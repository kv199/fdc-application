const assert = require('node:assert/strict')
const test = require('node:test')

const { getShiftLightCarKey, ShiftLightLearner } = require('./shift-light-engine.js')

function frame(overrides = {}) {
  return {
    timestampMs: 1000,
    car: { ordinal: 123, pi: 800, drivetrain: 1 },
    gear: 1,
    rpm: 5000,
    rpmMax: 8000,
    throttle: 1,
    brake: 0,
    clutch: 0,
    power: 100000,
    wheelRotation: { fl: 50, fr: 50, rl: 50, rr: 50 },
    ...overrides
  }
}

function upshiftPull(learner, gear) {
  learner.update(frame({ gear, rpm: 5500 }))
  learner.update(frame({ gear, rpm: 8000 }))
  learner.update(frame({ gear: 11, rpm: 7800 }))
  learner.update(frame({ gear: gear + 1, rpm: 6000 }))
}

function ratioFrame(gear, ratio, rpm, timestampMs) {
  const wheelSpeed = rpm / ratio
  return frame({
    timestampMs,
    gear,
    rpm,
    wheelRotation: { fl: wheelSpeed, fr: wheelSpeed, rl: wheelSpeed, rr: wheelSpeed }
  })
}

function validateStoredOptimalProfile(learner, nextRatio) {
  for (let sample = 0; sample < 20; sample += 1) {
    learner.update(ratioFrame(2, 60, 4000 + sample, 1000 + sample * 16))
    learner.update(ratioFrame(3, nextRatio, 4000 + sample, 2000 + sample * 16))
  }
}

test('uses the car identity and limiter for the profile key', () => {
  assert.equal(getShiftLightCarKey(frame()), 'fh6:123:800:8000')
  assert.equal(getShiftLightCarKey(frame({ car: { ordinal: 0, pi: 800 } })), null)
})

test('accepts a Porsche-length neutral transition by elapsed time', () => {
  const learner = new ShiftLightLearner('fh6:123:800:8000')
  learner.update(frame({ gear: 2, rpm: 8000, timestampMs: 0 }))
  for (let index = 1; index <= 18; index += 1) {
    learner.update(frame({ gear: 11, rpm: 7800, timestampMs: index * 7 }))
  }
  const snapshot = learner.update(frame({ gear: 3, rpm: 6000, timestampMs: 140 }))
  assert.equal(snapshot.gears.find(gear => gear.gear === 2)?.sampleCount, 1)
})

test('does not double-count a limiter candidate followed by an upshift', () => {
  const learner = new ShiftLightLearner('fh6:123:800:8000')
  learner.update(frame({ gear: 2, rpm: 8000, timestampMs: 0 }))
  learner.update(frame({ gear: 2, rpm: 7800, timestampMs: 16 }))
  learner.update(frame({ gear: 2, rpm: 7750, timestampMs: 32 }))
  learner.update(frame({ gear: 11, rpm: 7600, timestampMs: 48 }))
  const snapshot = learner.update(frame({ gear: 3, rpm: 6000, timestampMs: 64 }))
  assert.equal(snapshot.gears.find(gear => gear.gear === 2)?.sampleCount, 1)
})

test('clears a stale limiter candidate when the pull rearms below 85 percent', () => {
  const learner = new ShiftLightLearner('fh6:123:800:8000')
  learner.update(frame({ gear: 2, rpm: 8000, timestampMs: 0 }))
  learner.update(frame({ gear: 2, rpm: 7800, timestampMs: 16 }))
  learner.update(frame({ gear: 2, rpm: 6700, timestampMs: 32 }))
  learner.update(frame({ gear: 2, rpm: 8000, timestampMs: 48 }))
  learner.update(frame({ gear: 2, rpm: 7800, timestampMs: 64 }))
  const snapshot = learner.update(frame({ gear: 3, rpm: 6000, timestampMs: 80 }))
  assert.equal(snapshot.gears.find(gear => gear.gear === 2)?.sampleCount, 1)
})

test('restores bounded partial evidence without marking it calibrated', () => {
  const learner = new ShiftLightLearner('fh6:123:800:8000')
  learner.setProfile({
    key: 'fh6:123:800:8000',
    gear: 2,
    shiftRpm: null,
    sampleCount: 3,
    status: 'learning',
    samples: [7900, 7920, 7910],
    method: 'observed',
    ratioDrop: null
  })
  assert.deepEqual(learner.snapshot(frame({ gear: 2 })).gears.find(gear => gear.gear === 2), {
    gear: 2,
    status: 'learning',
    shiftRpm: null,
    sampleCount: 3,
    method: null,
    ratioDrop: null
  })
})

test('uses RPM-rate lead for observed profiles', () => {
  const learner = new ShiftLightLearner('fh6:123:800:8000')
  learner.setProfile({
    key: 'fh6:123:800:8000',
    gear: 2,
    shiftRpm: 7600,
    sampleCount: 5,
    method: 'observed'
  })
  learner.update(frame({ gear: 2, rpm: 6500, timestampMs: 4000 }))
  assert.equal(learner.update(frame({ gear: 2, rpm: 6700, timestampMs: 4016 })).phase, 'shift')
})

test('calibrates observed targets from clean full-throttle upshifts', () => {
  const learner = new ShiftLightLearner('fh6:123:800:8000')

  assert.equal(learner.update(frame()).status, 'learning')
  for (const gear of [1, 2, 3, 4, 5]) {
    for (let sample = 0; sample < 5; sample += 1) upshiftPull(learner, gear)
  }

  const calibrated = learner.update(frame({ gear: 5, rpm: 7925 }))
  assert.equal(calibrated.status, 'calibrated')
  assert.equal(calibrated.sampleCount, 5)
  assert.equal(calibrated.shiftRpm, 7925)
  assert.deepEqual(calibrated.gears.slice(0, 2), [
    { gear: 1, status: 'calibrated', shiftRpm: 7925, sampleCount: 5, method: 'observed', ratioDrop: null },
    { gear: 2, status: 'calibrated', shiftRpm: 7925, sampleCount: 5, method: 'observed', ratioDrop: null }
  ])
})

test('restores a calibrated profile without a user-facing car card', () => {
  const learner = new ShiftLightLearner('fh6:123:800:8000')
  learner.setProfile({
    key: 'fh6:123:800:8000',
    gear: 3,
    shiftRpm: 7925,
    sampleCount: 5
  })

  assert.equal(learner.update(frame({ gear: 3, rpm: 7700 })).status, 'calibrated')
  assert.equal(learner.update(frame({ gear: 3, rpm: 7925 })).phase, 'shift')
})

test('keeps an optimal target only when the live gearbox matches', () => {
  const matching = new ShiftLightLearner('fh6:123:800:8000')
  matching.setProfile({
    key: 'fh6:123:800:8000',
    gear: 2,
    shiftRpm: 7600,
    sampleCount: 40,
    method: 'optimal',
    ratioDrop: 0.8
  })
  validateStoredOptimalProfile(matching, 48)

  const mismatching = new ShiftLightLearner('fh6:123:800:8000')
  mismatching.setProfile({
    key: 'fh6:123:800:8000',
    gear: 2,
    shiftRpm: 7600,
    sampleCount: 40,
    method: 'optimal',
    ratioDrop: 0.8
  })
  validateStoredOptimalProfile(mismatching, 42)

  assert.equal(matching.snapshot(ratioFrame(2, 60, 7000, 3000)).method, 'optimal')
  assert.equal(mismatching.snapshot(ratioFrame(2, 60, 7000, 3000)).status, 'learning')
  assert.equal(mismatching.snapshot(ratioFrame(2, 60, 7000, 3000)).diagnostics.find(row => row.gear === 2).status, 'gearbox-mismatch')
})

test('rejects an observed profile when the confirmed gearbox signature differs', () => {
  const learner = new ShiftLightLearner('fh6:123:800:8000')
  learner.setProfile({
    key: 'fh6:123:800:8000',
    gear: 2,
    shiftRpm: 7600,
    sampleCount: 5,
    method: 'observed',
    gearboxSignature: '2:0.8000|3:0.7000'
  })

  for (let sample = 0; sample < 20; sample += 1) {
    learner.update(ratioFrame(2, 60, 4000 + sample, 1000 + sample * 32))
    learner.update(ratioFrame(3, 48, 4000 + sample, 2000 + sample * 32))
    learner.update(ratioFrame(4, 42, 4000 + sample, 3000 + sample * 32))
  }

  const snapshot = learner.snapshot(ratioFrame(2, 60, 7000, 4000))
  assert.equal(snapshot.gearboxSignature, '2:0.8000|3:0.8750')
  assert.equal(snapshot.status, 'learning')
  assert.equal(snapshot.diagnostics.find(row => row.gear === 2).status, 'gearbox-mismatch')
})

test('restores a tolerance-matched observed profile from the live gearbox', () => {
  const learner = new ShiftLightLearner('fh6:123:800:8000')
  learner.setProfile({
    key: 'fh6:123:800:8000',
    gear: 2,
    shiftRpm: 7600,
    sampleCount: 5,
    method: 'observed',
    gearboxSignature: '2:0.8000|3:0.8750'
  })

  for (let sample = 0; sample < 20; sample += 1) {
    learner.update(ratioFrame(2, 60, 4000 + sample, 1000 + sample * 32))
    learner.update(ratioFrame(3, 48.06, 4000 + sample, 2000 + sample * 32))
    learner.update(ratioFrame(4, 42, 4000 + sample, 3000 + sample * 32))
  }

  const snapshot = learner.snapshot(ratioFrame(2, 60, 7000, 4000))
  assert.equal(snapshot.status, 'calibrated')
  assert.equal(snapshot.shiftRpm, 7600)
})

test('completes observed calibration restored from five merged samples', () => {
  const learner = new ShiftLightLearner('fh6:123:800:8000')
  learner.setProfile({
    key: 'fh6:123:800:8000',
    gear: 2,
    shiftRpm: null,
    sampleCount: 5,
    status: 'learning',
    samples: [7900, 7920, 7940, 7960, 7980],
    method: 'observed'
  })

  const gear = learner.snapshot(frame({ gear: 2 })).gears.find(gear => gear.gear === 2)
  assert.deepEqual(gear, {
    gear: 2,
    status: 'calibrated',
    shiftRpm: 7865,
    sampleCount: 5,
    method: 'observed',
    ratioDrop: null
  })
})

test('migrates signed partial evidence when the gearbox signature expands', () => {
  const learner = new ShiftLightLearner('fh6:123:800:8000')
  for (let sample = 0; sample < 20; sample += 1) {
    learner.update(ratioFrame(2, 60, 4000 + sample, 1000 + sample * 32))
    learner.update(ratioFrame(3, 48, 4000 + sample, 2000 + sample * 32))
    learner.update(ratioFrame(4, 42, 4000 + sample, 3000 + sample * 32))
  }
  learner.setProfile({
    key: 'fh6:123:800:8000',
    gear: 2,
    shiftRpm: null,
    sampleCount: 1,
    status: 'learning',
    samples: [7900],
    method: 'observed',
    gearboxSignature: '2:0.8000|3:0.8750'
  })

  for (let sample = 0; sample < 20; sample += 1) {
    learner.update(ratioFrame(5, 35, 4000 + sample, 4100 + sample * 32))
  }

  const snapshot = learner.snapshot(ratioFrame(5, 35, 7000, 4800))
  assert.equal(snapshot.gearboxSignature, '2:0.8000|3:0.8750|4:0.8330')
  assert.equal(snapshot.gears.find(gear => gear.gear === 2)?.sampleCount, 1)
})

test('keeps the active signature through a small independent ratio change', () => {
  const learner = new ShiftLightLearner('fh6:123:800:8000')
  for (let sample = 0; sample < 20; sample += 1) {
    learner.update(ratioFrame(2, 60, 4000 + sample, 1000 + sample * 32))
    learner.update(ratioFrame(3, 48, 4000 + sample, 2000 + sample * 32))
    learner.update(ratioFrame(4, 42, 4000 + sample, 3000 + sample * 32))
  }
  learner.setProfile({
    key: 'fh6:123:800:8000',
    gear: 2,
    shiftRpm: null,
    sampleCount: 1,
    status: 'learning',
    samples: [7900],
    method: 'observed',
    gearboxSignature: '2:0.8000|3:0.8750'
  })

  for (let sample = 0; sample < 20; sample += 1) {
    learner.update(ratioFrame(2, 60, 4000 + sample, 4100 + sample * 32))
    learner.update(ratioFrame(3, 48.06, 4000 + sample, 4200 + sample * 32))
    learner.update(ratioFrame(4, 42, 4000 + sample, 4300 + sample * 32))
  }

  const snapshot = learner.snapshot(ratioFrame(2, 60, 7000, 4800))
  assert.equal(snapshot.gearboxSignature, '2:0.8000|3:0.8750')
  assert.equal(snapshot.gears.find(gear => gear.gear === 2)?.sampleCount, 1)
})

test('projects the optimal cue while RPM is rising quickly', () => {
  const learner = new ShiftLightLearner('fh6:123:800:8000')
  learner.setProfile({
    key: 'fh6:123:800:8000',
    gear: 2,
    shiftRpm: 7600,
    sampleCount: 40,
    method: 'optimal',
    ratioDrop: 0.8
  })
  validateStoredOptimalProfile(learner, 48)

  learner.update(ratioFrame(2, 60, 6500, 4000))
  const snapshot = learner.update(ratioFrame(2, 60, 6700, 4016))

  assert.equal(snapshot.shiftRpm, 7600)
  assert.equal(snapshot.phase, 'shift')
})
