const test = require('node:test')
const assert = require('node:assert/strict')

global.localStorage = {
  getItem: () => JSON.stringify({ tires: false, gear: false })
}

const preferences = require('./hud-preferences.js')

test.after(() => {
  delete global.localStorage
})

test('legacy HUD visibility keeps existing choices and enables the new Engine block', () => {
  assert.deepEqual(preferences.readState(), {
    tires: false,
    pedals: true,
    steering: true,
    gear: false,
    engine: true,
    history: true
  })
})

test('HUD component order places Engine directly before Input Graph', () => {
  assert.deepEqual(preferences.components, ['tires', 'pedals', 'steering', 'gear', 'engine', 'history'])
})
