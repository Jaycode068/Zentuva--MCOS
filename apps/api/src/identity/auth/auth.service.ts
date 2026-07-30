import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Session, User, UserStatus } from '@prisma/client';
import { AppError } from '@zentuva/utils';

import { AuditService } from '../audit/audit.service';
import { InvitationService } from '../invitation/invitation.service';
import { PasswordResetService } from '../password-reset/password-reset.service';
import { RoleService } from '../role/role.service';
import { SessionService } from '../session/session.service';
import { UserService } from '../user/user.service';
import { AUTH_AUDIT_ACTIONS } from './audit-actions';
import { generateOpaqueToken, hashToken } from './common/token-hash.util';
import { SESSION_STORE, SessionStore } from './ports/session-store.port';
import { TOKEN_SERVICE, TokenService } from './ports/token.port';

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface UserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organisationId: string;
  status: UserStatus;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResult extends AuthTokens {
  user: UserSummary;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AcceptInvitationInput {
  token: string;
  password: string;
  firstName: string;
  lastName: string;
}

/**
 * Orchestrates the Authentication Layer (Sprint 1B.2): login, refresh, logout, password
 * reset, invitation acceptance, and account locking. Depends only on the domain services
 * (UserService, SessionService, ...) and the three ports (PasswordHasher — via
 * UserService — TokenService, SessionStore) — never on Prisma or a JWT/bcrypt library
 * directly, per the brief's "behind interfaces" requirement.
 */
@Injectable()
export class AuthService {
  private readonly maxLoginAttempts: number;
  private readonly isDevelopment: boolean;

  constructor(
    private readonly userService: UserService,
    private readonly sessionService: SessionService,
    private readonly invitationService: InvitationService,
    private readonly roleService: RoleService,
    private readonly passwordResetService: PasswordResetService,
    private readonly auditService: AuditService,
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
    @Inject(SESSION_STORE) private readonly sessionStore: SessionStore,
    config: ConfigService,
  ) {
    this.maxLoginAttempts = config.get<number>('auth.maxLoginAttempts', 5);
    this.isDevelopment = config.get<string>('NODE_ENV') === 'development';
  }

  // ---------------------------------------------------------------------------------
  // Login (brief §3)
  // ---------------------------------------------------------------------------------

  async login(input: LoginInput, context: RequestContext): Promise<LoginResult> {
    const user = await this.userService.getByEmail(input.email);

    if (!user) {
      await this.recordAuditEvent(AUTH_AUDIT_ACTIONS.LOGIN_FAILURE, undefined, undefined, {
        email: input.email,
        reason: 'user_not_found',
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    this.assertLoginableStatus(user);

    const validPassword = await this.userService.verifyPassword(user, input.password);
    if (!validPassword) {
      await this.handleFailedLogin(user);
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.userService.resetFailedLoginAttempts(user.id);
    await this.userService.recordLogin(user.id);

    const result = await this.issueSession(user, context);

    await this.recordAuditEvent(
      AUTH_AUDIT_ACTIONS.LOGIN_SUCCESS,
      user.organisationId,
      user.id,
      { email: user.email },
      context,
    );

    return result;
  }

  /** Increments the failed-attempt counter and locks the account (brief §9) once
   *  MAX_LOGIN_ATTEMPTS is reached. */
  private async handleFailedLogin(user: User): Promise<void> {
    const updated = await this.userService.recordFailedLogin(user.id);

    await this.recordAuditEvent(AUTH_AUDIT_ACTIONS.LOGIN_FAILURE, user.organisationId, user.id, {
      email: user.email,
      reason: 'invalid_password',
      failedLoginAttempts: updated.failedLoginAttempts,
    });

    if (
      updated.failedLoginAttempts >= this.maxLoginAttempts &&
      updated.status === UserStatus.ACTIVE
    ) {
      await this.userService.updateStatus(user.organisationId, user.id, UserStatus.LOCKED);
      await this.recordAuditEvent(AUTH_AUDIT_ACTIONS.ACCOUNT_LOCKED, user.organisationId, user.id, {
        email: user.email,
        failedLoginAttempts: updated.failedLoginAttempts,
      });
    }
  }

  private assertLoginableStatus(user: User): void {
    if (user.status === UserStatus.ACTIVE) return;
    // Deliberately generic message (identity.md §5: failures are indistinguishable in the
    // response body to avoid user enumeration) — the real reason is only in the audit log.
    throw new UnauthorizedException('Invalid email or password');
  }

  // ---------------------------------------------------------------------------------
  // Refresh Token Rotation (brief §4)
  // ---------------------------------------------------------------------------------

  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    const payload = this.tokenService.verifyRefreshToken(rawRefreshToken);
    const tokenHash = hashToken(rawRefreshToken);
    const tokenRow = await this.sessionStore.findRefreshTokenByHash(tokenHash);

    if (!tokenRow) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (tokenRow.replacedByTokenId) {
      // Reuse of an already-rotated token — strong signal of theft. Revoke the whole
      // session (identity.md §5 Refresh Token Flow).
      await this.sessionStore.revokeSession(payload.organisationId, tokenRow.sessionId);
      await this.recordAuditEvent(
        AUTH_AUDIT_ACTIONS.REFRESH_REUSE_DETECTED,
        payload.organisationId,
        payload.sub,
        { sessionId: tokenRow.sessionId },
      );
      await this.recordAuditEvent(
        AUTH_AUDIT_ACTIONS.SESSION_REVOKED,
        payload.organisationId,
        payload.sub,
        { sessionId: tokenRow.sessionId, reason: 'refresh_token_reuse' },
      );
      throw new UnauthorizedException('Refresh token reuse detected; session revoked');
    }

    if (tokenRow.revokedAt || tokenRow.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const session = await this.sessionStore.findSessionById(
      payload.organisationId,
      tokenRow.sessionId,
    );
    if (!session || session.revokedAt) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const newPayload = {
      sub: payload.sub,
      organisationId: payload.organisationId,
      sessionId: session.id,
    };
    const newAccessToken = this.tokenService.signAccessToken(newPayload);
    const newRefreshToken = this.tokenService.signRefreshToken(newPayload);

    await this.sessionStore.rotateRefreshToken(tokenRow.id, {
      sessionId: session.id,
      tokenHash: hashToken(newRefreshToken),
      expiresAt: new Date(Date.now() + this.tokenService.getRefreshTokenExpiryMs()),
    });
    await this.sessionStore.touchSession(session.id);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: this.tokenService.getAccessTokenExpirySeconds(),
    };
  }

  // ---------------------------------------------------------------------------------
  // Logout (brief §5)
  // ---------------------------------------------------------------------------------

  async logout(organisationId: string, userId: string, sessionId: string): Promise<void> {
    await this.sessionService.revoke(organisationId, sessionId);
    await this.recordAuditEvent(AUTH_AUDIT_ACTIONS.LOGOUT, organisationId, userId, { sessionId });
  }

  async logoutAll(organisationId: string, userId: string): Promise<void> {
    await this.sessionService.revokeAllForUser(organisationId, userId);
    await this.recordAuditEvent(AUTH_AUDIT_ACTIONS.LOGOUT_ALL, organisationId, userId);
  }

  // ---------------------------------------------------------------------------------
  // Password Reset (brief §6)
  // ---------------------------------------------------------------------------------

  /**
   * Always resolves (never reveals whether the email exists) except for what it returns:
   * a raw reset token, **development-mode only** (brief §6). In production this return
   * value is always `undefined` — sending it by email is a future sprint's job (no email
   * integration exists yet).
   */
  async requestPasswordReset(email: string): Promise<{ resetToken?: string }> {
    const user = await this.userService.getByEmail(email);
    if (!user) {
      return {};
    }

    const rawToken = generateOpaqueToken();
    await this.passwordResetService.createToken(user.id, hashToken(rawToken));

    await this.recordAuditEvent(
      AUTH_AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
      user.organisationId,
      user.id,
    );

    return this.isDevelopment ? { resetToken: rawToken } : {};
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenRow = await this.passwordResetService.findByTokenHash(hashToken(rawToken));
    if (!tokenRow || !this.passwordResetService.isUsable(tokenRow)) {
      throw new AppError('Invalid or expired reset token', 400, 'INVALID_RESET_TOKEN');
    }

    const newHash = await this.userService.hashPassword(newPassword);
    const user = await this.userService.setPasswordHash(tokenRow.userId, newHash);
    await this.passwordResetService.markUsed(tokenRow.id);

    // A password reset invalidates every existing session — the old password may have
    // been compromised (identity.md §5 Password Reset Flow).
    await this.sessionStore.revokeAllSessionsForUser(user.organisationId, user.id);

    await this.recordAuditEvent(AUTH_AUDIT_ACTIONS.PASSWORD_RESET, user.organisationId, user.id);
    await this.recordAuditEvent(AUTH_AUDIT_ACTIONS.SESSION_REVOKED, user.organisationId, user.id, {
      reason: 'password_reset',
    });
  }

  // ---------------------------------------------------------------------------------
  // Invitation Acceptance (brief §7)
  // ---------------------------------------------------------------------------------

  async acceptInvitation(
    input: AcceptInvitationInput,
    context: RequestContext,
  ): Promise<LoginResult> {
    const invitation = await this.invitationService.validateToken(input.token);

    const user = await this.userService.createFromInvitationAcceptance({
      organisationId: invitation.organisationId,
      email: invitation.email,
      firstName: input.firstName,
      lastName: input.lastName,
      password: input.password,
    });

    await this.roleService.assignRoleToUser(
      invitation.organisationId,
      user.id,
      invitation.roleId,
      invitation.invitedById,
    );
    await this.invitationService.markAccepted(invitation.organisationId, invitation.id);

    const result = await this.issueSession(user, context);

    await this.recordAuditEvent(
      AUTH_AUDIT_ACTIONS.INVITATION_ACCEPTED,
      invitation.organisationId,
      user.id,
      { invitationId: invitation.id, email: user.email },
      context,
    );

    return result;
  }

  // ---------------------------------------------------------------------------------
  // Session Management (brief §8)
  // ---------------------------------------------------------------------------------

  listSessions(organisationId: string, userId: string): Promise<Session[]> {
    return this.sessionStore.listActiveSessions(organisationId, userId);
  }

  // ---------------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------------

  private async issueSession(user: User, context: RequestContext): Promise<LoginResult> {
    const session = await this.sessionStore.createSession({
      userId: user.id,
      organisationId: user.organisationId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    const payload = { sub: user.id, organisationId: user.organisationId, sessionId: session.id };
    const accessToken = this.tokenService.signAccessToken(payload);
    const refreshToken = this.tokenService.signRefreshToken(payload);

    await this.sessionStore.issueRefreshToken({
      sessionId: session.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + this.tokenService.getRefreshTokenExpiryMs()),
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.tokenService.getAccessTokenExpirySeconds(),
      user: toUserSummary(user),
    };
  }

  private recordAuditEvent(
    action: string,
    organisationId: string | undefined,
    actorUserId: string | undefined,
    metadata?: Record<string, unknown>,
    context?: RequestContext,
  ): Promise<unknown> {
    return this.auditService.record({
      action,
      entityType: 'User',
      entityId: actorUserId,
      organisationId,
      actorUserId,
      metadata,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
    });
  }
}

/** Never includes `passwordHash` — see brief's "Never expose: password hash" requirement. */
function toUserSummary(user: User): UserSummary {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    organisationId: user.organisationId,
    status: user.status,
  };
}
