const assert = require('node:assert/strict')
const test = require('node:test')

const {
  AsphaltCoachState,
  PHASES
} = require('./asphalt-coach-state.js')
const {
  AsphaltCoachFindings,
  FINDINGS
} = require('./asphalt-coach-findings.js')
const {
  AsphaltCoachPresentation,
  buildDriverBrief
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
    acceleration: { z: 1 },
    angularVelocity: { y: 0.3 },
    car: { ordinal: 1, pi: 800, drivetrain: 1 },
    lap: { raceTime: timestampMs / 1000, number: 1, distance: timestampMs },
    ...overrides
  }
}

function runFrames(frames) {
  const state = new AsphaltCoachState()
  const findings = new AsphaltCoachFindings()
  const events = []
  for (const input of frames) {
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
      acceleration: { z: positive ? 1 : 1 + index * 0.02 },
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
      acceleration: { z: positive ? 1 : 1 + index * 0.02 },
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
    acceleration: { z: 1 },
    angularVelocity: { y: 0.5 },
    slipAngle: { fl: 0.12, fr: 0.12, rl: 0.05, rr: 0.05 }
  }))
  frames.push(frame(120, {
    brake: 0.35,
    steer: 0.25,
    acceleration: { z: 1 },
    angularVelocity: { y: 0.5 },
    slipAngle: { fl: 0.12, fr: 0.12, rl: 0.05, rr: 0.05 }
  }))
  for (let index = 0; index < 5; index += 1) {
    frames.push(frame(140 + index * 20, {
      brake: 0.3,
      steer: 0.25,
      acceleration: { z: positive ? 0.7 : 1 },
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
      acceleration: { z: 1 + (positive ? index * 0.01 : 0) }
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
