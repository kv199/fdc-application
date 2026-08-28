import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const source = resolve(root, 'src/shift-light/shift-light.ts')
const output = resolve(root, 'overlay/shift-light-engine.js')

await build({
  entryPoints: [source],
  bundle: true,
  format: 'iife',
  globalName: 'HudShiftLight',
  platform: 'browser',
  outfile: output,
  legalComments: 'inline',
  banner: {
    js: '// FDC-owned Shift Light utility; keep this browser module self-contained.'
  },
  footer: {
    js: 'if (typeof globalThis !== "undefined") globalThis.HudShiftLight = HudShiftLight; if (typeof module !== "undefined") module.exports = HudShiftLight;'
  }
})

const bundle = readFileSync(output, 'utf8')
  .replaceAll('// src/shift-light/shift-light.ts', '// tools/shift-light/shift-light.ts')
  .replaceAll('// src/shift-light/optimal-shift.ts', '// tools/shift-light/optimal-shift.ts')
writeFileSync(output, bundle)

console.log(`Shift Light bundle generated: ${output}`)
