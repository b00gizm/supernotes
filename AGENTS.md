# Supernotes — Agent Instructions

Minimalist note-taking and productivity app: notes, daily notes, tasks, calendar, meeting transcription, AI agent.

## Current state

This repository is early / greenfield. Prefer small, reversible diffs. Do not invent a large app scaffold unless the task explicitly asks for it.

## Working style

- Read existing files before editing; match patterns already in the repo.
- Prefer deletion and reuse over new abstractions or dependencies.
- Keep commits focused; one concern per change when practical.
- Never commit secrets, tokens, or local env files with credentials.

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
- Update this section when real install/dev/test commands exist.
