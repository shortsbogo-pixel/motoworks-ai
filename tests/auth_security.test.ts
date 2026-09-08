import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import fs from 'node:fs';
import path from 'node:path';
import {
  checkLoginRateLimit,
  createSessionToken,
  ensureBaseSeed,
  hashPassword,
  ORGANIZATION_ID,
  recordLoginFailure,
  resetLoginFailure,
  timingSafeEqual,
  verifyPassword,
  verifySessionToken,
  type MotoworksEnv,
} from '../lib/server/motoworks';

const TEST_SESSION_SECRET = 'motoworks-test-session-secret-at-least-32chars!';
const TEST_PLATE_SECRET = 'motoworks-test-plate-secret-at-least-32chars!';

let mf: Miniflare;
let d1: D1Database;
let mockEnv: MotoworksEnv;

vi.mock('cloudflare:workers', () => ({
  get env() {
    return mockEnv;
  },
}));

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response(null); } }',
    d1Databases: ['DB'],
  });
  d1 = (await mf.getD1Database('DB')) as unknown as D1Database;

  const migrationFiles = [
    '../drizzle/0000_heavy_apocalypse.sql',
    '../drizzle/0001_add_plate_digits_hash.sql',
    '../drizzle/0002_steep_misty_knight.sql',
  ];

  for (const file of migrationFiles) {
    const sqlPath = path.resolve(__dirname, file);
    if (fs.existsSync(sqlPath)) {
      const sql = fs.readFileSync(sqlPath, 'utf8');
      const statements = sql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);

      for (const stmt of statements) {
        await d1.prepare(stmt).run();
      }
    }
  }

  mockEnv = {
    DB: d1,
    FILES: {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as R2Bucket,
    DATA_ENCRYPTION_KEY: 'test-key-32chars-for-encryption!',
    BOOTSTRAP_OWNER_EMAIL: 'shortsbogo@gmail.com',
    SESSION_SECRET: TEST_SESSION_SECRET,
    PLATE_HASH_SECRET: TEST_PLATE_SECRET,
  };

  await ensureBaseSeed(mockEnv, {
    id: 'user:owner:shortsbogo@gmail.com',
    externalId: 'owner:shortsbogo@gmail.com',
    email: 'shortsbogo@gmail.com',
    displayName: '대표 관리자',
    isOwner: true,
  });
});

afterAll(async () => {
  if (mf) {
    await mf.dispose();
  }
});

describe('보안 및 인증 메커니즘 무결성 검증 (tests/auth_security.test.ts)', () => {
  describe('1. timingSafeEqual 상수 시간 비교', () => {
    it('동일한 바이트 배열은 true를 반환한다', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 5]);
      expect(timingSafeEqual(a, b)).toBe(true);
    });

    it('하나라도 다른 바이트가 있으면 false를 반환한다', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 6]);
      expect(timingSafeEqual(a, b)).toBe(false);
    });

    it('길이가 다르면 즉시 false를 반환한다', () => {
      const a = new Uint8Array([1, 2, 3]);
      const b = new Uint8Array([1, 2, 3, 4]);
      expect(timingSafeEqual(a, b)).toBe(false);
    });
  });

  describe('2. PBKDF2-HMAC-SHA256 해싱 및 검증', () => {
    it('올바른 비밀번호를 검증하고 다른 솔트로 인해 고유한 해시를 생성한다', async () => {
      const password = 'TestPassword123!';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1.startsWith('pbkdf2:sha256:100000:')).toBe(true);
      expect(hash2.startsWith('pbkdf2:sha256:100000:')).toBe(true);
      expect(hash1).not.toBe(hash2); // 서로 다른 16바이트 솔트

      const valid1 = await verifyPassword(password, hash1);
      const valid2 = await verifyPassword(password, hash2);
      expect(valid1).toBe(true);
      expect(valid2).toBe(true);

      const invalid = await verifyPassword('WrongPassword123!', hash1);
      expect(invalid).toBe(false);
    });
  });

  describe('3. HMAC-SHA256 세션 토큰 서명 및 검증', () => {
    it('유효한 세션 토큰을 생성하고 서명을 검증한다', async () => {
      const token = await createSessionToken(
        { userId: 'user:test1', email: 'test@example.com' },
        TEST_SESSION_SECRET,
        3600,
      );

      const payload = await verifySessionToken(token, TEST_SESSION_SECRET);
      expect(payload).toBeDefined();
      expect(payload?.userId).toBe('user:test1');
      expect(payload?.email).toBe('test@example.com');
    });

    it('서명 또는 페이로드가 위조된 토큰은 거부(null)된다', async () => {
      const token = await createSessionToken(
        { userId: 'user:test1', email: 'test@example.com' },
        TEST_SESSION_SECRET,
        3600,
      );

      const [payloadPart, sigPart] = token.split('.');
      // 페이로드 임의 변경 (관리자로 위조 시도)
      const fakePayloadPart = btoa(JSON.stringify({ userId: 'user:owner', email: 'shortsbogo@gmail.com' }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      const forgedToken = `${fakePayloadPart}.${sigPart}`;

      const verified = await verifySessionToken(forgedToken, TEST_SESSION_SECRET);
      expect(verified).toBeNull();
    });

    it('만료된 토큰은 거부(null)된다', async () => {
      const token = await createSessionToken(
        { userId: 'user:test1', email: 'test@example.com' },
        TEST_SESSION_SECRET,
        -10, // 이미 10초 전 만료
      );

      const verified = await verifySessionToken(token, TEST_SESSION_SECRET);
      expect(verified).toBeNull();
    });
  });

  describe('4. /api/auth/login 엔드포인트 및 5회 실패 시 429 차단', () => {
    it('비밀번호가 일치하면 200 및 HttpOnly 세션 쿠키를 발급한다', async () => {
      const { POST: postLogin } = await import('../app/api/auth/login/route');
      const testEmail = 'shortsbogo@gmail.com';
      const testPassword = 'CorrectPassword999!';

      const hashed = await hashPassword(testPassword);
      await d1
        .prepare(`UPDATE users SET password_hash = ?1, status = 'active' WHERE email = ?2`)
        .bind(hashed, testEmail)
        .run();

      const req = new Request('http://localhost:5173/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: testPassword }),
      });

      const res = await postLogin(req);
      expect(res.status).toBe(200);
      const setCookie = res.headers.get('Set-Cookie');
      expect(setCookie).toBeDefined();
      expect(setCookie).toContain('motoworks_session=');
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Lax');
    });

    it('연속 5회 로그인 실패 시 HTTP 429 및 Retry-After를 반환한다', async () => {
      const { POST: postLogin } = await import('../app/api/auth/login/route');
      const targetEmail = 'shortsbogo@gmail.com';

      // 실패 카운터 초기화
      await resetLoginFailure(mockEnv, targetEmail);

      // 1~4회 실패 시 401 반환
      for (let i = 1; i <= 4; i++) {
        const failReq = new Request('http://localhost:5173/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: targetEmail, password: `WrongAttempt_${i}` }),
        });
        const res = await postLogin(failReq);
        expect(res.status).toBe(401);
      }

      // 5회차 실패 시 즉시 429 차단
      const fifthReq = new Request('http://localhost:5173/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, password: 'WrongAttempt_5' }),
      });
      const fifthRes = await postLogin(fifthReq);
      expect(fifthRes.status).toBe(429);
      expect(fifthRes.headers.get('Retry-After')).toBeDefined();

      // 이후 추가 시도도 즉시 429 차단
      const blockedReq = new Request('http://localhost:5173/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail, password: 'EvenCorrectPassword' }),
      });
      const blockedRes = await postLogin(blockedReq);
      expect(blockedRes.status).toBe(429);

      // 테스트 후 정상화 리셋
      await resetLoginFailure(mockEnv, targetEmail);
    });
  });

  describe('5. /api/auth/me 및 /api/auth/logout 세션 라이프사이클', () => {
    it('유효한 세션 쿠키로 사용자 프로필을 조회하고, 로그아웃 시 쿠키를 제거한다', async () => {
      const { GET: getMe } = await import('../app/api/auth/me/route');
      const { POST: postLogout } = await import('../app/api/auth/logout/route');

      const token = await createSessionToken(
        { userId: 'user:owner:shortsbogo@gmail.com', email: 'shortsbogo@gmail.com' },
        TEST_SESSION_SECRET,
      );

      // 1. GET /api/auth/me 성공
      const meReq = new Request('http://localhost:5173/api/auth/me', {
        headers: { Cookie: `motoworks_session=${token}` },
      });
      const meRes = await getMe(meReq);
      expect(meRes.status).toBe(200);
      const meData = (await meRes.json()) as any;
      expect(meData.user.email).toBe('shortsbogo@gmail.com');
      expect(meData.user.isOwner).toBe(true);

      // 2. POST /api/auth/logout 호출
      const logoutReq = new Request('http://localhost:5173/api/auth/logout', {
        method: 'POST',
        headers: { Cookie: `motoworks_session=${token}` },
      });
      const logoutRes = await postLogout(logoutReq);
      expect(logoutRes.status).toBe(200);
      const setCookie = logoutRes.headers.get('Set-Cookie');
      expect(setCookie).toContain('motoworks_session=;');
      expect(setCookie).toContain('Max-Age=0');
    });
  });
});
