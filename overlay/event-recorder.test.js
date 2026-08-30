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
  const previousRunId = instance.snapshot().run.runId
  instance.update(telemetry({ lap: { number: 1, current: 15, last: 55.418, raceTime: 55.4, distance: 1000 } }))
  instance.update(telemetry({ lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(saved.length, 1)
  assert.equal(saved[0].run.runType, 'circuit')
  assert.equal(saved[0].run.result, 'completed')
  assert.equal(saved[0].run.laps.length, 1)
  assert.equal(instance.snapshot().armed, true)
  assert.ok(instance.snapshot().run)
  assert.notEqual(instance.snapshot().run.runId, previousRunId)
})

test('mid-race clock and distance rewind stays in one run', async () => {
  const saved = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  instance.arm(11)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 32, last: 0, raceTime: 32, distance: 2500 } }))
  instance.update(telemetry({ lap: { number: 1, current: 0, last: 55.418, raceTime: 55.418, distance: 0 } }))
  const runId = instance.snapshot().run.runId
  instance.update(telemetry({ lap: { number: 1, current: 20, last: 55.418, raceTime: 75.418, distance: 1000 } }))
  instance.update(telemetry({ lap: { number: 1, current: 0.5, last: 55.418, raceTime: 0.5, distance: 10 } }))
  assert.equal(instance.snapshot().run.runId, runId)
  instance.update(telemetry({ lap: { number: 1, current: 20, last: 55.418, raceTime: 20.5, distance: 1000 } }))
  instance.update(telemetry({ lap: { number: 2, current: 0, last: 56.125, raceTime: 76.625, distance: 0 } }))

  const outcome = await instance.stop()
  assert.equal(outcome.outcome, 'saved')
  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0].run.laps, [
    { lapNumber: 1, lapTimeMs: 55418 },
    { lapNumber: 2, lapTimeMs: 56125 }
  ])
})

test('free-roam tail does not replace the accumulated circuit run', async () => {
  const saved = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  instance.arm(12)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 32, last: 0, raceTime: 32, distance: 2500 } }))
  instance.update(telemetry({ lap: { number: 1, current: 0, last: 55.418, raceTime: 55.418, distance: 0 } }))
  instance.update(telemetry({ lap: { number: 1, current: 20, last: 55.418, raceTime: 75.418, distance: 1000 } }))
  instance.update(telemetry({ lap: { number: 2, current: 0, last: 56.125, raceTime: 131.543, distance: 0 } }))
  const runId = instance.snapshot().run.runId
  instance.update(telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  instance.update(telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))

  assert.equal(instance.snapshot().run.runId, runId)
  const outcome = await instance.stop()
  assert.equal(outcome.outcome, 'saved')
  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0].run.laps, [
    { lapNumber: 1, lapTimeMs: 55418 },
    { lapNumber: 2, lapTimeMs: 56125 }
  ])
})

test('a confirmed sprint is saved immediately and the recorder remains armed', async () => {
  const saved = []
  const results = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    invoke: async (_command, payload) => { saved.push(payload); return payload },
    onResult: payload => results.push(payload)
  })
  instance.arm(8)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 108.7, last: 0, raceTime: 108.7, distance: 5951 } }))
  instance.update(telemetry({ isRaceOn: false, lap: { number: 0, current: 108.71, last: 0, raceTime: 108.71, distance: 5951 } }))
  assert.equal(saved.length, 0)
  instance.update(telemetry({ isRaceOn: false, lap: { number: 0, current: 108.71, last: 0, raceTime: 108.71, distance: 5951 } }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(saved.length, 1)
  assert.equal(saved[0].run.resultTimeMs, 108710)
  assert.equal(results.length, 1)
  assert.equal(results[0].eventId, 8)
  assert.equal(results[0].outcome, 'saved')
  assert.equal(results[0].run.resultTimeMs, 108710)
  assert.match(results[0].reason, /saved/i)
  assert.equal(instance.snapshot().armed, true)
  assert.equal(instance.snapshot().run, null)
  assert.equal((await instance.stop()).outcome, 'saved')
})

test('a sprint LastLap equal to the live clock is persisted before stop', async () => {
  const saved = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  instance.arm(13)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 108.713, last: 0, raceTime: 108.713, distance: 5951 } }))
  instance.update(telemetry({
    isRaceOn: false,
    lap: { number: 0, current: 0, last: 108.713, raceTime: 108.713, distance: 5951 }
  }))

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(saved.length, 1)
  assert.equal(saved[0].run.resultTimeMs, 108713)
  assert.equal(saved[0].run.runType, 'sprint')
  assert.equal((await instance.stop()).outcome, 'saved')
})

test('Stop saves the last live sprint race time after a zeroed result packet', async () => {
  const saved = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  instance.arm(14)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 113.916, last: 0, raceTime: 113.916, distance: 6200 } }))
  instance.update(telemetry({
    isRaceOn: false,
    speedKmh: 0,
    gear: 0,
    lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 }
  }))

  const outcome = await instance.stop()
  assert.equal(outcome.outcome, 'saved')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].run.runType, 'sprint')
  assert.equal(saved[0].run.result, 'confirmed')
  assert.equal(saved[0].run.resultTimeMs, 113916)
})

test('Stop does not use the sprint fallback for an ordinary paused run', async () => {
  const instance = recorder.createEventRecorder({ timingApi: timing, now: () => 1700000000000 })
  instance.arm(15)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 42, last: 0, raceTime: 42, distance: 2500 } }))
  instance.update(telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 0, raceTime: 42, distance: 2500 } }))

  assert.equal((await instance.stop()).outcome, 'discarded')
})

test('circuit stop saves every completed lap in one run', async () => {
  const saved = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  instance.arm(9)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 32, last: 0, raceTime: 32, distance: 2500 } }))
  instance.update(telemetry({ lap: { number: 1, current: 0, last: 55.418, raceTime: 55.418, distance: 0 } }))
  instance.update(telemetry({ lap: { number: 1, current: 20, last: 55.418, raceTime: 75.418, distance: 1000 } }))
  instance.update(telemetry({ lap: { number: 2, current: 0, last: 56.125, raceTime: 131.543, distance: 0 } }))
  const outcome = await instance.stop()
  assert.equal(outcome.outcome, 'saved')
  assert.deepEqual(saved[0].run.laps, [
    { lapNumber: 1, lapTimeMs: 55418 },
    { lapNumber: 2, lapTimeMs: 56125 }
  ])
})

test('stop reports discarded and failed results explicitly', async () => {
  const results = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    onResult: payload => results.push(payload),
    invoke: async () => { throw new Error('database offline') }
  })
  assert.equal((await instance.stop()).outcome, 'discarded')
  instance.arm(10)
  instance.update(telemetry())
  assert.equal((await instance.stop()).outcome, 'discarded')
  assert.equal(results[0].outcome, 'discarded')
  assert.equal(results[1].outcome, 'discarded')
  assert.match(results[1].reason, /no completed laps/i)
  instance.arm(10)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 1, current: 0, last: 55.418, raceTime: 55.418, distance: 0 } }))
  const failed = await instance.stop()
  assert.equal(failed.outcome, 'failed')
  assert.equal(results[2].outcome, 'failed')
  assert.match(results[2].reason, /database offline/i)
})
