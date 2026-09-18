const hud = document.getElementById('hud')
const throttleFill = document.getElementById('throttle-fill')
const throttleTrack = document.getElementById('throttle-track')
const brakeFill = document.getElementById('brake-fill')
const brakeTrack = document.getElementById('brake-track')
const speedValue = document.getElementById('speed-value')
const gearValue = document.getElementById('gear-value')
const rpmValue = document.getElementById('rpm-value')
const engineElements = {
  boost: document.getElementById('engine-boost'),
  power: document.getElementById('engine-power'),
  torque: document.getElementById('engine-torque')
}
const steeringCanvas = document.getElementById('steering-canvas')
const historyCanvas = document.getElementById('history-canvas')
const deltaStrip = document.getElementById('delta-strip')
const tireElements = {
  fl: document.getElementById('tire-fl'),
  fr: document.getElementById('tire-fr'),
  rl: document.getElementById('tire-rl'),
  rr: document.getElementById('tire-rr')
}
const tireVisualElements = {
  fl: document.getElementById('tire-shape-fl'),
  fr: document.getElementById('tire-shape-fr'),
  rl: document.getElementById('tire-shape-rl'),
  rr: document.getElementById('tire-shape-rr')
}

let displayPreferences = window.DisplayPreferences.read()
const STEERING_WHEEL_ASSET = 'assets/steering-wheels/default.svg'
const STEERING_WHEEL_RANGE_DEGREES = 90
const HISTORY_MS = 8000
const DEMO_MODE = new URLSearchParams(window.location.search).has('demo')
const DEMO_SIGNAL_FROM_URL = new URLSearchParams(window.location.search).get('signal')
const DEMO_SIGNALS = ['normal', 'redline', 'shift']
const REDLINE_RPM_FRACTION = 0.85

let latestTelemetry = null
let lapTimingState = window.HudLapTiming.createState()
let latestSteer = 0
let renderScheduled = false
let directStartPending = false
let directGeneration = 0
let directEventUnlisteners = []
let forzaConnected = false
let lastConnectionState = null
let routeRevision = 0
let routeStatus = window.HudTelemetryRoute.normalizeRouteStatus({
  phase: 'starting',
  revision: routeRevision
})
let historySamples = []
let steeringWheelImageReady = false
let demoSignal = DEMO_SIGNALS.includes(DEMO_SIGNAL_FROM_URL) ? DEMO_SIGNAL_FROM_URL : 'normal'
let activeRpmSignal = null
let latestShiftLight = {
  status: 'fallback',
  phase: 'normal',
  shiftRpm: null,
  sampleCount: 0,
  carKey: null,
  gameId: null,
  carOrdinal: null,
  pi: null,
  rpmMax: null,
  method: null
}
const shiftLightPresentation = window.ShiftLightPresentation.createShiftLightPresentation()
let shiftLightLatchTimer = null
let garageRuntime = null

function emitRecorderEvent(eventName, payload) {
  try {
    const eventApi = window.HudTauriEvents?.getEventApi?.()
    if (!eventApi || typeof eventApi.emit !== 'function') return Promise.resolve()
    return Promise.resolve(eventApi.emit(eventName, payload)).catch(() => {})
  } catch {
    return Promise.resolve()
  }
}

const deltaRuntime = window.HudDelta?.createDeltaRuntime?.() || null
const eventRecorder = window.HudEventRecorder?.createEventRecorder?.({
  timingApi: window.HudLapTiming,
  invoke: invokeTauri,
  emit: payload => emitRecorderEvent('event_recorder_status', payload),
  onSaved: payload => emitRecorderEvent('event_recorder_run_saved', payload),
  onResult: payload => emitRecorderEvent('event_recorder_result', payload),
  onReferenceCandidate: candidate => installBetterDeltaReference(candidate)
}) || null
const driverAnalysisSettings = window.DriverAnalysis?.readSettings?.() || {
  enabled: false,
  hotkey: window.DriverAnalysis?.DEFAULT_HOTKEY || 'Ctrl+Shift+F9'
}
let driverAnalysisHotkey = driverAnalysisSettings.hotkey
const driverAnalysisRecorder = window.DriverAnalysis?.createRecorder?.({
  engine: window.DriverAnalysisEngine?.createDriverAnalysisEngine?.(),
  invoke: invokeTauri,
  emit: payload => emitRecorderEvent('driver_analysis_status', payload),
  onResult: entry => Promise.all([
    emitRecorderEvent('driver_analysis_result', entry),
    publishDriverAnalysisHistory()
  ]),
  enabled: driverAnalysisSettings.enabled
}) || null
let deltaReferenceRequest = 0

const steeringWheelImage = new Image()
steeringWheelImage.addEventListener('load', () => {
  steeringWheelImageReady = true
  drawSteering(latestSteer)
})
steeringWheelImage.src = STEERING_WHEEL_ASSET

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0))
}

function clampSteer(value) {
  return Math.max(-1, Math.min(1, Number(value) || 0))
}

function formatGear(rawGear) {
  const gear = Number(rawGear)
  if (!Number.isFinite(gear)) return '\u2014'
  if (gear === 0) return 'R'
  if (gear >= 11) return 'N'
  return String(Math.max(1, Math.min(10, Math.trunc(gear))))
}

function formatRpm(rawRpm) {
  const rpm = Number(rawRpm)
  if (!Number.isFinite(rpm)) return '-- RPM'
  return `${Math.max(0, Math.round(rpm)).toLocaleString('en-US')} RPM`
}

function tireColor(tempC) {
  if (!Number.isFinite(tempC)) return '#71717a'
  if (tempC < 70) return '#38bdf8'
  if (tempC < 82) return '#69e83f'
  if (tempC < 92) return '#ffd400'
  return '#ff312b'
}

function setConnection(state) {
  if (state === lastConnectionState) return
  lastConnectionState = state
  hud.classList.remove('is-live', 'is-waiting', 'is-offline')
  hud.classList.add(state)
}

function sameRouteStatus(left, right) {
  return left.phase === right.phase
    && left.message === right.message
    && left.revision === right.revision
}

function publishRouteStatus(patch = {}, force = false) {
  const next = window.HudTelemetryRoute.normalizeRouteStatus({
    ...routeStatus,
    ...patch,
    revision: routeRevision
  })
  const changed = !sameRouteStatus(routeStatus, next)
  routeStatus = next
  if (DEMO_MODE || (!changed && !force)) return

  const eventApi = window.HudTauriEvents?.getEventApi?.()
  if (eventApi?.emit) Promise.resolve(eventApi.emit('hud_route_status', routeStatus)).catch(() => {})
}

function errorMessage(error) {
  if (typeof error === 'string') return error
  if (typeof error?.message === 'string') return error.message
  return String(error || 'Unknown Direct Data Out error')
}

function invokeTauri(command, args) {
  const invoke = window.__TAURI_INTERNALS__?.invoke
  if (typeof invoke !== 'function') return Promise.reject(new Error('Tauri commands are unavailable'))
  return Promise.resolve(invoke(command, args))
}

garageRuntime = window.HudGarageRuntime?.createGarageRuntime?.({ invoke: invokeTauri }) || null

function applyDisplayPreferences() {
  const redlineBrightnessColor = window.DisplayPreferences.redlineBrightnessColor(
    displayPreferences.redlineBrightness
  )
  const brightnessScale = window.DisplayPreferences.shiftLightBrightnessScale(
    displayPreferences.shiftLightBrightness
  )
  document.documentElement.style.setProperty('--redline-background', redlineBrightnessColor)
  document.documentElement.style.setProperty('--shift-light-brightness-scale', String(brightnessScale))
  document.documentElement.style.setProperty('--hud-opacity', String(displayPreferences.hudOpacity / 100))
  document.documentElement.dataset.speedUnit = displayPreferences.speedUnit
  speedValue.textContent = window.DisplayPreferences.formatSpeed(
    latestTelemetry?.speedKmh,
    displayPreferences.speedUnit
  )
  applyTelemetryVisibility()
}

function setDisplayPreferences(preferences) {
  displayPreferences = window.DisplayPreferences.write({
    ...displayPreferences,
    ...(preferences && typeof preferences === 'object' ? preferences : {})
  })
  applyDisplayPreferences()
  scheduleTelemetryRender()
  return { ...displayPreferences }
}

function setRpmSignal(signal) {
  if (signal === activeRpmSignal) return

  activeRpmSignal = signal
  hud.classList.remove('is-redline', 'is-shift')
  if (signal !== 'normal') hud.classList.add(`is-${signal}`)
  hud.dataset.signal = signal
}

function hasTelemetryPresentation() {
  return displayPreferences.showHudWithTelemetry === false
    || (forzaConnected && latestTelemetry !== null)
}

function applyTelemetryVisibility() {
  window.HudPreferences?.setTelemetryVisible?.(hasTelemetryPresentation())
}

function getRpmSignal(rawRpm, rawRpmMax) {
  const rpm = Number(rawRpm)
  const rpmMax = Number(rawRpmMax)
  if (!Number.isFinite(rpm) || !Number.isFinite(rpmMax) || rpmMax <= 0) return 'normal'

  const rpmFraction = rpm / rpmMax
  if (rpmFraction > REDLINE_RPM_FRACTION) return 'redline'
  return 'normal'
}

function getShiftLightSignal(telemetry) {
  const phase = shiftLightPresentation.getPhase()
  if (phase === 'shift' && displayPreferences.fdcShiftLightEnabled !== false) return 'shift'
  if (phase === 'approach') return 'redline'
  return getRpmSignal(telemetry.rpm, telemetry.rpmMax)
}

function queueShiftLight(shiftLight) {
  if (!shiftLight || typeof shiftLight !== 'object') return
  const status = ['fallback', 'learning', 'calibrated'].includes(shiftLight.status)
    ? shiftLight.status
    : 'fallback'
  const phase = ['normal', 'approach', 'shift'].includes(shiftLight.phase)
    ? shiftLight.phase
    : 'normal'
  latestShiftLight = { ...latestShiftLight, ...shiftLight, status, phase }
  shiftLightPresentation.update(phase)
  if (phase === 'shift') {
    if (shiftLightLatchTimer !== null) window.clearTimeout(shiftLightLatchTimer)
    shiftLightLatchTimer = window.setTimeout(() => {
      shiftLightLatchTimer = null
      scheduleTelemetryRender()
    }, window.ShiftLightPresentation.LATCH_MS + 1)
  }
  scheduleTelemetryRender()
}

function setDemoSignal(signal) {
  if (!DEMO_MODE) return

  demoSignal = DEMO_SIGNALS.includes(signal) ? signal : 'normal'
  setRpmSignal(demoSignal)
}

function updateTires(tires = {}) {
  for (const corner of Object.keys(tireElements)) {
    const value = Number(tires[corner])
    const element = tireElements[corner]
    const visual = tireVisualElements[corner]
    const color = tireColor(value)
    const hasTemperature = Number.isFinite(value)
    element.textContent = hasTemperature ? `${Math.round(value)}\u00b0` : '--\u00b0'
    element.style.color = color
    visual.style.color = color
    visual.style.backgroundColor = hasTemperature ? color : 'transparent'
  }
}

function updateEngine(telemetry = {}) {
  const engine = window.HudEnginePresentation.formatEngine(telemetry)
  engineElements.boost.textContent = engine.boost
  engineElements.power.textContent = engine.power
  engineElements.torque.textContent = engine.torque
}

function pushHistory(throttle, brake, timestamp = performance.now()) {
  historySamples.push({ timestamp, throttle, brake })
  const cutoff = timestamp - HISTORY_MS
  let firstVisible = 0
  while (firstVisible < historySamples.length && historySamples[firstVisible].timestamp < cutoff) {
    firstVisible += 1
  }
  if (firstVisible > 0) historySamples = historySamples.slice(firstVisible)
}

function sizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect()
  const density = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.max(1, Math.round(rect.width * density))
  const height = Math.max(1, Math.round(rect.height * density))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  return { width, height, density }
}

function drawSeries(context, samples, field, stroke, width, height, now) {
  if (samples.length < 2) return

  const xFor = timestamp => ((timestamp - (now - HISTORY_MS)) / HISTORY_MS) * width
  const yFor = value => height - clamp01(value) * (height - 4) - 2

  context.beginPath()
  samples.forEach((sample, index) => {
    const x = xFor(sample.timestamp)
    const y = yFor(sample[field])
    if (index === 0) context.moveTo(x, y)
    else context.lineTo(x, y)
  })
  context.strokeStyle = stroke
  context.lineWidth = 2.25
  context.lineJoin = 'miter'
  context.lineCap = 'butt'
  context.stroke()
}

function drawSteering(steer) {
  latestSteer = steer
  const { width: size } = sizeCanvas(steeringCanvas)
  const context = steeringCanvas.getContext('2d')
  if (!context) return

  context.clearRect(0, 0, steeringCanvas.width, steeringCanvas.height)
  if (!steeringWheelImageReady) return

  const center = size / 2
  const rotation = steer * STEERING_WHEEL_RANGE_DEGREES * Math.PI / 180
  context.save()
  context.translate(center, center)
  context.rotate(rotation)
  context.drawImage(steeringWheelImage, -center, -center, size, size)
  context.restore()
}

function drawHistory() {
  const { width, height } = sizeCanvas(historyCanvas)
  const context = historyCanvas.getContext('2d')
  if (!context) return

  context.clearRect(0, 0, width, height)
  context.lineWidth = 1
  context.strokeStyle = 'rgba(226, 232, 240, 0.16)'

  for (let column = 1; column < 6; column += 1) {
    const x = Math.round((column / 6) * width) + 0.5
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, height)
    context.stroke()
  }

  for (let row = 1; row < 3; row += 1) {
    const y = Math.round((row / 3) * height) + 0.5
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(width, y)
    context.stroke()
  }

  const now = historySamples.at(-1)?.timestamp ?? performance.now()
  drawSeries(context, historySamples, 'throttle', '#69e83f', width, height, now)
  drawSeries(context, historySamples, 'brake', '#ff312b', width, height, now)

  context.beginPath()
  context.moveTo(0, height - 1.5)
  context.lineTo(width, height - 1.5)
  context.strokeStyle = 'rgba(248, 250, 252, 0.75)'
  context.lineWidth = 1
  context.stroke()
}

function renderTelemetry() {
  renderScheduled = false
  const telemetry = latestTelemetry
  if (!telemetry) return

  const throttle = clamp01(telemetry.throttle)
  const brake = clamp01(telemetry.brake)
  const steer = clampSteer(telemetry.steer)
  const throttlePercent = Math.round(throttle * 100)
  const brakePercent = Math.round(brake * 100)

  throttleFill.style.transform = `scaleY(${throttle})`
  throttleTrack.setAttribute('aria-valuenow', String(throttlePercent))

  brakeFill.style.transform = `scaleY(${brake})`
  brakeTrack.setAttribute('aria-valuenow', String(brakePercent))

  drawSteering(steer)
  updateTires(telemetry.tireTempC)
  speedValue.textContent = window.DisplayPreferences.formatSpeed(telemetry.speedKmh, displayPreferences.speedUnit)
  gearValue.textContent = formatGear(telemetry.gear)
  rpmValue.textContent = formatRpm(telemetry.rpm)
  updateEngine(telemetry)
  const signal = DEMO_MODE ? demoSignal : getShiftLightSignal(telemetry)
  setRpmSignal(signal)
  if (!DEMO_MODE) pushHistory(throttle, brake)
  drawHistory()
  if (DEMO_MODE) setConnection(telemetry.isRaceOn ? 'is-live' : 'is-waiting')
  else setConnection(forzaConnected && telemetry.isRaceOn ? 'is-live' : 'is-waiting')
}

function queueTelemetry(telemetry) {
  if (!telemetry || typeof telemetry !== 'object' || !Number.isFinite(telemetry.speedKmh)) return false

  garageRuntime?.update?.(telemetry)
  eventRecorder?.update?.(telemetry)
  deltaRuntime?.update?.(telemetry)
  const shiftLightState = window.HudShiftLightRuntime?.update?.(telemetry)
  if (shiftLightState) queueShiftLight(shiftLightState)
  lapTimingState = window.HudLapTiming.update(lapTimingState, telemetry)
  driverAnalysisRecorder?.update?.(telemetry)

  latestTelemetry = telemetry
  forzaConnected = true
  applyTelemetryVisibility()
  if (renderScheduled) return true
  renderScheduled = true
  requestAnimationFrame(renderTelemetry)
  return true
}

function scheduleTelemetryRender() {
  if (renderScheduled) return
  renderScheduled = true
  requestAnimationFrame(renderTelemetry)
}

function resetDirectPresentation() {
  latestTelemetry = null
  applyTelemetryVisibility()
  deltaRuntime?.update?.(null)
  driverAnalysisRecorder?.resetTransient?.('direct_restart')
  lapTimingState = window.HudLapTiming.resetForRestart()
  latestSteer = 0
  historySamples = []
  latestShiftLight = {
    status: 'fallback',
    phase: 'normal',
    shiftRpm: null,
    sampleCount: 0,
    carKey: null,
    gameId: null,
    carOrdinal: null,
    pi: null,
    rpmMax: null,
    method: null
  }
  if (shiftLightLatchTimer !== null) {
    window.clearTimeout(shiftLightLatchTimer)
    shiftLightLatchTimer = null
  }
  shiftLightPresentation.reset()
  window.HudShiftLightRuntime?.update?.(null)
  setRpmSignal('normal')
  scheduleTelemetryRender()
}

async function listenDirectEvents(generation) {
  if (directEventUnlisteners.length > 0) return
  const eventApi = window.HudTauriEvents?.getEventApi?.()
  if (!eventApi || typeof eventApi.listen !== 'function') {
    throw new Error('Tauri event API is unavailable')
  }

  const unlistenTelemetry = await eventApi.listen('direct_telemetry', event => {
    if (generation !== directGeneration) return
    if (queueTelemetry(event.payload)) publishRouteStatus({ phase: 'live', message: '' })
  })
  if (generation !== directGeneration) {
    await unlistenTelemetry()
    return
  }

  let unlistenStatus
  try {
    unlistenStatus = await eventApi.listen('direct_status', event => {
      if (generation !== directGeneration) return
      const state = event.payload?.state
      if (state === 'is-live') {
        forzaConnected = true
        applyTelemetryVisibility()
        setConnection('is-live')
        publishRouteStatus({ phase: 'live', message: '' })
      } else if (state === 'is-waiting') {
        forzaConnected = false
        applyTelemetryVisibility()
        driverAnalysisRecorder?.resetTransient?.('waiting')
        setConnection('is-waiting')
        publishRouteStatus({ phase: 'waiting', message: '' })
        scheduleTelemetryRender()
      } else if (state === 'is-stale') {
        forzaConnected = false
        applyTelemetryVisibility()
        driverAnalysisRecorder?.resetTransient?.('telemetry_gap')
        window.HudShiftLightRuntime?.resetTransient?.()
        setConnection('is-waiting')
        publishRouteStatus({ phase: 'stale', message: '' })
        scheduleTelemetryRender()
      } else {
        forzaConnected = false
        applyTelemetryVisibility()
        driverAnalysisRecorder?.resetTransient?.('offline')
        window.HudShiftLightRuntime?.resetTransient?.()
        setConnection('is-offline')
        publishRouteStatus({
          phase: event.payload?.message ? 'error' : 'offline',
          message: event.payload?.message || ''
        })
        scheduleTelemetryRender()
      }
    })
  } catch (error) {
    await unlistenTelemetry()
    throw error
  }
  if (generation !== directGeneration) {
    await unlistenTelemetry()
    await unlistenStatus()
    return
  }
  directEventUnlisteners = [unlistenTelemetry, unlistenStatus]
}

async function disconnectDirect() {
  directGeneration += 1
  try {
    await invokeTauri('stop_direct_source')
  } catch {
    // The source may already be stopped during application shutdown.
  }
  for (const unlisten of directEventUnlisteners) {
    try {
      await unlisten()
    } catch {
      // Ignore an event listener that was already released.
    }
  }
  directEventUnlisteners = []
  directStartPending = false
}

async function connectDirect() {
  if (DEMO_MODE || directStartPending) return
  const generation = ++directGeneration
  directStartPending = true
  forzaConnected = false
  applyTelemetryVisibility()
  setConnection('is-waiting')
  publishRouteStatus({
    phase: 'starting',
    message: ''
  })
  try {
    await listenDirectEvents(generation)
    if (generation !== directGeneration) return
    await invokeTauri('start_direct_source')
    if (
      generation === directGeneration
      && routeStatus.phase === 'starting'
    ) {
      publishRouteStatus({ phase: 'waiting', message: '' })
    }
  } catch (error) {
    if (generation !== directGeneration) return
    await disconnectDirect()
    setConnection('is-offline')
    publishRouteStatus({ phase: 'error', message: errorMessage(error) })
    console.warn('[hud] unable to start Direct Data Out receiver', error)
  } finally {
    if (generation === directGeneration) directStartPending = false
  }
}

async function listenEventRecorderEvents() {
  const eventApi = window.HudTauriEvents?.getEventApi?.()
  if (!eventApi || typeof eventApi.listen !== 'function' || !eventRecorder) return
  await eventApi.listen('event_recorder_config', event => {
    const payload = event?.payload || {}
    if (payload.action === 'record') {
      eventRecorder.arm(payload.eventId, payload.eventName, payload.armedAt)
      void configureDeltaReference(payload.eventId)
    } else if (payload.action === 'stop') {
      deltaReferenceRequest += 1
      deltaRuntime?.clearReference?.()
      scheduleTelemetryRender()
      void eventRecorder.stop()
    }
  })
  await eventApi.listen('event_recorder_status_request', () => eventRecorder.status({}, true))
}

async function configureDeltaReference(eventId) {
  const request = ++deltaReferenceRequest
  deltaRuntime?.clearReference?.()
  const nativeEventId = Number(eventId)
  if (!Number.isSafeInteger(nativeEventId) || nativeEventId <= 0) {
    scheduleTelemetryRender()
    console.warn('[hud] unable to load Event delta reference: invalid Event ID', eventId)
    return
  }
  try {
    const reference = await invokeTauri('load_event_absolute_best', { eventId: nativeEventId })
    if (request !== deltaReferenceRequest) return
    installBetterDeltaReference(reference)
    scheduleTelemetryRender()
  } catch (error) {
    if (request !== deltaReferenceRequest) return
    scheduleTelemetryRender()
    console.warn('[hud] unable to load Event delta reference', error)
  }
}

function driverAnalysisStatus() {
  return {
    ...(driverAnalysisRecorder?.snapshot?.() || { enabled: false, recording: false, startedAt: null, sampleCount: 0 }),
    hotkey: driverAnalysisHotkey
  }
}

function publishDriverAnalysisStatus() {
  return emitRecorderEvent('driver_analysis_status', driverAnalysisStatus())
}

function publishDriverAnalysisHistory() {
  return emitRecorderEvent('driver_analysis_history', null)
}

async function applyDriverAnalysisAction(payload = {}) {
  if (!driverAnalysisRecorder) return null
  if (typeof payload.enabled === 'boolean') await driverAnalysisRecorder.setEnabled(payload.enabled)
  if (typeof payload.hotkey === 'string') driverAnalysisHotkey = payload.hotkey

  let result = null
  if (payload.action === 'record') result = { status: driverAnalysisRecorder.start(), entry: null }
  else if (payload.action === 'stop') result = await driverAnalysisRecorder.stop()
  else if (payload.action === 'toggle') result = await driverAnalysisRecorder.toggle()

  void publishDriverAnalysisStatus()
  return result
}

async function listenDriverAnalysisEvents() {
  const eventApi = window.HudTauriEvents?.getEventApi?.()
  if (!eventApi || typeof eventApi.listen !== 'function' || !driverAnalysisRecorder) return
  await eventApi.listen('driver_analysis_config', event => { void applyDriverAnalysisAction(event?.payload || {}) })
  await eventApi.listen('driver_analysis_status_request', () => {
    void publishDriverAnalysisStatus()
    void publishDriverAnalysisHistory()
  })
  await eventApi.listen('driver_analysis_hotkey', () => { void applyDriverAnalysisAction({ action: 'toggle' }) })
  void publishDriverAnalysisStatus()
  void publishDriverAnalysisHistory()
}

function installBetterDeltaReference(candidate) {
  const normalized = window.HudDelta?.normalizeReference?.(candidate)
  if (!normalized || !deltaRuntime) return false
  const recorder = eventRecorder?.snapshot?.()
  if (!recorder?.armed || String(recorder.eventId) !== String(normalized.eventId)) return false

  const current = deltaRuntime.getState?.().reference || null
  if (!window.HudDelta?.isBetterReference?.(normalized, current)) return false

  deltaRuntime.setReference?.(normalized)
  scheduleTelemetryRender()
  return true
}

async function retryDirectSource() {
  routeRevision += 1
  resetDirectPresentation()
  await disconnectDirect()
  await connectDirect()
}

function startDemo() {
  const start = performance.now() - HISTORY_MS
  for (let index = 0; index <= 240; index += 1) {
    const progress = index / 240
    let throttle = 0
    let brake = 0

    if (progress < 0.08) throttle = progress / 0.08
    else if (progress < 0.35) throttle = 0.96
    else if (progress < 0.48) throttle = 0.96 * (1 - (progress - 0.35) / 0.13)
    else if (progress > 0.64 && progress < 0.73) throttle = (progress - 0.64) / 0.09
    else if (progress >= 0.73 && progress < 0.94) throttle = 0.9
    else if (progress >= 0.94) throttle = 0.9 * (1 - (progress - 0.94) / 0.06)

    if (progress > 0.43 && progress < 0.54) brake = (progress - 0.43) / 0.11
    else if (progress >= 0.54 && progress < 0.7) brake = 1 - (progress - 0.54) / 0.16

    historySamples.push({ timestamp: start + progress * HISTORY_MS, throttle, brake })
  }

  latestTelemetry = {
    isRaceOn: true,
    throttle: 0.58,
    brake: 0.13,
    steer: -0.28,
    speedKmh: 128,
    gear: 5,
    rpm: 6420,
    rpmMax: 8000,
    power: 312000,
    torque: 460,
    boost: 12.3,
    lap: { current: 50.123 },
    tireTempC: { fl: 79, fr: 84, rl: 77, rr: 77 }
  }
  setDemoSignal(demoSignal)
  renderTelemetry()
}

window.addEventListener('keydown', event => {
  if (!DEMO_MODE) return

  const signalByKey = {
    1: 'normal',
    2: 'redline',
    3: 'shift'
  }
  const signal = signalByKey[event.key]
  if (signal) {
    setDemoSignal(signal)
    return
  }

})

window.addEventListener('resize', () => {
  drawHistory()
  drawSteering(clampSteer(latestTelemetry?.steer))
})

window.HudOverlay = {
  refresh: scheduleTelemetryRender,
  setDisplayPreferences,
  retryDirectSource,
  resetShiftLight: async () => {
    try {
      return await window.HudShiftLightRuntime?.reset?.() === true
    } catch (error) {
      console.warn('[hud] unable to reset Shift Light', error)
      return false
    }
  },
  syncShiftLightStatus: () => window.HudShiftLightRuntime?.sync?.(),
  syncRouteStatus: () => publishRouteStatus({}, true)
}

applyDisplayPreferences()
publishRouteStatus({}, true)
void listenEventRecorderEvents()
void listenDriverAnalysisEvents()
if (DEMO_MODE) startDemo()
else connectDirect()
