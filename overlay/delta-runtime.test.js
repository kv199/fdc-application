const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  calculateDelta,
  fillPercent,
  formatDelta,
  interpolateReferenceMs,
  normalizeReference,
  normalizeTracePoints,
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

test('runtime accepts an active Event reference and updates its presentation state', () => {
  const valueElement = { textContent: '', dataset: {} }
  const barElement = {
    dataset: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value }
  }
  const fillElement = { style: {} }
  const root = { dataset: {} }
  const runtime = createDeltaRuntime({ root, valueElement, barElement, fillElement })

  runtime.setActiveEvent({ id: 42, reference: { tracePoints: referenceTrace } })
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

  runtime.clearReference()
  assert.equal(valueElement.textContent, '—')
  assert.equal(fillElement.style.width, '0%')
})

test('the shared telemetry path loads and clears the Event reference with recording', () => {
  const overlaySource = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8')
  assert.match(overlaySource, /deltaRuntime\?\.update\?\.\(telemetry\)/)
  assert.match(overlaySource, /invokeTauri\('load_event_absolute_best', \{ eventId \}\)/)
  assert.match(overlaySource, /deltaRuntime\?\.setActiveEvent\?\.\(reference\)/)
  assert.match(overlaySource, /deltaRuntime\?\.clearReference\?\.\(\)/)
})
