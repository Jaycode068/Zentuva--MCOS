import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { SubmitPublicApplicationInput, submitPublicApplicationSchema } from '@zentuva/validation';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { ZodValidationPipe } from '../../../identity/auth/common/zod-validation.pipe';
import { assertValidResumeFile } from '../../../identity/common/resume-upload-validation';
import { CareersService } from './careers.service';

/**
 * Sprint 30 — Recruitment & Candidate Interview Management Foundation
 * (recruitment.md §"Public Careers Page" / §"Public Application Security").
 * Deliberately NO `@UseGuards(JwtAuthGuard)` anywhere on this controller —
 * fully public, matching `AuthController.register`'s exact precedent (a
 * controller/route with no guard decorator at all, per this codebase's
 * established convention — there is no global `@Public()` mechanism).
 *
 * `apply` is rate-limited via `@nestjs/throttler` (newly added this sprint —
 * no rate-limiting infrastructure existed anywhere in this codebase before;
 * applied ONLY here via a per-route `@Throttle`, never registered globally,
 * so nothing else in the app is affected).
 */
@Controller('careers')
export class CareersController {
  constructor(
    private readonly careersService: CareersService,
    private readonly config: ConfigService,
  ) {}

  @Get(':organisationSlug')
  async getOrganisation(@Param('organisationSlug') organisationSlug: string) {
    const info = await this.careersService.getOrganisationCareersInfo(organisationSlug);
    const vacancies = await this.careersService.listPublicVacancies(organisationSlug);
    return { organisation: info, vacancies };
  }

  @Get(':organisationSlug/:vacancySlug')
  getVacancy(
    @Param('organisationSlug') organisationSlug: string,
    @Param('vacancySlug') vacancySlug: string,
  ) {
    return this.careersService.getPublicVacancy(organisationSlug, vacancySlug);
  }

  @Post(':organisationSlug/:vacancySlug/apply')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('resume'))
  async apply(
    @Param('organisationSlug') organisationSlug: string,
    @Param('vacancySlug') vacancySlug: string,
    @UploadedFile() resume: Express.Multer.File | undefined,
    @Body('payload') payloadRaw: string,
  ) {
    if (!payloadRaw) {
      throw new BadRequestException(
        'Missing application data — attach it as multipart field "payload"',
      );
    }
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(payloadRaw);
    } catch {
      throw new BadRequestException('Application data must be valid JSON');
    }
    const pipe = new ZodValidationPipe(submitPublicApplicationSchema);
    const body = pipe.transform(parsedPayload) as SubmitPublicApplicationInput;

    if (resume) {
      assertValidResumeFile(resume, this.config);
    }

    return this.careersService.submitApplication(
      organisationSlug,
      vacancySlug,
      body,
      resume ? { buffer: resume.buffer, mimeType: resume.mimetype } : undefined,
    );
  }
}
