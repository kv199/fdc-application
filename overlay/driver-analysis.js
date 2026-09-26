(function (globalScope, factory) {
  const drivesApi = typeof module !== 'undefined' && module.exports && typeof document === 'undefined'
    ? require('./driver-analysis-drives.js') : globalScope.DriverAnalysisDrives
  const api = factory(globalScope, drivesApi)
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DriverAnalysis = api
}(typeof globalThis !== 'undefined' ? globalThis : this, (globalScope, drivesApi) => {
  'use strict'

  const SETTINGS_STORAGE_KEY = 'fdc.driver-analysis.settings.v1'
  const DEFAULT_HOTKEY = 'Ctrl+Shift+F9'
  const SAMPLE_BATCH_MS = 1000
  const REANALYSIS_PAGE_SIZE = 2000
  const BLOCKED_HOTKEYS = new Set(['Alt+F4', 'Alt+Tab', 'Ctrl+Escape', 'Ctrl+Shift+Escape'])

  function storageGet(storage, key) {
    try { return storage?.getItem?.(key) || null } catch { return null }
  }

  function storageSet(storage, key, value) {
    try { storage?.setItem?.(key, value) } catch { /* restricted webview */ }
  }

  function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {}
    const normalized = { enabled: source.enabled === true, hotkey: normalizeHotkey(source.hotkey) || DEFAULT_HOTKEY }
    const label = typeof source.hotkeyLabel === 'string' ? source.hotkeyLabel.trim().slice(0, 80) : ''
    if (label && isControllerHotkey(normalized.hotkey)) normalized.hotkeyLabel = label
    return normalized
  }

  function readSettings(storage = globalScope.localStorage) {
    try { return normalizeSettings(JSON.parse(storageGet(storage, SETTINGS_STORAGE_KEY) || 'null')) } catch { return normalizeSettings(null) }
  }

  function writeSettings(value, storage = globalScope.localStorage) {
    const settings = normalizeSettings(value)
    storageSet(storage, SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    return settings
  }

  function normalizedMainKey(value) {
    const raw = String(value || '').trim()
    if (/^[a-z]$/i.test(raw)) return raw.toUpperCase()
    if (/^[0-9]$/.test(raw)) return raw
    if (/^f(?:[1-9]|1[0-2])$/i.test(raw)) return raw.toUpperCase()
    const aliases = { ' ': 'Space', spacebar: 'Space', space: 'Space', enter: 'Enter', escape: 'Escape', esc: 'Escape', tab: 'Tab', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight' }
    return aliases[raw.toLowerCase()] || null
  }

  function isControllerHotkey(value) {
    const str = String(value || '').trim()
    return /^Controller:[0-9A-Fa-f]{4}:[0-9A-Fa-f]{4}:\d+$/.test(str)
  }

  function normalizeHotkey(value) {
    const str = String(value || '').trim()
    if (!str) return null
    if (/^controller:/i.test(str)) {
      const match = /^Controller:([0-9A-Fa-f]{4}):([0-9A-Fa-f]{4}):(\d+)$/i.exec(str)
      if (!match) return null
      const [, vendor, product, buttonStr] = match
      const button = Number(buttonStr)
      if (!Number.isInteger(button) || button < 1 || button > 1024) return null
      if (String(button) !== buttonStr) return null
      return `Controller:${vendor.toUpperCase()}:${product.toUpperCase()}:${button}`
    }
    const tokens = str.split('+').map(token => token.trim()).filter(Boolean)
    if (tokens.length < 2) return null
    const modifiers = new Set()
    let mainKey = null
    for (const token of tokens) {
      const normalized = token.toLowerCase()
      if (normalized === 'ctrl' || normalized === 'control') modifiers.add('Ctrl')
      else if (normalized === 'alt') modifiers.add('Alt')
      else if (normalized === 'shift') modifiers.add('Shift')
      else if (normalized === 'meta' || normalized === 'win' || normalized === 'windows' || normalized === 'super') return null
      else {
        if (mainKey !== null) return null
        mainKey = normalizedMainKey(token)
      }
    }
    if (!mainKey || modifiers.size === 0) return null
    const hotkey = [...['Ctrl', 'Alt', 'Shift'].filter(modifier => modifiers.has(modifier)), mainKey].join('+')
    return BLOCKED_HOTKEYS.has(hotkey) ? null : hotkey
  }

  function hotkeyFromKeyboardEvent(event) {
    if (!event || event.metaKey) return null
    const mainKey = normalizedMainKey(event.key)
    if (!mainKey || ['Ctrl', 'Alt', 'Shift'].includes(mainKey)) return null
    return normalizeHotkey([event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', mainKey].filter(Boolean).join('+'))
  }

  function formatHotkey(value, label) {
    const normalized = normalizeHotkey(value) || DEFAULT_HOTKEY
    if (isControllerHotkey(normalized)) {
      const match = /^Controller:([0-9A-F]{4}):([0-9A-F]{4}):(\d+)$/.exec(normalized)
      if (match) {
        const [, vendor, product, button] = match
        const deviceName = typeof label === 'string' && label.trim() ? label.trim() : `Controller ${vendor}:${product}`
        return `${deviceName} · Button ${button}`
      }
    }
    return normalized.replaceAll('+', ' + ')
  }

  function finite(value, fallback = 0) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  function quad(value, fallback = 0) { return ['fl', 'fr', 'rl', 'rr'].map(key => finite(value?.[key], fallback)) }

  function vehicleIdentity(telemetry) {
    const ordinal = Math.trunc(finite(telemetry?.car?.ordinal, -1))
    const pi = Math.trunc(finite(telemetry?.car?.pi, -1))
    const drivetrain = Math.trunc(finite(telemetry?.car?.drivetrain, -1))
    const rpmMax = Math.round(finite(telemetry?.rpmMax, -1))
    if (ordinal <= 0 || pi < 0 || drivetrain < 0 || rpmMax <= 0) return null
    return { key: `${ordinal}:${pi}:${rpmMax}:${drivetrain}`, ordinal, pi, drivetrain, rpmMax }
  }

  function persistedPosition(telemetry) {
    const values = [telemetry?.position?.x, telemetry?.position?.y, telemetry?.position?.z].map(Number)
    return values.every(Number.isFinite) ? values : null
  }

  function persistedSample(telemetry, sequence) {
    if (!telemetry || telemetry.isRaceOn === false || !Number.isFinite(Number(telemetry.timestampMs)) || !Number.isFinite(Number(telemetry.speedKmh))) return null
    const position = persistedPosition(telemetry)
    return {
      ...(position ? { position } : {}),
      sequence, timestampMs: Math.max(0, Math.round(finite(telemetry.timestampMs))), speedKmh: Math.max(0, finite(telemetry.speedKmh)),
      throttle: finite(telemetry.throttle), brake: finite(telemetry.brake), steer: finite(telemetry.steer),
      gear: Math.max(0, Math.trunc(finite(telemetry.gear))), rpm: Math.max(0, finite(telemetry.rpm)), rpmMax: Math.max(0, finite(telemetry.rpmMax)),
      accelerationX: finite(telemetry.acceleration?.x), accelerationY: finite(telemetry.acceleration?.y), accelerationZ: finite(telemetry.acceleration?.z), yawRate: finite(telemetry.angularVelocity?.y),
      slipRatio: quad(telemetry.slipRatio), slipAngle: quad(telemetry.slipAngle), combinedSlip: quad(telemetry.combinedSlip), tireTempC: quad(telemetry.tireTempC),
      suspension: quad(telemetry.suspension), rumble: quad(telemetry.rumble, false).map(Boolean), puddle: quad(telemetry.puddle),
      lapTime: Math.max(0, finite(telemetry.lap?.current)), lapNumber: Math.max(0, Math.trunc(finite(telemetry.lap?.number))), lapDistance: Math.max(0, finite(telemetry.lap?.distance))
    }
  }

  function replayTelemetry(sample, vehicleIdentity) {
    if (!sample || typeof sample !== 'object' || !vehicleIdentity || typeof vehicleIdentity !== 'object') return null
    const ordinal = Math.trunc(finite(vehicleIdentity.ordinal, -1))
    const pi = Math.trunc(finite(vehicleIdentity.pi, -1))
    const drivetrain = Math.trunc(finite(vehicleIdentity.drivetrain, -1))
    const rpmMax = finite(sample.rpmMax, finite(vehicleIdentity.rpmMax, -1))
    if (ordinal <= 0 || pi < 0 || drivetrain < 0 || rpmMax <= 0) return null
    const asQuad = value => {
      const values = Array.isArray(value) ? value : []
      return { fl: finite(values[0]), fr: finite(values[1]), rl: finite(values[2]), rr: finite(values[3]) }
    }
    const asBooleanQuad = value => {
      const values = Array.isArray(value) ? value : []
      return { fl: values[0] === true, fr: values[1] === true, rl: values[2] === true, rr: values[3] === true }
    }
    return {
      isRaceOn: true,
      timestampMs: finite(sample.timestampMs),
      speedKmh: finite(sample.speedKmh),
      throttle: finite(sample.throttle),
      brake: finite(sample.brake),
      steer: finite(sample.steer),
      gear: Math.max(0, Math.trunc(finite(sample.gear))),
      rpm: Math.max(0, finite(sample.rpm)),
      rpmMax,
      acceleration: { x: finite(sample.accelerationX), y: finite(sample.accelerationY), z: finite(sample.accelerationZ) },
      angularVelocity: { y: finite(sample.yawRate) },
      slipRatio: asQuad(sample.slipRatio),
      slipAngle: asQuad(sample.slipAngle),
      combinedSlip: asQuad(sample.combinedSlip),
      tireTempC: asQuad(sample.tireTempC),
      suspension: asQuad(sample.suspension),
      rumble: asBooleanQuad(sample.rumble),
      puddle: asQuad(sample.puddle),
      lap: { current: finite(sample.lapTime), raceTime: finite(sample.lapTime), number: Math.max(0, Math.trunc(finite(sample.lapNumber))), distance: Math.max(0, finite(sample.lapDistance)) },
      car: { ordinal, pi, drivetrain }
    }
  }

  function persistencePayload(finalized, interrupted = false) {
    const opportunityIndex = new Map(finalized.opportunities.map((opportunity, index) => [opportunity.id, index]))
    const evidenceByOpportunity = new Map(finalized.evidence.map(item => [item.opportunityId, item]))
    const opportunities = finalized.opportunities.map(opportunity => {
      const item = evidenceByOpportunity.get(opportunity.id)
      return {
        maneuverId: String(opportunity.maneuverId), opportunityType: opportunity.type,
        startedAtMs: Math.max(0, Math.round(finite(opportunity.startedAtMs))), finishedAtMs: Math.max(0, Math.round(finite(opportunity.endedAtMs, opportunity.startedAtMs))),
        speedBin: Number.isFinite(Number(opportunity.speedBin)) ? Math.trunc(Number(opportunity.speedBin)) : null,
        gear: Number.isFinite(Number(opportunity.context?.gear)) ? Math.trunc(Number(opportunity.context.gear)) : null,
        outcome: item?.outcome || opportunity.outcome || 'incomplete', valid: opportunity.valid === true,
        invalidReason: opportunity.valid === true ? null : opportunity.invalidReason || 'incomplete_opportunity', contextJson: JSON.stringify(opportunity.context || {})
      }
    })
    const evidence = finalized.evidence.map(item => ({
      opportunityIndex: opportunityIndex.get(item.opportunityId), problemType: item.type, primary: item.primary === true,
      detectorConfidence: finite(item.detectorConfidence), attributionConfidence: finite(item.attributionConfidence), severity: finite(item.severity),
      metricsJson: JSON.stringify({ ...(item.metrics || {}), confounders: item.confounders || [], counterexampleCount: finite(item.counterexampleCount) })
    })).filter(item => Number.isSafeInteger(item.opportunityIndex))
    const main = finalized.mainProblem
    const normalizedStatus = finalized.status === 'no_clear_dominant_problem' ? 'ambiguous' : finalized.status
    const result = interrupted
      ? 'interrupted'
      : ['issue', 'ambiguous', 'no_recurring_problem'].includes(normalizedStatus)
        ? normalizedStatus
        : 'insufficient'
    return {
      opportunities, evidence,
      result: {
        result, mainKind: result === 'issue' ? main?.kind || null : null, label: result === 'issue' ? main?.label || '' : '', instruction: result === 'issue' ? main?.instruction || '' : '',
        detectorConfidence: result === 'issue' ? main?.detectorConfidence ?? null : null, attributionConfidence: result === 'issue' ? main?.attributionConfidence ?? null : null,
        severity: result === 'issue' ? main?.severity ?? null : null,
        statsJson: finalized.stats ? JSON.stringify(finalized.stats) : null
      }
    }
  }

  // One recording (RECORD to STOP) holds one analysis session per continuous stint with a single car. A car change
  // finishes the current car's session and starts the next one in the same recording.
  function createRecorder(options = {}) {
    const engine = options.engine || globalScope.DriverAnalysisEngine?.createDriverAnalysisEngine?.()
    const invoke = typeof options.invoke === 'function' ? options.invoke : null
    const emit = typeof options.emit === 'function' ? options.emit : () => Promise.resolve()
    const onResult = typeof options.onResult === 'function' ? options.onResult : () => Promise.resolve()
    const now = typeof options.now === 'function' ? options.now : () => Date.now()
    const createSegmenter = typeof options.createSegmenter === 'function'
      ? options.createSegmenter
      : () => drivesApi?.createDriveSegmenter?.({ now }) || null
    if (!engine || !invoke) return null

    let enabled = options.enabled === true
    let phase = enabled ? 'ready' : 'off'
    let startedAt = null
    let recordingId = null
    let recordingPromise = null
    let car = createCarState()
    let lastError = null
    let persistence = Promise.resolve()

    function createCarState() {
      return {
        sessionId: null, sessionPromise: null, identity: null, sequence: 0, samples: [],
        lastFlushAt: 0, lastTimestampMs: null, segmenter: createSegmenter()
      }
    }

    function snapshot() {
      const engineState = engine.snapshot?.() || {}
      return {
        enabled, phase, startedAt, recordingId, sessionId: car.sessionId, sampleCount: car.sequence, lastError,
        ...engineState, recording: phase === 'waiting' || phase === 'recording'
      }
    }

    function publish() { void Promise.resolve(emit(snapshot())).catch(() => undefined) }

    function fail(error) {
      lastError = error instanceof Error ? error.message : String(error || 'Driver Analysis persistence failed')
      phase = 'error'
      publish()
    }

    function enqueue(task) {
      const next = persistence.then(task)
      persistence = next.catch(error => { fail(error) })
      return next
    }

    function resetRuntime(reason) {
      engine.reset?.(reason)
      startedAt = null
      recordingId = null
      recordingPromise = null
      car = createCarState()
      lastError = null
    }

    function flushSamples(state = car) {
      if (!state.sessionId || state.samples.length === 0) return Promise.resolve(0)
      const batch = state.samples
      state.samples = []
      state.lastFlushAt = now()
      return enqueue(() => invoke('append_driver_analysis_samples', { sessionId: state.sessionId, samples: batch })).catch(error => {
        state.samples = [...batch, ...state.samples]
        throw error
      })
    }

    function ensureRecording() {
      if (recordingPromise) return recordingPromise
      startedAt = now()
      recordingPromise = enqueue(() => invoke('create_driver_analysis_recording', { startedAtMs: startedAt })).then(id => {
        recordingId = Number(id)
        if (!Number.isSafeInteger(recordingId) || recordingId <= 0) throw new Error('Driver Analysis recording was not created')
        return recordingId
      })
      return recordingPromise
    }

    function ensureSession(identity) {
      const state = car
      if (state.sessionPromise) return state.sessionPromise
      const recording = ensureRecording()
      state.lastFlushAt = now()
      state.identity = identity
      phase = 'recording'
      publish()
      const input = {
        algorithmVersion: engine.snapshot?.().algorithmVersion,
        vehicleIdentity: { ordinal: identity.ordinal, pi: identity.pi, drivetrain: identity.drivetrain, rpmMax: identity.rpmMax },
        startedAtMs: now(),
        vehicleOrdinal: identity.ordinal, vehiclePi: identity.pi, vehicleDrivetrain: identity.drivetrain, vehicleRpmLimit: identity.rpmMax
      }
      state.sessionPromise = recording
        .then(id => enqueue(() => invoke('create_driver_analysis_session', { input: { ...input, recordingId: id } })))
        .then(id => {
          state.sessionId = Number(id)
          if (!Number.isSafeInteger(state.sessionId) || state.sessionId <= 0) throw new Error('Driver Analysis session was not created')
          return state.sessionId
        })
      return state.sessionPromise
    }

    // Finishes the current car's session and leaves a fresh car state for the next stint.
    async function finishCar(interrupted) {
      const state = car
      car = createCarState()
      if (!state.sessionPromise) return null
      const finalized = engine.finalize()
      engine.reset?.('car_finished')
      const drives = state.segmenter?.finalize?.() || []
      await state.sessionPromise
      await flushSamples(state)
      await persistence
      const payload = persistencePayload(finalized, interrupted)
      const entry = await enqueue(() => invoke('finalize_driver_analysis_session', { sessionId: state.sessionId, ...payload, drives }))
      void Promise.resolve(onResult(entry)).catch(() => undefined)
      return entry
    }

    function start() {
      if (!enabled || phase === 'waiting' || phase === 'recording' || phase === 'finalizing') return snapshot()
      resetRuntime('recording_start')
      phase = 'waiting'
      publish()
      return snapshot()
    }

    async function stop(interrupted = false) {
      if (phase !== 'waiting' && phase !== 'recording') return { status: snapshot(), entry: null }
      const hadRecording = recordingPromise !== null
      phase = 'finalizing'
      publish()
      if (!hadRecording) {
        resetRuntime('recording_stopped_without_telemetry')
        phase = enabled ? 'ready' : 'off'
        publish()
        return { status: snapshot(), entry: null }
      }
      try {
        const entry = await finishCar(interrupted)
        await persistence
        resetRuntime('recording_stop')
        phase = enabled ? 'ready' : 'off'
        publish()
        return { status: snapshot(), entry }
      } catch (error) {
        fail(error)
        return { status: snapshot(), entry: null, error }
      }
    }

    async function setEnabled(value) {
      const next = value === true
      if (!next && (phase === 'waiting' || phase === 'recording')) await stop(true)
      enabled = next
      if (!enabled && phase !== 'finalizing') phase = 'off'
      else if (enabled && phase === 'off') phase = 'ready'
      publish()
      return snapshot()
    }

    function update(telemetry) {
      if (!enabled || (phase !== 'waiting' && phase !== 'recording')) return snapshot()
      const identity = vehicleIdentity(telemetry)
      if (identity && car.identity && identity.key !== car.identity.key) {
        void finishCar(false).catch(error => fail(error))
      }
      const sample = persistedSample(telemetry, car.sequence)
      if (!identity || !sample) {
        // Result screens and pauses are not stored, but they carry the finish line for drive detection.
        if (car.identity) car.segmenter?.update?.(telemetry, null)
        return snapshot()
      }
      try {
        engine.update(telemetry)
      } catch (error) {
        // An analysis fault must not break the shared telemetry path or the HUD.
        fail(error)
        return snapshot()
      }
      // Forza sends packets in pairs with one timestamp; the analysis ignores the second, so it is not stored.
      const duplicate = car.lastTimestampMs !== null && sample.timestampMs === car.lastTimestampMs
      if (!duplicate) {
        car.sequence += 1
        car.lastTimestampMs = sample.timestampMs
        car.samples.push(sample)
      }
      car.segmenter?.update?.(telemetry, duplicate ? null : sample)
      const state = car
      void ensureSession(identity).then(() => {
        if (state === car && state.samples.length > 0 && now() - state.lastFlushAt >= SAMPLE_BATCH_MS) void flushSamples(state)
      }).catch(() => undefined)
      return snapshot()
    }

    function resetTransient(reason = 'telemetry_gap') {
      if (phase === 'recording') engine.resetTransient?.(reason)
      return snapshot()
    }

    function toggle() { return phase === 'waiting' || phase === 'recording' ? stop() : Promise.resolve({ status: start(), entry: null }) }

    return { resetTransient, setEnabled, snapshot, start, stop, toggle, update }
  }

  async function reanalyzeStoredSessions(options = {}) {
    const invoke = typeof options.invoke === 'function' ? options.invoke : null
    const createEngine = typeof options.createEngine === 'function'
      ? options.createEngine
      : globalScope.DriverAnalysisEngine?.createDriverAnalysisEngine
    const onResult = typeof options.onResult === 'function' ? options.onResult : () => undefined
    const onError = typeof options.onError === 'function' ? options.onError : () => undefined
    const statsVersion = options.statsVersion ?? globalScope.DriverAnalysisStats?.STATS_VERSION ?? null
    if (!invoke || typeof createEngine !== 'function') return []

    const probe = createEngine()
    const algorithmVersion = probe?.snapshot?.().algorithmVersion
    if (!algorithmVersion) return []
    const history = await invoke('load_driver_analysis_sessions')
    const needsReanalysis = entry => entry?.status === 'completed' && entry?.algorithmVersion !== algorithmVersion
    const needsStats = entry => statsVersion !== null
      && entry?.status !== 'recording'
      && Number(entry?.storageBytes) > 0
      && Number(entry?.stats?.version) !== Number(statsVersion)
    const candidates = (Array.isArray(history) ? history : []).filter(entry => (
      Number(entry?.sampleCount) > 0 && (needsReanalysis(entry) || needsStats(entry))
    ))
    const updated = []
    for (const entry of candidates) {
      try {
        const engine = createEngine()
        let afterSequence = -1
        let replayedSamples = 0
        while (true) {
          const page = await invoke('load_driver_analysis_samples', {
            sessionId: Number(entry.id),
            afterSequence,
            limit: REANALYSIS_PAGE_SIZE
          })
          if (!Array.isArray(page) || page.length === 0) break
          for (const sample of page) {
            const telemetry = replayTelemetry(sample, entry.vehicleIdentity)
            if (!telemetry) throw new Error(`Driver Analysis session ${entry.id} contains an invalid replay sample`)
            engine.update(telemetry)
            replayedSamples += 1
          }
          afterSequence = Math.trunc(finite(page.at(-1)?.sequence, afterSequence))
          if (page.length < REANALYSIS_PAGE_SIZE) break
          await new Promise(resolve => setTimeout(resolve, 0))
        }
        if (replayedSamples === 0) throw new Error(`Driver Analysis session ${entry.id} has no replay samples`)
        const finalized = engine.finalize()
        if (!needsReanalysis(entry) && !finalized.stats) throw new Error(`Driver Analysis session ${entry.id} produced no statistics`)
        const result = needsReanalysis(entry)
          ? await invoke('reanalyze_driver_analysis_session', {
            sessionId: Number(entry.id),
            algorithmVersion,
            ...persistencePayload(finalized, false)
          })
          : await invoke('save_driver_analysis_stats', {
            sessionId: Number(entry.id),
            statsJson: JSON.stringify(finalized.stats || {})
          })
        updated.push(result)
        onResult(result)
      } catch (error) {
        onError(error, entry)
      }
    }
    return updated
  }

  return {
    DEFAULT_HOTKEY, SETTINGS_STORAGE_KEY,
    createRecorder, formatHotkey, hotkeyFromKeyboardEvent,
    isControllerHotkey, normalizeHotkey, normalizeSettings, persistedSample, persistencePayload,
    readSettings, reanalyzeStoredSessions, replayTelemetry,
    vehicleIdentity, writeSettings
  }
}))
