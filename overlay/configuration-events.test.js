const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { readResolvedStylesheet } = require('../tools/stylesheet-tokens.cjs')
const { readConfigurationScripts } = require('../tools/test-sources.cjs')

const settingsHtml = fs.readFileSync(path.join(__dirname, 'settings.html'), 'utf8')
const settingsCss = readResolvedStylesheet('settings.css')
// Interface roles are asserted by token; preserved meanings (modes, classes, map layers) by value.
const settingsStyles = fs.readFileSync(path.join(__dirname, 'settings.css'), 'utf8')
// All scripts of the Configuration page, whichever files hold them (settings.js may be split).
const settingsJs = readConfigurationScripts()

// The first rule for a selector in the source stylesheet, so the assertion reads one declaration block.
function settingsCssFor(selector) {
  const start = settingsStyles.indexOf(`${selector} {`)
  if (start < 0) return ''
  return settingsStyles.slice(start, settingsStyles.indexOf('}', start) + 1)
}

// Local scripts of the Configuration page in document order.
const pageScriptOrder = [...settingsHtml.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)]
  .map(match => match[1])
  .filter(src => !/^(https?:)?\/\//i.test(src))

// A page script that refers to a shared module's global must load after the module that defines it.
function assertLoadsBeforeUsers(moduleSrc, globalName) {
  const moduleIndex = pageScriptOrder.indexOf(moduleSrc)
  assert.ok(moduleIndex >= 0, `the Configuration page loads ${moduleSrc}`)
  const users = pageScriptOrder.filter(src => src !== moduleSrc
    && fs.readFileSync(path.join(__dirname, src), 'utf8').includes(globalName))
  assert.ok(users.length > 0, `a page script uses ${globalName}`)
  for (const src of users) {
    assert.ok(pageScriptOrder.indexOf(src) > moduleIndex, `${src} uses ${globalName} and must load after ${moduleSrc}`)
  }
}

test('Events keeps the existing navigation and exposes the create/detail flow', () => {
  assert.match(settingsHtml, /id="events-tab"[^>]+data-settings-tab="events"/)
  assert.match(settingsHtml, /id="events-panel"[^>]+data-settings-panel="events"/)
  assert.match(settingsHtml, /id="events-grid"[^>]+aria-live="polite"/)
  assert.match(settingsHtml, /id="events-create-toggle"[^>]+aria-controls="events-create-area"/)
  assert.match(settingsHtml, /id="events-create-area"[^>]+hidden/)
  assert.ok(settingsHtml.indexOf('id="events-create-area"') < settingsHtml.indexOf('id="events-grid"'))
  assert.match(settingsHtml, /id="events-discard-dialog"[^>]+role="alertdialog"[^>]+hidden/)
  assert.match(settingsHtml, /id="events-discard-yes"[^>]*>YES<\/button>/)
  assert.match(settingsHtml, /id="events-discard-no"[^>]*>NO<\/button>/)
  for (const id of ['event-name', 'event-class', 'event-route-type', 'event-mode', 'event-notes']) {
    assert.match(settingsHtml, new RegExp(`id="${id}"`))
  }
  const formStart = settingsHtml.indexOf('id="events-create-form"')
  const formEnd = settingsHtml.indexOf('</form>', formStart)
  const eventsForm = settingsHtml.slice(formStart, formEnd)
  assert.ok(eventsForm.indexOf('id="event-name"') < eventsForm.indexOf('id="event-mode"'))
  assert.ok(eventsForm.indexOf('id="event-mode"') < eventsForm.indexOf('id="event-route-type"'))
  assert.ok(eventsForm.indexOf('id="event-route-type"') < eventsForm.indexOf('id="event-class"'))
  assert.ok(eventsForm.indexOf('id="event-class"') < eventsForm.indexOf('id="event-notes"'))
  assert.match(settingsHtml, /id="events-detail-view"[^>]+hidden/)
  assert.match(settingsHtml, /id="events-detail-back"[^>]*class="detail-back"[^>]*>← EVENTS<\/button>/)
  assert.match(settingsHtml, /id="events-detail-title"/)
  assert.match(settingsHtml, /id="events-detail-summary"[^>]+aria-label="Event details"/)
  assert.match(settingsHtml, /id="events-detail-notes"[^>]+hidden/)
  assert.doesNotMatch(settingsHtml, /events-detail-absolute-best|ABSOLUTE BEST/)
  assert.match(settingsHtml, /id="events-theory-time" class="events-theory__time"/)
  assert.doesNotMatch(settingsHtml, /id="events-detail-hint"|id="events-detail-card"|id="events-detail-metadata"/)
  assert.doesNotMatch(settingsHtml, /id="events-detail-archive"/)
  assert.match(settingsHtml, /id="events-detail-delete"/)
  assert.match(settingsHtml, /id="events-run-view"[^>]+hidden/)
  assert.match(settingsHtml, /id="events-run-back"[^>]*class="detail-back"[^>]*>← EVENT<\/button>/)
  assert.match(settingsHtml, /id="events-run-title"/)
  assert.match(settingsHtml, /id="events-run-summary"[^>]+aria-label="Event details"/)
  assert.match(settingsHtml, /id="events-run-theory-time" class="events-theory__time"/)
  assert.doesNotMatch(settingsHtml, /events-run-bht|BEST HYPOTHETICAL TIME/)
  assert.match(settingsHtml, /id="events-run-lap-sort"[^>]+aria-sort="descending"/)
  assert.match(settingsHtml, /id="events-run-laps"/)
  assert.match(settingsJs, /call\('create_event',/)
  assert.match(settingsJs, /route: \w+\.value/)
  assert.match(settingsJs, /call\('load_events'\)/)
  assert.match(settingsJs, /call\('load_event'/)
  assert.match(settingsJs, /call\('rename_event'/)
  assert.match(settingsJs, /call\('rename_event', \{ eventId: \w+\(event\.id\), name \}\)/)
  assert.doesNotMatch(settingsJs, /archive_event|archiveCurrentEvent|archived_at/)
  assert.match(settingsJs, /call\('delete_event'/)
  assert.match(settingsJs, /call\('delete_event', \{ eventId: \w+\(event\.id\) \}\)/)
  assert.match(settingsJs, /`Delete event /)
  assert.match(settingsJs, /'Reset the calibration of the current car\?/)
  assert.match(settingsJs, /CALIBRATION NOT RESET/)
  assert.match(settingsJs, /events-detail-view__title-input/)
  assert.match(settingsJs, /events-detail-view__badge--id/)
  assert.match(settingsJs, /events-detail-view__badge--mode/)
  assert.match(settingsJs, /events-detail-view__badge--class/)
  assert.match(settingsJs, /\.hidden = !\w+\.notes\b/)
  assert.doesNotMatch(settingsJs, /renderEventCard\(event, true\)/)
  assert.doesNotMatch(settingsJs, /load_event_absolute_best|eventsDetailAbsoluteBest|currentEventAbsoluteBestMs|event_recorder_reference/)
  assert.match(settingsJs, /call\('load_event_theoretical_best', \{ eventId: \w+ \}\)/)
  assert.doesNotMatch(settingsJs, /events-card__image/)
  assert.doesNotMatch(settingsJs, /copyEventId|events-card__copy/)
  assert.match(settingsJs, /EventTheoreticalBest\.normalizeSectors\(/)
  assert.match(settingsJs, /LAST /)
  assert.match(settingsJs, /'aria-sort'/)
  assert.match(settingsJs, /dataset\.tone = /)
  assert.match(settingsCss, /\.settings-tabs\s*\{[\s\S]*grid-template-columns:\s*repeat\(6,/)
  assert.match(settingsCss, /\.events-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(auto-fit/)
  assert.match(settingsCss, /\.events-card__id\s*\{[\s\S]*font-size:\s*28px/)
  assert.match(settingsStyles, /\.confirm-dialog \.confirm-dialog__no\s*\{[^}]*background:\s*var\(--accent\)/)
  assert.match(settingsStyles, /\.confirm-dialog \.settings-button\.confirm-dialog__yes:not\(:disabled\):hover[^{]*\{[^}]*background:\s*var\(--danger\)/)
  assert.doesNotMatch(settingsCss, /events-card__image/)
  assert.doesNotMatch(settingsCss, /events-card__copy/)
  assert.match(settingsCss, /\.events-card\[data-event-mode="any"\][\s\S]*#f97316/)
  assert.match(settingsCss, /\.events-card\[data-event-mode="rivals"\][\s\S]*#7dd3fc/)
  assert.match(settingsCss, /\.events-card\[data-event-mode="online"\][\s\S]*#facc15/)
  assert.match(settingsCss, /\.events-card\[data-event-mode="eventlab"\][\s\S]*#ffffff/)
  assert.match(settingsCss, /\.events-card\[data-event-mode="official"\][\s\S]*#ef4444/)
  assert.match(settingsCss, /\.events-card\[data-event-mode="blueprint"\][\s\S]*#c084fc/)
  assert.match(settingsJs, /events-card__badge--class/)
  assert.match(settingsCss, /\.events-card__badge--class\[data-event-class="B"\][\s\S]*#f97316/)
  assert.match(settingsCss, /\.events-detail-view__badge--class\[data-event-class="A"\][\s\S]*#ef4444/)
  assert.match(settingsCss, /\.events-detail-view__badge--class\[data-event-class="S1"\][\s\S]*#c084fc/)
  assert.match(settingsStyles, /\.events-run-table__time\[data-tone="best"\]\s*\{[^}]*var\(--best\)/)
  assert.match(settingsStyles, /\.events-run-table__time\[data-tone="second"\]\s*\{[^}]*var\(--accent-ink\)/)
  assert.match(settingsStyles, /\.events-theory__time\s*\{[^}]*var\(--best\)/)
})

test('Event recorder uses the compact idle control and local run timestamps', () => {
  assert.doesNotMatch(settingsHtml, /event-recorder__eyebrow|RUN CAPTURE/)
  assert.match(settingsHtml, /id="event-recorder-status"[^>]+hidden/)
  assert.match(settingsHtml, /id="event-recorder-toggle"[^>]*>RECORD RUN<\/button>/)
  assert.match(settingsHtml, /class="event-recorder__title">\s*<h3 id="event-recorder-title">RECORD RUNS<\/h3>\s*<p id="event-recorder-hint"/)
  // Toggle captions for idle, recording and finalizing, and the classes and state it sets.
  assert.match(settingsJs, /'FINALIZING'/)
  assert.match(settingsJs, /'STOP'/)
  assert.match(settingsJs, /'RECORD RUN'/)
  assert.match(settingsJs, /'settings-button--danger'/)
  assert.match(settingsJs, /'event-recorder__record'/)
  assert.match(settingsJs, /'aria-pressed'/)
  assert.match(settingsHtml, /data-tone="warning"[^>]*>Sprint: keep recording armed between attempts, then press STOP\.<\/p>/)
  assert.match(settingsJs, /Sprint: keep recording armed between attempts, then press STOP\./)
  assert.match(settingsJs, /dataset\.tone = [^\n]*'warning'/)
  assert.match(settingsStyles, /\.event-recorder__hint\[data-tone="warning"\]\s*\{[^}]*var\(--notice\)/)
  // Run timestamps are read with the local date getters, never the UTC ones.
  assert.match(settingsJs, /getFullYear\(\)/)
  assert.doesNotMatch(settingsJs, /getUTC(?:FullYear|Month|Date|Hours|Minutes|Seconds)\(/)
  assert.match(settingsStyles, /\.event-recorder\s*\{[^}]*border: 1px solid var\(--line\);[^}]*background: var\(--surface\)/)
  assert.match(settingsStyles, /\.event-recorder__record\s*\{[^}]*background: var\(--accent\)/)
  assert.match(settingsStyles, /\.settings-button--danger\s*\{[^}]*color: var\(--danger-text\)/)
})

test('Events expose deterministic persisted list sorting and in-memory run sorting', () => {
  assert.match(settingsHtml, /id="events-sort"[^>]+aria-label="Sort events"/)
  assert.deepEqual(
    [...settingsHtml.matchAll(/<option value="([^"]+)">/g)].map(match => match[1]).filter(value => value.includes('recorded') || value.startsWith('id-')),
    ['id-desc', 'id-asc', 'last-recorded-desc', 'last-recorded-asc']
  )
  assert.match(settingsJs, /'fdc\.events-sort\.v1'/)
  assert.match(settingsJs, /localStorage\.getItem\(\w+\)/)
  assert.match(settingsJs, /localStorage\.setItem\(\w+, JSON\.stringify\(/)
  assert.match(settingsJs, /\{ key: 'date', direction: 'desc' \}/)
  assert.match(settingsHtml, /data-run-sort="id"/)
  assert.match(settingsHtml, /data-run-sort="best"/)
  assert.match(settingsHtml, /<th scope="col" class="events-run-table__end">LAPS<\/th>/)
  assert.match(settingsHtml, /data-run-sort="date"/)
  const bestHeader = settingsHtml.indexOf('data-run-sort="best"')
  const lapsHeader = settingsHtml.indexOf('<th scope="col" class="events-run-table__end">LAPS</th>')
  const dateHeader = settingsHtml.indexOf('data-run-sort="date"')
  assert.ok(bestHeader < lapsHeader && lapsHeader < dateHeader)
  assert.match(settingsJs, /`Open run \$\{run\.id\}, /)
  assert.match(settingsJs, /'lap' : 'laps'/)
  assert.match(settingsJs, /runType === 'sprint'/)
  assert.match(settingsJs, /call\('load_event_runs'/)
  assert.match(settingsHtml, /id="event-runs-table" class="events-run-table-wrap"/)
  assert.match(settingsHtml, /<tbody id="event-runs-list"><\/tbody>/)
  assert.doesNotMatch(settingsHtml + settingsJs, /event-run-row/)
  assert.match(settingsJs, /events-run-table__end/)
  // As in the design book, BEST shows only the time, without the best lap or SPRINT.
  assert.doesNotMatch(settingsJs + settingsCss, /events-run-table__note|events-run-table__split/)
  assert.doesNotMatch(settingsHtml, /class="events-run-table__end"><button class="events-run-table__sort" type="button" data-run-sort="best"/)
  assert.doesNotMatch(settingsJs, /`#\$\{/)
  assert.doesNotMatch(settingsJs, /DRIVE #/)
})

test('Event lap rows expose trace details and time-weighted pedal statistics', () => {
  assert.match(settingsHtml, /events-run-table__caption[^>]*>Select a lap row to view its trace and pedal statistics\.<\/caption>/)
  // Trace points accept camelCase and snake_case position fields.
  assert.match(settingsJs, /position_x/)
  assert.match(settingsJs, /position_z/)
  assert.doesNotMatch(settingsJs, /TRACE · X \/ Z/)
  assert.match(settingsJs, /events-lap-detail__trace--\$\{/)
  assert.match(settingsJs, /EventTraceMap\?\.nextLayerSelection/)
  assert.match(settingsJs, /sectorFocus: true,/)
  assert.match(settingsJs, /className = 'events-lap-detail'/)
  assert.match(settingsJs, /EventTraceMap\?\.pedalState/)
  assert.match(settingsJs, /EventTraceMap\?\.groupRuns/)
  assert.match(settingsJs, /events-lap-detail__sector-tick/)
  assert.match(settingsJs, /events-lap-detail__stat--\$\{key\}/)
  assert.match(settingsJs, /setAttribute\('aria-expanded'/)
  assert.match(settingsJs, /call\('load_event_run', \{ runId: \w+ \}\)/)
  assert.match(settingsCss, /\.events-lap-detail\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\);/)
  assert.match(settingsCss, /\.events-lap-detail__trace\s*\{[\s\S]*stroke-width: calc\(2\.4 \* var\(--map-k, 1\)\);/)
  assert.match(settingsCss, /\.events-lap-detail__trace--throttle\s*\{\s*stroke: #69e83f;/)
  assert.match(settingsCss, /\.events-lap-detail__trace--brake\s*\{\s*stroke: #ef4444;/)
  assert.match(settingsCss, /\.events-lap-detail__trace--coast\s*\{\s*stroke: #facc15;/)
  assert.match(settingsStyles, /\.events-lap-detail__sector-tick\s*\{\s*stroke: var\(--text\);/)
  assert.match(settingsStyles, /\.events-lap-detail__sector-label\s*\{\s*fill: var\(--text\);/)
  assert.match(settingsCss, /\.events-lap-detail__legend\s*\{/)
  assert.match(settingsCss, /\.events-lap-detail__svg\s*\{[\s\S]*max-height: 560px;/)
  // Zoom and pan: the trace map script loads before the page scripts that use it, the controls are the three buttons,
  // and the wheel listener must be able to cancel the page scroll.
  assertLoadsBeforeUsers('trace-map-zoom.js', 'TraceMapZoom')
  assert.match(settingsJs, /globalThis\.TraceMapZoom/)
  assert.match(settingsJs, /'\+', 'Zoom in'/)
  assert.match(settingsJs, /'−', 'Zoom out'/)
  assert.match(settingsJs, /'FIT', 'Show whole lap'/)
  assert.match(settingsJs, /'events-lap-detail__zoom-button'/)
  assert.match(settingsJs, /'events-lap-detail__canvas'/)
  assert.match(settingsJs, /addEventListener\('wheel'[\s\S]*?preventDefault\(\)[\s\S]*?\{ passive: false \}\)/)
  assert.match(settingsJs, /setAttribute\('viewBox'/)
  assert.match(settingsCss, /\.events-lap-detail__zoom\s*\{[\s\S]*position: absolute;[\s\S]*right: 10px;/)
  assert.match(settingsCss, /\.events-lap-detail__zoom-button:disabled\s*\{/)
  assert.match(settingsCss, /\.events-lap-detail__svg\.is-zoomed\s*\{\s*cursor: grab;/)
  assert.match(settingsCss, /\.events-lap-detail__svg\.is-panning\s*\{\s*cursor: grabbing;/)
  // Sector ticks and labels are sized in screen pixels through --map-sector-k.
  assert.match(settingsCss, /\.events-lap-detail__sector-tick\s*\{[^}]*stroke-width: calc\(2 \* var\(--map-sector-k, var\(--map-k, 1\)\)\);/)
  assert.match(settingsCss, /\.events-lap-detail__sector-label\s*\{[^}]*font-size: calc\(13px \* var\(--map-sector-k, var\(--map-k, 1\)\)\);/)
  assert.match(settingsCss, /\.events-lap-detail__sector-label\s*\{[^}]*font-weight: 600;[^}]*letter-spacing: 0\.06em;/)
  assert.match(settingsStyles, /\.events-lap-detail__sector-label\s*\{[^}]*stroke: var\(--map-canvas\);[^}]*stroke-width: calc\(3px \* var\(--map-sector-k, var\(--map-k, 1\)\)\);[^}]*paint-order: stroke;/)
  assert.match(settingsJs, /--map-sector-k/)
  assert.match(settingsJs, /new ResizeObserver\(/)
  assert.doesNotMatch(settingsCss, /\.events-lap-detail__sector-label\s*\{[^}]*font-size: calc\(9px/)
  assert.doesNotMatch(settingsCss, /\.events-lap-detail__tooltip\s*\{/)
  assert.doesNotMatch(settingsJs, /placeTooltip/)
  assert.match(settingsJs, /events-lap-detail__map-layout/)
  assert.match(settingsJs, /events-lap-detail__inspector/)
  assert.match(settingsJs, /'POINT DATA'/)
  assert.match(settingsJs, /aria-live/)
  assert.match(settingsStyles, /\.events-lap-detail__map-layout\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) 300px;/)
  // The panel groups its values: a large DIST/TIME lead, two value columns, and notes at the foot.
  assert.match(settingsJs, /events-lap-detail__point-lead/)
  assert.match(settingsJs, /events-lap-detail__point-metrics/)
  assert.match(settingsJs, /events-lap-detail__point-notes/)
  assert.match(settingsStyles, /@media \(max-width: 760px\) \{[^@]*?\.events-lap-detail__map-layout\s*\{/)
  assert.doesNotMatch(settingsJs, /events-lap-detail__stat-key/)
  assert.match(settingsCss, /\.events-run-view__metric\s*\{[\s\S]*align-items: center;/)
})

test('Event run list marks the live run and the approximate sprint result', () => {
  assert.match(settingsJs, /payload\.savedRunId/)
  assert.match(settingsJs, /\.recording === true && \w+\.savedRunId === run\.id/)
  assert.match(settingsJs, /className = 'events-run-live'/)
  assert.match(settingsJs, /'LIVE'/)
  assert.match(settingsStyles, /\.events-run-live \{\s*margin-left: 8px;\s*color: var\(--accent-ink\);\s*font-size: 11px;\s*letter-spacing: 0\.08em;\s*\}/)
  assert.match(settingsJs, /resultTimeApproximate: /)
  assert.match(settingsJs, /result_time_approximate === true/)
  assert.match(settingsJs, /`~\$\{/)
  assert.match(settingsJs, /`RESULT /)
  assert.match(settingsJs, /'Approximate: last live race time before Forza cleared telemetry'/)
  assert.match(settingsJs, /\.title = [^\n]*approximate/i)
})

test('Events lap maps offer sector focus and Driver Analysis drive maps do not', () => {
  // Sector focus is opt-in: options.sectorFocus turns it on, and only the Events lap map passes it.
  assert.match(settingsJs, /options\.sectorFocus === true/)
  assert.equal((settingsJs.match(/sectorFocus: true/g) || []).length, 1, 'only one call site turns sector focus on')
  // Public contract for the Events page: options in, focusSector and getSectorFocus out.
  assert.match(settingsJs, /options\.onSectorChange\?\.\(/)
  assert.match(settingsJs, /options\.initialSector/)
  assert.match(settingsJs, /options\.fullLabel \|\| 'FULL LAP'/)
  assert.match(settingsJs, /\.focusSector = /)
  assert.match(settingsJs, /\.getSectorFocus = /)
  // The empty trace shows the legacy state in place of the old text when sector focus is on.
  assert.match(settingsJs, /'TRACE UNAVAILABLE'/)
  assert.match(settingsJs, /'Sector times are saved\. This older lap has no recorded trace\.'/)
  // Controls row, focus group, and the classes the dimming and visibility rules use.
  for (const className of [
    'events-lap-detail__tools',
    'events-lap-detail__sector-controls',
    'events-lap-detail__sector-button',
    'events-lap-detail__clear-focus',
    'events-lap-detail__fit-sector',
    'events-lap-detail__distance',
    'events-lap-detail__legend-label',
    'events-lap-detail__unavailable',
    'events-lap-detail__focus',
    'events-lap-detail__layer--dimmed',
    'events-lap-detail__layer--hidden'
  ]) assert.match(settingsJs, new RegExp(className))
  assert.match(settingsJs, /'FULL RUN' \? 'RUN' : 'LAP'/)
  assert.match(settingsJs, /`SECTOR \$\{\w+\} INPUT TIME`/)
  assert.match(settingsJs, /\} INPUT TIME`/)
  // Layers are listed in the legend in the order throttle, brake, coast, slip.
  assert.match(settingsJs, /'THROTTLE'[\s\S]*'BRAKE'[\s\S]*'COAST'[\s\S]*'SLIP'/)
  // Scoped shares come from the pure helper; the last sector takes the final flag.
  assert.match(settingsJs, /EventTraceMap\?\.sectorTimeShares\([\s\S]*?\{ final: \w+ === 3 \}/)
  // FIT SECTOR fits the sector's bounds with 24 px padding; SHOW FULL ROUTE resets.
  assert.match(settingsJs, /'SHOW FULL ROUTE'/)
  assert.match(settingsJs, /'FIT SECTOR'/)
  assert.match(settingsJs, /, 24, true\)/)
  assert.match(settingsJs, /\.resetZoom\(\)/)
  assert.match(settingsJs, /\.zoomToBounds = /)
  assert.match(settingsJs, /\.fitBoundsPx\(/)
  // Sector ticks and focus share one boundary search.
  assert.match(settingsJs, /EventTraceMap\?\.sectorBoundaries\(/)
  // Dimming and visibility rules for the whole lap under a focused sector.
  assert.match(settingsStyles, /\.events-lap-detail__outline-group\.events-lap-detail__layer--dimmed \{ opacity: 0\.16; \}/)
  assert.match(settingsStyles, /\.events-lap-detail__pedal-group\.events-lap-detail__layer--dimmed \{ opacity: 0\.12; \}/)
  assert.match(settingsStyles, /\.events-lap-detail__slip-group\.events-lap-detail__layer--hidden \{ display: none; \}/)
  // Pressed sector takes the lime accent, as in the design book.
  assert.match(settingsStyles, /\.events-lap-detail__sector-button\[aria-pressed="true"\] \{\s*border-color: var\(--accent-edge\);\s*color: var\(--text-on-accent\);\s*background: var\(--accent\);/)
  assert.match(settingsStyles, /\.events-lap-detail__clear-focus\[hidden\],\s*\.events-lap-detail__fit-sector\[hidden\] \{\s*display: none;/)
  // The caption and FIT SECTOR use the HUD roles, so they read on the dark route canvas in both themes.
  assert.match(settingsStyles, /\.events-lap-detail__distance \{[^}]*color: var\(--hud-text\);/)
  assert.match(settingsStyles, /\.events-lap-detail__fit-sector \{[^}]*top: 10px;[^}]*left: 10px;/)
  assert.match(settingsStyles, /\.events-lap-detail__unavailable h3 \{/)
})

test('Event page shows Theoretical Best with three sector sources in place of Absolute Best', () => {
  const section = settingsHtml.slice(settingsHtml.indexOf('<section class="events-theory"'), settingsHtml.indexOf('<section class="event-recorder"'))
  assert.match(section, /<h3 id="events-theory-title" class="events-theory__title">THEORETICAL BEST<\/h3>/)
  assert.match(section, /<p id="events-theory-description" class="events-theory__description">Best sectors across saved runs in this event\.<\/p>/)
  assert.match(section, /<output id="events-theory-time" class="events-theory__time" aria-live="polite">—<\/output>/)
  assert.match(section, /id="events-theory-toggle" class="settings-button events-theory__toggle" type="button" aria-expanded="true" aria-controls="events-theory-sectors">HIDE SECTORS<\/button>/)
  assert.match(section, /<div id="events-theory-sectors" class="events-theory__sectors">/)
  assert.match(section, /id="events-theory-shared-car" class="events-theory__shared-car" hidden>/)
  assert.match(section, /<span class="events-theory__shared-car-label">ALL SECTORS<\/span>/)
  assert.match(section, /id="events-theory-rows" class="events-theory__rows"/)
  assert.match(section, /id="events-theory-note">Complete all three sectors to calculate theoretical best\.<\/span>/)
  assert.match(section, /id="events-theory-count" class="events-theory__count" hidden>/)
  // The block takes the place Absolute Best held: after the notes, before the recorder.
  assert.ok(settingsHtml.indexOf('id="events-detail-notes"') < settingsHtml.indexOf('<section class="events-theory"'))
  assertLoadsBeforeUsers('event-theoretical-best.js', 'EventTheoreticalBest')

  assert.match(settingsJs, /'events-theory__row'/)
  assert.match(settingsJs, /'No eligible sector saved'/)
  assert.match(settingsJs, /'VIEW SECTOR'/)
  assert.match(settingsJs, /'UNAVAILABLE'/)
  assert.match(settingsJs, /'events-theory__car'/)
  assert.match(settingsJs, /setAttribute\('aria-expanded'/)
  assert.match(settingsJs, /'HIDE SECTORS'/)
  assert.match(settingsJs, /'SHOW SECTORS'/)
  assert.match(settingsJs, /`3 SECTORS · \$\{/)
  assert.match(settingsJs, /'RUN' : 'RUNS'/)
  assert.match(settingsJs, /\.ESTIMATE_NOTE\b/)
  assert.match(settingsJs, /\.INCOMPLETE_NOTE\b/)
  assert.match(settingsJs, /`Car \$\{/)
  assert.match(settingsJs, /addEventListener\('click'[^\n]*openEventSource\(/)
  assert.match(settingsJs, /lapNumber: sector\.lapNumber, sector: sector\.sector/)
  // A saved lap refreshes the theory; the refresh itself is checked after extraction (see the report).
  assert.match(settingsJs, /event_recorder_run_saved/)
  assert.match(settingsJs, /getElementById\('events-theory-toggle'\)/)
  assert.match(settingsStyles, /\.events-theory__row:not\(:disabled\):hover \.events-theory__action,/)
  assert.match(settingsStyles, /\.events-theory__row:disabled \.events-theory__action \{\s*background: var\(--surface-deep\);/)
})

test('Run page shows only the Theoretical Best time with its estimate footer', () => {
  const runSection = settingsHtml.slice(settingsHtml.indexOf('<section class="events-theory events-run-view__theory"'), settingsHtml.indexOf('<div class="events-run-view__metric events-run-view__metric--run">'))
  assert.match(runSection, /<h3 id="events-run-theory-title" class="events-theory__title">THEORETICAL BEST<\/h3>/)
  assert.match(runSection, /<p id="events-run-theory-description" class="events-theory__description">Best sectors from laps in this run\.<\/p>/)
  assert.match(runSection, /id="events-run-theory-time" class="events-theory__time"/)
  assert.match(runSection, /id="events-run-theory-count" class="events-theory__count" hidden>3 SECTORS<\/span>/)
  // No sources, rows, or toggle on the run page.
  assert.doesNotMatch(runSection, /breakdown|events-theory__toggle|events-theory__rows|events-theory__row|sector-list/)
  assert.doesNotMatch(settingsHtml, /BEST HYPOTHETICAL TIME/)
  // The run's total is the sum of its best sectors; the description and notes come from the shared module.
  assert.match(settingsJs, /runBestHypotheticalTimeMs\(run\)/)
  assert.match(settingsJs, /\.runDescription\(run\.runType\)/)
  assert.match(settingsJs, /\.INCOMPLETE_NOTE\b/)
})

test('Run lap table: sector cells are buttons, focus shows an outline, and a source opens its lap and sector', () => {
  const detailMarkup = settingsHtml.slice(settingsHtml.indexOf('<section class="events-run-table-section"'), settingsHtml.indexOf('<table class="events-run-table">', settingsHtml.indexOf('<section class="events-run-table-section"')))
  assert.match(detailMarkup, /<p id="events-run-source-context" class="events-run-source-context" hidden><\/p>/)
  assert.match(settingsHtml, /<p id="events-run-feedback" class="events-run-view__feedback" role="status" aria-live="polite" hidden><\/p>/)
  // Sector cells are buttons. A click stops at the cell so it does not also toggle the lap row.
  assert.match(settingsJs, /createElement\('button'\)[\s\S]{0,300}'events-run-table__cell'/)
  assert.match(settingsJs, /stopPropagation\(\)/)
  assert.match(settingsJs, /'Enter' && \w+\.key !== ' '/)
  assert.match(settingsJs, /'is-sector-focus'/)
  // The expanded lap's map follows the sector contract and reports its own focus changes back to the table.
  assert.match(settingsJs, /onSectorChange: /)
  assert.match(settingsJs, /'FULL RUN' : 'FULL LAP'/)
  assert.match(settingsJs, /initialSector: /)
  // VIEW SECTOR: opens the run at its lap and sector, with a status line and the context line.
  assert.match(settingsJs, /EventTheoreticalBest\.openedStatus\(/)
  assert.match(settingsJs, /EventTheoreticalBest\.sourceContext\(/)
  // Focus survives a re-render, so keyboard users keep their place after a save or a selection.
  assert.match(settingsJs, /dataset\.focusKey/)
  assert.match(settingsJs, /data-focus-key="\$\{/)
  assert.match(settingsJs, /focus\(\{ preventScroll: true \}\)/)
  // The focused sector's cell is outlined by a class; the outline is a crisp ring in the book's purple.
  assert.match(settingsCssFor('.events-run-table td.is-sector-focus'), /box-shadow: inset 0 0 0 1px var\(--best\)/)
  assert.match(settingsCssFor('.events-run-table__cell:disabled'), /cursor: default/)
  assert.match(settingsCssFor('.events-run-source-context'), /color: var\(--best\)/)
})

test('Run page Escape clears a focused sector, then collapses the lap, then returns to the Event', () => {
  // The order of the three steps lives in the page's keydown handler and is checked after extraction (see the report).
  // Here each step's effect must exist: clear the sector on the lap map, collapse the lap, close the run.
  assert.match(settingsJs, /focusSector\?\.\(null\)/)
  assert.match(settingsJs, /expandedEventRunLap = null/)
  assert.match(settingsJs, /closeEventRun\(\)/)
})

test('Event theory and run page: the recorder no longer emits the removed Delta reference event', () => {
  // A Windows checkout can have CRLF line endings; the pattern below spans a line break.
  const overlaySource = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8').replace(/\r\n/g, '\n')
  assert.doesNotMatch(overlaySource, /event_recorder_reference/)
  assert.match(overlaySource, /function installBetterDeltaReference\(candidate\)/)
  assert.match(overlaySource, /deltaRuntime\.setReference\?\.\(normalized\)\n\s*syncDeltaVisibility\(\)/)
  assert.doesNotMatch(settingsCss, /absolute-best/)
})
