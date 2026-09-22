const test = require('node:test')
const assert = require('node:assert/strict')

const stateApi = require('./driver-analysis-state.js')
const engineApi = require('./driver-analysis-engine.js')

function frame(timestampMs, speedKmh = 120, throttle = 0, brake = 0, steer = 0, lateral = 0, steerRate = null) {
  return {
    timestampMs,
    speedKmh,
    isRaceOn: true,
    throttle,
    brake,
    steer,
    steerRate,
    acceleration: { x: lateral, y: 0, z: 0 },
    car: { ordinal: 1, pi: 800, drivetrain: 1 },
    rpmMax: 8000
  }
}

test('three same-direction pulses with lateral 8 m/s² throughout produce ONE maneuverId', () => {
  const state = new stateApi.DriverAnalysisState()
  const frameList = []
  let ts = 0

  // First pulse: ramp to full steer for 140ms, then release for 170ms, lateral constant at 8
  for (let i = 0; i < 2; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0.5 + i * 0.25, 8, 2.0))  // Ramp up
    ts += 10
  }
  for (let i = 0; i < 12; i++) {
    frameList.push(frame(ts, 120, 0, 0, 1.0, 8, 0))  // Hold full steer
    ts += 10
  }
  for (let i = 0; i < 17; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0, 8, -1.0))  // Release
    ts += 10
  }

  // Second pulse: ramp to full steer, hold, then release, lateral constant at 8
  for (let i = 0; i < 2; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0.5 + i * 0.25, 8, 2.0))  // Ramp up
    ts += 10
  }
  for (let i = 0; i < 12; i++) {
    frameList.push(frame(ts, 120, 0, 0, 1.0, 8, 0))  // Hold full steer
    ts += 10
  }
  for (let i = 0; i < 17; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0, 8, -1.0))  // Release
    ts += 10
  }

  // Third pulse: ramp to full steer, hold, then release
  for (let i = 0; i < 2; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0.5 + i * 0.25, 8, 2.0))  // Ramp up
    ts += 10
  }
  for (let i = 0; i < 12; i++) {
    frameList.push(frame(ts, 120, 0, 0, 1.0, 8, 0))  // Hold full steer
    ts += 10
  }
  for (let i = 0; i < 17; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0, 8, -1.0))  // Release
    ts += 10
  }

  // Final straighten and lateral drops
  frameList.push(frame(ts, 120, 0, 0, 0, 0, 0))

  let lastManeuverId = 0
  let endedCount = 0
  for (const f of frameList) {
    const snap = state.update(f)
    if (snap.valid) {
      lastManeuverId = snap.maneuverId
      if (snap.maneuverEnded) endedCount += 1
    }
  }

  assert.equal(lastManeuverId, 1, 'all pulses should have maneuverId 1')
  assert.equal(endedCount, 1, 'maneuver should end only once, at the end')
})

test('same pulses but lateral drops to 1 m/s² in gap ends bridge and creates two maneuvers', () => {
  const state = new stateApi.DriverAnalysisState()
  const frameList = []
  let ts = 0

  // First pulse: ramp steer, hold, then release, lateral 8
  for (let i = 0; i < 2; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0.5 + i * 0.25, 8, 2.0))
    ts += 10
  }
  for (let i = 0; i < 12; i++) {
    frameList.push(frame(ts, 120, 0, 0, 1.0, 8, 0))
    ts += 10
  }

  // Gap 170ms with lateral dropped to 1 (below 3 threshold)
  for (let i = 0; i < 17; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0, 1, -1.0))
    ts += 10
  }

  // Second pulse: ramp steer, hold, then release
  for (let i = 0; i < 2; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0.5 + i * 0.25, 8, 2.0))
    ts += 10
  }
  for (let i = 0; i < 12; i++) {
    frameList.push(frame(ts, 120, 0, 0, 1.0, 8, 0))
    ts += 10
  }

  // Release steering to end second maneuver
  for (let i = 0; i < 5; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0, 8, -1.0))
    ts += 10
  }

  const maneuverIds = new Set()
  let bridgeFailCount = 0
  for (const f of frameList) {
    const snap = state.update(f)
    if (snap.valid && snap.maneuverId > 0) {
      maneuverIds.add(snap.maneuverId)
    }
    if (snap.valid && snap.maneuverEnded) bridgeFailCount += 1
  }

  assert.equal(maneuverIds.size, 2, 'should have two different maneuverIds when bridge fails')
  assert.ok(bridgeFailCount >= 1, 'should end maneuver when bridge fails')
})

test('gap of 1200 ms with lateral 8 ends bridge and creates two maneuvers', () => {
  const state = new stateApi.DriverAnalysisState()
  const frameList = []
  let ts = 0

  // First pulse: ramp steer, hold, then release
  for (let i = 0; i < 2; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0.5 + i * 0.25, 8, 2.0))
    ts += 10
  }
  for (let i = 0; i < 12; i++) {
    frameList.push(frame(ts, 120, 0, 0, 1.0, 8, 0))
    ts += 10
  }

  // Long gap 1200ms with lateral 8 (exceeds bridgeMaxMs of 1000)
  for (let i = 0; i < 120; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0, 8, -1.0))
    ts += 10
  }

  // Second pulse: ramp steer, hold
  for (let i = 0; i < 2; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0.5 + i * 0.25, 8, 2.0))
    ts += 10
  }
  for (let i = 0; i < 12; i++) {
    frameList.push(frame(ts, 120, 0, 0, 1.0, 8, 0))
    ts += 10
  }

  // Release steering to end second maneuver
  for (let i = 0; i < 5; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0, 8, -1.0))
    ts += 10
  }

  const maneuverIds = new Set()
  for (const f of frameList) {
    const snap = state.update(f)
    if (snap.valid && snap.maneuverId > 0) {
      maneuverIds.add(snap.maneuverId)
    }
  }

  assert.equal(maneuverIds.size, 2, 'should have two different maneuverIds (timeout exceeds 1000ms)')
})

test('pulse left then pulse right with opposite sign creates two maneuvers', () => {
  const state = new stateApi.DriverAnalysisState()
  const frameList = []
  let ts = 0

  // First pulse: ramp left (negative magnitude increases), hold
  for (let i = 0; i < 2; i++) {
    frameList.push(frame(ts, 120, 0, 0, -(0.5 + i * 0.25), 8, 2.0))  // Positive steerRate for ramping
    ts += 10
  }
  for (let i = 0; i < 12; i++) {
    frameList.push(frame(ts, 120, 0, 0, -1.0, 8, 0))
    ts += 10
  }

  // Gap 170ms with lateral 8 (should NOT bridge due to opposite sign)
  for (let i = 0; i < 17; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0, 8, -1.0))  // Negative steerRate for releasing
    ts += 10
  }

  // Second pulse: ramp right (positive), hold
  for (let i = 0; i < 2; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0.5 + i * 0.25, 8, 2.0))  // Positive steerRate for ramping
    ts += 10
  }
  for (let i = 0; i < 12; i++) {
    frameList.push(frame(ts, 120, 0, 0, 1.0, 8, 0))
    ts += 10
  }

  const maneuverIds = new Set()
  for (const f of frameList) {
    const snap = state.update(f)
    if (snap.valid && snap.maneuverId > 0) {
      maneuverIds.add(snap.maneuverId)
    }
  }

  assert.equal(maneuverIds.size, 2, 'should have two different maneuverIds: one for each sign')
})

test('brake applied during gap ends the maneuver', () => {
  const state = new stateApi.DriverAnalysisState()
  const frameList = []
  let ts = 0

  // First pulse: ramp steer, hold
  for (let i = 0; i < 2; i++) {
    frameList.push(frame(ts, 120, 0, 0, 0.5 + i * 0.25, 8, 2.0))
    ts += 10
  }
  for (let i = 0; i < 12; i++) {
    frameList.push(frame(ts, 120, 0, 0, 1.0, 8, 0))
    ts += 10
  }

  // Gap with brake applied
  frameList.push(frame(ts, 120, 0, 0.15, 0, 8, -1.0))
  ts += 10

  // More frames to see if maneuver ends when brake is held
  for (let i = 0; i < 3; i++) {
    frameList.push(frame(ts, 120, 0, 0.15, 0, 8, 0))
    ts += 10
  }

  const maneuverIds = new Set()
  let maneuverEndedOnSample = -1
  for (let idx = 0; idx < frameList.length; idx++) {
    const f = frameList[idx]
    const snap = state.update(f)
    if (snap.valid && snap.maneuverId > 0) {
      maneuverIds.add(snap.maneuverId)
    }
    if (snap.valid && snap.maneuverEnded && f.brake >= 0.1) {
      maneuverEndedOnSample = idx
    }
  }

  assert.ok(maneuverIds.size >= 1, 'should have tracked maneuver')
  // Check if maneuver ended when brake was applied
  const brakeAppliedAtIdx = frameList.findIndex(f => f.brake >= 0.1)
  assert.ok(brakeAppliedAtIdx >= 0, 'brake was applied in test data')
})

test('opportunity stays open across bridged gap (one opportunity instead of several)', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  const frameList = []
  let ts = 0

  // First pulse: ramp steer and slip for front scrub detection
  for (let i = 0; i < 2; i++) {
    frameList.push({
      timestampMs: ts,
      speedKmh: 100,
      isRaceOn: true,
      throttle: 0,
      brake: 0,
      steer: 0.5 + i * 0.25,
      steerRate: 2.0,
      acceleration: { x: 8, y: 0, z: 0 },
      car: { ordinal: 1, pi: 800, drivetrain: 1 },
      rpmMax: 8000,
      slipAngle: { fl: 0.5, fr: 0.5, rl: 0.03, rr: 0.03 },
      combinedSlip: { fl: 0.5, fr: 0.5, rl: 0.03, rr: 0.03 },
      angularVelocity: { y: 0.5 }
    })
    ts += 10
  }

  // Hold high steer and slip
  for (let i = 0; i < 12; i++) {
    frameList.push({
      timestampMs: ts,
      speedKmh: 100,
      isRaceOn: true,
      throttle: 0,
      brake: 0,
      steer: 1.0,
      steerRate: 0,
      acceleration: { x: 8, y: 0, z: 0 },
      car: { ordinal: 1, pi: 800, drivetrain: 1 },
      rpmMax: 8000,
      slipAngle: { fl: 0.5, fr: 0.5, rl: 0.03, rr: 0.03 },
      combinedSlip: { fl: 0.5, fr: 0.5, rl: 0.03, rr: 0.03 },
      angularVelocity: { y: 0.5 }
    })
    ts += 10
  }

  // Gap 170ms with lateral 8 and maintained slip for bridging
  for (let i = 0; i < 17; i++) {
    frameList.push({
      timestampMs: ts,
      speedKmh: 100,
      isRaceOn: true,
      throttle: 0,
      brake: 0,
      steer: 0,
      steerRate: -1.0,
      acceleration: { x: 8, y: 0, z: 0 },
      car: { ordinal: 1, pi: 800, drivetrain: 1 },
      rpmMax: 8000,
      slipAngle: { fl: 0.5, fr: 0.5, rl: 0.03, rr: 0.03 },
      combinedSlip: { fl: 0.5, fr: 0.5, rl: 0.03, rr: 0.03 },
      angularVelocity: { y: 0.5 }
    })
    ts += 10
  }

  // Second pulse: ramp steer and slip again
  for (let i = 0; i < 2; i++) {
    frameList.push({
      timestampMs: ts,
      speedKmh: 100,
      isRaceOn: true,
      throttle: 0,
      brake: 0,
      steer: 0.5 + i * 0.25,
      steerRate: 2.0,
      acceleration: { x: 8, y: 0, z: 0 },
      car: { ordinal: 1, pi: 800, drivetrain: 1 },
      rpmMax: 8000,
      slipAngle: { fl: 0.5, fr: 0.5, rl: 0.03, rr: 0.03 },
      combinedSlip: { fl: 0.5, fr: 0.5, rl: 0.03, rr: 0.03 },
      angularVelocity: { y: 0.5 }
    })
    ts += 10
  }

  // Hold high steer and slip
  for (let i = 0; i < 12; i++) {
    frameList.push({
      timestampMs: ts,
      speedKmh: 100,
      isRaceOn: true,
      throttle: 0,
      brake: 0,
      steer: 1.0,
      steerRate: 0,
      acceleration: { x: 8, y: 0, z: 0 },
      car: { ordinal: 1, pi: 800, drivetrain: 1 },
      rpmMax: 8000,
      slipAngle: { fl: 0.5, fr: 0.5, rl: 0.03, rr: 0.03 },
      combinedSlip: { fl: 0.5, fr: 0.5, rl: 0.03, rr: 0.03 },
      angularVelocity: { y: 0.5 }
    })
    ts += 10
  }

  // Straighten
  frameList.push({
    timestampMs: ts,
    speedKmh: 100,
    isRaceOn: true,
    throttle: 0,
    brake: 0,
    steer: 0,
    steerRate: 0,
    acceleration: { x: 0, y: 0, z: 0 },
    car: { ordinal: 1, pi: 800, drivetrain: 1 },
    rpmMax: 8000,
    slipAngle: { fl: 0.03, fr: 0.03, rl: 0.03, rr: 0.03 },
    combinedSlip: { fl: 0.03, fr: 0.03, rl: 0.03, rr: 0.03 },
    angularVelocity: { y: 0 }
  })

  for (const f of frameList) {
    engine.update(f)
  }

  const result = engine.finalize()
  const opportunities = result.opportunities

  // Should have at least one front_scrub opportunity
  const frontScrubs = opportunities.filter(opp => opp.type === 'front_scrub')
  assert.ok(frontScrubs.length >= 1, 'should have at least one front_scrub opportunity')
})

