const CO_DRIVER_PORTS = Object.freeze({
  production: 3000,
  develop: 3001
})

function resolveCoDriverChannel(search = '') {
  const params = new URLSearchParams(search)
  return params.get('channel') === 'develop' ? 'develop' : 'production'
}

function resolveCoDriverWebSocketUrl(search = '') {
  const channel = resolveCoDriverChannel(search)
  return `ws://127.0.0.1:${CO_DRIVER_PORTS[channel]}/_ws`
}

const connection = {
  resolveCoDriverChannel,
  resolveCoDriverWebSocketUrl
}

if (typeof window !== 'undefined') window.HudConnection = connection
if (typeof module !== 'undefined') module.exports = connection
