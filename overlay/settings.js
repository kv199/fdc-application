(function (globalScope) {
  'use strict'

  const invoke = globalScope.__TAURI_INTERNALS__?.invoke
  const appVersion = document.getElementById('app-version')
  const settingsHelpToggle = document.getElementById('settings-help-toggle')
  const settingsHelpMenu = document.getElementById('settings-help-menu')
  const settingsTitle = document.getElementById('settings-title')
  const driverAnalysisApi = globalScope.DriverAnalysis
  const status = document.getElementById('settings-status')
  const destructiveConfirmDialog = document.getElementById('destructive-confirm-dialog')
  const destructiveConfirmTitle = document.getElementById('destructive-confirm-title')
  const destructiveConfirmMessage = document.getElementById('destructive-confirm-message')
  const destructiveConfirmOption = document.getElementById('destructive-confirm-option')
  const destructiveConfirmOptionInput = document.getElementById('destructive-confirm-option-input')
  const destructiveConfirmOptionLabel = document.getElementById('destructive-confirm-option-label')
  const destructiveConfirmYes = document.getElementById('destructive-confirm-yes')
  const destructiveConfirmNo = document.getElementById('destructive-confirm-no')
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
  const displayPreferencesApi = globalScope.DisplayPreferences
  const quitConfirmationApi = globalScope.QuitConfirmation
  const connectionGuideApi = globalScope.ConnectionGuide
  const { renderTraceMap } = globalScope.TraceMapView
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
  const themeInputs = [...document.querySelectorAll('input[name="theme"]')]
  const configurationAlwaysOnTop = document.getElementById('configuration-always-on-top')
  const confirmBeforeQuit = document.getElementById('confirm-before-quit')
  const showHudWithTelemetry = document.getElementById('show-hud-with-telemetry')
  const fdcShiftLightEnabled = document.getElementById('fdc-shift-light-enabled')
  const redlineBrightness = document.getElementById('redline-brightness')
  const redlineBrightnessValue = document.getElementById('redline-brightness-value')
  const redlineBrightnessReset = document.getElementById('redline-brightness-reset')
  const shiftLightBrightness = document.getElementById('shift-light-brightness')
  const shiftLightBrightnessValue = document.getElementById('shift-light-brightness-value')
  const hudOpacity = document.getElementById('hud-opacity')
  const hudOpacityValue = document.getElementById('hud-opacity-value')
  const hudOpacityReset = document.getElementById('hud-opacity-reset')
  const displayPreferenceRows = [...document.querySelectorAll('[data-display-preference]')]
  const settingsTabs = [...document.querySelectorAll('[data-settings-tab]')]
  const settingsPanels = [...document.querySelectorAll('[data-settings-panel]')]
  let appVersionNumber = null
  let appVersionFeedbackTimer = null
  let displayPreferencesPending = false
  let displayPreferences = displayPreferencesApi?.read?.() || {
    speedUnit: 'kmh',
    distanceUnit: 'km',
    redlineBrightness: DEFAULT_REDLINE_BRIGHTNESS,
    shiftLightBrightness: 80,
    fdcShiftLightEnabled: true,
    showHudWithTelemetry: true,
    hudOpacity: DEFAULT_HUD_OPACITY,
    configurationAlwaysOnTop: false,
    theme: 'dark'
  }
  // The Configuration page is themed only; the HUD never receives this preference.
  const themeMediaQuery = typeof globalScope.matchMedia === 'function'
    ? globalScope.matchMedia('(prefers-color-scheme: light)')
    : null
  const CONFIGURATION_WINDOW_LABEL = globalScope.__TAURI_INTERNALS__?.metadata?.currentWindow?.label || 'settings'

  function setConfigurationWindowTheme(windowTheme) {
    if (typeof invoke !== 'function') return
    try {
      Promise.resolve(invoke('plugin:window|set_theme', { label: CONFIGURATION_WINDOW_LABEL, value: windowTheme })).catch(() => {})
    } catch {
      // A restricted webview must not stop the Configuration page from rendering.
    }
  }

  function applyConfigurationTheme(theme) {
    const resolved = theme === 'system'
      ? (themeMediaQuery?.matches ? 'light' : 'dark')
      : theme === 'light' ? 'light' : 'dark'
    document.documentElement.dataset.theme = resolved
    // SYSTEM passes null so the Windows title bar follows the app mode.
    setConfigurationWindowTheme(theme === 'system' ? null : resolved)
  }

  themeMediaQuery?.addEventListener?.('change', () => {
    if (displayPreferences.theme === 'system') applyConfigurationTheme('system')
  })
  applyConfigurationTheme(displayPreferences.theme)
  let latestShiftLightState = null
  let latestRouteRevision = -1
  let latestRouteStatus = globalScope.HudTelemetryRoute?.normalizeRouteStatus?.({ phase: 'offline' })
  let connectionGuideChecked = false
  let connectionGuideOpen = false
  let connectionGuideStage = null
  let routeStatusReceived = false
  let driverAnalysisSettings = driverAnalysisApi?.readSettings?.() || { enabled: false, hotkey: 'Ctrl+Shift+F9' }
  let driverAnalysisState = { enabled: driverAnalysisSettings.enabled, recording: false, startedAt: null, sampleCount: 0, hotkey: driverAnalysisSettings.hotkey }
  let driverAnalysisHistory = []

  // View modules are created here, after the shared state above. Each one returns the
  // functions this file still calls, under their old names.
  // -- HUD view --
  const hudView = globalScope.SettingsHud.create({
    call,
    setStatus,
    confirmDestructive,
    getDriverAnalysisSettings: () => driverAnalysisSettings,
    isDriverAnalysisHotkeyCapturing: () => driverAnalysisTab.isHotkeyCapturing(),
    setDriverAnalysisHotkey: (...args) => setDriverAnalysisHotkey(...args),
    setDriverAnalysisHotkeyCapture: (...args) => setDriverAnalysisHotkeyCapture(...args)
  })
  const {
    refreshHudDisplay,
    renderHudEditHotkey,
    setHudEditHotkey,
    setHudEditHotkeyCapture,
    listenControllerHotkeyCapture,
    updateOverlayToggle,
    renderLayoutMode,
    cancelEdit,
    setLayoutEditingState,
    isHudEditHotkeyCapturing,
    getHudEditHotkeySettings
  } = hudView
  // -- Garage and Shift Light views --
  const garageView = globalScope.SettingsGarage.create({
    call,
    setStatus,
    getLatestShiftLightState: () => latestShiftLightState,
    renderShiftLightState: value => renderShiftLightState(value),
    openConnectionGuideIfNeverConnected,
    getCurrentEventRuns: () => eventsTab.getCurrentEventRuns(),
    setCurrentEventRuns: value => eventsTab.setCurrentEventRuns(value),
    getCurrentEventRun: () => eventsTab.getCurrentEventRun(),
    setCurrentEventRun: value => eventsTab.setCurrentEventRun(value),
    getDriverAnalysisHistory: () => driverAnalysisHistory,
    setDriverAnalysisHistory: value => { driverAnalysisHistory = value },
    onGarageNamesChanged: ({ runsChanged, historyChanged }) => {
      if (runsChanged) {
        renderEventRuns()
        if (eventsTab.getCurrentEventRun()) renderEventRunDetail(eventsTab.getCurrentEventRun())
      }
      if (historyChanged) {
        renderDriverAnalysisHistory()
        renderDriverAnalysisView()
      }
    }
  })
  const { renderGarage, closeGarageVariants, listenGarageEvents } = garageView
  const shiftLightView = globalScope.SettingsShiftLight.create({
    call,
    setStatus,
    confirmDestructive,
    getLatestShiftLightState: () => latestShiftLightState,
    setLatestShiftLightState: value => { latestShiftLightState = value },
    getGarageVehicles: garageView.getGarageVehicles,
    appendGaragePerformance: garageView.appendGaragePerformance,
    garageVariantsFor: garageView.garageVariantsFor
  })
  const { renderShiftLightState, requestShiftLightReset, listenShiftLightEvents } = shiftLightView
  // -- Driver Analysis view --
  const driverAnalysisTab = globalScope.SettingsDriverAnalysis.create({
    call,
    setStatus,
    confirmDestructive,
    renderTraceMap,
    updateOverlayToggle,
    setHudEditHotkeyCapture,
    isHudEditHotkeyCapturing,
    getHudEditHotkeySettings,
    getDriverAnalysisSettings: () => driverAnalysisSettings,
    setDriverAnalysisSettings: value => { driverAnalysisSettings = value },
    getDriverAnalysisState: () => driverAnalysisState,
    setDriverAnalysisState: value => { driverAnalysisState = value },
    getDriverAnalysisHistory: () => driverAnalysisHistory,
    setDriverAnalysisHistory: value => { driverAnalysisHistory = value }
  })
  const {
    renderDriverAnalysisView,
    renderDriverAnalysisHistory,
    renderDriverAnalysisState,
    loadDriverAnalysisHistory,
    setDriverAnalysisHotkey,
    setDriverAnalysisHotkeyCapture,
    closeDriverAnalysisLevel,
    listenDriverAnalysisEvents
  } = driverAnalysisTab
  // -- Events view --
  const eventsTab = globalScope.SettingsEvents.create({
    call,
    setStatus,
    confirmDestructive,
    renderTraceMap
  })
  const {
    renderEventRuns,
    renderEventRunDetail,
    renderEventsLibrary,
    listenEventRecorderEvents,
    loadEvents,
    openEventDetail,
    closeEventDetail,
    openEventRun,
    closeEventRun
  } = eventsTab

  // Until Forza has sent Data Out once, Configuration opens on a setup guide.
  function openConnectionGuideIfNeverConnected() {
    if (!connectionGuideApi || connectionGuideChecked) return
    connectionGuideChecked = true
    connectionGuideOpen = connectionGuideApi.shouldShow(connectionGuideApi.read(), garageView.getGarageVehicles().size > 0)
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
    const recording = driverAnalysisState.recording === true || eventsTab.getRecorderState().recording === true
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
    if (tabName === 'events' && eventsTab.getEventsView() === 'library') void loadEvents()
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
    for (const input of themeInputs) {
      input.checked = input.value === preferences.theme
    }
    applyConfigurationTheme(preferences.theme)
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
    for (const input of themeInputs) input.disabled = pending
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

  async function listenRouteEvents() {
    const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
    if (!eventApi || typeof eventApi.listen !== 'function') return
    await eventApi.listen('hud_route_status', event => {
      routeStatusReceived = true
      renderRouteStatus(event.payload)
    })
    await call('sync_route_status')
  }

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
    if (eventsTab.getCurrentEventRun()) renderEventRunDetail(eventsTab.getCurrentEventRun())
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
  for (const input of themeInputs) {
    input.addEventListener('change', () => {
      if (!input.checked) return
      void updateDisplayPreferences(
        { theme: input.value },
        next => `THEME SET TO ${next.theme.toUpperCase()}`
      )
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
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    if (event.target?.classList?.contains('garage-current-car__input')
      || event.target?.classList?.contains('events-detail-view__title-input')) return
    const isDriverAnalysisPanelVisible = !document.getElementById('driver-analysis-panel')?.hidden
    if (isDriverAnalysisPanelVisible && driverAnalysisTab.getView().level !== 'history') {
      event.preventDefault()
      closeDriverAnalysisLevel()
      return
    }
    if (eventsTab.handleEscape(event)) return
    closeGarageVariants()
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
  const hudEditHotkeySettings = getHudEditHotkeySettings()
  void setHudEditHotkey(hudEditHotkeySettings.hotkey, false, hudEditHotkeySettings.hotkeyLabel)
  void listenShiftLightEvents()
  void listenRouteEvents()
  void listenGarageEvents()
  void listenEventRecorderEvents()
  void listenDriverAnalysisEvents()
  void listenControllerHotkeyCapture()
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
