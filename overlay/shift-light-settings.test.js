const assert = require('node:assert/strict')
const test = require('node:test')

const { normalizeShiftLightState } = require('./shift-light-settings.js')
const { readConfigurationScripts } = require('../tools/test-sources.cjs')

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
    ceilingClusterCount: 3,
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
    ceilingClusterCount: 3,
    provisionalCeiling: null,
    fallbackShiftRpm: null,
    currentGear: 5,
    gears: [{
      gear: 5,
      destinationGear: 6,
      status: 'potential',
      shiftRpm: 9550,
      modelRpm: null,
      shiftAtRpm: 9550,
      ready: false,
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
    ceilingClusterCount: 0,
    provisionalCeiling: null,
    fallbackShiftRpm: null,
    currentGear: null,
    gears: [],
    diagnostics: [],
    acceptedShiftCount: 0,
    lastAcceptedShift: null,
    persistenceError: null
  })
})

test('keeps the model point, effective shift point and readiness of each pair', () => {
  const { gears } = normalizeShiftLightState({
    gears: [
      { sourceGear: 1, destinationGear: 2, status: 'learning', shiftRpm: null, modelRpm: 7499.6, shiftAtRpm: 7499.6, ready: true },
      { sourceGear: 2, destinationGear: 3, status: 'potential', shiftRpm: 8800, modelRpm: null, shiftAtRpm: 8800, ready: false },
      { sourceGear: 3, destinationGear: 4, status: 'learning', shiftRpm: null, modelRpm: -5, shiftAtRpm: null, ready: false }
    ]
  })
  assert.deepEqual(gears.map(({ gear, modelRpm, shiftAtRpm, ready }) => ({ gear, modelRpm, shiftAtRpm, ready })), [
    { gear: 1, modelRpm: 7500, shiftAtRpm: 7500, ready: true },
    { gear: 2, modelRpm: null, shiftAtRpm: 8800, ready: false },
    { gear: 3, modelRpm: null, shiftAtRpm: null, ready: false }
  ])
})

test('derives the shift point and readiness of a snapshot from a learner without model points', () => {
  const { gears } = normalizeShiftLightState({
    gears: [
      { sourceGear: 1, destinationGear: 2, status: 'learning', shiftRpm: 9000 },
      { sourceGear: 2, destinationGear: 3, status: 'potential', shiftRpm: 8800, confirmationCount: 1 },
      { sourceGear: 3, destinationGear: 4, status: 'optimal', shiftRpm: 8700, confirmationCount: 3 }
    ]
  })
  assert.deepEqual(gears.map(({ gear, modelRpm, shiftAtRpm, ready }) => ({ gear, modelRpm, shiftAtRpm, ready })), [
    { gear: 1, modelRpm: null, shiftAtRpm: null, ready: false },
    { gear: 2, modelRpm: null, shiftAtRpm: 8800, ready: false },
    { gear: 3, modelRpm: null, shiftAtRpm: 8700, ready: true }
  ])
})

test('caps the displayed ceiling cluster at three and keeps up to twelve stored samples', () => {
  const capped = normalizeShiftLightState({ ceilingSampleCount: 14, ceilingClusterCount: 9 })
  assert.equal(capped.ceilingSampleCount, 12)
  assert.equal(capped.ceilingClusterCount, 3)
  const partial = normalizeShiftLightState({ ceilingSampleCount: 2, ceilingClusterCount: 2 })
  assert.equal(partial.ceilingClusterCount, 2)
  const invalid = normalizeShiftLightState({ ceilingClusterCount: -4 })
  assert.equal(invalid.ceilingClusterCount, 0)
  assert.equal(normalizeShiftLightState({}).ceilingClusterCount, 0)
})

test('the gear table shows no limiter hint, counts or power comparisons', () => {
  const settingsJs = readConfigurationScripts()
  assert.doesNotMatch(settingsJs, /isShiftAtLimiter|SHIFT AT LIMITER|ACCEPTED`|POWER DELTA|LAST Δ/)
})
