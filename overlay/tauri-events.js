(function (globalScope) {
  'use strict'

  function getInternalEventApi() {
    const internals = globalScope.__TAURI_INTERNALS__
    if (!internals || typeof internals.invoke !== 'function' || typeof internals.transformCallback !== 'function') return null

    return {
      listen: (event, handler) => {
        const callbackId = internals.transformCallback(handler)
        return Promise.resolve(internals.invoke('plugin:event|listen', {
          event,
          target: { kind: 'Any' },
          handler: callbackId
        })).then(eventId => async () => {
          await internals.invoke('plugin:event|unlisten', { event, eventId })
          internals.unregisterCallback?.(callbackId)
        })
      },
      emit: (event, payload) => internals.invoke('plugin:event|emit', { event, payload })
    }
  }

  function getEventApi() {
    const globalEvents = globalScope.__TAURI__?.event
    const internalEvents = getInternalEventApi()
    if (!globalEvents && !internalEvents) return null

    return {
      listen: async (event, handler) => {
        if (typeof globalEvents?.listen === 'function') {
          try {
            return await globalEvents.listen(event, handler)
          } catch {
            // Fall back to the lower-level IPC bridge below.
          }
        }
        return internalEvents.listen(event, handler)
      },
      emit: async (event, payload) => {
        if (typeof globalEvents?.emit === 'function') {
          try {
            return await globalEvents.emit(event, payload)
          } catch {
            // Fall back to the lower-level IPC bridge below.
          }
        }
        return internalEvents.emit(event, payload)
      }
    }
  }

  globalScope.HudTauriEvents = { getEventApi }
})(typeof globalThis === 'undefined' ? this : globalThis)
