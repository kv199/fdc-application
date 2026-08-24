(function (globalScope) {
  'use strict'

  const BOOST_PSI_TO_BAR = 0.0689475729
  const PLACEHOLDER = '\u2014'

  function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function roundedInteger(value) {
    if (value === 0) return 0
    return Math.sign(value) * Math.round(Math.abs(value))
  }

  function formatBoost(rawBoost) {
    const boost = finiteNumber(rawBoost)
    if (boost === null) return PLACEHOLDER
    return `${(boost * BOOST_PSI_TO_BAR).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })} BAR`
  }

  function formatPower(rawPower) {
    const power = finiteNumber(rawPower)
    if (power === null) return PLACEHOLDER
    return `${roundedInteger(power / 1000).toLocaleString('en-US')} KW`
  }

  function formatTorque(rawTorque) {
    const torque = finiteNumber(rawTorque)
    if (torque === null) return PLACEHOLDER
    return `${roundedInteger(torque).toLocaleString('en-US')} NM`
  }

  const api = {
    formatBoost,
    formatPower,
    formatTorque
  }

  if (typeof globalScope !== 'undefined') globalScope.HudEnginePresentation = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
