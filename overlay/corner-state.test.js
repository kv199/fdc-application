const assert = require('node:assert/strict')
const test = require('node:test')

const { formatCornerReadout, isFinalCornerExit } = require('./corner-state.js')

function template(overrides = {}) {
  return {
    status: 'ready',
    sessionId: 27,
    eventId: 13,
    ...overrides
  }
}

function state(overrides = {}) {
  return {
    sessionId: 27,
    eventId: 13,
    phase: 'entry',
    cornerIndex: 1,
    direction: 'left',
    distanceToEntryM: 18.4,
    distanceToApexM: 42.3,
    distanceToExitM: 126.8,
    ...overrides
  }
}

test('formats the entry phase with corner identity and apex distance', () => {
  assert.deepEqual(formatCornerReadout(template(), state()), {
    visible: true,
    identity: 'T1 LEFT',
    phase: 'ENTRY',
    distance: 'APEX 42 m',
    phaseClass: 'entry'
  })
})

test('formats BETWEEN and APPROACH using entry distance', () => {
  const between = formatCornerReadout(template(), state({ phase: 'between', distanceToEntryM: 148.7 }))
  const approach = formatCornerReadout(template(), state({ phase: 'approach', distanceToEntryM: 62.2 }))

  assert.equal(between.identity, 'T1 LEFT')
  assert.equal(between.phase, 'BETWEEN')
  assert.equal(between.distance, 'ENTRY 149 m')
  assert.equal(approach.phase, 'APPROACH')
  assert.equal(approach.distance, 'ENTRY 62 m')
})

test('formats APEX and EXIT phases', () => {
  const apex = formatCornerReadout(template(), state({ phase: 'apex' }))
  const exit = formatCornerReadout(template(), state({ phase: 'exit', direction: 'right', distanceToExitM: 67.6 }))

  assert.equal(apex.identity, 'T1 LEFT')
  assert.equal(apex.phase, 'APEX')
  assert.equal(apex.distance, '')
  assert.equal(exit.identity, 'T1 RIGHT')
  assert.equal(exit.phase, 'EXIT')
  assert.equal(exit.distance, 'EXIT 68 m')
})

test('shows loading and hides idle or unavailable templates', () => {
  const loading = formatCornerReadout(template({ status: 'loading' }), null)
  const idle = formatCornerReadout(template({ status: 'idle' }), state())
  const unavailable = formatCornerReadout(template({ status: 'unavailable' }), state())

  assert.deepEqual(loading, {
    visible: true,
    identity: 'CORNERS …',
    phase: '',
    distance: '',
    phaseClass: 'loading'
  })
  assert.equal(idle.visible, false)
  assert.equal(unavailable.visible, false)
})

test('hides inactive states and never displays a stale corner', () => {
  const inactive = formatCornerReadout(template(), state({ phase: 'inactive' }))
  const oldSession = formatCornerReadout(template(), state({ sessionId: 26 }))
  const oldEvent = formatCornerReadout(template(), state({ eventId: 12 }))

  assert.equal(inactive.visible, false)
  assert.equal(oldSession.visible, false)
  assert.equal(oldEvent.visible, false)
})

test('clamps invalid negative distances and handles missing direction', () => {
  const readout = formatCornerReadout(template(), state({
    direction: 'unknown',
    distanceToApexM: -12
  }))

  assert.equal(readout.identity, 'T1')
  assert.equal(readout.distance, 'APEX 0 m')
})

test('does not retain an unbounded history', () => {
  const readout = formatCornerReadout(template(), state())

  assert.equal(Object.keys(readout).length, 5)
  assert.equal(Object.values(readout).some(value => Array.isArray(value)), false)
})

test('detects the transition after the final template corner', () => {
  const finalTemplate = template({
    corners: [{ index: 1 }, { index: 3 }, { index: 7 }]
  })

  assert.equal(isFinalCornerExit(state({ cornerIndex: 7 }), state({ cornerIndex: null }), finalTemplate), true)
  assert.equal(isFinalCornerExit(state({ cornerIndex: 3 }), state({ cornerIndex: null }), finalTemplate), false)
  assert.equal(isFinalCornerExit(state({ cornerIndex: 7 }), state({ cornerIndex: 1 }), finalTemplate), false)
})
