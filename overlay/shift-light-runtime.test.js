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

function createRuntime({ stored = null, failSave = false } = {}) {
  const calls = []
  const path = require.resolve('./shift-light-runtime.js')
  delete require.cache[path]
  global.HudShiftLight = engine
  global.HudTauriEvents = { getEventApi: () => ({ emit: () => Promise.resolve() }) }
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
