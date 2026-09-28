const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { COMPONENTS, OVERLAY_COMPONENTS, COLUMN_WIDTHS } = require('./hud-widgets.js')
const tauriMain = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'src', 'main.rs'), 'utf8')
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
const settingsHtml = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8')

const LAYOUT_TARGETS = [...OVERLAY_COMPONENTS, ...COMPONENTS]

function rustFunction(name) {
  const start = tauriMain.indexOf(`fn ${name}(`)
  assert.notEqual(start, -1, `main.rs defines ${name}`)
  const body = tauriMain.slice(start)
  return body.slice(0, body.search(/\r?\n\}\r?\n/))
}

function quotedNames(source, pattern) {
  return [...source.matchAll(pattern)].map(match => match[1])
}

test('HUD widget lists are frozen and keep the compact column widths', () => {
  assert.deepEqual(COMPONENTS, ['tires', 'pedals', 'steering', 'gear', 'engine', 'history'])
  assert.deepEqual(OVERLAY_COMPONENTS, ['delta', 'hud'])
  assert.deepEqual(COLUMN_WIDTHS, { tires: 72, pedals: 46, steering: 68, gear: 92, engine: 116, history: 342 })
  for (const value of [COMPONENTS, OVERLAY_COMPONENTS, COLUMN_WIDTHS]) assert.ok(Object.isFrozen(value))
})

test('native command whitelists match the shared HUD widget lists exactly', () => {
  const layoutAction = rustFunction('layout_action')
  assert.deepEqual(quotedNames(layoutAction, /enterEditMode\?\.\('([a-z]+)'\)/g), LAYOUT_TARGETS)
  assert.deepEqual(quotedNames(layoutAction, /resetPosition\?\.\('([a-z]+)'\)/g), LAYOUT_TARGETS)
  assert.deepEqual(quotedNames(rustFunction('is_valid_layout_target'), /"([a-z]+)"/g), LAYOUT_TARGETS)
  assert.deepEqual(quotedNames(rustFunction('set_hud_visibility').split('=> component')[0], /"([a-z]+)"/g), COMPONENTS)
  assert.deepEqual(quotedNames(rustFunction('set_overlay_visibility').split('=> component')[0], /"([a-z]+)"/g), OVERLAY_COMPONENTS)
})

test('both windows load the shared HUD widget list before its consumers', () => {
  const position = (html, file) => html.indexOf(`<script src="${file}"></script>`)
  assert.ok(position(indexHtml, 'hud-widgets.js') >= 0)
  assert.ok(position(indexHtml, 'hud-widgets.js') < position(indexHtml, 'hud-layout.js'))
  assert.ok(position(indexHtml, 'hud-widgets.js') < position(indexHtml, 'hud-preferences.js'))
  assert.ok(position(settingsHtml, 'hud-widgets.js') >= 0)
  assert.ok(position(settingsHtml, 'hud-widgets.js') < position(settingsHtml, 'settings.js'))
})
