(function (globalScope, factory) {
  const api = factory()

  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.CornerState = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const ACTIVE_PHASES = Object.freeze([
    'between',
    'approach',
    'entry',
    'apex',
    'exit'
  ])

  const CORNER_PHASES = Object.freeze({
    BETWEEN: 'between',
    APPROACH: 'approach',
    ENTRY: 'entry',
    APEX: 'apex',
    EXIT: 'exit'
  })

  function finite(value) {
    if (value === null || value === undefined || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function isFinalCornerExit(previousState, nextState, template) {
    if (String(template?.status || '').toLowerCase() !== 'ready') return false

    const previousCornerIndex = finite(previousState?.cornerIndex)
    const nextCornerIndex = finite(nextState?.cornerIndex)
    if (previousCornerIndex === null || nextCornerIndex !== null) return false
    if (!Array.isArray(template.corners) || template.corners.length === 0) return false

    let lastCornerIndex = null
    for (const corner of template.corners) {
      const cornerIndex = finite(corner?.index)
      if (cornerIndex !== null && (lastCornerIndex === null || cornerIndex > lastCornerIndex)) {
        lastCornerIndex = cornerIndex
      }
    }

    return lastCornerIndex !== null && previousCornerIndex === lastCornerIndex
  }

  function normalizeDirection(direction) {
    const normalized = String(direction || '').toLowerCase()
    if (normalized === 'left') return 'LEFT'
    if (normalized === 'right') return 'RIGHT'
    return null
  }

  function normalizePhase(phase) {
    const normalized = String(phase || '').toLowerCase()
    return ACTIVE_PHASES.includes(normalized) ? normalized : null
  }

  function sameContext(template, state) {
    const templateSessionId = finite(template?.sessionId)
    const stateSessionId = finite(state?.sessionId)
    const templateEventId = finite(template?.eventId)
    const stateEventId = finite(state?.eventId)

    if (templateSessionId !== null && stateSessionId !== null && templateSessionId !== stateSessionId) return false
    if (templateEventId !== null && stateEventId !== null && templateEventId !== stateEventId) return false
    return true
  }

  function emptyReadout() {
    return {
      visible: false,
      identity: '',
      phase: '',
      distance: '',
      phaseClass: 'inactive'
    }
  }

  function formatDistance(label, rawDistance) {
    const distance = finite(rawDistance)
    if (distance === null) return label
    return `${label} ${Math.max(0, Math.round(distance))} m`
  }

  function formatCornerReadout(template, state) {
    const readout = emptyReadout()
    const status = String(template?.status || 'idle').toLowerCase()

    if (status === 'loading') {
      return {
        ...readout,
        visible: true,
        identity: 'CORNERS …',
        phaseClass: 'loading'
      }
    }

    if (status !== 'ready' || !state || !sameContext(template, state)) return readout

    const phase = normalizePhase(state.phase)
    const cornerIndex = finite(state.cornerIndex)
    if (phase === null || cornerIndex === null || cornerIndex < 1) return readout

    const direction = normalizeDirection(state.direction)
    const identity = [`T${Math.trunc(cornerIndex)}`, direction].filter(Boolean).join(' ')
    let distance = ''

    if (phase === CORNER_PHASES.BETWEEN || phase === CORNER_PHASES.APPROACH) {
      distance = formatDistance('ENTRY', state.distanceToEntryM)
    } else if (phase === CORNER_PHASES.ENTRY) {
      distance = formatDistance('APEX', state.distanceToApexM)
    } else if (phase === CORNER_PHASES.APEX) {
      distance = ''
    } else if (phase === CORNER_PHASES.EXIT) {
      distance = formatDistance('EXIT', state.distanceToExitM)
    }

    return {
      visible: true,
      identity,
      phase: phase.toUpperCase(),
      distance,
      phaseClass: phase
    }
  }

  return {
    CORNER_PHASES,
    formatCornerReadout,
    isFinalCornerExit,
    normalizeDirection,
    normalizePhase
  }
}))
