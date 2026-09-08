const assert = require('node:assert/strict')
const test = require('node:test')

const { normalizeShiftLightState } = require('./shift-light-settings.js')

test('normalizes the current per-gear learning state without legacy ratio fields', () => {
  assert.deepEqual(normalizeShiftLightState({
    status: 'calibrated',
    phase: 'shift',
    shiftRpm: 9550.4,
    sampleCount: 3,
    carKey: 'fh6:3766:4:800:1:10',
    gameId: 'fh6',
    carOrdinal: 3766,
    pi: 800,
    rpmMax: 8300,
    usableCeiling: 10220.4,
    ceilingSampleCount: 3,
    currentGear: 5,
    persistenceError: 'database locked',
    diagnostics: [{
      gear: 5,
      status: 'confirming',
      powerBinCount: 22,
      peakPowerRpm: 7800,
      targetRpm: 9550,
      confirmingCount: 2,
      lastReason: 'Last clean shift was too early.',
      evidenceCount: 6,
      ratioDrop: 0.72
    }],
    gears: [
      { gear: 5, status: 'confirming', shiftRpm: 9550, sampleCount: 6, candidateRpm: 9550, confirmingCount: 2, lastReason: 'Last clean shift was too early.' },
      { gear: 11, status: 'optimal', shiftRpm: 8000, sampleCount: 3 }
    ]
  }), {
    status: 'calibrated',
    phase: 'shift',
    shiftRpm: 9550,
    sampleCount: 3,
    carKey: 'fh6:3766:4:800:1:10',
    gameId: 'fh6',
    carOrdinal: 3766,
    pi: 800,
    rpmMax: 8300,
    usableCeiling: 10220,
    ceilingSampleCount: 3,
    fallbackShiftRpm: null,
    currentGear: 5,
    gears: [{
      gear: 5,
      status: 'confirming',
      shiftRpm: 9550,
      sampleCount: 6,
      candidateRpm: 9550,
      confirmingCount: 2,
      lastReason: 'Last clean shift was too early.'
    }],
    diagnostics: [{
      gear: 5,
      status: 'confirming',
      powerBinCount: 22,
      peakPowerRpm: 7800,
      targetRpm: 9550,
      confirmingCount: 2,
      lastReason: 'Last clean shift was too early.',
      evidenceCount: 6
    }],
    persistenceError: 'database locked'
  })
})

test('turns an unavailable or malformed state into a safe empty state', () => {
  assert.deepEqual(normalizeShiftLightState(null), {
    status: 'fallback',
    phase: 'normal',
    shiftRpm: null,
    sampleCount: 0,
    carKey: null,
    gameId: null,
    carOrdinal: null,
    pi: null,
    rpmMax: null,
    usableCeiling: null,
    ceilingSampleCount: 0,
    fallbackShiftRpm: null,
    currentGear: null,
    gears: [],
    diagnostics: [],
    persistenceError: null
  })
})
