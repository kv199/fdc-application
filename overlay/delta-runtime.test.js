const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  calculateDelta,
  fillPercent,
  formatDelta,
  formatRaceTime,
  interpolateReferenceMs,
  isBetterReference,
  normalizeReference,
  normalizeTracePoints,
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
