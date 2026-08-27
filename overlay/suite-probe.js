(function (globalScope) {
  'use strict'

  function createSuiteProbe(options = {}) {
    const WebSocketImpl = options.WebSocketImpl || globalScope.WebSocket
    const setTimer = options.setTimer || globalScope.setTimeout.bind(globalScope)
    const clearTimer = options.clearTimer || globalScope.clearTimeout.bind(globalScope)
    const url = options.url
    const intervalMs = options.intervalMs ?? 5000
    const timeoutMs = options.timeoutMs ?? 1000
    const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {}
    let active = false
    let timer = null
    let socket = null

    function clearScheduledProbe() {
      if (timer === null) return
      clearTimer(timer)
      timer = null
    }

    function schedule(delay = intervalMs) {
      if (!active || timer !== null || socket !== null) return
      timer = setTimer(() => {
        timer = null
        probe()
      }, delay)
    }

    function probe() {
      if (!active || socket !== null) return

      const current = new WebSocketImpl(url)
      socket = current
      let settled = false
      const timeout = setTimer(() => finish('unavailable'), timeoutMs)

      function finish(status) {
        if (settled) return
        settled = true
        clearTimer(timeout)
        if (socket === current) socket = null
        if (active) onStatus(status)
        if (current.readyState < 2) current.close()
        schedule()
      }

      current.addEventListener('message', event => {
        try {
          const message = JSON.parse(event.data)
          if (message.type !== 'forza_status') return
          finish(message.connected === true ? 'receiving' : 'waiting')
        } catch {
          // Ignore non-status messages until the initial provider status arrives.
        }
      })
      current.addEventListener('error', () => finish('unavailable'))
      current.addEventListener('close', () => finish('unavailable'))
    }

    function start() {
      if (active) return
      active = true
      schedule(0)
    }

    function stop() {
      active = false
      clearScheduledProbe()
      const current = socket
      socket = null
      if (current && current.readyState < 2) current.close()
    }

    return { start, stop }
  }

  const suiteProbe = { createSuiteProbe }

  globalScope.HudSuiteProbe = suiteProbe
  if (typeof module !== 'undefined') module.exports = suiteProbe
})(typeof globalThis === 'undefined' ? this : globalThis)
