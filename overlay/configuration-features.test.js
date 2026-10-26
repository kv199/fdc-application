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

test('Shift Light groups the redline and FDC cue controls under one SHIFT CUE card', () => {
  const shiftLightPanelIndex = settingsHtml.indexOf('id="shift-light-panel"')
  const cardIndex = settingsHtml.indexOf('id="shift-cue-card"')
  const helpPanelIndex = settingsHtml.indexOf('id="shift-light-help-panel"')
  const redlineRowIndex = settingsHtml.indexOf('class="shift-cue-row shift-cue-row--redline"')
  const fdcRowIndex = settingsHtml.indexOf('class="shift-cue-row shift-cue-row--fdc"')
  const redlineIndex = settingsHtml.indexOf('id="redline-brightness"')
  const redlineResetIndex = settingsHtml.indexOf('id="redline-brightness-reset"')
  const cueToggleIndex = settingsHtml.indexOf('id="fdc-shift-light-enabled"')
  const brightnessGroupIndex = settingsHtml.indexOf('id="shift-light-brightness-group"')
  const brightnessIndex = settingsHtml.indexOf('id="shift-light-brightness"')
  const brightnessResetIndex = settingsHtml.indexOf('id="shift-light-brightness-reset"')
  const hintIndex = settingsHtml.indexOf('id="shift-light-brightness-hint"')
  const settingsPanelIndex = settingsHtml.indexOf('id="settings-panel"')

  assert.ok(shiftLightPanelIndex >= 0)
  // One SHIFT CUE card holds both rows; the old separate cards and the old FDC brightness title are gone.
  assert.equal(settingsHtml.match(/<h3 id="shift-cue-title">SHIFT CUE<\/h3>/g)?.length, 1)
  assert.equal(settingsHtml.match(/id="shift-cue-card"/g)?.length, 1)
  assert.match(settingsHtml, /<section id="shift-cue-card" class="shift-light-brightness-card shift-cue-card" data-display-preference aria-labelledby="shift-cue-title">/)
  assert.match(settingsHtml, /<p class="hud-display-card__description">Flashes on the Gear block and the Shift Bar\.<\/p>/)
  assert.doesNotMatch(settingsHtml, /shift-light-brightness-card--redline|shift-light-cue-toggle|FDC SHIFT LIGHT BRIGHTNESS/)
  // Order inside the Shift Light tab: the card, the redline row, the FDC switch row with its brightness child, then the help panel.
  assert.ok(cardIndex > shiftLightPanelIndex)
  assert.ok(redlineRowIndex > cardIndex)
  assert.ok(redlineIndex > redlineRowIndex && redlineIndex < fdcRowIndex)
  assert.ok(redlineResetIndex > redlineRowIndex && redlineResetIndex < fdcRowIndex)
  assert.ok(fdcRowIndex > redlineResetIndex)
  assert.ok(cueToggleIndex > fdcRowIndex)
  assert.ok(brightnessGroupIndex > cueToggleIndex)
  assert.ok(brightnessIndex > brightnessGroupIndex)
  assert.ok(brightnessResetIndex > brightnessGroupIndex)
  assert.ok(hintIndex > brightnessIndex)
  assert.ok(helpPanelIndex > hintIndex)
  assert.ok(hintIndex < settingsPanelIndex)
  assert.match(settingsHtml, /<span class="shift-cue-dot shift-cue-dot--redline" aria-hidden="true"><\/span>\s*<strong id="redline-brightness-title">REDLINE<\/strong>/)
  assert.match(settingsHtml, /id="redline-brightness-value" for="redline-brightness" aria-live="polite">80%<\/output>/)
  assert.match(settingsHtml, /id="redline-brightness" type="range" min="0" max="100" step="5" value="80" aria-labelledby="redline-brightness-title"/)
  assert.match(settingsHtml, /id="redline-brightness-reset" class="settings-button hud-opacity-reset" type="button" disabled>RESET<\/button>/)
  assert.match(settingsHtml, /<span class="shift-cue-dot shift-cue-dot--fdc" aria-hidden="true"><\/span>\s*<strong>FDC SHIFT LIGHT<\/strong>/)
  assert.match(settingsHtml, /id="fdc-shift-light-enabled" class="visibility-toggle" type="button"[^>]*aria-pressed="true"/)
  // BRIGHTNESS is nested under the switch and is labelled by its own title.
  assert.match(settingsHtml, /<div id="shift-light-brightness-group" class="shift-cue-sub">/)
  assert.match(settingsHtml, /<strong id="shift-light-brightness-title">BRIGHTNESS<\/strong>/)
  assert.match(settingsHtml, /id="shift-light-brightness-value" for="shift-light-brightness" aria-live="polite">80%<\/output>/)
  assert.match(settingsHtml, /<button id="shift-light-brightness-reset" class="settings-button hud-opacity-reset" type="button" disabled>RESET<\/button>/)
  assert.match(settingsHtml, /id="shift-light-brightness" type="range" min="0" max="100" step="5" value="80" aria-labelledby="shift-light-brightness-title" aria-describedby="shift-light-brightness-hint"/)
  assert.match(settingsHtml, /<p id="shift-light-brightness-hint" class="shift-cue-hint" hidden>Turn on FDC SHIFT LIGHT to change its brightness\.<\/p>/)
  assert.doesNotMatch(settingsHtml, /class="brightness-scale"/)
  assert.match(settingsHtml, /<span class="calibration-label">LEARNED CEILING<\/span>/)
  assert.match(settingsHtml, /id="shift-light-usable-ceiling"/)
  assert.match(settingsHtml, /<dt>LEARNING<\/dt><dd>FDC is still learning this gear and shifts near the limiter\./)
  assert.match(settingsHtml, /<dt>READY<\/dt><dd>FDC has found where the next gear pulls harder and uses that shift point\.<\/dd>/)
  assert.doesNotMatch(settingsHtml, /<dt>POTENTIAL<\/dt>|<dt>OPTIMAL<\/dt>/)
  assert.match(settingsHtml, /checked by your clean full-throttle upshifts\./)
  // The redline and FDC cue values are sent in the set_display_preferences payload,
  // which configuration-shell.test.js pins.
})

test('FDC SHIFT LIGHT brightness and its RESET stay visible but disabled while the cue is off', () => {
  // Defaults and element wiring.
  assert.match(settingsJs, /const DEFAULT_SHIFT_LIGHT_BRIGHTNESS = displayPreferencesApi\?\.DEFAULTS\?\.shiftLightBrightness \?\? 80/)
  assert.match(settingsJs, /document\.getElementById\('shift-light-brightness-reset'\)/)
  assert.match(settingsJs, /document\.getElementById\('shift-light-brightness-group'\)/)
  assert.match(settingsJs, /document\.getElementById\('shift-light-brightness-hint'\)/)
  // Rendering: disabled = pending or cue off; RESET also disabled at the default; hint shown only while off.
  assert.match(settingsJs, /function renderShiftLightBrightness\(value, cueOn = displayPreferences\.fdcShiftLightEnabled !== false\)/)
  assert.match(settingsJs, /shiftLightBrightness\.disabled = displayPreferencesPending \|\| !cueOn\n/)
  assert.match(settingsJs, /shiftLightBrightnessReset\.disabled = displayPreferencesPending \|\| !cueOn \|\| isDefault\n/)
  assert.match(settingsJs, /shiftLightBrightnessReset\.classList\.toggle\('is-dirty', !isDefault\)/)
  assert.match(settingsJs, /shiftLightBrightnessGroup\.classList\.toggle\('is-inactive', !cueOn\)/)
  assert.match(settingsJs, /shiftLightBrightnessHint\.hidden = cueOn/)
  assert.match(settingsJs, /renderShiftLightBrightness\(preferences\.shiftLightBrightness, preferences\.fdcShiftLightEnabled !== false\)/)
  // Pending state must not re-enable the slider or RESET while the switch is off.
  assert.match(settingsJs, /const shiftLightCueOff = displayPreferences\.fdcShiftLightEnabled === false\n\s*shiftLightBrightness\.disabled = pending \|\| shiftLightCueOff\n/)
  assert.match(settingsJs, /shiftLightBrightnessReset\.disabled = pending \|\| shiftLightCueOff \|\| displayPreferences\.shiftLightBrightness === DEFAULT_SHIFT_LIGHT_BRIGHTNESS/)
  // RESET writes the default through the same preference path as the redline RESET.
  assert.match(settingsJs, /shiftLightBrightnessReset\.addEventListener\('click', \(\) => \{\n\s*void updateDisplayPreferences\(\n\s*\{ shiftLightBrightness: DEFAULT_SHIFT_LIGHT_BRIGHTNESS \},\n\s*next => `SHIFT LIGHT BRIGHTNESS RESET TO \$\{next\.shiftLightBrightness\}%`/)
  // The switch re-renders through updateDisplayPreferences, so the disabled state follows it.
  assert.match(settingsJs, /fdcShiftLightEnabled\?\.addEventListener\('click', \(\) => \{\n\s*const enabled = displayPreferences\.fdcShiftLightEnabled === false\n\s*void updateDisplayPreferences\(/)
})

test('Shift Light calibration card uses the design book title, table, and reset placement', () => {
  const profileIndex = settingsHtml.indexOf('id="shift-light-profile"')
  const gearRowsIndex = settingsHtml.indexOf('id="shift-light-gear-rows"')
  const exportIndex = settingsHtml.indexOf('id="shift-light-export"')
  const resetIndex = settingsHtml.indexOf('id="shift-light-reset"')

  assert.ok(profileIndex >= 0)
  assert.match(settingsHtml, /<div id="shift-light-profile" class="calibration-card" hidden>\s*<h3 class="calibration-card__title">CURRENT CAR PROFILE<\/h3>/)
  assert.match(settingsHtml, /class="events-run-table shift-light-gear-table"/)
  // The gear table has exactly three columns: GEAR, SHIFT AT and STATUS.
  assert.match(settingsHtml, /<thead>\s*<tr>\s*<th scope="col">GEAR<\/th>\s*<th scope="col">SHIFT AT<\/th>\s*<th scope="col" class="events-run-table__end">STATUS<\/th>\s*<\/tr>\s*<\/thead>\s*<tbody id="shift-light-gear-rows">/)
  assert.doesNotMatch(settingsHtml, /LAST COMPARISON|ACCEPTED SHIFTS/)
  assert.doesNotMatch(settingsHtml, /calibration-table/)
  assert.ok(gearRowsIndex > profileIndex)
  assert.ok(resetIndex > gearRowsIndex)
  // EXPORT DRIVES sits directly before the reset button and is a plain (not danger) button.
  assert.match(settingsHtml, /<\/table>\s*<\/div>\s*<\/div>\s*<button id="shift-light-export" class="settings-button" type="button" disabled hidden>\s*EXPORT DRIVES\s*<\/button>\s*<button id="shift-light-reset"[^>]*\bdisabled hidden>/)
  assert.ok(exportIndex > gearRowsIndex && exportIndex < resetIndex)
  assert.match(settingsJs, /'shift-light-profile'/)
  assert.match(settingsJs, /'shift-light-export'/)
  assert.match(settingsJs, /'export_shift_lab_drives'/)
  assert.match(settingsJs, /'shift-light-reset'/)
  assert.match(settingsJs, /\.hidden = !hasProfile/)
  assert.match(settingsJs, /\.scope = 'row'/)
  assert.match(settingsJs, /'events-run-table__end'/)
  assert.match(settingsJs, /colSpan = 3/)
  assert.doesNotMatch(settingsJs, /SHIFT AT LIMITER|PURPLE CUE ACTIVE|REDLINE FALLBACK/)
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
  assert.match(settingsJs, /\$\{readiness\} · \$\{formatRpm\(/)
  assert.doesNotMatch(settingsJs, /\$\{(state\.rpmMax|state\.usableCeiling|target|fallbackRpm)\} RPM/)
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
