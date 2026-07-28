# Zentuva Engineering Handbook

- **Version:** 0.1 (Living Document)
- **Project:** Zentuva
- **Product Type:** Manufacturing & Commerce Operating System (MCOS)
- **Status:** Active Development

## 1. Purpose

Zentuva is a cloud-native Manufacturing and Commerce Operating System (MCOS) built specifically
for African businesses. Its purpose is to connect every participant in the manufacturing and
commerce value chain into a single intelligent platform. Unlike traditional ERP systems that
primarily focus on internal business operations, Zentuva extends beyond the factory to include
suppliers, sales teams, distributors, retailers and eventually consumers.

The first tenant of Zentuva is Boby Bites, which serves as the pilot implementation and
validation of the platform. Every feature built for Boby Bites should be designed in a
configurable way so that it can be reused by future tenants without code changes.

## 2. Vision

To become Africa's digital infrastructure for manufacturing and commerce. Zentuva will empower
manufacturers to build smarter factories, stronger distribution networks and better customer
relationships through connected technology.

## 3. Mission

To simplify manufacturing operations while creating an intelligent commerce network that connects
production, distribution and consumption.

## 4. Product Philosophy

Zentuva is not an ERP. Zentuva is not a CRM. Zentuva is not inventory software.

Zentuva is a Manufacturing & Commerce Operating System (MCOS). The platform combines:

- Manufacturing Operations
- Business Operations
- Commerce
- Distribution
- Intelligence
- Future AI Services

into one connected ecosystem.

## 5. Product Principles

These principles guide every architectural and development decision.

**Principle 1 — MVP First.** Build only what is required today. Avoid over-engineering. Every
feature must solve a current business problem.

**Principle 2 — Configuration Over Customisation.** Never hardcode Boby Bites business logic.
Every workflow should be configurable whenever possible. Boby Bites is the first tenant — not the
only tenant.

**Principle 3 — Domain Ownership.** Every business domain owns its own logic. No module should
directly manipulate another module's data. Communication should happen through clearly defined
interfaces and domain events where appropriate.

**Principle 4 — Every Transaction Generates Intelligence.** Transactions are not merely records.
Every purchase order, production batch, inventory movement, sales order and retailer visit
contributes to business intelligence.

**Principle 5 — Role-Based Experiences.** Interfaces should be designed around how people work,
not around screen sizes. Examples:

- Management → Desktop Experience
- Finance → Desktop Experience
- Production → Desktop Experience
- Warehouse → Desktop Experience
- Sales Representatives → Mobile Experience
- Retailers → Mobile Experience
- Consumers → Mobile Experience (Future)

Field experiences should always render as mobile workflows, even when opened from a desktop
browser.

**Principle 6 — Experience Follows Workflow.** Technology must adapt to business workflows. Never
redesign a workflow simply to fit software. The software exists to simplify work.

**Principle 7 — Documentation is Part of Development.** Documentation is not optional. Every
significant code change must include corresponding documentation updates. If a feature is
implemented without documentation, the task is considered incomplete. Documentation should
include: business purpose, technical implementation, API changes, database changes, configuration
changes, and user impact. Every development task should leave the project more understandable
than before.

**Principle 8 — AI-Ready Architecture.** AI should never be tightly coupled to business modules.
Future AI capabilities must integrate through dedicated AI services. Business logic must remain
deterministic even without AI.

**Principle 9 — Build for Growth, Release for Today.** Architect for the future. Implement only
what today's business requires. Every release should be simple enough to deploy confidently.

## 6. Core Design Goals

Every feature should improve one or more of these goals:

1. Operational Efficiency
2. Manufacturing Excellence
3. Distribution Intelligence
4. Retail Connectivity
5. Consumer Engagement
6. Business Intelligence
7. Ease of Use

## 7. Primary Business Domains

Version 1 focuses on:

- Identity
- Organisation
- Product Catalogue
- Procurement
- Inventory
- Production
- Sales
- Distribution
- Finance

Future domains include: HR, CRM Automation, Retail Portal, Consumer Portal, Loyalty, Promotions,
AI, Analytics, Marketplace.

## 8. Technology Stack

See [architecture-overview.md](architecture-overview.md) for the full stack and rationale.

## 9. Architecture

Zentuva uses a **Modular Monolith Architecture**. Reasons: faster development, easier maintenance,
lower operational complexity, easier testing, and the option to extract into microservices later
if necessary. Microservices are not part of the MVP.

## 10. Coding Standards

- Strict TypeScript only.
- Business logic belongs in services, not controllers.
- Validation on every public endpoint.
- Audit important business operations.
- Prefer composition over duplication.
- Avoid premature optimisation.
- Keep modules loosely coupled.
- Write code for readability before cleverness.

See [coding-standards.md](coding-standards.md) for the enforced tooling.

## 11. Documentation Standards

Every completed feature must include: business documentation (why it exists), technical
documentation (how it works), database documentation (schema changes), API documentation
(endpoint changes), configuration documentation (env vars, feature flags, permissions), and
release notes.

- Every completed sprint must update [`docs/changelog.md`](../changelog.md).
- Every important architectural decision must be recorded as an ADR in [`docs/adr/`](../adr/).

## 12. Definition of Done

A task is not complete until all of the following are satisfied:

- [ ] Business requirement implemented.
- [ ] Code reviewed (AI/self-review for now).
- [ ] Validation included.
- [ ] Error handling included.
- [ ] Tests added where applicable.
- [ ] Documentation updated.
- [ ] Changelog updated (if user-facing or significant).
- [ ] No TypeScript errors.
- [ ] No linting errors.

If any one of these items is missing, the task remains **In Progress**.

## 13. The Zentuva Rule

Every line of code should answer one question:

> "Does this make manufacturing and commerce simpler, smarter or more connected?"

If the answer is no, reconsider whether it belongs in Zentuva.
