const assert = require('node:assert/strict')
const test = require('node:test')

const { normalizeShiftLightState } = require('./shift-light-settings.js')

test('normalizes the per-gear shift-light diagnostic state', () => {
  assert.deepEqual(normalizeShiftLightState({
    status: 'calibrated',
    phase: 'approach',
    shiftRpm: 7925.4,
    sampleCount: 5,
    carKey: 'fh6:123:800:8000',
    currentGear: 3,
    gears: [
      { gear: 3, status: 'calibrated', shiftRpm: 7925, sampleCount: 5 },
      { gear: 2, status: 'learning', shiftRpm: null, sampleCount: 2 },
      { gear: 11, status: 'calibrated', shiftRpm: 8000, sampleCount: 5 }
    ]
  }), {
    status: 'calibrated',
    phase: 'approach',
    shiftRpm: 7925,
    sampleCount: 5,
    carKey: 'fh6:123:800:8000',
    currentGear: 3,
    gears: [
      { gear: 2, status: 'learning', shiftRpm: null, sampleCount: 2 },
      { gear: 3, status: 'calibrated', shiftRpm: 7925, sampleCount: 5 }
    ]
  })
})

test('turns an unavailable or malformed state into a safe empty state', () => {
  assert.deepEqual(normalizeShiftLightState(null), {
    status: 'fallback',
    phase: 'normal',
    shiftRpm: null,
    sampleCount: 0,
    carKey: null,
    currentGear: null,
    gears: []
  })
})
