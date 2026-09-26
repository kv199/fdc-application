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

test('controller bindings are normalized and validated', () => {
  assert.equal(analysis.normalizeHotkey('Controller:346E:0006:116'), 'Controller:346E:0006:116')
  assert.equal(analysis.normalizeHotkey('controller:346e:0006:116'), 'Controller:346E:0006:116')
  assert.equal(analysis.normalizeHotkey('Controller:346E:0006:0'), null)
  assert.equal(analysis.normalizeHotkey('Controller:346E:0006:1025'), null)
  assert.equal(analysis.normalizeHotkey('Controller:346E:0006:01'), null)
  assert.equal(analysis.normalizeHotkey('Controller:GGGG:0006:116'), null)
  assert.equal(analysis.normalizeHotkey('Controller:346E:0006'), null)
})

test('isControllerHotkey distinguishes controller from keyboard hotkeys', () => {
  assert.equal(analysis.isControllerHotkey('Controller:346E:0006:116'), true)
  assert.equal(analysis.isControllerHotkey('controller:346e:0006:116'), false)
  assert.equal(analysis.isControllerHotkey('Ctrl+Shift+F9'), false)
  assert.equal(analysis.isControllerHotkey('Ctrl+Alt+R'), false)
  assert.equal(analysis.isControllerHotkey(''), false)
})

test('formatHotkey displays keyboard and controller hotkeys correctly', () => {
  assert.equal(analysis.formatHotkey('Ctrl+Shift+F9'), 'Ctrl + Shift + F9')
  assert.equal(analysis.formatHotkey('Ctrl+Alt+R'), 'Ctrl + Alt + R')
  assert.equal(analysis.formatHotkey('Controller:346E:0006:116'), 'Controller 346E:0006 · Button 116')
  assert.equal(analysis.formatHotkey('Controller:346E:0006:116', 'MOZA SR Shifter'), 'MOZA SR Shifter · Button 116')
  assert.equal(analysis.formatHotkey('Controller:346E:0006:116', ''), 'Controller 346E:0006 · Button 116')
})

test('normalizeSettings preserves hotkeyLabel for controller bindings only', () => {
  const keyboardSettings = analysis.normalizeSettings({ hotkey: 'Ctrl+Shift+F9', hotkeyLabel: 'Some Label' })
  assert.equal(keyboardSettings.hotkeyLabel, undefined)
  const controllerSettings = analysis.normalizeSettings({ hotkey: 'Controller:346E:0006:116', hotkeyLabel: 'MOZA Shifter' })
  assert.equal(controllerSettings.hotkeyLabel, 'MOZA Shifter')
  const trimmedSettings = analysis.normalizeSettings({ hotkey: 'Controller:346E:0006:116', hotkeyLabel: '  Device Name  ' })
  assert.equal(trimmedSettings.hotkeyLabel, 'Device Name')
  const longSettings = analysis.normalizeSettings({ hotkey: 'Controller:346E:0006:116', hotkeyLabel: 'A'.repeat(100) })
  assert.equal(longSettings.hotkeyLabel.length, 80)
})

test('legacy settings without hotkeyLabel load unchanged', () => {
  const storage = memoryStorage({ 'fdc.driver-analysis.settings.v1': JSON.stringify({ enabled: true, hotkey: 'Ctrl+Shift+F9' }) })
  const settings = analysis.readSettings(storage)
  assert.deepEqual(settings, { enabled: true, hotkey: 'Ctrl+Shift+F9' })
  const controllerStorage = memoryStorage({ 'fdc.driver-analysis.settings.v1': JSON.stringify({ enabled: true, hotkey: 'Controller:346E:0006:116', hotkeyLabel: 'Device' }) })
  const controllerSettings = analysis.readSettings(controllerStorage)
  assert.deepEqual(controllerSettings, { enabled: true, hotkey: 'Controller:346E:0006:116', hotkeyLabel: 'Device' })
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

test('persistencePayload includes statsJson when stats are provided', () => {
  const finalized = {
    status: 'issue',
    mainProblem: { kind: 'front_scrub', label: 'FRONT SCRUB', instruction: 'Reduce steering', detectorConfidence: 0.9, attributionConfidence: 0.8, severity: 0.6 },
    opportunities: [{ id: 'op-1', type: 'front_scrub', maneuverId: 1, startedAtMs: 100, endedAtMs: 200, valid: true, outcome: 'clean' }],
    evidence: [{ opportunityId: 'op-1', type: 'front_scrub', outcome: 'problem', primary: true, detectorConfidence: 0.9, attributionConfidence: 0.8, severity: 0.6, metrics: {} }],
    stats: {
      version: 1,
      movingMs: 5000,
      distanceM: 200,
      avgSpeedKmh: 144,
      maxSpeedKmh: 200,
      pedals: { fullThrottle: 0.5, partialThrottle: 0.2, coast: 0.1, brake: 0.2, brakeWithSteering: 0.05 },
      braking: { count: 3, peakDecelG: { median: 1.1 }, durationS: { median: 2.5 }, releaseS: { median: 0.5 }, trailBrakingShare: 0.8 },
      corners: { count: 3, lateralG: { median: 1.0 }, frontOverLimitShare: 0.2, rearOverLimitShare: 0.05 },
      exits: { count: 3, toFullThrottleS: { median: 1.5 }, peakLongitudinalG: { median: 0.8 } }
    }
  }

  const payload = analysis.persistencePayload(finalized)

  assert.ok(payload.result.statsJson !== null, 'statsJson should not be null when stats provided')
  const parsed = JSON.parse(payload.result.statsJson)
  assert.equal(parsed.version, 1)
  assert.equal(parsed.movingMs, 5000)
  assert.equal(parsed.distanceM, 200)
})

test('persistencePayload includes null statsJson when stats are missing', () => {
  const finalized = {
    status: 'insufficient',
    mainProblem: null,
    opportunities: [],
    evidence: [],
    stats: null
  }

  const payload = analysis.persistencePayload(finalized)

  assert.equal(payload.result.statsJson, null, 'statsJson should be null when stats missing')
})

test('reanalyzeStoredSessions with statsVersion: interrupted session replayed for stats backfill', async () => {
  const calls = []
  const storedSample = {
    sequence: 0,
    timestampMs: 100,
    speedKmh: 90,
    throttle: 0.4,
    brake: 0.1,
    steer: 0.2,
    gear: 3,
    rpm: 5000,
    rpmMax: 8000,
    accelerationX: 1,
    accelerationY: 0,
    accelerationZ: 0,
    yawRate: 0,
    slipRatio: [0.01, 0.02, 0.03, 0.04],
    slipAngle: [0.1, 0.2, 0.3, 0.4],
    combinedSlip: [0.2, 0.3, 0.4, 0.5],
    tireTempC: [80, 81, 82, 83],
    suspension: [0.5, 0.6, 0.7, 0.8],
    rumble: [false, true, false, false],
    puddle: [0, 0, 0, 0],
    lapTime: 12.5,
    lapNumber: 2,
    lapDistance: 450
  }

  const invoke = async (command, payload = {}) => {
    calls.push({ command, payload })
    if (command === 'load_driver_analysis_sessions') {
      return [{
        id: 7,
        status: 'interrupted',
        sampleCount: 1,
        storageBytes: 100,
        algorithmVersion: 'driver-analysis-rules-v3',
        stats: null,
        vehicleIdentity: { ordinal: 42, pi: 800, drivetrain: 1, rpmMax: 8000 }
      }]
    }
    if (command === 'load_driver_analysis_samples') return [storedSample]
    if (command === 'save_driver_analysis_stats') return { id: 7, statsJson: payload.statsJson }
    throw new Error(`Unexpected command ${command}`)
  }

  const createEngine = () => {
    const statsObj = { version: 1, movingMs: 1000, distanceM: 100 }
    const statsApi = { finalize: () => statsObj }
    return {
      snapshot: () => ({ algorithmVersion: 'driver-analysis-rules-v3' }),
      update: () => {},
      finalize: () => ({ status: 'insufficient', mainProblem: null, opportunities: [], evidence: [], stats: statsApi.finalize() })
    }
  }

  const updated = await analysis.reanalyzeStoredSessions({ invoke, createEngine, statsVersion: 1 })

  assert.equal(updated.length, 1)
  const saveCall = calls.find(c => c.command === 'save_driver_analysis_stats')
  assert.ok(saveCall, 'should call save_driver_analysis_stats')
  assert.ok(saveCall.payload.sessionId === 7)
  assert.ok(saveCall.payload.statsJson !== null)
  const stats = JSON.parse(saveCall.payload.statsJson)
  assert.equal(stats.version, 1)
})

test('reanalyzeStoredSessions with statsVersion: completed session with current stats is not replayed', async () => {
  const calls = []
  const updated = await analysis.reanalyzeStoredSessions({
    invoke: async command => {
      calls.push(command)
      return [{
        id: 7,
        status: 'completed',
        sampleCount: 100,
        storageBytes: 5000,
        algorithmVersion: 'driver-analysis-rules-v3',
        stats: { version: 1 }
      }]
    },
    createEngine: () => ({ snapshot: () => ({ algorithmVersion: 'driver-analysis-rules-v3' }) }),
    statsVersion: 1
  })

  assert.deepEqual(updated, [])
  assert.deepEqual(calls, ['load_driver_analysis_sessions'])
})

test('reanalyzeStoredSessions with statsVersion: old algorithm version still triggers full reanalysis with stats', async () => {
  const calls = []
  const storedSample = {
    sequence: 0,
    timestampMs: 100,
    speedKmh: 90,
    throttle: 0.4,
    brake: 0,
    steer: 0,
    gear: 3,
    rpm: 5000,
    rpmMax: 8000,
    accelerationX: 1,
    accelerationY: 0,
    accelerationZ: 0,
    yawRate: 0,
    slipRatio: [0.01, 0.02, 0.03, 0.04],
    slipAngle: [0.1, 0.2, 0.3, 0.4],
    combinedSlip: [0.2, 0.3, 0.4, 0.5],
    tireTempC: [80, 81, 82, 83],
    suspension: [0.5, 0.6, 0.7, 0.8],
    rumble: [false, true, false, false],
    puddle: [0, 0, 0, 0],
    lapTime: 12.5,
    lapNumber: 2,
    lapDistance: 450
  }

  const invoke = async (command, payload = {}) => {
    calls.push({ command, payload })
    if (command === 'load_driver_analysis_sessions') {
      return [{
        id: 7,
        status: 'completed',
        sampleCount: 1,
        storageBytes: 5000,
        algorithmVersion: 'driver-analysis-rules-v2',
        stats: { version: 1 },
        vehicleIdentity: { ordinal: 42, pi: 800, drivetrain: 1, rpmMax: 8000 }
      }]
    }
    if (command === 'load_driver_analysis_samples') return [storedSample]
    if (command === 'reanalyze_driver_analysis_session') {
      return { id: 7, result: payload.result.result, algorithmVersion: payload.algorithmVersion }
    }
    throw new Error(`Unexpected command ${command}`)
  }

  const createEngine = () => {
    const statsObj = { version: 1, movingMs: 1000, distanceM: 100 }
    const statsApi = { finalize: () => statsObj }
    return {
      snapshot: () => ({ algorithmVersion: 'driver-analysis-rules-v3' }),
      update: () => {},
      finalize: () => ({ status: 'issue', mainProblem: { kind: 'front_scrub' }, opportunities: [], evidence: [], stats: statsApi.finalize() })
    }
  }

  const updated = await analysis.reanalyzeStoredSessions({ invoke, createEngine, statsVersion: 1 })

  assert.equal(updated.length, 1)
  const reanalysisCall = calls.find(c => c.command === 'reanalyze_driver_analysis_session')
  assert.ok(reanalysisCall, 'should call reanalyze_driver_analysis_session for old algorithm')
  assert.ok(reanalysisCall.payload.result.statsJson !== null, 'result.statsJson should be populated')
  const stats = JSON.parse(reanalysisCall.payload.result.statsJson)
  assert.equal(stats.version, 1)
})

test('an analysis engine fault stops the recording without throwing into the telemetry path', async () => {
  const commands = []
  const recorder = analysis.createRecorder({
    enabled: true,
    engine: {
      reset: () => undefined,
      snapshot: () => ({ algorithmVersion: 'test' }),
      update: () => { throw new Error('engine fault') }
    },
    invoke: async command => { commands.push(command); return 1 }
  })
  recorder.start()
  const telemetry = {
    isRaceOn: true, timestampMs: 100, speedKmh: 90, rpmMax: 8000,
    car: { ordinal: 42, pi: 800, drivetrain: 2 }
  }
  assert.doesNotThrow(() => recorder.update(telemetry))
  const status = recorder.snapshot()
  assert.equal(status.phase, 'error')
  assert.equal(status.lastError, 'engine fault')
  assert.deepEqual(commands, [])
})
