import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { extractRelease, renderReleaseNotes, validateChangelog } from './release-notes.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

function changelog(...sections) {
  return ['# Changelog', '', ...sections].join('\n')
}

test('the repository changelog follows the release format', () => {
  assert.deepEqual(validateChangelog(read('CHANGELOG.md')), [])
})

test('the release notes template keeps its placeholders', () => {
  const template = read('docs/release-notes-template.md')
  for (const placeholder of ['{{VERSION}}', '{{PREVIOUS_TAG}}', '{{CHANGES}}']) {
    assert.ok(template.includes(placeholder), `${placeholder} is missing`)
  }
})

test('categories must be known, non-empty, and ordered', () => {
  const valid = changelog(
    '## Unreleased', '', '### Fixed', '- A fix.', '', '### Improved', '- A tweak.', '',
    '## 1.2.3 - 2026-01-01', '', '### Breaking', '- A break.', '', '### Added', '- A feature.'
  )
  assert.deepEqual(validateChangelog(valid), [])

  const errors = validateChangelog(changelog(
    '## Unreleased', '', '### Added', '- A feature.', '', '### Fixed', '- A fix.', '',
    '### Changed', '- Unknown.', '', '### Improved', ''
  ))
  assert.equal(errors.length, 3)
  assert.match(errors.join('\n'), /unexpected heading "### Changed"/)
  assert.match(errors.join('\n'), /empty Improved/)
  assert.match(errors.join('\n'), /categories must follow Breaking, Fixed, Added, Improved/)
})

test('releases must be dated, non-empty, and listed newest first', () => {
  const errors = validateChangelog(changelog(
    '## Unreleased', '',
    '## 1.2.3 - 2026-01-01', '', '- Older.', '',
    '## 1.3.3 - 2026-02-01', '', '- Newer.', '',
    '## 1.4.0', '', '- Undated.', '',
    '## 1.0.0 - 2025-01-01', ''
  ))
  assert.match(errors.join('\n'), /1\.3\.3 .*newest first/)
  assert.match(errors.join('\n'), /Unexpected section heading "## 1\.4\.0"/)
  assert.match(errors.join('\n'), /1\.0\.0 .*section is empty/)
  assert.match(validateChangelog('# Changes\n\n## 1.0.0 - 2025-01-01\n\n- One.').join('\n'), /first line.*first section/s)
})

test('a release section is extracted and rendered into the template', () => {
  const text = changelog(
    '## Unreleased', '', '### Fixed', '- Not released.', '',
    '## 1.2.4 - 2026-01-02', '', '### Fixed', '- Released fix.', '',
    '## 1.2.3 - 2026-01-01', '', '- First.'
  )
  const changes = extractRelease(text, '1.2.4')
  assert.equal(changes, '### Fixed\n- Released fix.')
  assert.throws(() => extractRelease(text, '9.9.9'), /no entries for 9\.9\.9/)

  const notes = renderReleaseNotes('v{{VERSION}} since {{PREVIOUS_TAG}}\n{{CHANGES}}', {
    version: '1.2.4',
    previousTag: 'v1.2.3',
    changes
  })
  assert.equal(notes, 'v1.2.4 since v1.2.3\n### Fixed\n- Released fix.')
})
