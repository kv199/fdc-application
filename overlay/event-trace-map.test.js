const test = require('node:test')
const assert = require('node:assert/strict')
const EventTraceMap = require('./event-trace-map.js')

test('pedalState returns brake when brake >= 0.05', () => {
  const point = { throttle: 0.1, brake: 0.05 }
  assert.equal(EventTraceMap.pedalState(point), 'brake')
})

test('pedalState returns throttle when throttle >= 0.05 and brake < 0.05', () => {
  const point = { throttle: 0.05, brake: 0.04 }
  assert.equal(EventTraceMap.pedalState(point), 'throttle')
})

test('pedalState returns coast when both throttle and brake < 0.05', () => {
  const point = { throttle: 0.04, brake: 0.04 }
  assert.equal(EventTraceMap.pedalState(point), 'coast')
})

test('pedalState handles missing throttle and brake', () => {
  assert.equal(EventTraceMap.pedalState({}), 'coast')
})

test('isSlipPoint returns true when any wheel has abs(combinedSlip) > 1', () => {
  const point = { combinedSlipFl: 1.5, combinedSlipFr: 0.5 }
  assert.equal(EventTraceMap.isSlipPoint(point), true)
})

test('isSlipPoint returns false when all wheels have abs(combinedSlip) <= 1', () => {
  const point = { combinedSlipFl: 0.5, combinedSlipFr: -0.8 }
  assert.equal(EventTraceMap.isSlipPoint(point), false)
})

test('isSlipPoint handles exactly 1.0 as not slip', () => {
  const point = { combinedSlipFl: 1.0, combinedSlipFr: -1.0 }
  assert.equal(EventTraceMap.isSlipPoint(point), false)
})

test('isSlipPoint respects custom limit', () => {
  const point = { combinedSlipFl: 1.5 }
  assert.equal(EventTraceMap.isSlipPoint(point, 2), false)
  assert.equal(EventTraceMap.isSlipPoint(point, 1), true)
})

test('isSlipPoint returns false for null point', () => {
  assert.equal(EventTraceMap.isSlipPoint(null), false)
})

test('hasExtendedTelemetry returns true when at least one point has extended fields', () => {
  const points = [{ speedKmh: 100 }]
  assert.equal(EventTraceMap.hasExtendedTelemetry(points), true)
})

test('hasExtendedTelemetry returns true when at least one point has rumble boolean', () => {
  const points = [{ rumbleFl: true }]
  assert.equal(EventTraceMap.hasExtendedTelemetry(points), true)
})

test('hasExtendedTelemetry returns false when no extended fields present', () => {
  const points = [{ throttle: 0.5, brake: 0 }]
  assert.equal(EventTraceMap.hasExtendedTelemetry(points), false)
})

test('hasExtendedTelemetry returns false for empty array', () => {
  assert.equal(EventTraceMap.hasExtendedTelemetry([]), false)
})

test('groupRuns groups consecutive points with same key', () => {
  const points = [
    { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }
  ]
  const keyOf = (p) => p.id < 3 ? 'a' : 'b'
  const runs = EventTraceMap.groupRuns(points, keyOf)
  assert.deepEqual(runs, [
    { key: 'a', startIndex: 0, endIndex: 1 },
    { key: 'b', startIndex: 1, endIndex: 4 }
  ])
})

test('groupRuns shares boundary points between consecutive runs', () => {
  const points = [
    { id: 1 }, { id: 2 }, { id: 3 }
  ]
  const keyOf = (p) => p.id < 2 ? 'a' : 'b'
  const runs = EventTraceMap.groupRuns(points, keyOf)
  assert.deepEqual(runs, [
    { key: 'a', startIndex: 0, endIndex: 0 },
    { key: 'b', startIndex: 0, endIndex: 2 }
  ])
})

test('groupRuns returns empty array for empty points', () => {
  const runs = EventTraceMap.groupRuns([], () => 'a')
  assert.deepEqual(runs, [])
})

test('nearestPointIndex finds nearest point within maxDistance', () => {
  const projected = [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
    { x: 20, y: 20 }
  ]
  const index = EventTraceMap.nearestPointIndex(projected, 11, 11, 3)
  assert.equal(index, 1)
})

test('nearestPointIndex returns null when no points within maxDistance', () => {
  const projected = [
    { x: 0, y: 0 },
    { x: 100, y: 100 }
  ]
  const index = EventTraceMap.nearestPointIndex(projected, 10, 10, 5)
  assert.equal(index, null)
})

test('nearestPointIndex returns null for empty array', () => {
  const index = EventTraceMap.nearestPointIndex([], 0, 0)
  assert.equal(index, null)
})

test('formatGear returns R for 0', () => {
  assert.equal(EventTraceMap.formatGear(0), 'R')
})

test('formatGear returns N for >= 11', () => {
  assert.equal(EventTraceMap.formatGear(11), 'N')
  assert.equal(EventTraceMap.formatGear(15), 'N')
})

test('formatGear returns number for 1-10', () => {
  assert.equal(EventTraceMap.formatGear(3), '3')
  assert.equal(EventTraceMap.formatGear(1), '1')
})

test('formatGear returns — for null/undefined', () => {
  assert.equal(EventTraceMap.formatGear(null), '—')
  assert.equal(EventTraceMap.formatGear(undefined), '—')
})

test('tooltipModel returns legacy data for point without extended telemetry', () => {
  const point = { throttle: 0.5, brake: 0.2, elapsedMs: 5000, distanceM: 100 }
  const model = EventTraceMap.tooltipModel(point, 0)
  assert.equal(model.legacyTelemetry, true)
  assert.ok(model.rows.some(r => r.label === 'THROTTLE'))
  assert.ok(model.rows.some(r => r.label === 'BRAKE'))
  assert.ok(model.rows.some(r => r.label === 'INFO'))
})

test('tooltipModel includes extended fields when speedKmh present', () => {
  const point = {
    throttle: 0.5, brake: 0.2,
    elapsedMs: 5000, distanceM: 100,
    speedKmh: 150,
    gear: 5,
    rpm: 7200,
    steer: 0.25
  }
  const model = EventTraceMap.tooltipModel(point, 0)
  assert.equal(model.legacyTelemetry, false)
  assert.ok(model.rows.some(r => r.label === 'SPEED'))
  assert.ok(model.rows.some(r => r.label === 'GEAR'))
  assert.ok(model.rows.some(r => r.label === 'RPM'))
})

test('tooltipModel includes wheel table for extended telemetry', () => {
  const point = {
    speedKmh: 150,
    combinedSlipFl: 0.8, combinedSlipFr: 0.9, combinedSlipRl: 0.7, combinedSlipRr: 0.6,
    slipAngleFl: 0.5, slipAngleFr: 0.4, slipAngleRl: 0.3, slipAngleRr: 0.2,
    slipRatioFl: -0.2, slipRatioFr: -0.15, slipRatioRl: 0.1, slipRatioRr: 0.05,
    tireTempCFl: 85, tireTempCFr: 87, tireTempCRl: 83, tireTempCRr: 82,
    suspensionFl: 0.4, suspensionFr: 0.35, suspensionRl: 0.3, suspensionRr: 0.32
  }
  const model = EventTraceMap.tooltipModel(point, 0)
  assert.ok(model.wheelTable.length > 0)
  assert.ok(model.wheelTable.some(r => r.label === 'COMBINED'))
  assert.ok(model.wheelTable.some(r => r.label === 'SLIP ANGLE'))
  assert.ok(model.wheelTable.some(r => r.label === 'SLIP RATIO'))
  assert.ok(model.wheelTable.some(r => r.label === 'TIRE'))
  assert.ok(model.wheelTable.some(r => r.label === 'SUSP'))
})

test('tooltipModel includes curbRow only when at least one wheel has rumble=true', () => {
  const pointWithCurb = {
    speedKmh: 150,
    rumbleFl: true, rumbleFr: false, rumbleRl: false, rumbleRr: false
  }
  const model = EventTraceMap.tooltipModel(pointWithCurb, 0)
  assert.ok(model.curbRow !== null)
  assert.ok(model.curbRow.wheels.includes('Fl'))

  const pointWithoutCurb = {
    speedKmh: 150,
    rumbleFl: false, rumbleFr: false, rumbleRl: false, rumbleRr: false
  }
  const model2 = EventTraceMap.tooltipModel(pointWithoutCurb, 0)
  assert.equal(model2.curbRow, null)
})

test('tooltipModel includes puddleRow only when at least one wheel has puddle depth > 0', () => {
  const pointWithPuddle = {
    speedKmh: 150,
    puddleFl: 0.3, puddleFr: 0, puddleRl: 0, puddleRr: 0
  }
  const model = EventTraceMap.tooltipModel(pointWithPuddle, 0)
  assert.ok(model.puddleRow !== null)
  assert.ok(model.puddleRow.wheels.Fl)

  const pointWithoutPuddle = {
    speedKmh: 150,
    puddleFl: 0, puddleFr: 0, puddleRl: 0, puddleRr: 0
  }
  const model2 = EventTraceMap.tooltipModel(pointWithoutPuddle, 0)
  assert.equal(model2.puddleRow, null)
})

test('null extended values do not count as extended telemetry', () => {
  assert.equal(EventTraceMap.hasExtendedTelemetry([{ speedKmh: null, combinedSlipFl: null, rumbleFl: false }]), false)
  assert.equal(EventTraceMap.isSlipPoint({ combinedSlipFl: null }), false)
})

test('formatTime matches the Events run time format', () => {
  assert.equal(EventTraceMap.formatTime(83456), '01:23.456')
  assert.equal(EventTraceMap.formatTime(null), '—')
})

test('tooltipModel orders acceleration rows and explains peak slip and suspension', () => {
  const model = EventTraceMap.tooltipModel({
    distanceM: 150, elapsedMs: 1000, throttle: 1, brake: 0,
    accelerationX: 9.80665, accelerationY: 0, accelerationZ: -4.903325, combinedSlipFl: -1.5
  }, 100)

  const labels = model.rows.map(row => row.label)
  assert.deepEqual(labels.filter(label => ['LAT', 'LONG', 'VERT'].includes(label)), ['LAT', 'LONG', 'VERT'])
  assert.equal(model.rows.find(row => row.label === 'LONG').value, '-0.50 g')
  assert.equal(model.rows.find(row => row.label === 'DIST').value, '50 m')
  assert.equal(model.wheelTable[0].values.Fl, '150%')
  assert.deepEqual(model.notes, ['SLIP: PEAK OVER 0.1 S', 'SUSP: 0% EXTENDED · 100% COMPRESSED'])
})
