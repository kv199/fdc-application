const test = require('node:test')
const assert = require('node:assert/strict')

const {
  classLabel,
  displayName,
  normalizeGaragePayload,
  vehicleFromTelemetry,
  createGarageRuntime
} = require('./garage-runtime.js')

function frame(overrides = {}) {
  return {
    speedKmh: 100,
    car: { ordinal: 123, class: 4, pi: 850 },
    ...overrides
  }
}

async function flushPromises() {
  await Promise.resolve()
  await new Promise(resolve => setImmediate(resolve))
}

test('normalizes native and telemetry vehicle identity without inventing values', () => {
  assert.equal(classLabel(4), 'S1')
  assert.equal(classLabel(99), '99')
  assert.equal(classLabel(null), null)
  assert.deepEqual(vehicleFromTelemetry(frame()), {
    carOrdinal: 123,
    name: null,
    class: 4,
    classLabel: 'S1',
    pi: 850,
    carGroup: null,
    drivetrain: null,
    cylinders: null,
    latestUsed: false,
    lastUsedAt: null
  })
  assert.equal(displayName(vehicleFromTelemetry(frame())), '123')
  assert.deepEqual(normalizeGaragePayload({ vehicles: [{ carOrdinal: 123, name: 'Track Tool', class: 4, pi: 850 }] })[0], {
    carOrdinal: 123,
    name: 'Track Tool',
    class: 4,
    classLabel: 'S1',
    pi: 850,
    carGroup: null,
    drivetrain: null,
    cylinders: null,
    latestUsed: false,
    lastUsedAt: null
  })
  const snapshot = normalizeGaragePayload({
    currentCarOrdinal: 456,
    cars: [{ ordinal: 456, name: null, variants: [{ class: 5, pi: 901, isCurrent: true }] }]
  })[0]
  assert.equal(snapshot.classLabel, 'S2')
  assert.equal(snapshot.pi, 901)
  assert.equal(snapshot.latestUsed, true)
})

test('records each car identity once while telemetry keeps the latest car visible', async () => {
  const calls = []
  const runtime = createGarageRuntime({
    invoke: async (command, args) => {
      calls.push({ command, args })
      return undefined
    }
  })

  assert.equal(runtime.update(frame()), true)
  assert.equal(runtime.update(frame()), true)
  assert.equal(runtime.update(frame({ car: { ordinal: 456, class: 5, pi: 901 } })), true)
  await flushPromises()

  assert.deepEqual(calls, [
    { command: 'record_garage_vehicle', args: { carOrdinal: 123, class: 4, pi: 850 } },
    { command: 'record_garage_vehicle', args: { carOrdinal: 456, class: 5, pi: 901 } }
  ])
  assert.equal(runtime.latestOrdinal(), 456)
  assert.equal(runtime.latest().carOrdinal, 456)
})

test('records a previously seen car again when it becomes the latest used car', async () => {
  const calls = []
  const runtime = createGarageRuntime({
    invoke: async (command, args) => {
      calls.push({ command, args })
      return undefined
    }
  })

  runtime.update(frame())
  runtime.update(frame({ car: { ordinal: 456, class: 5, pi: 901 } }))
  runtime.update(frame())
  await flushPromises()

  assert.equal(calls.length, 3)
  assert.deepEqual(calls[2], { command: 'record_garage_vehicle', args: { carOrdinal: 123, class: 4, pi: 850 } })
})

test('records through the native command and publishes the existing Garage event bridge', async () => {
  const calls = []
  const events = []
  globalThis.HudTauriEvents = {
    getEventApi: () => ({
      emit: async (name, payload) => events.push({ name, payload }),
      listen: async () => () => {}
    })
  }
  const runtime = createGarageRuntime({
    invoke: async (command, args) => {
      calls.push({ command, args })
      return undefined
    }
  })

  runtime.update(frame({ car: { ordinal: 123, class: 4, pi: 850 } }))
  await flushPromises()
  assert.deepEqual(calls, [
    { command: 'record_garage_vehicle', args: { carOrdinal: 123, class: 4, pi: 850 } }
  ])
  assert.equal(events[0].name, 'hud_garage')
  delete globalThis.HudTauriEvents
})
