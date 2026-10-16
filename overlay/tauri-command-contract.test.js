const test = require('node:test')
const assert = require('node:assert/strict')

const { registeredTauriCommands, invokedTauriCommands } = require('../tools/test-sources.cjs')

// Registered commands that runtime JS does not call. Each entry says why.
// The current entries have no caller at all and are kept until their removal is decided.
const NOT_INVOKED_FROM_JS = new Map([
  ['clear_hud_edit_hotkey', 'unused: no caller in runtime JS or Rust'],
  ['delete_driver_analysis_session', 'unused: JS deletes whole recordings with delete_driver_analysis_recording'],
  ['load_garage', 'unused: JS loads the Garage with load_garage_snapshot']
])

test('every command invoked from runtime JS is registered in generate_handler!', () => {
  const registered = new Set(registeredTauriCommands())
  const missing = invokedTauriCommands().filter(name => !registered.has(name))
  assert.deepEqual(missing, [], 'runtime JS calls commands that the Tauri handler does not register')
})

test('every registered command is invoked from runtime JS, except the reviewed allowlist', () => {
  const invoked = new Set(invokedTauriCommands())
  const uninvoked = registeredTauriCommands().filter(name => !invoked.has(name))
  assert.deepEqual(
    uninvoked.filter(name => !NOT_INVOKED_FROM_JS.has(name)),
    [],
    'registered commands with no runtime JS caller must be added to NOT_INVOKED_FROM_JS with a reason'
  )
})

test('the command allowlist names only registered commands that runtime JS does not call', () => {
  const registered = new Set(registeredTauriCommands())
  const invoked = new Set(invokedTauriCommands())
  for (const name of NOT_INVOKED_FROM_JS.keys()) {
    assert.ok(registered.has(name), `${name} is allowlisted but not registered`)
    assert.ok(!invoked.has(name), `${name} is allowlisted but runtime JS now calls it; remove it from the allowlist`)
  }
})

test('the source helpers read the configuration page scripts and the Rust backend sources', () => {
  const { readConfigurationScripts, readHudScripts, readRustSources } = require('../tools/test-sources.cjs')
  assert.match(readConfigurationScripts(), /function readHudEditHotkeySettings\(/)
  assert.match(readHudScripts(), /function invokeTauri\(command, args\)/)
  assert.match(readRustSources(), /fn load_garage_snapshot\(/)
  assert.match(readRustSources(), /generate_handler!\[/)
})
