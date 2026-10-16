(function (globalScope, factory) {
  const api = factory(globalScope)
  if (typeof module !== 'undefined' && module.exports && typeof document === 'undefined') module.exports = api
  else globalScope.SettingsDriverAnalysis = api
}(typeof globalThis !== 'undefined' ? globalThis : this, globalScope => {
  'use strict'

  function formatDriverAnalysisDuration(durationMs) {
    const seconds = Math.max(0, Math.round((Number(durationMs) || 0) / 1000))
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return minutes > 0 ? `${minutes}m ${String(remainingSeconds).padStart(2, '0')}s` : `${remainingSeconds}s`
  }

  function formatDriverAnalysisDate(value) {
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return 'UNKNOWN TIME'
    return `${date.toLocaleDateString()} · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }

  function formatDriverAnalysisSize(value) {
    const bytes = Math.max(0, Number(value) || 0)
    if (bytes < 1024) return `${Math.round(bytes)} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
  }

  function driverAnalysisResultCopy(entry) {
    if (entry?.status === 'recording') {
      return {
        label: 'RECORDING IN PROGRESS',
        instruction: 'Press STOP to finish. The analysis and statistics appear here when the recording is saved.'
      }
    }
    if (entry?.result === 'issue' && entry.label) {
      return {
        label: entry.label,
        instruction: entry.instruction || 'Repeat the session before changing another part of your technique.'
      }
    }
    if (entry?.result === 'ambiguous') {
      return {
        label: 'NO DRIVER-DOMINANT PATTERN DETECTED',
        instruction: 'The recording could not separate driver input from vehicle behaviour.'
      }
    }
    if (entry?.result === 'no_recurring_problem') {
      return {
        label: 'NO RECURRING PROBLEM DETECTED',
        instruction: 'No single technique problem repeated often enough in this recording.'
      }
    }
    if (entry?.result === 'interrupted' || entry?.status === 'interrupted') {
      return {
        label: 'RECORDING INTERRUPTED',
        instruction: 'Only completed maneuvers were kept. Record another asphalt session for a reliable result.'
      }
    }
    return {
      label: 'NOT ENOUGH ELIGIBLE MANEUVERS',
      instruction: 'Record a longer asphalt session before changing technique.'
    }
  }

  function driverAnalysisHeadline(session) {
    const isIssue = session?.result === 'issue' && session?.label
    const patternSummary = isIssue ? null : globalScope.DriverAnalysisStats?.formatPatternSummary?.(session.stats)
    let label, instruction, result
    if (isIssue) {
      label = session.label
      instruction = session.instruction || 'Repeat the session before changing another part of your technique.'
      result = 'issue'
    } else if (patternSummary) {
      label = globalScope.DriverAnalysisStats?.formatPatternHeadline?.(patternSummary) || 'MOST FREQUENT'
      instruction = patternSummary.text
      result = 'most_frequent'
    } else {
      const copy = driverAnalysisResultCopy(session)
      label = copy.label
      instruction = copy.instruction
      result = session?.status === 'recording' ? 'recording' : session?.result || 'unknown'
    }
    return { label, instruction, result }
  }

  // The Driver Analysis tab of Configuration. settings.js calls create(ctx) once, below its view
  // marker, and keeps the names it still calls from the returned object. State that other areas
  // also read (settings, the state, the history, the HUD edit hotkey) stays in settings.js and is
  // reached through ctx.
  function create(ctx) {
    const {
      call,
      setStatus,
      confirmDestructive,
      renderTraceMap,
      updateOverlayToggle,
      setHudEditHotkeyCapture,
      isHudEditHotkeyCapturing,
      getHudEditHotkeySettings,
      getDriverAnalysisSettings,
      setDriverAnalysisSettings,
      getDriverAnalysisState,
      setDriverAnalysisState,
      getDriverAnalysisHistory,
      setDriverAnalysisHistory
    } = ctx
    const driverAnalysisApi = globalScope.DriverAnalysis
    const FdcVehicle = globalScope.FdcVehicle
    const driverAnalysisEnabled = document.getElementById('driver-analysis-enabled')
    const driverAnalysisRecord = document.getElementById('driver-analysis-record')
    const driverAnalysisRecordingStatus = document.getElementById('driver-analysis-recording-status')
    const driverAnalysisRecorderHint = document.getElementById('driver-analysis-recorder-hint')
    const driverAnalysisHotkeyValue = document.getElementById('driver-analysis-hotkey-value')
    const driverAnalysisHotkeyChange = document.getElementById('driver-analysis-hotkey-change')
    const driverAnalysisHistoryView = document.getElementById('driver-analysis-history-view')
    const driverAnalysisDetailView = document.getElementById('driver-analysis-detail-view')
    const driverAnalysisDetailBack = document.getElementById('driver-analysis-detail-back')
    const driverAnalysisDetailTitle = document.getElementById('driver-analysis-detail-title')
    const driverAnalysisDetailSummary = document.getElementById('driver-analysis-detail-summary')
    const driverAnalysisDetailBody = document.getElementById('driver-analysis-detail-body')
    const driverAnalysisHistoryList = document.getElementById('driver-analysis-history-list')
    const driverAnalysisHistoryEmpty = document.getElementById('driver-analysis-history-empty')
    const driverAnalysisHistoryCount = document.getElementById('driver-analysis-history-count')
    // Driver Analysis drive maps open with the errors and clean checks; ALL shows every layer.
    let driveMapLayerSelection = [...(globalScope.DriverAnalysisMap?.ERROR_TYPES || []), 'clean']
    let driverAnalysisHotkeyCapture = false
    let driverAnalysisHistoryPending = false
    let driverAnalysisExportPending = false
    let driverAnalysisExportingId = null
    let driverAnalysisActionPending = false

    // Summary tiles of the recording and car pages: a label above a large value.
    function driverAnalysisSummaryTiles(metrics) {
      const summary = document.createElement('div')
      summary.className = 'driver-analysis-detail-view__summary'
      for (const metric of metrics) {
        const tile = document.createElement('div')
        tile.className = 'driver-analysis-detail-view__summary-metric'
        const label = document.createElement('span')
        label.className = 'driver-analysis-detail-view__summary-label'
        label.textContent = metric.label
        const value = document.createElement('strong')
        value.className = 'driver-analysis-detail-view__summary-value'
        value.textContent = metric.value
        tile.append(label, value)
        summary.append(tile)
      }
      return summary
    }

    let driverAnalysisView = { level: 'history', recordingId: null, sessionId: null, driveId: null }

    const expandedDriverAnalysisStats = new Set()

    const driverAnalysisDriveMaps = new Map()

    const DRIVER_ANALYSIS_BACK_LABELS = {
      history: { text: '← HISTORY', ariaLabel: 'Back to history' },
      recording: { text: '← RECORDING', ariaLabel: 'Back to the recording' },
      car: { text: '← CAR', ariaLabel: 'Back to the car' }
    }

    function setDriverAnalysisView(next) {
      driverAnalysisView = next
      if (driverAnalysisHistoryView) driverAnalysisHistoryView.hidden = next.level !== 'history'
      if (driverAnalysisDetailView) driverAnalysisDetailView.hidden = next.level === 'history'
      // The header path names the page from this level (RECORDING, CAR, DRIVE).
      if (driverAnalysisDetailView) driverAnalysisDetailView.dataset.level = next.level
      if (driverAnalysisDetailBack && next.level !== 'history') {
        const label = DRIVER_ANALYSIS_BACK_LABELS[driverAnalysisParentLevel(next)]
        driverAnalysisDetailBack.textContent = label.text
        driverAnalysisDetailBack.setAttribute('aria-label', label.ariaLabel)
      }
      renderDriverAnalysisView()
      if (next.level !== 'history' && driverAnalysisDetailBack) driverAnalysisDetailBack.focus()
    }

    // The level BACK leads to. The back label and closeDriverAnalysisLevel both
    // use it, so they cannot disagree. A recording with one car opens its car
    // page directly, so that car page leads back to the history.
    function driverAnalysisParentLevel(view) {
      if (view.level === 'drive') return 'car'
      if (view.level === 'car') {
        const recordings = globalScope.DriverAnalysisHistory?.groupRecordings?.(getDriverAnalysisHistory()) || []
        const recording = recordings.find(r => String(r.recordingId) === view.recordingId)
        return recording && recording.sessions.length > 1 ? 'recording' : 'history'
      }
      return 'history'
    }

    function closeDriverAnalysisLevel() {
      const { level, recordingId, sessionId } = driverAnalysisView
      if (level === 'history') return
      const parentLevel = driverAnalysisParentLevel(driverAnalysisView)
      if (parentLevel === 'car') {
        setDriverAnalysisView({ level: 'car', recordingId, sessionId, driveId: null })
      } else if (parentLevel === 'recording') {
        setDriverAnalysisView({ level: 'recording', recordingId, sessionId: null, driveId: null })
      } else {
        setDriverAnalysisView({ level: 'history', recordingId: null, sessionId: null, driveId: null })
      }
    }

    function renderDriverAnalysisView() {
      if (driverAnalysisView.level === 'history') return
      const recordingId = String(driverAnalysisView.recordingId)
      const sessionId = String(driverAnalysisView.sessionId)
      const driveId = String(driverAnalysisView.driveId)
      const recordings = globalScope.DriverAnalysisHistory?.groupRecordings?.(getDriverAnalysisHistory()) || []
      const recording = recordings.find(r => String(r.recordingId) === recordingId)
      if (!recording) {
        setDriverAnalysisView({ level: 'history', recordingId: null, sessionId: null, driveId: null })
        return
      }
      const session = recording.sessions.find(s => String(s?.id) === sessionId)
      if (driverAnalysisView.level !== 'recording' && !session) {
        setDriverAnalysisView({ level: 'history', recordingId: null, sessionId: null, driveId: null })
        return
      }
      if (driverAnalysisDetailBody) driverAnalysisDetailBody.replaceChildren()
      if (driverAnalysisDetailSummary) driverAnalysisDetailSummary.replaceChildren()
      if (driverAnalysisDetailTitle) driverAnalysisDetailTitle.textContent = 'RECORDING'
      if (driverAnalysisView.level === 'recording') {
        const firstSession = recording.sessions[0]
        if (driverAnalysisDetailTitle) driverAnalysisDetailTitle.textContent = formatDriverAnalysisDate(firstSession?.recordedAt)
        const totalDurationMs = globalScope.DriverAnalysisHistory?.recordingDurationMs?.(recording.sessions) ?? 0
        const totalDrives = recording.sessions.reduce((sum, s) => sum + (Array.isArray(s?.drives) ? s.drives.length : 0), 0)
        const totalStorageBytes = recording.sessions.reduce((sum, s) => sum + (Number(s?.storageBytes) || 0), 0)
        driverAnalysisDetailBody?.append(driverAnalysisSummaryTiles([
          { label: 'DURATION', value: formatDriverAnalysisDuration(totalDurationMs) },
          { label: 'CARS', value: String(recording.sessions.length) },
          { label: 'DRIVES', value: String(totalDrives) },
          { label: 'STORAGE', value: formatDriverAnalysisSize(totalStorageBytes) }
        ]))
        const section = document.createElement('section')
        section.className = 'events-run-table-section'
        const heading = document.createElement('div')
        heading.className = 'events-run-table-section__heading'
        const headingH3 = document.createElement('h3')
        headingH3.textContent = 'CARS'
        const headingSpan = document.createElement('span')
        headingSpan.textContent = 'SELECT A CAR'
        heading.append(headingH3, headingSpan)
        section.append(heading)
        const tableWrap = document.createElement('div')
        tableWrap.className = 'events-run-table-wrap'
        const table = document.createElement('table')
        table.className = 'events-run-table'
        const caption = document.createElement('caption')
        caption.className = 'events-run-table__caption'
        caption.textContent = 'Select a car row to open its drives and statistics.'
        table.append(caption)
        const thead = document.createElement('thead')
        const headerRow = document.createElement('tr')
        for (const header of ['CAR', 'PI', 'DRIVETRAIN', 'DRIVES', 'DURATION', 'RESULT']) {
          const th = document.createElement('th')
          th.scope = 'col'
          th.textContent = header
          if (['DRIVES', 'DURATION'].includes(header)) th.className = 'events-run-table__end'
          headerRow.append(th)
        }
        thead.append(headerRow)
        table.append(thead)
        const tbody = document.createElement('tbody')
        for (const s of recording.sessions) {
          const row = document.createElement('tr')
          row.className = 'events-run-table__lap-row'
          row.tabIndex = 0
          const carLabel = FdcVehicle.displayName(s?.vehicleName, s?.vehicleIdentity?.ordinal)
          row.setAttribute('aria-label', `Open ${carLabel}`)
          row.addEventListener('click', () => {
            setDriverAnalysisView({ level: 'car', recordingId: String(recording.recordingId), sessionId: String(s?.id), driveId: null })
          })
          row.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            setDriverAnalysisView({ level: 'car', recordingId: String(recording.recordingId), sessionId: String(s?.id), driveId: null })
          })
          const carCell = document.createElement('th')
          carCell.scope = 'row'
          carCell.textContent = carLabel
          row.append(carCell)
          const pi = Number(s?.vehicleIdentity?.pi)
          const piCell = document.createElement('td')
          piCell.textContent = Number.isFinite(pi) ? String(pi) : '—'
          row.append(piCell)
          const drivetrain = globalScope.DriverAnalysisHistory?.drivetrainLabel?.(s?.vehicleIdentity?.drivetrain) || '—'
          const drivetrainCell = document.createElement('td')
          drivetrainCell.textContent = drivetrain
          row.append(drivetrainCell)
          const drivesCount = Array.isArray(s?.drives) ? s.drives.length : 0
          const drivesCell = document.createElement('td')
          drivesCell.className = 'events-run-table__end'
          drivesCell.textContent = String(drivesCount)
          row.append(drivesCell)
          const durationMs = Number(s?.durationMs) || 0
          const durationCell = document.createElement('td')
          durationCell.className = 'events-run-table__end'
          const durationTime = document.createElement('span')
          durationTime.className = 'events-run-table__time'
          durationTime.textContent = formatDriverAnalysisDuration(durationMs)
          durationCell.append(durationTime)
          row.append(durationCell)
          const resultCell = document.createElement('td')
          const headline = document.createElement('strong')
          const hd = driverAnalysisHeadline(s)
          headline.textContent = hd.label
          headline.dataset.result = hd.result
          resultCell.append(headline)
          row.append(resultCell)
          tbody.append(row)
        }
        table.append(tbody)
        tableWrap.append(table)
        section.append(tableWrap)
        driverAnalysisDetailBody?.append(section)
      } else if (driverAnalysisView.level === 'car') {
        const carLabel = FdcVehicle.displayName(session?.vehicleName, session?.vehicleIdentity?.ordinal)
        const pi = Number(session?.vehicleIdentity?.pi)
        const drivetrain = globalScope.DriverAnalysisHistory?.drivetrainLabel?.(session?.vehicleIdentity?.drivetrain) || ''
        if (driverAnalysisDetailTitle) driverAnalysisDetailTitle.textContent = carLabel
        const badges = []
        if (Number.isFinite(pi)) {
          const piBadge = document.createElement('span')
          piBadge.className = 'events-detail-view__badge'
          piBadge.textContent = `PI ${pi}`
          badges.push(piBadge)
        }
        if (drivetrain) {
          const drivetrainBadge = document.createElement('span')
          drivetrainBadge.className = 'events-detail-view__badge'
          drivetrainBadge.textContent = drivetrain
          badges.push(drivetrainBadge)
        }
        const drivesCount = Array.isArray(session?.drives) ? session.drives.length : 0
        const drivesBadge = document.createElement('span')
        drivesBadge.className = 'events-detail-view__badge'
        drivesBadge.textContent = `${drivesCount} ${drivesCount === 1 ? 'DRIVE' : 'DRIVES'}`
        badges.push(drivesBadge)
        const durationMs = Number(session?.durationMs) || 0
        const durationBadge = document.createElement('span')
        durationBadge.className = 'events-detail-view__badge'
        durationBadge.textContent = session?.status === 'recording' ? 'LIVE' : formatDriverAnalysisDuration(durationMs)
        badges.push(durationBadge)
        const recordedDate = new Date(session?.recordedAt)
        if (Number.isFinite(recordedDate.getTime())) {
          const dateBadge = document.createElement('span')
          dateBadge.className = 'events-detail-view__badge'
          dateBadge.textContent = recordedDate.toLocaleDateString()
          badges.push(dateBadge)
        }
        if (driverAnalysisDetailSummary) driverAnalysisDetailSummary.append(...badges)
        const hd = driverAnalysisHeadline(session)
        const resultSection = document.createElement('section')
        resultSection.className = 'driver-analysis-detail-view__result'
        const resultLabel = document.createElement('span')
        resultLabel.className = 'driver-analysis-detail-view__result-label'
        resultLabel.textContent = 'RESULT'
        const resultHeadline = document.createElement('strong')
        resultHeadline.className = 'driver-analysis-detail-view__result-headline'
        resultHeadline.textContent = hd.label
        resultHeadline.dataset.result = hd.result
        resultSection.append(resultLabel, resultHeadline)
        if (hd.instruction) {
          const resultText = document.createElement('p')
          resultText.className = 'driver-analysis-detail-view__result-text'
          resultText.textContent = hd.instruction
          resultSection.append(resultText)
        }
        driverAnalysisDetailBody?.append(resultSection)
        const summaryMetrics = globalScope.DriverAnalysisStats?.formatSummaryMetrics?.(session.stats) || []
        if (summaryMetrics.length > 0) driverAnalysisDetailBody?.append(driverAnalysisSummaryTiles(summaryMetrics))
        const statsRows = globalScope.DriverAnalysisStats?.formatStatsRows?.(session.stats) || []
        if (statsRows.length > 0) {
          const statsToggleButton = document.createElement('button')
          statsToggleButton.type = 'button'
          statsToggleButton.className = 'settings-button driver-analysis-detail-view__stats-toggle'
          const statsExpanded = expandedDriverAnalysisStats.has(sessionId)
          statsToggleButton.textContent = statsExpanded ? 'HIDE' : 'STATS'
          statsToggleButton.setAttribute('aria-expanded', String(statsExpanded))
          driverAnalysisDetailBody?.append(statsToggleButton)
          const statsPanel = document.createElement('div')
          statsPanel.className = 'driver-analysis-detail-view__stats'
          statsPanel.hidden = !statsExpanded
          for (const statsRow of statsRows) {
            const section = document.createElement('section')
            section.className = 'events-run-table-section'
            const sectionHeading = document.createElement('div')
            sectionHeading.className = 'events-run-table-section__heading'
            const sectionH3 = document.createElement('h3')
            sectionH3.textContent = statsRow.count !== null && Number.isFinite(statsRow.count)
              ? `${statsRow.label} (${statsRow.count})`
              : statsRow.label
            if (statsRow.title) section.title = statsRow.title
            sectionHeading.append(sectionH3)
            section.append(sectionHeading)
            if (Array.isArray(statsRow.items) && statsRow.items.length > 0) {
              const tableWrap = document.createElement('div')
              tableWrap.className = 'events-run-table-wrap'
              const table = document.createElement('table')
              table.className = 'events-run-table'
              const tbody = document.createElement('tbody')
              for (const item of statsRow.items) {
                const itemRow = document.createElement('tr')
                const nameCell = document.createElement('th')
                nameCell.scope = 'row'
                nameCell.textContent = item.name
                itemRow.append(nameCell)
                const valueCell = document.createElement('td')
                const valueSpan = document.createElement('span')
                valueSpan.className = 'events-run-table__time'
                valueSpan.textContent = item.value
                valueCell.append(valueSpan)
                itemRow.append(valueCell)
                tbody.append(itemRow)
              }
              table.append(tbody)
              tableWrap.append(table)
              section.append(tableWrap)
            }
            statsPanel.append(section)
          }
          statsToggleButton.addEventListener('click', () => {
            const isExpanded = statsToggleButton.getAttribute('aria-expanded') === 'true'
            statsToggleButton.setAttribute('aria-expanded', String(!isExpanded))
            statsToggleButton.textContent = isExpanded ? 'STATS' : 'HIDE'
            statsPanel.hidden = isExpanded
            if (isExpanded) expandedDriverAnalysisStats.delete(sessionId)
            else expandedDriverAnalysisStats.add(sessionId)
          })
          driverAnalysisDetailBody?.append(statsPanel)
        }
        const drivesRecorded = session?.drivesRecorded !== false
        if (drivesRecorded && Array.isArray(session?.drives) && session.drives.length > 0) {
          const drivesSection = document.createElement('section')
          drivesSection.className = 'events-run-table-section'
          const drivesHeading = document.createElement('div')
          drivesHeading.className = 'events-run-table-section__heading'
          const drivesH3 = document.createElement('h3')
          drivesH3.textContent = 'DRIVES'
          const drivesSpan = document.createElement('span')
          drivesSpan.textContent = 'SELECT A DRIVE TO OPEN ITS MAP'
          drivesHeading.append(drivesH3, drivesSpan)
          drivesSection.append(drivesHeading)
          const tableWrap = document.createElement('div')
          tableWrap.className = 'events-run-table-wrap'
          const drivesTable = document.createElement('table')
          drivesTable.className = 'events-run-table'
          const caption = document.createElement('caption')
          caption.className = 'events-run-table__caption'
          caption.textContent = 'Select a drive row to open its map.'
          drivesTable.append(caption)
          const thead = document.createElement('thead')
          const headerRow = document.createElement('tr')
          for (const colHeader of ['ID', 'TYPE', 'DURATION', 'START', 'ERRORS']) {
            const th = document.createElement('th')
            th.scope = 'col'
            th.textContent = colHeader
            if (colHeader === 'START') th.className = 'events-run-table__end'
            headerRow.append(th)
          }
          thead.append(headerRow)
          drivesTable.append(thead)
          const tbody = document.createElement('tbody')
          for (const drive of session.drives) {
            const driveRow = document.createElement('tr')
            const driveKey = String(drive?.id)
            driveRow.className = 'events-run-table__lap-row'
            driveRow.tabIndex = 0
            driveRow.setAttribute('aria-label', `Open drive ${driveKey} map`)
            driveRow.addEventListener('click', () => {
              setDriverAnalysisView({ level: 'drive', recordingId, sessionId, driveId: driveKey })
            })
            driveRow.addEventListener('keydown', event => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              setDriverAnalysisView({ level: 'drive', recordingId, sessionId, driveId: driveKey })
            })
            const idCell = document.createElement('th')
            idCell.scope = 'row'
            idCell.textContent = String(drive?.id || '')
            driveRow.append(idCell)
            const typeCell = document.createElement('td')
            typeCell.textContent = globalScope.DriverAnalysisHistory?.driveTypeLabel?.(drive) || 'UNKNOWN'
            driveRow.append(typeCell)
            const durationCell = document.createElement('td')
            const durationSpan = document.createElement('span')
            durationSpan.className = 'events-run-table__time'
            durationSpan.textContent = globalScope.DriverAnalysisHistory?.formatDriveDuration?.(drive?.durationMs) || '00:00'
            durationCell.append(durationSpan)
            driveRow.append(durationCell)
            const startCell = document.createElement('td')
            startCell.className = 'events-run-table__end'
            const startTime = new Date(drive?.startedWallMs)
            startCell.textContent = Number.isFinite(startTime.getTime())
              ? startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '—'
            driveRow.append(startCell)
            const errorsCell = document.createElement('td')
            const errorCount = globalScope.DriverAnalysisHistory?.driveErrorCount?.(drive) || 0
            errorsCell.textContent = errorCount > 0 ? String(errorCount) : '—'
            driveRow.append(errorsCell)
            tbody.append(driveRow)
          }
          drivesTable.append(tbody)
          tableWrap.append(drivesTable)
          drivesSection.append(tableWrap)
          driverAnalysisDetailBody?.append(drivesSection)
        } else if (!drivesRecorded) {
          const noRecordMsg = document.createElement('div')
          noRecordMsg.className = 'settings-empty'
          noRecordMsg.textContent = 'RECORDED BEFORE DRIVES'
          driverAnalysisDetailBody?.append(noRecordMsg)
        } else if (Array.isArray(session?.drives) && session.drives.length === 0 && drivesRecorded) {
          const noRacesMsg = document.createElement('div')
          noRacesMsg.className = 'settings-empty'
          noRacesMsg.textContent = 'NO RACES IN THIS RECORDING'
          driverAnalysisDetailBody?.append(noRacesMsg)
        }
      } else if (driverAnalysisView.level === 'drive') {
        const drive = session.drives.find(d => String(d?.id) === driveId)
        if (!drive) {
          setDriverAnalysisView({ level: 'car', recordingId, sessionId, driveId: null })
          return
        }
        const carLabel = FdcVehicle.displayName(session?.vehicleName, session?.vehicleIdentity?.ordinal)
        if (driverAnalysisDetailTitle) driverAnalysisDetailTitle.textContent = `DRIVE ${drive?.id || ''}`
        const badges = []
        const carBadge = document.createElement('span')
        carBadge.className = 'events-detail-view__badge'
        carBadge.textContent = carLabel
        badges.push(carBadge)
        const driveTypeBadge = document.createElement('span')
        driveTypeBadge.className = 'events-detail-view__badge'
        driveTypeBadge.textContent = globalScope.DriverAnalysisHistory?.driveTypeLabel?.(drive) || 'UNKNOWN'
        badges.push(driveTypeBadge)
        const startTime = new Date(drive?.startedWallMs)
        const timeBadge = document.createElement('span')
        timeBadge.className = 'events-detail-view__badge'
        timeBadge.textContent = Number.isFinite(startTime.getTime())
          ? startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '—'
        badges.push(timeBadge)
        const errorCount = globalScope.DriverAnalysisHistory?.driveErrorCount?.(drive) || 0
        if (driverAnalysisDetailSummary) driverAnalysisDetailSummary.append(...badges)
        const meta = document.createElement('div')
        meta.className = 'events-run-view__meta'
        const durationMetric = document.createElement('div')
        durationMetric.className = 'events-run-view__metric'
        const durationLabel = document.createElement('div')
        durationLabel.className = 'events-run-view__metric-label'
        durationLabel.textContent = 'DURATION'
        const durationValue = document.createElement('div')
        durationValue.className = 'events-run-view__metric-value'
        durationValue.textContent = globalScope.DriverAnalysisHistory?.formatDriveDuration?.(drive?.durationMs) || '00:00'
        durationMetric.append(durationLabel, durationValue)
        const errorsMetric = document.createElement('div')
        errorsMetric.className = 'events-run-view__metric events-run-view__metric--run'
        const errorsLabel = document.createElement('div')
        errorsLabel.className = 'events-run-view__metric-label'
        errorsLabel.textContent = 'ERRORS'
        const errorsValue = document.createElement('div')
        errorsValue.className = 'events-run-view__metric-value'
        errorsValue.textContent = String(errorCount)
        errorsMetric.append(errorsLabel, errorsValue)
        meta.append(durationMetric, errorsMetric)
        driverAnalysisDetailBody?.append(meta)
        const mapWrap = document.createElement('div')
        mapWrap.className = 'events-run-table-wrap'
        const mapDetail = document.createElement('div')
        mapDetail.className = 'events-lap-detail'
        mapDetail.append(driverAnalysisDriveMap(session, drive))
        mapWrap.append(mapDetail)
        driverAnalysisDetailBody?.append(mapWrap)
      }
    }

    async function deleteDriverAnalysisRecording(recording) {
      if (!recording || !Array.isArray(recording.sessions) || recording.sessions.length === 0) return false
      if (driverAnalysisHistoryPending || driverAnalysisExportPending) return false
      if (!(await confirmDestructive('Delete this Driver Analysis recording, all its cars, and saved telemetry?'))) return false
      if (driverAnalysisHistoryPending || driverAnalysisExportPending) return false
      driverAnalysisHistoryPending = true
      renderDriverAnalysisHistory()
      const sessionIds = recording.sessions.map(s => Number(s?.id)).filter(id => Number.isSafeInteger(id) && id > 0)
      try {
        await call('delete_driver_analysis_recording', { recordingId: Number(recording.recordingId) })
        setDriverAnalysisHistory(getDriverAnalysisHistory().filter(session => !sessionIds.includes(Number(session?.id))))
        const recordingId = String(recording.recordingId)
        if (driverAnalysisView.recordingId === recordingId) {
          setDriverAnalysisView({ level: 'history', recordingId: null, sessionId: null, driveId: null })
        }
        renderDriverAnalysisHistory()
        setStatus('DRIVER ANALYSIS RECORDING DELETED')
        return true
      } catch (error) {
        setStatus(error.message || 'Unable to delete Driver Analysis recording', true)
        return false
      } finally {
        driverAnalysisHistoryPending = false
        renderDriverAnalysisHistory()
      }
    }

    async function exportDriverAnalysisRecording(recording) {
      if (!recording || !Array.isArray(recording.sessions) || recording.sessions.length === 0) return false
      if (driverAnalysisHistoryPending || driverAnalysisExportPending) return false
      driverAnalysisExportPending = true
      driverAnalysisExportingId = Number(recording.recordingId)
      renderDriverAnalysisHistory()
      try {
        const fileName = globalScope.DriverAnalysisHistory.exportFileName(recording.sessions[0]?.recordedAt)
        const outcome = await call('export_driver_analysis_recording', { recordingId: Number(recording.recordingId), fileName })
        if (outcome?.cancelled) return false
        const size = formatDriverAnalysisSize(outcome?.bytes)
        setStatus(`DRIVER ANALYSIS RECORDING EXPORTED · ${size}`)
        return true
      } catch (error) {
        setStatus(error?.message || (typeof error === 'string' && error) || 'Unable to export Driver Analysis recording', true)
        return false
      } finally {
        driverAnalysisExportPending = false
        driverAnalysisExportingId = null
        renderDriverAnalysisHistory()
      }
    }

    function renderDriverAnalysisHistory(history = getDriverAnalysisHistory()) {
      if (!driverAnalysisHistoryList) return
      const entries = Array.isArray(history) ? history : []
      setDriverAnalysisHistory(entries)
      driverAnalysisHistoryList.replaceChildren()
      if (driverAnalysisHistoryEmpty) driverAnalysisHistoryEmpty.hidden = entries.length > 0

      const recordings = globalScope.DriverAnalysisHistory?.groupRecordings?.(entries) || []
      if (driverAnalysisHistoryCount) {
        driverAnalysisHistoryCount.textContent = `${recordings.length} ${recordings.length === 1 ? 'RECORDING' : 'RECORDINGS'}`
      }

      for (const recording of recordings) {
        const recordingId = String(recording.recordingId)
        const firstSession = recording.sessions[0]
        const hasUnfinishedSessions = recording.sessions.some(s => s?.status === 'recording')

        const row = document.createElement('article')
        row.className = 'driver-analysis-history-row'
        row.dataset.recordingId = recordingId

        const meta = document.createElement('div')
        meta.className = 'driver-analysis-history-row__meta'
        const date = document.createElement('time')
        const recordedDate = new Date(firstSession?.recordedAt)
        date.dateTime = Number.isFinite(recordedDate.getTime()) ? recordedDate.toISOString() : ''
        date.textContent = formatDriverAnalysisDate(firstSession?.recordedAt)

        const totalDurationMs = globalScope.DriverAnalysisHistory?.recordingDurationMs?.(recording.sessions) ?? 0
        const duration = document.createElement('span')
        duration.textContent = hasUnfinishedSessions ? 'LIVE' : formatDriverAnalysisDuration(totalDurationMs)

        const totalStorageBytes = recording.sessions.reduce((sum, s) => sum + (Number(s?.storageBytes) || 0), 0)
        const storage = document.createElement('span')
        storage.textContent = formatDriverAnalysisSize(totalStorageBytes)

        const totalDrives = recording.sessions.reduce((sum, s) => sum + (Array.isArray(s?.drives) ? s.drives.length : 0), 0)
        const carsDrivesLabel = document.createElement('span')
        carsDrivesLabel.className = 'driver-analysis-history-row__cars-drives'
        const carCount = recording.sessions.length
        const driveText = totalDrives === 1 ? '1 DRIVE' : (totalDrives > 0 ? `${totalDrives} DRIVES` : '')
        carsDrivesLabel.textContent = `${carCount} ${carCount === 1 ? 'CAR' : 'CARS'}${driveText ? ' · ' + driveText : ''}`

        meta.append(date, duration, storage, carsDrivesLabel)

        const finding = document.createElement('div')
        finding.className = 'driver-analysis-history-row__finding'

        for (const session of recording.sessions) {
          const sessionLine = document.createElement('div')
          sessionLine.className = 'driver-analysis-history-row__session-line'

          const carName = FdcVehicle.displayName(session?.vehicleName, session?.vehicleIdentity?.ordinal)
          const sessionCarLabel = document.createElement('span')
          sessionCarLabel.className = 'driver-analysis-history-row__session-car'
          sessionCarLabel.textContent = carName

          const headline = document.createElement('strong')
          const hd = driverAnalysisHeadline(session)
          headline.textContent = hd.label
          headline.dataset.result = hd.result

          sessionLine.append(sessionCarLabel, document.createTextNode(' — '), headline)
          finding.append(sessionLine)
        }

        // Totals across different cars say little, so only a single-car card shows them.
        const summaryText = recording.sessions.length === 1
          ? globalScope.DriverAnalysisHistory?.recordingSummary?.(recording.sessions) || ''
          : ''
        if (summaryText) {
          const summary = document.createElement('div')
          summary.className = 'driver-analysis-history-row__summary'
          summary.textContent = summaryText
          finding.append(summary)
        }

        row.append(meta, finding)

        const actions = document.createElement('div')
        actions.className = 'driver-analysis-history-row__actions'
        if (recording.sessions.length > 0 && !hasUnfinishedSessions) {
          const detailsButton = document.createElement('button')
          detailsButton.type = 'button'
          detailsButton.className = 'settings-button settings-button--ready driver-analysis-history-row__details-toggle'
          detailsButton.textContent = 'DETAILS'
          detailsButton.addEventListener('click', () => {
            if (recording.sessions.length === 1) {
              setDriverAnalysisView({ level: 'car', recordingId, sessionId: String(recording.sessions[0]?.id), driveId: null })
            } else {
              setDriverAnalysisView({ level: 'recording', recordingId, sessionId: null, driveId: null })
            }
          })
          actions.append(detailsButton)
        }

        const actionsBlocked = driverAnalysisHistoryPending || driverAnalysisExportPending || hasUnfinishedSessions || getDriverAnalysisState().recording === true
        const firstDate = formatDriverAnalysisDate(firstSession?.recordedAt)
        const exportButton = document.createElement('button')
        exportButton.className = 'settings-button driver-analysis-history-row__export'
        exportButton.type = 'button'
        const isExporting = driverAnalysisExportPending && driverAnalysisExportingId === Number(recording.recordingId)
        if (isExporting) {
          exportButton.textContent = 'EXPORTING…'
          exportButton.classList.add('is-exporting')
          exportButton.setAttribute('aria-busy', 'true')
        } else {
          exportButton.textContent = 'EXPORT'
        }
        exportButton.disabled = actionsBlocked
        exportButton.setAttribute('aria-label', `Export Driver Analysis recording from ${firstDate}`)
        exportButton.addEventListener('click', () => void exportDriverAnalysisRecording(recording))
        const remove = document.createElement('button')
        remove.className = 'settings-button settings-button--danger driver-analysis-history-row__delete'
        remove.type = 'button'
        remove.textContent = 'DELETE'
        remove.disabled = actionsBlocked
        remove.setAttribute('aria-label', `Delete Driver Analysis recording from ${firstDate}`)
        remove.addEventListener('click', () => void deleteDriverAnalysisRecording(recording))
        actions.append(exportButton, remove)

        row.append(actions)
        driverAnalysisHistoryList.append(row)
      }
    }

    // A drive map is built once from the stored samples and checks of that drive and kept while Configuration is open.
    function driverAnalysisDriveMap(session, drive) {
      const key = String(drive?.id)
      const cached = driverAnalysisDriveMaps.get(key)
      if (cached?.element) return cached.element
      const holder = document.createElement('div')
      holder.className = 'driver-analysis-history-row__drive-map'
      const status = document.createElement('p')
      status.className = 'events-lap-detail__empty'
      status.textContent = cached?.error ? 'THE DRIVE MAP COULD NOT BE LOADED' : 'LOADING DRIVE MAP…'
      holder.append(status)
      if (!cached) {
        driverAnalysisDriveMaps.set(key, { loading: true })
        void loadDriverAnalysisDriveMap(session, drive).then(element => {
          driverAnalysisDriveMaps.set(key, { element })
          renderDriverAnalysisView()
        }).catch(() => {
          driverAnalysisDriveMaps.set(key, { error: true })
          renderDriverAnalysisView()
        })
      }
      return holder
    }

    async function loadDriverAnalysisDriveMap(session, drive) {
      const sessionId = Number(session?.id)
      const lastSequence = Number(drive?.lastSequence)
      const samples = []
      let afterSequence = Number(drive?.firstSequence) - 1
      while (afterSequence < lastSequence) {
        const page = await call('load_driver_analysis_samples', { sessionId, afterSequence, limit: 5000 })
        if (!Array.isArray(page) || page.length === 0) break
        samples.push(...page.filter(sample => Number(sample?.sequence) <= lastSequence))
        afterSequence = Number(page.at(-1)?.sequence)
        if (page.length < 5000) break
      }
      const checks = await call('load_driver_analysis_checks', {
        sessionId,
        startedAtMs: Number(drive?.startedAtMs),
        finishedAtMs: Number(drive?.finishedAtMs)
      })
      const mapApi = globalScope.DriverAnalysisMap
      const points = mapApi?.tracePointsFromSamples(samples) || []
      return renderTraceMap(points, Number(drive?.durationMs), {
        marks: mapApi?.checkMarks(Array.isArray(checks) ? checks : [], points) || { errors: [], clean: [] },
        // Sector ticks need a finish for a sprint; a circuit shows its first completed lap even when unfinished.
        requireFinish: drive?.finished !== true,
        emptyText: 'NO POSITION DATA WAS SAVED FOR THIS DRIVE',
        selection: {
          get: () => driveMapLayerSelection,
          set: value => { driveMapLayerSelection = value }
        }
      })
    }

    async function loadDriverAnalysisHistory() {
      try {
        const history = await call('load_driver_analysis_sessions')
        renderDriverAnalysisHistory(Array.isArray(history) ? history : [])
        // A reload rebuilds the open page from the new history, or returns to it when that recording is gone.
        renderDriverAnalysisView()
        return getDriverAnalysisHistory()
      } catch (error) {
        renderDriverAnalysisHistory([])
        setStatus(error.message || 'Unable to load Driver Analysis history', true)
        return []
      }
    }

    function renderDriverAnalysisState(value = getDriverAnalysisState()) {
      setDriverAnalysisState({
        ...getDriverAnalysisState(),
        ...(value && typeof value === 'object' ? value : {}),
        enabled: value?.enabled === true,
        recording: value?.recording === true,
        phase: typeof value?.phase === 'string' ? value.phase : value?.recording === true ? 'recording' : value?.enabled === true ? 'ready' : 'off',
        hotkey: driverAnalysisApi?.normalizeHotkey?.(value?.hotkey) || getDriverAnalysisSettings().hotkey
      })
      const { enabled, recording, hotkey, phase } = getDriverAnalysisState()
      const busy = driverAnalysisActionPending || phase === 'finalizing'
      const waiting = phase === 'waiting'
      const failed = phase === 'error'
      updateOverlayToggle(driverAnalysisEnabled, enabled)
      driverAnalysisEnabled.disabled = recording || busy
      driverAnalysisRecord.disabled = !enabled || busy
      driverAnalysisRecord.textContent = recording || waiting ? 'STOP' : busy ? 'SAVING' : 'RECORD'
      driverAnalysisRecord.setAttribute('aria-pressed', String(recording))
      driverAnalysisRecord.classList.toggle('settings-button--danger', recording || waiting)
      driverAnalysisRecord.classList.toggle('driver-analysis-record--ready', enabled && !recording && !waiting && !busy)
      driverAnalysisHotkeyChange.disabled = !enabled || recording || waiting || busy
      driverAnalysisHotkeyValue.textContent = driverAnalysisHotkeyCapture
        ? 'PRESS KEYS OR A BUTTON'
        : driverAnalysisApi?.formatHotkey?.(hotkey, getDriverAnalysisSettings().hotkeyLabel) || hotkey
      driverAnalysisRecordingStatus.dataset.state = phase
      driverAnalysisRecordingStatus.textContent = phase.toUpperCase()
      driverAnalysisRecorderHint.textContent = busy
        ? 'Saving telemetry and completing the analysis.'
        : waiting
          ? 'Waiting for valid Forza telemetry. Recording starts automatically when data arrives.'
          : recording
            ? 'Drive the asphalt session, then press Stop or use the global hotkey.'
            : failed
              ? 'The last recording could not be saved. Start a new session when ready.'
              : enabled
                ? 'Record one asphalt session. FDC will save one recurring problem.'
                : 'Enable Driver Analysis to start recording.'
      renderDriverAnalysisHistory()
    }

    function emitDriverAnalysisConfig(payload) {
      const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
      if (!eventApi || typeof eventApi.emit !== 'function') {
        return Promise.reject(new Error('Driver Analysis event bridge is unavailable'))
      }
      return eventApi.emit('driver_analysis_config', payload)
    }

    async function setDriverAnalysisEnabled(enabled) {
      if (getDriverAnalysisState().recording) return
      setDriverAnalysisSettings(driverAnalysisApi.writeSettings({ ...getDriverAnalysisSettings(), enabled }))
      renderDriverAnalysisState({ ...getDriverAnalysisState(), enabled })
      try {
        await emitDriverAnalysisConfig({ enabled, hotkey: getDriverAnalysisSettings().hotkey })
        const hotkeyReady = enabled
          ? await setDriverAnalysisHotkey(getDriverAnalysisSettings().hotkey, false, getDriverAnalysisSettings().hotkeyLabel)
          : await call('clear_driver_analysis_hotkey').then(() => true, error => {
            setStatus(error.message || 'Unable to clear Driver Analysis hotkey', true)
            return false
          })
        if (hotkeyReady) setStatus(`DRIVER ANALYSIS ${enabled ? 'ENABLED' : 'DISABLED'}`)
      } catch (error) {
        setDriverAnalysisSettings(driverAnalysisApi.writeSettings({ ...getDriverAnalysisSettings(), enabled: !enabled }))
        renderDriverAnalysisState({ ...getDriverAnalysisState(), enabled: !enabled })
        setStatus(error.message || 'Unable to update Driver Analysis', true)
      }
    }

    async function setDriverAnalysisHotkey(hotkey, announce = true, hotkeyLabel = '') {
      const normalized = driverAnalysisApi?.normalizeHotkey?.(hotkey)
      if (!normalized) {
        if (announce) setStatus('USE CTRL, ALT OR SHIFT WITH ONE KEY. WINDOWS KEY IS NOT ALLOWED.', true)
        return false
      }
      if (normalized === getHudEditHotkeySettings().hotkey) {
        if (announce) setStatus('THAT HOTKEY IS ALREADY USED BY HUD EDIT', true)
        return false
      }
      if (!getDriverAnalysisSettings().enabled) {
        setDriverAnalysisSettings(driverAnalysisApi.writeSettings({ ...getDriverAnalysisSettings(), hotkey: normalized, hotkeyLabel }))
        return true
      }
      try {
        const registered = await call('set_driver_analysis_hotkey', { hotkey: normalized })
        setDriverAnalysisSettings(driverAnalysisApi.writeSettings({ ...getDriverAnalysisSettings(), hotkey: registered, hotkeyLabel }))
        getDriverAnalysisState().hotkey = registered
        await emitDriverAnalysisConfig({ enabled: getDriverAnalysisSettings().enabled, hotkey: registered })
        renderDriverAnalysisState(getDriverAnalysisState())
        if (announce) {
          const formatted = driverAnalysisApi.formatHotkey(registered, getDriverAnalysisSettings().hotkeyLabel).toUpperCase()
          setStatus(`DRIVER ANALYSIS HOTKEY SET TO ${formatted}`)
        }
        return true
      } catch (error) {
        renderDriverAnalysisState(getDriverAnalysisState())
        setStatus(error.message || 'Unable to register Driver Analysis hotkey', true)
        return false
      }
    }

    async function sendDriverAnalysisAction(action) {
      if (driverAnalysisActionPending) return
      driverAnalysisActionPending = true
      renderDriverAnalysisState(getDriverAnalysisState())
      try {
        await emitDriverAnalysisConfig({
          action,
          enabled: getDriverAnalysisSettings().enabled,
          hotkey: getDriverAnalysisSettings().hotkey
        })
      } catch (error) {
        setStatus(error.message || 'Unable to update Driver Analysis recording', true)
      } finally {
        driverAnalysisActionPending = false
        renderDriverAnalysisState(getDriverAnalysisState())
      }
    }

    async function setDriverAnalysisHotkeyCapture(active) {
      const wasActive = driverAnalysisHotkeyCapture
      driverAnalysisHotkeyCapture = active === true
      if (driverAnalysisHotkeyCapture && isHudEditHotkeyCapturing()) await setHudEditHotkeyCapture(false)
      driverAnalysisHotkeyChange.textContent = driverAnalysisHotkeyCapture ? 'CANCEL' : 'CHANGE'
      renderDriverAnalysisState(getDriverAnalysisState())
      if (driverAnalysisHotkeyCapture) {
        setStatus('PRESS A KEY COMBINATION OR A CONTROLLER BUTTON')
        try {
          await call('start_controller_capture')
        } catch {
          setStatus('CONTROLLER CAPTURE UNAVAILABLE. PRESS A KEY COMBINATION.', true)
        }
      } else if (wasActive) {
        try {
          await call('stop_controller_capture')
        } catch {
        }
      }
    }

    async function listenDriverAnalysisEvents() {
      const eventApi = globalScope.HudTauriEvents?.getEventApi?.()
      if (!eventApi || typeof eventApi.listen !== 'function') return
      await eventApi.listen('driver_analysis_status', event => renderDriverAnalysisState(event?.payload || {}))
      await eventApi.listen('driver_analysis_history', () => void loadDriverAnalysisHistory())
      await eventApi.listen('driver_analysis_result', event => {
        const entry = event?.payload
        setStatus(entry?.result === 'issue'
          ? `ANALYSIS SAVED · ${entry.label}`
          : entry?.result === 'no_recurring_problem'
            ? 'ANALYSIS SAVED · NO RECURRING PROBLEM'
            : 'ANALYSIS SAVED · MORE EVIDENCE NEEDED')
        void loadDriverAnalysisHistory()
      })
      await eventApi.emit('driver_analysis_status_request')
    }

    driverAnalysisEnabled?.addEventListener('click', () => {
      void setDriverAnalysisEnabled(getDriverAnalysisSettings().enabled !== true)
    })
    driverAnalysisRecord?.addEventListener('click', () => {
      void sendDriverAnalysisAction(getDriverAnalysisState().recording ? 'stop' : 'record')
    })
    driverAnalysisHotkeyChange?.addEventListener('click', () => {
      void setDriverAnalysisHotkeyCapture(!driverAnalysisHotkeyCapture)
    })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && driverAnalysisHotkeyCapture) void setDriverAnalysisHotkeyCapture(false)
    })
    document.addEventListener('keydown', event => {
      if (!driverAnalysisHotkeyCapture) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.key === 'Escape') {
        void setDriverAnalysisHotkeyCapture(false)
        setStatus('DRIVER ANALYSIS HOTKEY UNCHANGED')
        return
      }
      const hotkey = driverAnalysisApi?.hotkeyFromKeyboardEvent?.(event)
      if (!hotkey) {
        if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
          setStatus('USE CTRL, ALT OR SHIFT WITH ONE KEY. WINDOWS KEY IS NOT ALLOWED.', true)
        }
        return
      }
      void setDriverAnalysisHotkeyCapture(false)
      void setDriverAnalysisHotkey(hotkey)
    })
    driverAnalysisDetailBack?.addEventListener('click', () => {
      closeDriverAnalysisLevel()
    })

    return {
      renderDriverAnalysisView,
      renderDriverAnalysisHistory,
      renderDriverAnalysisState,
      loadDriverAnalysisHistory,
      setDriverAnalysisHotkey,
      setDriverAnalysisHotkeyCapture,
      closeDriverAnalysisLevel,
      listenDriverAnalysisEvents,
      getView: () => driverAnalysisView,
      isHotkeyCapturing: () => driverAnalysisHotkeyCapture
    }
  }

  return {
    create,
    formatDriverAnalysisDuration,
    formatDriverAnalysisDate,
    formatDriverAnalysisSize,
    driverAnalysisResultCopy,
    driverAnalysisHeadline
  }
}))
