# Releasing FDC

## Branches

- `develop` is the working branch. Each logically complete and locally
  verified change is committed to `develop` and pushed to `origin/develop`.
- `main` is the release branch and the default GitHub branch. It contains only
  released source and changes only by fast-forwarding to `develop` during a
  release. Nothing is committed directly to `main`; fixes also go through
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

Replace `X.Y.Z` with the version in `src-tauri/Cargo.toml`:

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
2. runs the Node tests, `cargo fmt --check`, and the release Rust tests;
3. builds the NSIS installer with `npm run build:installer`;
4. prepares the release assets and their SHA-256 files;
5. renders the release notes from
   [release-notes-template.md](release-notes-template.md);
6. creates a draft GitHub release titled `FDC X.Y.Z`.

The workflow fails if a release for the tag already exists.

### Review and publish

Open the draft release, replace the `TODO` items in the notes with all
user-facing changes since the previous release, optionally download and check
the installer, then publish the release.

### Publishing an existing tag

A tag that was pushed before the workflow existed, such as `v7.16.46`, is
released manually: open **Actions → Release → Run workflow**, enter the tag,
and run it. The workflow file comes from `main`, but it builds the tag's
commit.

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

## Release notes

The workflow copies [release-notes-template.md](release-notes-template.md) into
the draft and replaces:

- `{{VERSION}}` with the version, for example `7.16.46`;
- `{{PREVIOUS_TAG}}` with the previous version tag, for example `v7.16.45`.
