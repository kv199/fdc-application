const test = require('node:test')
const assert = require('node:assert/strict')

global.localStorage = {
  getItem: () => JSON.stringify({ tires: false, gear: false })
}

const preferences = require('./hud-preferences.js')

test.after(() => {
  delete global.localStorage
})

test('legacy HUD visibility keeps existing choices and enables the new Engine block', () => {
  assert.deepEqual(preferences.readState(), {
    tires: false,
    pedals: true,
    steering: true,
    gear: false,
    engine: true,
    history: true
  })
})

test('HUD component order places Engine directly before Input Graph', () => {
  assert.deepEqual(preferences.components, ['tires', 'pedals', 'steering', 'gear', 'engine', 'history'])
})

test('Delta visibility stays synchronized across telemetry and HUD preference updates', () => {
  const modulePath = require.resolve('./hud-preferences.js')
  const previousDocument = global.document
  const previousHudLayout = global.HudLayout
  const previousHudOverlay = global.HudOverlay
  const previousHudPreferences = global.HudPreferences
  const previousLocalStorage = global.localStorage
  const storage = new Map([
    ['fdc.overlay-visibility.v1', JSON.stringify({ delta: false, hud: true })]
  ])
  const elements = new Map([
    ['hud', { hidden: false, style: {} }],
    ['hud-frame', { hidden: false }],
    ['delta-strip', { hidden: false }],
    ['shift-bar', { hidden: false }],
    ['hud-tires', { hidden: false }],
    ['hud-pedals', { hidden: false }],
    ['hud-steering', { hidden: false }],
    ['hud-gear', { hidden: false }],
    ['hud-engine', { hidden: false }],
    ['hud-history', { hidden: false }]
  ])

  try {
    global.localStorage = {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value)
    }
    global.document = {
      getElementById: id => elements.get(id) || null
    }
    global.HudLayout = {
      getMode: () => 'grouped',
      refreshLayout: () => undefined
    }
    global.HudOverlay = {
      refresh: () => undefined
    }

    delete require.cache[modulePath]
    const runtimePreferences = require('./hud-preferences.js')
    const delta = elements.get('delta-strip')

    assert.equal(delta.hidden, true)
    runtimePreferences.setTelemetryVisible(false)
    runtimePreferences.setTelemetryVisible(true)
    runtimePreferences.setVisibility('tires', false)
    assert.equal(delta.hidden, true)

    runtimePreferences.setOverlayVisibility('delta', true)
    // Delta remains hidden without an active reference
    assert.equal(delta.hidden, true)

    runtimePreferences.setDeltaReferenceActive(true)
    assert.equal(delta.hidden, false)
  } finally {
    delete require.cache[modulePath]
    global.document = previousDocument
    global.HudLayout = previousHudLayout
    global.HudOverlay = previousHudOverlay
    global.HudPreferences = previousHudPreferences
    global.localStorage = previousLocalStorage
  }
})

// Loads the real preferences module on a minimal DOM with the given stored overlay state.
function loadOverlayPreferences(storedOverlayState) {
  const modulePath = require.resolve('./hud-preferences.js')
  const globals = ['document', 'HudLayout', 'HudOverlay', 'HudPreferences', 'localStorage']
  const previous = Object.fromEntries(globals.map(name => [name, global[name]]))
  const storage = new Map()
  if (storedOverlayState !== undefined) storage.set('fdc.overlay-visibility.v1', JSON.stringify(storedOverlayState))
  const elements = new Map([
    'hud', 'hud-frame', 'delta-strip', 'shift-bar', 'hud-tires', 'hud-pedals', 'hud-steering', 'hud-gear', 'hud-engine', 'hud-history'
  ].map(id => [id, { hidden: false, style: {} }]))
  global.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value)
  }
  global.document = { getElementById: id => elements.get(id) || null }
  global.HudLayout = { getMode: () => 'grouped', refreshLayout: () => undefined }
  global.HudOverlay = { refresh: () => undefined }
  delete require.cache[modulePath]
  const runtime = require(modulePath)
  return {
    runtime,
    elements,
    storage,
    restore() {
      delete require.cache[modulePath]
      for (const name of globals) {
        if (previous[name] === undefined) delete global[name]
        else global[name] = previous[name]
      }
    }
  }
}

test('the Shift Bar is off by default and an old stored state without its key stays off', () => {
  for (const stored of [undefined, { delta: false, hud: true }]) {
    const loaded = loadOverlayPreferences(stored)
    try {
      assert.equal(loaded.elements.get('shift-bar').hidden, true, 'hidden while its switch is off')
      assert.deepEqual(loaded.runtime.getOverlayState(), {
        delta: stored?.delta !== false,
        hud: true,
        shiftBar: false
      })
    } finally {
      loaded.restore()
    }
  }
})

test('turning the Shift Bar on saves it and keeps the other overlay switches', () => {
  const loaded = loadOverlayPreferences({ delta: false, hud: true })
  try {
    loaded.runtime.setOverlayVisibility('shiftBar', true)
    assert.equal(loaded.elements.get('shift-bar').hidden, false)
    assert.deepEqual(JSON.parse(loaded.storage.get('fdc.overlay-visibility.v1')), { delta: false, hud: true, shiftBar: true })
    assert.equal(loaded.runtime.isOverlayVisible('delta'), false)
  } finally {
    loaded.restore()
  }
})

test('the Shift Bar follows telemetry visibility and works with the HUD blocks switched off', () => {
  const loaded = loadOverlayPreferences({ shiftBar: true })
  try {
    const bar = loaded.elements.get('shift-bar')
    assert.equal(bar.hidden, false)
    loaded.runtime.setTelemetryVisible(false)
    assert.equal(bar.hidden, true, 'hidden without live telemetry')
    loaded.runtime.setTelemetryVisible(true)
    assert.equal(bar.hidden, false)

    for (const name of ['gear', 'tires', 'pedals', 'steering', 'engine', 'history']) loaded.runtime.setVisibility(name, false)
    assert.equal(bar.hidden, false, 'Speed, Gear and RPM switched off do not hide the bar')
  } finally {
    loaded.restore()
  }
})

test('the Shift Bar is an editable target only while its switch is on, in both arrangements', () => {
  const { resolveEditableTargets } = require('./hud-preferences.js')
  const state = { tires: true, pedals: true, steering: true, gear: true, engine: true, history: true }
  assert.deepEqual(
    resolveEditableTargets({ state, overlayState: { hud: true, delta: true, shiftBar: true }, mode: 'grouped' }),
    ['hud', 'delta', 'shiftBar']
  )
  assert.deepEqual(
    resolveEditableTargets({ state, overlayState: { hud: true, delta: true, shiftBar: false }, mode: 'freeform' }),
    ['tires', 'pedals', 'steering', 'gear', 'engine', 'history', 'delta']
  )
  assert.deepEqual(
    resolveEditableTargets({ state, overlayState: { hud: false, delta: false, shiftBar: true }, mode: 'freeform' }),
    ['shiftBar']
  )
  assert.deepEqual(
    resolveEditableTargets({ state, overlayState: { hud: true, delta: true }, mode: 'grouped' }),
    ['hud', 'delta'],
    'a missing key is off'
  )
})
