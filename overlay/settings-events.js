(function (globalScope, factory) {
  const api = factory(globalScope)
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.SettingsEvents = api
}(typeof globalThis !== 'undefined' ? globalThis : this, globalScope => {
  'use strict'

  const EVENTS_SORT_STORAGE_KEY = 'fdc.events-sort.v1'
  const EVENT_SORT_OPTIONS = ['id-desc', 'id-asc', 'last-recorded-desc', 'last-recorded-asc']

  function eventKey(value) {
    if (value === null || value === undefined || value === '') return null
    return String(value)
  }

  function nativeEventId(value) {
    const numericId = Number(value)
    return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : value
  }

  function eventIdFrom(value) {
    if (value && typeof value === 'object') {
      return value.id ?? value.eventId ?? value.event_id ?? value.event?.id ?? value.event?.eventId ?? null
    }
    return value
  }

  function eventText(value) {
    return typeof value === 'string' ? value.trim() : ''
  }

  function normalizeEvent(value) {
    const source = value && typeof value === 'object' && value.event && typeof value.event === 'object'
      ? value.event
      : value
    const id = eventKey(eventIdFrom(source))
    if (!id) return null
    const mode = eventText(source?.mode) || 'Any'
    const routeType = eventText(source?.routeType ?? source?.route_type ?? source?.route) || 'Asphalt'
    const eventClass = eventText(source?.class ?? source?.eventClass ?? source?.event_class) || 'Any'
    return {
      id,
      name: eventText(source?.name ?? source?.title ?? source?.displayName) || `EVENT ${id}`,
      eventClass,
      routeType,
      mode,
      notes: eventText(source?.notes),
      createdAt: source?.createdAt ?? source?.created_at ?? null,
      lastRecordedAt: source?.lastRecordedAt
        ?? source?.last_recorded_at
        ?? source?.lastRecordedRunAt
        ?? source?.last_recorded_run_at
        ?? null
    }
  }

  function normalizeEventsPayload(value) {
    if (Array.isArray(value)) return value.map(normalizeEvent).filter(Boolean)
    if (!value || typeof value !== 'object') return []
    const list = value.events ?? value.items ?? value.records
    if (Array.isArray(list)) return list.map(normalizeEvent).filter(Boolean)
    const single = normalizeEvent(value.event ?? value)
    return single ? [single] : []
  }

  function eventModeKey(mode) {
    return eventText(mode).toLowerCase().replaceAll(/[^a-z0-9]+/g, '') || 'any'
  }

  function eventModeLabel(mode) {
    const labels = {
      any: 'ANY',
      rivals: 'RIVALS',
      online: 'ONLINE',
      eventlab: 'EVENTLAB',
      official: 'OFFICIAL',
      blueprint: 'BLUEPRINT'
    }
    return labels[eventModeKey(mode)] || eventText(mode).toUpperCase() || 'ANY'
  }

  function eventRouteLabel(routeType) {
    return eventText(routeType).toUpperCase() || 'ASPHALT'
  }

  function eventIdCompare(left, right) {
    const leftNumber = Number(left?.id)
    const rightNumber = Number(right?.id)
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber
    }
    return String(left?.id || '').localeCompare(String(right?.id || ''), undefined, { numeric: true })
  }

  function eventDateMs(event) {
    const value = event?.lastRecordedAt
    if (!value) return null
    const timestamp = new Date(value).getTime()
    return Number.isFinite(timestamp) ? timestamp : null
  }

  function runId(value) {
    if (value === null || value === undefined || value === '') return null
    return String(value)
  }

  function runTimeMs(value, unit = 'auto') {
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0) return null
    if (unit === 'ms') return Math.round(number)
    if (unit === 'seconds') return Math.round(number * 1000)
    return number < 1000 ? Math.round(number * 1000) : Math.round(number)
  }

  function finiteNumber(value) {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }

  function normalizePedal(value) {
    const number = finiteNumber(value)
    if (number === null) return 0
    return Math.max(0, Math.min(1, number > 1 ? number / 100 : number))
  }

  function normalizeTracePoints(value) {
    const list = Array.isArray(value) ? value : []
    return list.map(point => {
      if (!point || typeof point !== 'object') return null
      const position = point.position && typeof point.position === 'object' ? point.position : point
      const positionX = finiteNumber(point.positionX ?? point.position_x ?? position.x)
      const positionY = finiteNumber(point.positionY ?? point.position_y ?? position.y)
      const positionZ = finiteNumber(point.positionZ ?? point.position_z ?? position.z)
      if (positionX === null || positionZ === null) return null
      const normalized = {
        elapsedMs: runTimeMs(point.elapsedMs ?? point.elapsed_ms ?? point.timeMs ?? point.time_ms, 'ms'),
        distanceM: finiteNumber(point.distanceM ?? point.distance_m ?? point.distance),
        positionX,
        positionY,
        positionZ,
        throttle: normalizePedal(point.throttle ?? point.throttleInput ?? point.throttle_input),
        brake: normalizePedal(point.brake ?? point.brakeInput ?? point.brake_input)
      }
      // Extended contract fields (optional; include when present and finite, accept camelCase and snake_case)
      const extendedFields = [
        ['speedKmh', 'speed_kmh'],
        ['gear', 'gear'],
        ['rpm', 'rpm'],
        ['steer', 'steer'],
        ['accelerationX', 'acceleration_x'],
        ['accelerationY', 'acceleration_y'],
        ['accelerationZ', 'acceleration_z'],
        ['yawRate', 'yaw_rate'],
        ['slipAngleFl', 'slip_angle_fl'],
        ['slipAngleFr', 'slip_angle_fr'],
        ['slipAngleRl', 'slip_angle_rl'],
        ['slipAngleRr', 'slip_angle_rr'],
        ['slipRatioFl', 'slip_ratio_fl'],
        ['slipRatioFr', 'slip_ratio_fr'],
        ['slipRatioRl', 'slip_ratio_rl'],
        ['slipRatioRr', 'slip_ratio_rr'],
        ['combinedSlipFl', 'combined_slip_fl'],
        ['combinedSlipFr', 'combined_slip_fr'],
        ['combinedSlipRl', 'combined_slip_rl'],
        ['combinedSlipRr', 'combined_slip_rr'],
        ['tireTempCFl', 'tire_temp_c_fl'],
        ['tireTempCFr', 'tire_temp_c_fr'],
        ['tireTempCRl', 'tire_temp_c_rl'],
        ['tireTempCRr', 'tire_temp_c_rr'],
        ['suspensionFl', 'suspension_fl'],
        ['suspensionFr', 'suspension_fr'],
        ['suspensionRl', 'suspension_rl'],
        ['suspensionRr', 'suspension_rr'],
        ['puddleFl', 'puddle_fl'],
        ['puddleFr', 'puddle_fr'],
        ['puddleRl', 'puddle_rl'],
        ['puddleRr', 'puddle_rr']
      ]
      for (const [camelCase, snakeCase] of extendedFields) {
        const value = finiteNumber(point[camelCase] ?? point[snakeCase])
        if (value !== null) normalized[camelCase] = value
      }
      // Rumble fields: boolean, accept camelCase and snake_case
      for (const wheel of ['Fl', 'Fr', 'Rl', 'Rr']) {
        const camel = `rumble${wheel}`
        const snake = `rumble_${wheel.toLowerCase()}`
        if (point[camel] === true || point[snake] === true) {
          normalized[camel] = true
        }
      }
      return normalized
    }).filter(Boolean)
  }

  function normalizeEventRun(value) {
    const source = value && typeof value === 'object' && value.run && typeof value.run === 'object' ? value.run : value
    if (!source || typeof source !== 'object') return null
    const id = runId(source.runId ?? source.run_id ?? source.id)
    if (!id) return null
    const laps = Array.isArray(source.laps)
      ? source.laps.map(lap => {
        const sectors = lap?.sectors && typeof lap.sectors === 'object' ? lap.sectors : null
        const valueFor = (keys, fallbackKeys = []) => {
          const value = keys.map(key => lap?.[key]).find(candidate => candidate !== undefined && candidate !== null)
            ?? fallbackKeys.map(key => sectors?.[key]).find(candidate => candidate !== undefined && candidate !== null)
          return value === undefined || value === null ? null : runTimeMs(value, 'ms')
        }
        const tracePoints = normalizeTracePoints(
          lap?.tracePoints ?? lap?.trace_points ?? lap?.trace ?? lap?.samples
        )
        return {
          lapNumber: Number(lap?.lapNumber ?? lap?.lap_number ?? lap?.number),
          timeMs: lap?.lapTimeMs !== undefined
            ? runTimeMs(lap.lapTimeMs, 'ms')
            : lap?.lap_time_ms !== undefined
              ? runTimeMs(lap.lap_time_ms, 'ms')
              : lap?.timeMs !== undefined
                ? runTimeMs(lap.timeMs, 'ms')
                : lap?.time_ms !== undefined
                  ? runTimeMs(lap.time_ms, 'ms')
                  : runTimeMs(lap?.time ?? lap?.seconds),
          sector1TimeMs: valueFor(['sector1TimeMs', 'sector_1_time_ms', 'sector1Ms', 'sector_1_ms', 's1TimeMs', 's1_time_ms'], ['sector1TimeMs', 'sector_1_time_ms', 'sector1Ms', 'sector_1_ms', 's1TimeMs', 's1_time_ms', 's1']),
          sector2TimeMs: valueFor(['sector2TimeMs', 'sector_2_time_ms', 'sector2Ms', 'sector_2_ms', 's2TimeMs', 's2_time_ms'], ['sector2TimeMs', 'sector_2_time_ms', 'sector2Ms', 'sector_2_ms', 's2TimeMs', 's2_time_ms', 's2']),
          sector3TimeMs: valueFor(['sector3TimeMs', 'sector_3_time_ms', 'sector3Ms', 'sector_3_ms', 's3TimeMs', 's3_time_ms'], ['sector3TimeMs', 'sector_3_time_ms', 'sector3Ms', 'sector_3_ms', 's3TimeMs', 's3_time_ms', 's3']),
          tracePoints
        }
      }).filter(lap => Number.isFinite(lap.lapNumber) && lap.timeMs !== null)
      : []
    const car = source.car && typeof source.car === 'object' ? source.car : source
    const finalTimeMs = source.resultTimeMs !== undefined
      ? runTimeMs(source.resultTimeMs, 'ms')
      : source.result_time_ms !== undefined
        ? runTimeMs(source.result_time_ms, 'ms')
        : source.finalTimeMs !== undefined
          ? runTimeMs(source.finalTimeMs, 'ms')
          : source.final_time_ms !== undefined
            ? runTimeMs(source.final_time_ms, 'ms')
            : runTimeMs(source.finalTime ?? source.final_time)
    const runType = eventText(source.runType ?? source.run_type).toLowerCase() || (laps.length ? 'circuit' : 'sprint')
    const normalizedLaps = laps.length || finalTimeMs === null
      ? laps
      : [{
        lapNumber: 1,
        timeMs: finalTimeMs,
        sector1TimeMs: runTimeMs(source.sector1TimeMs ?? source.sector_1_time_ms ?? source.s1TimeMs ?? source.s1_time_ms, 'ms'),
        sector2TimeMs: runTimeMs(source.sector2TimeMs ?? source.sector_2_time_ms ?? source.s2TimeMs ?? source.s2_time_ms, 'ms'),
        sector3TimeMs: runTimeMs(source.sector3TimeMs ?? source.sector_3_time_ms ?? source.s3TimeMs ?? source.s3_time_ms, 'ms'),
        tracePoints: normalizeTracePoints(source.tracePoints ?? source.trace_points ?? source.trace)
      }]
    return {
      id,
      eventId: eventKey(source.eventId ?? source.event_id),
      startedAt: source.startedAt ?? source.started_at ?? source.createdAt ?? source.created_at ?? null,
      recordedAt: source.createdAt ?? source.created_at ?? source.recordedAt ?? source.recorded_at ?? source.startedAt ?? source.started_at ?? null,
      finalTimeMs,
      resultTimeApproximate: source.resultTimeApproximate === true || source.result_time_approximate === true,
      runType,
      result: eventText(source.result).toLowerCase() || 'completed',
      laps: normalizedLaps,
      car: {
        name: eventText(car.name ?? car.displayName ?? car.carName ?? source.carName),
        ordinal: car.ordinal ?? car.carOrdinal ?? car.car_ordinal ?? source.carOrdinal ?? source.car_ordinal ?? null,
        class: eventText(car.class ?? car.classLabel ?? car.carClass ?? source.carClass)
          || globalScope.HudGarageRuntime?.classLabel?.(car.class ?? car.classLabel ?? car.carClass ?? source.carClass)
          || null,
        pi: car.pi ?? car.performanceIndex ?? source.carPi ?? source.car_pi ?? null,
        drivetrain: eventText(car.drivetrainLabel ?? car.drivetrain ?? car.drivetrainType)
          || globalScope.HudGarageRuntime?.drivetrainLabel?.(car.drivetrain ?? car.drivetrainType ?? source.drivetrain)
          || null
      }
    }
  }

  function normalizeEventRunsPayload(value) {
    const list = Array.isArray(value) ? value : value?.runs ?? value?.items ?? value?.records
    return Array.isArray(list) ? list.map(normalizeEventRun).filter(Boolean) : []
  }

  function formatRunTime(timeMs) {
    if (!Number.isFinite(timeMs)) return '—'
    const totalSeconds = timeMs / 1000
    const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
    const seconds = (totalSeconds - minutes * 60).toFixed(3).padStart(6, '0')
    return `${minutes}:${seconds}`
  }

  function approximateRunResultTitle() {
    return 'Approximate: last live race time before Forza cleared telemetry'
  }

  // Only a sprint result saved from the last live race time is approximate; game-reported results are never marked.
  function isApproximateRunResult(run, timeMs) {
    return run?.runType === 'sprint'
      && run.resultTimeApproximate === true
      && Number.isFinite(timeMs)
      && timeMs === run.finalTimeMs
  }

  function formatRunResultTime(run, timeMs) {
    const formatted = formatRunTime(timeMs)
    return isApproximateRunResult(run, timeMs) ? `~${formatted}` : formatted
  }

  function latestPersistedLap(run) {
    return (run?.laps || []).reduce((latest, lap) => {
      const lapNumber = Number(lap?.lapNumber)
      if (!Number.isFinite(lapNumber) || !Number.isFinite(lap?.timeMs)) return latest
      return !latest || lapNumber > latest.lapNumber ? lap : latest
    }, null)
  }

  function savedRunTimeLabel(run) {
    if (run?.runType === 'sprint') {
      return Number.isFinite(run.finalTimeMs) ? `RESULT ${formatRunResultTime(run, run.finalTimeMs)}` : null
    }
    const lap = latestPersistedLap(run)
    return Number.isFinite(lap?.timeMs) ? `LAST ${formatRunTime(lap.timeMs)}` : null
  }

  function formatRunDate(value) {
    if (!value) return '—'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return String(value)
    const pad = number => String(number).padStart(2, '0')
    return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }

  function runBestTimeMs(run) {
    if (run?.runType === 'sprint') return run.finalTimeMs
    return run?.laps?.reduce((best, lap) => !best || lap.timeMs < best ? lap.timeMs : best, null)
  }

  function distinctTimeRanks(values) {
    const valid = values.filter(value => Number.isFinite(value)).sort((left, right) => left - right)
    const fastest = valid[0] ?? null
    const second = valid.find(value => value > fastest) ?? null
    return { fastest, second }
  }

  function timeTone(value, ranks) {
    if (!Number.isFinite(value)) return ''
    if (value === ranks.fastest) return 'best'
    if (value === ranks.second) return 'second'
    return ''
  }

  function runSectorBestTimes(run) {
    const laps = run?.laps || []
    return [0, 1, 2].map(index => {
      const values = laps.map(lap => lap?.[`sector${index + 1}TimeMs`]).filter(value => Number.isFinite(value))
      return distinctTimeRanks(values).fastest
    })
  }

  function runBestHypotheticalTimeMs(run) {
    const best = runSectorBestTimes(run)
    return best.every(value => Number.isFinite(value)) ? best.reduce((sum, value) => sum + value, 0) : null
  }

  function runDateMs(run) {
    if (!run?.startedAt) return null
    const timestamp = new Date(run.startedAt).getTime()
    return Number.isFinite(timestamp) ? timestamp : null
  }

  function runIdCompare(left, right) {
    const leftNumber = Number(left?.id)
    const rightNumber = Number(right?.id)
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) {
      return leftNumber - rightNumber
    }
    return String(left?.id || '').localeCompare(String(right?.id || ''), undefined, { numeric: true })
  }

  // The Events tab of Configuration. create(ctx) owns its DOM, its state and its listeners; ctx carries
  // the shell functions it calls. The returned object holds the functions settings.js still calls.
  function create(ctx) {
    const {
      call,
      setStatus,
      confirmDestructive,
      renderTraceMap
    } = ctx
    const FdcVehicle = globalScope.FdcVehicle
    const eventsLibraryView = document.getElementById('events-library-view')
    const eventsDetailView = document.getElementById('events-detail-view')
    const eventsGrid = document.getElementById('events-grid')
    const eventsGridEmpty = document.getElementById('events-grid-empty')
    const eventsCreateToggle = document.getElementById('events-create-toggle')
    const eventsCreateArea = document.getElementById('events-create-area')
    const eventsCreateCancel = document.getElementById('events-create-cancel')
    const eventsSort = document.getElementById('events-sort')
    const eventsCreateForm = document.getElementById('events-create-form')
    const eventName = document.getElementById('event-name')
    const eventClass = document.getElementById('event-class')
    const eventRouteType = document.getElementById('event-route-type')
    const eventMode = document.getElementById('event-mode')
    const eventNotes = document.getElementById('event-notes')
    const eventsDiscardDialog = document.getElementById('events-discard-dialog')
    const eventsDiscardYes = document.getElementById('events-discard-yes')
    const eventsDiscardNo = document.getElementById('events-discard-no')
    const eventsDetailBack = document.getElementById('events-detail-back')
    const eventsDetailTitle = document.getElementById('events-detail-title')
    const eventsDetailSummary = document.getElementById('events-detail-summary')
    const eventsDetailNotes = document.getElementById('events-detail-notes')
    const eventsDetailNotesValue = document.getElementById('events-detail-notes-value')
    const eventsTheoryTime = document.getElementById('events-theory-time')
    const eventsTheoryDescription = document.getElementById('events-theory-description')
    const eventsTheoryToggle = document.getElementById('events-theory-toggle')
    const eventsTheorySectors = document.getElementById('events-theory-sectors')
    const eventsTheorySharedCar = document.getElementById('events-theory-shared-car')
    const eventsTheorySharedCarName = document.getElementById('events-theory-shared-car-name')
    const eventsTheoryRows = document.getElementById('events-theory-rows')
    const eventsTheoryNote = document.getElementById('events-theory-note')
    const eventsTheoryCount = document.getElementById('events-theory-count')
    const eventsDetailDelete = document.getElementById('events-detail-delete')
    const eventsRunView = document.getElementById('events-run-view')
    const eventsRunBack = document.getElementById('events-run-back')
    const eventsRunTitle = document.getElementById('events-run-title')
    const eventsRunSummary = document.getElementById('events-run-summary')
    const eventsRunTheoryTime = document.getElementById('events-run-theory-time')
    const eventsRunTheoryDescription = document.getElementById('events-run-theory-description')
    const eventsRunTheoryNote = document.getElementById('events-run-theory-note')
    const eventsRunTheoryCount = document.getElementById('events-run-theory-count')
    const eventsRunId = document.getElementById('events-run-id')
    const eventsRunFeedback = document.getElementById('events-run-feedback')
    const eventsRunSourceContext = document.getElementById('events-run-source-context')
    const eventsRunTableHint = document.getElementById('events-run-table-hint')
    const eventsRunLapSort = document.getElementById('events-run-lap-sort')
    const eventsRunLaps = document.getElementById('events-run-laps')
    const eventsRunEmpty = document.getElementById('events-run-empty')
    const eventRecorderStatus = document.getElementById('event-recorder-status')
    const eventRecorderHint = document.getElementById('event-recorder-hint')
    const eventRecorderFeedback = document.getElementById('event-recorder-feedback')
    const eventRecorderToggle = document.getElementById('event-recorder-toggle')
    const eventRunsTable = document.getElementById('event-runs-table')
    const eventRunsList = document.getElementById('event-runs-list')
    const eventRunSortButtons = [...document.querySelectorAll('[data-run-sort]')]
    const eventRunsEmpty = document.getElementById('event-runs-empty')
    const eventRunsCount = document.getElementById('event-runs-count')

    const eventsById = new Map()
    let currentEventRuns = []
    // Sector 1-3 sources of the open Event's Theoretical Best, or null until they load.
    let currentEventTheory = null
    let eventTheoryOpen = true
    let eventTheoryRequestSequence = 0
    let currentEventRun = null
    let recorderState = { eventId: null, recording: false, state: 'stopped', lapCount: 0, savedRunId: null }
    let eventsView = 'library'
    let currentEventId = null
    let eventsCreateOpen = false
    let eventsDiscardConfirmOpen = false
    let eventRunsSort = { key: 'date', direction: 'desc' }
    let eventRunLapSortDirection = 'desc'
    let expandedEventRunLap = null
    // Sector focused on the expanded lap's map (1-3), or null. Only the map's own focus changes it.
    let expandedEventRunSector = null
    // Set while the expanded lap was opened by VIEW SECTOR on the Event page: { runId, lapNumber }.
    let eventRunSource = null
    // The trace map of the expanded lap, so Escape can clear its focus without rebuilding the table.
    let eventRunLapMap = null
    // Live reloads of the open run can finish out of order; only the newest one may render.
    let openEventRunRefreshSequence = 0
    let eventsSortValue = 'id-desc'

    async function listenEventRecorderEvents() {
      const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
      if (!eventApi || typeof eventApi.listen !== 'function') return
      await eventApi.listen('event_recorder_status', event => {
        const payload = event?.payload
        if (!payload || (currentEventId !== null && eventKey(payload.eventId) !== currentEventId)) return
        recorderState = {
          ...recorderState,
          eventId: eventKey(payload.eventId),
          recording: payload.recording === true,
          state: payload.state || (payload.recording ? 'recording' : 'stopped'),
          lapCount: Number(payload.lapCount) || 0,
          savedRunId: runId(payload.savedRunId)
        }
        renderEventRecorder()
      })
      await eventApi.listen('event_recorder_run_saved', event => {
        const run = normalizeEventRun(event?.payload)
        if (!run || currentEventId === null || (run.eventId && run.eventId !== currentEventId)) return
        currentEventRuns = [run, ...currentEventRuns.filter(existing => existing.id !== run.id)]
        if (updateEventLastRecordedAt(run)) renderEventsLibrary()
        renderEventRuns()
        // Each saved lap can change a sector's best, so the Event's Theoretical Best reloads after every save.
        void loadEventTheoreticalBest()
        if (currentEventRun?.id === run.id && eventsView === 'run') void refreshOpenEventRun(run.id)
      })
      await eventApi.listen('event_recorder_result', event => {
        const payload = event?.payload
        if (!payload || typeof payload !== 'object') return
        const resultEventId = eventKey(payload.eventId ?? payload.event_id ?? payload.run?.eventId ?? payload.run?.event_id)
        if (resultEventId !== null && currentEventId !== null && resultEventId !== currentEventId) return

        const outcome = eventText(payload.outcome).toLowerCase()
        if (outcome === 'saved') {
          const run = normalizeEventRun(payload.run ?? payload)
          if (run && updateEventLastRecordedAt(run)) renderEventsLibrary()
          const id = run?.id || runId(payload.runId ?? payload.run_id ?? payload.run?.runId ?? payload.run?.run_id)
          const details = []
          if (id) details.push(`ID ${id}`)
          if (run?.laps?.length) details.push(`${run.laps.length} ${run.laps.length === 1 ? 'LAP' : 'LAPS'}`)
          const savedTimeLabel = savedRunTimeLabel(run)
          if (savedTimeLabel) details.push(savedTimeLabel)
          const message = `RUN SAVED${details.length ? ` · ${details.join(' · ')}` : ''}`
          setEventRecorderFeedback(message, 'saved')
          setStatus(message)
        } else if (outcome === 'discarded') {
          const message = 'RUN DISCARDED — NO CONFIRMED RESULT'
          setEventRecorderFeedback(message, 'discarded')
          setStatus(message)
        } else if (outcome === 'failed') {
          const reason = eventText(payload.reason)
          const message = `RUN SAVE FAILED${reason ? ` — ${reason}` : ''}`
          setEventRecorderFeedback(message, 'failed')
          setStatus(message, true)
        }
      })
      await eventApi.emit('event_recorder_status_request')
    }

    function setEventRecorderFeedback(message, outcome = '') {
      if (!eventRecorderFeedback) return
      eventRecorderFeedback.textContent = message
      eventRecorderFeedback.dataset.outcome = outcome
      eventRecorderFeedback.hidden = !message
    }

    function clearEventRecorderFeedback() {
      setEventRecorderFeedback('', '')
    }

    function readEventsSort() {
      try {
        const stored = JSON.parse(localStorage.getItem(EVENTS_SORT_STORAGE_KEY) || 'null')
        return EVENT_SORT_OPTIONS.includes(stored) ? stored : 'id-desc'
      } catch {
        return 'id-desc'
      }
    }

    function saveEventsSort(value) {
      try {
        localStorage.setItem(EVENTS_SORT_STORAGE_KEY, JSON.stringify(value))
      } catch {
        // A restricted webview may not expose persistent storage.
      }
    }

    function compareEvents(left, right) {
      if (eventsSortValue === 'id-asc' || eventsSortValue === 'id-desc') {
        const result = eventIdCompare(left, right)
        return eventsSortValue === 'id-asc' ? result : -result
      }
      const leftDate = eventDateMs(left)
      const rightDate = eventDateMs(right)
      // Events without runs remain grouped at the end in either date direction.
      if (leftDate === null || rightDate === null) {
        if (leftDate === rightDate) return -eventIdCompare(left, right)
        return leftDate === null ? 1 : -1
      }
      if (leftDate !== rightDate) {
        const result = leftDate - rightDate
        return eventsSortValue === 'last-recorded-asc' ? result : -result
      }
      return -eventIdCompare(left, right)
    }

    function renderEventsSort() {
      if (eventsSort) eventsSort.value = eventsSortValue
    }

    function setEventsSort(value) {
      if (!EVENT_SORT_OPTIONS.includes(value)) return
      eventsSortValue = value
      saveEventsSort(value)
      renderEventsSort()
      renderEventsLibrary()
    }

    function renderEventCard(event) {
      const card = document.createElement('article')
      card.className = 'events-card'
      card.dataset.eventId = event.id
      card.dataset.eventMode = eventModeKey(event.mode)

      const open = document.createElement('button')
      open.type = 'button'
      open.className = 'events-card__open'
      open.setAttribute('aria-label', `Open event ${event.name}`)
      open.addEventListener('click', () => void openEventDetail(event.id))

      const id = document.createElement('span')
      id.className = 'events-card__id'
      id.textContent = String(event.id)

      const content = document.createElement('div')
      content.className = 'events-card__content'
      const name = document.createElement('h3')
      name.className = 'events-card__name'
      name.textContent = event.name
      const meta = document.createElement('div')
      meta.className = 'events-card__meta'
      const mode = document.createElement('span')
      mode.className = 'events-card__badge events-card__badge--mode'
      mode.textContent = eventModeLabel(event.mode)
      const route = document.createElement('span')
      route.className = 'events-card__badge events-card__badge--route'
      route.textContent = eventRouteLabel(event.routeType)
      const eventClass = document.createElement('span')
      eventClass.className = 'events-card__badge events-card__badge--class'
      eventClass.dataset.eventClass = eventText(event.eventClass).toUpperCase() || 'ANY'
      eventClass.textContent = eventText(event.eventClass).toUpperCase() || 'ANY'
      meta.append(mode, route, eventClass)
      content.append(name, meta)

      open.append(id, content)
      card.append(open)
      return card
    }

    function renderEventsLibrary() {
      if (!eventsGrid) return
      eventsGrid.replaceChildren()
      const activeEvents = [...eventsById.values()]
        .sort(compareEvents)
      if (eventsGridEmpty) eventsGridEmpty.hidden = activeEvents.length > 0
      for (const event of activeEvents) eventsGrid.append(renderEventCard(event))
    }

    function updateEventLastRecordedAt(run) {
      const eventId = eventKey(run?.eventId)
      const event = eventId === null ? null : eventsById.get(eventId)
      const recordedAt = run?.recordedAt || run?.startedAt
      if (!event || !recordedAt) return false
      const current = eventDateMs(event)
      const next = new Date(recordedAt).getTime()
      if (!Number.isFinite(next) || (current !== null && next <= current)) return false
      event.lastRecordedAt = recordedAt
      eventsById.set(event.id, event)
      return true
    }

    function applyEventRunDates(runs) {
      for (const run of runs) updateEventLastRecordedAt(run)
    }

    function setEventsCreateOpen(open) {
      eventsCreateOpen = Boolean(open)
      if (eventsCreateArea) eventsCreateArea.hidden = !eventsCreateOpen
      eventsCreateToggle?.setAttribute('aria-expanded', String(eventsCreateOpen))
      if (eventsCreateOpen) eventName?.focus()
    }

    function resetEventCreateForm() {
      eventsCreateForm?.reset()
    }

    function eventCreateFormHasContent() {
      return [eventName, eventMode, eventRouteType, eventClass, eventNotes]
        .some(field => field?.value.trim())
    }

    function setEventsDiscardConfirmOpen(open) {
      eventsDiscardConfirmOpen = Boolean(open)
      if (eventsDiscardDialog) eventsDiscardDialog.hidden = !eventsDiscardConfirmOpen
      if (eventsDiscardConfirmOpen) eventsDiscardNo?.focus()
    }

    function closeEventsCreate() {
      setEventsDiscardConfirmOpen(false)
      resetEventCreateForm()
      setEventsCreateOpen(false)
      eventsCreateToggle?.focus()
    }

    function requestEventsCreateClose() {
      if (!eventsCreateOpen || eventsDiscardConfirmOpen) return
      if (eventCreateFormHasContent()) {
        setEventsDiscardConfirmOpen(true)
        return
      }
      closeEventsCreate()
    }

    function setEventsView(view) {
      eventsView = view
      if (eventsLibraryView) eventsLibraryView.hidden = view !== 'library'
      if (eventsDetailView) eventsDetailView.hidden = view !== 'detail'
      if (eventsRunView) eventsRunView.hidden = view !== 'run'
    }

    function renderEventDetail(event) {
      if (!event) return
      renderEventIdentity(eventsDetailTitle, eventsDetailSummary, event)
      if (eventsDetailNotes) eventsDetailNotes.hidden = !event.notes
      if (eventsDetailNotesValue) eventsDetailNotesValue.textContent = event.notes || ''
      renderEventTheory()
      renderEventRecorder()
    }

    function renderEventIdentity(titleElement, summaryElement, event) {
      if (!event) return
      if (titleElement) titleElement.textContent = event.name
      if (!summaryElement) return
      summaryElement.replaceChildren()
      summaryElement.dataset.eventId = event.id
      summaryElement.dataset.eventMode = eventModeKey(event.mode)
      const id = document.createElement('span')
      id.className = 'events-detail-view__badge events-detail-view__badge--id'
      id.textContent = String(event.id)
      const mode = document.createElement('span')
      mode.className = 'events-detail-view__badge events-detail-view__badge--mode'
      mode.textContent = eventModeLabel(event.mode)
      const route = document.createElement('span')
      route.className = 'events-detail-view__badge'
      route.textContent = eventRouteLabel(event.routeType)
      const eventClass = document.createElement('span')
      eventClass.className = 'events-detail-view__badge events-detail-view__badge--class'
      eventClass.dataset.eventClass = eventText(event.eventClass).toUpperCase() || 'Any'
      eventClass.textContent = eventText(event.eventClass).toUpperCase() || 'ANY'
      summaryElement.append(id, mode, route, eventClass)
    }

    function runCarName(run) {
      return FdcVehicle.displayName(run.car.name, run.car.ordinal)
    }

    // The native loader picks the quickest Sector 1-3 across the Event's eligible laps and names the run and lap that
    // supplied each one. It reloads on open and after every saved lap; only the newest response may render.
    async function loadEventTheoreticalBest(eventId = currentEventId) {
      const key = eventKey(eventId)
      if (!key) return
      const sequence = ++eventTheoryRequestSequence
      try {
        const nativeEventId = Number.isFinite(Number(key)) ? Math.round(Number(key)) : key
        const payload = await call('load_event_theoretical_best', { eventId: nativeEventId })
        if (sequence !== eventTheoryRequestSequence || eventKey(currentEventId) !== key) return
        currentEventTheory = globalScope.EventTheoreticalBest.normalizeSectors(payload)
      } catch {
        if (sequence !== eventTheoryRequestSequence || eventKey(currentEventId) !== key) return
        currentEventTheory = null
      }
      renderEventTheory()
    }

    // A sector's car is the native name when it has one; otherwise the run list label, then the ordinal.
    function theorySectorCarName(sector) {
      if (sector.carName) return sector.carName
      const run = currentEventRuns.find(candidate => candidate.id === sector.runId)
      const listed = run ? runCarName(run) : ''
      if (listed) return listed
      return Number.isFinite(sector.carOrdinal) ? `Car ${Math.round(sector.carOrdinal)}` : '—'
    }

    function renderEventTheoryRow(sector, shared) {
      const EventTheory = globalScope.EventTheoreticalBest
      const timed = Number.isFinite(sector.timeMs) && Boolean(sector.runId)
      const seconds = EventTheory.formatSectorSeconds(sector.timeMs)
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'events-theory__row'
      row.dataset.sector = String(sector.sector)
      row.disabled = !timed
      const name = document.createElement('span')
      name.className = 'events-theory__sector'
      name.textContent = `S${sector.sector}`
      const time = document.createElement('span')
      time.className = 'events-theory__sector-time'
      time.textContent = seconds
      if (timed) {
        const unit = document.createElement('small')
        unit.textContent = 'S'
        time.append(unit)
      }
      const source = document.createElement('span')
      source.className = 'events-theory__source'
      if (timed) {
        source.textContent = EventTheory.sourceLabel({ runId: sector.runId, lapNumber: sector.lapNumber, runType: sector.runType })
        if (!shared) {
          const car = document.createElement('small')
          car.className = 'events-theory__car'
          car.textContent = theorySectorCarName(sector)
          source.append(car)
        }
      } else {
        source.textContent = 'No eligible sector saved'
      }
      const action = document.createElement('span')
      action.className = 'events-theory__action'
      action.textContent = timed ? 'VIEW SECTOR' : 'UNAVAILABLE'
      row.append(name, time, source, action)
      if (timed) {
        const lap = Number.isFinite(sector.lapNumber) && sector.runType !== 'sprint' ? `, Lap ${Math.round(sector.lapNumber)}` : ''
        row.setAttribute('aria-label', `View sector ${sector.sector}, ${seconds} seconds, Run ${sector.runId}${lap}`)
        row.addEventListener('click', () => void openEventSource(sector))
      } else {
        row.setAttribute('aria-label', `Sector ${sector.sector} unavailable`)
      }
      return row
    }

    // Sums the three sectors only when all have a time; the footer says which estimate is shown.
    function renderEventTheory() {
      if (!eventsTheoryTime) return
      const EventTheory = globalScope.EventTheoreticalBest
      const sectors = currentEventTheory || EventTheory.normalizeSectors(null)
      const total = EventTheory.totalMs(sectors)
      const complete = total !== null
      const shared = EventTheory.sharedCarKey(sectors) !== null
      eventsTheoryTime.textContent = formatRunTime(total)
      if (eventsTheoryRows) eventsTheoryRows.replaceChildren(...sectors.map(sector => renderEventTheoryRow(sector, shared)))
      if (eventsTheorySharedCar) eventsTheorySharedCar.hidden = !shared
      if (eventsTheorySharedCarName) eventsTheorySharedCarName.textContent = shared ? theorySectorCarName(sectors[0]) : ''
      if (eventsTheoryToggle) {
        eventsTheoryToggle.textContent = eventTheoryOpen ? 'HIDE SECTORS' : 'SHOW SECTORS'
        eventsTheoryToggle.setAttribute('aria-expanded', String(eventTheoryOpen))
      }
      if (eventsTheorySectors) eventsTheorySectors.hidden = !eventTheoryOpen
      if (eventsTheoryNote) eventsTheoryNote.textContent = complete ? EventTheory.ESTIMATE_NOTE : EventTheory.INCOMPLETE_NOTE
      if (eventsTheoryCount) {
        const runCount = EventTheory.distinctRunCount(sectors)
        eventsTheoryCount.textContent = `3 SECTORS · ${runCount} ${runCount === 1 ? 'RUN' : 'RUNS'}`
        eventsTheoryCount.hidden = !complete
      }
    }

    function compareEventRuns(left, right) {
      const key = eventRunsSort.key
      if (key === 'id') {
        const result = runIdCompare(left, right)
        return eventRunsSort.direction === 'asc' ? result : -result
      }
      const leftValue = key === 'best' ? runBestTimeMs(left) : runDateMs(left)
      const rightValue = key === 'best' ? runBestTimeMs(right) : runDateMs(right)
      // Runs missing the selected value remain grouped at the end in either direction.
      if (leftValue === null || rightValue === null || leftValue === undefined || rightValue === undefined) {
        if (leftValue === rightValue) return -runIdCompare(left, right)
        return leftValue === null || leftValue === undefined ? 1 : -1
      }
      if (leftValue !== rightValue) {
        const result = leftValue - rightValue
        return eventRunsSort.direction === 'asc' ? result : -result
      }
      return -runIdCompare(left, right)
    }

    function setEventRunsSort(key) {
      if (!['id', 'best', 'date'].includes(key)) return
      const direction = eventRunsSort.key === key
        ? eventRunsSort.direction === 'asc' ? 'desc' : 'asc'
        : key === 'date' ? 'desc' : 'asc'
      eventRunsSort = { key, direction }
      renderEventRuns()
    }

    function updateEventRunSortButtons() {
      for (const button of eventRunSortButtons) {
        const active = button.dataset.runSort === eventRunsSort.key
        button.setAttribute('aria-sort', active
          ? eventRunsSort.direction === 'asc' ? 'ascending' : 'descending'
          : 'none')
        button.setAttribute('aria-label', `Sort saved runs by ${button.textContent}`)
      }
    }

    function renderEventRuns() {
      if (!eventRunsList) return
      eventRunsList.replaceChildren()
      // Car labels in the theory rows come from this list, so the theory redraws with it.
      renderEventTheory()
      updateEventRunSortButtons()
      const runs = [...currentEventRuns].sort(compareEventRuns)
      if (eventRunsEmpty) eventRunsEmpty.hidden = runs.length > 0
      if (eventRunsTable) eventRunsTable.hidden = runs.length === 0
      if (eventRunsCount) eventRunsCount.textContent = `${runs.length} ${runs.length === 1 ? 'RUN' : 'RUNS'}`
      for (const run of runs) {
        const lapCount = run.laps.length
        const openRun = () => openEventRun(run.id)
        const row = document.createElement('tr')
        row.className = 'events-run-table__lap-row'
        row.tabIndex = 0
        row.setAttribute('aria-label', `Open run ${run.id}, ${lapCount} ${lapCount === 1 ? 'lap' : 'laps'}`)
        row.addEventListener('click', openRun)
        row.addEventListener('keydown', event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          openRun()
        })
        const idCell = document.createElement('th')
        idCell.scope = 'row'
        idCell.textContent = String(run.id)
        if (recorderState.recording === true && recorderState.savedRunId === run.id) {
          const live = document.createElement('span')
          live.className = 'events-run-live'
          live.textContent = 'LIVE'
          idCell.append(live)
        }
        row.append(idCell)
        const carCell = document.createElement('td')
        carCell.textContent = runCarName(run)
        row.append(carCell)
        const carDetails = [run.car.class, run.car.pi ? `PI ${run.car.pi}` : '', run.car.drivetrain].filter(Boolean).join(' · ') || '—'
        const carDetailsCell = document.createElement('td')
        carDetailsCell.textContent = carDetails
        row.append(carDetailsCell)
        const bestCell = document.createElement('td')
        const bestTime = document.createElement('span')
        bestTime.className = 'events-run-table__time'
        const bestTimeMs = runBestTimeMs(run)
        bestTime.textContent = formatRunResultTime(run, bestTimeMs)
        if (isApproximateRunResult(run, bestTimeMs)) {
          bestTime.title = approximateRunResultTitle()
          bestTime.setAttribute('aria-label', approximateRunResultTitle())
        }
        bestCell.append(bestTime)
        row.append(bestCell)
        const lapsCell = document.createElement('td')
        lapsCell.className = 'events-run-table__end'
        lapsCell.textContent = String(lapCount)
        row.append(lapsCell)
        const dateCell = document.createElement('td')
        dateCell.className = 'events-run-table__end'
        dateCell.textContent = formatRunDate(run.startedAt)
        row.append(dateCell)
        eventRunsList.append(row)
      }
    }

    function renderRunTimeCell(timeMs, ranks, approximate = false) {
      const value = document.createElement('span')
      value.className = 'events-run-table__time'
      if (!Number.isFinite(timeMs)) value.classList.add('is-missing')
      const tone = timeTone(timeMs, ranks)
      if (tone) value.dataset.tone = tone
      const marked = approximate && Number.isFinite(timeMs)
      value.textContent = marked ? `~${formatRunTime(timeMs)}` : formatRunTime(timeMs)
      if (marked) {
        value.title = approximateRunResultTitle()
        value.setAttribute('aria-label', approximateRunResultTitle())
      }
      return value
    }

    // The lap row and its lap number expand or collapse the lap without focusing a sector.
    function toggleEventRunLap(lapNumber) {
      const key = Number(lapNumber)
      expandedEventRunLap = expandedEventRunLap === key ? null : key
      expandedEventRunSector = null
      eventRunSource = null
      setEventRunFeedback('')
      if (currentEventRun) renderEventRunDetail(currentEventRun)
      if (expandedEventRunLap !== null) scrollEventRunLap(expandedEventRunLap, { detail: true })
    }

    // A sector cell expands its lap and focuses that sector. It was not opened from the Event, so no context line shows.
    function selectEventRunSector(lapNumber, sector) {
      expandedEventRunLap = Number(lapNumber)
      expandedEventRunSector = sector
      eventRunSource = null
      setEventRunFeedback('')
      if (currentEventRun) renderEventRunDetail(currentEventRun)
      scrollEventRunLap(expandedEventRunLap, { detail: true })
    }

    // Called by the expanded lap's map when its sector focus changes. The lap table and context line update in place,
    // so the map is not rebuilt while the user is using it.
    function setEventRunSectorFocus(lapNumber, sector) {
      if (expandedEventRunLap !== Number(lapNumber)) return
      expandedEventRunSector = Number.isFinite(sector) ? sector : null
      syncEventRunSectorFocus()
    }

    function syncEventRunSectorFocus() {
      for (const cell of eventsRunLaps?.querySelectorAll('td[data-sector]') || []) {
        const focused = Number(cell.dataset.lap) === expandedEventRunLap && Number(cell.dataset.sector) === expandedEventRunSector
        cell.classList.toggle('is-sector-focus', focused)
      }
      renderEventRunSourceContext()
    }

    // The context line names the source only while its lap stays expanded; the sector appears while it is focused.
    function renderEventRunSourceContext() {
      if (!eventsRunSourceContext) return
      const source = eventRunSource
      const visible = Boolean(source && Number.isFinite(source.lapNumber) && currentEventRun?.id === source.runId
        && expandedEventRunLap === source.lapNumber)
      eventsRunSourceContext.hidden = !visible
      eventsRunSourceContext.textContent = visible
        ? globalScope.EventTheoreticalBest.sourceContext({
          runId: source.runId,
          lapNumber: source.lapNumber,
          sector: expandedEventRunSector,
          runType: currentEventRun.runType
        })
        : ''
    }

    function setEventRunFeedback(message) {
      if (!eventsRunFeedback) return
      eventsRunFeedback.textContent = message
      eventsRunFeedback.hidden = !message
    }

    function scrollEventRunLap(lapNumber, { detail = false } = {}) {
      const row = eventsRunLaps?.querySelector(`tr.events-run-table__lap-row[data-lap="${lapNumber}"]`)
      const target = detail ? row?.nextElementSibling : row
      target?.scrollIntoView?.({ block: detail ? 'nearest' : 'start' })
    }

    // VIEW SECTOR lands on the sector cell it names; the lap row is brought to the top so the map shows under it.
    function focusEventRunSector(lapNumber, sector) {
      const cell = eventsRunLaps?.querySelector(`[data-focus-key="sector-${lapNumber}-${sector}"]`)
      if (cell) {
        cell.focus({ preventScroll: true })
        scrollEventRunLap(lapNumber)
      } else {
        eventsRunBack?.focus()
      }
    }

    // Theoretical Best for a run page: quickest Sector 1-3 across this run's laps, shown without sources or a toggle.
    function renderEventRunTheory(run) {
      const EventTheory = globalScope.EventTheoreticalBest
      const total = runBestHypotheticalTimeMs(run)
      const complete = Number.isFinite(total)
      if (eventsRunTheoryTime) eventsRunTheoryTime.textContent = formatRunTime(total)
      if (eventsRunTheoryDescription) eventsRunTheoryDescription.textContent = EventTheory.runDescription(run.runType)
      if (eventsRunTheoryNote) eventsRunTheoryNote.textContent = complete ? EventTheory.ESTIMATE_NOTE : EventTheory.INCOMPLETE_NOTE
      if (eventsRunTheoryCount) eventsRunTheoryCount.hidden = !complete
    }

    function renderEventRunDetail(run) {
      if (!run) return
      const event = currentEventId === null ? null : eventsById.get(currentEventId)
      if (!event) return
      // A re-render replaces the focused element, so focus returns to the same row or sector cell afterwards.
      const active = document.activeElement
      const focusKey = eventsRunLaps?.contains(active) ? active.dataset.focusKey || null : null
      renderEventIdentity(eventsRunTitle, eventsRunSummary, event)
      if (eventsRunId) eventsRunId.textContent = String(run.id)
      renderEventRunTheory(run)
      if (eventsRunTableHint) {
        eventsRunTableHint.textContent = run.runType === 'sprint' ? 'SPRINT · ONE PASS' : ''
      }
      const laps = [...(run.laps || [])].sort((left, right) => {
        const result = Number(left.lapNumber) - Number(right.lapNumber)
        return eventRunLapSortDirection === 'asc' ? result : -result
      })
      const lapRanks = distinctTimeRanks(laps.map(lap => lap.timeMs))
      const sectorRanks = [0, 1, 2].map(index => distinctTimeRanks(laps.map(lap => lap[`sector${index + 1}TimeMs`])))
      if (eventsRunLapSort) {
        eventsRunLapSort.setAttribute('aria-sort', eventRunLapSortDirection === 'asc' ? 'ascending' : 'descending')
      }
      eventRunLapMap = null
      if (eventsRunLaps) {
        eventsRunLaps.replaceChildren()
        for (const lap of laps) {
          const row = document.createElement('tr')
          const lapNumberValue = Number(lap.lapNumber)
          const expanded = expandedEventRunLap === lapNumberValue
          row.className = 'events-run-table__lap-row'
          row.dataset.lap = String(lapNumberValue)
          row.dataset.focusKey = `lap-${lapNumberValue}`
          row.tabIndex = 0
          row.setAttribute('aria-expanded', String(expanded))
          row.setAttribute('aria-label', `Lap ${Number.isFinite(lapNumberValue) ? lapNumberValue : 'unknown'} details`)
          row.addEventListener('click', () => toggleEventRunLap(lapNumberValue))
          row.addEventListener('keydown', event => {
            // Keys pressed on a sector button inside the row belong to that button, not to the row.
            if (event.target !== row || (event.key !== 'Enter' && event.key !== ' ')) return
            event.preventDefault()
            toggleEventRunLap(lapNumberValue)
          })
          const lapNumber = document.createElement('th')
          lapNumber.scope = 'row'
          lapNumber.textContent = Number.isFinite(lap.lapNumber) ? String(Math.round(lap.lapNumber)) : '—'
          const lapTime = document.createElement('td')
          lapTime.append(renderRunTimeCell(lap.timeMs, lapRanks, isApproximateRunResult(run, lap.timeMs)))
          row.append(lapNumber, lapTime)
          for (let index = 0; index < 3; index += 1) {
            const sectorNumber = index + 1
            const sectorTimeMs = lap[`sector${sectorNumber}TimeMs`]
            const cell = document.createElement('td')
            cell.dataset.lap = String(lapNumberValue)
            cell.dataset.sector = String(sectorNumber)
            cell.classList.toggle('is-sector-focus', expanded && expandedEventRunSector === sectorNumber)
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'events-run-table__cell'
            button.dataset.focusKey = `sector-${lapNumberValue}-${sectorNumber}`
            button.disabled = !Number.isFinite(sectorTimeMs)
            button.append(renderRunTimeCell(sectorTimeMs, sectorRanks[index]))
            button.addEventListener('click', event => {
              // The cell belongs to the sector, so its click must not also toggle the lap row.
              event.stopPropagation()
              selectEventRunSector(lapNumberValue, sectorNumber)
            })
            cell.append(button)
            row.append(cell)
          }
          eventsRunLaps.append(row)
          if (expanded) {
            const detailRow = document.createElement('tr')
            detailRow.className = 'events-lap-detail-row'
            const detailCell = document.createElement('td')
            detailCell.colSpan = 5
            const detail = document.createElement('div')
            detail.className = 'events-lap-detail'
            const map = renderTraceMap(lap.tracePoints || [], lap.timeMs, {
              sectorFocus: true,
              initialSector: expandedEventRunSector,
              fullLabel: run.runType === 'sprint' ? 'FULL RUN' : 'FULL LAP',
              onSectorChange: sector => setEventRunSectorFocus(lapNumberValue, sector)
            })
            eventRunLapMap = map
            detail.append(map)
            detailCell.append(detail)
            detailRow.append(detailCell)
            eventsRunLaps.append(detailRow)
          }
        }
      }
      if (focusKey) eventsRunLaps?.querySelector(`[data-focus-key="${focusKey}"]`)?.focus({ preventScroll: true })
      renderEventRunSourceContext()
      if (eventsRunEmpty) eventsRunEmpty.hidden = laps.length > 0
    }

    // A run row opens the run with no lap expanded. VIEW SECTOR passes its source, so the run opens with that lap
    // expanded, that sector focused, a status line, and the context line.
    async function openEventRun(id, source = null) {
      if (currentEventId === null) return false
      const key = runId(id)
      const run = currentEventRuns.find(candidate => candidate.id === key)
      if (!run) return false
      const firstLap = run.laps[0]?.lapNumber ?? null
      const sourceLap = source ? (Number.isFinite(source.lapNumber) ? source.lapNumber : firstLap) : null
      currentEventRun = run
      expandedEventRunLap = sourceLap
      // A sector is focused only inside an expanded lap, so a source without a lap focuses none.
      expandedEventRunSector = sourceLap !== null ? source.sector : null
      eventRunSource = sourceLap !== null ? { runId: key, lapNumber: sourceLap } : null
      setEventRunFeedback(source
        ? globalScope.EventTheoreticalBest.openedStatus({ runId: key, lapNumber: sourceLap, sector: source.sector, runType: run.runType })
        : '')
      eventRunLapSortDirection = 'desc'
      renderEventRunDetail(run)
      setEventsView('run')
      if (source) focusEventRunSector(sourceLap, source.sector)
      else eventsRunBack?.focus()
      try {
        const nativeRunId = Number.isFinite(Number(key)) ? Math.round(Number(key)) : key
        const loaded = normalizeEventRun(await call('load_event_run', { runId: nativeRunId }))
        if (loaded && loaded.id === key && eventsView === 'run' && currentEventRun?.id === key) {
          currentEventRun = loaded
          currentEventRuns = currentEventRuns.map(candidate => candidate.id === key ? loaded : candidate)
          renderEventRunDetail(loaded)
        }
      } catch {
        // The list payload remains usable; trace details simply stay unavailable.
      }
      return true
    }

    // VIEW SECTOR on the Event's Theoretical Best: the run that supplied the sector opens at its lap and sector.
    function openEventSource(sector) {
      return openEventRun(sector.runId, { lapNumber: sector.lapNumber, sector: sector.sector })
    }

    // Reloads the open run after one of its laps is saved. The expanded lap, sort, and focus stay as they are.
    async function refreshOpenEventRun(id) {
      const key = runId(id)
      if (!key || currentEventRun?.id !== key || eventsView !== 'run') return
      const sequence = ++openEventRunRefreshSequence
      try {
        const nativeRunId = Number.isFinite(Number(key)) ? Math.round(Number(key)) : key
        const loaded = normalizeEventRun(await call('load_event_run', { runId: nativeRunId }))
        if (sequence !== openEventRunRefreshSequence) return
        if (!loaded || loaded.id !== key || eventsView !== 'run' || currentEventRun?.id !== key) return
        currentEventRuns = currentEventRuns.map(candidate => candidate.id === key ? loaded : candidate)
        currentEventRun = loaded
        if (expandedEventRunLap !== null && !loaded.laps.some(lap => lap.lapNumber === expandedEventRunLap)) {
          expandedEventRunLap = null
          expandedEventRunSector = null
          eventRunSource = null
        }
        renderEventRunDetail(loaded)
      } catch {
        // The open run keeps the laps it already shows.
      }
    }

    function closeEventRun() {
      currentEventRun = null
      expandedEventRunLap = null
      expandedEventRunSector = null
      eventRunSource = null
      eventRunLapMap = null
      setEventRunFeedback('')
      if (eventsRunSummary) {
        eventsRunSummary.replaceChildren()
        delete eventsRunSummary.dataset.eventId
        delete eventsRunSummary.dataset.eventMode
      }
      if (eventsRunLaps) eventsRunLaps.replaceChildren()
      setEventsView(currentEventId === null ? 'library' : 'detail')
      if (currentEventId === null) renderEventsLibrary()
      else {
        const event = eventsById.get(currentEventId)
        if (event) renderEventDetail(event)
        eventsDetailBack?.focus()
      }
    }

    function renderEventRecorder() {
      const event = currentEventId === null ? null : eventsById.get(currentEventId)
      const isSelected = Boolean(event && recorderState.eventId === event.id)
      const recording = isSelected && recorderState.recording === true
      const recordingAnotherEvent = Boolean(recorderState.recording && !isSelected)
      const state = isSelected ? recorderState.state || (recording ? 'recording' : 'stopped') : 'stopped'
      const finalizing = isSelected && state === 'finalizing'
      if (eventRecorderStatus) {
        eventRecorderStatus.dataset.state = state
        eventRecorderStatus.textContent = state.toUpperCase()
        eventRecorderStatus.hidden = !recording && !finalizing
      }
      if (eventRecorderToggle) {
        eventRecorderToggle.textContent = finalizing ? 'FINALIZING' : recording ? 'STOP' : 'RECORD RUN'
        eventRecorderToggle.classList.toggle('settings-button--danger', recording)
        eventRecorderToggle.classList.toggle('event-recorder__record', !recording && !finalizing)
        eventRecorderToggle.setAttribute('aria-pressed', String(recording))
        eventRecorderToggle.disabled = recordingAnotherEvent || finalizing
      }
      if (eventRecorderHint) {
        const sprintWarning = 'Sprint: keep recording armed between attempts, then press STOP.'
        const hint = recordingAnotherEvent
          ? `Recording Event ${recorderState.eventId}. Open that event to stop capture.`
          : finalizing
            ? 'Checking post-finish telemetry for the game-reported result.'
            : sprintWarning
        eventRecorderHint.textContent = hint
        eventRecorderHint.dataset.tone = !recordingAnotherEvent && !finalizing ? 'warning' : ''
      }
      renderEventRuns()
    }

    async function loadEventRuns(eventId = currentEventId) {
      const key = eventKey(eventId)
      if (!key) return false
      try {
        const nativeEventId = Number.isFinite(Number(key)) ? Math.round(Number(key)) : key
        currentEventRuns = normalizeEventRunsPayload(await call('load_event_runs', { eventId: nativeEventId }))
        if (currentEventRuns.some(updateEventLastRecordedAt)) renderEventsLibrary()
        renderEventRuns()
        void loadEventTheoreticalBest(key)
        if (eventsView === 'run' && currentEventRun) {
          const refreshed = currentEventRuns.find(run => run.id === currentEventRun.id)
          if (refreshed) {
            currentEventRun = refreshed
            renderEventRunDetail(refreshed)
          }
        }
        return true
      } catch (error) {
        currentEventRuns = []
        renderEventRuns()
        setStatus(error.message || 'Unable to load event runs', true)
        return false
      }
    }

    async function sendRecorderConfig(action) {
      const event = currentEventId === null ? null : eventsById.get(currentEventId)
      const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
      if (!event || !eventApi || typeof eventApi.emit !== 'function') {
        setStatus('EVENT RECORDER IS UNAVAILABLE', true)
        return false
      }
      try {
        if (action === 'record') clearEventRecorderFeedback()
        await eventApi.emit('event_recorder_config', {
          action,
          eventId: event.id,
          eventName: event.name,
          armedAt: action === 'record' ? Date.now() : undefined
        })
        recorderState = { ...recorderState, eventId: event.id, recording: action === 'record', state: action === 'record' ? 'armed' : 'stopped' }
        renderEventRecorder()
        setStatus(action === 'record' ? 'EVENT RECORDING ARMED' : 'EVENT RECORDING STOPPED')
        return true
      } catch (error) {
        setStatus(error.message || 'Unable to update event recorder', true)
        return false
      }
    }

    async function loadEvents() {
      try {
        const result = await call('load_events')
        eventsById.clear()
        for (const event of normalizeEventsPayload(result)) eventsById.set(event.id, event)
        // The Events command intentionally returns event metadata only. Reuse the
        // existing run list command to derive the latest recorded date for sorting.
        try {
          applyEventRunDates(normalizeEventRunsPayload(await call('load_event_runs', { eventId: null })))
        } catch {
          // Sorting by ID remains available if run metadata cannot be loaded.
        }
        renderEventsLibrary()
        return true
      } catch (error) {
        renderEventsLibrary()
        setStatus(error.message || 'Unable to load events', true)
        return false
      }
    }

    async function openEventDetail(id) {
      const key = eventKey(id)
      if (!key) return false
      let event = eventsById.get(key) || null
      try {
        const loaded = normalizeEvent(await call('load_event', {
          eventId: nativeEventId(event?.id ?? id)
        }))
        if (loaded) {
          event = { ...event, ...loaded }
          eventsById.set(loaded.id, event)
        }
      } catch (error) {
        if (!event) {
          setStatus(error.message || 'Unable to load event', true)
          return false
        }
      }
      if (!event) return false
      currentEventId = event.id
      // A response for the previously open Event must not fill the theory of this one.
      currentEventTheory = null
      eventTheoryRequestSequence += 1
      currentEventRun = null
      clearEventRecorderFeedback()
      setEventsCreateOpen(false)
      renderEventDetail(event)
      setEventsView('detail')
      eventsDetailBack?.focus()
      void loadEventRuns(event.id)
      return true
    }

    function closeEventDetail() {
      if (eventsView === 'run') {
        closeEventRun()
        return
      }
      currentEventId = null
      if (eventsDetailSummary) {
        eventsDetailSummary.replaceChildren()
        delete eventsDetailSummary.dataset.eventId
        delete eventsDetailSummary.dataset.eventMode
      }
      if (eventsDetailNotes) eventsDetailNotes.hidden = true
      if (eventsDetailNotesValue) eventsDetailNotesValue.textContent = ''
      currentEventRuns = []
      currentEventTheory = null
      eventTheoryRequestSequence += 1
      currentEventRun = null
      setEventsView('library')
      renderEventsLibrary()
    }

    async function createEvent() {
      if (!eventsCreateForm?.checkValidity()) {
        eventsCreateForm?.reportValidity()
        return false
      }
      const payload = {
        name: eventName.value.trim(),
        class: eventClass.value,
        route: eventRouteType.value,
        mode: eventMode.value,
        notes: eventNotes.value.trim()
      }
      if (!payload.name) {
        eventName.setCustomValidity('Event name is required')
        eventName.reportValidity()
        eventName.setCustomValidity('')
        return false
      }
      try {
        const result = await call('create_event', payload)
        const created = normalizeEvent(result)
        const resultId = eventIdFrom(result)
        const event = created
          ? { ...created, ...payload, id: created.id }
          : normalizeEvent({ ...payload, id: resultId })
        if (!event) throw new Error('Create event did not return an event id')
        eventsById.set(event.id, event)
        resetEventCreateForm()
        setEventsCreateOpen(false)
        currentEventId = event.id
        renderEventDetail(event)
        setEventsView('detail')
        eventsDetailBack?.focus()
        void loadEventRuns(event.id)
        setStatus('EVENT CREATED')
        return true
      } catch (error) {
        setStatus(error.message || 'Unable to create event', true)
        return false
      }
    }

    function beginEventRename() {
      const event = currentEventId === null ? null : eventsById.get(currentEventId)
      if (!event || !eventsDetailTitle) return
      const input = document.createElement('input')
      input.className = 'events-detail-view__title-input'
      input.type = 'text'
      input.value = event.name
      input.setAttribute('aria-label', `Name for ${event.name}`)
      eventsDetailTitle.replaceWith(input)
      input.focus()
      let finished = false
      const finish = save => {
        if (finished) return
        finished = true
        const nextName = input.value.trim()
        input.replaceWith(eventsDetailTitle)
        if (save && nextName && nextName !== event.name) void renameEvent(event.id, nextName)
        if (save && !nextName) setStatus('EVENT NAME REQUIRED', true)
      }
      input.addEventListener('keydown', eventKeyDown => {
        if (eventKeyDown.key === 'Enter') {
          eventKeyDown.preventDefault()
          finish(true)
        }
        if (eventKeyDown.key === 'Escape') {
          eventKeyDown.preventDefault()
          finish(false)
        }
      })
      input.addEventListener('blur', () => finish(true), { once: true })
    }

    async function renameEvent(id, name) {
      const key = eventKey(id)
      const event = key ? eventsById.get(key) : null
      if (!event || !name) return false
      const previousName = event.name
      event.name = name
      renderEventDetail(event)
      renderEventsLibrary()
      try {
        const result = await call('rename_event', { eventId: nativeEventId(event.id), name })
        const returned = normalizeEvent(result)
        if (returned) eventsById.set(returned.id, { ...event, ...returned, name })
        renderEventDetail(eventsById.get(key))
        renderEventsLibrary()
        setStatus('EVENT NAME SAVED')
        return true
      } catch (error) {
        event.name = previousName
        renderEventDetail(event)
        renderEventsLibrary()
        setStatus(error.message || 'Unable to rename event', true)
        return false
      }
    }

    async function deleteCurrentEvent() {
      const event = currentEventId === null ? null : eventsById.get(currentEventId)
      if (!event) return false
      if (!(await confirmDestructive(`Delete event “${event.name}”?`))) return false
      try {
        await call('delete_event', { eventId: nativeEventId(event.id) })
        eventsById.delete(event.id)
        closeEventDetail()
        setStatus('EVENT DELETED')
        return true
      } catch (error) {
        setStatus(error.message || 'Unable to delete event', true)
        return false
      }
    }

  // Escape closes the innermost open Events layer. It returns false when none is open, so the
  // caller can fall through to its own Escape handling.
  function handleEscape(event) {
    if (eventsDiscardConfirmOpen) {
      event.preventDefault()
      setEventsDiscardConfirmOpen(false)
      eventsCreateCancel?.focus()
      return true
    }
    if (eventsView === 'library' && eventsCreateOpen) {
      event.preventDefault()
      requestEventsCreateClose()
      return true
    }
    if (eventsView === 'run') {
      event.preventDefault()
      // Escape peels one layer at a time: the focused sector, then the expanded lap, then the run.
      if (expandedEventRunSector !== null) {
        eventRunLapMap?.focusSector?.(null)
        expandedEventRunSector = null
        syncEventRunSectorFocus()
        return true
      }
      if (expandedEventRunLap !== null) {
        expandedEventRunLap = null
        eventRunSource = null
        setEventRunFeedback('')
        if (currentEventRun) renderEventRunDetail(currentEventRun)
        return true
      }
      closeEventRun()
      return true
    }
    if (eventsView === 'detail') {
      event.preventDefault()
      closeEventDetail()
      return true
    }
    return false
  }

    eventsCreateToggle?.addEventListener('click', () => {
      if (eventsCreateOpen) requestEventsCreateClose()
      else setEventsCreateOpen(true)
    })
    eventsCreateCancel?.addEventListener('click', requestEventsCreateClose)

    eventsDiscardYes?.addEventListener('click', closeEventsCreate)
    eventsDiscardNo?.addEventListener('click', () => {
      setEventsDiscardConfirmOpen(false)
      eventsCreateCancel?.focus()
    })
    eventsCreateForm?.addEventListener('submit', event => {
      event.preventDefault()
      void createEvent()
    })
    eventsSortValue = readEventsSort()
    renderEventsSort()
    eventsSort?.addEventListener('change', () => setEventsSort(eventsSort.value))
    for (const button of eventRunSortButtons) {
      button.addEventListener('click', () => setEventRunsSort(button.dataset.runSort))
    }
    eventsDetailBack?.addEventListener('click', closeEventDetail)
    eventsRunBack?.addEventListener('click', closeEventRun)
    // The show/hide choice is temporary: it lasts until the Configuration window is reloaded.
    eventsTheoryToggle?.addEventListener('click', () => {
      eventTheoryOpen = !eventTheoryOpen
      renderEventTheory()
    })
    eventsRunLapSort?.addEventListener('click', () => {
      eventRunLapSortDirection = eventRunLapSortDirection === 'desc' ? 'asc' : 'desc'
      if (currentEventRun) renderEventRunDetail(currentEventRun)
    })
    eventsDetailTitle?.addEventListener('click', beginEventRename)
    eventsDetailDelete?.addEventListener('click', () => void deleteCurrentEvent())
    eventRecorderToggle?.addEventListener('click', () => {
      void sendRecorderConfig(recorderState.recording === true ? 'stop' : 'record')
    })

    return {
      listenEventRecorderEvents,
      renderEventsLibrary,
      renderEventRuns,
      renderEventRunDetail,
      loadEvents,
      openEventDetail,
      closeEventDetail,
      openEventRun,
      closeEventRun,
      handleEscape,
      getCurrentEventRuns: () => currentEventRuns,
      setCurrentEventRuns: value => { currentEventRuns = value },
      getCurrentEventRun: () => currentEventRun,
      setCurrentEventRun: value => { currentEventRun = value },
      getEventsView: () => eventsView,
      getRecorderState: () => recorderState
    }
  }

  return {
    create,
    eventKey,
    nativeEventId,
    eventIdFrom,
    eventText,
    normalizeEvent,
    normalizeEventsPayload,
    eventModeKey,
    eventModeLabel,
    eventRouteLabel,
    eventIdCompare,
    eventDateMs,
    runId,
    runTimeMs,
    finiteNumber,
    normalizePedal,
    normalizeTracePoints,
    normalizeEventRun,
    normalizeEventRunsPayload,
    formatRunTime,
    approximateRunResultTitle,
    isApproximateRunResult,
    formatRunResultTime,
    latestPersistedLap,
    savedRunTimeLabel,
    formatRunDate,
    runBestTimeMs,
    distinctTimeRanks,
    timeTone,
    runSectorBestTimes,
    runBestHypotheticalTimeMs,
    runDateMs,
    runIdCompare
  }
}))
