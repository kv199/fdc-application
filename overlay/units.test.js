const assert = require('node:assert/strict')
const test = require('node:test')

const FdcUnits = require('./units.js')

test('formatSpeed with kmh converts canonical metric input to display units', () => {
  assert.equal(FdcUnits.formatSpeed(128), '128 km/h')
  assert.equal(FdcUnits.formatSpeed(128, { unit: 'kmh' }), '128 km/h')
  assert.equal(FdcUnits.formatSpeed(80.9344, { unit: 'mph' }), '50 mph')
  assert.equal(FdcUnits.formatSpeed(0), '0 km/h')
})

test('formatSpeed with decimals', () => {
  assert.equal(FdcUnits.formatSpeed(80.9344, { unit: 'mph', decimals: 1 }), '50.3 mph')
  assert.equal(FdcUnits.formatSpeed(128, { unit: 'kmh', decimals: 2 }), '128.00 km/h')
})

test('formatSpeed handles missing or invalid values', () => {
  assert.equal(FdcUnits.formatSpeed(null), '-- km/h')
  assert.equal(FdcUnits.formatSpeed(undefined), '-- km/h')
  assert.equal(FdcUnits.formatSpeed(''), '-- km/h')
  assert.equal(FdcUnits.formatSpeed(null, { unit: 'mph' }), '-- mph')
  assert.equal(FdcUnits.formatSpeed(null, { missing: 'N/A' }), 'N/A km/h')
})

test('formatSpeed clamps negative values to zero', () => {
  assert.equal(FdcUnits.formatSpeed(-3, { unit: 'kmh' }), '0 km/h')
  assert.equal(FdcUnits.formatSpeed(-10, { unit: 'mph' }), '0 mph')
})

test('formatDistance with long scale (km and mi)', () => {
  assert.equal(FdcUnits.formatDistance(1000), '1.0 km')
  assert.equal(FdcUnits.formatDistance(1609.344, { unit: 'mi' }), '1.0 mi')
  assert.equal(FdcUnits.formatDistance(2500), '2.5 km')
  assert.equal(FdcUnits.formatDistance(3218.688, { unit: 'mi' }), '2.0 mi')
})

test('formatDistance with short scale (m and ft)', () => {
  assert.equal(FdcUnits.formatDistance(500, { scale: 'short' }), '500 m')
  assert.equal(FdcUnits.formatDistance(304.8, { unit: 'mi', scale: 'short' }), '1000 ft')
  assert.equal(FdcUnits.formatDistance(152.4, { unit: 'mi', scale: 'short' }), '500 ft')
})

test('formatDistance with decimals', () => {
  assert.equal(FdcUnits.formatDistance(1234.5, { unit: 'km', decimals: 2 }), '1.23 km')
  assert.equal(FdcUnits.formatDistance(304.8, { unit: 'mi', scale: 'short', decimals: 1 }), '1000.0 ft')
})

test('formatDistance handles missing or invalid values', () => {
  assert.equal(FdcUnits.formatDistance(null), '-- km')
  assert.equal(FdcUnits.formatDistance(undefined), '-- km')
  assert.equal(FdcUnits.formatDistance(''), '-- km')
  assert.equal(FdcUnits.formatDistance(null, { unit: 'mi' }), '-- mi')
  assert.equal(FdcUnits.formatDistance(null, { missing: 'N/A' }), 'N/A km')
  assert.equal(FdcUnits.formatDistance(null, { scale: 'short', missing: 'N/A' }), 'N/A m')
})

test('unitFor with explicit unit wins', () => {
  assert.equal(FdcUnits.unitFor('speed', 'mph'), 'mph')
  assert.equal(FdcUnits.unitFor('speed', 'kmh'), 'kmh')
  assert.equal(FdcUnits.unitFor('distance', 'mi'), 'mi')
  assert.equal(FdcUnits.unitFor('distance', 'km'), 'km')
})

test('unitFor with display preferences fallback', () => {
  // Stub the global DisplayPreferences
  globalThis.DisplayPreferences = {
    read: () => ({
      speedUnit: 'mph',
      distanceUnit: 'mi'
    })
  }

  assert.equal(FdcUnits.unitFor('speed'), 'mph')
  assert.equal(FdcUnits.unitFor('distance'), 'mi')
  assert.equal(FdcUnits.unitFor('speed', undefined), 'mph')

  // Clean up
  delete globalThis.DisplayPreferences
})

test('unitFor defaults to kmh and km when preferences unavailable', () => {
  assert.equal(FdcUnits.unitFor('speed', undefined), 'kmh')
  assert.equal(FdcUnits.unitFor('distance', undefined), 'km')
})

test('unitFor rejects invalid units and falls back to default', () => {
  assert.equal(FdcUnits.unitFor('speed', 'knots'), 'kmh')
  assert.equal(FdcUnits.unitFor('distance', 'meters'), 'km')
  assert.equal(FdcUnits.unitFor('speed', null), 'kmh')
})

test('convertSpeed with kmh', () => {
  const mph = FdcUnits.convertSpeed(128, 'mph')
  assert.ok(Math.abs(mph - 79.5) < 0.1)
  assert.equal(FdcUnits.convertSpeed(128, 'kmh'), 128)
})

test('convertSpeed handles invalid values', () => {
  assert.equal(FdcUnits.convertSpeed(null, 'kmh'), null)
  assert.equal(FdcUnits.convertSpeed(undefined, 'mph'), null)
  assert.equal(FdcUnits.convertSpeed('', 'kmh'), null)
})

test('speedLabel', () => {
  assert.equal(FdcUnits.speedLabel('kmh'), 'km/h')
  assert.equal(FdcUnits.speedLabel('mph'), 'mph')
})

test('convertDistance with various units and scales', () => {
  const km = FdcUnits.convertDistance(1000, 'km', 'long')
  assert.equal(km, 1)
  const m = FdcUnits.convertDistance(500, 'km', 'short')
  assert.equal(m, 500)
  const mi = FdcUnits.convertDistance(1609.344, 'mi', 'long')
  assert.ok(Math.abs(mi - 1) < 0.001)
  const ft = FdcUnits.convertDistance(304.8, 'mi', 'short')
  assert.ok(Math.abs(ft - 1000) < 1)
})

test('convertDistance handles invalid values', () => {
  assert.equal(FdcUnits.convertDistance(null, 'km'), null)
  assert.equal(FdcUnits.convertDistance(undefined, 'mi'), null)
  assert.equal(FdcUnits.convertDistance('', 'km'), null)
})

test('distanceLabel', () => {
  assert.equal(FdcUnits.distanceLabel('km', 'long'), 'km')
  assert.equal(FdcUnits.distanceLabel('km', 'short'), 'm')
  assert.equal(FdcUnits.distanceLabel('mi', 'long'), 'mi')
  assert.equal(FdcUnits.distanceLabel('mi', 'short'), 'ft')
})
