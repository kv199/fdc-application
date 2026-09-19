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
