(function (globalScope) {
  'use strict'

  const GARAGE_EVENT = 'hud_garage'
  const FdcVehicle = globalScope.FdcVehicle || require('./vehicle.js')
  const { CLASS_LABELS, classLabel, drivetrainLabel } = FdcVehicle

  function finitePositive(value) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : null
  }

  function finiteNonNegative(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? number : null
  }

  function ordinalOf(value) {
    const ordinal = finitePositive(value)
    return ordinal === null ? null : Math.round(ordinal)
  }

  const SHIFT_LIGHT_STATUSES = ['none', 'learning', 'ready']

  function nonNegativeInteger(value) {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null
  }

  function shiftLightStatus(value) {
    const status = String(value || '').trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-')
    if (status === 'calibrated') return 'ready'
    if (status === 'calibrating') return 'learning'
    if (status === 'fallback' || status === 'unavailable' || status === 'no-profile') return 'none'
    if (SHIFT_LIGHT_STATUSES.includes(status)) return status
    return null
  }

  function normalizeShiftLightSummary(value) {
    const source = value && typeof value === 'object' ? value : null
    if (!source) return null
    const rawStatus = source.status ?? source.state ?? source.phase
    const rawTuneCount = source.tuneCount ?? source.tune_count ?? source.tunes
    const rawCalibratedGearCount = source.calibratedGearCount
      ?? source.calibrated_gear_count
      ?? source.calibratedGears
      ?? source.calibrated_gears
    const rawLearningGearCount = source.learningGearCount
      ?? source.learning_gear_count
      ?? source.learningGears
      ?? source.learning_gears
    const hasSummaryField = rawStatus !== undefined
      || rawTuneCount !== undefined
      || rawCalibratedGearCount !== undefined
      || rawLearningGearCount !== undefined
    if (!hasSummaryField) return null
    return {
      status: shiftLightStatus(rawStatus) || 'none',
      tuneCount: nonNegativeInteger(rawTuneCount) ?? 0,
      calibratedGearCount: nonNegativeInteger(rawCalibratedGearCount) ?? 0,
      learningGearCount: nonNegativeInteger(rawLearningGearCount) ?? 0
    }
  }

  function shiftLightSummaryFromVariant(value) {
    const variant = value && typeof value === 'object' ? value : {}
    return normalizeShiftLightSummary(
      variant.shiftLight
      ?? variant.shift_light
      ?? variant.shiftLightSummary
      ?? variant.shift_light_summary
      ?? (variant.shiftLightStatus !== undefined || variant.shift_light_status !== undefined
        ? {
            status: variant.shiftLightStatus ?? variant.shift_light_status,
            tuneCount: variant.shiftLightTuneCount ?? variant.shift_light_tune_count,
            calibratedGearCount: variant.shiftLightCalibratedGearCount ?? variant.shift_light_calibrated_gear_count
          }
        : null)
    )
  }

  function normalizeVariant(value) {
    const variant = value && typeof value === 'object' ? value : {}
    const rawClass = variant.class
    const numericClass = Number(rawClass)
    const pi = finiteNonNegative(variant.pi)
    const drivetrain = finiteNonNegative(variant.drivetrain)
    const cylinders = finiteNonNegative(variant.cylinders)
    const rawId = finitePositive(variant.id)
    return {
      id: rawId === null ? null : Math.round(rawId),
      class: Number.isFinite(numericClass) ? Math.round(numericClass) : null,
      classLabel: classLabel(rawClass),
      pi: pi === null ? null : Math.round(pi),
      drivetrain: drivetrain === null ? null : Math.round(drivetrain),
      drivetrainLabel: drivetrainLabel(drivetrain),
      cylinders: cylinders === null ? null : Math.round(cylinders),
      firstSeenSequence: nonNegativeInteger(variant.firstSeenSequence ?? variant.first_seen_sequence),
      lastSeenSequence: nonNegativeInteger(variant.lastSeenSequence ?? variant.last_seen_sequence),
      isCurrent: variant.isCurrent === true || variant.is_current === true,
      shiftLight: shiftLightSummaryFromVariant(variant)
    }
  }

  function normalizeVehicle(value) {
    const vehicle = value && typeof value === 'object' ? value : {}
    const carOrdinal = ordinalOf(vehicle.carOrdinal)
    if (carOrdinal === null) return null
    const currentVariant = Array.isArray(vehicle.variants)
      ? vehicle.variants.find(variant => variant?.isCurrent) || vehicle.variants[0]
      : null
    const rawName = vehicle.name
    const rawClass = vehicle.class ?? currentVariant?.class
    const rawPi = vehicle.pi ?? currentVariant?.pi
    const numericClass = Number(rawClass)
    const pi = finiteNonNegative(rawPi)
    const carGroup = finiteNonNegative(vehicle.carGroup)
    const drivetrain = finiteNonNegative(vehicle.drivetrain)
    const cylinders = finiteNonNegative(vehicle.cylinders)
    const variants = Array.isArray(vehicle.variants)
      ? vehicle.variants.map(normalizeVariant).filter(variant => variant.class !== null || variant.pi !== null)
      : null
    const shiftLight = normalizeShiftLightSummary(
      vehicle.shiftLight
      ?? vehicle.shift_light
      ?? vehicle.shiftLightSummary
      ?? vehicle.shift_light_summary
    ) || shiftLightSummaryFromVariant(currentVariant)
    const normalized = {
      carOrdinal,
      name: typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null,
      class: Number.isFinite(numericClass) ? Math.round(numericClass) : null,
      classLabel: classLabel(rawClass),
      pi: pi === null ? null : Math.round(pi),
      carGroup: carGroup === null ? null : Math.round(carGroup),
      drivetrain: drivetrain === null ? null : Math.round(drivetrain),
      cylinders: cylinders === null ? null : Math.round(cylinders),
      drivetrainLabel: drivetrainLabel(drivetrain),
      latestUsed: vehicle.latestUsed === true
    }
    if (variants) normalized.variants = variants
    if (shiftLight) normalized.shiftLight = shiftLight
    return normalized
  }

  function vehicleFromTelemetry(telemetry) {
    const car = FdcVehicle.vehicleFromTelemetry(telemetry)
    if (!car) return null
    return normalizeVehicle({
      carOrdinal: car.ordinal,
      class: car.class,
      pi: car.pi,
      carGroup: car.carGroup,
      drivetrain: car.drivetrain,
      cylinders: car.cylinders
    })
  }

  function normalizeGaragePayload(value) {
    if (Array.isArray(value)) return value.map(normalizeVehicle).filter(Boolean)
    if (!value || typeof value !== 'object') return []
    const list = value.cars
    if (Array.isArray(list)) {
      const currentOrdinal = ordinalOf(value.currentCarOrdinal)
      return list.map(normalizeVehicle).filter(Boolean).map(vehicle => currentOrdinal === vehicle.carOrdinal
        ? { ...vehicle, latestUsed: true }
        : vehicle)
    }
    const vehicle = normalizeVehicle(value)
    return vehicle ? [vehicle] : []
  }

  function displayName(vehicle) {
    return FdcVehicle.displayName(vehicle?.name, vehicle?.carOrdinal)
  }

  function recordKey(vehicle) {
    return [vehicle.carOrdinal, vehicle.class, vehicle.pi, vehicle.carGroup, vehicle.drivetrain, vehicle.cylinders].join(':')
  }

  function invokeDefault(command, args) {
    const invoke = globalScope.__TAURI_INTERNALS__?.invoke
    if (typeof invoke !== 'function') return Promise.reject(new Error('Tauri commands are unavailable'))
    return Promise.resolve(invoke(command, args))
  }

  function emitGarage(payload) {
    const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
    if (eventApi?.emit) Promise.resolve(eventApi.emit(GARAGE_EVENT, payload)).catch(() => {})
  }

  function createGarageRuntime(options = {}) {
    const invoke = typeof options.invoke === 'function' ? options.invoke : invokeDefault
    let lastRecordedKey = null
    let latest = null

    function update(telemetry) {
      const vehicle = vehicleFromTelemetry(telemetry)
      if (!vehicle || vehicle.class === null || vehicle.pi === null) return false
      const changedLatest = latest === null || latest.carOrdinal !== vehicle.carOrdinal
      latest = vehicle
      const key = recordKey(vehicle)
      const payload = { ...vehicle, latestUsed: true }
      if (key === lastRecordedKey) {
        if (changedLatest) emitGarage(payload)
        return true
      }
      lastRecordedKey = key
      emitGarage(payload)
      const recordArgs = {
        carOrdinal: vehicle.carOrdinal,
        class: vehicle.class,
        pi: vehicle.pi
      }
      for (const keyName of ['carGroup', 'drivetrain', 'cylinders']) {
        if (vehicle[keyName] !== null) recordArgs[keyName] = vehicle[keyName]
      }
      Promise.resolve(invoke('record_garage_vehicle', recordArgs)).then(result => {
        const saved = normalizeGaragePayload(result)[0]
        if (saved) emitGarage({ ...saved, latestUsed: true })
      }).catch(() => {})
      return true
    }

    return {
      update,
      latest: () => (latest ? { ...latest } : null),
      latestOrdinal: () => latest?.carOrdinal ?? null,
      normalizeVehicle,
      vehicleFromTelemetry,
      classLabel,
      displayName
    }
  }

  const api = {
    GARAGE_EVENT,
    CLASS_LABELS,
    normalizeVehicle,
    normalizeGaragePayload,
    vehicleFromTelemetry,
    classLabel,
    drivetrainLabel,
    shiftLightStatus,
    normalizeShiftLightSummary,
    displayName,
    createGarageRuntime
  }
  globalScope.HudGarageRuntime = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
