import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { TokenPayload } from '../ports/token.port';
import { JwtTokenService, parseDurationToSeconds } from './jwt-token.service';

describe('JwtTokenService', () => {
  const payload: TokenPayload = {
    sub: 'user-1',
    organisationId: 'org-1',
    sessionId: 'session-1',
  };

  function makeService(overrides: Record<string, string> = {}): JwtTokenService {
    const values: Record<string, string> = {
      'auth.jwtAccessSecret': 'access-secret-at-least-32-characters-long',
      'auth.jwtRefreshSecret': 'refresh-secret-at-least-32-characters-long',
      'auth.jwtAccessExpiresIn': '15m',
      'auth.jwtRefreshExpiresIn': '30d',
      ...overrides,
    };
    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (!(key in values)) throw new Error(`Missing config: ${key}`);
        return values[key];
      }),
      get: jest.fn((key: string, defaultValue?: string) => values[key] ?? defaultValue),
    } as unknown as ConfigService;
    return new JwtTokenService(new JwtService(), config);
  }

  it('signs and verifies an access token, round-tripping the payload', () => {
    const service = makeService();
    const token = service.signAccessToken(payload);
    expect(service.verifyAccessToken(token)).toMatchObject(payload);
  });

  it('signs and verifies a refresh token, round-tripping the payload', () => {
    const service = makeService();
    const token = service.signRefreshToken(payload);
    expect(service.verifyRefreshToken(token)).toMatchObject(payload);
  });

  it('rejects an access token when verified as a refresh token (different secrets)', () => {
    const service = makeService();
    const accessToken = service.signAccessToken(payload);
    expect(() => service.verifyRefreshToken(accessToken)).toThrow('Invalid or expired token');
  });

  it('rejects a refresh token when verified as an access token (different secrets)', () => {
    const service = makeService();
    const refreshToken = service.signRefreshToken(payload);
    expect(() => service.verifyAccessToken(refreshToken)).toThrow('Invalid or expired token');
  });

  it('rejects a garbage token', () => {
    const service = makeService();
    expect(() => service.verifyAccessToken('not-a-real-token')).toThrow('Invalid or expired token');
  });

  it('reports the configured access token expiry in seconds', () => {
    const service = makeService({ 'auth.jwtAccessExpiresIn': '15m' });
    expect(service.getAccessTokenExpirySeconds()).toBe(15 * 60);
  });

  it('reports the configured refresh token expiry in milliseconds', () => {
    const service = makeService({ 'auth.jwtRefreshExpiresIn': '30d' });
    expect(service.getRefreshTokenExpiryMs()).toBe(30 * 86400 * 1000);
  });
});

describe('parseDurationToSeconds', () => {
  it.each([
    ['30s', 30],
    ['15m', 900],
    ['2h', 7200],
    ['1d', 86400],
  ])('parses %s as %d seconds', (input, expected) => {
    expect(parseDurationToSeconds(input)).toBe(expected);
  });

  it('throws on an unrecognised format', () => {
    expect(() => parseDurationToSeconds('forever')).toThrow('Invalid duration');
  });
});
