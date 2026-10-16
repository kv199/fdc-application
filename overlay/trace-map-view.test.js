const test = require('node:test')
const assert = require('node:assert/strict')
const TraceMapView = require('./trace-map-view.js')

const { traceState, traceStats } = TraceMapView

test('the module loads in Node without a DOM and exports renderTraceMap as a function', () => {
  assert.equal(typeof globalThis.document, 'undefined')
  assert.equal(typeof TraceMapView.renderTraceMap, 'function')
})

test('traceState: brake at 0.05 or more wins over throttle', () => {
  assert.equal(traceState({ brake: 0.05, throttle: 0.9 }), 'brake')
  assert.equal(traceState({ brake: 0.5, throttle: 0.5 }), 'brake')
})

test('traceState: throttle at 0.05 or more when the brake is below 0.05', () => {
  assert.equal(traceState({ brake: 0.04, throttle: 0.05 }), 'throttle')
  assert.equal(traceState({ brake: 0, throttle: 1 }), 'throttle')
})

test('traceState: otherwise the car is coasting', () => {
  assert.equal(traceState({ brake: 0.04, throttle: 0.04 }), 'coast')
  assert.equal(traceState({}), 'coast')
  assert.equal(traceState(undefined), 'coast')
})

test('traceState: pedal values above 1 are percentages', () => {
  assert.equal(traceState({ brake: 0, throttle: 6 }), 'throttle')
  assert.equal(traceState({ brake: 4, throttle: 0 }), 'coast')
  assert.equal(traceState({ brake: 50, throttle: 90 }), 'brake')
})

test('traceStats: each interval is weighted by its elapsed time and counted under the state of its first point', () => {
  // Intervals: throttle 0-1000 ms (1000), brake 1000-3000 ms (2000), coast 3000-4000 ms (1000). Total 4000 ms.
  const points = [
    { elapsedMs: 0, throttle: 1, brake: 0 },
    { elapsedMs: 1000, throttle: 0, brake: 1 },
    { elapsedMs: 3000, throttle: 0, brake: 0 },
    { elapsedMs: 4000, throttle: 1, brake: 0 }
  ]
  assert.deepEqual(traceStats(points), { throttle: 25, brake: 50, coast: 25 })
})

test('traceStats: the last point counts the time remaining up to lapTimeMs', () => {
  // The same points as above, plus 1000 ms of throttle after the last point up to a 5000 ms lap. Total 5000 ms.
  const points = [
    { elapsedMs: 0, throttle: 1, brake: 0 },
    { elapsedMs: 1000, throttle: 0, brake: 1 },
    { elapsedMs: 3000, throttle: 0, brake: 0 },
    { elapsedMs: 4000, throttle: 1, brake: 0 }
  ]
  assert.deepEqual(traceStats(points, 5000), { throttle: 40, brake: 40, coast: 20 })
})

test('traceStats: shares are whole percents that add up to 100', () => {
  // Three equal intervals of 1000 ms give 33.3% each; the spare point goes to the first state in order.
  const points = [
    { elapsedMs: 0, throttle: 1, brake: 0 },
    { elapsedMs: 1000, throttle: 0, brake: 1 },
    { elapsedMs: 2000, throttle: 0, brake: 0 }
  ]
  assert.deepEqual(traceStats(points, 3000), { throttle: 34, brake: 33, coast: 33 })
})

test('traceStats: no timed interval gives null', () => {
  assert.equal(traceStats([]), null)
  assert.equal(traceStats([{ elapsedMs: 0, throttle: 1, brake: 0 }]), null)
})
