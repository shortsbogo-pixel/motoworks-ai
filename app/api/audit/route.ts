import { env } from 'cloudflare:workers';
import {
  errorResponse,
  getAllowedShops,
  ORGANIZATION_ID,
  requirePermission,
  SHOP_NAMES,
  type MotoworksEnv,
} from '@/lib/server/motoworks';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const runtime = env as unknown as MotoworksEnv;
  try {
    const user = await requirePermission(request, runtime, 'view_audit');
    const allowedShops = getAllowedShops(user, 'view_audit');
    const shopPlaceholders = allowedShops.map(() => '?').join(',');

    const rows = await runtime.DB.prepare(
      `SELECT al.id, al.shop_id, s.name AS shop_name, al.actor_user_id,
              u.display_name AS actor_name, u.email AS actor_email,
              al.action, al.entity_type, al.entity_id, al.after_json, al.created_at
         FROM audit_logs al
         LEFT JOIN shops s ON s.id = al.shop_id
         LEFT JOIN users u ON u.id = al.actor_user_id
        WHERE al.organization_id = ?
          AND (al.shop_id IS NULL OR al.shop_id IN (${shopPlaceholders}))
        ORDER BY al.created_at DESC
        LIMIT 100`,
    )
      .bind(ORGANIZATION_ID, ...allowedShops)
      .all<{
        id: string;
        shop_id: string | null;
        shop_name: string | null;
        actor_user_id: string | null;
        actor_name: string | null;
        actor_email: string | null;
        action: string;
        entity_type: string;
        entity_id: string;
        after_json: string | null;
        created_at: number;
      }>();

    const logs = rows.results.map((r) => {
      let detail = null;
      if (r.after_json) {
        try {
          detail = JSON.parse(r.after_json);
        } catch {
          detail = r.after_json;
        }
      }
      return {
        id: r.id,
        shopName: r.shop_name || (r.shop_id ? SHOP_NAMES[r.shop_id] : '공통'),
        actorName: r.actor_name || r.actor_email || '시스템',
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        detail,
        createdAt: r.created_at,
      };
    });

    return Response.json({ logs });
  } catch (error) {
    return errorResponse(error);
  }
}
