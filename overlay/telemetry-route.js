const ROUTE_SOURCES = ['direct', 'suite']
const ROUTE_PHASES = ['starting', 'waiting', 'live', 'stale', 'offline', 'error']
const SUITE_STATES = ['unavailable', 'waiting', 'receiving']

const ROUTE_ENDPOINTS = {
  direct: 'UDP 127.0.0.1:5301',
  suite: 'WS 127.0.0.1:3001/_ws'
}

function normalizeRouteStatus(status = {}) {
  const source = ROUTE_SOURCES.includes(status.source) ? status.source : 'direct'
  const phase = ROUTE_PHASES.includes(status.phase) ? status.phase : 'offline'
  const suiteState = SUITE_STATES.includes(status.suiteState) ? status.suiteState : 'unavailable'
  const message = typeof status.message === 'string' ? status.message.trim() : ''
  const revision = Number.isSafeInteger(status.revision) && status.revision >= 0 ? status.revision : 0

  return { source, phase, suiteState, message, revision }
}

function routeTone(phase) {
  if (phase === 'live') return 'live'
  if (phase === 'error') return 'error'
  if (phase === 'offline') return 'offline'
  if (phase === 'stale') return 'stale'
  return 'waiting'
}

function phaseLabel(phase) {
  const labels = {
    starting: 'STARTING',
    waiting: 'WAITING FOR FORZA',
    live: 'LIVE',
    stale: 'DATA STALE',
    offline: 'OFFLINE',
    error: 'ERROR'
  }
  return labels[phase]
}

function routeDetail(status) {
  if (status.source === 'direct') {
    const details = {
      starting: 'Opening the Direct Forza UDP receiver.',
      waiting: 'Listening for Forza Data Out on IP 127.0.0.1 and port 5301.',
      live: 'The HUD is receiving Forza Data Out directly. The Suite WebSocket is not used.',
      stale: 'Direct UDP is open, but Forza telemetry has stopped arriving.',
      offline: 'The Direct Forza UDP receiver is offline.',
      error: 'The Direct Forza UDP receiver could not start.'
    }
    return details[status.phase]
  }

  const details = {
    starting: 'Connecting to the local co-driver Suite provider.',
    waiting: 'The provider is connected and waiting for Forza telemetry.',
    live: 'The HUD is receiving normalized telemetry through co-driver Suite.',
    stale: 'The provider is connected, but Forza telemetry has stopped arriving.',
    offline: 'The co-driver Suite WebSocket is unavailable.',
    error: 'The co-driver Suite connection failed.'
  }
  return details[status.phase]
}

function suiteWarning(status) {
  if (status.source !== 'direct' || status.suiteState === 'unavailable') return ''
  if (status.suiteState === 'receiving') {
    return 'HUD input is Direct UDP. co-driver Suite is also receiving UDP packets.'
  }
  return 'HUD input is Direct UDP. co-driver Suite is running and waiting for Forza telemetry.'
}

function getRoutePresentation(rawStatus = {}) {
  const status = normalizeRouteStatus(rawStatus)
  const sourceLabel = status.source === 'direct' ? 'DIRECT' : 'SUITE'
  const detail = routeDetail(status)
  const message = status.message ? `${detail} ${status.message}` : detail

  return {
    ...status,
    endpoint: ROUTE_ENDPOINTS[status.source],
    sourceLabel,
    phaseLabel: phaseLabel(status.phase),
    statusLabel: `${sourceLabel} · ${phaseLabel(status.phase)}`,
    detail: message,
    warning: suiteWarning(status),
    tone: routeTone(status.phase),
    canRetry: status.phase === 'error' || status.phase === 'offline'
  }
}

const telemetryRoute = {
  getRoutePresentation,
  normalizeRouteStatus
}

if (typeof window !== 'undefined') window.HudTelemetryRoute = telemetryRoute
if (typeof module !== 'undefined') module.exports = telemetryRoute
