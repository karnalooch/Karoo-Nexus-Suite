# Security and CI baseline

Karoo Nexus uses the shared `karnalooch/engineering-platform` workflows pinned to immutable commit SHAs.

## Required pull-request gates

The local `Aggregate CI gate` is the single branch-protection boundary. It fails closed unless the required lanes succeed.

Current required lanes include:

- repository policy
- governance guard
- frontend lint and production build when relevant
- Rust `cargo check --locked` when relevant
- npm audit for dependency-sensitive changes
- Trivy filesystem scan for HIGH/CRITICAL vulnerabilities and secrets
- JavaScript/TypeScript CodeQL when frontend code changes

## Repository settings to enable manually

The GitHub App used by automation does not have repository administration scope, so these settings must be enabled by a repository administrator:

1. Enable **Dependency graph**.
2. Enable **Dependabot alerts** and **Dependabot security updates**.
3. Require **Aggregate CI gate** before merging to `main`.
4. Disallow direct pushes to `main` unless intentionally needed.

Once Dependency graph is enabled, re-enable the reusable Dependency Review lane in `.github/workflows/baseline.yml`.

## Credential incident

A CloudFront private key was found embedded in the public source tree and has been removed from the current code.

Deleting a credential from the latest tree does not revoke it and does not remove it from Git history.

Required incident response:

1. Revoke or rotate the exposed credential if it is controlled by this project.
2. If it belongs to a third party, do not use it and notify the owner through an appropriate security channel.
3. Treat all prior copies of the credential as compromised.
4. Keep the client-side CloudFront signing path disabled; private signing material must not be shipped in a browser/Tauri frontend bundle.

Trivy secret scanning remains a blocking CI gate for the current tree.
