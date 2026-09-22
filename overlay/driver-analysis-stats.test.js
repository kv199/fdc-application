const test = require('node:test')
const assert = require('node:assert/strict')

const statsApi = require('./driver-analysis-stats.js')
const engineApi = require('./driver-analysis-engine.js')

test('distribution returns null for empty input', () => {
  const result = statsApi.distribution([])
  assert.equal(result, null)
})

test('distribution returns null for all non-finite values', () => {
  const result = statsApi.distribution([null, undefined, NaN, Infinity])
  assert.equal(result, null)
})

test('distribution calculates median, p10, p90, and max', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const result = statsApi.distribution(values)
  assert.equal(result.median, 5.5)
  assert.equal(result.p10, 1.9)
  assert.equal(result.p90, 9.1)
  assert.equal(result.max, 10)
})

test('distribution handles single value', () => {
  const result = statsApi.distribution([42.5])
  assert.equal(result.median, 42.5)
  assert.equal(result.p10, 42.5)
  assert.equal(result.p90, 42.5)
  assert.equal(result.max, 42.5)
})

test('distribution filters non-finite values and sorts', () => {
  const values = [5, null, 1, undefined, 10, NaN, 3]
  const result = statsApi.distribution(values)
  // Sorted: [1, 3, 5, 10], median position: (4-1)*0.5 = 1.5 -> 3 + (5-3)*0.5 = 4
  assert.equal(result.median, 4)
  assert.equal(result.max, 10)
})

test('MIN_EVENTS and STATS_VERSION are exported', () => {
  assert.equal(statsApi.MIN_EVENTS, 3)
  assert.equal(statsApi.STATS_VERSION, 1)
})

test('DEFAULT_THRESHOLDS includes required configuration', () => {
  const thresholds = statsApi.DEFAULT_THRESHOLDS
  assert.ok(thresholds.maxStepMs > 0)
  assert.ok(thresholds.movingKmh >= 0)
  assert.ok(thresholds.brakeOn > 0)
  assert.ok(thresholds.brakeOff > 0)
  assert.ok(thresholds.brakeOff < thresholds.brakeOn)
})

test('createDriverAnalysisStats exports required methods', () => {
  const stats = statsApi.createDriverAnalysisStats()
  assert.equal(typeof stats.update, 'function')
  assert.equal(typeof stats.reset, 'function')
  assert.equal(typeof stats.resetTransient, 'function')
  assert.equal(typeof stats.finalize, 'function')
})

test('synthetic session: 5 laps with acceleration, braking, turns, and exits', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  const car = { ordinal: 1, pi: 800, drivetrain: 1 }
  let timestampMs = 0
  const rpmMax = 8000
  let lapDistance = 0
  let lapCount = 1

  const driveFrame = (speedKmh, throttle, brake, steer, gear = 3) => {
    const frame = {
      timestampMs,
      speedKmh,
      throttle,
      brake,
      steer,
      gear,
      rpm: speedKmh > 20 ? 4000 + speedKmh * 30 : 1000,
      rpmMax,
      isRaceOn: true,
      car,
      acceleration: {
        x: steer !== 0 ? steer * 20 : 0,
        y: 0,
        z: brake > 0.1 ? -11 : (throttle > 0.5 ? throttle * 8 : 0)
      },
      angularVelocity: { y: steer !== 0 ? steer * 1.5 : 0 },
      slipAngle: {
        fl: Math.abs(steer) * 0.15,
        fr: Math.abs(steer) * 0.15,
        rl: 0.03,
        rr: 0.03
      },
      lap: { number: lapCount, distance: lapDistance, raceTime: timestampMs / 1000 }
    }
    lapDistance += (speedKmh / 3.6) * 0.016
    if (lapDistance > 5000) {
      lapDistance = 0
      lapCount++
    }
    timestampMs += 16
    return frame
  }

  // Simulate 5 laps
  for (let lap = 0; lap < 5; lap++) {
    // Straight: accelerate to 200 km/h with full throttle
    for (let i = 0; i < 50; i++) {
      const currentSpeed = Math.min(200, 50 + i * 3)
      engine.update(driveFrame(currentSpeed, 0.98, 0, 0))
    }

    // Hard braking (0.9 brake, z = -11 m/s²)
    for (let i = 0; i < 30; i++) {
      const speed = Math.max(40, 200 - i * 5)
      engine.update(driveFrame(speed, 0, 0.9, 0))
    }

    // Braking with steering at the end (trail braking)
    for (let i = 0; i < 15; i++) {
      const speed = Math.max(30, 40 - i * 1)
      const steerAmount = (i / 15) * 0.4
      engine.update(driveFrame(speed, 0, 0.6, steerAmount))
    }

    // Turn: lateral acceleration x=10 (approximately 1.02 g)
    for (let i = 0; i < 30; i++) {
      const steerAmount = Math.sin((i / 30) * Math.PI) * 0.5
      const speed = 60 + Math.sin((i / 30) * Math.PI) * 20
      engine.update(driveFrame(speed, 0, 0, steerAmount))
    }

    // Exit turn: throttle ramp to full
    for (let i = 0; i < 25; i++) {
      const throttleAmount = (i / 25) * 0.98
      const speed = 60 + i * 3
      engine.update(driveFrame(speed, throttleAmount, 0, 0.1 * (1 - i / 25)))
    }

    // Continue accelerating
    for (let i = 0; i < 20; i++) {
      const speed = 135 + i * 3
      engine.update(driveFrame(speed, 0.98, 0, 0))
    }
  }

  const result = engine.finalize()
  const stats = result.stats

  assert.ok(stats, 'stats should be finalized')
  assert.equal(stats.version, statsApi.STATS_VERSION, 'stats version should match STATS_VERSION')
  assert.equal(stats.braking.count, 5, 'should have 5 braking events')
  assert.equal(stats.corners.count, 5, 'should have 5 corners')
  assert.equal(stats.exits.count, 5, 'should have 5 exits')

  // Pedal shares should sum to ~1 (within 0.01)
  const moving = stats.movingMs
  const totalShare = (stats.pedals.fullThrottle || 0) + (stats.pedals.partialThrottle || 0) +
                     (stats.pedals.coast || 0) + (stats.pedals.brake || 0)
  assert.ok(Math.abs(totalShare - 1) < 0.01, `pedal shares should sum to ~1, got ${totalShare}`)

  // Brake share should be > 0
  assert.ok(stats.pedals.brake > 0, 'brake share should be > 0')

  // Trail braking should be 1 (100%) - all braking events include trail braking
  assert.equal(stats.braking.trailBrakingShare, 1, 'trail braking share should be 1')

  // Peak decel should be close to 11/9.80665 (~1.12)
  const expectedDecelG = 11 / 9.80665
  assert.ok(stats.braking.peakDecelG.median !== null, 'peak decel median should not be null')
  assert.ok(Math.abs(stats.braking.peakDecelG.median - expectedDecelG) < 0.02,
    `peak decel should be ~${expectedDecelG}, got ${stats.braking.peakDecelG.median}`)

  // Lateral G should be close to 10/9.80665 (~1.02)
  const expectedLateralG = 10 / 9.80665
  assert.ok(stats.corners.lateralG.median !== null, 'lateral G median should not be null')
  assert.ok(Math.abs(stats.corners.lateralG.median - expectedLateralG) < 0.02,
    `lateral G should be ~${expectedLateralG}, got ${stats.corners.lateralG.median}`)

  // Distance and speed should be positive
  assert.ok(stats.distanceM > 0, 'distance should be > 0')
  assert.ok(stats.avgSpeedKmh > 0, 'average speed should be > 0')
  assert.ok(stats.maxSpeedKmh > 0, 'max speed should be > 0')
  assert.ok(stats.maxSpeedKmh >= 200, 'max speed should be >= target speed of 200')
})

test('pedal classification: brake frames count as brake even when throttle is 1', () => {
  const stats = statsApi.createDriverAnalysisStats()
  const car = { ordinal: 1, pi: 800, drivetrain: 1 }

  const snapshot1 = {
    valid: true,
    resetReason: null,
    phase: 'braking',
    maneuverId: 1,
    sample: {
      timestampMs: 0,
      speedKmh: 100,
      throttle: 1.0,
      brake: 0.9,
      steer: 0,
      gear: 3,
      rpm: 5000,
      rpmMax: 8000,
      acceleration: { x: 0, y: 0, z: -11 },
      angularVelocity: { y: 0 },
      slipAngle: { fl: 0.05, fr: 0.05, rl: 0.03, rr: 0.03 },
      lapDistanceM: 100,
      car: car,
      steerMagnitude: 0,
      lateralResponse: 0,
      longitudinalResponse: -11,
      frontSlip: 0.05,
      rearSlip: 0.03,
      drivenSlip: 0
    },
    previousSample: null
  }

  const snapshot2 = {
    valid: true,
    resetReason: null,
    phase: 'braking',
    maneuverId: 1,
    sample: {
      timestampMs: 100,
      speedKmh: 90,
      throttle: 1.0,
      brake: 0.9,
      steer: 0,
      gear: 3,
      rpm: 4500,
      rpmMax: 8000,
      acceleration: { x: 0, y: 0, z: -11 },
      angularVelocity: { y: 0 },
      slipAngle: { fl: 0.05, fr: 0.05, rl: 0.03, rr: 0.03 },
      lapDistanceM: 102,
      car: car,
      steerMagnitude: 0,
      lateralResponse: 0,
      longitudinalResponse: -11,
      frontSlip: 0.05,
      rearSlip: 0.03,
      drivenSlip: 0
    },
    previousSample: snapshot1.sample
  }

  stats.update(snapshot1)
  stats.update(snapshot2)
  const result = stats.finalize()

  assert.ok(result.pedals.brake > 0, 'brake share should be > 0 even when throttle is 1')
  assert.equal(result.pedals.fullThrottle || 0, 0, 'full throttle share should be 0 when brake is active')
})

test('frames below 5 km/h are excluded from movingMs', () => {
  const stats = statsApi.createDriverAnalysisStats()
  const car = { ordinal: 1, pi: 800, drivetrain: 1 }
  let timestampMs = 0

  const frame = (speed, throttle = 0) => {
    const sample = {
      timestampMs,
      speedKmh: speed,
      throttle,
      brake: 0,
      steer: 0,
      gear: 0,
      rpm: 0,
      rpmMax: 8000,
      acceleration: { x: 0, y: 0, z: 0 },
      angularVelocity: { y: 0 },
      slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
      car: car,
      steerMagnitude: 0,
      lateralResponse: 0,
      longitudinalResponse: 0,
      frontSlip: 0,
      rearSlip: 0,
      drivenSlip: 0
    }
    timestampMs += 16
    return sample
  }

  // Low speed frames should not count toward movingMs
  const snapshot1 = { valid: true, resetReason: null, phase: 'straight', maneuverId: 0, sample: frame(2), previousSample: null }
  stats.update(snapshot1)

  const snapshot2 = { valid: true, resetReason: null, phase: 'straight', maneuverId: 0, sample: frame(3), previousSample: snapshot1.sample }
  stats.update(snapshot2)

  // High speed frames should count
  const snapshot3 = { valid: true, resetReason: null, phase: 'straight', maneuverId: 0, sample: frame(100), previousSample: snapshot2.sample }
  stats.update(snapshot3)

  const snapshot4 = { valid: true, resetReason: null, phase: 'straight', maneuverId: 0, sample: frame(100), previousSample: snapshot3.sample }
  stats.update(snapshot4)

  const result = stats.finalize()

  // Only the last two frames (at 100 km/h) should count
  assert.ok(result.movingMs > 0, 'moving time should be > 0')
  assert.ok(result.movingMs <= 32, 'moving time should only include frames >= 5 km/h')
})

test('telemetry gap > 250ms during braking discards the braking event', () => {
  const stats = statsApi.createDriverAnalysisStats()
  const car = { ordinal: 1, pi: 800, drivetrain: 1 }

  // Start braking
  const sample1 = {
    timestampMs: 0,
    speedKmh: 100,
    throttle: 0,
    brake: 0.9,
    steer: 0,
    gear: 3,
    rpm: 5000,
    rpmMax: 8000,
    acceleration: { x: 0, y: 0, z: -11 },
    angularVelocity: { y: 0 },
    slipAngle: { fl: 0.05, fr: 0.05, rl: 0.03, rr: 0.03 },
    car: car,
    steerMagnitude: 0,
    lateralResponse: 0,
    longitudinalResponse: -11,
    frontSlip: 0.05,
    rearSlip: 0.03,
    drivenSlip: 0
  }

  const snapshot1 = { valid: true, resetReason: null, phase: 'braking', maneuverId: 1, sample: sample1, previousSample: null }
  stats.update(snapshot1)

  // Continue braking for a bit
  const sample2 = {
    ...sample1,
    timestampMs: 100,
    speedKmh: 95
  }
  const snapshot2 = { valid: true, resetReason: null, phase: 'braking', maneuverId: 1, sample: sample2, previousSample: sample1 }
  stats.update(snapshot2)

  // Telemetry gap > 250ms (reset transient)
  const snapshot3 = { valid: false, resetReason: 'telemetry_gap', phase: 'straight', maneuverId: 1, sample: null, previousSample: null }
  stats.update(snapshot3)

  // After the gap, update with new frames - the braking event should be discarded
  const sample4 = {
    ...sample1,
    timestampMs: 500,
    speedKmh: 50,
    brake: 0
  }
  const snapshot4 = { valid: true, resetReason: null, phase: 'straight', maneuverId: 1, sample: sample4, previousSample: null }
  stats.update(snapshot4)

  const result = stats.finalize()

  // The braking event that was interrupted should not be counted
  assert.equal(result.braking.count, 0, 'braking event interrupted by gap should not be counted')
})

test('formatStatsRows returns empty array for null or missing stats', () => {
  assert.deepEqual(statsApi.formatStatsRows(null), [])
  assert.deepEqual(statsApi.formatStatsRows(undefined), [])
  assert.deepEqual(statsApi.formatStatsRows({}), [])
  assert.deepEqual(statsApi.formatStatsRows({ version: null }), [])
})

test('formatStatsRows hides sections when count < MIN_EVENTS', () => {
  const stats = {
    version: statsApi.STATS_VERSION,
    distanceM: 5000,
    avgSpeedKmh: 100,
    maxSpeedKmh: 150,
    movingMs: 180000,
    pedals: {
      fullThrottle: 0.4,
      partialThrottle: 0.2,
      coast: 0.2,
      brake: 0.2,
      brakeWithSteering: 0.05
    },
    braking: { count: 2, peakDecelG: null, durationS: null, releaseS: null, trailBrakingShare: null },
    corners: { count: 1, lateralG: null },
    exits: { count: 0, toFullThrottleS: null }
  }

  const rows = statsApi.formatStatsRows(stats)
  const braking = rows.find(r => r.key === 'braking')
  const corners = rows.find(r => r.key === 'corners')
  const exits = rows.find(r => r.key === 'exits')

  assert.equal(braking, undefined, 'BRAKING row should be hidden when count < MIN_EVENTS')
  assert.equal(corners, undefined, 'CORNERS row should be hidden when count < MIN_EVENTS')
  assert.equal(exits, undefined, 'EXIT row should be hidden when count < MIN_EVENTS')
})

test('formatStatsRows returns rows with required keys and no judgmental words', () => {
  const stats = {
    version: statsApi.STATS_VERSION,
    distanceM: 5000,
    avgSpeedKmh: 100,
    maxSpeedKmh: 150,
    movingMs: 180000,
    pedals: {
      fullThrottle: 0.4,
      partialThrottle: 0.2,
      coast: 0.2,
      brake: 0.2,
      brakeWithSteering: 0.05
    },
    braking: {
      count: 5,
      peakDecelG: { median: 1.12, p10: 1.0, p90: 1.2, max: 1.3 },
      durationS: { median: 2.5, p10: 2.0, p90: 3.0, max: 3.5 },
      releaseS: { median: 0.5, p10: 0.3, p90: 0.7, max: 0.9 },
      trailBrakingShare: 0.8
    },
    corners: {
      count: 5,
      lateralG: { median: 1.02, p10: 0.9, p90: 1.1, max: 1.2 },
      frontSlipDominantShare: 0.6
    },
    exits: {
      count: 5,
      toFullThrottleS: { median: 1.5, p10: 1.0, p90: 2.0, max: 2.5 },
      peakLongitudinalG: { median: 0.8, p10: 0.6, p90: 1.0, max: 1.1 }
    }
  }

  const rows = statsApi.formatStatsRows(stats)

  assert.ok(rows.length > 0, 'should have rows')
  const keys = new Set(rows.map(r => r.key))
  assert.ok(keys.has('overview'), 'should have overview row')
  assert.ok(keys.has('pedals'), 'should have pedals row')
  assert.ok(keys.has('braking'), 'should have braking row')
  assert.ok(keys.has('corners'), 'should have corners row')
  assert.ok(keys.has('exits'), 'should have exits row')

  // Check that all rows have required properties
  for (const row of rows) {
    assert.ok(typeof row.key === 'string', `row should have key property`)
    assert.ok(typeof row.label === 'string', `row should have label property`)
    assert.ok(row.count === null || typeof row.count === 'number', `row should have count property`)
    assert.ok(typeof row.text === 'string', `row should have text property`)
    assert.ok(typeof row.title === 'string', `row should have title property`)
  }

  // Check that no row contains judgmental words
  const judgmentalWords = ['good', 'bad', 'score', 'should', 'need', 'must', 'fail', 'pass']
  const allText = rows.map(r => r.text + ' ' + r.title).join(' ').toLowerCase()
  for (const word of judgmentalWords) {
    assert.ok(!allText.includes(word), `text should not contain judgmental word "${word}"`)
  }

  // Check for descriptive content
  const pedalRow = rows.find(r => r.key === 'pedals')
  assert.ok(pedalRow.text.includes('Full throttle'), 'pedal row should mention full throttle')
  assert.ok(pedalRow.text.includes('Brake'), 'pedal row should mention brake')

  const brakingRow = rows.find(r => r.key === 'braking')
  assert.ok(brakingRow.text.includes('peak'), 'braking row should mention peak decel')
  assert.ok(brakingRow.text.includes('trail braking'), 'braking row should mention trail braking')

  const cornersRow = rows.find(r => r.key === 'corners')
  assert.ok(cornersRow.text.includes('lateral'), 'corners row should mention lateral g')

  const exitsRow = rows.find(r => r.key === 'exits')
  assert.ok(exitsRow.text.includes('full throttle'), 'exits row should mention full throttle')
})

test('stats finalize returns null distributions when no events', () => {
  const stats = statsApi.createDriverAnalysisStats()

  // Update with a valid frame but no braking/corners/exits
  const sample = {
    timestampMs: 0,
    speedKmh: 100,
    throttle: 0.5,
    brake: 0,
    steer: 0,
    gear: 3,
    rpm: 5000,
    rpmMax: 8000,
    acceleration: { x: 0, y: 0, z: 0 },
    angularVelocity: { y: 0 },
    slipAngle: { fl: 0, fr: 0, rl: 0, rr: 0 },
    car: { ordinal: 1, pi: 800, drivetrain: 1 },
    steerMagnitude: 0,
    lateralResponse: 0,
    longitudinalResponse: 0,
    frontSlip: 0,
    rearSlip: 0,
    drivenSlip: 0
  }

  const snapshot = { valid: true, resetReason: null, phase: 'straight', maneuverId: 0, sample, previousSample: null }
  stats.update(snapshot)

  const result = stats.finalize()

  assert.equal(result.braking.count, 0)
  assert.equal(result.braking.peakDecelG, null)
  assert.equal(result.corners.count, 0)
  assert.equal(result.corners.lateralG, null)
  assert.equal(result.exits.count, 0)
  assert.equal(result.exits.toFullThrottleS, null)
})
