# Project Instructions

## Product ownership and repository boundary

- This repository contains **Forza Horizon 6 HUD**, an independent product
  conceived and owned by Kirill.
- This is not a fork, subproject, or vendored copy of `co-driver`.
- The expected project root on the primary development machine is
  `C:\Install\forza-horizon-6-hud`.
- `co-driver` is a separate external project that acts as a local telemetry data
  provider. It owns UDP reception, Forza packet decoding, telemetry persistence,
  Docker configuration, and its web application.
- This HUD consumes only the local WebSocket contract exposed by `co-driver`:
  production uses `ws://127.0.0.1:3000/_ws`, while development/lab uses
  `ws://127.0.0.1:3001/_ws`.
- Do not copy, vendor, embed, rename, or modify `co-driver` source code from this
  repository. Do not operate on its database or Docker setup unless the user
  explicitly requests a cross-repository task.
- Related local directories have distinct responsibilities:
  - `C:\Install\co-driver` is the external telemetry server project.
  - `C:\Install\forza-horizon-6-co-pilot` is the archived combined project.
- If the WebSocket contract must change, treat it as coordinated work across two
  independent repositories, with separate validation and commits in each.

## Before changing anything

- Confirm the working directory, Git root, current branch, and working-tree
  status before editing.
- When continuing earlier feature or visual work, inspect the local branches and
  relevant recent commits before choosing the baseline. Do not assume that the
  checked-out branch or `develop` contains the accepted visual variant.
- Stop if the Git root is not exactly this HUD repository. Do not guess between
  similarly named Forza or co-driver directories.
- Use `README.md` for startup, demo/live URLs, and build instructions. Use the
  relevant ADR for protocol or window architecture instead of rediscovering
  those decisions from `co-driver`.
- Preserve unrelated and user-owned changes. Never discard or rewrite them to
  make the task easier.
- Keep the requested scope narrow. Do not add settings, packaging, analytics, or
  unrelated cleanup as part of a HUD change unless explicitly requested.

## Git workflow

- `main` contains verified, releasable versions used for gaming.
- `develop` is the default working and integration branch for day-to-day work.
- For normal tasks, work and commit directly on `develop`. Do not create a task
  branch by default.
- Accumulate focused, validated commits on `develop` so the user can test them as
  a batch.
- Create a short-lived `feature/<name>` branch from `develop` only after the user
  and Codex explicitly agree that a change is large, risky, or long-running
  enough to benefit from isolation.
- Never commit directly to `main`.
- Merge `develop` into `main` only when the user explicitly confirms that the
  accumulated work is accepted and requests the promotion.
- Do not push, rewrite history, or otherwise alter remote branches without
  explicit user approval, except for the approved release workflow below.
- Treat an explicit request to release or promote to production as approval for
  the complete workflow: merge `develop` into `main`, validate and build on
  `main`, then push both `develop` and `main` to `origin`. Do not report the
  release as complete if either push fails or was skipped.
- Do not push feature branches as part of the normal release workflow unless
  explicitly requested.
- For completed implementation work, create a focused commit after validation.
- Use concise Conventional Commit messages such as
  `feat(hud): add opacity control` or `fix(telemetry): bound reconnect attempts`.
- Never include unrelated changes in a commit.

## Build channels

- Git branches and Cargo build profiles are separate concepts, but this project
  maps them into two user-facing build channels.
- Build testable development executables from `develop` with the custom
  `develop` Cargo profile. The expected output is
  `src-tauri/target/develop/forza-horizon-6-hud.exe`.
- Build stable gaming executables from `main` with the standard `release` Cargo
  profile. The expected output is
  `src-tauri/target/release/forza-horizon-6-hud.exe`.
- A feature branch is not a user-facing build channel. For pre-merge testing,
  use the `develop` profile with an isolated target directory:
  `cargo build --profile develop --locked --target-dir target/<branch-slug>`.
  Report the result as a feature preview, not as the standard develop build.
- Reserve Cargo's standard `debug` output for technical diagnostics. Do not hand
  it off as the normal development build.
- Before reporting an executable as a `develop` or `release` build, confirm that
  the checked-out Git branch matches the corresponding build channel and that
  the file was rebuilt after the latest changes. State the branch, absolute
  `.exe` path, selected WebSocket endpoint, and remaining manual game test.

## Architecture invariants

- Preserve the runtime data flow:
  `Forza Data Out -> co-driver -> WebSocket -> Tauri HUD`.
- Do not duplicate co-driver's UDP decoder, database, telemetry storage, or web
  application in this repository unless an architectural change is explicitly
  approved.
- Preserve the transparent, always-on-top, focusless, click-through HUD window.
- Do not inject DLLs, read Forza process memory, hook DirectX, or emulate input.
  Use the official telemetry stream only.
- Preserve the restrictive Content Security Policy and local-only network access
  unless a security-reviewed task explicitly requires a change.
- Treat throttle and brake as normalized `0..1` values and steering as `-1..1`.
  Do not present normalized steering as a measured physical steering-wheel angle.
- Treat `speedKmh` as canonical incoming telemetry. Unit preferences in the
  `co-driver` web UI are display-only and are not part of the HUD contract.

## Frontend conventions

- Keep the overlay dependency-free: plain HTML, CSS, and browser JavaScript.
- Do not introduce a frontend framework, bundler, or runtime dependency without
  explicit justification and approval.
- Use two-space indentation, single quotes, and no semicolons in JavaScript.
- Keep documentation and user-visible HUD text in English; use `km/h`, `RPM`,
  and `°C` for the current canonical telemetry units.
- Keep scripts and styles in external files because the CSP disallows inline
  code.
- Preserve accessible labels, meter attributes, and semantic output elements.
- Coalesce telemetry updates with `requestAnimationFrame`.
- Keep telemetry history bounded.
- Prefer Canvas for frequently redrawn graphs and steering visuals.
- Avoid per-sample DOM nodes, unbounded allocations, and large blur effects.

## Current HUD design

Unless a task explicitly requests a redesign:

- Preserve the current compact telemetry layout. Treat `overlay/overlay.css` and
  `src-tauri/tauri.conf.json` as the source of truth for dimensions and scaling.
- Keep the order: tires, pedals, steering, gear, input history.
- Keep front tire temperatures above the tire shapes and rear temperatures
  below them.
- Keep brake on the left in red and throttle on the right in green.
- Draw input history as lines without filled areas or time labels.
- Rotate the complete steering wheel together with its yellow center marker.
- Do not reintroduce pedal labels, percentages, gear labels, or steering degrees.
- Treat settings, tray controls, positioning, scaling, installers, and auto-start
  as separate product stages rather than incidental scope.

## Rust conventions

- Keep compatibility with Rust 1.85 or newer and edition 2024.
- Format Rust using rustfmt.
- Avoid new production dependencies unless they materially reduce long-term
  maintenance cost.
- Keep Tauri configuration and Rust window behavior synchronized.

## Validation

Run checks appropriate to the changed area:

- Rust formatting:
  `cargo fmt --check --manifest-path src-tauri/Cargo.toml`
- Rust/Tauri correctness for normal work, from `src-tauri` on `develop`:
  `cargo check --profile develop --locked`
- Development delivery, from `src-tauri` on `develop`:
  `cargo build --profile develop --locked`
- Release delivery, from `src-tauri` on `main` after an approved merge:
  `cargo build --release --locked`
- Release synchronization, after the validated `main` build:
  `git push origin develop main`
- Diagnostic debug build, only when specifically needed:
  `cargo build --locked`
- JavaScript syntax, when Node.js is available:
  `node --check overlay/overlay.js`
- JavaScript unit tests:
  `node --test overlay/*.test.js`

For visual changes:

- Test `overlay/index.html` in demo mode with `?demo=1`.
- Test at the dimensions configured by the checked-out branch and inspect for
  clipping and overflow.
- Check the browser console.
- Verify tires, pedals, steering, gear, connection states, and input history.
- Remember that `?demo=1` intentionally disables WebSocket access; use the live
  workflow from `README.md` when validating telemetry.
- Do not claim a change was tested in Forza unless it was tested with live
  telemetry.

State clearly which checks were run and which still require manual game testing.

## Documentation and architectural decisions

- Update `README.md` when setup, build commands, runtime dependencies, or user
  behavior changes.
- Record durable architectural decisions in `ADR/adr_yyyy_mm_dd.md`.
- Add an ADR for repository boundaries, protocol changes, persistence,
  security-sensitive behavior, major dependencies, or window architecture.
- Do not create ADR entries for minor styling adjustments.

## Generated and local files

Never commit:

- `src-tauri/target/`
- `src-tauri/gen/`
- local telemetry or database data
- logs
- temporary screenshots and design-QA artifacts
- generated executables

## Code Review Rules

- Flag any change that blurs ownership between this HUD and `co-driver`.
- Flag unbounded telemetry buffers or per-frame allocation growth.
- Flag changes to the WebSocket URL or message schema without coordinated
  documentation and validation.
- Flag regressions in transparency, click-through, always-on-top, focus behavior,
  or reconnection.
- Flag relaxation of CSP or non-local network access without a clear need.
- Flag generated artifacts or local telemetry data added to Git.
