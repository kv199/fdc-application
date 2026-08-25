const assert = require('node:assert/strict')
const test = require('node:test')

const {
  AsphaltCoachState,
  PHASES,
  normalizeFrame
} = require('./asphalt-coach-state.js')
const {
  AsphaltCoachFindings,
  FINDINGS,
  learnedThresholds
} = require('./asphalt-coach-findings.js')
const {
  AsphaltCoachPresentation,
  buildDriverBrief,
  CUE_META
} = require('./asphalt-coach-presentation.js')

function frame(timestampMs, overrides = {}) {
  return {
    isRaceOn: true,
    timestampMs,
    speedKmh: 100,
    rpmMax: 8000,
    throttle: 0,
    brake: 0,
    steer: 0,
    slipRatio: { fl: 0.02, fr: 0.02, rl: 0.02, rr: 0.02 },
    slipAngle: { fl: 0.05, fr: 0.05, rl: 0.04, rr: 0.04 },
    combinedSlip: { fl: 0.2, fr: 0.2, rl: 0.15, rr: 0.15 },
    acceleration: { x: 1, y: 0, z: 1 },
    angularVelocity: { y: 0.3 },
    car: { ordinal: 1, pi: 800, drivetrain: 1 },
    lap: { raceTime: timestampMs / 1000, number: 1, distance: timestampMs },
    ...overrides
  }
}

function calibrationPrefix() {
  return Array.from({ length: 36 }, (_, index) => frame(index * 20, {
    speedKmh: 30 + Math.floor(index / 9) * 25 + (index % 9) * 0.05,
    acceleration: { x: 1, y: 0, z: 1 }
  }))
}

function calibratedReplay(frames) {
  const offsetMs = 740
  return calibrationPrefix().concat(frames.map(input => ({
    ...input,
    timestampMs: input.timestampMs + offsetMs,
    lap: {
      ...input.lap,
      raceTime: (input.timestampMs + offsetMs) / 1000,
      distance: input.timestampMs + offsetMs
    }
  })))
}

function runFrames(frames, options = {}) {
  const state = new AsphaltCoachState()
  const findings = new AsphaltCoachFindings()
  const events = []
  const replay = options.calibrated === false ? frames : calibratedReplay(frames)
  for (const input of replay) {
    const snapshot = state.update(input)
    const result = findings.update(snapshot)
    events.push(...result.events)
  }
  return { state, findings, events }
}

function turnInFrames(overrides = {}) {
  return [
    frame(0, { brake: 0.5 }),
    frame(20, { brake: 0.4, steer: 0.1 }),
    frame(40, { brake: 0.3, steer: 0.2 }),
    frame(60, { brake: 0.2, steer: 0.3, ...overrides })
  ]
}

function rotationFrames(overrides = {}) {
  return [
    ...turnInFrames(),
    frame(80, { brake: 0.08, steer: 0.3, ...overrides })
  ]
}

function exitFrames() {
  return [
    ...rotationFrames(),
    frame(100, { brake: 0, steer: 0.3, throttle: 0.25, speedKmh: 100.05 }),
    frame(120, { brake: 0, steer: 0.3, throttle: 0.5, speedKmh: 100.11 }),
    frame(140, { brake: 0, steer: 0.3, throttle: 0.51, speedKmh: 100.17 })
  ]
}

function frontScrubScenario(positive) {
  const frames = turnInFrames({
    slipAngle: { fl: 0.15, fr: 0.15, rl: 0.05, rr: 0.05 },
    combinedSlip: { fl: 0.7, fr: 0.7, rl: 0.1, rr: 0.1 }
  })
  for (let index = 0; index < 12; index += 1) {
    const growth = positive ? index * 0.01 : 0
    frames.push(frame(80 + index * 20, {
      brake: 0.2,
      steer: 0.3 + (positive ? index * 0.01 : 0),
      slipAngle: { fl: 0.16 + growth, fr: 0.16 + growth, rl: 0.05, rr: 0.05 },
      combinedSlip: { fl: 0.7, fr: 0.7, rl: 0.1, rr: 0.1 },
      acceleration: { x: positive ? 1 : 1 + index * 0.02, y: 0, z: 1 },
      angularVelocity: { y: positive ? 0.3 : 0.3 + index * 0.02 }
    }))
  }
  return frames
}

function wheelspinScenario(positive) {
  const frames = exitFrames()
  for (let index = 0; index < 12; index += 1) {
    frames.push(frame(160 + index * 20, {
      steer: 0.3,
      throttle: 0.68 + index * 0.01,
      speedKmh: positive ? 100.18 + index * 0.001 : 100.18 + index * 0.06,
      slipRatio: positive
        ? { fl: 0.02, fr: 0.02, rl: 0.2, rr: 0.2 }
        : { fl: 0.02, fr: 0.02, rl: 0.03, rr: 0.03 }
    }))
  }
  return frames
}

function overloadScenario(positive) {
  const frames = turnInFrames()
  for (let index = 0; index < 12; index += 1) {
    frames.push(frame(80 + index * 20, {
      brake: 0.3,
      steer: 0.3,
      combinedSlip: { fl: positive ? 0.9 : 0.7, fr: positive ? 0.9 : 0.7, rl: 0.1, rr: 0.1 },
      acceleration: { x: positive ? 1 : 1 + index * 0.02, y: 0, z: 1 },
      angularVelocity: { y: positive ? 0.3 : 0.3 + index * 0.02 }
    }))
  }
  return frames
}

function abruptReleaseScenario(positive) {
  const frames = rotationFrames({ brake: 0.5, steer: 0.25 })
  frames.push(frame(100, {
    brake: 0.5,
    steer: 0.25,
    acceleration: { x: 1, y: 0, z: 1 },
    angularVelocity: { y: 0.5 },
    slipAngle: { fl: 0.12, fr: 0.12, rl: 0.05, rr: 0.05 }
  }))
  frames.push(frame(120, {
    brake: 0.35,
    steer: 0.25,
    acceleration: { x: 1, y: 0, z: 1 },
    angularVelocity: { y: 0.5 },
    slipAngle: { fl: 0.12, fr: 0.12, rl: 0.05, rr: 0.05 }
  }))
  for (let index = 0; index < 5; index += 1) {
    frames.push(frame(140 + index * 20, {
      brake: 0.3,
      steer: 0.25,
      acceleration: { x: positive ? 0.7 : 1, y: 0, z: 1 },
      angularVelocity: { y: positive ? 0.2 : 0.5 },
      slipAngle: { fl: 0.12, fr: 0.12, rl: positive ? 0.2 : 0.05, rr: positive ? 0.2 : 0.05 }
    }))
  }
  return frames
}

function controlledReleaseScenario(positive) {
  const frames = turnInFrames({
    brake: 0.3,
    steer: 0.25,
    combinedSlip: { fl: 0.6, fr: 0.6, rl: 0.1, rr: 0.1 }
  })
  for (let index = 0; index < 12; index += 1) {
    frames.push(frame(80 + index * 20, {
      brake: positive ? 0.3 - index * 0.01 : 0.3,
      steer: 0.25,
      combinedSlip: { fl: 0.6, fr: 0.6, rl: 0.1, rr: 0.1 },
      acceleration: { x: 1, y: 0, z: 1 + (positive ? index * 0.01 : 0) }
    }))
  }
  return frames
}

function cleanExitScenario(positive) {
  const frames = exitFrames()
  for (let index = 0; index < 12; index += 1) {
    frames.push(frame(160 + index * 20, {
      steer: 0.3,
      throttle: positive ? 0.52 + index * 0.01 : 0.52,
      speedKmh: positive ? 100.2 + index * 0.06 : 100.2,
      slipRatio: { fl: 0.02, fr: 0.02, rl: 0.03, rr: 0.03 }
    }))
  }
  return frames
}

function hasFinding(frames, kind) {
  return runFrames(frames).events.some(event => event.kind === kind)
}

test('state emits the map-free STRAIGHT to BRAKING to TURN-IN to ROTATION to EXIT lifecycle', () => {
  const state = new AsphaltCoachState()
  const phases = []
  const inputs = [
    frame(0),
    frame(20, { brake: 0.5 }),
    frame(40, { brake: 0.3, steer: 0.2 }),
    frame(60, { brake: 0.2, steer: 0.3 }),
    frame(80, { brake: 0, steer: 0.3 }),
    frame(100, { brake: 0, steer: 0.3, throttle: 0.3 })
  ]
  for (const input of inputs) phases.push(state.update(input).phase)
  assert.deepEqual(phases, [PHASES.STRAIGHT, PHASES.BRAKING, PHASES.TURN_IN, PHASES.TURN_IN, PHASES.ROTATION, PHASES.EXIT])
})

test('front scrub requires growing steering and front slip without improving response', () => {
  assert.equal(hasFinding(frontScrubScenario(true), FINDINGS.FRONT_SCRUB), true)
  assert.equal(hasFinding(frontScrubScenario(false), FINDINGS.FRONT_SCRUB), false)
})

test('lateral response uses FH6 local X and keeps longitudinal response on Z', () => {
  const sample = normalizeFrame(frame(0, {
    acceleration: { x: 2.5, y: 0.2, z: 9.5 }
  }))
  assert.equal(sample.lateralResponse, 2.5)
  assert.equal(sample.longitudinalResponse, 9.5)
})

test('exit wheelspin requires driven slip and a weak speed response after a clean baseline', () => {
  assert.equal(hasFinding(wheelspinScenario(true), FINDINGS.EXIT_WHEELSPIN), true)
  assert.equal(hasFinding(wheelspinScenario(false), FINDINGS.EXIT_WHEELSPIN), false)
})

test('brake plus steering overload requires front combined slip and stalled response', () => {
  assert.equal(hasFinding(overloadScenario(true), FINDINGS.BRAKE_STEERING_OVERLOAD), true)
  assert.equal(hasFinding(overloadScenario(false), FINDINGS.BRAKE_STEERING_OVERLOAD), false)
})

test('abrupt brake release requires a measured response or stability deterioration', () => {
  assert.equal(hasFinding(abruptReleaseScenario(true), FINDINGS.ABRUPT_BRAKE_RELEASE), true)
  assert.equal(hasFinding(abruptReleaseScenario(false), FINDINGS.ABRUPT_BRAKE_RELEASE), false)
})

test('controlled release is a positive finding only when brake release is progressive', () => {
  assert.equal(hasFinding(controlledReleaseScenario(true), FINDINGS.CONTROLLED_RELEASE), true)
  assert.equal(hasFinding(controlledReleaseScenario(false), FINDINGS.CONTROLLED_RELEASE), false)
})

test('clean exit is a positive finding only with rising throttle, low driven slip and acceleration', () => {
  assert.equal(hasFinding(cleanExitScenario(true), FINDINGS.CLEAN_EXIT), true)
  assert.equal(hasFinding(cleanExitScenario(false), FINDINGS.CLEAN_EXIT), false)
})

test('calibration is bounded by speed bins and becomes ready only after evidence spans bins', () => {
  const state = new AsphaltCoachState()
  let snapshot = null
  for (let index = 0; index < 42; index += 1) {
    snapshot = state.update(frame(index * 20, {
      speedKmh: 30 + (index % 4) * 30
    }))
  }
  assert.equal(snapshot.calibration.ready, true)
  assert.equal(snapshot.calibration.binsWithSamples >= 3, true)
  assert.equal(state.envelope.bins.length, 12)
})

test('an unseen speed bin stays silent until its own local evidence is ready', () => {
  const state = new AsphaltCoachState()
  for (const input of calibrationPrefix()) state.update(input)

  let snapshot = state.update(frame(720, { speedKmh: 180 }))
  assert.equal(snapshot.calibration.ready, false)
  assert.equal(snapshot.calibration.bin.samples, 1)
  assert.equal(snapshot.calibration.bin.ready, false)

  for (let index = 1; index < 8; index += 1) {
    snapshot = state.update(frame(720 + index * 20, { speedKmh: 180 + index * 0.05 }))
  }
  assert.equal(snapshot.calibration.ready, true)
  assert.equal(snapshot.calibration.bin.samples, 8)
  assert.equal(snapshot.calibration.bin.ready, true)
})

test('an invalid first maneuver cannot train a new speed bin', () => {
  const state = new AsphaltCoachState()
  for (const input of calibrationPrefix()) state.update(input)

  const bad = state.update(frame(720, {
    speedKmh: 180,
    steer: 0.4,
    slipAngle: { fl: 0.4, fr: 0.4, rl: 0.05, rr: 0.05 },
    combinedSlip: { fl: 0.95, fr: 0.95, rl: 0.1, rr: 0.1 }
  }))
  assert.equal(bad.calibration.bin.samples, 0)

  let snapshot = bad
  for (let index = 1; index <= 8; index += 1) {
    snapshot = state.update(frame(720 + index * 20, { speedKmh: 180 + index * 0.05 }))
  }
  assert.equal(snapshot.calibration.bin.samples, 8)
  assert.equal(snapshot.calibration.bin.ready, true)
})

test('learned envelope scales response thresholds instead of only changing readiness', () => {
  const learned = learnedThresholds({
    responseFlatDelta: 0.03,
    responseFlatRatio: 0.04,
    yawFlatDelta: 0.04,
    yawFlatRatio: 0.04,
    frontSlipMin: 0.16,
    frontSlipEnvelopeRatio: 0.9,
    drivenSlipMin: 0.12,
    drivenSlipEnvelopeRatio: 1.25,
    drivenSlipCleanMax: 0.08,
    cleanSlipEnvelopeRatio: 1.1,
    frontCombinedOverload: 0.85,
    combinedSlipEnvelopeRatio: 1.15,
    wheelspinMinAcceleration: 0.5,
    wheelspinAccelerationRatio: 0.65,
    brakeReleaseResponseDrop: 0.15,
    brakeReleaseResponseRatio: 0.18,
    brakeReleaseYawDrop: 0.2,
    brakeReleaseYawRatio: 0.25,
    cleanExitAccelerationMin: 0.5,
    cleanExitAccelerationRatio: 0.45
  }, {
    calibration: {
      bin: {
        lateralResponseP90: 5,
        yawRateP90: 4,
        effectiveAccelerationP90: 3,
        frontSlipP90: 0.3,
        drivenSlipP90: 0.15,
        frontCombinedSlipP90: 0.9
      }
    }
  })
  assert.equal(learned.responseFlatDelta, 0.2)
  assert.equal(learned.yawFlatDelta, 0.16)
  assert.equal(learned.cleanExitAccelerationMin, 1.35)
})

test('findings stay silent before calibration and on rumble-disturbed replay', () => {
  assert.equal(runFrames(frontScrubScenario(true), { calibrated: false }).events.length, 0)
  const disturbed = frontScrubScenario(true).map(input => ({
    ...input,
    rumble: { fl: true, fr: false, rl: false, rr: false }
  }))
  assert.equal(runFrames(disturbed).events.length, 0)
  const puddle = frontScrubScenario(true).map(input => ({
    ...input,
    puddle: { fl: 0.01, fr: 0, rl: 0, rr: 0 }
  }))
  assert.equal(runFrames(puddle).events.length, 0)
  const verticalTransient = frontScrubScenario(true).map((input, index) => ({
    ...input,
    acceleration: { ...(input.acceleration || { x: 1, z: 1 }), y: index % 2 }
  }))
  assert.equal(runFrames(verticalTransient).events.length, 0)
  const lateralImpact = frontScrubScenario(true).map((input, index) => ({
    ...input,
    acceleration: { x: index % 2 === 0 ? 1 : 5, y: 0, z: 1 }
  }))
  assert.equal(runFrames(lateralImpact).events.length, 0)
  const longitudinalImpact = frontScrubScenario(true).map((input, index) => ({
    ...input,
    acceleration: { x: 1, y: 0, z: index % 2 === 0 ? 1 : 5 }
  }))
  assert.equal(runFrames(longitudinalImpact).events.length, 0)
})

test('beginning a new attempt clears evidence counts without requiring a process reset', () => {
  const result = runFrames(frontScrubScenario(true))
  assert.equal(result.findings.getSummary().negativeEvidence > 0, true)
  result.findings.beginAttempt(2)
  assert.deepEqual(result.findings.getSummary(), {
    counts: {
      front_scrub: 0,
      exit_wheelspin: 0,
      brake_steering_overload: 0,
      abrupt_brake_release: 0,
      clean_exit: 0,
      controlled_release: 0
    },
    negativeEvidence: 0,
    positiveEvidence: 0
  })
})

test('an ordinary lap boundary preserves accumulated finding evidence', () => {
  const result = runFrames(frontScrubScenario(true))
  const before = result.findings.getSummary()
  result.findings.resetTransient()
  assert.deepEqual(result.findings.getSummary(), before)
})

test('Direct and Suite normalized replays produce identical zero-reference findings', () => {
  const replay = frontScrubScenario(true).concat(cleanExitScenario(true).slice(8).map(input => ({
    ...input,
    timestampMs: input.timestampMs + 340,
    lap: { ...input.lap, raceTime: (input.timestampMs + 340) / 1000, distance: input.timestampMs + 340 }
  })))
  const direct = runFrames(replay)
  const suite = runFrames(replay.map(input => ({ ...input })))
  assert.deepEqual(
    direct.events.map(event => event.kind),
    suite.events.map(event => event.kind)
  )
  assert.deepEqual(direct.findings.getSummary(), suite.findings.getSummary())
})

test('straight, inactive and telemetry gaps produce no findings', () => {
  const state = new AsphaltCoachState()
  const findings = new AsphaltCoachFindings()
  let result = findings.update(state.update(frame(0)))
  assert.equal(result.events.length, 0)
  result = findings.update(state.update(frame(20, { isRaceOn: false })))
  assert.equal(result.events.length, 0)
  state.update(frame(20, { isRaceOn: true }))
  const gap = state.update(frame(400, { isRaceOn: true }))
  assert.equal(gap.resetReason, 'telemetry_gap')
  result = findings.update(gap)
  assert.equal(result.events.length, 0)
})

test('car identity and restart rewinds reset the current session envelope and findings', () => {
  const state = new AsphaltCoachState()
  const findings = new AsphaltCoachFindings()
  findings.update(state.update(frame(0)))
  findings.update(state.update(frame(20, { speedKmh: 100.2 })))
  state.update(frame(40, { car: { ordinal: 2, pi: 800, drivetrain: 1 } }))
  findings.reset()
  assert.equal(state.envelope.samples, 0)
  assert.equal(findings.getSummary().negativeEvidence, 0)
  state.update(frame(60, { car: { ordinal: 2, pi: 800, drivetrain: 1 }, lap: { raceTime: 10, number: 1, distance: 60 } }))
  const rewind = state.update(frame(80, { car: { ordinal: 2, pi: 800, drivetrain: 1 }, lap: { raceTime: 0, number: 1, distance: 0 } }))
  assert.equal(rewind.resetReason, 'race_clock_rewind')
})

test('presentation keeps one cue, applies priority and cooldown, then prioritizes the brief focus', () => {
  const presentation = new AsphaltCoachPresentation()
  const calibration = { ready: true }
  const result = {
    valid: true,
    calibration,
    events: [
      { kind: FINDINGS.FRONT_SCRUB, confidence: 0.87, eventToken: 'front' },
      { kind: FINDINGS.ABRUPT_BRAKE_RELEASE, confidence: 0.92, eventToken: 'release' }
    ]
  }
  let view = presentation.update(result, 100)
  assert.equal(view.mode, 'cue')
  assert.equal(view.cue.kind, FINDINGS.ABRUPT_BRAKE_RELEASE)
  view = presentation.update({ ...result, events: [{ kind: FINDINGS.FRONT_SCRUB, confidence: 0.9, eventToken: 'front-2' }] }, 2000)
  assert.equal(view.mode, 'none')

  presentation.showBrief({ counts: {
    front_scrub: 2,
    exit_wheelspin: 1,
    brake_steering_overload: 0,
    abrupt_brake_release: 0,
    clean_exit: 1,
    controlled_release: 0
  } }, 5000)
  presentation.beginAttempt()
  view = presentation.update({
    valid: true,
    calibration,
    events: [
      { kind: FINDINGS.EXIT_WHEELSPIN, confidence: 0.9, eventToken: 'wheel' },
      { kind: FINDINGS.FRONT_SCRUB, confidence: 0.9, eventToken: 'front-3' }
    ]
  }, 5100)
  assert.equal(view.cue.kind, FINDINGS.FRONT_SCRUB)
})

test('driver brief is asphalt-only, evidence-based and has no score or exact loss claim', () => {
  const brief = buildDriverBrief({ counts: {
    front_scrub: 2,
    exit_wheelspin: 0,
    brake_steering_overload: 0,
    abrupt_brake_release: 0,
    clean_exit: 3,
    controlled_release: 0
  } })
  assert.equal(brief.title, 'DRIVER BRIEF · ASPHALT')
  assert.match(brief.mainText, /FRONT SCRUB · 2 EVIDENCE/)
  assert.match(brief.strengthText, /CLEAN EXIT · 3 EVIDENCE/)
  assert.match(brief.nextText, /Reduce steering/)
  assert.doesNotMatch(JSON.stringify(brief), /seconds|metres|meters|score|late throttle|wrong apex/i)
})

test('empty brief reports insufficient evidence without inventing a strength or focus', () => {
  const brief = buildDriverBrief({ counts: {} })
  assert.equal(brief.mainKind, null)
  assert.equal(brief.strengthKind, null)
  assert.equal(brief.nextFocus, null)
  assert.match(brief.strengthText, /NO POSITIVE EVIDENCE/)
  assert.doesNotMatch(JSON.stringify(brief), /KEEP.*THROTTLE|CLEAN EXIT/i)
})

test('live cue labels do not look like track corner numbers', () => {
  assert.equal(CUE_META.front_scrub.code, 'ASPHALT')
  assert.equal(CUE_META.exit_wheelspin.code, 'ASPHALT')
  assert.doesNotMatch(JSON.stringify(CUE_META), /C[0-9]/)
})
