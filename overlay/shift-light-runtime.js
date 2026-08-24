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
  let lastVariantRegistrationAt = 0

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

  function persistProfile(profile, expectedLearner) {
    if (
      !profile
      || expectedLearner === resettingLearner
    ) return

    enqueueProfileMutation(() => {
      if (
        expectedLearner === resettingLearner
      ) return undefined
      return invokeCommand('save_shift_light_profile', profile)
    }).catch(() => {})
  }

  function registerVariant(key, expectedLearner) {
    if (!key || expectedLearner === resettingLearner) return
    enqueueProfileMutation(() => {
      if (expectedLearner === resettingLearner) return undefined
      return invokeCommand('register_shift_light_variant', { key })
    }).catch(() => {})
    lastVariantRegistrationAt = Date.now()
  }

  function createLearner(key) {
    const localGeneration = ++generation
    const localLoadGeneration = ++loadGeneration
    const localLearner = new globalScope.HudShiftLight.ShiftLightLearner(key, {
      onCalibrated: profile => {
        if (profile.method === 'optimal') persistProfile(profile, localLearner)
      },
      onProgress: profile => persistProfile(profile, localLearner)
    })
    learner = localLearner
    currentKey = key
    lastVariantRegistrationAt = 0
    registerVariant(key, localLearner)
    latestState = localLearner.snapshot(latestTelemetry)
    publish(latestState)

    invokeCommand('load_shift_light_profiles', { key })
      .then(profiles => {
        if (
          key !== currentKey
          || localGeneration !== generation
          || localLoadGeneration !== loadGeneration
          || localLearner !== learner
        ) return
        if (Array.isArray(profiles)) localLearner.setProfiles(profiles)
        publish(localLearner.snapshot(latestTelemetry))
      })
      .catch(() => {
        // Learning remains available in memory when the local database is unavailable.
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
    else if (Date.now() - lastVariantRegistrationAt >= 1000) registerVariant(key, learner)
    return publish(learner.update(telemetry))
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
      await enqueueProfileMutation(() => invokeCommand('reset_shift_light_profiles', { key }))
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
    currentLearner.reset()
    lastVariantRegistrationAt = 0
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
