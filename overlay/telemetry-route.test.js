const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getRoutePresentation,
  normalizeRouteStatus
} = require('./telemetry-route.js')

test('normalizes unknown route values to a safe Direct Data Out offline state', () => {
  assert.deepEqual(normalizeRouteStatus({ phase: 'broken', message: null }), {
    phase: 'offline',
    message: '',
    revision: 0
  })
})

test('describes a live Direct Data Out route', () => {
  const presentation = getRoutePresentation({ phase: 'live' })

  assert.equal(presentation.statusLabel, 'DIRECT DATA OUT · LIVE')
  assert.equal(presentation.endpoint, 'UDP 127.0.0.1:5301')
  assert.match(presentation.detail, /receiving Forza Horizon 6 Data Out directly/)
  assert.equal(presentation.warning, '')
  assert.equal(presentation.tone, 'live')
})

test('describes missing packets without introducing another transport state', () => {
  const presentation = getRoutePresentation({ phase: 'stale' })

  assert.equal(presentation.statusLabel, 'DIRECT DATA OUT · DATA STALE')
  assert.match(presentation.detail, /packets have stopped arriving/)
  assert.equal(presentation.warning, '')
})

test('preserves a Direct UDP bind error and exposes retry', () => {
  const presentation = getRoutePresentation({
    phase: 'error',
    message: 'Unable to bind UDP 127.0.0.1:5301: address in use'
  })

  assert.match(presentation.detail, /address in use/)
  assert.equal(presentation.tone, 'error')
  assert.equal(presentation.canRetry, true)
})
