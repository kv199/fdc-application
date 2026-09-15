(function (globalScope) {
  'use strict'

  const STORAGE_KEY = 'fdc.hud-visibility.v1'
  const OVERLAY_STORAGE_KEY = 'fdc.overlay-visibility.v1'
  const COMPONENTS = ['tires', 'pedals', 'steering', 'gear', 'engine', 'history']
  const OVERLAY_COMPONENTS = ['coach', 'delta', 'hud']
  const COLUMN_WIDTHS = {
    tires: '72px',
    pedals: '46px',
    steering: '68px',
    gear: '92px',
    engine: '116px',
    history: '342px'
  }
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
      coach: document.getElementById('coach-card'),
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

      for (const name of COMPONENTS) sections[name].hidden = !state[name]

      const visibleColumns = COMPONENTS
        .filter(name => state[name])
        .map(name => COLUMN_WIDTHS[name])
      const hasVisibleContent = visibleColumns.length > 0
      hud.hidden = !hasVisibleContent
      hudFrame.hidden = !telemetryVisible || !overlayState.hud || !hasVisibleContent
      if (hasVisibleContent && globalScope.HudLayout?.getMode?.() !== 'freeform') {
        hud.style.gridTemplateColumns = visibleColumns.join(' ')
        hud.style.width = `${visibleColumns.reduce((total, column) => total + Number.parseFloat(column), 0)}px`
      } else if (globalScope.HudLayout?.getMode?.() === 'freeform') {
        hud.style.gridTemplateColumns = ''
        hud.style.width = ''
      }
      saveState(state)
      saveOverlayState(overlayState)
      globalScope.HudLayout?.refreshLayout?.()
    }

    function applyOverlayVisibility() {
      if (!overlayState.coach) overlayElements.coach.hidden = true
      if (!overlayState.delta) overlayElements.delta.hidden = true
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
        telemetryVisible = visible !== false
        apply(state)
      },
      setVisibility: (name, visible) => {
        if (!COMPONENTS.includes(name)) return
        apply({ ...state, [name]: visible === true })
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
    readOverlayState
  }

  if (typeof document !== 'undefined') {
    const preferences = createPreferences()
    if (preferences) Object.assign(api, preferences)
  }

  if (typeof globalScope !== 'undefined') globalScope.HudPreferences = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
