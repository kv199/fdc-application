const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  calculateDelta,
  fillPercent,
  formatDelta,
  formatRaceTime,
  formatSectorDelta,
  interpolateReferenceMs,
  isBetterReference,
  normalizeReference,
  normalizeTracePoints,
  referenceSectorTimesMs,
  referenceTimeMsFrom,
  toneForDelta,
  createDeltaRuntime
} = require('./delta-runtime.js')

const referenceTrace = [
  { distanceM: 0, elapsedMs: 0 },
  { distanceM: 100, elapsedMs: 5000 },
  { distanceM: 200, elapsedMs: 10000 }
]

test('normalizes Event trace aliases and interpolates elapsed reference time by distance', () => {
  const reference = normalizeReference({
    eventId: 42,
    trace_points: [
      { distance_m: 100, elapsed_ms: 5000 },
      { distance_m: 0, elapsed_ms: 0 },
      { distance_m: 200, elapsed_ms: 10000 }
    ]
  })

  assert.equal(reference.eventId, 42)
  assert.deepEqual(reference.tracePoints, referenceTrace)
  assert.equal(interpolateReferenceMs(reference, 50), 2500)
  assert.equal(interpolateReferenceMs(reference, -10), 0)
  assert.equal(interpolateReferenceMs(reference, 250), 10000)
})

test('accepts a reference represented by parallel distance and elapsed-time arrays', () => {
  const reference = normalizeReference({
    distancesM: [0, 100, 200],
    elapsedMs: [0, 5000, 10000]
  })
  assert.deepEqual(reference.tracePoints, referenceTrace)
})

test('accepts an active Event reference nested under a reference run lap', () => {
  const reference = normalizeReference({
    id: 42,
    referenceRun: { lap: { tracePoints: referenceTrace } }
  })
  assert.deepEqual(reference.tracePoints, referenceTrace)
})

test('preserves the canonical reference time independently from trace duration', () => {
  const reference = normalizeReference({
    eventId: 42,
    timeMs: 123456,
    tracePoints: [
      { distanceM: 0, elapsedMs: 0 },
      { distanceM: 100, elapsedMs: 120000 }
    ]
  })

  assert.equal(reference.timeMs, 123456)
  assert.equal(reference.durationMs, 120000)
  assert.equal(referenceTimeMsFrom({ time_ms: 654321, tracePoints: referenceTrace }), 654321)
  assert.equal(referenceTimeMsFrom({ duration: 95.418, tracePoints: referenceTrace }), 95418)
  assert.equal(normalizeReference({ timeMs: 45678, tracePoints: [] }), null)
})

test('does not invent a BEST time from the last trace timestamp', () => {
  const reference = normalizeReference(referenceTrace)
  assert.equal(reference.timeMs, null)
  assert.equal(reference.durationMs, 10000)
})

test('selects only a faster reference for the active Event', () => {
  const current = normalizeReference({ eventId: 42, timeMs: 60000, tracePoints: referenceTrace })
  const faster = normalizeReference({ eventId: 42, timeMs: 59000, tracePoints: referenceTrace })
  const equal = normalizeReference({ eventId: 42, timeMs: 60000, tracePoints: referenceTrace })
  const slower = normalizeReference({ eventId: 42, timeMs: 61000, tracePoints: referenceTrace })
  const otherEvent = normalizeReference({ eventId: 43, timeMs: 61000, tracePoints: referenceTrace })

  assert.equal(isBetterReference(faster, current), true)
  assert.equal(isBetterReference(equal, current), false)
  assert.equal(isBetterReference(slower, current), false)
  assert.equal(isBetterReference(otherEvent, current), true)
})

test('a partial-distance reference never replaces a full one and a full one replaces it', () => {
  const trace = distanceM => [{ distanceM: 0, elapsedMs: 0 }, { distanceM, elapsedMs: 29000 }]
  const full = normalizeReference({ eventId: 42, timeMs: 139155, tracePoints: trace(5948) })
  const partial = normalizeReference({ eventId: 42, timeMs: 29350, tracePoints: trace(1236) })
  const nearFullFaster = normalizeReference({ eventId: 42, timeMs: 139000, tracePoints: trace(5940) })

  assert.equal(isBetterReference(partial, full), false)
  assert.equal(isBetterReference(full, partial), true)
  assert.equal(isBetterReference(nearFullFaster, full), true)
})

test('rebases cumulative reference distance to the first trace sample', () => {
  const reference = normalizeReference([
    { distanceM: 5950, elapsedMs: 0 },
    { distanceM: 6050, elapsedMs: 5000 }
  ])
  assert.deepEqual(reference.tracePoints, [
    { distanceM: 0, elapsedMs: 0 },
    { distanceM: 100, elapsedMs: 5000 }
  ])
})

test('Delta is current elapsed time minus reference elapsed time', () => {
  const reference = normalizeReference(referenceTrace)
  assert.equal(calculateDelta({ isRaceOn: true, lap: { current: 4, distance: 100 } }, reference), -1)
  assert.equal(calculateDelta({ isRaceOn: true, lap: { current: 6, distance: 100 } }, reference), 1)
  assert.equal(calculateDelta({ isRaceOn: false, lap: { current: 6, distance: 100 } }, reference), null)
  assert.equal(calculateDelta({ isRaceOn: true, lap: { current: 6 } }, reference), null)
})

test('Delta presentation maps ahead to green right and behind to red left', () => {
  assert.equal(toneForDelta(-0.25), 'ahead')
  assert.equal(toneForDelta(0.25), 'behind')
  assert.equal(toneForDelta(0), 'neutral')
  assert.equal(fillPercent(-1), 50)
  assert.equal(fillPercent(1), 50)
  assert.equal(fillPercent(2), 50)
  assert.equal(fillPercent(0.25), 12.5)
  assert.equal(formatDelta(-0.125), '-0.125')
  assert.equal(formatDelta(0.125), '+0.125')
})

test('formats race and lap times with minutes, seconds, and milliseconds', () => {
  assert.equal(formatRaceTime(55418), '00:55.418')
  assert.equal(formatRaceTime(61500), '01:01.500')
  assert.equal(formatRaceTime(3600000 + 12), '60:00.012')
  assert.equal(formatRaceTime(null), '—')
  assert.equal(formatRaceTime(-1), '—')
})

test('runtime accepts an active Event reference and updates its presentation state', () => {
  const valueElement = { textContent: '', dataset: {} }
  const barElement = {
    dataset: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value }
  }
  const fillElement = { style: {} }
  const bestContainer = { hidden: true }
  const bestElement = {
    textContent: '',
    dataset: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value }
  }
  const root = { dataset: {} }
  const runtime = createDeltaRuntime({ root, valueElement, barElement, fillElement, bestContainer, bestElement })

  runtime.setActiveEvent({ id: 42, reference: { timeMs: 98765, tracePoints: referenceTrace } })
  // The first live packet establishes the lap's distance origin. This keeps
  // cumulative saved traces comparable to a lap whose live distance resets.
  runtime.update({ isRaceOn: true, lap: { number: 0, current: 0, distance: 20 } })
  runtime.update({ isRaceOn: true, lap: { number: 0, current: 4, distance: 120 } })

  assert.equal(valueElement.textContent, '-1.000')
  assert.equal(valueElement.dataset.tone, 'ahead')
  assert.equal(barElement.dataset.tone, 'ahead')
  assert.equal(fillElement.style.width, '50%')
  assert.equal(barElement.attributes['aria-valuenow'], '-1')
  assert.equal(root.dataset.deltaTone, 'ahead')
  assert.equal(bestElement.textContent, '01:38.765')
  assert.equal(bestElement.dataset.available, 'true')
  assert.equal(bestElement.attributes['aria-label'], 'Best lap time 01:38.765')
  assert.equal(bestContainer.hidden, false)

  runtime.clearReference()
  assert.equal(valueElement.textContent, '—')
  assert.equal(fillElement.style.width, '0%')
  assert.equal(bestElement.textContent, '—')
  assert.equal(bestElement.dataset.available, 'false')
  assert.equal(bestContainer.hidden, true)
})

test('HUD and Delta telemetry visibility follows live IsRaceOn samples only', () => {
  const overlaySource = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8')
  assert.match(overlaySource, /const TELEMETRY_HIDE_DELAY_MS = 500/)
  assert.match(overlaySource, /if \(telemetry\.isRaceOn === true\) lastLiveTelemetryAt = performance\.now\(\)/)
  assert.match(overlaySource, /performance\.now\(\) - lastLiveTelemetryAt < TELEMETRY_HIDE_DELAY_MS/)
})

test('the shared telemetry path loads and clears the Event reference with recording', () => {
  const overlaySource = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8')
  assert.match(overlaySource, /deltaRuntime\?\.update\?\.\(telemetry\)/)
  assert.match(overlaySource, /const nativeEventId = Number\(eventId\)/)
  assert.match(overlaySource, /Number\.isSafeInteger\(nativeEventId\) \|\| nativeEventId <= 0/)
  assert.match(overlaySource, /invokeTauri\('load_event_absolute_best', \{ eventId: nativeEventId \}\)/)
  assert.match(overlaySource, /onReferenceCandidate: candidate => installBetterDeltaReference\(candidate\)/)
  assert.match(overlaySource, /installBetterDeltaReference\(reference\)/)
  assert.match(overlaySource, /HudDelta\?\.isBetterReference\?\.\(normalized, current\)/)
  assert.match(overlaySource, /deltaRuntime\?\.clearReference\?\.\(\)/)
})

test('render writes a DOM property only when its presented value changes', () => {
  let writes = 0
  const counted = target => new Proxy(target, {
    set(object, key, value) {
      writes += 1
      object[key] = value
      return true
    }
  })
  const barAttributes = {}
  const bestAttributes = {}
  const valueElement = counted({ textContent: '', dataset: counted({}) })
  const barElement = counted({
    dataset: counted({}),
    setAttribute(name, value) {
      writes += 1
      barAttributes[name] = value
    }
  })
  const fillElement = counted({ style: counted({}) })
  const bestContainer = counted({ hidden: true })
  const bestElement = counted({
    textContent: '',
    dataset: counted({}),
    setAttribute(name, value) {
      writes += 1
      bestAttributes[name] = value
    }
  })
  const root = counted({ dataset: counted({}) })
  const runtime = createDeltaRuntime({ root, valueElement, barElement, fillElement, bestContainer, bestElement })

  runtime.setActiveEvent({ id: 42, reference: { timeMs: 98765, tracePoints: referenceTrace } })
  runtime.render(-0.5)
  const afterFirstRender = writes
  assert.ok(afterFirstRender > 0)
  assert.equal(valueElement.textContent, '-0.500')
  assert.equal(fillElement.style.width, '25%')
  assert.equal(bestElement.textContent, '01:38.765')

  const state = runtime.render(-0.5)
  assert.equal(writes, afterFirstRender)
  assert.equal(state.deltaSeconds, -0.5)
  assert.equal(state.tone, 'ahead')

  runtime.render(0.25)
  assert.ok(writes > afterFirstRender)
  assert.equal(valueElement.textContent, '+0.250')
  assert.equal(valueElement.dataset.tone, 'behind')
  assert.equal(barAttributes['aria-valuenow'], '0.25')
  assert.equal(fillElement.style.width, '12.5%')
  assert.equal(root.dataset.deltaTone, 'behind')

  // Identical live telemetry produces an identical delta, so it writes nothing.
  runtime.update({ isRaceOn: true, lap: { number: 0, current: 0, distance: 20 } })
  runtime.update({ isRaceOn: true, lap: { number: 0, current: 4, distance: 120 } })
  const beforeRepeatedUpdate = writes
  runtime.update({ isRaceOn: true, lap: { number: 0, current: 4, distance: 120 } })
  assert.equal(writes, beforeRepeatedUpdate)
  assert.equal(valueElement.textContent, '-1.000')
})

// Sector sample helpers: a 300 m reference split into three 100 m sectors.
function referenceFromSectors([firstMs, secondMs, thirdMs], extra = {}) {
  return {
    eventId: 42,
    timeMs: firstMs + secondMs + thirdMs,
    tracePoints: [
      { distanceM: 0, elapsedMs: 0 },
      { distanceM: 100, elapsedMs: firstMs },
      { distanceM: 200, elapsedMs: firstMs + secondMs },
      { distanceM: 300, elapsedMs: firstMs + secondMs + thirdMs }
    ],
    ...extra
  }
}

const sectorReference = referenceFromSectors([10000, 10000, 10000])

function lapTelemetry(lapNumber, distanceM, elapsedMs) {
  return { isRaceOn: true, lap: { number: lapNumber, currentMs: elapsedMs, distance: distanceM } }
}

// Elapsed lap time at a distance for a lap whose 100 m sectors take sectorsMs.
function elapsedOnLap([firstMs, secondMs, thirdMs], distanceM) {
  if (distanceM <= 100) return (distanceM / 100) * firstMs
  if (distanceM <= 200) return firstMs + ((distanceM - 100) / 100) * secondMs
  return firstMs + secondMs + ((distanceM - 200) / 100) * thirdMs
}

function driveLap(runtime, lapNumber, sectorsMs, fromM = 0, toM = 300) {
  for (let distanceM = fromM; distanceM <= toM; distanceM += 10) {
    runtime.update(lapTelemetry(lapNumber, distanceM, elapsedOnLap(sectorsMs, distanceM)))
  }
  return runtime
}

function sectorCell() {
  const value = { textContent: '' }
  return {
    dataset: {},
    attributes: {},
    value,
    setAttribute(name, text) { this.attributes[name] = text },
    querySelector(selector) { return selector === '[data-delta-sector-value]' ? value : null }
  }
}

const NEUTRAL_SECTORS = [
  { tone: 'neutral', deltaMs: null },
  { tone: 'neutral', deltaMs: null },
  { tone: 'neutral', deltaMs: null }
]

test('reference sector times split the lap distance into thirds and leave unknown sectors null', () => {
  assert.deepEqual(referenceSectorTimesMs(normalizeReference(sectorReference)), [10000, 10000, 10000])
  assert.deepEqual(
    referenceSectorTimesMs(normalizeReference(referenceFromSectors([9000, 11000, 12000]))),
    [9000, 11000, 12000]
  )
  // Without a stored BEST time the trace duration stands in for the lap end.
  const withoutBestTime = normalizeReference({ eventId: 42, tracePoints: sectorReference.tracePoints })
  assert.deepEqual(referenceSectorTimesMs(withoutBestTime), [10000, 10000, 10000])
  assert.deepEqual(referenceSectorTimesMs(null), [null, null, null])
})

test('sector differences are formatted in signed seconds with three decimals', () => {
  assert.equal(formatSectorDelta(0), '0.000')
  assert.equal(formatSectorDelta(-666), '-0.666')
  assert.equal(formatSectorDelta(1250), '+1.250')
  assert.equal(formatSectorDelta(null), '—')
})

test('normalizeReference carries Event best sector times and treats invalid values as unknown', () => {
  const reference = normalizeReference({
    ...sectorReference,
    bestSectors: { sector1TimeMs: 9800, sector2TimeMs: 0, sector3TimeMs: 'x' }
  })
  assert.deepEqual(reference.bestSectorsMs, [9800, null, null])
  assert.deepEqual(normalizeReference({ ...sectorReference, bestSectors: null }).bestSectorsMs, [null, null, null])
  assert.deepEqual(normalizeReference(referenceTrace).bestSectorsMs, [null, null, null])
})

test('live sector times interpolate the boundary crossing between samples and colour the row', () => {
  const cells = [sectorCell(), sectorCell(), sectorCell()]
  const runtime = createDeltaRuntime({ sectorElements: cells })
  runtime.setReference(sectorReference)
  assert.deepEqual(runtime.getState().sectors, NEUTRAL_SECTORS)
  assert.equal(cells[0].value.textContent, '—')

  // 105 ms per metre sampled every 30 m. Both boundaries fall between samples,
  // so each crossing time is interpolated: 10500 ms and 21000 ms.
  runtime.update(lapTelemetry(0, 0, 0))
  assert.deepEqual(runtime.getState().sectors[0], { tone: 'active', deltaMs: null })
  for (let distanceM = 30; distanceM <= 300; distanceM += 30) {
    runtime.update(lapTelemetry(0, distanceM, distanceM * 105))
  }
  assert.deepEqual(runtime.getState().sectors, [
    { tone: 'worse', deltaMs: 500 },
    { tone: 'worse', deltaMs: 500 },
    { tone: 'active', deltaMs: null }
  ])
  assert.equal(cells[0].dataset.sectorTone, 'worse')
  assert.equal(cells[0].value.textContent, '+0.500')
  assert.equal(cells[0].attributes['aria-label'], 'Sector 1, worse')
  assert.equal(cells[2].dataset.sectorTone, 'active')
  assert.equal(cells[2].value.textContent, '—')
  assert.equal(cells[2].attributes['aria-label'], 'Sector 3, current')

  // The third sector is finished by the lap time: 31500 - 21000 = 10500 ms.
  runtime.completeLap(31500)
  assert.deepEqual(runtime.getState().sectors.map(sector => sector.deltaMs), [500, 500, 500])
  assert.equal(cells[2].dataset.sectorTone, 'worse')
  assert.equal(cells[2].value.textContent, '+0.500')
  assert.equal(cells[2].attributes['aria-label'], 'Sector 3, worse')
})

test('an equal sector shows 0.000 and a faster-than-reference sector is green', () => {
  const runtime = createDeltaRuntime()
  // The Event's best S2 is 9000 ms, so a 9500 ms S2 is faster than the
  // reference but not purple.
  runtime.setReference({ ...sectorReference, bestSectors: { sector2TimeMs: 9000 } })
  driveLap(runtime, 0, [10000, 9500, 10000])
  runtime.completeLap(29500)
  assert.deepEqual(runtime.getState().sectors, [
    { tone: 'equal', deltaMs: 0 },
    { tone: 'better', deltaMs: -500 },
    { tone: 'equal', deltaMs: 0 }
  ])
})

test('a purple best sector outranks green and must be beaten by the next lap', () => {
  const runtime = createDeltaRuntime()
  runtime.setReference({ ...sectorReference, bestSectors: { sector1TimeMs: 9500, sector2TimeMs: null, sector3TimeMs: null } })

  driveLap(runtime, 0, [9000, 10000, 10000])
  runtime.completeLap(29000)
  assert.deepEqual(runtime.getState().sectors[0], { tone: 'best', deltaMs: -1000 })
  assert.equal(runtime.getState().bestSectorsMs[0], 9000)

  // 9200 ms is faster than the reference but no longer the Event best.
  driveLap(runtime, 1, [9200, 10000, 10000])
  runtime.completeLap(29200)
  assert.deepEqual(runtime.getState().sectors[0], { tone: 'better', deltaMs: -800 })
  assert.equal(runtime.getState().bestSectorsMs[0], 9000)
})

test('completeLap finalizes the third sector only once the second sector boundary is known', () => {
  const runtime = createDeltaRuntime()
  runtime.setReference(sectorReference)
  driveLap(runtime, 0, [10000, 10000, 10000], 0, 150)

  // The second boundary has not been crossed, so the lap time cannot finish S3.
  runtime.completeLap(30000)
  assert.deepEqual(runtime.getState().sectors, [
    { tone: 'equal', deltaMs: 0 },
    { tone: 'active', deltaMs: null },
    { tone: 'neutral', deltaMs: null }
  ])

  driveLap(runtime, 0, [10000, 10000, 10000], 160, 300)
  runtime.completeLap(Number.NaN)
  runtime.completeLap(0)
  assert.deepEqual(runtime.getState().sectors[2], { tone: 'active', deltaMs: null })

  runtime.completeLap(30000)
  assert.deepEqual(runtime.getState().sectors[2], { tone: 'equal', deltaMs: 0 })
  runtime.completeLap(31000)
  assert.deepEqual(runtime.getState().sectors[2], { tone: 'equal', deltaMs: 0 })
})

test('a finished lap stays visible until the next lap completes its first sector', () => {
  const runtime = createDeltaRuntime()
  runtime.setReference(sectorReference)
  driveLap(runtime, 0, [10500, 10500, 10500])
  runtime.completeLap(31500)
  const finished = runtime.getState().sectors
  assert.deepEqual(finished.map(sector => sector.tone), ['worse', 'worse', 'worse'])

  // A new lap starts: the held results remain and no sector is active yet.
  runtime.update(lapTelemetry(1, 0, 0))
  runtime.update(lapTelemetry(1, 50, 5000))
  assert.deepEqual(runtime.getState().sectors, finished)

  runtime.update(lapTelemetry(1, 100, 10000))
  assert.deepEqual(runtime.getState().sectors, [
    { tone: 'equal', deltaMs: 0 },
    { tone: 'active', deltaMs: null },
    { tone: 'neutral', deltaMs: null }
  ])

  driveLap(runtime, 1, [10000, 10000, 10000], 110, 210)
  assert.deepEqual(runtime.getState().sectors, [
    { tone: 'equal', deltaMs: 0 },
    { tone: 'equal', deltaMs: 0 },
    { tone: 'active', deltaMs: null }
  ])
})

test('installing a faster reference keeps the sector row and merges the Event bests', () => {
  const runtime = createDeltaRuntime()
  runtime.setReference(sectorReference)
  driveLap(runtime, 0, [9000, 10000, 10000])
  runtime.completeLap(29000)
  const before = runtime.getState().sectors
  assert.deepEqual(before, [
    { tone: 'best', deltaMs: -1000 },
    { tone: 'equal', deltaMs: 0 },
    { tone: 'equal', deltaMs: 0 }
  ])

  runtime.setReference(referenceFromSectors([9500, 9800, 9700], { bestSectors: { sector2TimeMs: 9800 } }))
  const after = runtime.getState()
  assert.deepEqual(after.sectors, before)
  assert.deepEqual(after.bestSectorsMs, [9000, 9800, 9700])

  // The held results survive into the next lap as well.
  runtime.update(lapTelemetry(1, 0, 0))
  assert.deepEqual(runtime.getState().sectors, before)
})

test('clearReference clears the sector row and the Event bests', () => {
  const runtime = createDeltaRuntime()
  runtime.setReference({ ...sectorReference, bestSectors: { sector1TimeMs: 9000 } })
  driveLap(runtime, 0, [9000, 10000, 10000])
  runtime.completeLap(29000)
  runtime.clearReference()
  assert.deepEqual(runtime.getState().sectors, NEUTRAL_SECTORS)
  assert.deepEqual(runtime.getState().bestSectorsMs, [null, null, null])
})

test('without a reference telemetry produces no sector results', () => {
  const cells = [sectorCell(), sectorCell(), sectorCell()]
  const runtime = createDeltaRuntime({ sectorElements: cells })
  driveLap(runtime, 0, [9000, 10000, 10000])
  runtime.completeLap(29000)
  assert.deepEqual(runtime.getState().sectors, NEUTRAL_SECTORS)
  assert.deepEqual(runtime.getState().bestSectorsMs, [null, null, null])
  assert.equal(cells[0].dataset.sectorTone, 'neutral')
  assert.equal(cells[0].value.textContent, '—')
})

test('race-off packets keep the displayed sectors and the open lap so a late completeLap finishes it', () => {
  const runtime = createDeltaRuntime()
  runtime.setReference(sectorReference)
  driveLap(runtime, 0, [9000, 10000, 10000], 0, 210)
  runtime.update({ isRaceOn: false, lap: { number: 0, currentMs: 21000, distance: 210 } })
  runtime.update(null)
  assert.deepEqual(runtime.getState().sectors, [
    { tone: 'best', deltaMs: -1000 },
    { tone: 'equal', deltaMs: 0 },
    { tone: 'active', deltaMs: null }
  ])

  // The sprint result is confirmed after race-off: S3 is 29000 - 19000 = 10000 ms.
  runtime.completeLap(29000)
  assert.deepEqual(runtime.getState().sectors[2], { tone: 'equal', deltaMs: 0 })
})

test('a lap first observed after its start produces no sector results', () => {
  const runtime = createDeltaRuntime()
  runtime.setReference(sectorReference)
  driveLap(runtime, 0, [9000, 10000, 10000], 0, 150)
  const beforePause = runtime.getState().sectors

  // The pause menu clears the live flag; the resumed lap restarts the
  // distance origin mid-lap, so its boundaries cannot be trusted.
  runtime.update({ isRaceOn: false, lap: { number: 0, currentMs: 14000, distance: 150 } })
  driveLap(runtime, 0, [9000, 10000, 10000], 160, 300)
  runtime.completeLap(29000)
  assert.deepEqual(runtime.getState().sectors, [beforePause[0], { tone: 'neutral', deltaMs: null }, { tone: 'neutral', deltaMs: null }])
  assert.deepEqual(runtime.getState().bestSectorsMs, [9000, 10000, 10000])

  // The next lap observed from its start is timed again.
  driveLap(runtime, 1, [10000, 10000, 10000], 0, 100)
  assert.deepEqual(runtime.getState().sectors[0], { tone: 'equal', deltaMs: 0 })
})

test('Delta sector markup and styles are present in the overlay', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
  assert.match(html, /<div class="delta-strip__sectors" data-delta-sectors>/)
  assert.equal((html.match(/ data-delta-sector /g) || []).length, 3)
  assert.equal((html.match(/data-delta-sector-value>/g) || []).length, 3)

  const css = fs.readFileSync(path.join(__dirname, 'overlay.css'), 'utf8')
  assert.match(css, /\.delta-strip__sectors \{[^}]*repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(css, /\.delta-strip__sector\[data-sector-tone='best'\] \{[^}]*var\(--best\)/)
  assert.match(css, /\.delta-strip__sector\[data-sector-tone='active'\] \{[^}]*var\(--hud-text\)/)
})

test('overlay completes the finished lap before the better-reference check', () => {
  const overlaySource = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8')
  assert.match(
    overlaySource,
    /recorder\?\.armed[\s\S]*?deltaRuntime\.completeLap\?\.\(normalized\.timeMs\)[\s\S]*?HudDelta\?\.isBetterReference\?\.\(normalized, current\)/
  )
})
