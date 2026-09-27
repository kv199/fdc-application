(function (globalScope, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DriverAnalysisDrives = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict'

  // A race starts from a clean clock, like an Events run start.
  const START_MAX_S = 2
  const START_MAX_DISTANCE_M = 25
  // A lap boundary counts as a circuit lap only when the race goes on past it; otherwise it is the finish line.
  const LAP_CONFIRM_DISTANCE_M = 100
  // Travelled distance falling back by more than this ends the race unless it is an in-race rewind.
  const DISTANCE_RESET_M = 100

  function finite(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function isCleanStart(telemetry) {
    if (telemetry?.isRaceOn !== true) return false
    const current = finite(telemetry?.lap?.current)
    const raceTime = finite(telemetry?.lap?.raceTime)
    const distance = finite(telemetry?.lap?.distance)
    return current !== null && current <= START_MAX_S
      && (raceTime === null || raceTime <= START_MAX_S)
      && (distance === null || distance <= START_MAX_DISTANCE_M)
  }

  function lastLapValue(telemetry) {
    const value = finite(telemetry?.lap?.last)
    return value !== null && value > 0 ? value : null
  }

  // Some sprint results clear the race clock, Last Lap, and distance instead of reporting the result, like in Events.
  function isZeroedResultPacket(telemetry) {
    if (telemetry?.isRaceOn === true) return false
    const current = finite(telemetry?.lap?.current)
    const raceTime = finite(telemetry?.lap?.raceTime)
    const distance = finite(telemetry?.lap?.distance)
    const lastLap = lastLapValue(telemetry)
    return current === 0 && raceTime === 0 && lastLap === null && distance === 0
  }

  // Splits one car's telemetry into races. Every packet is passed in, live or not; `persisted` is the saved sample
  // ({ sequence, timestampMs }) for packets that were stored, so a drive maps onto a contiguous sample range.
  function createDriveSegmenter(options = {}) {
    const now = typeof options.now === 'function' ? options.now : () => Date.now()
    const drives = []
    let active = null

    function open(telemetry) {
      const distance = finite(telemetry?.lap?.distance) ?? 0
      active = {
        startedWallMs: Math.max(0, Math.round(Number(now()) || 0)),
        startDistance: distance,
        lastDistance: distance,
        lastLapNumber: finite(telemetry?.lap?.number),
        lastLapValue: lastLapValue(telemetry),
        confirmedLaps: 0,
        pendingBoundaryDistance: null,
        finishLine: false,
        lastLiveCurrent: null,
        lastLiveRaceTime: null,
        zeroedExit: false,
        pendingSprintCurrent: null,
        firstSequence: null,
        lastSequence: null,
        startedAtMs: null,
        finishedAtMs: null
      }
    }

    function close() {
      const drive = active
      active = null
      if (!drive || drive.firstSequence === null) return
      const kind = drive.confirmedLaps > 0 ? 'circuit' : 'sprint'
      const finished = drive.finishLine || drive.pendingBoundaryDistance !== null || (kind === 'sprint' && drive.zeroedExit)
      drives.push({
        kind,
        finished,
        lapCount: kind === 'circuit' ? drive.confirmedLaps + (finished ? 1 : 0) : null,
        firstSequence: drive.firstSequence,
        lastSequence: drive.lastSequence,
        startedAtMs: drive.startedAtMs,
        finishedAtMs: drive.finishedAtMs,
        startedWallMs: drive.startedWallMs,
        distanceM: Math.max(0, Math.round((drive.lastDistance - drive.startDistance) * 10) / 10)
      })
    }

    // A boundary seen while racing may be a circuit lap; one seen on the non-live result packets is the finish line.
    function noteBoundary(telemetry, live) {
      const lapNumber = finite(telemetry?.lap?.number)
      const lap = lastLapValue(telemetry)
      // While racing only a higher lap number is trusted; a new Last Lap alone can be a stale value from an earlier race.
      const boundary = (lapNumber !== null && active.lastLapNumber !== null && lapNumber > active.lastLapNumber)
        || (!live && lap !== null && lap !== active.lastLapValue)
      if (lapNumber !== null) active.lastLapNumber = lapNumber
      if (lap !== null) active.lastLapValue = lap
      if (!boundary) return
      if (!live) active.finishLine = true
      else if (active.pendingBoundaryDistance === null) active.pendingBoundaryDistance = active.lastDistance
    }

    function update(telemetry, persisted = null) {
      if (!telemetry || typeof telemetry !== 'object') return
      const live = telemetry.isRaceOn === true
      if (isCleanStart(telemetry)) {
        const progressed = active && (active.lastDistance - active.startDistance > START_MAX_DISTANCE_M || active.confirmedLaps > 0)
        if (progressed) close()
        if (!active) open(telemetry)
      }
      if (!active) return
      if (!live) {
        noteBoundary(telemetry, false)
        const sprintSoFar = active.confirmedLaps === 0 && active.pendingBoundaryDistance === null
        const progressed = active.lastDistance - active.startDistance > START_MAX_DISTANCE_M
        const zeroed = isZeroedResultPacket(telemetry)
        if (zeroed && progressed && sprintSoFar) active.zeroedExit = true
        // A non-live Current Lap past the last live value confirms a sprint finish once it repeats.
        if (sprintSoFar && !zeroed) {
          const current = finite(telemetry?.lap?.current)
          const ordinal = finite(telemetry?.car?.ordinal)
          if (current !== null && ordinal !== null && ordinal > 0 && active.lastLiveCurrent !== null && current > active.lastLiveCurrent) {
            if (current === active.pendingSprintCurrent) {
              active.finishLine = true
            } else {
              active.pendingSprintCurrent = current
            }
          } else {
            active.pendingSprintCurrent = null
          }
        } else {
          active.pendingSprintCurrent = null
        }
        return
      }
      // Driving on after the finish line is no longer part of the race.
      if (active.finishLine) {
        close()
        return
      }
      // After a zeroed result only a continuing race clock and distance keep the drive going.
      if (active.zeroedExit) {
        const raceTime = finite(telemetry?.lap?.raceTime)
        const distance = finite(telemetry?.lap?.distance)
        const continues = raceTime !== null && raceTime >= active.lastLiveRaceTime - 1
          && distance !== null && distance >= active.lastDistance - DISTANCE_RESET_M
        if (continues) {
          active.zeroedExit = false
        } else {
          close()
          return
        }
      }
      active.pendingSprintCurrent = null
      const distance = finite(telemetry?.lap?.distance)
      const lapNumber = finite(telemetry?.lap?.number)
      if (distance !== null && distance < active.lastDistance - DISTANCE_RESET_M) {
        const current = finite(telemetry?.lap?.current)
        const raceOver = (lapNumber !== null && active.lastLapNumber !== null && lapNumber !== active.lastLapNumber)
          || (current !== null && current < 1)
        if (raceOver) {
          close()
          return
        }
        // In-race rewind: continue from the rewound position and forget a boundary that was rewound past.
        active.lastDistance = distance
        if (active.pendingBoundaryDistance !== null && distance < active.pendingBoundaryDistance) active.pendingBoundaryDistance = null
        if (lapNumber !== null) active.lastLapNumber = lapNumber
      } else if (distance !== null) {
        active.lastDistance = Math.max(active.lastDistance, distance)
      }
      const current = finite(telemetry?.lap?.current)
      const raceTime = finite(telemetry?.lap?.raceTime)
      if (current !== null) active.lastLiveCurrent = current
      if (raceTime !== null) active.lastLiveRaceTime = raceTime
      noteBoundary(telemetry, true)
      if (active.pendingBoundaryDistance !== null && active.lastDistance >= active.pendingBoundaryDistance + LAP_CONFIRM_DISTANCE_M) {
        active.confirmedLaps += 1
        active.pendingBoundaryDistance = null
      }
      if (persisted) {
        if (active.firstSequence === null) {
          active.firstSequence = persisted.sequence
          active.startedAtMs = persisted.timestampMs
        }
        active.lastSequence = persisted.sequence
        active.finishedAtMs = persisted.timestampMs
      }
    }

    // Closes the race in progress and returns every drive of this car in order.
    function finalize() {
      close()
      return drives.map(drive => ({ ...drive }))
    }

    return { finalize, update }
  }

  return { createDriveSegmenter, isCleanStart, isZeroedResultPacket }
}))
