(function (globalScope) {
  'use strict'

  const STORAGE_KEY = 'forza-horizon-6-hud.hud-visibility.v1'
  const COMPONENTS = ['tires', 'pedals', 'steering', 'gear', 'history']
  const COLUMN_WIDTHS = {
    tires: '72px',
    pedals: '46px',
    steering: '68px',
    gear: '92px',
    history: '342px'
  }
  const DEFAULT_STATE = COMPONENTS.reduce((state, name) => {
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

  function createPreferences() {
    const hud = document.getElementById('hud')
    const hudFrame = document.getElementById('hud-frame')
    if (!hud || !hudFrame) return null

    const sections = {
      tires: document.getElementById('hud-tires'),
      pedals: document.getElementById('hud-pedals'),
      steering: document.getElementById('hud-steering'),
      gear: document.getElementById('hud-gear'),
      history: document.getElementById('hud-history')
    }
    if (Object.values(sections).some(section => !section)) return null

    let state = readState()

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
      hudFrame.hidden = !hasVisibleContent
      if (hasVisibleContent) {
        hud.style.gridTemplateColumns = visibleColumns.join(' ')
        hud.style.width = `${visibleColumns.reduce((total, column) => total + Number.parseFloat(column), 0)}px`
      }
      saveState(state)
      globalScope.HudLayout?.refreshLayout?.()
    }

    apply()

    const api = {
      components: COMPONENTS,
      getState: () => ({ ...state }),
      setVisibility: (name, visible) => {
        if (!COMPONENTS.includes(name)) return
        apply({ ...state, [name]: visible === true })
      },
      apply
    }
    return api
  }

  const api = {
    components: COMPONENTS,
    defaultState: () => ({ ...DEFAULT_STATE }),
    readState
  }

  if (typeof document !== 'undefined') {
    const preferences = createPreferences()
    if (preferences) Object.assign(api, preferences)
  }

  if (typeof globalScope !== 'undefined') globalScope.HudPreferences = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
