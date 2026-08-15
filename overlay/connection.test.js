const assert = require('node:assert/strict')
const test = require('node:test')

const {
  resolveCoDriverChannel,
  resolveCoDriverWebSocketUrl
} = require('./connection.js')

test('defaults to the production WebSocket channel', () => {
  assert.equal(resolveCoDriverChannel(''), 'production')
  assert.equal(resolveCoDriverWebSocketUrl(''), 'ws://127.0.0.1:3000/_ws')
})

test('selects the development WebSocket channel explicitly', () => {
  assert.equal(resolveCoDriverChannel('?channel=develop'), 'develop')
  assert.equal(resolveCoDriverWebSocketUrl('?channel=develop'), 'ws://127.0.0.1:3001/_ws')
})

test('keeps unknown channels on production', () => {
  assert.equal(resolveCoDriverChannel('?channel=staging'), 'production')
  assert.equal(resolveCoDriverWebSocketUrl('?channel=staging'), 'ws://127.0.0.1:3000/_ws')
})
