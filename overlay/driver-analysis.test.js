const test = require('node:test')
const assert = require('node:assert/strict')

const analysis = require('./driver-analysis.js')
const presentation = require('./asphalt-coach-presentation.js')

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value))
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

test('recorder stores only the most frequent negative issue using existing tie priority', () => {
  let currentTime = Date.parse('2026-09-18T12:00:00.000Z')
  const storage = memoryStorage()
  const counts = {
    front_scrub: 2,
    exit_wheelspin: 0,
    brake_steering_overload: 2,
    abrupt_brake_release: 0,
    clean_exit: 9,
    controlled_release: 0
  }
  const state = {
    reset() {},
    resetTransient() {},
    update() { return { valid: true, calibration: { ready: true }, sample: {}, resetReason: null } }
  }
  const findings = {
    reset() {},
    resetTransient() {},
    update() {},
    getSummary() { return { counts } }
  }
  const recorder = analysis.createRecorder({
    state,
    findings,
    buildBrief: presentation.buildDriverBrief,
    metaFor: presentation.metaFor,
    enabled: true,
    storage,
    now: () => currentTime
  })

  recorder.start()
  recorder.update({ speedKmh: 100 })
  currentTime += 5000
  const result = recorder.stop()

  assert.equal(result.entry.mainKind, 'brake_steering_overload')
  assert.equal(result.entry.label, 'BRAKE + STEERING OVERLOAD')
  assert.equal(result.entry.evidenceCount, 2)
  assert.equal(result.history.length, 1)
  assert.equal(Object.hasOwn(result.entry, 'telemetry'), false)
})

test('recorder refuses to start while Driver Analysis is disabled', () => {
  const recorder = analysis.createRecorder({
    state: { reset() {}, resetTransient() {}, update() {} },
    findings: { reset() {}, resetTransient() {}, update() {}, getSummary() { return { counts: {} } } },
    buildBrief: presentation.buildDriverBrief,
    metaFor: presentation.metaFor,
    enabled: false,
    storage: memoryStorage()
  })

  assert.equal(recorder.start().recording, false)
})
