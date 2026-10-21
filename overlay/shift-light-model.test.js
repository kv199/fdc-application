const assert = require('node:assert/strict')
const test = require('node:test')

const { getShiftLightCarKey, ShiftLightLearner } = require('./shift-light-engine.js')

const car = { ordinal: 4223, class: 2, pi: 590, drivetrain: 2, cylinders: 6 }
const KEY = 'fh6:4223:2:590:2:6'
// Engine RPM per km/h in each gear.
const RATIOS = { 1: 120, 2: 85, 3: 65, 4: 52 }
const LIMITER_RPM = 9000
const NO_SLIP = { fl: 0, fr: 0, rl: 0, rr: 0 }

// Power peaks at 6,000 RPM and falls symmetrically, so the crossover of G -> G+1 with
// step = ratio(G+1) / ratio(G) is where 6,000 - x * step = x - 6,000: x = 12,000 / (1 + step).
function peakAtSixThousand(rpm) { return 300000 - 0.02 * (rpm - 6000) ** 2 }
function analyticCrossover(sourceGear) { return 12000 / (1 + RATIOS[sourceGear + 1] / RATIOS[sourceGear]) }

function frame(overrides = {}) {
  return { isRaceOn: true, timestampMs: 0, car, gear: 1, rpm: 5000, rpmMax: 10000, throttle: 1, brake: 0, handBrake: 0,
    clutch: 0, power: 200000, speedKmh: 100, slipRatio: NO_SLIP, ...overrides }
}

/**
 * A full-throttle pull through the given gears: each gear climbs 20 RPM per 16 ms frame to the
 * limiter, bounces on it once (a limiter observation), then shifts directly into the next gear
 * with one torque-cut frame. With `comparable: false` the driver lifts for 300 ms before each
 * shift, so no power comparison is captured. `skip(rpm, gear)` makes a frame unusable.
 * Ends with a lifted frame 300 ms later so the throttled model refresh sees the whole pull.
 */
function pull(learner, options = {}) {
  const { startMs = 0, gears = [1, 2, 3, 4], startRpm = 3000, powerAt = peakAtSixThousand, comparable = true,
    slipFor = () => NO_SLIP, skip = () => false, limiter = true, extraFor = () => ({}) } = options
  let timestampMs = startMs
  let rpm = startRpm
  const update = (gear, overrides) => {
    const speedKmh = overrides.rpm / RATIOS[gear]
    learner.update(frame({ timestampMs, gear, speedKmh, slipRatio: slipFor(gear), ...extraFor(gear, overrides.rpm), ...overrides }))
    timestampMs += 16
  }
  gears.forEach((gear, index) => {
    if (index > 0) update(gear, { rpm, power: -50000 })
    for (; rpm < LIMITER_RPM; rpm += 20) update(gear, skip(rpm, gear) ? { rpm, power: 0 } : { rpm, power: powerAt(rpm) })
    const top = limiter ? [LIMITER_RPM, LIMITER_RPM - 60, LIMITER_RPM - 5] : [LIMITER_RPM - 5]
    for (const value of top) update(gear, { rpm: value, power: powerAt(value) })
    if (!comparable) for (let lift = 0; lift < 20; lift++) update(gear, { rpm: LIMITER_RPM - 100, throttle: 0, power: 0 })
    const next = gears[index + 1]
    if (next !== undefined) rpm = Math.round(LIMITER_RPM * RATIOS[next] / RATIOS[gear])
  })
  timestampMs += 300
  update(gears.at(-1), { rpm: 5000, throttle: 0, power: 0 })
  return timestampMs
}

function gearOf(snapshot, gear) { return snapshot.gears.find(item => item.gear === gear) }
function modelOf(snapshot, gear) { return snapshot.diagnostics.find(item => item.gear === gear).model }

test('a pull through four gears places the model point of each pair at the power crossover', () => {
  const learner = new ShiftLightLearner(KEY)
  pull(learner)
  const snapshot = learner.snapshot(frame({ gear: 2, rpm: 5000 }))
  assert.equal(snapshot.usableCeiling, LIMITER_RPM)
  for (const sourceGear of [1, 2, 3]) {
    const gear = gearOf(snapshot, sourceGear), model = modelOf(snapshot, sourceGear)
    const expected = analyticCrossover(sourceGear)
    assert.ok(Math.abs(gear.modelRpm - expected) <= 50, `${sourceGear}->${sourceGear + 1} model ${gear.modelRpm}, analytic ${expected}`)
    assert.equal(gear.shiftAtRpm, gear.modelRpm)
    assert.equal(gear.ready, true)
    assert.equal(model.rpm, gear.modelRpm)
    assert.equal(model.kind, 'crossover')
    assert.ok(model.coverage >= 0.5)
    assert.ok(Math.abs(model.ratioStep - RATIOS[sourceGear + 1] / RATIOS[sourceGear]) < 1e-9)
    // Every comparison was made at the limiter, far above the model point, with the next gear stronger.
    assert.ok(model.agree >= 1)
    assert.equal(model.contradict, 0)
    assert.equal(model.rejected, false)
  }
  // The last gear has no next-gear ratio, so it has no model point.
  assert.equal(gearOf(snapshot, 4)?.modelRpm ?? null, null)
  assert.equal(snapshot.effectiveTargetRpm, gearOf(snapshot, 2).modelRpm)
  assert.equal(snapshot.shiftRpm, gearOf(snapshot, 2).modelRpm)
  assert.equal(snapshot.lightOnRpm, snapshot.effectiveTargetRpm - snapshot.leadRpm)
  assert.equal(snapshot.status, 'calibrated')
  assert.equal(snapshot.method, 'optimal')
})

test('a model point alone makes the current pair calibrated and ready', () => {
  const learner = new ShiftLightLearner(KEY)
  pull(learner, { comparable: false })
  assert.deepEqual(learner.serializeLearningState().shiftSamples, [])
  const snapshot = learner.snapshot(frame({ gear: 3, rpm: 5000 }))
  const gear = gearOf(snapshot, 3)
  assert.equal(gear.status, 'learning')
  assert.equal(gear.ready, true)
  assert.ok(Math.abs(gear.modelRpm - analyticCrossover(3)) <= 50)
  assert.equal(snapshot.status, 'calibrated')
  assert.equal(snapshot.method, 'optimal')
  assert.equal(snapshot.effectiveTargetRpm, gear.modelRpm)
  assert.equal(snapshot.lightOnRpm, gear.modelRpm - snapshot.leadRpm)
  // The rows exist and serialize with the model point.
  const targets = learner.serializeLearningState().gearTargets
  for (const sourceGear of [1, 2, 3]) assert.equal(targets.find(item => item.sourceGear === sourceGear).modelRpm, gearOf(snapshot, sourceGear).modelRpm)
})

test('power rising to the limiter puts the model point at the ceiling', () => {
  const learner = new ShiftLightLearner(KEY)
  pull(learner, { powerAt: rpm => rpm * 30, comparable: false })
  const snapshot = learner.snapshot(frame({ gear: 2, rpm: 5000 }))
  for (const sourceGear of [1, 2, 3]) {
    assert.equal(gearOf(snapshot, sourceGear).modelRpm, LIMITER_RPM)
    assert.equal(modelOf(snapshot, sourceGear).kind, 'at-limiter')
  }
  assert.equal(snapshot.effectiveTargetRpm, LIMITER_RPM)
})

test('without a ceiling there is no model point and the cue keeps the redline fallback', () => {
  const learner = new ShiftLightLearner(KEY)
  pull(learner, { limiter: false, comparable: false })
  const snapshot = learner.snapshot(frame({ gear: 2, rpm: 5000 }))
  assert.equal(snapshot.usableCeiling, null)
  assert.equal(snapshot.provisionalCeiling, null)
  for (const sourceGear of [1, 2, 3]) {
    const gear = gearOf(snapshot, sourceGear), model = modelOf(snapshot, sourceGear)
    assert.equal(gear.modelRpm, null)
    assert.equal(gear.ready, false)
    assert.equal(gear.shiftAtRpm, 10000)
    assert.equal(model.rpm, null)
    assert.equal(model.kind, null)
    assert.ok(model.ratioStep > 0)
  }
  assert.equal(snapshot.effectiveTargetRpm, 10000)
  assert.equal(snapshot.status, 'learning')
  assert.equal(snapshot.method, null)
})

test('wheelspin frames feed the power curve but not the gear ratios', () => {
  const learner = new ShiftLightLearner(KEY)
  // First gear spins its wheels the whole pull, so it never gives a ratio.
  pull(learner, { comparable: false, slipFor: gear => gear === 1 ? { fl: 0.5, fr: 0.5, rl: 0.5, rr: 0.5 } : NO_SLIP })
  const snapshot = learner.snapshot(frame({ gear: 1, rpm: 5000 }))
  assert.equal(gearOf(snapshot, 1).modelRpm, null)
  assert.equal(modelOf(snapshot, 1).ratioStep, null)
  assert.equal(gearOf(snapshot, 1).shiftAtRpm, LIMITER_RPM)
  assert.equal(snapshot.effectiveTargetRpm, LIMITER_RPM)
  assert.equal(snapshot.status, 'learning')
  // 2 -> 3 shifts to about 5,200 RPM, which only the spinning first gear covered.
  assert.ok(Math.abs(gearOf(snapshot, 2).modelRpm - analyticCrossover(2)) <= 50)
})

test('missing slip data gives no gear ratio and no model point', () => {
  const learner = new ShiftLightLearner(KEY)
  pull(learner, { comparable: false, slipFor: () => undefined })
  const snapshot = learner.snapshot(frame({ gear: 2, rpm: 5000 }))
  for (const sourceGear of [1, 2, 3]) {
    assert.equal(gearOf(snapshot, sourceGear).modelRpm, null)
    assert.equal(modelOf(snapshot, sourceGear).ratioStep, null)
  }
})

const TIRE_RADIUS_M = 0.33
const RPM_TO_RAD_S = 2 * Math.PI / 60
// Engine over wheel angular speed in a gear whose wheel-surface speed is rpm / RATIOS[gear] km/h.
function overallRatio(gear) { return RATIOS[gear] * RPM_TO_RAD_S * 3.6 * TIRE_RADIUS_M }
// Driven-wheel surface speed over ground speed per gear: heavy wheelspin in 1st, less in 2nd.
const SPIN = { 1: 1.6, 2: 1.3, 3: 1, 4: 1 }
const DRIVEN = { 0: ['fl', 'fr'], 1: ['rl', 'rr'], 2: ['fl', 'fr', 'rl', 'rr'] }
/**
 * Frames of a car whose driven wheels spin: Data Out speed is the ground speed, so rpm / speed is
 * inflated, while the driven wheels turn with the engine through the gear ratio. Undriven wheels
 * roll at ground speed. `split(gear)` makes AWD fronts turn faster than the engine-locked rears by that share.
 */
function spinningWheels(drivetrain, { split = () => 0, wheels = true } = {}) {
  const driven = DRIVEN[drivetrain] ?? DRIVEN[1]
  return (gear, rpm) => {
    const spin = SPIN[gear], speedKmh = rpm / RATIOS[gear] / spin
    const drivenRad = rpm * RPM_TO_RAD_S / overallRatio(gear), groundRad = speedKmh / 3.6 / TIRE_RADIUS_M
    const wheelRotation = {}, slipRatio = {}
    for (const wheel of ['fl', 'fr', 'rl', 'rr']) {
      const isDriven = driven.includes(wheel)
      const share = drivetrain === 2 && wheel.startsWith('f') ? 1 + split(gear) : 1
      wheelRotation[wheel] = isDriven ? drivenRad * share : groundRad
      slipRatio[wheel] = isDriven ? spin - 1 : 0
    }
    return { car: { ...car, drivetrain }, speedKmh, slipRatio, wheelRotation: wheels ? wheelRotation : null }
  }
}
function assertModel(snapshot, sourceGears, label) {
  for (const sourceGear of sourceGears) {
    const model = modelOf(snapshot, sourceGear)
    assert.ok(Math.abs(model.ratioStep - RATIOS[sourceGear + 1] / RATIOS[sourceGear]) < 1e-9, `${label} ${sourceGear}: step ${model.ratioStep}`)
    assert.ok(Math.abs(gearOf(snapshot, sourceGear).modelRpm - analyticCrossover(sourceGear)) <= 50, `${label} ${sourceGear}: ${gearOf(snapshot, sourceGear).modelRpm}`)
  }
}

test('driven-wheel rotation gives gear ratios through rear wheelspin on a RWD car', () => {
  const learner = new ShiftLightLearner('fh6:4223:2:590:1:6')
  pull(learner, { comparable: false, extraFor: spinningWheels(1) })
  const snapshot = learner.snapshot(frame({ gear: 1, rpm: 5000 }))
  assertModel(snapshot, [1, 2, 3], 'RWD')
  // rpm / speed alone has no ratio for the spinning gears, so their pairs had no model point.
  const speedOnly = new ShiftLightLearner('fh6:4223:2:590:1:6')
  pull(speedOnly, { comparable: false, extraFor: spinningWheels(1, { wheels: false }) })
  const old = speedOnly.snapshot(frame({ gear: 1, rpm: 5000 }))
  for (const sourceGear of [1, 2]) {
    assert.equal(gearOf(old, sourceGear).modelRpm, null)
    assert.equal(modelOf(old, sourceGear).ratioStep, null)
  }
  assert.ok(Math.abs(gearOf(old, 3).modelRpm - analyticCrossover(3)) <= 50)
})

test('FWD reads the front wheels and AWD the rear pair', () => {
  const fwd = new ShiftLightLearner('fh6:4223:2:590:0:6')
  pull(fwd, { comparable: false, extraFor: spinningWheels(0) })
  assertModel(fwd.snapshot(frame({ gear: 1, rpm: 5000 })), [1, 2, 3], 'FWD')
  // AWD fronts drift from the engine by a gear-dependent share, so all four wheels would give wrong steps.
  const awd = new ShiftLightLearner(KEY)
  pull(awd, { comparable: false, extraFor: spinningWheels(2, { split: gear => ({ 1: 0.3, 2: 0.1 })[gear] ?? 0 }) })
  assertModel(awd.snapshot(frame({ gear: 1, rpm: 5000 })), [1, 2, 3], 'AWD')
})

test('without a known drivetrain or wheel data the ratios fall back to rpm / speed without wheelspin', () => {
  const spinning = spinningWheels(1)
  const variants = {
    'unknown drivetrain': (gear, rpm) => ({ ...spinning(gear, rpm), car: { ...car, drivetrain: 7 } }),
    'missing drivetrain': (gear, rpm) => ({ ...spinning(gear, rpm), car: { ordinal: 4223, class: 2, pi: 590, cylinders: 6 } }),
    'null wheel rotation': (gear, rpm) => ({ ...spinning(gear, rpm), wheelRotation: null }),
    'non-finite wheel rotation': (gear, rpm) => ({ ...spinning(gear, rpm), wheelRotation: { ...spinning(gear, rpm).wheelRotation, rr: Number.NaN } })
  }
  for (const [label, extraFor] of Object.entries(variants)) {
    const learner = new ShiftLightLearner('fh6:4223:2:590:1:6')
    pull(learner, { comparable: false, extraFor })
    const snapshot = learner.snapshot(frame({ gear: 1, rpm: 5000 }))
    for (const sourceGear of [1, 2]) {
      assert.equal(gearOf(snapshot, sourceGear).modelRpm, null, `${label} ${sourceGear}`)
      assert.equal(modelOf(snapshot, sourceGear).ratioStep, null, `${label} ${sourceGear}`)
    }
    assert.ok(Math.abs(modelOf(snapshot, 3).ratioStep - RATIOS[4] / RATIOS[3]) < 1e-9, label)
    assert.ok(Math.abs(gearOf(snapshot, 3).modelRpm - analyticCrossover(3)) <= 50, label)
  }
})

test('a pair never divides a wheel-based ratio by an rpm / speed ratio', () => {
  // 1st has only wheel ratios (wheelspin), 2nd only rpm / speed ratios (no wheel data): no step.
  const spinning = spinningWheels(1)
  const wheelOnly = new ShiftLightLearner('fh6:4223:2:590:1:6')
  pull(wheelOnly, { comparable: false, extraFor: (gear, rpm) => gear === 1 ? spinning(gear, rpm) : { car: { ...car, drivetrain: 1 }, wheelRotation: null } })
  const none = wheelOnly.snapshot(frame({ gear: 1, rpm: 5000 }))
  assert.equal(modelOf(none, 1).ratioStep, null)
  assert.equal(gearOf(none, 1).modelRpm, null)
  assert.ok(Math.abs(modelOf(none, 2).ratioStep - RATIOS[3] / RATIOS[2]) < 1e-9)
  // With 1st also giving rpm / speed ratios, the pair uses rpm / speed for both gears.
  const both = new ShiftLightLearner('fh6:4223:2:590:1:6')
  const rwd = { ...car, drivetrain: 1 }
  pull(both, { comparable: false, extraFor: (gear, rpm) => {
    const rear = rpm * RPM_TO_RAD_S / overallRatio(1)
    return { car: rwd, wheelRotation: gear === 1 ? { fl: rear, fr: rear, rl: rear, rr: rear } : null }
  } })
  assertModel(both.snapshot(frame({ gear: 1, rpm: 5000 })), [1, 2, 3], 'speed for both')
})

test('a missing next-gear ratio leaves that pair without a model point', () => {
  const learner = new ShiftLightLearner(KEY)
  pull(learner, { comparable: false, slipFor: gear => gear === 3 ? { fl: 0, fr: 0.3, rl: 0, rr: 0 } : NO_SLIP })
  const snapshot = learner.snapshot(frame({ gear: 2, rpm: 5000 }))
  assert.equal(gearOf(snapshot, 2).modelRpm, null)
  assert.equal(gearOf(snapshot, 3).modelRpm, null)
  assert.ok(Math.abs(gearOf(snapshot, 1).modelRpm - analyticCrossover(1)) <= 50)
  assert.equal(snapshot.effectiveTargetRpm, LIMITER_RPM)
})

test('a gap between the power peak and the crossover gives no model point', () => {
  const learner = new ShiftLightLearner(KEY)
  // Nothing is known from the peak up to the crossovers, so the next gear already wins at the first known point.
  pull(learner, { comparable: false, skip: rpm => rpm >= 6000 && rpm < 7100 })
  const snapshot = learner.snapshot(frame({ gear: 2, rpm: 5000 }))
  for (const sourceGear of [1, 2, 3]) {
    assert.equal(gearOf(snapshot, sourceGear).modelRpm, null, `${sourceGear}->${sourceGear + 1}`)
    assert.equal(modelOf(snapshot, sourceGear).kind, null)
    assert.equal(gearOf(snapshot, sourceGear).shiftAtRpm, LIMITER_RPM)
  }
})

test('a crossover found on thin coverage gives no model point', () => {
  const learner = new ShiftLightLearner(KEY)
  // Points just above the peak are known, then a long gap hides the crossovers.
  pull(learner, { comparable: false, skip: rpm => rpm >= 6200 && rpm < 7600 })
  const snapshot = learner.snapshot(frame({ gear: 2, rpm: 5000 }))
  for (const sourceGear of [2, 3]) {
    const model = modelOf(snapshot, sourceGear)
    assert.equal(gearOf(snapshot, sourceGear).modelRpm, null, `${sourceGear}->${sourceGear + 1}`)
    assert.ok(model.coverage !== null && model.coverage < 0.5, `coverage ${model.coverage}`)
  }
})

function sample(sourceGear, beforeRpm, powerDeltaPct, index) {
  const beforePower = 200000, afterPower = beforePower * (1 + powerDeltaPct / 100)
  return { sourceGear, destinationGear: sourceGear + 1, beforeTimestampMs: 1000 * index, afterTimestampMs: 1000 * index + 150,
    beforeRpm, afterRpm: Math.round(beforeRpm * 0.75), beforePower, afterPower, powerDeltaPct,
    outcome: powerDeltaPct >= 0 ? 'better' : 'not_better', reason: powerDeltaPct >= 0 ? 'POWER_CROSSOVER' : 'NO_CROSSOVER' }
}
function stateWith(modelRpm, samples, target = {}) {
  return { modelVersion: 4, version: 4, key: KEY, reportedRedlineRpm: 10000, ceilingSamples: [9000, 9000, 9000], usableCeiling: 9000,
    gearTargets: [{ sourceGear: 2, destinationGear: 3, status: 'learning', targetRpm: null, candidateRpm: null, confirmationCount: 0,
      confirmationRpms: [], lastReason: null, evidence: [], modelRpm, ...target }],
    shiftSamples: samples }
}
function importedSnapshot(state) {
  const learner = new ShiftLightLearner(KEY)
  learner.importLearningState(state)
  return learner.snapshot(frame({ gear: 2, rpm: 5000 }))
}

test('two later shifts where the next gear was weaker reject the model point', () => {
  const snapshot = importedSnapshot(stateWith(6800, [sample(2, 8900, -4, 1), sample(2, 8800, -3, 2)]))
  const model = modelOf(snapshot, 2)
  assert.deepEqual({ rpm: model.rpm, agree: model.agree, contradict: model.contradict, rejected: model.rejected },
    { rpm: 6800, agree: 0, contradict: 2, rejected: true })
  assert.equal(gearOf(snapshot, 2).modelRpm, null)
  assert.equal(gearOf(snapshot, 2).ready, false)
  assert.equal(gearOf(snapshot, 2).shiftAtRpm, 9000)
  assert.equal(snapshot.effectiveTargetRpm, 9000)
  assert.equal(snapshot.status, 'learning')
  // A rejected point is not saved, so neither a restart nor Garage reads it as READY.
  const learner = new ShiftLightLearner(KEY)
  learner.importLearningState(stateWith(6800, [sample(2, 8900, -4, 1), sample(2, 8800, -3, 2)]))
  assert.equal(learner.serializeLearningState().gearTargets.find(item => item.sourceGear === 2).modelRpm, null)
  // An earlier shift where the next gear was stronger also contradicts it.
  assert.equal(modelOf(importedSnapshot(stateWith(6800, [sample(2, 6500, 2, 1), sample(2, 8900, -4, 2)])), 2).rejected, true)
})

test('agreeing comparisons, a single contradiction or nearby shifts keep the model point', () => {
  const kept = [
    [sample(2, 8900, 3, 1), sample(2, 8800, 5, 2)],
    [sample(2, 6400, -2, 1), sample(2, 6500, -1, 2)],
    [sample(2, 8900, -4, 1)],
    [sample(2, 8900, -4, 1), sample(2, 8800, -3, 2), sample(2, 8700, 2, 3), sample(2, 6300, -2, 4)],
    [sample(2, 6900, -4, 1), sample(2, 6700, 3, 2), sample(2, 6950, -3, 3)]
  ]
  for (const samples of kept) {
    const snapshot = importedSnapshot(stateWith(6800, samples))
    assert.equal(modelOf(snapshot, 2).rejected, false, JSON.stringify(samples.map(item => [item.beforeRpm, item.powerDeltaPct])))
    assert.equal(gearOf(snapshot, 2).modelRpm, 6800)
    assert.equal(snapshot.effectiveTargetRpm, 6800)
  }
  const nearby = modelOf(importedSnapshot(stateWith(6800, kept[4])), 2)
  assert.deepEqual({ agree: nearby.agree, contradict: nearby.contradict }, { agree: 0, contradict: 0 })
})

test('a live model point is rejected when merged comparisons contradict it', () => {
  const learner = new ShiftLightLearner(KEY)
  pull(learner, { comparable: false })
  const modelRpm = gearOf(learner.snapshot(frame({ gear: 2 })), 2).modelRpm
  assert.ok(modelRpm !== null)
  const stored = learner.serializeLearningState()
  stored.shiftSamples = [sample(2, 8900, -4, 101), sample(2, 8800, -3, 102)]
  learner.mergeLearningState(stored)
  const snapshot = learner.snapshot(frame({ gear: 2, rpm: 5000 }))
  assert.equal(modelOf(snapshot, 2).rejected, true)
  assert.equal(gearOf(snapshot, 2).modelRpm, null)
  assert.equal(snapshot.effectiveTargetRpm, LIMITER_RPM)
})

test('the model point outranks a confirmed optimal target', () => {
  const optimal = { status: 'optimal', targetRpm: 8900, candidateRpm: 8900, confirmationCount: 3, confirmationRpms: [8900, 8900, 8900] }
  const snapshot = importedSnapshot(stateWith(6800, [], optimal))
  assert.equal(gearOf(snapshot, 2).status, 'optimal')
  assert.equal(gearOf(snapshot, 2).shiftRpm, 8900)
  assert.equal(gearOf(snapshot, 2).shiftAtRpm, 6800)
  assert.equal(snapshot.effectiveTargetRpm, 6800)
  // Without a model point the optimal target is the shift point and the pair is ready.
  const withoutModel = importedSnapshot(stateWith(null, [], optimal))
  assert.deepEqual({ shiftAtRpm: gearOf(withoutModel, 2).shiftAtRpm, ready: gearOf(withoutModel, 2).ready, effective: withoutModel.effectiveTargetRpm },
    { shiftAtRpm: 8900, ready: true, effective: 8900 })
  // A potential candidate is the shift point but not ready.
  const potential = importedSnapshot(stateWith(null, [], { status: 'potential', candidateRpm: 8700, confirmationCount: 1, confirmationRpms: [8700] }))
  assert.deepEqual({ shiftAtRpm: gearOf(potential, 2).shiftAtRpm, ready: gearOf(potential, 2).ready, status: potential.status },
    { shiftAtRpm: 8700, ready: false, status: 'calibrated' })
})

test('a live model point replaces an optimal target learned in the same run', () => {
  const learner = new ShiftLightLearner(KEY)
  const optimal = { status: 'optimal', targetRpm: 8900, candidateRpm: 8900, confirmationCount: 3, confirmationRpms: [8900, 8900, 8900] }
  learner.importLearningState(stateWith(null, [], optimal))
  pull(learner, { comparable: false })
  const snapshot = learner.snapshot(frame({ gear: 2, rpm: 5000 }))
  assert.equal(gearOf(snapshot, 2).status, 'optimal')
  assert.ok(Math.abs(snapshot.effectiveTargetRpm - analyticCrossover(2)) <= 50)
})

test('a persisted model point is used after a restart until the live model places its own', () => {
  const first = new ShiftLightLearner(KEY)
  pull(first, { comparable: false })
  const saved = first.serializeLearningState()
  const savedRpm = saved.gearTargets.find(item => item.sourceGear === 2).modelRpm
  assert.ok(Math.abs(savedRpm - analyticCrossover(2)) <= 50)
  assert.equal(saved.modelVersion, 4)

  const restarted = new ShiftLightLearner(KEY)
  restarted.importLearningState(JSON.parse(JSON.stringify(saved)))
  const snapshot = restarted.snapshot(frame({ gear: 2, rpm: 5000 }))
  assert.equal(gearOf(snapshot, 2).modelRpm, savedRpm)
  assert.equal(snapshot.effectiveTargetRpm, savedRpm)
  assert.equal(snapshot.status, 'calibrated')
  // Only the live model knows how the point was placed.
  assert.equal(modelOf(snapshot, 2).kind, null)
  assert.deepEqual(restarted.serializeLearningState().gearTargets.map(item => item.modelRpm), saved.gearTargets.map(item => item.modelRpm))

  // A persisted point far from the live one is replaced once the live model places its own.
  const stale = JSON.parse(JSON.stringify(saved))
  stale.gearTargets.find(item => item.sourceGear === 2).modelRpm = 8000
  const replaced = new ShiftLightLearner(KEY)
  replaced.importLearningState(stale)
  assert.equal(replaced.snapshot(frame({ gear: 2 })).effectiveTargetRpm, 8000)
  pull(replaced, { comparable: false, startMs: 100000 })
  assert.equal(gearOf(replaced.snapshot(frame({ gear: 2 })), 2).modelRpm, savedRpm)
  assert.equal(replaced.serializeLearningState().gearTargets.find(item => item.sourceGear === 2).modelRpm, savedRpm)
})

test('a merged persisted model point does not replace the live one', () => {
  const learner = new ShiftLightLearner(KEY)
  pull(learner, { comparable: false })
  const liveRpm = gearOf(learner.snapshot(frame({ gear: 2 })), 2).modelRpm
  learner.mergeLearningState(stateWith(8000, []))
  assert.equal(gearOf(learner.snapshot(frame({ gear: 2 })), 2).modelRpm, liveRpm)
  const fresh = new ShiftLightLearner(KEY)
  fresh.mergeLearningState(stateWith(8000, []))
  assert.equal(gearOf(fresh.snapshot(frame({ gear: 2 })), 2).modelRpm, 8000)
})

test('a missing or invalid persisted model point imports as null', () => {
  for (const modelRpm of [undefined, null, 'fast', -5, 0, Number.NaN, 200000]) {
    const state = stateWith(modelRpm, [])
    if (modelRpm === undefined) delete state.gearTargets[0].modelRpm
    const learner = new ShiftLightLearner(KEY)
    learner.importLearningState(state)
    assert.equal(learner.serializeLearningState().gearTargets[0].modelRpm, null, String(modelRpm))
    assert.equal(gearOf(learner.snapshot(frame({ gear: 2 })), 2).modelRpm, null)
  }
})

test('reset clears the model point and the power curve; a transient reset keeps them', () => {
  const learner = new ShiftLightLearner(KEY)
  const endMs = pull(learner, { comparable: false })
  const modelRpm = gearOf(learner.snapshot(frame({ gear: 2 })), 2).modelRpm
  learner.resetTransient()
  assert.equal(gearOf(learner.snapshot(frame({ gear: 2 })), 2).modelRpm, modelRpm)
  learner.reset()
  assert.deepEqual(learner.serializeLearningState().gearTargets, [])
  // Without the old curve, a single settled frame cannot place a model point.
  const snapshot = learner.update(frame({ timestampMs: endMs + 2000, gear: 2, rpm: 6000, speedKmh: 6000 / RATIOS[2] }))
  assert.equal(snapshot.gears.every(item => item.modelRpm === null), true)
  assert.equal(snapshot.diagnostics.every(item => item.model.rpm === null && item.model.ratioStep === null), true)
})

test('every snapshot gear and diagnostic carries the model fields', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  const snapshot = learner.update(frame({ timestampMs: 0, gear: 2, rpm: 6000 }))
  const gear = gearOf(snapshot, 2)
  assert.deepEqual({ modelRpm: gear.modelRpm, shiftAtRpm: gear.shiftAtRpm, ready: gear.ready }, { modelRpm: null, shiftAtRpm: 10000, ready: false })
  assert.deepEqual(modelOf(snapshot, 2), { rpm: null, kind: null, coverage: null, ratioStep: null, agree: 0, contradict: 0, rejected: false })
})
