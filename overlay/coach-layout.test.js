const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const layout = require('./coach-layout.js')
const source = fs.readFileSync(path.join(__dirname, 'coach-layout.js'), 'utf8')
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
const css = fs.readFileSync(path.join(__dirname, 'overlay.css'), 'utf8')

test('sanitizes finite positions and widget sizes', () => {
  assert.deepEqual(layout.sanitizePosition({ x: -0.2, y: 1.4 }), { x: 0, y: 1 })
  assert.equal(layout.sanitizePosition({ x: 0.4 }), null)
  assert.deepEqual(layout.clampPosition({ x: Number.NaN, y: 0.5 }), { x: 0, y: 0 })
  assert.equal(layout.sanitizeWidgetSize(0), 0)
  assert.equal(layout.sanitizeWidgetSize(0.1), 0.5)
  assert.equal(layout.sanitizeWidgetSize(1.25), 1.25)
  assert.equal(layout.sanitizeWidgetSize(3), 2)
})

test('uses a fresh v2 namespace and never reads the old layout', () => {
  assert.equal(layout.STORAGE_KEY, 'fdc.layout.v2')
  assert.equal(layout.MODE_STORAGE_KEY, 'fdc.layout-mode.v1')
  assert.match(source, /const STORAGE_KEY = 'fdc\.layout\.v2'/)
  assert.doesNotMatch(source, /fdc\.layout\.v1/)
  assert.deepEqual(layout.MODES, ['grouped', 'freeform'])
})

test('keeps shared coach/delta targets and separates grouped/freeform telemetry targets', () => {
  assert.deepEqual(layout.GROUPED_TARGETS, ['coach', 'delta', 'hud'])
  assert.deepEqual(layout.FREEFORM_TARGETS, ['tires', 'pedals', 'steering', 'gear', 'engine', 'history'])
  assert.match(source, /shared: stored\.shared/)
  assert.match(source, /grouped: stored\.grouped/)
  assert.match(source, /freeform: stored\.freeform/)
})

test('freeform preserves current compact grid widths and 69px height', () => {
  assert.match(source, /tires: 72, pedals: 46, steering: 68, gear: 92, engine: 116, history: 342/)
  assert.match(source, /const HUD_BASE_HEIGHT = 69/)
  assert.match(css, /\.hud\[data-layout-mode='freeform'\] > section\.hud-freeform-widget[\s\S]*height: 69px/)
  assert.match(css, /section\.hud-freeform-widget\.layout-positioned[\s\S]*transform:[^;]+!important/)
  assert.match(html, /data-hud-widget="tires"/)
  assert.match(html, /data-hud-widget="history"/)
})

test('freeform targets expose independent edit, reset, cancel, save and resize behavior', () => {
  assert.match(source, /function resetPosition\(name = editingTarget \|\| 'coach'\)/)
  assert.match(source, /function resetLayout\(targetMode = mode\)/)
  assert.match(source, /setMode,[\s\S]*getMode: \(\) => mode/)
  assert.match(source, /dataset\.layoutResizeTarget = name/)
  assert.match(source, /for \(const name of TARGET_NAMES\)/)
  assert.match(source, /const fixedRight = rect\.left \+ rect\.width/)
  assert.match(source, /const fixedBottom = rect\.top \+ rect\.height/)
  assert.match(css, /\.hud-freeform-widget\.is-editing \{[\s\S]*pointer-events: auto/)
})

test('mode changes refresh visibility layout and both modes retain separate state', () => {
  assert.match(source, /storageSet\(MODE_STORAGE_KEY, mode\)/)
  assert.match(source, /globalScope\.HudPreferences\?\.apply\?\.\(\)/)
  assert.match(source, /if \(name === 'hud'\) return positions\.grouped/)
  assert.match(source, /return positions\.freeform/)
})
