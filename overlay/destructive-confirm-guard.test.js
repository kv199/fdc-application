const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Every delete or reset of saved data must ask through the shared ARE YOU SURE? dialog, never the browser confirm().
const NATIVE_CONFIRM = /(?:\bwindow|\bglobalScope|\bglobalThis)\.confirm\b|(?<![\w.])confirm\(/
const DESTRUCTIVE_COMMAND = /['"](?:delete|reset)_\w+['"]/g

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

function unconfirmedCommands(source) {
  return [...source.matchAll(DESTRUCTIVE_COMMAND)]
    .filter(match => !/await confirmDestructive\(/.test(enclosingFunction(source, match.index)))
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

test('every delete and reset command waits for confirmDestructive first', () => {
  const sources = overlaySources()
  const offenders = sources.flatMap(({ name, source }) => unconfirmedCommands(source).map(command => `${name}: ${command}`))
  assert.deepEqual(offenders, [])
  const commands = sources.flatMap(({ source }) => [...source.matchAll(DESTRUCTIVE_COMMAND)].map(match => match[0]))
  for (const command of ["'delete_event'", "'delete_driver_analysis_recording'", "'reset_shift_light'"]) {
    assert.ok(commands.includes(command), `the guard must see ${command}`)
  }
})

test('the guard recognizes an unconfirmed command and a browser confirm', () => {
  assert.deepEqual(unconfirmedCommands(`async function remove() {\n  await call('delete_event', {})\n}`), ["'delete_event'"])
  assert.deepEqual(unconfirmedCommands(`function reset() {\n  invoke('reset_shift_light')\n}`), ["'reset_shift_light'"])
  assert.deepEqual(unconfirmedCommands(`async function remove() {\n  if (!(await confirmDestructive('x'))) return\n  await call('delete_event', {})\n}`), [])
  for (const line of ["if (!window.confirm('x')) return", "globalScope.confirm('x')", "confirm('x')"]) assert.match(line, NATIVE_CONFIRM)
  for (const line of ['await confirmDestructive(message)', 'closeDestructiveConfirm(false)']) assert.doesNotMatch(line, NATIVE_CONFIRM)
})
