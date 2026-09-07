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
  let learnerCount = 0
  const profiles = options.profiles || []
  const runtimePath = require.resolve('./shift-light-runtime.js')
  delete require.cache[runtimePath]
  global.HudShiftLight = {
    ...shiftLightEngine,
    ShiftLightLearner: class extends shiftLightEngine.ShiftLightLearner {
      constructor(...args) {
        super(...args)
        learnerCount += 1
      }
    }
  }
  global.HudTauriEvents = { getEventApi: () => ({ emit: () => Promise.resolve() }) }
  global.__TAURI_INTERNALS__ = { invoke: (command, args) => {
    calls.push({ command, args })
    if (options.invoke) {
      const result = options.invoke(command, args)
      if (result !== undefined) return result
    }
    if (command === 'resolve_shift_light_config') return Promise.resolve({ variantId: 202, status: 'ready', ratioFeatures: null })
    if (command === 'get_latest_shift_light_config') return Promise.resolve(options.latestGearCount ?? null)
    if (command === 'register_shift_light_config') return Promise.resolve({ variantId: 202, status: 'ready', ratioFeatures: args.gearboxSignature || null })
    if (command === 'load_shift_light_config_profiles') return Promise.resolve(profiles)
    if (command === 'save_shift_light_config_profile') return Promise.resolve()
    if (command === 'clear_shift_light_config') return Promise.resolve()
    return Promise.resolve(null)
  } }
  require(runtimePath)
  return { calls, runtime: global.HudShiftLightRuntime, learnerCount: () => learnerCount }
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

test('resolves storage on the first forward gear without limiter evidence', async () => {
  const { calls, runtime } = createRuntime()
  runtime.update(frame({ gear: 6 }))
  await flushPromises()
  const registration = calls.find(call => call.command === 'register_shift_light_config')
  assert.equal(registration, undefined)
  assert.deepEqual(calls.find(call => call.command === 'resolve_shift_light_config')?.args, {
    key: 'fh6:123:4:800:1:8:8000',
    observedGear: 6
  })
})

test('keeps RWD and AWD configurations separate for the same car ordinal', async () => {
  const { calls, runtime } = createRuntime({ latestGearCount: 6 })
  runtime.update(frame({ gear: 3 }))
  await flushPromises()
  runtime.update(frame({ car: { ordinal: 123, class: 4, pi: 800, drivetrain: 2, cylinders: 8 }, gear: 3 }))
  await flushPromises()

  const keys = calls
    .filter(call => call.command === 'resolve_shift_light_config')
    .map(call => call.args.key)
  assert.deepEqual(keys, ['fh6:123:4:800:1:8:8000', 'fh6:123:4:800:2:8:8000'])
})

test('saves a qualifying upshift before any top-gear count is inferred', async () => {
  const { calls, runtime } = createRuntime()
  runtime.update(frame({ gear: 3, rpm: 8000, timestampMs: 0 }))
  runtime.update(frame({ gear: 11, rpm: 7800, timestampMs: 16 }))
  runtime.update(frame({ gear: 4, rpm: 6000, timestampMs: 48 }))
  await flushPromises()

  const save = calls.find(call => call.command === 'save_shift_light_config_profile')
  assert.equal(save?.args.configId, 202)
  assert.equal(save?.args.profile.gear, 3)
  assert.equal(save?.args.profile.sampleCount, 1)
  assert.equal(runtime.getState().gearCount, null)
})

test('car 342 keeps its loaded targets and completes first gear despite a legacy one-gear configuration', async () => {
  const key = 'fh6:342:3:678:1:12:9500'
  const car = { ordinal: 342, class: 3, pi: 678, drivetrain: 1, cylinders: 12 }
  const { calls, runtime, learnerCount } = createRuntime({
    latestGearCount: 1,
    invoke: command => command === 'resolve_shift_light_config'
      ? Promise.resolve({ variantId: 4, status: 'ready' }) : undefined,
    profiles: [
      { key, gear: 1, status: 'learning', sampleCount: 4, samples: [8500, 8550, 8600, 8650], method: 'observed' },
      ...[2, 3, 4, 5, 6].map(gear => ({ key, gear, status: 'calibrated', shiftRpm: 8500, sampleCount: 5, samples: [8575, 8575, 8575, 8575, 8575], method: 'observed' }))
    ]
  })
  runtime.update(frame({ car, rpmMax: 9500, gear: 3, timestampMs: 0 }))
  await flushPromises()
  for (let i = 1; i <= 6; i += 1) {
    const state = runtime.update(frame({ car, rpmMax: 9500, gear: 3, timestampMs: i * 16 }))
    await flushPromises()
    assert.equal(state.shiftRpm, 8500)
  }
  runtime.update(frame({ car, rpmMax: 9500, gear: 1, rpm: 8700, timestampMs: 120 }))
  runtime.update(frame({ car, rpmMax: 9500, gear: 2, rpm: 6000, timestampMs: 136 }))
  await flushPromises()
  assert.equal(learnerCount(), 1)
  assert.equal(calls.filter(call => call.command === 'resolve_shift_light_config').length, 1)
  assert.equal(calls.some(call => call.command === 'get_latest_shift_light_config'), false)
  const saved = calls.find(call => call.command === 'save_shift_light_config_profile' && call.args.profile.gear === 1)
  assert.equal(saved?.args.configId, 4)
  assert.equal(saved?.args.profile.status, 'calibrated')
  assert.equal(saved?.args.profile.sampleCount, 5)
})

test('higher gears and repeated limiter observations keep the same learner and stored configuration', async () => {
  const { calls, runtime, learnerCount } = createRuntime({ latestGearCount: 1 })
  runtime.update(frame({ gear: 1, timestampMs: 0 }))
  await flushPromises()
  confirmTerminalGear(runtime, 1, 100)
  await flushPromises()
  confirmTerminalGear(runtime, 6, 500)
  await flushPromises()
  assert.equal(learnerCount(), 1)
  assert.equal(calls.filter(call => call.command === 'resolve_shift_light_config').length, 1)
  assert.equal(calls.some(call => call.command === 'clear_shift_light_config'), false)
  assert.deepEqual([...new Set(calls.filter(call => call.command === 'save_shift_light_config_profile').map(call => call.args.configId))], [202])
})

test('a delayed load from the previous car cannot publish targets into the current car', async () => {
  let finishLoad
  const oldLoad = new Promise(resolve => { finishLoad = resolve })
  let loads = 0
  const { calls, runtime } = createRuntime({ invoke: command => {
    if (command === 'load_shift_light_config_profiles' && loads++ === 0) return oldLoad
  } })
  runtime.update(frame())
  await flushPromises()
  runtime.update(frame({ car: { ordinal: 342, class: 3, pi: 678, drivetrain: 1, cylinders: 12 } }))
  finishLoad([{ key: 'fh6:123:4:800:1:8:8000', gear: 3, shiftRpm: 7500, status: 'calibrated', sampleCount: 5, samples: [] }])
  await flushPromises()
  assert.equal(runtime.getState().carOrdinal, 342)
  assert.equal(runtime.getState().shiftRpm, null)
  assert.equal(calls.filter(call => call.command === 'resolve_shift_light_config').length, 2)
})

test('storage failure retries without discarding live upshift evidence', async t => {
  let now = 1000
  t.mock.method(Date, 'now', () => now)
  let attempts = 0
  const { calls, runtime, learnerCount } = createRuntime({ invoke: command => {
    if (command === 'resolve_shift_light_config' && attempts++ === 0) return Promise.reject(new Error('busy'))
  } })
  runtime.update(frame({ rpm: 8000, timestampMs: 0 }))
  await flushPromises()
  runtime.update(frame({ gear: 4, rpm: 6000, timestampMs: 16 }))
  await flushPromises()
  assert.equal(calls.filter(call => call.command === 'resolve_shift_light_config').length, 1)
  now += 1000
  runtime.update(frame({ gear: 4, rpm: 6500, timestampMs: 32 }))
  await flushPromises()
  assert.equal(learnerCount(), 1)
  const saved = calls.find(call => call.command === 'save_shift_light_config_profile')
  assert.equal(saved?.args.profile.gear, 3)
  assert.equal(saved?.args.profile.sampleCount, 1)
})

test('failed profile writes retain the latest evidence and retry with backoff', async t => {
  let now = 1000
  t.mock.method(Date, 'now', () => now)
  let saveAttempts = 0
  const { calls, runtime } = createRuntime({ invoke: command => {
    if (command === 'save_shift_light_config_profile' && saveAttempts++ === 0) {
      return Promise.reject(new Error('busy'))
    }
  } })

  runtime.update(frame({ rpm: 8000, timestampMs: 0 }))
  runtime.update(frame({ gear: 4, rpm: 6000, timestampMs: 16 }))
  await flushPromises()
  await flushPromises()
  assert.equal(calls.filter(call => call.command === 'save_shift_light_config_profile').length, 1)

  now += 250
  runtime.update(frame({ gear: 4, rpm: 6500, timestampMs: 32 }))
  await flushPromises()
  await flushPromises()

  const saves = calls.filter(call => call.command === 'save_shift_light_config_profile')
  assert.equal(saves.length, 2)
  assert.equal(saves[1].args.profile.gear, 3)
  assert.equal(saves[1].args.profile.sampleCount, 1)
})

test('newer profile revisions keep the existing write backoff', async t => {
  let now = 1000
  t.mock.method(Date, 'now', () => now)
  let saveAttempts = 0
  const { calls, runtime } = createRuntime({ invoke: command => {
    if (command === 'save_shift_light_config_profile' && saveAttempts++ === 0) {
      return Promise.reject(new Error('busy'))
    }
  } })

  runtime.update(frame({ rpm: 8000, timestampMs: 0 }))
  runtime.update(frame({ gear: 4, rpm: 6000, timestampMs: 16 }))
  await flushPromises()
  await flushPromises()
  assert.equal(calls.filter(call => call.command === 'save_shift_light_config_profile').length, 1)

  runtime.update(frame({ gear: 3, rpm: 8000, timestampMs: 32 }))
  runtime.update(frame({ gear: 4, rpm: 6000, timestampMs: 48 }))
  await flushPromises()
  await flushPromises()
  assert.equal(calls.filter(call => call.command === 'save_shift_light_config_profile').length, 1)

  now += 250
  runtime.update(frame({ gear: 4, rpm: 6500, timestampMs: 64 }))
  await flushPromises()
  await flushPromises()
  const saves = calls.filter(call => call.command === 'save_shift_light_config_profile')
  assert.equal(saves.length, 2)
  assert.equal(saves[1].args.profile.sampleCount, 2)
})

test('a successful same-key learner revision supersedes a failed old writer', async t => {
  let now = 1000
  t.mock.method(Date, 'now', () => now)
  let saveAttempts = 0
  const { calls, runtime } = createRuntime({ invoke: command => {
    if (command === 'save_shift_light_config_profile' && saveAttempts++ === 0) {
      return Promise.reject(new Error('busy'))
    }
  } })

  runtime.update(frame({ rpm: 8000, timestampMs: 0 }))
  runtime.update(frame({ gear: 4, rpm: 6000, timestampMs: 16 }))
  await flushPromises()
  await flushPromises()
  assert.equal(calls.filter(call => call.command === 'save_shift_light_config_profile').length, 1)

  const otherCar = { ordinal: 342, class: 3, pi: 678, drivetrain: 1, cylinders: 12 }
  runtime.update(frame({ car: otherCar, timestampMs: 32 }))
  await flushPromises()
  runtime.update(frame({ rpm: 8000, timestampMs: 48 }))
  await flushPromises()

  runtime.update(frame({ gear: 4, rpm: 6000, timestampMs: 64 }))
  runtime.update(frame({ gear: 3, rpm: 8000, timestampMs: 80 }))
  runtime.update(frame({ gear: 4, rpm: 6000, timestampMs: 96 }))
  await flushPromises()
  await flushPromises()

  let saves = calls.filter(call => call.command === 'save_shift_light_config_profile')
  assert.equal(saves.length, 2)
  assert.equal(saves[1].args.profile.sampleCount, 2)

  now += 250
  runtime.update(frame({ gear: 4, rpm: 6500, timestampMs: 112 }))
  await flushPromises()
  await flushPromises()
  saves = calls.filter(call => call.command === 'save_shift_light_config_profile')
  assert.equal(saves.length, 2)
})

test('reset invalidates retry writers from an older learner with the same key', async () => {
  let saveAttempts = 0
  const { calls, runtime } = createRuntime({ invoke: command => {
    if (command === 'save_shift_light_config_profile' && saveAttempts++ === 0) {
      return Promise.reject(new Error('busy'))
    }
  } })

  runtime.update(frame({ rpm: 8000, timestampMs: 0 }))
  runtime.update(frame({ gear: 4, rpm: 6000, timestampMs: 16 }))
  await flushPromises()
  await flushPromises()
  assert.equal(calls.filter(call => call.command === 'save_shift_light_config_profile').length, 1)

  const otherCar = { ordinal: 342, class: 3, pi: 678, drivetrain: 1, cylinders: 12 }
  runtime.update(frame({ car: otherCar, timestampMs: 32 }))
  await flushPromises()
  runtime.update(frame({ timestampMs: 48 }))
  await flushPromises()
  assert.equal(await runtime.reset(), true)

  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(calls.filter(call => call.command === 'save_shift_light_config_profile').length, 1)
})

test('reset during profile loading cannot restore cleared targets and retains the configuration ID', async () => {
  let finishLoad
  const pendingLoad = new Promise(resolve => { finishLoad = resolve })
  const { calls, runtime } = createRuntime({ invoke: command => {
    if (command === 'load_shift_light_config_profiles') return pendingLoad
  } })
  runtime.update(frame({ timestampMs: 0 }))
  await flushPromises()
  const resetting = runtime.reset()
  finishLoad([{ key: 'fh6:123:4:800:1:8:8000', gear: 3, shiftRpm: 7500, status: 'calibrated', sampleCount: 5, samples: [] }])
  assert.equal(await resetting, true)
  assert.equal(runtime.getState().shiftRpm, null)
  runtime.update(frame({ rpm: 8000, timestampMs: 100 }))
  runtime.update(frame({ gear: 4, rpm: 6000, timestampMs: 116 }))
  await flushPromises()
  assert.equal(calls.filter(call => call.command === 'resolve_shift_light_config').length, 1)
  assert.equal(calls.find(call => call.command === 'save_shift_light_config_profile')?.args.configId, 202)
})

test('publishes a stored optimal profile immediately after configuration load', async () => {
  const { calls, runtime } = createRuntime({
    latestGearCount: 6,
    profiles: [{
      key: 'fh6:123:4:800:1:8:8000',
      gear: 3,
      shiftRpm: 7600,
      sampleCount: 40,
      status: 'calibrated',
      samples: [],
      method: 'optimal',
      ratioDrop: 0.8,
      gearboxSignature: '2:0.8000|3:0.7000'
    }]
  })

  runtime.update(frame({ gear: 3, rpm: 6500, timestampMs: 0 }))
  await flushPromises()
  await flushPromises()

  const state = runtime.getState()
  assert.equal(calls.some(call => call.command === 'load_shift_light_config_profiles'), true)
  assert.equal(state.status, 'calibrated')
  assert.equal(state.method, 'optimal')
  assert.equal(state.shiftRpm, 7600)
  assert.equal(state.gears.find(gear => gear.gear === 3)?.method, 'optimal')
})

test('a failed reset reloads the saved calibration after a suppressed in-flight load', async () => {
  let finishLoad
  let loads = 0
  const profiles = [{ key: 'fh6:123:4:800:1:8:8000', gear: 3, shiftRpm: 7500, status: 'calibrated', sampleCount: 5, samples: [] }]
  const { runtime } = createRuntime({ profiles, invoke: command => {
    if (command === 'load_shift_light_config_profiles' && loads++ === 0) {
      return new Promise(resolve => { finishLoad = resolve })
    }
    if (command === 'clear_shift_light_config') return Promise.reject(new Error('busy'))
  } })
  runtime.update(frame({ timestampMs: 0 }))
  await flushPromises()
  const resetting = runtime.reset()
  finishLoad(profiles)
  assert.equal(await resetting, false)
  runtime.update(frame({ timestampMs: 16 }))
  await flushPromises()
  assert.equal(runtime.getState().shiftRpm, 7500)
})
