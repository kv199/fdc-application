const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getRoutePresentation,
  normalizeRouteStatus
} = require('./telemetry-route.js')

test('normalizes unknown route values to a safe Direct offline state', () => {
  assert.deepEqual(normalizeRouteStatus({ source: 'other', phase: 'broken', suiteState: 'maybe' }), {
    source: 'direct',
    phase: 'offline',
    suiteState: 'unavailable',
    message: '',
    revision: 0
  })
})

test('describes a live Direct route without implying Suite input', () => {
  const presentation = getRoutePresentation({ source: 'direct', phase: 'live' })

  assert.equal(presentation.statusLabel, 'DIRECT · LIVE')
  assert.equal(presentation.endpoint, 'UDP 127.0.0.1:5301')
  assert.match(presentation.detail, /directly/)
  assert.equal(presentation.warning, '')
  assert.equal(presentation.tone, 'live')
})

test('makes simultaneous Suite reception explicit while Direct remains authoritative', () => {
  const presentation = getRoutePresentation({
    source: 'direct',
    phase: 'live',
    suiteState: 'receiving'
  })

  assert.equal(presentation.statusLabel, 'DIRECT · LIVE')
  assert.match(presentation.warning, /HUD input is Direct UDP/)
  assert.match(presentation.warning, /also receiving UDP packets/)
})

test('distinguishes Suite transport availability from live Forza telemetry', () => {
  const waiting = getRoutePresentation({ source: 'suite', phase: 'waiting' })
  const live = getRoutePresentation({ source: 'suite', phase: 'live' })

  assert.equal(waiting.statusLabel, 'SUITE · WAITING FOR FORZA')
  assert.match(waiting.detail, /provider is connected/)
  assert.equal(live.statusLabel, 'SUITE · LIVE')
})

test('preserves a Direct bind error and exposes retry', () => {
  const presentation = getRoutePresentation({
    source: 'direct',
    phase: 'error',
    message: 'Unable to bind UDP 127.0.0.1:5301: address in use'
  })

  assert.match(presentation.detail, /address in use/)
  assert.equal(presentation.tone, 'error')
  assert.equal(presentation.canRetry, true)
})
