const assert = require('node:assert/strict')
const test = require('node:test')

const { getShiftLightCarKey, ShiftLightLearner } = require('./shift-light-engine.js')

const car = { ordinal: 3766, class: 1, pi: 800, drivetrain: 1, cylinders: 10 }

function frame(overrides = {}) {
  return {
    isRaceOn: true, timestampMs: 0, car, gear: 1, rpm: 9000, rpmMax: 11000,
    throttle: 1, brake: 0, handBrake: 0, clutch: 0, power: 400, torque: 200,
    speedKmh: 100, combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 }, ...overrides
  }
}

function upshift(learner, timestampMs, rpm, afterPower = 420) {
  learner.update(frame({ timestampMs, rpm: rpm - 100, power: 390 }))
  learner.update(frame({ timestampMs: timestampMs + 16, rpm, power: 405 }))
  // The first new-gear frames are torque-cut and must not be used as afterPower.
  learner.update(frame({ timestampMs: timestampMs + 32, gear: 2, rpm: 6500, power: -50 }))
  learner.update(frame({ timestampMs: timestampMs + 48, gear: 2, rpm: 6600, power: -20 }))
  learner.update(frame({ timestampMs: timestampMs + 112, gear: 2, rpm: 7000, power: afterPower }))
  learner.update(frame({ timestampMs: timestampMs + 128, gear: 2, rpm: 7100, power: afterPower }))
  learner.update(frame({ timestampMs: timestampMs + 144, gear: 2, rpm: 7200, power: afterPower }))
}

test('uses only the stable vehicle configuration fields for the learner key', () => {
  assert.equal(getShiftLightCarKey(frame()), 'fh6:3766:1:800:1:10')
  assert.equal(getShiftLightCarKey(frame({ rpmMax: 9500 })), 'fh6:3766:1:800:1:10')
})

test('confirms the median of three clean better real upshifts', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  upshift(learner, 0, 9500)
  upshift(learner, 1000, 9550)
  upshift(learner, 2000, 9600)
  const gear = learner.snapshot(frame()).gears.find(item => item.gear === 1)
  assert.deepEqual(
    { status: gear.status, rpm: gear.shiftRpm, confirmations: gear.confirmationCount },
    { status: 'optimal', rpm: 9550, confirmations: 3 }
  )
})

test('uses redline as an operational cue before an earlier candidate exists', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  const state = learner.update(frame({ rpm: 11000 }))
  assert.equal(state.shiftRpm, 11000)
  assert.equal(state.lightOnRpm, 10800)
  assert.equal(state.phase, 'shift')
})

function leadAfterRpmStep(rpmStep, timestampStepMs = 16) {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  learner.update(frame({ timestampMs: 0, rpm: 9000 }))
  return learner.update(frame({ timestampMs: timestampStepMs, rpm: 9000 + rpmStep })).leadRpm
}

test('derives the cue lead from the RPM rate and clamps it to 100–1000 RPM', () => {
  assert.equal(new ShiftLightLearner(getShiftLightCarKey(frame())).snapshot(frame()).leadRpm, 200)
  // 160 RPM in 16 ms is 10,000 RPM/s, so 0.15 s is 1,500 RPM and clamps to the maximum.
  assert.equal(leadAfterRpmStep(160), 1000)
  // 16 RPM in 16 ms is 1,000 RPM/s, so the lead is 150 RPM.
  assert.equal(leadAfterRpmStep(16), 150)
  // 8 RPM in 16 ms is 500 RPM/s, so the raw lead of 75 RPM clamps to the minimum.
  assert.equal(leadAfterRpmStep(8), 100)
})

test('marks the highest forward gear as last known', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  assert.equal(learner.update(frame({ timestampMs: 0, gear: 1 })).lastKnownGear, true)

  upshift(learner, 0, 9500)
  assert.equal(learner.snapshot(frame({ gear: 2 })).lastKnownGear, true)
  assert.equal(learner.update(frame({ timestampMs: 200, gear: 1, rpm: 6000 })).lastKnownGear, false)
})

test('treats persisted evidence of a higher gear as proof after a restart', () => {
  const key = getShiftLightCarKey(frame())
  const first = new ShiftLightLearner(key)
  upshift(first, 0, 9500)
  const restarted = new ShiftLightLearner(key)
  restarted.importLearningState(first.serializeLearningState())
  assert.equal(restarted.update(frame({ timestampMs: 0, gear: 1 })).lastKnownGear, false)
})

test('keeps gear 10 as the last known gear', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  assert.equal(learner.update(frame({ timestampMs: 0, gear: 10, rpm: 9000 })).lastKnownGear, true)
  assert.equal(learner.update(frame({ timestampMs: 16, gear: 9, rpm: 7000 })).lastKnownGear, false)
})
