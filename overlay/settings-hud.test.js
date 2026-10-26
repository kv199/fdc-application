const test = require('node:test')
const assert = require('node:assert/strict')

// The widget rules read HudWidgets.COMPONENTS when they run. hud-widgets.js sets it on the
// global object when it loads in Node, the same way the browser loads it before settings.js.
require('./hud-widgets.js')
const SettingsHud = require('./settings-hud.js')

const { create, normalizeLayoutMode, allWidgetsOn, anyWidgetOn, brakeMarkDependencies } = SettingsHud

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

test('brake target: the TARGET switch needs Throttle & Brake or Input Graph, and its level needs TARGET on', () => {
  const on = { pedals: true, history: true }
  const off = { pedals: false, history: false }
  const target = { targetEnabled: true }
  const noTarget = { targetEnabled: false }

  // Both widgets on: the switch works; the level works only while TARGET is on.
  assert.deepEqual(brakeMarkDependencies(on, target), { targetSwitchDisabled: false, targetLevelDisabled: false, targetSwitchHint: false, targetLevelHint: false, peakDisabled: false })
  assert.deepEqual(brakeMarkDependencies(on, noTarget), { targetSwitchDisabled: false, targetLevelDisabled: true, targetSwitchHint: false, targetLevelHint: true, peakDisabled: false })
  // One of the two widgets is enough for the target switch.
  assert.equal(brakeMarkDependencies({ pedals: false, history: true }, target).targetSwitchDisabled, false)
  assert.equal(brakeMarkDependencies({ pedals: true, history: false }, target).targetSwitchDisabled, false)
  // Both off: the switch and the level are disabled, and the widget hint shows instead of the level hint.
  assert.deepEqual(brakeMarkDependencies(off, target), { targetSwitchDisabled: true, targetLevelDisabled: true, targetSwitchHint: true, targetLevelHint: false, peakDisabled: true })
  assert.deepEqual(brakeMarkDependencies(off, noTarget), { targetSwitchDisabled: true, targetLevelDisabled: true, targetSwitchHint: true, targetLevelHint: false, peakDisabled: true })
})

test('brake peak marker: it is disabled only while Throttle & Brake is off', () => {
  assert.equal(brakeMarkDependencies({ pedals: false, history: true }, {}).peakDisabled, true)
  assert.equal(brakeMarkDependencies({ pedals: true, history: false }, {}).peakDisabled, false)
  assert.equal(brakeMarkDependencies({}, {}).peakDisabled, false)
})

test('brake dependencies read a missing widget key as on, and missing preferences as off', () => {
  assert.deepEqual(brakeMarkDependencies({}, undefined), { targetSwitchDisabled: false, targetLevelDisabled: true, targetSwitchHint: false, targetLevelHint: true, peakDisabled: false })
})

test('ALL being on always means ANY is on', () => {
  const { visibility, overlay } = switchesAll(true)
  assert.equal(allWidgetsOn(visibility, overlay), true)
  assert.equal(anyWidgetOn(visibility, overlay), true)
})
