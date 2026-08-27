const ROUTE_PHASES = ['starting', 'waiting', 'live', 'stale', 'offline', 'error']

const DIRECT_ENDPOINT = 'UDP 127.0.0.1:5301'

function normalizeRouteStatus(status = {}) {
  const phase = ROUTE_PHASES.includes(status.phase) ? status.phase : 'offline'
  const message = typeof status.message === 'string' ? status.message.trim() : ''
  const revision = Number.isSafeInteger(status.revision) && status.revision >= 0 ? status.revision : 0

  return { phase, message, revision }
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
    waiting: 'WAITING FOR DATA',
    live: 'LIVE',
    stale: 'DATA STALE',
    offline: 'OFFLINE',
    error: 'ERROR'
  }
  return labels[phase]
}

function routeDetail(status) {
  const details = {
    starting: 'Starting the FDC Direct Data Out receiver.',
    waiting: 'Listening for Forza Horizon 6 Data Out on UDP port 5301.',
    live: 'FDC is receiving Forza Horizon 6 Data Out directly.',
    stale: 'UDP 5301 is open, but Forza Data Out packets have stopped arriving.',
    offline: 'The FDC Direct Data Out receiver is offline.',
    error: 'The FDC Direct Data Out receiver could not start.'
  }
  return details[status.phase]
}

function getRoutePresentation(rawStatus = {}) {
  const status = normalizeRouteStatus(rawStatus)
  const detail = routeDetail(status)
  const message = status.message ? `${detail} ${status.message}` : detail

  return {
    ...status,
    endpoint: DIRECT_ENDPOINT,
    sourceLabel: 'DIRECT DATA OUT',
    phaseLabel: phaseLabel(status.phase),
    statusLabel: `DIRECT DATA OUT · ${phaseLabel(status.phase)}`,
    detail: message,
    warning: '',
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
