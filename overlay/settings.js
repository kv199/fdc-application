(function (globalScope) {
  'use strict'

  const VISIBILITY_STORAGE_KEY = 'fdc.hud-visibility.v1'
  const OVERLAY_VISIBILITY_STORAGE_KEY = 'fdc.overlay-visibility.v1'
  const EVENTS_SORT_STORAGE_KEY = 'fdc.events-sort.v1'
  const EVENT_SORT_OPTIONS = ['id-desc', 'id-asc', 'last-recorded-desc', 'last-recorded-asc']
  const COMPONENTS = ['tires', 'pedals', 'steering', 'gear', 'engine', 'history']
  const OVERLAY_COMPONENTS = ['coach', 'delta', 'hud']
  const DEFAULT_VISIBILITY = COMPONENTS.reduce((state, name) => {
    state[name] = true
    return state
  }, {})
  const invoke = globalScope.__TAURI_INTERNALS__?.invoke
  const appVersion = document.getElementById('app-version')
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
  const SETTINGS_WINDOW_CONTEXTS = Object.freeze({
    hud: 'HUD',
    garage: 'GARAGE',
    events: 'EVENTS',
    'shift-light': 'SHIFT LIGHT',
    settings: 'SETTINGS'
  })
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
  const eventsSort = document.getElementById('events-sort')
  const eventsCreateForm = document.getElementById('events-create-form')
  const eventName = document.getElementById('event-name')
  const eventClass = document.getElementById('event-class')
  const eventRouteType = document.getElementById('event-route-type')
  const eventMode = document.getElementById('event-mode')
  const eventNotes = document.getElementById('event-notes')
  const eventsDiscardDialog = document.getElementById('events-discard-dialog')
  const eventsDiscardYes = document.getElementById('events-discard-yes')
  const eventsDiscardNo = document.getElementById('events-discard-no')
  const eventsDetailBack = document.getElementById('events-detail-back')
  const eventsDetailTitle = document.getElementById('events-detail-title')
  const eventsDetailSummary = document.getElementById('events-detail-summary')
  const eventsDetailNotes = document.getElementById('events-detail-notes')
  const eventsDetailNotesValue = document.getElementById('events-detail-notes-value')
  const eventsDetailAbsoluteBest = document.getElementById('events-detail-absolute-best')
  const eventsDetailDelete = document.getElementById('events-detail-delete')
  const eventsRunView = document.getElementById('events-run-view')
  const eventsRunBack = document.getElementById('events-run-back')
  const eventsRunTitle = document.getElementById('events-run-title')
  const eventsRunSummary = document.getElementById('events-run-summary')
  const eventsRunBht = document.getElementById('events-run-bht')
  const eventsRunId = document.getElementById('events-run-id')
  const eventsRunTableHint = document.getElementById('events-run-table-hint')
  const eventsRunLapSort = document.getElementById('events-run-lap-sort')
  const eventsRunLaps = document.getElementById('events-run-laps')
  const eventsRunEmpty = document.getElementById('events-run-empty')
  const eventRecorderStatus = document.getElementById('event-recorder-status')
  const eventRecorderHint = document.getElementById('event-recorder-hint')
  const eventRecorderFeedback = document.getElementById('event-recorder-feedback')
  const eventRecorderToggle = document.getElementById('event-recorder-toggle')
  const eventRunsList = document.getElementById('event-runs-list')
  const eventRunSortButtons = [...document.querySelectorAll('[data-run-sort]')]
  const eventRunsEmpty = document.getElementById('event-runs-empty')
  const eventRunsCount = document.getElementById('event-runs-count')
  const eventsById = new Map()
  let currentEventRuns = []
  let currentEventRun = null
  let recorderState = { eventId: null, recording: false, state: 'stopped', lapCount: 0 }
  let eventsView = 'library'
  let currentEventId = null
  let eventsCreateOpen = false
  let eventsDiscardConfirmOpen = false
  let eventRunsSort = { key: 'date', direction: 'desc' }
  let eventRunLapSortDirection = 'desc'
  let expandedEventRunLap = null
  let eventsSortValue = 'id-desc'
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
    let runsChanged = false
    currentEventRuns = currentEventRuns.map(run => {
      const ordinal = Number(run?.car?.ordinal)
      if (!Number.isFinite(ordinal) || ordinal <= 0) return run
      const garageName = garageVehicles.get(Math.round(ordinal))?.name
      if (!garageName || run.car.name === garageName) return run
      runsChanged = true
      return { ...run, car: { ...run.car, name: garageName } }
    })
    if (runsChanged) renderEventRuns()
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

  async function listenEventRecorderEvents() {
    const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
    if (!eventApi || typeof eventApi.listen !== 'function') return
    await eventApi.listen('event_recorder_status', event => {
      const payload = event?.payload
      if (!payload || (currentEventId !== null && eventKey(payload.eventId) !== currentEventId)) return
      recorderState = {
        ...recorderState,
        eventId: eventKey(payload.eventId),
        recording: payload.recording === true,
        state: payload.state || (payload.recording ? 'recording' : 'stopped'),
        lapCount: Number(payload.lapCount) || 0
      }
      renderEventRecorder()
    })
    await eventApi.listen('event_recorder_run_saved', event => {
      const run = normalizeEventRun(event?.payload)
      if (!run || currentEventId === null || (run.eventId && run.eventId !== currentEventId)) return
      currentEventRuns = [run, ...currentEventRuns.filter(existing => existing.id !== run.id)]
      if (updateEventLastRecordedAt(run)) renderEventsLibrary()
      renderEventRuns()
    })
    await eventApi.listen('event_recorder_result', event => {
      const payload = event?.payload
      if (!payload || typeof payload !== 'object') return
      const resultEventId = eventKey(payload.eventId ?? payload.event_id ?? payload.run?.eventId ?? payload.run?.event_id)
      if (resultEventId !== null && currentEventId !== null && resultEventId !== currentEventId) return

      const outcome = eventText(payload.outcome).toLowerCase()
      if (outcome === 'saved') {
        const run = normalizeEventRun(payload.run ?? payload)
        if (run && updateEventLastRecordedAt(run)) renderEventsLibrary()
        const id = run?.id || runId(payload.runId ?? payload.run_id ?? payload.run?.runId ?? payload.run?.run_id)
        const details = []
        if (id) details.push(`ID ${id}`)
        if (run?.laps?.length) details.push(`${run.laps.length} ${run.laps.length === 1 ? 'LAP' : 'LAPS'}`)
        const savedTimeLabel = savedRunTimeLabel(run)
        if (savedTimeLabel) details.push(savedTimeLabel)
        const message = `RUN SAVED${details.length ? ` · ${details.join(' · ')}` : ''}`
        setEventRecorderFeedback(message, 'saved')
        setStatus(message)
      } else if (outcome === 'discarded') {
        const message = 'RUN DISCARDED — NO CONFIRMED RESULT'
        setEventRecorderFeedback(message, 'discarded')
        setStatus(message)
      } else if (outcome === 'failed') {
        const reason = eventText(payload.reason)
        const message = `RUN SAVE FAILED${reason ? ` — ${reason}` : ''}`
        setEventRecorderFeedback(message, 'failed')
        setStatus(message, true)
      }
    })
    await eventApi.emit('event_recorder_status_request')
  }

  function setEventRecorderFeedback(message, outcome = '') {
    if (!eventRecorderFeedback) return
    eventRecorderFeedback.textContent = message
    eventRecorderFeedback.dataset.outcome = outcome
    eventRecorderFeedback.hidden = !message
  }

  function clearEventRecorderFeedback() {
    setEventRecorderFeedback('', '')
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
      createdAt: source?.createdAt ?? source?.created_at ?? null,
      lastRecordedAt: source?.lastRecordedAt
        ?? source?.last_recorded_at
        ?? source?.lastRecordedRunAt
        ?? source?.last_recorded_run_at
        ?? null
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

  function readEventsSort() {
    try {
      const stored = JSON.parse(localStorage.getItem(EVENTS_SORT_STORAGE_KEY) || 'null')
      return EVENT_SORT_OPTIONS.includes(stored) ? stored : 'id-desc'
    } catch {
      return 'id-desc'
    }
  }

  function saveEventsSort(value) {
    try {
      localStorage.setItem(EVENTS_SORT_STORAGE_KEY, JSON.stringify(value))
    } catch {
      // A restricted webview may not expose persistent storage.
    }
  }

  function eventIdCompare(left, right) {
    const leftNumber = Number(left?.id)
    const rightNumber = Number(right?.id)
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber
    }
    return String(left?.id || '').localeCompare(String(right?.id || ''), undefined, { numeric: true })
  }

  function eventDateMs(event) {
    const value = event?.lastRecordedAt
    if (!value) return null
    const timestamp = new Date(value).getTime()
    return Number.isFinite(timestamp) ? timestamp : null
  }

  function compareEvents(left, right) {
    if (eventsSortValue === 'id-asc' || eventsSortValue === 'id-desc') {
      const result = eventIdCompare(left, right)
      return eventsSortValue === 'id-asc' ? result : -result
    }
    const leftDate = eventDateMs(left)
    const rightDate = eventDateMs(right)
    // Events without runs remain grouped at the end in either date direction.
    if (leftDate === null || rightDate === null) {
      if (leftDate === rightDate) return -eventIdCompare(left, right)
      return leftDate === null ? 1 : -1
    }
    if (leftDate !== rightDate) {
      const result = leftDate - rightDate
      return eventsSortValue === 'last-recorded-asc' ? result : -result
    }
    return -eventIdCompare(left, right)
  }

  function renderEventsSort() {
    if (eventsSort) eventsSort.value = eventsSortValue
  }

  function setEventsSort(value) {
    if (!EVENT_SORT_OPTIONS.includes(value)) return
    eventsSortValue = value
    saveEventsSort(value)
    renderEventsSort()
    renderEventsLibrary()
  }

  function renderEventCard(event) {
    const card = document.createElement('article')
    card.className = 'events-card'
    card.dataset.eventId = event.id
    card.dataset.eventMode = eventModeKey(event.mode)

    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'events-card__open'
    open.setAttribute('aria-label', `Open event ${event.name}`)
    open.addEventListener('click', () => void openEventDetail(event.id))

    const id = document.createElement('span')
    id.className = 'events-card__id'
    id.textContent = `#${event.id}`

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
    const eventClass = document.createElement('span')
    eventClass.className = 'events-card__badge events-card__badge--class'
    eventClass.dataset.eventClass = eventText(event.eventClass).toUpperCase() || 'ANY'
    eventClass.textContent = eventText(event.eventClass).toUpperCase() || 'ANY'
    meta.append(mode, route, eventClass)
    content.append(name, meta)

    open.append(id, content)
    card.append(open)
    return card
  }

  function renderEventsLibrary() {
    if (!eventsGrid) return
    eventsGrid.replaceChildren()
    const activeEvents = [...eventsById.values()]
      .sort(compareEvents)
    if (eventsGridEmpty) eventsGridEmpty.hidden = activeEvents.length > 0
    for (const event of activeEvents) eventsGrid.append(renderEventCard(event))
  }

  function updateEventLastRecordedAt(run) {
    const eventId = eventKey(run?.eventId)
    const event = eventId === null ? null : eventsById.get(eventId)
    const recordedAt = run?.recordedAt || run?.startedAt
    if (!event || !recordedAt) return false
    const current = eventDateMs(event)
    const next = new Date(recordedAt).getTime()
    if (!Number.isFinite(next) || (current !== null && next <= current)) return false
    event.lastRecordedAt = recordedAt
    eventsById.set(event.id, event)
    return true
  }

  function applyEventRunDates(runs) {
    for (const run of runs) updateEventLastRecordedAt(run)
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

  function eventCreateFormHasContent() {
    return [eventName, eventMode, eventRouteType, eventClass, eventNotes]
      .some(field => field?.value.trim())
  }

  function setEventsDiscardConfirmOpen(open) {
    eventsDiscardConfirmOpen = Boolean(open)
    if (eventsDiscardDialog) eventsDiscardDialog.hidden = !eventsDiscardConfirmOpen
    if (eventsDiscardConfirmOpen) eventsDiscardNo?.focus()
  }

  function closeEventsCreate() {
    setEventsDiscardConfirmOpen(false)
    resetEventCreateForm()
    setEventsCreateOpen(false)
    eventsCreateToggle?.focus()
  }

  function requestEventsCreateClose() {
    if (!eventsCreateOpen || eventsDiscardConfirmOpen) return
    if (eventCreateFormHasContent()) {
      setEventsDiscardConfirmOpen(true)
      return
    }
    closeEventsCreate()
  }

  function setEventsView(view) {
    eventsView = view
    if (eventsLibraryView) eventsLibraryView.hidden = view !== 'library'
    if (eventsDetailView) eventsDetailView.hidden = view !== 'detail'
    if (eventsRunView) eventsRunView.hidden = view !== 'run'
  }

  function renderEventDetail(event) {
    if (!event) return
    renderEventIdentity(eventsDetailTitle, eventsDetailSummary, event)
    if (eventsDetailNotes) eventsDetailNotes.hidden = !event.notes
    if (eventsDetailNotesValue) eventsDetailNotesValue.textContent = event.notes || ''
    renderEventAbsoluteBest()
    renderEventRecorder()
  }

  function runId(value) {
    if (value === null || value === undefined || value === '') return null
    return String(value)
  }

  function runTimeMs(value, unit = 'auto') {
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0) return null
    if (unit === 'ms') return Math.round(number)
    if (unit === 'seconds') return Math.round(number * 1000)
    return number < 1000 ? Math.round(number * 1000) : Math.round(number)
  }

  function finiteNumber(value) {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function normalizePedal(value) {
    const number = finiteNumber(value)
    if (number === null) return 0
    return Math.max(0, Math.min(1, number > 1 ? number / 100 : number))
  }

  function normalizeTracePoints(value) {
    const list = Array.isArray(value) ? value : []
    return list.map(point => {
      if (!point || typeof point !== 'object') return null
      const position = point.position && typeof point.position === 'object' ? point.position : point
      const positionX = finiteNumber(point.positionX ?? point.position_x ?? position.x)
      const positionY = finiteNumber(point.positionY ?? point.position_y ?? position.y)
      const positionZ = finiteNumber(point.positionZ ?? point.position_z ?? position.z)
      if (positionX === null || positionZ === null) return null
      return {
        elapsedMs: runTimeMs(point.elapsedMs ?? point.elapsed_ms ?? point.timeMs ?? point.time_ms, 'ms'),
        distanceM: finiteNumber(point.distanceM ?? point.distance_m ?? point.distance),
        positionX,
        positionY,
        positionZ,
        throttle: normalizePedal(point.throttle ?? point.throttleInput ?? point.throttle_input),
        brake: normalizePedal(point.brake ?? point.brakeInput ?? point.brake_input)
      }
    }).filter(Boolean)
  }

  function normalizeEventRun(value) {
    const source = value && typeof value === 'object' && value.run && typeof value.run === 'object' ? value.run : value
    if (!source || typeof source !== 'object') return null
    const id = runId(source.runId ?? source.run_id ?? source.id)
    if (!id) return null
    const laps = Array.isArray(source.laps)
      ? source.laps.map(lap => {
        const sectors = lap?.sectors && typeof lap.sectors === 'object' ? lap.sectors : null
        const valueFor = (keys, fallbackKeys = []) => {
          const value = keys.map(key => lap?.[key]).find(candidate => candidate !== undefined && candidate !== null)
            ?? fallbackKeys.map(key => sectors?.[key]).find(candidate => candidate !== undefined && candidate !== null)
          return value === undefined || value === null ? null : runTimeMs(value, 'ms')
        }
        const tracePoints = normalizeTracePoints(
          lap?.tracePoints ?? lap?.trace_points ?? lap?.trace ?? lap?.samples
        )
        return {
          lapNumber: Number(lap?.lapNumber ?? lap?.lap_number ?? lap?.number),
          timeMs: lap?.lapTimeMs !== undefined
            ? runTimeMs(lap.lapTimeMs, 'ms')
            : lap?.lap_time_ms !== undefined
              ? runTimeMs(lap.lap_time_ms, 'ms')
              : lap?.timeMs !== undefined
                ? runTimeMs(lap.timeMs, 'ms')
                : lap?.time_ms !== undefined
                  ? runTimeMs(lap.time_ms, 'ms')
                  : runTimeMs(lap?.time ?? lap?.seconds),
          sector1TimeMs: valueFor(['sector1TimeMs', 'sector_1_time_ms', 'sector1Ms', 'sector_1_ms', 's1TimeMs', 's1_time_ms'], ['sector1TimeMs', 'sector_1_time_ms', 'sector1Ms', 'sector_1_ms', 's1TimeMs', 's1_time_ms', 's1']),
          sector2TimeMs: valueFor(['sector2TimeMs', 'sector_2_time_ms', 'sector2Ms', 'sector_2_ms', 's2TimeMs', 's2_time_ms'], ['sector2TimeMs', 'sector_2_time_ms', 'sector2Ms', 'sector_2_ms', 's2TimeMs', 's2_time_ms', 's2']),
          sector3TimeMs: valueFor(['sector3TimeMs', 'sector_3_time_ms', 'sector3Ms', 'sector_3_ms', 's3TimeMs', 's3_time_ms'], ['sector3TimeMs', 'sector_3_time_ms', 'sector3Ms', 'sector_3_ms', 's3TimeMs', 's3_time_ms', 's3']),
          tracePoints
        }
      }).filter(lap => Number.isFinite(lap.lapNumber) && lap.timeMs !== null)
      : []
    const car = source.car && typeof source.car === 'object' ? source.car : source
    const finalTimeMs = source.resultTimeMs !== undefined
      ? runTimeMs(source.resultTimeMs, 'ms')
      : source.result_time_ms !== undefined
        ? runTimeMs(source.result_time_ms, 'ms')
        : source.finalTimeMs !== undefined
          ? runTimeMs(source.finalTimeMs, 'ms')
          : source.final_time_ms !== undefined
            ? runTimeMs(source.final_time_ms, 'ms')
            : runTimeMs(source.finalTime ?? source.final_time)
    const runType = eventText(source.runType ?? source.run_type).toLowerCase() || (laps.length ? 'circuit' : 'sprint')
    const normalizedLaps = laps.length || finalTimeMs === null
      ? laps
      : [{
        lapNumber: 1,
        timeMs: finalTimeMs,
        sector1TimeMs: runTimeMs(source.sector1TimeMs ?? source.sector_1_time_ms ?? source.s1TimeMs ?? source.s1_time_ms, 'ms'),
        sector2TimeMs: runTimeMs(source.sector2TimeMs ?? source.sector_2_time_ms ?? source.s2TimeMs ?? source.s2_time_ms, 'ms'),
        sector3TimeMs: runTimeMs(source.sector3TimeMs ?? source.sector_3_time_ms ?? source.s3TimeMs ?? source.s3_time_ms, 'ms'),
        tracePoints: normalizeTracePoints(source.tracePoints ?? source.trace_points ?? source.trace)
      }]
    return {
      id,
      eventId: eventKey(source.eventId ?? source.event_id),
      startedAt: source.startedAt ?? source.started_at ?? source.createdAt ?? source.created_at ?? null,
      recordedAt: source.createdAt ?? source.created_at ?? source.recordedAt ?? source.recorded_at ?? source.startedAt ?? source.started_at ?? null,
      finalTimeMs,
      runType,
      result: eventText(source.result).toLowerCase() || 'completed',
      laps: normalizedLaps,
      car: {
        name: eventText(car.name ?? car.displayName ?? car.carName ?? source.carName),
        ordinal: car.ordinal ?? car.carOrdinal ?? car.car_ordinal ?? source.carOrdinal ?? source.car_ordinal ?? null,
        class: eventText(car.class ?? car.classLabel ?? car.carClass ?? source.carClass)
          || garageApi?.classLabel?.(car.class ?? car.classLabel ?? car.carClass ?? source.carClass)
          || null,
        pi: car.pi ?? car.performanceIndex ?? source.carPi ?? source.car_pi ?? null,
        drivetrain: eventText(car.drivetrainLabel ?? car.drivetrain ?? car.drivetrainType)
          || garageApi?.drivetrainLabel?.(car.drivetrain ?? car.drivetrainType ?? source.drivetrain)
          || null
      }
    }
  }

  function normalizeEventRunsPayload(value) {
    const list = Array.isArray(value) ? value : value?.runs ?? value?.items ?? value?.records
    return Array.isArray(list) ? list.map(normalizeEventRun).filter(Boolean) : []
  }

  function formatRunTime(timeMs) {
    if (!Number.isFinite(timeMs)) return '—'
    const totalSeconds = timeMs / 1000
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
    const seconds = (totalSeconds - minutes * 60).toFixed(3).padStart(6, '0')
    return `${minutes}:${seconds}`
  }

  function latestPersistedLap(run) {
    return (run?.laps || []).reduce((latest, lap) => {
      const lapNumber = Number(lap?.lapNumber)
      if (!Number.isFinite(lapNumber) || !Number.isFinite(lap?.timeMs)) return latest
      return !latest || lapNumber > latest.lapNumber ? lap : latest
    }, null)
  }

  function savedRunTimeLabel(run) {
    if (run?.runType === 'sprint') {
      return Number.isFinite(run.finalTimeMs) ? `RESULT ${formatRunTime(run.finalTimeMs)}` : null
    }
    const lap = latestPersistedLap(run)
    return Number.isFinite(lap?.timeMs) ? `LAST ${formatRunTime(lap.timeMs)}` : null
  }

  function formatRunDate(value) {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value)
    const pad = number => String(number).padStart(2, '0')
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  function renderEventIdentity(titleElement, summaryElement, event) {
    if (!event) return
    if (titleElement) titleElement.textContent = event.name
    if (!summaryElement) return
    summaryElement.replaceChildren()
    summaryElement.dataset.eventId = event.id
    summaryElement.dataset.eventMode = eventModeKey(event.mode)
    const id = document.createElement('span')
    id.className = 'events-detail-view__badge events-detail-view__badge--id'
    id.textContent = `#${event.id}`
    const mode = document.createElement('span')
    mode.className = 'events-detail-view__badge events-detail-view__badge--mode'
    mode.textContent = eventModeLabel(event.mode)
    const route = document.createElement('span')
    route.className = 'events-detail-view__badge'
    route.textContent = eventRouteLabel(event.routeType)
    const eventClass = document.createElement('span')
    eventClass.className = 'events-detail-view__badge events-detail-view__badge--class'
    eventClass.dataset.eventClass = eventText(event.eventClass).toUpperCase() || 'Any'
    eventClass.textContent = eventText(event.eventClass).toUpperCase() || 'ANY'
    summaryElement.append(id, mode, route, eventClass)
  }

  function runCarName(run) {
    return run.car.name || (run.car.ordinal ? `CAR #${run.car.ordinal}` : 'UNKNOWN CAR')
  }

  function runBestTimeMs(run) {
    if (run?.runType === 'sprint') return run.finalTimeMs
    return run?.laps?.reduce((best, lap) => !best || lap.timeMs < best ? lap.timeMs : best, null)
  }

  function eventAbsoluteBestTimeMs(runs = currentEventRuns) {
    return runs.reduce((best, run) => {
      const time = runBestTimeMs(run)
      return Number.isFinite(time) && (best === null || time < best) ? time : best
    }, null)
  }

  function renderEventAbsoluteBest() {
    if (!eventsDetailAbsoluteBest) return
    eventsDetailAbsoluteBest.textContent = formatRunTime(eventAbsoluteBestTimeMs())
  }

  function distinctTimeRanks(values) {
    const valid = values.filter(value => Number.isFinite(value)).sort((left, right) => left - right)
    const fastest = valid[0] ?? null
    const second = valid.find(value => value > fastest) ?? null
    return { fastest, second }
  }

  function timeTone(value, ranks) {
    if (!Number.isFinite(value)) return ''
    if (value === ranks.fastest) return 'best'
    if (value === ranks.second) return 'second'
    return ''
  }

  function runSectorBestTimes(run) {
    const laps = run?.laps || []
    return [0, 1, 2].map(index => {
      const values = laps.map(lap => lap?.[`sector${index + 1}TimeMs`]).filter(value => Number.isFinite(value))
      return distinctTimeRanks(values).fastest
    })
  }

  function runBestHypotheticalTimeMs(run) {
    const best = runSectorBestTimes(run)
    return best.every(value => Number.isFinite(value)) ? best.reduce((sum, value) => sum + value, 0) : null
  }

  function runDateMs(run) {
    if (!run?.startedAt) return null
    const timestamp = new Date(run.startedAt).getTime()
    return Number.isFinite(timestamp) ? timestamp : null
  }

  function runIdCompare(left, right) {
    const leftNumber = Number(left?.id)
    const rightNumber = Number(right?.id)
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber
    }
    return String(left?.id || '').localeCompare(String(right?.id || ''), undefined, { numeric: true })
  }

  function compareEventRuns(left, right) {
    const key = eventRunsSort.key
    if (key === 'id') {
      const result = runIdCompare(left, right)
      return eventRunsSort.direction === 'asc' ? result : -result
    }
    const leftValue = key === 'best' ? runBestTimeMs(left) : runDateMs(left)
    const rightValue = key === 'best' ? runBestTimeMs(right) : runDateMs(right)
    // Runs missing the selected value remain grouped at the end in either direction.
    if (leftValue === null || rightValue === null || leftValue === undefined || rightValue === undefined) {
      if (leftValue === rightValue) return -runIdCompare(left, right)
      return leftValue === null || leftValue === undefined ? 1 : -1
    }
    if (leftValue !== rightValue) {
      const result = leftValue - rightValue
      return eventRunsSort.direction === 'asc' ? result : -result
    }
    return -runIdCompare(left, right)
  }

  function setEventRunsSort(key) {
    if (!['id', 'best', 'date'].includes(key)) return
    const direction = eventRunsSort.key === key
      ? eventRunsSort.direction === 'asc' ? 'desc' : 'asc'
      : key === 'date' ? 'desc' : 'asc'
    eventRunsSort = { key, direction }
    renderEventRuns()
  }

  function updateEventRunSortButtons() {
    for (const button of eventRunSortButtons) {
      const active = button.dataset.runSort === eventRunsSort.key
      button.setAttribute('aria-sort', active
        ? eventRunsSort.direction === 'asc' ? 'ascending' : 'descending'
        : 'none')
      button.setAttribute('aria-label', `Sort saved runs by ${button.textContent}`)
    }
  }

  function renderEventRuns() {
    if (!eventRunsList) return
    eventRunsList.replaceChildren()
    renderEventAbsoluteBest()
    updateEventRunSortButtons()
    const runs = [...currentEventRuns].sort(compareEventRuns)
    if (eventRunsEmpty) eventRunsEmpty.hidden = runs.length > 0
    if (eventRunsCount) eventRunsCount.textContent = `${runs.length} ${runs.length === 1 ? 'RUN' : 'RUNS'}`
    for (const run of runs) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'event-run-row'
      row.setAttribute('aria-label', `Open run ${run.id}`)
      row.addEventListener('click', () => openEventRun(run.id))
      const carDetails = [run.car.class, run.car.pi ? `PI ${run.car.pi}` : '', run.car.drivetrain].filter(Boolean).join(' · ') || '—'
      const bestLap = run.runType !== 'sprint'
        ? run.laps.reduce((best, lap) => !best || lap.timeMs < best.timeMs ? lap : best, null)
        : null
      const cells = [
        ['ID', run.id],
        ['CAR', runCarName(run)],
        ['CLASS / PI / DRIVE', carDetails],
        [bestLap ? `BEST L${Math.max(1, Math.round(bestLap.lapNumber))}` : 'SPRINT', formatRunTime(runBestTimeMs(run))],
        ['DATE', formatRunDate(run.startedAt)]
      ]
      for (const [label, value] of cells) {
        const cell = document.createElement('div')
        cell.className = 'event-run-row__cell'
        const labelElement = document.createElement('span')
        labelElement.className = 'event-run-row__label'
        labelElement.textContent = label
        const valueElement = document.createElement('span')
        valueElement.className = `event-run-row__value${label.startsWith('BEST') || label === 'SPRINT' ? ' event-run-row__time' : ''}`
        valueElement.textContent = value
        cell.append(labelElement, valueElement)
        row.append(cell)
      }
      eventRunsList.append(row)
    }
  }

  function renderRunTimeCell(timeMs, ranks) {
    const value = document.createElement('span')
    value.className = 'events-run-table__time'
    if (!Number.isFinite(timeMs)) value.classList.add('is-missing')
    const tone = timeTone(timeMs, ranks)
    if (tone) value.dataset.tone = tone
    value.textContent = formatRunTime(timeMs)
    return value
  }

  const TRACE_COLORS = {
    throttle: '#69e83f',
    brake: '#ef4444',
    coast: '#facc15'
  }

  function traceState(point) {
    // Braking wins when both pedals are pressed, matching the HUD's safety-first
    // interpretation of overlapping inputs.
    if (normalizePedal(point?.brake) >= 0.05) return 'brake'
    if (normalizePedal(point?.throttle) >= 0.05) return 'throttle'
    return 'coast'
  }

  function traceStats(points, lapTimeMs = null) {
    const totals = { throttle: 0, brake: 0, coast: 0 }
    const firstElapsed = finiteNumber(points[0]?.elapsedMs)
    if (Number.isFinite(firstElapsed) && firstElapsed > 0) {
      totals[traceState(points[0])] += firstElapsed
    }
    for (let index = 0; index < points.length - 1; index += 1) {
      const elapsed = finiteNumber(points[index + 1]?.elapsedMs) - finiteNumber(points[index]?.elapsedMs)
      if (!Number.isFinite(elapsed) || elapsed <= 0) continue
      totals[traceState(points[index])] += elapsed
    }
    const lastElapsed = finiteNumber(points.at(-1)?.elapsedMs)
    const remaining = Number.isFinite(lapTimeMs) && Number.isFinite(lastElapsed)
      ? Math.max(0, lapTimeMs - lastElapsed)
      : 0
    if (remaining > 0 && points.length) totals[traceState(points.at(-1))] += remaining
    const total = Object.values(totals).reduce((sum, value) => sum + value, 0)
    if (total <= 0) return null
    const exact = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value / total * 100]))
    const rounded = Object.fromEntries(Object.entries(exact).map(([key, value]) => [key, Math.floor(value)]))
    let remainder = 100 - Object.values(rounded).reduce((sum, value) => sum + value, 0)
    for (const [key] of Object.entries(exact).sort((left, right) => right[1] - Math.floor(right[1]) - (left[1] - Math.floor(left[1])))) {
      if (remainder <= 0) break
      rounded[key] += 1
      remainder -= 1
    }
    return rounded
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name)
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
    return element
  }

  function traceSectorTicks(points, minDistance, maxDistance, project, minX, maxX, minZ, maxZ) {
    const ticks = []
    const distanceRange = maxDistance - minDistance
    if (!(distanceRange > 0)) return ticks
    for (let sector = 1; sector <= 3; sector += 1) {
      const target = minDistance + distanceRange * sector / 3
      let nearest = null
      for (const point of points) {
        if (point.distanceM === null) continue
        const delta = Math.abs(point.distanceM - target)
        if (!nearest || delta < nearest.delta) nearest = { point, delta }
      }
      if (!nearest) continue
      const pointIndex = points.indexOf(nearest.point)
      const previous = points[Math.max(0, pointIndex - 1)] || nearest.point
      const next = points[Math.min(points.length - 1, pointIndex + 1)] || nearest.point
      const current = project(nearest.point)
      const dx = project(next).x - project(previous).x
      const dz = project(next).y - project(previous).y
      const length = Math.hypot(dx, dz) || 1
      const normalX = -dz / length * 8
      const normalY = dx / length * 8
      ticks.push({
        x1: current.x - normalX,
        y1: current.y - normalY,
        x2: current.x + normalX,
        y2: current.y + normalY,
        label: `S${sector}`
      })
    }
    return ticks
  }

  function renderTraceMap(points) {
    const map = document.createElement('div')
    map.className = 'events-lap-detail__map'
    if (points.length < 2) {
      const empty = document.createElement('p')
      empty.className = 'events-lap-detail__empty'
      empty.textContent = 'NO TRACE DATA SAVED FOR THIS LAP'
      map.append(empty)
      return map
    }
    const coordinates = points.map(point => ({ x: point.positionX, z: point.positionZ }))
    const minX = Math.min(...coordinates.map(point => point.x))
    const maxX = Math.max(...coordinates.map(point => point.x))
    const minZ = Math.min(...coordinates.map(point => point.z))
    const maxZ = Math.max(...coordinates.map(point => point.z))
    const width = 720
    const height = 380
    const padding = 30
    const scale = Math.min(
      (width - padding * 2) / Math.max(1, maxX - minX),
      (height - padding * 2) / Math.max(1, maxZ - minZ)
    )
    const project = point => ({
      x: padding + (point.positionX - minX) * scale,
      y: height - padding - (point.positionZ - minZ) * scale
    })
    const svg = svgElement('svg', {
      class: 'events-lap-detail__svg',
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': 'Throttle, brake and coast trace map'
    })
    svg.append(svgElement('rect', { class: 'events-lap-detail__surface', x: 0, y: 0, width, height, rx: 2 }))
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = project(points[index])
      const to = project(points[index + 1])
      svg.append(svgElement('line', {
        class: `events-lap-detail__trace events-lap-detail__trace--${traceState(points[index])}`,
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y
      }))
    }
    const distances = points.map(point => point.distanceM).filter(value => value !== null)
    const minDistance = distances.length ? Math.min(...distances) : 0
    const maxDistance = distances.length ? Math.max(...distances) : 0
    for (const tick of traceSectorTicks(points, minDistance, maxDistance, project, minX, maxX, minZ, maxZ)) {
      svg.append(svgElement('line', {
        class: 'events-lap-detail__sector-tick',
        x1: tick.x1,
        y1: tick.y1,
        x2: tick.x2,
        y2: tick.y2
      }))
      const label = svgElement('text', { class: 'events-lap-detail__sector-label', x: tick.x2 + 5, y: tick.y2 - 4 })
      label.textContent = tick.label
      svg.append(label)
    }
    const start = project(points[0])
    svg.append(svgElement('circle', { class: 'events-lap-detail__start', cx: start.x, cy: start.y, r: 3 }))
    map.append(svg)
    return map
  }

  function renderTraceStats(points, lapTimeMs) {
    const stats = document.createElement('aside')
    stats.className = 'events-lap-detail__stats'
    const heading = document.createElement('div')
    heading.className = 'events-lap-detail__label'
    heading.textContent = 'INPUT TIME'
    stats.append(heading)
    const values = traceStats(points, lapTimeMs)
    if (!values) {
      const empty = document.createElement('p')
      empty.className = 'events-lap-detail__empty'
      empty.textContent = 'STATISTICS UNAVAILABLE'
      stats.append(empty)
      return stats
    }
    const labels = [
      ['throttle', 'THROTTLE'],
      ['brake', 'BRAKE'],
      ['coast', 'COAST']
    ]
    for (const [key, label] of labels) {
      const row = document.createElement('div')
      row.className = `events-lap-detail__stat events-lap-detail__stat--${key}`
      const name = document.createElement('span')
      name.className = 'events-lap-detail__stat-name'
      name.textContent = label
      const value = document.createElement('output')
      value.className = 'events-lap-detail__stat-value'
      value.textContent = `${values[key]}%`
      row.append(name, value)
      stats.append(row)
    }
    return stats
  }

  function toggleEventRunLap(lapNumber, row) {
    const key = Number(lapNumber)
    expandedEventRunLap = expandedEventRunLap === key ? null : key
    if (eventsRunLaps) renderEventRunDetail(currentEventRun)
    if (expandedEventRunLap !== null) row?.nextElementSibling?.scrollIntoView?.({ block: 'nearest' })
  }

  function renderEventRunDetail(run) {
    if (!run) return
    const event = currentEventId === null ? null : eventsById.get(currentEventId)
    if (!event) return
    renderEventIdentity(eventsRunTitle, eventsRunSummary, event)
    if (eventsRunId) eventsRunId.textContent = `#${run.id}`
    if (eventsRunBht) eventsRunBht.textContent = formatRunTime(runBestHypotheticalTimeMs(run))
    if (eventsRunTableHint) {
      eventsRunTableHint.textContent = run.runType === 'sprint' ? 'SPRINT · ONE PASS' : 'SECTOR TIMES'
    }
    const laps = [...(run.laps || [])].sort((left, right) => {
      const result = Number(left.lapNumber) - Number(right.lapNumber)
      return eventRunLapSortDirection === 'asc' ? result : -result
    })
    const lapRanks = distinctTimeRanks(laps.map(lap => lap.timeMs))
    const sectorRanks = [0, 1, 2].map(index => distinctTimeRanks(laps.map(lap => lap[`sector${index + 1}TimeMs`])))
    if (eventsRunLapSort) {
      eventsRunLapSort.setAttribute('aria-sort', eventRunLapSortDirection === 'asc' ? 'ascending' : 'descending')
    }
    if (eventsRunLaps) {
      eventsRunLaps.replaceChildren()
      for (const lap of laps) {
        const row = document.createElement('tr')
        const lapNumberValue = Number(lap.lapNumber)
        const expanded = expandedEventRunLap === lapNumberValue
        row.className = 'events-run-table__lap-row'
        row.tabIndex = 0
        row.setAttribute('aria-expanded', String(expanded))
        row.setAttribute('aria-label', `Lap ${Number.isFinite(lapNumberValue) ? lapNumberValue : 'unknown'} details`)
        row.addEventListener('click', () => toggleEventRunLap(lapNumberValue, row))
        row.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          toggleEventRunLap(lapNumberValue, row)
        })
        const lapNumber = document.createElement('th')
        lapNumber.scope = 'row'
        lapNumber.textContent = Number.isFinite(lap.lapNumber) ? String(Math.round(lap.lapNumber)) : '—'
        const lapTime = document.createElement('td')
        lapTime.append(renderRunTimeCell(lap.timeMs, lapRanks))
        row.append(lapNumber, lapTime)
        for (let index = 0; index < 3; index += 1) {
          const sector = document.createElement('td')
          sector.append(renderRunTimeCell(lap[`sector${index + 1}TimeMs`], sectorRanks[index]))
          row.append(sector)
        }
        eventsRunLaps.append(row)
        if (expanded) {
          const detailRow = document.createElement('tr')
          detailRow.className = 'events-lap-detail-row'
          const detailCell = document.createElement('td')
          detailCell.colSpan = 5
          const detail = document.createElement('div')
          detail.className = 'events-lap-detail'
          detail.append(renderTraceMap(lap.tracePoints || []), renderTraceStats(lap.tracePoints || [], lap.timeMs))
          detailCell.append(detail)
          detailRow.append(detailCell)
          eventsRunLaps.append(detailRow)
        }
      }
    }
    if (eventsRunEmpty) eventsRunEmpty.hidden = laps.length > 0
  }

  async function openEventRun(id) {
    if (currentEventId === null) return false
    const key = runId(id)
    const run = currentEventRuns.find(candidate => candidate.id === key)
    if (!run) return false
    currentEventRun = run
    expandedEventRunLap = null
    eventRunLapSortDirection = 'desc'
    renderEventRunDetail(run)
    setEventsView('run')
    eventsRunBack?.focus()
    try {
      const nativeRunId = Number.isFinite(Number(key)) ? Math.round(Number(key)) : key
      const loaded = normalizeEventRun(await call('load_event_run', { runId: nativeRunId }))
      if (loaded && loaded.id === key && eventsView === 'run' && currentEventRun?.id === key) {
        currentEventRun = loaded
        currentEventRuns = currentEventRuns.map(candidate => candidate.id === key ? loaded : candidate)
        renderEventRunDetail(loaded)
      }
    } catch {
      // The list payload remains usable; trace details simply stay unavailable.
    }
    return true
  }

  function closeEventRun() {
    currentEventRun = null
    expandedEventRunLap = null
    if (eventsRunSummary) {
      eventsRunSummary.replaceChildren()
      delete eventsRunSummary.dataset.eventId
      delete eventsRunSummary.dataset.eventMode
    }
    if (eventsRunLaps) eventsRunLaps.replaceChildren()
    setEventsView(currentEventId === null ? 'library' : 'detail')
    if (currentEventId === null) renderEventsLibrary()
    else {
      const event = eventsById.get(currentEventId)
      if (event) renderEventDetail(event)
      eventsDetailBack?.focus()
    }
  }

  function renderEventRecorder() {
    const event = currentEventId === null ? null : eventsById.get(currentEventId)
    const isSelected = Boolean(event && recorderState.eventId === event.id)
    const recording = isSelected && recorderState.recording === true
    const recordingAnotherEvent = Boolean(recorderState.recording && !isSelected)
    const state = isSelected ? recorderState.state || (recording ? 'recording' : 'stopped') : 'stopped'
    const finalizing = isSelected && state === 'finalizing'
    if (eventRecorderStatus) {
      eventRecorderStatus.dataset.state = state
      eventRecorderStatus.textContent = state.toUpperCase()
      eventRecorderStatus.hidden = !recording && !finalizing
    }
    if (eventRecorderToggle) {
      eventRecorderToggle.textContent = finalizing ? 'FINALIZING' : recording ? 'STOP' : 'RECORD RUN'
      eventRecorderToggle.classList.toggle('settings-button--danger', recording)
      eventRecorderToggle.classList.toggle('event-recorder__record', !recording && !finalizing)
      eventRecorderToggle.setAttribute('aria-pressed', String(recording))
      eventRecorderToggle.disabled = recordingAnotherEvent || finalizing
    }
    if (eventRecorderHint) {
      const sprintWarning = 'For Sprint Racing, press STOP in free roam or before starting a new race. The results screen can report an imprecise final time.'
      const hint = recordingAnotherEvent
        ? `Recording Event #${recorderState.eventId}. Open that event to stop capture.`
        : finalizing
          ? 'Checking post-finish telemetry for the official result.'
          : sprintWarning
      eventRecorderHint.textContent = hint
      eventRecorderHint.dataset.tone = !recordingAnotherEvent && !finalizing ? 'warning' : ''
    }
    renderEventRuns()
  }

  async function loadEventRuns(eventId = currentEventId) {
    const key = eventKey(eventId)
    if (!key) return false
    try {
      const nativeEventId = Number.isFinite(Number(key)) ? Math.round(Number(key)) : key
      currentEventRuns = normalizeEventRunsPayload(await call('load_event_runs', { eventId: nativeEventId }))
      if (currentEventRuns.some(updateEventLastRecordedAt)) renderEventsLibrary()
      renderEventRuns()
      if (eventsView === 'run' && currentEventRun) {
        const refreshed = currentEventRuns.find(run => run.id === currentEventRun.id)
        if (refreshed) {
          currentEventRun = refreshed
          renderEventRunDetail(refreshed)
        }
      }
      return true
    } catch (error) {
      currentEventRuns = []
      renderEventRuns()
      setStatus(error.message || 'Unable to load event runs', true)
      return false
    }
  }

  async function sendRecorderConfig(action) {
    const event = currentEventId === null ? null : eventsById.get(currentEventId)
    const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
    if (!event || !eventApi || typeof eventApi.emit !== 'function') {
      setStatus('EVENT RECORDER IS UNAVAILABLE', true)
      return false
    }
    try {
      if (action === 'record') clearEventRecorderFeedback()
      await eventApi.emit('event_recorder_config', {
        action,
        eventId: event.id,
        eventName: event.name,
        armedAt: action === 'record' ? Date.now() : undefined
      })
      recorderState = { ...recorderState, eventId: event.id, recording: action === 'record', state: action === 'record' ? 'armed' : 'stopped' }
      renderEventRecorder()
      setStatus(action === 'record' ? 'EVENT RECORDING ARMED' : 'EVENT RECORDING STOPPED')
      return true
    } catch (error) {
      setStatus(error.message || 'Unable to update event recorder', true)
      return false
    }
  }

  async function loadEvents() {
    try {
      const result = await call('load_events')
      eventsById.clear()
      for (const event of normalizeEventsPayload(result)) eventsById.set(event.id, event)
      // The Events command intentionally returns event metadata only. Reuse the
      // existing run list command to derive the latest recorded date for sorting.
      try {
        applyEventRunDates(normalizeEventRunsPayload(await call('load_event_runs', { eventId: null })))
      } catch {
        // Sorting by ID remains available if run metadata cannot be loaded.
      }
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
    if (!event) return false
    currentEventId = event.id
    currentEventRun = null
    clearEventRecorderFeedback()
    setEventsCreateOpen(false)
    renderEventDetail(event)
    setEventsView('detail')
    eventsDetailBack?.focus()
    void loadEventRuns(event.id)
    return true
  }

  function closeEventDetail() {
    if (eventsView === 'run') {
      closeEventRun()
      return
    }
    currentEventId = null
    if (eventsDetailSummary) {
      eventsDetailSummary.replaceChildren()
      delete eventsDetailSummary.dataset.eventId
      delete eventsDetailSummary.dataset.eventMode
    }
    if (eventsDetailNotes) eventsDetailNotes.hidden = true
    if (eventsDetailNotesValue) eventsDetailNotesValue.textContent = ''
    currentEventRuns = []
    currentEventRun = null
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
      currentEventId = event.id
      renderEventDetail(event)
      setEventsView('detail')
      eventsDetailBack?.focus()
      void loadEventRuns(event.id)
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
    updateSettingsWindowContext(tabName)
    if (tabName === 'events' && eventsView === 'library') void loadEvents()
  }

  function updateSettingsWindowContext(tabName) {
    const context = SETTINGS_WINDOW_CONTEXTS[tabName]
    if (!context) return
    document.title = `FDC · ${context}`
    void call('set_settings_window_context', { context: tabName }).catch(() => undefined)
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

  async function loadAppVersion() {
    if (!appVersion) return
    try {
      const version = await call('get_app_version')
      if (typeof version !== 'string' || !version.trim()) return
      const normalizedVersion = version.trim().replace(/^v/u, '')
      appVersion.textContent = `v${normalizedVersion}`
    } catch {
      // Preserve the unavailable-version fallback when the native command is unavailable.
    }
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
    const fallbackShiftRpm = state.fallbackShiftRpm ?? (state.rpmMax ? Math.round(state.rpmMax * 0.98) : null)
    shiftLightCurrentTarget.textContent = state.shiftRpm
      ? `${state.status === 'learning' ? 'PROVISIONAL · ' : ''}${state.shiftRpm} RPM`
      : fallbackShiftRpm ? `FALLBACK · SHIFT AT ${fallbackShiftRpm} RPM` : 'FALLBACK'
    const activeState = state.method === 'optimal' && state.gearboxValidation === 'validating'
      ? 'OPTIMAL · VALIDATING'
      : state.method === 'optimal' && state.gearboxValidation === 'checking'
        ? 'OPTIMAL · GEARBOX CHECK'
        : state.gearboxChanged
          ? 'NEW GEARBOX · LEARNING'
          : state.status === 'learning' && state.shiftRpm
            ? `LEARNING · ${Math.min(5, state.sampleCount)}/5`
            : state.method?.toUpperCase() || state.status.toUpperCase()
    shiftLightState.textContent = `${activeState}${state.currentGear ? ` · GEAR ${state.currentGear}` : ''}`
    shiftLightGearRows.replaceChildren()

    const diagnosticsByGear = new Map((state.diagnostics || []).map(diagnostic => [diagnostic.gear, diagnostic]))

    for (const gear of state.gears) {
      const diagnostic = diagnosticsByGear.get(gear.gear)
      const method = diagnostic?.method || gear.method
      const diagnosticStatus = diagnostic?.status === 'gearbox-mismatch'
        ? 'learning'
        : diagnostic?.status || method || gear.status
      const row = document.createElement('tr')
      row.dataset.state = diagnosticStatus

      const gearCell = document.createElement('td')
      gearCell.textContent = `G${gear.gear}`
      row.append(gearCell)

      const targetCell = document.createElement('td')
      const provisional = gear.status === 'learning' && gear.shiftRpm !== null
      appendCellText(
        targetCell,
        formatRpm(provisional ? gear.shiftRpm : diagnostic?.targetRpm ?? gear.shiftRpm),
        provisional
          ? `PROVISIONAL · ${Math.min(5, gear.sampleCount)}/5`
          : `AFTER ${formatRpm(diagnostic?.postShiftRpm)}`
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
        provisional
          ? 'LEARNING'
          : diagnosticStatus === 'learning' ? 'LEARNING' : method?.toUpperCase() || gear.status.toUpperCase(),
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
      setStatus(target === 'hud'
        ? 'EDITING HUD — DRAG IT OR A CORNER TO RESIZE'
        : `EDITING ${target.toUpperCase()} — DRAG IT IN THE HUD`)
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
      setStatus(target === 'hud'
        ? 'EDITING HUD - DRAG IT OR A CORNER TO RESIZE'
        : `EDITING ${target.toUpperCase()} - DRAG IT IN THE HUD`)
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
  void loadAppVersion()

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

  eventsCreateToggle?.addEventListener('click', () => {
    if (eventsCreateOpen) requestEventsCreateClose()
    else setEventsCreateOpen(true)
  })
  eventsCreateCancel?.addEventListener('click', requestEventsCreateClose)
  eventsDiscardYes?.addEventListener('click', closeEventsCreate)
  eventsDiscardNo?.addEventListener('click', () => {
    setEventsDiscardConfirmOpen(false)
    eventsCreateCancel?.focus()
  })
  eventsCreateForm?.addEventListener('submit', event => {
    event.preventDefault()
    void createEvent()
  })
  eventsSortValue = readEventsSort()
  renderEventsSort()
  eventsSort?.addEventListener('change', () => setEventsSort(eventsSort.value))
  for (const button of eventRunSortButtons) {
    button.addEventListener('click', () => setEventRunsSort(button.dataset.runSort))
  }
  eventsDetailBack?.addEventListener('click', closeEventDetail)
  eventsRunBack?.addEventListener('click', closeEventRun)
  eventsRunLapSort?.addEventListener('click', () => {
    eventRunLapSortDirection = eventRunLapSortDirection === 'desc' ? 'asc' : 'desc'
    if (currentEventRun) renderEventRunDetail(currentEventRun)
  })
  eventsDetailTitle?.addEventListener('click', beginEventRename)
  eventsDetailDelete?.addEventListener('click', () => void deleteCurrentEvent())
  eventRecorderToggle?.addEventListener('click', () => {
    void sendRecorderConfig(recorderState.recording === true ? 'stop' : 'record')
  })
  garageCurrentVariantsToggle?.addEventListener('click', toggleGarageVariants)
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    if (event.target?.classList?.contains('garage-current-car__input')
      || event.target?.classList?.contains('events-detail-view__title-input')) return
    if (eventsDiscardConfirmOpen) {
      event.preventDefault()
      setEventsDiscardConfirmOpen(false)
      eventsCreateCancel?.focus()
      return
    }
    if (eventsView === 'library' && eventsCreateOpen) {
      event.preventDefault()
      requestEventsCreateClose()
      return
    }
    if (eventsView === 'run') {
      event.preventDefault()
      if (expandedEventRunLap !== null) {
        expandedEventRunLap = null
        if (currentEventRun) renderEventRunDetail(currentEventRun)
        return
      }
      closeEventRun()
      return
    }
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
  void listenEventRecorderEvents()
  globalScope.SettingsController = {
    cancelEdit,
    setLayoutEditingState,
    setRouteStatus: renderRouteStatus,
    resetShiftLight: requestShiftLightReset,
    loadEvents,
    openEventDetail,
    closeEventDetail,
    openEventRun,
    closeEventRun
  }
})(typeof globalThis === 'undefined' ? this : globalThis)
