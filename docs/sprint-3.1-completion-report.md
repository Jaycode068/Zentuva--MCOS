# Sprint 3.1 Completion Report — Public Marketing Website (Landing Page)

**Date:** 2026-07-31
**Status:** Complete

## 1. Objective

Build Zentuva's first public-facing website: a landing page at `/` that communicates the
product vision, establishes trust, explains the platform, and creates entry points for
future onboarding. Unauthenticated, no backend integration — positioned as a premium,
modern technology company's website (Linear/Stripe/Vercel-adjacent), not an admin
dashboard. Explicitly not Sprint 3.2 (authentication UI, sign-up, onboarding).

## 2. Implementation Summary

### Positioning

Zentuva is positioned throughout as **"The Operating System for African Manufacturing"**
— never as an ERP or SaaS product. The hero, metadata, and copy consistently use
"operating system" / "manufacturing infrastructure" language per the brief.

### Structure

`apps/web/src/app/page.tsx` composes twelve section components from
`apps/web/src/components/marketing/`, each self-contained and reusable:

| Component            | Section                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Navbar`             | Sticky top nav, logo, links, Sign In / Get Started, mobile hamburger menu                                    |
| `Hero`               | Headline, supporting copy, Get Started / Book a Demo, abstract dashboard-card illustration                   |
| `TrustedBy`          | "Coming Soon" / "Pilot Manufacturers" / "Growing Businesses" / "Future Partners" placeholders                |
| `ProblemSection`     | Seven common manufacturing pain points + "Zentuva brings everything together"                                |
| `WhatIsZentuva`      | The nine pillars (Production → AI) as a connected ecosystem around a "Zentuva Core" badge                    |
| `PlatformModules`    | Eleven module cards (icon, title, two-line description)                                                      |
| `WhyZentuva`         | Nine principles (Built for African manufacturers → AI-ready)                                                 |
| `RetailIntelligence` | Visually distinct (dark) section — Factory→Distributor→Wholesaler→Retail→Consumer chain + five insight types |
| `AiSection`          | "Built for the AI era," six future capabilities explicitly labeled "not yet available"                       |
| `VisionTimeline`     | Horizontal roadmap: Today → Retail Intelligence → AI Copilot → Connected African Supply Chains               |
| `CtaSection`         | Final CTA — Request Demo / Join Early Access                                                                 |
| `Footer`             | Logo, mission statement, Products/Company/Resources link columns, social placeholders, copyright             |

Supporting files: `logo.tsx` (brand mark), `container.tsx` (`Container` +
`SectionHeading` shared layout primitives), `icons.tsx` (11 minimal line icons, no
external icon library).

### Brand

The user shared the real Zentuva logo as an inline chat image mid-sprint: a circular seal
— a bold angular "Z" monogram in deep purple, a lavender arc around most of the circle,
two pink diamond accents where the arc ends, and a curved "ZENTUVA" wordmark. That
palette (deep purple / soft lavender / accent pink) is now the site's actual color
system, not a marketing-only skin:

- `packages/ui/src/styles.css`: `--primary` changed from the old green
  (`142 71% 29%`) to a deep purple (`258 55% 48%`), with matching dark-mode values. Two
  new tokens, `--lavender` and `--accent-pink`, were added for soft backgrounds and
  highlight accents.
- `packages/config/tailwind/preset.js`: registered `lavender` and `accentPink` as
  Tailwind color utilities alongside the existing shadcn/ui token set.

Because these are shared design-system tokens (not scoped to the marketing page), the
existing `/settings/organisation` and `/settings/users` pages now render in the same
purple brand instead of the old green — confirmed intentional and verified not to break
either page (full quality gate green, screenshots unaffected structurally).

## 3. Testing / Verification Performed

- Full monorepo quality gate from a clean state (`node_modules` kept, `dist`/`.next`/
  `.turbo` wiped and rebuilt): `pnpm build`, `pnpm lint`, `pnpm type-check`, `pnpm test`
  all green across all 7 workspace packages. 69/69 backend unit tests unaffected (this
  sprint touched no backend code).
- Live browser verification at desktop (1440px) and mobile (375px) viewports:
  - All twelve sections render with the intended content, no console errors.
  - Hero's two-column layout (headline + abstract dashboard illustration) confirmed at
    desktop width; the illustration cards stack correctly below the text at mobile width.
  - Mobile hamburger menu opens/closes correctly (verified via direct DOM interaction
    after the browser tool's synthetic click coordinate missed the target once — the
    toggle itself works; not a defect in the shipped code).
  - Heading hierarchy checked programmatically: exactly one `<h1>` (the hero headline),
    `<h2>` for every section heading, `<h3>` for card/principle titles — correctly nested
    for accessibility and SEO.
  - AI section's six capabilities are visibly labeled "Part of the platform vision — not
    yet available," per the brief's explicit instruction not to claim they exist.
- No lorem ipsum anywhere — every section's copy was written for this sprint.

## 4. Known Limitations

- **No real logo file.** The brief instructed "use the attached Zentuva logo," but no
  image file was ever placed in the repository — the actual logo was only shared as an
  inline image in chat partway through the sprint, and this harness has no mechanism to
  extract a pasted chat image's raw bytes into a repo file. `ZentuvaMark`
  (`apps/web/src/components/marketing/logo.tsx`) is a deliberately simplified geometric
  recreation of the "Z" monogram (three solid polygons forming a bold Z) in the same deep
  purple, used at small sizes in the nav/footer — not a pixel-perfect reproduction of the
  full circular seal (arc, diamonds, curved wordmark), which doesn't read well at small
  icon sizes regardless of source fidelity. **Action needed:** drop the real logo file
  (SVG preferred) into `apps/web/public/` in a follow-up so it can be swapped in directly.
- **`buttonVariants` export**: exporting this from `packages/ui` (previously
  file-internal to `Button`) was necessary to style anchor tags as buttons without adding
  a new Radix dependency. This is a small, backward-compatible API surface increase, not
  a breaking change — flagged here for visibility since it's a shared package change.
- All calls to action (Get Started, Book a Demo, Sign In, Request Demo, Join Early
  Access) are static links with no destination, form, or backend behind them — this is
  explicitly out of scope for Sprint 3.1 per the brief ("Do not begin Sprint 3.2").
- No analytics, cookie consent, or SEO metadata beyond the page `<title>`/description
  (Open Graph tags, sitemap, robots.txt) — not requested by the brief, noted as likely
  follow-up work before a real public launch.

## 5. Deferred / Future Work

Sprint 3.2 (authentication UI: sign-in, sign-up, tenant registration, onboarding) is
explicitly next, per the brief's closing instruction. Beyond that: real logo asset,
working demo-request/early-access forms (likely needs a lightweight backend endpoint or
third-party form service), Open Graph/SEO metadata, and any additional public pages
(pricing, docs, blog) implied by the nav's "Products"/"Solutions" links currently
anchoring to sections on the same page.
