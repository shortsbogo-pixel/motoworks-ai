import { env } from 'cloudflare:workers';
import { errorResponse, requireAuthorizedUser, type MotoworksEnv } from '@/lib/server/motoworks';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const runtime = env as unknown as MotoworksEnv;
  try {
    const user = await requireAuthorizedUser(request, runtime);
    return Response.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        isOwner: user.isOwner,
        status: user.status,
        roles: user.roles,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
