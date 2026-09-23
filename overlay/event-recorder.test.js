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

test('completed laps persist three interpolated equal-distance sector times', async () => {
  const saved = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  instance.arm(70)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 10, last: 0, raceTime: 10, distance: 300 } }))
  instance.update(telemetry({ lap: { number: 0, current: 20, last: 0, raceTime: 20, distance: 600 } }))
  instance.update(telemetry({ lap: { number: 0, current: 30, last: 0, raceTime: 30, distance: 900 } }))
  instance.update(telemetry({ lap: { number: 1, current: 0, last: 36, raceTime: 36, distance: 0 } }))

  const outcome = await instance.stop()
  assert.equal(outcome.outcome, 'saved')
  assert.deepEqual(saved[0].run.laps, [{
    lapNumber: 1,
    lapTimeMs: 36000,
    sector1TimeMs: 10000,
    sector2TimeMs: 10000,
    sector3TimeMs: 16000
  }])
})

test('sector splits use the current lap distance span when DistanceTraveled accumulates', () => {
  assert.deepEqual(recorder.sectorTimesFromSamples([
    { distance: 1000, elapsedMs: 0 },
    { distance: 1300, elapsedMs: 10000 },
    { distance: 1600, elapsedMs: 20000 },
    { distance: 1900, elapsedMs: 30000 }
  ], 36000), {
    sector1TimeMs: 10000,
    sector2TimeMs: 10000,
    sector3TimeMs: 16000
  })
})

test('completed laps persist compact Position and pedal trace points', async () => {
  const saved = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  const frame = (current, distance, position, controls = {}) => telemetry({
    lap: { number: 0, current, last: 0, raceTime: current, distance },
    position,
    ...controls
  })
  instance.arm(72)
  instance.update(frame(0, 0, { x: 1, y: 2, z: 3 }))
  instance.update(frame(0.05, 50, { x: 2, y: 2, z: 3 }))
  instance.update(frame(0.15, 100, { x: 3, y: 2, z: 4 }, { throttle: 0.7, brake: 0.0 }))
  instance.update(frame(0.3, 300, { x: 4, y: 2, z: 5 }, { throttle: 0.7, brake: 0.0 }))
  instance.update(telemetry({
    position: { x: 5, y: 2, z: 6 },
    lap: { number: 1, current: 0, last: 0.3, raceTime: 0.3, distance: 0 }
  }))

  await instance.stop()
  const trace = saved[0].run.laps[0].tracePoints
  assert.equal(trace.length, 2)
  assert.deepEqual(trace.map(point => point.sampleIndex), [0, 1])
  assert.deepEqual(trace.map(point => point.positionX), [3, 4])
  assert.equal(trace[0].throttle, 0.7)
  assert.equal(trace[0].brake, 0)
})

test('a completed circuit lap emits a usable reference candidate immediately', () => {
  const candidates = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    onReferenceCandidate: candidate => {
      candidates.push(candidate)
      assert.equal(instance.snapshot().run.laps.length, 1)
    }
  })
  const frame = (current, distance, number = 0) => telemetry({
    position: { x: distance, y: 2, z: distance + 1 },
    throttle: 0.7,
    brake: 0,
    lap: { number, current, last: number === 1 ? 30 : 0, raceTime: current, distance }
  })

  instance.arm(73, 'Rivals Test')
  instance.update(frame(0, 0))
  instance.update(frame(0.15, 100))
  instance.update(frame(0.3, 300))
  instance.update(frame(0, 0, 1))

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].eventId, 73)
  assert.equal(candidates[0].runType, 'circuit')
  assert.equal(candidates[0].lapNumber, 1)
  assert.equal(candidates[0].timeMs, 30000)
  assert.equal(typeof candidates[0].captureRunId, 'string')
  assert.ok(candidates[0].tracePoints.length >= 2)
  assert.deepEqual(candidates[0].tracePoints.map(point => point.positionX), [0, 100, 300])
})

test('a confirmed sprint persists one synthetic lap with interpolated sectors', async () => {
  const saved = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  instance.arm(71)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 10, last: 0, raceTime: 10, distance: 300 } }))
  instance.update(telemetry({ lap: { number: 0, current: 20, last: 0, raceTime: 20, distance: 600 } }))
  instance.update(telemetry({ lap: { number: 0, current: 30, last: 0, raceTime: 30, distance: 900 } }))
  instance.update(telemetry({
    isRaceOn: false,
    lap: { number: 0, current: 0, last: 30, raceTime: 0, distance: 0 }
  }))

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0].run.laps, [{
    lapNumber: 1,
    lapTimeMs: 30000,
    sector1TimeMs: 10000,
    sector2TimeMs: 10000,
    sector3TimeMs: 10000
  }])
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
  assert.deepEqual(snapshot.run.laps[0], {
    lapNumber: 1,
    timeMs: 55418,
    sector1TimeMs: 10667,
    sector2TimeMs: 10667,
    sector3TimeMs: 34085
  })
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
    { lapNumber: 1, lapTimeMs: 55418, sector1TimeMs: 10667, sector2TimeMs: 10667, sector3TimeMs: 34085 },
    { lapNumber: 2, lapTimeMs: 56125, sector1TimeMs: 6667, sector2TimeMs: 6667, sector3TimeMs: 42792 }
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
    { lapNumber: 1, lapTimeMs: 55418, sector1TimeMs: 10667, sector2TimeMs: 10667, sector3TimeMs: 34085 },
    { lapNumber: 2, lapTimeMs: 56125, sector1TimeMs: 6667, sector2TimeMs: 6667, sector3TimeMs: 42792 }
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

test('a zeroed sprint packet automatically falls back and restarts on the next clean start', async () => {
  const saved = []
  const candidates = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    onReferenceCandidate: candidate => {
      candidates.push(candidate)
      assert.equal(saved.length, 0)
    },
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  instance.arm(74)
  instance.update(telemetry({ throttle: 0.7, brake: 0, position: { x: 1, y: 2, z: 3 } }))
  instance.update(telemetry({
    throttle: 0.7,
    brake: 0,
    position: { x: 2, y: 2, z: 4 },
    lap: { number: 0, current: 108.713, last: 0, raceTime: 108.713, distance: 5951 }
  }))
  instance.update(telemetry({
    isRaceOn: false,
    lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 }
  }))

  const previousRunId = instance.snapshot().run.runId
  instance.update(telemetry({
    throttle: 0.7,
    brake: 0,
    position: { x: 3, y: 2, z: 5 },
    lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 }
  }))

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(saved.length, 1)
  assert.equal(saved[0].run.eventId, 74)
  assert.equal(saved[0].run.runType, 'sprint')
  assert.equal(saved[0].run.result, 'confirmed')
  assert.equal(saved[0].run.resultTimeMs, 108713)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].runType, 'sprint')
  assert.equal(candidates[0].timeMs, 108713)
  assert.ok(candidates[0].tracePoints.length >= 2)
  assert.equal(instance.snapshot().armed, true)
  assert.ok(instance.snapshot().run)
  assert.notEqual(instance.snapshot().run.runId, previousRunId)
})

test('an abandoned attempt restarted from the menu is not saved as a short sprint', async () => {
  const saved = []
  const candidates = []
  const results = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    referenceDistanceM: () => 5948,
    onReferenceCandidate: candidate => candidates.push(candidate),
    onResult: payload => results.push(payload),
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  instance.arm(75)
  instance.update(telemetry({ throttle: 0.7, brake: 0, position: { x: 1, y: 2, z: 3 } }))
  instance.update(telemetry({
    throttle: 0.7,
    brake: 0,
    position: { x: 2, y: 2, z: 4 },
    lap: { number: 0, current: 29.35, last: 0, raceTime: 29.35, distance: 1236 }
  }))
  instance.update(telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  const abandonedRunId = instance.snapshot().run.runId
  instance.update(telemetry({ throttle: 0.7, brake: 0, position: { x: 3, y: 2, z: 5 } }))

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(saved.length, 0)
  assert.equal(candidates.length, 0)
  assert.equal(results.at(-1).outcome, 'discarded')
  assert.equal(instance.snapshot().armed, true)
  assert.notEqual(instance.snapshot().run.runId, abandonedRunId)
})

test('a sprint that covers the reference distance is saved through the fallback', async () => {
  const saved = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    referenceDistanceM: () => 5948,
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  instance.arm(76)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 139.7, last: 0, raceTime: 139.7, distance: 5946 } }))
  instance.update(telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  instance.update(telemetry())

  await new Promise(resolve => setImmediate(resolve))
  assert.equal(saved.length, 1)
  assert.equal(saved[0].run.runType, 'sprint')
  assert.equal(saved[0].run.resultTimeMs, 139700)
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

test('Stop waits for an exact post-finish LastLap before saving a sprint', async () => {
  const saved = []
  const statuses = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    onStatus: status => statuses.push(status),
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  instance.arm(14)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 113.594, last: 0, raceTime: 113.594, distance: 6200 } }))
  instance.update(telemetry({
    isRaceOn: false,
    speedKmh: 0,
    gear: 0,
    lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 }
  }))

  const stopping = instance.stop()
  assert.equal(statuses.at(-1).state, 'finalizing')
  instance.update(telemetry({
    isRaceOn: false,
    speedKmh: 0,
    gear: 0,
    lap: { number: 0, current: 0, last: 113.601, raceTime: 0, distance: 0 }
  }))

  const outcome = await stopping
  assert.equal(outcome.outcome, 'saved')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].run.runType, 'sprint')
  assert.equal(saved[0].run.result, 'confirmed')
  assert.equal(saved[0].run.resultTimeMs, 113601)
  assert.equal(statuses.at(-1).eventId, '14')
  assert.equal(statuses.at(-1).state, 'stopped')
})

test('Stop falls back after the bounded post-finish packet window', async () => {
  const saved = []
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  instance.arm(16)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 113.594, last: 0, raceTime: 113.594, distance: 6200 } }))
  instance.update(telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))

  const stopping = instance.stop()
  for (let index = 0; index < recorder.POST_FINISH_PACKET_WINDOW; index += 1) {
    instance.update(telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))
  }

  const outcome = await stopping
  assert.equal(outcome.outcome, 'saved')
  assert.equal(saved[0].run.resultTimeMs, 113594)
})

test('Stop falls back after one second when post-finish telemetry stops', async () => {
  const saved = []
  let timeoutCallback = null
  const instance = recorder.createEventRecorder({
    timingApi: timing,
    now: () => 1700000000000,
    setTimeout: callback => { timeoutCallback = callback; return 1 },
    clearTimeout: () => {},
    invoke: async (_command, payload) => { saved.push(payload); return payload }
  })
  instance.arm(17)
  instance.update(telemetry())
  instance.update(telemetry({ lap: { number: 0, current: 113.594, last: 0, raceTime: 113.594, distance: 6200 } }))
  instance.update(telemetry({ isRaceOn: false, lap: { number: 0, current: 0, last: 0, raceTime: 0, distance: 0 } }))

  const stopping = instance.stop()
  assert.equal(saved.length, 0)
  timeoutCallback()

  const outcome = await stopping
  assert.equal(outcome.outcome, 'saved')
  assert.equal(saved[0].run.resultTimeMs, 113594)
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
    { lapNumber: 1, lapTimeMs: 55418, sector1TimeMs: 10667, sector2TimeMs: 10667, sector3TimeMs: 34085 },
    { lapNumber: 2, lapTimeMs: 56125, sector1TimeMs: 6667, sector2TimeMs: 6667, sector3TimeMs: 42792 }
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
