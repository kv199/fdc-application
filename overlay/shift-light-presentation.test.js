const assert = require('node:assert/strict')
const test = require('node:test')

const { LATCH_MS, createShiftLightPresentation } = require('./shift-light-presentation.js')

test('latches purple shift presentation immediately for at least 250 ms', () => {
  let clock = 1000
  const presentation = createShiftLightPresentation(() => clock)

  assert.equal(presentation.update('shift'), 'shift')
  clock += LATCH_MS - 1
  assert.equal(presentation.update('normal'), 'shift')
  clock += 2
  assert.equal(presentation.getPhase(), 'normal')
})
test('returns to the latest approach phase after the latch expires', () => {
  let clock = 2000
  const presentation = createShiftLightPresentation(() => clock)

  presentation.update('shift')
  clock += LATCH_MS + 1
  assert.equal(presentation.update('approach'), 'approach')
})
