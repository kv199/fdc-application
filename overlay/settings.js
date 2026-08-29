(function (globalScope) {
  'use strict'

  const VISIBILITY_STORAGE_KEY = 'fdc.hud-visibility.v1'
  const OVERLAY_VISIBILITY_STORAGE_KEY = 'fdc.overlay-visibility.v1'
  const COMPONENTS = ['tires', 'pedals', 'steering', 'gear', 'engine', 'history']
  const OVERLAY_COMPONENTS = ['coach', 'delta', 'hud']
  const DEFAULT_VISIBILITY = COMPONENTS.reduce((state, name) => {
    state[name] = true
    return state
  }, {})
  const invoke = globalScope.__TAURI_INTERNALS__?.invoke
  const status = document.getElementById('settings-status')
  const telemetryStatus = document.getElementById('telemetry-status')
  const telemetryStatusLabel = document.getElementById('telemetry-status-label')
  const telemetryRouteCard = document.getElementById('telemetry-route-card')
  const telemetryRouteRetry = document.getElementById('telemetry-route-retry')
  const shiftLightEmpty = document.getElementById('shift-light-empty')
  const shiftLightProfile = document.getElementById('shift-light-profile')
  const shiftLightCarKey = document.getElementById('shift-light-car-key')
  const shiftLightCarPi = document.getElementById('shift-light-car-pi')
  const shiftLightCarRpmMax = document.getElementById('shift-light-car-rpm-max')
  const shiftLightCurrentTarget = document.getElementById('shift-light-current-target')
  const shiftLightState = document.getElementById('shift-light-state')
  const shiftLightGearRows = document.getElementById('shift-light-gear-rows')
  const shiftLightReset = document.getElementById('shift-light-reset')
  const shiftLightHelp = document.getElementById('shift-light-help')
  const shiftLightHelpPanel = document.getElementById('shift-light-help-panel')
  const displayPreferencesApi = globalScope.DisplayPreferences
  const DEFAULT_HUD_OPACITY = displayPreferencesApi?.DEFAULTS?.hudOpacity ?? 80
  const speedUnitInputs = [...document.querySelectorAll('input[name="speed-unit"]')]
  const configurationAlwaysOnTop = document.getElementById('configuration-always-on-top')
  const shiftLightBrightness = document.getElementById('shift-light-brightness')
  const shiftLightBrightnessValue = document.getElementById('shift-light-brightness-value')
  const hudOpacity = document.getElementById('hud-opacity')
  const hudOpacityValue = document.getElementById('hud-opacity-value')
  const hudOpacityReset = document.getElementById('hud-opacity-reset')
  const displayPreferenceRows = [...document.querySelectorAll('[data-display-preference]')]
  const normalizeShiftLightState = globalScope.ShiftLightSettings?.normalizeShiftLightState
  const settingsTabs = [...document.querySelectorAll('[data-settings-tab]')]
  const settingsPanels = [...document.querySelectorAll('[data-settings-panel]')]
  const garageApi = globalScope.HudGarageRuntime
  const garageGrid = document.getElementById('garage-grid')
  const garageGridEmpty = document.getElementById('garage-grid-empty')
  const garageCurrentCar = document.getElementById('garage-current-car')
  const garageCurrentVariants = document.getElementById('garage-current-variants')
  const garageCurrentVariantsToggle = document.getElementById('garage-current-variants-toggle')
  const garageCurrentEmpty = document.getElementById('garage-current-empty')
  const garageCarsCount = document.getElementById('garage-cars-count')
  const garageVehicles = new Map()
  let garageLatestOrdinal = null
  let garageVariantsOpen = false
  let garageVariantsOrdinal = null
  const eventsLibraryView = document.getElementById('events-library-view')
  const eventsDetailView = document.getElementById('events-detail-view')
  const eventsGrid = document.getElementById('events-grid')
  const eventsGridEmpty = document.getElementById('events-grid-empty')
  const eventsCreateToggle = document.getElementById('events-create-toggle')
  const eventsCreateArea = document.getElementById('events-create-area')
  const eventsCreateCancel = document.getElementById('events-create-cancel')
  const eventsCreateForm = document.getElementById('events-create-form')
  const eventName = document.getElementById('event-name')
  const eventClass = document.getElementById('event-class')
  const eventRouteType = document.getElementById('event-route-type')
  const eventMode = document.getElementById('event-mode')
  const eventNotes = document.getElementById('event-notes')
  const eventsDetailBack = document.getElementById('events-detail-back')
  const eventsDetailTitle = document.getElementById('events-detail-title')
  const eventsDetailMetadata = document.getElementById('events-detail-metadata')
  const eventsDetailArchive = document.getElementById('events-detail-archive')
  const eventsDetailDelete = document.getElementById('events-detail-delete')
  const eventsById = new Map()
  let eventsView = 'library'
  let currentEventId = null
  let eventsCreateOpen = false
  let editingTarget = null
  let shiftLightResetPending = false
  let displayPreferencesPending = false
  let displayPreferences = displayPreferencesApi?.read?.() || {
    speedUnit: 'kmh',
    shiftLightBrightness: 80,
    hudOpacity: DEFAULT_HUD_OPACITY,
    configurationAlwaysOnTop: true
  }
  let latestShiftLightState = null
  let latestRouteRevision = -1
  let latestRouteStatus = globalScope.HudTelemetryRoute?.normalizeRouteStatus?.({ phase: 'offline' })

  function garageDisplayName(vehicle) {
    return garageApi?.displayName?.(vehicle) || vehicle?.name || String(vehicle?.carOrdinal || '')
  }

  function garagePerformanceClass(classLabel) {
    return String(classLabel || 'unknown').trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-') || 'unknown'
  }

  function garageDrivetrainLabel(vehicle) {
    const directLabel = typeof vehicle?.drivetrainLabel === 'string' ? vehicle.drivetrainLabel.trim().toUpperCase() : ''
    if (['FWD', 'RWD', 'AWD'].includes(directLabel)) return directLabel
    const rawDrivetrain = vehicle?.drivetrain
      ?? vehicle?.drivetrainType
      ?? vehicle?.drivetrain_type
    const normalized = garageApi?.drivetrainLabel?.(rawDrivetrain)
    if (normalized) return normalized
    const fallback = typeof rawDrivetrain === 'string' ? rawDrivetrain.trim().toUpperCase() : ''
    return ['FWD', 'RWD', 'AWD'].includes(fallback) ? fallback : null
  }

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

  function renderGarageVariants(vehicle) {
    if (!garageCurrentVariants || !garageCurrentVariantsToggle) return
    const isCurrentVehicle = garageVariantsOrdinal === vehicle?.carOrdinal
    const open = Boolean(vehicle && isCurrentVehicle && garageVariantsOpen)
    garageCurrentVariants.replaceChildren()
    garageCurrentVariants.hidden = !open
    garageCurrentVariantsToggle.hidden = !vehicle
    garageCurrentVariantsToggle.textContent = open ? 'HIDE' : 'VIEW'
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
      garageCurrentVariants.append(row)
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
    const image = document.createElement('div')
    image.className = 'garage-current-car__image'
    image.textContent = 'IMAGE'
    image.setAttribute('aria-label', `Image placeholder for ${garageDisplayName(vehicle)}`)
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
    garageCurrentCar.append(image, content)
    renderGarageVariants(vehicle)
  }

  function renderGarage() {
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

      const image = document.createElement('div')
      image.className = 'garage-card__image'
      image.textContent = 'IMAGE'
      image.setAttribute('aria-label', `Image placeholder for ${garageDisplayName(vehicle)}`)

      const content = document.createElement('div')
      content.className = 'garage-card__content'
      const name = document.createElement('h4')
      name.className = 'garage-card__name'
      name.textContent = garageDisplayName(vehicle)

      const meta = document.createElement('div')
      appendGaragePerformance(meta, vehicle)
      if (vehicle.carOrdinal === garageLatestOrdinal) {
        card.classList.add('garage-card--latest')
        const latest = document.createElement('span')
        latest.className = 'garage-card__latest'
        latest.textContent = 'LAST USED'
        card.append(latest)
      }

      content.append(name, meta)
      card.append(image, content)
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
      const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
      if (eventApi?.emit) await eventApi.emit('hud_garage', returned || vehicle)
      setStatus('GARAGE NAME SAVED')
      return true
    } catch (error) {
      setStatus(error.message || 'Unable to rename garage car', true)
      return false
    }
  }

  function applyGaragePayload(payload) {
    const vehicles = garageApi?.normalizeGaragePayload?.(payload) || []
    for (const vehicle of vehicles) mergeGarageVehicle(vehicle)
    renderGarage()
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
  }

  function eventKey(value) {
    if (value === null || value === undefined || value === '') return null
    return String(value)
  }

  function eventIdFrom(value) {
    if (value && typeof value === 'object') {
      return value.id ?? value.eventId ?? value.event_id ?? value.event?.id ?? value.event?.eventId ?? null
    }
    return value
  }

  function eventText(value) {
    return typeof value === 'string' ? value.trim() : ''
  }

  function normalizeEvent(value) {
    const source = value && typeof value === 'object' && value.event && typeof value.event === 'object'
      ? value.event
      : value
    const id = eventKey(eventIdFrom(source))
    if (!id) return null
    const mode = eventText(source?.mode) || 'Any'
    const routeType = eventText(source?.routeType ?? source?.route_type ?? source?.route) || 'Asphalt'
    const eventClass = eventText(source?.class ?? source?.eventClass ?? source?.event_class) || 'Any'
    return {
      id,
      name: eventText(source?.name ?? source?.title ?? source?.displayName) || `EVENT ${id}`,
      eventClass,
      routeType,
      mode,
      notes: eventText(source?.notes),
      archived: source?.archived === true
        || source?.isArchived === true
        || source?.is_archived === true
        || Boolean(source?.archivedAt ?? source?.archived_at)
    }
  }

  function normalizeEventsPayload(value) {
    if (Array.isArray(value)) return value.map(normalizeEvent).filter(Boolean)
    if (!value || typeof value !== 'object') return []
    const list = value.events ?? value.items ?? value.records
    if (Array.isArray(list)) return list.map(normalizeEvent).filter(Boolean)
    const single = normalizeEvent(value.event ?? value)
    return single ? [single] : []
  }

  function eventModeKey(mode) {
    return eventText(mode).toLowerCase().replaceAll(/[^a-z0-9]+/g, '') || 'any'
  }

  function eventModeLabel(mode) {
    const labels = {
      any: 'ANY',
      rivals: 'RIVALS',
      online: 'ONLINE',
      eventlab: 'EVENTLAB',
      official: 'OFFICIAL',
      blueprint: 'BLUEPRINT'
    }
    return labels[eventModeKey(mode)] || eventText(mode).toUpperCase() || 'ANY'
  }

  function eventRouteLabel(routeType) {
    return eventText(routeType).toUpperCase() || 'ASPHALT'
  }

  function renderEventCard(event, detail = false) {
    const card = document.createElement('article')
    card.className = `events-card${detail ? ' events-card--detail' : ''}`
    card.dataset.eventId = event.id
    card.dataset.eventMode = eventModeKey(event.mode)
    if (!detail) {
      card.tabIndex = 0
      card.setAttribute('role', 'button')
      card.setAttribute('aria-label', `Open event ${event.name}`)
      card.addEventListener('click', () => void openEventDetail(event.id))
      card.addEventListener('keydown', eventKeyDown => {
        if (eventKeyDown.key === 'Enter' || eventKeyDown.key === ' ') {
          eventKeyDown.preventDefault()
          void openEventDetail(event.id)
        }
      })
    }

    const image = document.createElement('div')
    image.className = 'events-card__image'
    image.textContent = 'EVENT'
    image.setAttribute('aria-hidden', 'true')

    const content = document.createElement('div')
    content.className = 'events-card__content'
    const name = document.createElement('h3')
    name.className = 'events-card__name'
    name.textContent = event.name
    const meta = document.createElement('div')
    meta.className = 'events-card__meta'
    const mode = document.createElement('span')
    mode.className = 'events-card__badge events-card__badge--mode'
    mode.textContent = eventModeLabel(event.mode)
    const route = document.createElement('span')
    route.className = 'events-card__badge events-card__badge--route'
    route.textContent = eventRouteLabel(event.routeType)
    meta.append(mode, route)
    content.append(name, meta)
    card.append(image, content)
    return card
  }

  function renderEventsLibrary() {
    if (!eventsGrid) return
    eventsGrid.replaceChildren()
    const activeEvents = [...eventsById.values()].filter(event => !event.archived)
    if (eventsGridEmpty) eventsGridEmpty.hidden = activeEvents.length > 0
    for (const event of activeEvents) eventsGrid.append(renderEventCard(event))
  }

  function setEventsCreateOpen(open) {
    eventsCreateOpen = Boolean(open)
    if (eventsCreateArea) eventsCreateArea.hidden = !eventsCreateOpen
    eventsCreateToggle?.setAttribute('aria-expanded', String(eventsCreateOpen))
    if (eventsCreateOpen) eventName?.focus()
  }

  function resetEventCreateForm() {
    eventsCreateForm?.reset()
  }

  function setEventsView(view) {
    eventsView = view
    const detail = view === 'detail'
    if (eventsLibraryView) eventsLibraryView.hidden = detail
    if (eventsDetailView) eventsDetailView.hidden = !detail
  }

  function renderEventDetail(event) {
    if (!event) return
    if (eventsDetailTitle) eventsDetailTitle.textContent = event.name
    if (eventsDetailMetadata) {
      eventsDetailMetadata.replaceChildren()
      eventsDetailMetadata.dataset.eventId = event.id
      eventsDetailMetadata.dataset.eventMode = eventModeKey(event.mode)
      const fields = [
        ['MODE', eventModeLabel(event.mode), true],
        ['ROUTE TYPE', eventRouteLabel(event.routeType), false],
        ['CLASS', eventText(event.eventClass).toUpperCase() || 'ANY', false]
      ]
      if (event.notes) fields.push(['NOTES', event.notes, false])
      for (const [label, value, isMode] of fields) {
        const row = document.createElement('div')
        row.className = 'events-detail-view__metadata-row'
        const labelElement = document.createElement('span')
        labelElement.className = 'events-detail-view__metadata-label'
        labelElement.textContent = label
        const valueElement = document.createElement('span')
        valueElement.className = `events-detail-view__metadata-value${isMode ? ' events-detail-view__metadata-value--mode' : ''}`
        valueElement.textContent = value
        row.append(labelElement, valueElement)
        eventsDetailMetadata.append(row)
      }
    }
  }

  async function loadEvents() {
    try {
      const result = await call('load_events')
      eventsById.clear()
      for (const event of normalizeEventsPayload(result)) eventsById.set(event.id, event)
      renderEventsLibrary()
      return true
    } catch (error) {
      renderEventsLibrary()
      setStatus(error.message || 'Unable to load events', true)
      return false
    }
  }

  async function openEventDetail(id) {
    const key = eventKey(id)
    if (!key) return false
    let event = eventsById.get(key) || null
    try {
      const loaded = normalizeEvent(await call('load_event', { eventId: event?.id ?? id }))
      if (loaded) {
        event = { ...event, ...loaded }
        eventsById.set(loaded.id, event)
      }
    } catch (error) {
      if (!event) {
        setStatus(error.message || 'Unable to load event', true)
        return false
      }
    }
    if (!event || event.archived) return false
    currentEventId = event.id
    setEventsCreateOpen(false)
    renderEventDetail(event)
    setEventsView('detail')
    eventsDetailBack?.focus()
    return true
  }

  function closeEventDetail() {
    currentEventId = null
    if (eventsDetailMetadata) {
      eventsDetailMetadata.replaceChildren()
      delete eventsDetailMetadata.dataset.eventId
      delete eventsDetailMetadata.dataset.eventMode
    }
    setEventsView('library')
    renderEventsLibrary()
  }

  async function createEvent() {
    if (!eventsCreateForm?.checkValidity()) {
      eventsCreateForm?.reportValidity()
      return false
    }
    const payload = {
      name: eventName.value.trim(),
      class: eventClass.value,
      route: eventRouteType.value,
      mode: eventMode.value,
      notes: eventNotes.value.trim()
    }
    if (!payload.name) {
      eventName.setCustomValidity('Event name is required')
      eventName.reportValidity()
      eventName.setCustomValidity('')
      return false
    }
    try {
      const result = await call('create_event', payload)
      const created = normalizeEvent(result)
      const resultId = eventIdFrom(result)
      const event = created
        ? { ...created, ...payload, id: created.id }
        : normalizeEvent({ ...payload, id: resultId })
      if (!event) throw new Error('Create event did not return an event id')
      eventsById.set(event.id, event)
      resetEventCreateForm()
      setEventsCreateOpen(false)
      renderEventDetail(event)
      currentEventId = event.id
      setEventsView('detail')
      eventsDetailBack?.focus()
      setStatus('EVENT CREATED')
      return true
    } catch (error) {
      setStatus(error.message || 'Unable to create event', true)
      return false
    }
  }

  function beginEventRename() {
    const event = currentEventId === null ? null : eventsById.get(currentEventId)
    if (!event || !eventsDetailTitle) return
    const input = document.createElement('input')
    input.className = 'events-detail-view__title-input'
    input.type = 'text'
    input.value = event.name
    input.setAttribute('aria-label', `Name for ${event.name}`)
    eventsDetailTitle.replaceWith(input)
    input.focus()
    let finished = false
    const finish = save => {
      if (finished) return
      finished = true
      const nextName = input.value.trim()
      input.replaceWith(eventsDetailTitle)
      if (save && nextName && nextName !== event.name) void renameEvent(event.id, nextName)
      if (save && !nextName) setStatus('EVENT NAME REQUIRED', true)
    }
    input.addEventListener('keydown', eventKeyDown => {
      if (eventKeyDown.key === 'Enter') {
        eventKeyDown.preventDefault()
        finish(true)
      }
      if (eventKeyDown.key === 'Escape') {
        eventKeyDown.preventDefault()
        finish(false)
      }
    })
    input.addEventListener('blur', () => finish(true), { once: true })
  }

  async function renameEvent(id, name) {
    const key = eventKey(id)
    const event = key ? eventsById.get(key) : null
    if (!event || !name) return false
    const previousName = event.name
    event.name = name
    renderEventDetail(event)
    renderEventsLibrary()
    try {
      const result = await call('rename_event', { eventId: event.id, name })
      const returned = normalizeEvent(result)
      if (returned) eventsById.set(returned.id, { ...event, ...returned, name })
      renderEventDetail(eventsById.get(key))
      renderEventsLibrary()
      setStatus('EVENT NAME SAVED')
      return true
    } catch (error) {
      event.name = previousName
      renderEventDetail(event)
      renderEventsLibrary()
      setStatus(error.message || 'Unable to rename event', true)
      return false
    }
  }

  async function archiveCurrentEvent() {
    const event = currentEventId === null ? null : eventsById.get(currentEventId)
    if (!event) return false
    try {
      await call('archive_event', { eventId: event.id })
      event.archived = true
      eventsById.set(event.id, event)
      closeEventDetail()
      setStatus('EVENT ARCHIVED')
      return true
    } catch (error) {
      setStatus(error.message || 'Unable to archive event', true)
      return false
    }
  }

  async function deleteCurrentEvent() {
    const event = currentEventId === null ? null : eventsById.get(currentEventId)
    if (!event) return false
    if (typeof globalScope.confirm === 'function' && !globalScope.confirm(`Delete event “${event.name}”?`)) return false
    try {
      await call('delete_event', { eventId: event.id })
      eventsById.delete(event.id)
      closeEventDetail()
      setStatus('EVENT DELETED')
      return true
    } catch (error) {
      setStatus(error.message || 'Unable to delete event', true)
      return false
    }
  }

  function selectSettingsTab(tabName) {
    for (const tab of settingsTabs) {
      const isActive = tab.dataset.settingsTab === tabName
      tab.classList.toggle('is-active', isActive)
      tab.setAttribute('aria-selected', String(isActive))
      tab.tabIndex = isActive ? 0 : -1
    }
    for (const panel of settingsPanels) {
      panel.hidden = panel.dataset.settingsPanel !== tabName
    }
    if (tabName === 'events' && eventsView === 'library') void loadEvents()
  }

  function setStatus(message, error = false) {
    status.textContent = message
    status.classList.toggle('is-error', error)
  }

  function call(command, args) {
    if (typeof invoke !== 'function') {
      return Promise.reject(new Error('Tauri commands are unavailable'))
    }
    return invoke(command, args)
  }

  function renderDisplayPreferences(preferences) {
    for (const input of speedUnitInputs) {
      input.checked = input.value === preferences.speedUnit
    }
    renderShiftLightBrightness(preferences.shiftLightBrightness)
    renderHudOpacity(preferences.hudOpacity)
    if (configurationAlwaysOnTop) updateOverlayToggle(configurationAlwaysOnTop, preferences.configurationAlwaysOnTop !== false)
  }

  function renderShiftLightBrightness(value) {
    const brightness = Number(value)
    const minimum = Number(shiftLightBrightness.min)
    const maximum = Number(shiftLightBrightness.max)
    const progress = ((brightness - minimum) / (maximum - minimum)) * 100
    shiftLightBrightness.value = String(brightness)
    shiftLightBrightness.style.setProperty('--brightness-fill', `${Math.max(0, Math.min(100, progress))}%`)
    shiftLightBrightness.setAttribute('aria-valuetext', `${brightness}% brightness`)
    shiftLightBrightnessValue.textContent = `${brightness}%`
  }

  function renderHudOpacity(value) {
    const opacity = Number(value)
    const isDefault = opacity === DEFAULT_HUD_OPACITY
    const minimum = Number(hudOpacity.min)
    const maximum = Number(hudOpacity.max)
    const progress = ((opacity - minimum) / (maximum - minimum)) * 100
    hudOpacity.value = String(opacity)
    hudOpacity.style.setProperty('--brightness-fill', `${Math.max(0, Math.min(100, progress))}%`)
    hudOpacity.setAttribute('aria-valuetext', `${opacity}% opacity`)
    hudOpacityValue.textContent = `${opacity}%`
    hudOpacityReset.disabled = displayPreferencesPending || isDefault
    hudOpacityReset.classList.toggle('is-dirty', !isDefault)
  }

  function setDisplayPreferencesPending(pending) {
    displayPreferencesPending = pending
    for (const input of speedUnitInputs) input.disabled = pending
    if (configurationAlwaysOnTop) configurationAlwaysOnTop.disabled = pending
    shiftLightBrightness.disabled = pending
    hudOpacity.disabled = pending
    hudOpacityReset.disabled = pending || displayPreferences.hudOpacity === DEFAULT_HUD_OPACITY
    for (const row of displayPreferenceRows) row.classList.toggle('is-pending', pending)
  }

  async function updateDisplayPreferences(update, successMessage) {
    if (displayPreferencesPending) {
      renderDisplayPreferences(displayPreferences)
      return
    }
    if (!displayPreferencesApi?.normalize || !displayPreferencesApi?.write) {
      setStatus('DISPLAY PREFERENCES ARE UNAVAILABLE', true)
      return
    }

    const previous = displayPreferences
    const next = displayPreferencesApi.normalize({ ...previous, ...update })
    displayPreferences = next
    displayPreferencesApi.write(next)
    renderDisplayPreferences(next)
    setDisplayPreferencesPending(true)

    try {
      await call('set_display_preferences', {
        speedUnit: next.speedUnit,
        shiftLightBrightness: next.shiftLightBrightness,
        hudOpacity: next.hudOpacity
      })
      setStatus(successMessage(next))
    } catch (error) {
      displayPreferences = previous
      displayPreferencesApi.write(previous)
      renderDisplayPreferences(previous)
      setStatus(error.message || 'Unable to update display preferences', true)
    } finally {
      setDisplayPreferencesPending(false)
    }
  }

  function readVisibility() {
    try {
      const stored = JSON.parse(localStorage.getItem(VISIBILITY_STORAGE_KEY) || 'null')
      if (!stored || typeof stored !== 'object') return { ...DEFAULT_VISIBILITY }
      return COMPONENTS.reduce((state, name) => {
        state[name] = stored[name] !== false
        return state
      }, {})
    } catch {
      return { ...DEFAULT_VISIBILITY }
    }
  }

  function saveVisibility(state) {
    try {
      localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(state))
    } catch {
      // A restricted webview may not expose persistent storage.
    }
  }

  function readOverlayVisibility() {
    try {
      const stored = JSON.parse(localStorage.getItem(OVERLAY_VISIBILITY_STORAGE_KEY) || 'null')
      if (!stored || typeof stored !== 'object') {
        return OVERLAY_COMPONENTS.reduce((state, name) => {
          state[name] = true
          return state
        }, {})
      }
      return OVERLAY_COMPONENTS.reduce((state, name) => {
        state[name] = stored[name] !== false
        return state
      }, {})
    } catch {
      return OVERLAY_COMPONENTS.reduce((state, name) => {
        state[name] = true
        return state
      }, {})
    }
  }

  function saveOverlayVisibility(state) {
    try {
      localStorage.setItem(OVERLAY_VISIBILITY_STORAGE_KEY, JSON.stringify(state))
    } catch {
      // A restricted webview may not expose persistent storage.
    }
  }

  function updateOverlayToggle(button, visible) {
    button.setAttribute('aria-pressed', String(visible))
    button.dataset.state = visible ? 'on' : 'off'
  }

  function renderRouteStatus(rawStatus) {
    const nextStatus = globalScope.HudTelemetryRoute?.normalizeRouteStatus?.(rawStatus)
    if (!nextStatus || nextStatus.revision < latestRouteRevision) return
    latestRouteRevision = nextStatus.revision
    latestRouteStatus = nextStatus
    const presentation = globalScope.HudTelemetryRoute?.getRoutePresentation?.(latestRouteStatus)
    if (!presentation) return

    telemetryStatus.dataset.state = presentation.tone === 'live'
      ? 'live'
      : ['waiting', 'stale'].includes(presentation.tone)
        ? 'connected'
        : 'offline'
    telemetryStatusLabel.textContent = presentation.statusLabel
    telemetryRouteCard.dataset.tone = presentation.tone
    telemetryRouteRetry.hidden = !presentation.canRetry
  }

  async function updateConfigurationAlwaysOnTop(alwaysOnTop, showStatus = true) {
    if (displayPreferencesPending || !displayPreferencesApi?.normalize || !displayPreferencesApi?.write) return
    const previous = displayPreferences
    const next = displayPreferencesApi.normalize({ ...previous, configurationAlwaysOnTop: alwaysOnTop })
    displayPreferences = next
    displayPreferencesApi.write(next)
    renderDisplayPreferences(next)
    setDisplayPreferencesPending(true)
    try {
      await call('set_configuration_always_on_top', { alwaysOnTop: next.configurationAlwaysOnTop })
      if (showStatus) setStatus(next.configurationAlwaysOnTop ? 'CONFIGURATION ALWAYS ON TOP' : 'CONFIGURATION CAN STAY BEHIND OTHER APPS')
    } catch (error) {
      displayPreferences = previous
      displayPreferencesApi.write(previous)
      renderDisplayPreferences(previous)
      setStatus(error.message || 'Unable to update Configuration priority', true)
    } finally {
      setDisplayPreferencesPending(false)
    }
  }

  async function retryDirectSource() {
    try {
      setStatus('RETRYING DIRECT DATA OUT')
      await call('retry_direct_source')
    } catch (error) {
      setStatus(error.message || 'Unable to retry Direct Data Out', true)
    }
  }

  function formatRpm(value) {
    return Number.isFinite(value) ? `${Math.round(value)} RPM` : '—'
  }

  function formatPower(value) {
    return Number.isFinite(value) ? `${Math.round(value / 1000)} kW` : '—'
  }

  function formatDiagnosticStatus(status) {
    return String(status || 'learning').replaceAll('-', ' ').toUpperCase()
  }

  function appendCellText(cell, primary, secondary = '') {
    cell.textContent = primary
    if (secondary) {
      const detail = document.createElement('span')
      detail.className = 'calibration-cell__sub'
      detail.textContent = secondary
      cell.append(detail)
    }
  }

  function renderShiftLightState(value) {
    const state = typeof normalizeShiftLightState === 'function'
      ? normalizeShiftLightState(value)
      : value
    latestShiftLightState = state
    const hasProfile = Boolean(state?.carKey && state?.carOrdinal)
    shiftLightEmpty.hidden = hasProfile
    shiftLightProfile.hidden = !hasProfile
    shiftLightReset.disabled = !hasProfile || shiftLightResetPending
    if (!hasProfile) return

    shiftLightCarKey.textContent = state.gameId === 'fh6' && state.carOrdinal
      ? `FH6 CAR #${state.carOrdinal}`
      : '—'
    shiftLightCarPi.textContent = state.pi ? `PI ${state.pi}` : '—'
    shiftLightCarRpmMax.textContent = state.rpmMax ? `${state.rpmMax} RPM` : '—'
    shiftLightCurrentTarget.textContent = state.shiftRpm ? `${state.shiftRpm} RPM` : 'FALLBACK'
    const activeState = state.method?.toUpperCase() || state.status.toUpperCase()
    shiftLightState.textContent = `${activeState}${state.currentGear ? ` · GEAR ${state.currentGear}` : ''}`
    shiftLightGearRows.replaceChildren()

    const diagnosticsByGear = new Map((state.diagnostics || []).map(diagnostic => [diagnostic.gear, diagnostic]))

    for (const gear of state.gears) {
      const diagnostic = diagnosticsByGear.get(gear.gear)
      const method = diagnostic?.method || gear.method
      const diagnosticStatus = diagnostic?.status || method || gear.status
      const row = document.createElement('tr')
      row.dataset.state = diagnosticStatus

      const gearCell = document.createElement('td')
      gearCell.textContent = `G${gear.gear}`
      row.append(gearCell)

      const targetCell = document.createElement('td')
      appendCellText(
        targetCell,
        formatRpm(diagnostic?.targetRpm ?? gear.shiftRpm),
        `AFTER ${formatRpm(diagnostic?.postShiftRpm)}`
      )
      row.append(targetCell)

      const powerCell = document.createElement('td')
      appendCellText(
        powerCell,
        `${formatPower(diagnostic?.powerAtTarget)} / ${formatPower(diagnostic?.powerAfterShift)}`,
        'CURRENT / NEXT'
      )
      row.append(powerCell)

      const dataCell = document.createElement('td')
      const coverage = diagnostic ? `${Math.round(diagnostic.powerCurveCoverage * 100)}%` : '—'
      const ratio = diagnostic
        ? `${diagnostic.currentRatioSamples}/${diagnostic.nextRatioSamples}`
        : '—'
      const peakPower = diagnostic ? formatRpm(diagnostic.peakPowerRpm) : '—'
      appendCellText(dataCell, `CURVE ${coverage}`, `PEAK ${peakPower} · RATIO ${ratio} · EVIDENCE ${diagnostic?.estimateEvidence || gear.sampleCount}`)
      row.append(dataCell)

      const stateCell = document.createElement('td')
      appendCellText(
        stateCell,
        method?.toUpperCase() || gear.status.toUpperCase(),
        formatDiagnosticStatus(diagnosticStatus)
      )
      row.append(stateCell)
      shiftLightGearRows.append(row)
    }

    if (!state.gears.length) {
      const row = document.createElement('tr')
      const cell = document.createElement('td')
      cell.colSpan = 5
      cell.textContent = 'NO GEAR SAMPLES YET'
      row.append(cell)
      shiftLightGearRows.append(row)
    }
  }

  function requestShiftLightReset() {
    if (shiftLightResetPending || !latestShiftLightState?.carKey) return
    const reset = globalScope.__TAURI_INTERNALS__?.invoke
    if (typeof reset !== 'function') {
      setStatus('TAURI COMMANDS ARE UNAVAILABLE', true)
      return
    }
    shiftLightResetPending = true
    shiftLightReset.disabled = true
    setStatus('RESETTING CALIBRATION')
    Promise.resolve(reset('reset_shift_light'))
      .catch(error => {
        shiftLightResetPending = false
        shiftLightReset.disabled = !latestShiftLightState?.carKey
        setStatus(error.message || 'Unable to reset calibration', true)
      })
  }

  function renderShiftLightResetResult(result) {
    shiftLightResetPending = false
    shiftLightReset.disabled = !latestShiftLightState?.carKey
    if (result?.ok === true) {
      setStatus('CALIBRATION RESET COMPLETE')
      return
    }
    setStatus(result?.message || 'Unable to reset calibration', true)
  }

  async function listenShiftLightEvents() {
    const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
    if (!eventApi || typeof eventApi.listen !== 'function') return
    await eventApi.listen('hud_shift_light', event => {
      renderShiftLightState(event.payload)
      shiftLightReset.disabled = !latestShiftLightState?.carKey || shiftLightResetPending
    })
    await eventApi.listen('hud_shift_light_reset_result', event => {
      renderShiftLightResetResult(event.payload)
    })
    await call('sync_shift_light_status')
  }

  async function listenRouteEvents() {
    const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
    if (!eventApi || typeof eventApi.listen !== 'function') return
    await eventApi.listen('hud_route_status', event => renderRouteStatus(event.payload))
    await call('sync_route_status')
  }

  function updateLayoutRows() {
    for (const row of document.querySelectorAll('[data-layout-target]')) {
      const target = row.dataset.layoutTarget
      const isEditing = editingTarget === target
      row.querySelector('[data-layout-action="edit"]').hidden = isEditing
      row.querySelector('[data-layout-action="save"]').hidden = !isEditing
      row.classList.toggle('is-editing', isEditing)
    }
  }

  async function selectLayoutTarget(target) {
    if (editingTarget === target) return
    if (editingTarget) {
      await call('layout_action', { action: 'cancel', target: editingTarget })
    }

    try {
      await call('layout_action', { action: 'edit', target })
      editingTarget = target
      updateLayoutRows()
      setStatus(`EDITING ${target.toUpperCase()} — DRAG IT IN THE HUD`)
    } catch (error) {
      setStatus(error.message || 'Unable to enter edit mode', true)
    }
  }

  async function saveLayoutTarget(target) {
    if (editingTarget !== target) return
    try {
      await call('layout_action', { action: 'save', target })
      editingTarget = null
      updateLayoutRows()
      setStatus('POSITION SAVED')
    } catch (error) {
      setStatus(error.message || 'Unable to save position', true)
    }
  }

  function cancelEdit() {
    editingTarget = null
    updateLayoutRows()
    setStatus('READY')
  }

  function setLayoutEditingState(target, isEditing) {
    if (!['coach', 'delta', 'hud'].includes(target)) return

    if (isEditing) {
      editingTarget = target
      updateLayoutRows()
      setStatus(`EDITING ${target.toUpperCase()} - DRAG IT IN THE HUD`)
      return
    }

    if (editingTarget === target) {
      editingTarget = null
      updateLayoutRows()
      setStatus('POSITION SAVED')
    }
  }

  for (const row of document.querySelectorAll('[data-layout-target]')) {
    const target = row.dataset.layoutTarget
    row.querySelector('[data-layout-action="edit"]').addEventListener('click', () => selectLayoutTarget(target))
    row.querySelector('[data-layout-action="save"]').addEventListener('click', () => saveLayoutTarget(target))
  }

  const overlayVisibility = readOverlayVisibility()
  for (const button of document.querySelectorAll('[data-overlay-toggle]')) {
    const component = button.dataset.overlayToggle
    const visible = overlayVisibility[component] !== false
    updateOverlayToggle(button, visible)
    button.addEventListener('click', async () => {
      const nextVisible = overlayVisibility[component] === false
      overlayVisibility[component] = nextVisible
      updateOverlayToggle(button, nextVisible)
      saveOverlayVisibility(overlayVisibility)
      try {
        await call('set_overlay_visibility', { component, visible: nextVisible })
        setStatus(`${component.toUpperCase()} ${nextVisible ? 'ENABLED' : 'HIDDEN'}`)
      } catch (error) {
        overlayVisibility[component] = !nextVisible
        updateOverlayToggle(button, !nextVisible)
        saveOverlayVisibility(overlayVisibility)
        setStatus(error.message || 'Unable to update overlay visibility', true)
      }
    })
  }

  const accordionToggle = document.querySelector('[data-accordion-toggle="hud"]')
  const accordionPanel = document.querySelector('[data-accordion-panel="hud"]')
  accordionToggle?.addEventListener('click', () => {
    const expanded = accordionToggle.getAttribute('aria-expanded') === 'true'
    accordionToggle.setAttribute('aria-expanded', String(!expanded))
    accordionPanel.hidden = expanded
  })

  for (const tab of settingsTabs) {
    tab.addEventListener('click', () => selectSettingsTab(tab.dataset.settingsTab))
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const currentIndex = settingsTabs.indexOf(tab)
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? settingsTabs.length - 1
          : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + settingsTabs.length) % settingsTabs.length
      const nextTab = settingsTabs[nextIndex]
      selectSettingsTab(nextTab.dataset.settingsTab)
      nextTab.focus()
    })
  }
  selectSettingsTab('hud')

  displayPreferences = displayPreferencesApi?.normalize?.(displayPreferences) || displayPreferences
  renderDisplayPreferences(displayPreferences)
  void updateConfigurationAlwaysOnTop(displayPreferences.configurationAlwaysOnTop, false)
  configurationAlwaysOnTop?.addEventListener('click', () => {
    void updateConfigurationAlwaysOnTop(displayPreferences.configurationAlwaysOnTop === false)
  })
  for (const input of speedUnitInputs) {
    input.addEventListener('change', () => {
      if (!input.checked) return
      void updateDisplayPreferences(
        { speedUnit: input.value },
        next => `SPEED UNIT SET TO ${next.speedUnit === 'mph' ? 'MPH' : 'KM/H'}`
      )
    })
  }
  shiftLightBrightness.addEventListener('input', () => {
    renderShiftLightBrightness(shiftLightBrightness.value)
  })
  shiftLightBrightness.addEventListener('change', () => {
    void updateDisplayPreferences(
      { shiftLightBrightness: Number(shiftLightBrightness.value) },
      next => `SHIFT LIGHT BRIGHTNESS SET TO ${next.shiftLightBrightness}%`
    )
  })

  shiftLightHelp?.addEventListener('click', () => {
    const expanded = shiftLightHelp.getAttribute('aria-expanded') === 'true'
    shiftLightHelp.setAttribute('aria-expanded', String(!expanded))
    if (shiftLightHelpPanel) shiftLightHelpPanel.hidden = expanded
  })

  const visibility = readVisibility()
  for (const input of document.querySelectorAll('[data-hud-component]')) {
    const component = input.dataset.hudComponent
    input.checked = visibility[component] !== false
    input.addEventListener('change', async () => {
      visibility[component] = input.checked
      saveVisibility(visibility)
      try {
        await call('set_hud_visibility', { component, visible: input.checked })
        setStatus(`${component.toUpperCase()} ${input.checked ? 'ENABLED' : 'HIDDEN'}`)
      } catch (error) {
        input.checked = !input.checked
        visibility[component] = input.checked
        saveVisibility(visibility)
        setStatus(error.message || 'Unable to update HUD visibility', true)
      }
    })
  }

  shiftLightReset.addEventListener('click', () => {
    requestShiftLightReset()
  })
  hudOpacity.addEventListener('input', () => {
    renderHudOpacity(hudOpacity.value)
  })
  hudOpacity.addEventListener('change', () => {
    void updateDisplayPreferences(
      { hudOpacity: Number(hudOpacity.value) },
      next => `HUD OPACITY SET TO ${next.hudOpacity}%`
    )
  })
  hudOpacityReset.addEventListener('click', () => {
    void updateDisplayPreferences(
      { hudOpacity: DEFAULT_HUD_OPACITY },
      next => `HUD OPACITY RESET TO ${next.hudOpacity}%`
    )
  })

  eventsCreateToggle?.addEventListener('click', () => setEventsCreateOpen(!eventsCreateOpen))
  eventsCreateCancel?.addEventListener('click', () => {
    resetEventCreateForm()
    setEventsCreateOpen(false)
  })
  eventsCreateForm?.addEventListener('submit', event => {
    event.preventDefault()
    void createEvent()
  })
  eventsDetailBack?.addEventListener('click', closeEventDetail)
  eventsDetailTitle?.addEventListener('click', beginEventRename)
  eventsDetailArchive?.addEventListener('click', () => void archiveCurrentEvent())
  eventsDetailDelete?.addEventListener('click', () => void deleteCurrentEvent())
  garageCurrentVariantsToggle?.addEventListener('click', toggleGarageVariants)
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    if (event.target?.classList?.contains('garage-current-car__input')
      || event.target?.classList?.contains('events-detail-view__title-input')) return
    if (eventsView === 'detail') {
      event.preventDefault()
      closeEventDetail()
      return
    }
    closeGarageVariants()
  })

  telemetryRouteRetry.addEventListener('click', () => {
    void retryDirectSource()
  })

  renderRouteStatus(latestRouteStatus)
  renderShiftLightState(null)
  renderGarage()
  renderEventsLibrary()
  void listenShiftLightEvents()
  void listenRouteEvents()
  void listenGarageEvents()
  globalScope.SettingsController = {
    cancelEdit,
    setLayoutEditingState,
    setRouteStatus: renderRouteStatus,
    resetShiftLight: requestShiftLightReset,
    loadEvents,
    openEventDetail,
    closeEventDetail
  }
})(typeof globalThis === 'undefined' ? this : globalThis)
