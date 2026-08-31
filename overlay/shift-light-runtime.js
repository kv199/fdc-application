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
  let currentGearCount = null
  let configurationRegistrationPending = false
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

  function registerConfiguration(key, expectedLearner, gearCount, gearboxSignature = null) {
    if (!key || !Number.isInteger(gearCount) || gearCount < 1) return Promise.resolve(null)
    return enqueueProfileMutation(async () => {
      const args = { key, gearCount }
      if (gearboxSignature) args.gearboxSignature = gearboxSignature
      const resolution = await invokeCommand('register_shift_light_config', args)
      if (
        !resolution
        || !Number.isInteger(resolution.variantId)
      ) return null
      variantIdsByLearner.set(expectedLearner, resolution.variantId)
      if (expectedLearner === learner) {
        currentVariantId = resolution.variantId
      }
      return resolution
    })
  }

  function loadConfigurationProfiles(key, configId, expectedLearner, requestedLoadGeneration) {
    invokeCommand('load_shift_light_config_profiles', { key, configId })
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
      onProgress: profile => persistProfile(profile, localLearner),
      onCalibrated: profile => {
        if (profile.method === 'optimal') persistProfile(profile, localLearner)
      },
      onGearboxChanged: signature => clearConfiguration(localLearner, signature)
    })
    learner = localLearner
    currentKey = key
    currentVariantId = null
    currentGearCount = null
    variantIdsByLearner.set(localLearner, null)
    pendingProfilesByLearner.set(localLearner, new Map())
    latestState = localLearner.snapshot(latestTelemetry)
    publish(latestState)

    invokeCommand('get_latest_shift_light_config', { key })
      .then(gearCount => {
        if (key !== currentKey || localGeneration !== generation || localLearner !== learner) return
        if (Number.isInteger(gearCount) && gearCount >= 1) activateConfiguration(key, localLearner, gearCount)
      })
      .catch(() => {})
  }

  function activateConfiguration(key, expectedLearner, gearCount) {
    if (configurationRegistrationPending || expectedLearner !== learner) return
    configurationRegistrationPending = true
    const state = expectedLearner.snapshot(latestTelemetry)
    const signature = typeof state?.gearboxSignature === 'string' ? state.gearboxSignature : null
    registerConfiguration(key, expectedLearner, gearCount, signature)
      .then(resolution => {
        configurationRegistrationPending = false
        if (
          !resolution
          || key !== currentKey
          || expectedLearner !== learner
        ) return
        variantIdsByLearner.set(expectedLearner, resolution.variantId)
        currentVariantId = resolution.variantId
        currentGearCount = gearCount
        const requestedLoadGeneration = ++loadGeneration
        loadConfigurationProfiles(key, resolution.variantId, expectedLearner, requestedLoadGeneration)
        flushPendingProfiles(expectedLearner)
      })
      .catch(() => {
        configurationRegistrationPending = false
      })
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
    let state = learner.update(telemetry)
    const confirmedGearCount = Number.isInteger(state?.gearCount) ? state.gearCount : null
    const observedGearCount = Number.isInteger(state?.observedGearCount) ? state.observedGearCount : 0
    if (currentGearCount !== null && observedGearCount > currentGearCount) {
      createLearner(key)
      state = learner.update(telemetry)
    } else if (confirmedGearCount !== null && confirmedGearCount !== currentGearCount) {
      if (currentGearCount !== null) {
        learner.clearConfiguration()
        pendingProfilesByLearner.get(learner)?.clear()
      }
      activateConfiguration(key, learner, confirmedGearCount)
    }
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
        if (!configId) throw new Error('Drive to the confirmed top gear before resetting this calibration')
        return invokeCommand('clear_shift_light_config', { configId })
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
    currentGearCount = null
    variantIdsByLearner.set(currentLearner, null)
    const pendingProfiles = pendingProfilesByLearner.get(currentLearner)
    pendingProfiles?.clear()
    publish({ ...currentLearner.snapshot(latestTelemetry), phase: 'normal' })
    if (resettingLearner === currentLearner) resettingLearner = null
    configurationRegistrationPending = false
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
