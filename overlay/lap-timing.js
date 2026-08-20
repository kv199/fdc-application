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
    return {
      ...state,
      lastRaceTimeS: live && raceTimeS !== null ? raceTimeS : state.lastRaceTimeS,
      lastLapNumber: live && lapNumber !== null ? lapNumber : state.lastLapNumber,
      lastDistanceM: live && distanceM !== null ? distanceM : state.lastDistanceM,
      ...overrides
    }
  }

  function update(state, telemetry) {
    const current = state && typeof state === 'object' ? state : createState()
    if (!telemetry || typeof telemetry !== 'object') return current

    const currentTimeMs = currentGameTimeMs(telemetry)
    const completedTimeMs = completedLapTimeMs(telemetry)
    if (isRestart(current, telemetry)) {
      return remember(createState({
        phase: telemetry.isRaceOn === true ? 'live' : 'restart',
        lapNumber: finite(telemetry?.lap?.number),
        currentTimeMs: telemetry.isRaceOn === true ? currentTimeMs : null,
        attemptStartValid: telemetry.isRaceOn === true && currentTimeMs !== null && currentTimeMs <= START_MAX_MS
      }), telemetry)
    }

    if (telemetry.isRaceOn !== true) {
      if (completedTimeMs !== null && current.attemptStartValid) {
        return remember(current, telemetry, {
          phase: 'circuit_complete',
          currentTimeMs: completedTimeMs,
          finalTimeMs: completedTimeMs,
          finalTimeSource: COMPLETE_SOURCES.circuit
        })
      }
      return remember(current, telemetry, {
        phase: current.finalTimeMs !== null ? current.phase : current.phase === 'idle' ? 'idle' : 'paused'
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
        attemptStartValid: true
      }), telemetry)
    }

    if (completedTimeMs !== null && current.attemptStartValid) {
      return remember(current, telemetry, {
        phase: 'circuit_complete',
        currentTimeMs: completedTimeMs,
        finalTimeMs: completedTimeMs,
        finalTimeSource: COMPLETE_SOURCES.circuit
      })
    }

    if (current.phase === 'circuit_complete' || current.phase === 'sprint_complete') {
      return remember(current, telemetry)
    }

    return remember(current, telemetry, {
      phase: 'live',
      currentTimeMs: currentTimeMs === null ? current.currentTimeMs : currentTimeMs,
      attemptStartValid: current.attemptStartValid || (currentTimeMs !== null && currentTimeMs <= START_MAX_MS)
    })
  }

  function complete(state, payload) {
    const timeMs = finite(payload?.lapTimeMs)
    if (timeMs === null || timeMs <= 0) return state
    const timeSource = payload?.timeSource === COMPLETE_SOURCES.sprint
      ? COMPLETE_SOURCES.sprint
      : COMPLETE_SOURCES.circuit
    return {
      ...(state && typeof state === 'object' ? state : createState()),
      phase: timeSource === COMPLETE_SOURCES.sprint ? 'sprint_complete' : 'circuit_complete',
      lapNumber: finite(payload?.lapNumber),
      currentTimeMs: timeMs,
      finalTimeMs: timeMs,
      finalTimeSource: timeSource
    }
  }

  function resetForSourceSwitch() {
    return createState()
  }

  function displayTimeMs(state) {
    return finite(state?.finalTimeMs) ?? finite(state?.currentTimeMs)
  }

  return {
    COMPLETE_SOURCES,
    START_MAX_MS,
    complete,
    createState,
    currentGameTimeMs,
    displayTimeMs,
    resetForSourceSwitch,
    update
  }
}))
