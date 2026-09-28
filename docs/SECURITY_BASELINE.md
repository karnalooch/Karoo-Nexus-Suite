# Security and CI baseline

Karoo Nexus uses the shared `karnalooch/engineering-platform` workflows pinned to immutable commit SHAs.

## Required pull-request gates

The local `Aggregate CI gate` is the single branch-protection boundary. It fails closed unless the required lanes succeed.

Current required lanes include:

- repository policy
- governance guard
- fail-fast private-key guard
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

## Secret-handling contract

- Private keys, signing keys and secret-container files must not be committed.
- Private signing material must never be shipped in a browser or Tauri frontend bundle.
- Secrets must be injected only through an appropriate trusted runtime or build-time secret boundary.
- A deleted secret must still be treated as compromised if it ever appeared in repository history.
- Trivy secret scanning and the local private-key guard remain blocking CI gates for the current tree.
