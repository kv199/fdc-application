# FDC Shift Light build

The canonical Shift Light learner source lives in this directory:

- `shift-light.ts` contains the learner and profile identity logic.
- `optimal-shift.ts` contains the local optimal-shift estimator.
- `telemetry.ts` defines the build-time telemetry contract supplied by FDC.
- `build.mjs` produces the browser bundle consumed by the overlay.

From the repository root, install the locked dev dependency and regenerate the
checked-in browser bundle:

```powershell
npm ci
npm run build:shift-light
npm run test:shift-light
```

The build writes `overlay/shift-light-engine.js`. The executable does not run
the TypeScript source or require a build tool at runtime.

The profile key and serialized profile fields are compatibility contracts:
`fh6:<carOrdinal>:<PI>:<rpmMax>` remains the identity for learning data, and
the native FDC SQLite schema is unchanged. Source or build changes must keep
the learner tests, build-integrity tests, and native persistence tests passing.
