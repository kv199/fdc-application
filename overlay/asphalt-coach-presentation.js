(function (globalScope, factory) {
  const api = factory()

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.AsphaltCoachPresentation = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const DEFAULT_THRESHOLDS = Object.freeze({
    cueDurationMs: 1800,
    cooldownMs: 4200,
    briefDurationMs: 25000,
    cueMinConfidence: 0.84
  })

  const CUE_PRIORITY = Object.freeze([
    'abrupt_brake_release',
    'brake_steering_overload',
    'front_scrub',
    'exit_wheelspin',
    'controlled_release',
    'clean_exit'
  ])

  const CUE_META = Object.freeze({
    front_scrub: Object.freeze({
      code: 'ASPHALT',
      label: 'FRONT SCRUB',
      instruction: 'Reduce steering · let the front recover'
    }),
    exit_wheelspin: Object.freeze({
      code: 'ASPHALT',
      label: 'EXIT WHEELSPIN',
      instruction: 'Build throttle after the car is settled'
    }),
    brake_steering_overload: Object.freeze({
      code: 'ASPHALT',
      label: 'BRAKE + STEERING OVERLOAD',
      instruction: 'Release brake · let the front recover'
    }),
    abrupt_brake_release: Object.freeze({
      code: 'ASPHALT',
      label: 'ABRUPT BRAKE RELEASE',
      instruction: 'Release brake smoothly · keep the car settled'
    }),
    clean_exit: Object.freeze({
      code: 'ASPHALT',
      label: 'CLEAN EXIT',
      instruction: 'Keep the throttle build · clean exit'
    }),
    controlled_release: Object.freeze({
      code: 'ASPHALT',
      label: 'CONTROLLED RELEASE',
      instruction: 'Keep the brake release smooth'
    })
  })

  const NEXT_RUN_INSTRUCTIONS = Object.freeze({
    front_scrub: 'Reduce steering · let the front recover',
    exit_wheelspin: 'Build throttle after the car is settled',
    brake_steering_overload: 'Release brake as steering builds',
    abrupt_brake_release: 'Release brake smoothly through rotation',
    clean_exit: 'Keep the clean throttle build',
    controlled_release: 'Keep the brake release smooth'
  })

  function priority(kind) {
    const index = CUE_PRIORITY.indexOf(kind)
    return index === -1 ? CUE_PRIORITY.length : index
  }

  function metaFor(kind) {
    return CUE_META[kind] || {
      code: 'C0',
      label: 'TECHNIQUE',
      instruction: 'Keep the car settled'
    }
  }

  function createEmptyView(readiness = 'calibrating') {
    return {
      mode: 'none',
      readiness,
      cue: null,
      brief: null,
      focus: null
    }
  }

  function strongestKind(counts, candidates) {
    let selected = null
    let selectedCount = 0
    for (const kind of candidates) {
      const count = Number(counts?.[kind]) || 0
      if (count > selectedCount || (count === selectedCount && count > 0 && priority(kind) < priority(selected))) {
        selected = kind
        selectedCount = count
      }
    }
    return selected === null ? null : { kind: selected, count: selectedCount }
  }

  function buildDriverBrief(summary, options = {}) {
    const counts = summary?.counts || {}
    const recurring = strongestKind(counts, [
      'front_scrub',
      'exit_wheelspin',
      'brake_steering_overload',
      'abrupt_brake_release'
    ])
    const strength = strongestKind(counts, ['clean_exit', 'controlled_release'])
    const mainKind = recurring?.kind || null
    const strengthKind = strength?.kind || null
    const mainCount = recurring?.count || 0
    const strengthCount = strength?.count || 0

    return {
      title: options.title || 'DRIVER BRIEF · ASPHALT',
      mainHeading: options.mainHeading || 'MAIN HABIT',
      strengthHeading: options.strengthHeading || 'STRONG',
      nextHeading: options.nextHeading || 'NEXT RUN',
      mainKind,
      mainLabel: mainKind ? metaFor(mainKind).label : '',
      mainEvidenceCount: mainCount,
      mainText: recurring
        ? `${metaFor(mainKind).label} · ${mainCount} EVIDENCE`
        : 'NO RECURRING NEGATIVE PATTERN YET',
      strengthKind,
      strengthLabel: strengthKind ? metaFor(strengthKind).label : '',
      strengthEvidenceCount: strengthCount,
      strengthText: strength
        ? `${metaFor(strengthKind).label} · ${strengthCount} EVIDENCE`
        : 'NO POSITIVE EVIDENCE YET',
      nextFocus: mainKind,
      nextText: mainKind
        ? NEXT_RUN_INSTRUCTIONS[mainKind]
        : 'Collect more evidence before changing technique'
    }
  }

  class AsphaltCoachPresentation {
    constructor(options = {}) {
      this.thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) }
      this.reset()
    }

    reset() {
      this.focus = null
      this.activeCue = null
      this.activeBrief = null
      this.cooldownUntilMs = 0
      this.lastView = createEmptyView()
      return this.lastView
    }

    resetTransient(readiness = 'calibrating') {
      this.activeCue = null
      this.activeBrief = null
      this.cooldownUntilMs = 0
      this.lastView = createEmptyView(readiness)
      this.lastView.focus = this.focus
      return this.lastView
    }

    beginAttempt() {
      this.activeCue = null
      this.activeBrief = null
      this.cooldownUntilMs = 0
      this.lastView = createEmptyView('calibrating')
      this.lastView.focus = this.focus
      return this.lastView
    }

    dismissInterimBrief(readiness = 'ready') {
      if (this.activeBrief?.dismissOnResume !== true) return this.lastView
      this.activeBrief = null
      this.lastView = createEmptyView(readiness)
      this.lastView.focus = this.focus
      return this.lastView
    }

    showBrief(summary, timestampMs, options = {}) {
      const brief = buildDriverBrief(summary, options)
      this.focus = brief.nextFocus
      this.activeCue = null
      this.activeBrief = {
        ...brief,
        dismissOnResume: options.dismissOnResume === true,
        expiresAtMs: timestampMs + this.thresholds.briefDurationMs
      }
      this.cooldownUntilMs = 0
      this.lastView = {
        mode: 'brief',
        readiness: 'ready',
        cue: null,
        brief,
        focus: this.focus
      }
      return this.lastView
    }

    update(result, timestampMs = 0) {
      const now = Number.isFinite(Number(timestampMs)) ? Number(timestampMs) : 0
      const readiness = result?.calibration?.ready === true ? 'ready' : 'calibrating'

      if (this.activeBrief !== null) {
        if (now < this.activeBrief.expiresAtMs) {
          this.lastView = {
            mode: 'brief',
            readiness: 'ready',
            cue: null,
            brief: { ...this.activeBrief, expiresAtMs: undefined },
            focus: this.focus
          }
          return this.lastView
        }
        this.activeBrief = null
      }

      if (this.activeCue !== null) {
        if (now < this.activeCue.expiresAtMs) {
          this.lastView = {
            mode: 'cue',
            readiness,
            cue: { ...this.activeCue, expiresAtMs: undefined },
            brief: null,
            focus: this.focus
          }
          return this.lastView
        }
        this.activeCue = null
      }

      if (result?.valid !== true || readiness !== 'ready') {
        this.lastView = createEmptyView(readiness)
        this.lastView.focus = this.focus
        return this.lastView
      }

      if (now < this.cooldownUntilMs) {
        this.lastView = createEmptyView(readiness)
        this.lastView.focus = this.focus
        return this.lastView
      }

      const events = Array.isArray(result.events) ? result.events : []
      const eligible = events
        .filter(event => Number(event.confidence) >= this.thresholds.cueMinConfidence)
        .sort((left, right) => {
          const leftFocus = left.kind === this.focus ? -1 : 0
          const rightFocus = right.kind === this.focus ? -1 : 0
          return leftFocus - rightFocus || priority(left.kind) - priority(right.kind)
        })
      const event = eligible[0]
      if (!event) {
        this.lastView = createEmptyView(readiness)
        this.lastView.focus = this.focus
        return this.lastView
      }

      const meta = metaFor(event.kind)
      this.activeCue = {
        ...event,
        ...meta,
        expiresAtMs: now + this.thresholds.cueDurationMs
      }
      this.cooldownUntilMs = now + this.thresholds.cooldownMs
      this.lastView = {
        mode: 'cue',
        readiness,
        cue: { ...this.activeCue, expiresAtMs: undefined },
        brief: null,
        focus: this.focus
      }
      return this.lastView
    }

    getView(timestampMs = 0) {
      return this.update({
        valid: this.lastView.mode !== 'none',
        events: [],
        calibration: { ready: this.lastView.readiness === 'ready' }
      }, timestampMs)
    }
  }

  return {
    CUE_META,
    CUE_PRIORITY,
    DEFAULT_THRESHOLDS,
    AsphaltCoachPresentation,
    buildDriverBrief,
    createEmptyView,
    metaFor
  }
}))
