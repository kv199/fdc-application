const hud = document.getElementById('hud')
const throttleFill = document.getElementById('throttle-fill')
const throttleTrack = document.getElementById('throttle-track')
const brakeFill = document.getElementById('brake-fill')
const brakeTrack = document.getElementById('brake-track')
const speedValue = document.getElementById('speed-value')
const gearValue = document.getElementById('gear-value')
const rpmValue = document.getElementById('rpm-value')
const shiftStatus = document.getElementById('shift-status')
const steeringCanvas = document.getElementById('steering-canvas')
const historyCanvas = document.getElementById('history-canvas')
const coachCard = document.getElementById('coach-card')
const coachbar = document.getElementById('coachbar')
const coachStatus = document.getElementById('coach-status')
const cornerIdentity = document.getElementById('corner-identity')
const cornerPhase = document.getElementById('corner-phase')
const cornerDistance = document.getElementById('corner-distance')
const coachTarget = document.getElementById('coach-target')
const coachTargetLabel = document.getElementById('coach-target-label')
const coachTargetRef = document.getElementById('coach-target-ref')
const coachTargetObserved = document.getElementById('coach-target-observed')
const deltaStrip = document.getElementById('delta-strip')
const currentLapTime = document.getElementById('current-lap-time')
const lapDeltaMarker = document.getElementById('lap-delta-marker')
const lapDeltaValue = document.getElementById('lap-delta-value')
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

const WS_URL = window.HudConnection.resolveCoDriverWebSocketUrl()
const STEERING_WHEEL_ASSET = 'assets/steering-wheels/default.svg'
const STEERING_WHEEL_RANGE_DEGREES = 90
const RECONNECT_MS = 1000
const HISTORY_MS = 8000
const DEMO_MODE = new URLSearchParams(window.location.search).has('demo')
const DEMO_SIGNAL_FROM_URL = new URLSearchParams(window.location.search).get('signal')
const DEMO_CORNER_FROM_URL = new URLSearchParams(window.location.search).get('corner')
const DEMO_REFERENCE_FROM_URL = new URLSearchParams(window.location.search).get('reference')
const DEMO_SIGNALS = ['normal', 'redline', 'shift']
const DEMO_CORNERS = ['between', 'approach', 'entry', 'apex', 'exit']
const DEMO_REFERENCES = ['brake-late', 'release', 'apex-slow', 'throttle-late', 'good', 'summary']
const REDLINE_RPM_FRACTION = 0.85
const SHIFT_RPM_FRACTION = 0.98
const LAP_SUMMARY_DURATION_MS = 4000
const DEMO_LAP_SUMMARY_FROM_URL = new URLSearchParams(window.location.search).get('lapSummary') === '1'

let latestTelemetry = null
let latestLiveLapTimeSeconds = null
let latestSteer = 0
let renderScheduled = false
let reconnectTimer = null
let socket = null
let forzaConnected = false
let lastConnectionState = null
let historySamples = []
let steeringWheelImageReady = false
let demoSignal = DEMO_SIGNALS.includes(DEMO_SIGNAL_FROM_URL) ? DEMO_SIGNAL_FROM_URL : 'normal'
let demoCorner = DEMO_CORNERS.includes(DEMO_CORNER_FROM_URL) ? DEMO_CORNER_FROM_URL : null
let demoReference = DEMO_REFERENCES.includes(DEMO_REFERENCE_FROM_URL) ? DEMO_REFERENCE_FROM_URL : null
let activeRpmSignal = null
let latestShiftLight = {
  status: 'fallback',
  phase: 'normal',
  shiftRpm: null,
  sampleCount: 0,
  carKey: null
}
let latestCornerTemplate = null
let latestCornerState = null
let latestReference = window.ReferenceCoach.createEmptyReference()
let referenceDeltaState = 'neutral'
let lapDeltaState = 'neutral'
let lapSummaryReference = null
let lapSummaryExpiresAt = 0
let lapSummaryTimer = null
let pendingReference = null
let lastAvailableReference = null
let finalLapSummaryReference = null
let finalLapSummaryLapNumber = null

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

function finiteStateNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function formatGear(rawGear) {
  const gear = Number(rawGear)
  if (!Number.isFinite(gear)) return '\u2014'
  if (gear === 0) return 'R'
  if (gear >= 11) return 'N'
  return String(Math.max(1, Math.min(10, Math.trunc(gear))))
}

function formatSpeedKmh(rawSpeed) {
  const speed = Number(rawSpeed)
  if (!Number.isFinite(speed)) return '-- km/h'
  return `${Math.max(0, Math.round(speed))} km/h`
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
  notifyConnectionState(state)
}

function notifyConnectionState(state) {
  const invoke = window.__TAURI_INTERNALS__?.invoke
  if (typeof invoke === 'function') {
    Promise.resolve(invoke('notify_connection_state', { state })).catch(() => {})
  }
}

function setRpmSignal(signal) {
  if (signal === activeRpmSignal) return

  activeRpmSignal = signal
  hud.classList.remove('is-redline', 'is-shift')
  if (signal !== 'normal') hud.classList.add(`is-${signal}`)
  hud.dataset.signal = signal
}

function clearLapSummary({ promotePending = true } = {}) {
  if (lapSummaryTimer !== null) {
    window.clearTimeout(lapSummaryTimer)
    lapSummaryTimer = null
  }
  if (promotePending && pendingReference?.available === true) latestReference = pendingReference
  pendingReference = null
  lapSummaryReference = null
  lapSummaryExpiresAt = 0
}

function getActiveLapSummary() {
  if (!lapSummaryReference || performance.now() >= lapSummaryExpiresAt) {
    clearLapSummary()
    return null
  }
  return lapSummaryReference
}

function beginLapSummary() {
  if (getActiveLapSummary()) return true
  const sourceReference = latestReference?.available === true
    ? latestReference
    : lastAvailableReference
  if (sourceReference?.available !== true) return false

  lapSummaryReference = sourceReference
  latestReference = window.ReferenceCoach.createEmptyReference()
  lastAvailableReference = null
  pendingReference = null
  lapSummaryExpiresAt = performance.now() + LAP_SUMMARY_DURATION_MS
  if (lapSummaryTimer !== null) window.clearTimeout(lapSummaryTimer)
  lapSummaryTimer = window.setTimeout(() => {
    lapSummaryTimer = null
    clearLapSummary()
    scheduleTelemetryRender()
  }, LAP_SUMMARY_DURATION_MS)
  return true
}

function queueLapComplete(payload) {
  const lapComplete = window.ReferenceCoach.normalizeLapCompletePayload(payload)
  if (!lapComplete) return

  finalLapSummaryReference = {
    ...window.ReferenceCoach.createEmptyReference(),
    available: true,
    lapDeltaMs: lapComplete.deltaMs
  }
  finalLapSummaryLapNumber = lapComplete.lapNumber
  latestReference = window.ReferenceCoach.createEmptyReference()
  lastAvailableReference = null
  clearLapSummary({ promotePending: false })
  scheduleTelemetryRender()
}

function getDisplayedReference() {
  if (finalLapSummaryReference) return { reference: finalLapSummaryReference, isSummary: true }
  const summary = getActiveLapSummary()
  if (summary) return { reference: summary, isSummary: true }
  return {
    reference: latestReference,
    isSummary: false
  }
}

function renderCoach(reference, isSummary = false) {
  const hasReference = reference?.available === true
  const isCoachEditing = window.HudLayout?.isEditing?.('coach') === true
  const isCoachVisible = window.HudPreferences?.isOverlayVisible?.('coach') !== false
  const isDeltaVisible = window.HudPreferences?.isOverlayVisible?.('delta') !== false
  coachCard.dataset.hasReference = hasReference ? 'true' : 'false'
  coachCard.hidden = !isCoachEditing && (!isCoachVisible || !hasReference)
  deltaStrip.hidden = !isDeltaVisible

  if (!hasReference) {
    coachbar.dataset.deltaState = 'neutral'
    coachbar.dataset.cueKind = ''
    coachbar.dataset.phase = ''
    coachTarget.hidden = true
    lapDeltaState = 'neutral'
    deltaStrip.dataset.deltaState = 'neutral'
    lapDeltaMarker.style.left = '50%'
    lapDeltaValue.textContent = '\u2014'
    deltaStrip.dataset.mode = ''
    deltaStrip.setAttribute('aria-label', 'Lap delta')
    lapDeltaValue.setAttribute('aria-label', 'Current lap delta')
    window.HudLayout.refreshPosition?.()
    return
  }

  const phase = reference.phase || 'between'
  const deltaState = isSummary
    ? 'neutral'
    : window.ReferenceCoach.classifyDelta(reference.deltaMs, referenceDeltaState)
  referenceDeltaState = deltaState
  coachbar.dataset.deltaState = deltaState

  const lapDeltaView = window.ReferenceCoach.createLapDeltaView(reference.lapDeltaMs, lapDeltaState)
  lapDeltaState = lapDeltaView.state
  deltaStrip.dataset.deltaState = lapDeltaView.state
  lapDeltaMarker.style.left = `${lapDeltaView.positionPercent}%`
  lapDeltaValue.textContent = lapDeltaView.text || '\u2014'
  deltaStrip.dataset.mode = isSummary ? 'summary' : 'live'
  deltaStrip.setAttribute('aria-label', isSummary ? 'Final lap delta' : 'Lap delta')
  lapDeltaValue.setAttribute('aria-label', isSummary ? 'Final lap delta' : 'Current lap delta')

  coachStatus.dataset.phase = isSummary ? 'summary' : phase
  coachStatus.dataset.cueKind = reference.cue?.kind || ''
  coachStatus.textContent = window.ReferenceCoach.formatCoachStatus(reference, isSummary) || '\u2014'

  const target = isSummary
    ? null
    : window.ReferenceCoach.getActivePedalPoint(phase, reference.targets, reference.observed)
  coachTarget.hidden = target === null
  if (target) {
    coachTargetLabel.textContent = target.label
    coachTargetRef.textContent = target.reference
    coachTargetObserved.textContent = target.observed
  }

  window.HudLayout.refreshPosition?.()
}

function renderCorner(template, state, reference, isSummary = false) {
  if (isSummary) {
    const referenceReadout = window.ReferenceCoach.formatCornerReadout(reference)
    cornerIdentity.textContent = referenceReadout.identity
    cornerIdentity.hidden = !referenceReadout.visible || referenceReadout.identity === ''
    cornerPhase.textContent = ''
    cornerPhase.hidden = true
    cornerDistance.textContent = ''
    cornerDistance.hidden = true
    cornerIdentity.dataset.phase = ''
    return
  }

  const readout = window.CornerState.formatCornerReadout(template, state)
  const referenceReadout = window.ReferenceCoach.formatCornerReadout(reference)
  const mergedReadout = {
    visible: readout.visible || referenceReadout.visible,
    identity: referenceReadout.identity || readout.identity,
    phase: referenceReadout.phase || readout.phase,
    distance: readout.distance,
    phaseClass: referenceReadout.visible ? referenceReadout.phaseClass : readout.phaseClass
  }
  const fields = [
    [cornerIdentity, mergedReadout.identity],
    [cornerPhase, mergedReadout.phase],
    [cornerDistance, mergedReadout.distance]
  ]

  for (const [element, text] of fields) {
    element.textContent = text
    element.hidden = !mergedReadout.visible || text === ''
    element.dataset.phase = mergedReadout.phaseClass
  }
}

function getRpmSignal(rawRpm, rawRpmMax) {
  const rpm = Number(rawRpm)
  const rpmMax = Number(rawRpmMax)
  if (!Number.isFinite(rpm) || !Number.isFinite(rpmMax) || rpmMax <= 0) return 'normal'

  const rpmFraction = rpm / rpmMax
  if (rpmFraction >= SHIFT_RPM_FRACTION) return 'shift'
  if (rpmFraction > REDLINE_RPM_FRACTION) return 'redline'
  return 'normal'
}

function getShiftLightSignal(telemetry) {
  if (latestShiftLight.phase === 'shift') return 'shift'
  if (latestShiftLight.phase === 'approach') return 'redline'
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
  shiftStatus.textContent = status.toUpperCase()
  shiftStatus.dataset.status = status
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
  const displayedReference = getDisplayedReference()
  const telemetry = latestTelemetry
  currentLapTime.textContent = `LIVE LAP ${window.ReferenceCoach.formatLapTime(latestLiveLapTimeSeconds)}`
  if (!telemetry) {
    renderCoach(displayedReference.reference, displayedReference.isSummary)
    renderCorner(latestCornerTemplate, latestCornerState, displayedReference.reference, displayedReference.isSummary)
    return
  }

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
  speedValue.textContent = formatSpeedKmh(telemetry.speedKmh)
  gearValue.textContent = formatGear(telemetry.gear)
  rpmValue.textContent = formatRpm(telemetry.rpm)
  const signal = DEMO_MODE ? demoSignal : getShiftLightSignal(telemetry)
  setRpmSignal(signal)
  if (!DEMO_MODE) pushHistory(throttle, brake)
  drawHistory()
  renderCoach(displayedReference.reference, displayedReference.isSummary)
  renderCorner(latestCornerTemplate, latestCornerState, displayedReference.reference, displayedReference.isSummary)
  if (DEMO_MODE) setConnection(telemetry.isRaceOn ? 'is-live' : 'is-waiting')
  else if (!socket) setConnection('is-offline')
  else setConnection(forzaConnected && telemetry.isRaceOn ? 'is-live' : 'is-waiting')
}

function queueTelemetry(telemetry) {
  const raceRestart = window.ReferenceCoach.isRaceRestart(latestTelemetry, telemetry)
  const lapCurrentSeconds = finiteStateNumber(telemetry?.lap?.current)
  if (telemetry?.isRaceOn === true && lapCurrentSeconds !== null && lapCurrentSeconds >= 0) {
    latestLiveLapTimeSeconds = lapCurrentSeconds
  }

  const telemetryLapNumber = finiteStateNumber(telemetry?.lap?.number)
  if (
    finalLapSummaryReference
    && finalLapSummaryLapNumber !== null
    && telemetryLapNumber !== null
    && telemetryLapNumber !== finalLapSummaryLapNumber
  ) {
    finalLapSummaryReference = null
    finalLapSummaryLapNumber = null
  }

  if (raceRestart) {
    finalLapSummaryReference = null
    finalLapSummaryLapNumber = null
    resetCornerState({ preserveLapSummary: false, promotePending: false })
  }

  // The game may finish/leave the active lap before co-driver emits its idle
  // state. Preserve the last useful Coach frame during that transition.
  const endedLiveFrame = latestTelemetry?.isRaceOn === true && telemetry?.isRaceOn === false
  if (endedLiveFrame) beginLapSummary()

  latestTelemetry = telemetry
  forzaConnected = true
  if (renderScheduled) return
  renderScheduled = true
  requestAnimationFrame(renderTelemetry)
}

function scheduleTelemetryRender() {
  if (renderScheduled) return
  renderScheduled = true
  requestAnimationFrame(renderTelemetry)
}

function resetCornerState({ preserveLapSummary = false, promotePending = true } = {}) {
  latestCornerTemplate = null
  latestCornerState = null
  latestReference = window.ReferenceCoach.createEmptyReference()
  referenceDeltaState = 'neutral'
  lapDeltaState = 'neutral'
  if (!preserveLapSummary) {
    lastAvailableReference = null
    clearLapSummary({ promotePending })
  }
  else pendingReference = null
}

function queueCornerTemplate(template) {
  if (!template || typeof template !== 'object') return

  const isRecordingIdle = template.status === 'idle'
  if (isRecordingIdle) beginLapSummary()
  latestCornerTemplate = template
  latestCornerState = null
  latestReference = window.ReferenceCoach.createEmptyReference()
  referenceDeltaState = 'neutral'
  lapDeltaState = 'neutral'
  if (!isRecordingIdle) {
    finalLapSummaryReference = null
    finalLapSummaryLapNumber = null
    lastAvailableReference = null
    clearLapSummary({ promotePending: false })
  }
  scheduleTelemetryRender()
}

function queueCornerState(state) {
  if (!state || typeof state !== 'object') return

  const previousCornerIndex = finiteStateNumber(latestCornerState?.cornerIndex)
  const nextCornerIndex = finiteStateNumber(state.cornerIndex)
  const changedCorner = previousCornerIndex !== null
    && nextCornerIndex !== null
    && previousCornerIndex !== nextCornerIndex
  const referenceCorner = latestReference.corner
  const nextDirection = String(state.direction || '').toUpperCase()
  const nextIdentity = nextCornerIndex !== null
    ? [`T${Math.trunc(nextCornerIndex)}`, nextDirection].filter(Boolean).join(' ')
    : ''
  if (changedCorner && referenceCorner && referenceCorner !== nextIdentity) {
    latestReference = window.ReferenceCoach.createEmptyReference()
    referenceDeltaState = 'neutral'
    lapDeltaState = 'neutral'
  }

  latestCornerState = state
  scheduleTelemetryRender()
}

function queueReference(payload) {
  const reference = window.ReferenceCoach.normalizeReferencePayload(payload)
  const summary = getActiveLapSummary()
  if (reference.available) {
    lastAvailableReference = reference
    if (summary) {
      pendingReference = reference
    } else {
      clearLapSummary({ promotePending: false })
      latestReference = reference
    }
  } else {
    // co-driver makes the reference unavailable after the final matched zone.
    // Keep the last valid frame until the explicit lap_complete message arrives
    // instead of turning the live delta into a premature final summary.
    if (!summary && lastAvailableReference?.available === true) latestReference = lastAvailableReference
    else if (!summary) latestReference = reference
  }
  scheduleTelemetryRender()
}

function scheduleReconnect() {
  if (reconnectTimer !== null || DEMO_MODE) return
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    connect()
  }, RECONNECT_MS)
}

function connect() {
  if (DEMO_MODE || (socket && socket.readyState < WebSocket.CLOSING)) return

  forzaConnected = false
  setConnection('is-waiting')
  socket = new WebSocket(WS_URL)

  socket.addEventListener('message', (event) => {
    try {
      const message = JSON.parse(event.data)
      if (message.type === 'telemetry' && message.t) queueTelemetry(message.t)
      if (message.type === 'shift_light') queueShiftLight(message.shiftLight)
      if (message.type === 'corner_template') queueCornerTemplate(message.template)
      if (message.type === 'corner_state') queueCornerState(message.cornerState)
      if (message.type === 'coach_reference') queueReference(message.reference)
      if (message.type === 'lap_complete') queueLapComplete(message.lapComplete)
      if (message.type === 'recording_state' && message.state === 'idle') {
        beginLapSummary()
        resetCornerState({ preserveLapSummary: true })
        scheduleTelemetryRender()
      }
      if (message.type === 'forza_status') {
        forzaConnected = message.connected === true
        if (forzaConnected) return
        beginLapSummary()
        resetCornerState({ preserveLapSummary: true })
        setConnection('is-waiting')
        scheduleTelemetryRender()
      }
    } catch {
      // Keep rendering the last valid frame when a malformed message arrives.
    }
  })

  socket.addEventListener('close', () => {
    socket = null
    forzaConnected = false
    resetCornerState({ promotePending: false })
    setConnection('is-offline')
    scheduleTelemetryRender()
    scheduleReconnect()
  })

  socket.addEventListener('error', () => socket?.close())
}

function setDemoCorner(corner, schedule = true) {
  if (!DEMO_MODE) return

  demoCorner = DEMO_CORNERS.includes(corner) ? corner : null
  latestCornerTemplate = demoCorner === null
    ? { status: 'idle', sessionId: null, eventId: null }
    : { status: 'ready', sessionId: 27, eventId: 13 }
  latestCornerState = null

  if (demoCorner !== null) {
    const distanceByPhase = {
      between: 149,
      approach: 62,
      entry: 42,
      apex: 0,
      exit: 68
    }
    latestCornerState = {
      sessionId: 27,
      eventId: 13,
      timestampMs: 2000,
      lapNumber: 2,
      lapDistanceM: 405.2,
      phase: demoCorner,
      cornerIndex: 1,
      direction: 'left',
      distanceToEntryM: distanceByPhase[demoCorner],
      distanceToApexM: distanceByPhase[demoCorner],
      distanceToExitM: distanceByPhase[demoCorner],
      speedKmh: 128,
      brake: 0.13,
      throttle: 0.58,
      steer: -0.28
    }
  }

  if (schedule) scheduleTelemetryRender()
}

function setDemoReference(reference, schedule = true) {
  if (!DEMO_MODE) return

  demoReference = DEMO_REFERENCES.includes(reference) ? reference : null
  latestReference = demoReference === null
    ? window.ReferenceCoach.createEmptyReference()
    : window.ReferenceCoach.createDemoReference(demoReference)
  lastAvailableReference = latestReference.available ? latestReference : null
  referenceDeltaState = 'neutral'
  lapDeltaState = 'neutral'

  if (schedule) scheduleTelemetryRender()
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
    lap: { current: 50.123 },
    tireTempC: { fl: 79, fr: 84, rl: 77, rr: 77 }
  }
  latestLiveLapTimeSeconds = latestTelemetry.lap.current
  setDemoCorner(demoCorner, false)
  setDemoReference(demoReference, false)
  if (DEMO_LAP_SUMMARY_FROM_URL) {
    beginLapSummary()
    latestReference = window.ReferenceCoach.createEmptyReference()
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

  const referenceByKey = {
    9: 'brake-late',
    0: 'summary'
  }
  if (referenceByKey[event.key]) setDemoReference(referenceByKey[event.key])
})

window.addEventListener('resize', () => {
  drawHistory()
  drawSteering(clampSteer(latestTelemetry?.steer))
})

window.HudOverlay = {
  refresh: scheduleTelemetryRender,
  syncConnectionState: () => {
    if (lastConnectionState) notifyConnectionState(lastConnectionState)
  }
}

if (DEMO_MODE) startDemo()
else connect()
