const assert = require('node:assert/strict')
const test = require('node:test')

const shiftLightEngine = require('./shift-light-engine.js')

function frame(overrides = {}) {
  return {
    timestampMs: 1000,
    isRaceOn: true,
    car: { ordinal: 123, class: 4, pi: 800, drivetrain: 1, cylinders: 8 },
    gear: 3,
    rpm: 6500,
    rpmMax: 8000,
    throttle: 1,
    brake: 0,
    clutch: 0,
    power: 100000,
    wheelRotation: { fl: 50, fr: 50, rl: 50, rr: 50 },
    ...overrides
  }
}

function flushPromises() {
  return new Promise(resolve => setImmediate(resolve))
}

function createRuntime(options = {}) {
  const calls = []
  const profiles = options.profiles || []
  const runtimePath = require.resolve('./shift-light-runtime.js')
  delete require.cache[runtimePath]
  global.HudShiftLight = shiftLightEngine
  global.HudTauriEvents = { getEventApi: () => ({ emit: () => Promise.resolve() }) }
  global.__TAURI_INTERNALS__ = { invoke: (command, args) => {
    calls.push({ command, args })
    if (command === 'get_latest_shift_light_config') return Promise.resolve(options.latestGearCount ?? null)
    if (command === 'register_shift_light_config') return Promise.resolve({ variantId: 202, status: 'ready', ratioFeatures: args.gearboxSignature || null })
    if (command === 'load_shift_light_config_profiles') return Promise.resolve(profiles)
    if (command === 'save_shift_light_config_profile') return Promise.resolve()
    if (command === 'clear_shift_light_config') return Promise.resolve()
    return Promise.resolve(null)
  } }
  require(runtimePath)
  return { calls, runtime: global.HudShiftLightRuntime }
}

function confirmTerminalGear(runtime, gear, start = 1000) {
  for (let pull = 0; pull < 2; pull += 1) {
    const base = start + pull * 100
    if (pull > 0) runtime.update(frame({ gear, rpm: 6000, timestampMs: base - 16 }))
    runtime.update(frame({ gear, rpm: 8000, timestampMs: base }))
    runtime.update(frame({ gear, rpm: 7600, timestampMs: base + 16 }))
    runtime.update(frame({ gear, rpm: 7500, timestampMs: base + 32 }))
  }
}

test('waits for repeated limiter evidence before selecting a gear-count configuration', async () => {
  const { calls, runtime } = createRuntime()
  runtime.update(frame({ gear: 6 }))
  await flushPromises()
  assert.equal(calls.some(call => call.command === 'register_shift_light_config'), false)

  confirmTerminalGear(runtime, 6)
  await flushPromises()

  const registration = calls.find(call => call.command === 'register_shift_light_config')
  assert.deepEqual(registration?.args, {
    key: 'fh6:123:4:800:1:8:8000',
    gearCount: 6
  })
})

test('keeps RWD and AWD configurations separate for the same car ordinal', async () => {
  const { calls, runtime } = createRuntime({ latestGearCount: 6 })
  runtime.update(frame({ gear: 3 }))
  await flushPromises()
  runtime.update(frame({ car: { ordinal: 123, class: 4, pi: 800, drivetrain: 2, cylinders: 8 }, gear: 3 }))
  await flushPromises()

  const keys = calls
    .filter(call => call.command === 'get_latest_shift_light_config')
    .map(call => call.args.key)
  assert.deepEqual(keys, ['fh6:123:4:800:1:8:8000', 'fh6:123:4:800:2:8:8000'])
})

test('does not save a profile before the top-gear count is confirmed', async () => {
  const { calls, runtime } = createRuntime()
  runtime.update(frame({ gear: 3, rpm: 8000, timestampMs: 0 }))
  runtime.update(frame({ gear: 11, rpm: 7800, timestampMs: 16 }))
  runtime.update(frame({ gear: 4, rpm: 6000, timestampMs: 48 }))
  await flushPromises()

  assert.equal(calls.some(call => call.command === 'save_shift_light_config_profile'), false)
})
