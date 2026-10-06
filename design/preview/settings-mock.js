(function(globalScope) {
  'use strict'

  // Mock Tauri internals
  const mockData = {
    appVersion: 'preview',
    telemetryConnected: true,
    hudDisplays: [
      { id: 1, name: 'Primary Display' },
      { id: 2, name: 'Secondary Display' }
    ],
    currentHudDisplay: 1,
    garageVehicles: [
      {
        carOrdinal: 128,
        latestUsed: true,
        name: 'Grifo GT',
        class: 7,
        classLabel: 'S2',
        pi: 880,
        drivetrain: 1,
        cylinders: 8,
        variants: [
          { class: 7, classLabel: 'S2', pi: 880, drivetrain: 1, cylinders: 8 }
        ]
      },
      {
        carOrdinal: 1,
        latestUsed: false,
        name: null,
        class: 0,
        classLabel: 'D',
        pi: 142,
        drivetrain: 0,
        cylinders: 4,
        variants: []
      },
      {
        carOrdinal: 50,
        latestUsed: false,
        name: 'Civic Type R',
        class: 2,
        classLabel: 'C',
        pi: 453,
        drivetrain: 1,
        cylinders: 4,
        variants: []
      },
      {
        carOrdinal: 100,
        latestUsed: false,
        name: 'M440i',
        class: 3,
        classLabel: 'B',
        pi: 614,
        drivetrain: 1,
        cylinders: 6,
        variants: []
      },
      {
        carOrdinal: 110,
        latestUsed: false,
        name: 'Ferrari F40',
        class: 4,
        classLabel: 'A',
        pi: 728,
        drivetrain: 0,
        cylinders: 8,
        variants: []
      },
      {
        carOrdinal: 120,
        latestUsed: false,
        name: 'Pagani Huayra',
        class: 5,
        classLabel: 'S1',
        pi: 815,
        drivetrain: 0,
        cylinders: 12,
        variants: []
      },
      {
        carOrdinal: 125,
        latestUsed: false,
        name: null,
        class: 6,
        classLabel: 'S2',
        pi: 883,
        drivetrain: 0,
        cylinders: 12,
        variants: []
      },
      {
        carOrdinal: 130,
        latestUsed: false,
        name: null,
        class: 8,
        classLabel: 'R',
        pi: 998,
        drivetrain: 0,
        cylinders: 8,
        variants: []
      },
      {
        carOrdinal: 140,
        latestUsed: false,
        name: 'Lancia Stratos',
        class: 9,
        classLabel: 'X',
        pi: 1098,
        drivetrain: 0,
        cylinders: 6,
        variants: []
      }
    ],
    events: [
      {
        id: '1',
        name: 'Circuit Race 1',
        eventClass: 'A',
        mode: 'Rivals',
        routeType: 'Asphalt',
        notes: 'A fast circuit race, good for testing.',
        createdAt: '2026-10-01T10:00:00Z',
        lastRecordedAt: '2026-10-05T15:30:00Z',
        runs: [
          {
            id: '1-1',
            eventId: '1',
            carOrdinal: 110,
            carName: 'Ferrari F40',
            carClass: 4,
            carClassLabel: 'A',
            carPi: 728,
            carDrivetrain: 0,
            startedAt: '2026-10-05T15:20:00Z',
            recordedAt: '2026-10-05T15:20:00Z',
            finalTimeMs: 125340,
            runType: 'circuit',
            result: 'completed',
            laps: [
              {
                lapNumber: 1,
                timeMs: 65200,
                sector1TimeMs: 22100,
                sector2TimeMs: 21500,
                sector3TimeMs: 21600,
                tracePoints: []
              },
              {
                lapNumber: 2,
                timeMs: 63200,
                sector1TimeMs: 21200,
                sector2TimeMs: 20900,
                sector3TimeMs: 21100,
                tracePoints: []
              },
              {
                lapNumber: 3,
                timeMs: 63400,
                sector1TimeMs: 21300,
                sector2TimeMs: 21000,
                sector3TimeMs: 21100,
                tracePoints: []
              },
              {
                lapNumber: 4,
                timeMs: 63540,
                sector1TimeMs: 21400,
                sector2TimeMs: 21000,
                sector3TimeMs: 21140,
                tracePoints: []
              }
            ]
          },
          {
            id: '1-2',
            eventId: '1',
            carOrdinal: 128,
            carName: 'Grifo GT',
            carClass: 7,
            carClassLabel: 'S2',
            carPi: 880,
            carDrivetrain: 1,
            startedAt: '2026-10-04T14:00:00Z',
            recordedAt: '2026-10-04T14:00:00Z',
            finalTimeMs: 123100,
            runType: 'circuit',
            result: 'completed',
            laps: [
              {
                lapNumber: 1,
                timeMs: 62500,
                sector1TimeMs: 21000,
                sector2TimeMs: 20700,
                sector3TimeMs: 20800,
                tracePoints: []
              },
              {
                lapNumber: 2,
                timeMs: 61100,
                sector1TimeMs: 20400,
                sector2TimeMs: 20200,
                sector3TimeMs: 20500,
                tracePoints: []
              },
              {
                lapNumber: 3,
                timeMs: 60900,
                sector1TimeMs: 20300,
                sector2TimeMs: 20100,
                sector3TimeMs: 20500,
                tracePoints: []
              }
            ]
          },
          {
            id: '1-3',
            eventId: '1',
            carOrdinal: 100,
            carName: 'M440i',
            carClass: 3,
            carClassLabel: 'B',
            carPi: 614,
            carDrivetrain: 1,
            startedAt: '2026-10-03T11:00:00Z',
            recordedAt: '2026-10-03T11:00:00Z',
            finalTimeMs: 132200,
            runType: 'circuit',
            result: 'completed',
            laps: [
              {
                lapNumber: 1,
                timeMs: 67300,
                sector1TimeMs: 22500,
                sector2TimeMs: 22200,
                sector3TimeMs: 22600,
                tracePoints: []
              },
              {
                lapNumber: 2,
                timeMs: 65100,
                sector1TimeMs: 21700,
                sector2TimeMs: 21800,
                sector3TimeMs: 21600,
                tracePoints: []
              }
            ]
          }
        ]
      },
      {
        id: '2',
        name: 'Sprint Challenge',
        eventClass: 'D',
        mode: 'Online',
        routeType: 'Asphalt',
        notes: '',
        createdAt: '2026-09-20T08:30:00Z',
        lastRecordedAt: null,
        runs: []
      },
      {
        id: '3',
        name: 'Rally Event',
        eventClass: 'Any',
        mode: 'Official',
        routeType: 'Rally',
        notes: 'Dirt and gravel course.',
        createdAt: '2026-09-15T12:00:00Z',
        lastRecordedAt: null,
        runs: []
      },
      {
        id: '4',
        name: 'Cross Country',
        eventClass: 'S1',
        mode: 'Any',
        routeType: 'Offroad',
        notes: '',
        createdAt: '2026-09-10T09:00:00Z',
        lastRecordedAt: null,
        runs: []
      }
    ],
    driverAnalysisRecordings: [
      {
        id: 1,
        sessionCount: 2,
        vehicleIdentity: { ordinal: 100 },
        vehicleName: 'M440i',
        startedAt: '2026-10-02T14:00:00Z',
        recordedAt: '2026-10-02T14:00:00Z',
        durationMs: 600000,
        sizeBytes: 5242880,
        status: 'completed',
        sessions: [
          {
            id: 1,
            recordingId: 1,
            vehicleIdentity: { ordinal: 100 },
            vehicleName: 'M440i',
            startedAt: '2026-10-02T14:00:00Z',
            durationMs: 300000,
            sampleCount: 5000,
            drives: [
              {
                id: 1,
                sessionId: 1,
                startedAt: '2026-10-02T14:00:00Z',
                durationMs: 120000,
                sampleCount: 2000,
                speedKmhMin: 10,
                speedKmhMax: 180,
                speedKmhAvg: 92
              },
              {
                id: 2,
                sessionId: 1,
                startedAt: '2026-10-02T14:02:00Z',
                durationMs: 180000,
                sampleCount: 3000,
                speedKmhMin: 5,
                speedKmhMax: 185,
                speedKmhAvg: 98
              }
            ]
          },
          {
            id: 2,
            recordingId: 1,
            vehicleIdentity: { ordinal: 100 },
            vehicleName: 'M440i',
            startedAt: '2026-10-02T14:05:00Z',
            durationMs: 300000,
            sampleCount: 5000,
            drives: [
              {
                id: 3,
                sessionId: 2,
                startedAt: '2026-10-02T14:05:00Z',
                durationMs: 300000,
                sampleCount: 5000,
                speedKmhMin: 0,
                speedKmhMax: 190,
                speedKmhAvg: 95
              }
            ]
          }
        ]
      },
      {
        id: 2,
        sessionCount: 1,
        vehicleIdentity: { ordinal: 128 },
        vehicleName: 'Grifo GT',
        startedAt: '2026-10-01T16:30:00Z',
        recordedAt: '2026-10-01T16:30:00Z',
        durationMs: 450000,
        sizeBytes: 3932160,
        status: 'completed',
        sessions: [
          {
            id: 3,
            recordingId: 2,
            vehicleIdentity: { ordinal: 128 },
            vehicleName: 'Grifo GT',
            startedAt: '2026-10-01T16:30:00Z',
            durationMs: 450000,
            sampleCount: 7500,
            drives: [
              {
                id: 4,
                sessionId: 3,
                startedAt: '2026-10-01T16:30:00Z',
                durationMs: 450000,
                sampleCount: 7500,
                speedKmhMin: 15,
                speedKmhMax: 265,
                speedKmhAvg: 128
              }
            ]
          }
        ]
      }
    ],
    shiftLightState: {
      carKey: '128',
      carOrdinal: 128,
      carName: 'Grifo GT',
      pi: 880,
      rpmMax: 7200,
      usableCeiling: 7000,
      currentTarget: 6800,
      state: 'optimal',
      gears: [
        { gear: 1, shiftPoint: 5400, confirmedShifts: 3, lastComparison: null, state: 'optimal' },
        { gear: 2, shiftPoint: 6200, confirmedShifts: 3, lastComparison: null, state: 'optimal' },
        { gear: 3, shiftPoint: 6500, confirmedShifts: 2, lastComparison: null, state: 'potential' },
        { gear: 4, shiftPoint: 6800, confirmedShifts: 0, lastComparison: null, state: 'learning' }
      ]
    },
    displayPreferences: {
      speedUnit: 'kmh',
      distanceUnit: 'km',
      redlineBrightness: 80,
      shiftLightBrightness: 80,
      fdcShiftLightEnabled: true,
      showHudWithTelemetry: true,
      hudOpacity: 80,
      configurationAlwaysOnTop: false
    },
    // The shape the native route status event carries; see overlay/telemetry-route.js.
    routeStatus: {
      phase: 'live',
      message: '',
      revision: 1
    }
  }

  // Mock __TAURI_INTERNALS__
  if (!globalScope.__TAURI_INTERNALS__) {
    globalScope.__TAURI_INTERNALS__ = {}
  }

  let callbackCounter = 0
  const callbacks = new Map()
  const handlers = new Map()

  // Delivers an event to every listener the page registered, as Tauri does.
  function emit(event, payload) {
    for (const id of callbacks.get(event) || []) {
      handlers.get(id)?.({ event, id, payload })
    }
  }

  // Preview helpers for designers and agents, e.g. in the browser console:
  //   fdcPreview.setRouteStatus('waiting')  // live, waiting, stale, offline, error
  globalScope.fdcPreview = {
    setRouteStatus(phase, message = '') {
      mockData.routeStatus = { phase, message, revision: mockData.routeStatus.revision + 1 }
      emit('hud_route_status', mockData.routeStatus)
    }
  }

  globalScope.__TAURI_INTERNALS__.invoke = async function(command, args) {
    console.log(`[Mock Tauri] invoke('${command}', `, args, ')')

    try {
      switch (command) {
        case 'get_app_version':
          return mockData.appVersion

        case 'load_garage_snapshot':
          return {
            cars: mockData.garageVehicles,
            currentCarOrdinal: 128
          }

        case 'list_hud_displays':
          return {
            displays: mockData.hudDisplays.map(display => ({ name: String(display.id), label: display.name })),
            selected: String(mockData.currentHudDisplay),
            savedMissing: false
          }

        case 'set_hud_display':
          if (args?.displayId) {
            mockData.currentHudDisplay = args.displayId
          }
          return null

        case 'load_events':
          return mockData.events.map(e => ({
            id: e.id,
            name: e.name,
            eventClass: e.eventClass,
            mode: e.mode,
            routeType: e.routeType,
            notes: e.notes,
            createdAt: e.createdAt,
            lastRecordedAt: e.lastRecordedAt
          }))

        case 'load_event':
          const eventId = String(args?.eventId)
          const event = mockData.events.find(e => e.id === eventId)
          if (!event) {
            throw new Error(`Event ${eventId} not found`)
          }
          return {
            id: event.id,
            name: event.name,
            eventClass: event.eventClass,
            mode: event.mode,
            routeType: event.routeType,
            notes: event.notes,
            createdAt: event.createdAt,
            lastRecordedAt: event.lastRecordedAt
          }

        case 'load_event_runs':
          const eventIdForRuns = String(args?.eventId)
          const eventForRuns = mockData.events.find(e => e.id === eventIdForRuns)
          if (!eventForRuns) {
            return []
          }
          return eventForRuns.runs || []

        case 'load_event_run':
          const runId = String(args?.runId)
          let foundRun = null
          for (const event of mockData.events) {
            const run = event.runs?.find(r => r.id === runId)
            if (run) {
              foundRun = run
              break
            }
          }
          if (!foundRun) {
            throw new Error(`Run ${runId} not found`)
          }
          return foundRun

        case 'load_event_absolute_best':
          const eventIdForBest = String(args?.eventId)
          const eventForBest = mockData.events.find(e => e.id === eventIdForBest)
          if (!eventForBest || !eventForBest.runs || eventForBest.runs.length === 0) {
            return null
          }
          const bestRun = eventForBest.runs.reduce((best, current) => {
            return current.finalTimeMs < best.finalTimeMs ? current : best
          })
          return { timeMs: bestRun.finalTimeMs }

        case 'create_event':
          const newEventId = String(Math.max(...mockData.events.map(e => Number(e.id))) + 1)
          const newEvent = {
            id: newEventId,
            name: args?.name || 'NEW EVENT',
            eventClass: args?.class || 'Any',
            mode: args?.mode || 'Any',
            routeType: args?.routeType || 'Asphalt',
            notes: args?.notes || '',
            createdAt: new Date().toISOString(),
            lastRecordedAt: null,
            runs: []
          }
          mockData.events.push(newEvent)
          return newEvent

        case 'delete_event':
          const deleteEventId = String(args?.eventId)
          mockData.events = mockData.events.filter(e => e.id !== deleteEventId)
          return null

        case 'rename_event':
          const renameEventId = String(args?.eventId)
          const eventToRename = mockData.events.find(e => e.id === renameEventId)
          if (eventToRename) {
            eventToRename.name = args?.name || eventToRename.name
          }
          return eventToRename

        case 'rename_garage_car':
          const carOrdinal = Number(args?.carOrdinal)
          const car = mockData.garageVehicles.find(v => v.carOrdinal === carOrdinal)
          if (car) {
            car.name = args?.name || null
          }
          return car ? [car] : []

        case 'load_driver_analysis_sessions':
          return mockData.driverAnalysisRecordings

        case 'load_driver_analysis_checks':
          const sessionId = Number(args?.sessionId)
          const recording = mockData.driverAnalysisRecordings.find(r =>
            r.sessions.some(s => s.id === sessionId)
          )
          if (!recording) {
            return []
          }
          return [
            { sessionId, checkType: 'speed', count: 45, finding: 'Speed variations detected' },
            { sessionId, checkType: 'smooth', count: 12, finding: 'Minor jerky inputs' },
            { sessionId, checkType: 'braking', count: 8, finding: 'Late braking in turn 3' }
          ]

        case 'load_driver_analysis_samples':
          const driveIdForSamples = Number(args?.driveId)
          let targetDrive = null
          for (const recording of mockData.driverAnalysisRecordings) {
            for (const session of recording.sessions) {
              const drive = session.drives.find(d => d.id === driveIdForSamples)
              if (drive) {
                targetDrive = drive
                break
              }
            }
          }
          if (!targetDrive) {
            return []
          }
          const samples = []
          for (let i = 0; i < 20; i++) {
            samples.push({
              elapsedMs: i * 1000,
              speedKmh: 50 + Math.sin(i * 0.5) * 30,
              throttle: Math.max(0, Math.sin(i * 0.3)) * 0.8,
              brake: Math.max(0, -Math.cos(i * 0.3)) * 0.5,
              gear: (i % 4) + 1,
              rpm: 2000 + Math.sin(i * 0.4) * 3000
            })
          }
          return samples

        case 'sync_route_status':
          // The backend answers by emitting the current status.
          setTimeout(() => emit('hud_route_status', mockData.routeStatus), 0)
          return null

        case 'sync_shift_light_status':
          return mockData.shiftLightState

        case 'set_display_preferences':
          Object.assign(mockData.displayPreferences, args || {})
          return null

        case 'set_hud_visibility':
          // Just accept it
          return null

        case 'set_overlay_visibility':
          // Just accept it
          return null

        case 'set_layout_mode':
          // Just accept it
          return null

        case 'set_configuration_always_on_top':
          mockData.displayPreferences.configurationAlwaysOnTop = args?.alwaysOnTop === true
          return null

        case 'set_settings_window_context':
          // Just accept it
          return null

        case 'layout_action':
          // Accept layout edit/save actions
          return null

        case 'quit_app':
          console.log('[Mock Tauri] quit_app called')
          return null

        case 'retry_direct_source':
          // Retry telemetry connection
          return null

        case 'start_controller_capture':
          // Start capturing hotkey input
          return null

        case 'stop_controller_capture':
          // Stop capturing hotkey input
          return null

        case 'set_driver_analysis_hotkey':
          // Set the hotkey
          return null

        case 'clear_driver_analysis_hotkey':
          // Clear the hotkey
          return null

        case 'delete_driver_analysis_recording':
          const deleteRecordingId = Number(args?.recordingId)
          mockData.driverAnalysisRecordings = mockData.driverAnalysisRecordings.filter(
            r => r.id !== deleteRecordingId
          )
          return null

        case 'export_driver_analysis_recording':
          // Just resolve successfully
          return null

        case 'open_feedback_link':
          console.log(`[Mock Tauri] Would open feedback link: ${args?.link}`)
          return null

        // Event system
        case 'plugin:event|listen':
          const eventName = args?.event
          const callbackId = args?.handler
          if (!callbacks.has(eventName)) {
            callbacks.set(eventName, [])
          }
          callbacks.get(eventName).push(callbackId)
          return callbackId

        case 'plugin:event|unlisten':
          const unlistenEvent = args?.event
          const unlistenId = args?.eventId
          if (callbacks.has(unlistenEvent)) {
            const listeners = callbacks.get(unlistenEvent)
            const idx = listeners.indexOf(unlistenId)
            if (idx >= 0) {
              listeners.splice(idx, 1)
            }
          }
          return null

        case 'plugin:event|emit':
          // Just accept emissions
          return null

        default:
          console.warn(`[Mock Tauri] Unknown command: '${command}'`)
          return null
      }
    } catch (error) {
      console.error(`[Mock Tauri] Error in command '${command}':`, error)
      throw error
    }
  }

  globalScope.__TAURI_INTERNALS__.transformCallback = function(handler) {
    const id = callbackCounter++
    handlers.set(id, handler)
    return id
  }

  globalScope.__TAURI_INTERNALS__.unregisterCallback = function(id) {
    handlers.delete(id)
  }

  console.log('[Mock Tauri] Backend initialized')
})(typeof globalThis === 'undefined' ? this : globalThis)
