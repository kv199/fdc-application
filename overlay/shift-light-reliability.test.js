const assert = require('node:assert/strict')
const test = require('node:test')

const { ShiftLightLearner } = require('./shift-light-engine.js')

function frame(overrides = {}) {
  return {
    isRaceOn: true,
    timestampMs: 0,
    car: { ordinal: 123, class: 4, pi: 800, drivetrain: 1, cylinders: 8 },
    gear: 2,
    rpm: 5000,
    rpmMax: 10000,
    throttle: 1,
    brake: 0,
    clutch: 0,
    handBrake: 0,
    power: 100000,
    wheelRotation: { fl: 50, fr: 50, rl: 50, rr: 50 },
    ...overrides
  }
}

function runFrames(learner, values, startTimestamp = 0, overrides = {}) {
  values.forEach((rpm, index) => {
    learner.update(frame({
      ...overrides,
      rpm,
      timestampMs: startTimestamp + index * 16
    }))
  })
}

function resetBetweenPulls(learner, timestampMs) {
  learner.update(frame({ throttle: 0, rpm: 3500, timestampMs }))
}

function cleanLimiterPull(learner, startTimestamp) {
  runFrames(learner, [5000, 6500, 7800, 8000, 7600, 7980], startTimestamp)
}

function cleanUpshift(learner, startTimestamp, overrides = {}) {
  learner.update(frame({ ...overrides, gear: 2, rpm: 5000, timestampMs: startTimestamp }))
  learner.update(frame({ ...overrides, gear: 2, rpm: 6500, timestampMs: startTimestamp + 16 }))
  learner.update(frame({ ...overrides, gear: 2, rpm: 9000, timestampMs: startTimestamp + 32 }))
  learner.update(frame({ ...overrides, gear: 3, rpm: 6000, timestampMs: startTimestamp + 48 }))
}

function sustainedFallPull(learner, startTimestamp) {
  runFrames(learner, [5000, 6500, 8000, 7800, 7600, 7400, 7000], startTimestamp)
}

function syntheticPower(rpm) {
  return 300000 - 50 * Math.abs(rpm - 6000)
}

function ratioFrame(gear, ratio, rpm, timestampMs, rpmMax = 10000) {
  const wheelSpeed = rpm / ratio
  return frame({
    gear,
    rpm,
    rpmMax,
    timestampMs,
    wheelRotation: { fl: wheelSpeed, fr: wheelSpeed, rl: wheelSpeed, rr: wheelSpeed }
  })
}

function feedOptimalEvidence(learner) {
  let timestampMs = 1000
  for (let sample = 0; sample < 20; sample += 1) {
    learner.update(ratioFrame(2, 60, 4000 + sample, timestampMs, 8000))
    learner.update(ratioFrame(3, 48, 4000 + sample, timestampMs + 16, 8000))
    timestampMs += 32
  }

  for (let rpm = 4000; rpm <= 8000; rpm += 100) {
    for (let sample = 0; sample < 3; sample += 1) {
      const wheelSpeed = rpm / 60
      learner.update(frame({
        gear: 2,
        rpm,
        rpmMax: 8000,
        power: syntheticPower(rpm),
        wheelRotation: { fl: wheelSpeed, fr: wheelSpeed, rl: wheelSpeed, rr: wheelSpeed },
        timestampMs
      }))
      timestampMs += 16
    }
  }
  return timestampMs
}

function finishCleanPull(learner, startTimestamp) {
  runFrames(learner, [4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000], startTimestamp, { rpmMax: 8000 })
  learner.update(frame({ rpmMax: 8000, throttle: 0, rpm: 7600, timestampMs: startTimestamp + 160 }))
}

test('uses repeated clean lower limiter evidence while preserving identity rpmMax', () => {
  const learner = new ShiftLightLearner('fh6:123:4:800:1:8:10000')

  cleanLimiterPull(learner, 0)
  assert.equal(learner.snapshot(frame({ rpm: 7000, timestampMs: 100 })).fallbackShiftRpm, 9800)
  resetBetweenPulls(learner, 120)
  cleanLimiterPull(learner, 200)

  const snapshot = learner.snapshot(frame({ rpm: 7000, timestampMs: 320 }))
  assert.equal(snapshot.rpmMax, 10000)
  assert.equal(snapshot.fallbackShiftRpm, 7900)
})

test('does not infer a limiter from a sustained clean rpm fall', () => {
  const learner = new ShiftLightLearner('fh6:123:4:800:1:8:10000')

  sustainedFallPull(learner, 0)
  resetBetweenPulls(learner, 140)
  sustainedFallPull(learner, 220)

  const snapshot = learner.snapshot(frame({ rpm: 6500, timestampMs: 340 }))
  assert.equal(snapshot.fallbackShiftRpm, 9800)
})

test('does not learn observed targets from brake or slip polluted pulls', () => {
  const clean = new ShiftLightLearner('fh6:123:4:800:1:8:10000')
  const braked = new ShiftLightLearner('fh6:123:4:800:1:8:10000')
  const slipping = new ShiftLightLearner('fh6:123:4:800:1:8:10000')

  cleanUpshift(clean, 0)
  cleanUpshift(braked, 0, { brake: 1 })
  cleanUpshift(slipping, 0, { combinedSlip: { fl: 1, fr: 1, rl: 1, rr: 1 } })

  const cleanGear = clean.snapshot(frame({ gear: 2, timestampMs: 100 })).gears.find(row => row.gear === 2)
  const brakedGear = braked.snapshot(frame({ gear: 2, timestampMs: 100 })).gears.find(row => row.gear === 2)
  const slippingGear = slipping.snapshot(frame({ gear: 2, timestampMs: 100 })).gears.find(row => row.gear === 2)
  assert.equal(cleanGear?.sampleCount, 1)
  assert.equal(brakedGear?.sampleCount ?? 0, 0)
  assert.equal(slippingGear?.sampleCount ?? 0, 0)
})

test('requires fresh optimal confirmations after a timestamp gap', () => {
  const learner = new ShiftLightLearner('fh6:123:4:800:1:8:8000')
  let timestampMs = feedOptimalEvidence(learner)
  const initial = learner.snapshot(frame({ gear: 2, rpm: 6000, timestampMs })).diagnostics
    .find(row => row.gear === 2)
  assert.equal(initial?.targetRpm, 6725)

  finishCleanPull(learner, timestampMs + 16)
  const beforeGap = learner.snapshot(frame({ gear: 2, rpm: 6000, timestampMs: timestampMs + 200 }))
  assert.equal(beforeGap.gears.find(row => row.gear === 2)?.method, null)

  finishCleanPull(learner, timestampMs + 2500)
  const afterGap = learner.snapshot(frame({ gear: 2, rpm: 6000, timestampMs: timestampMs + 2700 }))
  assert.equal(afterGap.gears.find(row => row.gear === 2)?.method, null)
})
