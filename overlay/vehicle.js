(function (globalScope) {
  'use strict'

  // Shared car rules: class and drivetrain labels, the display-name rule, and
  // the single reader of the normalized telemetry `car` object.
  const CLASS_LABELS = ['D', 'C', 'B', 'A', 'S1', 'S2', 'R', 'X']
  const DRIVETRAIN_LABELS = ['FWD', 'RWD', 'AWD']

  function finitePositive(value) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : null
  }

  function roundedNonNegative(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null
  }

  function classLabel(value) {
    if (typeof value === 'string' && value.trim()) return value.trim().toUpperCase()
    if (value === null || value === undefined || value === '') return null
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return null
    return CLASS_LABELS[Math.round(numeric)] || String(Math.round(numeric))
  }

  function drivetrainLabel(value) {
    const numeric = roundedNonNegative(value)
    return numeric === null ? null : (DRIVETRAIN_LABELS[numeric] || null)
  }

  // A car is shown by its current Garage name, otherwise by its car ordinal.
  function displayName(name, ordinal) {
    const trimmedName = typeof name === 'string' ? name.trim() : ''
    if (trimmedName) return trimmedName
    const positiveOrdinal = finitePositive(ordinal)
    return positiveOrdinal === null ? '' : String(Math.trunc(positiveOrdinal))
  }

  function vehicleFromTelemetry(telemetry) {
    const car = telemetry?.car
    if (!car || typeof car !== 'object') return null
    const ordinal = finitePositive(car.ordinal)
    if (ordinal === null) return null
    return {
      ordinal: Math.round(ordinal),
      class: roundedNonNegative(car.class),
      pi: roundedNonNegative(car.pi),
      carGroup: roundedNonNegative(car.carGroup),
      drivetrain: roundedNonNegative(car.drivetrain),
      cylinders: roundedNonNegative(car.cylinders)
    }
  }

  const api = {
    CLASS_LABELS,
    DRIVETRAIN_LABELS,
    classLabel,
    drivetrainLabel,
    displayName,
    vehicleFromTelemetry
  }
  globalScope.FdcVehicle = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
