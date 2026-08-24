const test = require('node:test')
const assert = require('node:assert/strict')

const {
  formatEngine,
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

test('zeros positive engine readings while throttle is released', () => {
  assert.deepEqual(formatEngine({
    throttle: 0,
    boost: 12.3,
    power: 312000,
    torque: 460
  }), {
    boost: '0.00 BAR',
    power: '0 HP',
    torque: '0 NM'
  })
  assert.deepEqual(formatEngine({
    throttle: 0.01,
    boost: 12.3,
    power: 312000,
    torque: 460
  }), {
    boost: '0.00 BAR',
    power: '0 HP',
    torque: '0 NM'
  })
})

test('keeps engine readings above the release threshold and preserves the zero floor', () => {
  assert.deepEqual(formatEngine({
    throttle: 0.011,
    boost: 12.3,
    power: 312000,
    torque: 460
  }), {
    boost: '0.85 BAR',
    power: '418 HP',
    torque: '460 NM'
  })
  assert.deepEqual(formatEngine({
    throttle: 0.5,
    boost: -1,
    power: -500,
    torque: -12.6
  }), {
    boost: '0.00 BAR',
    power: '0 HP',
    torque: '0 NM'
  })
})

test('keeps unavailable engine channels as placeholders while throttle is released', () => {
  for (const value of [null, undefined, '', Number.NaN]) {
    assert.deepEqual(formatEngine({
      throttle: 0,
      boost: value,
      power: value,
      torque: value
    }), {
      boost: '\u2014',
      power: '\u2014',
      torque: '\u2014'
    })
  }
})

test('formats atmospheric zero boost as a measured zero', () => {
  assert.equal(formatEngine({ throttle: 0.5, boost: 0 }).boost, '0.00 BAR')
})

test('uses a stable placeholder for unavailable or invalid engine values', () => {
  for (const value of [null, undefined, '', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(formatBoost(value), '\u2014')
    assert.equal(formatPower(value), '\u2014')
    assert.equal(formatTorque(value), '\u2014')
  }
})
