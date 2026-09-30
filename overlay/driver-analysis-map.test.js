const test = require('node:test')
const assert = require('node:assert/strict')
const map = require('./driver-analysis-map.js')

const sample = (timestampMs, extra = {}) => ({
  sequence: timestampMs / 16, timestampMs, speedKmh: 150, throttle: 1, brake: 0, steer: 0.1, gear: 4, rpm: 7000,
  accelerationX: 3, accelerationY: 0, accelerationZ: 1, yawRate: 0.2,
  slipAngle: [0.2, 0.2, 0.1, 0.1], slipRatio: [0, 0, 0.1, 0.1], combinedSlip: [0.3, 0.3, 0.2, 0.2],
  tireTempC: [80, 80, 75, 75], suspension: [0.4, 0.4, 0.5, 0.5], rumble: [false, false, false, false], puddle: [0, 0, 0, 0],
  lapDistance: 1000 + timestampMs / 10, position: [timestampMs, 0, -timestampMs], ...extra
})

test('trace points are thinned to 100 ms and keep the signed slip peak and curb contact', () => {
  const samples = Array.from({ length: 20 }, (_, index) => sample(index * 16, index === 3
    ? { combinedSlip: [-1.8, 0.3, 0.2, 0.2], rumble: [false, false, true, false] }
    : {}))
  const points = map.tracePointsFromSamples(samples)

  assert.deepEqual(points.slice(0, 3).map(point => point.elapsedMs), [0, 112, 224])
  assert.equal(points[1].combinedSlipFl, -1.8)
  assert.equal(points[1].rumbleRl, true)
  assert.equal(points[2].combinedSlipFl, 0.3)
  assert.equal(points[2].rumbleRl, undefined)
  assert.deepEqual([points[0].positionX, points[0].positionZ, points[0].tireTempCFl, points[0].gear], [0, -0, 80, 4])
})

test('a pedal or gear change adds a trace point, and samples without a position are skipped', () => {
  const points = map.tracePointsFromSamples([
    sample(0),
    sample(16, { position: null }),
    sample(32, { brake: 0.6, throttle: 0 }),
    sample(48, { brake: 0.6, throttle: 0, gear: 3 })
  ])
  assert.deepEqual(points.map(point => point.elapsedMs), [0, 32, 48])
  assert.deepEqual(map.tracePointsFromSamples([sample(0, { position: null })]), [])
})

test('problem checks become segments and clean checks become points', () => {
  const points = map.tracePointsFromSamples(Array.from({ length: 50 }, (_, index) => sample(index * 100)))
  const marks = map.checkMarks([
    { outcome: 'problem', opportunityType: 'front_scrub', problemType: 'front_scrub', startedAtMs: 1000, finishedAtMs: 1550 },
    { outcome: 'problem', opportunityType: 'exit_wheelspin', problemType: null, startedAtMs: 4900, finishedAtMs: 4900 },
    { outcome: 'clean', opportunityType: 'front_scrub', startedAtMs: 2000, finishedAtMs: 2400 }
  ], points)

  assert.deepEqual(marks.errors.map(mark => [mark.kind, mark.startIndex, mark.endIndex]), [['front_scrub', 10, 15], ['exit_wheelspin', 48, 49]])
  assert.deepEqual(marks.clean.map(mark => mark.index), [22])
  assert.deepEqual(map.errorCounts(marks), { front_scrub: 1, exit_wheelspin: 1 })
  assert.equal(map.errorAt(marks, 12).kind, 'front_scrub')
  assert.equal(map.errorAt(marks, 30), null)
})

test('error descriptions show the measured numbers and the instruction', () => {
  const points = map.tracePointsFromSamples(Array.from({ length: 30 }, (_, index) => sample(index * 100)))
  const model = map.errorTooltipModel({
    kind: 'front_scrub', startIndex: 12, endIndex: 18,
    check: { startedAtMs: 1200, finishedAtMs: 1800, metrics: { steerGrowth: 0.18, peakFrontSlip: 1.12, lateralResponseLoss: 0.64, yawResponseLoss: 0.0873 } }
  }, points)

  assert.equal(model.heading, 'FRONT SCRUB')
  assert.equal(model.subtitle, '0.12 km · 0.6 s')
  assert.deepEqual(model.lines, ['Steering +18% · front slip 112%', 'Response lateral −0.6 m/s² · yaw −5 °/s'])
  assert.equal(model.instruction, 'Reduce steering and let the front recover')
})

test('every error type has a description and missing metrics are left out', () => {
  const points = map.tracePointsFromSamples([sample(0), sample(100)])
  const lines = kind => map.errorTooltipModel({ kind, startIndex: 0, endIndex: 1, check: { startedAtMs: 0, finishedAtMs: 100, metrics: {
    throttleGrowth: 0.4, drivenSlipPeak: 0.35, effectiveAccelerationPeak: 1.25,
    maxBrake: 0.7, maxSteer: 0.3, maxFrontCombinedSlip: 1.05,
    previousBrake: 0.8, releaseRate: 4.2, rearSlipRise: 0.3
  } } }, points).lines

  assert.deepEqual(lines('exit_wheelspin'), ['Throttle +40% · driven slip 35%', 'Acceleration 1.3 m/s²'])
  assert.deepEqual(lines('brake_steering_overload'), ['Brake 70% · steering 30% · front slip 105%'])
  assert.deepEqual(lines('abrupt_brake_release'), ['Brake 80% · released at 420%/s', 'Rear slip +30%'])
})

test('a hover near a problem segment picks the segment over a closer plain point', () => {
  const projected = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 }]
  const marks = { errors: [{ kind: 'front_scrub', startIndex: 2, endIndex: 3 }], clean: [] }
  assert.equal(map.nearestErrorIndex(marks, projected, 11, 0, 14), 2)
  assert.equal(map.nearestErrorIndex(marks, projected, 0, 0, 14), null)
})

test('error tooltip model uses imperial units when DisplayPreferences specifies them', () => {
  try {
    globalThis.DisplayPreferences = {
      read: () => ({ speedUnit: 'mph', distanceUnit: 'mi' })
    }
    const points = map.tracePointsFromSamples(Array.from({ length: 30 }, (_, index) => sample(index * 100)))
    const model = map.errorTooltipModel({
      kind: 'front_scrub', startIndex: 12, endIndex: 18,
      check: { startedAtMs: 1200, finishedAtMs: 1800, metrics: { steerGrowth: 0.18, peakFrontSlip: 1.12, lateralResponseLoss: 0.64, yawResponseLoss: 0.0873 } }
    }, points)

    assert.ok(model.subtitle.includes('mi'), `distance should be in miles: ${model.subtitle}`)
  } finally {
    delete globalThis.DisplayPreferences
  }
})
