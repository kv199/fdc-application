const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const settingsHtml = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8')
const settingsJs = fs.readFileSync(path.join(__dirname, 'settings.js'), 'utf8')
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

test('Display settings expose speed units before telemetry', () => {
  const displaySettingsIndex = settingsHtml.indexOf('id="display-settings-title"')
  const telemetrySettingsIndex = settingsHtml.indexOf('id="telemetry-settings-title"')
  const displayPreferencesScriptIndex = settingsHtml.indexOf('src="display-preferences.js"')
  const settingsScriptIndex = settingsHtml.indexOf('src="settings.js"')

  assert.ok(displaySettingsIndex >= 0)
  assert.ok(telemetrySettingsIndex > displaySettingsIndex)
  assert.match(settingsHtml, /name="speed-unit" value="kmh"/)
  assert.match(settingsHtml, /name="speed-unit" value="mph"/)
  assert.ok(displayPreferencesScriptIndex >= 0)
  assert.ok(settingsScriptIndex > displayPreferencesScriptIndex)
})

test('Shift Light brightness lives in the Shift Light tab and uses a rectilinear meter', () => {
  const shiftLightPanelIndex = settingsHtml.indexOf('id="shift-light-panel"')
  const brightnessIndex = settingsHtml.indexOf('id="shift-light-brightness"')
  const settingsPanelIndex = settingsHtml.indexOf('id="settings-panel"')

  assert.ok(shiftLightPanelIndex >= 0)
  assert.ok(brightnessIndex > shiftLightPanelIndex)
  assert.ok(brightnessIndex < settingsPanelIndex)
  assert.match(settingsHtml, /class="shift-light-brightness-card"/)
  assert.match(settingsHtml, /id="shift-light-brightness" type="range" min="0" max="100" step="5" value="80"/)
  assert.match(settingsJs, /--brightness-fill/)
})

test('Configuration persists and applies display preferences through the shared contract', () => {
  assert.match(settingsJs, /displayPreferencesApi\?\.read/)
  assert.match(settingsJs, /displayPreferencesApi\.normalize/)
  assert.match(settingsJs, /displayPreferencesApi\.write\(next\)/)
  assert.match(settingsJs, /call\('set_display_preferences', \{\s*speedUnit: next\.speedUnit,\s*shiftLightBrightness: next\.shiftLightBrightness\s*\}\)/)
  assert.match(settingsJs, /displayPreferences = previous\s*displayPreferencesApi\.write\(previous\)\s*renderDisplayPreferences\(previous\)/)
})

test('tray has one Configuration action and no calibration reset action', () => {
  assert.match(tauriMain, /\.text\("settings", "Configuration"\)/)
  assert.doesNotMatch(tauriMain, /reset-shift/)
  assert.match(tauriMain, /\.text\("quit", "Quit"\)/)
})

test('Configuration replays Shift Light state and waits for the real reset result', () => {
  assert.match(settingsJs, /hud_shift_light_reset_result/)
  assert.match(settingsJs, /call\('sync_shift_light_status'\)/)
  assert.equal(settingsJs.match(/CALIBRATION RESET COMPLETE/g)?.length, 1)
  assert.match(tauriMain, /fn sync_shift_light_status/)
})
