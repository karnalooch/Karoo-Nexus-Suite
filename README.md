# Karoo Nexus Suite

Desktop management suite for Hammerhead Karoo devices, built with Next.js and Tauri.

## Requirements

- Node.js 22+
- npm
- Rust stable
- Tauri system prerequisites for your platform
- Android Platform Tools (ADB) for device features

## Development

Install JavaScript dependencies and start the frontend:

```bash
npm ci
npm run dev
```

For the desktop application:

```bash
npm run tauri dev
```

## Validation

Frontend checks:

```bash
npm run lint
npm run build
```

Rust/Tauri check:

```bash
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

The frontend uses Next.js static export so Tauri can load the generated `out/` directory.
