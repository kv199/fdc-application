const test = require('node:test')
const assert = require('node:assert/strict')
const EventTheoreticalBest = require('./event-theoretical-best.js')

const sectorPayload = () => ({
  sectors: [
    { sector: 1, timeMs: 22871, runId: 6, lapNumber: 3, runType: 'circuit', carOrdinal: 812, carName: 'Supra', hasTrace: true },
    { sector: 2, timeMs: 23010, runId: 8, lapNumber: 5, runType: 'circuit', carOrdinal: 812, carName: 'Supra', hasTrace: true },
    { sector: 3, timeMs: 21940, runId: 6, lapNumber: 2, runType: 'circuit', carOrdinal: 812, carName: 'Supra', hasTrace: false }
  ]
})

test('normalizeSectors always returns Sector 1, 2 and 3 in order and fills missing entries with no time', () => {
  const sectors = EventTheoreticalBest.normalizeSectors({ sectors: [{ sector: 3, timeMs: 21940, runId: 6 }] })
  assert.deepEqual(sectors.map(sector => sector.sector), [1, 2, 3])
  assert.equal(sectors[0].timeMs, null)
  assert.equal(sectors[0].runId, null)
  assert.equal(sectors[2].timeMs, 21940)
  assert.equal(sectors[2].runId, '6')
  assert.equal(sectors[2].hasTrace, false)
})

test('normalizeSectors keeps camelCase fields, stringifies run ids and lowercases the run type', () => {
  const [first] = EventTheoreticalBest.normalizeSectors({
    sectors: [{ sector: 1, timeMs: '22871', runId: 6, lapNumber: '3', runType: ' SPRINT ', carOrdinal: 812, carName: '  ', hasTrace: true }]
  })
  assert.equal(first.timeMs, 22871)
  assert.equal(first.runId, '6')
  assert.equal(first.lapNumber, 3)
  assert.equal(first.runType, 'sprint')
  assert.equal(first.carOrdinal, 812)
  assert.equal(first.carName, null)
  assert.equal(first.hasTrace, true)
})

test('totalMs sums three timed sectors and is null while any sector is missing', () => {
  const sectors = EventTheoreticalBest.normalizeSectors(sectorPayload())
  assert.equal(EventTheoreticalBest.totalMs(sectors), 22871 + 23010 + 21940)
  const incomplete = EventTheoreticalBest.normalizeSectors({ sectors: sectorPayload().sectors.slice(0, 2) })
  assert.equal(EventTheoreticalBest.totalMs(incomplete), null)
  assert.equal(EventTheoreticalBest.totalMs([]), null)
})

test('sharedCarKey names one car only when all three sectors have that car', () => {
  const same = EventTheoreticalBest.normalizeSectors(sectorPayload())
  assert.equal(EventTheoreticalBest.sharedCarKey(same), 'ordinal:812')

  const mixed = EventTheoreticalBest.normalizeSectors(sectorPayload())
  mixed[1] = { ...mixed[1], carOrdinal: 900, carName: 'Civic' }
  assert.equal(EventTheoreticalBest.sharedCarKey(mixed), null)

  const missing = EventTheoreticalBest.normalizeSectors({ sectors: sectorPayload().sectors.slice(0, 2) })
  assert.equal(EventTheoreticalBest.sharedCarKey(missing), null)

  const namesOnly = EventTheoreticalBest.normalizeSectors({
    sectors: [1, 2, 3].map(sector => ({ sector, timeMs: 20000, runId: 1, carName: 'Supra' }))
  })
  assert.equal(EventTheoreticalBest.sharedCarKey(namesOnly), 'name:Supra')
})

test('distinctRunCount counts the saved runs that supply a sector time', () => {
  assert.equal(EventTheoreticalBest.distinctRunCount(EventTheoreticalBest.normalizeSectors(sectorPayload())), 2)
  const withoutRun = EventTheoreticalBest.normalizeSectors({ sectors: [{ sector: 1, timeMs: 20000, runId: null }] })
  assert.equal(EventTheoreticalBest.distinctRunCount(withoutRun), 0)
  assert.equal(EventTheoreticalBest.distinctRunCount(EventTheoreticalBest.normalizeSectors({})), 0)
})

test('formatSectorSeconds shows seconds to milliseconds and a dash without a time', () => {
  assert.equal(EventTheoreticalBest.formatSectorSeconds(22871), '22.871')
  assert.equal(EventTheoreticalBest.formatSectorSeconds(21940), '21.940')
  assert.equal(EventTheoreticalBest.formatSectorSeconds(null), '—')
})

test('sourceLabel names the lap of a circuit source and the sprint pass', () => {
  assert.equal(EventTheoreticalBest.sourceLabel({ runId: '6', lapNumber: 3, runType: 'circuit' }), 'RUN #6 · LAP 3')
  assert.equal(EventTheoreticalBest.sourceLabel({ runId: '6', lapNumber: 1, runType: 'sprint' }), 'RUN #6 · SPRINT')
  assert.equal(EventTheoreticalBest.sourceLabel({ runId: '6', lapNumber: null, runType: 'circuit' }), 'RUN #6')
})

test('openedStatus and sourceContext omit the lap for a sprint', () => {
  assert.equal(
    EventTheoreticalBest.openedStatus({ runId: '8', lapNumber: 5, sector: 2, runType: 'circuit' }),
    'Opened Run #8, Lap 5, Sector 2.'
  )
  assert.equal(
    EventTheoreticalBest.openedStatus({ runId: '8', lapNumber: 1, sector: 2, runType: 'sprint' }),
    'Opened Run #8, Sector 2.'
  )
  assert.equal(
    EventTheoreticalBest.sourceContext({ runId: '8', lapNumber: 5, sector: 2, runType: 'circuit' }),
    'FROM EVENT THEORETICAL BEST · RUN #8 · LAP 5 · SECTOR 2'
  )
  assert.equal(
    EventTheoreticalBest.sourceContext({ runId: '8', lapNumber: 5, sector: null, runType: 'circuit' }),
    'FROM EVENT THEORETICAL BEST · RUN #8 · LAP 5'
  )
  assert.equal(
    EventTheoreticalBest.sourceContext({ runId: '8', lapNumber: 1, sector: 3, runType: 'sprint' }),
    'FROM EVENT THEORETICAL BEST · RUN #8 · SECTOR 3'
  )
})

test('runDescription and footer copy match the page wording', () => {
  assert.equal(EventTheoreticalBest.runDescription('circuit'), 'Best sectors from laps in this run.')
  assert.equal(EventTheoreticalBest.runDescription('sprint'), 'Sector times from this run.')
  assert.equal(EventTheoreticalBest.EVENT_DESCRIPTION, 'Best sectors across saved runs in this event.')
  assert.equal(EventTheoreticalBest.ESTIMATE_NOTE, 'Sum of three virtual distance sectors; an estimate, not a recorded result.')
  assert.equal(EventTheoreticalBest.INCOMPLETE_NOTE, 'Complete all three sectors to calculate theoretical best.')
})
