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

function shift(learner, timestampMs, overrides = {}, afterPower = 420) {
  learner.update(frame({ ...overrides, timestampMs, rpm: 9400 }))
  learner.update(frame({ ...overrides, timestampMs: timestampMs + 16, rpm: 9500 }))
  learner.update(frame({ ...overrides, timestampMs: timestampMs + 32, gear: 2, rpm: 6500, power: afterPower }))
}

test('rejects brake and driven-wheel-slip pollution from shift evidence', () => {
  const learner = new ShiftLightLearner(key)
  shift(learner, 0, { brake: 1 })
  shift(learner, 1000, { combinedSlip: { fl: 0, fr: 0, rl: 1, rr: 1 } })
  const state = learner.serializeLearningState().gears.find(item => item.sourceGear === 1)
  assert.equal(state?.evidence.length ?? 0, 0)
  assert.equal(state?.status ?? 'learning', 'learning')
})

test('keeps an Optimal cue while a later replacement candidate is confirmed', () => {
  const learner = new ShiftLightLearner(key)
  shift(learner, 0)
  shift(learner, 1000)
  shift(learner, 2000)
  shift(learner, 3000, { power: 390 }, 390)
  let state = learner.snapshot(frame()).gears.find(item => item.gear === 1)
  assert.equal(state.shiftRpm, 9500)
  for (const [index, rpm] of [9700, 9750, 9800].entries()) {
    learner.update(frame({ timestampMs: 4000 + index * 1000, rpm: rpm - 50 }))
    learner.update(frame({ timestampMs: 4016 + index * 1000, rpm }))
    learner.update(frame({ timestampMs: 4032 + index * 1000, gear: 2, rpm: 6500, power: 420 }))
  }
  state = learner.snapshot(frame()).gears.find(item => item.gear === 1)
  assert.equal(state.shiftRpm, 9700)
})
