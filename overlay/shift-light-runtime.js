(function (globalScope) {
  'use strict'

  const EMPTY_STATE = {
    status: 'fallback',
    phase: 'normal',
    shiftRpm: null,
    sampleCount: 0,
    carKey: null,
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

  function persistProfile(profile, expectedKey, expectedGeneration, expectedLearner) {
    if (
      !profile
      || expectedKey !== currentKey
      || expectedGeneration !== generation
      || expectedLearner !== learner
      || expectedLearner === resettingLearner
    ) return

    enqueueProfileMutation(() => {
      if (
        expectedKey !== currentKey
        || expectedGeneration !== generation
        || expectedLearner !== learner
        || expectedLearner === resettingLearner
      ) return undefined
      return invokeCommand('save_shift_light_profile', profile)
    }).catch(() => {})
  }

  function createLearner(key) {
    const localGeneration = ++generation
    const localLoadGeneration = ++loadGeneration
    const localLearner = new globalScope.HudShiftLight.ShiftLightLearner(key, {
      onCalibrated: profile => persistProfile(profile, key, localGeneration, localLearner)
    })
    learner = localLearner
    currentKey = key
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
    return publish(learner.update(telemetry))
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
    publish({ ...currentLearner.snapshot(latestTelemetry), phase: 'normal' })
    if (resettingLearner === currentLearner) resettingLearner = null
    return publishResetResult({ ok: true, carKey: key })
  }

  const api = {
    emptyState: () => ({ ...EMPTY_STATE, gears: [], diagnostics: [] }),
    getState: () => latestState,
    reset,
    sync: () => publish(latestState),
    update
  }

  globalScope.HudShiftLightRuntime = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
