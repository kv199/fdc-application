import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const thisTestFile = resolve(root, 'tools/public-readiness.test.mjs')

function getTrackedFiles() {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    return output.split('\0').filter(f => f.length > 0)
  } catch {
    return null
  }
}

test('no tracked file is a forbidden artifact', (t) => {
  const trackedFiles = getTrackedFiles()
  if (trackedFiles === null) {
    t.skip('git is unavailable or directory is not a git work tree')
    return
  }

  const forbiddenExtensions = [
    'exe', 'msi', 'sqlite', 'db', 'wal', 'shm', 'log',
    'replay', 'recording', 'telemetry', 'pfx', 'p12', 'pem', 'key', 'env'
  ]
  const forbiddenExtPattern = new RegExp(`\\.(${forbiddenExtensions.join('|')})$`, 'i')
  const forbiddenNamePattern = /\.(sqlite|db)-/
  const forbiddenDirPattern = /^(target|src-tauri[/\\]target|node_modules|data|recordings|telemetry|captures|export|exports|qa|outputs)[/\\]/

  const offenders = []
  for (const file of trackedFiles) {
    if (forbiddenExtPattern.test(file) ||
        forbiddenNamePattern.test(file) ||
        forbiddenDirPattern.test(file)) {
      offenders.push(file)
    }
  }

  assert.equal(offenders.length, 0, `Tracked forbidden artifacts found: ${offenders.join(', ')}`)
})

test('no tracked text file contains an absolute user-profile path', (t) => {
  const trackedFiles = getTrackedFiles()
  if (trackedFiles === null) {
    t.skip('git is unavailable or directory is not a git work tree')
    return
  }

  const binaryExtensions = [
    'png', 'ico', 'icns', 'jpg', 'jpeg', 'gif', 'webp', 'woff', 'woff2', 'ttf'
  ]
  const binaryExtPattern = new RegExp(`\\.(${binaryExtensions.join('|')})$`, 'i')

  // Build Windows path pattern (C:\Users\name) from pieces
  const winDrive = '[A-Za-z]'
  const winPath = new RegExp(`${winDrive}:[/\\\\]Users[/\\\\][^/\\\\:*?"<>|]+`)

  // Build Unix path patterns
  const unixUserPath = /\/Users\/[^/]+/
  const unixHomePath = /\/home\/[^/]+/

  const offenders = []
  for (const file of trackedFiles) {
    // Skip binary files
    if (binaryExtPattern.test(file)) {
      continue
    }

    // Skip this test file itself
    if (file === 'tools/public-readiness.test.mjs' || file === thisTestFile) {
      continue
    }

    try {
      const content = readFileSync(resolve(root, file), 'utf8')

      // Check for NUL byte to detect binary files not caught by extension
      if (content.substring(0, 8000).includes('\0')) {
        continue
      }

      // Check for absolute paths
      if (winPath.test(content) || unixUserPath.test(content) || unixHomePath.test(content)) {
        offenders.push(file)
      }
    } catch {
      // Skip files that can't be read as text
    }
  }

  assert.equal(offenders.length, 0, `Tracked text files with absolute user paths found: ${offenders.join(', ')}`)
})

test('no tracked text file contains a PEM private key header', (t) => {
  const trackedFiles = getTrackedFiles()
  if (trackedFiles === null) {
    t.skip('git is unavailable or directory is not a git work tree')
    return
  }

  const binaryExtensions = [
    'png', 'ico', 'icns', 'jpg', 'jpeg', 'gif', 'webp', 'woff', 'woff2', 'ttf'
  ]
  const binaryExtPattern = new RegExp(`\\.(${binaryExtensions.join('|')})$`, 'i')

  // Build PEM header pattern from pieces to avoid literal in source
  const beginStr = '-----BEGIN'
  const privateStr = 'PRIVATE KEY'
  const endStr = '-----'
  const pemPattern = new RegExp(`${beginStr}[^\\n]*${privateStr}[^\\n]*${endStr}`)

  const offenders = []
  for (const file of trackedFiles) {
    // Skip binary files
    if (binaryExtPattern.test(file)) {
      continue
    }

    try {
      const content = readFileSync(resolve(root, file), 'utf8')

      // Check for NUL byte to detect binary files
      if (content.substring(0, 8000).includes('\0')) {
        continue
      }

      // Check for PEM private key header
      if (pemPattern.test(content)) {
        offenders.push(file)
      }
    } catch {
      // Skip files that can't be read as text
    }
  }

  assert.equal(offenders.length, 0, `Tracked files with PEM private key headers found: ${offenders.join(', ')}`)
})
