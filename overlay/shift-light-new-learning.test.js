const assert = require('node:assert/strict')
const test = require('node:test')

const { ShiftLightLearner, SHIFT_LIGHT_LEARNING_VERSION } = require('./shift-light-engine.js')

const key = 'fh6:3766:1:800:1:10:11000'
const car = { ordinal: 3766, class: 1, pi: 800, drivetrain: 1, cylinders: 10 }

function frame(overrides = {}) {
  return {
    isRaceOn: true,
    timestampMs: 0,
    car,
    gear: 1,
    rpm: 5000,
    rpmMax: 11000,
    throttle: 1,
    brake: 0,
    clutch: 0,
    handBrake: 0,
    power: 400,
    torque: 200,
    speedKmh: 100,
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
    ...overrides
  }
}

function upshift(learner, timestampMs, rpm, afterPower = 420, overrides = {}) {
  learner.update(frame({ ...overrides, timestampMs, gear: 1, rpm: rpm - 100, power: 390 }))
  learner.update(frame({ ...overrides, timestampMs: timestampMs + 16, gear: 1, rpm, power: 405 }))
  learner.update(frame({ ...overrides, timestampMs: timestampMs + 32, gear: 2, rpm: 6500, power: afterPower }))
}

test('learns actual clean upshifts, selects the earliest confirming RPM, and restores JSON state', () => {
  const writes = []
  const learner = new ShiftLightLearner(key, { onLearningState: state => writes.push(state) })
  upshift(learner, 0, 9500)
  upshift(learner, 1000, 9550)
  upshift(learner, 2000, 9600)

  const row = learner.snapshot(frame({ gear: 1, rpm: 9500 })).gears.find(item => item.gear === 1)
  assert.equal(row.status, 'optimal')
  assert.equal(row.shiftRpm, 9500)
  assert.equal(row.confirmingCount, 3)
  assert.ok(writes.length >= 6)

  const state = learner.serializeLearningState()
  assert.equal(state.modelVersion, SHIFT_LIGHT_LEARNING_VERSION)
  assert.equal(state.version, SHIFT_LIGHT_LEARNING_VERSION)
  assert.equal(state.gears[0].evidence.length, 3)
  assert.equal(state.gears[0].powerBins.length, 2)

  const restored = new ShiftLightLearner(key)
  restored.importLearningState(JSON.parse(JSON.stringify(state)))
  assert.deepEqual(
    restored.snapshot(frame({ gear: 1, rpm: 9500 })).gears.find(item => item.gear === 1),
    row
  )
})

test('keeps learning after a too-early clean shift and records the reason', () => {
  const learner = new ShiftLightLearner(key)
  upshift(learner, 0, 9500, 390)
  const row = learner.snapshot(frame({ gear: 1 })).gears.find(item => item.gear === 1)
  assert.equal(row.status, 'learning')
  assert.equal(row.shiftRpm, null)
  assert.match(row.lastReason, /too early/i)
  assert.equal(learner.snapshot(frame({ gear: 1, rpm: 9500 })).phase, 'approach')
})

function limiterRun(learner, timestampMs, peakRpm = 10220) {
  learner.update(frame({ timestampMs, gear: 1, rpm: peakRpm - 220, power: 400 }))
  learner.update(frame({ timestampMs: timestampMs + 16, gear: 1, rpm: peakRpm - 120, power: 405 }))
  learner.update(frame({ timestampMs: timestampMs + 32, gear: 1, rpm: peakRpm, power: 405 }))
  learner.update(frame({ timestampMs: timestampMs + 48, gear: 1, rpm: peakRpm - 50, power: -10 }))
  learner.update(frame({ timestampMs: timestampMs + 64, gear: 1, rpm: peakRpm - 10, power: 405 }))
}

function ceilingUpshift(learner, timestampMs, rpm, afterPower = 300) {
  learner.update(frame({ timestampMs, gear: 1, rpm: rpm - 100, power: 400 }))
  learner.update(frame({ timestampMs: timestampMs + 16, gear: 1, rpm, power: 405 }))
  learner.update(frame({ timestampMs: timestampMs + 32, gear: 2, rpm: 6500, power: afterPower }))
}

test('learns a trusted ceiling only from clean limiter oscillation', () => {
  const learner = new ShiftLightLearner(key)
  limiterRun(learner, 0, 10220)
  // A second oscillation without leaving the limiter region is the same pull
  // and must not inflate the independent-sample count.
  learner.update(frame({ timestampMs: 80, gear: 1, rpm: 10170 }))
  learner.update(frame({ timestampMs: 96, gear: 1, rpm: 10210 }))
  // Even a deep cut and complete recovery still belong to this same
  // continuous clean WOT pull.
  learner.update(frame({ timestampMs: 112, gear: 1, rpm: 9970 }))
  learner.update(frame({ timestampMs: 128, gear: 1, rpm: 10220 }))
  learner.update(frame({ timestampMs: 144, gear: 1, rpm: 10170 }))
  learner.update(frame({ timestampMs: 160, gear: 1, rpm: 10210 }))
  assert.deepEqual(learner.serializeLearningState().ceilingSamples, [10220])
  learner.update(frame({ timestampMs: 1000, gear: 11, throttle: 0, rpm: 0, speedKmh: 0, power: 0 }))
  limiterRun(learner, 2000, 10235)
  learner.update(frame({ timestampMs: 3000, gear: 11, throttle: 0, rpm: 0, speedKmh: 0, power: 0 }))
  limiterRun(learner, 4000, 10218)
  const state = learner.serializeLearningState()
  assert.deepEqual(state.ceilingSamples, [10220, 10235, 10218])
  assert.equal(state.usableCeiling, 10220)
  const snapshot = learner.snapshot(frame({ gear: 1, rpm: 9000 }))
  assert.equal(snapshot.usableCeiling, 10220)
  assert.equal(snapshot.ceilingSampleCount, 3)
})

test('reacquires a changed ceiling after three consistent limiter pulls', () => {
  const learner = new ShiftLightLearner(key)
  for (const [index, peak] of [10220, 10235, 10218].entries()) {
    limiterRun(learner, index * 1000, peak)
    learner.update(frame({ timestampMs: index * 1000 + 100, gear: 11, throttle: 0, rpm: 0, speedKmh: 0, power: 0 }))
  }
  assert.equal(learner.serializeLearningState().usableCeiling, 10220)
  for (const [index, peak] of [10800, 10810, 10805].entries()) {
    limiterRun(learner, 4000 + index * 1000, peak)
    learner.update(frame({ timestampMs: 4100 + index * 1000, gear: 11, throttle: 0, rpm: 0, speedKmh: 0, power: 0 }))
  }
  const state = learner.serializeLearningState()
  assert.deepEqual(state.ceilingSamples, [10800, 10810, 10805])
  assert.equal(state.usableCeiling, 10805)
})

test('keeps a fresh live ceiling when persisted state resolves later', () => {
  const persisted = new ShiftLightLearner(key)
  for (const [index, peak] of [10220, 10235, 10218].entries()) {
    limiterRun(persisted, index * 1000, peak)
    persisted.update(frame({ timestampMs: index * 1000 + 100, gear: 11, throttle: 0, rpm: 0, speedKmh: 0, power: 0 }))
  }

  const live = new ShiftLightLearner(key)
  for (const [index, peak] of [10800, 10810, 10805].entries()) {
    limiterRun(live, 4000 + index * 1000, peak)
    live.update(frame({ timestampMs: 4100 + index * 1000, gear: 11, throttle: 0, rpm: 0, speedKmh: 0, power: 0 }))
  }
  live.mergeLearningState(persisted.serializeLearningState())

  const state = live.serializeLearningState()
  assert.deepEqual(state.ceilingSamples, [10800, 10810, 10805])
  assert.equal(state.usableCeiling, 10805)
})

test('rejects an arbitrary WOT maximum and a top-speed plateau as a ceiling', () => {
  const arbitraryPeak = new ShiftLightLearner(key)
  arbitraryPeak.update(frame({ timestampMs: 0, rpm: 10000 }))
  arbitraryPeak.update(frame({ timestampMs: 16, rpm: 10100 }))
  arbitraryPeak.update(frame({ timestampMs: 32, rpm: 10220 }))
  assert.equal(arbitraryPeak.serializeLearningState().usableCeiling, null)

  const plateau = new ShiftLightLearner(key)
  plateau.update(frame({ timestampMs: 0, rpm: 10220 }))
  plateau.update(frame({ timestampMs: 16, rpm: 10220 }))
  plateau.update(frame({ timestampMs: 32, rpm: 10220 }))
  plateau.update(frame({ timestampMs: 48, rpm: 10220 }))
  assert.equal(plateau.serializeLearningState().usableCeiling, null)
})

test('uses the trusted ceiling for fallback confirmation when wheel force falls after the shift', () => {
  const learner = new ShiftLightLearner(key)
  limiterRun(learner, 0, 10220)
  learner.update(frame({ timestampMs: 1000, gear: 11, throttle: 0, rpm: 0, speedKmh: 0, power: 0 }))
  limiterRun(learner, 2000, 10235)
  learner.update(frame({ timestampMs: 3000, gear: 11, throttle: 0, rpm: 0, speedKmh: 0, power: 0 }))
  limiterRun(learner, 4000, 10218)
  ceilingUpshift(learner, 6000, 10170)
  ceilingUpshift(learner, 7000, 10210)
  ceilingUpshift(learner, 8000, 10190)
  const state = learner.serializeLearningState()
  const gear = state.gears.find(item => item.sourceGear === 1)
  assert.equal(gear.status, 'optimal')
  assert.equal(gear.targetRpm, 10170)
  assert.deepEqual(gear.evidence.map(item => item.outcome), ['rpm_ceiling', 'rpm_ceiling', 'rpm_ceiling'])
  assert.deepEqual(gear.evidence.map(item => item.reason), ['RPM_CEILING', 'RPM_CEILING', 'RPM_CEILING'])
})

test('does not count polluted shifts as evidence', () => {
  const learner = new ShiftLightLearner(key)
  upshift(learner, 0, 9500, 420, { brake: 1 })
  upshift(learner, 1000, 9500, 420, { combinedSlip: { fl: 0, fr: 0, rl: 1, rr: 1 } })
  const state = learner.serializeLearningState()
  assert.equal(state.gears.find(item => item.sourceGear === 1)?.evidence.length ?? 0, 0)
  assert.equal(state.gears.find(item => item.sourceGear === 1)?.status ?? 'learning', 'learning')
})

test('keeps an existing optimal target while collecting a replacement candidate', () => {
  const learner = new ShiftLightLearner(key)
  upshift(learner, 0, 9500)
  upshift(learner, 1000, 9550)
  upshift(learner, 2000, 9600)
  // Contradict the target at the target RPM. It remains visible.
  upshift(learner, 3000, 9500, 390)
  let row = learner.snapshot(frame({ gear: 1 })).gears.find(item => item.gear === 1)
  assert.equal(row.status, 'optimal')
  assert.equal(row.shiftRpm, 9500)
  // A later better point can replace it only after three stable confirmations.
  upshift(learner, 4000, 9700)
  upshift(learner, 5000, 9750)
  upshift(learner, 6000, 9800)
  row = learner.snapshot(frame({ gear: 1 })).gears.find(item => item.gear === 1)
  assert.equal(row.status, 'optimal')
  assert.equal(row.shiftRpm, 9700)
})
