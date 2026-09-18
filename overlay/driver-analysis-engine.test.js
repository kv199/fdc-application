const test = require('node:test')
const assert = require('node:assert/strict')

const stateApi = require('./driver-analysis-state.js')
const opportunitiesApi = require('./driver-analysis-opportunities.js')
const evidenceApi = require('./driver-analysis-evidence.js')
const scoringApi = require('./driver-analysis-scoring.js')
const engineApi = require('./driver-analysis-engine.js')

function snapshot(type, maneuverId, samples, context = {}) {
  return {
    id: `op-${type}-${maneuverId}`,
    type,
    maneuverId,
    startedAtMs: samples[0]?.timestampMs || 0,
    endedAtMs: samples.at(-1)?.timestampMs || 0,
    durationMs: Math.max(0, (samples.at(-1)?.timestampMs || 0) - (samples[0]?.timestampMs || 0)),
    context: { carIdentity: '1:700:8000:1', speedBin: 4, gear: 3, drivetrain: 1, ...context },
    samples,
    preTriggerSample: samples[0],
    valid: true,
    outcome: 'clean',
    invalidReason: null
  }
}

function frontSamples(offset = 0) {
  return [
    { timestampMs: offset + 0, steerMagnitude: 0.2, steerRate: 0.15, frontSlip: 0.12, lateralResponse: 0.55, yawRate: 0.55, speedKmh: 100 },
    { timestampMs: offset + 100, steerMagnitude: 0.34, steerRate: 0.08, frontSlip: 0.19, lateralResponse: 0.42, yawRate: 0.41, speedKmh: 99 }
  ]
}

function qualifies(kind, maneuverId, offset = 0) {
  const base = { timestampMs: offset, speedKmh: 100, carIdentity: '1:700:8000:1', gear: 3, drivetrain: 1 }
  const samples = kind === 'front_scrub'
    ? frontSamples(offset)
    : kind === 'exit_wheelspin'
      ? [
          { ...base, timestampMs: offset, throttle: 0.35, throttleRate: 0.2, drivenSlip: 0.06, effectiveAcceleration: 0.8, steerMagnitude: 0.2 },
          { ...base, timestampMs: offset + 100, throttle: 0.8, throttleRate: 0.4, drivenSlip: 0.24, effectiveAcceleration: 0.6, steerMagnitude: 0.18 }
        ]
      : kind === 'brake_steering_overload'
        ? [
            { ...base, timestampMs: offset, brake: 0.4, steerMagnitude: 0.25, frontCombinedSlip: 0.7, lateralResponse: 0.55, yawRate: 0.55 },
            { ...base, timestampMs: offset + 100, brake: 0.45, steerMagnitude: 0.32, frontCombinedSlip: 0.95, lateralResponse: 0.4, yawRate: 0.38 }
          ]
        : [
            { ...base, timestampMs: offset, brake: 0.1, brakeRate: -2.4, rearSlip: 0.08, lateralResponse: 0.5, yawRate: 0.5 },
            { ...base, timestampMs: offset + 100, brake: 0.04, brakeRate: -0.5, rearSlip: 0.2, lateralResponse: 0.25, yawRate: 0.22 }
          ]
  return snapshot(kind, maneuverId, samples)
}

test('normalizes queueTelemetry samples and creates map-free maneuvers', () => {
  const state = new stateApi.DriverAnalysisState()
  const car = { ordinal: 1, pi: 700, drivetrain: 1 }
  const first = state.update({ timestampMs: 0, speedKmh: 100, isRaceOn: true, car, rpmMax: 8000, steer: 0, brake: 0, throttle: 0 })
  const second = state.update({ timestampMs: 100, speedKmh: 100, isRaceOn: true, car, rpmMax: 8000, steer: 0.25, brake: 0, throttle: 0 })
  assert.equal(first.valid, true)
  assert.equal(second.phase, stateApi.PHASES.TURN_IN)
  assert.equal(second.maneuverId, 1)
  assert.equal(second.vehicleIdentity, '1:700:8000:1')
})

test('duplicate game timestamps are ignored without resetting the active maneuver', () => {
  const state = new stateApi.DriverAnalysisState()
  const car = { ordinal: 1, pi: 700, drivetrain: 1 }
  state.update({ timestampMs: 0, speedKmh: 100, isRaceOn: true, car, rpmMax: 8000, steer: 0, brake: 0, throttle: 0 })
  const turnIn = state.update({ timestampMs: 100, speedKmh: 100, isRaceOn: true, car, rpmMax: 8000, steer: 0.25, brake: 0, throttle: 0 })
  const duplicate = state.update({ timestampMs: 100, speedKmh: 100, isRaceOn: true, car, rpmMax: 8000, steer: 0.3, brake: 0, throttle: 0 })
  const next = state.update({ timestampMs: 200, speedKmh: 99, isRaceOn: true, car, rpmMax: 8000, steer: 0.32, brake: 0, throttle: 0 })

  assert.equal(turnIn.maneuverId, 1)
  assert.equal(duplicate.valid, false)
  assert.equal(duplicate.resetReason, null)
  assert.equal(duplicate.phase, stateApi.PHASES.TURN_IN)
  assert.equal(next.maneuverId, 1)
  assert.notEqual(next.resetReason, 'duplicate_timestamp')
})

test('engine keeps an opportunity valid across duplicate game timestamps', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  const car = { ordinal: 1, pi: 700, drivetrain: 1 }
  const frame = (timestampMs, steer, frontSlip) => ({
    timestampMs, speedKmh: 100, isRaceOn: true, car, rpmMax: 8000, steer, brake: 0, throttle: 0,
    slipAngle: { fl: frontSlip, fr: frontSlip, rl: 0.03, rr: 0.03 },
    combinedSlip: { fl: frontSlip, fr: frontSlip, rl: 0.03, rr: 0.03 },
    acceleration: { x: 0.5, y: 0, z: 0 }, angularVelocity: { y: 0.5 }
  })
  engine.update(frame(0, 0, 0.03))
  engine.update(frame(100, 0.25, 0.14))
  engine.update(frame(100, 0.3, 0.18))
  engine.update(frame(200, 0.32, 0.19))
  const result = engine.finalize()
  const front = result.opportunities.find(item => item.type === 'front_scrub')

  assert.ok(front)
  assert.equal(front.valid, true)
  assert.equal(front.invalidReason, null)
  assert.ok(front.samples.length >= 2)
  assert.equal(result.sampleCount, 3)
})

test('collector emits no more than one opportunity of each type per maneuver and retains response samples', () => {
  const collector = new opportunitiesApi.DriverAnalysisOpportunities()
  const samples = [
    { timestampMs: 0, speedKmh: 100, steerMagnitude: 0.2, steerRate: 0.1, frontSlip: 0.12, lateralResponse: 0.5 },
    { timestampMs: 100, speedKmh: 100, steerMagnitude: 0.3, steerRate: 0, frontSlip: 0.2, lateralResponse: 0.3 },
    { timestampMs: 200, speedKmh: 100, steerMagnitude: 0.31, steerRate: 0, frontSlip: 0.21, lateralResponse: 0.29 }
  ]
  samples.forEach((sample, index) => collector.update({ valid: true, phase: index === 0 ? 'turn-in' : 'rotation', maneuverId: 1, sample, previousSample: samples[index - 1] || null }))
  const opportunities = collector.finalize()
  assert.equal(opportunities.filter(item => item.type === 'front_scrub').length, 1)
  assert.equal(opportunities.find(item => item.type === 'front_scrub').samples.length, 3)
})

test('same-car clean counterexample enables driver attribution', () => {
  const clean = snapshot('front_scrub', 1, [
    { timestampMs: 0, steerMagnitude: 0.2, steerRate: 0, frontSlip: 0.1, lateralResponse: 0.5, yawRate: 0.5 },
    { timestampMs: 100, steerMagnitude: 0.2, steerRate: 0, frontSlip: 0.11, lateralResponse: 0.55, yawRate: 0.54 }
  ])
  const problem = qualifies('front_scrub', 2)
  const evidence = evidenceApi.analyzeOpportunities([clean, problem])
  const result = evidence.find(item => item.maneuverId === 2)
  assert.equal(result.outcome, 'problem')
  assert.ok(result.attributionConfidence >= 0.7)
  assert.equal(result.primary, true)
})

test('scoring applies qualification gates and returns one dominant problem', () => {
  const opportunities = []
  const evidence = []
  for (let index = 0; index < 6; index += 1) {
    const maneuverId = index + 1
    opportunities.push({ id: `front-${index}`, type: 'front_scrub', maneuverId, valid: true, outcome: 'clean' })
    evidence.push({ opportunityId: `front-${index}`, type: 'front_scrub', maneuverId, outcome: index < 4 ? 'problem' : 'clean', primary: index < 4, detectorConfidence: 0.92, attributionConfidence: 0.85, severity: 0.7 })
  }
  const summary = scoringApi.summarizeDriverAnalysis({ opportunities, evidence })
  assert.equal(summary.status, scoringApi.STATUS.ISSUE)
  assert.equal(summary.mainProblem.kind, 'front_scrub')
  assert.equal(summary.aggregates.front_scrub.recurrence, 4 / 6)
})

test('scoring reports no recurring problem when data is sufficient but findings are rare', () => {
  const opportunities = []
  const evidence = []
  for (let index = 0; index < 6; index += 1) {
    const maneuverId = index + 1
    opportunities.push({ id: `front-${index}`, type: 'front_scrub', maneuverId, valid: true, outcome: 'clean' })
    evidence.push({
      opportunityId: `front-${index}`, type: 'front_scrub', maneuverId,
      outcome: index === 0 ? 'ambiguous' : 'clean', primary: false,
      detectorConfidence: index === 0 ? 0.9 : 0.2, attributionConfidence: 0.2, severity: 0.2
    })
  }
  const summary = scoringApi.summarizeDriverAnalysis({ opportunities, evidence })
  assert.equal(summary.status, scoringApi.STATUS.NO_RECURRING_PROBLEM)
})

test('scoring reserves ambiguous for a recurring unresolved candidate', () => {
  const opportunities = []
  const evidence = []
  for (let index = 0; index < 6; index += 1) {
    const maneuverId = index + 1
    opportunities.push({ id: `front-${index}`, type: 'front_scrub', maneuverId, valid: true, outcome: 'clean' })
    evidence.push({
      opportunityId: `front-${index}`, type: 'front_scrub', maneuverId,
      outcome: index < 3 ? 'ambiguous' : 'clean', primary: false,
      detectorConfidence: index < 3 ? 0.9 : 0.2, attributionConfidence: 0.2, severity: 0.5
    })
  }
  const summary = scoringApi.summarizeDriverAnalysis({ opportunities, evidence })
  assert.equal(summary.status, scoringApi.STATUS.AMBIGUOUS)
  assert.equal(summary.aggregates.front_scrub.candidateRecurrence, 0.5)
})

test('engine finalization is JSON-serializable and exposes the agreed API', () => {
  const engine = engineApi.createDriverAnalysisEngine()
  const car = { ordinal: 1, pi: 700, drivetrain: 1 }
  engine.update({ timestampMs: 0, speedKmh: 100, isRaceOn: true, car, rpmMax: 8000, steer: 0, brake: 0, throttle: 0 })
  engine.update({ timestampMs: 100, speedKmh: 100, isRaceOn: true, car, rpmMax: 8000, steer: 0.25, brake: 0, throttle: 0 })
  const result = engine.finalize()
  assert.ok(['insufficient', 'ambiguous', 'issue', 'no_recurring_problem', 'no_clear_dominant_problem'].includes(result.status))
  assert.equal(result.algorithmVersion, engineApi.DRIVER_ANALYSIS_VERSION)
  assert.doesNotThrow(() => JSON.stringify(result))
  assert.equal(typeof engine.reset, 'function')
  assert.equal(typeof engine.resetTransient, 'function')
  assert.equal(typeof engine.update, 'function')
  assert.equal(typeof engine.snapshot, 'function')
  assert.equal(typeof engine.finalize, 'function')
})

test('evidence keeps invalid opportunities out of qualification and classifies valid outcomes', () => {
  const invalid = snapshot('front_scrub', 1, frontSamples())
  invalid.valid = false
  invalid.outcome = 'incomplete'
  invalid.invalidReason = 'telemetry_gap'
  const clean = snapshot('front_scrub', 2, [
    { timestampMs: 0, steerMagnitude: 0.2, steerRate: 0, frontSlip: 0.1, lateralResponse: 0.5, yawRate: 0.5 },
    { timestampMs: 100, steerMagnitude: 0.2, steerRate: 0, frontSlip: 0.11, lateralResponse: 0.55, yawRate: 0.54 }
  ])
  const result = evidenceApi.analyzeOpportunities([invalid, clean])
  assert.equal(result[0].outcome, 'incomplete')
  const summary = scoringApi.summarizeDriverAnalysis({ opportunities: [invalid, clean], evidence: result })
  assert.equal(summary.aggregates.front_scrub.validOpportunities, 1)
})
