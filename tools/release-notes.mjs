import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const CATEGORIES = ['Breaking', 'Fixed', 'Added', 'Improved']

const VERSION_HEADING = /^## (\d+)\.(\d+)\.(\d+) - \d{4}-\d{2}-\d{2}$/

function compareVersions(left, right) {
  const index = left.findIndex((part, i) => part !== right[i])
  return index < 0 ? 0 : left[index] - right[index]
}

function splitSections(changelog) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n')
  const sections = []
  let current = null
  for (const line of lines) {
    if (line.startsWith('## ')) {
      current = { heading: line.trimEnd(), body: [] }
      sections.push(current)
    } else if (current) {
      current.body.push(line)
    }
  }
  return { title: lines[0], sections }
}

function validateCategories(section, errors) {
  const categories = []
  let entries = 0
  for (const line of section.body) {
    if (line.startsWith('#')) {
      const category = line.match(/^### (.+)$/)?.[1]
      if (!CATEGORIES.includes(category)) {
        errors.push(`${section.heading}: unexpected heading "${line}"`)
        continue
      }
      if (categories.includes(category)) errors.push(`${section.heading}: duplicate ${category}`)
      if (entries === 0 && categories.length > 0) errors.push(`${section.heading}: empty ${categories.at(-1)}`)
      categories.push(category)
      entries = 0
    } else if (line.startsWith('- ')) {
      entries += 1
    }
  }
  if (categories.length > 0 && entries === 0) errors.push(`${section.heading}: empty ${categories.at(-1)}`)
  const ordered = [...categories].sort((a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b))
  if (categories.join() !== ordered.join()) {
    errors.push(`${section.heading}: categories must follow ${CATEGORIES.join(', ')}`)
  }
}

export function validateChangelog(changelog) {
  const { title, sections } = splitSections(changelog)
  const errors = []
  if (title !== '# Changelog') errors.push('The first line must be "# Changelog"')
  if (sections[0]?.heading !== '## Unreleased') errors.push('The first section must be "## Unreleased"')

  let previous = null
  for (const [index, section] of sections.entries()) {
    validateCategories(section, errors)
    if (index === 0) continue
    const match = section.heading.match(VERSION_HEADING)
    if (!match) {
      errors.push(`Unexpected section heading "${section.heading}"`)
      continue
    }
    if (!section.body.join('\n').trim()) errors.push(`${section.heading}: section is empty`)
    const version = match.slice(1).map(Number)
    if (previous && compareVersions(version, previous) >= 0) {
      errors.push(`${section.heading}: releases must be listed newest first`)
    }
    previous = version
  }
  return errors
}

export function extractRelease(changelog, version) {
  const section = splitSections(changelog).sections
    .find(candidate => candidate.heading.startsWith(`## ${version} - `))
  const body = section?.body.join('\n').trim()
  if (!body) throw new Error(`CHANGELOG.md has no entries for ${version}`)
  return body
}

export function renderReleaseNotes(template, { version, previousTag, changes }) {
  return template
    .replaceAll('{{VERSION}}', version)
    .replaceAll('{{PREVIOUS_TAG}}', previousTag)
    .replaceAll('{{CHANGES}}', changes)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      version: { type: 'string' },
      'previous-tag': { type: 'string' },
      changelog: { type: 'string', default: 'CHANGELOG.md' },
      template: { type: 'string', default: 'docs/release-notes-template.md' },
      out: { type: 'string' }
    }
  })
  if (!values.version || !values.out) throw new Error('--version and --out are required')

  const changelog = readFileSync(values.changelog, 'utf8')
  const errors = validateChangelog(changelog)
  if (errors.length > 0) throw new Error(`CHANGELOG.md is invalid:\n${errors.join('\n')}`)

  const notes = renderReleaseNotes(readFileSync(values.template, 'utf8'), {
    version: values.version,
    previousTag: values['previous-tag'] || `v${values.version}`,
    changes: extractRelease(changelog, values.version)
  })
  writeFileSync(values.out, notes)
  console.log(`Release notes for ${values.version} written to ${values.out}`)
}
