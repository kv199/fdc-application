(function (globalScope) {
  'use strict'

  // Canonical HUD block list shared by the overlay and the Configuration
  // window. The native command whitelists in src-tauri/src/main.rs mirror it.
  const COMPONENTS = Object.freeze(['tires', 'pedals', 'steering', 'gear', 'engine', 'history'])
  const OVERLAY_COMPONENTS = Object.freeze(['delta', 'hud'])
  const COLUMN_WIDTHS = Object.freeze({
    tires: 72,
    pedals: 46,
    steering: 68,
    gear: 92,
    engine: 116,
    history: 342
  })

  const api = Object.freeze({ COMPONENTS, OVERLAY_COMPONENTS, COLUMN_WIDTHS })

  if (typeof globalScope !== 'undefined') globalScope.HudWidgets = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
