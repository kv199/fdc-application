// Replays raw packets from fdc-lab.sqlite through the Shift Light learner and checks its shift points against a power-curve reference.
// Opens the lab (and optional fdc.sqlite) read-only; the only files it writes are the --out report and the --fixture export.
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { gunzipSync, gzipSync } from 'node:zlib'
import { decodePacket } from './shift-lab-decoder.mjs'

const require = createRequire(import.meta.url)
const { getShiftLightCarKey, ShiftLightLearner } = require('../overlay/shift-light-engine.js')

const NEUTRAL_GEAR = 11
const NEUTRAL_WINDOW_MS = 400
const PRE_SHIFT_WINDOW_MS = 200
const MAX_SOURCE_FRAMES = 5
const CUE_WINDOW_MS = 3000
const ACCEPT_WINDOW_MS = 1000
const FLAG_RPM = 150
const CURVE_BIN_RPM = 100
const CURVE_MIN_FRAMES = 3
const RATIO_MIN_FRAMES = 10
const SCAN_STEP_RPM = 50
const AT_CEILING_RPM = 200
const SLIP_LIMIT = 0.15
// Mirrors the learner's PRE_SHIFT_SETTLE_MS: a clean run counts only after this long in one gear.
const SETTLE_MS = 150
// Mirrors the learner's MAX_TIMESTAMP_GAP_MS: a larger jump, or time going backwards, starts a new run.
const MAX_TIMESTAMP_GAP_MS = 1000
const SHIFT_TABLES = ['shift_light_configs', 'shift_light_gear_targets']
const FIXTURE_FORMAT = 'fdc-shift-lab-fixture'
const FIXTURE_VERSION = 1
const USAGE = [
  'Usage: node tools/shift-lab.mjs --lab <fdc-lab.sqlite> [--fdc <fdc.sqlite>] [--session <id>] [--json] [--out <file>]',
  '       node tools/shift-lab.mjs --lab <fdc-lab.sqlite> [--session <id>] [--car <key>] --fixture <file.json.gz>'
].join('\n')

function quantile(values, fraction) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
}

function median(values) {
  return quantile(values, 0.5)
}

function maxAbsSlip(slip) {
  return Math.max(Math.abs(slip.fl), Math.abs(slip.fr), Math.abs(slip.rl), Math.abs(slip.rr))
}

// Engine power is the same with or without wheelspin, so the power curve uses every full-throttle frame;
// rpm / speed only gives a gear ratio while the wheels do not slip.
function isCleanPowerFrame(frame) {
  return frame.isRaceOn && frame.gear >= 1 && frame.gear <= 10 && frame.throttle >= 0.95 && frame.clutch <= 0.05 &&
    frame.brake <= 0.02 && frame.handBrake <= 0.02 && frame.power > 0 && frame.speedKmh > 20
}

function isCleanRatioFrame(frame) {
  return isCleanPowerFrame(frame) && maxAbsSlip(frame.slipRatio) < SLIP_LIMIT
}

function referenceFrame(frame) {
  return {
    isRaceOn: frame.isRaceOn, gear: frame.gear, rpm: frame.rpm, speedKmh: frame.speedKmh, throttle: frame.throttle,
    clutch: frame.clutch, brake: frame.brake, handBrake: frame.handBrake, power: frame.power, slipRatio: frame.slipRatio
  }
}

// Power at an RPM by linear interpolation between bin centres; null unless both neighbouring bins are covered.
function curveValue(curve, rpm) {
  const position = rpm / CURVE_BIN_RPM - 0.5
  const low = Math.floor(position)
  const lowValue = curve.get(low)
  const highValue = curve.get(low + 1)
  if (lowValue === undefined || highValue === undefined) return null
  return lowValue + (highValue - lowValue) * (position - low)
}

// Scans every 50-RPM point from the power peak to the ceiling and skips points where either power is unknown.
// Coverage is the share of those points that could be evaluated, so a crossover found on thin data stays visible.
function crossoverPoint(curve, ratioStep, ceilingRpm) {
  let peak = null
  for (const bin of [...curve.keys()].sort((left, right) => left - right)) {
    const rpm = bin * CURVE_BIN_RPM + CURVE_BIN_RPM / 2
    if (rpm <= ceilingRpm && (peak === null || curve.get(bin) > peak.value)) peak = { rpm, value: curve.get(bin) }
  }
  if (peak === null) return { kind: 'insufficient-data', referenceRpm: null, coverage: null }
  let steps = 0
  let evaluable = 0
  let highest = null
  let crossover = null
  let sawLower = false
  for (let rpm = peak.rpm; rpm <= ceilingRpm; rpm += SCAN_STEP_RPM) {
    steps++
    const here = curveValue(curve, rpm)
    const shifted = curveValue(curve, rpm * ratioStep)
    if (here === null || shifted === null) continue
    evaluable++
    highest = rpm
    if (crossover === null && shifted >= here) crossover = { rpm, bounded: sawLower }
    if (crossover === null) sawLower = true
  }
  const coverage = Math.round(evaluable / steps * 100) / 100
  // Without a known point where the current gear was still stronger, the crossover may lie in the gap before it.
  if (crossover !== null) return { kind: crossover.bounded ? 'crossover' : 'at-or-below', referenceRpm: crossover.rpm, coverage }
  if (highest !== null && ceilingRpm - highest <= AT_CEILING_RPM) return { kind: 'at-ceiling', referenceRpm: ceilingRpm, coverage }
  return { kind: 'insufficient-data', referenceRpm: null, coverage }
}

// Reference shift points from clean full-throttle frames only; replaySession passes only settled frames.
// The learner's own state is passed in to compare against.
export function referenceModel(frames, ceilingRpm = null, learnerPairs = []) {
  const clean = frames.filter(isCleanPowerFrame)
  // Recordings hold hundreds of thousands of frames, so values are pushed in place and the maximum is found by reduce.
  const ceiling = ceilingRpm ?? (clean.length === 0 ? null : clean.reduce((highest, frame) => Math.max(highest, frame.rpm), 0))
  const binPowers = new Map()
  const gearRatios = new Map()
  const push = (map, key, value) => {
    const values = map.get(key)
    if (values) values.push(value)
    else map.set(key, [value])
  }
  for (const frame of clean) {
    push(binPowers, Math.floor(frame.rpm / CURVE_BIN_RPM), frame.power)
    if (isCleanRatioFrame(frame)) push(gearRatios, frame.gear, frame.rpm / frame.speedKmh)
  }
  const curve = new Map()
  for (const [bin, powers] of binPowers) {
    if (powers.length >= CURVE_MIN_FRAMES) curve.set(bin, quantile(powers, 0.9))
  }
  const ratios = new Map()
  for (const [gear, values] of gearRatios) {
    if (values.length >= RATIO_MIN_FRAMES) ratios.set(gear, { ratio: median(values), frames: values.length })
  }
  const observedGears = new Set(clean.map(frame => frame.gear))
  const pairs = []
  for (let sourceGear = 1; sourceGear <= 9; sourceGear++) {
    if (!observedGears.has(sourceGear) || !observedGears.has(sourceGear + 1)) continue
    const from = ratios.get(sourceGear)
    const to = ratios.get(sourceGear + 1)
    const ratioStep = from && to ? to.ratio / from.ratio : null
    const point = ratioStep === null || ceiling === null
      ? { kind: 'insufficient-data', referenceRpm: null, coverage: null }
      : crossoverPoint(curve, ratioStep, ceiling)
    const learner = learnerPairs.find(pair => pair.sourceGear === sourceGear && pair.destinationGear === sourceGear + 1)
    const learnerRpm = ceiling === null ? null : learner?.targetRpm ?? learner?.candidateRpm ?? ceiling
    const differenceRpm = point.referenceRpm === null || learnerRpm === null ? null : learnerRpm - point.referenceRpm
    pairs.push({
      pair: `${sourceGear}->${sourceGear + 1}`,
      sourceGear,
      destinationGear: sourceGear + 1,
      ratioStep,
      referenceRpm: point.referenceRpm,
      kind: point.kind,
      coverage: point.coverage,
      learnerRpm,
      differenceRpm,
      flagged: differenceRpm !== null && Math.abs(differenceRpm) > FLAG_RPM
    })
  }
  return {
    ceilingRpm: ceiling,
    curveBins: curve.size,
    ratios: [...ratios].map(([gear, value]) => ({ gear, ratio: value.ratio, frames: value.frames })),
    pairs
  }
}

// An upshift is G -> G+1 directly, or through neutral when the destination appears within 400 ms of the first neutral frame.
export function findUpshifts(frames) {
  const shifts = []
  let source = null
  let neutral = null
  frames.forEach((frame, index) => {
    const gear = frame.gear
    if (gear >= 1 && gear <= 10) {
      if (source !== null && frames[source].gear <= 9 && gear === frames[source].gear + 1 &&
        (neutral === null || frame.timestampMs - frames[neutral].timestampMs <= NEUTRAL_WINDOW_MS)) {
        const sourceGear = frames[source].gear
        const window = []
        for (let back = source; back >= 0 && window.length < MAX_SOURCE_FRAMES; back--) {
          const candidate = frames[back]
          if (candidate.gear !== sourceGear || frame.timestampMs - candidate.timestampMs > PRE_SHIFT_WINDOW_MS) break
          window.push(candidate)
        }
        shifts.push({ index, source, sourceGear, destinationGear: gear, via: neutral === null ? 'direct' : 'neutral', window })
      }
      source = index
      neutral = null
    } else if (gear === NEUTRAL_GEAR) {
      if (source !== null && neutral === null) neutral = index
    } else {
      source = null
      neutral = null
    }
  })
  return shifts
}

function rejectionReason(window) {
  if (window.some(frame => frame.throttle < 0.95)) return 'partial-throttle'
  if (window.some(frame => frame.clutch > 0.05)) return 'clutch'
  if (window.some(frame => frame.brake > 0.02 || frame.handBrake > 0.02)) return 'brake'
  if (window.some(frame => frame.power <= 0)) return 'no-power'
  return 'capture-incomplete'
}

function createGroup(key) {
  const group = {
    key, sessionIds: [], spans: new Map(), frameCount: 0, cues: [], shifts: [],
    referenceFrames: [], referenceRun: null, maxRpm: null, lastPhase: null, lastSnapshot: null, currentSession: null, learner: null
  }
  group.learner = new ShiftLightLearner(key, { onLearningState: state => recordAcceptedSamples(group, state) })
  return group
}

// The learner publishes only when it appends a sample, so the newest sample is the last one in the list.
function recordAcceptedSamples(group, state) {
  const sample = state.shiftSamples.at(-1)
  if (!sample) return
  const shift = [...group.shifts].reverse().find(item => !item.accepted && item.sessionId === group.currentSession &&
    item.sourceGear === sample.sourceGear && sample.afterTimestampMs >= item.timestampMs &&
    sample.afterTimestampMs - item.timestampMs <= ACCEPT_WINDOW_MS)
  if (shift) Object.assign(shift, { accepted: true, reason: null, powerDeltaPct: sample.powerDeltaPct })
}

// Like the learner, the reference uses only frames at least SETTLE_MS into an uninterrupted clean run in one gear.
// Right after a clutch shift at full throttle the engine still turns faster than the road speed gives, without any
// tyre slip, so those first frames would corrupt both the gear ratios and the power curve.
function isSettledReferenceFrame(group, frame) {
  if (!isCleanPowerFrame(frame)) {
    group.referenceRun = null
    return false
  }
  const run = group.referenceRun
  const delta = run === null ? null : frame.timestampMs - run.lastMs
  if (run === null || run.gear !== frame.gear || !(delta >= 0 && delta <= MAX_TIMESTAMP_GAP_MS)) {
    group.referenceRun = { gear: frame.gear, startMs: frame.timestampMs, lastMs: frame.timestampMs }
    return false
  }
  run.lastMs = frame.timestampMs
  return frame.timestampMs - run.startMs >= SETTLE_MS
}

function replaySession(session, frames, groups, totals) {
  const upshiftAt = new Map(findUpshifts(frames).map(shift => [shift.index, shift]))
  let active = null
  frames.forEach((frame, index) => {
    const key = getShiftLightCarKey(frame)
    if (key === null) {
      totals.keylessFrames++
      if (active) {
        active.learner.resetTransient()
        active.lastPhase = 'normal'
        active.referenceRun = null
      }
      return
    }
    if (!groups.has(key)) groups.set(key, createGroup(key))
    const group = groups.get(key)
    // active starts as null in every session, so this also restarts the clean run at a session start.
    if (group !== active) {
      group.learner.resetTransient()
      group.lastPhase = null
      group.referenceRun = null
    }
    active = group
    group.currentSession = session.id
    if (!group.sessionIds.includes(session.id)) group.sessionIds.push(session.id)
    const span = group.spans.get(session.id) ?? { first: frame.timestampMs, last: frame.timestampMs }
    span.last = frame.timestampMs
    group.spans.set(session.id, span)
    group.frameCount++
    totals.keyedFrames++
    if (frame.gear >= 1 && frame.gear <= 10) group.maxRpm = Math.max(group.maxRpm ?? 0, frame.rpm)
    if (isSettledReferenceFrame(group, frame)) group.referenceFrames.push(referenceFrame(frame))

    const detected = upshiftAt.get(index)
    if (detected) {
      const cue = [...group.cues].reverse().find(item => item.sessionId === session.id && item.gear === detected.sourceGear &&
        frame.timestampMs - item.timestampMs >= 0 && frame.timestampMs - item.timestampMs <= CUE_WINDOW_MS)
      group.shifts.push({
        sessionId: session.id,
        timestampMs: frame.timestampMs,
        sourceGear: detected.sourceGear,
        destinationGear: detected.destinationGear,
        via: detected.via,
        rpmBefore: frames[detected.source].rpm,
        cueDelayMs: cue ? frame.timestampMs - cue.timestampMs : null,
        accepted: false,
        reason: rejectionReason(detected.window),
        powerDeltaPct: null
      })
    }

    const snapshot = group.learner.update(frame)
    group.lastSnapshot = snapshot
    if (snapshot.phase === 'shift' && group.lastPhase !== 'shift') {
      group.cues.push({
        sessionId: session.id,
        timestampMs: frame.timestampMs,
        gear: frame.gear,
        rpm: frame.rpm,
        lightOnRpm: snapshot.lightOnRpm,
        effectiveTargetRpm: snapshot.effectiveTargetRpm
      })
    }
    group.lastPhase = snapshot.phase
  })
}

function readGameConfig(fdcDb, identity) {
  const config = fdcDb.prepare(`SELECT id, usable_ceiling_rpm FROM shift_light_configs
    WHERE game_id = 'fh6' AND car_ordinal = ? AND car_class = ? AND car_performance_index = ? AND drivetrain_type = ? AND num_cylinders = ?`)
    .get(identity.carOrdinal, identity.carClass, identity.pi, identity.drivetrain, identity.cylinders)
  if (!config) return { found: false, usableCeilingRpm: null, pairs: [] }
  const pairs = fdcDb.prepare(`SELECT source_gear, destination_gear, status, candidate_rpm, optimal_rpm, confirmation_count
    FROM shift_light_gear_targets WHERE config_id = ? ORDER BY source_gear`).all(config.id)
    .map(row => ({
      sourceGear: row.source_gear,
      destinationGear: row.destination_gear,
      status: row.status,
      candidateRpm: row.candidate_rpm,
      optimalRpm: row.optimal_rpm,
      confirmationCount: row.confirmation_count
    }))
  return { found: true, usableCeilingRpm: config.usable_ceiling_rpm, pairs }
}

function fdcStatus(fdcDb) {
  const tables = fdcDb.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${SHIFT_TABLES.map(() => '?').join(',')})`)
    .all(...SHIFT_TABLES).map(row => row.name)
  const missing = SHIFT_TABLES.filter(name => !tables.includes(name))
  return missing.length === 0
    ? { available: true, message: 'Shift Light tables present' }
    : { available: false, message: `missing tables: ${missing.join(', ')}` }
}

// The learner's own model point for a pair, read from the last snapshot of the replay.
function learnerModel(snapshot, sourceGear) {
  const gear = snapshot?.gears.find(item => item.gear === sourceGear)
  if (!gear) return null
  const model = snapshot.diagnostics.find(item => item.gear === sourceGear)?.model ?? null
  return {
    modelRpm: gear.modelRpm,
    shiftAtRpm: gear.shiftAtRpm,
    ready: gear.ready,
    kind: model?.kind ?? null,
    coverage: model?.coverage ?? null,
    agree: model?.agree ?? 0,
    contradict: model?.contradict ?? 0,
    rejected: model?.rejected ?? false
  }
}

function summarizeCar(group, fdcDb) {
  const [, carOrdinal, carClass, pi, drivetrain, cylinders] = group.key.split(':').map((part, index) => index === 0 ? part : Number(part))
  const identity = { gameId: 'fh6', carOrdinal, carClass, pi, drivetrain, cylinders }
  const state = group.learner.serializeLearningState()
  const usableCeiling = state.usableCeiling ?? null
  const provisionalCeiling = group.lastSnapshot?.provisionalCeiling ?? null
  const ceilingRpm = usableCeiling ?? provisionalCeiling ?? group.maxRpm
  const learnerPairs = state.gearTargets.map(target => ({
    sourceGear: target.sourceGear,
    destinationGear: target.destinationGear,
    status: target.status,
    candidateRpm: target.candidateRpm,
    targetRpm: target.targetRpm,
    confirmationCount: target.confirmationCount
  }))
  const reference = referenceModel(group.referenceFrames, ceilingRpm, learnerPairs)
  const game = fdcDb ? readGameConfig(fdcDb, identity) : null
  const shifts = group.shifts
  const accepted = shifts.filter(shift => shift.accepted)
  const rejections = {}
  for (const shift of shifts.filter(item => !item.accepted)) rejections[shift.reason] = (rejections[shift.reason] ?? 0) + 1
  const delays = shifts.map(shift => shift.cueDelayMs).filter(value => value !== null)
  const sourceGears = new Set([
    ...learnerPairs.map(pair => pair.sourceGear),
    ...reference.pairs.map(pair => pair.sourceGear),
    ...(game?.pairs ?? []).map(pair => pair.sourceGear),
    ...shifts.map(shift => shift.sourceGear)
  ])
  const comparison = [...sourceGears].sort((left, right) => left - right).map(sourceGear => {
    const learner = learnerPairs.find(pair => pair.sourceGear === sourceGear)
    const model = learnerModel(group.lastSnapshot, sourceGear)
    const referencePair = reference.pairs.find(pair => pair.sourceGear === sourceGear) ?? null
    const gamePair = game?.pairs.find(pair => pair.sourceGear === sourceGear) ?? null
    const replayRpm = learner ? learner.targetRpm ?? learner.candidateRpm : null
    const gameRpm = gamePair ? gamePair.optimalRpm ?? gamePair.candidateRpm : null
    const flags = []
    if (referencePair?.flagged) flags.push('reference-diff')
    if (replayRpm !== null && gameRpm !== null && Math.abs(replayRpm - gameRpm) > FLAG_RPM) flags.push('game-vs-replay')
    return {
      pair: `${sourceGear}->${sourceGear + 1}`,
      sourceGear,
      destinationGear: sourceGear + 1,
      replay: learner ? { status: learner.status, rpm: replayRpm } : null,
      game: gamePair ? { status: gamePair.status, rpm: gameRpm } : null,
      reference: referencePair
        ? { kind: referencePair.kind, rpm: referencePair.referenceRpm, ratioStep: referencePair.ratioStep, coverage: referencePair.coverage }
        : null,
      differenceRpm: referencePair?.differenceRpm ?? null,
      model,
      flags
    }
  })
  const spans = [...group.spans.values()]
  return {
    key: group.key,
    identity,
    sessionIds: group.sessionIds,
    frames: group.frameCount,
    durationMs: spans.reduce((total, span) => total + Math.max(0, span.last - span.first), 0),
    ceiling: {
      usable: usableCeiling,
      provisional: provisionalCeiling,
      reportedRedlineRpm: state.reportedRedlineRpm,
      maxObservedRpm: group.maxRpm,
      usedForReference: ceilingRpm,
      samples: state.ceilingSamples,
      game: game ? { usableCeilingRpm: game.usableCeilingRpm, differenceRpm: usableCeiling === null || game.usableCeilingRpm === null ? null : usableCeiling - game.usableCeilingRpm } : null
    },
    learner: { gearTargets: state.gearTargets, acceptedSamples: state.shiftSamples },
    game,
    comparison,
    reference,
    cues: group.cues,
    shifts,
    summary: {
      cueCount: group.cues.length,
      shiftCount: shifts.length,
      acceptedCount: accepted.length,
      acceptanceRate: shifts.length === 0 ? null : accepted.length / shifts.length,
      rejections,
      medianCueDelayMs: median(delays),
      cueDelayCount: delays.length
    }
  }
}

function readLabSessions(db, sessionId) {
  return db.prepare('SELECT id FROM lab_sessions ORDER BY started_at_ms, id').all()
    .filter(session => sessionId === null || session.id === sessionId)
}

// Decodes one session at a time so a long recording is never held in memory twice.
function* decodeLabSessions(db, sessions, totals) {
  for (const session of sessions) {
    const packets = db.prepare('SELECT sequence, packet FROM lab_packets WHERE session_id = ? ORDER BY sequence').all(session.id)
    const frames = []
    for (const row of packets) {
      totals.packets++
      const frame = decodePacket(row.packet)
      if (frame) frames.push(frame)
      else totals.undecodedPackets++
    }
    yield { id: session.id, frames }
  }
}

// Replays already-decoded sessions, given in order as { id, frames }, through one learner per car.
export function replayFrames(sessions, options = {}) {
  const { fdcDb = null } = options
  const groups = new Map()
  const totals = { keylessFrames: 0, keyedFrames: 0 }
  for (const session of sessions) replaySession(session, session.frames, groups, totals)
  const fdc = fdcDb ? fdcStatus(fdcDb) : null
  const cars = [...groups.values()].map(group => summarizeCar(group, fdc?.available ? fdcDb : null))
  return { keylessFrames: totals.keylessFrames, keyedFrames: totals.keyedFrames, fdc, cars }
}

export function replayLab(db, options = {}) {
  const { sessionId = null, fdcDb = null } = options
  const schemaVersion = db.prepare('SELECT version FROM lab_schema_version').get()?.version ?? null
  const sessions = readLabSessions(db, sessionId)
  const totals = { packets: 0, undecodedPackets: 0 }
  const replay = replayFrames(decodeLabSessions(db, sessions, totals), { fdcDb })
  return {
    schemaVersion,
    sessions: sessions.length,
    packets: totals.packets,
    undecodedPackets: totals.undecodedPackets,
    ...replay
  }
}

function fixtureFrame(frame) {
  const { car, slipRatio } = frame
  return {
    isRaceOn: frame.isRaceOn, timestampMs: frame.timestampMs, rpm: frame.rpm, rpmMax: frame.rpmMax, speedKmh: frame.speedKmh,
    power: frame.power, gear: frame.gear, throttle: frame.throttle, brake: frame.brake, clutch: frame.clutch, handBrake: frame.handBrake,
    car: { ordinal: car.ordinal, class: car.class, pi: car.pi, drivetrain: car.drivetrain, cylinders: car.cylinders },
    slipRatio: { fl: slipRatio.fl, fr: slipRatio.fr, rl: slipRatio.rl, rr: slipRatio.rr }
  }
}

function carKeys(sessions) {
  const keys = new Set()
  for (const session of sessions) {
    for (const frame of session.frames) {
      const key = getShiftLightCarKey(frame)
      if (key !== null) keys.add(key)
    }
  }
  return [...keys]
}

// Keeps the car's frames and keyless frames with only the fields the learner and the reference read.
// A run of another car's frames becomes one keyless frame, so the learner still resets where the car changed.
export function toFixture(sessions, key) {
  const kept = []
  for (const session of sessions) {
    const frames = []
    let foreign = false
    let hasCar = false
    for (const frame of session.frames) {
      const frameKey = getShiftLightCarKey(frame)
      if (frameKey !== null && frameKey !== key) {
        if (!foreign) frames.push({ ...fixtureFrame(frame), car: { ordinal: 0, class: 0, pi: 0, drivetrain: 0, cylinders: 0 } })
        foreign = true
        continue
      }
      foreign = false
      if (frameKey === key) hasCar = true
      frames.push(fixtureFrame(frame))
    }
    if (hasCar) kept.push({ id: session.id, frames })
  }
  return { format: FIXTURE_FORMAT, formatVersion: FIXTURE_VERSION, key, sessions: kept }
}

export function loadFixture(path) {
  const fixture = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8'))
  if (fixture?.format !== FIXTURE_FORMAT || fixture.formatVersion !== FIXTURE_VERSION) {
    throw new Error(`${path} is not a ${FIXTURE_FORMAT} v${FIXTURE_VERSION} file`)
  }
  return fixture
}

// Fixtures are <name>.json.gz files; only those with a hand-written <name>.expect.json next to them are checked.
export function findFixtures(dir) {
  if (!existsSync(dir)) return { fixtures: [], unmatched: [] }
  const files = readdirSync(dir).sort()
  const fixtures = []
  const unmatched = []
  for (const file of files.filter(name => name.endsWith('.json.gz'))) {
    const name = file.slice(0, -'.json.gz'.length)
    if (files.includes(`${name}.expect.json`)) fixtures.push({ name, path: join(dir, file), expectPath: join(dir, `${name}.expect.json`) })
    else unmatched.push(name)
  }
  return { fixtures, unmatched }
}

export function writeFixture(path, fixture) {
  mkdirSync(dirname(resolve(path)), { recursive: true })
  writeFileSync(path, gzipSync(JSON.stringify(fixture), { level: 9 }))
}

// Compares a replayed car with hand-written expectations; every key is optional and an empty list means it passed.
export function checkExpectations(carResult, expect) {
  const failures = []
  if (expect.usableCeilingRpm !== undefined) {
    const [min, max] = expect.usableCeilingRpm
    const usable = carResult.ceiling.usable
    if (usable === null || usable === undefined) failures.push(`usable ceiling is null, expected ${min}-${max}`)
    else if (usable < min || usable > max) failures.push(`usable ceiling ${usable} is outside ${min}-${max}`)
  }
  const targets = carResult.learner.gearTargets
  if (expect.minLearnedShiftRpm !== undefined) {
    for (const target of targets.filter(item => item.status === 'potential' || item.status === 'optimal')) {
      const rpm = target.targetRpm ?? target.candidateRpm
      if (rpm === null || rpm === undefined || rpm < expect.minLearnedShiftRpm) {
        failures.push(`${target.sourceGear}->${target.destinationGear} ${target.status} at ${rpm ?? 'no RPM'}, expected at least ${expect.minLearnedShiftRpm}`)
      }
    }
  }
  for (const [pair, status] of Object.entries(expect.pairs ?? {})) {
    const [sourceGear, destinationGear] = pair.split('->').map(Number)
    const target = targets.find(item => item.sourceGear === sourceGear && item.destinationGear === destinationGear)
    if (!target) failures.push(`${pair} has no learner state, expected ${status}`)
    else if (target.status !== status) failures.push(`${pair} is ${target.status}, expected ${status}`)
  }
  if (expect.minAcceptedShifts !== undefined && carResult.summary.acceptedCount < expect.minAcceptedShifts) {
    failures.push(`${carResult.summary.acceptedCount} accepted shifts, expected at least ${expect.minAcceptedShifts}`)
  }
  for (const [pair, [min, max]] of Object.entries(expect.shiftAtRpm ?? {})) {
    const shiftAtRpm = carResult.comparison.find(item => item.pair === pair)?.model?.shiftAtRpm ?? null
    if (shiftAtRpm === null) failures.push(`${pair} has no shift point, expected ${min}-${max}`)
    else if (shiftAtRpm < min || shiftAtRpm > max) failures.push(`${pair} shifts at ${shiftAtRpm}, outside ${min}-${max}`)
  }
  for (const [pair, [min, max]] of Object.entries(expect.referenceRpm ?? {})) {
    const reference = carResult.reference.pairs.find(item => item.pair === pair)
    if (!reference) failures.push(`${pair} has no reference, expected a crossover at ${min}-${max}`)
    else if (reference.kind !== 'crossover') failures.push(`${pair} reference is ${reference.kind}, expected a crossover at ${min}-${max}`)
    else if (reference.referenceRpm < min || reference.referenceRpm > max) {
      failures.push(`${pair} reference crossover ${reference.referenceRpm} is outside ${min}-${max}`)
    }
  }
  return failures
}

function pad(text, width) {
  return String(text).padEnd(width)
}

function formatPoint(point, label = '') {
  if (!point) return '-'
  const rpm = point.rpm === null || point.rpm === undefined ? '' : ` ${Math.round(point.rpm)}`
  return `${point.status ?? point.kind ?? label}${rpm}`
}

// The learner's model point and whether the pair is ready: `7500 ready`, `9498 ready (limiter)`, `- learning`.
function formatModel(model) {
  if (!model) return '-'
  const rpm = model.modelRpm === null ? '-' : String(model.modelRpm)
  const suffix = model.rejected ? ' (rejected)' : model.modelRpm !== null && model.kind === 'at-limiter' ? ' (limiter)' : ''
  return `${rpm} ${model.ready ? 'ready' : 'learning'}${suffix}`
}

function formatDifference(value) {
  if (value === null || value === undefined) return '-'
  return `${value >= 0 ? '+' : ''}${Math.round(value)}`
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`
}

export function formatReport(result) {
  const lines = ['Shift Light lab replay', '']
  lines.push(`lab: ${result.source?.lab ?? '(not named)'}, schema v${result.schemaVersion}`)
  lines.push(`sessions ${result.sessions}, packets ${result.packets}, undecoded ${result.undecodedPackets}, keyless frames ${result.keylessFrames}`)
  if (result.fdc === null) lines.push('game comparison: not requested (--fdc)')
  else lines.push(`game comparison: ${result.fdc.available ? result.source?.fdc ?? 'fdc.sqlite' : 'unavailable'}; ${result.fdc.message}`)
  if (result.cars.length === 0) lines.push('', 'No keyed Shift Light frames found.')
  for (const car of result.cars) {
    const { identity, ceiling, summary } = car
    lines.push('', `## Car ${car.key}`)
    lines.push(`ordinal ${identity.carOrdinal}, class ${identity.carClass}, PI ${identity.pi}, drivetrain ${identity.drivetrain}, cylinders ${identity.cylinders}`)
    lines.push(`sessions ${car.sessionIds.length} (${car.sessionIds.join(', ')}), frames ${car.frames}, duration ${formatSeconds(car.durationMs)}`)
    const gameText = ceiling.game
      ? `game ${ceiling.game.usableCeilingRpm ?? '-'} (difference ${formatDifference(ceiling.game.differenceRpm)})`
      : 'game -'
    lines.push(`ceiling: replay usable ${ceiling.usable ?? '-'}, provisional ${ceiling.provisional ?? '-'}, redline ${ceiling.reportedRedlineRpm ?? '-'}, max observed ${ceiling.maxObservedRpm ?? '-'}; ${gameText}; reference uses ${ceiling.usedForReference ?? '-'}`)
    lines.push('')
    const header = [pad('pair', 8), pad('replay', 22), pad('model', 22), pad('game', 22), pad('reference', 30), pad('diff', 8), 'flags']
    lines.push(header.join(' '))
    for (const row of car.comparison) {
      const reference = row.reference
        ? `${row.reference.kind}${row.reference.rpm === null ? '' : ` ${Math.round(row.reference.rpm)}`}` +
          `${row.reference.coverage === null ? '' : ` (cov ${row.reference.coverage.toFixed(2)})`}`
        : '-'
      lines.push([
        pad(row.pair, 8),
        pad(formatPoint(row.replay), 22),
        pad(formatModel(row.model), 22),
        pad(formatPoint(row.game), 22),
        pad(reference, 30),
        pad(formatDifference(row.differenceRpm), 8),
        row.flags.join(', ')
      ].join(' ').trimEnd())
    }
    lines.push('')
    lines.push(`cues: ${summary.cueCount}`)
    const acceptance = summary.acceptanceRate === null ? '-' : `${Math.round(summary.acceptanceRate * 100)}%`
    lines.push(`shifts: ${summary.shiftCount} upshifts, ${summary.acceptedCount} accepted (${acceptance})`)
    const rejected = Object.entries(summary.rejections).map(([reason, count]) => `${reason} ${count}`).join(', ')
    lines.push(`not accepted: ${rejected || 'none'}`)
    const delay = summary.medianCueDelayMs === null ? '-' : `${Math.round(summary.medianCueDelayMs)} ms over ${summary.cueDelayCount} shifts with a cue`
    lines.push(`median cue-to-shift delay: ${delay}`)
    lines.push('note: the reference ignores the turbo boost drop after a shift; it compares clean full-throttle power only. ' +
      'cov is the share of 50-RPM points from the power peak to the ceiling where both powers were known. ' +
      'model is the learner\'s own model point at the end of the replay; ready means it has a model point in use or an optimal target.')
  }
  return `${lines.join('\n')}\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      lab: { type: 'string' },
      fdc: { type: 'string' },
      session: { type: 'string' },
      json: { type: 'boolean', default: false },
      out: { type: 'string' },
      fixture: { type: 'string' },
      car: { type: 'string' }
    }
  })
  if (!values.lab) {
    console.error(USAGE)
    process.exitCode = 1
  } else {
    const sessionId = values.session === undefined ? null : Number(values.session)
    if (sessionId !== null && !Number.isInteger(sessionId)) {
      console.error(USAGE)
      process.exitCode = 1
    } else if (values.fixture) {
      const labDb = new DatabaseSync(values.lab, { readOnly: true })
      try {
        const sessions = []
        for (const session of decodeLabSessions(labDb, readLabSessions(labDb, sessionId), { packets: 0, undecodedPackets: 0 })) {
          sessions.push({ id: session.id, frames: session.frames.map(fixtureFrame) })
        }
        const keys = carKeys(sessions)
        if (values.car ? !keys.includes(values.car) : keys.length !== 1) {
          const found = keys.length === 0 ? 'no car keys' : `car keys:\n${keys.map(key => `  ${key}`).join('\n')}`
          console.error(values.car ? `${values.car} is not in the selection; ${found}` : `Choose one car with --car; the selection has ${found}`)
          process.exitCode = 1
        } else {
          const fixture = toFixture(sessions, values.car ?? keys[0])
          writeFixture(values.fixture, fixture)
          const frames = fixture.sessions.reduce((total, session) => total + session.frames.length, 0)
          console.log(`${values.fixture}: ${fixture.key}, ${fixture.sessions.length} sessions, ${frames} frames`)
        }
      } finally {
        labDb.close()
      }
    } else {
      const labDb = new DatabaseSync(values.lab, { readOnly: true })
      const fdcDb = values.fdc ? new DatabaseSync(values.fdc, { readOnly: true }) : null
      try {
        const result = replayLab(labDb, { sessionId, fdcDb })
        result.source = { lab: values.lab, fdc: values.fdc ?? null }
        const text = values.json ? `${JSON.stringify(result, null, 2)}\n` : formatReport(result)
        if (values.out) writeFileSync(values.out, text)
        else process.stdout.write(text)
      } finally {
        labDb.close()
        fdcDb?.close()
      }
    }
  }
}
