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
    if (command === 'load_shift_light_learning_state') return Promise.resolve(stored)
    if (command === 'save_shift_light_learning_state') return failSave ? Promise.reject(new Error('disk unavailable')) : Promise.resolve()
    if (command === 'clear_shift_light_config') return Promise.resolve()
    return Promise.resolve(null)
  } }
  require(path)
  return { calls, runtime: global.HudShiftLightRuntime }
}

test('creates a six-field configuration and persists completed learning state', async () => {
  const { calls, runtime } = createRuntime()
  runtime.update(frame({ timestampMs: 0, rpm: 9400 }))
  runtime.update(frame({ timestampMs: 16, rpm: 9500 }))
  runtime.update(frame({ timestampMs: 32, gear: 2, rpm: 6500, power: 420 }))
  await flush(); await flush()
  assert.deepEqual(calls.find(call => call.command === 'resolve_shift_light_config').args, {
    key: 'fh6:3766:1:800:1:10', observedGear: 1
  })
  const save = calls.find(call => call.command === 'save_shift_light_learning_state')
  assert.equal(save.args.configId, 42)
  assert.equal(save.args.state.modelVersion, 2)
  assert.equal(save.args.state.gears[0].evidence[0].outcome, 'better')
})

test('surfaces a learning-state save failure without dropping live state', async () => {
  const { runtime } = createRuntime({ failSave: true })
  runtime.update(frame({ timestampMs: 0 }))
  await flush(); await flush()
  assert.match(runtime.getState().persistenceError, /disk unavailable/i)
  assert.ok(runtime.getState().gears.length > 0)
})
