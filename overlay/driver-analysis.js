(function (globalScope, factory) {
  const api = factory(globalScope)
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DriverAnalysis = api
}(typeof globalThis !== 'undefined' ? globalThis : this, globalScope => {
  'use strict'

  const SETTINGS_STORAGE_KEY = 'fdc.driver-analysis.settings.v1'
  const HISTORY_STORAGE_KEY = 'fdc.driver-analysis.history.v1'
  const DEFAULT_HOTKEY = 'Ctrl+Shift+F9'
  const HISTORY_LIMIT = 100
  const SAMPLE_BATCH_MS = 1000
  const REANALYSIS_PAGE_SIZE = 2000
  const BLOCKED_HOTKEYS = new Set(['Alt+F4', 'Alt+Tab', 'Ctrl+Escape', 'Ctrl+Shift+Escape'])

  function storageGet(storage, key) {
    try { return storage?.getItem?.(key) || null } catch { return null }
  }

  function storageSet(storage, key, value) {
    try { storage?.setItem?.(key, value) } catch { /* restricted webview */ }
  }

  function storageRemove(storage, key) {
    try { storage?.removeItem?.(key) } catch { /* restricted webview */ }
  }

  function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {}
    return { enabled: source.enabled === true, hotkey: normalizeHotkey(source.hotkey) || DEFAULT_HOTKEY }
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

  function normalizeHotkey(value) {
    const tokens = String(value || '').split('+').map(token => token.trim()).filter(Boolean)
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

  function formatHotkey(value) {
    return (normalizeHotkey(value) || DEFAULT_HOTKEY).replaceAll('+', ' + ')
  }

  function isoDate(value) {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  }

  function normalizeHistoryEntry(value) {
    if (!value || typeof value !== 'object') return null
    const recordedAt = isoDate(value.recordedAt ?? value.startedAt)
    if (!recordedAt) return null
    const result = ['issue', 'insufficient', 'ambiguous', 'no_recurring_problem', 'interrupted'].includes(value.result) ? value.result : 'insufficient'
    const issue = result === 'issue' && typeof value.mainKind === 'string' && String(value.label || '').trim() && String(value.instruction || '').trim()
    return {
      id: String(value.id || Date.parse(recordedAt)), recordedAt,
      durationMs: Math.max(0, Math.round(Number(value.durationMs) || 0)), sampleCount: Math.max(0, Math.round(Number(value.sampleCount) || 0)),
      maneuverCount: Math.max(0, Math.round(Number(value.maneuverCount) || 0)), opportunityCount: Math.max(0, Math.round(Number(value.opportunityCount) || 0)),
      evidenceCount: Math.max(0, Math.round(Number(value.evidenceCount) || 0)),
      result: issue ? 'issue' : result === 'issue' ? 'insufficient' : result,
      mainKind: issue ? value.mainKind : null, label: issue ? String(value.label).trim() : '', instruction: issue ? String(value.instruction).trim() : ''
    }
  }

  function sortHistoryNewestFirst(entries) {
    return entries.slice().sort((left, right) => Date.parse(right.recordedAt) - Date.parse(left.recordedAt) || String(right.id).localeCompare(String(left.id)))
  }

  function readHistory(storage = globalScope.localStorage) {
    try {
      const stored = JSON.parse(storageGet(storage, HISTORY_STORAGE_KEY) || '[]')
      return Array.isArray(stored) ? sortHistoryNewestFirst(stored.map(normalizeHistoryEntry).filter(Boolean)).slice(0, HISTORY_LIMIT) : []
    } catch { return [] }
  }

  function writeHistory(entries, storage = globalScope.localStorage) {
    const history = sortHistoryNewestFirst((Array.isArray(entries) ? entries : []).map(normalizeHistoryEntry).filter(Boolean)).slice(0, HISTORY_LIMIT)
    storageSet(storage, HISTORY_STORAGE_KEY, JSON.stringify(history))
    return history
  }

  function appendHistory(entry, storage = globalScope.localStorage) {
    const normalized = normalizeHistoryEntry(entry)
    return normalized ? writeHistory([normalized, ...readHistory(storage)], storage) : readHistory(storage)
  }

  function clearHistory(storage = globalScope.localStorage) { storageRemove(storage, HISTORY_STORAGE_KEY) }

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

  function persistedSample(telemetry, sequence) {
    if (!telemetry || telemetry.isRaceOn === false || !Number.isFinite(Number(telemetry.timestampMs)) || !Number.isFinite(Number(telemetry.speedKmh))) return null
    return {
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
        severity: result === 'issue' ? main?.severity ?? null : null
      }
    }
  }

  function createRecorder(options = {}) {
    const engine = options.engine || globalScope.DriverAnalysisEngine?.createDriverAnalysisEngine?.()
    const invoke = typeof options.invoke === 'function' ? options.invoke : null
    const emit = typeof options.emit === 'function' ? options.emit : () => Promise.resolve()
    const onResult = typeof options.onResult === 'function' ? options.onResult : () => Promise.resolve()
    const now = typeof options.now === 'function' ? options.now : () => Date.now()
    if (!engine || !invoke) return null

    let enabled = options.enabled === true
    let phase = enabled ? 'ready' : 'off'
    let startedAt = null
    let sessionId = null
    let sessionPromise = null
    let identity = null
    let sequence = 0
    let samples = []
    let lastFlushAt = 0
    let lastError = null
    let persistence = Promise.resolve()

    function snapshot() {
      const engineState = engine.snapshot?.() || {}
      return { enabled, phase, startedAt, sessionId, sampleCount: sequence, lastError, ...engineState, recording: phase === 'waiting' || phase === 'recording' }
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
      sessionId = null
      sessionPromise = null
      identity = null
      sequence = 0
      samples = []
      lastFlushAt = 0
      lastError = null
    }

    function flushSamples() {
      if (!sessionId || samples.length === 0) return Promise.resolve(0)
      const batch = samples
      samples = []
      lastFlushAt = now()
      return enqueue(() => invoke('append_driver_analysis_samples', { sessionId, samples: batch })).catch(error => {
        samples = [...batch, ...samples]
        throw error
      })
    }

    function ensureSession(car) {
      if (sessionId) return Promise.resolve(sessionId)
      if (sessionPromise) return sessionPromise
      startedAt = now()
      lastFlushAt = startedAt
      identity = car
      phase = 'recording'
      publish()
      const input = {
        algorithmVersion: engine.snapshot?.().algorithmVersion || 'driver-analysis-rules-v2',
        vehicleIdentity: { ordinal: car.ordinal, pi: car.pi, drivetrain: car.drivetrain, rpmMax: car.rpmMax }, startedAtMs: startedAt,
        vehicleOrdinal: car.ordinal, vehiclePi: car.pi, vehicleDrivetrain: car.drivetrain, vehicleRpmLimit: car.rpmMax
      }
      sessionPromise = enqueue(() => invoke('create_driver_analysis_session', { input })).then(id => {
        sessionId = Number(id)
        if (!Number.isSafeInteger(sessionId) || sessionId <= 0) throw new Error('Driver Analysis session was not created')
        return sessionId
      })
      return sessionPromise
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
      const hadSession = sessionPromise !== null
      phase = 'finalizing'
      publish()
      if (!hadSession) {
        resetRuntime('recording_stopped_without_telemetry')
        phase = enabled ? 'ready' : 'off'
        publish()
        return { status: snapshot(), entry: null }
      }
      try {
        await sessionPromise
        await flushSamples()
        await persistence
        const finalized = engine.finalize()
        const payload = persistencePayload(finalized, interrupted)
        const entry = await enqueue(() => invoke('finalize_driver_analysis_session', { sessionId, ...payload }))
        void Promise.resolve(onResult(entry)).catch(() => undefined)
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
      const car = vehicleIdentity(telemetry)
      const sample = persistedSample(telemetry, sequence)
      if (!car || !sample) return snapshot()
      if (identity && car.key !== identity.key) {
        void stop(true)
        return snapshot()
      }
      sequence += 1
      samples.push(sample)
      engine.update(telemetry)
      void ensureSession(car).then(() => {
        if (samples.length > 0 && now() - lastFlushAt >= SAMPLE_BATCH_MS) void flushSamples()
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
    if (!invoke || typeof createEngine !== 'function') return []

    const probe = createEngine()
    const algorithmVersion = probe?.snapshot?.().algorithmVersion
    if (!algorithmVersion) return []
    const history = await invoke('load_driver_analysis_sessions')
    const candidates = (Array.isArray(history) ? history : []).filter(entry => (
      entry?.status === 'completed'
      && Number(entry?.sampleCount) > 0
      && entry?.algorithmVersion !== algorithmVersion
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
        const payload = persistencePayload(engine.finalize(), false)
        const result = await invoke('reanalyze_driver_analysis_session', {
          sessionId: Number(entry.id),
          algorithmVersion,
          ...payload
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
    DEFAULT_HOTKEY, HISTORY_LIMIT, HISTORY_STORAGE_KEY, SETTINGS_STORAGE_KEY,
    appendHistory, clearHistory, createRecorder, formatHotkey, hotkeyFromKeyboardEvent,
    normalizeHistoryEntry, normalizeHotkey, normalizeSettings, persistedSample, persistencePayload,
    readHistory, readSettings, reanalyzeStoredSessions, replayTelemetry, sortHistoryNewestFirst,
    vehicleIdentity, writeHistory, writeSettings
  }
}))
