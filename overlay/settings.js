(function (globalScope) {
  'use strict'

  const VISIBILITY_STORAGE_KEY = 'fdc.hud-visibility.v1'
  const OVERLAY_VISIBILITY_STORAGE_KEY = 'fdc.overlay-visibility.v1'
  const EVENTS_SORT_STORAGE_KEY = 'fdc.events-sort.v1'
  const LAYOUT_MODE_STORAGE_KEY = 'fdc.layout-mode.v1'
  const HUD_EDIT_HOTKEY_STORAGE_KEY = 'fdc.hud-edit-hotkey.v1'
  const DEFAULT_HUD_EDIT_HOTKEY = 'Ctrl+Shift+F8'
  const EVENT_SORT_OPTIONS = ['id-desc', 'id-asc', 'last-recorded-desc', 'last-recorded-asc']
  const { COMPONENTS, OVERLAY_COMPONENTS } = globalScope.HudWidgets
  const LAYOUT_TARGET_LABELS = Object.freeze({
    delta: 'DELTA',
    hud: 'HUD',
    tires: 'TIRES',
    pedals: 'THROTTLE & BRAKE',
    steering: 'STEERING',
    gear: 'GEAR / SPEED / RPM',
    engine: 'ENGINE / BOOST',
    history: 'INPUT GRAPH'
  })
  const DEFAULT_VISIBILITY = COMPONENTS.reduce((state, name) => {
    state[name] = true
    return state
  }, {})
  const invoke = globalScope.__TAURI_INTERNALS__?.invoke
  const appVersion = document.getElementById('app-version')
  const settingsHelpToggle = document.getElementById('settings-help-toggle')
  const settingsHelpMenu = document.getElementById('settings-help-menu')
  const settingsTitle = document.getElementById('settings-title')
  const driverAnalysisApi = globalScope.DriverAnalysis
  const driverAnalysisEnabled = document.getElementById('driver-analysis-enabled')
  const driverAnalysisRecord = document.getElementById('driver-analysis-record')
  const driverAnalysisRecordingStatus = document.getElementById('driver-analysis-recording-status')
  const driverAnalysisRecorderHint = document.getElementById('driver-analysis-recorder-hint')
  const driverAnalysisHotkeyValue = document.getElementById('driver-analysis-hotkey-value')
  const driverAnalysisHotkeyChange = document.getElementById('driver-analysis-hotkey-change')
  const hudEditHotkeyValue = document.getElementById('hud-edit-hotkey-value')
  const hudEditHotkeyChange = document.getElementById('hud-edit-hotkey-change')
  const driverAnalysisHistoryView = document.getElementById('driver-analysis-history-view')
  const driverAnalysisDetailView = document.getElementById('driver-analysis-detail-view')
  const driverAnalysisDetailBack = document.getElementById('driver-analysis-detail-back')
  const driverAnalysisDetailTitle = document.getElementById('driver-analysis-detail-title')
  const driverAnalysisDetailSummary = document.getElementById('driver-analysis-detail-summary')
  const driverAnalysisDetailBody = document.getElementById('driver-analysis-detail-body')
  const driverAnalysisHistoryList = document.getElementById('driver-analysis-history-list')
  const driverAnalysisHistoryEmpty = document.getElementById('driver-analysis-history-empty')
  const driverAnalysisHistoryCount = document.getElementById('driver-analysis-history-count')
  const status = document.getElementById('settings-status')
  const telemetryStatus = document.getElementById('telemetry-status')
  const telemetryStatusLabel = document.getElementById('telemetry-status-label')
  const telemetryStatusButton = document.getElementById('telemetry-status-button')
  const settingsIntros = [...document.querySelectorAll('[data-settings-intro]')]
  const connectGuide = document.getElementById('connect-guide')
  const connectGuideStatusLabel = document.getElementById('connect-guide-status-label')
  const connectGuideHint = document.getElementById('connect-guide-hint')
  const connectGuideRetry = document.getElementById('connect-guide-retry')
  const connectGuideSkip = document.getElementById('connect-guide-skip')
  const connectGuideDone = document.getElementById('connect-guide-done')
  const shiftLightEmpty = document.getElementById('shift-light-empty')
  const shiftLightProfile = document.getElementById('shift-light-profile')
  const shiftLightCarKey = document.getElementById('shift-light-car-key')
  const shiftLightCarPi = document.getElementById('shift-light-car-pi')
  const shiftLightCarRpmMax = document.getElementById('shift-light-car-rpm-max')
  const shiftLightUsableCeiling = document.getElementById('shift-light-usable-ceiling')
  const shiftLightCurrentTarget = document.getElementById('shift-light-current-target')
  const shiftLightState = document.getElementById('shift-light-state')
  const shiftLightGearRows = document.getElementById('shift-light-gear-rows')
  const shiftLightReset = document.getElementById('shift-light-reset')
  const shiftLightHelp = document.getElementById('shift-light-help')
  const shiftLightHelpPanel = document.getElementById('shift-light-help-panel')
  const displayPreferencesApi = globalScope.DisplayPreferences
  const quitConfirmationApi = globalScope.QuitConfirmation
  const connectionGuideApi = globalScope.ConnectionGuide
  const CONNECTION_GUIDE_LABELS = Object.freeze({
    waiting: 'WAITING FOR DATA FROM FORZA…',
    connected: 'CONNECTED',
    problem: 'FDC CANNOT RECEIVE DATA OUT'
  })
  const CONNECTION_GUIDE_HINTS = Object.freeze({
    waiting: 'This screen updates as soon as the game sends data.',
    connected: 'FDC is receiving data from Forza Horizon 6.'
  })
  const DEFAULT_REDLINE_BRIGHTNESS = displayPreferencesApi?.DEFAULTS?.redlineBrightness ?? 80
  const DEFAULT_HUD_OPACITY = displayPreferencesApi?.DEFAULTS?.hudOpacity ?? 80
  const SETTINGS_WINDOW_CONTEXTS = Object.freeze({
    hud: 'HUD',
    'driver-analysis': 'DRIVER ANALYSIS',
    garage: 'GARAGE',
    events: 'EVENTS',
    'shift-light': 'SHIFT LIGHT',
    settings: 'SETTINGS'
  })
  const speedUnitInputs = [...document.querySelectorAll('input[name="speed-unit"]')]
  const hudRenderingInputs = [...document.querySelectorAll('input[name="hud-rendering"]')]
  const hudRenderingNote = document.getElementById('hud-rendering-note')
  const HUD_RENDERING_NOTE = hudRenderingNote?.textContent || ''
  const distanceUnitInputs = [...document.querySelectorAll('input[name="distance-unit"]')]
  const configurationAlwaysOnTop = document.getElementById('configuration-always-on-top')
  const confirmBeforeQuit = document.getElementById('confirm-before-quit')
  const showHudWithTelemetry = document.getElementById('show-hud-with-telemetry')
  const fdcShiftLightEnabled = document.getElementById('fdc-shift-light-enabled')
  const redlineBrightness = document.getElementById('redline-brightness')
  const redlineBrightnessValue = document.getElementById('redline-brightness-value')
  const redlineBrightnessReset = document.getElementById('redline-brightness-reset')
  const shiftLightBrightness = document.getElementById('shift-light-brightness')
  const shiftLightBrightnessValue = document.getElementById('shift-light-brightness-value')
  const hudDisplay = document.getElementById('hud-display')
  const hudDisplayMissing = document.getElementById('hud-display-missing')
  const hudOpacity = document.getElementById('hud-opacity')
  const hudOpacityValue = document.getElementById('hud-opacity-value')
  const hudOpacityReset = document.getElementById('hud-opacity-reset')
  const layoutModeInputs = [...document.querySelectorAll('[data-layout-mode]')]
  const displayPreferenceRows = [...document.querySelectorAll('[data-display-preference]')]
  const normalizeShiftLightState = globalScope.ShiftLightSettings?.normalizeShiftLightState
  const settingsTabs = [...document.querySelectorAll('[data-settings-tab]')]
  const settingsPanels = [...document.querySelectorAll('[data-settings-panel]')]
  const garageApi = globalScope.HudGarageRuntime
  const FdcVehicle = globalScope.FdcVehicle
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
  const destructiveConfirmDialog = document.getElementById('destructive-confirm-dialog')
  const destructiveConfirmTitle = document.getElementById('destructive-confirm-title')
  const destructiveConfirmMessage = document.getElementById('destructive-confirm-message')
  const destructiveConfirmOption = document.getElementById('destructive-confirm-option')
  const destructiveConfirmOptionInput = document.getElementById('destructive-confirm-option-input')
  const destructiveConfirmOptionLabel = document.getElementById('destructive-confirm-option-label')
  const destructiveConfirmYes = document.getElementById('destructive-confirm-yes')
  const destructiveConfirmNo = document.getElementById('destructive-confirm-no')
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
  const eventRunsTable = document.getElementById('event-runs-table')
  const eventRunsList = document.getElementById('event-runs-list')
  const eventRunSortButtons = [...document.querySelectorAll('[data-run-sort]')]
  const eventRunsEmpty = document.getElementById('event-runs-empty')
  const eventRunsCount = document.getElementById('event-runs-count')
  const eventsById = new Map()
  let currentEventRuns = []
  let currentEventAbsoluteBestMs = null
  let appVersionNumber = null
  let appVersionFeedbackTimer = null
  let currentEventRun = null
  let recorderState = { eventId: null, recording: false, state: 'stopped', lapCount: 0 }
  let eventsView = 'library'
  let currentEventId = null
  let eventsCreateOpen = false
  let eventsDiscardConfirmOpen = false
  let eventRunsSort = { key: 'date', direction: 'desc' }
  let eventRunLapSortDirection = 'desc'
  let expandedEventRunLap = null
  // Selected trace map layers shared by every lap until the window reloads; null shows all layers.
  let traceMapLayerSelection = null
  // Driver Analysis drive maps open with the errors and clean checks; ALL shows every layer.
  let driveMapLayerSelection = [...(globalScope.DriverAnalysisMap?.ERROR_TYPES || []), 'clean']
  let eventsSortValue = 'id-desc'
  let editingTarget = null
  let hudDisplayCount = 0
  let layoutMode = 'grouped'
  let shiftLightResetPending = false
  let displayPreferencesPending = false
  let displayPreferences = displayPreferencesApi?.read?.() || {
    speedUnit: 'kmh',
    distanceUnit: 'km',
    redlineBrightness: DEFAULT_REDLINE_BRIGHTNESS,
    shiftLightBrightness: 80,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: DEFAULT_HUD_OPACITY,
    configurationAlwaysOnTop: false
  }
  let latestShiftLightState = null
  let latestRouteRevision = -1
  let latestRouteStatus = globalScope.HudTelemetryRoute?.normalizeRouteStatus?.({ phase: 'offline' })
  let connectionGuideChecked = false
  let connectionGuideOpen = false
  let connectionGuideStage = null
  let routeStatusReceived = false
  let driverAnalysisSettings = driverAnalysisApi?.readSettings?.() || { enabled: false, hotkey: 'Ctrl+Shift+F9' }
  let driverAnalysisState = { enabled: driverAnalysisSettings.enabled, recording: false, startedAt: null, sampleCount: 0, hotkey: driverAnalysisSettings.hotkey }
  let driverAnalysisHotkeyCapture = false
  let hudEditHotkeySettings = readHudEditHotkeySettings()
  let hudEditHotkeyCapture = false
  let driverAnalysisHistory = []
  let driverAnalysisHistoryPending = false
  let driverAnalysisExportPending = false
  let driverAnalysisExportingId = null
  let driverAnalysisActionPending = false

  function garageDisplayName(vehicle) {
    return FdcVehicle.displayName(vehicle?.name, vehicle?.carOrdinal)
  }

  function garagePerformanceClass(classLabel) {
    return String(classLabel || 'unknown').trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-') || 'unknown'
  }

  function garageDrivetrainLabel(vehicle) {
    return FdcVehicle.drivetrainLabel(vehicle?.drivetrain)
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
    currentEventRuns = currentEventRuns.map(run => {
      const ordinal = Number(run?.car?.ordinal)
      if (!Number.isFinite(ordinal) || ordinal <= 0 || !ordinals.includes(Math.round(ordinal))) return run
      const garageName = garageVehicles.get(Math.round(ordinal))?.name
      const newName = garageName || null
      if (run.car.name === newName) return run
      runsChanged = true
      return { ...run, car: { ...run.car, name: newName } }
    })
    let historyChanged = false
    driverAnalysisHistory = driverAnalysisHistory.map(session => {
      const ordinal = Number(session?.vehicleIdentity?.ordinal)
      if (!Number.isFinite(ordinal) || ordinal <= 0 || !ordinals.includes(Math.round(ordinal))) return session
      const garageName = garageVehicles.get(Math.round(ordinal))?.name
      const newName = garageName || null
      if (session.vehicleName === newName) return session
      historyChanged = true
      return { ...session, vehicleName: newName }
    })
    const openRunOrdinal = Math.round(Number(currentEventRun?.car?.ordinal))
    if (currentEventRun && ordinals.includes(openRunOrdinal)) {
      const newName = garageVehicles.get(openRunOrdinal)?.name || null
      if (currentEventRun.car.name !== newName) {
        currentEventRun = { ...currentEventRun, car: { ...currentEventRun.car, name: newName } }
        runsChanged = true
      }
    }
    if (runsChanged) {
      renderEventRuns()
      if (currentEventRun) renderEventRunDetail(currentEventRun)
    }
    if (historyChanged) {
      renderDriverAnalysisHistory()
      renderDriverAnalysisView()
    }
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

  // Until Forza has sent Data Out once, Configuration opens on a setup guide.
  function openConnectionGuideIfNeverConnected() {
    if (!connectionGuideApi || connectionGuideChecked) return
    connectionGuideChecked = true
    connectionGuideOpen = connectionGuideApi.shouldShow(connectionGuideApi.read(), garageVehicles.size > 0)
    renderConnectionGuide()
  }

  function renderConnectionGuide() {
    if (!connectGuide || !connectionGuideApi) return
    const presentation = globalScope.HudTelemetryRoute?.getRoutePresentation?.(latestRouteStatus)
    // The page starts from a placeholder offline status, so wait for the real one.
    const stage = routeStatusReceived ? connectionGuideApi.stage(presentation?.tone) : 'waiting'
    if (stage === 'connected' && !connectionGuideApi.read().connected) connectionGuideApi.write({ connected: true })

    const opening = connectionGuideOpen && connectGuide.hidden
    const stageChanged = stage !== connectionGuideStage
    connectionGuideStage = stage
    connectGuide.hidden = !connectionGuideOpen
    connectGuide.dataset.stage = stage
    connectGuideStatusLabel.textContent = CONNECTION_GUIDE_LABELS[stage]
    connectGuideHint.textContent = stage === 'problem' ? presentation?.detail || '' : CONNECTION_GUIDE_HINTS[stage]
    connectGuideRetry.hidden = stage !== 'problem'
    connectGuideSkip.hidden = stage === 'connected'
    connectGuideDone.hidden = stage !== 'connected'
    if (connectionGuideOpen && (opening || stageChanged)) {
      ;(stage === 'connected' ? connectGuideDone : stage === 'problem' ? connectGuideRetry : connectGuideSkip).focus()
    }
  }

  // The header status opens the same guide at any time: the steps, the live
  // stage, and RETRY DATA OUT when the receiver has a problem.
  function openConnectionGuide() {
    if (!connectGuide || !connectionGuideApi || connectionGuideOpen) return
    connectionGuideOpen = true
    renderConnectionGuide()
  }

  function closeConnectionGuide() {
    if (!connectionGuideOpen) return
    connectionGuideOpen = false
    renderConnectionGuide()
    settingsTabs.find(tab => tab.classList.contains('is-active'))?.focus()
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
      void loadEventAbsoluteBest()
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
    await eventApi.listen('event_recorder_reference', event => {
      const payload = event?.payload
      if (!payload || typeof payload !== 'object') return
      if (eventKey(payload.eventId) !== currentEventId || currentEventId === null) return
      const timeMs = payload.timeMs
      if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) return
      if (currentEventAbsoluteBestMs === null || timeMs < currentEventAbsoluteBestMs) {
        currentEventAbsoluteBestMs = timeMs
        renderEventAbsoluteBest()
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

  function nativeEventId(value) {
    const numericId = Number(value)
    return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : value
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
    id.textContent = String(event.id)

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

  // Every delete or reset of saved data asks here first, and so does quitting. NO has focus, and Escape or a click outside the box also answers NO.
  let resolveDestructiveConfirm = null
  let destructiveConfirmReturnFocus = null

  function closeDestructiveConfirm(confirmed) {
    if (!resolveDestructiveConfirm) return
    const resolve = resolveDestructiveConfirm
    resolveDestructiveConfirm = null
    destructiveConfirmDialog.hidden = true
    destructiveConfirmReturnFocus?.focus?.()
    destructiveConfirmReturnFocus = null
    resolve({ confirmed, option: !destructiveConfirmOption.hidden && destructiveConfirmOptionInput.checked })
  }

  function askConfirm({ title = 'ARE YOU SURE?', message, yes = 'YES', no = 'NO', option = '' }) {
    if (!destructiveConfirmDialog) return Promise.resolve({ confirmed: false, option: false })
    closeDestructiveConfirm(false)
    destructiveConfirmReturnFocus = document.activeElement
    destructiveConfirmTitle.textContent = title
    destructiveConfirmMessage.textContent = message
    destructiveConfirmYes.textContent = yes
    destructiveConfirmNo.textContent = no
    destructiveConfirmOption.hidden = !option
    destructiveConfirmOptionInput.checked = false
    destructiveConfirmOptionLabel.textContent = option
    destructiveConfirmDialog.hidden = false
    destructiveConfirmNo.focus()
    return new Promise(resolve => { resolveDestructiveConfirm = resolve })
  }

  async function confirmDestructive(message) {
    return (await askConfirm({ message })).confirmed
  }

  // The X button of this window lands here. QUIT exits FDC; minimizing keeps it running.
  async function requestQuit() {
    if (!quitConfirmationApi) return
    const preferences = quitConfirmationApi.read()
    const recording = driverAnalysisState.recording === true || recorderState.recording === true
    const question = quitConfirmationApi.question(preferences, recording)
    if (question) {
      const answer = await askConfirm({
        title: 'QUIT FDC?',
        message: question.message,
        yes: 'QUIT',
        no: 'CANCEL',
        option: question.offerDontAsk ? 'Don\'t ask again' : ''
      })
      if (!answer.confirmed) return
      quitConfirmationApi.write(quitConfirmationApi.afterQuit(preferences, answer.option))
    }
    try {
      await call('quit_app')
    } catch (error) {
      setStatus(error.message || 'Unable to quit FDC', true)
    }
  }

  function renderQuitConfirmation() {
    if (confirmBeforeQuit && quitConfirmationApi) updateOverlayToggle(confirmBeforeQuit, quitConfirmationApi.read().confirm)
  }

  // WebView2 picks GPU or CPU drawing when FDC starts, so the saved choice
  // can differ from the one this launch uses until the next start.
  let hudRendering = null

  function hudRenderingLabel(renderer) {
    return renderer === 'cpu' ? 'CPU' : 'GPU'
  }

  function renderHudRendering(state) {
    hudRendering = state
    for (const input of hudRenderingInputs) {
      input.checked = input.value === state?.saved
      input.disabled = !state
    }
    if (!hudRenderingNote) return
    hudRenderingNote.textContent = state && state.saved !== state.active
      ? `Restart FDC to draw the HUD with the ${hudRenderingLabel(state.saved)}. FDC uses the ${hudRenderingLabel(state.active)} until then.`
      : HUD_RENDERING_NOTE
  }

  async function loadHudRendering() {
    try {
      renderHudRendering(await call('get_hud_rendering'))
    } catch {
      renderHudRendering(null)
    }
  }

  async function updateHudRendering(renderer) {
    const previous = hudRendering
    for (const input of hudRenderingInputs) input.disabled = true
    try {
      const next = await call('set_hud_rendering', { renderer })
      renderHudRendering(next)
      const message = `HUD RENDERING SET TO ${hudRenderingLabel(next.saved)}`
      setStatus(next.saved === next.active ? message : `${message} · RESTART FDC TO APPLY`)
    } catch (error) {
      renderHudRendering(previous)
      setStatus(error?.message || String(error || 'Unable to save HUD rendering'), true)
    }
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
      const normalized = {
        elapsedMs: runTimeMs(point.elapsedMs ?? point.elapsed_ms ?? point.timeMs ?? point.time_ms, 'ms'),
        distanceM: finiteNumber(point.distanceM ?? point.distance_m ?? point.distance),
        positionX,
        positionY,
        positionZ,
        throttle: normalizePedal(point.throttle ?? point.throttleInput ?? point.throttle_input),
        brake: normalizePedal(point.brake ?? point.brakeInput ?? point.brake_input)
      }
      // Extended contract fields (optional; include when present and finite, accept camelCase and snake_case)
      const extendedFields = [
        ['speedKmh', 'speed_kmh'],
        ['gear', 'gear'],
        ['rpm', 'rpm'],
        ['steer', 'steer'],
        ['accelerationX', 'acceleration_x'],
        ['accelerationY', 'acceleration_y'],
        ['accelerationZ', 'acceleration_z'],
        ['yawRate', 'yaw_rate'],
        ['slipAngleFl', 'slip_angle_fl'],
        ['slipAngleFr', 'slip_angle_fr'],
        ['slipAngleRl', 'slip_angle_rl'],
        ['slipAngleRr', 'slip_angle_rr'],
        ['slipRatioFl', 'slip_ratio_fl'],
        ['slipRatioFr', 'slip_ratio_fr'],
        ['slipRatioRl', 'slip_ratio_rl'],
        ['slipRatioRr', 'slip_ratio_rr'],
        ['combinedSlipFl', 'combined_slip_fl'],
        ['combinedSlipFr', 'combined_slip_fr'],
        ['combinedSlipRl', 'combined_slip_rl'],
        ['combinedSlipRr', 'combined_slip_rr'],
        ['tireTempCFl', 'tire_temp_c_fl'],
        ['tireTempCFr', 'tire_temp_c_fr'],
        ['tireTempCRl', 'tire_temp_c_rl'],
        ['tireTempCRr', 'tire_temp_c_rr'],
        ['suspensionFl', 'suspension_fl'],
        ['suspensionFr', 'suspension_fr'],
        ['suspensionRl', 'suspension_rl'],
        ['suspensionRr', 'suspension_rr'],
        ['puddleFl', 'puddle_fl'],
        ['puddleFr', 'puddle_fr'],
        ['puddleRl', 'puddle_rl'],
        ['puddleRr', 'puddle_rr']
      ]
      for (const [camelCase, snakeCase] of extendedFields) {
        const value = finiteNumber(point[camelCase] ?? point[snakeCase])
        if (value !== null) normalized[camelCase] = value
      }
      // Rumble fields: boolean, accept camelCase and snake_case
      for (const wheel of ['Fl', 'Fr', 'Rl', 'Rr']) {
        const camel = `rumble${wheel}`
        const snake = `rumble_${wheel.toLowerCase()}`
        if (point[camel] === true || point[snake] === true) {
          normalized[camel] = true
        }
      }
      return normalized
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
    id.textContent = String(event.id)
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
    return FdcVehicle.displayName(run.car.name, run.car.ordinal)
  }

  function runBestTimeMs(run) {
    if (run?.runType === 'sprint') return run.finalTimeMs
    return run?.laps?.reduce((best, lap) => !best || lap.timeMs < best ? lap.timeMs : best, null)
  }

  // The native loader owns eligibility (including the distance check that
  // rejects abandoned attempts), so the page shows the same result as Delta.
  async function loadEventAbsoluteBest(eventId = currentEventId) {
    const key = eventKey(eventId)
    if (!key) return
    try {
      const nativeEventId = Number.isFinite(Number(key)) ? Math.round(Number(key)) : key
      const reference = await call('load_event_absolute_best', { eventId: nativeEventId })
      if (eventKey(currentEventId) !== key) return
      const time = Number(reference?.timeMs)
      currentEventAbsoluteBestMs = Number.isFinite(time) ? time : null
    } catch {
      if (eventKey(currentEventId) !== key) return
      currentEventAbsoluteBestMs = null
    }
    renderEventAbsoluteBest()
  }

  function renderEventAbsoluteBest() {
    if (!eventsDetailAbsoluteBest) return
    eventsDetailAbsoluteBest.textContent = formatRunTime(currentEventAbsoluteBestMs)
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
    if (eventRunsTable) eventRunsTable.hidden = runs.length === 0
    if (eventRunsCount) eventRunsCount.textContent = `${runs.length} ${runs.length === 1 ? 'RUN' : 'RUNS'}`
    for (const run of runs) {
      const lapCount = run.laps.length
      const openRun = () => openEventRun(run.id)
      const row = document.createElement('tr')
      row.className = 'events-run-table__lap-row'
      row.tabIndex = 0
      row.setAttribute('aria-label', `Open run ${run.id}, ${lapCount} ${lapCount === 1 ? 'lap' : 'laps'}`)
      row.addEventListener('click', openRun)
      row.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        openRun()
      })
      const idCell = document.createElement('th')
      idCell.scope = 'row'
      idCell.textContent = String(run.id)
      row.append(idCell)
      const carCell = document.createElement('td')
      carCell.textContent = runCarName(run)
      row.append(carCell)
      const carDetails = [run.car.class, run.car.pi ? `PI ${run.car.pi}` : '', run.car.drivetrain].filter(Boolean).join(' · ') || '—'
      const carDetailsCell = document.createElement('td')
      carDetailsCell.textContent = carDetails
      row.append(carDetailsCell)
      const bestCell = document.createElement('td')
      const bestTime = document.createElement('span')
      bestTime.className = 'events-run-table__time'
      bestTime.textContent = formatRunTime(runBestTimeMs(run))
      bestCell.append(bestTime)
      row.append(bestCell)
      const lapsCell = document.createElement('td')
      lapsCell.className = 'events-run-table__end'
      lapsCell.textContent = String(lapCount)
      row.append(lapsCell)
      const dateCell = document.createElement('td')
      dateCell.className = 'events-run-table__end'
      dateCell.textContent = formatRunDate(run.startedAt)
      row.append(dateCell)
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

  // Events lap maps use the defaults. Driver Analysis drive maps pass marks (problem segments and clean checks), their
  // own layer selection, and no sector ticks.
  function renderTraceMap(points, lapTimeMs, options = {}) {
    const marks = options.marks || null
    const selection = options.selection || {
      get: () => traceMapLayerSelection,
      set: value => { traceMapLayerSelection = value }
    }
    const map = document.createElement('div')
    map.className = 'events-lap-detail__map'
    if (points.length < 2) {
      const empty = document.createElement('p')
      empty.className = 'events-lap-detail__empty'
      empty.textContent = options.emptyText || 'NO TRACE DATA SAVED FOR THIS LAP'
      map.append(empty)
      return map
    }
    const coordinates = points.map(point => ({ x: point.positionX, z: point.positionZ }))
    const minX = Math.min(...coordinates.map(point => point.x))
    const maxX = Math.max(...coordinates.map(point => point.x))
    const minZ = Math.min(...coordinates.map(point => point.z))
    const maxZ = Math.max(...coordinates.map(point => point.z))
    // The viewBox follows the track's shape so any layout fills the width; CSS caps the rendered height.
    const width = 1000
    const padding = 36
    const spanX = Math.max(1, maxX - minX)
    const spanZ = Math.max(1, maxZ - minZ)
    const height = Math.round(Math.min(1400, Math.max(360, (width - padding * 2) * spanZ / spanX + padding * 2)))
    const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanZ)
    const offsetX = (width - spanX * scale) / 2
    const offsetY = (height - spanZ * scale) / 2
    const project = point => ({
      x: offsetX + (point.positionX - minX) * scale,
      y: height - offsetY - (point.positionZ - minZ) * scale
    })
    const projected = points.map(project)

    // Check if extended telemetry is available
    const hasExtended = globalThis.EventTraceMap?.hasExtendedTelemetry(points) ?? false

    const markLayers = marks
      ? [
          ...(globalThis.DriverAnalysisMap?.ERROR_TYPES || []).filter(kind => marks.errors.some(mark => mark.kind === kind)),
          ...(marks.clean.length > 0 ? ['clean'] : [])
        ]
      : []
    const available = [
      ...markLayers,
      ...(globalThis.EventTraceMap?.TRACE_LAYERS.filter(layer => layer !== 'slip' || hasExtended) ?? ['throttle', 'brake', 'coast'])
    ]

    const svg = svgElement('svg', {
      class: 'events-lap-detail__svg',
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': 'Throttle, brake, coast, and slip trace map'
    })
    svg.append(svgElement('rect', { class: 'events-lap-detail__surface', x: 0, y: 0, width, height, rx: 2 }))

    // White track outline: always visible
    const outlineGroup = svgElement('g', { class: 'events-lap-detail__outline-group' })
    const outlinePoints = projected.map((p, i) => `${p.x},${p.y}`).join(' ')
    outlineGroup.append(svgElement('polyline', {
      class: 'events-lap-detail__outline',
      points: outlinePoints
    }))
    svg.append(outlineGroup)

    // Slip layer (drawn under pedal lines)
    if (hasExtended) {
      const slipGroup = svgElement('g', { class: 'events-lap-detail__slip-group', 'data-layer-group': 'slip' })
      const slipRuns = globalThis.EventTraceMap?.groupRuns(points, (p) => globalThis.EventTraceMap?.isSlipPoint(p) ? 'slip' : 'no-slip') ?? []
      for (const run of slipRuns) {
        if (run.key !== 'slip') continue
        const runPoints = projected.slice(run.startIndex, run.endIndex + 1)
        const pointsStr = runPoints.map((p) => `${p.x},${p.y}`).join(' ')
        slipGroup.append(svgElement('polyline', {
          class: 'events-lap-detail__slip-line',
          points: pointsStr
        }))
      }
      svg.append(slipGroup)
    }

    // Pedal layers
    const pedalLayers = ['throttle', 'brake', 'coast']
    for (const pedal of pedalLayers) {
      const group = svgElement('g', { class: `events-lap-detail__pedal-group events-lap-detail__pedal-group--${pedal}`, 'data-layer-group': pedal })
      const runs = globalThis.EventTraceMap?.groupRuns(points, (p) => globalThis.EventTraceMap?.pedalState(p)) ?? []
      for (const run of runs) {
        if (run.key !== pedal) continue
        const runPoints = projected.slice(run.startIndex, run.endIndex + 1)
        if (runPoints.length < 2) continue
        const pointsStr = runPoints.map((p) => `${p.x},${p.y}`).join(' ')
        group.append(svgElement('polyline', {
          class: `events-lap-detail__trace events-lap-detail__trace--${pedal}`,
          points: pointsStr
        }))
      }
      svg.append(group)
    }

    if (marks) svg.append(...renderTraceMarks(marks, projected))

    // Sector ticks and labels (on top)
    const distances = points.map(point => point.distanceM).filter(value => value !== null)
    const minDistance = distances.length ? Math.min(...distances) : 0
    const maxDistance = distances.length ? Math.max(...distances) : 0
    const ticks = options.sectorTicks === false ? [] : traceSectorTicks(points, minDistance, maxDistance, project, minX, maxX, minZ, maxZ)
    for (const tick of ticks) {
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

    // Start marker
    const start = project(points[0])
    svg.append(svgElement('circle', { class: 'events-lap-detail__start', cx: start.x, cy: start.y, r: 3 }))

    // POINT DATA panel beside the map: it shows the hovered point while the pointer is over the map layout.
    const inspectorTitle = document.createElement('span')
    inspectorTitle.className = 'events-lap-detail__inspector-title'
    inspectorTitle.textContent = 'POINT DATA'
    const inspectorBody = document.createElement('div')
    inspectorBody.className = 'events-lap-detail__inspector-body'
    const inspector = document.createElement('aside')
    inspector.className = 'events-lap-detail__inspector'
    inspector.setAttribute('aria-live', 'polite')
    inspector.setAttribute('aria-label', 'Point data')
    inspector.append(inspectorTitle, inspectorBody)
    const layout = document.createElement('div')
    layout.className = 'events-lap-detail__map-layout'
    layout.append(svg, inspector)

    // Hover functionality
    const markerCircle = svgElement('circle', { class: 'events-lap-detail__hover-marker', cx: 0, cy: 0, r: 4 })
    markerCircle.style.display = 'none'
    svg.append(markerCircle)

    svg.addEventListener('pointermove', (event) => {
      // The viewBox is letterboxed inside the padded element, so map through the screen matrix.
      const matrix = svg.getScreenCTM()
      if (!matrix) return
      const cursor = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      const x = cursor.x
      const y = cursor.y

      const nearestIdx = (marks ? globalThis.DriverAnalysisMap?.nearestErrorIndex(marks, projected, x, y, 14) : null)
        ?? globalThis.EventTraceMap?.nearestPointIndex(projected, x, y, 14) ?? null
      if (nearestIdx !== null) {
        const p = projected[nearestIdx]
        markerCircle.setAttribute('cx', p.x)
        markerCircle.setAttribute('cy', p.y)

        const errorMark = marks ? globalThis.DriverAnalysisMap?.errorAt(marks, nearestIdx) : null
        const tooltipData = errorMark
          ? globalThis.DriverAnalysisMap.errorTooltipModel(errorMark, points)
          : globalThis.EventTraceMap?.tooltipModel(points[nearestIdx], points[0].distanceM ?? 0) ?? { rows: [], wheelTable: [] }
        renderTooltip(inspectorBody, tooltipData)
        markerCircle.style.display = 'block'
      } else {
        inspectorBody.replaceChildren()
        markerCircle.style.display = 'none'
      }
    })

    // The panel sits beside the SVG, so leaving the whole layout (not just the SVG) clears it.
    layout.addEventListener('pointerleave', () => {
      inspectorBody.replaceChildren()
      markerCircle.style.display = 'none'
    })

    const legend = renderTraceLegend(points, lapTimeMs, available, marks)
    const applyLayers = () => {
      const visible = globalThis.EventTraceMap?.visibleLayers(selection.get(), available) ?? available
      for (const group of svg.querySelectorAll('[data-layer-group]')) {
        group.style.display = visible.includes(group.getAttribute('data-layer-group')) ? '' : 'none'
      }
      for (const button of legend.querySelectorAll('[data-layer]')) {
        button.setAttribute('aria-pressed', String(visible.includes(button.dataset.layer)))
      }
    }
    legend.addEventListener('click', event => {
      const button = event.target.closest('button')
      if (!button || button.disabled) return
      selection.set(button.dataset.layer
        ? globalThis.EventTraceMap?.nextLayerSelection(selection.get(), button.dataset.layer, available) ?? null
        : null)
      applyLayers()
    })
    applyLayers()

    map.append(layout, legend)
    if (marks && marks.errors.length > 0) map.append(renderTraceErrorList(marks, points, svg))
    return map
  }

  // Problem segments are drawn thick over a dark casing, one group per problem type; clean checks are small dots.
  function renderTraceMarks(marks, projected) {
    const groups = new Map()
    const groupFor = key => {
      if (!groups.has(key)) groups.set(key, svgElement('g', { class: 'events-lap-detail__marks', 'data-layer-group': key }))
      return groups.get(key)
    }
    marks.errors.forEach((mark, index) => {
      const pointsText = projected.slice(mark.startIndex, mark.endIndex + 1).map(point => `${point.x},${point.y}`).join(' ')
      const group = groupFor(mark.kind)
      group.append(
        svgElement('polyline', { class: 'events-lap-detail__mark-casing', points: pointsText, 'data-mark-index': index }),
        svgElement('polyline', { class: `events-lap-detail__mark events-lap-detail__mark--${mark.kind}`, points: pointsText, 'data-mark-index': index })
      )
    })
    for (const mark of marks.clean) {
      const point = projected[mark.index]
      groupFor('clean').append(svgElement('circle', { class: 'events-lap-detail__clean', cx: point.x, cy: point.y, r: 5 }))
    }
    const order = [...(globalThis.DriverAnalysisMap?.ERROR_TYPES || []), 'clean']
    return [...groups.entries()].sort(([left], [right]) => order.indexOf(right) - order.indexOf(left)).map(([, group]) => group)
  }

  // Every problem of the drive in order; selecting one highlights it on the map.
  function renderTraceErrorList(marks, points, svg) {
    const list = document.createElement('div')
    list.className = 'events-lap-detail__errors'
    marks.errors.forEach((mark, index) => {
      const model = globalThis.DriverAnalysisMap?.errorTooltipModel(mark, points)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'events-lap-detail__error'
      button.setAttribute('aria-pressed', 'false')
      const swatch = document.createElement('span')
      swatch.className = `events-lap-detail__swatch events-lap-detail__swatch--${mark.kind}`
      swatch.setAttribute('aria-hidden', 'true')
      const name = document.createElement('span')
      name.className = 'events-lap-detail__error-name'
      name.textContent = model?.heading || mark.kind
      const where = document.createElement('span')
      where.className = 'events-lap-detail__error-where'
      where.textContent = model?.subtitle || ''
      button.append(swatch, name, where)
      button.addEventListener('click', () => {
        const selected = button.getAttribute('aria-pressed') !== 'true'
        for (const other of list.querySelectorAll('.events-lap-detail__error')) other.setAttribute('aria-pressed', 'false')
        button.setAttribute('aria-pressed', String(selected))
        for (const line of svg.querySelectorAll('[data-mark-index]')) {
          line.classList.toggle('is-selected', selected && line.getAttribute('data-mark-index') === String(index))
        }
      })
      list.append(button)
    })
    return list
  }

  // One row under the map: each pedal layer with its share of lap time, SLIP with its time above 100% combined
  // slip, and ALL to show every layer again. The buttons also select the visible layers.
  function renderTraceLegend(points, lapTimeMs, available, marks = null) {
    const legend = document.createElement('div')
    legend.className = 'events-lap-detail__legend'
    if (marks) {
      const counts = globalThis.DriverAnalysisMap?.errorCounts(marks) || {}
      for (const key of available.filter(layer => !['throttle', 'brake', 'coast', 'slip'].includes(layer))) {
        const label = key === 'clean' ? 'CLEAN' : globalThis.DriverAnalysisMap?.ERROR_SHORT_LABELS?.[key] || key.toUpperCase()
        legend.append(renderLegendButton(key, label, String(key === 'clean' ? marks.clean.length : counts[key] || 0)))
      }
    }
    const pedalShares = traceStats(points, lapTimeMs)
    const slipShare = globalThis.EventTraceMap?.slipTimeShare(points, lapTimeMs) ?? null
    const labels = [
      ['throttle', 'THROTTLE'],
      ['brake', 'BRAKE'],
      ['coast', 'COAST'],
      ['slip', 'SLIP']
    ]
    for (const [key, label] of labels) {
      const share = key === 'slip' ? slipShare : pedalShares?.[key]
      const button = renderLegendButton(key, label, Number.isFinite(share) ? `${share}%` : '—')
      if (!available.includes(key)) {
        button.disabled = true
        button.title = 'Extended telemetry was not recorded for this lap'
      }
      legend.append(button)
    }
    const all = document.createElement('button')
    all.type = 'button'
    all.className = 'events-lap-detail__legend-all'
    all.textContent = 'ALL'
    legend.append(all)
    return legend
  }

  function renderLegendButton(key, label, valueText) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `events-lap-detail__stat events-lap-detail__stat--${key}`
    button.dataset.layer = key
    const swatch = document.createElement('span')
    swatch.className = `events-lap-detail__swatch events-lap-detail__swatch--${key}`
    swatch.setAttribute('aria-hidden', 'true')
    const name = document.createElement('span')
    name.className = 'events-lap-detail__stat-name'
    name.textContent = label
    const value = document.createElement('output')
    value.className = 'events-lap-detail__stat-value'
    value.textContent = valueText
    button.append(swatch, name, value)
    return button
  }

  function renderErrorTooltip(container, model) {
    const heading = document.createElement('div')
    heading.className = `events-lap-detail__tooltip-heading events-lap-detail__tooltip-heading--${model.kind}`
    heading.textContent = model.heading
    const subtitle = document.createElement('div')
    subtitle.className = 'events-lap-detail__tooltip-caption'
    subtitle.textContent = model.subtitle
    container.append(heading, subtitle)
    for (const text of model.lines || []) {
      const line = document.createElement('div')
      line.className = 'events-lap-detail__tooltip-line'
      line.textContent = text
      container.append(line)
    }
    if (model.instruction) {
      const instruction = document.createElement('div')
      instruction.className = 'events-lap-detail__tooltip-instruction'
      instruction.textContent = `→ ${model.instruction}`
      container.append(instruction)
    }
  }

  function renderTooltip(container, model) {
    container.replaceChildren()
    if (model.heading) {
      renderErrorTooltip(container, model)
      return
    }

    // DIST and TIME lead the panel in large type; the other values sit in two columns below.
    const appendMetrics = (className, rows) => {
      if (!rows.length) return
      const group = document.createElement('div')
      group.className = className
      for (const row of rows) {
        const metric = document.createElement('div')
        metric.className = 'events-lap-detail__point-metric'
        const label = document.createElement('span')
        label.className = 'events-lap-detail__tooltip-label'
        label.textContent = row.label
        const value = document.createElement('span')
        value.className = 'events-lap-detail__tooltip-value'
        value.textContent = row.value
        metric.append(label, value)
        group.append(metric)
      }
      container.append(group)
    }
    const isLead = row => row.label === 'DIST' || row.label === 'TIME'
    appendMetrics('events-lap-detail__point-lead', model.rows.filter(isLead))
    appendMetrics('events-lap-detail__point-metrics', model.rows.filter(row => !isLead(row)))

    // Wheel table
    if (model.wheelTable.length > 0) {
      const table = document.createElement('table')
      table.className = 'events-lap-detail__tooltip-table'
      const headerRow = document.createElement('tr')
      const headerLabel = document.createElement('th')
      headerLabel.textContent = ''
      headerRow.append(headerLabel)
      for (const wheel of ['Fl', 'Fr', 'Rl', 'Rr']) {
        const th = document.createElement('th')
        th.textContent = wheel.toUpperCase()
        headerRow.append(th)
      }
      table.append(headerRow)

      for (const row of model.wheelTable) {
        const tr = document.createElement('tr')
        const labelTd = document.createElement('td')
        labelTd.className = 'events-lap-detail__tooltip-wheel-label'
        labelTd.textContent = row.label
        tr.append(labelTd)
        for (const wheel of ['Fl', 'Fr', 'Rl', 'Rr']) {
          const td = document.createElement('td')
          td.textContent = row.values?.[wheel] ?? '—'
          tr.append(td)
        }
        table.append(tr)
      }
      container.append(table)
    }

    // Curb row
    if (model.curbRow) {
      const div = document.createElement('div')
      div.className = 'events-lap-detail__tooltip-row'
      const label = document.createElement('span')
      label.className = 'events-lap-detail__tooltip-label'
      label.textContent = model.curbRow.label
      const value = document.createElement('span')
      value.className = 'events-lap-detail__tooltip-value'
      value.textContent = model.curbRow.wheels.map(wheel => wheel.toUpperCase()).join(', ')
      div.append(label, value)
      container.append(div)
    }

    // Puddle row
    if (model.puddleRow) {
      const div = document.createElement('div')
      div.className = 'events-lap-detail__tooltip-row'
      const label = document.createElement('span')
      label.className = 'events-lap-detail__tooltip-label'
      label.textContent = model.puddleRow.label
      const value = document.createElement('span')
      value.className = 'events-lap-detail__tooltip-value'
      value.textContent = Object.entries(model.puddleRow.wheels).map(([w, d]) => `${w.toUpperCase()} ${d}`).join(', ')
      div.append(label, value)
      container.append(div)
    }

    if (model.notes?.length) {
      const notes = document.createElement('div')
      notes.className = 'events-lap-detail__point-notes'
      for (const note of model.notes) {
        const caption = document.createElement('div')
        caption.className = 'events-lap-detail__tooltip-caption'
        caption.textContent = note
        notes.append(caption)
      }
      container.append(notes)
    }
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
    if (eventsRunId) eventsRunId.textContent = String(run.id)
    if (eventsRunBht) eventsRunBht.textContent = formatRunTime(runBestHypotheticalTimeMs(run))
    if (eventsRunTableHint) {
      eventsRunTableHint.textContent = run.runType === 'sprint' ? 'SPRINT · ONE PASS' : ''
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
          detail.append(renderTraceMap(lap.tracePoints || [], lap.timeMs))
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
      const sprintWarning = 'Sprint: keep recording armed between attempts, then press STOP.'
      const hint = recordingAnotherEvent
        ? `Recording Event ${recorderState.eventId}. Open that event to stop capture.`
        : finalizing
          ? 'Checking post-finish telemetry for the game-reported result.'
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
      void loadEventAbsoluteBest(key)
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
      const loaded = normalizeEvent(await call('load_event', {
        eventId: nativeEventId(event?.id ?? id)
      }))
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
    currentEventAbsoluteBestMs = null
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
    currentEventAbsoluteBestMs = null
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
      const result = await call('rename_event', { eventId: nativeEventId(event.id), name })
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
    if (!(await confirmDestructive(`Delete event “${event.name}”?`))) return false
    try {
      await call('delete_event', { eventId: nativeEventId(event.id) })
      eventsById.delete(event.id)
      closeEventDetail()
      setStatus('EVENT DELETED')
      return true
    } catch (error) {
      setStatus(error.message || 'Unable to delete event', true)
      return false
    }
  }

  function syncHudDisplayDisabled() {
    if (hudDisplay) hudDisplay.disabled = hudDisplayCount <= 1 || Boolean(editingTarget)
  }

  async function refreshHudDisplay() {
    if (!hudDisplay) return
    try {
      const displayList = await call('list_hud_displays')
      hudDisplay.replaceChildren(...displayList.displays.map(display => new Option(display.label, display.name)))
      if (displayList.selected) hudDisplay.value = displayList.selected
      hudDisplayCount = displayList.displays.length
      hudDisplayMissing.hidden = !displayList.savedMissing
      syncHudDisplayDisabled()
    } catch (error) {
      setStatus(error.message || 'Unable to list monitors', true)
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
    if (tabName === 'hud') void refreshHudDisplay()
    if (tabName === 'events' && eventsView === 'library') void loadEvents()
    if (tabName === 'driver-analysis') {
      void loadDriverAnalysisHistory()
      const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
      if (eventApi?.emit) void eventApi.emit('driver_analysis_status_request')
    }
  }

  function updateSettingsWindowContext(tabName) {
    const context = SETTINGS_WINDOW_CONTEXTS[tabName]
    if (!context) return
    const activeTab = settingsTabs.find(tab => tab.dataset.settingsTab === tabName)
    if (settingsTitle) settingsTitle.textContent = activeTab?.textContent.trim() || context
    for (const intro of settingsIntros) intro.hidden = intro.dataset.settingsIntro !== tabName
    document.title = `FDC · ${context}`
    void call('set_settings_window_context', { context: tabName }).catch(() => undefined)
  }

  function setStatus(message, error = false) {
    status.textContent = message
    status.classList.toggle('is-error', error)
  }

  function showAppVersionFeedback(label) {
    clearTimeout(appVersionFeedbackTimer)
    appVersion.textContent = label
    appVersionFeedbackTimer = setTimeout(() => {
      appVersion.textContent = `v${appVersionNumber}`
    }, 1500)
  }

  function copyTextWithSelection(text) {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      return document.execCommand('copy')
    } finally {
      textarea.remove()
    }
  }

  async function copyAppVersionToClipboard() {
    if (!appVersionNumber) return
    const text = `FDC ${appVersionNumber}`
    let copied = false
    try {
      await navigator.clipboard.writeText(text)
      copied = true
    } catch {
      copied = copyTextWithSelection(text)
    }
    showAppVersionFeedback(copied ? 'COPIED' : 'COPY FAILED')
  }

  function toggleHelpMenu(open) {
    if (open === undefined) open = settingsHelpMenu.hidden
    settingsHelpMenu.hidden = !open
    settingsHelpToggle.setAttribute('aria-expanded', String(open))
    if (open) {
      const firstItem = settingsHelpMenu.querySelector('[role="menuitem"]')
      firstItem?.focus()
    }
  }

  function closeHelpMenu() {
    toggleHelpMenu(false)
    settingsHelpToggle.focus()
  }

  function handleHelpMenuKeydown(event) {
    const items = [...settingsHelpMenu.querySelectorAll('[role="menuitem"]')]
    const currentIndex = items.indexOf(document.activeElement)
    let nextIndex = currentIndex

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      nextIndex = (currentIndex + 1) % items.length
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      nextIndex = (currentIndex - 1 + items.length) % items.length
    } else if (event.key === 'Home') {
      event.preventDefault()
      nextIndex = 0
    } else if (event.key === 'End') {
      event.preventDefault()
      nextIndex = items.length - 1
    } else if (event.key === 'Escape') {
      event.preventDefault()
      closeHelpMenu()
      return
    } else if (event.key === 'Tab') {
      event.preventDefault()
      closeHelpMenu()
      return
    }

    if (items[nextIndex]) items[nextIndex].focus()
  }

  function call(command, args) {
    if (typeof invoke !== 'function') {
      return Promise.reject(new Error('Tauri commands are unavailable'))
    }
    return invoke(command, args)
  }

  function formatDriverAnalysisDuration(durationMs) {
    const seconds = Math.max(0, Math.round((Number(durationMs) || 0) / 1000))
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return minutes > 0 ? `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s` : `${remainingSeconds}s`
  }

  function formatDriverAnalysisDate(value) {
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return 'UNKNOWN TIME'
    return `${date.toLocaleDateString()} · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }

  function formatDriverAnalysisSize(value) {
    const bytes = Math.max(0, Number(value) || 0)
    if (bytes < 1024) return `${Math.round(bytes)} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
  }

  function driverAnalysisResultCopy(entry) {
    if (entry?.status === 'recording') {
      return {
        label: 'RECORDING IN PROGRESS',
        instruction: 'Press STOP to finish. The analysis and statistics appear here when the recording is saved.'
      }
    }
    if (entry?.result === 'issue' && entry.label) {
      return {
        label: entry.label,
        instruction: entry.instruction || 'Repeat the session before changing another part of your technique.'
      }
    }
    if (entry?.result === 'ambiguous') {
      return {
        label: 'NO DRIVER-DOMINANT PATTERN DETECTED',
        instruction: 'The recording could not separate driver input from vehicle behaviour.'
      }
    }
    if (entry?.result === 'no_recurring_problem') {
      return {
        label: 'NO RECURRING PROBLEM DETECTED',
        instruction: 'No single technique problem repeated often enough in this recording.'
      }
    }
    if (entry?.result === 'interrupted' || entry?.status === 'interrupted') {
      return {
        label: 'RECORDING INTERRUPTED',
        instruction: 'Only completed maneuvers were kept. Record another asphalt session for a reliable result.'
      }
    }
    return {
      label: 'NOT ENOUGH ELIGIBLE MANEUVERS',
      instruction: 'Record a longer asphalt session before changing technique.'
    }
  }

  function driverAnalysisHeadline(session) {
    const isIssue = session?.result === 'issue' && session?.label
    const patternSummary = isIssue ? null : globalScope.DriverAnalysisStats?.formatPatternSummary?.(session.stats)
    let label, instruction, result
    if (isIssue) {
      label = session.label
      instruction = session.instruction || 'Repeat the session before changing another part of your technique.'
      result = 'issue'
    } else if (patternSummary) {
      label = globalScope.DriverAnalysisStats?.formatPatternHeadline?.(patternSummary) || 'MOST FREQUENT'
      instruction = patternSummary.text
      result = 'most_frequent'
    } else {
      const copy = driverAnalysisResultCopy(session)
      label = copy.label
      instruction = copy.instruction
      result = session?.status === 'recording' ? 'recording' : session?.result || 'unknown'
    }
    return { label, instruction, result }
  }

  // Summary tiles of the recording and car pages: a label above a large value.
  function driverAnalysisSummaryTiles(metrics) {
    const summary = document.createElement('div')
    summary.className = 'driver-analysis-detail-view__summary'
    for (const metric of metrics) {
      const tile = document.createElement('div')
      tile.className = 'driver-analysis-detail-view__summary-metric'
      const label = document.createElement('span')
      label.className = 'driver-analysis-detail-view__summary-label'
      label.textContent = metric.label
      const value = document.createElement('strong')
      value.className = 'driver-analysis-detail-view__summary-value'
      value.textContent = metric.value
      tile.append(label, value)
      summary.append(tile)
    }
    return summary
  }

  let driverAnalysisView = { level: 'history', recordingId: null, sessionId: null, driveId: null }
  const expandedDriverAnalysisStats = new Set()
  const driverAnalysisDriveMaps = new Map()

  const DRIVER_ANALYSIS_BACK_LABELS = {
    history: { text: '← HISTORY', ariaLabel: 'Back to history' },
    recording: { text: '← RECORDING', ariaLabel: 'Back to the recording' },
    car: { text: '← CAR', ariaLabel: 'Back to the car' }
  }

  function setDriverAnalysisView(next) {
    driverAnalysisView = next
    if (driverAnalysisHistoryView) driverAnalysisHistoryView.hidden = next.level !== 'history'
    if (driverAnalysisDetailView) driverAnalysisDetailView.hidden = next.level === 'history'
    // The header path names the page from this level (RECORDING, CAR, DRIVE).
    if (driverAnalysisDetailView) driverAnalysisDetailView.dataset.level = next.level
    if (driverAnalysisDetailBack && next.level !== 'history') {
      const label = DRIVER_ANALYSIS_BACK_LABELS[driverAnalysisParentLevel(next)]
      driverAnalysisDetailBack.textContent = label.text
      driverAnalysisDetailBack.setAttribute('aria-label', label.ariaLabel)
    }
    renderDriverAnalysisView()
    if (next.level !== 'history' && driverAnalysisDetailBack) driverAnalysisDetailBack.focus()
  }

  // The level BACK leads to. The back label and closeDriverAnalysisLevel both
  // use it, so they cannot disagree. A recording with one car opens its car
  // page directly, so that car page leads back to the history.
  function driverAnalysisParentLevel(view) {
    if (view.level === 'drive') return 'car'
    if (view.level === 'car') {
      const recordings = globalScope.DriverAnalysisHistory?.groupRecordings?.(driverAnalysisHistory) || []
      const recording = recordings.find(r => String(r.recordingId) === view.recordingId)
      return recording && recording.sessions.length > 1 ? 'recording' : 'history'
    }
    return 'history'
  }

  function closeDriverAnalysisLevel() {
    const { level, recordingId, sessionId } = driverAnalysisView
    if (level === 'history') return
    const parentLevel = driverAnalysisParentLevel(driverAnalysisView)
    if (parentLevel === 'car') {
      setDriverAnalysisView({ level: 'car', recordingId, sessionId, driveId: null })
    } else if (parentLevel === 'recording') {
      setDriverAnalysisView({ level: 'recording', recordingId, sessionId: null, driveId: null })
    } else {
      setDriverAnalysisView({ level: 'history', recordingId: null, sessionId: null, driveId: null })
    }
  }

  function renderDriverAnalysisView() {
    if (driverAnalysisView.level === 'history') return
    const recordingId = String(driverAnalysisView.recordingId)
    const sessionId = String(driverAnalysisView.sessionId)
    const driveId = String(driverAnalysisView.driveId)
    const recordings = globalScope.DriverAnalysisHistory?.groupRecordings?.(driverAnalysisHistory) || []
    const recording = recordings.find(r => String(r.recordingId) === recordingId)
    if (!recording) {
      setDriverAnalysisView({ level: 'history', recordingId: null, sessionId: null, driveId: null })
      return
    }
    const session = recording.sessions.find(s => String(s?.id) === sessionId)
    if (driverAnalysisView.level !== 'recording' && !session) {
      setDriverAnalysisView({ level: 'history', recordingId: null, sessionId: null, driveId: null })
      return
    }
    if (driverAnalysisDetailBody) driverAnalysisDetailBody.replaceChildren()
    if (driverAnalysisDetailSummary) driverAnalysisDetailSummary.replaceChildren()
    if (driverAnalysisDetailTitle) driverAnalysisDetailTitle.textContent = 'RECORDING'
    if (driverAnalysisView.level === 'recording') {
      const firstSession = recording.sessions[0]
      if (driverAnalysisDetailTitle) driverAnalysisDetailTitle.textContent = formatDriverAnalysisDate(firstSession?.recordedAt)
      const totalDurationMs = globalScope.DriverAnalysisHistory?.recordingDurationMs?.(recording.sessions) ?? 0
      const totalDrives = recording.sessions.reduce((sum, s) => sum + (Array.isArray(s?.drives) ? s.drives.length : 0), 0)
      const totalStorageBytes = recording.sessions.reduce((sum, s) => sum + (Number(s?.storageBytes) || 0), 0)
      driverAnalysisDetailBody?.append(driverAnalysisSummaryTiles([
        { label: 'DURATION', value: formatDriverAnalysisDuration(totalDurationMs) },
        { label: 'CARS', value: String(recording.sessions.length) },
        { label: 'DRIVES', value: String(totalDrives) },
        { label: 'STORAGE', value: formatDriverAnalysisSize(totalStorageBytes) }
      ]))
      const section = document.createElement('section')
      section.className = 'events-run-table-section'
      const heading = document.createElement('div')
      heading.className = 'events-run-table-section__heading'
      const headingH3 = document.createElement('h3')
      headingH3.textContent = 'CARS'
      const headingSpan = document.createElement('span')
      headingSpan.textContent = 'SELECT A CAR'
      heading.append(headingH3, headingSpan)
      section.append(heading)
      const tableWrap = document.createElement('div')
      tableWrap.className = 'events-run-table-wrap'
      const table = document.createElement('table')
      table.className = 'events-run-table'
      const caption = document.createElement('caption')
      caption.className = 'events-run-table__caption'
      caption.textContent = 'Select a car row to open its drives and statistics.'
      table.append(caption)
      const thead = document.createElement('thead')
      const headerRow = document.createElement('tr')
      for (const header of ['CAR', 'PI', 'DRIVETRAIN', 'DRIVES', 'DURATION', 'RESULT']) {
        const th = document.createElement('th')
        th.scope = 'col'
        th.textContent = header
        if (['DRIVES', 'DURATION'].includes(header)) th.className = 'events-run-table__end'
        headerRow.append(th)
      }
      thead.append(headerRow)
      table.append(thead)
      const tbody = document.createElement('tbody')
      for (const s of recording.sessions) {
        const row = document.createElement('tr')
        row.className = 'events-run-table__lap-row'
        row.tabIndex = 0
        const carLabel = FdcVehicle.displayName(s?.vehicleName, s?.vehicleIdentity?.ordinal)
        row.setAttribute('aria-label', `Open ${carLabel}`)
        row.addEventListener('click', () => {
          setDriverAnalysisView({ level: 'car', recordingId: String(recording.recordingId), sessionId: String(s?.id), driveId: null })
        })
        row.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          setDriverAnalysisView({ level: 'car', recordingId: String(recording.recordingId), sessionId: String(s?.id), driveId: null })
        })
        const carCell = document.createElement('th')
        carCell.scope = 'row'
        carCell.textContent = carLabel
        row.append(carCell)
        const pi = Number(s?.vehicleIdentity?.pi)
        const piCell = document.createElement('td')
        piCell.textContent = Number.isFinite(pi) ? String(pi) : '—'
        row.append(piCell)
        const drivetrain = globalScope.DriverAnalysisHistory?.drivetrainLabel?.(s?.vehicleIdentity?.drivetrain) || '—'
        const drivetrainCell = document.createElement('td')
        drivetrainCell.textContent = drivetrain
        row.append(drivetrainCell)
        const drivesCount = Array.isArray(s?.drives) ? s.drives.length : 0
        const drivesCell = document.createElement('td')
        drivesCell.className = 'events-run-table__end'
        drivesCell.textContent = String(drivesCount)
        row.append(drivesCell)
        const durationMs = Number(s?.durationMs) || 0
        const durationCell = document.createElement('td')
        durationCell.className = 'events-run-table__end'
        const durationTime = document.createElement('span')
        durationTime.className = 'events-run-table__time'
        durationTime.textContent = formatDriverAnalysisDuration(durationMs)
        durationCell.append(durationTime)
        row.append(durationCell)
        const resultCell = document.createElement('td')
        const headline = document.createElement('strong')
        const hd = driverAnalysisHeadline(s)
        headline.textContent = hd.label
        headline.dataset.result = hd.result
        resultCell.append(headline)
        row.append(resultCell)
        tbody.append(row)
      }
      table.append(tbody)
      tableWrap.append(table)
      section.append(tableWrap)
      driverAnalysisDetailBody?.append(section)
    } else if (driverAnalysisView.level === 'car') {
      const carLabel = FdcVehicle.displayName(session?.vehicleName, session?.vehicleIdentity?.ordinal)
      const pi = Number(session?.vehicleIdentity?.pi)
      const drivetrain = globalScope.DriverAnalysisHistory?.drivetrainLabel?.(session?.vehicleIdentity?.drivetrain) || ''
      if (driverAnalysisDetailTitle) driverAnalysisDetailTitle.textContent = carLabel
      const badges = []
      if (Number.isFinite(pi)) {
        const piBadge = document.createElement('span')
        piBadge.className = 'events-detail-view__badge'
        piBadge.textContent = `PI ${pi}`
        badges.push(piBadge)
      }
      if (drivetrain) {
        const drivetrainBadge = document.createElement('span')
        drivetrainBadge.className = 'events-detail-view__badge'
        drivetrainBadge.textContent = drivetrain
        badges.push(drivetrainBadge)
      }
      const drivesCount = Array.isArray(session?.drives) ? session.drives.length : 0
      const drivesBadge = document.createElement('span')
      drivesBadge.className = 'events-detail-view__badge'
      drivesBadge.textContent = `${drivesCount} ${drivesCount === 1 ? 'DRIVE' : 'DRIVES'}`
      badges.push(drivesBadge)
      const durationMs = Number(session?.durationMs) || 0
      const durationBadge = document.createElement('span')
      durationBadge.className = 'events-detail-view__badge'
      durationBadge.textContent = session?.status === 'recording' ? 'LIVE' : formatDriverAnalysisDuration(durationMs)
      badges.push(durationBadge)
      const recordedDate = new Date(session?.recordedAt)
      if (Number.isFinite(recordedDate.getTime())) {
        const dateBadge = document.createElement('span')
        dateBadge.className = 'events-detail-view__badge'
        dateBadge.textContent = recordedDate.toLocaleDateString()
        badges.push(dateBadge)
      }
      if (driverAnalysisDetailSummary) driverAnalysisDetailSummary.append(...badges)
      const hd = driverAnalysisHeadline(session)
      const resultSection = document.createElement('section')
      resultSection.className = 'driver-analysis-detail-view__result'
      const resultLabel = document.createElement('span')
      resultLabel.className = 'driver-analysis-detail-view__result-label'
      resultLabel.textContent = 'RESULT'
      const resultHeadline = document.createElement('strong')
      resultHeadline.className = 'driver-analysis-detail-view__result-headline'
      resultHeadline.textContent = hd.label
      resultHeadline.dataset.result = hd.result
      resultSection.append(resultLabel, resultHeadline)
      if (hd.instruction) {
        const resultText = document.createElement('p')
        resultText.className = 'driver-analysis-detail-view__result-text'
        resultText.textContent = hd.instruction
        resultSection.append(resultText)
      }
      driverAnalysisDetailBody?.append(resultSection)
      const summaryMetrics = globalScope.DriverAnalysisStats?.formatSummaryMetrics?.(session.stats) || []
      if (summaryMetrics.length > 0) driverAnalysisDetailBody?.append(driverAnalysisSummaryTiles(summaryMetrics))
      const statsRows = globalScope.DriverAnalysisStats?.formatStatsRows?.(session.stats) || []
      if (statsRows.length > 0) {
        const statsToggleButton = document.createElement('button')
        statsToggleButton.type = 'button'
        statsToggleButton.className = 'settings-button driver-analysis-detail-view__stats-toggle'
        const statsExpanded = expandedDriverAnalysisStats.has(sessionId)
        statsToggleButton.textContent = statsExpanded ? 'HIDE' : 'STATS'
        statsToggleButton.setAttribute('aria-expanded', String(statsExpanded))
        driverAnalysisDetailBody?.append(statsToggleButton)
        const statsPanel = document.createElement('div')
        statsPanel.className = 'driver-analysis-detail-view__stats'
        statsPanel.hidden = !statsExpanded
        for (const statsRow of statsRows) {
          const section = document.createElement('section')
          section.className = 'events-run-table-section'
          const sectionHeading = document.createElement('div')
          sectionHeading.className = 'events-run-table-section__heading'
          const sectionH3 = document.createElement('h3')
          sectionH3.textContent = statsRow.count !== null && Number.isFinite(statsRow.count)
            ? `${statsRow.label} (${statsRow.count})`
            : statsRow.label
          if (statsRow.title) section.title = statsRow.title
          sectionHeading.append(sectionH3)
          section.append(sectionHeading)
          if (Array.isArray(statsRow.items) && statsRow.items.length > 0) {
            const tableWrap = document.createElement('div')
            tableWrap.className = 'events-run-table-wrap'
            const table = document.createElement('table')
            table.className = 'events-run-table'
            const tbody = document.createElement('tbody')
            for (const item of statsRow.items) {
              const itemRow = document.createElement('tr')
              const nameCell = document.createElement('th')
              nameCell.scope = 'row'
              nameCell.textContent = item.name
              itemRow.append(nameCell)
              const valueCell = document.createElement('td')
              const valueSpan = document.createElement('span')
              valueSpan.className = 'events-run-table__time'
              valueSpan.textContent = item.value
              valueCell.append(valueSpan)
              itemRow.append(valueCell)
              tbody.append(itemRow)
            }
            table.append(tbody)
            tableWrap.append(table)
            section.append(tableWrap)
          }
          statsPanel.append(section)
        }
        statsToggleButton.addEventListener('click', () => {
          const isExpanded = statsToggleButton.getAttribute('aria-expanded') === 'true'
          statsToggleButton.setAttribute('aria-expanded', String(!isExpanded))
          statsToggleButton.textContent = isExpanded ? 'STATS' : 'HIDE'
          statsPanel.hidden = isExpanded
          if (isExpanded) expandedDriverAnalysisStats.delete(sessionId)
          else expandedDriverAnalysisStats.add(sessionId)
        })
        driverAnalysisDetailBody?.append(statsPanel)
      }
      const drivesRecorded = session?.drivesRecorded !== false
      if (drivesRecorded && Array.isArray(session?.drives) && session.drives.length > 0) {
        const drivesSection = document.createElement('section')
        drivesSection.className = 'events-run-table-section'
        const drivesHeading = document.createElement('div')
        drivesHeading.className = 'events-run-table-section__heading'
        const drivesH3 = document.createElement('h3')
        drivesH3.textContent = 'DRIVES'
        const drivesSpan = document.createElement('span')
        drivesSpan.textContent = 'SELECT A DRIVE TO OPEN ITS MAP'
        drivesHeading.append(drivesH3, drivesSpan)
        drivesSection.append(drivesHeading)
        const tableWrap = document.createElement('div')
        tableWrap.className = 'events-run-table-wrap'
        const drivesTable = document.createElement('table')
        drivesTable.className = 'events-run-table'
        const caption = document.createElement('caption')
        caption.className = 'events-run-table__caption'
        caption.textContent = 'Select a drive row to open its map.'
        drivesTable.append(caption)
        const thead = document.createElement('thead')
        const headerRow = document.createElement('tr')
        for (const colHeader of ['ID', 'TYPE', 'DURATION', 'START', 'ERRORS']) {
          const th = document.createElement('th')
          th.scope = 'col'
          th.textContent = colHeader
          if (colHeader === 'START') th.className = 'events-run-table__end'
          headerRow.append(th)
        }
        thead.append(headerRow)
        drivesTable.append(thead)
        const tbody = document.createElement('tbody')
        for (const drive of session.drives) {
          const driveRow = document.createElement('tr')
          const driveKey = String(drive?.id)
          driveRow.className = 'events-run-table__lap-row'
          driveRow.tabIndex = 0
          driveRow.setAttribute('aria-label', `Open drive ${driveKey} map`)
          driveRow.addEventListener('click', () => {
            setDriverAnalysisView({ level: 'drive', recordingId, sessionId, driveId: driveKey })
          })
          driveRow.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            setDriverAnalysisView({ level: 'drive', recordingId, sessionId, driveId: driveKey })
          })
          const idCell = document.createElement('th')
          idCell.scope = 'row'
          idCell.textContent = String(drive?.id || '')
          driveRow.append(idCell)
          const typeCell = document.createElement('td')
          typeCell.textContent = globalScope.DriverAnalysisHistory?.driveTypeLabel?.(drive) || 'UNKNOWN'
          driveRow.append(typeCell)
          const durationCell = document.createElement('td')
          const durationSpan = document.createElement('span')
          durationSpan.className = 'events-run-table__time'
          durationSpan.textContent = globalScope.DriverAnalysisHistory?.formatDriveDuration?.(drive?.durationMs) || '00:00'
          durationCell.append(durationSpan)
          driveRow.append(durationCell)
          const startCell = document.createElement('td')
          startCell.className = 'events-run-table__end'
          const startTime = new Date(drive?.startedWallMs)
          startCell.textContent = Number.isFinite(startTime.getTime())
            ? startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '—'
          driveRow.append(startCell)
          const errorsCell = document.createElement('td')
          const errorCount = globalScope.DriverAnalysisHistory?.driveErrorCount?.(drive) || 0
          errorsCell.textContent = errorCount > 0 ? String(errorCount) : '—'
          driveRow.append(errorsCell)
          tbody.append(driveRow)
        }
        drivesTable.append(tbody)
        tableWrap.append(drivesTable)
        drivesSection.append(tableWrap)
        driverAnalysisDetailBody?.append(drivesSection)
      } else if (!drivesRecorded) {
        const noRecordMsg = document.createElement('div')
        noRecordMsg.className = 'settings-empty'
        noRecordMsg.textContent = 'RECORDED BEFORE DRIVES'
        driverAnalysisDetailBody?.append(noRecordMsg)
      } else if (Array.isArray(session?.drives) && session.drives.length === 0 && drivesRecorded) {
        const noRacesMsg = document.createElement('div')
        noRacesMsg.className = 'settings-empty'
        noRacesMsg.textContent = 'NO RACES IN THIS RECORDING'
        driverAnalysisDetailBody?.append(noRacesMsg)
      }
    } else if (driverAnalysisView.level === 'drive') {
      const drive = session.drives.find(d => String(d?.id) === driveId)
      if (!drive) {
        setDriverAnalysisView({ level: 'car', recordingId, sessionId, driveId: null })
        return
      }
      const carLabel = FdcVehicle.displayName(session?.vehicleName, session?.vehicleIdentity?.ordinal)
      if (driverAnalysisDetailTitle) driverAnalysisDetailTitle.textContent = `DRIVE ${drive?.id || ''}`
      const badges = []
      const carBadge = document.createElement('span')
      carBadge.className = 'events-detail-view__badge'
      carBadge.textContent = carLabel
      badges.push(carBadge)
      const driveTypeBadge = document.createElement('span')
      driveTypeBadge.className = 'events-detail-view__badge'
      driveTypeBadge.textContent = globalScope.DriverAnalysisHistory?.driveTypeLabel?.(drive) || 'UNKNOWN'
      badges.push(driveTypeBadge)
      const startTime = new Date(drive?.startedWallMs)
      const timeBadge = document.createElement('span')
      timeBadge.className = 'events-detail-view__badge'
      timeBadge.textContent = Number.isFinite(startTime.getTime())
        ? startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '—'
      badges.push(timeBadge)
      const errorCount = globalScope.DriverAnalysisHistory?.driveErrorCount?.(drive) || 0
      if (driverAnalysisDetailSummary) driverAnalysisDetailSummary.append(...badges)
      const meta = document.createElement('div')
      meta.className = 'events-run-view__meta'
      const durationMetric = document.createElement('div')
      durationMetric.className = 'events-run-view__metric'
      const durationLabel = document.createElement('div')
      durationLabel.className = 'events-run-view__metric-label'
      durationLabel.textContent = 'DURATION'
      const durationValue = document.createElement('div')
      durationValue.className = 'events-run-view__metric-value'
      durationValue.textContent = globalScope.DriverAnalysisHistory?.formatDriveDuration?.(drive?.durationMs) || '00:00'
      durationMetric.append(durationLabel, durationValue)
      const errorsMetric = document.createElement('div')
      errorsMetric.className = 'events-run-view__metric events-run-view__metric--run'
      const errorsLabel = document.createElement('div')
      errorsLabel.className = 'events-run-view__metric-label'
      errorsLabel.textContent = 'ERRORS'
      const errorsValue = document.createElement('div')
      errorsValue.className = 'events-run-view__metric-value'
      errorsValue.textContent = String(errorCount)
      errorsMetric.append(errorsLabel, errorsValue)
      meta.append(durationMetric, errorsMetric)
      driverAnalysisDetailBody?.append(meta)
      const mapWrap = document.createElement('div')
      mapWrap.className = 'events-run-table-wrap'
      const mapDetail = document.createElement('div')
      mapDetail.className = 'events-lap-detail'
      mapDetail.append(driverAnalysisDriveMap(session, drive))
      mapWrap.append(mapDetail)
      driverAnalysisDetailBody?.append(mapWrap)
    }
  }

  async function deleteDriverAnalysisRecording(recording) {
    if (!recording || !Array.isArray(recording.sessions) || recording.sessions.length === 0) return false
    if (driverAnalysisHistoryPending || driverAnalysisExportPending) return false
    if (!(await confirmDestructive('Delete this Driver Analysis recording, all its cars, and saved telemetry?'))) return false
    if (driverAnalysisHistoryPending || driverAnalysisExportPending) return false
    driverAnalysisHistoryPending = true
    renderDriverAnalysisHistory()
    const sessionIds = recording.sessions.map(s => Number(s?.id)).filter(id => Number.isSafeInteger(id) && id > 0)
    try {
      await call('delete_driver_analysis_recording', { recordingId: Number(recording.recordingId) })
      driverAnalysisHistory = driverAnalysisHistory.filter(session => !sessionIds.includes(Number(session?.id)))
      const recordingId = String(recording.recordingId)
      if (driverAnalysisView.recordingId === recordingId) {
        setDriverAnalysisView({ level: 'history', recordingId: null, sessionId: null, driveId: null })
      }
      renderDriverAnalysisHistory()
      setStatus('DRIVER ANALYSIS RECORDING DELETED')
      return true
    } catch (error) {
      setStatus(error.message || 'Unable to delete Driver Analysis recording', true)
      return false
    } finally {
      driverAnalysisHistoryPending = false
      renderDriverAnalysisHistory()
    }
  }

  async function exportDriverAnalysisRecording(recording) {
    if (!recording || !Array.isArray(recording.sessions) || recording.sessions.length === 0) return false
    if (driverAnalysisHistoryPending || driverAnalysisExportPending) return false
    driverAnalysisExportPending = true
    driverAnalysisExportingId = Number(recording.recordingId)
    renderDriverAnalysisHistory()
    try {
      const fileName = globalScope.DriverAnalysisHistory.exportFileName(recording.sessions[0]?.recordedAt)
      const outcome = await call('export_driver_analysis_recording', { recordingId: Number(recording.recordingId), fileName })
      if (outcome?.cancelled) return false
      const size = formatDriverAnalysisSize(outcome?.bytes)
      setStatus(`DRIVER ANALYSIS RECORDING EXPORTED · ${size}`)
      return true
    } catch (error) {
      setStatus(error?.message || (typeof error === 'string' && error) || 'Unable to export Driver Analysis recording', true)
      return false
    } finally {
      driverAnalysisExportPending = false
      driverAnalysisExportingId = null
      renderDriverAnalysisHistory()
    }
  }

  function renderDriverAnalysisHistory(history = driverAnalysisHistory) {
    if (!driverAnalysisHistoryList) return
    const entries = Array.isArray(history) ? history : []
    driverAnalysisHistory = entries
    driverAnalysisHistoryList.replaceChildren()
    if (driverAnalysisHistoryEmpty) driverAnalysisHistoryEmpty.hidden = entries.length > 0

    const recordings = globalScope.DriverAnalysisHistory?.groupRecordings?.(entries) || []
    if (driverAnalysisHistoryCount) {
      driverAnalysisHistoryCount.textContent = `${recordings.length} ${recordings.length === 1 ? 'RECORDING' : 'RECORDINGS'}`
    }

    for (const recording of recordings) {
      const recordingId = String(recording.recordingId)
      const firstSession = recording.sessions[0]
      const hasUnfinishedSessions = recording.sessions.some(s => s?.status === 'recording')

      const row = document.createElement('article')
      row.className = 'driver-analysis-history-row'
      row.dataset.recordingId = recordingId

      const meta = document.createElement('div')
      meta.className = 'driver-analysis-history-row__meta'
      const date = document.createElement('time')
      const recordedDate = new Date(firstSession?.recordedAt)
      date.dateTime = Number.isFinite(recordedDate.getTime()) ? recordedDate.toISOString() : ''
      date.textContent = formatDriverAnalysisDate(firstSession?.recordedAt)

      const totalDurationMs = globalScope.DriverAnalysisHistory?.recordingDurationMs?.(recording.sessions) ?? 0
      const duration = document.createElement('span')
      duration.textContent = hasUnfinishedSessions ? 'LIVE' : formatDriverAnalysisDuration(totalDurationMs)

      const totalStorageBytes = recording.sessions.reduce((sum, s) => sum + (Number(s?.storageBytes) || 0), 0)
      const storage = document.createElement('span')
      storage.textContent = formatDriverAnalysisSize(totalStorageBytes)

      const totalDrives = recording.sessions.reduce((sum, s) => sum + (Array.isArray(s?.drives) ? s.drives.length : 0), 0)
      const carsDrivesLabel = document.createElement('span')
      carsDrivesLabel.className = 'driver-analysis-history-row__cars-drives'
      const carCount = recording.sessions.length
      const driveText = totalDrives === 1 ? '1 DRIVE' : (totalDrives > 0 ? `${totalDrives} DRIVES` : '')
      carsDrivesLabel.textContent = `${carCount} ${carCount === 1 ? 'CAR' : 'CARS'}${driveText ? ' · ' + driveText : ''}`

      meta.append(date, duration, storage, carsDrivesLabel)

      const finding = document.createElement('div')
      finding.className = 'driver-analysis-history-row__finding'

      for (const session of recording.sessions) {
        const sessionLine = document.createElement('div')
        sessionLine.className = 'driver-analysis-history-row__session-line'

        const carName = FdcVehicle.displayName(session?.vehicleName, session?.vehicleIdentity?.ordinal)
        const sessionCarLabel = document.createElement('span')
        sessionCarLabel.className = 'driver-analysis-history-row__session-car'
        sessionCarLabel.textContent = carName

        const headline = document.createElement('strong')
        const hd = driverAnalysisHeadline(session)
        headline.textContent = hd.label
        headline.dataset.result = hd.result

        sessionLine.append(sessionCarLabel, document.createTextNode(' — '), headline)
        finding.append(sessionLine)
      }

      // Totals across different cars say little, so only a single-car card shows them.
      const summaryText = recording.sessions.length === 1
        ? globalScope.DriverAnalysisHistory?.recordingSummary?.(recording.sessions) || ''
        : ''
      if (summaryText) {
        const summary = document.createElement('div')
        summary.className = 'driver-analysis-history-row__summary'
        summary.textContent = summaryText
        finding.append(summary)
      }

      row.append(meta, finding)

      const actions = document.createElement('div')
      actions.className = 'driver-analysis-history-row__actions'
      if (recording.sessions.length > 0 && !hasUnfinishedSessions) {
        const detailsButton = document.createElement('button')
        detailsButton.type = 'button'
        detailsButton.className = 'settings-button settings-button--ready driver-analysis-history-row__details-toggle'
        detailsButton.textContent = 'DETAILS'
        detailsButton.addEventListener('click', () => {
          if (recording.sessions.length === 1) {
            setDriverAnalysisView({ level: 'car', recordingId, sessionId: String(recording.sessions[0]?.id), driveId: null })
          } else {
            setDriverAnalysisView({ level: 'recording', recordingId, sessionId: null, driveId: null })
          }
        })
        actions.append(detailsButton)
      }

      const actionsBlocked = driverAnalysisHistoryPending || driverAnalysisExportPending || hasUnfinishedSessions || driverAnalysisState.recording === true
      const firstDate = formatDriverAnalysisDate(firstSession?.recordedAt)
      const exportButton = document.createElement('button')
      exportButton.className = 'settings-button driver-analysis-history-row__export'
      exportButton.type = 'button'
      const isExporting = driverAnalysisExportPending && driverAnalysisExportingId === Number(recording.recordingId)
      if (isExporting) {
        exportButton.textContent = 'EXPORTING…'
        exportButton.classList.add('is-exporting')
        exportButton.setAttribute('aria-busy', 'true')
      } else {
        exportButton.textContent = 'EXPORT'
      }
      exportButton.disabled = actionsBlocked
      exportButton.setAttribute('aria-label', `Export Driver Analysis recording from ${firstDate}`)
      exportButton.addEventListener('click', () => void exportDriverAnalysisRecording(recording))
      const remove = document.createElement('button')
      remove.className = 'settings-button settings-button--danger driver-analysis-history-row__delete'
      remove.type = 'button'
      remove.textContent = 'DELETE'
      remove.disabled = actionsBlocked
      remove.setAttribute('aria-label', `Delete Driver Analysis recording from ${firstDate}`)
      remove.addEventListener('click', () => void deleteDriverAnalysisRecording(recording))
      actions.append(exportButton, remove)

      row.append(actions)
      driverAnalysisHistoryList.append(row)
    }
  }

  // A drive map is built once from the stored samples and checks of that drive and kept while Configuration is open.
  function driverAnalysisDriveMap(session, drive) {
    const key = String(drive?.id)
    const cached = driverAnalysisDriveMaps.get(key)
    if (cached?.element) return cached.element
    const holder = document.createElement('div')
    holder.className = 'driver-analysis-history-row__drive-map'
    const status = document.createElement('p')
    status.className = 'events-lap-detail__empty'
    status.textContent = cached?.error ? 'THE DRIVE MAP COULD NOT BE LOADED' : 'LOADING DRIVE MAP…'
    holder.append(status)
    if (!cached) {
      driverAnalysisDriveMaps.set(key, { loading: true })
      void loadDriverAnalysisDriveMap(session, drive).then(element => {
        driverAnalysisDriveMaps.set(key, { element })
        renderDriverAnalysisView()
      }).catch(() => {
        driverAnalysisDriveMaps.set(key, { error: true })
        renderDriverAnalysisView()
      })
    }
    return holder
  }

  async function loadDriverAnalysisDriveMap(session, drive) {
    const sessionId = Number(session?.id)
    const lastSequence = Number(drive?.lastSequence)
    const samples = []
    let afterSequence = Number(drive?.firstSequence) - 1
    while (afterSequence < lastSequence) {
      const page = await call('load_driver_analysis_samples', { sessionId, afterSequence, limit: 5000 })
      if (!Array.isArray(page) || page.length === 0) break
      samples.push(...page.filter(sample => Number(sample?.sequence) <= lastSequence))
      afterSequence = Number(page.at(-1)?.sequence)
      if (page.length < 5000) break
    }
    const checks = await call('load_driver_analysis_checks', {
      sessionId,
      startedAtMs: Number(drive?.startedAtMs),
      finishedAtMs: Number(drive?.finishedAtMs)
    })
    const mapApi = globalScope.DriverAnalysisMap
    const points = mapApi?.tracePointsFromSamples(samples) || []
    return renderTraceMap(points, Number(drive?.durationMs), {
      marks: mapApi?.checkMarks(Array.isArray(checks) ? checks : [], points) || { errors: [], clean: [] },
      sectorTicks: false,
      emptyText: 'NO POSITION DATA WAS SAVED FOR THIS DRIVE',
      selection: {
        get: () => driveMapLayerSelection,
        set: value => { driveMapLayerSelection = value }
      }
    })
  }

  async function loadDriverAnalysisHistory() {
    try {
      const history = await call('load_driver_analysis_sessions')
      renderDriverAnalysisHistory(Array.isArray(history) ? history : [])
      // A reload rebuilds the open page from the new history, or returns to it when that recording is gone.
      renderDriverAnalysisView()
      return driverAnalysisHistory
    } catch (error) {
      renderDriverAnalysisHistory([])
      setStatus(error.message || 'Unable to load Driver Analysis history', true)
      return []
    }
  }

  function renderDriverAnalysisState(value = driverAnalysisState) {
    driverAnalysisState = {
      ...driverAnalysisState,
      ...(value && typeof value === 'object' ? value : {}),
      enabled: value?.enabled === true,
      recording: value?.recording === true,
      phase: typeof value?.phase === 'string' ? value.phase : value?.recording === true ? 'recording' : value?.enabled === true ? 'ready' : 'off',
      hotkey: driverAnalysisApi?.normalizeHotkey?.(value?.hotkey) || driverAnalysisSettings.hotkey
    }
    const { enabled, recording, hotkey, phase } = driverAnalysisState
    const busy = driverAnalysisActionPending || phase === 'finalizing'
    const waiting = phase === 'waiting'
    const failed = phase === 'error'
    updateOverlayToggle(driverAnalysisEnabled, enabled)
    driverAnalysisEnabled.disabled = recording || busy
    driverAnalysisRecord.disabled = !enabled || busy
    driverAnalysisRecord.textContent = recording || waiting ? 'STOP' : busy ? 'SAVING' : 'RECORD'
    driverAnalysisRecord.setAttribute('aria-pressed', String(recording))
    driverAnalysisRecord.classList.toggle('settings-button--danger', recording || waiting)
    driverAnalysisRecord.classList.toggle('driver-analysis-record--ready', enabled && !recording && !waiting && !busy)
    driverAnalysisHotkeyChange.disabled = !enabled || recording || waiting || busy
    driverAnalysisHotkeyValue.textContent = driverAnalysisHotkeyCapture
      ? 'PRESS KEYS OR A BUTTON'
      : driverAnalysisApi?.formatHotkey?.(hotkey, driverAnalysisSettings.hotkeyLabel) || hotkey
    driverAnalysisRecordingStatus.dataset.state = phase
    driverAnalysisRecordingStatus.textContent = phase.toUpperCase()
    driverAnalysisRecorderHint.textContent = busy
      ? 'Saving telemetry and completing the analysis.'
      : waiting
        ? 'Waiting for valid Forza telemetry. Recording starts automatically when data arrives.'
        : recording
          ? 'Drive the asphalt session, then press Stop or use the global hotkey.'
          : failed
            ? 'The last recording could not be saved. Start a new session when ready.'
            : enabled
              ? 'Record one asphalt session. FDC will save one recurring problem.'
              : 'Enable Driver Analysis to start recording.'
    renderDriverAnalysisHistory()
  }

  function emitDriverAnalysisConfig(payload) {
    const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
    if (!eventApi || typeof eventApi.emit !== 'function') {
      return Promise.reject(new Error('Driver Analysis event bridge is unavailable'))
    }
    return eventApi.emit('driver_analysis_config', payload)
  }

  async function setDriverAnalysisEnabled(enabled) {
    if (driverAnalysisState.recording) return
    driverAnalysisSettings = driverAnalysisApi.writeSettings({ ...driverAnalysisSettings, enabled })
    renderDriverAnalysisState({ ...driverAnalysisState, enabled })
    try {
      await emitDriverAnalysisConfig({ enabled, hotkey: driverAnalysisSettings.hotkey })
      const hotkeyReady = enabled
        ? await setDriverAnalysisHotkey(driverAnalysisSettings.hotkey, false, driverAnalysisSettings.hotkeyLabel)
        : await call('clear_driver_analysis_hotkey').then(() => true, error => {
          setStatus(error.message || 'Unable to clear Driver Analysis hotkey', true)
          return false
        })
      if (hotkeyReady) setStatus(`DRIVER ANALYSIS ${enabled ? 'ENABLED' : 'DISABLED'}`)
    } catch (error) {
      driverAnalysisSettings = driverAnalysisApi.writeSettings({ ...driverAnalysisSettings, enabled: !enabled })
      renderDriverAnalysisState({ ...driverAnalysisState, enabled: !enabled })
      setStatus(error.message || 'Unable to update Driver Analysis', true)
    }
  }

  async function setDriverAnalysisHotkey(hotkey, announce = true, hotkeyLabel = '') {
    const normalized = driverAnalysisApi?.normalizeHotkey?.(hotkey)
    if (!normalized) {
      if (announce) setStatus('USE CTRL, ALT OR SHIFT WITH ONE KEY. WINDOWS KEY IS NOT ALLOWED.', true)
      return false
    }
    if (normalized === hudEditHotkeySettings.hotkey) {
      if (announce) setStatus('THAT HOTKEY IS ALREADY USED BY HUD EDIT', true)
      return false
    }
    if (!driverAnalysisSettings.enabled) {
      driverAnalysisSettings = driverAnalysisApi.writeSettings({ ...driverAnalysisSettings, hotkey: normalized, hotkeyLabel })
      return true
    }
    try {
      const registered = await call('set_driver_analysis_hotkey', { hotkey: normalized })
      driverAnalysisSettings = driverAnalysisApi.writeSettings({ ...driverAnalysisSettings, hotkey: registered, hotkeyLabel })
      driverAnalysisState.hotkey = registered
      await emitDriverAnalysisConfig({ enabled: driverAnalysisSettings.enabled, hotkey: registered })
      renderDriverAnalysisState(driverAnalysisState)
      if (announce) {
        const formatted = driverAnalysisApi.formatHotkey(registered, driverAnalysisSettings.hotkeyLabel).toUpperCase()
        setStatus(`DRIVER ANALYSIS HOTKEY SET TO ${formatted}`)
      }
      return true
    } catch (error) {
      renderDriverAnalysisState(driverAnalysisState)
      setStatus(error.message || 'Unable to register Driver Analysis hotkey', true)
      return false
    }
  }

  async function sendDriverAnalysisAction(action) {
    if (driverAnalysisActionPending) return
    driverAnalysisActionPending = true
    renderDriverAnalysisState(driverAnalysisState)
    try {
      await emitDriverAnalysisConfig({
        action,
        enabled: driverAnalysisSettings.enabled,
        hotkey: driverAnalysisSettings.hotkey
      })
    } catch (error) {
      setStatus(error.message || 'Unable to update Driver Analysis recording', true)
    } finally {
      driverAnalysisActionPending = false
      renderDriverAnalysisState(driverAnalysisState)
    }
  }

  async function setDriverAnalysisHotkeyCapture(active) {
    const wasActive = driverAnalysisHotkeyCapture
    driverAnalysisHotkeyCapture = active === true
    if (driverAnalysisHotkeyCapture && hudEditHotkeyCapture) await setHudEditHotkeyCapture(false)
    driverAnalysisHotkeyChange.textContent = driverAnalysisHotkeyCapture ? 'CANCEL' : 'CHANGE'
    renderDriverAnalysisState(driverAnalysisState)
    if (driverAnalysisHotkeyCapture) {
      setStatus('PRESS A KEY COMBINATION OR A CONTROLLER BUTTON')
      try {
        await call('start_controller_capture')
      } catch {
        setStatus('CONTROLLER CAPTURE UNAVAILABLE. PRESS A KEY COMBINATION.', true)
      }
    } else if (wasActive) {
      try {
        await call('stop_controller_capture')
      } catch {
      }
    }
  }

  // The HUD edit hotkey is always registered: pressing it in Forza starts a layout edit
  // over the running game, and pressing it again saves.
  function readHudEditHotkeySettings() {
    try {
      const stored = JSON.parse(globalScope.localStorage?.getItem(HUD_EDIT_HOTKEY_STORAGE_KEY) || 'null')
      const hotkey = driverAnalysisApi?.normalizeHotkey?.(stored?.hotkey) || DEFAULT_HUD_EDIT_HOTKEY
      const hotkeyLabel = hotkey.startsWith('Controller:') && typeof stored?.hotkeyLabel === 'string' ? stored.hotkeyLabel.trim().slice(0, 80) : ''
      return { hotkey, hotkeyLabel }
    } catch {
      return { hotkey: DEFAULT_HUD_EDIT_HOTKEY, hotkeyLabel: '' }
    }
  }

  function writeHudEditHotkeySettings(hotkey, hotkeyLabel) {
    hudEditHotkeySettings = { hotkey, hotkeyLabel: hotkey.startsWith('Controller:') ? hotkeyLabel : '' }
    try { globalScope.localStorage?.setItem(HUD_EDIT_HOTKEY_STORAGE_KEY, JSON.stringify(hudEditHotkeySettings)) } catch { /* restricted webview */ }
  }

  function renderHudEditHotkey() {
    if (!hudEditHotkeyValue || !hudEditHotkeyChange) return
    hudEditHotkeyChange.textContent = hudEditHotkeyCapture ? 'CANCEL' : 'CHANGE'
    hudEditHotkeyValue.textContent = hudEditHotkeyCapture
      ? 'PRESS KEYS OR A BUTTON'
      : driverAnalysisApi?.formatHotkey?.(hudEditHotkeySettings.hotkey, hudEditHotkeySettings.hotkeyLabel) || hudEditHotkeySettings.hotkey
  }

  async function setHudEditHotkey(hotkey, announce = true, hotkeyLabel = '') {
    const normalized = driverAnalysisApi?.normalizeHotkey?.(hotkey)
    if (!normalized) {
      if (announce) setStatus('USE CTRL, ALT OR SHIFT WITH ONE KEY. WINDOWS KEY IS NOT ALLOWED.', true)
      return false
    }
    if (normalized === driverAnalysisSettings.hotkey) {
      setStatus('THAT HOTKEY IS ALREADY USED BY DRIVER ANALYSIS', true)
      return false
    }
    try {
      const registered = await call('set_hud_edit_hotkey', { hotkey: normalized })
      writeHudEditHotkeySettings(registered, hotkeyLabel)
      renderHudEditHotkey()
      if (announce) {
        const formatted = driverAnalysisApi.formatHotkey(registered, hudEditHotkeySettings.hotkeyLabel).toUpperCase()
        setStatus(`HUD EDIT HOTKEY SET TO ${formatted}`)
      }
      return true
    } catch (error) {
      renderHudEditHotkey()
      setStatus(error.message || 'Unable to register HUD edit hotkey', true)
      return false
    }
  }

  async function setHudEditHotkeyCapture(active) {
    const wasActive = hudEditHotkeyCapture
    hudEditHotkeyCapture = active === true
    if (hudEditHotkeyCapture && driverAnalysisHotkeyCapture) await setDriverAnalysisHotkeyCapture(false)
    renderHudEditHotkey()
    if (hudEditHotkeyCapture) {
      setStatus('PRESS A KEY COMBINATION OR A CONTROLLER BUTTON')
      try {
        await call('start_controller_capture')
      } catch {
        setStatus('CONTROLLER CAPTURE UNAVAILABLE. PRESS A KEY COMBINATION.', true)
      }
    } else if (wasActive) {
      try {
        await call('stop_controller_capture')
      } catch {
      }
    }
  }

  async function listenHudEditHotkeyEvents() {
    const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
    if (!eventApi || typeof eventApi.listen !== 'function') return
    await eventApi.listen('driver_analysis_controller_captured', async event => {
      if (!hudEditHotkeyCapture) return
      const binding = event?.payload?.binding
      const deviceName = event?.payload?.deviceName || ''
      if (!binding) return
      await setHudEditHotkeyCapture(false)
      await setHudEditHotkey(binding, true, deviceName)
    })
  }

  async function listenDriverAnalysisEvents() {
    const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
    if (!eventApi || typeof eventApi.listen !== 'function') return
    await eventApi.listen('driver_analysis_status', event => renderDriverAnalysisState(event?.payload || {}))
    await eventApi.listen('driver_analysis_history', () => void loadDriverAnalysisHistory())
    await eventApi.listen('driver_analysis_result', event => {
      const entry = event?.payload
      setStatus(entry?.result === 'issue'
        ? `ANALYSIS SAVED · ${entry.label}`
        : entry?.result === 'no_recurring_problem'
          ? 'ANALYSIS SAVED · NO RECURRING PROBLEM'
          : 'ANALYSIS SAVED · MORE EVIDENCE NEEDED')
      void loadDriverAnalysisHistory()
    })
    await eventApi.listen('driver_analysis_controller_captured', async event => {
      if (!driverAnalysisHotkeyCapture) return
      const binding = event?.payload?.binding
      const deviceName = event?.payload?.deviceName || ''
      if (!binding) return
      await setDriverAnalysisHotkeyCapture(false)
      await setDriverAnalysisHotkey(binding, true, deviceName)
    })
    await eventApi.emit('driver_analysis_status_request')
  }

  async function loadAppVersion() {
    if (!appVersion) return
    try {
      const version = await call('get_app_version')
      if (typeof version !== 'string' || !version.trim()) return
      const normalizedVersion = version.trim().replace(/^v/u, '')
      appVersionNumber = normalizedVersion
      appVersion.textContent = `v${normalizedVersion}`
      appVersion.disabled = false
    } catch {
      // Preserve the unavailable-version fallback when the native command is unavailable.
    }
  }

  function renderDisplayPreferences(preferences) {
    for (const input of speedUnitInputs) {
      input.checked = input.value === preferences.speedUnit
    }
    for (const input of distanceUnitInputs) {
      input.checked = input.value === preferences.distanceUnit
    }
    renderRedlineBrightness(preferences.redlineBrightness)
    renderShiftLightBrightness(preferences.shiftLightBrightness)
    renderHudOpacity(preferences.hudOpacity)
    if (configurationAlwaysOnTop) updateOverlayToggle(configurationAlwaysOnTop, preferences.configurationAlwaysOnTop === true)
    if (showHudWithTelemetry) updateOverlayToggle(showHudWithTelemetry, preferences.showHudWithTelemetry !== false)
    if (fdcShiftLightEnabled) updateOverlayToggle(fdcShiftLightEnabled, preferences.fdcShiftLightEnabled !== false)
  }

  function renderRedlineBrightness(value) {
    const brightness = Number(value)
    const isDefault = brightness === DEFAULT_REDLINE_BRIGHTNESS
    const minimum = Number(redlineBrightness.min)
    const maximum = Number(redlineBrightness.max)
    const progress = ((brightness - minimum) / (maximum - minimum)) * 100
    redlineBrightness.value = String(brightness)
    redlineBrightness.style.setProperty('--brightness-fill', `${Math.max(0, Math.min(100, progress))}%`)
    redlineBrightness.setAttribute('aria-valuetext', `${brightness}% brightness`)
    redlineBrightnessValue.textContent = `${brightness}%`
    redlineBrightnessReset.disabled = displayPreferencesPending || isDefault
    redlineBrightnessReset.classList.toggle('is-dirty', !isDefault)
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
    for (const input of distanceUnitInputs) input.disabled = pending
    if (configurationAlwaysOnTop) configurationAlwaysOnTop.disabled = pending
    if (showHudWithTelemetry) showHudWithTelemetry.disabled = pending
    if (fdcShiftLightEnabled) fdcShiftLightEnabled.disabled = pending
    redlineBrightness.disabled = pending
    redlineBrightnessReset.disabled = pending || displayPreferences.redlineBrightness === DEFAULT_REDLINE_BRIGHTNESS
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

    const unitsChanged = previous.speedUnit !== next.speedUnit || previous.distanceUnit !== next.distanceUnit

    try {
      await call('set_display_preferences', {
        speedUnit: next.speedUnit,
        redlineBrightness: next.redlineBrightness,
        shiftLightBrightness: next.shiftLightBrightness,
        hudOpacity: next.hudOpacity,
        fdcShiftLightEnabled: next.fdcShiftLightEnabled,
        showHudWithTelemetry: next.showHudWithTelemetry
      })
      setStatus(successMessage(next))
      if (unitsChanged) {
        renderUnitDependentViews()
      }
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

  function renderHudComponentVisibility(component, visible) {
    for (const input of document.querySelectorAll('[data-hud-component]')) {
      if (input.dataset.hudComponent === component) input.checked = visible
    }
    for (const button of document.querySelectorAll('[data-hud-toggle]')) {
      if (button.dataset.hudToggle === component) updateOverlayToggle(button, visible)
    }
    renderAllToggle()
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
    renderConnectionGuide()
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

  // Matches the in-game HUD number format (for example 8,200 RPM).
  const SHIFT_LIGHT_RPM_FORMAT = new Intl.NumberFormat('en-US')

  function formatRpm(value) {
    return Number.isFinite(value) ? `${SHIFT_LIGHT_RPM_FORMAT.format(Math.round(value))} RPM` : '—'
  }

  function formatDelta(value) {
    return Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(1)}%` : '—'
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

  // The Shift Light car key is fh6:<ordinal>:<class>:<pi>:..., so the class
  // is read from it and falls back to the Garage variant with the same PI.
  function renderShiftLightCarClass(state, vehicle) {
    shiftLightCarPi.replaceChildren()
    const pi = state.pi
    const keyClass = typeof state.carKey === 'string' ? state.carKey.split(':')[2] : ''
    const variant = garageVariantsFor(vehicle).find(candidate => candidate?.pi === pi)
    const classLabel = (/^\d+$/.test(keyClass) ? garageApi?.classLabel?.(Number(keyClass)) : null)
      || variant?.classLabel
      || (variant?.class !== null && variant?.class !== undefined ? garageApi?.classLabel?.(variant.class) : null)
    if (!classLabel && !pi) {
      shiftLightCarPi.textContent = '—'
      return
    }
    appendGaragePerformance(shiftLightCarPi, { classLabel, pi })
  }

  function renderShiftLightState(value) {
    const state = typeof normalizeShiftLightState === 'function'
      ? normalizeShiftLightState(value)
      : value
    latestShiftLightState = state
    const hasProfile = Boolean(state?.carKey && state?.carOrdinal)
    shiftLightEmpty.hidden = hasProfile
    shiftLightProfile.hidden = !hasProfile
    shiftLightReset.hidden = !hasProfile
    shiftLightReset.disabled = !hasProfile || shiftLightResetPending
    if (!hasProfile) return

    const garageVehicle = state.gameId === 'fh6' && state.carOrdinal ? garageVehicles.get(state.carOrdinal) : null
    shiftLightCarKey.textContent = FdcVehicle.displayName(garageVehicle?.name, state.carOrdinal)
    renderShiftLightCarClass(state, garageVehicle)
    shiftLightCarRpmMax.textContent = state.rpmMax ? formatRpm(state.rpmMax) : '—'
    shiftLightUsableCeiling.textContent = state.usableCeiling
      ? `${formatRpm(state.usableCeiling)} · ${state.ceilingSampleCount}/3`
      : state.ceilingSampleCount > 0 ? `LEARNING · ${state.ceilingSampleCount}/3` : 'NOT OBSERVED'
    const activeGear = state.gears.find(gear => gear.gear === state.currentGear)
    const activeStatus = activeGear?.status || 'learning'
    const fallbackTarget = state.usableCeiling || state.fallbackShiftRpm || state.reportedRedlineRpm || state.rpmMax
    const activeTarget = activeStatus === 'learning'
      ? fallbackTarget
      : activeGear?.shiftRpm ?? state.shiftRpm
    shiftLightCurrentTarget.textContent = activeTarget
      ? `${activeStatus === 'optimal' ? 'OPTIMAL' : activeStatus === 'potential' ? 'POTENTIAL' : 'LEARNING'} · ${formatRpm(activeTarget)}`
      : fallbackTarget
        ? `LEARNING · ${formatRpm(fallbackTarget)}`
        : 'WAITING FOR RPM LIMIT'
    const activeState = activeStatus === 'potential'
      ? `POTENTIAL ${Math.max(1, activeGear?.confirmationCount || 1)}/3`
      : activeStatus.toUpperCase()
    shiftLightState.textContent = `${activeState}${state.currentGear ? ` · GEAR ${state.currentGear}` : ''}`
    shiftLightGearRows.replaceChildren()

    const diagnosticsByGear = new Map((state.diagnostics || []).map(diagnostic => [diagnostic.gear, diagnostic]))

    for (const gear of state.gears) {
      const diagnostic = diagnosticsByGear.get(gear.gear)
      const diagnosticStatus = diagnostic?.status || gear.status
      const row = document.createElement('tr')
      row.dataset.state = diagnosticStatus

      const gearCell = document.createElement('th')
      gearCell.scope = 'row'
      gearCell.textContent = `G${gear.gear}`
      row.append(gearCell)

      const targetCell = document.createElement('td')
      appendCellText(
        targetCell,
        formatRpm(diagnostic?.targetRpm ?? gear.shiftRpm ?? (gear.status === 'learning' ? fallbackTarget : null)),
        gear.status === 'potential'
          ? `POTENTIAL · ${Math.max(1, diagnostic?.confirmationCount ?? gear.confirmationCount)}/3`
          : gear.status === 'optimal'
            ? 'PURPLE CUE ACTIVE'
            : 'REDLINE FALLBACK'
      )
      row.append(targetCell)

      const powerCell = document.createElement('td')
      appendCellText(
        powerCell,
        `${diagnostic?.acceptedShiftCount ?? gear.acceptedShiftCount ?? gear.sampleCount} ACCEPTED`,
        Number.isFinite(diagnostic?.lastDeltaPct ?? gear.lastDeltaPct)
          ? `LAST Δ ${formatDelta(diagnostic?.lastDeltaPct ?? gear.lastDeltaPct)}`
          : 'WAITING FOR AN ACCEPTED SHIFT'
      )
      row.append(powerCell)

      const dataCell = document.createElement('td')
      const lastRpm = gear.lastRpmBefore ?? null
      appendCellText(
        dataCell,
        Number.isFinite(gear.lastDeltaPct) ? `${formatDelta(gear.lastDeltaPct)} POWER DELTA` : 'NO LAST SHIFT',
        Number.isFinite(lastRpm) ? `RECORDED ${formatRpm(lastRpm)}` : 'WAITING FOR A COMPARABLE UPSHIFT'
      )
      row.append(dataCell)

      const stateCell = document.createElement('td')
      stateCell.className = 'events-run-table__end'
      appendCellText(
        stateCell,
        diagnosticStatus === 'potential'
          ? `POTENTIAL ${Math.max(1, diagnostic?.confirmationCount ?? gear.confirmationCount)}/3`
          : diagnosticStatus.toUpperCase(),
        diagnosticStatus === 'learning' ? 'REDLINE FALLBACK ACTIVE' : ''
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

    if (state.persistenceError) {
      setStatus(`SHIFT LIGHT SAVE ERROR · ${state.persistenceError}`, true)
    }
  }

  async function requestShiftLightReset() {
    const carKey = latestShiftLightState?.carKey
    if (shiftLightResetPending || !carKey) return
    const reset = globalScope.__TAURI_INTERNALS__?.invoke
    if (typeof reset !== 'function') {
      setStatus('TAURI COMMANDS ARE UNAVAILABLE', true)
      return
    }
    if (!(await confirmDestructive('Reset the calibration of the current car? Its learned shift points are deleted and learning starts again.'))) return
    if (shiftLightResetPending) return
    // The answer was given for the car shown when the question opened; a different car is never reset.
    if (latestShiftLightState?.carKey !== carKey) {
      setStatus('CURRENT CAR CHANGED. CALIBRATION NOT RESET', true)
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
    await eventApi.listen('hud_route_status', event => {
      routeStatusReceived = true
      renderRouteStatus(event.payload)
    })
    await call('sync_route_status')
  }

  function normalizeLayoutMode(value) {
    return value === 'freeform' ? 'freeform' : 'grouped'
  }

  function readLayoutMode() {
    try {
      return normalizeLayoutMode(localStorage.getItem(LAYOUT_MODE_STORAGE_KEY))
    } catch {
      return 'grouped'
    }
  }

  function persistLayoutMode(mode) {
    try {
      localStorage.setItem(LAYOUT_MODE_STORAGE_KEY, mode)
    } catch {
      // A restricted webview may not expose persistent storage.
    }
  }

  function renderLayoutMode(mode) {
    layoutMode = normalizeLayoutMode(mode)
    for (const input of layoutModeInputs) input.checked = input.value === layoutMode
    renderLayoutEditRow()
  }

  function renderLayoutEditRow() {
    const editBtn = document.getElementById('hud-layout-edit')
    const resetBtn = document.getElementById('hud-layout-reset')
    const saveBtn = document.getElementById('hud-layout-save')
    const cancelBtn = document.getElementById('hud-layout-cancel')

    const editing = Boolean(editingTarget)
    editBtn.hidden = editing
    resetBtn.hidden = editing
    saveBtn.hidden = !editing
    cancelBtn.hidden = !editing
    const status = document.getElementById('hud-layout-status')
    if (status) status.hidden = !editing
    const hint = document.getElementById('hud-layout-edit-hint')
    if (hint) {
      hint.textContent = editing
        ? 'Drag the blocks on the screen, then save or cancel. In Forza, the hotkey also saves.'
        : 'Move and resize the HUD blocks right on the screen.'
    }
    syncHudDisplayDisabled()
  }

  async function selectLayoutMode(mode) {
    const nextMode = normalizeLayoutMode(mode)
    if (nextMode === layoutMode) return
    const previousMode = layoutMode

    try {
      if (editingTarget) {
        await call('layout_action', { action: 'cancel', target: editingTarget })
        editingTarget = null
        renderLayoutEditRow()
      }
      await call('set_layout_mode', { mode: nextMode })
      persistLayoutMode(nextMode)
      layoutMode = normalizeLayoutMode(mode)
      for (const input of layoutModeInputs) input.checked = input.value === layoutMode
      renderLayoutEditRow()
      setStatus(`${nextMode.toUpperCase()} HUD LAYOUT ENABLED`)
    } catch (error) {
      layoutMode = previousMode
      for (const input of layoutModeInputs) input.checked = input.value === layoutMode
      setStatus(error.message || 'Unable to change HUD layout mode', true)
    }
  }

  function cancelEdit() {
    editingTarget = null
    renderLayoutEditRow()
    setStatus('READY')
  }

  function setLayoutEditingState(target, isEditing) {
    if (!Object.hasOwn(LAYOUT_TARGET_LABELS, target)) return

    if (isEditing) {
      editingTarget = target
      renderLayoutEditRow()
      setStatus('EDITING — DRAG BLOCKS ON THE SCREEN')
      return
    }

    if (editingTarget === target) {
      editingTarget = null
      renderLayoutEditRow()
      setStatus('LAYOUT SAVED')
    }
  }

  const hudLayoutEditBtn = document.getElementById('hud-layout-edit')
  const hudLayoutResetBtn = document.getElementById('hud-layout-reset')
  const hudLayoutSaveBtn = document.getElementById('hud-layout-save')
  const hudLayoutCancelBtn = document.getElementById('hud-layout-cancel')

  hudLayoutEditBtn?.addEventListener('click', async () => {
    if (!anyWidgetOn()) {
      setStatus('TURN ON A WIDGET TO EDIT THE LAYOUT', true)
      return
    }
    try {
      await call('layout_action', { action: 'start', target: 'hud' })
      editingTarget = 'hud'
      renderLayoutEditRow()
      setStatus('EDITING — DRAG BLOCKS ON THE SCREEN')
    } catch (error) {
      setStatus(error.message || 'Unable to enter edit mode', true)
    }
  })

  hudLayoutResetBtn?.addEventListener('click', async () => {
    if (!(await confirmDestructive('Every HUD block and Delta goes back to its default place and size, in both arrangements.'))) return
    try {
      await call('layout_action', { action: 'reset_all', target: 'hud' })
      setStatus('HUD LAYOUT RESET')
    } catch (error) {
      setStatus(error.message || 'Unable to reset layout', true)
    }
  })

  hudLayoutSaveBtn?.addEventListener('click', async () => {
    try {
      await call('layout_action', { action: 'save', target: editingTarget })
      editingTarget = null
      renderLayoutEditRow()
      setStatus('LAYOUT SAVED')
    } catch (error) {
      setStatus(error.message || 'Unable to save layout', true)
    }
  })

  hudLayoutCancelBtn?.addEventListener('click', async () => {
    try {
      await call('layout_action', { action: 'cancel', target: editingTarget })
      editingTarget = null
      renderLayoutEditRow()
      setStatus('READY')
    } catch (error) {
      setStatus(error.message || 'Unable to cancel the layout edit', true)
    }
  })

  const overlayVisibility = readOverlayVisibility()

  function renderOverlayComponentVisibility(component, visible) {
    const button = document.querySelector(`[data-overlay-toggle="${component}"]`)
    if (button) updateOverlayToggle(button, visible)
    renderAllToggle()
  }

  async function setOverlayComponentVisibility(component, visible) {
    const previous = overlayVisibility[component] !== false
    overlayVisibility[component] = visible
    renderOverlayComponentVisibility(component, visible)
    saveOverlayVisibility(overlayVisibility)
    try {
      await call('set_overlay_visibility', { component, visible })
      setStatus(`${component.toUpperCase()} ${visible ? 'ENABLED' : 'HIDDEN'}`)
    } catch (error) {
      overlayVisibility[component] = previous
      renderOverlayComponentVisibility(component, previous)
      saveOverlayVisibility(overlayVisibility)
      setStatus(error.message || 'Unable to update overlay visibility', true)
    }
  }

  for (const button of document.querySelectorAll('[data-overlay-toggle]')) {
    const component = button.dataset.overlayToggle
    const visible = overlayVisibility[component] !== false
    updateOverlayToggle(button, visible)
    button.addEventListener('click', async () => {
      const nextVisible = overlayVisibility[component] === false
      void setOverlayComponentVisibility(component, nextVisible)
    })
  }

  function allWidgetsOn() {
    return COMPONENTS.every(c => visibility[c] !== false) && overlayVisibility.delta !== false
  }

  function anyWidgetOn() {
    return COMPONENTS.some(c => visibility[c] !== false) || overlayVisibility.delta !== false
  }

  function renderAllToggle() {
    const allBtn = document.getElementById('hud-all-widgets')
    if (!allBtn) return
    updateOverlayToggle(allBtn, allWidgetsOn())
  }

  const allWidgetsBtn = document.getElementById('hud-all-widgets')
  allWidgetsBtn?.addEventListener('click', async () => {
    const next = !allWidgetsOn()
    for (const component of COMPONENTS) {
      if ((visibility[component] !== false) !== next) {
        await setHudComponentVisibility(component, next)
      }
    }
    if ((overlayVisibility.delta !== false) !== next) {
      await setOverlayComponentVisibility('delta', next)
    }
    renderAllToggle()
    setStatus(next ? 'ALL WIDGETS ON' : 'ALL WIDGETS OFF')
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

  layoutMode = readLayoutMode()
  renderLayoutMode(layoutMode)
  for (const input of layoutModeInputs) {
    input.addEventListener('change', () => {
      if (input.checked) void selectLayoutMode(input.value)
    })
  }
  void call('set_layout_mode', { mode: layoutMode }).catch(() => undefined)
  selectSettingsTab('hud')
  void loadAppVersion()

  appVersion?.addEventListener('click', () => {
    if (!appVersion.disabled) void copyAppVersionToClipboard()
  })

  settingsHelpToggle?.addEventListener('click', () => {
    toggleHelpMenu()
  })

  settingsHelpMenu?.addEventListener('keydown', handleHelpMenuKeydown)

  for (const menuItem of settingsHelpMenu?.querySelectorAll('[role="menuitem"]') || []) {
    menuItem.addEventListener('click', async (event) => {
      const kind = event.target.dataset.feedbackLink
      if (!kind) return
      toggleHelpMenu(false)
      try {
        await call('open_feedback_link', { kind })
      } catch (error) {
        setStatus('COULD NOT OPEN THE BROWSER', true)
      }
    })
  }

  document.addEventListener('click', (event) => {
    if (!settingsHelpMenu?.hidden && !settingsHelpToggle?.contains(event.target) && !settingsHelpMenu?.contains(event.target)) {
      closeHelpMenu()
    }
  })

  function renderUnitDependentViews() {
    renderDriverAnalysisHistory()
    renderDriverAnalysisView()
    if (currentEventRun) renderEventRunDetail(currentEventRun)
  }

  displayPreferences = displayPreferencesApi?.normalize?.(displayPreferences) || displayPreferences
  renderDisplayPreferences(displayPreferences)
  void updateConfigurationAlwaysOnTop(displayPreferences.configurationAlwaysOnTop, false)
  renderQuitConfirmation()
  confirmBeforeQuit?.addEventListener('click', () => {
    if (!quitConfirmationApi) return
    const preferences = quitConfirmationApi.read()
    const next = quitConfirmationApi.write({ ...preferences, confirm: !preferences.confirm })
    renderQuitConfirmation()
    setStatus(next.confirm ? 'FDC ASKS BEFORE QUITTING' : 'X QUITS FDC WITHOUT ASKING')
  })
  configurationAlwaysOnTop?.addEventListener('click', () => {
    void updateConfigurationAlwaysOnTop(displayPreferences.configurationAlwaysOnTop === false)
  })
  renderHudRendering(null)
  void loadHudRendering()
  for (const input of hudRenderingInputs) {
    input.addEventListener('change', () => {
      if (input.checked) void updateHudRendering(input.value)
    })
  }
  for (const input of speedUnitInputs) {
    input.addEventListener('change', () => {
      if (!input.checked) return
      void updateDisplayPreferences(
        { speedUnit: input.value },
        next => `SPEED UNIT SET TO ${next.speedUnit === 'mph' ? 'MPH' : 'KM/H'}`
      )
    })
  }
  for (const input of distanceUnitInputs) {
    input.addEventListener('change', () => {
      if (!input.checked) return
      void updateDisplayPreferences(
        { distanceUnit: input.value },
        next => `DISTANCE UNIT SET TO ${next.distanceUnit === 'mi' ? 'MI' : 'KM'}`
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
  async function setHudComponentVisibility(component, visible) {
    const previous = visibility[component] !== false
    visibility[component] = visible
    renderHudComponentVisibility(component, visible)
    saveVisibility(visibility)
    try {
      await call('set_hud_visibility', { component, visible })
      setStatus(`${component.toUpperCase()} ${visible ? 'ENABLED' : 'HIDDEN'}`)
    } catch (error) {
      visibility[component] = previous
      renderHudComponentVisibility(component, previous)
      saveVisibility(visibility)
      setStatus(error.message || 'Unable to update HUD visibility', true)
    }
  }

  for (const component of COMPONENTS) {
    renderHudComponentVisibility(component, visibility[component] !== false)
  }
  for (const button of document.querySelectorAll('[data-hud-toggle]')) {
    button.addEventListener('click', () => {
      const component = button.dataset.hudToggle
      void setHudComponentVisibility(component, visibility[component] === false)
    })
  }
  renderAllToggle()
  // The whole-HUD switch is gone: a HUD hidden with it stays hidden through the widget switches.
  if (overlayVisibility.hud === false) {
    void (async () => {
      for (const component of COMPONENTS) await setHudComponentVisibility(component, false)
      await setOverlayComponentVisibility('hud', true)
      setStatus('READY')
    })()
  }

  shiftLightReset.addEventListener('click', () => {
    void requestShiftLightReset()
  })
  redlineBrightness.addEventListener('input', () => {
    renderRedlineBrightness(redlineBrightness.value)
  })
  redlineBrightness.addEventListener('change', () => {
    void updateDisplayPreferences(
      { redlineBrightness: Number(redlineBrightness.value) },
      next => `REDLINE BRIGHTNESS SET TO ${next.redlineBrightness}%`
    )
  })
  redlineBrightnessReset.addEventListener('click', () => {
    void updateDisplayPreferences(
      { redlineBrightness: DEFAULT_REDLINE_BRIGHTNESS },
      next => `REDLINE BRIGHTNESS RESET TO ${next.redlineBrightness}%`
    )
  })
  fdcShiftLightEnabled?.addEventListener('click', () => {
    const enabled = displayPreferences.fdcShiftLightEnabled === false
    void updateDisplayPreferences(
      { fdcShiftLightEnabled: enabled },
      next => `FDC SHIFT LIGHT ${next.fdcShiftLightEnabled ? 'ENABLED' : 'HIDDEN'}`
    )
  })
  showHudWithTelemetry?.addEventListener('click', () => {
    const enabled = displayPreferences.showHudWithTelemetry === false
    void updateDisplayPreferences(
      { showHudWithTelemetry: enabled },
      next => `HUD TELEMETRY VISIBILITY ${next.showHudWithTelemetry ? 'ENABLED' : 'DISABLED'}`
    )
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

  hudDisplay?.addEventListener('change', async () => {
    try {
      await call('set_hud_display', { name: hudDisplay.value })
    } catch (error) {
      setStatus(error.message || 'Unable to move the HUD', true)
    }
    await refreshHudDisplay()
  })

  eventsCreateToggle?.addEventListener('click', () => {
    if (eventsCreateOpen) requestEventsCreateClose()
    else setEventsCreateOpen(true)
  })
  eventsCreateCancel?.addEventListener('click', requestEventsCreateClose)
  destructiveConfirmYes?.addEventListener('click', () => closeDestructiveConfirm(true))
  destructiveConfirmNo?.addEventListener('click', () => closeDestructiveConfirm(false))
  destructiveConfirmDialog?.addEventListener('click', event => {
    if (event.target === destructiveConfirmDialog) closeDestructiveConfirm(false)
  })
  // A click on the question text keeps the focused answer, so Enter still means NO unless YES was chosen.
  destructiveConfirmDialog?.addEventListener('mousedown', event => {
    if (!event.target.closest('button, label')) event.preventDefault()
  })
  // Captured before every other shortcut, so Escape only closes the question and focus stays on its answers.
  document.addEventListener('keydown', event => {
    if (!resolveDestructiveConfirm) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      closeDestructiveConfirm(false)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      event.stopImmediatePropagation()
      const answers = [destructiveConfirmOption.hidden ? null : destructiveConfirmOptionInput, destructiveConfirmYes, destructiveConfirmNo].filter(Boolean)
      const index = answers.indexOf(document.activeElement)
      answers[(index + (event.shiftKey ? answers.length - 1 : 1)) % answers.length].focus()
    }
  }, true)
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
  driverAnalysisEnabled?.addEventListener('click', () => {
    void setDriverAnalysisEnabled(driverAnalysisSettings.enabled !== true)
  })
  driverAnalysisRecord?.addEventListener('click', () => {
    void sendDriverAnalysisAction(driverAnalysisState.recording ? 'stop' : 'record')
  })
  driverAnalysisHotkeyChange?.addEventListener('click', () => {
    void setDriverAnalysisHotkeyCapture(!driverAnalysisHotkeyCapture)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && driverAnalysisHotkeyCapture) void setDriverAnalysisHotkeyCapture(false)
  })
  window.addEventListener('focus', () => {
    void refreshHudDisplay()
  })
  document.addEventListener('keydown', event => {
    if (!driverAnalysisHotkeyCapture) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === 'Escape') {
      void setDriverAnalysisHotkeyCapture(false)
      setStatus('DRIVER ANALYSIS HOTKEY UNCHANGED')
      return
    }
    const hotkey = driverAnalysisApi?.hotkeyFromKeyboardEvent?.(event)
    if (!hotkey) {
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
        setStatus('USE CTRL, ALT OR SHIFT WITH ONE KEY. WINDOWS KEY IS NOT ALLOWED.', true)
      }
      return
    }
    void setDriverAnalysisHotkeyCapture(false)
    void setDriverAnalysisHotkey(hotkey)
  })
  hudEditHotkeyChange?.addEventListener('click', () => {
    void setHudEditHotkeyCapture(!hudEditHotkeyCapture)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && hudEditHotkeyCapture) void setHudEditHotkeyCapture(false)
  })
  document.addEventListener('keydown', event => {
    if (!hudEditHotkeyCapture) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.key === 'Escape') {
      void setHudEditHotkeyCapture(false)
      setStatus('HUD EDIT HOTKEY UNCHANGED')
      return
    }
    const hotkey = driverAnalysisApi?.hotkeyFromKeyboardEvent?.(event)
    if (!hotkey) {
      if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
        setStatus('USE CTRL, ALT OR SHIFT WITH ONE KEY. WINDOWS KEY IS NOT ALLOWED.', true)
      }
      return
    }
    void setHudEditHotkeyCapture(false)
    void setHudEditHotkey(hotkey)
  })
  garageCurrentVariantsToggle?.addEventListener('click', toggleGarageVariants)
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    if (event.target?.classList?.contains('garage-current-car__input')
      || event.target?.classList?.contains('events-detail-view__title-input')) return
    const isDriverAnalysisPanelVisible = !document.getElementById('driver-analysis-panel')?.hidden
    if (isDriverAnalysisPanelVisible && driverAnalysisView.level !== 'history') {
      event.preventDefault()
      closeDriverAnalysisLevel()
      return
    }
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

  driverAnalysisDetailBack?.addEventListener('click', () => {
    closeDriverAnalysisLevel()
  })

  telemetryStatusButton?.addEventListener('click', openConnectionGuide)
  connectGuideRetry?.addEventListener('click', () => {
    void retryDirectSource()
  })
  connectGuideSkip?.addEventListener('click', closeConnectionGuide)
  connectGuideDone?.addEventListener('click', closeConnectionGuide)
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !connectionGuideOpen || resolveDestructiveConfirm) return
    event.preventDefault()
    closeConnectionGuide()
  })

  renderRouteStatus(latestRouteStatus)
  renderShiftLightState(null)
  renderGarage()
  renderEventsLibrary()
  renderDriverAnalysisState(driverAnalysisState)
  renderDriverAnalysisHistory()
  void loadDriverAnalysisHistory()
  if (driverAnalysisSettings.enabled) void setDriverAnalysisHotkey(driverAnalysisSettings.hotkey, false, driverAnalysisSettings.hotkeyLabel)
  renderHudEditHotkey()
  void setHudEditHotkey(hudEditHotkeySettings.hotkey, false, hudEditHotkeySettings.hotkeyLabel)
  void listenShiftLightEvents()
  void listenRouteEvents()
  void listenGarageEvents()
  void listenEventRecorderEvents()
  void listenDriverAnalysisEvents()
  void listenHudEditHotkeyEvents()
  globalScope.SettingsController = {
    cancelEdit,
    setLayoutEditingState,
    setLayoutMode: renderLayoutMode,
    setRouteStatus: renderRouteStatus,
    resetShiftLight: requestShiftLightReset,
    loadEvents,
    openEventDetail,
    closeEventDetail,
    openEventRun,
    closeEventRun,
    refreshHudDisplay,
    requestQuit
  }
})(typeof globalThis === 'undefined' ? this : globalThis)
