# FDC repository guidance

## Repository identity

- Product: FDC (`Feedback-Driven Companion`).
- Application: standalone Windows Tauri application for Forza Horizon 6.
- `main` is the only supported permanent branch.
- The supported runnable build is the Cargo `release` build.
- While working on `main`, commit each logically complete and locally verified
  in-scope change and push it to the configured GitHub `origin/main`; do not
  leave completed work only locally.

## Current system boundary

- FDC receives Forza Horizon 6 Data Out on `127.0.0.1:5301`.
- The native Tauri layer decodes packets into normalized telemetry.
- The browser overlay consumes telemetry through `queueTelemetry`.
- Current consumers are the Telemetry HUD, lap timing, Asphalt Coach, and Shift Light.
- Shift Light persistence belongs to FDC-local `fdc.sqlite`.
- Preserve the local runtime boundary and do not add another telemetry transport.

## Documentation routing

Read only the source relevant to the current task:

- Current system data flow: `docs/architecture.md`
- Asphalt Coach behavior: `docs/asphalt-coach.md`
- Shift Light behavior and contracts: `docs/shift-light.md`
- Specific decision record relevant to the current task: `ADR/`

Do not load all documentation or the entire `ADR/` directory by default.
Current code is the behavioral authority. Current documentation describes
implemented behavior. If they disagree, inspect and report the discrepancy
before changing runtime behavior.

## Verification by change type

- Documentation-only changes: check links and claims, then run
  `git diff --check`.
- Browser or Coach changes: run `node --check` for affected files and the
  relevant Node.js tests.
- Shift Light changes: run `npm run build:shift-light` and
  `npm run test:shift-light`. Compare `overlay/shift-light-engine.js` when
  runtime behavior should remain unchanged.
- Native or release changes: run the locked release Cargo format, test, check,
  and build commands from the repository root.
- Release handoff: launch
  `src-tauri/target/release/fdc-application.exe` and confirm that it remains
  alive for at least five seconds.

## Data and generated artifacts

- Keep build output, executables, `target/`, SQLite databases, telemetry
  captures, logs, exports, and QA screenshots out of Git.
- Runtime Shift Light data belongs in the application-data directory as
  `fdc.sqlite`.
- Canonical Shift Light TypeScript source lives in `src/shift-light/`.
- `tools/build-shift-light.mjs` generates the runtime bundle at
  `overlay/shift-light-engine.js`.
- Rebuild generated assets from canonical source; do not maintain separate
  runtime implementations.

## Change discipline

- For explanation, review, diagnosis, or planning, inspect the relevant
  materials and report the result. Do not edit files unless the request asks
  for a change.
- For requested changes, builds, or fixes, make the in-scope local changes and
  run relevant non-destructive validation without asking first.
- Reading files, inspecting logs, editing in-scope files, and running relevant
  tests are normal local actions within the requested task.
- Ask before destructive actions, external writes, or material scope expansion.
- If an ambiguity can change behavior, data ownership, permissions, security,
  or task scope, stop and ask for clarification.
- Preserve the Direct Data Out packet contract and normalized `queueTelemetry`
  path.
- Keep Asphalt Coach asphalt-only, current-run, and zero-reference.
- Do not add track identity, ideal-line guidance, driving scores, exact
  time-loss claims, or unsupported findings without an explicit product
  decision.
- Preserve Shift Light learner APIs, vehicle identity, numeric variant IDs,
  telemetry contracts, SQLite migration safety, and local persistence.
- Documentation must describe implemented behavior only and must be written in
  English.
- Keep decision records unchanged unless updating them is explicitly requested.
- Do not introduce new runtime channels, external telemetry dependencies, or
  unsupported features.
