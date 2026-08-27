const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')
const storageSources = [
  'coach-layout.js',
  'connection.js',
  'display-preferences.js',
  'hud-preferences.js',
  'settings.js'
].map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n')

test('FDC uses only fresh v1 browser storage keys', () => {
  for (const key of [
    'fdc.layout.v1',
    'fdc.telemetry-source.v1',
    'fdc.display-preferences.v1',
    'fdc.hud-visibility.v1',
    'fdc.overlay-visibility.v1'
  ]) {
    assert.match(storageSources, new RegExp(key.replaceAll('.', '\\.'), 'u'))
  }

  assert.doesNotMatch(storageSources, /forza-horizon-6-hud\.(layout|coach-position|telemetry-source|display-preferences|hud-visibility|overlay-visibility)\./u)
})

test('FDC has a new native identity and database filename', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'))
  const cargo = fs.readFileSync(path.join(root, 'src-tauri', 'Cargo.toml'), 'utf8')
  const rust = fs.readFileSync(path.join(root, 'src-tauri', 'src', 'main.rs'), 'utf8')

  assert.equal(config.productName, 'FDC')
  assert.equal(config.identifier, 'dev.kv199.fdc')
  assert.match(cargo, /^name = "fdc-application"$/mu)
  assert.match(rust, /directory\.join\("fdc\.sqlite"\)/u)
  assert.doesNotMatch(rust, /directory\.join\("hud\.sqlite"\)/u)
})
