import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Invitation,
  InvitationStatus,
  PasswordResetToken,
  Session,
  User,
  UserStatus,
} from '@prisma/client';

import { ACCOUNT_AUDIT_ACTIONS } from '../account/account-audit-actions';
import { AuditService } from '../audit/audit.service';
import { InvitationService } from '../invitation/invitation.service';
import { PasswordResetService } from '../password-reset/password-reset.service';
import { RoleService } from '../role/role.service';
import { SessionService } from '../session/session.service';
import { UserService } from '../user/user.service';
import { AUTH_AUDIT_ACTIONS } from './audit-actions';
import { AuthService } from './auth.service';
import { SessionStore } from './ports/session-store.port';
import { TokenService } from './ports/token.port';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    organisationId: 'org-1',
    email: 'jane@example.com',
    employeeCode: null,
    firstName: 'Jane',
    lastName: 'Doe',
    phoneNumber: null,
    avatarUrl: null,
    avatarKey: null,
    passwordHash: 'hashed',
    status: UserStatus.ACTIVE,
    failedLoginAttempts: 0,
    mustChangePassword: false,
    passwordChangedAt: null,
    emailVerifiedAt: null,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    userId: 'user-1',
    organisationId: 'org-1',
    userAgent: 'jest',
    ipAddress: '127.0.0.1',
    createdAt: new Date(),
    lastUsedAt: new Date(),
    revokedAt: null,
    ...overrides,
  };
}

function makeInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: 'invitation-1',
    organisationId: 'org-1',
    email: 'newperson@example.com',
    roleId: 'role-member',
    invitedById: 'user-1',
    tokenHash: 'hash',
    status: InvitationStatus.PENDING,
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('AuthService', () => {
  let userService: jest.Mocked<UserService>;
  let sessionService: jest.Mocked<SessionService>;
  let invitationService: jest.Mocked<InvitationService>;
  let roleService: jest.Mocked<RoleService>;
  let passwordResetService: jest.Mocked<PasswordResetService>;
  let auditService: jest.Mocked<AuditService>;
  let tokenService: jest.Mocked<TokenService>;
  let sessionStore: jest.Mocked<SessionStore>;
  let config: ConfigService;
  let authService: AuthService;

  const context = { ipAddress: '127.0.0.1', userAgent: 'jest' };

  beforeEach(() => {
    userService = {
      getByEmail: jest.fn(),
      getById: jest.fn(),
      verifyPassword: jest.fn(),
      recordLogin: jest.fn(),
      recordFailedLogin: jest.fn(),
      resetFailedLoginAttempts: jest.fn(),
      updateStatus: jest.fn(),
      setPasswordHash: jest.fn(),
      hashPassword: jest.fn(),
      createFromInvitationAcceptance: jest.fn(),
    } as unknown as jest.Mocked<UserService>;

    sessionService = {
      revoke: jest.fn(),
      revokeAllForUser: jest.fn(),
    } as unknown as jest.Mocked<SessionService>;

    invitationService = {
      validateToken: jest.fn(),
      markAccepted: jest.fn(),
    } as unknown as jest.Mocked<InvitationService>;

    roleService = {
      assignRoleToUser: jest.fn(),
    } as unknown as jest.Mocked<RoleService>;

    passwordResetService = {
      createToken: jest.fn(),
      findByTokenHash: jest.fn(),
      isUsable: jest.fn(),
      markUsed: jest.fn(),
    } as unknown as jest.Mocked<PasswordResetService>;

    auditService = {
      record: jest.fn(),
    } as unknown as jest.Mocked<AuditService>;

    tokenService = {
      signAccessToken: jest.fn().mockReturnValue('access-token'),
      verifyAccessToken: jest.fn(),
      signRefreshToken: jest.fn().mockReturnValue('refresh-token'),
      verifyRefreshToken: jest.fn(),
      getAccessTokenExpirySeconds: jest.fn().mockReturnValue(900),
      getRefreshTokenExpiryMs: jest.fn().mockReturnValue(2_592_000_000),
    } as unknown as jest.Mocked<TokenService>;

    sessionStore = {
      createSession: jest.fn().mockResolvedValue(makeSession()),
      issueRefreshToken: jest.fn(),
      findRefreshTokenByHash: jest.fn(),
      rotateRefreshToken: jest.fn(),
      findSessionById: jest.fn(),
      touchSession: jest.fn(),
      revokeSession: jest.fn(),
      revokeAllSessionsForUser: jest.fn(),
      revokeAllSessionsForUserExcept: jest.fn(),
      listActiveSessions: jest.fn(),
    } as unknown as jest.Mocked<SessionStore>;

    config = { get: jest.fn().mockReturnValue(5) } as unknown as ConfigService;

    authService = new AuthService(
      userService,
      sessionService,
      invitationService,
      roleService,
      passwordResetService,
      auditService,
      tokenService,
      sessionStore,
      config,
    );
  });

  // -----------------------------------------------------------------------------
  // Login
  // -----------------------------------------------------------------------------
  describe('login', () => {
    it('succeeds for a correctly-authenticated ACTIVE user', async () => {
      const user = makeUser();
      userService.getByEmail.mockResolvedValue(user);
      userService.verifyPassword.mockResolvedValue(true);

      const result = await authService.login({ email: user.email, password: 'correct' }, context);

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(result.expiresIn).toBe(900);
      expect(result.user).toEqual({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        organisationId: user.organisationId,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
      });
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(userService.resetFailedLoginAttempts).toHaveBeenCalledWith(user.id);
      expect(userService.recordLogin).toHaveBeenCalledWith(user.id);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUTH_AUDIT_ACTIONS.LOGIN_SUCCESS }),
      );
    });

    it('rejects an unknown email without revealing that it does not exist', async () => {
      userService.getByEmail.mockResolvedValue(null);

      await expect(
        authService.login({ email: 'nobody@example.com', password: 'x' }, context),
      ).rejects.toThrow(UnauthorizedException);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUTH_AUDIT_ACTIONS.LOGIN_FAILURE,
          metadata: expect.objectContaining({ reason: 'user_not_found' }),
        }),
      );
    });

    it('rejects an incorrect password and increments the failed-attempt counter', async () => {
      const user = makeUser();
      userService.getByEmail.mockResolvedValue(user);
      userService.verifyPassword.mockResolvedValue(false);
      userService.recordFailedLogin.mockResolvedValue({ ...user, failedLoginAttempts: 1 });

      await expect(
        authService.login({ email: user.email, password: 'wrong' }, context),
      ).rejects.toThrow(UnauthorizedException);
      expect(userService.recordFailedLogin).toHaveBeenCalledWith(user.id);
      expect(userService.updateStatus).not.toHaveBeenCalled();
    });

    it('locks the account once MAX_LOGIN_ATTEMPTS is reached', async () => {
      const user = makeUser();
      userService.getByEmail.mockResolvedValue(user);
      userService.verifyPassword.mockResolvedValue(false);
      userService.recordFailedLogin.mockResolvedValue({ ...user, failedLoginAttempts: 5 });

      await expect(
        authService.login({ email: user.email, password: 'wrong' }, context),
      ).rejects.toThrow(UnauthorizedException);
      expect(userService.updateStatus).toHaveBeenCalledWith(
        user.organisationId,
        user.id,
        UserStatus.LOCKED,
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUTH_AUDIT_ACTIONS.ACCOUNT_LOCKED }),
      );
    });

    it.each([UserStatus.LOCKED, UserStatus.SUSPENDED, UserStatus.DEACTIVATED, UserStatus.INVITED])(
      'rejects a %s user without checking the password',
      async (status) => {
        const user = makeUser({ status });
        userService.getByEmail.mockResolvedValue(user);

        await expect(
          authService.login({ email: user.email, password: 'correct' }, context),
        ).rejects.toThrow(UnauthorizedException);
        expect(userService.verifyPassword).not.toHaveBeenCalled();
      },
    );
  });

  // -----------------------------------------------------------------------------
  // Refresh Token Rotation
  // -----------------------------------------------------------------------------
  describe('refresh', () => {
    const payload = { sub: 'user-1', organisationId: 'org-1', sessionId: 'session-1' };

    it('rotates a valid, unused refresh token', async () => {
      tokenService.verifyRefreshToken.mockReturnValue(payload);
      sessionStore.findRefreshTokenByHash.mockResolvedValue({
        id: 'token-1',
        sessionId: 'session-1',
        tokenHash: 'hash',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        replacedByTokenId: null,
      });
      sessionStore.findSessionById.mockResolvedValue(makeSession());

      const result = await authService.refresh('raw-refresh-token');

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      expect(sessionStore.rotateRefreshToken).toHaveBeenCalledWith(
        'token-1',
        expect.objectContaining({ sessionId: 'session-1' }),
      );
      expect(sessionStore.touchSession).toHaveBeenCalledWith('session-1');
    });

    it('detects reuse of an already-rotated token and revokes the session', async () => {
      tokenService.verifyRefreshToken.mockReturnValue(payload);
      sessionStore.findRefreshTokenByHash.mockResolvedValue({
        id: 'token-1',
        sessionId: 'session-1',
        tokenHash: 'hash',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        replacedByTokenId: 'token-2',
      });

      await expect(authService.refresh('stolen-token')).rejects.toThrow(
        'Refresh token reuse detected; session revoked',
      );
      expect(sessionStore.revokeSession).toHaveBeenCalledWith('org-1', 'session-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUTH_AUDIT_ACTIONS.REFRESH_REUSE_DETECTED }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUTH_AUDIT_ACTIONS.SESSION_REVOKED }),
      );
    });

    it('rejects an unknown token', async () => {
      tokenService.verifyRefreshToken.mockReturnValue(payload);
      sessionStore.findRefreshTokenByHash.mockResolvedValue(null);

      await expect(authService.refresh('unknown-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired token', async () => {
      tokenService.verifyRefreshToken.mockReturnValue(payload);
      sessionStore.findRefreshTokenByHash.mockResolvedValue({
        id: 'token-1',
        sessionId: 'session-1',
        tokenHash: 'hash',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() - 1000),
        revokedAt: null,
        replacedByTokenId: null,
      });

      await expect(authService.refresh('expired-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a token whose session was revoked', async () => {
      tokenService.verifyRefreshToken.mockReturnValue(payload);
      sessionStore.findRefreshTokenByHash.mockResolvedValue({
        id: 'token-1',
        sessionId: 'session-1',
        tokenHash: 'hash',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        replacedByTokenId: null,
      });
      sessionStore.findSessionById.mockResolvedValue(makeSession({ revokedAt: new Date() }));

      await expect(authService.refresh('token-for-revoked-session')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // -----------------------------------------------------------------------------
  // Logout
  // -----------------------------------------------------------------------------
  describe('logout / logoutAll', () => {
    it('logout revokes the current session and records an audit event', async () => {
      await authService.logout('org-1', 'user-1', 'session-1');
      expect(sessionService.revoke).toHaveBeenCalledWith('org-1', 'session-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUTH_AUDIT_ACTIONS.LOGOUT }),
      );
    });

    it('logoutAll revokes every session for the user', async () => {
      await authService.logoutAll('org-1', 'user-1');
      expect(sessionService.revokeAllForUser).toHaveBeenCalledWith('org-1', 'user-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUTH_AUDIT_ACTIONS.LOGOUT_ALL }),
      );
    });
  });

  // -----------------------------------------------------------------------------
  // Password Reset
  // -----------------------------------------------------------------------------
  describe('password reset', () => {
    it('returns a reset token in development mode for an existing user', async () => {
      (config.get as jest.Mock).mockImplementation((key: string) =>
        key === 'NODE_ENV' ? 'development' : 5,
      );
      authService = new AuthService(
        userService,
        sessionService,
        invitationService,
        roleService,
        passwordResetService,
        auditService,
        tokenService,
        sessionStore,
        config,
      );
      userService.getByEmail.mockResolvedValue(makeUser());

      const result = await authService.requestPasswordReset('jane@example.com');

      expect(result.resetToken).toEqual(expect.any(String));
      expect(passwordResetService.createToken).toHaveBeenCalled();
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUTH_AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED }),
      );
    });

    it('never returns a token outside development mode', async () => {
      (config.get as jest.Mock).mockImplementation((key: string) =>
        key === 'NODE_ENV' ? 'production' : 5,
      );
      authService = new AuthService(
        userService,
        sessionService,
        invitationService,
        roleService,
        passwordResetService,
        auditService,
        tokenService,
        sessionStore,
        config,
      );
      userService.getByEmail.mockResolvedValue(makeUser());

      const result = await authService.requestPasswordReset('jane@example.com');
      expect(result.resetToken).toBeUndefined();
    });

    it('does not create a token or leak existence for an unknown email', async () => {
      userService.getByEmail.mockResolvedValue(null);

      const result = await authService.requestPasswordReset('nobody@example.com');

      expect(result.resetToken).toBeUndefined();
      expect(passwordResetService.createToken).not.toHaveBeenCalled();
      expect(auditService.record).not.toHaveBeenCalled();
    });

    it('resets the password and revokes every session for a valid token', async () => {
      const user = makeUser();
      const tokenRow: PasswordResetToken = {
        id: 'reset-1',
        userId: user.id,
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
        createdAt: new Date(),
      };
      passwordResetService.findByTokenHash.mockResolvedValue(tokenRow);
      passwordResetService.isUsable.mockReturnValue(true);
      userService.hashPassword.mockResolvedValue('new-hash');
      userService.setPasswordHash.mockResolvedValue(user);

      await authService.resetPassword('raw-token', 'new-password-123');

      expect(userService.setPasswordHash).toHaveBeenCalledWith(user.id, 'new-hash');
      expect(passwordResetService.markUsed).toHaveBeenCalledWith('reset-1');
      expect(sessionStore.revokeAllSessionsForUser).toHaveBeenCalledWith(
        user.organisationId,
        user.id,
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUTH_AUDIT_ACTIONS.PASSWORD_RESET }),
      );
    });

    it('rejects an invalid or expired reset token', async () => {
      passwordResetService.findByTokenHash.mockResolvedValue(null);

      await expect(authService.resetPassword('bad-token', 'new-password-123')).rejects.toThrow(
        'Invalid or expired reset token',
      );
      expect(userService.setPasswordHash).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------------
  // Invitation Acceptance
  // -----------------------------------------------------------------------------
  describe('acceptInvitation', () => {
    it('validates the token, creates the user, assigns the role, and issues a session', async () => {
      const invitation = makeInvitation();
      const newUser = makeUser({ id: 'user-2', email: invitation.email });
      invitationService.validateToken.mockResolvedValue(invitation);
      userService.createFromInvitationAcceptance.mockResolvedValue(newUser);

      const result = await authService.acceptInvitation(
        { token: 'raw-token', password: 'password123', firstName: 'New', lastName: 'Person' },
        context,
      );

      expect(invitationService.validateToken).toHaveBeenCalledWith('raw-token');
      expect(userService.createFromInvitationAcceptance).toHaveBeenCalledWith({
        organisationId: invitation.organisationId,
        email: invitation.email,
        firstName: 'New',
        lastName: 'Person',
        password: 'password123',
      });
      expect(roleService.assignRoleToUser).toHaveBeenCalledWith(
        invitation.organisationId,
        newUser.id,
        invitation.roleId,
        invitation.invitedById,
      );
      expect(invitationService.markAccepted).toHaveBeenCalledWith(
        invitation.organisationId,
        invitation.id,
      );
      expect(result.accessToken).toBe('access-token');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUTH_AUDIT_ACTIONS.INVITATION_ACCEPTED }),
      );
    });

    it('propagates rejection for an invalid/expired/already-used invitation token', async () => {
      invitationService.validateToken.mockRejectedValue(new Error('Invitation has expired'));

      await expect(
        authService.acceptInvitation(
          { token: 'bad-token', password: 'x', firstName: 'A', lastName: 'B' },
          context,
        ),
      ).rejects.toThrow('Invitation has expired');
      expect(userService.createFromInvitationAcceptance).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------------
  // Session Management
  // -----------------------------------------------------------------------------
  describe('listSessions', () => {
    it('delegates to the SessionStore', async () => {
      const sessions = [makeSession()];
      sessionStore.listActiveSessions.mockResolvedValue(sessions);

      const result = await authService.listSessions('org-1', 'user-1');

      expect(result).toBe(sessions);
      expect(sessionStore.listActiveSessions).toHaveBeenCalledWith('org-1', 'user-1');
    });
  });

  // -----------------------------------------------------------------------------
  // Account Management (Sprint 3.3)
  // -----------------------------------------------------------------------------
  describe('changePassword', () => {
    it('verifies the current password, sets the new one, and revokes every other session', async () => {
      const user = makeUser();
      userService.getById.mockResolvedValue(user);
      userService.verifyPassword.mockResolvedValue(true);
      userService.hashPassword.mockResolvedValue('new-hashed');

      await authService.changePassword(
        'org-1',
        'user-1',
        'session-current',
        'oldPass1!',
        'NewPass1!',
        context,
      );

      expect(userService.verifyPassword).toHaveBeenCalledWith(user, 'oldPass1!');
      expect(userService.hashPassword).toHaveBeenCalledWith('NewPass1!');
      expect(userService.setPasswordHash).toHaveBeenCalledWith('user-1', 'new-hashed');
      expect(sessionStore.revokeAllSessionsForUserExcept).toHaveBeenCalledWith(
        'org-1',
        'user-1',
        'session-current',
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: ACCOUNT_AUDIT_ACTIONS.PASSWORD_CHANGED }),
      );
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: AUTH_AUDIT_ACTIONS.SESSION_REVOKED }),
      );
    });

    it('rejects an incorrect current password without touching sessions', async () => {
      const user = makeUser();
      userService.getById.mockResolvedValue(user);
      userService.verifyPassword.mockResolvedValue(false);

      await expect(
        authService.changePassword(
          'org-1',
          'user-1',
          'session-current',
          'wrong',
          'NewPass1!',
          context,
        ),
      ).rejects.toThrow('Current password is incorrect');
      expect(userService.setPasswordHash).not.toHaveBeenCalled();
      expect(sessionStore.revokeAllSessionsForUserExcept).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the user no longer exists', async () => {
      userService.getById.mockResolvedValue(null);

      await expect(
        authService.changePassword('org-1', 'missing', 'session-1', 'old', 'NewPass1!', context),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('revokeSession', () => {
    it('revokes a session owned by the caller and records an audit entry', async () => {
      const session = makeSession({ id: 'session-2', userId: 'user-1' });
      sessionStore.findSessionById.mockResolvedValue(session);

      await authService.revokeSession('org-1', 'user-1', 'session-2');

      expect(sessionStore.revokeSession).toHaveBeenCalledWith('org-1', 'session-2');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AUTH_AUDIT_ACTIONS.SESSION_REVOKED,
          metadata: { sessionId: 'session-2', reason: 'user_revoked' },
        }),
      );
    });

    it('throws NotFoundException for a session that does not exist', async () => {
      sessionStore.findSessionById.mockResolvedValue(null);

      await expect(authService.revokeSession('org-1', 'user-1', 'nope')).rejects.toThrow(
        NotFoundException,
      );
      expect(sessionStore.revokeSession).not.toHaveBeenCalled();
    });

    it("throws NotFoundException for another user's session (ownership check)", async () => {
      const session = makeSession({ id: 'session-3', userId: 'someone-else' });
      sessionStore.findSessionById.mockResolvedValue(session);

      await expect(authService.revokeSession('org-1', 'user-1', 'session-3')).rejects.toThrow(
        NotFoundException,
      );
      expect(sessionStore.revokeSession).not.toHaveBeenCalled();
    });
  });
});
