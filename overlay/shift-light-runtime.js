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
    gearboxSignature: null,
    currentGear: null,
    method: null,
    gears: [],
    diagnostics: []
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
  const pendingProfilesByLearner = new WeakMap()
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

  function flushPendingProfiles(expectedLearner) {
    const variantId = variantIdsByLearner.get(expectedLearner)
    const pendingProfiles = pendingProfilesByLearner.get(expectedLearner)
    if (!variantId || !pendingProfiles || expectedLearner === resettingLearner) return
    const profiles = [...pendingProfiles.values()]
    pendingProfiles.clear()
    for (const profile of profiles) {
      enqueueProfileMutation(() => {
        if (expectedLearner === resettingLearner) return undefined
        const learnerVariantId = variantIdsByLearner.get(expectedLearner)
        if (!learnerVariantId) {
          pendingProfiles.set(profile.gear, profile)
          return undefined
        }
        return invokeCommand('save_shift_light_config_profile', {
          configId: learnerVariantId,
          profile
        })
      }).catch(() => {})
    }
  }

  function persistProfile(profile, expectedLearner) {
    if (!profile || expectedLearner !== learner || expectedLearner === resettingLearner) return
    let pendingProfiles = pendingProfilesByLearner.get(expectedLearner)
    if (!pendingProfiles) {
      pendingProfiles = new Map()
      pendingProfilesByLearner.set(expectedLearner, pendingProfiles)
    }
    pendingProfiles.set(profile.gear, profile)
    flushPendingProfiles(expectedLearner)
  }

  function createLearner(key) {
    const localLearner = new globalScope.HudShiftLight.ShiftLightLearner(key, {
      onProgress: profile => persistProfile(profile, localLearner),
      onCalibrated: profile => {
        if (profile.method === 'optimal') persistProfile(profile, localLearner)
      },
      onGearboxChanged: signature => clearConfiguration(localLearner, signature)
    })
    learner = localLearner
    currentKey = key
    variantIdsByLearner.set(localLearner, null)
    pendingProfilesByLearner.set(localLearner, new Map())
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
      const resolution = await invokeCommand('resolve_shift_light_config', { key, observedGear })
      if (!Number.isInteger(resolution?.variantId) || resolution.variantId < 1) {
        throw new Error('Invalid Shift Light configuration')
      }
      const profiles = await invokeCommand('load_shift_light_config_profiles', {
        key, configId: resolution.variantId
      })
      if (expectedLearner !== learner || key !== currentKey) return
      if (!Array.isArray(profiles)) throw new Error('Invalid Shift Light profiles')
      variantIdsByLearner.set(expectedLearner, resolution.variantId)
      if (requestedLoadGeneration !== loadGeneration || expectedLearner === resettingLearner) return
      expectedLearner.setProfiles(profiles)
      publish(expectedLearner.snapshot(latestTelemetry))
      flushPendingProfiles(expectedLearner)
    })
      .catch(() => {
        // Keep live evidence and retry storage without recreating the learner.
        retryAfterByLearner.set(expectedLearner, Date.now() + 1000)
      })
      .finally(() => resolvingLearners.delete(expectedLearner))
  }

  function clearConfiguration(expectedLearner, signature) {
    const configId = variantIdsByLearner.get(expectedLearner)
    if (!configId) return
    enqueueProfileMutation(() => invokeCommand('clear_shift_light_config', {
      configId,
      gearboxSignature: signature
    })).catch(() => {})
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
    resolveConfiguration(key, learner, state.observedGearCount)
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
        return invokeCommand('clear_shift_light_config', { configId })
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
    const pendingProfiles = pendingProfilesByLearner.get(currentLearner)
    pendingProfiles?.clear()
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
