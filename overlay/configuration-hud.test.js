const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { readResolvedStylesheet } = require('../tools/stylesheet-tokens.cjs')
const { readConfigurationScripts, readRustSources } = require('../tools/test-sources.cjs')
const DisplayPreferences = require('./display-preferences.js')
const hudLayout = require('./hud-layout.js')

const settingsHtml = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8')
const settingsCss = readResolvedStylesheet('settings.css')
// Interface roles are asserted by token; preserved meanings (modes, classes, map layers) by value.
const settingsStyles = fs.readFileSync(path.join(__dirname, 'settings.css'), 'utf8')
const settingsJs = readConfigurationScripts()
const overlayHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
const tauriMain = readRustSources()
const tauriConfig = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json'), 'utf8')
const cargoManifest = fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'Cargo.toml'), 'utf8')

test('Engine telemetry keeps the compact panel order and one visibility toggle', () => {
  const sections = [...overlayHtml.matchAll(/<section id="(hud-[^"]+)"/g)].map(match => match[1])
  const components = [...settingsHtml.matchAll(/data-hud-toggle="([^"]+)"/g)].map(match => match[1])

  assert.deepEqual(sections, ['hud-tires', 'hud-pedals', 'hud-steering', 'hud-gear', 'hud-engine', 'hud-history'])
  assert.deepEqual(components, ['tires', 'pedals', 'steering', 'gear', 'engine', 'history'])
  assert.match(settingsHtml, /<span class="widget-row__name">Engine \/ Boost<\/span>/)
  assert.match(overlayHtml, /id="engine-boost"[^>]+aria-label="Boost pressure"/)
  assert.match(overlayHtml, /id="engine-power"[^>]+aria-label="Engine power"/)
  assert.match(overlayHtml, /id="engine-torque"[^>]+aria-label="Engine torque"/)
})

test('Engine visibility is part of the safe HUD component contract', () => {
  const hudWidgets = require('./hud-widgets.js')

  assert.deepEqual(hudWidgets.COMPONENTS, ['tires', 'pedals', 'steering', 'gear', 'engine', 'history'])
  assert.equal(hudWidgets.COLUMN_WIDTHS.engine, 116)
  // hud-widgets.test.js checks that the native HUD_COMPONENT_NAMES whitelist lists exactly these widgets.
})

test('HUD layout exposes grouped and freeform modes with unified widgets and layout editing', () => {
  // The HUD tab has three cards in order: DISPLAY, LAYOUT and WIDGETS. The LAYOUT card holds one
  // raised plate whose rows are ARRANGEMENT, EDIT THE LAYOUT and IN-GAME EDIT HOTKEY.
  assert.match(settingsHtml, /<section class="hud-group" aria-labelledby="hud-layout-title">\s*<div class="hud-group__head">\s*<h3 id="hud-layout-title" class="layout-section__title">LAYOUT<\/h3>[\s\S]*?<section class="action-panel" aria-label="HUD layout editing" data-layout-edit-row>[\s\S]*?<div class="action-panel__row layout-arrangement">[\s\S]*?<h3 id="hud-layout-arrangement-title">ARRANGEMENT<\/h3>[\s\S]*?class="unit-options" role="radiogroup" aria-labelledby="hud-layout-arrangement-title"[\s\S]*?<h3 id="hud-layout-edit-title">EDIT THE LAYOUT<\/h3>[\s\S]*?<strong>IN-GAME EDIT HOTKEY<\/strong>[\s\S]*?<\/section>\s*<\/section>\s*<section class="layout-list hud-group" aria-labelledby="hud-widgets-title">[\s\S]*?id="hud-widgets-title" class="layout-section__title">WIDGETS</)
  // The editor shows EDITING while an edit runs, like READY on the Driver Analysis recorder.
  assert.match(settingsHtml, /id="hud-layout-status" class="action-panel__status" data-state="editing" role="status" aria-live="polite" hidden>EDITING</)
  assert.match(settingsJs, /getElementById\('hud-layout-status'\)/)
  assert.match(settingsJs, /\.hidden = !editing/)
  assert.match(settingsStyles, /\.driver-analysis-recorder__main,\s*\.driver-analysis-hotkey,\s*\.action-panel__row \{/)
  assert.match(settingsStyles, /\.action-panel__status\[data-state='editing'\] \{\s*color: var\(--warning\);/)
  // Widgets are compact rows with a name only; the whole row toggles its widget.
  assert.equal(settingsHtml.match(/<label class="widget-row">\s*<span class="widget-row__name">[^<]+<\/span>\s*<button class="visibility-toggle"/g)?.length, 8)
  assert.doesNotMatch(settingsHtml, /layout-row|visibility-row/)
  assert.doesNotMatch(settingsHtml, /data-freeform-layout-list|data-grouped-layout-row/)
  assert.match(settingsHtml, /data-layout-mode="grouped" checked/)
  assert.match(settingsHtml, /data-layout-mode="freeform"/)

  // Layout edit row has EDIT LAYOUT, RESET LAYOUT, SAVE, CANCEL
  assert.match(settingsHtml, /id="hud-layout-edit"[^>]*class="settings-button settings-button--ready"/)
  assert.match(settingsHtml, /id="hud-layout-reset"[^>]*class="settings-button settings-button--caution"/)
  assert.match(settingsHtml, /id="hud-layout-save"/)
  assert.match(settingsHtml, /id="hud-layout-cancel"/)
  assert.match(settingsHtml, /data-layout-edit-row/)

  // One widget list with all widgets and ALL toggle

  assert.match(settingsHtml, /id="hud-all-widgets"[^>]*data-hud-toggle-all/)
  for (const component of ['tires', 'pedals', 'steering', 'gear', 'engine', 'history']) {
    assert.match(settingsHtml, new RegExp(`data-hud-toggle="${component}"`, 'u'))
  }
  assert.match(settingsHtml, /data-overlay-toggle="delta"/)

  // No old per-row edit buttons or accordion
  assert.doesNotMatch(settingsHtml, /data-layout-action="edit"|data-accordion-toggle|visibility-list/)

  // Native contract for layout actions
  assert.match(settingsJs, /call\('layout_action', \{ action: 'start', target: 'hud' \}\)/)
  assert.match(settingsJs, /call\('layout_action', \{ action: 'reset_all', target: 'hud' \}\)/)
  assert.match(settingsJs, /call\('set_layout_mode', \{ mode: nextMode \}\)/)
  assert.match(tauriMain, /fn set_layout_mode\(app: AppHandle, mode: String\)/)
})

test('the Configuration page writes the layout mode under the key and modes the overlay reads', () => {
  // hud-layout.js owns the stored layout mode; the Configuration page must use the same key.
  assert.match(settingsJs, new RegExp(`'${hudLayout.MODE_STORAGE_KEY.replace(/\./g, '\\.')}'`))
  const radioModes = [...new Set([...settingsHtml.matchAll(/data-layout-mode="([^"]+)"/g)].map(match => match[1]))]
  assert.deepEqual(radioModes, hudLayout.MODES)
})

test('HUD opacity appears before HUD controls and resets to its 80 percent default', () => {
  const hudOpacityIndex = settingsHtml.indexOf('id="hud-opacity"')
  const layoutListIndex = settingsHtml.indexOf('class="action-panel__row layout-arrangement"')

  assert.ok(hudOpacityIndex >= 0)
  assert.ok(hudOpacityIndex < layoutListIndex)
  assert.match(settingsHtml, /id="hud-opacity" type="range" min="1" max="100" step="1" value="80"/)
  assert.match(settingsHtml, /id="hud-opacity-reset" class="settings-button hud-opacity-reset" type="button" disabled>RESET<\/button>/)
  assert.match(settingsJs, /HUD OPACITY RESET TO /)
  assert.match(settingsJs, /\.disabled = [^\n]*DEFAULT_HUD_OPACITY/)
  assert.match(settingsStyles, /\.hud-opacity-reset\.is-dirty:not\(:disabled\)\s*\{[^}]*var\(--caution\)/)
})

test('the HUD opacity slider range and default agree with the display preference bounds', () => {
  const slider = settingsHtml.match(/id="hud-opacity" type="range" min="(\d+)" max="(\d+)" step="\d+" value="(\d+)"/)
  assert.ok(slider, 'HUD opacity slider')
  const [, min, max, value] = slider.map(Number)
  assert.equal(value, DisplayPreferences.DEFAULTS.hudOpacity)
  assert.equal(DisplayPreferences.normalize({ hudOpacity: 0 }).hudOpacity, min)
  assert.equal(DisplayPreferences.normalize({ hudOpacity: 1000 }).hudOpacity, max)
})

test('HUD heading has no redundant position and visibility label, and status uses a fixed footer', () => {
  assert.doesNotMatch(settingsHtml, /POSITION \+ VISIBILITY/)
  assert.match(settingsHtml, /<footer class="settings-footer"[^>]*aria-label="Configuration status"[^>]*>/)
  assert.match(settingsHtml, /id="settings-status"[^>]*role="status"/)
  assert.match(settingsHtml, /id="app-version"[^>]*type="button"[^>]*title="Click to copy"[^>]*disabled/)
  assert.match(settingsHtml, /id="settings-help-toggle"[^>]*type="button"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*aria-controls="settings-help-menu">HELP<\/button>/)
  assert.match(settingsHtml, /id="settings-help-menu"[^>]*role="menu"[^>]*aria-labelledby="settings-help-toggle"[^>]*hidden>/)
  const menuItems = [...settingsHtml.matchAll(/data-feedback-link="([^"]+)"/g)].map(m => m[1])
  assert.deepEqual(menuItems, ['bug', 'idea', 'question'])
  assert.match(settingsHtml, /data-feedback-link="bug"[^>]*>Report a bug<\/button>/)
  assert.match(settingsHtml, /data-feedback-link="idea"[^>]*>Suggest an idea<\/button>/)
  assert.match(settingsHtml, /data-feedback-link="question"[^>]*>Ask a question<\/button>/)
  assert.doesNotMatch(settingsHtml, /v\d+\.\d+\.\d+/)
  assert.doesNotMatch(settingsJs, /v\d+\.\d+\.\d+/)
  assert.match(settingsJs, /getElementById\('settings-status'\)/)
  assert.match(settingsJs, /getElementById\('settings-help-toggle'\)/)
  assert.match(settingsJs, /getElementById\('settings-help-menu'\)/)
  assert.match(settingsJs, /call\('get_app_version'\)/)
  // The leading "v" of a tag is stripped once, then the page shows it with one "v" prefix.
  assert.match(settingsJs, /replace\(\/\^v\/u, ''\)/)
  assert.match(settingsJs, /`v\$\{[^}]+\}`/)
  assert.match(settingsJs, /\.disabled = false/)
  assert.match(settingsJs, /navigator\.clipboard\.writeText/)
  assert.match(settingsJs, /document\.execCommand\('copy'\)/)
  assert.match(settingsJs, /COPIED/)
  assert.match(settingsJs, /call\('open_feedback_link', \{ kind \}\)/)
  assert.match(cargoManifest, /^version = "\d+\.\d+\.\d+"$/m)
  assert.equal(Object.hasOwn(JSON.parse(tauriConfig), 'version'), false)
  assert.match(settingsCss, /--settings-footer-height:\s*52px;/)
  assert.match(settingsStyles, /\.settings-shell\s*{[^}]*padding:[^;]*calc\([^;]*\+ var\(--settings-footer-height\)\);/)
  assert.match(settingsStyles, /\.settings-footer\s*{[\s\S]*?position:\s*fixed;[\s\S]*?height:\s*var\(--settings-footer-height\);[\s\S]*?border-top:[\s\S]*?background:\s*var\(--bg\);/)
  assert.match(settingsCss, /\.settings-footer__right\s*{[\s\S]*?margin-left:\s*auto/)
  assert.match(settingsCss, /\.settings-footer__version\s*{[\s\S]*?cursor:\s*pointer/)
  assert.match(settingsCss, /\.settings-footer__help\s*{[\s\S]*?font-weight:\s*600/)
  assert.match(settingsCss, /\.settings-help-menu\s*{[\s\S]*?position:\s*absolute/)
  assert.match(settingsCss, /\.settings-help-menu button\s*{[\s\S]*?width:\s*100%/)
  assert.doesNotMatch(settingsCss, /\.settings-status\s*{[^}]*position:\s*fixed;/)
})

test('HUD DISPLAY card allows selecting which monitor the HUD covers', () => {
  const hudPanel = settingsHtml.slice(settingsHtml.indexOf('id="hud-panel"'), settingsHtml.indexOf('id="hud-panel"') + 4000)
  assert.match(settingsHtml, /<section class="hud-group" aria-labelledby="hud-screen-title">\s*<div class="hud-group__head">\s*<h3 id="hud-screen-title" class="layout-section__title">DISPLAY<\/h3>/)
  assert.match(hudPanel, /id="hud-display-title" class="hud-row__title">HUD DISPLAY/)
  assert.match(hudPanel, /Monitor the HUD is shown on/)
  assert.match(hudPanel, /id="hud-display"[^>]*><\/select>/)
  assert.match(hudPanel, /id="hud-display-missing"[^>]*hidden/)
  assert.ok(hudPanel.indexOf('HUD DISPLAY') < hudPanel.indexOf('HUD OPACITY'))
  // The DISPLAY card holds the monitor, the opacity and SHOW HUD WITH TELEMETRY, in that order.
  const displayCard = settingsHtml.slice(settingsHtml.indexOf('aria-labelledby="hud-screen-title"'), settingsHtml.indexOf('aria-labelledby="hud-layout-title"'))
  assert.ok(displayCard.indexOf('id="hud-display"') < displayCard.indexOf('id="hud-opacity"'))
  assert.ok(displayCard.indexOf('id="hud-opacity"') < displayCard.indexOf('id="show-hud-with-telemetry"'))
  assert.match(displayCard, /<div class="display-setting-row" data-display-preference>\s*<div class="display-setting-row__copy">\s*<strong>SHOW HUD WITH TELEMETRY<\/strong>/)
  assert.match(displayCard, /<button id="show-hud-with-telemetry" class="visibility-toggle" type="button" aria-label="Show the HUD, Delta and Shift Bar only with live telemetry" aria-pressed="true">/)
  assert.match(settingsJs, /call\('list_hud_displays'\)/)
  assert.match(settingsJs, /call\('set_hud_display'/)
  // The monitor list is disabled with one monitor, and while a layout edit runs.
  assert.match(settingsJs, /hudDisplay\.disabled = [^\n]*<= 1/)
  assert.match(settingsJs, /hudDisplay\.disabled = [^\n]*editingTarget/)
  // The Rust side refreshes the list through this public method.
  assert.match(settingsJs, /globalScope\.SettingsController[\s\S]*refreshHudDisplay/)
})

test('HUD uses FdcUnits for speed formatting and reads fresh display preferences on update', () => {
  assert.match(overlayHtml, /src="units.js"/)
  assert.match(overlayHtml, /src="vehicle.js"/)
  assert.ok(overlayHtml.indexOf('vehicle.js') < overlayHtml.indexOf('units.js'))
  const overlaySource = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8')
  assert.match(overlaySource, /window\.FdcUnits\.formatSpeed\([\s\S]*?\{ unit: displayPreferences\.speedUnit \}/)
  assert.match(overlaySource, /window\.DisplayPreferences\.write\(\{\s*\.\.\.window\.DisplayPreferences\.read\(\),/)
})

test('the HUD tab offers an edit hotkey in the layout edit row that is registered at startup and never shared with Driver Analysis', () => {
  const start = settingsHtml.indexOf('data-settings-panel="hud"')
  const hudPanel = settingsHtml.slice(start, settingsHtml.indexOf('data-settings-panel="', start + 1))
  assert.match(hudPanel, /data-layout-edit-row[\s\S]*id="hud-edit-hotkey-value"[^>]*>Ctrl \+ Shift \+ F8<\/output>/)
  // The hotkey row matches GLOBAL RECORD HOTKEY: copy on the left, the combination and CHANGE on the right.
  assert.match(hudPanel, /<strong>IN-GAME EDIT HOTKEY<\/strong>\s*<small id="hud-edit-hotkey-help">[^<]+<\/small>\s*<\/div>\s*<div class="action-panel__actions">\s*<output id="hud-edit-hotkey-value"[^>]*>Ctrl \+ Shift \+ F8<\/output>\s*<button id="hud-edit-hotkey-change" class="settings-button"/)
  assert.match(settingsStyles, /\.driver-analysis-hotkey__control output,\s*\.action-panel__actions output \{/)
  assert.doesNotMatch(hudPanel, /id="hud-edit-hotkey-title">EDIT HOTKEY/)
  assert.match(settingsJs, /'Ctrl\+Shift\+F8'/)
  assert.match(settingsJs, /'fdc\.hud-edit-hotkey\.v1'/)
  assert.match(settingsJs, /call\('set_hud_edit_hotkey', \{ hotkey: /)
  // Startup registers the stored hotkey without announcing it.
  assert.match(settingsJs, /setHudEditHotkey\([^)]*, false/)
  assert.match(settingsJs, /THAT HOTKEY IS ALREADY USED BY DRIVER ANALYSIS/)
  assert.match(settingsJs, /THAT HOTKEY IS ALREADY USED BY HUD EDIT/)
  // One capture at a time: starting either capture ends the other.
  assert.match(settingsJs, /if \(hudEditHotkeyCapture && isDriverAnalysisHotkeyCapturing\(\)\) await setDriverAnalysisHotkeyCapture\(false\)/)
  assert.match(settingsJs, /if \(driverAnalysisHotkeyCapture && isHudEditHotkeyCapturing\(\)\) await setHudEditHotkeyCapture\(false\)/)
  assert.match(tauriMain, /fn set_hud_edit_hotkey\(/)
  assert.match(tauriMain, /window\.HudLayout\?\.toggleEditSession\?\.\(\)/)
})

test('every widget switch is the only element bound to its widget', () => {
  for (const name of ['tires', 'pedals', 'steering', 'gear', 'engine', 'history']) {
    assert.equal(settingsHtml.match(new RegExp(`data-hud-toggle="${name}"`, 'g'))?.length, 1, name)
  }
  assert.equal(settingsHtml.match(/data-overlay-toggle="delta"/g)?.length, 1)
  assert.equal(settingsHtml.match(/data-overlay-toggle="shiftBar"/g)?.length, 1)
})

test('the Shift Bar is a WIDGETS row with its own switch that defaults off and ALL covers it', () => {
  const row = settingsHtml.match(/<label class="widget-row">\s*<span class="widget-row__name">Shift Bar<\/span>\s*<button class="visibility-toggle" type="button" data-overlay-toggle="shiftBar" aria-label="Toggle Shift Bar" aria-pressed="false">/)
  assert.ok(row, 'Shift Bar row with an off switch')
  // The default-off reading of a missing Shift Bar key is checked in hud-widgets.test.js.
  assert.match(settingsJs, /globalScope\.HudWidgets/)
  assert.match(settingsJs, /isOverlayComponentOn\(/)
  // ALL and ANY both count the Shift Bar as on only when its key is explicitly true.
  assert.ok((settingsJs.match(/overlayVisibility\.shiftBar === true/g) || []).length >= 2)
  assert.match(settingsJs, /setOverlayComponentVisibility\('shiftBar', /)
  assert.match(settingsJs, /'SHIFT BAR'/)
  assert.match(settingsHtml, /Show the HUD, Delta and Shift Bar only while live telemetry is received\./)
  assert.match(settingsJs, /Every HUD block, Delta and the Shift Bar goes back to its default place/)
})

test('BRAKE TARGET options nest under the Throttle & Brake row, outside its label, with a target slider and a peak marker', () => {
  // The options are a sibling after the Throttle label, so clicking them never toggles the widget.
  const throttleRow = settingsHtml.match(/<label class="widget-row">\s*<span class="widget-row__name">Throttle &amp; Brake<\/span>[\s\S]*?<\/label>\s*(<div id="brake-target-card" class="widget-options brake-target-card" aria-labelledby="brake-target-title">)/)
  assert.ok(throttleRow, 'BRAKE TARGET options directly after the Throttle & Brake row')
  const steeringIndex = settingsHtml.indexOf('<span class="widget-row__name">Steering</span>')
  assert.ok(settingsHtml.indexOf('id="brake-target-card"') < steeringIndex, 'the options come before Steering')
  assert.match(settingsHtml, /<h4 id="brake-target-title" class="widget-options__title">BRAKE TARGET<\/h4>/)
  assert.match(settingsHtml, /A line on the brake bar and the Input Graph at the brake level you practice\./)
  assert.match(settingsHtml, /<span id="brake-target-level-name" class="brake-target-row__name">TARGET<\/span>/)
  assert.match(settingsHtml, /<output id="brake-target-value" for="brake-target-level" aria-live="polite">70%<\/output>/)
  assert.match(settingsHtml, /<button id="brake-target-enabled" class="visibility-toggle" type="button" aria-label="Show the brake target line" aria-pressed="false" aria-describedby="brake-target-widget-hint">/)
  assert.match(settingsHtml, /<input id="brake-target-level" type="range" min="5" max="100" step="5" value="70" aria-labelledby="brake-target-level-name" aria-describedby="brake-target-level-hint">/)
  assert.match(settingsHtml, /<span id="brake-peak-name" class="brake-target-row__name">PEAK MARKER<\/span>/)
  assert.match(settingsHtml, /Shows the highest brake level of the last stop until the next one\./)
  assert.match(settingsHtml, /<button id="brake-peak-enabled" class="visibility-toggle" type="button" aria-label="Show the peak brake marker" aria-pressed="false" aria-describedby="brake-peak-hint">/)
  assert.ok(settingsHtml.indexOf('src="brake-marks.js"') < settingsHtml.indexOf('src="settings-hud.js"'))
  assert.match(settingsStyles, /\.brake-target-row\s*\{[^}]*border-top:\s*1px solid var\(--line-subtle\)/)
  assert.match(settingsStyles, /\.widget-options\s*\{[^}]*border-left:\s*1px solid var\(--line-strong\)/)
  assert.match(settingsStyles, /\.widget-options \+ \.widget-row\s*\{[^}]*border-top:/)
})

test('BRAKE TARGET hints are hidden by default and the dependent controls are named by their hint', () => {
  const hint = id => settingsHtml.match(new RegExp(`<p id="${id}" class="brake-target-hint" hidden>([^<]+)</p>`))
  assert.equal(hint('brake-target-widget-hint')?.[1], 'Turn on Throttle &amp; Brake or Input Graph to see the target.')
  assert.equal(hint('brake-target-level-hint')?.[1], 'Turn on TARGET to choose the level.')
  assert.equal(hint('brake-peak-hint')?.[1], 'Turn on Throttle &amp; Brake to see the peak marker.')
  // The dependency rules are applied in settings-hud.js; the hints are shown and hidden only from there.
  const hudJs = fs.readFileSync(path.join(__dirname, 'settings-hud.js'), 'utf8')
  assert.match(hudJs, /brakeTargetWidgetHint\.hidden = !state\.targetSwitchHint/)
  assert.match(hudJs, /brakeTargetLevelHint\.hidden = !state\.targetLevelHint/)
  assert.match(hudJs, /brakePeakHint\.hidden = !state\.peakDisabled/)
  assert.match(hudJs, /brakeTargetEnabled\.disabled = state\.targetSwitchDisabled/)
  assert.match(hudJs, /brakeTargetLevel\.disabled = state\.targetLevelDisabled/)
  assert.match(hudJs, /brakePeakEnabled\.disabled = state\.peakDisabled/)
  // Every widget change and every brake render recomputes the dependent state.
  assert.match(hudJs, /function renderAllToggle\(\) \{\s*syncBrakeDependencies\(\)/)
  assert.match(hudJs, /renderBrakeTargetLevel\(preferences\.targetPercent\)\s*syncBrakeDependencies\(\)/)
  assert.match(settingsStyles, /\.brake-target-row\.is-disabled \.brake-target-row__name\s*\{\s*color:\s*var\(--text-faint\)/)
  assert.match(settingsStyles, /\.brake-target-hint\s*\{[^}]*color:\s*var\(--notice\)/)
})

test('BRAKE TARGET saves through set_brake_marks with the three fields and hides itself without BrakeMarks', () => {
  const hudJs = fs.readFileSync(path.join(__dirname, 'settings-hud.js'), 'utf8')
  assert.match(hudJs, /const brakeMarks = globalScope\.BrakeMarks/)
  assert.match(hudJs, /brakeMarks \? brakeMarks\.read\(\) : null/)
  assert.match(hudJs, /call\('set_brake_marks', \{\s*targetEnabled: next\.targetEnabled,\s*targetPercent: next\.targetPercent,\s*peakEnabled: next\.peakEnabled\s*\}\)/)
  // The slider updates its label on input and saves on change; each switch click saves at once.
  assert.match(hudJs, /brakeTargetLevel\?\.addEventListener\('input'/)
  assert.match(hudJs, /brakeTargetLevel\?\.addEventListener\('change'/)
  assert.match(hudJs, /brakeTargetEnabled\?\.addEventListener\('click'/)
  assert.match(hudJs, /brakePeakEnabled\?\.addEventListener\('click'/)
  assert.match(hudJs, /brakeMarks\.write\(\{ \.\.\.previous, \.\.\.changes \}\)/)
  assert.match(hudJs, /setStatus\(error\.message \|\| 'Unable to update the brake target', true\)/)
  assert.match(hudJs, /brakeTargetCard\.hidden = true/)
})
