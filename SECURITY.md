# Security policy

## Supported versions

Security fixes are provided for the latest published FDC release. Older builds
may be replaced by a newer release instead of receiving a separate patch.

## Reporting a vulnerability

Use GitHub private vulnerability reporting. In the repository's **Security** tab,
select **Report a vulnerability**.

When reporting, include:

- the affected FDC version and Windows version;
- the steps needed to reproduce the problem;
- the security impact you observed;
- a minimal proof of concept when it is safe to share.

**Do not** open a public issue, discussion, or pull request for an unpatched
vulnerability. Do not attach real telemetry captures, `fdc.sqlite` databases,
passwords, API keys, signing material, usernames, filesystem paths, or other
personal data. Use synthetic values in screenshots, logs, and test cases.

If private reporting is unavailable, contact the owner through the contact
method on their [GitHub profile](https://github.com/kv199) without sensitive
details in public.

## Release trust

FDC's official Windows x64 installers are attached to GitHub releases. Each
official release includes a matching SHA-256 checksum file.

- Official installers: built by the Release workflow (`.github/workflows/release.yml`)
  from a version tag on `main`.
- Each installer has a matching `.sha256` file containing the lowercase hex hash and filename.
- Installers are unsigned. SmartScreen warnings and "Unknown publisher" messages
  are expected and normal.
- A release must not be described as signed until its Authenticode signature
  can be verified successfully.

Local builds, `develop` branch builds, and CI builds from pull requests are not
official releases.
