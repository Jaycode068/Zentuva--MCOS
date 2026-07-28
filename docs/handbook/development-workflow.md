# Development Workflow

## Branching

- `main` is always deployable.
- Work happens on short-lived feature branches, merged via pull request.

## Before you start a task

1. Confirm the business requirement (what problem does this solve? — Principle 1, MVP First).
2. Check whether it belongs in an existing domain module or needs a new one (Principle 3, Domain
   Ownership).
3. Check whether it should be configurable rather than Boby-Bites-specific (Principle 2).

## While implementing

- Business logic goes in services, not controllers/route handlers.
- Validate all public inputs with a Zod schema from `packages/validation` or a NestJS DTO.
- Add error handling for real failure modes only — not speculative ones.
- Keep modules loosely coupled; communicate across domains through defined interfaces or domain
  events, never by reaching into another module's data directly.

## Before you consider a task done

Run through the [Definition of Done](engineering-handbook.md#12-definition-of-done):

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
```

All four must pass with no errors.

## Documentation is part of the task

Per Principle 7, a task is not complete without updated documentation:

- **New or changed business domain** → update or create `docs/domains/<domain>.md`.
- **New or changed API endpoint** → update `docs/api/`.
- **New or changed database model** → update `docs/database/`.
- **New environment variable, feature flag, or permission** → update the relevant `.env.example`
  and the handbook/architecture docs.
- **New architectural decision** (new dependency, new pattern, new cross-cutting concern) → add an
  ADR in `docs/adr/`.
- **User-facing or significant change** → add an entry to `docs/changelog.md`.

## Commits & PRs

- Write commit messages that explain _why_, not just _what_.
- A PR description should cover: business purpose, technical implementation summary, and any
  documentation/changelog updates included.

## Using Claude Code on this repository

This repository's `docs/` tree is intended to be a live source of context for AI coding
assistants. When implementing or modifying a feature:

1. Read the relevant `docs/domains/<domain>.md` (if it exists) before writing code.
2. Update that document, or create it, before considering the task complete.
3. If a new architectural decision is introduced, create a new ADR in `docs/adr/`.
4. If a business workflow changes, update the corresponding domain document.
