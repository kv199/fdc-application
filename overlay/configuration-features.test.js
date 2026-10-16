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
const tauriMain = readRustSources()

test('Garage typography follows the design book: readout car name, no weight above 600, caps labels only', () => {
  const tokensCss = fs.readFileSync(path.join(__dirname, 'tokens.css'), 'utf8')
  assert.match(tokensCss, /--type-garage-car:\s*38px;/)
  assert.match(settingsStyles, /\.garage-current-car__name\s*\{[^}]*font-family:\s*var\(--font-readout\)[^}]*font-size:\s*var\(--type-garage-car\)[^}]*font-weight:\s*500/)
  assert.match(settingsStyles, /\.garage-current-car__name\s*\{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/)
  assert.match(settingsStyles, /\.garage-section-heading h3\s*\{[^}]*font-size:\s*var\(--type-panel-title\)[^}]*font-weight:\s*600/)
  assert.match(settingsStyles, /\.garage-card__name\s*\{[^}]*font-family:\s*var\(--font-readout\)[^}]*font-size:\s*22px[^}]*font-weight:\s*500/)
  assert.match(settingsStyles, /\.garage-variant-row \.garage-performance__pi\s*\{[^}]*font-family:\s*var\(--font-readout\)[^}]*font-size:\s*22px/)
  for (const [, selector, body] of settingsStyles.matchAll(/(\.garage-[^{}]+)\{([^}]*)\}/g)) {
    const weight = body.match(/font-weight:\s*(\d+)/)
    if (weight) assert.ok(Number(weight[1]) <= 600, `${selector.trim()} must not exceed weight 600`)
  }
})

test('Shift Light exposes separate redline and FDC cue controls in the Shift Light tab', () => {
  const shiftLightPanelIndex = settingsHtml.indexOf('id="shift-light-panel"')
  const redlineIndex = settingsHtml.indexOf('id="redline-brightness"')
  const redlineResetIndex = settingsHtml.indexOf('id="redline-brightness-reset"')
  const cueToggleIndex = settingsHtml.indexOf('id="fdc-shift-light-enabled"')
  const brightnessIndex = settingsHtml.indexOf('id="shift-light-brightness"')
  const settingsPanelIndex = settingsHtml.indexOf('id="settings-panel"')

  assert.ok(shiftLightPanelIndex >= 0)
  assert.ok(redlineIndex > shiftLightPanelIndex)
  assert.ok(redlineResetIndex > shiftLightPanelIndex)
  assert.ok(cueToggleIndex > redlineResetIndex)
  assert.ok(brightnessIndex > shiftLightPanelIndex)
  assert.ok(brightnessIndex > cueToggleIndex)
  assert.ok(brightnessIndex < settingsPanelIndex)
  assert.match(settingsHtml, /<h3 id="redline-brightness-title">REDLINE BRIGHTNESS<\/h3>/)
  assert.match(settingsHtml, /id="redline-brightness-value"[^>]*>80%<\/output>/)
  assert.match(settingsHtml, /id="redline-brightness" type="range" min="0" max="100" step="5" value="80"/)
  assert.match(settingsHtml, /id="redline-brightness-reset"[^>]*type="button"[^>]*disabled>RESET<\/button>/)
  assert.match(settingsHtml, /id="fdc-shift-light-enabled" class="visibility-toggle" type="button"[^>]*aria-pressed="true"/)
  assert.doesNotMatch(settingsHtml, /class="brightness-scale"/)
  assert.match(settingsHtml, /<h3 id="shift-light-brightness-title">FDC SHIFT LIGHT BRIGHTNESS<\/h3>/)
  assert.match(settingsHtml, /class="shift-light-brightness-card"/)
  assert.match(settingsHtml, /id="shift-light-brightness" type="range" min="0" max="100" step="5" value="80"/)
  assert.match(settingsHtml, /<span class="calibration-label">LEARNED CEILING<\/span>/)
  assert.match(settingsHtml, /id="shift-light-usable-ceiling"/)
  assert.match(settingsHtml, /<dt>LEARNING<\/dt><dd>Shifts at the safe redline while FDC watches your full-throttle upshifts\.<\/dd>/)
  assert.match(settingsHtml, /<dt>POTENTIAL<\/dt>/)
  assert.match(settingsHtml, /Only clean full-throttle upshifts count; other shifts are ignored\./)
  // The redline and FDC cue values are sent in the set_display_preferences payload,
  // which configuration-shell.test.js pins.
})

test('Shift Light calibration card uses the design book title, table, and reset placement', () => {
  const profileIndex = settingsHtml.indexOf('id="shift-light-profile"')
  const gearRowsIndex = settingsHtml.indexOf('id="shift-light-gear-rows"')
  const resetIndex = settingsHtml.indexOf('id="shift-light-reset"')

  assert.ok(profileIndex >= 0)
  assert.match(settingsHtml, /<div id="shift-light-profile" class="calibration-card" hidden>\s*<h3 class="calibration-card__title">CURRENT CAR PROFILE<\/h3>/)
  assert.match(settingsHtml, /class="events-run-table shift-light-gear-table"/)
  assert.match(settingsHtml, /<th scope="col" class="events-run-table__end">STATE<\/th>/)
  assert.match(settingsHtml, /<th scope="col">LAST COMPARISON<\/th>/)
  assert.doesNotMatch(settingsHtml, /calibration-table/)
  assert.ok(gearRowsIndex > profileIndex)
  assert.ok(resetIndex > gearRowsIndex)
  assert.match(settingsHtml, /<\/table>\s*<\/div>\s*<\/div>\s*<button id="shift-light-reset"[^>]*\bdisabled hidden>/)
  assert.match(settingsJs, /'shift-light-profile'/)
  assert.match(settingsJs, /'shift-light-reset'/)
  assert.match(settingsJs, /\.hidden = !hasProfile/)
  assert.match(settingsJs, /\.scope = 'row'/)
  assert.match(settingsJs, /'events-run-table__end'/)
  assert.match(settingsJs, /colSpan = 5/)
  assert.match(settingsJs, /'NO GEAR SAMPLES YET'/)
})

test('Shift Light RPM values use thousands separators through formatRpm', () => {
  // formatRpm lives in settings.js and is not exported; its exact rules are pinned in
  // configuration-extraction-backlog.test.js until it moves into a testable module.
  assert.match(settingsJs, /Intl\.NumberFormat\('en-US'\)/)
  assert.match(settingsJs, /formatRpm\(state\.rpmMax\)/)
  assert.match(settingsJs, /formatRpm\(state\.usableCeiling\)/)
  assert.match(settingsJs, /LEARNING · \$\{state\.ceilingClusterCount\}\/3/)
  assert.match(settingsJs, /· \$\{formatRpm\(/)
  assert.match(settingsJs, /LEARNING · \$\{formatRpm\(/)
  assert.doesNotMatch(settingsJs, /\$\{(state\.rpmMax|state\.usableCeiling|activeTarget|fallbackTarget)\} RPM/)
})

test('Configuration replays Shift Light state and waits for the real reset result', () => {
  assert.match(settingsJs, /hud_shift_light_reset_result/)
  assert.match(settingsJs, /call\('sync_shift_light_status'\)/)
  // The success text is shown only for a reset result that reports ok.
  assert.match(settingsJs, /CALIBRATION RESET COMPLETE/)
  assert.match(settingsJs, /\?\.ok === true/)
  assert.match(tauriMain, /fn sync_shift_light_status/)
})

test('Driver Analysis heading spacing does not affect toggle internals', () => {
  assert.match(settingsCss, /\.driver-analysis-heading > div > span\s*\{[\s\S]*?margin-top:\s*6px;/)
  assert.doesNotMatch(settingsCss, /\.driver-analysis-heading span\s*\{/)
})

test('Driver Analysis history cards open drill-down pages for recording, car, and drive', () => {
  assert.match(settingsHtml, /id="driver-analysis-history-view"[\s\S]*class="driver-analysis-history-view"/)
  assert.match(settingsHtml, /id="driver-analysis-detail-view"[\s\S]*class="driver-analysis-detail-view"/)
  assert.match(settingsHtml, /id="driver-analysis-detail-back"[\s\S]*class="detail-back"[\s\S]*><\/button>/)
  assert.match(settingsHtml, /id="driver-analysis-detail-title"[\s\S]*class="events-detail-view__title/)
  assert.match(settingsHtml, /id="driver-analysis-detail-summary"[\s\S]*class="events-detail-view__summary"/)
  assert.match(settingsHtml, /id="driver-analysis-detail-body"[\s\S]*class="driver-analysis-detail-view__body"/)
  // Every drill-down level is both a state the page can enter and a page the view renders.
  for (const level of ['history', 'recording', 'car', 'drive']) {
    assert.match(settingsJs, new RegExp(`level (===|:) '${level}'`))
  }
  assert.match(settingsJs, /'driver-analysis-detail-back'/)
  assert.match(settingsJs, /getElementById\('driver-analysis-panel'\)/)
  assert.match(settingsJs, /key !== 'Escape'/)
  assert.match(settingsJs, /delete_driver_analysis_recording/)
  assert.match(settingsJs, /DriverAnalysisHistory\?.groupRecordings/)
  assert.match(settingsJs, /DriverAnalysisHistory\?.recordingSummary/)
  assert.match(settingsJs, /FdcVehicle\.displayName\(session\?\.vehicleName/)
  assert.match(settingsJs, /formatPatternSummary.*session\.stats/)
  assert.match(settingsJs, /formatPatternHeadline/)
  assert.match(settingsJs, /formatSummaryMetrics\?\.\(session\.stats\)/)
  assert.match(settingsJs, /instruction = patternSummary\.text/)
  assert.match(settingsJs, /recording\.sessions\.length === 1[\s\S]{0,120}recordingSummary/)
  assert.match(settingsJs, /className = 'driver-analysis-detail-view__summary'/)
  assert.match(settingsJs, /className = 'driver-analysis-detail-view__result'/)
  assert.match(settingsJs, /formatStatsRows.*session\.stats/)
  assert.match(settingsJs, /'DETAILS'/)
  assert.match(settingsJs, /events-run-table__lap-row/)
  assert.match(settingsJs, /events-run-table-section/)
  assert.match(settingsJs, /events-lap-detail/)
  assert.match(settingsJs, /textContent = 'CARS'/)
  assert.match(settingsJs, /textContent = 'DRIVES'/)
  assert.match(settingsCss, /\.driver-analysis-history-row__details-toggle,\s*\.driver-analysis-history-row__export,\s*\.driver-analysis-history-row__delete\s*\{\s*min-width:\s*84px/)
  // Row actions appear in this order: DETAILS, then EXPORT and DELETE.
  assert.match(settingsJs, /'DETAILS'[\s\S]*'EXPORT'[\s\S]*'DELETE'/)
  assert.match(settingsHtml, /id="destructive-confirm-dialog" class="confirm-dialog" role="alertdialog"[^>]+hidden/)
  assert.match(settingsHtml, /<h3 id="destructive-confirm-title">ARE YOU SURE\?<\/h3>/)
  assert.match(settingsHtml, /id="destructive-confirm-yes"[^>]*>YES<\/button>\s*<button id="destructive-confirm-no"[^>]*>NO<\/button>/)
  assert.match(settingsCss, /\.driver-analysis-history-row__summary\s*\{[\s\S]*margin-top:\s*8px/)
  assert.match(settingsCss, /\.driver-analysis-detail-view__body[\s\S]*display:\s*grid/)
  assert.match(settingsCss, /\.driver-analysis-detail-view__summary\s*\{[\s\S]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/)
})

test('Garage does not create image placeholders for current car or saved cars', () => {
  assert.doesNotMatch(settingsJs, /garage-current-car__image/)
  assert.doesNotMatch(settingsJs, /garage-card__image/)
  assert.doesNotMatch(settingsJs, /'IMAGE'/)
})
