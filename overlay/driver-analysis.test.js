const test = require('node:test')
const assert = require('node:assert/strict')

const analysis = require('./driver-analysis.js')

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  }
}

test('Driver Analysis defaults off with a Windows-safe global hotkey', () => {
  const settings = analysis.readSettings(memoryStorage())

  assert.deepEqual(settings, { enabled: false, hotkey: 'Ctrl+Shift+F9' })
  assert.equal(analysis.normalizeHotkey('Win+R'), null)
  assert.equal(analysis.normalizeHotkey('Alt+F4'), null)
  assert.equal(analysis.normalizeHotkey('Ctrl+Shift+F9'), 'Ctrl+Shift+F9')
})

test('keyboard capture requires a non-Windows modifier combination', () => {
  assert.equal(analysis.hotkeyFromKeyboardEvent({ key: 'r', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false }), 'Ctrl+Alt+R')
  assert.equal(analysis.hotkeyFromKeyboardEvent({ key: 'F9', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false }), 'Ctrl+Shift+F9')
  assert.equal(analysis.hotkeyFromKeyboardEvent({ key: 'r', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }), null)
  assert.equal(analysis.hotkeyFromKeyboardEvent({ key: 'r', ctrlKey: false, altKey: false, shiftKey: false, metaKey: true }), null)
})

test('history is durable, bounded and ordered newest first', () => {
  const storage = memoryStorage()
  analysis.appendHistory({ id: 'old', recordedAt: '2026-09-18T10:00:00.000Z', durationMs: 1000, result: 'insufficient' }, storage)
  analysis.appendHistory({
    id: 'new',
    recordedAt: '2026-09-18T11:00:00.000Z',
    durationMs: 2000,
    sampleCount: 20,
    evidenceCount: 3,
    result: 'issue',
    mainKind: 'front_scrub',
    label: 'FRONT SCRUB',
    instruction: 'Reduce steering'
  }, storage)

  assert.deepEqual(analysis.readHistory(storage).map(entry => entry.id), ['new', 'old'])
})

test('recorder waits for telemetry, batches samples and persists one final result', async () => {
  let currentTime = Date.parse('2026-09-18T12:00:00.000Z')
  const calls = []
  const engine = {
    reset() {}, resetTransient() {}, update() {},
    snapshot() { return { algorithmVersion: 'test-v1', opportunityCount: 1, maneuverCount: 1 } },
    finalize() {
      return {
        status: 'issue',
        mainProblem: { kind: 'front_scrub', label: 'FRONT SCRUB', instruction: 'Reduce steering', detectorConfidence: 0.9, attributionConfidence: 0.8, severity: 0.6 },
        opportunities: [{ id: 'op-1', type: 'front_scrub', maneuverId: 1, startedAtMs: 100, endedAtMs: 200, speedBin: 3, context: { gear: 3 }, valid: true, outcome: 'clean' }],
        evidence: [{ opportunityId: 'op-1', type: 'front_scrub', outcome: 'problem', primary: true, detectorConfidence: 0.9, attributionConfidence: 0.8, severity: 0.6, metrics: {} }]
      }
    }
  }
  const invoke = async (command, payload) => {
    calls.push({ command, payload })
    if (command === 'create_driver_analysis_session') return 17
    if (command === 'finalize_driver_analysis_session') return { id: 17, result: payload.result.result, label: payload.result.label }
    return payload.samples.length
  }
  const recorder = analysis.createRecorder({
    engine,
    invoke,
    enabled: true,
    now: () => currentTime
  })

  assert.equal(recorder.start().phase, 'waiting')
  recorder.update({
    isRaceOn: true, timestampMs: 100, speedKmh: 100, throttle: 0.5, brake: 0, steer: 0.2, gear: 3, rpm: 5000, rpmMax: 8000,
    acceleration: { x: 1, y: 0, z: 2 }, angularVelocity: { y: 0.2 },
    slipRatio: { fl: 0, fr: 0, rl: 0.1, rr: 0.1 }, slipAngle: { fl: 0.1, fr: 0.1, rl: 0.05, rr: 0.05 },
    combinedSlip: { fl: 0.2, fr: 0.2, rl: 0.1, rr: 0.1 }, tireTempC: { fl: 80, fr: 80, rl: 75, rr: 75 },
    suspension: { fl: 0.1, fr: 0.1, rl: 0.1, rr: 0.1 }, rumble: { fl: false, fr: false, rl: false, rr: false },
    puddle: { fl: 0, fr: 0, rl: 0, rr: 0 }, lap: { current: 5, number: 1, distance: 100 },
    car: { ordinal: 42, pi: 800, drivetrain: 1 }
  })
  recorder.update({
    isRaceOn: true, timestampMs: 100, speedKmh: 100, rpmMax: 8000,
    car: { ordinal: 42, pi: 800, drivetrain: 1 }
  })
  assert.equal(recorder.snapshot().phase, 'recording')
  await recorder.setEnabled(true)
  assert.equal(recorder.snapshot().phase, 'recording')
  currentTime += 5000
  const result = await recorder.stop()

  assert.equal(result.entry.label, 'FRONT SCRUB')
  assert.deepEqual(calls.map(call => call.command), ['create_driver_analysis_session', 'append_driver_analysis_samples', 'finalize_driver_analysis_session'])
  assert.equal(calls[1].payload.samples.length, 2)
  assert.deepEqual(calls[1].payload.samples.map(sample => sample.timestampMs), [100, 100])
  assert.deepEqual(calls[1].payload.samples.map(sample => sample.sequence), [0, 1])
  assert.equal(calls[2].payload.opportunities.length, 1)
  assert.equal(calls[2].payload.evidence.length, 1)
  assert.equal(recorder.snapshot().phase, 'ready')
})

test('recorder refuses to start while Driver Analysis is disabled', () => {
  const recorder = analysis.createRecorder({
    engine: { reset() {}, resetTransient() {}, update() {}, snapshot() { return {} } },
    invoke: async () => 1,
    enabled: false,
  })

  assert.equal(recorder.start().recording, false)
  assert.equal(recorder.start().phase, 'off')
})

test('stored sessions are replayed once and replaced under the current algorithm version', async () => {
  const calls = []
  const replayed = []
  const storedSample = {
    sequence: 0, timestampMs: 100, speedKmh: 90, throttle: 0.4, brake: 0.1, steer: 0.2,
    gear: 3, rpm: 5000, rpmMax: 8000,
    accelerationX: 1, accelerationY: 2, accelerationZ: 3, yawRate: 0.3,
    slipRatio: [0.01, 0.02, 0.03, 0.04], slipAngle: [0.1, 0.2, 0.3, 0.4],
    combinedSlip: [0.2, 0.3, 0.4, 0.5], tireTempC: [80, 81, 82, 83],
    suspension: [0.5, 0.6, 0.7, 0.8], rumble: [false, true, false, false], puddle: [0, 0, 0, 0],
    lapTime: 12.5, lapNumber: 2, lapDistance: 450
  }
  const invoke = async (command, payload = {}) => {
    calls.push({ command, payload })
    if (command === 'load_driver_analysis_sessions') {
      return [{
        id: 7, status: 'completed', sampleCount: 1, algorithmVersion: 'driver-analysis-rules-v2',
        vehicleIdentity: { ordinal: 42, pi: 800, drivetrain: 1, rpmMax: 8000 }
      }]
    }
    if (command === 'load_driver_analysis_samples') return [storedSample]
    if (command === 'reanalyze_driver_analysis_session') return { id: 7, result: payload.result.result, algorithmVersion: payload.algorithmVersion }
    throw new Error(`Unexpected command ${command}`)
  }
  const createEngine = () => ({
    snapshot: () => ({ algorithmVersion: 'driver-analysis-rules-v3' }),
    update: telemetry => replayed.push(telemetry),
    finalize: () => ({ status: 'no_recurring_problem', mainProblem: null, opportunities: [], evidence: [] })
  })

  const updated = await analysis.reanalyzeStoredSessions({ invoke, createEngine })

  assert.equal(updated.length, 1)
  assert.deepEqual(calls.map(call => call.command), [
    'load_driver_analysis_sessions',
    'load_driver_analysis_samples',
    'reanalyze_driver_analysis_session'
  ])
  assert.equal(calls[2].payload.algorithmVersion, 'driver-analysis-rules-v3')
  assert.equal(calls[2].payload.result.result, 'no_recurring_problem')
  assert.equal(replayed[0].acceleration.x, 1)
  assert.equal(replayed[0].rumble.fr, true)
  assert.deepEqual(replayed[0].car, { ordinal: 42, pi: 800, drivetrain: 1 })
})

test('sessions already analyzed by the current version are not replayed', async () => {
  const calls = []
  const updated = await analysis.reanalyzeStoredSessions({
    invoke: async command => {
      calls.push(command)
      return [{ id: 7, status: 'completed', sampleCount: 100, algorithmVersion: 'driver-analysis-rules-v3' }]
    },
    createEngine: () => ({ snapshot: () => ({ algorithmVersion: 'driver-analysis-rules-v3' }) })
  })
  assert.deepEqual(updated, [])
  assert.deepEqual(calls, ['load_driver_analysis_sessions'])
})
