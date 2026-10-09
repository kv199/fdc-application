(function (globalScope) {
  'use strict'

  const BOOST_PSI_TO_BAR = 0.0689475729
  const WATTS_PER_HORSEPOWER = 745.6998715822702
  const THROTTLE_RELEASED_THRESHOLD = 0.01
  const PLACEHOLDER = '\u2014'
  // Built once: toLocaleString would construct a new formatter on every call.
  const WHOLE_NUMBER_FORMAT = new Intl.NumberFormat('en-US')
  const TWO_DECIMAL_NUMBER_FORMAT = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function roundedInteger(value) {
    if (value === 0) return 0
    return Math.sign(value) * Math.round(Math.abs(value))
  }

  function nonNegative(value) {
    return Math.max(0, value)
  }

  function isThrottleReleased(rawThrottle) {
    const throttle = finiteNumber(rawThrottle)
    return throttle !== null && throttle <= THROTTLE_RELEASED_THRESHOLD
  }

  function formatBoost(rawBoost, throttleReleased = false) {
    const boost = finiteNumber(rawBoost)
    if (boost === null) return PLACEHOLDER
    const displayedBoost = throttleReleased ? 0 : nonNegative(boost)
    return `${TWO_DECIMAL_NUMBER_FORMAT.format(displayedBoost * BOOST_PSI_TO_BAR)} BAR`
  }

  function formatPower(rawPower, throttleReleased = false) {
    const power = finiteNumber(rawPower)
    if (power === null) return PLACEHOLDER
    const displayedPower = throttleReleased ? 0 : nonNegative(power)
    return `${WHOLE_NUMBER_FORMAT.format(roundedInteger(displayedPower / WATTS_PER_HORSEPOWER))} HP`
  }

  function formatTorque(rawTorque, throttleReleased = false) {
    const torque = finiteNumber(rawTorque)
    if (torque === null) return PLACEHOLDER
    const displayedTorque = throttleReleased ? 0 : nonNegative(torque)
    return `${WHOLE_NUMBER_FORMAT.format(roundedInteger(displayedTorque))} NM`
  }

  function formatEngine(telemetry = {}) {
    const source = telemetry && typeof telemetry === 'object' ? telemetry : {}
    const throttleReleased = isThrottleReleased(source.throttle)
    return {
      boost: formatBoost(source.boost, throttleReleased),
      power: formatPower(source.power, throttleReleased),
      torque: formatTorque(source.torque, throttleReleased)
    }
  }

  const api = {
    formatEngine,
    formatBoost,
    formatPower,
    formatTorque
  }

  if (typeof globalScope !== 'undefined') globalScope.HudEnginePresentation = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
