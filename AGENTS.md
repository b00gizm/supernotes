# Supernotes — Agent Instructions

Minimalist note-taking and productivity app: notes, daily notes, tasks, calendar, meeting transcription, AI agent.

## Current state

Tauri 2 + React + TypeScript scaffold is in place (`src/` frontend, `src-tauri/` backend). Prefer small, reversible diffs on top of this skeleton.

## Working style

- Read existing files before editing; match patterns already in the repo.
- Prefer deletion and reuse over new abstractions or dependencies.
- Keep commits focused; one concern per change when practical.
- Never commit secrets, tokens, or local env files with credentials.

## Ponytail

Lazy senior mode is always on via [`.cursor/rules/ponytail.mdc`](.cursor/rules/ponytail.mdc): climb the simplicity ladder before writing code, delete over add, and leave one small check for non-trivial logic. Mark deliberate shortcuts with a `ponytail:` comment naming the ceiling.

## Commits

**Before every commit:** run `npm run format:check` and fix any reported files (`npm run format`). CI runs this check and it is a common failure mode when skipped.

Use [Conventional Commits](https://www.conventionalcommits.org/) with a leading [gitmoji](https://gitmoji.dev/):

```text
<gitmoji> <type>(optional-scope): <short description>

[optional body]
```

- `type`: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- Put the gitmoji first, then the conventional type. Description is imperative mood, lowercase, no trailing period.
- One logical change per commit. Use the body only when the why is not obvious from the subject.

Examples:

```text
✨ feat(notes): add daily note template picker

🐛 fix(tasks): prevent duplicate due-date reminders

📝 docs: document agent commit conventions

♻️ refactor(calendar): extract week-grid layout helper

🔧 chore: ignore local env and build artifacts
```

Common gitmoji map: `✨ feat`, `🐛 fix`, `📝 docs`, `💄 style`, `♻️ refactor`, `⚡️ perf`, `✅ test`, `📦 build`, `👷 ci`, `🔧 chore`, `⏪️ revert`.

## Product principles

- Minimalist UX: one clear job per screen/section.
- Notes, tasks, and calendar should stay coherent as one product, not siloed mini-apps.
- Prefer local-first / offline-friendly designs when choosing storage and sync approaches, unless the task specifies otherwise.

## Verification

- After non-trivial logic changes, leave or run the smallest check that would fail if the change broke (unit test, script, or assert-based self-check).
- Do not add heavy test frameworks unless the project already uses them.

## Cursor Cloud specific instructions

- Cloud agent install config lives in `.cursor/environment.json`.
- Keep `install` idempotent and free of long-running servers.
- Put per-boot services in `start` or `terminals` once the app has a real runtime.

### Common commands

```bash
npm install
npm run format:check   # required before commit; fix with npm run format
npm run lint
npm run typecheck
npm test
npm run build
cd src-tauri && cargo test
npm run tauri dev   # needs display + Tauri OS deps
```

## Lessons from code reviews (avoid repeating these bug classes)

### M1: Persistence & optimistic state

- Every optimistic update needs a visible failure path. Never let a staleness/
  generation guard skip the error branch — a swallowed failed save plus optimistic
  UI equals silent data loss (the user sees content that was never persisted).
- Trailing debounce alone is not autosave: continuous typing defers the write
  forever. Pair debounce with a max-wait AND flush on blur/visibilitychange/close.
- Separate commands by semantics: metadata toggles (pin) must not ride the
  full-row content update. Full-row last-write-wins updates race each other,
  and metadata changes must not bump `updated_at` (it corrupts recency ordering
  that other features depend on).
