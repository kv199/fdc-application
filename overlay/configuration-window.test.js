const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const settingsHtml = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8')
const overlayHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
const tauriMain = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'src', 'main.rs'), 'utf8')

test('Configuration exposes HUD, Shift Light and Settings tabs', () => {
  const tabs = [...settingsHtml.matchAll(/data-settings-tab="([^"]+)"/g)].map(match => match[1])

  assert.deepEqual(tabs, ['hud', 'shift-light', 'settings'])
})

test('telemetry diagnostics live only inside the Settings tab', () => {
  const settingsPanelIndex = settingsHtml.indexOf('id="settings-panel"')
  const telemetryStatusIndex = settingsHtml.indexOf('id="telemetry-status"')
  const routeCardIndex = settingsHtml.indexOf('id="telemetry-route-card"')

  assert.ok(settingsPanelIndex >= 0)
  assert.ok(telemetryStatusIndex > settingsPanelIndex)
  assert.ok(routeCardIndex > settingsPanelIndex)
  assert.doesNotMatch(overlayHtml, /telemetry-route-badge/)
})

test('tray has one Configuration action and no calibration reset action', () => {
  assert.match(tauriMain, /\.text\("settings", "Configuration"\)/)
  assert.doesNotMatch(tauriMain, /reset-shift/)
  assert.match(tauriMain, /\.text\("quit", "Quit"\)/)
})
