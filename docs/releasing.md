# Releasing FDC

## Branches

- `develop` is the working branch. Each logically complete and locally
  verified change is committed to `develop` and pushed to `origin/develop`.
- `main` is the release branch and the default GitHub branch. It contains only
  released source and changes only by fast-forwarding to `develop` during a
  release or a
  [documentation-only publication](#publishing-documentation-without-a-release).
  Nothing is committed directly to `main`; fixes also go through
  `develop`, so the two branches never carry different versions.

## Versioning

### Version source

`src-tauri/Cargo.toml` is the sole canonical application version source. The
Tauri configuration omits `version`.

### Bump rules

Bump the version according to user impact:

- user-facing runtime features require a minor bump;
- fixes and safe UI or behavior improvements require a patch bump;
- breaking compatibility, persistence, or contract changes require a major
  bump.

Lower-order version components are never reset. For example, a user-facing
feature changes `1.1.14` to `1.2.14`, a subsequent fix changes it to `1.2.15`,
and a breaking change changes it to `2.2.15`. This is an intentional FDC rule
and does not follow SemVer's reset convention.

Documentation-only changes, tests-only changes, and nonbehavioral refactors do
not bump the version.

### Bumps on `develop`

Every version bump happens on `develop`: it updates `src-tauri/Cargo.toml`, is
reflected in `src-tauri/Cargo.lock`, passes the release verification cycle in
[development.md](development.md), and is committed and pushed to `develop`.
No tags are created on `develop`.

A release therefore carries the version reached on `develop` at release time,
and version jumps between releases are expected. For example, after several
changes on `develop` the next release after `v7.16.46` may be `v8.18.49`.
Intermediate versions appear only in the `src-tauri/Cargo.toml` history:

```powershell
git log -p src-tauri/Cargo.toml
```

## Release procedure

### Prerequisites

- CI is green on `develop`.
- The release verification cycle in [development.md](development.md) has passed
  for the final `develop` state.

### Steps

Replace `X.Y.Z` with the version in `src-tauri/Cargo.toml`.

1. On `develop`, finalize the [changelog](#changelog): rename `## Unreleased`
   to `## X.Y.Z - YYYY-MM-DD` with today's date, add a new empty
   `## Unreleased` above it, then commit and push:

   ```powershell
   git commit -am "docs: finalize the X.Y.Z changelog"
   git push origin develop
   ```

2. After CI passes for that commit, fast-forward `main`, tag the release, and
   return to `develop`:

   ```powershell
   git switch main
   git pull --ff-only origin main
   git merge --ff-only develop
   git push origin main
   git tag -a vX.Y.Z -m "FDC X.Y.Z"
   git push origin vX.Y.Z
   git switch develop
   ```

### What the Release workflow does

Pushing the tag runs the Release workflow (`.github/workflows/release.yml`).
It uses the GitHub environment `release`, which can require manual approval.
The workflow:

1. validates that the tag has the form `vX.Y.Z`, equals the
   `src-tauri/Cargo.toml` version, and points to a commit contained in `main`;
2. renders the [release notes](#release-notes) from the `X.Y.Z` section of
   `CHANGELOG.md`, and fails immediately if that section is missing or the
   changelog format is invalid;
3. runs the Node tests, `cargo fmt --check`, and the release Rust tests;
4. builds the NSIS installer with `npm run build:installer`;
5. prepares the release assets and their SHA-256 files;
6. creates a draft GitHub release titled `FDC X.Y.Z`.

The workflow fails if a release for the tag already exists. Its runs are named
`Release vX.Y.Z` in the Actions list.

### Review and publish

Open the draft from the
[Releases](https://github.com/kv199/fdc-application/releases) page, review the
notes, optionally download and check the installer from **Assets**, then
select **Edit → Publish release**.

### Publishing documentation without a release

When `develop` has no version bump since the latest release tag, its changes
are documentation, tests, or CI only. On the owner's request, `main` may then
be fast-forwarded to `develop` without creating a tag, so the default branch
shows current documentation:

```powershell
git diff --quiet vX.Y.Z develop -- src-tauri/Cargo.toml
git switch main
git pull --ff-only origin main
git merge --ff-only develop
git push origin main
git switch develop
```

Replace `vX.Y.Z` with the latest release tag. The first command must succeed:
if `src-tauri/Cargo.toml` changed since that tag, the changes need a regular
release instead.

### Publishing an existing tag

A tag that was pushed before the workflow existed, such as `v7.16.46`, is
released manually: open **Actions → Release → Run workflow**, enter the tag,
and run it. The workflow file comes from `main`, but it builds the tag's
commit. The release notes come from `main` as well, so `CHANGELOG.md` on
`main` must contain the tag's section.

## Release assets

| File | Contents |
| --- | --- |
| `FDC_<version>_x64-setup.exe` | NSIS installer for the version |
| `FDC_<version>_x64-setup.exe.sha256` | SHA-256 of the versioned installer |
| `FDC-setup.exe` | The same installer under a stable name |
| `FDC-setup.exe.sha256` | SHA-256 of `FDC-setup.exe` |

Each `.sha256` file contains `<lowercase hex hash>  <file name>`. The stable
name makes
`https://github.com/kv199/fdc-application/releases/latest/download/FDC-setup.exe`
always download the latest published installer.

## Changelog

[`CHANGELOG.md`](../CHANGELOG.md) lists user-facing changes, newest release
first. The `## Unreleased` section collects changes on `develop` until the next
release.

Every user-facing change adds one entry under `## Unreleased` in the same
commit, in the category that matches its version bump:

| Category | Use for | Version bump |
| --- | --- | --- |
| `### Breaking` | Incompatible data, settings, or behavior changes | major |
| `### Fixed` | Bug fixes | patch |
| `### Added` | New features | minor |
| `### Improved` | Safe UI or behavior improvements | patch |

Rules:

- categories appear in the order Breaking, Fixed, Added, Improved, and a
  category is added only when it has an entry;
- each entry is one `- ` bullet written for users: what changed for them, not
  how the code changed;
- documentation-only, tests-only, CI, and nonbehavioral refactor changes get no
  entry;
- a release section is headed `## X.Y.Z - YYYY-MM-DD` and is never empty.

The Node test suite validates this format, so CI fails on an unknown or
misordered category, an empty category or release, or a release listed out of
order.

## Release notes

`tools/release-notes.mjs` renders
[release-notes-template.md](release-notes-template.md) into the draft and
replaces:

- `{{CHANGES}}` with the body of the `X.Y.Z` section of `CHANGELOG.md`;
- `{{VERSION}}` with the version, for example `7.16.46`;
- `{{PREVIOUS_TAG}}` with the previous version tag, for example `v7.16.45`.
