# Folder Structure

```
zentuva/
├── apps/
│   ├── web/                     Next.js frontend
│   │   ├── src/
│   │   │   ├── app/              App Router routes (layout.tsx, page.tsx, globals.css)
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
│       │   ├── app.module.ts
│       │   └── main.ts
│       ├── prisma/
│       │   └── schema.prisma      Database schema (no models yet)
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
│   ├── domains/                  Per-domain documentation (populated as domains are built)
│   ├── adr/                      Architecture Decision Records
│   ├── api/                      API documentation (populated as endpoints are built)
│   ├── database/                 Database/schema documentation (populated as models are built)
│   ├── changelog.md
│   └── roadmap.md
│
├── docker-compose.yml            Full stack (postgres, redis, api, web)
├── docker-compose.dev.yml        Infra-only (postgres, redis) for local `pnpm dev`
├── turbo.json                    Turborepo task pipeline
├── pnpm-workspace.yaml
└── package.json                  Root scripts (build, dev, lint, test, format)
```

## Where things go

- **A new domain module** (e.g. `procurement`) → `apps/api/src/procurement/` as a NestJS module,
  plus a matching `docs/domains/procurement.md`.
- **A new shared type** used by both `apps/web` and `apps/api` → `packages/types/src`.
- **A new shared UI component** → `packages/ui/src/components`.
- **A new cross-cutting utility** with no framework dependency → `packages/utils/src`.
- **A new validation schema** shared across apps → `packages/validation/src`.
- **A new architectural decision** → a new file in `docs/adr/`.
