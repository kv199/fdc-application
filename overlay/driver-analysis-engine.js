(function (globalScope, factory) {
  const stateApi = typeof module !== 'undefined' && module.exports && typeof document === 'undefined'
    ? require('./driver-analysis-state.js') : globalScope.DriverAnalysisState
  const opportunitiesApi = typeof module !== 'undefined' && module.exports && typeof document === 'undefined'
    ? require('./driver-analysis-opportunities.js') : globalScope.DriverAnalysisOpportunities
  const evidenceApi = typeof module !== 'undefined' && module.exports && typeof document === 'undefined'
    ? require('./driver-analysis-evidence.js') : globalScope.DriverAnalysisEvidence
  const scoringApi = typeof module !== 'undefined' && module.exports && typeof document === 'undefined'
    ? require('./driver-analysis-scoring.js') : globalScope.DriverAnalysisScoring
  const statsApi = typeof module !== 'undefined' && module.exports && typeof document === 'undefined'
    ? require('./driver-analysis-stats.js') : globalScope.DriverAnalysisStats
  const api = factory(stateApi || {}, opportunitiesApi || {}, evidenceApi || {}, scoringApi || {}, statsApi || {})
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.DriverAnalysisEngine = api
}(typeof globalThis !== 'undefined' ? globalThis : this, (stateApi, opportunitiesApi, evidenceApi, scoringApi, statsApi) => {
  'use strict'

  const DRIVER_ANALYSIS_VERSION = 'driver-analysis-rules-v5'
  const PROBLEM_META = scoringApi.PROBLEM_META || {}

  function createDriverAnalysisEngine(options = {}) {
    const thresholds = options.thresholds || {}
    const state = options.state || new stateApi.DriverAnalysisState({ thresholds })
    const opportunities = options.opportunities || new opportunitiesApi.DriverAnalysisOpportunities({ thresholds })
    const stats = options.stats || statsApi.createDriverAnalysisStats?.() || null
    let sampleCount = 0
    let lastSnapshot = state.snapshot(null)
    let lastResult = null

    function reset(reason = null) {
      state.reset(reason)
      opportunities.reset()
      stats?.reset()
      sampleCount = 0
      lastSnapshot = state.snapshot(null, reason)
      lastResult = null
      return snapshot()
    }

    function resetTransient(reason = 'telemetry_gap') {
      state.resetTransient(reason)
      opportunities.resetTransient(reason)
      stats?.resetTransient()
      lastSnapshot = state.snapshot(null, reason)
      return snapshot()
    }

    function update(telemetry) {
      const result = state.update(telemetry)
      lastSnapshot = result
      stats?.update(result)
      if (result?.valid !== true) {
        if (result?.resetReason) opportunities.resetTransient(result.resetReason)
        return { ...snapshot(), state: result, finalizedOpportunities: [] }
      }
      sampleCount += 1
      const finalizedOpportunities = opportunities.update(result)
      lastResult = null
      return { ...snapshot(), state: result, finalizedOpportunities }
    }

    function finalize() {
      opportunities.finalize()
      const opportunityList = opportunities.getOpportunities()
      const evidence = evidenceApi.analyzeOpportunities(opportunityList, { thresholds: options.evidenceThresholds || thresholds })
      const outcomeById = new Map(evidence.map(item => [item.opportunityId, item.outcome]))
      const classifiedOpportunities = opportunityList.map(opportunity => ({
        ...opportunity,
        outcome: outcomeById.get(opportunity.id) || opportunity.outcome
      }))
      const summary = scoringApi.summarizeDriverAnalysis({ opportunities: classifiedOpportunities, evidence }, { thresholds: options.scoringThresholds || {} })
      const result = {
        status: summary.status,
        mainProblem: summary.mainProblem,
        opportunities: classifiedOpportunities,
        evidence,
        aggregates: summary.aggregates,
        maneuverCount: summary.maneuverCount,
        sampleCount,
        stats: stats?.finalize() || null,
        algorithmVersion: DRIVER_ANALYSIS_VERSION
      }
      lastResult = result
      return result
    }

    function snapshot() {
      const opportunityList = opportunities.getOpportunities()
      return {
        recording: lastResult === null,
        sampleCount,
        opportunityCount: opportunityList.length,
        maneuverCount: new Set(opportunityList.map(opportunity => opportunity.maneuverId)).size,
        vehicleIdentity: lastSnapshot?.vehicleIdentity || null,
        algorithmVersion: DRIVER_ANALYSIS_VERSION
      }
    }

    return { finalize, reset, resetTransient, snapshot, update }
  }

  return { DRIVER_ANALYSIS_VERSION, PROBLEM_META, createDriverAnalysisEngine }
}))
