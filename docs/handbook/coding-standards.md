# Coding Standards

## Language

- Strict TypeScript everywhere. `strict: true` is enabled in every `tsconfig.json` (via
  [`packages/config/typescript`](../../packages/config/typescript)).
- No `any` without justification — `@typescript-eslint/no-explicit-any` is a warning, not an
  error, but should be treated as one during review.

## Architecture rules

- **Business logic belongs in services, not controllers.** Controllers (NestJS) and route
  handlers (Next.js) should only handle transport concerns — parsing, validation wiring, and
  delegating to a service.
- **Validate every public endpoint.** Use Zod schemas from [`packages/validation`](../../packages/validation)
  or NestJS's `ValidationPipe` (enabled globally in `apps/api/src/main.ts`).
- **Audit important business operations.** Once domain modules exist, mutating operations that
  matter to the business (orders, inventory movements, financial transactions) must be logged in
  a way that supports later audit trails.
- **Domain ownership.** No module reaches into another module's database tables or internal
  services directly. Cross-domain communication happens through defined interfaces or domain
  events.
- **Composition over duplication.** Prefer shared packages (`packages/*`) and composable
  functions over copy-pasted logic.
- **No premature optimisation.** Optimise only once a real bottleneck is measured.

## Formatting & linting

- [Prettier](../../.prettierrc.json) enforces formatting; do not hand-format.
- ESLint presets live in [`packages/config/eslint`](../../packages/config/eslint):
  `base.js`, `nestjs.js`, `nextjs.js`, `react-library.js`.
- Husky + lint-staged run ESLint and Prettier on staged files before every commit.

## Naming & structure

- One export concept per file where reasonable (a component, a service, a schema).
- File names: `kebab-case.ts` / `kebab-case.tsx`.
- Types and interfaces: `PascalCase`. Functions and variables: `camelCase`.

## Testing

- Add tests where applicable (see [Definition of Done](engineering-handbook.md#12-definition-of-done)).
  A foundation-only change with no business logic does not require new tests, but the test
  runners (`jest` for `apps/api`) must remain green.
