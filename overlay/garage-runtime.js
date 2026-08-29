(function (globalScope) {
  'use strict'

  const GARAGE_EVENT = 'hud_garage'
  const CLASS_LABELS = ['D', 'C', 'B', 'A', 'S1', 'S2', 'R', 'X']

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
    return {
      carOrdinal,
      name: typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null,
      class: Number.isFinite(numericClass) ? Math.round(numericClass) : null,
      classLabel: classLabel(rawClass),
      pi: pi === null ? null : Math.round(pi),
      carGroup: carGroup === null ? null : Math.round(carGroup),
      drivetrain: drivetrain === null ? null : Math.round(drivetrain),
      cylinders: cylinders === null ? null : Math.round(cylinders),
      latestUsed: vehicle.latestUsed === true || vehicle.isLatestUsed === true,
      lastUsedAt: vehicle.lastUsedAt ?? vehicle.last_seen_at ?? vehicle.lastSeenAt ?? null
    }
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
    displayName,
    createGarageRuntime
  }
  globalScope.HudGarageRuntime = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
