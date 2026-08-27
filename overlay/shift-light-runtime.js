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
  let generation = 0
  let loadGeneration = 0
  let profileMutationQueue = Promise.resolve()
  let resettingLearner = null
  let currentVariantId = null
  let currentVariantStatus = 'provisional'
  let variantRegistrationPending = false
  let requestedVariantSignature = null
  let variantResolutionPending = false
  let lastVariantResolutionAt = 0
  let variantIdsByLearner = new WeakMap()
  let pendingProfilesByLearner = new WeakMap()

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
        return invokeCommand('save_shift_light_profile', {
          variantId: learnerVariantId,
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

  function registerVariant(key, expectedLearner, gearboxSignature = null) {
    if (!key) return Promise.resolve(null)
    return enqueueProfileMutation(async () => {
      const args = { key }
      if (gearboxSignature) args.gearboxSignature = gearboxSignature
      const resolution = await invokeCommand('register_shift_light_variant', args)
      if (
        !resolution
        || !Number.isInteger(resolution.variantId)
      ) return null
      variantIdsByLearner.set(expectedLearner, resolution.variantId)
      if (expectedLearner === learner) {
        currentVariantId = resolution.variantId
        currentVariantStatus = resolution.status || 'provisional'
      }
      return resolution
    })
  }

  function loadVariantProfiles(key, variantId, expectedLearner, requestedLoadGeneration) {
    invokeCommand('load_shift_light_profiles', { key, variantId })
      .then(profiles => {
        if (
          key !== currentKey
          || requestedLoadGeneration !== loadGeneration
          || expectedLearner !== learner
        ) return
        if (Array.isArray(profiles)) expectedLearner.setProfiles(profiles)
        publish(expectedLearner.snapshot(latestTelemetry))
      })
      .catch(() => {
        // The live learner remains usable when the local database is unavailable.
      })
  }

  function createLearner(key) {
    const localGeneration = ++generation
    const localLearner = new globalScope.HudShiftLight.ShiftLightLearner(key, {
      onCalibrated: profile => {
        if (profile.method === 'optimal') persistProfile(profile, localLearner)
      },
      onProgress: profile => persistProfile(profile, localLearner)
    })
    learner = localLearner
    currentKey = key
    currentVariantId = null
    currentVariantStatus = 'provisional'
    requestedVariantSignature = null
    variantResolutionPending = false
    lastVariantResolutionAt = 0
    variantIdsByLearner.set(localLearner, null)
    pendingProfilesByLearner.set(localLearner, new Map())
    latestState = localLearner.snapshot(latestTelemetry)
    publish(latestState)

    variantRegistrationPending = true
    registerVariant(key, localLearner)
      .then(resolution => {
        variantRegistrationPending = false
        if (
          !resolution
          || key !== currentKey
          || localGeneration !== generation
          || localLearner !== learner
        ) return
        const requestedLoadGeneration = ++loadGeneration
        loadVariantProfiles(key, resolution.variantId, localLearner, requestedLoadGeneration)
        flushPendingProfiles(localLearner)
      })
      .catch(() => {
        variantRegistrationPending = false
        // Learning remains available in memory when the local database is unavailable.
      })
  }

  function syncVariantSignature(key, state, expectedLearner) {
    const signature = typeof state?.gearboxSignature === 'string' && state.gearboxSignature.length > 0
      ? state.gearboxSignature
      : null
    if (!signature || expectedLearner !== learner) return
    const now = Date.now()
    if (
      variantResolutionPending
      || signature === requestedVariantSignature
        && (currentVariantStatus !== 'ambiguous' || now - lastVariantResolutionAt < 1000)
    ) return

    requestedVariantSignature = signature
    lastVariantResolutionAt = now
    variantResolutionPending = true
    registerVariant(key, expectedLearner, signature)
      .then(resolution => {
        variantResolutionPending = false
        if (
          !resolution
          || key !== currentKey
          || expectedLearner !== learner
        ) return
        currentVariantStatus = resolution.status || 'provisional'
        if (resolution.status === 'ambiguous') {
          variantIdsByLearner.set(expectedLearner, resolution.variantId)
          currentVariantId = resolution.variantId
          flushPendingProfiles(expectedLearner)
          return
        }
        variantIdsByLearner.set(expectedLearner, resolution.variantId)
        currentVariantId = resolution.variantId
        const requestedLoadGeneration = ++loadGeneration
        loadVariantProfiles(key, resolution.variantId, expectedLearner, requestedLoadGeneration)
        flushPendingProfiles(expectedLearner)
      })
      .catch(() => {
        variantResolutionPending = false
        // The live learner remains usable when the signed variant is not yet persisted.
      })
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
    else if (!variantIdsByLearner.get(learner) && !variantRegistrationPending) {
      const expectedLearner = learner
      variantRegistrationPending = true
      registerVariant(key, expectedLearner)
        .then(resolution => {
          variantRegistrationPending = false
          if (!resolution || key !== currentKey || expectedLearner !== learner) return
          const requestedLoadGeneration = ++loadGeneration
          loadVariantProfiles(key, resolution.variantId, expectedLearner, requestedLoadGeneration)
          flushPendingProfiles(expectedLearner)
        })
        .catch(() => {
          variantRegistrationPending = false
        })
    }
    const state = learner.update(telemetry)
    syncVariantSignature(key, state, learner)
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
        let variantId = variantIdsByLearner.get(currentLearner) || null
        if (!variantId) {
          const resolution = await invokeCommand('register_shift_light_variant', { key })
          variantId = resolution?.variantId || null
          if (variantId) variantIdsByLearner.set(currentLearner, variantId)
          currentVariantId = variantId
        }
        if (!variantId) throw new Error('Unable to resolve the active HUD variant')
        return invokeCommand('reset_shift_light_profiles', { variantId })
      })
    } catch (error) {
      if (resettingLearner === currentLearner) resettingLearner = null
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
    generation += 1
    currentLearner.reset()
    currentVariantId = null
    currentVariantStatus = 'provisional'
    requestedVariantSignature = null
    variantResolutionPending = false
    variantIdsByLearner.set(currentLearner, null)
    const pendingProfiles = pendingProfilesByLearner.get(currentLearner)
    pendingProfiles?.clear()
    publish({ ...currentLearner.snapshot(latestTelemetry), phase: 'normal' })
    if (resettingLearner === currentLearner) resettingLearner = null
    variantRegistrationPending = false
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
