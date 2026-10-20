import jwt from 'jsonwebtoken';
import { verifySessionToken } from './jwt.util';

const secret = 'test-secret-with-enough-entropy-for-unit-tests';
const subject = '8f779c1a-49aa-4ee0-a10f-0e13ea9db4c5';
const tenantId = '25dde861-7ac9-4f1f-b944-1263e2a7495b';

function sign(overrides: Record<string, unknown> = {}) {
  return jwt.sign(
    {
      email: 'agent@example.com',
      role: 'authenticated',
      aud: 'authenticated',
      app: 'apticket',
      tenant_id: tenantId,
      ...overrides,
    },
    secret,
    { subject, algorithm: 'HS256' },
  );
}

describe('verifySessionToken', () => {
  it('accepts an APTicket authenticated token', () => {
    expect(verifySessionToken(sign(), secret)).toEqual({
      sub: subject,
      email: 'agent@example.com',
      tenantId,
      app: 'apticket',
      sessionVersion: 0,
      expiresAt: null,
    });
  });

  it.each([
    ['missing app claim', { app: undefined }],
    ['wrong app claim', { app: 'another-app' }],
    ['wrong role', { role: 'anon' }],
    ['wrong audience', { aud: 'another-audience' }],
    ['missing tenant', { tenant_id: undefined }],
    ['negative session version', { session_version: -1 }],
    ['string session version', { session_version: '1' }],
    ['fractional session version', { session_version: 1.5 }],
    ['null session version', { session_version: null }],
    [
      'unsafe session version',
      { session_version: Number.MAX_SAFE_INTEGER + 1 },
    ],
  ])('rejects %s', (_label, overrides) => {
    expect(verifySessionToken(sign(overrides), secret)).toBeNull();
  });
});
