import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

test('canonical Shift Light source graph is local to FDC', () => {
  const sourceFiles = [
    'src/shift-light/shift-light.ts',
    'src/shift-light/optimal-shift.ts',
    'src/shift-light/telemetry.ts'
  ]

  for (const file of sourceFiles) {
    const source = read(file)
    assert.doesNotMatch(source, /apps[\\/]co-driver|server[\\/]utils[\\/]decode|co-driver/iu)
  }

  assert.match(read('src/shift-light/shift-light.ts'), /from ['"]\.\/telemetry['"]/u)
  assert.match(read('src/shift-light/shift-light.ts'), /from ['"]\.\/optimal-shift['"]/u)
  assert.match(read('src/shift-light/optimal-shift.ts'), /from ['"]\.\/telemetry['"]/u)
})

test('local build workflow targets the checked-in overlay bundle', () => {
  const packageJson = read('package.json')
  const buildScript = read('tools/build-shift-light.mjs')

  assert.match(packageJson, /"build:shift-light": "node tools\/build-shift-light\.mjs"/u)
  assert.match(packageJson, /"esbuild": "0\.28\.2"/u)
  assert.match(buildScript, /src\/shift-light\/shift-light\.ts/u)
  assert.match(buildScript, /overlay\/shift-light-engine\.js/u)
  assert.doesNotMatch(buildScript, /tools[\\/]shift-light[\\/]/u)
  assert.doesNotMatch(buildScript, /apps[\\/]co-driver|server[\\/]utils[\\/]decode|co-driver/iu)
})

test('checked-in bundle has the FDC-owned export and no external source path', () => {
  const bundle = read('overlay/shift-light-engine.js')

  assert.match(bundle, /^\/\/ FDC-owned Shift Light utility/u)
  assert.match(bundle, /globalThis\.HudShiftLight = HudShiftLight/u)
  assert.match(bundle, /src\/shift-light\/shift-light\.ts/u)
  assert.match(bundle, /src\/shift-light\/optimal-shift\.ts/u)
  assert.doesNotMatch(bundle, /tools[\\/]shift-light[\\/]/u)
  assert.doesNotMatch(bundle, /apps[\\/]co-driver|server[\\/]utils[\\/]decode|co-driver/iu)
})
