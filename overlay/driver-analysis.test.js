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
  assert.equal(recorder.snapshot().phase, 'recording')
  await recorder.setEnabled(true)
  assert.equal(recorder.snapshot().phase, 'recording')
  currentTime += 5000
  const result = await recorder.stop()

  assert.equal(result.entry.label, 'FRONT SCRUB')
  assert.deepEqual(calls.map(call => call.command), ['create_driver_analysis_session', 'append_driver_analysis_samples', 'finalize_driver_analysis_session'])
  assert.equal(calls[1].payload.samples.length, 1)
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
