const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Every delete must ask through the shared ARE YOU SURE? dialog, never the browser confirm().
const NATIVE_CONFIRM = /(?:\bwindow|\bglobalScope|\bglobalThis)\.confirm\b|(?<![\w.])confirm\(/
const DELETE_COMMAND = /call\('delete_\w+'/g

function overlaySources() {
  return fs.readdirSync(__dirname)
    .filter(name => name.endsWith('.js') && !name.endsWith('.test.js') && name !== 'shift-light-engine.js')
    .map(name => ({ name, source: fs.readFileSync(path.join(__dirname, name), 'utf8') }))
}

// The code from the nearest `function` keyword before an index, which is the function that contains it.
function enclosingFunction(source, index) {
  const start = source.lastIndexOf('function ', index)
  return source.slice(start, index)
}

function deleteCallsWithoutConfirmation(source) {
  return [...source.matchAll(DELETE_COMMAND)]
    .filter(match => !/await confirmDelete\(/.test(enclosingFunction(source, match.index)))
    .map(match => match[0])
}

test('overlay code never uses the browser confirm()', () => {
  const offenders = overlaySources()
    .flatMap(({ name, source }) => source.split(/\r?\n/)
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => !/^\s*\/\//.test(line) && NATIVE_CONFIRM.test(line))
      .map(({ line, number }) => `${name}:${number}: ${line.trim()}`))
  assert.deepEqual(offenders, [])
})

test('every delete command waits for confirmDelete first', () => {
  const offenders = overlaySources().flatMap(({ name, source }) => deleteCallsWithoutConfirmation(source).map(call => `${name}: ${call}`))
  assert.deepEqual(offenders, [])
  assert.ok(overlaySources().some(({ source }) => source.includes("call('delete_")), 'the guard must see the delete commands')
})

test('the guard recognizes an unconfirmed delete and a browser confirm', () => {
  assert.deepEqual(deleteCallsWithoutConfirmation(`async function remove() {\n  await call('delete_event', {})\n}`), ["call('delete_event'"])
  assert.deepEqual(deleteCallsWithoutConfirmation(`async function remove() {\n  if (!(await confirmDelete('x'))) return\n  await call('delete_event', {})\n}`), [])
  for (const line of ["if (!window.confirm('x')) return", "globalScope.confirm('x')", "confirm('x')"]) assert.match(line, NATIVE_CONFIRM)
  for (const line of ['await confirmDelete(message)', 'closeDeleteConfirm(false)']) assert.doesNotMatch(line, NATIVE_CONFIRM)
})
