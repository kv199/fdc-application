(function (globalScope, factory) {
  const api = factory()

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DriverCoach = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const PHASES = Object.freeze({
    NEUTRAL: 'NEUTRAL',
    BRAKE: 'BRAKE',
    BLEND: 'BLEND',
    COAST: 'COAST',
    POWER: 'POWER'
  })

  const DEFAULT_THRESHOLDS = Object.freeze({
    pedalOn: 0.05,
    meaningfulBrake: 0.1,
    turnOnSteer: 0.12,
    turnOffSteer: 0.08,
    turnOnSustainMs: 140,
    turnOffSustainMs: 400,
    maxFrameGapMs: 250,
    summaryVisibilityMs: 2500
  })

  function finiteOrNull(value) {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function nonNegativeOrNull(value) {
    const number = finiteOrNull(value)
    return number === null ? null : Math.max(0, number)
  }

  class DriverCoach {
    constructor(options = {}) {
      this.thresholds = {
        ...DEFAULT_THRESHOLDS,
        ...(options.thresholds || {})
      }
      this.reset()
    }

    reset() {
      this.lastTimestampMs = null
      this.phase = PHASES.NEUTRAL
      this.phaseSinceMs = null
      this.turnActive = false
      this.turnOnSinceMs = null
      this.turnOffSinceMs = null
      this.corner = null
      this.summary = null
      this.summaryExpiresAtMs = null
      this.snapshot = this.createSnapshot(null)
      return this.snapshot
    }

    update(frame = {}) {
      if (frame.isRaceOn !== true) return this.reset()

      const timestampMs = finiteOrNull(frame.timestampMs)
      if (timestampMs === null) return this.getSnapshot()

      if (this.lastTimestampMs !== null) {
        const frameGapMs = timestampMs - this.lastTimestampMs
        if (frameGapMs < 0 || frameGapMs > this.thresholds.maxFrameGapMs) {
          this.reset()
        }
      }

      const deltaMs = this.lastTimestampMs === null
        ? 0
        : timestampMs - this.lastTimestampMs
      const speedKmh = nonNegativeOrNull(frame.speedKmh)
      const throttle = Math.max(0, Number(frame.throttle) || 0)
      const brake = Math.max(0, Number(frame.brake) || 0)
      const steer = Number(frame.steer) || 0

      this.expireSummary(timestampMs)

      if (this.corner !== null) {
        this.addPhaseDuration(deltaMs)
        this.updateMinimumSpeed(speedKmh)
      }

      this.updateTurnState(Math.abs(steer), timestampMs, speedKmh)
      this.setPhase(this.classifyPhase(throttle, brake), timestampMs)
      this.lastTimestampMs = timestampMs
      this.snapshot = this.createSnapshot(timestampMs)
      return this.snapshot
    }

    getSnapshot(timestampMs = this.lastTimestampMs) {
      const currentTimestampMs = finiteOrNull(timestampMs)
      if (currentTimestampMs !== null) this.expireSummary(currentTimestampMs)
      return this.createSnapshot(currentTimestampMs)
    }

    classifyPhase(throttle, brake) {
      if (this.turnActive) {
        if (brake >= this.thresholds.meaningfulBrake) return PHASES.BLEND
        if (throttle >= this.thresholds.pedalOn) return PHASES.POWER
        if (throttle < this.thresholds.pedalOn && brake < this.thresholds.pedalOn) {
          return PHASES.COAST
        }
        return PHASES.NEUTRAL
      }

      if (brake >= this.thresholds.meaningfulBrake) return PHASES.BRAKE
      return PHASES.NEUTRAL
    }

    updateTurnState(steerMagnitude, timestampMs, speedKmh) {
      if (!this.turnActive) {
        if (steerMagnitude >= this.thresholds.turnOnSteer) {
          if (this.turnOnSinceMs === null) this.turnOnSinceMs = timestampMs
          if (timestampMs - this.turnOnSinceMs >= this.thresholds.turnOnSustainMs) {
            this.turnActive = true
            this.turnOnSinceMs = null
            this.turnOffSinceMs = null
            this.corner = {
              blendMs: 0,
              coastMs: 0,
              minSpeedKmh: speedKmh
            }
          }
        } else {
          this.turnOnSinceMs = null
        }
        return
      }

      if (steerMagnitude <= this.thresholds.turnOffSteer) {
        if (this.turnOffSinceMs === null) this.turnOffSinceMs = timestampMs
        if (timestampMs - this.turnOffSinceMs >= this.thresholds.turnOffSustainMs) {
          this.finishCorner(timestampMs, speedKmh)
        }
      } else {
        this.turnOffSinceMs = null
      }
    }

    finishCorner(timestampMs, exitSpeedKmh) {
      if (this.corner === null) return

      this.summary = {
        blendMs: this.corner.blendMs,
        coastMs: this.corner.coastMs,
        minSpeedKmh: this.corner.minSpeedKmh,
        exitSpeedKmh
      }
      this.summaryExpiresAtMs = timestampMs + this.thresholds.summaryVisibilityMs
      this.corner = null
      this.turnActive = false
      this.turnOnSinceMs = null
      this.turnOffSinceMs = null
    }

    addPhaseDuration(deltaMs) {
      if (deltaMs <= 0 || this.corner === null) return
      if (this.phase === PHASES.BLEND) this.corner.blendMs += deltaMs
      if (this.phase === PHASES.COAST) this.corner.coastMs += deltaMs
    }

    updateMinimumSpeed(speedKmh) {
      if (this.corner === null || speedKmh === null) return
      if (this.corner.minSpeedKmh === null || speedKmh < this.corner.minSpeedKmh) {
        this.corner.minSpeedKmh = speedKmh
      }
    }

    setPhase(phase, timestampMs) {
      if (phase === this.phase) return
      this.phase = phase
      this.phaseSinceMs = timestampMs
    }

    expireSummary(timestampMs) {
      if (this.summaryExpiresAtMs === null || timestampMs < this.summaryExpiresAtMs) return
      this.summary = null
      this.summaryExpiresAtMs = null
    }

    createSnapshot(timestampMs) {
      const phaseDurationMs = this.phaseSinceMs === null || timestampMs === null
        ? 0
        : Math.max(0, timestampMs - this.phaseSinceMs)

      return {
        timestampMs,
        phase: this.phase,
        phaseDurationMs,
        turnActive: this.turnActive,
        summary: this.summary === null ? null : { ...this.summary }
      }
    }
  }

  return {
    DEFAULT_THRESHOLDS,
    DriverCoach,
    PHASES
  }
}))
