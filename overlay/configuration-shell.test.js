const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { readResolvedStylesheet } = require('../tools/stylesheet-tokens.cjs')
const { readConfigurationScripts, readRustSources } = require('../tools/test-sources.cjs')

const settingsHtml = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8')
const settingsCss = readResolvedStylesheet('settings.css')
// Interface roles are asserted by token; preserved meanings (modes, classes, map layers) by value.
const settingsStyles = fs.readFileSync(path.join(__dirname, 'settings.css'), 'utf8')
const settingsJs = readConfigurationScripts()
const overlayHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
const tauriMain = readRustSources()
const tauriConfig = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json'), 'utf8')

// The object literal that the Configuration scripts pass to the set_display_preferences command.
function displayPreferencesPayload() {
  const match = settingsJs.match(/call\('set_display_preferences', \{([\s\S]*?)\}\)/)
  assert.ok(match, 'the Configuration scripts call set_display_preferences with an object')
  return match[1]
}

test('Every Configuration tab has a one-paragraph intro in the header and Settings states where data lives', () => {
  const header = settingsHtml.slice(settingsHtml.indexOf('<header class="settings-header">'), settingsHtml.indexOf('</header>'))
  for (const panel of ['hud', 'events', 'driver-analysis', 'shift-light', 'garage', 'settings']) {
    const intros = header.match(new RegExp(`<p data-settings-intro="${panel}"( hidden)?>[^<]+</p>`, 'g')) || []
    assert.equal(intros.length, 1, panel)
    const start = settingsHtml.indexOf(`data-settings-panel="${panel}"`)
    const next = settingsHtml.indexOf('data-settings-panel="', start + 1)
    const markup = settingsHtml.slice(start, next === -1 ? undefined : next)
    assert.doesNotMatch(markup, /data-settings-intro/, panel)
  }
  // Only the active tab's intro shows; drill-down views hide it with the compact header.
  assert.match(settingsHtml, /<p data-settings-intro="hud">/)
  assert.match(settingsJs, /dataset\.settingsIntro/)
  assert.match(settingsCss, /:is\(\.events-detail-view, \.events-run-view, \.driver-analysis-detail-view\):not\(\[hidden\]\)\)\s*\.settings-header__intro\s*\{\s*display: none;/)
  assert.match(settingsHtml, /<h2 id="settings-panel-title" class="settings-page-title">SETTINGS<\/h2>/)
  assert.match(settingsHtml, /<p data-settings-intro="settings" hidden>Options for the whole app\. Everything FDC records stays on this PC\.<\/p>/)
  assert.doesNotMatch(settingsHtml, /YOUR DATA/)
  assert.doesNotMatch(settingsHtml, /VISUAL OUTPUT|RECORDED ASPHALT REVIEW|VEHICLE LIBRARY|AUTO CALIBRATION/)
})

test('Configuration exposes Events second and Driver Analysis third in the primary tab order', () => {
  const tabs = [...settingsHtml.matchAll(/data-settings-tab="([^"]+)"/g)].map(match => match[1])

  assert.deepEqual(tabs, ['hud', 'events', 'driver-analysis', 'shift-light', 'garage', 'settings'])
  assert.match(settingsHtml, /id="driver-analysis-panel"[^>]+data-settings-panel="driver-analysis"/)
  assert.match(settingsHtml, /id="driver-analysis-enabled"[^>]+aria-pressed="false"/)
  assert.match(settingsHtml, /id="driver-analysis-record"[^>]+disabled>RECORD<\/button>/)
  assert.match(settingsHtml, /id="driver-analysis-hotkey-value"[^>]*>Ctrl \+ Shift \+ F9<\/output>/)
  assert.match(settingsHtml, /<strong>BETA<\/strong>/)
  assert.match(settingsHtml, /Experimental — results may be inaccurate\. Asphalt only\./)
  assert.match(settingsHtml, /id="driver-analysis-history-list"[^>]+aria-live="polite"/)
  assert.match(settingsJs, /call\('load_driver_analysis_sessions'\)/)
  assert.match(settingsJs, /call\('delete_driver_analysis_recording', \{ recordingId[\s\S]*\}\)/)
  assert.match(settingsJs, /Delete this Driver Analysis recording, all its cars, and saved telemetry\?/)
  assert.match(settingsJs, /phase === 'waiting'/)
  assert.match(settingsJs, /phase === 'finalizing'/)
  assert.doesNotMatch(settingsHtml, /Driver Coach|data-layout-target="coach"/)
  assert.doesNotMatch(overlayHtml, /id="coach-card"|id="coachbar"/)
  assert.doesNotMatch(overlayHtml, /asphalt-coach|driver-coach|coach-layout/)
  assert.match(settingsHtml, /id="garage-panel"[^>]+data-settings-panel="garage"/)
  assert.match(settingsHtml, /id="garage-grid"[^>]+aria-live="polite"/)
  assert.match(settingsHtml, /id="garage-current-car"/)
  assert.match(settingsHtml, /id="garage-current-variants-toggle" class="settings-button settings-button--ready"[^>]*>VIEW VARIANTS<\/button>/)
  assert.match(settingsHtml, /id="garage-current-variants"[^>]+class="garage-variants"/)
  assert.match(settingsHtml, /id="garage-variants-title">OBSERVED VARIANTS<\/h3>/)
  assert.match(settingsHtml, /id="garage-variant-list"/)
  // The variants panel is a sibling below the current-car section, not nested inside it.
  const currentSectionEnd = settingsHtml.indexOf('</section>', settingsHtml.indexOf('class="garage-current"'))
  assert.ok(settingsHtml.indexOf('id="garage-current-variants"') > currentSectionEnd)
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
  assert.match(settingsJs, /garage-variant-row__cylinders/)
  assert.match(settingsJs, /garage-variant-row__state/)
  assert.match(settingsJs, /'OBSERVED'/)
  assert.match(settingsJs, /garage-current-variants-toggle/)
  assert.match(settingsJs, /event\.key !== 'Escape'/)
  assert.match(settingsJs, /garage-current-car__input/)
  assert.doesNotMatch(settingsJs, /garage-shift-light/)
  assert.doesNotMatch(settingsJs, /Duplicate/u)
  assert.doesNotMatch(settingsJs, /appendGarageShiftLight/)
  assert.match(settingsJs, /garage-card--latest/)
  assert.match(settingsJs, /'LAST USED'/)
  assert.match(settingsJs, /'garage-card__name'/)
  assert.match(settingsCss, /\.garage-variants\s*\{[^}]*width:\s*100%[^}]*border:\s*1px solid/)
  assert.match(settingsCss, /\.garage-variant-list\s*\{[^}]*max-height:\s*480px[^}]*overflow-y:\s*auto/)
  assert.match(settingsCss, /\.garage-variant-row\s*\{[^}]*justify-content:\s*flex-start/)
  assert.match(settingsCss, /\.garage-variant-row__state\s*\{[^}]*margin-left:\s*auto/)
  assert.doesNotMatch(settingsStyles, /\.garage-variant-row \{[^}]*border-left/)
  assert.match(settingsStyles, /\.garage-card \{[^}]*border: 1px solid var\(--line\);/)
  assert.doesNotMatch(settingsStyles, /\.garage-card \{[^}]*border-left: 3px/)
  assert.doesNotMatch(settingsCss, /\.garage-current-variants-toggle/)
  assert.match(settingsJs, /'HIDE VARIANTS'/)
  assert.match(settingsJs, /'VIEW VARIANTS'/)
})

test('the header status opens the connection guide instead of a permanent setup card', () => {
  const header = settingsHtml.slice(settingsHtml.indexOf('<header class="settings-header">'), settingsHtml.indexOf('</header>'))
  assert.match(header, /class="settings-header__connection"[\s\S]*<button id="telemetry-status-button"[^>]*type="button"[\s\S]*id="telemetry-status"[^>]*role="status"/)
  assert.doesNotMatch(settingsHtml, /telemetry-route-card|telemetry-setup-guide|telemetry-route-retry|HOW TO CONNECT/)
  assert.doesNotMatch(settingsJs, /telemetryRouteCard|telemetryRouteRetry/)
  assert.match(settingsJs, /getElementById\('telemetry-status-button'\)/)
  // The guide keeps the steps and RETRY DATA OUT for a receiver problem.
  const guide = settingsHtml.slice(settingsHtml.indexOf('class="connect-guide"'), settingsHtml.indexOf('id="connect-guide-done"'))
  assert.match(guide, /Data Out IP Address[\s\S]*127\.0\.0\.1/)
  assert.match(guide, /Data Out IP Port[\s\S]*5301/)
  assert.match(guide, /id="connect-guide-retry"/)
  assert.doesNotMatch(settingsHtml, /id="telemetry-route-endpoint"|id="telemetry-route-label"/)
  assert.doesNotMatch(settingsJs, /telemetryRouteEndpoint|telemetryRouteLabel|telemetryRouteDetail|telemetryRouteWarning/u)
  assert.doesNotMatch(overlayHtml, /telemetry-route-badge/)
})

test('Configuration title sits directly below the product name', () => {
  assert.match(settingsHtml, /class="settings-header__brand"[\s\S]*Feedback-Driven Companion[\s\S]*<h1 id="settings-title">CONFIGURATION<\/h1>/u)
  assert.doesNotMatch(settingsHtml, /Configure the overlay and Shift Light\./u)
})

test('Configuration heading follows the active tab', () => {
  assert.match(settingsJs, /getElementById\('settings-title'\)/)
  assert.match(settingsJs, /dataset\.settingsTab/)
  assert.match(settingsJs, /\.textContent = [^\n]*\.textContent\.trim\(\)/)
})

test('Configuration window title reflects the active section and build version without game branding', () => {
  const configuredTitles = JSON.parse(tauriConfig).app.windows.map(window => window.title)

  assert.deepEqual(
    [...settingsHtml.matchAll(/data-settings-tab="([^"]+)"/g)].map(match => match[1]),
    ['hud', 'events', 'driver-analysis', 'shift-light', 'garage', 'settings']
  )
  assert.deepEqual(configuredTitles, ['FDC · HUD', 'FDC · HUD'])
  assert.doesNotMatch(`${configuredTitles.join(' ')} ${overlayHtml}`, /Forza Horizon 6 HUD/u)
  assert.match(settingsJs, /call\('set_settings_window_context', \{ context: /)
  assert.match(tauriMain, /fn settings_window_context_label\(context: &str\) -> Option<&'static str>/)
  assert.match(tauriMain, /"hud" => Some\("HUD"\)/)
  assert.match(tauriMain, /"driver-analysis" => Some\("DRIVER ANALYSIS"\)/)
  assert.match(tauriMain, /"garage" => Some\("GARAGE"\)/)
  assert.match(tauriMain, /"events" => Some\("EVENTS"\)/)
  assert.match(tauriMain, /"shift-light" => Some\("SHIFT LIGHT"\)/)
  assert.match(tauriMain, /"settings" => Some\("SETTINGS"\)/)
  assert.match(tauriMain, /fn settings_window_title\(context: &str\) -> String/)
  assert.match(tauriMain, /format!\("FDC · \{context\} · v\{\}", get_app_version\(\)\)/)
  assert.match(tauriMain, /fn set_settings_window_context\(app: AppHandle, context: String\)/)
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

test('Settings exposes Configuration priority and speed unit preferences', () => {
  const settingsPanelIndex = settingsHtml.indexOf('id="settings-panel"')
  const displayPreferencesScriptIndex = settingsHtml.indexOf('src="display-preferences.js"')
  const settingsScriptIndex = settingsHtml.indexOf('src="settings.js"')
  const settingsPanel = settingsHtml.slice(settingsPanelIndex)

  assert.ok(settingsPanelIndex >= 0)
  assert.match(settingsHtml, /<section class="display-settings" aria-label="Display settings">/)
  assert.doesNotMatch(settingsHtml, /DISPLAY SETTINGS|WINDOW \+ SPEED FORMAT/u)
  assert.match(settingsHtml, /name="speed-unit" value="kmh"/)
  assert.match(settingsHtml, /name="speed-unit" value="mph"/)
  assert.match(settingsHtml, /name="distance-unit" value="km"/)
  assert.match(settingsHtml, /name="distance-unit" value="mi"/)
  assert.ok(settingsHtml.indexOf('speed-unit') < settingsHtml.indexOf('distance-unit'))
  assert.match(settingsHtml, /id="configuration-always-on-top" class="visibility-toggle" type="button"[^>]*aria-pressed="false"/)
  assert.match(settingsHtml, /<strong>SHOW HUD WITH TELEMETRY<\/strong>/)
  assert.match(settingsHtml, /id="show-hud-with-telemetry" class="visibility-toggle" type="button"[^>]*aria-pressed="true"/)
  assert.ok(settingsHtml.indexOf('id="show-hud-with-telemetry"') > settingsPanelIndex)
  assert.match(settingsJs, /showHudWithTelemetry/)
  assert.match(settingsHtml, /calibration-label">CLASS<\/span>\s*<output id="shift-light-car-pi">/)
  assert.match(settingsJs, /FdcVehicle\.displayName\(/)
  assert.match(settingsJs, /set_configuration_always_on_top/)
  assert.match(tauriMain, /fn set_configuration_always_on_top/)
  assert.doesNotMatch(settingsPanel, /telemetry-settings|telemetry-route-card|DIRECT DATA OUT.*OFFLINE/u)
  assert.ok(displayPreferencesScriptIndex >= 0)
  assert.ok(settingsScriptIndex > displayPreferencesScriptIndex)
})

test('Settings groups its display rows under three headings in order', () => {
  const groupHtml = (labelledBy) => {
    const start = settingsHtml.indexOf(`<section class="settings-group" aria-labelledby="${labelledBy}">`)
    assert.ok(start >= 0, `missing settings group ${labelledBy}`)
    return settingsHtml.slice(start, settingsHtml.indexOf('</section>', start))
  }
  const rowTitles = (html) => [...html.matchAll(/<div class="display-setting-row[^"]*"[^>]*>\s*<div class="display-setting-row__copy">\s*<strong[^>]*>([^<]+)<\/strong>/gu)].map((match) => match[1])
  const windowGroup = groupHtml('settings-window-title')
  const hudGroup = groupHtml('settings-hud-title')
  const unitsGroup = groupHtml('settings-units-title')

  assert.match(settingsHtml, /<div class="settings-board">/)
  assert.match(settingsHtml, /<h3 id="settings-window-title">WINDOW &amp; EXIT<\/h3>/)
  assert.match(settingsHtml, /<h3 id="settings-hud-title">HUD BEHAVIOR<\/h3>/)
  assert.match(settingsHtml, /<h3 id="settings-units-title">UNITS<\/h3>/)
  assert.ok(settingsHtml.indexOf('WINDOW &amp; EXIT') < settingsHtml.indexOf('HUD BEHAVIOR'))
  assert.ok(settingsHtml.indexOf('HUD BEHAVIOR') < settingsHtml.indexOf('>UNITS<'))
  assert.deepEqual(rowTitles(windowGroup), ['CONFIGURATION ALWAYS ON TOP', 'CONFIRM BEFORE QUITTING', 'THEME'])
  assert.deepEqual(rowTitles(hudGroup), ['SHOW HUD WITH TELEMETRY', 'HUD RENDERING'])
  assert.deepEqual(rowTitles(unitsGroup), ['SPEED UNIT', 'DISTANCE UNIT'])
  assert.match(settingsStyles, /\.settings-board\s*\{[^}]*width:\s*100%;[^}]*margin:\s*0;/)
  assert.match(settingsStyles, /\.settings-group\s*\{[^}]*border:\s*1px solid var\(--line\)[^}]*background:\s*var\(--surface\)/)
})

test('Settings exposes a THEME row with dark, light, and system radios after CONFIRM BEFORE QUITTING', () => {
  const windowStart = settingsHtml.indexOf('<section class="settings-group" aria-labelledby="settings-window-title">')
  const windowGroup = settingsHtml.slice(windowStart, settingsHtml.indexOf('</section>', windowStart))
  const themeStart = windowGroup.indexOf('aria-labelledby="theme-title"')
  assert.ok(themeStart > windowGroup.indexOf('CONFIRM BEFORE QUITTING'), 'THEME follows CONFIRM BEFORE QUITTING')
  const themeRow = windowGroup.slice(themeStart)

  assert.match(themeRow, /<strong id="theme-title">THEME<\/strong>/)
  assert.match(themeRow, /<small>Choose a dark or light Configuration window, or follow Windows\. The HUD stays dark\.<\/small>/)
  assert.match(themeRow, /<div class="unit-options" aria-label="Theme">/)
  assert.deepEqual([...themeRow.matchAll(/<input type="radio" name="theme" value="([^"]+)">\s*<span>([^<]+)<\/span>/gu)].map(match => [match[1], match[2]]), [['dark', 'DARK'], ['light', 'LIGHT'], ['system', 'SYSTEM']])
  assert.match(settingsJs, /querySelectorAll\('input\[name="theme"\]'\)/)
  assert.match(settingsJs, /prefers-color-scheme: light/)
  assert.match(settingsJs, /dataset\.theme/)
  assert.match(settingsJs, /plugin:window\|set_theme/)
  assert.doesNotMatch(displayPreferencesPayload(), /theme/)
})

test('Configuration persists and applies display preferences through the shared contract', () => {
  assert.match(settingsJs, /displayPreferencesApi\?\.read/)
  assert.match(settingsJs, /displayPreferencesApi\.normalize/)
  assert.match(settingsJs, /displayPreferencesApi\.write\(next\)/)
  const payload = displayPreferencesPayload()
  const keys = ['speedUnit', 'redlineBrightness', 'shiftLightBrightness', 'hudOpacity', 'fdcShiftLightEnabled', 'showHudWithTelemetry']
  assert.deepEqual([...payload.matchAll(/(\w+):/g)].map(match => match[1]).sort(), [...keys].sort())
  for (const key of keys) assert.match(payload, new RegExp(`\\b${key}: next\\.${key}\\b`), key)
  assert.match(settingsJs, /displayPreferencesApi\.write\(previous\)/)
})

test('Configuration keeps its default size and exposes standard Windows controls', () => {
  const settingsWindow = JSON.parse(tauriConfig).app.windows.find(window => window.label === 'settings')

  assert.deepEqual({ width: settingsWindow.width, height: settingsWindow.height }, { width: 820, height: 620 })
  assert.equal(settingsWindow.minimizable, true)
  assert.equal(settingsWindow.maximizable, true)
  assert.equal(settingsWindow.alwaysOnTop, false)
})

test('Settings chooses GPU or CPU HUD rendering for the next FDC start', () => {
  const panel = settingsHtml.slice(settingsHtml.indexOf('data-settings-panel="settings"'), settingsHtml.indexOf('<footer class="settings-footer"'))
  assert.match(panel, /<strong>SHOW HUD WITH TELEMETRY<\/strong>[\s\S]*?<strong id="hud-rendering-title">HUD RENDERING<\/strong>[\s\S]*?<strong id="speed-unit-title">SPEED UNIT<\/strong>/)
  assert.match(panel, /<input type="radio" name="hud-rendering" value="gpu">\s*<span>GPU<\/span>/)
  assert.match(panel, /<input type="radio" name="hud-rendering" value="cpu">\s*<span>CPU<\/span>/)
  assert.match(panel, /<small id="hud-rendering-note">[^<]*Applies after FDC restarts\.<\/small>/)
  assert.match(settingsJs, /call\('get_hud_rendering'\)/)
  assert.match(settingsJs, /call\('set_hud_rendering', \{ renderer \}\)/)
  assert.match(settingsJs, /Restart FDC to draw the HUD with the/)

  // WebView2 arguments are fixed at startup, so both windows are built in code.
  for (const window of JSON.parse(tauriConfig).app.windows) {
    assert.equal(window.create, false, window.label)
    assert.equal(Object.hasOwn(window, 'additionalBrowserArgs'), false, window.label)
  }
  assert.match(tauriMain, /WebviewWindowBuilder::from_config\(app\.handle\(\), &config\)\?/)
  assert.match(tauriMain, /builder\.additional_browser_args\(args\)/)
  assert.match(tauriMain, /get_hud_rendering,\s*set_hud_rendering,/)
})

test('Configuration restores its last on-screen position with its size', () => {
  assert.match(tauriMain, /SettingsWindowState/)
  assert.match(tauriMain, /WindowEvent::Resized\(_\) \| WindowEvent::Moved\(_\)/)
  assert.match(tauriMain, /window\.outer_position\(\)/)
  assert.match(tauriMain, /app\s*\.available_monitors\(\)/)
  assert.match(tauriMain, /window\.set_position\(position\)/)
  assert.match(tauriMain, /serde\(default\)/)
})

test('Configuration opens every time the HUD starts', () => {
  assert.match(tauriMain, /window\.show\(\)\?;\s*show_settings\(app\.handle\(\)\)\?;/)
  assert.doesNotMatch(tauriMain, /settings-first-launch-complete/)
})

test('tray has one Configuration action and no calibration reset action', () => {
  assert.match(tauriMain, /\.text\("settings", "Configuration"\)/)
  assert.doesNotMatch(tauriMain, /reset-shift/)
  assert.match(tauriMain, /\.text\("quit", "Quit"\)/)
})

test('the Configuration X button asks QUIT FDC? through the shared dialog', () => {
  assert.match(tauriMain, /CloseRequested[\s\S]*?prevent_close\(\)[\s\S]*?SettingsController\?\.requestQuit\?\.\(\)/)
  assert.match(tauriMain, /fn quit_app\(app: AppHandle\) \{\s*app\.exit\(0\);/)
  assert.doesNotMatch(tauriMain, /settings\.hide\(\)/)
  assert.ok(settingsHtml.indexOf('src="quit-confirmation.js"') < settingsHtml.indexOf('src="settings.js"'))
  assert.match(settingsHtml, /id="destructive-confirm-option" class="confirm-dialog__option" hidden/)
  assert.match(settingsHtml, /CONFIRM BEFORE QUITTING[\s\S]*?id="confirm-before-quit"/)
  assert.match(settingsJs, /title: 'QUIT FDC\?'/)
  assert.match(settingsJs, /yes: 'QUIT'/)
  assert.match(settingsJs, /no: 'CANCEL'/)
  assert.match(settingsJs, /quitConfirmationApi\.question\(/)
  assert.match(settingsJs, /call\('quit_app'\)/)
  assert.match(settingsJs, /globalScope\.SettingsController[\s\S]*requestQuit/)
})

test('Configuration opens on the connection guide until Forza first sends Data Out', () => {
  assert.ok(settingsHtml.indexOf('src="connection-guide.js"') < settingsHtml.indexOf('src="settings.js"'))
  const guide = settingsHtml.slice(settingsHtml.indexOf('id="connect-guide"'), settingsHtml.indexOf('id="destructive-confirm-dialog"'))
  assert.match(guide, /role="dialog" aria-modal="true"[^>]*hidden/)
  assert.match(guide, /Settings → HUD and Gameplay → Telemetry/)
  assert.match(guide, /<code class="connect-guide__value">127\.0\.0\.1<\/code>/)
  assert.match(guide, /<code class="connect-guide__value">5301<\/code>/)
  for (const id of ['connect-guide-retry', 'connect-guide-skip', 'connect-guide-done']) assert.match(guide, new RegExp('id="' + id + '"'))
  assert.match(settingsJs, /connectionGuideApi\.shouldShow\(connectionGuideApi\.read\(\), garageVehicles\.size > 0\)/)
  assert.match(settingsJs, /telemetryStatusLabel\.textContent = presentation\.statusLabel/)
  assert.match(settingsCss, /\.connect-guide \{[^}]*z-index: 15;/)
})

test('Back buttons on drill-down views name their parent and use detail-back class', () => {
  assert.match(settingsHtml, /id="events-detail-back"[^>]*class="detail-back"/)
  assert.match(settingsHtml, /id="events-detail-back"[^>]*aria-label="Back to Events"/)
  assert.match(settingsHtml, /id="events-detail-back"[^>]*>← EVENTS</)
  assert.match(settingsHtml, /id="events-run-back"[^>]*class="detail-back"/)
  assert.match(settingsHtml, /id="events-run-back"[^>]*aria-label="Back to the event"/)
  assert.match(settingsHtml, /id="events-run-back"[^>]*>← EVENT</)
  assert.match(settingsHtml, /id="driver-analysis-detail-back"[^>]*class="detail-back"/)
  assert.match(settingsJs, /← HISTORY/)
  assert.match(settingsJs, /← RECORDING/)
  assert.match(settingsJs, /← CAR/)
})

test('Drill-down object titles use the readout font from the design book', () => {
  const tokensCss = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8')
  // settingsCss has its token references resolved, so var() assertions read the source stylesheet.
  assert.match(settingsStyles, /\.events-detail-view__title\s*\{[^}]*font-family:\s*var\(--font-readout\)[^}]*font-size:\s*var\(--type-heading\)[^}]*font-weight:\s*500/)
  assert.match(settingsStyles, /\.events-detail-view__title-input\s*\{[^}]*font-family:\s*var\(--font-readout\)[^}]*font-weight:\s*500/)
  assert.match(settingsStyles, /\.driver-analysis-detail-view \.events-detail-view__title\s*\{[^}]*font-size:\s*var\(--type-object-title\)/)
  assert.match(tokensCss, /--type-object-title: 36px;/)
  assert.doesNotMatch(settingsCss, /\.events-detail-view__title\s*\{[^}]*font-weight:\s*800/)
  // Like the design book, the title does not change color under the pointer.
  assert.doesNotMatch(settingsCss, /\.events-detail-view__title:hover/)
  assert.match(settingsCss, /\.events-detail-view__title:focus-visible\s*\{[^}]*color:/)
})

test('Configuration calls only the render functions it defines, and never renders event run detail without its run', () => {
  const called = new Set([...settingsJs.matchAll(/\b(render[A-Z]\w*)\(/g)].map(match => match[1]))
  const defined = new Set([...settingsJs.matchAll(/(?:function\s+|const\s+|let\s+)(render[A-Z]\w*)\b/g)].map(match => match[1]))
  assert.deepEqual([...called].filter(name => !defined.has(name)), [])
  assert.doesNotMatch(settingsJs, /renderEventRunDetail\(\)/)
})

test('Configuration uses one shared empty-state style', () => {
  assert.match(settingsCss, /\.settings-empty\s*\{/)
  assert.match(settingsCss, /\.settings-empty--inline\s*\{/)
  assert.match(settingsCss, /\.settings-empty\[hidden\]/)
  for (const id of ['driver-analysis-history-empty', 'garage-grid-empty', 'events-grid-empty', 'event-runs-empty', 'events-run-empty', 'shift-light-empty']) {
    assert.match(settingsHtml, new RegExp(`id="${id}"[^>]*class="settings-empty"`), id)
  }
  assert.match(settingsHtml, /id="garage-current-empty"[^>]*class="settings-empty settings-empty--inline"/)
  assert.doesNotMatch(settingsHtml, /garage-empty/)
  assert.doesNotMatch(settingsHtml, /driver-analysis-history__empty/)
  assert.doesNotMatch(settingsHtml, /event-runs__empty/)
  assert.doesNotMatch(settingsHtml, /calibration-empty/)
  assert.doesNotMatch(settingsCss, /garage-empty/)
  assert.doesNotMatch(settingsCss, /driver-analysis-history__empty/)
  assert.doesNotMatch(settingsCss, /event-runs__empty/)
  assert.doesNotMatch(settingsCss, /calibration-empty/)
  assert.match(settingsJs, /className = 'settings-empty'/)
  assert.doesNotMatch(settingsJs, /className = 'events-run-empty'/)
  assert.match(settingsCss, /\.shift-light-brightness-card__heading\s*\{[^}]*align-items:\s*center/)
})

test('Units module is loaded after vehicle in both overlay and settings HTML', () => {
  const overlayVehicleIndex = overlayHtml.indexOf('src="vehicle.js"')
  const overlayUnitsIndex = overlayHtml.indexOf('src="units.js"')
  const settingsVehicleIndex = settingsHtml.indexOf('src="vehicle.js"')
  const settingsUnitsIndex = settingsHtml.indexOf('src="units.js"')

  assert.ok(overlayVehicleIndex >= 0)
  assert.ok(overlayUnitsIndex > overlayVehicleIndex)
  assert.ok(settingsVehicleIndex >= 0)
  assert.ok(settingsUnitsIndex > settingsVehicleIndex)
})

test('Settings has distance unit controls wired alongside speed unit controls', () => {
  assert.match(settingsJs, /querySelectorAll\('input\[name="distance-unit"\]'\)/)
  assert.match(settingsJs, /\{ distanceUnit: [\w.]+\.value \}/)
  assert.match(settingsJs, /DISTANCE UNIT SET TO/)
  assert.match(settingsJs, /'MI'/)
  assert.match(settingsJs, /'KM'/)
})

test('Settings re-renders unit-dependent views when units change', () => {
  assert.match(settingsJs, /renderUnitDependentViews\(\)/)
})

test('Drill-down views show a back link and page name in the header path', () => {
  const header = settingsHtml.slice(settingsHtml.indexOf('<header class="settings-header">'), settingsHtml.indexOf('</header>'))
  const path = header.slice(header.indexOf('class="settings-header__path"'), header.indexOf('</nav>'))
  for (const id of ['events-detail-back', 'events-run-back', 'driver-analysis-detail-back']) {
    assert.match(path, new RegExp(`id="${id}" class="detail-back"`), id)
    assert.equal(settingsHtml.split(`id="${id}"`).length, 2, `${id} appears once`)
  }
  for (const page of ['event', 'run', 'recording', 'car', 'drive']) {
    assert.match(path, new RegExp(`data-detail-page="${page}"`), page)
  }
  assert.doesNotMatch(settingsHtml, /class="events-detail-view__header"/)
  assert.match(settingsHtml, /class="events-detail-view__heading">\s*<button id="events-detail-title"[\s\S]*?class="events-detail-view__actions">\s*<button id="events-detail-delete"/)
  assert.match(settingsJs, /\.dataset\.level = /)
  assert.match(settingsCss, /#driver-analysis-detail-view:not\(\[hidden\]\)\[data-level='car'\]\)\s*\[data-detail-page='car'\]/)
})

test('The one next step of a screen uses the lime ready button', () => {
  assert.match(settingsHtml, /id="events-create-toggle" class="settings-button settings-button--ready"/)
  assert.match(settingsHtml, /id="events-create-submit" class="settings-button settings-button--ready"/)
  assert.match(settingsJs, /detailsButton\.className = 'settings-button settings-button--ready driver-analysis-history-row__details-toggle'/)
  assert.doesNotMatch(settingsHtml, /settings-button--primary/)
  assert.match(settingsStyles, /\.settings-button\.settings-button--ready\s*\{[^}]*background: var\(--accent\)/)
  assert.match(settingsStyles, /\.settings-button\.settings-button--ready:disabled\s*\{[^}]*background: var\(--surface-deep\)/)
})

test('Configuration type roles follow the design book', () => {
  assert.match(settingsStyles, /button,\s*input,\s*select,\s*textarea\s*\{\s*font: inherit;/)
  assert.doesNotMatch(settingsStyles, /font-weight:\s*(650|750|800|850|900)/)
})
