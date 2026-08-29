const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const settingsHtml = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8')
const settingsCss = fs.readFileSync(path.join(__dirname, 'settings.css'), 'utf8')
const settingsJs = fs.readFileSync(path.join(__dirname, 'settings.js'), 'utf8')
const overlayHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
const tauriMain = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'src', 'main.rs'), 'utf8')

test('Configuration exposes HUD, Garage, Shift Light and Settings tabs', () => {
  const tabs = [...settingsHtml.matchAll(/data-settings-tab="([^"]+)"/g)].map(match => match[1])

  assert.deepEqual(tabs, ['hud', 'garage', 'shift-light', 'settings'])
  assert.match(settingsHtml, /id="garage-panel"[^>]+data-settings-panel="garage"/)
  assert.match(settingsHtml, /id="garage-grid"[^>]+aria-live="polite"/)
  assert.match(settingsHtml, /id="garage-current-car"/)
  assert.match(settingsHtml, /id="garage-cars-count">0 CARS/)
  assert.doesNotMatch(settingsHtml, /ONE CARD PER CAR ORDINAL/)
  assert.doesNotMatch(settingsHtml, /garage-current-title[^]*LAST USED/)
  assert.match(settingsJs, /load_garage_snapshot/)
  assert.match(settingsJs, /rename_garage_car/)
  assert.match(settingsJs, /garage-current-car__input/)
  assert.match(settingsJs, /garage-performance--/)
  assert.match(settingsJs, /garage-current-car__group/)
  assert.match(settingsJs, /garage-current-car__drivetrain/)
  assert.match(settingsJs, /garage-current-car__cylinders/)
  assert.match(settingsJs, /latest\.textContent = 'LAST USED'/)
  assert.doesNotMatch(settingsJs, /input\.className = 'garage-card__name'/)
})

test('Engine telemetry keeps the compact panel order and one visibility toggle', () => {
  const sections = [...overlayHtml.matchAll(/<section id="(hud-[^"]+)"/g)].map(match => match[1])
  const components = [...settingsHtml.matchAll(/data-hud-component="([^"]+)"/g)].map(match => match[1])

  assert.deepEqual(sections, ['hud-tires', 'hud-pedals', 'hud-steering', 'hud-gear', 'hud-engine', 'hud-history'])
  assert.deepEqual(components, ['tires', 'pedals', 'steering', 'gear', 'engine', 'history'])
  assert.match(settingsHtml, /<strong>Engine \/ Boost<\/strong>/)
  assert.match(settingsHtml, /<small>Boost, power and torque data<\/small>/)
  assert.match(overlayHtml, /id="engine-boost"[^>]+aria-label="Boost pressure"/)
  assert.match(overlayHtml, /id="engine-power"[^>]+aria-label="Engine power"/)
  assert.match(overlayHtml, /id="engine-torque"[^>]+aria-label="Engine torque"/)
})

test('Engine visibility is part of the safe HUD component contract', () => {
  const preferences = fs.readFileSync(path.join(__dirname, 'hud-preferences.js'), 'utf8')

  assert.match(preferences, /const COMPONENTS = \['tires', 'pedals', 'steering', 'gear', 'engine', 'history'\]/)
  assert.match(preferences, /engine: '116px'/)
  assert.match(tauriMain, /"tires" \| "pedals" \| "steering" \| "gear" \| "engine" \| "history"/)
})

test('telemetry status stays separate and right-aligned above the setup card', () => {
  const settingsPanelIndex = settingsHtml.indexOf('id="settings-panel"')
  const telemetryStatusIndex = settingsHtml.indexOf('id="telemetry-status"')
  const routeCardIndex = settingsHtml.indexOf('id="telemetry-route-card"')
  const headerIndex = settingsHtml.indexOf('class="settings-header"')

  assert.ok(settingsPanelIndex >= 0)
  assert.ok(headerIndex >= 0)
  assert.ok(telemetryStatusIndex > headerIndex)
  assert.ok(routeCardIndex > telemetryStatusIndex)
  assert.ok(telemetryStatusIndex < settingsPanelIndex)
  assert.ok(routeCardIndex < settingsPanelIndex)
  assert.match(settingsHtml, /class="settings-header__connection"[\s\S]*id="telemetry-status"[\s\S]*id="telemetry-route-card"/)
  assert.match(settingsCss, /\.settings-header__connection > \.telemetry-status[\s\S]*justify-content: flex-end[\s\S]*width: 100%/)
  assert.match(settingsCss, /#telemetry-route-detail\s*\{\s*margin-top: 0;/)
  assert.match(settingsHtml, /class="telemetry-setup-guide"[\s\S]*Settings → HUD and Gameplay → Telemetry/)
  assert.match(settingsHtml, /Data Out IP Address[\s\S]*127\.0\.0\.1/)
  assert.match(settingsHtml, /Data Out IP Port[\s\S]*5301/)
  const setupGuide = settingsHtml.slice(settingsHtml.indexOf('class="telemetry-setup-guide"'), settingsHtml.indexOf('id="telemetry-route-retry"'))
  assert.equal((setupGuide.match(/<li>/g) || []).length, 4)
  assert.doesNotMatch(setupGuide, /Return to the game and start driving/u)
  assert.doesNotMatch(settingsHtml, /id="telemetry-route-endpoint"|id="telemetry-route-label"/)
  assert.doesNotMatch(settingsJs, /telemetryRouteEndpoint|telemetryRouteLabel|telemetryRouteDetail|telemetryRouteWarning/u)
  assert.doesNotMatch(overlayHtml, /telemetry-route-badge/)
})

test('Configuration exposes only the Direct Data Out receiver', () => {
  assert.match(settingsHtml, /DIRECT DATA OUT/)
  assert.match(settingsHtml, /127\.0\.0\.1/)
  assert.match(settingsHtml, /5301/)
  assert.doesNotMatch(settingsHtml, /telemetry-source|co-driver|Suite|WebSocket/u)
  assert.doesNotMatch(settingsJs, /HudConnection|set_telemetry_source|selectTelemetrySource/u)
  assert.match(settingsJs, /call\('retry_direct_source'\)/u)
  assert.match(tauriMain, /fn retry_direct_source/u)
})

test('Settings exposes only the speed unit preference', () => {
  const displaySettingsIndex = settingsHtml.indexOf('id="display-settings-title"')
  const settingsPanelIndex = settingsHtml.indexOf('id="settings-panel"')
  const displayPreferencesScriptIndex = settingsHtml.indexOf('src="display-preferences.js"')
  const settingsScriptIndex = settingsHtml.indexOf('src="settings.js"')
  const settingsPanel = settingsHtml.slice(settingsPanelIndex)

  assert.ok(displaySettingsIndex >= 0)
  assert.ok(settingsPanelIndex >= 0)
  assert.match(settingsHtml, /name="speed-unit" value="kmh"/)
  assert.match(settingsHtml, /name="speed-unit" value="mph"/)
  assert.doesNotMatch(settingsPanel, /telemetry-settings|telemetry-route-card|DIRECT DATA OUT.*OFFLINE/u)
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
