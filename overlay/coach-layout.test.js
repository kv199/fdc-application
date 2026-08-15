const test = require('node:test')
const assert = require('node:assert/strict')

const { clampPosition, sanitizePosition } = require('./coach-layout.js')

test('sanitizePosition accepts finite coordinates and clamps them to the screen', () => {
  assert.deepEqual(sanitizePosition({ x: -0.2, y: 1.4 }), { x: 0, y: 1 })
})

test('sanitizePosition rejects malformed storage data', () => {
  assert.equal(sanitizePosition(null), null)
  assert.equal(sanitizePosition({ x: 'left', y: 0.4 }), null)
  assert.equal(sanitizePosition({ x: 0.4 }), null)
})

test('clampPosition falls back to the top-left for invalid positions', () => {
  assert.deepEqual(clampPosition({ x: Number.NaN, y: 0.5 }), { x: 0, y: 0 })
  assert.deepEqual(clampPosition({ x: 0.25, y: 0.75 }), { x: 0.25, y: 0.75 })
})
