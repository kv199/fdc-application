(function (globalScope) {
  'use strict'

  const { COMPONENTS, OVERLAY_COMPONENTS, COLUMN_WIDTHS } = globalScope.HudWidgets || require('./hud-widgets.js')
  const STORAGE_KEY = 'fdc.hud-visibility.v1'
  const OVERLAY_STORAGE_KEY = 'fdc.overlay-visibility.v1'
  const DEFAULT_STATE = COMPONENTS.reduce((state, name) => {
    state[name] = true
    return state
  }, {})
  const DEFAULT_OVERLAY_STATE = OVERLAY_COMPONENTS.reduce((state, name) => {
    state[name] = true
    return state
  }, {})

  function readState() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (!stored || typeof stored !== 'object') return { ...DEFAULT_STATE }
      return COMPONENTS.reduce((state, name) => {
        state[name] = stored[name] !== false
        return state
      }, {})
    } catch {
      return { ...DEFAULT_STATE }
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      // A restricted webview may not expose persistent storage.
    }
  }

  function readOverlayState() {
    try {
      const stored = JSON.parse(localStorage.getItem(OVERLAY_STORAGE_KEY) || 'null')
      if (!stored || typeof stored !== 'object') return { ...DEFAULT_OVERLAY_STATE }
      return OVERLAY_COMPONENTS.reduce((state, name) => {
        state[name] = stored[name] !== false
        return state
      }, {})
    } catch {
      return { ...DEFAULT_OVERLAY_STATE }
    }
  }

  function resolveHudVisibility(input) {
    const { state, overlayState, telemetryVisible, mode, editingTarget } = input
    const sections = {}
    for (const name of COMPONENTS) {
      sections[name] = state[name] === false
    }
    const hasVisibleContent = COMPONENTS.some(name => state[name] !== false)
    let hud = !hasVisibleContent
    let hudFrame = !telemetryVisible || overlayState.hud === false || !hasVisibleContent
    let delta = !telemetryVisible || overlayState.delta === false

    // A layout edit keeps its target and the target's containers visible,
    // whatever telemetry or the visibility switches would otherwise hide.
    if (editingTarget === 'delta') {
      delta = false
    } else if (editingTarget === 'hud' && mode === 'grouped') {
      hudFrame = false
    } else if (COMPONENTS.includes(editingTarget) && mode === 'freeform') {
      sections[editingTarget] = false
      hud = false
      hudFrame = false
    }

    return { hud, hudFrame, delta, sections }
  }

  function saveOverlayState(state) {
    try {
      localStorage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify(state))
    } catch {
      // A restricted webview may not expose persistent storage.
    }
  }

  function createPreferences() {
    const hud = document.getElementById('hud')
    const hudFrame = document.getElementById('hud-frame')
    const overlayElements = {
      delta: document.getElementById('delta-strip')
    }
    if (!hud || !hudFrame || Object.values(overlayElements).some(element => !element)) return null

    const sections = {
      tires: document.getElementById('hud-tires'),
      pedals: document.getElementById('hud-pedals'),
      steering: document.getElementById('hud-steering'),
      gear: document.getElementById('hud-gear'),
      engine: document.getElementById('hud-engine'),
      history: document.getElementById('hud-history')
    }
    if (Object.values(sections).some(section => !section)) return null

    let state = readState()
    let overlayState = readOverlayState()
    let telemetryVisible = true

    function apply(nextState = state) {
      state = COMPONENTS.reduce((result, name) => {
        result[name] = nextState[name] !== false
        return result
      }, {})

      const visibility = resolveHudVisibility({
        state,
        overlayState,
        telemetryVisible,
        mode: globalScope.HudLayout?.getMode?.() || 'grouped',
        editingTarget: globalScope.HudLayout?.getEditingTarget?.() ?? null
      })

      for (const name of COMPONENTS) sections[name].hidden = visibility.sections[name]
      hud.hidden = visibility.hud
      hudFrame.hidden = visibility.hudFrame
      overlayElements.delta.hidden = visibility.delta

      const visibleColumns = COMPONENTS
        .filter(name => state[name])
        .map(name => COLUMN_WIDTHS[name])
      const hasVisibleContent = visibleColumns.length > 0
      if (hasVisibleContent && globalScope.HudLayout?.getMode?.() !== 'freeform') {
        hud.style.gridTemplateColumns = visibleColumns.map(width => `${width}px`).join(' ')
        hud.style.width = `${visibleColumns.reduce((total, width) => total + width, 0)}px`
      } else if (globalScope.HudLayout?.getMode?.() === 'freeform') {
        hud.style.gridTemplateColumns = ''
        hud.style.width = ''
      }
      globalScope.HudLayout?.refreshLayout?.()
    }

    function applyOverlayVisibility() {
      apply(state)
      globalScope.HudOverlay?.refresh?.()
    }

    apply()

    const api = {
      components: COMPONENTS,
      getState: () => ({ ...state }),
      getOverlayState: () => ({ ...overlayState }),
      isOverlayVisible: name => overlayState[name] !== false,
      setTelemetryVisible: visible => {
        const next = visible !== false
        if (next === telemetryVisible) return
        telemetryVisible = next
        apply(state)
      },
      setVisibility: (name, visible) => {
        if (!COMPONENTS.includes(name)) return
        apply({ ...state, [name]: visible === true })
        saveState(state)
      },
      getLayoutMode: () => globalScope.HudLayout?.getMode?.() || 'grouped',
      setLayoutMode: mode => globalScope.HudLayout?.setMode?.(mode),
      setOverlayVisibility: (name, visible) => {
        if (!OVERLAY_COMPONENTS.includes(name)) return
        overlayState = {
          ...overlayState,
          [name]: visible === true
        }
        saveOverlayState(overlayState)
        apply(state)
        globalScope.HudOverlay?.refresh?.()
      },
      apply
    }
    applyOverlayVisibility()
    return api
  }

  const api = {
    components: COMPONENTS,
    defaultState: () => ({ ...DEFAULT_STATE }),
    readState,
    overlayComponents: OVERLAY_COMPONENTS,
    defaultOverlayState: () => ({ ...DEFAULT_OVERLAY_STATE }),
    readOverlayState,
    resolveHudVisibility
  }

  if (typeof document !== 'undefined') {
    const preferences = createPreferences()
    if (preferences) Object.assign(api, preferences)
  }

  if (typeof globalScope !== 'undefined') globalScope.HudPreferences = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
