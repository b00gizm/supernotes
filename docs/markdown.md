# Note markdown conventions

SQLite stores note bodies as markdown (`notes.body_markdown`). The TipTap editor
parses that string on load and serializes back on save. Round-trip must be
byte-stable for the canonical forms below (see `src/editor/fixtures/roundtrip/`
and `markdown-roundtrip.test.ts`).

External edits (pasting valid markdown into the DB) are supported: the first
load may normalize to the serializer's canonical form (e.g. blank lines between
task items, `\` hard breaks); after that, save/load is byte-stable.

## Core CommonMark / GFM (supported now)

| Element         | Markdown                                                  |
| --------------- | --------------------------------------------------------- |
| Headings        | `#` … `######`                                            |
| Bold / italic   | `**bold**`, `*italic*`                                    |
| Strike          | `~~strike~~`                                              |
| Highlight       | `==highlight==`                                           |
| Inline code     | `` `code` ``                                              |
| Code block      | fenced ` ```lang ` … ` ``` `                              |
| Blockquote      | `> quote`                                                 |
| Bullet list     | `- item` (nested with 2-space indent)                     |
| Ordered list    | `1. item`                                                 |
| Checklist       | `- [ ] open` / `- [x] done` (square; not task pills)      |
| Link            | `[label](https://…)`                                      |
| Image           | `![alt](path)` — empty `![alt]()` is a drop slot          |
| Table           | GFM pipe tables                                           |
| Horizontal rule | `---`                                                     |
| Hard break      | trailing `\` + newline (canonical; two spaces also parse) |

Images are block-level in the editor: an image mid-paragraph serializes on its
own lines.

Adjacent bullet items and checkboxes may sit in one markdown-it list; on parse
we split them into a bullet list + task list so TipTap does not invent an empty
checkbox. The first save after an external edit is the canonical form (golden
fixtures already use that form).

## Wikilinks (ENG-56)

```text
[[Note Title]]
```

- Title is the note's display title (same namespace as tags).
- No aliases in MVP (`[[title\|alias]]` is not defined yet).
- Titles must not contain `]`.
- Editor node attrs may hold a resolved `noteId`; markdown always stores the
  **title**. Renaming a note rewrites `[[old]]` → `[[new]]` in notes that link
  to it (without bumping those notes' `updated_at`). The `links` table is the
  ID index (see `docs/data-model.md`), synced from `[[…]]` / `#tag` / `@mention`
  on every note save. A read-only Backlinks section below the editor lists
  inbound sources from that index (never written into the note body). Creating
  a note backfills link rows from bodies that already mentioned its title
  (create-on-click for a missing `@Sam` / `#tag` / `[[Title]]`).
- Typing `[[` opens an inline title autocomplete; click navigates, creating the
  target note on first click when missing.

## Tags / mentions (ENG-57)

```text
#project
@Priya
@Priya Sharma
```

- Logseq approach: `#` / `@` are shorthand for the note titled `project` /
  `Priya` / `Priya Sharma` (same namespace as `[[project]]`).
- Stay **literal** in markdown (no HTML wrapping in the stored string).
- `#tag` has **no** space after `#` (a space makes an ATX heading).
- `@Name` may include one optional capitalized surname token.
- Typing `#` / `@` opens the same title autocomplete as `[[`; editor renders
  compact chips (tags vs mentions styled apart from wikilinks). Click /
  create-on-miss / `links` sync match wikilinks.

## Task pills (ENG-61)

Square checklists (`- [ ]`) stay GFM task items. First-class tasks use a
distinct pill node:

```text
[[task:<uuid>]] Buy milk
```

- `<uuid>` is the `tasks.id` row.
- Text after the closing `]]` is the display title (DB is source of truth;
  editor edits update the row).
- One pill per line in MVP.
- Does **not** use `- [ ]` syntax (that remains the lightweight checklist).
- Typing `[]` + space at the start of a paragraph creates a DB task + pill.
  `- [ ]` / `[ ]` / `- []` (inside a list) still create square checkboxes.
- Clicking the circle sets state to `done` (click again reopens). Waiting /
  cancelled are set from the Tasks view / shared metadata popover.
- Deleting the pill in the editor **deletes** the task row (not orphaned).
- State lives in SQLite (`open` \| `waiting` \| `done` \| `cancelled`); it is
  not encoded in the markdown. On load, pills hydrate state from the `tasks`
  table.
