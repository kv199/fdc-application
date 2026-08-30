(function (globalScope, factory) {
  const api = factory()

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.HudLapTiming = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const START_MAX_MS = 2000
  const COMPLETE_SOURCES = Object.freeze({
    circuit: 'forza_lap_last',
    sprint: 'forza_lap_current'
  })

  function finite(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function currentGameTimeMs(telemetry) {
    const current = finite(telemetry?.lap?.current)
    return current !== null && current >= 0 ? current * 1000 : null
  }

  function completedLapTimeMs(telemetry) {
    const last = finite(telemetry?.lap?.last)
    return last !== null && last > 0 ? Math.round(last * 1000) : null
  }

  function createState(overrides = {}) {
    return {
      phase: 'idle',
      lapNumber: null,
      currentTimeMs: null,
      finalTimeMs: null,
      finalTimeSource: null,
      attemptStartValid: false,
      lastRaceTimeS: null,
      lastLapNumber: null,
      lastDistanceM: null,
      lastLiveCurrentTimeMs: null,
      lastObservedLapTimeMs: null,
      lastCompletedLapTimeMs: null,
      pendingLapBoundary: false,
      pendingLapNumber: null,
      pendingSprintTimeMs: null,
      ...overrides
    }
  }

  function isRestart(state, telemetry) {
    const previousRaceTimeS = finite(state.lastRaceTimeS)
    const currentRaceTimeS = finite(telemetry?.lap?.raceTime)
    const previousLapNumber = finite(state.lastLapNumber)
    const currentLapNumber = finite(telemetry?.lap?.number)
    const previousDistanceM = finite(state.lastDistanceM)
    const currentDistanceM = finite(telemetry?.lap?.distance)
    if (
      previousRaceTimeS === null
      || currentRaceTimeS === null
      || previousLapNumber === null
      || currentLapNumber === null
    ) return false

    const clockWentBack = currentRaceTimeS + 5 < previousRaceTimeS
    const lapWentBack = currentLapNumber < previousLapNumber
    const distanceWentBack = previousDistanceM !== null
      && currentDistanceM !== null
      && currentDistanceM + 100 < previousDistanceM
    return clockWentBack && (lapWentBack || distanceWentBack)
  }

  function remember(state, telemetry, overrides = {}) {
    const raceTimeS = finite(telemetry?.lap?.raceTime)
    const lapNumber = finite(telemetry?.lap?.number)
    const distanceM = finite(telemetry?.lap?.distance)
    const live = telemetry?.isRaceOn === true
    const currentTimeMs = currentGameTimeMs(telemetry)
    const observedLapTimeMs = completedLapTimeMs(telemetry)
    return {
      ...state,
      lastRaceTimeS: live && raceTimeS !== null ? raceTimeS : state.lastRaceTimeS,
      lastLapNumber: live && lapNumber !== null ? lapNumber : state.lastLapNumber,
      lastDistanceM: live && distanceM !== null ? distanceM : state.lastDistanceM,
      lastLiveCurrentTimeMs: live && currentTimeMs !== null
        ? currentTimeMs
        : state.lastLiveCurrentTimeMs,
      lastObservedLapTimeMs: observedLapTimeMs !== null
        ? observedLapTimeMs
        : state.lastObservedLapTimeMs,
      ...overrides
    }
  }

  function hasLapBoundary(state, telemetry) {
    const previousLapNumber = finite(state.lastLapNumber)
    const currentLapNumber = finite(telemetry?.lap?.number)
    return previousLapNumber !== null
      && currentLapNumber !== null
      && currentLapNumber > previousLapNumber
  }

  function canCompleteCircuit(state, telemetry, completedTimeMs) {
    if (!state.attemptStartValid || completedTimeMs === null) return false
    const currentLapNumber = finite(telemetry?.lap?.number)
    const boundary = hasLapBoundary(state, telemetry)
    const delayedBoundary = state.pendingLapBoundary
      && currentLapNumber !== null
      && currentLapNumber === state.pendingLapNumber
    if (
      state.lastCompletedLapTimeMs !== null
      && completedTimeMs === state.lastCompletedLapTimeMs
      && !boundary
      && !delayedBoundary
    ) return false

    const newLastLap = completedTimeMs !== state.lastObservedLapTimeMs
    const progressedBeforeLastLap = state.lastLiveCurrentTimeMs !== null
      && state.lastLiveCurrentTimeMs > START_MAX_MS
    return boundary
      || delayedBoundary
      || (telemetry?.isRaceOn === true && newLastLap && progressedBeforeLastLap)
  }

  function strongSprintLastCandidate(state, telemetry, completedTimeMs, circuitComplete) {
    if (
      telemetry?.isRaceOn === true
      || circuitComplete
      || !state.attemptStartValid
      || state.lastLiveCurrentTimeMs === null
      || hasLapBoundary(state, telemetry)
      || state.pendingLapBoundary
      || completedTimeMs === null
      || completedTimeMs < state.lastLiveCurrentTimeMs
      || completedTimeMs === state.lastObservedLapTimeMs
    ) return null

    return completedTimeMs
  }

  function advancingSprintCurrentCandidate(state, telemetry, currentTimeMs, completedTimeMs, circuitComplete) {
    if (
      telemetry?.isRaceOn === true
      || circuitComplete
      || !state.attemptStartValid
      || currentTimeMs === null
      || state.lastLiveCurrentTimeMs === null
      || currentTimeMs <= state.lastLiveCurrentTimeMs
      || finite(telemetry?.car?.ordinal) === null
      || finite(telemetry?.car?.ordinal) <= 0
      || hasLapBoundary(state, telemetry)
      || state.pendingLapBoundary
    ) return null

    return currentTimeMs
  }

  function isConfirmedSprintCurrent(state, currentTimeMs) {
    return currentTimeMs !== null
      && state.pendingSprintTimeMs !== null
      && currentTimeMs === state.pendingSprintTimeMs
  }

  function update(state, telemetry) {
    const current = state && typeof state === 'object' ? state : createState()
    if (!telemetry || typeof telemetry !== 'object') return current

    const currentTimeMs = currentGameTimeMs(telemetry)
    const completedTimeMs = completedLapTimeMs(telemetry)
    if (telemetry.isRaceOn === true && isRestart(current, telemetry)) {
      return remember(createState({
        phase: telemetry.isRaceOn === true ? 'live' : 'restart',
        lapNumber: finite(telemetry?.lap?.number),
        currentTimeMs: telemetry.isRaceOn === true ? currentTimeMs : null,
        attemptStartValid: telemetry.isRaceOn === true && currentTimeMs !== null && currentTimeMs <= START_MAX_MS,
        lastObservedLapTimeMs: current.lastObservedLapTimeMs,
        lastCompletedLapTimeMs: current.lastCompletedLapTimeMs,
        pendingLapBoundary: false,
        pendingLapNumber: null,
        pendingSprintTimeMs: null
      }), telemetry)
    }

    const lapBoundary = hasLapBoundary(current, telemetry)
    const circuitComplete = canCompleteCircuit(current, telemetry, completedTimeMs)

    if (telemetry.isRaceOn !== true) {
      if (circuitComplete) {
        return remember(current, telemetry, {
          phase: 'circuit_complete',
          currentTimeMs: completedTimeMs,
          finalTimeMs: completedTimeMs,
          finalTimeSource: COMPLETE_SOURCES.circuit,
          lastCompletedLapTimeMs: completedTimeMs,
          pendingLapBoundary: false,
          pendingLapNumber: null
        })
      }
      const strongLastTimeMs = strongSprintLastCandidate(
        current,
        telemetry,
        completedTimeMs,
        circuitComplete
      )
      if (strongLastTimeMs !== null) {
        return remember(current, telemetry, {
          phase: 'sprint_complete',
          currentTimeMs: strongLastTimeMs,
          finalTimeMs: strongLastTimeMs,
          finalTimeSource: COMPLETE_SOURCES.circuit,
          pendingSprintTimeMs: null
        })
      }
      const advancingCurrentTimeMs = advancingSprintCurrentCandidate(
        current,
        telemetry,
        currentTimeMs,
        completedTimeMs,
        circuitComplete
      )
      if (advancingCurrentTimeMs !== null) {
        if (isConfirmedSprintCurrent(current, advancingCurrentTimeMs)) {
          return remember(current, telemetry, {
            phase: 'sprint_complete',
            currentTimeMs: advancingCurrentTimeMs,
            finalTimeMs: advancingCurrentTimeMs,
            finalTimeSource: COMPLETE_SOURCES.sprint,
            pendingSprintTimeMs: null
          })
        }
        return remember(current, telemetry, {
          phase: current.finalTimeMs !== null ? current.phase : 'paused',
          pendingSprintTimeMs: advancingCurrentTimeMs
        })
      }
      if (lapBoundary && completedTimeMs === null) {
        return remember(current, telemetry, {
          phase: current.finalTimeMs !== null ? current.phase : 'paused',
          pendingLapBoundary: true,
          pendingLapNumber: finite(telemetry?.lap?.number),
          pendingSprintTimeMs: null
        })
      }
      return remember(current, telemetry, {
        phase: current.finalTimeMs !== null ? current.phase : current.phase === 'idle' ? 'idle' : 'paused',
        pendingSprintTimeMs: null
      })
    }

    const startsNextAttempt = (
      current.phase === 'circuit_complete'
      || current.phase === 'sprint_complete'
      || current.phase === 'restart'
    ) && currentTimeMs !== null && currentTimeMs <= START_MAX_MS
    if (startsNextAttempt) {
      return remember(createState({
        phase: 'live',
        lapNumber: finite(telemetry?.lap?.number),
        currentTimeMs,
        attemptStartValid: true,
        lastCompletedLapTimeMs: current.lastCompletedLapTimeMs,
        pendingLapBoundary: false,
        pendingLapNumber: null,
        pendingSprintTimeMs: null
      }), telemetry)
    }

    const resumedAfterFalseSprintFinish = current.phase === 'sprint_complete'
      && currentTimeMs !== null
      && current.finalTimeMs !== null
      && currentTimeMs > current.finalTimeMs
    if (resumedAfterFalseSprintFinish) {
      return remember(current, telemetry, {
        phase: 'live',
        currentTimeMs,
        finalTimeMs: null,
        finalTimeSource: null,
        pendingSprintTimeMs: null
      })
    }

    if (circuitComplete) {
      return remember(current, telemetry, {
        phase: 'circuit_complete',
        currentTimeMs: completedTimeMs,
        finalTimeMs: completedTimeMs,
        finalTimeSource: COMPLETE_SOURCES.circuit,
        lastCompletedLapTimeMs: completedTimeMs,
        pendingLapBoundary: false,
        pendingLapNumber: null,
        pendingSprintTimeMs: null
      })
    }

    if (lapBoundary && completedTimeMs === null) {
      return remember(current, telemetry, {
        pendingLapBoundary: true,
        pendingLapNumber: finite(telemetry?.lap?.number),
        pendingSprintTimeMs: null
      })
    }

    if (current.phase === 'circuit_complete' || current.phase === 'sprint_complete') {
      return remember(current, telemetry)
    }

    return remember(current, telemetry, {
      phase: 'live',
      currentTimeMs: currentTimeMs === null ? current.currentTimeMs : currentTimeMs,
      attemptStartValid: current.attemptStartValid || (currentTimeMs !== null && currentTimeMs <= START_MAX_MS),
      pendingSprintTimeMs: null
    })
  }

  function resetForRestart() {
    return createState()
  }

  function displayTimeMs(state) {
    return finite(state?.finalTimeMs) ?? finite(state?.currentTimeMs)
  }

  return {
    COMPLETE_SOURCES,
    START_MAX_MS,
    createState,
    currentGameTimeMs,
    displayTimeMs,
    resetForRestart,
    update
  }
}))
