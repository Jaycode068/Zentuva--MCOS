import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UsePipes,
} from '@nestjs/common';
import {
  acceptInvitationWithTokenSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  resetPasswordSchema,
} from '@zentuva/validation';
import { Request } from 'express';

import { AuthService, LoginResult, RequestContext } from './auth.service';
import { ZodValidationPipe } from './common/zod-validation.pipe';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TokenPayload } from './ports/token.port';

/**
 * The Identity Domain's HTTP surface for Sprint 1B.2: authentication only. No role,
 * permission, or organisation-management endpoints — see the brief's "Expose only
 * authentication endpoints" and Constraints. Every route is public except logout(-all)
 * and GET /sessions, which require a valid access token via {@link JwtAuthGuard} (pure
 * authentication — no RBAC).
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @UsePipes(new ZodValidationPipe(loginSchema))
  login(
    @Body() body: { email: string; password: string },
    @Req() req: Request,
  ): Promise<LoginResult> {
    return this.authService.login(body, requestContext(req));
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: TokenPayload): Promise<void> {
    await this.authService.logout(user.organisationId, user.sub, user.sessionId);
  }

  @Post('logout-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@CurrentUser() user: TokenPayload): Promise<void> {
    await this.authService.logoutAll(user.organisationId, user.sub);
  }

  @Post('refresh')
  @UsePipes(new ZodValidationPipe(refreshTokenSchema))
  refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refresh(body.refreshToken);
  }

  @Post('password/request-reset')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ZodValidationPipe(forgotPasswordSchema))
  requestPasswordReset(@Body() body: { email: string }): Promise<{ resetToken?: string }> {
    return this.authService.requestPasswordReset(body.email);
  }

  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UsePipes(new ZodValidationPipe(resetPasswordSchema))
  async resetPassword(@Body() body: { token: string; newPassword: string }): Promise<void> {
    await this.authService.resetPassword(body.token, body.newPassword);
  }

  @Post('invitations/accept')
  @UsePipes(new ZodValidationPipe(acceptInvitationWithTokenSchema))
  acceptInvitation(
    @Body() body: { token: string; password: string; firstName: string; lastName: string },
    @Req() req: Request,
  ): Promise<LoginResult> {
    return this.authService.acceptInvitation(body, requestContext(req));
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  async sessions(@CurrentUser() user: TokenPayload) {
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
}

function requestContext(req: Request): RequestContext {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  };
}
