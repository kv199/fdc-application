(function (globalScope) {
  'use strict'

  // Canonical HUD block list shared by the overlay and the Configuration
  // window. The native command whitelists in src-tauri/src/main.rs mirror it.
  const COMPONENTS = Object.freeze(['tires', 'pedals', 'steering', 'gear', 'engine', 'history'])
  const OVERLAY_COMPONENTS = Object.freeze(['delta', 'hud', 'shiftBar'])
  // Overlay blocks that are off until their switch is turned on. A stored
  // state without their key reads as off; every other overlay key keeps its default.
  const DEFAULT_OFF_OVERLAY_COMPONENTS = Object.freeze(['shiftBar'])
  const COLUMN_WIDTHS = Object.freeze({
    tires: 72,
    pedals: 46,
    steering: 68,
    gear: 92,
    engine: 116,
    history: 342
  })

  // Reads one overlay switch from a stored state object (or null when nothing is stored).
  function isOverlayComponentOn(stored, name) {
    const value = stored && typeof stored === 'object' ? stored[name] : undefined
    if (DEFAULT_OFF_OVERLAY_COMPONENTS.includes(name)) return value === true
    return value !== false
  }

  const api = Object.freeze({
    COMPONENTS,
    OVERLAY_COMPONENTS,
    DEFAULT_OFF_OVERLAY_COMPONENTS,
    COLUMN_WIDTHS,
    isOverlayComponentOn
  })

  if (typeof globalScope !== 'undefined') globalScope.HudWidgets = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
