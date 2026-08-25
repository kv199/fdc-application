(function (globalScope, factory) {
  const api = factory()

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.AsphaltCoachLifecycle = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function finite(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function resolveLapAction({ previousTimingState, timingState, previousLapNumber, telemetry } = {}) {
    const previousPhase = previousTimingState?.phase
    const currentPhase = timingState?.phase
    const wasComplete = previousPhase === 'circuit_complete' || previousPhase === 'sprint_complete'
    const isComplete = currentPhase === 'circuit_complete' || currentPhase === 'sprint_complete'
    const currentLapNumber = finite(telemetry?.lap?.number)
    const previousLap = finite(previousLapNumber)
    const lapAdvanced = previousLap !== null
      && currentLapNumber !== null
      && currentLapNumber > previousLap
    const nextAttemptStarted = wasComplete && currentPhase === 'live' && telemetry?.isRaceOn === true

    if (isComplete && !wasComplete && telemetry?.isRaceOn !== true) return 'brief'
    if (lapAdvanced) return 'lap_boundary'
    if (nextAttemptStarted) return 'begin_attempt'
    return 'none'
  }

  return { resolveLapAction }
}))
