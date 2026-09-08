const assert = require('node:assert/strict')
const test = require('node:test')

const { normalizeShiftLightState } = require('./shift-light-settings.js')

test('normalizes compact per-pair calibration without legacy bin or reason fields', () => {
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
    reportedRedlineRpm: 8300,
    usableCeiling: 10220.4,
    ceilingSampleCount: 3,
    currentGear: 5,
    acceptedShiftCount: 4,
    shiftSamples: [{ sourceGear: 5, destinationGear: 6, rpmBefore: 9550, powerDeltaPct: 1.2, recordedAt: 123 }],
    persistenceError: 'database locked',
    diagnostics: [{
      gear: 5,
      status: 'potential',
      targetRpm: 9550,
      confirmationCount: 2,
      acceptedShiftCount: 6,
      lastDeltaPct: 1.2,
      lastRpmBefore: 9550
    }],
    gears: [
      { sourceGear: 5, destinationGear: 6, status: 'potential', shiftRpm: 9550, acceptedShiftCount: 6, candidateRpm: 9550, confirmationCount: 2, lastDeltaPct: 1.2, lastRpmBefore: 9550 },
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
    reportedRedlineRpm: 8300,
    usableCeiling: 10220,
    ceilingSampleCount: 3,
    fallbackShiftRpm: null,
    currentGear: 5,
    gears: [{
      gear: 5,
      destinationGear: 6,
      status: 'potential',
      shiftRpm: 9550,
      sampleCount: 6,
      candidateRpm: 9550,
      confirmationCount: 2,
      acceptedShiftCount: 6,
      lastRpmBefore: 9550,
      lastDeltaPct: 1.2,
      lastAcceptedAt: null
    }],
    diagnostics: [{
      gear: 5,
      status: 'potential',
      targetRpm: 9550,
      confirmationCount: 2,
      acceptedShiftCount: 6,
      lastRpmBefore: 9550,
      lastDeltaPct: 1.2,
      lastAcceptedAt: null
    }],
    acceptedShiftCount: 4,
    lastAcceptedShift: { sourceGear: 5, destinationGear: 6, rpmBefore: 9550, powerDeltaPct: 1.2, recordedAt: 123 },
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
    reportedRedlineRpm: null,
    usableCeiling: null,
    ceilingSampleCount: 0,
    fallbackShiftRpm: null,
    currentGear: null,
    gears: [],
    diagnostics: [],
    acceptedShiftCount: 0,
    lastAcceptedShift: null,
    persistenceError: null
  })
})
