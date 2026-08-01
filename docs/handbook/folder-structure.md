# Folder Structure

```
zentuva/
├── apps/
│   ├── web/                     Next.js frontend
│   │   ├── src/
│   │   │   ├── app/              App Router routes (layout.tsx, page.tsx, globals.css)
│   │   │   │   └── (app)/        Route group (Sprint 3.5): every authenticated page
│   │   │   │                     (/workspace, /settings/*, /account/*) — adds no URL
│   │   │   │                     segment, shares one WorkspaceLayout
│   │   │   ├── components/workspace/  Sidebar/Topbar/WorkspaceLayout shell (Sprint 3.5)
│   │   │   ├── providers/        React context providers (TanStack Query, etc.)
│   │   │   └── lib/              Frontend-only utilities (env parsing, etc.)
│   │   ├── public/
│   │   ├── next.config.js
│   │   ├── tailwind.config.js
│   │   └── Dockerfile
│   │
│   └── api/                     NestJS backend
│       ├── src/
│       │   ├── config/            Configuration loading + env validation
│       │   ├── health/            Health check module (Terminus)
│       │   ├── prisma/            PrismaService/PrismaModule (global)
│       │   ├── identity/          Identity Domain — repositories + service skeletons, no controllers yet
│       │   │   ├── organisation/  ├── user/  ├── role/  ├── invitation/  ├── session/  ├── audit/
│       │   │   ├── common/        Shared helpers (e.g. not-implemented stub marker)
│       │   │   └── identity.module.ts
│       │   ├── app.module.ts
│       │   └── main.ts
│       ├── prisma/
│       │   ├── schema.prisma      Identity Domain schema (docs/domains/identity.md §9)
│       │   └── seed.ts            Seeds Boby Bites org, system roles, permission catalog
│       ├── nest-cli.json
│       └── Dockerfile
│
├── packages/
│   ├── ui/                      Shared shadcn/ui component library
│   ├── types/                   Shared TypeScript types
│   ├── config/                  Shared ESLint / TypeScript / Tailwind config presets
│   ├── utils/                   Shared framework-agnostic utilities
│   └── validation/               Shared Zod validation schemas
│
├── docs/
│   ├── handbook/                 Engineering handbook, coding standards, architecture, workflow
│   ├── development/              Local Development Guide
│   ├── domains/                  Per-domain documentation (populated as domains are built)
│   ├── adr/                      Architecture Decision Records
│   ├── api/                      API documentation (populated as endpoints are built)
│   ├── database/                 Database/schema documentation (populated as models are built)
│   ├── changelog.md
│   └── roadmap.md
│
├── .vscode/                      Shared launch.json (debugging), extensions.json, settings.json
├── docker-compose.dev.yml        Infra-only (postgres, redis) — the daily dev workflow
├── docker-compose.production.yml Full stack (postgres, redis, api, web) — not for daily dev
├── turbo.json                    Turborepo task pipeline
├── pnpm-workspace.yaml
└── package.json                  Root scripts (infra:*, db:*, dev, build, lint, test, format)
```

## Where things go

- **A new domain module** (e.g. `procurement`) → `apps/api/src/procurement/` as a NestJS module,
  plus a matching `docs/domains/procurement.md`.
- **A new shared type** used by both `apps/web` and `apps/api` → `packages/types/src`.
- **A new shared UI component** → `packages/ui/src/components`.
- **A new cross-cutting utility** with no framework dependency → `packages/utils/src`.
- **A new validation schema** shared across apps → `packages/validation/src`.
- **A new architectural decision** → a new file in `docs/adr/`.
