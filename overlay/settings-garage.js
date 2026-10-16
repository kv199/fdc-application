(function (globalScope, factory) {
  const api = factory(globalScope)
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.SettingsGarage = api
}(typeof globalThis !== 'undefined' ? globalThis : this, globalScope => {
  'use strict'

  // Pure rules: no DOM and no state. The FdcVehicle rules are read when a function runs,
  // so Node tests can call these directly once vehicle.js is loaded.
  function garageDisplayName(vehicle) {
    return globalScope.FdcVehicle.displayName(vehicle?.name, vehicle?.carOrdinal)
  }

  function garagePerformanceClass(classLabel) {
    return String(classLabel || 'unknown').trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-') || 'unknown'
  }

  function garageDrivetrainLabel(vehicle) {
    return globalScope.FdcVehicle.drivetrainLabel(vehicle?.drivetrain)
  }

  function garageVariantFallback(vehicle) {
    return {
      class: vehicle?.class,
      classLabel: vehicle?.classLabel,
      pi: vehicle?.pi,
      drivetrain: vehicle?.drivetrain,
      drivetrainLabel: vehicle?.drivetrainLabel
    }
  }

  function garageVariantsFor(vehicle) {
    if (!vehicle) return []
    if (Array.isArray(vehicle.variants) && vehicle.variants.length > 0) return vehicle.variants
    const fallback = garageVariantFallback(vehicle)
    const hasClass = Boolean(fallback.classLabel) || fallback.class !== null && fallback.class !== undefined
    const hasPi = fallback.pi !== null && fallback.pi !== undefined
    return hasClass || hasPi
      ? [fallback]
      : []
  }

  function garageVariantCylinders(variant, vehicle) {
    const cylinders = variant?.cylinders
      ?? variant?.numCylinders
      ?? variant?.num_cylinders
      ?? vehicle?.cylinders
    return cylinders === null || cylinders === undefined ? null : cylinders
  }

  // The Garage tab: the car grid, the current car with its name editor, and the observed
  // variants. ctx carries the shell functions, getters and setters for the settings.js state
  // that Garage shares with other tabs, and the callbacks that refresh those tabs.
  function create(ctx) {
    const {
      call,
      setStatus,
      getLatestShiftLightState,
      renderShiftLightState,
      openConnectionGuideIfNeverConnected,
      getCurrentEventRuns,
      setCurrentEventRuns,
      getCurrentEventRun,
      setCurrentEventRun,
      getDriverAnalysisHistory,
      setDriverAnalysisHistory,
      onGarageNamesChanged
    } = ctx
    const garageApi = globalScope.HudGarageRuntime
    const garageGrid = document.getElementById('garage-grid')
    const garageGridEmpty = document.getElementById('garage-grid-empty')
    const garageCurrentCar = document.getElementById('garage-current-car')
    const garageCurrentVariants = document.getElementById('garage-current-variants')
    const garageVariantList = document.getElementById('garage-variant-list')
    const garageCurrentVariantsToggle = document.getElementById('garage-current-variants-toggle')
    const garageCurrentEmpty = document.getElementById('garage-current-empty')
    const garageCarsCount = document.getElementById('garage-cars-count')
    const garageVehicles = new Map()
    let garageLatestOrdinal = null
    let garageVariantsOpen = false
    let garageVariantsOrdinal = null

  function appendGaragePerformance(container, vehicle) {
    const classLabel = vehicle?.classLabel
      || (vehicle?.class !== null && vehicle?.class !== undefined
        ? garageApi?.classLabel?.(vehicle.class)
        : null)
    const pi = vehicle?.pi === null || vehicle?.pi === undefined ? null : vehicle.pi
    if (!classLabel && pi === null) return
    const performance = document.createElement('div')
    performance.className = `garage-performance garage-performance--${garagePerformanceClass(classLabel)}`
    if (classLabel) {
      const classBadge = document.createElement('span')
      classBadge.className = 'garage-performance__class'
      classBadge.textContent = classLabel
      performance.append(classBadge)
    }
    if (pi !== null) {
      const piBadge = document.createElement('span')
      piBadge.className = 'garage-performance__pi'
      piBadge.textContent = String(pi)
      performance.append(piBadge)
    }
    container.append(performance)
  }
  function renderGarageVariants(vehicle) {
    if (!garageCurrentVariants || !garageCurrentVariantsToggle || !garageVariantList) return
    const isCurrentVehicle = garageVariantsOrdinal === vehicle?.carOrdinal
    const open = Boolean(vehicle && isCurrentVehicle && garageVariantsOpen)
    garageVariantList.replaceChildren()
    garageCurrentVariants.hidden = !open
    garageCurrentVariantsToggle.hidden = !vehicle
    garageCurrentVariantsToggle.textContent = open ? 'HIDE VARIANTS' : 'VIEW VARIANTS'
    garageCurrentVariantsToggle.setAttribute('aria-expanded', String(open))
    if (!open || !vehicle) return

    for (const variant of garageVariantsFor(vehicle)) {
      const classLabel = variant?.classLabel
        || (variant?.class !== null && variant?.class !== undefined
          ? garageApi?.classLabel?.(variant.class)
          : null)
      const row = document.createElement('div')
      row.className = `garage-variant-row garage-variant-row--${garagePerformanceClass(classLabel)}`
      row.dataset.carClass = classLabel || 'unknown'
      appendGaragePerformance(row, { ...variant, classLabel })
      const drivetrain = garageDrivetrainLabel(variant) || garageDrivetrainLabel(vehicle)
      if (drivetrain) {
        const drivetrainValue = document.createElement('span')
        drivetrainValue.className = 'garage-variant-row__drivetrain'
        drivetrainValue.textContent = drivetrain
        row.append(drivetrainValue)
      }
      const cylinders = garageVariantCylinders(variant, vehicle)
      if (cylinders !== null) {
        const cylindersValue = document.createElement('span')
        cylindersValue.className = 'garage-variant-row__cylinders'
        cylindersValue.textContent = `${cylinders} CYL`
        row.append(cylindersValue)
      }
      // Every listed variant was observed in telemetry, so each row is marked OBSERVED.
      const state = document.createElement('span')
      state.className = 'garage-variant-row__state'
      state.textContent = 'OBSERVED'
      row.append(state)
      garageVariantList.append(row)
    }
  }
  function mergeGarageVehicle(value) {
    const vehicle = garageApi?.normalizeVehicle?.(value)
    if (!vehicle) return null
    const previous = garageVehicles.get(vehicle.carOrdinal)
    const merged = {
      ...previous,
      ...vehicle,
      name: vehicle.name || previous?.name || null,
      classLabel: vehicle.classLabel || previous?.classLabel || null,
      class: vehicle.class ?? previous?.class ?? null,
      pi: vehicle.pi ?? previous?.pi ?? null
    }
    garageVehicles.set(merged.carOrdinal, merged)
    if (merged.latestUsed) {
      for (const saved of garageVehicles.values()) saved.latestUsed = saved.carOrdinal === merged.carOrdinal
      garageLatestOrdinal = merged.carOrdinal
    }
    return merged
  }
  function renderGarageCurrent() {
    if (!garageCurrentCar || !garageCurrentEmpty) return
    const vehicle = garageLatestOrdinal === null ? null : garageVehicles.get(garageLatestOrdinal)
    if (vehicle && garageVariantsOrdinal !== vehicle.carOrdinal) {
      garageVariantsOrdinal = vehicle.carOrdinal
      garageVariantsOpen = false
    }
    garageCurrentCar.replaceChildren()
    garageCurrentCar.hidden = !vehicle
    garageCurrentEmpty.hidden = Boolean(vehicle)
    if (!vehicle) {
      garageVariantsOrdinal = null
      garageVariantsOpen = false
      renderGarageVariants(null)
      return
    }
    const content = document.createElement('div')
    content.className = 'garage-current-car__content'
    const name = document.createElement('button')
    name.type = 'button'
    name.className = 'garage-current-car__name'
    name.textContent = garageDisplayName(vehicle)
    const details = document.createElement('div')
    details.className = 'garage-current-car__details'
    appendGaragePerformance(details, vehicle)
    const drivetrain = garageDrivetrainLabel(vehicle)
    if (drivetrain) {
      const drivetrainValue = document.createElement('span')
      drivetrainValue.className = 'garage-current-car__drivetrain'
      drivetrainValue.textContent = drivetrain
      details.append(drivetrainValue)
    }
    if (vehicle.cylinders !== null && vehicle.cylinders !== undefined) {
      const cylinders = document.createElement('span')
      cylinders.className = 'garage-current-car__cylinders'
      cylinders.textContent = `${vehicle.cylinders} CYL`
      details.append(cylinders)
    }
    details.append(garageCurrentVariantsToggle)
    const carGroup = vehicle.carGroup === null || vehicle.carGroup === undefined
      ? null
      : Number(vehicle.carGroup)
    const group = Number.isFinite(carGroup) && carGroup > 0
      ? document.createElement('span')
      : null
    if (group) {
      group.className = 'garage-current-car__group'
      group.textContent = `GROUP ${Math.round(carGroup)}`
    }
    name.addEventListener('click', () => {
      const input = document.createElement('input')
      input.className = 'garage-current-car__input'
      input.type = 'text'
      input.maxLength = 80
      input.value = vehicle.name || ''
      input.placeholder = String(vehicle.carOrdinal)
      input.setAttribute('aria-label', `Name for ${vehicle.carOrdinal}`)
      name.replaceWith(input)
      input.focus()
      let cancelled = false
      const finish = () => {
        if (cancelled) return
        const nextName = input.value.trim()
        input.replaceWith(name)
        if (nextName !== (vehicle.name || '')) void renameGarageCar(vehicle.carOrdinal, nextName)
      }
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') finish()
        if (event.key === 'Escape') {
          cancelled = true
          input.replaceWith(name)
        }
      })
      input.addEventListener('blur', finish, { once: true })
    })
    content.append(name, ...(group ? [group] : []), details)
    garageCurrentCar.append(content)
    renderGarageVariants(vehicle)
  }
  function renderGarage() {
    const latestShiftLightState = getLatestShiftLightState()
    if (latestShiftLightState) renderShiftLightState(latestShiftLightState)
    if (!garageGrid) return
    garageGrid.replaceChildren()
    const vehicles = [...garageVehicles.values()].sort((left, right) => {
      if (left.latestUsed !== right.latestUsed) return left.latestUsed ? -1 : 1
      return left.carOrdinal - right.carOrdinal
    })
    if (garageGridEmpty) garageGridEmpty.hidden = vehicles.length > 0
    if (garageCarsCount) {
      garageCarsCount.textContent = `${vehicles.length} ${vehicles.length === 1 ? 'CAR' : 'CARS'}`
    }
    for (const vehicle of vehicles) {
      const card = document.createElement('article')
      card.className = 'garage-card'
      card.dataset.carOrdinal = String(vehicle.carOrdinal)
      card.dataset.carClass = vehicle.classLabel || 'unknown'

      const content = document.createElement('div')
      content.className = 'garage-card__content'
      const name = document.createElement('h4')
      name.className = 'garage-card__name'
      name.textContent = garageDisplayName(vehicle)

      const meta = document.createElement('div')
      appendGaragePerformance(meta, vehicle)
      content.append(name, meta)
      card.append(content)
      if (vehicle.carOrdinal === garageLatestOrdinal) {
        card.classList.add('garage-card--latest')
        const latest = document.createElement('span')
        latest.className = 'garage-card__latest'
        latest.textContent = 'LAST USED'
        card.append(latest)
      }
      garageGrid.append(card)
    }
    renderGarageCurrent()
  }
  function closeGarageVariants() {
    if (!garageVariantsOpen) return
    garageVariantsOpen = false
    const vehicle = garageVariantsOrdinal === null ? null : garageVehicles.get(garageVariantsOrdinal)
    renderGarageVariants(vehicle)
  }

  function toggleGarageVariants() {
    const vehicle = garageLatestOrdinal === null ? null : garageVehicles.get(garageLatestOrdinal)
    if (!vehicle) return
    garageVariantsOrdinal = vehicle.carOrdinal
    garageVariantsOpen = !garageVariantsOpen
    renderGarageVariants(vehicle)
  }
  async function renameGarageCar(carOrdinal, name) {
    const ordinal = Number(carOrdinal)
    if (!Number.isFinite(ordinal) || ordinal <= 0) return false
    const normalizedName = typeof name === 'string' ? name.trim() : ''
    const vehicle = mergeGarageVehicle({ carOrdinal: ordinal, name: normalizedName || null })
    if (vehicle) {
      vehicle.name = normalizedName || null
      garageVehicles.set(vehicle.carOrdinal, vehicle)
    }
    renderGarage()
    propagateGarageNames([Math.round(ordinal)])
    try {
      const result = await call('rename_garage_car', { carOrdinal: Math.round(ordinal), name: normalizedName })
      const returned = garageApi?.normalizeGaragePayload?.(result)?.[0]
      if (returned) {
        const saved = mergeGarageVehicle(returned)
        if (saved) {
          saved.name = normalizedName || null
          garageVehicles.set(saved.carOrdinal, saved)
        }
      }
      renderGarage()
      propagateGarageNames([Math.round(ordinal)])
      const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
      if (eventApi?.emit) await eventApi.emit('hud_garage', returned || vehicle)
      setStatus('GARAGE NAME SAVED')
      return true
    } catch (error) {
      setStatus(error.message || 'Unable to rename garage car', true)
      return false
    }
  }
  function propagateGarageNames(ordinals) {
    let runsChanged = false
    setCurrentEventRuns(getCurrentEventRuns().map(run => {
      const ordinal = Number(run?.car?.ordinal)
      if (!Number.isFinite(ordinal) || ordinal <= 0 || !ordinals.includes(Math.round(ordinal))) return run
      const garageName = garageVehicles.get(Math.round(ordinal))?.name
      const newName = garageName || null
      if (run.car.name === newName) return run
      runsChanged = true
      return { ...run, car: { ...run.car, name: newName } }
    }))
    let historyChanged = false
    setDriverAnalysisHistory(getDriverAnalysisHistory().map(session => {
      const ordinal = Number(session?.vehicleIdentity?.ordinal)
      if (!Number.isFinite(ordinal) || ordinal <= 0 || !ordinals.includes(Math.round(ordinal))) return session
      const garageName = garageVehicles.get(Math.round(ordinal))?.name
      const newName = garageName || null
      if (session.vehicleName === newName) return session
      historyChanged = true
      return { ...session, vehicleName: newName }
    }))
    const currentEventRun = getCurrentEventRun()
    const openRunOrdinal = Math.round(Number(currentEventRun?.car?.ordinal))
    if (currentEventRun && ordinals.includes(openRunOrdinal)) {
      const newName = garageVehicles.get(openRunOrdinal)?.name || null
      if (currentEventRun.car.name !== newName) {
        setCurrentEventRun({ ...currentEventRun, car: { ...currentEventRun.car, name: newName } })
        runsChanged = true
      }
    }
    // settings.js re-renders the Events and Driver Analysis views that show these names.
    onGarageNamesChanged({ runsChanged, historyChanged })
  }

  function applyGaragePayload(payload) {
    const vehicles = garageApi?.normalizeGaragePayload?.(payload) || []
    const ordinals = []
    for (const vehicle of vehicles) {
      mergeGarageVehicle(vehicle)
      ordinals.push(vehicle.carOrdinal)
    }
    renderGarage()
    propagateGarageNames(ordinals)
  }

  async function listenGarageEvents() {
    const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
    if (!eventApi || typeof eventApi.listen !== 'function') return
    await eventApi.listen('hud_garage', event => applyGaragePayload(event?.payload))
    try {
      applyGaragePayload(await call('load_garage_snapshot'))
    } catch {
      renderGarage()
    }
    openConnectionGuideIfNeverConnected()
  }

    garageCurrentVariantsToggle?.addEventListener('click', toggleGarageVariants)

    return {
      renderGarage,
      closeGarageVariants,
      listenGarageEvents,
      getGarageVehicles: () => garageVehicles,
      appendGaragePerformance,
      garageVariantsFor
    }
  }

  return {
    create,
    garageDisplayName,
    garagePerformanceClass,
    garageDrivetrainLabel,
    garageVariantsFor,
    garageVariantCylinders
  }
}))
