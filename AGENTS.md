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

### M2: Round-trips, dual implementations & the IPC boundary

- The browser mock hides the IPC contract. `memoryApi` let snake_case invoke
  args ship while every test passed — Tauri 2 expects camelCase argument keys.
  Every new command needs one check that crosses the real boundary, and never
  wrap an invoke in a `catch` that swallows into a default: a broken contract
  then looks like a feature that silently renders nothing.
- Never serialize what the parser can't re-read. Round-trip safety cuts both
  ways: escape user content that collides with syntax (`|` in table cells,
  `==` in prose), and validate programmatic inserts (autocomplete picks)
  against the target syntax's charset before serializing them as shorthand.
  Golden fixtures only cover what you thought of — every round-trip fix lands
  with a new fixture.
- Dual implementations drift. The TS and Rust extractors must produce identical
  output for identical input — share one fixture set across both suites. Same
  rule within a layer: resolve and rewrite must use the same matching semantics
  (case, Unicode); resolving loosely while rewriting exactly silently breaks
  links on rename.
- Multi-statement DB commands need a transaction. Statement-by-statement
  auto-commit means a mid-sequence error leaves partial state, and a committed
  row plus a returned `Err` makes the frontend retry into duplicates.
- Anything captured before an `await` is stale after it. Map editor positions
  through transactions instead of reusing them, give every fire-and-forget
  promise a `.catch` with a visible failure, and guard click-to-create actions
  against firing twice while the first call is in flight.
- Editor plugin `update()` hooks fire on every view sync: calling `setState`
  from one without an equality check is a render loop (React aborts with
  "Maximum update depth exceeded").
- If the backend rewrites rows the frontend may hold open (rename rewriting
  other notes' bodies), it needs an invalidation signal to open editors —
  otherwise the next autosave clobbers the rewrite with the stale draft.

### M3–M5: Embedded entities, migrations & the view/persistence boundary

- Migrations are the one place an error is permanent: a failed migration rolls
  back, `Db::open().expect()` panics, and the app never boots again. Any
  migration that rewrites a column feeding a new UNIQUE index must dedup
  first, and never derive a local-day value from a UTC timestamp prefix
  (`substr(created_at, 1, 10)` is the wrong day for evening rows). Test
  migrations with colliding and timezone-edge rows, not one happy row.
- Node attrs are a cache of DB state, and caches go stale. A pill that
  hydrates once and then writes full rows from its own attrs silently reverts
  every edit made from another surface — the M1 full-row last-write-wins bug,
  reborn at the task layer. Writes built from node attrs must be partial
  patches, and embedded views must subscribe to the entity's change events.
- Delete-on-node-removal is wrong scope. "Node left this editor's doc" is not
  "user deleted the entity": cut here / paste in another note looks identical.
  Entity lifecycle decisions need app-level state, not per-editor-instance
  snapshots that die on remount.
- Every doc-changing transaction reaches autosave. NodeView attr syncs and
  load-normalization drift mark the doc dirty, so merely opening or clicking a
  note saves the full body and bumps `updated_at` — corrupting recency and
  widening the last-write-wins window. Non-edit transactions must not dirty
  the draft; assert load→serialize identity with a fixture.
- Parser strictness flips are data-loss events. `html:false` → `html:true`
  changed what the schema silently drops from existing bodies, and the first
  autosave made it permanent. Any parse-mode change ships with a round-trip
  fixture of content that was legal before the change.
- Values clipped for display must never flow back into persistence. The
  calendar seeded its edit state with day-clipped segment times and committed
  them on blur _and Escape_, truncating cross-midnight events on a mere click.
  Keep view projections and persisted values in separate shapes, make Escape
  cancel, and clamp drag math by the event's real duration, not a default.
- Overlays must own focus synchronously. A `setTimeout(0)` focus means the
  keystrokes right after ⌘K land in the editor underneath the palette — and
  autosave persists them into the note. Focus on mount and capture keys at the
  overlay while it is open.
- When bucketing by date range, cover the whole domain. Grouping that only
  consumes "this week forward" let past rows fall through to a catch-all
  rendered after "Next week". Handle the past explicitly and test rows before
  the window, not just inside it.
- The M2 rules held only where fixtures were hostile. Case folding diverged
  three ways (TS Unicode `toLowerCase`, Rust `eq_ignore_ascii_case`, SQLite
  ASCII `LOWER`) and stayed invisible because the shared parity fixtures were
  ASCII-only; three new `catch(() => default)` swallows shipped despite the
  rule. Parity fixtures need non-ASCII rows, and the swallow pattern is worth
  a lint/grep in CI rather than a rule in prose.
