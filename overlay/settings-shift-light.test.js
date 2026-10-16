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

test('Shift Light power deltas carry a sign and one decimal, and a dash when no value is known', () => {
  assert.equal(shiftLight.formatDelta(3.14), '+3.1%')
  assert.equal(shiftLight.formatDelta(-2.04), '-2.0%')
  assert.equal(shiftLight.formatDelta(0), '+0.0%')
  assert.equal(shiftLight.formatDelta(null), '—')
  assert.equal(shiftLight.formatDelta(Number.NaN), '—')
})
