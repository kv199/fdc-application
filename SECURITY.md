# Security policy

## Supported versions

Security fixes are provided for the latest published FDC release. Older builds
may be replaced by a newer release instead of receiving a separate patch.
Until the first GitHub release is published, no public binary release is
supported.

## Reporting a vulnerability

This repository is currently private and does not yet have a dedicated public
vulnerability-reporting channel. Do not disclose an unpatched vulnerability in
a public issue, discussion, or pull request.

If you already have a private contact channel with the repository owner, use it
and include:

- the affected FDC version and Windows version;
- the steps needed to reproduce the problem;
- the security impact you observed;
- a minimal proof of concept when it is safe to share.

Do not attach real telemetry captures, `fdc.sqlite` databases, passwords, API
keys, signing material, usernames, filesystem paths, or other personal data.
Use synthetic values in screenshots, logs, and test cases.

When the repository is public and GitHub private vulnerability reporting is
enabled, reports may be submitted through the repository's Security tab using
**Report a vulnerability**.

## Release trust

Official Windows x64 installers will be attached to GitHub releases. Each
official release must include a matching SHA-256 checksum file. Local builds,
CI builds from pull requests, and ordinary push builds are not official
releases.

FDC installers are currently unsigned. Release notes must state this clearly.
A release must not be described as signed until its Authenticode signature can
be verified successfully.
