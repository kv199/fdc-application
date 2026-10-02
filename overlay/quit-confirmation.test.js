const assert = require('node:assert/strict')
const test = require('node:test')

const QuitConfirmation = require('./quit-confirmation.js')

function createStorage(initialValue = null) {
  let value = initialValue
  return {
    getItem: key => key === QuitConfirmation.STORAGE_KEY ? value : null,
    setItem: (key, nextValue) => {
      if (key === QuitConfirmation.STORAGE_KEY) value = nextValue
    }
  }
}

test('asks before quitting by default and sanitizes stored values', () => {
  assert.equal(QuitConfirmation.STORAGE_KEY, 'fdc.quit-confirmation.v1')
  assert.deepEqual(QuitConfirmation.read(createStorage()), { confirm: true, quitBefore: false })
  assert.deepEqual(QuitConfirmation.read(createStorage('not json')), { confirm: true, quitBefore: false })
  assert.deepEqual(QuitConfirmation.normalize({ confirm: 'no', quitBefore: 1 }), { confirm: true, quitBefore: false })
  const storage = createStorage()
  QuitConfirmation.write({ confirm: false, quitBefore: true }, storage)
  assert.deepEqual(QuitConfirmation.read(storage), { confirm: false, quitBefore: true })
})

test('offers "Don\'t ask again" only after the first confirmed quit', () => {
  const first = QuitConfirmation.question({ confirm: true, quitBefore: false }, false)
  assert.equal(first.offerDontAsk, false)
  assert.match(first.message, /minimize this window/)

  const afterFirst = QuitConfirmation.afterQuit({ confirm: true, quitBefore: false }, false)
  assert.deepEqual(afterFirst, { confirm: true, quitBefore: true })
  assert.equal(QuitConfirmation.question(afterFirst, false).offerDontAsk, true)

  const dontAsk = QuitConfirmation.afterQuit(afterFirst, true)
  assert.deepEqual(dontAsk, { confirm: false, quitBefore: true })
  assert.equal(QuitConfirmation.question(dontAsk, false), null)
})

test('a recording always asks and never offers "Don\'t ask again"', () => {
  const recording = QuitConfirmation.question({ confirm: false, quitBefore: true }, true)
  assert.equal(recording.offerDontAsk, false)
  assert.match(recording.message, /recording is in progress/)
  assert.equal(QuitConfirmation.question({ confirm: true, quitBefore: true }, true).offerDontAsk, false)
})
