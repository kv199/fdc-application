const test = require('node:test')
const assert = require('node:assert/strict')

const stateApi = require('./driver-analysis-state.js')
const opportunitiesApi = require('./driver-analysis-opportunities.js')
const evidenceApi = require('./driver-analysis-evidence.js')
const scoringApi = require('./driver-analysis-scoring.js')
const engineApi = require('./driver-analysis-engine.js')

test('140ms full-lock steering pulse becomes invalid with steering_pulse invalidReason', () => {
  const collector = new opportunitiesApi.DriverAnalysisOpportunities()
  const samples = [
    { timestampMs: 0, speedKmh: 100, steerMagnitude: 1.0, steerRate: 2.0, frontSlip: 0.5, lateralResponse: 0.5, yawRate: 0.3 },
    { timestampMs: 140, speedKmh: 100, steerMagnitude: 0.05, steerRate: -6.8, frontSlip: 0.52, lateralResponse: 0.48, yawRate: 0.28 }
  ]
  samples.forEach((sample, index) => {
    collector.update({
      valid: true,
      phase: 'rotation',
      maneuverId: 1,
      sample,
      previousSample: samples[index - 1] || null
    })
  })
  const opportunities = collector.finalize()
  const frontScrub = opportunities.find(opp => opp.type === 'front_scrub')

  assert.ok(frontScrub, 'front_scrub opportunity created')
  assert.equal(frontScrub.valid, false, 'opportunity is invalid')
  assert.equal(frontScrub.invalidReason, 'steering_pulse', 'invalidReason is steering_pulse')
  assert.equal(frontScrub.outcome, 'incomplete')
})

test('sustained steering (>= 300ms) with frontSlip 0.5->1.05 and lateral loss 1.0 triggers front scrub', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  const car = { ordinal: 1, pi: 700, drivetrain: 1 }
  const frame = (timestampMs, steerMagnitude, frontSlip, lateralResponse, yawRate) => ({
    timestampMs,
    speedKmh: 100,
    isRaceOn: true,
    car,
    rpmMax: 8000,
    steer: steerMagnitude,
    brake: 0,
    throttle: 0,
    slipAngle: { fl: frontSlip, fr: frontSlip, rl: 0.03, rr: 0.03 },
    combinedSlip: { fl: frontSlip, fr: frontSlip, rl: 0.03, rr: 0.03 },
    acceleration: { x: lateralResponse, y: 0, z: 0 },
    angularVelocity: { y: yawRate }
  })

  engine.update(frame(0, 0.2, 0.5, 1.0, 0.4))
  engine.update(frame(100, 0.4, 0.7, 0.8, 0.3))
  engine.update(frame(200, 0.5, 0.9, 0.4, 0.15))
  engine.update(frame(300, 0.6, 1.05, 0.0, 0.1))

  const result = engine.finalize()
  const frontScrub = result.opportunities.find(opp => opp.type === 'front_scrub')

  // Add a clean counterexample from the same opportunity list for attribution
  const clean = {
    id: 'clean-1',
    type: 'front_scrub',
    maneuverId: 999,
    valid: true,
    outcome: 'clean',
    context: frontScrub.context,
    samples: [
      { timestampMs: 0, steerMagnitude: 0.2, steerRate: 0, frontSlip: 0.1, lateralResponse: 0.5, yawRate: 0.5 },
      { timestampMs: 100, steerMagnitude: 0.2, steerRate: 0, frontSlip: 0.11, lateralResponse: 0.55, yawRate: 0.54 }
    ]
  }

  const evidence = evidenceApi.analyzeOpportunities([clean, frontScrub], { cleanCounterexamples: [clean] })
  const result2 = evidence.find(e => e.type === 'front_scrub' && e.maneuverId === frontScrub.maneuverId)

  assert.ok(frontScrub, 'front_scrub opportunity exists')
  assert.equal(frontScrub.valid, true)
  assert.ok(result2, 'evidence exists')
  assert.equal(result2.outcome, 'problem', 'triggered as problem')
})

test('same sustained window with frontSlip peaking at 0.7 does not trigger', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  const car = { ordinal: 1, pi: 700, drivetrain: 1 }
  const frame = (timestampMs, steerMagnitude, frontSlip, lateralResponse, yawRate) => ({
    timestampMs,
    speedKmh: 100,
    isRaceOn: true,
    car,
    rpmMax: 8000,
    steer: steerMagnitude,
    brake: 0,
    throttle: 0,
    slipAngle: { fl: frontSlip, fr: frontSlip, rl: 0.03, rr: 0.03 },
    combinedSlip: { fl: frontSlip, fr: frontSlip, rl: 0.03, rr: 0.03 },
    acceleration: { x: lateralResponse, y: 0, z: 0 },
    angularVelocity: { y: yawRate }
  })

  engine.update(frame(0, 0.2, 0.5, 0.5, 0.4))
  engine.update(frame(100, 0.4, 0.6, 0.35, 0.3))
  engine.update(frame(200, 0.5, 0.7, 0.2, 0.15))
  engine.update(frame(300, 0.6, 0.65, -0.3, 0.1))

  const result = engine.finalize()
  const frontScrub = result.opportunities.find(opp => opp.type === 'front_scrub')
  const evidence = result.evidence.find(e => e.type === 'front_scrub')

  assert.ok(frontScrub, 'front_scrub opportunity exists')
  assert.ok(evidence, 'evidence exists')
  assert.notEqual(evidence.outcome, 'problem', 'does not trigger as problem with low peak slip')
})

test('sustained window with lateral loss 0.2 m/s² and yaw loss 0.01 rad/s does not trigger', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  const car = { ordinal: 1, pi: 700, drivetrain: 1 }
  const frame = (timestampMs, steerMagnitude, frontSlip, lateralResponse, yawRate) => ({
    timestampMs,
    speedKmh: 100,
    isRaceOn: true,
    car,
    rpmMax: 8000,
    steer: steerMagnitude,
    brake: 0,
    throttle: 0,
    slipAngle: { fl: frontSlip, fr: frontSlip, rl: 0.03, rr: 0.03 },
    combinedSlip: { fl: frontSlip, fr: frontSlip, rl: 0.03, rr: 0.03 },
    acceleration: { x: lateralResponse, y: 0, z: 0 },
    angularVelocity: { y: yawRate }
  })

  engine.update(frame(0, 0.2, 0.5, 0.5, 0.4))
  engine.update(frame(100, 0.4, 0.7, 0.4, 0.39))
  engine.update(frame(200, 0.5, 0.9, 0.35, 0.39))
  engine.update(frame(300, 0.6, 1.05, 0.3, 0.39))

  const result = engine.finalize()
  const frontScrub = result.opportunities.find(opp => opp.type === 'front_scrub')
  const evidence = result.evidence.find(e => e.type === 'front_scrub')

  assert.ok(frontScrub, 'front_scrub opportunity exists')
  assert.ok(evidence, 'evidence exists')
  assert.notEqual(evidence.outcome, 'problem', 'does not trigger with insufficient response loss')
})

test('engine snapshot algorithmVersion is driver-analysis-rules-v6', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  const snapshot = engine.snapshot()
  assert.equal(snapshot.algorithmVersion, 'driver-analysis-rules-v6')
})

test('EXIT-phase corner held at full throttle with sustained steering 300+ms, frontSlip 0.5->1.05, lateral loss 1.0 m/s² yields outcome problem', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  const car = { ordinal: 1, pi: 700, drivetrain: 1 }
  const frame = (timestampMs, steerMagnitude, frontSlip, lateralResponse, yawRate, throttle = 1.0) => ({
    timestampMs,
    speedKmh: 100,
    isRaceOn: true,
    car,
    rpmMax: 8000,
    steer: steerMagnitude,
    brake: 0,
    throttle,
    slipAngle: { fl: frontSlip, fr: frontSlip, rl: 0.03, rr: 0.03 },
    combinedSlip: { fl: frontSlip, fr: frontSlip, rl: 0.03, rr: 0.03 },
    acceleration: { x: lateralResponse, y: 0, z: 0 },
    angularVelocity: { y: yawRate }
  })

  engine.update(frame(0, 0.2, 0.5, 1.0, 0.4, 1.0))
  engine.update(frame(100, 0.4, 0.7, 0.8, 0.3, 1.0))
  engine.update(frame(200, 0.5, 0.9, 0.4, 0.15, 1.0))
  engine.update(frame(300, 0.6, 1.05, 0.0, 0.1, 1.0))

  const result = engine.finalize()
  const frontScrub = result.opportunities.find(opp => opp.type === 'front_scrub')

  const clean = {
    id: 'clean-exit-throttle',
    type: 'front_scrub',
    maneuverId: 999,
    valid: true,
    outcome: 'clean',
    context: frontScrub.context,
    samples: [
      { timestampMs: 0, steerMagnitude: 0.2, steerRate: 0, frontSlip: 0.1, lateralResponse: 0.5, yawRate: 0.5, throttle: 1.0 },
      { timestampMs: 100, steerMagnitude: 0.2, steerRate: 0, frontSlip: 0.11, lateralResponse: 0.55, yawRate: 0.54, throttle: 1.0 }
    ]
  }

  const evidence = evidenceApi.analyzeOpportunities([clean, frontScrub], { cleanCounterexamples: [clean] })
  const result2 = evidence.find(e => e.type === 'front_scrub' && e.maneuverId === frontScrub.maneuverId)

  assert.ok(frontScrub, 'front_scrub opportunity exists in EXIT phase')
  assert.equal(frontScrub.valid, true)
  assert.ok(result2, 'evidence exists')
  assert.equal(result2.outcome, 'problem', 'triggered as problem in EXIT phase')
})

test('EXIT-phase corner with throttle rising from 0.3 to 1.0 before slip rise yields outcome ambiguous with throttle_rise confounder', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  const car = { ordinal: 1, pi: 700, drivetrain: 1 }
  const frame = (timestampMs, steerMagnitude, frontSlip, lateralResponse, yawRate, throttle = 0) => ({
    timestampMs,
    speedKmh: 100,
    isRaceOn: true,
    car,
    rpmMax: 8000,
    steer: steerMagnitude,
    brake: 0,
    throttle,
    slipAngle: { fl: frontSlip, fr: frontSlip, rl: 0.03, rr: 0.03 },
    combinedSlip: { fl: frontSlip, fr: frontSlip, rl: 0.03, rr: 0.03 },
    acceleration: { x: lateralResponse, y: 0, z: 0 },
    angularVelocity: { y: yawRate }
  })

  engine.update(frame(0, 0.2, 0.5, 1.0, 0.4, 0.3))
  engine.update(frame(100, 0.4, 0.7, 0.8, 0.3, 0.6))
  engine.update(frame(200, 0.5, 0.9, 0.4, 0.15, 0.8))
  engine.update(frame(300, 0.6, 1.05, 0.0, 0.1, 1.0))

  const result = engine.finalize()
  const frontScrub = result.opportunities.find(opp => opp.type === 'front_scrub')

  const evidence = result.evidence.find(e => e.type === 'front_scrub')

  assert.ok(frontScrub, 'front_scrub opportunity exists')
  assert.equal(frontScrub.valid, true)
  assert.ok(evidence, 'evidence exists')
  assert.equal(evidence.outcome, 'ambiguous', 'outcome is ambiguous with throttle rise')
  assert.ok(evidence.confounders.includes('throttle_rise'), 'throttle_rise is in confounders')
})

test('EXIT-phase EXIT_WHEELSPIN opportunity still requires throttle >= 0.35 and EXIT phase (no regression)', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  const car = { ordinal: 1, pi: 700, drivetrain: 1 }
  const frame = (timestampMs, steerMagnitude, throttle = 0, drivenSlip = 0) => ({
    timestampMs,
    speedKmh: 100,
    isRaceOn: true,
    car,
    rpmMax: 8000,
    steer: steerMagnitude,
    brake: 0,
    throttle,
    slipRatio: { fl: drivenSlip, fr: drivenSlip, rl: drivenSlip, rr: drivenSlip },
    acceleration: { x: 0.5, y: 0, z: 2 },
    angularVelocity: { y: 0 }
  })

  engine.update(frame(0, 0.2, 0.1, 0.06))
  engine.update(frame(100, 0.3, 0.35, 0.1))
  engine.update(frame(200, 0.25, 0.8, 0.24))
  engine.update(frame(300, 0.2, 0.9, 0.3))

  const result = engine.finalize()
  const exitWheelspin = result.opportunities.find(opp => opp.type === 'exit_wheelspin')

  assert.ok(exitWheelspin, 'exit_wheelspin opportunity created')
})

test('EXIT-phase BRAKE_STEERING_OVERLOAD still not created (no regression)', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  const car = { ordinal: 1, pi: 700, drivetrain: 1 }
  const frame = (timestampMs, steerMagnitude, brake = 0) => ({
    timestampMs,
    speedKmh: 100,
    isRaceOn: true,
    car,
    rpmMax: 8000,
    steer: steerMagnitude,
    brake,
    throttle: 1.0,
    slipAngle: { fl: 0.4, fr: 0.4, rl: 0.03, rr: 0.03 },
    combinedSlip: { fl: 0.7, fr: 0.7, rl: 0.03, rr: 0.03 },
    acceleration: { x: 0.5, y: 0, z: 0 },
    angularVelocity: { y: 0.4 }
  })

  engine.update(frame(0, 0.25, 0.0))
  engine.update(frame(100, 0.32, 0.05))

  const result = engine.finalize()
  const brakeSteering = result.opportunities.find(opp => opp.type === 'brake_steering_overload')

  assert.equal(brakeSteering, undefined, 'brake_steering_overload not created in EXIT phase')
})

test('front_scrub opportunity context has onThrottle true when samples contain throttle >= 0.2', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  const car = { ordinal: 1, pi: 700, drivetrain: 1 }
  const frame = (timestampMs, steerMagnitude, frontSlip, lateralResponse, yawRate, throttle = 0) => ({
    timestampMs,
    speedKmh: 100,
    isRaceOn: true,
    car,
    rpmMax: 8000,
    steer: steerMagnitude,
    brake: 0,
    throttle,
    slipAngle: { fl: frontSlip, fr: frontSlip, rl: 0.03, rr: 0.03 },
    combinedSlip: { fl: frontSlip, fr: frontSlip, rl: 0.03, rr: 0.03 },
    acceleration: { x: lateralResponse, y: 0, z: 0 },
    angularVelocity: { y: yawRate }
  })

  engine.update(frame(0, 0.2, 0.5, 1.0, 0.4, 0.3))
  engine.update(frame(100, 0.4, 0.7, 0.8, 0.3, 0.5))
  engine.update(frame(200, 0.5, 0.9, 0.4, 0.15, 0.8))
  engine.update(frame(300, 0.6, 1.05, 0.0, 0.1, 1.0))

  const result = engine.finalize()
  const frontScrub = result.opportunities.find(opp => opp.type === 'front_scrub')

  assert.ok(frontScrub, 'front_scrub opportunity exists')
  assert.equal(frontScrub.context.onThrottle, true, 'context.onThrottle is true')
})
