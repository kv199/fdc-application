const assert = require('node:assert/strict')
const test = require('node:test')
const { ShiftLightLearner } = require('./shift-light-engine.js')

const key = 'fh6:3766:1:800:1:10'
const car = { ordinal: 3766, class: 1, pi: 800, drivetrain: 1, cylinders: 10 }
const frame = overrides => ({
  isRaceOn: true, timestampMs: 0, car, gear: 1, rpm: 9500, rpmMax: 11000,
  throttle: 1, brake: 0, handBrake: 0, clutch: 0, power: 405, speedKmh: 100,
  combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 }, ...overrides
})

function shift(learner, timestampMs, rpm) {
  learner.update(frame({ timestampMs, rpm: rpm - 50 }))
  learner.update(frame({ timestampMs: timestampMs + 16, rpm }))
  learner.update(frame({ timestampMs: timestampMs + 32, gear: 2, rpm: 6500, power: 420 }))
}

test('merges persisted completed facts with samples collected while storage loads', () => {
  const saved = new ShiftLightLearner(key)
  shift(saved, 0, 9500)
  const live = new ShiftLightLearner(key)
  live.update(frame({ timestampMs: 1000, rpm: 7600, power: 350 }))
  live.mergeLearningState(saved.serializeLearningState())
  const state = live.serializeLearningState().gears.find(item => item.sourceGear === 1)
  assert.equal(state.evidence.length, 1)
  assert.ok(state.powerBins.some(item => item.rpmBucket === 7600))
  assert.equal(state.status, 'confirming')
})

test('completed facts restore after a new learner is created', () => {
  const first = new ShiftLightLearner(key)
  shift(first, 0, 9500)
  shift(first, 1000, 9550)
  const restored = new ShiftLightLearner(key)
  restored.importLearningState(JSON.parse(JSON.stringify(first.serializeLearningState())))
  shift(restored, 2000, 9600)
  const state = restored.snapshot(frame()).gears.find(item => item.gear === 1)
  assert.equal(state.status, 'optimal')
  assert.equal(state.shiftRpm, 9500)
})
