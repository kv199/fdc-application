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

  function invokeCommand(command, args) {
    if (typeof invoke !== 'function') return Promise.reject(new Error('Tauri commands are unavailable'))
    return Promise.resolve(invoke(command, args))
  }

  function publish(state) {
    latestState = state || EMPTY_STATE
    const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
    if (typeof eventApi?.emit === 'function') {
      Promise.resolve(eventApi.emit('hud_shift_light', latestState)).catch(() => {})
    }
    return latestState
  }

  function persistProfile(profile, expectedKey, expectedGeneration, expectedLearner) {
    if (!profile || expectedKey !== currentKey || expectedGeneration !== generation || expectedLearner !== learner) return
    invokeCommand('save_shift_light_profile', profile).catch(() => {})
  }

  function createLearner(key) {
    const localGeneration = ++generation
    const localLearner = new globalScope.HudShiftLight.ShiftLightLearner(key, {
      onCalibrated: profile => persistProfile(profile, key, localGeneration, localLearner)
    })
    learner = localLearner
    currentKey = key
    latestState = localLearner.snapshot(latestTelemetry)
    publish(latestState)

    invokeCommand('load_shift_light_profiles', { key })
      .then(profiles => {
        if (key !== currentKey || localGeneration !== generation || localLearner !== learner) return
        if (Array.isArray(profiles)) localLearner.setProfiles(profiles)
        publish(localLearner.snapshot(latestTelemetry))
      })
      .catch(() => {
        // Learning remains available in memory when the local database is unavailable.
      })
  }

  function update(telemetry) {
    latestTelemetry = telemetry || null
    const key = telemetry ? globalScope.HudShiftLight.getShiftLightCarKey(telemetry) : null
    if (!key) {
      if (learner) learner.resetTransient()
      return publish(EMPTY_STATE)
    }

    if (key !== currentKey || !learner) createLearner(key)
    return publish(learner.update(telemetry))
  }

  async function reset() {
    if (!currentKey || !learner) return false
    const key = currentKey
    await invokeCommand('reset_shift_light_profiles', { key })
    learner.reset()
    publish(learner.snapshot(latestTelemetry))
    return true
  }

  const api = {
    emptyState: () => ({ ...EMPTY_STATE, gears: [], diagnostics: [] }),
    getState: () => latestState,
    reset,
    update
  }

  globalScope.HudShiftLightRuntime = api
  if (typeof module !== 'undefined') module.exports = api
})(typeof globalThis === 'undefined' ? this : globalThis)
