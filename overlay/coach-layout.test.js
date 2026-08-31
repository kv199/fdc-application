const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { clampPosition, sanitizeHudSize, sanitizePosition } = require('./coach-layout.js')

test('sanitizePosition accepts finite coordinates and clamps them to the screen', () => {
  assert.deepEqual(sanitizePosition({ x: -0.2, y: 1.4 }), { x: 0, y: 1 })
})

test('sanitizePosition rejects malformed storage data', () => {
  assert.equal(sanitizePosition(null), null)
  assert.equal(sanitizePosition({ x: 'left', y: 0.4 }), null)
  assert.equal(sanitizePosition({ x: 0.4 }), null)
})

test('clampPosition falls back to the top-left for invalid positions', () => {
  assert.deepEqual(clampPosition({ x: Number.NaN, y: 0.5 }), { x: 0, y: 0 })
  assert.deepEqual(clampPosition({ x: 0.25, y: 0.75 }), { x: 0.25, y: 0.75 })
})

test('HUD size uses zero for its responsive default and bounds custom scales', () => {
  assert.equal(sanitizeHudSize(0), 0)
  assert.equal(sanitizeHudSize(undefined), 0)
  assert.equal(sanitizeHudSize('invalid'), 0)
  assert.equal(sanitizeHudSize(-1), 0)
  assert.equal(sanitizeHudSize(0.1), 0.5)
  assert.equal(sanitizeHudSize(1.25), 1.25)
  assert.equal(sanitizeHudSize(3), 2)
})

test('stacks the default Coach position above the Delta strip', () => {
  const source = fs.readFileSync(path.join(__dirname, 'coach-layout.js'), 'utf8')
  assert.match(source, /hudTop - deltaSize\.height - elementSize\.height - 20/)
  assert.match(source, /Math\.min\(460, Math\.max\(0, viewport\.width - 24\)\), height: 88/)
})

test('HUD Reset anchors its default position from the viewport, not its prior layout rect', () => {
  const source = fs.readFileSync(path.join(__dirname, 'coach-layout.js'), 'utf8')
  assert.match(source, /left: \(viewport\.width - hudSize\.width\) \/ 2/)
  assert.match(source, /top: viewport\.height - hudSize\.height - 28/)
  assert.match(source, /if \(name === 'hud'\) return defaultHudAnchor/)
})

test('starts layout storage in a fresh FDC v1 namespace', () => {
  const source = fs.readFileSync(path.join(__dirname, 'coach-layout.js'), 'utf8')
  assert.match(source, /const STORAGE_KEY = 'fdc\.layout\.v1'/)
  assert.doesNotMatch(source, /LEGACY_COACH_STORAGE_KEY|forza-horizon-6-hud\./)
})

test('HUD has four edit-only resize handles and persists its size without adding sizes to other targets', () => {
  const layoutSource = fs.readFileSync(path.join(__dirname, 'coach-layout.js'), 'utf8')
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  const css = fs.readFileSync(path.join(__dirname, 'overlay.css'), 'utf8')

  assert.equal((html.match(/data-layout-resize-handle=/g) || []).length, 4)
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    assert.match(html, new RegExp(`data-layout-resize-handle="${corner}"`, 'u'))
  }
  assert.match(layoutSource, /if \(name === 'hud'\) result\[name\]\.size = sanitizeHudSize\(/)
  assert.match(layoutSource, /if \(name === 'hud'\) positions\[name\]\.size = HUD_DEFAULT_SIZE/)
  assert.match(layoutSource, /for \(const handle of document\.querySelectorAll\('\[data-layout-resize-handle\]'\)\)/)
  assert.match(css, /\.hud-frame\.is-editing \.hud-resize-handle/)
})

test('every widget Reset uses the shared target reset contract, with HUD size reset by entry removal', () => {
  const layoutSource = fs.readFileSync(path.join(__dirname, 'coach-layout.js'), 'utf8')
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  const rust = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'src', 'main.rs'), 'utf8')

  for (const target of ['coach', 'delta', 'hud']) {
    assert.match(html, new RegExp(`id="${target}-reset"`, 'u'))
    assert.ok(rust.includes(`"${target}" => "window.HudLayout?.resetPosition?.('${target}')"`))
  }
  assert.match(layoutSource, /delete positions\[name\]\s+saveStoredPositions\(positions\)/)
  assert.match(layoutSource, /removeStoredPosition\(positions, name\)\s+refreshLayout\(\)/)
  assert.match(layoutSource, /tools\[name\]\.reset\.addEventListener\('click', \(\) => resetPosition\(name\)\)/)
})
