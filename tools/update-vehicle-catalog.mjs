// Builds the FH6 vehicle catalog (CarOrdinal -> display name and car type) that
// FDC embeds in the application. It runs only on a developer machine; the
// application itself never uses the network.
//
// Sources, with thanks:
// - HDR's "Forza Horizon 6 Car Ordinals" gist (car name -> CarOrdinal):
//   https://gist.github.com/HDR/0659d1717bc61504bf83750628963f4f
// - The official Forza Horizon 6 car list (official name and car type):
//   https://forza.net/fh6cars
//
// Placeholder entries and AI traffic vehicles are left out of the catalog.
// Ordinals whose HDR name has no exact official counterpart are resolved by hand
// in tools/vehicle-catalog-overrides.json: an official Car Name, or null to keep
// the HDR name without a car type.
//
// Usage: node tools/update-vehicle-catalog.mjs [--write]
// Without --write the run is a dry run. With --write the catalog is written to
// src-tauri/data/vehicle-catalog.json only when every ordinal is resolved.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const HDR_GIST_ID = '0659d1717bc61504bf83750628963f4f'
const HDR_GIST_URL = `https://gist.github.com/HDR/${HDR_GIST_ID}`
const HDR_API_URL = `https://api.github.com/gists/${HDR_GIST_ID}`
const OFFICIAL_URL = 'https://forza.net/fh6cars'
const USER_AGENT = 'fdc-vehicle-catalog'
const TRAFFIC_VEHICLE = /\(Traffic\)\s*$/i

export const CAR_TYPE_ALIASES = {
  'Rods and Customs': 'Rods & Customs',
  'Electic Domestics': 'Eclectic Domestics'
}

const NAMED_ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }

export function normalizeCarType(type) {
  return CAR_TYPE_ALIASES[type] ?? type
}

export function decodeHtmlEntities(text) {
  // A single pass keeps an encoded entity such as &amp;#39; literal.
  return String(text ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, body) => {
      if (body[0] === '#') {
        const hex = body[1] === 'x' || body[1] === 'X'
        return String.fromCodePoint(hex ? parseInt(body.slice(2), 16) : Number(body.slice(1)))
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? entity
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function foldCase(text) {
  return String(text).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function normalizeName(name) {
  return foldCase(name).replace(/[^a-z0-9]/g, '')
}

function cellsOf(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map(match => decodeHtmlEntities(match[1]))
}

export function parseOfficialCarList(html) {
  const table = html.match(/<table[^>]*>[\s\S]*?<\/table>/i)?.[0]
  if (!table) throw new Error('Official car list: no table found')

  const head = table.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i)?.[1] ?? ''
  const headers = cellsOf(head, 'th')
  if (headers[0] !== 'Make' || headers[1] !== 'Car Name' || headers[2] !== 'Car Type') {
    throw new Error(`Official car list: header must start with Make, Car Name, Car Type; found ${headers.slice(0, 3).join(', ') || 'none'}`)
  }

  const body = table.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? ''
  const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match, index) => {
    const [make, name, carType] = cellsOf(match[1], 'td')
    if (!make || !name || !carType) throw new Error(`Official car list: row ${index + 1} lacks Make, Car Name, or Car Type`)
    return { make, name, carType: normalizeCarType(carType) }
  })
  if (rows.length === 0) throw new Error('Official car list: no rows found')
  return rows
}

export function parseHdrOrdinals(object) {
  const seen = new Set()
  const entries = []
  for (const [name, value] of Object.entries(object)) {
    // HDR keeps placeholder entries such as NUL_CAR_00; real cars start with a model year.
    // AI traffic vehicles are not player cars, so the catalog leaves them out.
    if (!/^\d{4} /.test(name) || TRAFFIC_VEHICLE.test(name)) continue
    if (!/^\d+$/.test(String(value)) || Number(value) <= 0) throw new Error(`HDR: invalid ordinal for "${name}": ${value}`)
    const ordinal = Number(value)
    if (seen.has(ordinal)) throw new Error(`HDR: duplicate ordinal ${ordinal}`)
    seen.add(ordinal)
    entries.push({ ordinal, name: name.trim() })
  }
  return entries
}

export function validateOverrides(overrides) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('Overrides must be an object')
  if (overrides.schema !== 1) throw new Error('Overrides schema must be 1')
  const { matches } = overrides
  if (!matches || typeof matches !== 'object' || Array.isArray(matches)) throw new Error('Overrides must have a "matches" object')
  for (const [key, value] of Object.entries(matches)) {
    if (!/^[1-9]\d*$/.test(key)) throw new Error(`Override key must be a positive integer string, got: ${key}`)
    if (value !== null && (typeof value !== 'string' || value.trim() === '')) {
      throw new Error(`Override value for ${key} must be a non-empty string or null`)
    }
  }
  return overrides
}

function tokens(name) {
  const words = foldCase(name).match(/[a-z0-9]+/g) ?? []
  const year = /^\d{4}$/.test(words[0] ?? '') ? Number(words[0]) : null
  return { year, words: new Set(year === null ? words : words.slice(1)) }
}

export function scoreCandidate(hdrName, officialName) {
  const hdr = tokens(hdrName)
  const official = tokens(officialName)
  const longest = Math.max(hdr.words.size, official.words.size)
  if (longest === 0) return 0
  const shared = [...hdr.words].filter(word => official.words.has(word)).length
  const yearPenalty = hdr.year !== null && official.year !== null ? 0.25 * Math.min(Math.abs(hdr.year - official.year), 2) : 0
  return Math.round((shared / longest - yearPenalty) * 100) / 100
}

function candidatesFor(hdrName, official) {
  return official
    .map(row => ({ name: row.name, carType: row.carType, score: scoreCandidate(hdrName, row.name) }))
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 5)
}

export function buildCatalog({ hdr, official, overrides }) {
  const officialByName = new Map()
  for (const row of official) {
    const key = normalizeName(row.name)
    officialByName.set(key, [...(officialByName.get(key) ?? []), row])
  }
  const matches = new Map(Object.entries(overrides?.matches ?? {}).map(([key, value]) => [Number(key), value]))

  const vehicles = []
  const unresolved = []
  const staleOverrides = []
  const stats = { exact: 0, override: 0, hdrOnly: 0, unresolved: 0, stale: 0 }

  for (const { ordinal, name } of hdr) {
    if (matches.has(ordinal)) {
      const officialName = matches.get(ordinal)
      if (officialName === null) {
        vehicles.push({ ordinal, name, carType: null })
        stats.hdrOnly += 1
        continue
      }
      const rows = officialByName.get(normalizeName(officialName)) ?? []
      if (rows.length === 1) {
        vehicles.push({ ordinal, name: rows[0].name, carType: rows[0].carType })
        stats.override += 1
      } else {
        staleOverrides.push({
          ordinal,
          officialName,
          reason: rows.length === 0 ? 'the official list has no such Car Name' : 'the Car Name matches several official rows'
        })
      }
      continue
    }

    const rows = officialByName.get(normalizeName(name)) ?? []
    if (rows.length === 1) {
      vehicles.push({ ordinal, name: rows[0].name, carType: rows[0].carType })
      stats.exact += 1
    } else if (rows.length > 1) {
      unresolved.push({
        ordinal,
        hdrName: name,
        reason: 'several official rows share this name',
        candidates: rows.map(row => ({ name: row.name, carType: row.carType, score: 1 }))
      })
    } else {
      unresolved.push({ ordinal, hdrName: name, reason: 'no exact official match', candidates: candidatesFor(name, official) })
    }
  }

  const hdrOrdinals = new Set(hdr.map(entry => entry.ordinal))
  for (const [ordinal, officialName] of matches) {
    if (!hdrOrdinals.has(ordinal)) staleOverrides.push({ ordinal, officialName, reason: 'HDR no longer lists this ordinal' })
  }

  vehicles.sort((left, right) => left.ordinal - right.ordinal)
  unresolved.sort((left, right) => left.ordinal - right.ordinal)
  staleOverrides.sort((left, right) => left.ordinal - right.ordinal)
  stats.unresolved = unresolved.length
  stats.stale = staleOverrides.length
  return { vehicles, unresolved, staleOverrides, stats }
}

function renderVehicle({ ordinal, name, carType }) {
  return `{ "ordinal": ${ordinal}, "name": ${JSON.stringify(name)}, "carType": ${JSON.stringify(carType ?? null)} }`
}

export function renderCatalog({ sources, vehicles }) {
  // One vehicle per line keeps weekly catalog diffs readable.
  const header = JSON.stringify({ schema: 1, game: 'fh6', sources }, null, 2).replace(/\n\}$/, '')
  const lines = [...vehicles].sort((left, right) => left.ordinal - right.ordinal).map(vehicle => `    ${renderVehicle(vehicle)}`)
  const list = lines.length === 0 ? '[]' : `[\n${lines.join(',\n')}\n  ]`
  return `${header},\n  "vehicles": ${list}\n}\n`
}

export function diffCatalogs(previousVehicles, nextVehicles) {
  const previous = new Map(previousVehicles.map(vehicle => [vehicle.ordinal, vehicle]))
  const next = new Map(nextVehicles.map(vehicle => [vehicle.ordinal, vehicle]))
  const changed = []
  for (const vehicle of nextVehicles) {
    const before = previous.get(vehicle.ordinal)
    if (before && (before.name !== vehicle.name || before.carType !== vehicle.carType)) {
      changed.push({ ordinal: vehicle.ordinal, previous: before, next: vehicle })
    }
  }
  return {
    added: nextVehicles.filter(vehicle => !previous.has(vehicle.ordinal)),
    removed: previousVehicles.filter(vehicle => !next.has(vehicle.ordinal)),
    changed
  }
}

async function fetchChecked(url, parse) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
  return parse(response)
}

async function fetchHdr() {
  const gist = await fetchChecked(HDR_API_URL, response => response.json())
  const file = Object.values(gist.files ?? {}).find(candidate => candidate.filename?.endsWith('.json'))
  if (!file) throw new Error('HDR gist has no JSON file')
  const content = file.truncated ? await fetchChecked(file.raw_url, response => response.text()) : file.content
  return {
    entries: parseHdrOrdinals(JSON.parse(content)),
    source: { url: HDR_GIST_URL, revision: gist.history?.[0]?.version ?? null, updatedAt: gist.updated_at ?? null }
  }
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw new Error(`${path}: ${error.message}`)
  }
}

function describe(vehicle) {
  return `${vehicle.ordinal} ${vehicle.name}${vehicle.carType ? ` [${vehicle.carType}]` : ''}`
}

async function main() {
  const { values } = parseArgs({ options: { write: { type: 'boolean', default: false } } })
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const catalogPath = resolve(root, 'src-tauri/data/vehicle-catalog.json')
  const overrides = validateOverrides(readJson(resolve(root, 'tools/vehicle-catalog-overrides.json'), { schema: 1, matches: {} }))
  const previous = readJson(catalogPath, null)

  const hdr = await fetchHdr()
  const official = parseOfficialCarList(await fetchChecked(OFFICIAL_URL, response => response.text()))
  const result = buildCatalog({ hdr: hdr.entries, official, overrides })
  const { stats } = result

  console.log(`HDR ordinals: ${hdr.entries.length}, official rows: ${official.length}`)
  console.log(`Exact: ${stats.exact}, override: ${stats.override}, HDR only: ${stats.hdrOnly}, unresolved: ${stats.unresolved}, stale overrides: ${stats.stale}`)

  if (previous) {
    const diff = diffCatalogs(previous.vehicles ?? [], result.vehicles)
    console.log(`\nAgainst the current catalog: +${diff.added.length} added, -${diff.removed.length} removed, ${diff.changed.length} changed`)
    for (const vehicle of diff.added) console.log(`  + ${describe(vehicle)}`)
    for (const vehicle of diff.removed) console.log(`  - ${describe(vehicle)}`)
    for (const change of diff.changed) console.log(`  ~ ${describe(change.previous)} -> ${describe(change.next)}`)
  }

  for (const item of result.staleOverrides) console.log(`\nStale override ${item.ordinal} (${item.officialName}): ${item.reason}`)
  for (const item of result.unresolved) {
    console.log(`\nUnresolved ${item.ordinal} ${item.hdrName}: ${item.reason}`)
    for (const candidate of item.candidates) console.log(`  ${candidate.score.toFixed(2)}  ${candidate.name} [${candidate.carType}]`)
  }

  if (!values.write) return
  if (stats.unresolved > 0 || stats.stale > 0) {
    console.error('\nNot written: resolve every unresolved ordinal and stale override in tools/vehicle-catalog-overrides.json first.')
    process.exitCode = 1
    return
  }
  const sources = { hdr: hdr.source, official: { url: OFFICIAL_URL, fetchedAt: new Date().toISOString().slice(0, 10) } }
  mkdirSync(dirname(catalogPath), { recursive: true })
  writeFileSync(catalogPath, renderCatalog({ sources, vehicles: result.vehicles }))
  console.log(`\nWrote ${result.vehicles.length} vehicles to src-tauri/data/vehicle-catalog.json`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
