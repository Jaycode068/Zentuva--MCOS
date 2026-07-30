import { SessionRepository } from '../../session/session.repository';
import { DatabaseSessionStore } from './database-session-store';

describe('DatabaseSessionStore', () => {
  let sessionRepository: jest.Mocked<SessionRepository>;
  let store: DatabaseSessionStore;

  beforeEach(() => {
    sessionRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      findManyByUser: jest.fn(),
      revoke: jest.fn(),
      revokeAllForUser: jest.fn(),
      updateLastUsedAt: jest.fn(),
      createRefreshToken: jest.fn(),
      findRefreshTokenByHash: jest.fn(),
      rotateRefreshToken: jest.fn(),
    } as unknown as jest.Mocked<SessionRepository>;
    store = new DatabaseSessionStore(sessionRepository);
  });

  it('createSession delegates to the repository with a connect-shaped payload', async () => {
    await store.createSession({
      userId: 'user-1',
      organisationId: 'org-1',
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });

    expect(sessionRepository.create).toHaveBeenCalledWith({
      user: { connect: { id: 'user-1' } },
      organisation: { connect: { id: 'org-1' } },
      ipAddress: '127.0.0.1',
      userAgent: 'jest',
    });
  });

  it('issueRefreshToken delegates with the session connected by id', async () => {
    const expiresAt = new Date();
    await store.issueRefreshToken({ sessionId: 'session-1', tokenHash: 'hash', expiresAt });

    expect(sessionRepository.createRefreshToken).toHaveBeenCalledWith({
      session: { connect: { id: 'session-1' } },
      tokenHash: 'hash',
      expiresAt,
    });
  });

  it('rotateRefreshToken delegates old-token id and new-token payload separately', async () => {
    const expiresAt = new Date();
    await store.rotateRefreshToken('old-token-id', {
      sessionId: 'session-1',
      tokenHash: 'new-hash',
      expiresAt,
    });

    expect(sessionRepository.rotateRefreshToken).toHaveBeenCalledWith('old-token-id', {
      session: { connect: { id: 'session-1' } },
      tokenHash: 'new-hash',
      expiresAt,
    });
  });

  it('revokeSession delegates to the repository', async () => {
    await store.revokeSession('org-1', 'session-1');
    expect(sessionRepository.revoke).toHaveBeenCalledWith('org-1', 'session-1');
  });

  it('revokeAllSessionsForUser delegates to the repository', async () => {
    await store.revokeAllSessionsForUser('org-1', 'user-1');
    expect(sessionRepository.revokeAllForUser).toHaveBeenCalledWith('org-1', 'user-1');
  });

  it('touchSession updates lastUsedAt via the repository', async () => {
    await store.touchSession('session-1');
    expect(sessionRepository.updateLastUsedAt).toHaveBeenCalledWith('session-1');
  });

  it('listActiveSessions delegates to the repository', async () => {
    await store.listActiveSessions('org-1', 'user-1');
    expect(sessionRepository.findManyByUser).toHaveBeenCalledWith('org-1', 'user-1');
  });
});
