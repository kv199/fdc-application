const assert = require('node:assert/strict')
const test = require('node:test')

const { getShiftLightCarKey, ShiftLightLearner } = require('./shift-light-engine.js')

const car = { ordinal: 3766, class: 1, pi: 800, drivetrain: 1, cylinders: 10 }

function frame(overrides = {}) {
  return {
    isRaceOn: true, timestampMs: 0, car, gear: 1, rpm: 9000, rpmMax: 11000,
    throttle: 1, brake: 0, handBrake: 0, clutch: 0, power: 400, torque: 200,
    speedKmh: 100, combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 }, ...overrides
  }
}

function upshift(learner, timestampMs, rpm, afterPower = 420) {
  // A clean full-throttle lead-in: before frames count only after 150 ms of settled power.
  learner.update(frame({ timestampMs: timestampMs - 150, rpm: rpm - 300, power: 380 }))
  learner.update(frame({ timestampMs, rpm: rpm - 100, power: 390 }))
  learner.update(frame({ timestampMs: timestampMs + 16, rpm, power: 405 }))
  // The first new-gear frames are torque-cut and must not be used as afterPower.
  learner.update(frame({ timestampMs: timestampMs + 32, gear: 2, rpm: 6500, power: -50 }))
  learner.update(frame({ timestampMs: timestampMs + 48, gear: 2, rpm: 6600, power: -20 }))
  learner.update(frame({ timestampMs: timestampMs + 112, gear: 2, rpm: 7000, power: afterPower }))
  learner.update(frame({ timestampMs: timestampMs + 128, gear: 2, rpm: 7100, power: afterPower }))
  learner.update(frame({ timestampMs: timestampMs + 144, gear: 2, rpm: 7200, power: afterPower }))
}

function ceilingLearner(ceilingSamples, reportedRedlineRpm = 10000) {
  const key = getShiftLightCarKey(frame())
  const learner = new ShiftLightLearner(key)
  learner.importState({ modelVersion: 4, version: 4, key, reportedRedlineRpm, ceilingSamples,
    usableCeiling: null, gearTargets: [], shiftSamples: [] })
  return learner
}

// One clean full-throttle limiter pull on a 10,000 RPM redline: rise 100+ RPM, peak, drop 60 RPM,
// recover near the peak, then a non-clean frame that re-arms the detector. Returns the next timestamp.
function limiterPull(learner, startMs, peakRpm) {
  const rpms = [6000, 7000, peakRpm, peakRpm - 60, peakRpm - 5]
  rpms.forEach((rpm, index) => learner.update(frame({ timestampMs: startMs + index * 16, gear: 1, rpm, rpmMax: 10000 })))
  learner.update(frame({ timestampMs: startMs + rpms.length * 16, gear: 1, rpm: peakRpm - 5, throttle: 0, rpmMax: 10000 }))
  return startMs + (rpms.length + 1) * 16 + 200
}

function ceilingOf(learner) {
  const snapshot = learner.snapshot(frame())
  return { usableCeiling: snapshot.usableCeiling, sampleCount: snapshot.ceilingSampleCount, clusterCount: snapshot.ceilingClusterCount }
}

test('a false low detection does not block the Honda limiter; the next tight sample learns it', () => {
  assert.deepEqual(ceilingOf(ceilingLearner([7106, 9196, 9195])), { usableCeiling: null, sampleCount: 3, clusterCount: 2 })
  assert.deepEqual(ceilingOf(ceilingLearner([7106, 9196, 9195, 9190])), { usableCeiling: 9195, sampleCount: 4, clusterCount: 3 })
})

test('low false detections never matter when three tight samples sit above them', () => {
  assert.deepEqual(ceilingOf(ceilingLearner([6200, 5900, 9100, 9105, 9102])), { usableCeiling: 9102, sampleCount: 5, clusterCount: 3 })
})

test('an isolated high spike more than 400 RPM above the cluster does not block it', () => {
  assert.deepEqual(ceilingOf(ceilingLearner([8700, 8710, 8720, 9400])), { usableCeiling: 8710, sampleCount: 4, clusterCount: 3 })
})

test('two qualifying clusters resolve to the higher one', () => {
  assert.deepEqual(ceilingOf(ceilingLearner([8600, 8601, 8602, 9200, 9201, 9199])), { usableCeiling: 9200, sampleCount: 6, clusterCount: 3 })
})

test('a qualifying cluster waits while a considered sample sits within 400 RPM above it', () => {
  assert.deepEqual(ceilingOf(ceilingLearner([8300, 8310, 8320, 8600], null)), { usableCeiling: null, sampleCount: 4, clusterCount: 1 })
  assert.deepEqual(ceilingOf(ceilingLearner([8300, 8310, 8320, 9400], null)), { usableCeiling: 8310, sampleCount: 4, clusterCount: 3 })
})

test('a cluster of six is accepted even with a stray sample within 400 RPM above it', () => {
  // One stray high observation stays among the highest samples, so it must not block forever.
  assert.deepEqual(ceilingOf(ceilingLearner([9100, 9105, 9110, 9112, 9115, 9450], null)), { usableCeiling: null, sampleCount: 6, clusterCount: 1 })
  assert.deepEqual(ceilingOf(ceilingLearner([9100, 9105, 9110, 9112, 9115, 9118, 9450], null)), { usableCeiling: 9110, sampleCount: 7, clusterCount: 6 })
})

test('samples below 85% of the reported redline are stored but not considered', () => {
  assert.deepEqual(ceilingOf(ceilingLearner([8300, 8310, 8320, 8600])), { usableCeiling: null, sampleCount: 4, clusterCount: 1 })
  assert.deepEqual(ceilingOf(ceilingLearner([8300, 8310, 8320, 9400])), { usableCeiling: null, sampleCount: 4, clusterCount: 1 })
  assert.deepEqual(ceilingOf(ceilingLearner([7100, 7150, 7200])), { usableCeiling: null, sampleCount: 3, clusterCount: 0 })
})

test('no cluster of three yields no ceiling and reports the size of the highest group', () => {
  assert.deepEqual(ceilingOf(ceilingLearner([])), { usableCeiling: null, sampleCount: 0, clusterCount: 0 })
  assert.deepEqual(ceilingOf(ceilingLearner([9000, 9050])), { usableCeiling: null, sampleCount: 2, clusterCount: 2 })
  assert.deepEqual(ceilingOf(ceilingLearner([8600, 9000, 9500])), { usableCeiling: null, sampleCount: 3, clusterCount: 1 })
})

test('an imported window of more than twelve samples keeps the highest twelve', () => {
  const lowerTwelve = Array.from({ length: 12 }, (_, index) => 7100 + index)
  assert.deepEqual(ceilingOf(ceilingLearner([9900, 9901, 9902, ...lowerTwelve])), { usableCeiling: 9901, sampleCount: 12, clusterCount: 3 })
})

test('live limiter pulls keep the highest twelve observations', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  let startMs = 0
  // The lower twelve stay within 400 RPM of the highest clean full-throttle RPM, so none is withdrawn.
  for (let peak = 9600; peak <= 9611; peak += 1) startMs = limiterPull(learner, startMs, peak)
  for (const peak of [9900, 9901, 9902]) startMs = limiterPull(learner, startMs, peak)
  assert.deepEqual(ceilingOf(learner), { usableCeiling: 9901, sampleCount: 12, clusterCount: 3 })
})

test('live limiter pulls report the Honda progress before and after a tight third sample', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  let startMs = 0
  // Reaching 9,196 RPM on clean full throttle withdraws the false 7,106 detection.
  for (const peak of [7106, 9196, 9195]) startMs = limiterPull(learner, startMs, peak)
  assert.deepEqual(ceilingOf(learner), { usableCeiling: null, sampleCount: 2, clusterCount: 2 })
  startMs = limiterPull(learner, startMs, 9190)
  assert.deepEqual(ceilingOf(learner), { usableCeiling: 9195, sampleCount: 3, clusterCount: 3 })
})

// A clean full-throttle pull that rises to topRpm without a limiter pattern, then lifts. Returns the next timestamp.
function wotPull(learner, startMs, topRpm, gear = 1) {
  const rpms = [topRpm - 1000, topRpm - 500, topRpm]
  rpms.forEach((rpm, index) => learner.update(frame({ timestampMs: startMs + index * 16, gear, rpm, rpmMax: 10000 })))
  learner.update(frame({ timestampMs: startMs + rpms.length * 16, gear, rpm: topRpm - 200, throttle: 0, rpmMax: 10000 }))
  return startMs + (rpms.length + 1) * 16 + 200
}

function ceilingDetails(learner) {
  const snapshot = learner.snapshot(frame({ rpm: 5000, rpmMax: 10000 }))
  return { samples: learner.serializeLearningState().ceilingSamples, usableCeiling: snapshot.usableCeiling, provisionalCeiling: snapshot.provisionalCeiling }
}

test('a wheelspin limiter pattern far below a higher clean full-throttle RPM is withdrawn', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  let startMs = limiterPull(learner, 0, 8600)
  assert.deepEqual(ceilingDetails(learner), { samples: [8600], usableCeiling: null, provisionalCeiling: 8600 })
  startMs = wotPull(learner, startMs, 9187, 5)
  const details = ceilingDetails(learner)
  assert.equal(details.samples.some(sample => sample < 9187 - 400), false)
  assert.deepEqual(details, { samples: [], usableCeiling: null, provisionalCeiling: null })
})

test('a low limiter pattern after a higher clean full-throttle RPM is not recorded', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  const startMs = wotPull(learner, 0, 9187, 3)
  limiterPull(learner, startMs, 8600)
  assert.deepEqual(ceilingDetails(learner), { samples: [], usableCeiling: null, provisionalCeiling: null })
})

test('the highest clean full-throttle RPM raises a provisional ceiling but never creates one', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  // Without a limiter observation the cue keeps the reported redline instead of following the climbing RPM.
  let startMs = wotPull(learner, 0, 9187, 4)
  assert.deepEqual(ceilingDetails(learner), { samples: [], usableCeiling: null, provisionalCeiling: null })
  startMs = limiterPull(learner, startMs, 8900)
  assert.deepEqual(ceilingDetails(learner), { samples: [8900], usableCeiling: null, provisionalCeiling: 9187 })
})

test('real limiter hits within 400 RPM below the highest clean full-throttle RPM are kept', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  let startMs = wotPull(learner, 0, 9187, 4)
  for (const peak of [8787, 8786, 9100, 9105, 9102]) startMs = limiterPull(learner, startMs, peak)
  assert.deepEqual(ceilingDetails(learner), { samples: [8787, 9100, 9102, 9105], usableCeiling: 9102, provisionalCeiling: null })
})

test('a trusted ceiling is withdrawn when clean full throttle later exceeds it by more than 400 RPM', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  let startMs = 0
  for (const peak of [8700, 8710, 8720]) startMs = limiterPull(learner, startMs, peak)
  assert.deepEqual(ceilingDetails(learner), { samples: [8700, 8710, 8720], usableCeiling: 8710, provisionalCeiling: null })
  startMs = wotPull(learner, startMs, 9050, 6)
  assert.equal(ceilingDetails(learner).usableCeiling, 8710)
  wotPull(learner, startMs, 9187, 6)
  const state = learner.serializeLearningState()
  assert.deepEqual({ samples: state.ceilingSamples, usableCeiling: state.usableCeiling }, { samples: [], usableCeiling: null })
  assert.deepEqual(ceilingDetails(learner), { samples: [], usableCeiling: null, provisionalCeiling: null })
})

test('the highest clean full-throttle RPM survives a transient reset but not a full reset', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  let startMs = wotPull(learner, 0, 9187, 2)
  learner.resetTransient()
  startMs = limiterPull(learner, startMs, 8600)
  assert.deepEqual(ceilingDetails(learner), { samples: [], usableCeiling: null, provisionalCeiling: null })
  learner.reset()
  assert.equal(ceilingDetails(learner).provisionalCeiling, null)
  limiterPull(learner, startMs, 8600)
  assert.deepEqual(ceilingDetails(learner), { samples: [8600], usableCeiling: null, provisionalCeiling: 8600 })
})

test('imported ceiling samples stay until this run reaches a higher clean full-throttle RPM', () => {
  const learner = ceilingLearner([8600, 8610, 8620])
  let startMs = wotPull(learner, 0, 8900, 2)
  assert.deepEqual(ceilingDetails(learner), { samples: [8600, 8610, 8620], usableCeiling: 8610, provisionalCeiling: null })
  wotPull(learner, startMs, 9187, 2)
  assert.deepEqual(ceilingDetails(learner), { samples: [], usableCeiling: null, provisionalCeiling: null })
})

test('importing or merging a calibration keeps the highest clean full-throttle RPM of the run', () => {
  const key = getShiftLightCarKey(frame())
  const stored = { modelVersion: 4, version: 4, key, reportedRedlineRpm: 10000, ceilingSamples: [9100, 9105, 9102],
    usableCeiling: null, gearTargets: [], shiftSamples: [] }
  const imported = new ShiftLightLearner(key)
  let startMs = wotPull(imported, 0, 9187, 2)
  imported.importState(stored)
  limiterPull(imported, startMs, 8600)
  assert.deepEqual(ceilingDetails(imported).samples, [9100, 9102, 9105])
  const merged = new ShiftLightLearner(key)
  startMs = wotPull(merged, 0, 9187, 2)
  merged.mergeLearningState(stored)
  limiterPull(merged, startMs, 8600)
  assert.deepEqual(ceilingDetails(merged).samples, [9100, 9102, 9105])
})

test('uses only the stable vehicle configuration fields for the learner key', () => {
  assert.equal(getShiftLightCarKey(frame()), 'fh6:3766:1:800:1:10')
  assert.equal(getShiftLightCarKey(frame({ rpmMax: 9500 })), 'fh6:3766:1:800:1:10')
})

test('confirms the median of three clean better real upshifts', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  upshift(learner, 0, 9500)
  upshift(learner, 1000, 9550)
  upshift(learner, 2000, 9600)
  const gear = learner.snapshot(frame()).gears.find(item => item.gear === 1)
  assert.deepEqual(
    { status: gear.status, rpm: gear.shiftRpm, confirmations: gear.confirmationCount },
    { status: 'optimal', rpm: 9550, confirmations: 3 }
  )
})

// A 4th-gear pull into the limiter: steady power, a limiter cut with negative power, then power
// returns reduced and ramps back. `ramp` lists the [timestampMs, rpm, power] frames after the cut.
function limiterCutPull(learner, ramp) {
  for (let t = 0; t <= 160; t += 16) learner.update(frame({ timestampMs: t, gear: 4, rpm: 9000 + t * 3, power: 700 }))
  learner.update(frame({ timestampMs: 176, gear: 4, rpm: 9355, power: -492 }))
  learner.update(frame({ timestampMs: 192, gear: 4, rpm: 9182, power: -300 }))
  for (const [timestampMs, rpm, power] of ramp) learner.update(frame({ timestampMs, gear: 4, rpm, power }))
}
// Neutral, then clean 5th-gear frames from POST_SHIFT_DELAY_MS after the transition on.
function neutralShiftToFifth(learner, neutralMs, afterPower) {
  learner.update(frame({ timestampMs: neutralMs, gear: 11, rpm: 9302, power: -456 }))
  learner.update(frame({ timestampMs: neutralMs + 16, gear: 5, rpm: 8005, power: 599 }))
  for (const offset of [96, 112, 128]) learner.update(frame({ timestampMs: neutralMs + offset, gear: 5, rpm: 8005 + offset, power: afterPower }))
}

test('a shift while power ramps back after a limiter cut is ignored', () => {
  // Recorded cases: a shift 31 ms after power returned, and one 94 ms after it while power was still ~5% low.
  const ramps = [
    [[208, 9182, 593], [224, 9257, 602], [224, 9314, 610], [224, 9360, 617], [240, 9398, 624]],
    [[208, 9300, 534], [224, 9330, 551], [240, 9360, 580], [256, 9390, 610], [272, 9420, 640], [288, 9440, 653], [302, 9456, 658]]
  ]
  for (const ramp of ramps) {
    const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
    limiterCutPull(learner, ramp)
    neutralShiftToFifth(learner, ramp.at(-1)[0], 671)
    const state = learner.serializeLearningState()
    assert.deepEqual(state.shiftSamples, [])
    assert.equal(state.gearTargets.find(item => item.sourceGear === 4)?.status ?? 'learning', 'learning')
  }
})

test('a shift after 150 ms of settled power following a limiter cut compares only settled frames', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  limiterCutPull(learner, [[208, 9182, 593], [224, 9257, 602], [240, 9398, 624], [256, 9420, 640], [272, 9440, 660],
    [288, 9450, 705], [304, 9460, 710], [320, 9470, 708], [336, 9475, 709], [352, 9478, 710],
    [368, 9480, 712], [384, 9490, 711], [400, 9495, 713]])
  neutralShiftToFifth(learner, 416, 760)
  const samples = learner.serializeLearningState().shiftSamples
  assert.equal(samples.length, 1)
  // The run restarts at 208 ms, so only the 368, 384 and 400 ms frames are before evidence.
  assert.deepEqual({ sourceGear: samples[0].sourceGear, beforeTimestampMs: samples[0].beforeTimestampMs, beforeRpm: samples[0].beforeRpm, beforePower: samples[0].beforePower },
    { sourceGear: 4, beforeTimestampMs: 384, beforeRpm: 9490, beforePower: 712 })
})

test('a partial-throttle or clutch frame in the source gear restarts the pre-shift settle period', () => {
  for (const interruption of [{ throttle: 0.5 }, { clutch: 1 }]) {
    const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
    for (let t = 0; t <= 160; t += 16) learner.update(frame({ timestampMs: t, rpm: 9000 + t * 3, power: 400 }))
    learner.update(frame({ timestampMs: 176, rpm: 9480, power: 400, ...interruption }))
    for (const t of [192, 208, 224]) learner.update(frame({ timestampMs: t, rpm: 9500, power: 410 }))
    learner.update(frame({ timestampMs: 240, gear: 2, rpm: 6500, power: -50 }))
    learner.update(frame({ timestampMs: 256, gear: 2, rpm: 6600, power: -20 }))
    for (const t of [320, 336, 352]) learner.update(frame({ timestampMs: t, gear: 2, rpm: 7000, power: 420 }))
    assert.deepEqual(learner.serializeLearningState().shiftSamples, [], JSON.stringify(interruption))
  }
})

test('a neutral upshift after a settled clean run records the comparison', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  for (let t = 0; t <= 240; t += 16) learner.update(frame({ timestampMs: t, gear: 2, rpm: 9000 + t, power: 400 + t / 16 }))
  learner.update(frame({ timestampMs: 256, gear: 11, rpm: 9100, power: -100 }))
  learner.update(frame({ timestampMs: 272, gear: 11, rpm: 8500, power: -100 }))
  learner.update(frame({ timestampMs: 288, gear: 3, rpm: 7000, power: -50 }))
  for (const t of [368, 384, 400]) learner.update(frame({ timestampMs: t, gear: 3, rpm: 7200, power: 450 }))
  const samples = learner.serializeLearningState().shiftSamples
  assert.equal(samples.length, 1)
  // Frames from 160 ms on are settled; the last five (176-240 ms) are the before evidence.
  assert.deepEqual({ sourceGear: samples[0].sourceGear, destinationGear: samples[0].destinationGear, beforeTimestampMs: samples[0].beforeTimestampMs, beforePower: samples[0].beforePower },
    { sourceGear: 2, destinationGear: 3, beforeTimestampMs: 208, beforePower: 413 })
})

test('uses redline as an operational cue before an earlier candidate exists', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  const state = learner.update(frame({ rpm: 11000 }))
  assert.equal(state.shiftRpm, 11000)
  assert.equal(state.lightOnRpm, 10800)
  assert.equal(state.phase, 'shift')
})

function leadAfterRpmStep(rpmStep, timestampStepMs = 16) {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  learner.update(frame({ timestampMs: 0, rpm: 9000 }))
  return learner.update(frame({ timestampMs: timestampStepMs, rpm: 9000 + rpmStep })).leadRpm
}

test('derives the cue lead from the RPM rate and clamps it to 100–1000 RPM', () => {
  assert.equal(new ShiftLightLearner(getShiftLightCarKey(frame())).snapshot(frame()).leadRpm, 200)
  // 160 RPM in 16 ms is 10,000 RPM/s, so 0.15 s is 1,500 RPM and clamps to the maximum.
  assert.equal(leadAfterRpmStep(160), 1000)
  // 16 RPM in 16 ms is 1,000 RPM/s, so the lead is 150 RPM.
  assert.equal(leadAfterRpmStep(16), 150)
  // 8 RPM in 16 ms is 500 RPM/s, so the raw lead of 75 RPM clamps to the minimum.
  assert.equal(leadAfterRpmStep(8), 100)
})

test('marks the highest forward gear as last known', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  assert.equal(learner.update(frame({ timestampMs: 0, gear: 1 })).lastKnownGear, true)

  upshift(learner, 0, 9500)
  assert.equal(learner.snapshot(frame({ gear: 2 })).lastKnownGear, true)
  assert.equal(learner.update(frame({ timestampMs: 200, gear: 1, rpm: 6000 })).lastKnownGear, false)
})

test('treats persisted evidence of a higher gear as proof after a restart', () => {
  const key = getShiftLightCarKey(frame())
  const first = new ShiftLightLearner(key)
  upshift(first, 0, 9500)
  const restarted = new ShiftLightLearner(key)
  restarted.importLearningState(first.serializeLearningState())
  assert.equal(restarted.update(frame({ timestampMs: 0, gear: 1 })).lastKnownGear, false)
})

test('keeps gear 10 as the last known gear', () => {
  const learner = new ShiftLightLearner(getShiftLightCarKey(frame()))
  assert.equal(learner.update(frame({ timestampMs: 0, gear: 10, rpm: 9000 })).lastKnownGear, true)
  assert.equal(learner.update(frame({ timestampMs: 16, gear: 9, rpm: 7000 })).lastKnownGear, false)
})

test('a first limiter hit gives a provisional ceiling that the cue and fallback target use at once', () => {
  const learner = ceilingLearner([9195])
  const snapshot = learner.snapshot(frame({ rpm: 5000, rpmMax: 10000 }))
  assert.equal(snapshot.usableCeiling, null)
  assert.equal(snapshot.provisionalCeiling, 9195)
  assert.equal(snapshot.fallbackShiftRpm, 9195)
  // Low false hits below 85% of the redline are not a limiter.
  assert.equal(ceilingLearner([7106]).snapshot(frame({ rpmMax: 10000 })).provisionalCeiling, null)
  // The provisional value only rises with later hits, and a trusted ceiling replaces it.
  assert.equal(ceilingLearner([9100, 9195]).snapshot(frame({ rpmMax: 10000 })).provisionalCeiling, 9195)
  const trusted = ceilingLearner([9190, 9195, 9196]).snapshot(frame({ rpmMax: 10000 }))
  assert.equal(trusted.usableCeiling, 9195)
  assert.equal(trusted.provisionalCeiling, null)
  assert.equal(trusted.fallbackShiftRpm, 9195)
})
