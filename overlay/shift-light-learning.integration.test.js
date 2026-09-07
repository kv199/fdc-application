const assert = require('node:assert/strict')
const test = require('node:test')
const engine = require('./shift-light-engine.js')
const { normalizeShiftLightState } = require('./shift-light-settings.js')

const key = 'fh6:342:3:678:1:12:9500'
function frame(gear, rpm, timestampMs) {
  return {
    car: { ordinal: 342, class: 3, pi: 678, drivetrain: 1, cylinders: 12 },
    isRaceOn: true, gear, rpm, timestampMs, rpmMax: 9500,
    throttle: 1, brake: 0, handBrake: 0, clutch: 0, power: 0,
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 }
  }
}

test('a first clean upshift drives a provisional cue while persistence stays partial', () => {
  const writes = []
  const learner = new engine.ShiftLightLearner(key, { onProgress: profile => writes.push(profile) })
  learner.update(frame(2, 8000, 0))
  learner.update(frame(3, 6000, 16))
  const state = normalizeShiftLightState(learner.update(frame(2, 7950, 32)))
  assert.equal(state.status, 'learning')
  assert.equal(state.shiftRpm, 7925)
  assert.equal(state.phase, 'shift')
  assert.equal(writes[0].status, 'learning')
  assert.equal(writes[0].shiftRpm, null)
  assert.deepEqual(writes[0].samples, [8000])
})

test('four equal persisted pulls plus one new pull complete car 342 without losing duplicates', () => {
  const writes = []
  const learner = new engine.ShiftLightLearner(key, { onProgress: profile => writes.push(profile) })
  learner.setProfiles([{
    key, gear: 2, status: 'learning', method: 'observed', shiftRpm: null,
    sampleCount: 4, samples: [8500, 8500, 8500, 8500]
  }])
  learner.update(frame(2, 8500, 0))
  learner.update(frame(3, 6000, 16))
  const state = normalizeShiftLightState(learner.snapshot(frame(2, 8400, 32)))
  assert.equal(state.status, 'calibrated')
  assert.equal(state.shiftRpm, 8425)
  assert.equal(state.sampleCount, 5)
  const saved = writes.at(-1)
  assert.deepEqual(saved.samples, [8500, 8500, 8500, 8500, 8500])
  assert.equal(saved.shiftRpm, 8425)
})

test('a pull collected during database loading joins persisted evidence exactly once', () => {
  const writes = []
  const learner = new engine.ShiftLightLearner(key, { onProgress: profile => writes.push(profile) })
  learner.update(frame(2, 8500, 0))
  learner.update(frame(3, 6000, 16))
  const profiles = [{
    key, gear: 2, status: 'learning', method: 'observed', shiftRpm: null,
    sampleCount: 4, samples: [8500, 8500, 8500, 8500]
  }]
  learner.setProfiles(profiles)
  learner.setProfiles(profiles)
  const state = learner.snapshot(frame(2, 8400, 32))
  assert.equal(state.status, 'calibrated')
  assert.equal(state.shiftRpm, 8425)
  assert.equal(writes.length, 2)
  assert.deepEqual(writes.at(-1).samples, [8500, 8500, 8500, 8500, 8500])
})
