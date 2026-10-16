const test = require('node:test')
const assert = require('node:assert/strict')
const SettingsEvents = require('./settings-events.js')

const {
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
} = SettingsEvents

test('settings-events.js loads without a DOM and exports create()', () => {
  assert.equal(typeof document, 'undefined')
  assert.equal(typeof create, 'function')
})

test('Event ids: keys are strings, native ids are safe positive integers, and the id is read from any payload shape', () => {
  assert.equal(eventKey(null), null)
  assert.equal(eventKey(''), null)
  assert.equal(eventKey(12), '12')
  assert.equal(nativeEventId('42'), 42)
  assert.equal(nativeEventId('0'), '0')
  assert.equal(nativeEventId('abc'), 'abc')
  assert.equal(eventIdFrom({ eventId: 7 }), 7)
  assert.equal(eventIdFrom({ event: { id: 9 } }), 9)
  assert.equal(eventIdFrom(5), 5)
  assert.equal(eventText('  Night  '), 'Night')
  assert.equal(eventText(5), '')
})

test('Event payloads: names, modes, and routes are trimmed, defaulted, and labelled in capitals', () => {
  assert.deepEqual(normalizeEvent({ id: 3, name: ' Night ', mode: 'rivals', route: 'Dirt', class: 'S1' }), {
    id: '3',
    name: 'Night',
    eventClass: 'S1',
    routeType: 'Dirt',
    mode: 'rivals',
    notes: '',
    createdAt: null,
    lastRecordedAt: null
  })
  assert.equal(normalizeEvent({ event: { id: 4 } }).name, 'EVENT 4')
  assert.equal(normalizeEvent({ event: { id: 4 } }).routeType, 'Asphalt')
  assert.equal(normalizeEvent({ name: 'No id' }), null)
  assert.deepEqual(normalizeEventsPayload([{ id: 1 }, { id: null }]).map(event => event.id), ['1'])
  assert.deepEqual(normalizeEventsPayload({ items: [{ id: 2 }] }).map(event => event.id), ['2'])
  assert.deepEqual(normalizeEventsPayload({ event: { id: 5 } }).map(event => event.id), ['5'])
  assert.deepEqual(normalizeEventsPayload('nothing'), [])

  assert.equal(eventModeKey('Eventlab'), 'eventlab')
  assert.equal(eventModeKey(''), 'any')
  assert.equal(eventModeLabel('Eventlab'), 'EVENTLAB')
  assert.equal(eventModeLabel('Weird Mode'), 'WEIRD MODE')
  assert.equal(eventModeLabel(''), 'ANY')
  assert.equal(eventRouteLabel('dirt'), 'DIRT')
  assert.equal(eventRouteLabel(''), 'ASPHALT')
})

test('Event order: ids compare numerically and a missing last-recorded date reads as null', () => {
  assert.ok(eventIdCompare({ id: '10' }, { id: '9' }) > 0)
  assert.ok(eventIdCompare({ id: '2' }, { id: '2' }) === 0)
  assert.equal(eventDateMs({ lastRecordedAt: null }), null)
  assert.equal(eventDateMs({ lastRecordedAt: 'not a date' }), null)
  assert.equal(eventDateMs({ lastRecordedAt: '2026-01-05T10:00:00Z' }), Date.parse('2026-01-05T10:00:00Z'))
})

test('Run values: run ids, times in seconds or milliseconds, and finite numbers', () => {
  assert.equal(runId(null), null)
  assert.equal(runId(''), null)
  assert.equal(runId(0), '0')
  assert.equal(runTimeMs(1.5), 1500)
  assert.equal(runTimeMs(1500), 1500)
  assert.equal(runTimeMs(2, 'seconds'), 2000)
  assert.equal(runTimeMs(1234.4, 'ms'), 1234)
  assert.equal(runTimeMs(-1), null)
  assert.equal(runTimeMs('x'), null)
  assert.equal(finiteNumber('3'), 3)
  assert.equal(finiteNumber('x'), null)
  assert.equal(normalizePedal(50), 0.5)
  assert.equal(normalizePedal(-1), 0)
  assert.equal(normalizePedal(1.5), 0.015)
  assert.equal(normalizePedal('x'), 0)
})

test('Trace points: pedals are clamped, incomplete positions are dropped, and optional fields keep only finite values', () => {
  assert.deepEqual(normalizeTracePoints('not a list'), [])
  const [point, ...rest] = normalizeTracePoints([
    { position: { x: 1, y: 2, z: 3 }, elapsedMs: 100, throttle: 80, brake: 0, speed_kmh: 120, rumbleFl: true, rumble_rr: 'yes' },
    { positionX: 4, positionZ: null }
  ])
  assert.equal(rest.length, 0)
  assert.equal(point.positionX, 1)
  assert.equal(point.positionY, 2)
  assert.equal(point.positionZ, 3)
  assert.equal(point.elapsedMs, 100)
  assert.equal(point.throttle, 0.8)
  assert.equal(point.brake, 0)
  assert.equal(point.speedKmh, 120)
  assert.equal(point.rumbleFl, true)
  assert.equal('rumbleRr' in point, false)
  assert.equal('gear' in point, false)
})

test('Run payloads: laps read camelCase and snake_case times, a sprint result becomes one lap, and approximation is kept only when reported', () => {
  const circuit = normalizeEventRun({
    runId: 'r1',
    eventId: 9,
    laps: [
      { lapNumber: 1, lap_time_ms: 90000, sector1TimeMs: 30000, sector_2_ms: 30000, sector_3_ms: 30000 },
      { lap_number: 2, timeMs: 88000 }
    ],
    car: { name: 'Stalker', ordinal: 12, class: 'S1', pi: 800, drivetrain: 'AWD' }
  })
  assert.equal(circuit.id, 'r1')
  assert.equal(circuit.eventId, '9')
  assert.equal(circuit.runType, 'circuit')
  assert.equal(circuit.result, 'completed')
  assert.equal(circuit.laps.length, 2)
  assert.equal(circuit.laps[0].timeMs, 90000)
  assert.equal(circuit.laps[0].sector1TimeMs, 30000)
  assert.equal(circuit.laps[0].sector2TimeMs, 30000)
  assert.equal(circuit.laps[0].sector3TimeMs, 30000)
  assert.equal(circuit.laps[1].timeMs, 88000)
  assert.equal(circuit.resultTimeApproximate, false)
  assert.deepEqual(circuit.car, { name: 'Stalker', ordinal: 12, class: 'S1', pi: 800, drivetrain: 'AWD' })

  const sprint = normalizeEventRun({ runId: 'r2', resultTimeMs: 61000, resultTimeApproximate: true, runType: 'sprint' })
  assert.equal(sprint.runType, 'sprint')
  assert.equal(sprint.finalTimeMs, 61000)
  assert.equal(sprint.resultTimeApproximate, true)
  assert.equal(sprint.laps.length, 1)
  assert.equal(sprint.laps[0].lapNumber, 1)
  assert.equal(sprint.laps[0].timeMs, 61000)

  const snake = normalizeEventRun({ run: { run_id: 'r3', result_time_approximate: true, result_time_ms: 5000 } })
  assert.equal(snake.id, 'r3')
  assert.equal(snake.resultTimeApproximate, true)
  assert.equal(snake.runType, 'sprint')
  assert.equal(normalizeEventRun(null), null)
  assert.equal(normalizeEventRun({ laps: [] }), null)
})

test('Run car labels: the Garage runtime fills a missing class label', () => {
  const previous = globalThis.HudGarageRuntime
  globalThis.HudGarageRuntime = { classLabel: value => `CLASS ${value}`, drivetrainLabel: value => `DT ${value}` }
  try {
    const run = normalizeEventRun({ runId: 'r4', car: { class: 'X', drivetrain: 'RWD' }, resultTimeMs: 1000 })
    assert.equal(run.car.class, 'X')
    assert.equal(run.car.drivetrain, 'RWD')
    const fallback = normalizeEventRun({ runId: 'r5', carClass: 'S2', drivetrain: 'FWD', resultTimeMs: 1000 })
    assert.equal(fallback.car.class, 'S2')
    assert.equal(fallback.car.drivetrain, 'FWD')
    // Non-text values have no label of their own, so the Garage runtime names them.
    const garageOnly = normalizeEventRun({ runId: 'r6', resultTimeMs: 1000, car: { class: 7, drivetrain: 8 } })
    assert.equal(garageOnly.car.class, 'CLASS 7')
    assert.equal(garageOnly.car.drivetrain, 'DT 8')
  } finally {
    if (previous === undefined) delete globalThis.HudGarageRuntime
    else globalThis.HudGarageRuntime = previous
  }
  assert.deepEqual(normalizeEventRunsPayload({ runs: [{ runId: 'a', resultTimeMs: 1 }, { laps: [] }] }).map(run => run.id), ['a'])
  assert.deepEqual(normalizeEventRunsPayload(42), [])
})

test('Run times: formatted as minutes, seconds, and thousandths; an approximate sprint result gets a tilde and a title', () => {
  assert.equal(formatRunTime(83456), '01:23.456')
  assert.equal(formatRunTime(null), '—')
  assert.equal(approximateRunResultTitle(), 'Approximate: last live race time before Forza cleared telemetry')

  const approximate = { runType: 'sprint', resultTimeApproximate: true, finalTimeMs: 61000 }
  assert.equal(isApproximateRunResult(approximate, 61000), true)
  assert.equal(isApproximateRunResult(approximate, 60000), false)
  assert.equal(isApproximateRunResult({ ...approximate, runType: 'circuit' }, 61000), false)
  assert.equal(isApproximateRunResult({ ...approximate, resultTimeApproximate: false }, 61000), false)
  assert.equal(formatRunResultTime(approximate, 61000), '~01:01.000')
  assert.equal(formatRunResultTime({ runType: 'sprint', finalTimeMs: 61000 }, 61000), '01:01.000')
})

test('Lap summaries: the latest persisted lap is the highest lap number with a time; sprint and circuit labels differ', () => {
  const run = { runType: 'circuit', laps: [{ lapNumber: 1, timeMs: 90000 }, { lapNumber: 3, timeMs: 88000 }, { lapNumber: 2, timeMs: null }] }
  assert.equal(latestPersistedLap(run).lapNumber, 3)
  assert.equal(latestPersistedLap({ laps: [] }), null)
  assert.equal(savedRunTimeLabel(run), 'LAST 01:28.000')
  assert.equal(savedRunTimeLabel({ runType: 'circuit', laps: [] }), null)
  assert.equal(savedRunTimeLabel({ runType: 'sprint', finalTimeMs: 90000 }), 'RESULT 01:30.000')
  assert.equal(savedRunTimeLabel({ runType: 'sprint', finalTimeMs: null }), null)
  assert.equal(runBestTimeMs({ runType: 'sprint', finalTimeMs: 90000 }), 90000)
  assert.equal(runBestTimeMs({ runType: 'circuit', laps: [{ timeMs: 90000 }, { timeMs: 88000 }] }), 88000)
})

test('Run dates: a missing date is a dash, an invalid one is shown as written, and a valid one uses local time', () => {
  assert.equal(formatRunDate(null), '—')
  assert.equal(formatRunDate('soon'), 'soon')
  assert.equal(formatRunDate(new Date(2026, 0, 5, 9, 7, 3).toISOString()), '2026.01.05 09:07:03')
  assert.equal(runDateMs({ startedAt: null }), null)
  assert.equal(runDateMs({ startedAt: '2026-01-05T10:00:00Z' }), Date.parse('2026-01-05T10:00:00Z'))
  assert.ok(runIdCompare({ id: '10' }, { id: '9' }) > 0)
  assert.ok(runIdCompare({ id: 'b' }, { id: 'a' }) > 0)
})

test('Sector ranks: the fastest value is best and the next distinct value is second; runs need all three sectors for a total', () => {
  assert.deepEqual(distinctTimeRanks([3, 1, 2, 1]), { fastest: 1, second: 2 })
  assert.deepEqual(distinctTimeRanks([5]), { fastest: 5, second: null })
  assert.deepEqual(distinctTimeRanks([]), { fastest: null, second: null })
  const ranks = { fastest: 1, second: 2 }
  assert.equal(timeTone(1, ranks), 'best')
  assert.equal(timeTone(2, ranks), 'second')
  assert.equal(timeTone(3, ranks), '')
  assert.equal(timeTone(NaN, ranks), '')

  const run = {
    laps: [
      { sector1TimeMs: 30000, sector2TimeMs: 31000, sector3TimeMs: null },
      { sector1TimeMs: 29000, sector2TimeMs: 32000, sector3TimeMs: 28000 }
    ]
  }
  assert.deepEqual(runSectorBestTimes(run), [29000, 31000, 28000])
  assert.equal(runBestHypotheticalTimeMs(run), 88000)
  assert.equal(runBestHypotheticalTimeMs({ laps: [{ sector1TimeMs: 1000, sector2TimeMs: 1000, sector3TimeMs: null }] }), null)
})
