(function (globalScope, factory) {
  const api = factory()
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DriverAnalysisScoring = api
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict'

  const PROBLEM_META = Object.freeze({
    front_scrub: Object.freeze({ label: 'FRONT SCRUB', instruction: 'Reduce steering and let the front recover' }),
    exit_wheelspin: Object.freeze({ label: 'EXIT WHEELSPIN', instruction: 'Build throttle after the car is settled' }),
    brake_steering_overload: Object.freeze({ label: 'BRAKE + STEERING OVERLOAD', instruction: 'Release brake as steering builds' }),
    abrupt_brake_release: Object.freeze({ label: 'ABRUPT BRAKE RELEASE', instruction: 'Release brake smoothly through rotation' })
  })
  const PROBLEM_TYPES = Object.freeze(Object.keys(PROBLEM_META))
  const STATUS = Object.freeze({
    ISSUE: 'issue',
    INSUFFICIENT: 'insufficient',
    AMBIGUOUS: 'ambiguous',
    NO_CLEAR_DOMINANT_PROBLEM: 'no_clear_dominant_problem'
  })
  const DEFAULT_THRESHOLDS = Object.freeze({
    minValidOpportunities: 5,
    minPrimaryEvidence: 3,
    minDistinctManeuvers: 3,
    minRecurrence: 0.4,
    minDetectorConfidence: 0.84,
    minAttributionConfidence: 0.70,
    maxAmbiguity: 0.30,
    winnerMargin: 1.15
  })

  function number(value, fallback = 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  function clamp(value, low = 0, high = 1) { return Math.max(low, Math.min(high, number(value, low))) }
  function median(values) {
    const sorted = values.map(value => number(value)).filter(Number.isFinite).sort((left, right) => left - right)
    if (!sorted.length) return 0
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  }

  function emptyAggregate(kind) {
    return {
      kind,
      validOpportunities: 0,
      cleanOpportunities: 0,
      problemEvidence: 0,
      primaryEvidence: 0,
      ambiguousOpportunities: 0,
      distinctManeuvers: 0,
      recurrence: 0,
      ambiguity: 0,
      medianDetectorConfidence: 0,
      medianAttributionConfidence: 0,
      medianSeverity: 0,
      sampleSupport: 0,
      ambiguityPenalty: 1,
      priority: 0,
      qualified: false
    }
  }

  function aggregateFor(kind, opportunities, evidence, thresholds) {
    const relevantOpportunities = opportunities.filter(opportunity => opportunity.type === kind && opportunity.valid === true && opportunity.outcome !== 'incomplete')
    const relevantEvidence = evidence.filter(item => item.type === kind)
    const problemEvidence = relevantEvidence.filter(item => item.outcome === 'problem')
    const primaryEvidence = problemEvidence.filter(item => item.primary === true)
    const ambiguousOpportunities = relevantEvidence.filter(item => item.outcome === 'ambiguous').length
    const distinctManeuvers = new Set(primaryEvidence.map(item => item.maneuverId)).size
    const recurrence = relevantOpportunities.length ? primaryEvidence.length / relevantOpportunities.length : 0
    const ambiguity = relevantOpportunities.length ? ambiguousOpportunities / relevantOpportunities.length : 0
    const detector = median(primaryEvidence.map(item => item.detectorConfidence))
    const attribution = median(primaryEvidence.map(item => item.attributionConfidence))
    const severity = median(primaryEvidence.map(item => item.severity))
    const sampleSupport = Math.min(1, relevantOpportunities.length / 8)
    const ambiguityPenalty = Math.max(0, 1 - ambiguity)
    const priority = recurrence * detector * attribution * severity * sampleSupport * ambiguityPenalty
    const aggregate = {
      ...emptyAggregate(kind),
      validOpportunities: relevantOpportunities.length,
      cleanOpportunities: relevantEvidence.filter(item => item.outcome === 'clean').length,
      problemEvidence: problemEvidence.length,
      primaryEvidence: primaryEvidence.length,
      ambiguousOpportunities,
      distinctManeuvers,
      recurrence,
      ambiguity,
      medianDetectorConfidence: detector,
      medianAttributionConfidence: attribution,
      medianSeverity: severity,
      sampleSupport,
      ambiguityPenalty,
      priority
    }
    aggregate.qualified = aggregate.validOpportunities >= thresholds.minValidOpportunities
      && aggregate.primaryEvidence >= thresholds.minPrimaryEvidence
      && aggregate.distinctManeuvers >= thresholds.minDistinctManeuvers
      && aggregate.recurrence >= thresholds.minRecurrence
      && aggregate.medianDetectorConfidence >= thresholds.minDetectorConfidence
      && aggregate.medianAttributionConfidence >= thresholds.minAttributionConfidence
      && aggregate.ambiguity <= thresholds.maxAmbiguity
    return aggregate
  }

  function summarizeDriverAnalysis({ opportunities = [], evidence = [] } = {}, options = {}) {
    const thresholds = { ...DEFAULT_THRESHOLDS, ...(options.thresholds || {}) }
    const aggregates = Object.fromEntries(PROBLEM_TYPES.map(kind => [kind, aggregateFor(kind, opportunities, evidence, thresholds)]))
    const qualified = Object.values(aggregates).filter(aggregate => aggregate.qualified).sort((left, right) => right.priority - left.priority)
    const best = qualified[0] || null
    const second = qualified[1] || null
    let status = STATUS.INSUFFICIENT
    let mainProblem = null
    const hasValid = Object.values(aggregates).some(aggregate => aggregate.validOpportunities > 0)
    const hasAmbiguous = Object.values(aggregates).some(aggregate => aggregate.ambiguousOpportunities > 0 || (aggregate.problemEvidence > 0 && aggregate.medianAttributionConfidence < thresholds.minAttributionConfidence))
    if (best) {
      if (second && best.priority < second.priority * thresholds.winnerMargin) {
        status = STATUS.NO_CLEAR_DOMINANT_PROBLEM
      } else {
        status = STATUS.ISSUE
        const meta = PROBLEM_META[best.kind]
        mainProblem = {
          kind: best.kind,
          label: meta.label,
          instruction: meta.instruction,
          priority: best.priority,
          evidenceCount: best.primaryEvidence,
          opportunityCount: best.validOpportunities,
          detectorConfidence: best.medianDetectorConfidence,
          attributionConfidence: best.medianAttributionConfidence,
          severity: best.medianSeverity
        }
      }
    } else if (hasAmbiguous) {
      status = STATUS.AMBIGUOUS
    } else if (hasValid) {
      status = STATUS.INSUFFICIENT
    }
    return {
      status,
      mainProblem,
      aggregates,
      thresholds: { ...thresholds },
      validOpportunityCount: opportunities.filter(opportunity => opportunity.valid === true && opportunity.outcome !== 'incomplete').length,
      evidenceCount: evidence.filter(item => item.outcome === 'problem' && item.primary === true).length,
      maneuverCount: new Set(opportunities.filter(opportunity => opportunity.valid === true).map(opportunity => opportunity.maneuverId)).size
    }
  }

  return { DEFAULT_THRESHOLDS, PROBLEM_META, PROBLEM_TYPES, STATUS, median, summarizeDriverAnalysis }
}))
