// Replays raw packets from fdc-lab.sqlite through the Shift Light learner and checks its shift points against a power-curve reference.
// Opens the lab (and optional fdc.sqlite) read-only; the only file it writes is the --out report.
import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
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
const SLIP_LIMIT = 0.15
const SHIFT_TABLES = ['shift_light_configs', 'shift_light_gear_targets']
const USAGE = 'Usage: node tools/shift-lab.mjs --lab <fdc-lab.sqlite> [--fdc <fdc.sqlite>] [--session <id>] [--json] [--out <file>]'

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

function isCleanFrame(frame) {
  return frame.isRaceOn && frame.gear >= 1 && frame.gear <= 10 && frame.throttle >= 0.95 && frame.clutch <= 0.05 &&
    frame.brake <= 0.02 && frame.handBrake <= 0.02 && frame.power > 0 && frame.speedKmh > 20 && maxAbsSlip(frame.slipRatio) < SLIP_LIMIT
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

function crossoverPoint(curve, ratioStep, ceilingRpm) {
  let peak = null
  for (const bin of [...curve.keys()].sort((left, right) => left - right)) {
    const rpm = bin * CURVE_BIN_RPM + CURVE_BIN_RPM / 2
    if (rpm <= ceilingRpm && (peak === null || curve.get(bin) > peak.value)) peak = { rpm, value: curve.get(bin) }
  }
  if (peak === null) return { kind: 'insufficient-data', referenceRpm: null }
  for (let rpm = peak.rpm; rpm <= ceilingRpm; rpm += SCAN_STEP_RPM) {
    const here = curveValue(curve, rpm)
    const shifted = curveValue(curve, rpm * ratioStep)
    if (here === null || shifted === null) return { kind: 'insufficient-data', referenceRpm: null }
    if (shifted >= here) return { kind: 'crossover', referenceRpm: rpm }
  }
  return { kind: 'at-ceiling', referenceRpm: ceilingRpm }
}

// Reference shift points from clean full-throttle frames only; the learner's own state is passed in to compare against.
export function referenceModel(frames, ceilingRpm = null, learnerPairs = []) {
  const clean = frames.filter(isCleanFrame)
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
    push(gearRatios, frame.gear, frame.rpm / frame.speedKmh)
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
      ? { kind: 'insufficient-data', referenceRpm: null }
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
    referenceFrames: [], maxRpm: null, lastPhase: null, lastSnapshot: null, currentSession: null, learner: null
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
      }
      return
    }
    if (!groups.has(key)) groups.set(key, createGroup(key))
    const group = groups.get(key)
    if (group !== active) {
      group.learner.resetTransient()
      group.lastPhase = null
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
    if (isCleanFrame(frame)) group.referenceFrames.push(referenceFrame(frame))

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
      reference: referencePair ? { kind: referencePair.kind, rpm: referencePair.referenceRpm, ratioStep: referencePair.ratioStep } : null,
      differenceRpm: referencePair?.differenceRpm ?? null,
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

export function replayLab(db, options = {}) {
  const { sessionId = null, fdcDb = null } = options
  const schemaVersion = db.prepare('SELECT version FROM lab_schema_version').get()?.version ?? null
  const sessions = db.prepare('SELECT id, started_at_ms, finished_at_ms, app_version, shift_light_model_version FROM lab_sessions ORDER BY started_at_ms, id').all()
    .filter(session => sessionId === null || session.id === sessionId)
  const groups = new Map()
  const totals = { packets: 0, undecodedPackets: 0, keylessFrames: 0, keyedFrames: 0 }
  for (const session of sessions) {
    const packets = db.prepare('SELECT sequence, packet FROM lab_packets WHERE session_id = ? ORDER BY sequence').all(session.id)
    const frames = []
    for (const row of packets) {
      totals.packets++
      const frame = decodePacket(row.packet)
      if (frame) frames.push(frame)
      else totals.undecodedPackets++
    }
    replaySession(session, frames, groups, totals)
  }
  const fdc = fdcDb ? fdcStatus(fdcDb) : null
  const cars = [...groups.values()].map(group => summarizeCar(group, fdc?.available ? fdcDb : null))
  return {
    schemaVersion,
    sessions: sessions.length,
    packets: totals.packets,
    undecodedPackets: totals.undecodedPackets,
    keylessFrames: totals.keylessFrames,
    keyedFrames: totals.keyedFrames,
    fdc,
    cars
  }
}

function pad(text, width) {
  return String(text).padEnd(width)
}

function formatPoint(point, label = '') {
  if (!point) return '-'
  const rpm = point.rpm === null || point.rpm === undefined ? '' : ` ${Math.round(point.rpm)}`
  return `${point.status ?? point.kind ?? label}${rpm}`
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
    const header = [pad('pair', 8), pad('replay', 22), pad('game', 22), pad('reference', 24), pad('diff', 8), 'flags']
    lines.push(header.join(' '))
    for (const row of car.comparison) {
      const reference = row.reference ? `${row.reference.kind}${row.reference.rpm === null ? '' : ` ${Math.round(row.reference.rpm)}`}` : '-'
      lines.push([
        pad(row.pair, 8),
        pad(formatPoint(row.replay), 22),
        pad(formatPoint(row.game), 22),
        pad(reference, 24),
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
    lines.push('note: the reference ignores the turbo boost drop after a shift; it compares clean full-throttle power only.')
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
      out: { type: 'string' }
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
