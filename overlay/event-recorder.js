(function (globalScope, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.HudEventRecorder = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const START_MAX_MS = 2000
  const START_MAX_DISTANCE_M = 25
  const RESTART_CLOCK_REWIND_S = 5
  const RESTART_DISTANCE_REWIND_M = 100

  function finite(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function text(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }

  function lapTimeMs(telemetry) {
    const value = finite(telemetry?.lap?.last)
    return value !== null && value > 0 ? Math.round(value * 1000) : null
  }

  function currentTimeMs(telemetry) {
    const value = finite(telemetry?.lap?.current)
    return value !== null && value >= 0 ? Math.round(value * 1000) : null
  }

  function isCleanStart(telemetry) {
    if (telemetry?.isRaceOn !== true) return false
    const current = currentTimeMs(telemetry)
    const raceTime = finite(telemetry?.lap?.raceTime)
    const distance = finite(telemetry?.lap?.distance)
    return current !== null && current <= START_MAX_MS
      && (raceTime === null || raceTime <= START_MAX_MS / 1000)
      && (distance === null || distance <= START_MAX_DISTANCE_M)
  }

  function isStrongRestart(previous, telemetry) {
    if (!previous || telemetry?.isRaceOn !== true) return false
    const previousClock = finite(previous.lastRaceTimeS)
    const currentClock = finite(telemetry?.lap?.raceTime)
    const previousLap = finite(previous.lastLapNumber)
    const currentLap = finite(telemetry?.lap?.number)
    const previousDistance = finite(previous.lastDistanceM)
    const currentDistance = finite(telemetry?.lap?.distance)
    if (previousClock === null || currentClock === null || previousLap === null || currentLap === null) return false
    const clockRewound = currentClock + RESTART_CLOCK_REWIND_S < previousClock
    const lapRewound = currentLap < previousLap
    const distanceRewound = previousDistance !== null
      && currentDistance !== null
      && currentDistance + RESTART_DISTANCE_REWIND_M < previousDistance
    return clockRewound && (lapRewound || distanceRewound)
  }

  function carSnapshot(telemetry) {
    const car = telemetry?.car && typeof telemetry.car === 'object' ? telemetry.car : {}
    const ordinal = finite(car.ordinal ?? telemetry?.carOrdinal)
    const pi = finite(car.pi ?? telemetry?.pi)
    const drivetrain = finite(car.drivetrain ?? car.drivetrainType ?? telemetry?.drivetrain)
    const classLabels = ['D', 'C', 'B', 'A', 'S1', 'S2', 'R', 'X']
    const rawClass = car.class ?? car.classLabel ?? telemetry?.classLabel
    const numericClass = finite(rawClass)
    const classValue = numericClass !== null
      ? Math.round(numericClass)
      : classLabels.indexOf(String(rawClass || '').trim().toUpperCase())
    const name = text(car.name ?? car.displayName ?? car.carName ?? telemetry?.carName)
    return {
      ordinal: ordinal === null ? null : Math.round(ordinal),
      name,
      class: classValue < 0 ? null : classValue,
      pi: pi === null ? null : Math.round(pi),
      drivetrain: drivetrain === null ? null : Math.round(drivetrain)
    }
  }

  function createState() {
    return {
      armed: false,
      eventId: null,
      eventName: null,
      run: null,
      timingState: null,
      pendingLapNumber: null,
      lastTelemetry: null,
      lastRunResult: null,
      armedAtMs: null
    }
  }

  function createRun(eventId, telemetry, timestamp) {
    const safeTimestamp = Number.isFinite(Number(timestamp)) ? Number(timestamp) : Date.now()
    return {
      runId: `run-${safeTimestamp}-${Math.random().toString(36).slice(2, 8)}`,
      eventId: String(eventId),
      startedAt: new Date(safeTimestamp).toISOString(),
      startedAtMs: safeTimestamp,
      laps: [],
      finalTimeMs: null,
      finalTimeSource: null,
      runType: 'circuit',
      result: 'completed',
      car: carSnapshot(telemetry)
    }
  }

  function normalizeRunsPayload(value) {
    const list = Array.isArray(value) ? value : value?.runs ?? value?.items ?? value?.records
    if (!Array.isArray(list)) return []
    return list.filter(run => run && typeof run === 'object')
  }

  function createEventRecorder(options = {}) {
    const timingApi = options.timingApi || null
    const invoke = typeof options.invoke === 'function' ? options.invoke : null
    const emit = typeof options.emit === 'function' ? options.emit : null
    const now = typeof options.now === 'function' ? options.now : Date.now
    const onStatus = typeof options.onStatus === 'function' ? options.onStatus : () => {}
    const onSaved = typeof options.onSaved === 'function' ? options.onSaved : () => {}
    const onResult = typeof options.onResult === 'function' ? options.onResult : () => {}
    let state = createState()
    let persistQueue = Promise.resolve()
    let lastPersistence = null
    let lastStatusSignature = null

    function status(extra = {}, force = false) {
      const run = state.run
      const payload = {
        eventId: state.eventId,
        eventName: state.eventName,
        recording: state.armed,
        state: state.armed ? (run ? 'recording' : 'armed') : 'stopped',
        runId: run?.runId ?? null,
        lapCount: run?.laps.length ?? 0,
        laps: run?.laps.map(lap => ({ ...lap })) ?? [],
        ...extra
      }
      const signature = JSON.stringify([
        payload.eventId,
        payload.recording,
        payload.state,
        payload.runId,
        payload.lapCount,
        run?.finalTimeMs ?? null,
        payload.restart,
        payload.error || null
      ])
      if (force || signature !== lastStatusSignature) {
        lastStatusSignature = signature
        onStatus(payload)
        if (emit) Promise.resolve(emit(payload)).catch(() => {})
      }
      return payload
    }

    function resetTiming() {
      state.timingState = timingApi?.createState?.() || null
      state.pendingLapNumber = null
    }

    function arm(eventId, eventName = null, armedAt = null) {
      const key = eventId === null || eventId === undefined || eventId === '' ? null : String(eventId)
      if (!key) return status({ error: 'An event is required' })
      state = createState()
      state.armed = true
      state.eventId = key
      state.eventName = text(eventName)
      state.armedAtMs = Number.isFinite(Number(armedAt)) ? Number(armedAt) : (Number(now()) || Date.now())
      lastPersistence = null
      resetTiming()
      return status()
    }

    function appendLap(telemetry, afterTiming) {
      if (!state.run) return false
      const number = finite(telemetry?.lap?.number)
      const timeMs = lapTimeMs(telemetry)
      if (number === null || timeMs === null) return false
      if (state.run.laps.some(lap => lap.lapNumber === Math.round(number))) return false
      state.run.laps.push({ lapNumber: Math.round(number), timeMs })
      state.run.laps.sort((left, right) => left.lapNumber - right.lapNumber)
      state.pendingLapNumber = null
      return true
    }

    function detectLapCompletion(previousTiming, telemetry, afterTiming) {
      const previousLap = finite(previousTiming?.lastLapNumber)
      const currentLap = finite(telemetry?.lap?.number)
      const boundary = previousLap !== null && currentLap !== null && currentLap > previousLap
      const timeMs = lapTimeMs(telemetry)
      if (boundary && timeMs !== null) return true
      if (boundary && timeMs === null) {
        state.pendingLapNumber = currentLap
        return false
      }
      return state.pendingLapNumber !== null
        && currentLap !== null
        && currentLap === state.pendingLapNumber
        && timeMs !== null
        && afterTiming?.phase === 'circuit_complete'
    }

    function resultEventId(run) {
      if (run?.eventId !== null && run?.eventId !== undefined) {
        return Number.isFinite(Number(run.eventId)) ? Math.round(Number(run.eventId)) : run.eventId
      }
      return state.eventId
    }

    function notifyResult(payload) {
      try {
        Promise.resolve(onResult(payload)).catch(() => {})
      } catch (_) {
        // Result observers must not change persistence outcomes.
      }
      return payload
    }

    function result(run, outcome, reason, extra = {}) {
      return notifyResult({
        eventId: resultEventId(run),
        outcome,
        run: run || null,
        reason,
        ...extra
      })
    }

    function hasPersistableResult(run) {
      if (!run) return false
      if (run.runType === 'sprint') return run.result === 'confirmed' && run.finalTimeMs !== null
      return run.laps.length > 0 || run.finalTimeMs !== null
    }

    function persist(run, reason) {
      if (!run) return Promise.resolve(result(null, 'discarded', 'There is no active run to save.'))
      if (!hasPersistableResult(run)) {
        return Promise.resolve(result(run, 'discarded', 'The run has no completed laps or confirmed result.'))
      }
      const classLabels = ['D', 'C', 'B', 'A', 'S1', 'S2', 'R', 'X']
      const carClass = run.car.class === null ? null : Number.isFinite(Number(run.car.class))
        ? Math.round(Number(run.car.class))
        : classLabels.indexOf(String(run.car.class).toUpperCase())
      const payload = {
        run: {
          eventId: Number.isFinite(Number(run.eventId)) ? Math.round(Number(run.eventId)) : run.eventId,
          carOrdinal: run.car.ordinal,
          carName: run.car.name,
          carClass: carClass < 0 ? null : carClass,
          carPi: run.car.pi,
          drivetrain: run.car.drivetrain,
          startedAt: run.startedAt,
          runType: run.runType,
          result: run.result,
          resultTimeMs: run.finalTimeMs,
          laps: run.laps.map(lap => ({ lapNumber: lap.lapNumber, lapTimeMs: lap.timeMs }))
        }
      }
      const queued = persistQueue.catch(() => undefined).then(() => {
        if (!invoke) {
          try { onSaved(payload) } catch (_) {}
          return result(run, 'saved', `Run saved (${reason}).`, { run: payload.run })
        }
        return Promise.resolve()
          .then(() => invoke('record_event_run', payload))
          .then(saved => {
            const savedRun = saved?.run || saved || payload.run
            try { onSaved(savedRun) } catch (_) {}
            return result(run, 'saved', `Run saved (${reason}).`, { run: savedRun })
          })
          .catch(error => {
            const detail = text(error?.message ?? error)
            const message = detail ? `Unable to save run: ${detail}` : 'Unable to save run.'
            return result(run, 'failed', message, { error: message })
          })
      })
      persistQueue = queued.catch(() => undefined)
      return queued
    }

    function finishRun(reason, finalTimeMs = null, finalTimeSource = null) {
      if (!state.run) return Promise.resolve(false)
      const run = { ...state.run, laps: state.run.laps.map(lap => ({ ...lap })) }
      if (finalTimeMs !== null) run.finalTimeMs = finalTimeMs
      if (finalTimeSource !== null) run.finalTimeSource = finalTimeSource
      state.lastRunResult = run
      state.run = null
      lastPersistence = persist(run, reason)
      return lastPersistence
    }

    function stop() {
      const pending = state.run
        ? finishRun('stop')
        : (lastPersistence || Promise.resolve(result(null, 'discarded', 'There is no active run to save.')))
      state.armed = false
      state.eventId = null
      state.eventName = null
      state.run = null
      resetTiming()
      status()
      return pending
    }

    function update(telemetry) {
      if (!state.armed || !telemetry || typeof telemetry !== 'object') return status()
      const previousTiming = state.timingState || timingApi?.createState?.() || null
      const restart = isStrongRestart(previousTiming, telemetry)
      if (restart) {
        void finishRun('restart')
        state.run = null
        state.armedAtMs = Number(now()) || Date.now()
        resetTiming()
      }

      if (!state.run) {
        if (isCleanStart(telemetry)) {
          state.run = createRun(state.eventId, telemetry, state.armedAtMs || now())
        }
      }

      if (timingApi?.update && state.timingState) {
        const nextTiming = timingApi.update(state.timingState, telemetry)
        if (state.run && detectLapCompletion(previousTiming, telemetry, nextTiming)) appendLap(telemetry, nextTiming)
        if (state.run && nextTiming?.phase === 'sprint_complete' && finite(nextTiming.finalTimeMs) !== null) {
          state.run.finalTimeMs = Math.round(nextTiming.finalTimeMs)
          state.run.finalTimeSource = nextTiming.finalTimeSource || 'forza_lap_current'
          state.run.runType = 'sprint'
          state.run.result = 'confirmed'
          void finishRun('sprint_complete')
        }
        state.timingState = nextTiming
      }
      state.lastTelemetry = telemetry
      return status({ restart })
    }

    function snapshot() {
      return {
        ...state,
        run: state.run ? { ...state.run, laps: state.run.laps.map(lap => ({ ...lap })), car: { ...state.run.car } } : null
      }
    }

    return { arm, stop, update, status, snapshot }
  }

  return {
    START_MAX_MS,
    START_MAX_DISTANCE_M,
    createState,
    createEventRecorder,
    carSnapshot,
    isCleanStart,
    isStrongRestart,
    normalizeRunsPayload
  }
}))
