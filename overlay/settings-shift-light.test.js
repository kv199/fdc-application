const test = require('node:test')
const assert = require('node:assert/strict')
const shiftLight = require('./settings-shift-light.js')

test('settings-shift-light.js loads without a DOM and exports create()', () => {
  assert.equal(typeof document, 'undefined')
  assert.equal(typeof shiftLight.create, 'function')
})

test('Shift Light RPM labels use thousands separators and a dash when no value is known', () => {
  assert.equal(shiftLight.formatRpm(8200), '8,200 RPM')
  assert.equal(shiftLight.formatRpm(7999.6), '8,000 RPM')
  assert.equal(shiftLight.formatRpm(null), '—')
  assert.equal(shiftLight.formatRpm(undefined), '—')
  assert.equal(shiftLight.formatRpm(Number.NaN), '—')
  assert.equal(shiftLight.formatRpm(Number.POSITIVE_INFINITY), '—')
})

const { normalizeShiftLightState } = require('./shift-light-settings.js')

test('a gear row names the pair, its shift point and READY or LEARNING', () => {
  assert.deepEqual(shiftLight.gearRowView({ gear: 1, shiftAtRpm: 7500, ready: true }, 9001), {
    state: 'ready', pair: '1 → 2', shiftAt: '7,500 RPM', status: 'READY'
  })
  assert.deepEqual(shiftLight.gearRowView({ gear: 4, shiftAtRpm: 8800, ready: false }, 9001), {
    state: 'learning', pair: '4 → 5', shiftAt: '8,800 RPM', status: 'LEARNING'
  })
  // Only an explicit true is READY.
  assert.equal(shiftLight.gearRowView({ gear: 2, shiftAtRpm: 7500 }, null).status, 'LEARNING')
})

test('a gear row without a shift point falls back to the ceiling, then the redline, then a dash', () => {
  const gear = { gear: 2, shiftAtRpm: null, ready: false }
  assert.equal(shiftLight.fallbackShiftRpm({ usableCeiling: 9195, fallbackShiftRpm: 9100, reportedRedlineRpm: 9360, rpmMax: 9400 }), 9195)
  assert.equal(shiftLight.fallbackShiftRpm({ usableCeiling: null, fallbackShiftRpm: 9100, reportedRedlineRpm: 9360 }), 9100)
  assert.equal(shiftLight.fallbackShiftRpm({ reportedRedlineRpm: 9360, rpmMax: 9400 }), 9360)
  assert.equal(shiftLight.fallbackShiftRpm({ rpmMax: 9400 }), 9400)
  assert.equal(shiftLight.fallbackShiftRpm({}), null)
  assert.equal(shiftLight.gearRowView(gear, 9001).shiftAt, '9,001 RPM')
  assert.equal(shiftLight.gearRowView(gear, null).shiftAt, '—')
})

test('CURRENT TARGET and STATE describe the readiness of the current gear', () => {
  const state = normalizeShiftLightState({
    carKey: 'fh6:3766:1:800:1:10',
    rpmMax: 9400,
    usableCeiling: 9001,
    currentGear: 2,
    gears: [
      { sourceGear: 1, destinationGear: 2, status: 'learning', modelRpm: 7500, shiftAtRpm: 7500, ready: true },
      { sourceGear: 2, destinationGear: 3, status: 'learning', modelRpm: null, shiftAtRpm: null, ready: false }
    ]
  })
  assert.deepEqual(shiftLight.currentGearView(state), { target: 'LEARNING · 9,001 RPM', state: 'LEARNING · GEAR 2' })
  assert.deepEqual(shiftLight.currentGearView({ ...state, currentGear: 1 }), { target: 'READY · 7,500 RPM', state: 'READY · GEAR 1' })
  assert.deepEqual(shiftLight.currentGearView({ ...state, currentGear: null }), { target: 'LEARNING · 9,001 RPM', state: 'LEARNING' })
  assert.deepEqual(
    shiftLight.currentGearView({ ...state, usableCeiling: null, rpmMax: null, currentGear: 2 }),
    { target: 'WAITING FOR RPM LIMIT', state: 'LEARNING · GEAR 2' }
  )
})

test('a snapshot from a learner without model points shows OPTIMAL pairs as READY and others as LEARNING', () => {
  const state = normalizeShiftLightState({
    carKey: 'fh6:3766:1:800:1:10',
    rpmMax: 9400,
    usableCeiling: 9001,
    currentGear: 3,
    gears: [
      { sourceGear: 1, destinationGear: 2, status: 'learning', shiftRpm: 9001 },
      { sourceGear: 2, destinationGear: 3, status: 'potential', shiftRpm: 8800, confirmationCount: 2 },
      { sourceGear: 3, destinationGear: 4, status: 'optimal', shiftRpm: 8700, confirmationCount: 3 }
    ]
  })
  const fallback = shiftLight.fallbackShiftRpm(state)
  assert.deepEqual(state.gears.map(gear => shiftLight.gearRowView(gear, fallback)), [
    { state: 'learning', pair: '1 → 2', shiftAt: '9,001 RPM', status: 'LEARNING' },
    { state: 'learning', pair: '2 → 3', shiftAt: '8,800 RPM', status: 'LEARNING' },
    { state: 'ready', pair: '3 → 4', shiftAt: '8,700 RPM', status: 'READY' }
  ])
  assert.deepEqual(shiftLight.currentGearView(state), { target: 'READY · 8,700 RPM', state: 'READY · GEAR 3' })
})

test('the Shift Lab export name carries the local time it was made', () => {
  assert.equal(shiftLight.exportFileName(new Date(2026, 9, 2, 8, 5).getTime()), 'fdc-shift-lab-20261002-0805.sqlite.gz')
  assert.equal(shiftLight.exportFileName(new Date(2026, 0, 31, 23, 59).getTime()), 'fdc-shift-lab-20260131-2359.sqlite.gz')
})

test('the Shift Lab export size rounds like the Driver Analysis export', () => {
  assert.equal(shiftLight.formatExportSize(0), '0 B')
  assert.equal(shiftLight.formatExportSize(1023), '1023 B')
  assert.equal(shiftLight.formatExportSize(2560), '2.5 KB')
  assert.equal(shiftLight.formatExportSize(12 * 1024 * 1024), '12 MB')
})
