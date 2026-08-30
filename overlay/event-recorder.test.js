const test = require('node:test')
const assert = require('node:assert/strict')
const timing = require('./lap-timing.js')
const recorder = require('./event-recorder.js')

function telemetry(overrides = {}) {
  return {
    isRaceOn: true,
    speedKmh: 0,
    car: { ordinal: 42, name: 'Test Car', classLabel: 'A', pi: 800, drivetrain: 2 },
    lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 },
    ...overrides
  }
}

test('Record arms without starting mid-race and starts only at a clean clock', () => {
  assert.equal(recorder.carSnapshot(telemetry()).class, 3)
  const instance = recorder.createEventRecorder({ timingApi: timing, now: () => 1700000000000 })
  instance.arm(7, 'Rivals Test')
  instance.update(telemetry({ lap: { number: 0, current: 20, last: 0, raceTime: 20, distance: 900 } }))
  assert.equal(instance.snapshot().run, null)
  instance.update(telemetry())
  assert.equal(instance.snapshot().run.eventId, '7')
})

test('pause preserves the active run and the first LastLap plus boundary is recorded', () => {
  const instance = recorder.createEventRecorder({ timingApi: timing, now: () => 1700000000000 })
  instance.arm(7)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 32, last: 0, raceTime: 32, distance: 2500 } }))
  instance.update(telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 0, raceTime: 32, distance: 2500 } }))
  instance.update(telemetry({ isRaceOn: true, lap: { number: 1, current: 0, last: 55.418, raceTime: 55.418, distance: 0 } }))
  const snapshot = instance.snapshot()
  assert.equal(snapshot.run.laps.length, 1)
  assert.deepEqual(snapshot.run.laps[0], { lapNumber: 1, timeMs: 55418 })
})

test('strong restart persists the completed prior run and remains armed for a clean next run', async () => {
  const saved = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  instance.arm(7)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 32, last: 0, raceTime: 32, distance: 2500 } }))
  instance.update(telemetry({ lap: { number: 1, current: 0, last: 55.418, raceTime: 55.418, distance: 0 } }))
  instance.update(telemetry({ lap: { number: 1, current: 15, last: 55.418, raceTime: 55.4, distance: 1000 } }))
  instance.update(telemetry({ lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(saved.length, 1)
  assert.equal(saved[0].run.runType, 'circuit')
  assert.equal(saved[0].run.result, 'completed')
  assert.equal(instance.snapshot().armed, true)
  assert.ok(instance.snapshot().run)
})

test('a sprint is saved only after the timing engine confirms the finish', async () => {
  const saved = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  instance.arm(8)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 108.7, last: 0, raceTime: 108.7, distance: 5951 } }))
  instance.update(telemetry({ isRaceOn: false, lap: { number: 0, current: 108.71, last: 0, raceTime: 108.71, distance: 5951 } }))
  assert.equal(saved.length, 0)
  instance.update(telemetry({ isRaceOn: false, lap: { number: 0, current: 108.71, last: 0, raceTime: 108.71, distance: 5951 } }))
  assert.equal(saved.length, 0)
  await instance.stop()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(saved.length, 1)
  assert.equal(saved[0].run.finalTimeMs, undefined)
  assert.equal(saved[0].run.resultTimeMs, 108710)
})
