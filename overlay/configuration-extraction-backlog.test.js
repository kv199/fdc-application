const test = require('node:test')
const assert = require('node:assert/strict')
const { readConfigurationScripts } = require('../tools/test-sources.cjs')

// Behavior that still lives inside overlay/settings.js and has no module API to
// call, so it can only be checked against the code text. These assertions pin
// internal names on purpose: when settings.js is split, move each rule into a
// module, replace its assertions here with a behavior test of that module, and
// delete the entry. The file should shrink to nothing.
const settingsJs = readConfigurationScripts()

test('Garage current car: variants toggle and cylinder fallback', () => {
  assert.match(settingsJs, /garageCurrentVariantsToggle\?\.addEventListener\('click', toggleGarageVariants\)/)
  assert.match(settingsJs, /garageCurrentVariantsToggle\.setAttribute\('aria-expanded', String\(open\)\)/)
})

test('Configuration tabs: only the active tab intro shows and the heading follows the active tab', () => {
  assert.match(settingsJs, /for \(const intro of settingsIntros\) intro\.hidden = intro\.dataset\.settingsIntro !== tabName/)
  assert.match(settingsJs, /const activeTab = settingsTabs\.find\(tab => tab\.dataset\.settingsTab === tabName\)/)
  assert.match(settingsJs, /settingsTitle\.textContent = activeTab\?\.textContent\.trim\(\) \|\| context/)
})

test('Connection guide: the header status opens it, startup decides it after the Garage snapshot, and a status change re-renders it', () => {
  assert.match(settingsJs, /telemetryStatusButton\?\.addEventListener\('click', openConnectionGuide\)/)
  assert.match(settingsJs, /function openConnectionGuide\(\) \{[\s\S]*?connectionGuideOpen = true[\s\S]*?renderConnectionGuide\(\)/)
  assert.match(settingsJs, /applyGaragePayload\(await call\('load_garage_snapshot'\)\)[\s\S]*?openConnectionGuideIfNeverConnected\(\)/)
  assert.match(settingsJs, /telemetryStatusLabel\.textContent = presentation\.statusLabel\s*renderConnectionGuide\(\)/)
})

test('Settings: a rejected display preference write restores the previous preferences', () => {
  assert.match(settingsJs, /displayPreferences = previous\s*displayPreferencesApi\.write\(previous\)\s*renderDisplayPreferences\(previous\)/)
})

test('Quit: the question appears while Driver Analysis or an Event is recording', () => {
  assert.match(settingsJs, /driverAnalysisState\.recording === true \|\| recorderState\.recording === true/)
})

test('Units: a speed or distance unit change re-renders every unit-dependent view', () => {
  assert.match(settingsJs, /renderDriverAnalysisHistory\(\)/)
  assert.match(settingsJs, /renderDriverAnalysisView\(\)/)
  assert.match(settingsJs, /function renderUnitDependentViews\(\) \{[\s\S]*?renderEventRunDetail\(currentEventRun\)/)
  assert.match(settingsJs, /unitsChanged = previous\.speedUnit !== next\.speedUnit \|\| previous\.distanceUnit !== next\.distanceUnit/)
  assert.match(settingsJs, /if \(unitsChanged\) \{\s*renderUnitDependentViews\(\)/)
})

test('HUD DISPLAY: the monitor list is disabled with one monitor or during a layout edit', () => {
  assert.match(settingsJs, /hudDisplay\.disabled = hudDisplayCount <= 1 \|\| Boolean\(editingTarget\)/)
})

test('HUD opacity: RESET is disabled while saving or at the default', () => {
  assert.match(settingsJs, /hudOpacityReset\.disabled = pending \|\| displayPreferences\.hudOpacity === DEFAULT_HUD_OPACITY/)
})

test('Help menu: the menu opens from its button and is driven by the keyboard', () => {
  assert.match(settingsJs, /toggleHelpMenu/)
  assert.match(settingsJs, /handleHelpMenuKeydown/)
})

test('HUD edit hotkey: the stored hotkey is registered at startup', () => {
  assert.match(settingsJs, /void setHudEditHotkey\(hudEditHotkeySettings\.hotkey, false, hudEditHotkeySettings\.hotkeyLabel\)/)
})

test('WIDGETS: the Shift Bar is read from storage, counted by ALL and ANY, and toggled only on change', () => {
  assert.match(settingsJs, /function readOverlayVisibility\(\)[\s\S]*?isOverlayComponentOn\(stored, name\)/)
  assert.match(settingsJs, /function allWidgetsOn\(\) \{[\s\S]*?overlayVisibility\.shiftBar === true/)
  assert.match(settingsJs, /function anyWidgetOn\(\) \{[\s\S]*?overlayVisibility\.shiftBar === true/)
  assert.match(settingsJs, /if \(\(overlayVisibility\.shiftBar === true\) !== next\) \{\s*await setOverlayComponentVisibility\('shiftBar', next\)/)
})

test('Shift Light: the car class and PI come from the car key, and RPM labels follow the learning state', () => {
  assert.match(settingsJs, /state\.carKey\.split\(':'\)\[2\]/)
  assert.match(settingsJs, /appendGaragePerformance\(shiftLightCarPi, \{ classLabel, pi \}\)/)
  assert.match(settingsJs, /\? `\$\{formatRpm\(state\.usableCeiling\)\} · \$\{state\.ceilingClusterCount\}\/3`/)
  assert.match(settingsJs, /: state\.ceilingSampleCount > 0 \? `LEARNING · \$\{state\.ceilingClusterCount\}\/3`/)
  assert.match(settingsJs, /· \$\{formatRpm\(activeTarget\)\}`/)
  assert.match(settingsJs, /LEARNING · \$\{formatRpm\(fallbackTarget\)\}`/)
})

test('Driver Analysis: single-car recordings show the recording summary, Escape leaves drill-downs, and actions keep their order', () => {
  assert.match(settingsJs, /recording\.sessions\.length === 1/)
  assert.match(settingsJs, /recording\.sessions\.length === 1\s*\n\s*\? globalScope\.DriverAnalysisHistory\?\.recordingSummary/)
  assert.match(settingsJs, /isDriverAnalysisPanelVisible && driverAnalysisTab\.getView\(\)\.level !== 'history'/)
  assert.match(settingsJs, /actions\.append\(detailsButton\)[\s\S]*actions\.append\(exportButton, remove\)/)
})

test('Driver Analysis: BACK names the parent level', () => {
  assert.match(settingsJs, /DRIVER_ANALYSIS_BACK_LABELS\[driverAnalysisParentLevel\(next\)\]/)
  assert.match(settingsJs, /driverAnalysisDetailBack\.textContent = label\.text/)
  assert.match(settingsJs, /driverAnalysisDetailBack\.setAttribute\('aria-label', label\.ariaLabel\)/)
})

test('Events library: closing a filled create form asks first, and card badges keep their order', () => {
  assert.match(settingsJs, /function eventCreateFormHasContent\(\)/)
  assert.match(settingsJs, /function requestEventsCreateClose\(\)/)
  assert.match(settingsJs, /if \(eventsView === 'library' && eventsCreateOpen\)/)
  assert.doesNotMatch(settingsJs, /function renderEventDetail\([^]*renderEventCard\(event, true\)/)
  assert.match(settingsJs, /eventRunLapSortDirection = 'desc'/)
  assert.match(settingsJs, /meta\.append\(mode, route, eventClass\)/)
  assert.doesNotMatch(settingsJs, /textContent = `#\$\{/)
})

test('Event recorder: status, button state, warning tone, and local time', () => {
  assert.match(settingsJs, /eventRecorderStatus\.hidden = !recording && !finalizing/)
  assert.match(settingsJs, /eventRecorderToggle\.disabled = recordingAnotherEvent \|\| finalizing/)
  assert.match(settingsJs, /eventRecorderHint\.dataset\.tone = !recordingAnotherEvent && !finalizing \? 'warning' : ''/)
  assert.match(settingsJs, /getHours\(\).*getMinutes\(\).*getSeconds\(\)/s)
})

test('Event lap rows: pedal shares are weighted by time and only one lap is expanded', () => {
  assert.doesNotMatch(settingsJs, /function renderTraceStats/)
  assert.match(settingsJs, /if \(expandedEventRunLap !== null\)/)
  assert.doesNotMatch(settingsJs, /function placeTooltip/)
})

test('Event runs: the live run, approximate results, and a refresh of the open run', () => {
  assert.match(settingsJs, /if \(recorderState\.recording === true && recorderState\.savedRunId === run\.id\) \{/)
  assert.match(settingsJs, /resultTimeApproximate: source\.resultTimeApproximate === true \|\| source\.result_time_approximate === true/)
  assert.match(settingsJs, /return 'Approximate: last live race time before Forza cleared telemetry'/)
  assert.match(settingsJs, /bestTime\.title = approximateRunResultTitle\(\)/)
  assert.match(settingsJs, /renderRunTimeCell\(lap\.timeMs, lapRanks, isApproximateRunResult\(run, lap\.timeMs\)\)/)
  assert.match(settingsJs, /if \(currentEventRun\?\.id === run\.id && eventsView === 'run'\) void refreshOpenEventRun\(run\.id\)/)
  assert.match(settingsJs, /async function refreshOpenEventRun\(id\) \{/)
})

test('Event lap maps: sector focus, legend labels, hover range, and fit state', () => {
  const driveMap = settingsJs.slice(settingsJs.indexOf('async function loadDriverAnalysisDriveMap'), settingsJs.indexOf('async function loadDriverAnalysisHistory'))
  assert.match(driveMap, /return renderTraceMap\(points, Number\(drive\?\.durationMs\)/)
  assert.doesNotMatch(driveMap, /sectorFocus|fullLabel|onSectorChange|initialSector/)
  assert.match(settingsJs, /if \(sectorFocus\) \{\s*map\.append\(renderTraceUnavailable\(\)\)/)
  assert.match(settingsJs, /legendLabel\.textContent = `SECTOR \$\{focusedSector\} INPUT TIME`/)
  assert.match(settingsJs, /legendLabel\.textContent = `\$\{scopeWord\} INPUT TIME`/)
  assert.match(settingsJs, /focused\.outline, \.\.\.\(focused\.slip \? \[focused\.slip\] : \[\]\), \.\.\.focused\.pedals/)
  assert.match(settingsJs, /const hoverIndex = \(x, y, reach\) => \{/)
  assert.match(settingsJs, /\?\? hoverIndex\(x, y, hoverReach\(\)\) \?\? null/)
  assert.match(settingsJs, /if \(sectorFitted\) map\.resetZoom\(\)/)
  assert.match(settingsJs, /const setView = \(next, fitted = false\) => \{/)
  assert.match(settingsJs, /map\.zoomToBounds = \(bounds, paddingPx = 24\) => fitToBounds\(bounds, paddingPx, false\)/)
})

test('Event Theoretical Best: incomplete sectors, shared car, collapse, and stale responses', () => {
  assert.match(settingsJs, /row\.disabled = !timed/)
  assert.match(settingsJs, /action\.textContent = timed \? 'VIEW SECTOR' : 'UNAVAILABLE'/)
  assert.match(settingsJs, /if \(!shared\) \{[\s\S]*?car\.className = 'events-theory__car'/)
  assert.match(settingsJs, /eventsTheorySharedCar\.hidden = !shared/)
  assert.match(settingsJs, /eventsTheorySectors\.hidden = !eventTheoryOpen/)
  assert.match(settingsJs, /event_recorder_run_saved[\s\S]{0,500}void loadEventTheoreticalBest\(\)/)
  assert.match(settingsJs, /const sequence = \+\+eventTheoryRequestSequence/)
  assert.match(settingsJs, /if \(sequence !== eventTheoryRequestSequence \|\| eventKey\(currentEventId\) !== key\) return/)
  assert.match(settingsJs, /void loadEventTheoreticalBest\(key\)/)
})

test('Event run page: Theoretical Best total, sector cells, source context, and focus restore', () => {
  assert.match(settingsJs, /const total = runBestHypotheticalTimeMs\(run\)/)
  assert.match(settingsJs, /button\.disabled = !Number\.isFinite\(sectorTimeMs\)/)
  assert.match(settingsJs, /cell\.classList\.toggle\('is-sector-focus', expanded && expandedEventRunSector === sectorNumber\)/)
  assert.match(settingsJs, /initialSector: expandedEventRunSector/)
  assert.match(settingsJs, /if \(source\) focusEventRunSector\(sourceLap, source\.sector\)/)
  assert.match(settingsJs, /eventRunSource = sourceLap !== null \? \{ runId: key, lapNumber: sourceLap \} : null/)
  assert.match(settingsJs, /eventsRunSourceContext\.hidden = !visible/)
  const selectCell = settingsJs.slice(settingsJs.indexOf('function selectEventRunSector('), settingsJs.indexOf('function setEventRunSectorFocus('))
  assert.match(selectCell, /eventRunSource = null/)
  assert.match(settingsJs, /const focusKey = eventsRunLaps\?\.contains\(active\) \? active\.dataset\.focusKey \|\| null : null/)
  assert.match(settingsJs, /if \(focusKey\) eventsRunLaps\?\.querySelector\(`\[data-focus-key="\$\{focusKey\}"\]`\)\?\.focus\(\{ preventScroll: true \}\)/)
})

test('Event run page: Escape clears a sector, then collapses the lap, then returns to the Event', () => {
  const start = settingsJs.indexOf("if (eventsView === 'run') {\n      event.preventDefault()")
  assert.ok(start > 0, 'run Escape branch')
  const branch = settingsJs.slice(start, settingsJs.indexOf("if (eventsView === 'detail')", start))
  const sector = branch.indexOf('expandedEventRunSector !== null')
  const lap = branch.indexOf('expandedEventRunLap !== null')
  const back = branch.indexOf('closeEventRun()')
  assert.ok(sector >= 0 && lap > sector && back > lap)
  assert.match(branch, /eventRunLapMap\?\.focusSector\?\.\(null\)/)
  assert.match(branch, /syncEventRunSectorFocus\(\)/)
})
