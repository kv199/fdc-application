const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const layout = require('./hud-layout.js')
const { readRustSources } = require('../tools/test-sources.cjs')
const source = fs.readFileSync(path.join(__dirname, 'hud-layout.js'), 'utf8')
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

test('the Shift Bar defaults to 0.5 and reads a stored size below 0.5 as 0.5', () => {
  assert.equal(layout.SHIFT_BAR_DEFAULT_SIZE, 0.5)
  assert.equal(layout.SHIFT_BAR_MIN_SIZE, 0.5)
  // Stored size 0 means never resized, so the Shift Bar uses its 0.5 default.
  assert.equal(layout.resolveWidgetScaleFactor('shiftBar', 0), 0.5)
  assert.equal(layout.resolveWidgetScaleFactor('shiftBar', undefined), 0.5)
  assert.equal(layout.resolveWidgetScaleFactor('shiftBar', 'not a number'), 0.5)
  assert.equal(layout.resolveWidgetScaleFactor('shiftBar', 0.3), 0.5)
  // Stored sizes from 0.5 to 2 keep working unchanged.
  assert.equal(layout.resolveWidgetScaleFactor('shiftBar', 0.5), 0.5)
  assert.equal(layout.resolveWidgetScaleFactor('shiftBar', 1.2), 1.2)
  assert.equal(layout.resolveWidgetScaleFactor('shiftBar', 2), 2)
  assert.equal(layout.resolveWidgetScaleFactor('shiftBar', 3), 2)
  assert.equal(layout.sanitizeWidgetSize(0.3, 'shiftBar'), 0.5)
  assert.equal(layout.sanitizeWidgetSize(0, 'shiftBar'), 0, 'the stored never-resized value stays 0')
})

test('every other widget still defaults to 1 and keeps the 0.5 to 2 limits', () => {
  for (const name of ['delta', 'hud', 'tires', 'history']) {
    assert.equal(layout.resolveWidgetScaleFactor(name, 0), 1, `${name} default`)
    assert.equal(layout.resolveWidgetScaleFactor(name, undefined), 1, `${name} unset`)
    assert.equal(layout.resolveWidgetScaleFactor(name, 0.3), 0.5, `${name} minimum`)
    assert.equal(layout.resolveWidgetScaleFactor(name, 1.2), 1.2, `${name} stored`)
    assert.equal(layout.resolveWidgetScaleFactor(name, 3), 2, `${name} maximum`)
  }
})

test('the editor never resizes the Shift Bar below 0.5 and keeps the 2x maximum', () => {
  const viewport = { width: 1920, height: 1080 }
  const baseSize = { width: 736, height: 48 }
  assert.equal(layout.clampResizedWidgetSize('shiftBar', 0.2, viewport, baseSize), 0.5)
  assert.equal(layout.clampResizedWidgetSize('shiftBar', 0.5, viewport, baseSize), 0.5)
  assert.equal(layout.clampResizedWidgetSize('shiftBar', 1.5, viewport, baseSize), 1.5)
  assert.equal(layout.clampResizedWidgetSize('shiftBar', 9, viewport, baseSize), 2)
  // A small viewport lowers the maximum, but never below the minimum.
  assert.equal(layout.clampResizedWidgetSize('shiftBar', 1.5, { width: 368, height: 1080 }, baseSize), 0.5)
  // Other widgets keep their own 0.5 minimum.
  assert.equal(layout.clampResizedWidgetSize('delta', 0.2, viewport, baseSize), 0.5)
  assert.equal(layout.clampResizedWidgetSize('hud', 0.2, viewport, baseSize), 0.5)
  assert.equal(layout.clampResizedWidgetSize('hud', 9, viewport, baseSize), 2)
  assert.equal(layout.clampResizedWidgetSize('tires', 1.2, viewport, baseSize), 1.2)
  // The live editor resize and the size lookup both go through the shared helpers.
  assert.match(source, /size: clampResizedWidgetSize\(name, requested, viewport, baseSize\)/)
  assert.match(source, /return resolveWidgetScaleFactor\(name, getWidgetSize\(name\)\)/)
})

test('keeps editor toolbar inside the viewport and flips it above bottom-edge targets', () => {
  const viewport = { width: 1000, height: 800 }
  const toolbar = { width: 420, height: 48 }

  assert.deepEqual(
    layout.calculateEditorToolbarPosition({ left: 24, top: 700, bottom: 780 }, toolbar, viewport),
    { left: 24, top: 642 }
  )
  assert.deepEqual(
    layout.calculateEditorToolbarPosition({ left: 24, top: 20, bottom: 100 }, toolbar, viewport),
    { left: 24, top: 110 }
  )
  assert.deepEqual(
    layout.calculateEditorToolbarPosition({ left: 900, top: 20, bottom: 100 }, toolbar, viewport),
    { left: 572, top: 110 }
  )
})

test('uses a fresh v2 namespace and never reads the old layout', () => {
  assert.equal(layout.STORAGE_KEY, 'fdc.layout.v2')
  assert.equal(layout.MODE_STORAGE_KEY, 'fdc.layout-mode.v1')
  assert.match(source, /const STORAGE_KEY = 'fdc\.layout\.v2'/)
  assert.doesNotMatch(source, /fdc\.layout\.v1/)
  assert.deepEqual(layout.MODES, ['grouped', 'freeform'])
})

test('keeps Delta and grouped HUD separate from freeform telemetry targets', () => {
  assert.deepEqual(layout.GROUPED_TARGETS, ['delta', 'hud', 'shiftBar'])
  assert.deepEqual(layout.FREEFORM_TARGETS, ['tires', 'pedals', 'steering', 'gear', 'engine', 'history'])
  assert.match(source, /shared: stored\.shared/)
  assert.match(source, /grouped: stored\.grouped/)
  assert.match(source, /freeform: stored\.freeform/)
})

test('freeform preserves current compact grid widths and 69px height', () => {
  const hudWidgets = require('./hud-widgets.js')
  assert.deepEqual(hudWidgets.COLUMN_WIDTHS, { tires: 72, pedals: 46, steering: 68, gear: 92, engine: 116, history: 342 })
  assert.match(source, /const HUD_BASE_HEIGHT = 69/)
  assert.match(css, /\.hud\[data-layout-mode='freeform'\] > section\.hud-freeform-widget[\s\S]*height: 69px/)
  assert.match(css, /section\.hud-freeform-widget\.layout-positioned[\s\S]*transform:[^;]+!important/)
  assert.match(html, /data-hud-widget="tires"/)
  assert.match(html, /data-hud-widget="history"/)
})

test('freeform targets expose independent edit, reset, cancel, save and resize behavior', () => {
  assert.match(source, /function resetPosition\(name = selectedTarget \|\| 'hud'\)/)
  assert.match(source, /function resetLayout\(targetMode = mode\)/)
  assert.match(source, /setMode,[\s\S]*getMode: \(\) => mode/)
  assert.match(source, /dataset\.layoutResizeTarget = name/)
  assert.match(source, /for \(const name of TARGET_NAMES\)/)
  assert.match(source, /const fixedRight = rect\.left \+ rect\.width/)
  assert.match(source, /const fixedBottom = rect\.top \+ rect\.height/)
  assert.match(source, /editorFrame\.className = 'hud-widget-editor-frame'/)
  assert.match(source, /hud\.append\(editorFrame\)/)
  assert.match(source, /function syncEditorToolbar\(name, rect\)/)
  assert.match(source, /function syncEditorFrame\(name\)/)
  assert.match(source, /if \(name === 'hud'\) syncEditorToolbar\(name, getStageRect\(element\)\)/)
  assert.match(source, /calculateEditorToolbarPosition\(rect, toolbarRect, viewport\)/)
  assert.match(css, /\.hud-widget-editor-frame \{[\s\S]*pointer-events: none/)
  assert.match(css, /\.hud-widget-editor-frame\.is-selected:not\(\[hidden\]\) \.layout-resize-handle/)
  assert.match(css, /\.hud-widget-editor-frame \.layout-edit-tools,[\s\S]*pointer-events: auto/)
})

test('snap preference exports storage key and defaults to on', () => {
  assert.equal(layout.SNAP_STORAGE_KEY, 'fdc.layout-snap.v1')
  assert.match(source, /const SNAP_STORAGE_KEY = 'fdc\.layout-snap\.v1'/)
})

test('snap preference persists as on or off', () => {
  assert.match(source, /function readStoredSnap\(\)/)
  assert.match(source, /storageSet\(SNAP_STORAGE_KEY, snapEnabled \? 'on' : 'off'\)/)
  assert.match(source, /return storageGet\(SNAP_STORAGE_KEY\) !== 'off'/)
})

test('updateFromPointer does not call snapRect while updateWidgetSizeFromPointer does not', () => {
  assert.match(source, /function updateFromPointer\(clientX, clientY\) \{[\s\S]*?if \(snapEnabled\)[\s\S]*?HudGrid\.snapRect/)
  assert.doesNotMatch(source, /function updateWidgetSizeFromPointer\(clientX, clientY\)[\s\S]*?HudGrid\.snapRect/)
})

test('mode changes refresh visibility layout and both modes retain separate state', () => {
  assert.match(source, /storageSet\(MODE_STORAGE_KEY, mode\)/)
  assert.match(source, /globalScope\.HudPreferences\?\.apply\?\.\(\)/)
  assert.match(source, /if \(name === 'hud'\) return positions\.grouped/)
  assert.match(source, /return positions\.freeform/)
})

test('resolveEditableTargets returns correct targets for each mode', () => {
  const { resolveEditableTargets } = require('./hud-preferences.js')

  const grouped = resolveEditableTargets({ state: { tires: true, pedals: true, steering: true, gear: true, engine: true, history: true }, overlayState: { hud: true, delta: true }, mode: 'grouped' })
  assert.deepEqual(grouped, ['hud', 'delta'])

  const groupedNoHud = resolveEditableTargets({ state: { tires: true, pedals: true, steering: true, gear: true, engine: true, history: true }, overlayState: { hud: false, delta: true }, mode: 'grouped' })
  assert.deepEqual(groupedNoHud, ['delta'])

  const groupedAllBlocksOff = resolveEditableTargets({ state: { tires: false, pedals: false, steering: false, gear: false, engine: false, history: false }, overlayState: { hud: true, delta: true }, mode: 'grouped' })
  assert.deepEqual(groupedAllBlocksOff, ['delta'])

  const groupedNothingOn = resolveEditableTargets({ state: { tires: false, pedals: false, steering: false, gear: false, engine: false, history: false }, overlayState: { hud: false, delta: false }, mode: 'grouped' })
  assert.deepEqual(groupedNothingOn, [])

  const freeform = resolveEditableTargets({ state: { tires: true, pedals: true, steering: true, gear: true, engine: true, history: false }, overlayState: { hud: true, delta: true }, mode: 'freeform' })
  assert.deepEqual(freeform, ['tires', 'pedals', 'steering', 'gear', 'engine', 'delta'])

  const freeformNoDelta = resolveEditableTargets({ state: { tires: true, pedals: true, steering: true, gear: true, engine: true, history: false }, overlayState: { hud: true, delta: false }, mode: 'freeform' })
  assert.deepEqual(freeformNoDelta, ['tires', 'pedals', 'steering', 'gear', 'engine'])
})

test('static toolbars bind CANCEL and SNAP to their own buttons', () => {
  const source = fs.readFileSync(path.join(__dirname, 'hud-layout.js'), 'utf8')
  assert.match(source, /cancel: document\.getElementById\(`\$\{domId\}-cancel`\)/)
  assert.match(source, /snap: document\.getElementById\(`\$\{domId\}-snap`\)/)
  assert.match(source, /const domId = TARGET_DOM_IDS\[name\] \|\| name/)
})

test('Shift Bar is an independent shared target with its own markup, handles and toolbar', () => {
  assert.match(source, /const SHARED_TARGETS = \['delta', 'shiftBar'\]/)
  assert.match(source, /if \(SHARED_TARGETS\.includes\(name\)\) return positions\.shared/)
  assert.match(source, /sanitizePositionMap\(stored\.shared, SHARED_TARGETS\)/)
  assert.match(source, /sanitizePositionMap\(layout\.shared, SHARED_TARGETS\)/)
  assert.match(source, /const TARGET_DOM_IDS = Object\.freeze\(\{ shiftBar: 'shift-bar' \}\)/)
  assert.match(source, /shiftBar: document\.getElementById\('shift-bar'\)/)
  assert.match(source, /elements\.shiftBar\.style\.setProperty\('--shift-bar-user-scale', scale\)/)
  assert.match(source, /applyPosition\('shiftBar'\)/)
  assert.match(source, /const names = mode === 'grouped' \? \['delta', 'shiftBar', 'hud'\] : \[\.\.\.FREEFORM_TARGETS, 'delta', 'shiftBar'\]/)

  const section = html.match(/<section id="shift-bar" class="shift-bar" aria-label="Shift bar" data-signal="normal" hidden>[\s\S]*?<\/section>/)
  assert.ok(section, 'the Shift Bar section is in index.html, hidden until its switch is on')
  assert.match(section[0], /<div id="shift-bar-segments" class="shift-bar__segments" aria-hidden="true"><\/div>/)
  assert.match(section[0], /<div id="shift-bar-edit-tools" class="layout-edit-tools" hidden>/)
  assert.match(section[0], /DRAG SHIFT BAR TO MOVE · CORNER TO RESIZE · CLICK A BLOCK TO SELECT/)
  for (const id of ['shift-bar-snap', 'shift-bar-reset', 'shift-bar-cancel', 'shift-bar-save']) {
    assert.match(section[0], new RegExp(`id="${id}"`))
  }
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    assert.match(section[0], new RegExp(`data-layout-resize-target="shiftBar" data-layout-resize-handle="${corner}"`))
  }
  // The Shift Bar sits between Delta and the HUD frame in the shell.
  const deltaEnd = html.indexOf('</section>', html.indexOf('id="delta-strip"'))
  assert.ok(deltaEnd < html.indexOf('<section id="shift-bar"') && html.indexOf('<section id="shift-bar"') < html.indexOf('id="hud-frame"'))
})

test('Shift Bar positioning: absolute, sized from the HUD scale and the user scale, edit state visible', () => {
  assert.match(css, /\.shift-bar \{[^}]*position: absolute;[^}]*width: calc\(736px \* var\(--hud-scale\) \* var\(--shift-bar-user-scale, 0\.5\)\);[^}]*height: calc\(48px \* var\(--hud-scale\) \* var\(--shift-bar-user-scale, 0\.5\)\);/s)
  // The CSS fallback is the Shift Bar default (0.5), so the first paint matches the layout script.
  assert.doesNotMatch(css, /--shift-bar-user-scale, 1\)/)
  assert.equal((css.match(/--shift-bar-user-scale, 0\.5\)/g) || []).length, 3)
  assert.match(css, /\.shift-bar\.is-editing \{[^}]*pointer-events: auto;/s)
  assert.match(css, /\.shift-bar\.is-editing\.is-selected \.layout-resize-handle \{\s*display: block;\s*\}/)
  assert.match(source, /const SHIFT_BAR_BASE_HEIGHT = 48/)
  assert.match(source, /const STACK_GAP = 10/)
})

test('Shift Bar defaults: above the HUD, Delta above the Shift Bar only while the bar is on', () => {
  assert.match(source, /if \(name === 'shiftBar'\) \{[\s\S]*?top: hudTop - STACK_GAP - elementSize\.height/)
  assert.match(source, /const shiftBarSlot = isShiftBarSwitchedOn\(\)[\s\S]*?: 0/)
  assert.match(source, /return \{ left: hudLeft, top: hudTop - shiftBarSlot - STACK_GAP - elementSize\.height \}/)
  // Defaults are not cached, so turning the bar on moves an unsaved Delta above it.
  assert.match(source, /function ensurePosition\(name\)[\s\S]*?return \{ x: [^}]*size: DEFAULT_SIZE \}\r?\n\s*\}/)
  assert.doesNotMatch(source, /map\[name\] = \{ x: available\.width/)
})

test('Shift Bar is a window-shrink target and uses the edit guard', () => {
  assert.match(source, /function isShiftBarSwitchedOn\(\)/)
  assert.match(source, /const unavailableShiftBar = name === 'shiftBar' && !isShiftBarSwitchedOn\(\)/)
  assert.match(source, /unavailableFreeformTarget \|\| unavailableShiftBar\) return/)
})

test('native layout_action maps start and reset_all actions', () => {
  const source = readRustSources()
  // Check that the actions are defined and call the correct JS functions
  assert.match(source, /"start"\s*=>\s*"window\.HudLayout\?\.startEditSession\?\.\(\)"/)
  assert.match(source, /"reset_all"\s*=>\s*"window\.HudLayout\?\.resetAllPositions\?\.\(\)"/)
  // Ensure these come in the layout_action function
  const layoutActionStart = source.indexOf('fn layout_action')
  const layoutActionEnd = source.indexOf('\n}\n', layoutActionStart) + 3
  const layoutActionSource = source.substring(layoutActionStart, layoutActionEnd)
  assert.match(layoutActionSource, /"start"/)
  assert.match(layoutActionSource, /"reset_all"/)
})

const MONITOR = { width: 1920, height: 1080, offsetX: 0, offsetY: 0 }

test('computeWindowBounds unions visible rects and pads them by 8 px', () => {
  const rects = [
    { left: 100, top: 200, width: 50, height: 40 },
    { left: 300, top: 250, width: 100, height: 30 }
  ]
  assert.deepEqual(layout.computeWindowBounds(rects, MONITOR), { left: 92, top: 192, width: 316, height: 96 })
  assert.deepEqual(layout.computeWindowBounds(rects, MONITOR, 0), { left: 100, top: 200, width: 300, height: 80 })
})

test('computeWindowBounds moves window-space rects into stage space by the offset', () => {
  const rects = [
    { left: 100, top: 200, width: 50, height: 40 },
    { left: 300, top: 250, width: 100, height: 30 }
  ]
  const stage = { width: 3840, height: 2160, offsetX: 1000, offsetY: 500 }
  assert.deepEqual(layout.computeWindowBounds(rects, stage), { left: 1092, top: 692, width: 316, height: 96 })
})

test('computeWindowBounds clamps to the stage edges', () => {
  assert.deepEqual(
    layout.computeWindowBounds([{ left: 2, top: 1, width: 10, height: 10 }], MONITOR),
    { left: 0, top: 0, width: 20, height: 19 }
  )
  assert.deepEqual(
    layout.computeWindowBounds([{ left: 1915, top: 1075, width: 4, height: 4 }], MONITOR),
    { left: 1907, top: 1067, width: 13, height: 13 }
  )
  assert.deepEqual(
    layout.computeWindowBounds([{ left: 0, top: 0, width: 1920, height: 1080 }], MONITOR),
    { left: 0, top: 0, width: 1920, height: 1080 }
  )
})

test('computeWindowBounds rounds outward to whole CSS px inside a fractional stage', () => {
  assert.deepEqual(
    layout.computeWindowBounds([{ left: 10.6, top: 20.2, width: 5.5, height: 3.3 }], MONITOR, 0),
    { left: 10, top: 20, width: 7, height: 4 }
  )
  assert.deepEqual(
    layout.computeWindowBounds([{ left: 1690, top: 10, width: 16, height: 10 }], { width: 1706.67, height: 900, offsetX: 0, offsetY: 0 }),
    { left: 1682, top: 2, width: 24, height: 26 }
  )
})

test('computeWindowBounds ignores hidden rects and returns null when nothing is visible', () => {
  assert.equal(layout.computeWindowBounds([], MONITOR), null)
  assert.equal(layout.computeWindowBounds(undefined, MONITOR), null)
  assert.equal(layout.computeWindowBounds([{ left: 10, top: 10, width: 0, height: 0 }], MONITOR), null)
  assert.deepEqual(
    layout.computeWindowBounds([{ left: 500, top: 500, width: 0, height: 40 }, { left: 100, top: 200, width: 50, height: 40 }], MONITOR, 0),
    { left: 100, top: 200, width: 50, height: 40 }
  )
})

test('the page asks the native side for bounds and the stage through the agreed commands', () => {
  assert.match(source, /invoke\('set_hud_window_bounds', \{ bounds: toPhysicalBounds\(bounds\) \}\)/)
  assert.match(source, /invoke\('get_hud_stage'\)/)
  assert.match(source, /listen\('hud_stage', event => applyStage\(event\.payload\)\)/)
  assert.match(source, /if \(document\.readyState === 'complete'\) startStageSync\(\)/)
  assert.match(source, /addEventListener\('load', startStageSync, \{ once: true \}\)/)
})

test('stage-space CSS: the shell covers the stage and shifts by the window offset', () => {
  assert.match(css, /\.hud-shell\s*{[^}]*width:\s*var\(--stage-width, 100vw\);[^}]*height:\s*var\(--stage-height, 100vh\);[^}]*transform:\s*translate\(calc\(var\(--stage-offset-x, 0px\) \* -1\), calc\(var\(--stage-offset-y, 0px\) \* -1\)\);/s)
  assert.match(css, /\.hud-shell\.is-restaging\s*{\s*visibility:\s*hidden;\s*}/)
  assert.match(css, /\.hud\[data-layout-mode='freeform'\] {[^}]*width:\s*var\(--stage-width, 100vw\);[^}]*height:\s*var\(--stage-height, 100vh\);/s)
})

test('no viewport unit in the stylesheet sizes stage content except as a pre-JS fallback', () => {
  assert.doesNotMatch(css.replace(/var\(--stage-(?:width|height), 100v[wh]\)/g, ''), /100v[wh]/)
})
