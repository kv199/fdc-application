const assert = require('node:assert/strict')
const test = require('node:test')

const ConnectionGuide = require('./connection-guide.js')

function createStorage(initialValue = null) {
  let value = initialValue
  return {
    getItem: key => key === ConnectionGuide.STORAGE_KEY ? value : null,
    setItem: (key, nextValue) => {
      if (key === ConnectionGuide.STORAGE_KEY) value = nextValue
    }
  }
}

test('remembers whether Forza has ever sent Data Out', () => {
  assert.equal(ConnectionGuide.STORAGE_KEY, 'fdc.connection-guide.v1')
  assert.deepEqual(ConnectionGuide.read(createStorage()), { connected: false })
  assert.deepEqual(ConnectionGuide.read(createStorage('not json')), { connected: false })
  assert.deepEqual(ConnectionGuide.normalize({ connected: 'yes' }), { connected: false })
  const storage = createStorage()
  ConnectionGuide.write({ connected: true }, storage)
  assert.deepEqual(ConnectionGuide.read(storage), { connected: true })
})

test('shows the guide only before the first connection and without Garage cars', () => {
  assert.equal(ConnectionGuide.shouldShow({ connected: false }, false), true)
  assert.equal(ConnectionGuide.shouldShow({ connected: true }, false), false)
  assert.equal(ConnectionGuide.shouldShow({ connected: false }, true), false)
})

test('maps every route tone to a guide stage', () => {
  assert.equal(ConnectionGuide.stage('live'), 'connected')
  assert.equal(ConnectionGuide.stage('waiting'), 'waiting')
  assert.equal(ConnectionGuide.stage('stale'), 'waiting')
  assert.equal(ConnectionGuide.stage('offline'), 'problem')
  assert.equal(ConnectionGuide.stage('error'), 'problem')
})
