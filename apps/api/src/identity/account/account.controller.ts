import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ChangePasswordInput,
  changePasswordSchema,
  UpdateAccountProfileInput,
  updateAccountProfileSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuditService } from '../audit/audit.service';
import { AuthService, RequestContext } from '../auth/auth.service';
import { ZodValidationPipe } from '../auth/common/zod-validation.pipe';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TokenPayload } from '../auth/ports/token.port';
import { assertValidImageFile } from '../common/image-upload-validation';
import { OrganisationService } from '../organisation/organisation.service';
import { UserWithRoles } from '../user/user.repository';
import { UserService } from '../user/user.service';
import { ACCOUNT_AUDIT_ACTIONS } from './account-audit-actions';

/**
 * The "My Account" HTTP surface (Sprint 3.3 brief): every route requires only
 * authentication (`JwtAuthGuard`) — no `RolesGuard`, since every action here is scoped to
 * the caller's own account, not another user's. Reuses `AuthService`/`UserService`/
 * `OrganisationService` throughout; the only new orchestration is `AuthService.
 * changePassword`/`revokeSession` (see auth.service.ts).
 */
@Controller('account')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(
    private readonly userService: UserService,
    private readonly organisationService: OrganisationService,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService,
  ) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: TokenPayload) {
    const account = await this.userService.getByIdWithRoles(user.organisationId, user.sub);
    if (!account) {
      throw new NotFoundException('User not found');
    }
    return this.buildProfileResponse(account);
  }

  @Patch('profile')
  async updateProfile(
    @Body(new ZodValidationPipe(updateAccountProfileSchema)) body: UpdateAccountProfileInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    await this.userService.updateProfile(user.organisationId, user.sub, body);

    await this.auditService.record({
      action: ACCOUNT_AUDIT_ACTIONS.PROFILE_UPDATED,
      entityType: 'User',
      entityId: user.sub,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const account = await this.userService.getByIdWithRoles(user.organisationId, user.sub);
    if (!account) {
      throw new NotFoundException('User not found');
    }
    return this.buildProfileResponse(account);
  }

  /**
   * Profile photo upload — the "placeholder only" avatar from Sprint 3.3 made real,
   * following the same multipart-upload pattern Sprint 3.4 established for
   * `POST /api/settings/logo` (shared file-type/size validation via
   * `assertValidImageFile`, shared `FileStorage` port via `UserService.setAvatar`).
   */
  @Post('avatar')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAvatar(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded — attach it as multipart field "file"');
    }
    assertValidImageFile(file, this.config, 'Profile photo');

    await this.userService.setAvatar(user.organisationId, user.sub, {
      mimeType: file.mimetype,
      buffer: file.buffer,
    });

    await this.auditService.record({
      action: ACCOUNT_AUDIT_ACTIONS.AVATAR_UPLOADED,
      entityType: 'User',
      entityId: user.sub,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      metadata: { mimeType: file.mimetype, sizeBytes: file.size },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const account = await this.userService.getByIdWithRoles(user.organisationId, user.sub);
    if (!account) {
      throw new NotFoundException('User not found');
    }
    return this.buildProfileResponse(account);
  }

  @Delete('avatar')
  async deleteAvatar(@CurrentUser() user: TokenPayload, @Req() req: Request) {
    await this.userService.removeAvatar(user.organisationId, user.sub);

    await this.auditService.record({
      action: ACCOUNT_AUDIT_ACTIONS.AVATAR_REMOVED,
      entityType: 'User',
      entityId: user.sub,
      organisationId: user.organisationId,
      actorUserId: user.sub,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    const account = await this.userService.getByIdWithRoles(user.organisationId, user.sub);
    if (!account) {
      throw new NotFoundException('User not found');
    }
    return this.buildProfileResponse(account);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @CurrentUser() user: TokenPayload,
    @Req() req: Request,
  ): Promise<void> {
    await this.authService.changePassword(
      user.organisationId,
      user.sub,
      user.sessionId,
      body.currentPassword,
      body.newPassword,
      requestContext(req),
    );
  }

  @Get('sessions')
  async listSessions(@CurrentUser() user: TokenPayload) {
    const sessions = await this.authService.listSessions(user.organisationId, user.sub);
    return {
      items: sessions.map((session) => ({
        id: session.id,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt,
        lastActivityAt: session.lastUsedAt,
        isCurrent: session.id === user.sessionId,
      })),
    };
  }

  @Delete('sessions/:id')
  async revokeSession(@Param('id') id: string, @CurrentUser() user: TokenPayload) {
    await this.authService.revokeSession(user.organisationId, user.sub, id);
    return { revoked: true, wasCurrentSession: id === user.sessionId };
  }

  /** Shared by GET/PATCH — the "my own profile" view combines the User row (name, phone,
   *  employee code, security fields), its one role (Sprint 2.2 single-role-per-user MVP
   *  assumption), and the organisation's name/code, none of which the caller can edit
   *  through this endpoint. */
  private async buildProfileResponse(account: UserWithRoles) {
    const organisation = await this.organisationService.getById(account.organisationId);
    const roleName = account.userRoles[0]?.role.name ?? null;

    return {
      id: account.id,
      firstName: account.firstName,
      lastName: account.lastName,
      phoneNumber: account.phoneNumber,
      avatarUrl: account.avatarUrl,
      employeeCode: account.employeeCode,
      email: account.email,
      role: roleName,
      organisation: organisation
        ? {
            id: organisation.id,
            name: organisation.name,
            organisationCode: organisation.organisationCode,
          }
        : null,
      status: account.status,
      joinedAt: account.createdAt,
      lastLoginAt: account.lastLoginAt,
      failedLoginAttempts: account.failedLoginAttempts,
      passwordChangedAt: account.passwordChangedAt,
      mustChangePassword: account.mustChangePassword,
    };
  }
}

function requestContext(req: Request): RequestContext {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };
}
