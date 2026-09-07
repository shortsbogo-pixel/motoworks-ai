import { env } from 'cloudflare:workers';
import {
  checkLoginRateLimit,
  createSessionToken,
  errorResponse,
  HttpError,
  logSecurityAudit,
  ORGANIZATION_ID,
  recordLoginFailure,
  resetLoginFailure,
  verifyPassword,
  type MotoworksEnv,
} from '@/lib/server/motoworks';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const runtime = env as unknown as MotoworksEnv;
  try {
    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
    };

    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';

    if (!email || !password) {
      return Response.json(
        { error: '이메일과 비밀번호를 모두 입력해주세요.' },
        { status: 400 },
      );
    }

    // 1. 무차별 대입 방지 Rate Limit 검증 (5회 실패 시 15분 차단)
    const rateCheck = await checkLoginRateLimit(runtime, email);
    if (!rateCheck.allowed) {
      await logSecurityAudit(
        runtime,
        `unauth:${email}`,
        'auth.login_blocked',
        'rate_limit',
        email,
        { reason: rateCheck.reason },
        request,
      );
      return Response.json(
        { error: rateCheck.reason },
        {
          status: 429,
          headers: { 'Retry-After': String(rateCheck.retryAfterSeconds ?? 900) },
        },
      );
    }

    // 2. 사용자 조회 (password_hash 컬럼 포함)
    const userRow = await runtime.DB.prepare(
      `SELECT id, email, display_name, status, password_hash
         FROM users
        WHERE email = ?1 AND organization_id = ?2
        LIMIT 1`,
    )
      .bind(email, ORGANIZATION_ID)
      .first<{
        id: string;
        email: string;
        display_name: string | null;
        status: 'pending' | 'active' | 'suspended';
        password_hash: string | null;
      }>();

    // 사용자가 없거나 비밀번호가 설정되지 않은 경우
    if (!userRow || !userRow.password_hash) {
      const failure = await recordLoginFailure(runtime, email);
      await logSecurityAudit(
        runtime,
        `unauth:${email}`,
        'auth.login_failed',
        'users',
        email,
        { reason: 'user_not_found_or_no_password', consecutiveFailures: failure.consecutiveFailures },
        request,
      );
      if (failure.isBlocked) {
        return Response.json(
          { error: '연속된 로그인 실패(5회 이상)로 계정이 15분간 잠금되었습니다.' },
          { status: 429, headers: { 'Retry-After': '900' } },
        );
      }
      return Response.json(
        { error: '이메일 또는 비밀번호가 일치하지 않습니다.' },
        { status: 401 },
      );
    }

    // 3. 계정 상태 확인
    if (userRow.status === 'pending') {
      return Response.json(
        { error: '계정 승인 대기 중입니다. 관리자의 승인이 필요합니다.' },
        { status: 403 },
      );
    }
    if (userRow.status === 'suspended') {
      return Response.json(
        { error: '비활성화된 계정입니다. 관리자에게 문의하세요.' },
        { status: 403 },
      );
    }

    // 4. PBKDF2-HMAC-SHA256 해시 상수 시간 비교
    const isValid = await verifyPassword(password, userRow.password_hash);
    if (!isValid) {
      const failure = await recordLoginFailure(runtime, email);
      await logSecurityAudit(
        runtime,
        userRow.id,
        'auth.login_failed',
        'users',
        email,
        { reason: 'invalid_password', consecutiveFailures: failure.consecutiveFailures },
        request,
      );
      if (failure.isBlocked) {
        return Response.json(
          { error: '연속된 로그인 실패(5회 이상)로 계정이 15분간 잠금되었습니다.' },
          { status: 429, headers: { 'Retry-After': '900' } },
        );
      }
      return Response.json(
        { error: '이메일 또는 비밀번호가 일치하지 않습니다.' },
        { status: 401 },
      );
    }

    // 5. 로그인 성공 처리: 실패 카운터 리셋
    await resetLoginFailure(runtime, email);

    // 6. 12시간 유효 HMAC 세션 토큰 발급
    const sessionSecret = runtime.SESSION_SECRET;
    if (!sessionSecret) {
      throw new HttpError(500, '서버에 SESSION_SECRET이 설정되지 않았습니다.');
    }

    const sessionDurationSeconds = 12 * 3600; // 12시간
    const token = await createSessionToken(
      { userId: userRow.id, email: userRow.email },
      sessionSecret,
      sessionDurationSeconds,
    );

    await logSecurityAudit(
      runtime,
      userRow.id,
      'auth.login_success',
      'users',
      userRow.id,
      { email: userRow.email },
      request,
    );

    // 7. HttpOnly, Secure, SameSite=Lax 쿠키 헤더 설정
    const cookieString = `motoworks_session=${token}; Path=/; Max-Age=${sessionDurationSeconds}; HttpOnly; Secure; SameSite=Lax`;

    return Response.json(
      {
        success: true,
        user: {
          id: userRow.id,
          email: userRow.email,
          displayName: userRow.display_name || userRow.email,
        },
      },
      {
        status: 200,
        headers: {
          'Set-Cookie': cookieString,
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
