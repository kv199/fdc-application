const CO_DRIVER_WEBSOCKET_URL = 'ws://127.0.0.1:3001/_ws'

function resolveCoDriverWebSocketUrl() {
  return CO_DRIVER_WEBSOCKET_URL
}

const connection = {
  resolveCoDriverWebSocketUrl
}

if (typeof window !== 'undefined') window.HudConnection = connection
if (typeof module !== 'undefined') module.exports = connection
