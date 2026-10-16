const test = require('node:test')
const assert = require('node:assert/strict')

// The widget rules read HudWidgets.COMPONENTS when they run. hud-widgets.js sets it on the
// global object when it loads in Node, the same way the browser loads it before settings.js.
require('./hud-widgets.js')
const SettingsHud = require('./settings-hud.js')

const { create, normalizeLayoutMode, allWidgetsOn, anyWidgetOn } = SettingsHud

const WIDGETS = ['tires', 'pedals', 'steering', 'gear', 'engine', 'history']

function switchesAll(value) {
  return {
    visibility: Object.fromEntries(WIDGETS.map(name => [name, value])),
    overlay: { delta: value, hud: value, shiftBar: value }
  }
}

test('settings-hud.js loads without a DOM and exports create() and its pure rules', () => {
  assert.equal(typeof globalThis.document, 'undefined')
  assert.equal(typeof create, 'function')
  assert.equal(typeof normalizeLayoutMode, 'function')
  assert.equal(typeof allWidgetsOn, 'function')
  assert.equal(typeof anyWidgetOn, 'function')
})

test('normalizeLayoutMode: only freeform is freeform, and every other value reads as grouped', () => {
  assert.equal(normalizeLayoutMode('freeform'), 'freeform')
  assert.equal(normalizeLayoutMode('grouped'), 'grouped')
  assert.equal(normalizeLayoutMode(null), 'grouped')
  assert.equal(normalizeLayoutMode(undefined), 'grouped')
  assert.equal(normalizeLayoutMode('FREEFORM'), 'grouped')
  assert.equal(normalizeLayoutMode('unknown'), 'grouped')
})

test('ALL is on only when every widget and Delta are on and the Shift Bar is explicitly on', () => {
  const { visibility, overlay } = switchesAll(true)
  assert.equal(allWidgetsOn(visibility, overlay), true)
  // The Shift Bar is off by default, so a missing key counts as off for ALL.
  assert.equal(allWidgetsOn(visibility, { ...overlay, shiftBar: undefined }), false)
  assert.equal(allWidgetsOn(visibility, { ...overlay, shiftBar: false }), false)
  assert.equal(allWidgetsOn(visibility, { ...overlay, delta: false }), false)
  assert.equal(allWidgetsOn({ ...visibility, gear: false }, overlay), false)
})

test('ALL treats a widget without a stored switch as on, since only an explicit false turns it off', () => {
  const { overlay } = switchesAll(true)
  assert.equal(allWidgetsOn({}, overlay), true)
  assert.equal(allWidgetsOn({ tires: false }, overlay), false)
})

test('ANY is on when a widget, Delta or the Shift Bar is on, and the removed whole-HUD switch does not count', () => {
  const { visibility, overlay } = switchesAll(false)
  assert.equal(anyWidgetOn(visibility, overlay), false)
  assert.equal(anyWidgetOn({ ...visibility, history: true }, overlay), true)
  assert.equal(anyWidgetOn(visibility, { ...overlay, delta: true }), true)
  assert.equal(anyWidgetOn(visibility, { ...overlay, shiftBar: true }), true)
  assert.equal(anyWidgetOn(visibility, { ...overlay, shiftBar: undefined }), false)
  assert.equal(anyWidgetOn(visibility, { ...overlay, hud: true }), false)
})

test('ALL being on always means ANY is on', () => {
  const { visibility, overlay } = switchesAll(true)
  assert.equal(allWidgetsOn(visibility, overlay), true)
  assert.equal(anyWidgetOn(visibility, overlay), true)
})
