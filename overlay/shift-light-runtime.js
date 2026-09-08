(function (globalScope) {
  'use strict'

  const EMPTY_STATE = {
    status: 'fallback',
    phase: 'normal',
    shiftRpm: null,
    sampleCount: 0,
    carKey: null,
    gameId: null,
    carOrdinal: null,
    pi: null,
    rpmMax: null,
    reportedRedlineRpm: null,
    usableCeiling: null,
    ceilingSampleCount: 0,
    currentGear: null,
    method: null,
    gears: [],
    diagnostics: [],
    acceptedShiftCount: 0,
    lastAcceptedShift: null,
    persistenceError: null
  }

  const invoke = globalScope.__TAURI_INTERNALS__?.invoke
  let learner = null
  let currentKey = null
  let latestTelemetry = null
  let latestState = EMPTY_STATE
  let loadGeneration = 0
  let profileMutationQueue = Promise.resolve()
  let resettingLearner = null
  const variantIdsByLearner = new WeakMap()
  const pendingCalibrationByLearner = new WeakMap()
  const calibrationRetryByLearner = new WeakMap()
  const calibrationFlushInFlight = new WeakSet()
  const calibrationFingerprintByLearner = new WeakMap()
  const resolvingLearners = new WeakSet()
  const retryAfterByLearner = new WeakMap()

  function invokeCommand(command, args) {
    if (typeof invoke !== 'function') return Promise.reject(new Error('Tauri commands are unavailable'))
    return Promise.resolve(invoke(command, args))
  }

  function emit(name, payload) {
    const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
    if (typeof eventApi?.emit === 'function') {
      Promise.resolve(eventApi.emit(name, payload)).catch(() => {})
    }
  }

  function publish(state) {
    latestState = state || EMPTY_STATE
    emit('hud_shift_light', latestState)
    return latestState
  }

  function publishResetResult(result) {
    emit('hud_shift_light_reset_result', result)
    return result.ok === true
  }

  function enqueueProfileMutation(task) {
    const operation = profileMutationQueue.then(task)
    profileMutationQueue = operation.catch(() => {})
    return operation
  }

  function publishPersistenceError(error) {
    const message = error?.message || String(error || 'Unable to persist Shift Light calibration')
    latestState = { ...latestState, persistenceError: message }
    emit('hud_shift_light', latestState)
  }

  function compactCalibration(state, key, telemetry) {
    if (!state || typeof state !== 'object') return null
    const gears = Array.isArray(state.gearTargets)
      ? state.gearTargets
      : Array.isArray(state.gears) ? state.gears : []
    const shiftSamples = Array.isArray(state.shiftSamples)
      ? state.shiftSamples
      : Array.isArray(state.acceptedShifts) ? state.acceptedShifts : []
    return {
      reportedRedlineRpm: finiteRpm(state.reportedRedlineRpm ?? state.rpmMax ?? telemetry?.rpmMax),
      usableCeiling: finiteRpm(state.usableCeiling),
      ceilingSamples: compactRpmArray(state.ceilingSamples),
      gearTargets: gears.map(compactGearTarget).filter(Boolean),
      shiftSamples: shiftSamples.map(compactShiftSample).filter(Boolean)
    }
  }

  function finiteRpm(value) {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null
  }

  function compactRpmArray(value) {
    return Array.isArray(value) ? value.map(finiteRpm).filter(value => value !== null).slice(-3) : []
  }

  function compactGearTarget(value) {
    if (!value || typeof value !== 'object') return null
    const sourceGear = Number.isInteger(value.sourceGear) ? value.sourceGear : value.gear
    if (!Number.isInteger(sourceGear) || sourceGear < 1 || sourceGear > 10) return null
    const destinationGear = Number.isInteger(value.destinationGear) ? value.destinationGear : sourceGear + 1
    if (destinationGear !== sourceGear + 1 || destinationGear > 10) return null
    const status = value.status
    return {
      sourceGear,
      destinationGear,
      status: ['learning', 'potential', 'optimal'].includes(status) ? status : 'learning',
      candidateRpm: finiteRpm(value.candidateRpm),
      optimalRpm: finiteRpm(value.optimalRpm ?? value.targetRpm ?? value.shiftRpm),
      confirmationCount: Number.isFinite(value.confirmationCount)
        ? Math.max(0, Math.round(value.confirmationCount))
        : 0,
      acceptedShiftCount: Number.isFinite(value.acceptedShiftCount)
        ? Math.max(0, Math.round(value.acceptedShiftCount))
        : Number.isFinite(value.sampleCount) ? Math.max(0, Math.round(value.sampleCount)) : 0,
      lastDeltaPct: Number.isFinite(value.lastDeltaPct) ? value.lastDeltaPct : null,
      lastAcceptedAt: Number.isFinite(value.lastAcceptedAt) ? Math.round(value.lastAcceptedAt) : null
    }
  }

  function compactShiftSample(value) {
    if (!value || typeof value !== 'object') return null
    const sourceGear = Number.isInteger(value.sourceGear) ? value.sourceGear : value.gear
    const destinationGear = Number.isInteger(value.destinationGear) ? value.destinationGear : sourceGear + 1
    const beforeRpm = finiteRpm(value.beforeRpm)
    const afterRpm = finiteRpm(value.afterRpm)
    const beforePower = value.beforePower
    const afterPower = value.afterPower
    const deltaPercent = value.deltaPercent ?? value.powerDeltaPct
    const beforeTimestampMs = Number.isFinite(value.beforeTimestampMs) ? Math.round(value.beforeTimestampMs) : 0
    const afterTimestampMs = Number.isFinite(value.afterTimestampMs) ? Math.round(value.afterTimestampMs) : 0
    if (!Number.isInteger(sourceGear) || sourceGear < 1 || sourceGear > 10
      || destinationGear !== sourceGear + 1 || beforeRpm === null || afterRpm === null
      || !Number.isFinite(beforePower) || beforePower <= 0
      || !Number.isFinite(afterPower) || afterPower <= 0
      || beforeTimestampMs < 0 || afterTimestampMs < beforeTimestampMs
      || !Number.isFinite(deltaPercent)) return null
    return {
      sourceGear,
      destinationGear,
      beforeTimestampMs,
      afterTimestampMs,
      beforeRpm,
      afterRpm,
      beforePower,
      afterPower,
      deltaPercent,
      classification: deltaPercent >= 0 ? 'crossover' : 'not_better'
    }
  }

  // The database deliberately exposes SQL-shaped names (optimalRpm and
  // deltaPercent). Adapt only those names at the learner boundary; the
  // persisted request remains the compact native contract.
  function adaptCalibrationForLearner(value, key) {
    if (!value || typeof value !== 'object') return value
    return {
      ...value,
      key: value.key ?? key,
      gearTargets: Array.isArray(value.gearTargets)
        ? value.gearTargets.map(target => ({
          ...target,
          status: target.status,
          targetRpm: target.targetRpm ?? target.optimalRpm
        })) : [],
      shiftSamples: Array.isArray(value.shiftSamples)
        ? value.shiftSamples.map(sample => ({
          ...sample,
          powerDeltaPct: sample.powerDeltaPct ?? sample.deltaPercent,
          outcome: sample.outcome ?? (sample.classification === 'crossover' ? 'better' : 'not_better'),
          reason: sample.reason ?? (sample.classification === 'crossover' ? 'POWER_CROSSOVER' : 'NO_CROSSOVER')
        })) : []
    }
  }

  function flushCalibration(expectedLearner) {
    const state = pendingCalibrationByLearner.get(expectedLearner)
    const configId = variantIdsByLearner.get(expectedLearner)
    if (!state || !configId || expectedLearner !== learner || expectedLearner === resettingLearner
      || calibrationFlushInFlight.has(expectedLearner)) return
    pendingCalibrationByLearner.delete(expectedLearner)
    calibrationFlushInFlight.add(expectedLearner)
    enqueueProfileMutation(() => invokeCommand('save_shift_light_calibration', {
      request: {
        key: currentKey,
        configId,
        reportedRedlineRpm: state.reportedRedlineRpm,
        usableCeiling: state.usableCeiling,
        ceilingSamples: state.ceilingSamples,
        gearTargets: state.gearTargets,
        shiftSamples: state.shiftSamples
      }
    })).then(() => {
      calibrationFlushInFlight.delete(expectedLearner)
      calibrationRetryByLearner.delete(expectedLearner)
      // A telemetry frame may have produced a newer compact snapshot while
      // the previous write was in flight. Persist only that latest snapshot.
      flushCalibration(expectedLearner)
    }, error => {
      calibrationFingerprintByLearner.delete(expectedLearner)
      pendingCalibrationByLearner.set(expectedLearner, state)
      calibrationFlushInFlight.delete(expectedLearner)
      publishPersistenceError(error)
      const retry = calibrationRetryByLearner.get(expectedLearner) || { attempts: 0 }
      retry.attempts += 1
      calibrationRetryByLearner.set(expectedLearner, retry)
      const delay = Math.min(4000, 250 * (2 ** Math.min(retry.attempts - 1, 4)))
      const timer = setTimeout(() => flushCalibration(expectedLearner), delay)
      timer.unref?.()
    })
  }

  function persistCalibration(state, expectedLearner) {
    if (!state || typeof state !== 'object' || expectedLearner !== learner || expectedLearner === resettingLearner) return
    const compact = compactCalibration(state, currentKey, latestTelemetry)
    if (!compact) return
    const fingerprint = JSON.stringify(compact)
    if (fingerprint === calibrationFingerprintByLearner.get(expectedLearner)) return
    calibrationFingerprintByLearner.set(expectedLearner, fingerprint)
    pendingCalibrationByLearner.set(expectedLearner, compact)
    flushCalibration(expectedLearner)
  }

  function createLearner(key) {
    const localLearner = new globalScope.HudShiftLight.ShiftLightLearner(key, {
      onLearningState: state => persistCalibration(state, localLearner),
      onGearboxChanged: signature => clearConfiguration(localLearner, signature)
    })
    learner = localLearner
    currentKey = key
    variantIdsByLearner.set(localLearner, null)
    pendingCalibrationByLearner.set(localLearner, null)
    calibrationRetryByLearner.set(localLearner, { attempts: 0 })
    latestState = localLearner.snapshot(latestTelemetry)
    publish(latestState)
  }

  function resolveConfiguration(key, expectedLearner, observedGear) {
    if (
      variantIdsByLearner.get(expectedLearner)
      || resolvingLearners.has(expectedLearner)
      || expectedLearner === resettingLearner
      || Date.now() < (retryAfterByLearner.get(expectedLearner) || 0)
      || !Number.isInteger(observedGear) || observedGear < 1 || observedGear > 10
    ) return
    resolvingLearners.add(expectedLearner)
    const requestedLoadGeneration = loadGeneration
    enqueueProfileMutation(async () => {
      if (expectedLearner !== learner) return
      // A higher observed gear cannot prove a different gearbox. Resolve once
      // by the full vehicle key, keeping both the learner and its numeric ID.
      const resolution = await invokeCommand('resolve_shift_light_config', {
        key,
        observedGear,
        reportedRedlineRpm: finiteRpm(latestTelemetry?.rpmMax)
      })
      const configId = Number.isInteger(resolution?.configId) ? resolution.configId : resolution?.variantId
      if (!Number.isInteger(configId) || configId < 1) {
        throw new Error('Invalid Shift Light configuration')
      }
      const learningStateResult = await invokeCommand('load_shift_light_calibration', {
        key, configId
      })
      const learningState = learningStateResult?.calibration ?? learningStateResult
      if (expectedLearner !== learner || key !== currentKey) return
      if (learningState !== null && (typeof learningState !== 'object' || Array.isArray(learningState))) {
        throw new Error('Invalid Shift Light calibration')
      }
      variantIdsByLearner.set(expectedLearner, configId)
      if (requestedLoadGeneration !== loadGeneration || expectedLearner === resettingLearner) return
      if (learningState) {
        // Telemetry may arrive while the async configuration lookup is in
        // flight. Join those completed facts rather than replacing either
        // the live start of the pull or the persisted calibration.
        const calibration = adaptCalibrationForLearner(learningState, key)
        if (typeof expectedLearner.mergeCalibration === 'function') {
          expectedLearner.mergeCalibration(calibration)
        } else if (typeof expectedLearner.mergeLearningState === 'function') {
          expectedLearner.mergeLearningState(calibration, key)
        } else if (typeof expectedLearner.importCalibration === 'function') {
          expectedLearner.importCalibration(calibration)
        } else if (typeof expectedLearner.importLearningState === 'function') {
          expectedLearner.importLearningState(calibration, key)
        }
      }
      publish(expectedLearner.snapshot(latestTelemetry))
      flushCalibration(expectedLearner)
    })
      .catch(() => {
        // Keep live evidence and retry storage without recreating the learner.
        retryAfterByLearner.set(expectedLearner, Date.now() + 1000)
        publishPersistenceError(new Error('Unable to load Shift Light calibration from the database'))
      })
      .finally(() => resolvingLearners.delete(expectedLearner))
  }

  function clearConfiguration(expectedLearner) {
    const configId = variantIdsByLearner.get(expectedLearner)
    if (!configId) return
    enqueueProfileMutation(() => invokeCommand('clear_shift_light_config', {
      configId
    })).catch(error => publishPersistenceError(error))
  }

  function update(telemetry) {
    const key = telemetry ? globalScope.HudShiftLight.getShiftLightCarKey(telemetry) : null
    if (!key) {
      if (!learner) return publish(EMPTY_STATE)
      learner.resetTransient()
      return publish({ ...latestState, phase: 'normal' })
    }

    latestTelemetry = telemetry
    if (key !== currentKey || !learner) createLearner(key)
    const state = learner.update(telemetry)
    // Some learner revisions emit their persistence callback only when a
    // completed shift changes a target. Snapshot on the update boundary as
    // well so reported redline/ceiling facts are not lost before that event.
    const serialized = typeof learner.serializeLearningState === 'function'
      ? learner.serializeLearningState()
      : typeof learner.exportLearningState === 'function' ? learner.exportLearningState() : null
    persistCalibration(serialized, learner)
    resolveConfiguration(key, learner, state.observedGearCount)
    flushCalibration(learner)
    return publish(state)
  }

  function resetTransient() {
    if (!learner) return latestState
    learner.resetTransient()
    return publish({ ...latestState, phase: 'normal' })
  }

  async function reset() {
    if (!currentKey || !learner) {
      return publishResetResult({
        ok: false,
        carKey: null,
        message: 'No car calibration profile is available'
      })
    }
    const key = currentKey
    const currentLearner = learner
    resettingLearner = currentLearner
    try {
      await enqueueProfileMutation(async () => {
        const configId = variantIdsByLearner.get(currentLearner) || null
        if (!configId) throw new Error('The calibration database is not available yet')
        await invokeCommand('clear_shift_light_config', { configId })
      })
    } catch (error) {
      if (resettingLearner === currentLearner) resettingLearner = null
      // A load finishing during reset is intentionally not published. If the
      // clear fails, reload the still-persisted calibration on the next frame.
      variantIdsByLearner.delete(currentLearner)
      return publishResetResult({
        ok: false,
        carKey: key,
        message: error?.message || 'Unable to reset the calibration database'
      })
    }

    if (key !== currentKey || currentLearner !== learner) {
      if (resettingLearner === currentLearner) resettingLearner = null
      return publishResetResult({
        ok: false,
        carKey: currentKey,
        message: 'The car profile changed during reset'
      })
    }

    loadGeneration += 1
    currentLearner.reset()
    pendingCalibrationByLearner.delete(currentLearner)
    calibrationFingerprintByLearner.delete(currentLearner)
    publish({ ...currentLearner.snapshot(latestTelemetry), phase: 'normal' })
    if (resettingLearner === currentLearner) resettingLearner = null
    return publishResetResult({ ok: true, carKey: key })
  }

  const api = {
    emptyState: () => ({ ...EMPTY_STATE, gears: [], diagnostics: [] }),
    getState: () => latestState,
    reset,
    resetTransient,
    sync: () => publish(latestState),
    update
  }

  globalScope.HudShiftLightRuntime = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
