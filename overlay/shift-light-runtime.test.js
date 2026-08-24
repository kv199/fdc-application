const test = require('node:test')
const assert = require('node:assert/strict')

const shiftLightEngine = require('./shift-light-engine.js')

function frame(overrides = {}) {
  return {
    timestampMs: 1000,
    isRaceOn: true,
    car: { ordinal: 123, pi: 800, drivetrain: 1 },
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

function pauseFrame() {
  return frame({
    isRaceOn: false,
    car: { ordinal: 0, pi: 0, drivetrain: 1 },
    gear: 0,
    rpm: 0,
    rpmMax: 0,
    throttle: 0,
    power: 0,
    wheelRotation: { fl: 0, fr: 0, rl: 0, rr: 0 }
  })
}

function upshiftPull(runtime, gear) {
  runtime.update(frame({ gear, rpm: 5500 }))
  runtime.update(frame({ gear, rpm: 8000 }))
  runtime.update(frame({ gear: 11, rpm: 7800 }))
  runtime.update(frame({ gear: gear + 1, rpm: 6000 }))
}

function ratioFrame(gear, ratio, rpm, timestampMs) {
  const wheelSpeed = rpm / ratio
  return frame({
    timestampMs,
    gear,
    rpm,
    wheelRotation: { fl: wheelSpeed, fr: wheelSpeed, rl: wheelSpeed, rr: wheelSpeed }
  })
}

function deferred() {
  let resolve
  const promise = new Promise(done => {
    resolve = done
  })
  return { promise, resolve }
}

function createRuntime(options = {}) {
  const calls = []
  const events = []
  let profiles = options.profiles || []
  const runtimePath = require.resolve('./shift-light-runtime.js')
  delete require.cache[runtimePath]

  globalThis.HudShiftLight = shiftLightEngine
  globalThis.HudTauriEvents = {
    getEventApi: () => ({
      emit: async (name, payload) => {
        events.push({ name, payload })
      }
    })
  }
  globalThis.__TAURI_INTERNALS__ = {
    invoke: async (command, args) => {
      calls.push({ command, args })
      if (command === 'load_shift_light_profiles') {
        if (options.loadPromise) return options.loadPromise
        return profiles
      }
      if (command === 'reset_shift_light_profiles') {
        if (options.resetPromise) await options.resetPromise
        profiles = []
        return undefined
      }
      if (command === 'save_shift_light_profile' && !args?.profile) {
        throw new Error('missing named profile argument')
      }
      if (command === 'save_shift_light_profile' && options.savePromise) {
        await options.savePromise
      }
      return undefined
    }
  }

  return {
    calls,
    events,
    runtime: require('./shift-light-runtime.js')
  }
}

async function flushPromises() {
  await Promise.resolve()
  await new Promise(resolve => setImmediate(resolve))
}

test('preserves the last car and gear calibration through pause and resets it there', async () => {
  const key = 'fh6:123:800:8000'
  const { calls, events, runtime } = createRuntime({
    profiles: [{ key, gear: 3, shiftRpm: 7800, sampleCount: 5, method: 'observed' }]
  })

  runtime.update(frame())
  await flushPromises()
  const paused = runtime.update(pauseFrame())

  assert.equal(paused.carKey, key)
  assert.equal(paused.currentGear, 3)
  assert.equal(paused.phase, 'normal')
  assert.deepEqual(paused.gears.map(gear => gear.gear), [3])
  assert.equal(await runtime.reset(), true)

  const resetCall = calls.find(call => call.command === 'reset_shift_light_profiles')
  assert.deepEqual(resetCall?.args, { key })
  assert.equal(runtime.getState().carKey, key)
  assert.equal(runtime.getState().phase, 'normal')
  assert.deepEqual(runtime.getState().gears, [])
  assert.deepEqual(events.at(-1), {
    name: 'hud_shift_light_reset_result',
    payload: { ok: true, carKey: key }
  })

  const resumed = runtime.update(frame())
  assert.equal(resumed.status, 'learning')
  assert.equal(resumed.carKey, key)
})

test('keeps a cold paused runtime empty and reports that reset is unavailable', async () => {
  const { events, runtime } = createRuntime()

  assert.equal(runtime.update(pauseFrame()).carKey, null)
  assert.equal(await runtime.reset(), false)
  assert.deepEqual(events.at(-1), {
    name: 'hud_shift_light_reset_result',
    payload: {
      ok: false,
      carKey: null,
      message: 'No car calibration profile is available'
    }
  })
})

test('sync republishes the retained Shift Light state for late Configuration listeners', async () => {
  const key = 'fh6:123:800:8000'
  const { events, runtime } = createRuntime({
    profiles: [{ key, gear: 3, shiftRpm: 7800, sampleCount: 5, method: 'observed' }]
  })
  runtime.update(frame())
  await flushPromises()
  runtime.update(pauseFrame())
  events.length = 0

  const synced = runtime.sync()

  assert.equal(synced.carKey, key)
  assert.equal(events.length, 1)
  assert.equal(events[0].name, 'hud_shift_light')
  assert.equal(events[0].payload.carKey, key)
})

test('a late profile load cannot restore calibration after reset', async () => {
  const key = 'fh6:123:800:8000'
  const load = deferred()
  const { runtime } = createRuntime({ loadPromise: load.promise })
  runtime.update(frame())

  assert.equal(await runtime.reset(), true)
  load.resolve([{ key, gear: 3, shiftRpm: 7800, sampleCount: 5, method: 'observed' }])
  await flushPromises()

  assert.equal(runtime.getState().carKey, key)
  assert.deepEqual(runtime.getState().gears, [])
})

test('reset does not clear a new car that appears while SQLite is pending', async () => {
  const reset = deferred()
  const { events, runtime } = createRuntime({ resetPromise: reset.promise })
  runtime.update(frame())
  await flushPromises()
  const resetResult = runtime.reset()

  runtime.update(frame({ car: { ordinal: 456, pi: 900, drivetrain: 1 } }))
  await flushPromises()
  reset.resolve()

  assert.equal(await resetResult, false)
  assert.equal(runtime.getState().carKey, 'fh6:456:900:8000')
  assert.deepEqual(events.at(-1), {
    name: 'hud_shift_light_reset_result',
    payload: {
      ok: false,
      carKey: 'fh6:456:900:8000',
      message: 'The car profile changed during reset'
    }
  })
})

test('reset waits for an in-flight save before deleting the SQLite profile', async () => {
  const save = deferred()
  const { calls, runtime } = createRuntime({ savePromise: save.promise })
  runtime.update(frame())
  await flushPromises()
  for (let sample = 0; sample < 5; sample += 1) upshiftPull(runtime, 3)
  await flushPromises()

  const resetResult = runtime.reset()
  await flushPromises()
  assert.equal(calls.filter(call => call.command === 'save_shift_light_profile').length, 1)
  assert.equal(calls.some(call => call.command === 'reset_shift_light_profiles'), false)

  save.resolve()
  assert.equal(await resetResult, true)
  assert.deepEqual(
    calls.filter(call => ['save_shift_light_profile', 'reset_shift_light_profiles'].includes(call.command)).map(call => call.command),
    ['save_shift_light_profile', 'reset_shift_light_profiles']
  )
})

test('reset blocks new calibration saves while SQLite deletion is pending', async () => {
  const reset = deferred()
  const { calls, runtime } = createRuntime({ resetPromise: reset.promise })
  runtime.update(frame())
  await flushPromises()
  const resetResult = runtime.reset()

  for (let sample = 0; sample < 5; sample += 1) upshiftPull(runtime, 3)
  await flushPromises()
  assert.equal(calls.some(call => call.command === 'save_shift_light_profile'), false)

  reset.resolve()
  assert.equal(await resetResult, true)
  assert.equal(calls.some(call => call.command === 'save_shift_light_profile'), false)
})

test('reset includes the active signature while Rust also clears the unsigned variant', async () => {
  const key = 'fh6:123:800:8000'
  const { calls, runtime } = createRuntime()
  for (let sample = 0; sample < 20; sample += 1) {
    runtime.update(ratioFrame(2, 60, 4000 + sample, 1000 + sample * 32))
    runtime.update(ratioFrame(3, 48, 4000 + sample, 2000 + sample * 32))
    runtime.update(ratioFrame(4, 42, 4000 + sample, 3000 + sample * 32))
  }
  await flushPromises()

  const signature = '2:0.8000|3:0.8750'
  assert.equal(runtime.getState().gearboxSignature, signature)
  assert.equal(await runtime.reset(), true)

  const resetCall = calls.find(call => call.command === 'reset_shift_light_profiles')
  assert.deepEqual(resetCall?.args, { key, gearboxSignature: signature })
})

test('registers a variant on its first valid packet and saves old progress after a car switch', async () => {
  const { calls, runtime } = createRuntime()
  runtime.update(frame())
  await flushPromises()

  const registration = calls.find(call => call.command === 'register_shift_light_variant')
  assert.deepEqual(registration?.args, { key: 'fh6:123:800:8000' })

  upshiftPull(runtime, 3)
  runtime.update(frame({ car: { ordinal: 456, pi: 900, drivetrain: 1 } }))
  await flushPromises()

  const saved = calls.find(call => call.command === 'save_shift_light_profile')
  assert.equal(saved?.args.profile.key, 'fh6:123:800:8000')
  assert.equal(saved?.args.profile.status, 'learning')
  assert.equal(saved?.args.profile.sampleCount, 1)
})

test('does not let a late SQLite load overwrite samples collected in memory', async () => {
  const load = deferred()
  const { runtime } = createRuntime({ loadPromise: load.promise })
  runtime.update(frame())
  upshiftPull(runtime, 3)
  load.resolve([])
  await flushPromises()

  assert.equal(runtime.getState().gears.find(gear => gear.gear === 3)?.sampleCount, 1)
  assert.equal(runtime.getState().gears.find(gear => gear.gear === 3)?.status, 'learning')
})
