(function (globalScope, factory) {
  const api = factory(globalScope)
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.FdcUnits = api
}(typeof globalThis !== 'undefined' ? globalThis : this, globalScope => {
  'use strict'

  // Single source of truth for displayed measurement units. Data stays metric
  // (km/h, meters) everywhere; convert only when a value is shown. Each
  // quantity has its own display preference key: `${quantity}Unit`.
  const QUANTITIES = Object.freeze({
    speed: Object.freeze({
      defaultUnit: 'kmh',
      units: Object.freeze({
        kmh: Object.freeze({ label: 'km/h', perBase: 1 }),
        mph: Object.freeze({ label: 'mph', perBase: 0.621371 })
      })
    }),
    distance: Object.freeze({
      defaultUnit: 'km',
      units: Object.freeze({
        km: Object.freeze({
          long: Object.freeze({ label: 'km', perMeter: 0.001 }),
          short: Object.freeze({ label: 'm', perMeter: 1 })
        }),
        mi: Object.freeze({
          long: Object.freeze({ label: 'mi', perMeter: 1 / 1609.344 }),
          short: Object.freeze({ label: 'ft', perMeter: 1 / 0.3048 })
        })
      })
    })
  })

  function finite(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function isUnit(quantity, unit) {
    return Object.hasOwn(QUANTITIES[quantity]?.units || {}, unit)
  }

  function currentPreferences() {
    try {
      return globalScope?.DisplayPreferences?.read?.() || null
    } catch {
      return null
    }
  }

  // An explicit unit wins; otherwise the current display preference is used,
  // so every caller follows Settings without passing preferences around.
  function unitFor(quantity, unit) {
    if (isUnit(quantity, unit)) return unit
    const preferred = currentPreferences()?.[`${quantity}Unit`]
    return isUnit(quantity, preferred) ? preferred : QUANTITIES[quantity].defaultUnit
  }

  function formatNumber(value, decimals) {
    const factor = 10 ** decimals
    return (Math.round(value * factor) / factor).toFixed(decimals)
  }

  function convertSpeed(speedKmh, unit) {
    const speed = finite(speedKmh)
    if (speed === null) return null
    return speed * QUANTITIES.speed.units[unitFor('speed', unit)].perBase
  }

  function speedLabel(unit) {
    return QUANTITIES.speed.units[unitFor('speed', unit)].label
  }

  function formatSpeed(speedKmh, options = {}) {
    const unit = unitFor('speed', options.unit)
    const speed = convertSpeed(speedKmh, unit)
    const label = speedLabel(unit)
    if (speed === null) return `${options.missing ?? '--'} ${label}`
    return `${formatNumber(Math.max(0, speed), options.decimals ?? 0)} ${label}`
  }

  function distanceScale(unit, scale) {
    return QUANTITIES.distance.units[unitFor('distance', unit)][scale === 'short' ? 'short' : 'long']
  }

  function convertDistance(meters, unit, scale = 'long') {
    const distance = finite(meters)
    if (distance === null) return null
    return distance * distanceScale(unit, scale).perMeter
  }

  function distanceLabel(unit, scale = 'long') {
    return distanceScale(unit, scale).label
  }

  function formatDistance(meters, options = {}) {
    const scale = options.scale === 'short' ? 'short' : 'long'
    const unit = unitFor('distance', options.unit)
    const distance = convertDistance(meters, unit, scale)
    const label = distanceLabel(unit, scale)
    if (distance === null) return `${options.missing ?? '--'} ${label}`
    return `${formatNumber(distance, options.decimals ?? (scale === 'long' ? 1 : 0))} ${label}`
  }

  return {
    QUANTITIES,
    unitFor,
    convertSpeed,
    speedLabel,
    formatSpeed,
    convertDistance,
    distanceLabel,
    formatDistance
  }
}))
