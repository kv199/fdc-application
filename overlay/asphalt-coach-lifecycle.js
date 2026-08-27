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

  function telemetryRestarted(previousTelemetry, telemetry) {
    const previousRaceTimeS = finite(previousTelemetry?.lap?.raceTime)
    const currentRaceTimeS = finite(telemetry?.lap?.raceTime)
    const previousLapNumber = finite(previousTelemetry?.lap?.number)
    const currentLapNumber = finite(telemetry?.lap?.number)
    const previousDistanceM = finite(previousTelemetry?.lap?.distance)
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

  function resolveAttemptRestart({ previousTelemetry, previousTimingState, telemetry } = {}) {
    if (telemetry?.isRaceOn !== true) return false
    const timingBaseline = {
      lap: {
        raceTime: previousTimingState?.lastRaceTimeS,
        number: previousTimingState?.lastLapNumber,
        distance: previousTimingState?.lastDistanceM
      }
    }
    return telemetryRestarted(previousTelemetry, telemetry)
      || telemetryRestarted(timingBaseline, telemetry)
  }

  function canSummarizeAttempt(timingState) {
    return timingState?.phase === 'live'
      && timingState?.attemptStartValid === true
      && finite(timingState?.lastLiveCurrentTimeMs) !== null
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
    const completedResultStopped = wasComplete
      && isComplete
      && telemetry?.isRaceOn !== true
    const liveAttemptStopped = previousPhase === 'live'
      && currentPhase === 'paused'
      && canSummarizeAttempt(previousTimingState)
      && telemetry?.isRaceOn !== true

    if (isComplete && !wasComplete && (telemetry?.isRaceOn !== true || !lapAdvanced)) return 'brief'
    if (completedResultStopped) return 'brief'
    if (liveAttemptStopped) return 'run_check'
    if (lapAdvanced) return 'lap_boundary'
    return 'none'
  }

  return { canSummarizeAttempt, resolveAttemptRestart, resolveLapAction }
}))
