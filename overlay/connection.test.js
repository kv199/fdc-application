const assert = require('node:assert/strict')
const test = require('node:test')

const { resolveCoDriverWebSocketUrl } = require('./connection.js')

test('uses the single Suite WebSocket endpoint', () => {
  assert.equal(resolveCoDriverWebSocketUrl(), 'ws://127.0.0.1:3001/_ws')
})

test('does not allow query parameters to select another runtime channel', () => {
  assert.equal(resolveCoDriverWebSocketUrl('?channel=production'), 'ws://127.0.0.1:3001/_ws')
})
