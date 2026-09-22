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
  assert.equal(statsApi.STATS_VERSION, 4)
})

test('DEFAULT_THRESHOLDS includes required configuration', () => {
  const thresholds = statsApi.DEFAULT_THRESHOLDS
  assert.ok(thresholds.maxStepMs > 0)
  assert.ok(thresholds.movingKmh >= 0)
  assert.ok(thresholds.brakeOn > 0)
  assert.ok(thresholds.brakeOff > 0)
  assert.ok(thresholds.brakeOff < thresholds.brakeOn)
  assert.ok(thresholds.smoothingWindowMs > 0)
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

    // Braking with steering at the end (trail braking with >= 0.3 brake for >= 250ms)
    for (let i = 0; i < 25; i++) {
      const speed = Math.max(30, 40 - i * 0.4)
      const steerAmount = (i / 25) * 0.5
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

  // Lateral G should be close to 10/9.80665 (~1.02), but smoothing may reduce it slightly
  const expectedLateralG = 10 / 9.80665
  assert.ok(stats.corners.lateralG.median !== null, 'lateral G median should not be null')
  assert.ok(Math.abs(stats.corners.lateralG.median - expectedLateralG) < 0.08,
    `lateral G should be close to ~${expectedLateralG}, got ${stats.corners.lateralG.median}`)

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

test('single-frame lateral spike does not dominate corner peak', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  let timestampMs = 0
  const rpmMax = 8000
  let lapDistance = 0
  let lapCount = 1

  const driveFrame = (speedKmh, throttle, brake, steer, lateralAccel = null) => {
    const frame = {
      timestampMs,
      speedKmh,
      throttle,
      brake,
      steer,
      gear: 3,
      rpm: speedKmh > 20 ? 4000 + speedKmh * 30 : 1000,
      rpmMax,
      isRaceOn: true,
      car: { ordinal: 1, pi: 800, drivetrain: 1 },
      acceleration: {
        x: lateralAccel !== null ? lateralAccel : (steer !== 0 ? steer * 10 : 0),
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

  // Simulate a corner with mostly ~10 m/s² lateral (1.02 g)
  // but one spike frame at 60 m/s² (6.1 g)
  for (let i = 0; i < 30; i++) {
    const steer = Math.sin((i / 30) * Math.PI) * 0.5
    const speed = 60 + Math.sin((i / 30) * Math.PI) * 20
    let lateralAccel = null
    if (i === 15) {
      // Single spike frame at peak of turn
      lateralAccel = 60
    }
    engine.update(driveFrame(speed, 0, 0, steer, lateralAccel))
  }

  // Exit turn
  for (let i = 0; i < 25; i++) {
    const throttleAmount = (i / 25) * 0.98
    const speed = 60 + i * 3
    engine.update(driveFrame(speed, throttleAmount, 0, 0.1 * (1 - i / 25)))
  }

  const result = engine.finalize()
  const stats = result.stats

  assert.ok(stats.corners.count >= 1, 'should have at least 1 corner')
  assert.ok(stats.corners.lateralG.p90 !== null, 'should have p90 for lateral g')
  // Peak should be the 95th percentile, not affected much by single spike
  // Expected: smoothed values mostly around 1.02 g, so p90 should be around 1.2-1.3 g
  assert.ok(stats.corners.lateralG.p90 < 2, `peak lateral should be smoothed, got ${stats.corners.lateralG.p90} g`)
})

test('single-frame braking spike does not dominate peak decel', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  let timestampMs = 0
  const rpmMax = 8000
  let lapDistance = 0
  let lapCount = 1

  const driveFrame = (speedKmh, throttle, brake, steer, brakingAccel = null) => {
    const frame = {
      timestampMs,
      speedKmh,
      throttle,
      brake,
      steer,
      gear: 3,
      rpm: speedKmh > 20 ? 4000 + speedKmh * 30 : 1000,
      rpmMax,
      isRaceOn: true,
      car: { ordinal: 1, pi: 800, drivetrain: 1 },
      acceleration: {
        x: steer !== 0 ? steer * 20 : 0,
        y: 0,
        z: brakingAccel !== null ? brakingAccel : (brake > 0.1 ? -11 : (throttle > 0.5 ? throttle * 8 : 0))
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

  // Multiple braking events with one spike frame each
  for (let event = 0; event < 5; event++) {
    // Build speed before braking
    for (let i = 0; i < 20; i++) {
      engine.update(driveFrame(200 - i * 2, 0.98, 0, 0))
    }

    // Braking event with one spike: 40 frames = 640ms (> 300ms minimum)
    for (let i = 0; i < 40; i++) {
      const speed = Math.max(50, 200 - i * 3.75)
      let brakingAccel = null
      if (i === 20) {
        // Single spike at -30 m/s² instead of -11
        brakingAccel = -30
      }
      engine.update(driveFrame(speed, 0, 0.9, 0, brakingAccel))
    }
  }

  const result = engine.finalize()
  const stats = result.stats

  assert.ok(stats.braking.count >= 3, `should have at least 3 braking events, got ${stats.braking.count}`)
  assert.ok(stats.braking.peakDecelG.median !== null, 'should have peak decel median')
  // Peak decel should be around 1.12 g (11 m/s²), not dominated by the single spike
  // Even with smoothing, values shouldn't exceed ~1.5 g
  assert.ok(stats.braking.peakDecelG.median < 1.8, `peak decel should be smoothed, got ${stats.braking.peakDecelG.median} g`)
})

test('flat-out corner excluded from exits, lifted corner included', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  let timestampMs = 0
  const rpmMax = 8000
  let lapDistance = 0
  let lapCount = 1

  const driveFrame = (speedKmh, throttle, brake, steer) => {
    const frame = {
      timestampMs,
      speedKmh,
      throttle,
      brake,
      steer,
      gear: 3,
      rpm: speedKmh > 20 ? 4000 + speedKmh * 30 : 1000,
      rpmMax,
      isRaceOn: true,
      car: { ordinal: 1, pi: 800, drivetrain: 1 },
      acceleration: {
        x: steer !== 0 ? steer * 10 : 0,
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

  // Flat-out corner: no brake, full throttle throughout
  for (let i = 0; i < 30; i++) {
    const steer = Math.sin((i / 30) * Math.PI) * 0.5
    const speed = 60 + Math.sin((i / 30) * Math.PI) * 20
    engine.update(driveFrame(speed, 0.98, 0, steer))
  }

  // Exit with full throttle
  for (let i = 0; i < 50; i++) {
    const speed = 60 + i * 3
    engine.update(driveFrame(speed, 0.98, 0, 0.1 * Math.max(0, 1 - i / 25)))
  }

  // Lifted corner: no throttle during turn
  for (let i = 0; i < 30; i++) {
    const steer = Math.sin((i / 30) * Math.PI) * 0.5
    const speed = 60 + Math.sin((i / 30) * Math.PI) * 20
    engine.update(driveFrame(speed, 0, 0, steer))
  }

  // Exit with throttle ramp to full
  for (let i = 0; i < 50; i++) {
    const throttleAmount = (i / 50) * 0.98
    const speed = 60 + i * 2
    engine.update(driveFrame(speed, throttleAmount, 0, 0.1 * Math.max(0, 1 - i / 25)))
  }

  const result = engine.finalize()
  const stats = result.stats

  assert.equal(stats.corners.count, 2, `should have 2 corners, got ${stats.corners.count}`)
  assert.equal(stats.corners.flatOutCount, 1, `should have 1 flat-out corner, got ${stats.corners.flatOutCount}`)
  assert.equal(stats.exits.count, 1, `should have 1 exit (only lifted corners with full throttle), got ${stats.exits.count}`)
  if (stats.exits.count > 0) {
    assert.ok(stats.exits.toFullThrottleS.median > 0, 'lifted corner exit should have positive time to full throttle')
  }
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
    corners: { count: 1, flatOutCount: 0, lateralG: null },
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
      flatOutCount: 1,
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
  assert.ok(cornersRow.text.includes('peak'), 'corners row should mention peak lateral')
  assert.ok(cornersRow.text.includes('flat-out'), 'corners row should mention flat-out count')

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
  assert.equal(result.corners.flatOutCount, 0)
  assert.equal(result.corners.lateralG, null)
  assert.equal(result.exits.count, 0)
  assert.equal(result.exits.toFullThrottleS, null)
})

test('trail braking: light brake tail without steering is not trail braking', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  let timestampMs = 0
  const rpmMax = 8000
  let lapDistance = 0
  let lapCount = 1

  const driveFrame = (speedKmh, throttle, brake, steer) => {
    const frame = {
      timestampMs,
      speedKmh,
      throttle,
      brake,
      steer,
      gear: 3,
      rpm: speedKmh > 20 ? 4000 + speedKmh * 30 : 1000,
      rpmMax,
      isRaceOn: true,
      car: { ordinal: 1, pi: 800, drivetrain: 1 },
      acceleration: {
        x: 0,
        y: 0,
        z: brake > 0.1 ? -11 : 0
      },
      angularVelocity: { y: 0 },
      slipAngle: {
        fl: 0,
        fr: 0,
        rl: 0,
        rr: 0
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

  // Hard braking straight (no steering)
  for (let i = 0; i < 30; i++) {
    const speed = Math.max(40, 100 - i * 2)
    engine.update(driveFrame(speed, 0, 0.9, 0))
  }

  // Light brake tail only (0.15) with steering - should NOT count as trail braking
  for (let i = 0; i < 20; i++) {
    const speed = Math.max(30, 40 - i * 0.5)
    const steer = 0.4
    engine.update(driveFrame(speed, 0, 0.15, steer))
  }

  // Release brake completely
  for (let i = 0; i < 10; i++) {
    engine.update(driveFrame(25, 0, 0, 0.4))
  }

  const result = engine.finalize()
  const stats = result.stats

  assert.ok(stats.braking.count >= 1, `should have at least 1 braking event, got ${stats.braking.count}`)
  assert.equal(stats.braking.trailBrakingShare, 0, 'light brake tail (0.15) should not trigger trail braking (0%)')
})

test('trail braking: brake >= 0.3 with steering after straight start IS trail braking', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  let timestampMs = 0
  const rpmMax = 8000
  let lapDistance = 0
  let lapCount = 1

  const driveFrame = (speedKmh, throttle, brake, steer) => {
    const frame = {
      timestampMs,
      speedKmh,
      throttle,
      brake,
      steer,
      gear: 3,
      rpm: speedKmh > 20 ? 4000 + speedKmh * 30 : 1000,
      rpmMax,
      isRaceOn: true,
      car: { ordinal: 1, pi: 800, drivetrain: 1 },
      acceleration: {
        x: 0,
        y: 0,
        z: brake > 0.1 ? -11 : 0
      },
      angularVelocity: { y: 0 },
      slipAngle: {
        fl: 0,
        fr: 0,
        rl: 0,
        rr: 0
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

  // Hard braking straight (no steering) - starts straight
  for (let i = 0; i < 30; i++) {
    const speed = Math.max(40, 100 - i * 2)
    engine.update(driveFrame(speed, 0, 0.9, 0))
  }

  // Brake >= 0.3 with steering for ~0.5 s (31 frames * 16ms ≈ 496ms of trail braking overlap)
  for (let i = 0; i < 31; i++) {
    const speed = Math.max(30, 40 - i * 0.3)
    const steer = 0.4
    engine.update(driveFrame(speed, 0, 0.5, steer))
  }

  // Release brake
  for (let i = 0; i < 10; i++) {
    engine.update(driveFrame(20, 0, 0, 0.4))
  }

  const result = engine.finalize()
  const stats = result.stats

  assert.ok(stats.braking.count >= 1, `should have at least 1 braking event, got ${stats.braking.count}`)
  assert.equal(stats.braking.trailBrakingShare, 1, 'brake >= 0.3 with steering for >= 250ms should be trail braking')
  assert.ok(stats.braking.trailOverlapS !== null, 'trail braking events should have trailOverlapS distribution')
  assert.ok(stats.braking.trailOverlapS.median !== null, 'trailOverlapS.median should not be null')
  const medianTrailS = stats.braking.trailOverlapS.median
  assert.ok(Math.abs(medianTrailS - 0.5) < 0.05, `trailOverlapS.median should be ~0.5s, got ${medianTrailS}s`)
})

test('trail braking: event starting with steering already applied excluded from share denominator', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  let timestampMs = 0
  const rpmMax = 8000
  let lapDistance = 0
  let lapCount = 1

  const driveFrame = (speedKmh, throttle, brake, steer) => {
    const frame = {
      timestampMs,
      speedKmh,
      throttle,
      brake,
      steer,
      gear: 3,
      rpm: speedKmh > 20 ? 4000 + speedKmh * 30 : 1000,
      rpmMax,
      isRaceOn: true,
      car: { ordinal: 1, pi: 800, drivetrain: 1 },
      acceleration: {
        x: 0,
        y: 0,
        z: brake > 0.1 ? -11 : 0
      },
      angularVelocity: { y: 0 },
      slipAngle: {
        fl: 0,
        fr: 0,
        rl: 0,
        rr: 0
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

  // Event 1: brake straight, then with steering (counted in denominator)
  for (let i = 0; i < 25; i++) {
    const speed = Math.max(40, 100 - i * 2.4)
    engine.update(driveFrame(speed, 0, 0.9, 0))
  }
  for (let i = 0; i < 20; i++) {
    const speed = Math.max(30, 40 - i * 0.5)
    engine.update(driveFrame(speed, 0, 0.5, 0.4))
  }

  // Release brake completely to close Event 1
  for (let i = 0; i < 10; i++) {
    engine.update(driveFrame(20, 0, 0, 0))
  }

  // Event 2: brake with steering already applied (NOT counted in denominator)
  for (let i = 0; i < 25; i++) {
    const speed = Math.max(40, 100 - i * 2.4)
    engine.update(driveFrame(speed, 0, 0.9, 0.4))
  }
  for (let i = 0; i < 20; i++) {
    const speed = Math.max(30, 40 - i * 0.5)
    engine.update(driveFrame(speed, 0, 0.5, 0.4))
  }

  // Release brake completely to close Event 2
  for (let i = 0; i < 10; i++) {
    engine.update(driveFrame(20, 0, 0, 0))
  }

  const result = engine.finalize()
  const stats = result.stats

  assert.equal(stats.braking.straightStartCount, 1, 'straightStartCount should be 1 (only first event started straight)')
  assert.equal(stats.braking.count, 2, 'should have 2 total braking events')
})

test('trail braking: 0.2s overlap below 250ms threshold is not trail braking', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  let timestampMs = 0
  const rpmMax = 8000
  let lapDistance = 0
  let lapCount = 1

  const driveFrame = (speedKmh, throttle, brake, steer) => {
    const frame = {
      timestampMs,
      speedKmh,
      throttle,
      brake,
      steer,
      gear: 3,
      rpm: speedKmh > 20 ? 4000 + speedKmh * 30 : 1000,
      rpmMax,
      isRaceOn: true,
      car: { ordinal: 1, pi: 800, drivetrain: 1 },
      acceleration: {
        x: 0,
        y: 0,
        z: brake > 0.1 ? -11 : 0
      },
      angularVelocity: { y: 0 },
      slipAngle: {
        fl: 0,
        fr: 0,
        rl: 0,
        rr: 0
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

  // Brake straight for 25 frames (~400ms)
  for (let i = 0; i < 25; i++) {
    const speed = Math.max(40, 100 - i * 2.4)
    engine.update(driveFrame(speed, 0, 0.9, 0))
  }

  // Trail braking overlap of only 0.2s (12 frames * 16ms ≈ 192ms) - below 250ms
  for (let i = 0; i < 12; i++) {
    const speed = Math.max(30, 40 - i * 0.83)
    engine.update(driveFrame(speed, 0, 0.5, 0.4))
  }

  // Release
  for (let i = 0; i < 10; i++) {
    engine.update(driveFrame(20, 0, 0, 0.4))
  }

  const result = engine.finalize()
  const stats = result.stats

  assert.equal(stats.braking.count, 1, 'should have 1 braking event')
  assert.equal(stats.braking.trailBrakingShare, 0, 'overlap of 0.2s (< 250ms) should not be trail braking (0%)')
})

test('formatStatsRows shows trail braking with median time', () => {
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
      straightStartCount: 2,
      trailBrakingShare: 0.5,
      trailOverlapS: { median: 0.5, p10: 0.3, p90: 0.7, max: 0.8 }
    },
    corners: {
      count: 5,
      flatOutCount: 1,
      lateralG: { median: 1.02, p10: 0.9, p90: 1.1, max: 1.2 }
    },
    exits: {
      count: 5,
      toFullThrottleS: { median: 1.5, p10: 1.0, p90: 2.0, max: 2.5 },
      peakLongitudinalG: { median: 0.8, p10: 0.6, p90: 1.0, max: 1.1 }
    }
  }

  const rows = statsApi.formatStatsRows(stats)
  const brakingRow = rows.find(r => r.key === 'braking')

  assert.ok(brakingRow, 'should have braking row')
  assert.ok(brakingRow.text.includes('trail braking 50%'), 'should show trail braking percentage')
  assert.ok(brakingRow.text.includes('(0.5 s)'), 'should show trail braking median time in parentheses')
  assert.ok(brakingRow.title.includes('0.3–0.7 s trail braking'), 'should show trail braking range in title')
})

test('steering: smooth steering at 0.5 gives 0% full lock', () => {
  const stats = statsApi.createDriverAnalysisStats()
  const car = { ordinal: 1, pi: 800, drivetrain: 1 }
  let timestampMs = 0

  const sample = (speed, steer) => {
    const s = {
      timestampMs,
      speedKmh: speed,
      throttle: 0.5,
      brake: 0,
      steer,
      gear: 3,
      rpm: 3000,
      rpmMax: 8000,
      acceleration: { x: steer * 10, y: 0, z: 0 },
      angularVelocity: { y: 0 },
      slipAngle: { fl: 0.05, fr: 0.05, rl: 0.03, rr: 0.03 },
      car,
      steerMagnitude: Math.abs(steer),
      lateralResponse: 0,
      longitudinalResponse: 0,
      frontSlip: 0.05,
      rearSlip: 0.03,
      drivenSlip: 0
    }
    timestampMs += 16
    return s
  }

  // Smooth steering at 0.5 for 1 second (62 frames)
  let prevSample = null
  for (let i = 0; i < 62; i++) {
    const s = sample(60, 0.5)
    const snapshot = { valid: true, resetReason: null, phase: 'turn-in', maneuverId: 1, sample: s, previousSample: prevSample }
    stats.update(snapshot)
    prevSample = s
  }

  const result = stats.finalize()

  assert.ok(result.steering, 'should have steering stats')
  assert.equal(result.steering.fullLockShare, 0, 'steering at 0.5 should have 0% full lock')
})

test('steering: full-lock pulses counted per corner', () => {
  const stats = statsApi.createDriverAnalysisStats()
  const car = { ordinal: 1, pi: 800, drivetrain: 1 }
  let timestampMs = 0

  const sample = (speed, steer) => {
    const s = {
      timestampMs,
      speedKmh: speed,
      throttle: 0.5,
      brake: 0,
      steer,
      gear: 3,
      rpm: 3000,
      rpmMax: 8000,
      acceleration: { x: steer * 10, y: 0, z: 0 },
      angularVelocity: { y: 0 },
      slipAngle: { fl: 0.05, fr: 0.05, rl: 0.03, rr: 0.03 },
      car,
      steerMagnitude: Math.abs(steer),
      lateralResponse: 0,
      longitudinalResponse: 0,
      frontSlip: 0.05,
      rearSlip: 0.03,
      drivenSlip: 0
    }
    timestampMs += 16
    return s
  }

  // Three full-lock entries with releases between (staying within corner phase)
  // Entry 1: transition to full lock
  let prevSample = sample(60, 0.3)
  let snapshot = { valid: true, resetReason: null, phase: 'turn-in', maneuverId: 1, sample: prevSample, previousSample: null }
  stats.update(snapshot)

  // Full lock for 10 frames
  for (let i = 0; i < 10; i++) {
    const s = sample(60, 1.0)
    snapshot = { valid: true, resetReason: null, phase: 'rotation', maneuverId: 1, sample: s, previousSample: prevSample }
    stats.update(snapshot)
    prevSample = s
  }

  // Release to 0.3 for 5 frames
  for (let i = 0; i < 5; i++) {
    const s = sample(60, 0.3)
    snapshot = { valid: true, resetReason: null, phase: 'rotation', maneuverId: 1, sample: s, previousSample: prevSample }
    stats.update(snapshot)
    prevSample = s
  }

  // Entry 2: transition to full lock
  for (let i = 0; i < 10; i++) {
    const s = sample(60, 1.0)
    snapshot = { valid: true, resetReason: null, phase: 'rotation', maneuverId: 1, sample: s, previousSample: prevSample }
    stats.update(snapshot)
    prevSample = s
  }

  // Release to 0.3 for 5 frames
  for (let i = 0; i < 5; i++) {
    const s = sample(60, 0.3)
    snapshot = { valid: true, resetReason: null, phase: 'rotation', maneuverId: 1, sample: s, previousSample: prevSample }
    stats.update(snapshot)
    prevSample = s
  }

  // Entry 3: transition to full lock
  for (let i = 0; i < 10; i++) {
    const s = sample(60, 1.0)
    snapshot = { valid: true, resetReason: null, phase: 'rotation', maneuverId: 1, sample: s, previousSample: prevSample }
    stats.update(snapshot)
    prevSample = s
  }

  // Release to 0.3 for 20 frames
  for (let i = 0; i < 20; i++) {
    const s = sample(60, 0.3)
    snapshot = { valid: true, resetReason: null, phase: 'exit', maneuverId: 1, sample: s, previousSample: prevSample }
    stats.update(snapshot)
    prevSample = s
  }

  const result = stats.finalize()

  assert.ok(result.corners.count >= 1, 'should have at least 1 corner')
  assert.ok(result.steering.pulsesPerCorner, 'should have pulsesPerCorner distribution')
  assert.equal(result.steering.pulsesPerCorner.median, 3, 'corner should have median 3 full-lock pulses')
})

test('steering: fullLockShare 0.5 for period half at 1.0 and half at 0.5', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  let timestampMs = 0
  const rpmMax = 8000
  let lapDistance = 0
  let lapCount = 1

  const driveFrame = (speedKmh, throttle, brake, steer) => {
    const frame = {
      timestampMs,
      speedKmh,
      throttle,
      brake,
      steer,
      gear: 3,
      rpm: speedKmh > 20 ? 4000 + speedKmh * 30 : 1000,
      rpmMax,
      isRaceOn: true,
      car: { ordinal: 1, pi: 800, drivetrain: 1 },
      acceleration: {
        x: steer !== 0 ? steer * 10 : 0,
        y: 0,
        z: 0
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

  // Half the period at full lock (1.0): 31 frames ~496ms
  for (let i = 0; i < 31; i++) engine.update(driveFrame(60, 0, 0, 1.0))
  // Half at partial steering (0.5): 31 frames ~496ms
  for (let i = 0; i < 31; i++) engine.update(driveFrame(60, 0, 0, 0.5))

  // Exit
  for (let i = 0; i < 25; i++) {
    engine.update(driveFrame(60 + i * 2, i / 25 * 0.98, 0, 0.1))
  }

  const result = engine.finalize()
  const stats = result.stats

  assert.ok(stats.steering, 'should have steering stats')
  assert.ok(Math.abs(stats.steering.fullLockShare - 0.5) < 0.05, `fullLockShare should be ~0.5, got ${stats.steering.fullLockShare}`)
})

test('formatStatsRows includes steering row with correct order and content', () => {
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
    steering: {
      fullLockShare: 0.68,
      pulsesPerCorner: { median: 5, p10: 3, p90: 7, max: 10 },
      cornersWithoutFullLock: 12
    },
    braking: {
      count: 5,
      peakDecelG: { median: 1.12, p10: 1.0, p90: 1.2, max: 1.3 },
      durationS: { median: 2.5, p10: 2.0, p90: 3.0, max: 3.5 },
      releaseS: { median: 0.5, p10: 0.3, p90: 0.7, max: 0.9 },
      straightStartCount: 2
    },
    corners: {
      count: 40,
      flatOutCount: 1,
      lateralG: { median: 1.02, p10: 0.9, p90: 1.1, max: 1.2 }
    },
    exits: {
      count: 5,
      toFullThrottleS: { median: 1.5, p10: 1.0, p90: 2.0, max: 2.5 },
      peakLongitudinalG: { median: 0.8, p10: 0.6, p90: 1.0, max: 1.1 }
    }
  }

  const rows = statsApi.formatStatsRows(stats)
  const keys = rows.map(r => r.key)

  // Check row order: overview, pedals, steering, braking, corners, exits
  const expectedOrder = ['overview', 'pedals', 'steering', 'braking', 'corners', 'exits']
  assert.deepEqual(keys, expectedOrder, `row order should be ${expectedOrder.join(', ')}, got ${keys.join(', ')}`)

  const steeringRow = rows.find(r => r.key === 'steering')
  assert.ok(steeringRow, 'should have steering row')
  assert.ok(steeringRow.text.includes('full lock 68% of steering time'), 'should include full lock percentage')
  assert.ok(steeringRow.text.includes('5 full-lock pulses per corner'), 'should include pulse median (not singular)')
  assert.ok(steeringRow.text.includes('no full lock in 12 of 40 corners'), 'should include corners without full lock')
  assert.ok(steeringRow.title.includes('3–7 full-lock pulses per corner'), 'should include range in title')
})

test('steering: singular "pulse" when median is 1', () => {
  const stats = {
    version: statsApi.STATS_VERSION,
    distanceM: 1000,
    avgSpeedKmh: 50,
    maxSpeedKmh: 100,
    movingMs: 72000,
    pedals: { fullThrottle: 0.2, partialThrottle: 0.2, coast: 0.2, brake: 0.2, brakeWithSteering: 0 },
    steering: {
      fullLockShare: 0.3,
      pulsesPerCorner: { median: 1, p10: 1, p90: 1, max: 1 },
      cornersWithoutFullLock: 0
    },
    braking: { count: 0 },
    corners: { count: 5, flatOutCount: 0, lateralG: null },
    exits: { count: 0 }
  }

  const rows = statsApi.formatStatsRows(stats)
  const steeringRow = rows.find(r => r.key === 'steering')

  assert.ok(steeringRow.text.includes('1 full-lock pulse per corner'), 'should use singular "pulse" when median is 1')
})
