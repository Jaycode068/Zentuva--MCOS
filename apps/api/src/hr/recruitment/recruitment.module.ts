import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from '../../identity/auth/auth.module';
import { IdentityModule } from '../../identity/identity.module';
import { FileStorageModule } from '../../identity/organisation/infrastructure/file-storage.module';
import { HrModule } from '../hr.module';
import { ApplicationController } from './application.controller';
import { ApplicationRepository } from './application.repository';
import { ApplicationService } from './application.service';
import { CandidateRepository } from './candidate.repository';
import { HiringRequestController } from './hiring-request.controller';
import { HiringRequestRepository } from './hiring-request.repository';
import { HiringRequestService } from './hiring-request.service';
import { InterviewEvaluationController } from './interview-evaluation.controller';
import { InterviewEvaluationRepository } from './interview-evaluation.repository';
import { InterviewEvaluationService } from './interview-evaluation.service';
import { InterviewStageDecisionRepository } from './interview-stage-decision.repository';
import { InterviewStageDecisionService } from './interview-stage-decision.service';
import { InterviewStageRepository } from './interview-stage.repository';
import { InterviewStageService } from './interview-stage.service';
import { InterviewController } from './interview.controller';
import { InterviewRepository } from './interview.repository';
import { InterviewService } from './interview.service';
import { OfferController } from './offer.controller';
import { OfferRepository } from './offer.repository';
import { OfferService } from './offer.service';
import { CareersController } from './public/careers.controller';
import { CareersService } from './public/careers.service';
import { RecruitmentNotificationService } from './recruitment-notification.service';
import { VacancyController } from './vacancy.controller';
import { VacancyRepository } from './vacancy.repository';
import { VacancyService } from './vacancy.service';

/**
 * Recruitment & Candidate Interview Management Foundation (Sprint 30,
 * docs/domains/recruitment.md) — CONCEPTUALLY part of the HR domain, kept as
 * its own NestJS module purely to avoid bloating `HrModule`'s existing
 * provider list with ~13 new models' worth of services, not because
 * Recruitment is a separate application (the brief's own explicit
 * architectural principle).
 *
 * Imports `HrModule` for `EmployeeService`/`DepartmentService`/
 * `PositionService`/`EmployeeOnboardingService` (all reused completely
 * unchanged — see `OfferService.accept()`), `FileStorageModule` (candidate
 * resume uploads, the same `FileStorage` port `EmployeeDocumentService`
 * already uses), `IdentityModule`/`AuthModule` (guards, `UserService`,
 * `OrganisationService`).
 *
 * Deliberately does NOT import `NotificationsModule` — `RecruitmentNotification
 * Service` writes directly to the shared `notifications` table via the
 * globally-registered `PrismaService` instead (its own doc comment explains
 * why: importing `NotificationsModule` here would create a circular module
 * dependency, since `NotificationsModule` imports `WorkflowModule`, and
 * `WorkflowModule` imports THIS module for the Hiring Request handler).
 *
 * `ThrottlerModule.forRoot(...)` is imported here so `ThrottlerGuard`'s
 * dependencies (storage, options) are available for injection — but the
 * guard itself is applied ONLY via `@UseGuards(ThrottlerGuard)` directly on
 * `CareersController`, deliberately NEVER via the `APP_GUARD` token (which
 * would register it globally across the ENTIRE application regardless of
 * which module provides it — a mistake caught before this sprint shipped:
 * an early draft used `APP_GUARD` here, which would have throttled every
 * authenticated route in the app to 5 requests/minute). New infrastructure
 * this sprint introduces (recruitment.md §"Public Application Security") —
 * no rate-limiting existed anywhere in this codebase before, and this stays
 * scoped to the one public endpoint that needs it.
 */
@Module({
  imports: [
    IdentityModule,
    AuthModule,
    HrModule,
    FileStorageModule,
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 5 }]),
  ],
  controllers: [
    HiringRequestController,
    VacancyController,
    ApplicationController,
    InterviewController,
    InterviewEvaluationController,
    OfferController,
    CareersController,
  ],
  providers: [
    HiringRequestRepository,
    HiringRequestService,
    VacancyRepository,
    VacancyService,
    CandidateRepository,
    ApplicationRepository,
    ApplicationService,
    InterviewStageRepository,
    InterviewStageService,
    InterviewRepository,
    InterviewService,
    InterviewEvaluationRepository,
    InterviewEvaluationService,
    InterviewStageDecisionRepository,
    InterviewStageDecisionService,
    OfferRepository,
    OfferService,
    RecruitmentNotificationService,
    CareersService,
  ],
  exports: [HiringRequestRepository],
})
export class RecruitmentModule {}
