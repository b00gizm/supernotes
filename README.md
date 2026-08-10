# Supernotes

Minimalist note-taking and productivity app: notes, daily notes, tasks, calendar, meeting transcription, AI agent.

Stack: **Tauri 2** (Rust) + **React** + **TypeScript** (Vite).

## Prerequisites

- Node.js 22+
- Rust stable (`rustup`)
- OS-specific [Tauri prerequisites](https://tauri.app/start/prerequisites/)
  - macOS: Xcode Command Line Tools
  - Linux: `webkit2gtk`, `librsvg2`, etc. (see Tauri docs)
  - Windows: WebView2 + MSVC build tools

## Setup

```bash
npm install
```

## Development

```bash
# Open the desktop app (Vite + Tauri)
npm run tauri dev

# Frontend only (browser)
npm run dev
```

## Checks

```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build

# Rust
cd src-tauri && cargo test
```

## Production build

```bash
npm run tauri build
```

## Project layout

| Path                       | Purpose                             |
| -------------------------- | ----------------------------------- |
| `src/`                     | React frontend                      |
| `src-tauri/`               | Rust / Tauri backend                |
| `.github/workflows/ci.yml` | Lint, typecheck, tests, Tauri build |
