const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')
const storageSources = [
  'hud-layout.js',
  'driver-analysis.js',
  'display-preferences.js',
  'hud-preferences.js',
  'settings.js'
].map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n')

test('FDC uses only current versioned browser storage keys', () => {
  for (const key of [
    'fdc.layout.v2',
    'fdc.layout-mode.v1',
    'fdc.display-preferences.v1',
    'fdc.hud-visibility.v1',
    'fdc.overlay-visibility.v1',
    'fdc.driver-analysis.settings.v1',
    'fdc.driver-analysis.history.v1'
  ]) {
    assert.match(storageSources, new RegExp(key.replaceAll('.', '\\.'), 'u'))
  }

  assert.doesNotMatch(storageSources, /forza-horizon-6-hud\.(layout|coach-position|telemetry-source|display-preferences|hud-visibility|overlay-visibility)\./u)
})

test('FDC uses its canonical native identity and database filename', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  const cargo = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8')
  const rust = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8')

  assert.equal(config.productName, 'FDC')
  assert.equal(config.identifier, 'FDC')
  assert.match(cargo, /^name = "fdc-application"$/mu)
  assert.match(rust, /directory\.join\("fdc\.sqlite"\)/u)
  assert.doesNotMatch(rust, /directory\.join\("hud\.sqlite"\)/u)
})

test('FDC exposes only the Direct Data Out runtime path', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  const settings = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8')
  const settingsRuntime = fs.readFileSync(path.join(__dirname, 'settings.js'), 'utf8')
  const overlayRuntime = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8')
  const route = fs.readFileSync(path.join(__dirname, 'telemetry-route.js'), 'utf8')
  const config = fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')

  for (const source of [html, settings, settingsRuntime, overlayRuntime, route, config]) {
    assert.doesNotMatch(source, /WebSocket|websocket|co-driver|Suite|3001|ws:\/\//iu)
  }
  assert.match(html, /src="telemetry-route\.js"/u)
  assert.doesNotMatch(html, /suite-probe|connection\.js|reference-coach|corner-state/u)
  assert.match(settings, /DIRECT DATA OUT/u)
  assert.doesNotMatch(settings, /telemetry-source|source-option|co-driver|Suite/u)
  assert.match(route, /UDP 127\.0\.0\.1:5301/u)
  assert.match(config, /connect-src 'self'/u)
})
