/**
 * Test helpers that read the program's source as text without assuming which
 * file a piece of code lives in. Splitting settings.js or main.rs into several
 * files must not break a test that only asserts behavior, so tests read the
 * combined text of a set of files instead of one hard-coded path.
 */
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const overlayDir = path.join(root, 'overlay')
const rustSourceDir = path.join(root, 'src-tauri', 'src')

// Separator placed before each file in a combined text. It names the file, so a
// failing assertion still shows where the code is.
const separator = label => `\n// ---- ${label} ----\n`

function readNormalized(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
}

// Files in `dir` whose name passes `predicate`, sorted by relative POSIX path so
// the combined text has the same order on every platform.
function listFiles(dir, predicate, { recursive = false } = {}) {
  const found = []
  const visit = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (recursive) visit(full)
      } else if (predicate(entry.name)) {
        found.push(full)
      }
    }
  }
  visit(dir)
  return found
    .map(file => ({ file, label: path.relative(dir, file).split(path.sep).join('/') }))
    .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
}

/**
 * All Rust sources of the Tauri backend (src-tauri/src, recursively) as one text,
 * CRLF normalized to LF. Rust code may move between modules, so tests search this
 * text rather than main.rs.
 * @returns {string}
 */
function readRustSources() {
  return listFiles(rustSourceDir, name => name.endsWith('.rs'), { recursive: true })
    .map(({ file, label }) => `${separator(`src-tauri/src/${label}`)}${readNormalized(file)}`)
    .join('')
    .replace(/^\n/, '')
}

/**
 * The local scripts that overlay/<htmlFileName> loads with <script src="...">, in
 * document order, as one text. Remote scripts (http/https) are skipped. A local
 * script that the page references but that does not exist is an error, so a stale
 * reference cannot pass silently.
 * @param {string} htmlFileName page file name inside overlay/, such as 'settings.html'
 * @returns {string}
 */
function readPageScripts(htmlFileName) {
  const html = readNormalized(path.join(overlayDir, htmlFileName)).replace(/<!--[\s\S]*?-->/g, '')
  const parts = []
  for (const match of html.matchAll(/<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const src = match[1]
    if (/^(https?:)?\/\//i.test(src)) continue
    const file = path.join(overlayDir, src)
    if (!fs.existsSync(file)) throw new Error(`${htmlFileName} loads ${src}, which is missing from overlay/`)
    parts.push(`${separator(`overlay/${src}`)}${readNormalized(file)}`)
  }
  if (parts.length === 0) throw new Error(`${htmlFileName} loads no local scripts`)
  return parts.join('').replace(/^\n/, '')
}

/**
 * All local scripts of the Configuration window (overlay/settings.html), as one text.
 * Tests use it for what the Configuration page's code does, whichever file holds it.
 * @returns {string}
 */
function readConfigurationScripts() {
  return readPageScripts('settings.html')
}

/**
 * All local scripts of the HUD overlay page (overlay/index.html), as one text.
 * @returns {string}
 */
function readHudScripts() {
  return readPageScripts('index.html')
}

/**
 * Command names listed in the tauri::generate_handler![ ... ] of the Rust sources,
 * with module prefixes removed (controller_input::start_controller_capture becomes
 * start_controller_capture). Sorted and without duplicates.
 * @returns {string[]}
 */
function registeredTauriCommands() {
  const rust = readRustSources()
  const marker = 'generate_handler!['
  const start = rust.indexOf(marker)
  if (start === -1) throw new Error('no tauri::generate_handler![ in src-tauri/src')
  const open = start + marker.length - 1
  let depth = 0
  let close = -1
  for (let index = open; index < rust.length && close === -1; index += 1) {
    if (rust[index] === '[') depth += 1
    else if (rust[index] === ']') {
      depth -= 1
      if (depth === 0) close = index
    }
  }
  if (close === -1) throw new Error('unterminated generate_handler![')
  const names = rust
    .slice(open + 1, close)
    .replace(/\/\/[^\n]*/g, '')
    .split(',')
    .map(entry => entry.trim().split('::').pop())
    .filter(Boolean)
  return [...new Set(names)].sort()
}

// Functions through which runtime JS calls a native command, with the command name
// as a string first argument. The list was taken from the overlay sources:
// invokeTauri (overlay.js), invokeCommand (shift-light-runtime.js), invokeDefault
// (garage-runtime.js), call (settings.js), persistenceCall (event-recorder.js) and
// reset, a local alias of __TAURI_INTERNALS__.invoke in settings.js.
const INVOKE_WRAPPERS = ['invoke', 'invokeTauri', 'invokeCommand', 'invokeDefault', 'call', 'persistenceCall', 'reset']

/**
 * Native command names that the runtime JS (overlay/*.js, excluding *.test.js)
 * calls. Tauri plugin commands (plugin:...) are not application commands and are
 * left out.
 * @returns {string[]}
 */
function invokedTauriCommands() {
  const names = new Set()
  const wrapperCall = new RegExp('(?<![\\w$.])(?:' + INVOKE_WRAPPERS.join('|') + ')\\s*\\(\\s*[\'"`]([^\'"`]+)[\'"`]', 'g')
  // Direct calls on the Tauri internals object, such as internals.invoke('...').
  const memberInvoke = /\.invoke\s*\(\s*['"`]([^'"`]+)['"`]/g
  const runtimeFiles = listFiles(overlayDir, name => name.endsWith('.js') && !name.endsWith('.test.js'))
  for (const { file } of runtimeFiles) {
    const source = readNormalized(file)
    for (const pattern of [wrapperCall, memberInvoke]) {
      for (const match of source.matchAll(pattern)) {
        if (!match[1].startsWith('plugin:')) names.add(match[1])
      }
    }
  }
  return [...names].sort()
}

module.exports = {
  readRustSources,
  readPageScripts,
  readConfigurationScripts,
  readHudScripts,
  registeredTauriCommands,
  invokedTauriCommands
}
