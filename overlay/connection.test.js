const assert = require('node:assert/strict')
const test = require('node:test')

const {
  normalizeTelemetrySource,
  resolveCoDriverWebSocketUrl,
  writeTelemetrySource
} = require('./connection.js')

test('uses the single Suite WebSocket endpoint', () => {
  assert.equal(resolveCoDriverWebSocketUrl(), 'ws://127.0.0.1:3001/_ws')
})

test('does not allow query parameters to select another runtime channel', () => {
  assert.equal(resolveCoDriverWebSocketUrl('?channel=production'), 'ws://127.0.0.1:3001/_ws')
})

test('normalizes the supported telemetry sources', () => {
  assert.equal(normalizeTelemetrySource('direct'), 'direct')
  assert.equal(normalizeTelemetrySource('suite'), 'suite')
  assert.equal(normalizeTelemetrySource('unknown'), 'direct')
})

test('writes a normalized telemetry source without requiring browser storage', () => {
  const previousStorage = global.localStorage
  const values = new Map()
  global.localStorage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  }

  assert.equal(writeTelemetrySource('suite'), 'suite')
  assert.equal(values.get('forza-horizon-6-hud.telemetry-source.v1'), 'suite')

  global.localStorage = previousStorage
})
