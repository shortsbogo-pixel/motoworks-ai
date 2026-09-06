import { env } from 'cloudflare:workers';
import {
  errorResponse,
  requireAuthorizedUser,
  type MotoworksEnv,
} from '@/lib/server/motoworks';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const runtime = env as unknown as MotoworksEnv;
  try {
    const { id } = await context.params;
    const document = await runtime.DB.prepare(
      `SELECT original_object_key, mime_type, shop_id
         FROM documents
        WHERE id = ?1
        LIMIT 1`,
    )
      .bind(id)
      .first<{
        original_object_key: string;
        mime_type: string;
        shop_id: string;
      }>();
    if (!document) return new Response('Not found', { status: 404 });
    await requireAuthorizedUser(request, runtime, document.shop_id);
    const object = await runtime.FILES.get(document.original_object_key);
    if (!object) return new Response('Not found', { status: 404 });
    return new Response(object.body, {
      headers: {
        'Content-Type': document.mime_type,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
