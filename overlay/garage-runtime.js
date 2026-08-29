(function (globalScope) {
  'use strict'

  const GARAGE_EVENT = 'hud_garage'
  const CLASS_LABELS = ['D', 'C', 'B', 'A', 'S1', 'S2', 'R', 'X']
  const DRIVETRAIN_LABELS = ['FWD', 'RWD', 'AWD']

  function finitePositive(value) {
    const number = Number(value)
    return Number.isFinite(number) && number > 0 ? number : null
  }

  function finiteNonNegative(value) {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? number : null
  }

  function ordinalOf(value) {
    const ordinal = finitePositive(value)
    return ordinal === null ? null : Math.round(ordinal)
  }

  function classLabel(value) {
    if (typeof value === 'string' && value.trim()) return value.trim().toUpperCase()
    if (value === null || value === undefined || value === '') return null
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return null
    return CLASS_LABELS[Math.round(numeric)] || String(Math.round(numeric))
  }

  function drivetrainLabel(value) {
    if (value === null || value === undefined || value === '') return null
    const numeric = finiteNonNegative(value)
    return numeric === null ? null : (DRIVETRAIN_LABELS[Math.round(numeric)] || null)
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
    const rawClass = variant.class ?? variant.carClass ?? variant.classLabel
    const numericClass = Number(rawClass)
    const pi = finiteNonNegative(variant.pi ?? variant.performanceIndex)
    const drivetrain = finiteNonNegative(variant.drivetrain ?? variant.drivetrainType ?? variant.drivetrain_type)
    const rawId = finitePositive(variant.id)
    return {
      id: rawId === null ? null : Math.round(rawId),
      class: Number.isFinite(numericClass) ? Math.round(numericClass) : null,
      classLabel: classLabel(rawClass),
      pi: pi === null ? null : Math.round(pi),
      drivetrain: drivetrain === null ? null : Math.round(drivetrain),
      drivetrainLabel: drivetrainLabel(drivetrain),
      firstSeenSequence: nonNegativeInteger(variant.firstSeenSequence ?? variant.first_seen_sequence),
      lastSeenSequence: nonNegativeInteger(variant.lastSeenSequence ?? variant.last_seen_sequence),
      isCurrent: variant.isCurrent === true || variant.is_current === true,
      shiftLight: shiftLightSummaryFromVariant(variant)
    }
  }

  function normalizeVehicle(value) {
    const vehicle = value && typeof value === 'object' ? value : {}
    const carOrdinal = ordinalOf(vehicle.carOrdinal ?? vehicle.car_ordinal ?? vehicle.ordinal)
    if (carOrdinal === null) return null
    const currentVariant = Array.isArray(vehicle.variants)
      ? vehicle.variants.find(variant => variant?.isCurrent) || vehicle.variants[0]
      : null
    const rawName = vehicle.name ?? vehicle.displayName ?? vehicle.carName
    const rawClass = vehicle.class ?? vehicle.carClass ?? vehicle.classLabel ?? currentVariant?.class ?? currentVariant?.carClass
    const rawPi = vehicle.pi ?? vehicle.performanceIndex ?? currentVariant?.pi
    const numericClass = Number(rawClass)
    const pi = finiteNonNegative(rawPi)
    const carGroup = finiteNonNegative(vehicle.carGroup ?? vehicle.car_group)
    const drivetrain = finiteNonNegative(vehicle.drivetrain ?? vehicle.drivetrainType ?? vehicle.drivetrain_type)
    const cylinders = finiteNonNegative(vehicle.cylinders ?? vehicle.numCylinders ?? vehicle.num_cylinders)
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
      latestUsed: vehicle.latestUsed === true || vehicle.isLatestUsed === true,
      lastUsedAt: vehicle.lastUsedAt ?? vehicle.last_seen_at ?? vehicle.lastSeenAt ?? null
    }
    if (variants) normalized.variants = variants
    if (shiftLight) normalized.shiftLight = shiftLight
    return normalized
  }

  function vehicleFromTelemetry(telemetry) {
    const car = telemetry?.car && typeof telemetry.car === 'object' ? telemetry.car : {}
    return normalizeVehicle({
      carOrdinal: car.ordinal ?? car.carOrdinal ?? telemetry?.carOrdinal ?? telemetry?.car_ordinal,
      name: car.name ?? car.displayName ?? telemetry?.carName,
      class: car.class ?? car.carClass ?? telemetry?.class ?? telemetry?.carClass,
      pi: car.pi ?? telemetry?.pi,
      carGroup: car.carGroup ?? telemetry?.carGroup,
      drivetrain: car.drivetrain ?? telemetry?.drivetrain,
      cylinders: car.cylinders ?? telemetry?.cylinders
    })
  }

  function normalizeGaragePayload(value) {
    if (Array.isArray(value)) return value.map(normalizeVehicle).filter(Boolean)
    if (!value || typeof value !== 'object') return []
    const list = value.cars ?? value.vehicles ?? value.garage ?? value.items
    if (Array.isArray(list)) {
      const currentOrdinal = ordinalOf(value.currentCarOrdinal ?? value.current_car_ordinal)
      return list.map(normalizeVehicle).filter(Boolean).map(vehicle => currentOrdinal === vehicle.carOrdinal
        ? { ...vehicle, latestUsed: true }
        : vehicle)
    }
    const vehicle = normalizeVehicle(value.vehicle ?? value)
    return vehicle ? [vehicle] : []
  }

  function displayName(vehicle) {
    return vehicle?.name || (vehicle?.carOrdinal ? String(vehicle.carOrdinal) : '')
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
      const car = telemetry?.car && typeof telemetry.car === 'object' ? telemetry.car : telemetry
      for (const [keyName, value] of [
        ['carGroup', car?.carGroup],
        ['drivetrain', car?.drivetrain],
        ['cylinders', car?.cylinders]
      ]) {
        if (value !== undefined && value !== null) recordArgs[keyName] = value
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
