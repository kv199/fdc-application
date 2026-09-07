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
  const PROFILE_RETRY_BASE_MS = 250
  const PROFILE_RETRY_MAX_MS = 4000
  const variantIdsByLearner = new WeakMap()
  const pendingProfilesByLearner = new WeakMap()
  const profileRetryStateByLearner = new WeakMap()
  const pendingLearningStateByLearner = new WeakMap()
  const learningStateRetryByLearner = new WeakMap()
  const profileGenerationByLearner = new WeakMap()
  const profileGenerationByKey = new Map()
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

  function flushPendingProfiles(expectedLearner, generation = profileGenerationByLearner.get(expectedLearner)) {
    const variantId = variantIdsByLearner.get(expectedLearner)
    const pendingProfiles = pendingProfilesByLearner.get(expectedLearner)
    const retryStates = profileRetryStateByLearner.get(expectedLearner)
    const currentKeyGeneration = generation?.key
      ? profileGenerationByKey.get(generation.key)
      : generation
    if (
      generation !== profileGenerationByLearner.get(expectedLearner)
      || generation !== currentKeyGeneration
      || !variantId
      || !pendingProfiles
      || expectedLearner === resettingLearner
    ) return
    const now = Date.now()
    for (const [gear, profile] of pendingProfiles) {
      if (generation.latestProfiles.get(gear) !== profile) {
        pendingProfiles.delete(gear)
        retryStates?.delete(gear)
        continue
      }
      const retry = retryStates?.get(gear) || { attempts: 0, nextAt: 0, inFlight: false, profile }
      if (retry.inFlight || now < retry.nextAt) continue
      retry.inFlight = true
      retry.profile = profile
      retryStates?.set(gear, retry)
      enqueueProfileMutation(async () => {
        if (
          expectedLearner === resettingLearner
          || generation !== profileGenerationByLearner.get(expectedLearner)
          || generation !== profileGenerationByKey.get(generation?.key)
        ) return false
        const learnerVariantId = variantIdsByLearner.get(expectedLearner)
        if (!learnerVariantId || pendingProfiles.get(gear) !== profile
          || generation.latestProfiles.get(gear) !== profile) return false
        await invokeCommand('save_shift_light_config_profile', {
          configId: learnerVariantId,
          profile
        })
        return true
      }).then(saved => {
        const current = retryStates?.get(gear)
        if (!current || current.profile !== profile) return
        current.inFlight = false
        if (saved && pendingProfiles.get(gear) === profile) {
          pendingProfiles.delete(gear)
          retryStates.delete(gear)
          return
        }
        flushPendingProfiles(expectedLearner, generation)
      }).catch(() => {
        const current = retryStates?.get(gear)
        if (!current || current.profile !== profile) return
        current.inFlight = false
        current.attempts += 1
        const delay = Math.min(
          PROFILE_RETRY_MAX_MS,
          PROFILE_RETRY_BASE_MS * (2 ** Math.min(current.attempts - 1, 4))
        )
        current.nextAt = Date.now() + delay
        publishPersistenceError(new Error('Unable to save Shift Light calibration to the database'))
        const timer = setTimeout(() => flushPendingProfiles(expectedLearner, generation), delay)
        timer.unref?.()
      })
    }
  }

  function persistProfile(profile, expectedLearner) {
    if (!profile || expectedLearner !== learner || expectedLearner === resettingLearner) return
    let pendingProfiles = pendingProfilesByLearner.get(expectedLearner)
    if (!pendingProfiles) {
      pendingProfiles = new Map()
      pendingProfilesByLearner.set(expectedLearner, pendingProfiles)
    }
    let retryStates = profileRetryStateByLearner.get(expectedLearner)
    if (!retryStates) {
      retryStates = new Map()
      profileRetryStateByLearner.set(expectedLearner, retryStates)
    }
    const retry = retryStates.get(profile.gear)
    if (!retry) {
      retryStates.set(profile.gear, {
        attempts: 0,
        nextAt: 0,
        inFlight: false,
        profile
      })
    }
    pendingProfiles.set(profile.gear, profile)
    profileGenerationByLearner.get(expectedLearner).latestProfiles.set(profile.gear, profile)
    flushPendingProfiles(expectedLearner)
  }

  function publishPersistenceError(error) {
    const message = error?.message || String(error || 'Unable to persist Shift Light learning state')
    latestState = { ...latestState, persistenceError: message }
    emit('hud_shift_light', latestState)
  }

  function flushLearningState(expectedLearner) {
    const state = pendingLearningStateByLearner.get(expectedLearner)
    const configId = variantIdsByLearner.get(expectedLearner)
    if (!state || !configId || expectedLearner !== learner || expectedLearner === resettingLearner) return
    pendingLearningStateByLearner.delete(expectedLearner)
    enqueueProfileMutation(() => invokeCommand('save_shift_light_learning_state', {
      key: currentKey,
      configId,
      state
    })).catch(error => {
      // Keep the last accepted state for a later retry, but expose the failure
      // to the UI instead of silently losing learning progress.
      pendingLearningStateByLearner.set(expectedLearner, state)
      publishPersistenceError(error)
      const retry = learningStateRetryByLearner.get(expectedLearner) || { attempts: 0 }
      retry.attempts += 1
      learningStateRetryByLearner.set(expectedLearner, retry)
      const delay = Math.min(4000, 250 * (2 ** Math.min(retry.attempts - 1, 4)))
      const timer = setTimeout(() => flushLearningState(expectedLearner), delay)
      timer.unref?.()
    }).then(() => {
      learningStateRetryByLearner.delete(expectedLearner)
    })
  }

  function persistLearningState(state, expectedLearner) {
    if (!state || typeof state !== 'object' || expectedLearner !== learner || expectedLearner === resettingLearner) return
    pendingLearningStateByLearner.set(expectedLearner, state)
    flushLearningState(expectedLearner)
  }

  function createLearner(key) {
    let generation = profileGenerationByKey.get(key)
    if (!generation) {
      generation = { key, latestProfiles: new Map() }
      profileGenerationByKey.set(key, generation)
    }
    const localLearner = new globalScope.HudShiftLight.ShiftLightLearner(key, {
      // The new learner state is the only persistence contract. Legacy
      // profile callbacks are intentionally not wired: they would recreate
      // the removed Observed/Optimal storage alongside the new state.
      onLearningState: state => persistLearningState(state, localLearner),
      onGearboxChanged: signature => clearConfiguration(localLearner, signature)
    })
    learner = localLearner
    currentKey = key
    variantIdsByLearner.set(localLearner, null)
    pendingProfilesByLearner.set(localLearner, new Map())
    profileRetryStateByLearner.set(localLearner, new Map())
    pendingLearningStateByLearner.set(localLearner, null)
    learningStateRetryByLearner.set(localLearner, { attempts: 0 })
    profileGenerationByLearner.set(localLearner, generation)
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
      const learningState = await invokeCommand('load_shift_light_learning_state', {
        key, configId: resolution.variantId
      })
      if (expectedLearner !== learner || key !== currentKey) return
      if (learningState !== null && (typeof learningState !== 'object' || Array.isArray(learningState))) {
        throw new Error('Invalid Shift Light learning state')
      }
      variantIdsByLearner.set(expectedLearner, resolution.variantId)
      if (requestedLoadGeneration !== loadGeneration || expectedLearner === resettingLearner) return
      if (learningState) {
        // Telemetry may arrive while the async configuration lookup is in
        // flight. Join those completed facts rather than replacing either
        // the live start of the pull or the persisted calibration.
        if (typeof expectedLearner.mergeLearningState === 'function') {
          expectedLearner.mergeLearningState(learningState)
        } else if (typeof expectedLearner.importLearningState === 'function') {
          expectedLearner.importLearningState(learningState)
        }
      }
      publish(expectedLearner.snapshot(latestTelemetry))
      flushPendingProfiles(expectedLearner)
      flushLearningState(expectedLearner)
    })
      .catch(() => {
        // Keep live evidence and retry storage without recreating the learner.
        retryAfterByLearner.set(expectedLearner, Date.now() + 1000)
        publishPersistenceError(new Error('Unable to load Shift Light calibration from the database'))
      })
      .finally(() => resolvingLearners.delete(expectedLearner))
  }

  function clearConfiguration(expectedLearner, signature) {
    const configId = variantIdsByLearner.get(expectedLearner)
    if (!configId) return
    enqueueProfileMutation(() => invokeCommand('clear_shift_light_config', {
      configId,
      gearboxSignature: signature
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
    resolveConfiguration(key, learner, state.observedGearCount)
    flushPendingProfiles(learner)
    flushLearningState(learner)
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
        const nextGeneration = { key, latestProfiles: new Map() }
        profileGenerationByKey.set(key, nextGeneration)
        profileGenerationByLearner.set(currentLearner, nextGeneration)
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
    pendingLearningStateByLearner.delete(currentLearner)
    profileRetryStateByLearner.get(currentLearner)?.clear()
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
