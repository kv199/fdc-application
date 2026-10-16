const test = require('node:test')
const assert = require('node:assert/strict')

const { readRustSources } = require('../tools/test-sources.cjs')
const HudEventRecorder = require('./event-recorder.js')
const HudDelta = require('./delta-runtime.js')
const EventTraceMap = require('./event-trace-map.js')

// One synthetic lap: 1200 m in 60 s at 10 Hz. The speed is 20 m/s +- 10 m/s
// over one 60 s period, so the time to each distance third is not a third of
// the lap time and a wrong boundary cannot pass by accident.
const LAP_DISTANCE_M = 1200
const LAP_TIME_MS = 60000
const SAMPLE_INTERVAL_MS = 100
const SAMPLE_COUNT = LAP_TIME_MS / SAMPLE_INTERVAL_MS
const BOUNDARY_DISTANCES_M = [LAP_DISTANCE_M / 3, (2 * LAP_DISTANCE_M) / 3]

// Recorder and Delta both interpolate linearly between the same samples, so only
// the integer-millisecond rounding of each sector value can differ.
const TIME_TOLERANCE_MS = 1

function distanceAt(seconds) {
  return 20 * seconds + (600 / (2 * Math.PI)) * (1 - Math.cos((2 * Math.PI * seconds) / 60))
}

// samples use the recorder's shape; firstElapsedMs is the lap time of the first observed sample.
function buildLap(firstElapsedMs = 0) {
  const samples = []
  for (let index = 0; index <= SAMPLE_COUNT; index += 1) {
    samples.push({
      distance: distanceAt((index * SAMPLE_INTERVAL_MS) / 1000),
      elapsedMs: firstElapsedMs + index * SAMPLE_INTERVAL_MS
    })
  }
  return samples
}

const toTrace = samples => samples.map(({ distance, elapsedMs }) => ({ distanceM: distance, elapsedMs }))

function referenceFrom(samples) {
  return HudDelta.normalizeReference({
    eventId: 'synthetic-lap',
    timeMs: samples.at(-1).elapsedMs,
    tracePoints: toTrace(samples)
  })
}

// Replays the lap through the live Delta runtime against the same lap as its reference.
function liveSectorDeltas(samples) {
  const runtime = HudDelta.createDeltaRuntime()
  runtime.setReference({ eventId: 'synthetic-lap', timeMs: samples.at(-1).elapsedMs, tracePoints: toTrace(samples) })
  for (const sample of samples) {
    runtime.update({
      isRaceOn: true,
      lap: { number: 1, current: sample.elapsedMs / 1000, distance: sample.distance }
    })
  }
  return runtime.completeLap(samples.at(-1).elapsedMs).sectors.map(sector => sector.deltaMs)
}

// Cumulative boundary times [first, second] from recorded sector durations.
function recordedBoundaryTimesMs(samples) {
  const sectors = HudEventRecorder.sectorTimesFromSamples(samples, samples.at(-1).elapsedMs)
  return [sectors.sector1TimeMs, sectors.sector1TimeMs + sectors.sector2TimeMs]
}

test('recorder and Delta reference place both sector boundaries at the same time on one lap', () => {
  const samples = buildLap()
  const reference = referenceFrom(samples)
  assert.equal(reference.endDistanceM, LAP_DISTANCE_M)

  const recorded = recordedBoundaryTimesMs(samples)
  const delta = BOUNDARY_DISTANCES_M.map(distanceM => HudDelta.interpolateReferenceMs(reference, distanceM))
  recorded.forEach((timeMs, index) => {
    assert.ok(Math.abs(timeMs - delta[index]) <= TIME_TOLERANCE_MS,
      `boundary ${index + 1}: recorder ${timeMs} ms, Delta ${delta[index]} ms`)
  })

  // The boundaries are not thirds of the lap time, so this is not a trivial match.
  assert.ok(Math.abs(delta[0] - LAP_TIME_MS / 3) > 1000)
})

test('live Delta sector deltas are zero when the same lap is replayed against itself', () => {
  const samples = buildLap()
  for (const deltaMs of liveSectorDeltas(samples)) {
    // Both sides are rounded to whole milliseconds before the difference is taken.
    assert.ok(Math.abs(deltaMs) <= TIME_TOLERANCE_MS, `sector delta ${deltaMs} ms`)
  }
})

test('trace map ticks sit on the sample nearest each third of the lap distance', () => {
  const samples = buildLap()
  const points = samples.map(({ distance, elapsedMs }) => ({ lapNumber: 1, distanceM: distance, elapsedMs }))
  // A trailing point of the next lap is what marks the first lap as completed.
  points.push({ lapNumber: 2, distanceM: 0, elapsedMs: LAP_TIME_MS + SAMPLE_INTERVAL_MS })

  const span = EventTraceMap.sectorSpan(points, { requireFinish: true })
  assert.deepEqual(span, { startIndex: 0, endIndex: SAMPLE_COUNT })
  const boundaries = EventTraceMap.sectorBoundaries(points, span)
  assert.equal(boundaries.minDistanceM, 0)

  // The map snaps to a sample. Distance is monotonic, so that sample is one of the two
  // that bracket the exact crossing: the error is at most one distance step and at most one sample interval in time.
  const stepM = Math.max(...samples.slice(1).map((sample, index) => sample.distance - samples[index].distance))
  const recorded = recordedBoundaryTimesMs(samples)
  const [tickOne, tickTwo, tickThree] = boundaries.ticks
  BOUNDARY_DISTANCES_M.forEach((distanceM, index) => {
    const tick = boundaries.ticks[index]
    assert.ok(Math.abs(points[tick].distanceM - distanceM) <= stepM,
      `tick ${index + 1} at ${points[tick].distanceM} m, expected ${distanceM} m`)
    assert.ok(Math.abs(points[tick].elapsedMs - recorded[index]) <= SAMPLE_INTERVAL_MS,
      `tick ${index + 1} at ${points[tick].elapsedMs} ms, recorder ${recorded[index]} ms`)
  })
  assert.equal(tickThree, SAMPLE_COUNT)
  assert.ok(tickOne < tickTwo)

  const ranges = EventTraceMap.sectorRanges(points, span)
  assert.equal(ranges.length, 3)
  assert.equal(ranges[0].startIndex, 0)
  assert.equal(ranges[2].endIndex, SAMPLE_COUNT)
  assert.equal(ranges[0].endIndex, ranges[1].startIndex)
  assert.equal(ranges[1].endIndex, ranges[2].startIndex)
  assert.equal(ranges[2].endDistanceM, LAP_DISTANCE_M)
})

test('documents: a lap whose first sample is 400 ms in gives the Delta reference sectors 1 and 3 an offset from the recorder', () => {
  // The recorder keeps the lap clock as it is, but the Delta reference rebases elapsed
  // time to its first trace point. The live runtime uses the lap clock, so an
  // identical replay shows the same offset. Both happen within the 1 s start tolerance.
  const samples = buildLap(400)
  const reference = referenceFrom(samples)
  const recorded = HudEventRecorder.sectorTimesFromSamples(samples, samples.at(-1).elapsedMs)
  const referenceSectors = HudDelta.referenceSectorTimesMs(reference)

  assert.ok(Math.abs((recorded.sector1TimeMs - referenceSectors[0]) - 400) <= TIME_TOLERANCE_MS)
  assert.ok(Math.abs(recorded.sector2TimeMs - referenceSectors[1]) <= TIME_TOLERANCE_MS)
  assert.ok(Math.abs((recorded.sector3TimeMs - referenceSectors[2]) + 400) <= TIME_TOLERANCE_MS)

  const [live1, live2, live3] = liveSectorDeltas(samples)
  assert.ok(Math.abs(live1 - 400) <= TIME_TOLERANCE_MS, `live sector 1 delta ${live1} ms`)
  assert.ok(Math.abs(live2) <= TIME_TOLERANCE_MS, `live sector 2 delta ${live2} ms`)
  assert.ok(Math.abs(live3 + 400) <= TIME_TOLERANCE_MS, `live sector 3 delta ${live3} ms`)
})

test.todo('recorder and Delta reference agree on a lap whose first trace sample is 400 ms into the lap (see the documenting test above)')

test('the 97% reference-coverage threshold is identical in the recorder, the Delta runtime and the native store', () => {
  const rustMatch = readRustSources().match(/const EVENT_REFERENCE_DISTANCE_RATIO: f64 = ([0-9.]+);/)
  assert.ok(rustMatch, 'the Rust sources define EVENT_REFERENCE_DISTANCE_RATIO')

  assert.equal(Number(rustMatch[1]), 0.97)
  assert.equal(HudEventRecorder.SPRINT_MIN_REFERENCE_DISTANCE_RATIO, 0.97)
  assert.equal(HudDelta.REFERENCE_DISTANCE_RATIO, 0.97)
})
