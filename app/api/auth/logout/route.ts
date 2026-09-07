import { env } from 'cloudflare:workers';
import { errorResponse, logSecurityAudit, requireAuthorizedUser, type MotoworksEnv } from '@/lib/server/motoworks';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const runtime = env as unknown as MotoworksEnv;
  try {
    try {
      const user = await requireAuthorizedUser(request, runtime);
      await logSecurityAudit(
        runtime,
        user.id,
        'auth.logout',
        'users',
        user.id,
        { email: user.email },
        request,
      );
    } catch {
      // 세션이 이미 만료되었어도 로그아웃 쿠키 제어는 정상 진행
    }

    const cookieString = `motoworks_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

    return Response.json(
      { success: true },
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
