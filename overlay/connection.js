const CO_DRIVER_WEBSOCKET_URL = 'ws://127.0.0.1:3001/_ws'
const TELEMETRY_SOURCE_STORAGE_KEY = 'fdc.telemetry-source.v1'
const TELEMETRY_SOURCES = ['direct', 'suite']

function resolveCoDriverWebSocketUrl() {
  return CO_DRIVER_WEBSOCKET_URL
}

function normalizeTelemetrySource(source) {
  return TELEMETRY_SOURCES.includes(source) ? source : 'direct'
}

function readTelemetrySource() {
  try {
    return normalizeTelemetrySource(localStorage.getItem(TELEMETRY_SOURCE_STORAGE_KEY))
  } catch {
    return 'direct'
  }
}

function writeTelemetrySource(source) {
  const normalized = normalizeTelemetrySource(source)
  try {
    localStorage.setItem(TELEMETRY_SOURCE_STORAGE_KEY, normalized)
  } catch {
    // A restricted webview may not expose persistent storage.
  }
  return normalized
}

const connection = {
  resolveCoDriverWebSocketUrl,
  normalizeTelemetrySource,
  readTelemetrySource,
  writeTelemetrySource
}

if (typeof window !== 'undefined') window.HudConnection = connection
if (typeof module !== 'undefined') module.exports = connection
