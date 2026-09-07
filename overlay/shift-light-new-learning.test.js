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
