const test = require('node:test')
const assert = require('node:assert/strict')

const {
  formatBoost,
  formatPower,
  formatTorque
} = require('./engine-presentation.js')

test('formats engine telemetry at the HUD presentation boundary', () => {
  assert.equal(formatBoost(12.3), '0.85 BAR')
  assert.equal(formatPower(312000), '418 HP')
  assert.equal(formatTorque(460), '460 NM')
})

test('clamps engine braking and vacuum values to the Forza-style zero floor', () => {
  assert.equal(formatBoost(0), '0.00 BAR')
  assert.equal(formatBoost(-1), '0.00 BAR')
  assert.equal(formatPower(-500), '0 HP')
  assert.equal(formatTorque(-12.6), '0 NM')
})

test('uses a stable placeholder for unavailable or invalid engine values', () => {
  for (const value of [null, undefined, '', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(formatBoost(value), '\u2014')
    assert.equal(formatPower(value), '\u2014')
    assert.equal(formatTorque(value), '\u2014')
  }
})
