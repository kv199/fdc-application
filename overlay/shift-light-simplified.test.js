const assert = require('node:assert/strict')
const test = require('node:test')

const { ShiftLightLearner, SHIFT_LIGHT_LEARNING_VERSION } = require('./shift-light-engine.js')

const car = { ordinal: 500, class: 1, pi: 800, drivetrain: 1, cylinders: 10 }
const key = 'fh6:500:1:800:1:10'
function frame(overrides = {}) {
  return { isRaceOn: true, timestampMs: 0, car, gear: 1, rpm: 8000, rpmMax: 11000,
    throttle: 1, brake: 0, handBrake: 0, clutch: 0, power: 400, speedKmh: 100,
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 }, ...overrides }
}
function feedShift(learner, start, rpm, afterPower, overrides = {}) {
  learner.update(frame({ timestampMs: start, rpm: rpm - 100, power: 400, ...overrides }))
  learner.update(frame({ timestampMs: start + 16, rpm, power: 410, ...overrides }))
  learner.update(frame({ timestampMs: start + 32, gear: 2, rpm: 6500, power: -50, ...overrides }))
  learner.update(frame({ timestampMs: start + 48, gear: 2, rpm: 6600, power: -20, ...overrides }))
  learner.update(frame({ timestampMs: start + 112, gear: 2, rpm: 7000, power: afterPower, ...overrides }))
  learner.update(frame({ timestampMs: start + 128, gear: 2, rpm: 7100, power: afterPower, ...overrides }))
  learner.update(frame({ timestampMs: start + 144, gear: 2, rpm: 7200, power: afterPower, ...overrides }))
}

test('waits past negative torque-cut frames and compares fresh median raw power', () => {
  const learner = new ShiftLightLearner(key)
  feedShift(learner, 0, 9500, 420, { combinedSlip: { fl: 1, fr: 1, rl: 1, rr: 1 } })
  const state = learner.serializeLearningState()
  assert.equal(state.shiftSamples.length, 1)
  assert.equal(state.shiftSamples[0].beforeTimestampMs, 16)
  assert.equal(state.shiftSamples[0].afterTimestampMs, 128)
  assert.equal(state.shiftSamples[0].beforePower, 410)
  assert.equal(state.shiftSamples[0].afterPower, 420)
  assert.equal(state.shiftSamples[0].outcome, 'better')
  const gear = learner.snapshot(frame({ gear: 1, rpm: 9000 })).gears.find(item => item.gear === 1)
  assert.equal(gear.acceptedShiftCount, 1)
  assert.equal(gear.lastRpmBefore, 9500)
  assert.equal(gear.lastDeltaPct, state.shiftSamples[0].powerDeltaPct)
})

test('ignores a stale pre-shift window instead of inventing evidence', () => {
  const learner = new ShiftLightLearner(key)
  learner.update(frame({ timestampMs: 0, rpm: 9500, power: 410 }))
  learner.update(frame({ timestampMs: 400, gear: 2, rpm: 6500, power: -50 }))
  learner.update(frame({ timestampMs: 512, gear: 2, rpm: 7000, power: 420 }))
  learner.update(frame({ timestampMs: 528, gear: 2, rpm: 7100, power: 420 }))
  learner.update(frame({ timestampMs: 544, gear: 2, rpm: 7200, power: 420 }))
  assert.deepEqual(learner.serializeLearningState().shiftSamples, [])
})

test('keeps a clean negative delta as neutral observation without condemning the driver', () => {
  const learner = new ShiftLightLearner(key)
  feedShift(learner, 0, 9500, 350)
  const state = learner.serializeLearningState()
  assert.equal(state.shiftSamples.length, 1)
  assert.equal(state.shiftSamples[0].outcome, 'not_better')
  assert.equal(state.gearTargets.find(item => item.sourceGear === 1).status, 'learning')
  assert.equal(state.gearTargets.find(item => item.sourceGear === 1).targetRpm, null)
})

test('confirms three nonnegative samples independently for each gear pair', () => {
  const learner = new ShiftLightLearner(key)
  feedShift(learner, 0, 9500, 420)
  feedShift(learner, 1000, 9550, 420)
  feedShift(learner, 2000, 9600, 420)
  const target = learner.serializeLearningState().gearTargets.find(item => item.sourceGear === 1)
  assert.deepEqual({ status: target.status, target: target.targetRpm, count: target.confirmationCount }, { status: 'optimal', target: 9550, count: 3 })
})

test('does not discard engine-power evidence only because wheel slip is noisy', () => {
  const learner = new ShiftLightLearner(key)
  feedShift(learner, 0, 9500, 420)
  // Wheel slip is deliberately not an engine-power validity gate anymore.
  const state = learner.serializeLearningState()
  assert.equal(state.shiftSamples.length, 1)
})

test('same-rank state merge keeps the richer evidence and confirmation count', () => {
  const left = new ShiftLightLearner(key)
  const right = new ShiftLightLearner(key)
  feedShift(left, 0, 9500, 420)
  feedShift(right, 1000, 9550, 420)
  feedShift(right, 2000, 9600, 420)
  left.mergeLearningState(right.serializeLearningState())
  const target = left.serializeLearningState().gearTargets.find(item => item.sourceGear === 1)
  assert.equal(target.status, 'optimal')
  assert.equal(target.confirmationCount, 3)
  assert.equal(target.evidence.length, 3)
  assert.deepEqual(target.confirmationRpms, [9500, 9550, 9600])
})

test('same-rank merge counts distinct shifts even when their RPM values match', () => {
  const left = new ShiftLightLearner(key)
  const right = new ShiftLightLearner(key)
  feedShift(left, 0, 9500, 420)
  feedShift(right, 1000, 9500, 420)
  feedShift(right, 2000, 9500, 420)
  left.mergeLearningState(right.serializeLearningState())
  const target = left.serializeLearningState().gearTargets.find(item => item.sourceGear === 1)
  assert.equal(target.status, 'optimal')
  assert.equal(target.confirmationCount, 3)
  assert.deepEqual(target.confirmationRpms, [9500, 9500, 9500])
})

test('reconstructs confirmation RPMs from samples across a restart', () => {
  const first = new ShiftLightLearner(key)
  feedShift(first, 0, 9500, 420)
  feedShift(first, 1000, 9550, 420)
  const saved = first.serializeLearningState()
  delete saved.gearTargets.find(item => item.sourceGear === 1).confirmationRpms
  const restored = new ShiftLightLearner(key)
  restored.importLearningState(saved)
  assert.deepEqual(restored.serializeLearningState().gearTargets.find(item => item.sourceGear === 1).confirmationRpms, [9500, 9550])
  feedShift(restored, 2000, 9600, 420)
  const target = restored.serializeLearningState().gearTargets.find(item => item.sourceGear === 1)
  assert.equal(target.status, 'optimal')
  assert.equal(target.targetRpm, 9550)
})

test('a crossover at the reported redline cannot create an earlier potential', () => {
  const learner = new ShiftLightLearner(key)
  feedShift(learner, 0, 11000, 420)
  const target = learner.serializeLearningState().gearTargets.find(item => item.sourceGear === 1)
  assert.equal(target.status, 'learning')
  assert.equal(target.confirmationCount, 0)
  assert.equal(learner.serializeLearningState().shiftSamples[0].outcome, 'better')
})

test('does not create or persist a non-existent 10 to 11 target', () => {
  const learner = new ShiftLightLearner(key)
  learner.update(frame({ gear: 10, rpm: 9000, power: 400 }))
  const state = learner.serializeLearningState()
  assert.equal(state.gearTargets.some(item => item.sourceGear === 10), false)
  state.gearTargets.push({ sourceGear: 10, destinationGear: 11, status: 'optimal', targetRpm: 9000, candidateRpm: 9000, confirmationCount: 3, confirmationRpms: [9000, 9000, 9000], lastReason: null, evidence: [] })
  const restored = new ShiftLightLearner(key)
  restored.importLearningState(state)
  assert.equal(restored.serializeLearningState().gearTargets.some(item => item.sourceGear === 10), false)
})

test('rejects persisted zero-power shift samples', () => {
  const learner = new ShiftLightLearner(key)
  const state = learner.serializeLearningState()
  state.shiftSamples = [{ sourceGear: 1, destinationGear: 2, beforeTimestampMs: 1, afterTimestampMs: 2, beforeRpm: 9000, afterRpm: 6500, beforePower: 0, afterPower: 400, powerDeltaPct: 0, outcome: 'better', reason: 'POWER_CROSSOVER' }]
  state.gearTargets = [{ sourceGear: 1, destinationGear: 2, status: 'potential', targetRpm: 9000, candidateRpm: 9000, confirmationCount: 1, confirmationRpms: [9000], lastReason: null, evidence: [] }]
  const restored = new ShiftLightLearner(key)
  restored.importLearningState(state)
  assert.deepEqual(restored.serializeLearningState().shiftSamples, [])
})

test('uses redline as fallback and derives a separately clamped light-on threshold', () => {
  const learner = new ShiftLightLearner(key)
  const state = learner.update(frame({ timestampMs: 0, rpm: 10500, power: 400 }))
  assert.equal(state.shiftRpm, 11000)
  assert.equal(state.effectiveTargetRpm, 11000)
  assert.equal(state.leadRpm, 200)
  assert.equal(state.lightOnRpm, 10800)
  assert.equal(state.phase, 'approach')
  assert.equal(learner.serializeLearningState().modelVersion, SHIFT_LIGHT_LEARNING_VERSION)
})
