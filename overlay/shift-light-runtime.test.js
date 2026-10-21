const assert = require('node:assert/strict')
const test = require('node:test')
const engine = require('./shift-light-engine.js')

const car = { ordinal: 3766, class: 1, pi: 800, drivetrain: 1, cylinders: 10 }
function frame(overrides = {}) {
  return {
    isRaceOn: true, timestampMs: 0, car, gear: 1, rpm: 9500, rpmMax: 11000,
    throttle: 1, brake: 0, handBrake: 0, clutch: 0, power: 405, speedKmh: 100,
    combinedSlip: { fl: 0, fr: 0, rl: 0, rr: 0 }, ...overrides
  }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

function createRuntime({ stored = null, failSave = false, events = [], shiftLight = engine } = {}) {
  const calls = []
  const path = require.resolve('./shift-light-runtime.js')
  delete require.cache[path]
  global.HudShiftLight = shiftLight
  global.HudTauriEvents = { getEventApi: () => ({
    emit: (name, payload) => {
      events.push({ name, payload })
      return Promise.resolve()
    }
  }) }
  global.__TAURI_INTERNALS__ = { invoke: (command, args) => {
    calls.push({ command, args })
    if (command === 'resolve_shift_light_config') return Promise.resolve({ variantId: 42, status: 'ready' })
    if (command === 'load_shift_light_calibration') return Promise.resolve(stored)
    if (command === 'save_shift_light_calibration') return failSave ? Promise.reject(new Error('disk unavailable')) : Promise.resolve()
    if (command === 'clear_shift_light_config') return Promise.resolve()
    return Promise.resolve(null)
  } }
  require(path)
  return { calls, runtime: global.HudShiftLightRuntime }
}

test('resolves a six-field configuration and persists compact calibration', async () => {
  const { calls, runtime } = createRuntime()
  // A clean lead-in: before frames count only after 150 ms of settled power.
  runtime.update(frame({ timestampMs: -150, rpm: 9100 }))
  runtime.update(frame({ timestampMs: 0, rpm: 9400 }))
  runtime.update(frame({ timestampMs: 16, rpm: 9500 }))
  runtime.update(frame({ timestampMs: 32, gear: 2, rpm: 6500, power: -50 }))
  runtime.update(frame({ timestampMs: 48, gear: 2, rpm: 6600, power: -20 }))
  runtime.update(frame({ timestampMs: 112, gear: 2, rpm: 7000, power: 420 }))
  runtime.update(frame({ timestampMs: 128, gear: 2, rpm: 7100, power: 420 }))
  runtime.update(frame({ timestampMs: 144, gear: 2, rpm: 7200, power: 420 }))
  await flush(); await flush(); await flush(); await flush(); await flush()
  assert.deepEqual(calls.find(call => call.command === 'resolve_shift_light_config').args, {
    key: 'fh6:3766:1:800:1:10', observedGear: 1, reportedRedlineRpm: 11000
  })
  const saves = calls.filter(call => call.command === 'save_shift_light_calibration')
  const save = saves[saves.length - 1]
  assert.equal(save.args.request.configId, 42)
  assert.equal(save.args.request.reportedRedlineRpm, 11000)
  assert.ok(['learning', 'potential', 'optimal'].includes(save.args.request.gearTargets[0].status))
  assert.equal('modelVersion' in save.args.request, false)
  assert.equal('optimalRpm' in save.args.request.gearTargets[0], true)
  assert.equal('targetRpm' in save.args.request.gearTargets[0], false)
  assert.equal('powerBins' in save.args.request.gearTargets[0], false)
  assert.equal(save.args.request.gearTargets[0].confirmationCount, 1)
  assert.equal(save.args.request.shiftSamples.length, 1)
  assert.equal(save.args.request.shiftSamples[0].classification, 'crossover')
  assert.ok(save.args.request.shiftSamples[0].beforePower > 0)
  assert.ok(save.args.request.shiftSamples[0].afterPower > 0)
})

test('surfaces a calibration save failure without dropping live state', async () => {
  const { runtime } = createRuntime({ failSave: true })
  runtime.update(frame({ timestampMs: 0 }))
  await flush(); await flush()
  assert.match(runtime.getState().persistenceError, /disk unavailable/i)
  assert.ok(runtime.getState().gears.length > 0)
})

test('publishes hud_shift_light only when the displayed state changes, while update still returns the state', async () => {
  const events = []
  const { runtime } = createRuntime({ events })
  const emitCount = () => events.filter(event => event.name === 'hud_shift_light').length
  const frozen = frame({ timestampMs: 1000, gear: 1, rpm: 5000 })

  // Settle the car resolution and the first snapshot before counting emits.
  runtime.update(frozen)
  await flush(); await flush(); await flush(); await flush(); await flush()
  runtime.update(frozen)
  const settled = emitCount()

  for (let index = 0; index < 10; index += 1) {
    const returned = runtime.update(frozen)
    assert.equal(returned, runtime.getState())
    assert.equal(returned.carKey, 'fh6:3766:1:800:1:10')
    assert.equal(returned.currentGear, 1)
  }
  assert.equal(emitCount(), settled)

  runtime.update(frame({ timestampMs: 1016, gear: 2, rpm: 6000 }))
  assert.equal(emitCount(), settled + 1)
  assert.equal(events.filter(event => event.name === 'hud_shift_light').at(-1).payload.currentGear, 2)

  const beforeSync = emitCount()
  runtime.sync()
  runtime.sync()
  assert.equal(emitCount(), beforeSync + 2)
  assert.equal(events.filter(event => event.name === 'hud_shift_light').at(-1).payload.currentGear, 2)
})

test('loads up to twelve stored ceiling samples, keeps the highest and reports the cluster count', async () => {
  const stored = {
    modelVersion: 4,
    reportedRedlineRpm: 11000,
    usableCeiling: 9901,
    ceilingSamples: [9900, 9901, 9902, ...Array.from({ length: 12 }, (_, index) => 7100 + index)],
    gearTargets: [],
    shiftSamples: []
  }
  const keptHighest = [...Array.from({ length: 9 }, (_, index) => 7103 + index), 9900, 9901, 9902]
  const { calls, runtime } = createRuntime({ stored })
  runtime.update(frame({ timestampMs: 0, rpm: 9400 }))
  await flush(); await flush(); await flush(); await flush(); await flush()
  const state = runtime.update(frame({ timestampMs: 16, rpm: 9400 }))
  assert.equal(state.ceilingSampleCount, 12)
  assert.equal(state.ceilingClusterCount, 3)
  assert.equal(state.usableCeiling, 9901)
  const saves = calls.filter(call => call.command === 'save_shift_light_calibration')
  assert.deepEqual(saves[saves.length - 1].args.request.ceilingSamples, keptHighest)
})

test('saves the ceiling samples withdrawn by a higher clean full-throttle RPM', async () => {
  const stored = { modelVersion: 4, reportedRedlineRpm: 10000, usableCeiling: 8610,
    ceilingSamples: [8600, 8610, 8620], gearTargets: [], shiftSamples: [] }
  const { calls, runtime } = createRuntime({ stored })
  runtime.update(frame({ timestampMs: 0, rpm: 8000, rpmMax: 10000 }))
  await flush(); await flush(); await flush(); await flush(); await flush()
  assert.equal(runtime.update(frame({ timestampMs: 16, rpm: 8100, rpmMax: 10000 })).usableCeiling, 8610)
  const state = runtime.update(frame({ timestampMs: 32, rpm: 9187, rpmMax: 10000 }))
  assert.equal(state.usableCeiling, null)
  assert.equal(state.ceilingSampleCount, 0)
  await flush(); await flush(); await flush()
  const saves = calls.filter(call => call.command === 'save_shift_light_calibration')
  assert.deepEqual(saves[saves.length - 1].args.request.ceilingSamples, [])
  assert.equal(saves[saves.length - 1].args.request.usableCeiling, null)
})

test('exposes a zero ceiling cluster count before any configuration is resolved', () => {
  const { runtime } = createRuntime()
  const empty = runtime.update(null)
  assert.equal(empty.ceilingClusterCount, 0)
  assert.equal(empty.ceilingSampleCount, 0)
})

test('passes cue timing, ceiling and last known gear through to the overlay', () => {
  const events = []
  const { runtime } = createRuntime({ events })
  const empty = runtime.update(null)
  assert.equal(empty.lastKnownGear, false)
  assert.equal(empty.lightOnRpm, null)
  assert.equal(empty.effectiveTargetRpm, null)

  const state = runtime.update(frame({ timestampMs: 0, gear: 1, rpm: 9400 }))
  assert.equal(state.effectiveTargetRpm, 11000)
  assert.equal(state.lightOnRpm, 10800)
  assert.equal(state.rpmMax, 11000)
  assert.equal(state.usableCeiling, null)
  assert.equal(state.currentGear, 1)
  assert.equal(state.lastKnownGear, true)

  const lower = runtime.update(frame({ timestampMs: 16, gear: 2, rpm: 6000 }))
  assert.equal(lower.lastKnownGear, true)
  const back = runtime.update(frame({ timestampMs: 32, gear: 1, rpm: 6000 }))
  assert.equal(back.lastKnownGear, false)
  const published = events.filter(event => event.name === 'hud_shift_light').at(-1).payload
  assert.equal(published.lastKnownGear, false)
})

// A minimal learner that exposes the model point of each pair, independent of the real bundle.
function fakeShiftLight() {
  const learners = []
  class ShiftLightLearner {
    constructor(key) {
      this.key = key
      this.modelRpm = null
      this.merged = null
      learners.push(this)
    }

    snapshot() {
      return { carKey: this.key, observedGearCount: 1, gears: [] }
    }

    update() {
      return this.snapshot()
    }

    serializeLearningState() {
      return {
        reportedRedlineRpm: 11000,
        usableCeiling: null,
        ceilingSamples: [],
        gearTargets: [{
          sourceGear: 1, destinationGear: 2, status: 'learning',
          candidateRpm: null, optimalRpm: null, confirmationCount: 0, modelRpm: this.modelRpm
        }],
        shiftSamples: []
      }
    }

    mergeCalibration(calibration) {
      this.merged = calibration
    }

    resetTransient() {}
    reset() {}
  }
  return { learners, shiftLight: { getShiftLightCarKey: engine.getShiftLightCarKey, ShiftLightLearner } }
}

test('saves a new model point of a gear pair as part of the compact calibration', async () => {
  const { learners, shiftLight } = fakeShiftLight()
  const { calls, runtime } = createRuntime({ shiftLight })
  runtime.update(frame({ timestampMs: 0 }))
  await flush(); await flush(); await flush(); await flush(); await flush()
  const saves = () => calls.filter(call => call.command === 'save_shift_light_calibration')
  assert.equal(saves().at(-1).args.request.gearTargets[0].modelRpm, null)
  const savedBefore = saves().length

  runtime.update(frame({ timestampMs: 16 }))
  await flush(); await flush()
  assert.equal(saves().length, savedBefore, 'an unchanged state is not saved again')

  learners[0].modelRpm = 7499.6
  runtime.update(frame({ timestampMs: 32 }))
  await flush(); await flush(); await flush()
  assert.equal(saves().length, savedBefore + 1)
  assert.deepEqual(saves().at(-1).args.request.gearTargets[0], {
    sourceGear: 1,
    destinationGear: 2,
    status: 'learning',
    candidateRpm: null,
    optimalRpm: null,
    confirmationCount: 0,
    modelRpm: 7500,
    acceptedShiftCount: 0,
    lastDeltaPct: null,
    lastAcceptedAt: null
  })
})

test('hands a stored model point to the learner and drops a malformed one', async () => {
  const { learners, shiftLight } = fakeShiftLight()
  const stored = {
    modelVersion: 4,
    reportedRedlineRpm: 11000,
    usableCeiling: null,
    ceilingSamples: [],
    gearTargets: [
      { sourceGear: 1, destinationGear: 2, status: 'optimal', candidateRpm: 7400, optimalRpm: 7450, confirmationCount: 3, modelRpm: 7500 },
      { sourceGear: 2, destinationGear: 3, status: 'learning', candidateRpm: null, optimalRpm: null, confirmationCount: 0, modelRpm: null },
      { sourceGear: 3, destinationGear: 4, status: 'learning', candidateRpm: null, optimalRpm: null, confirmationCount: 0, modelRpm: -1 }
    ],
    shiftSamples: []
  }
  const { runtime } = createRuntime({ stored, shiftLight })
  runtime.update(frame({ timestampMs: 0 }))
  await flush(); await flush(); await flush(); await flush(); await flush()
  const targets = learners[0].merged.gearTargets
  assert.deepEqual(targets.map(target => target.modelRpm), [7500, null, null])
  assert.equal(targets[0].targetRpm, 7450)
})
