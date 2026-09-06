import { env } from 'cloudflare:workers';
import {
  decryptValue,
  errorResponse,
  getAllowedShops,
  hasPermission,
  ORGANIZATION_ID,
  requirePermission,
  SHOP_NAMES,
  type MotoworksEnv,
} from '@/lib/server/motoworks';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const runtime = env as unknown as MotoworksEnv;
  try {
    const user = await requirePermission(request, runtime, 'view');
    const allowedShops = getAllowedShops(user, 'view');
    if (allowedShops.length === 0) {
      return Response.json({ customers: [], mergeCandidates: [] });
    }

    const canViewPii = hasPermission(user, 'view_pii');
    const shopPlaceholders = allowedShops.map(() => '?').join(',');

    const rows = await runtime.DB.prepare(
      `SELECT c.id, c.shop_id, s.name AS shop_name, c.name, c.phone_encrypted, c.status, c.created_at
         FROM customers c
         LEFT JOIN shops s ON s.id = c.shop_id
        WHERE c.organization_id = ? AND c.shop_id IN (${shopPlaceholders})
        ORDER BY c.created_at DESC
        LIMIT 100`,
    )
      .bind(ORGANIZATION_ID, ...allowedShops)
      .all<{
        id: string;
        shop_id: string;
        shop_name: string | null;
        name: string;
        phone_encrypted: string | null;
        status: string;
        created_at: number;
      }>();

    const customers = await Promise.all(
      rows.results.map(async (row) => {
        let name = row.name;
        let phone = '';
        if (row.phone_encrypted && runtime.DATA_ENCRYPTION_KEY) {
          phone = await decryptValue(
            row.phone_encrypted,
            runtime.DATA_ENCRYPTION_KEY,
          );
        }

        if (!canViewPii) {
          if (name.length > 2) name = `${name[0]}*${name.slice(2)}`;
          else if (name.length === 2) name = `${name[0]}*`;
          if (phone) {
            phone = phone.replace(/(\d{3})[- ]?(\d{3,4})[- ]?(\d{4})/, '$1-****-$3');
          }
        }

        // 해당 고객의 차량 목록
        const vehicles = await runtime.DB.prepare(
          `SELECT id, model, plate_encrypted, certainty
             FROM vehicles
            WHERE customer_id = ?1`,
        )
          .bind(row.id)
          .all<{
            id: string;
            model: string | null;
            plate_encrypted: string | null;
            certainty: string;
          }>();

        const vehicleList = await Promise.all(
          vehicles.results.map(async (v) => {
            let plate = '';
            if (v.plate_encrypted && runtime.DATA_ENCRYPTION_KEY) {
              plate = await decryptValue(
                v.plate_encrypted,
                runtime.DATA_ENCRYPTION_KEY,
              );
            }
            if (!canViewPii && plate) {
              plate = plate.replace(/(\d{2,3}[가-힣]\s*)(\d{4})/, '$1****');
            }
            return {
              id: v.id,
              model: v.model || '차종 미확인',
              plate,
              certainty: v.certainty,
            };
          }),
        );

        return {
          id: row.id,
          shopId: row.shop_id,
          shopName: row.shop_name || SHOP_NAMES[row.shop_id] || '센터 확인',
          name,
          phone,
          status: row.status,
          createdAt: row.created_at,
          vehicles: vehicleList,
        };
      }),
    );

    // 병합 후보 목록
    const candidates = await runtime.DB.prepare(
      `SELECT cmc.id, cmc.customer_a_id, cmc.customer_b_id, cmc.evidence_json, cmc.conflict_json, cmc.score, cmc.status
         FROM customer_merge_candidates cmc
        WHERE cmc.organization_id = ? AND cmc.status = 'pending'
        LIMIT 20`,
    )
      .bind(ORGANIZATION_ID)
      .all<{
        id: string;
        customer_a_id: string;
        customer_b_id: string;
        evidence_json: string;
        conflict_json: string | null;
        score: number;
        status: string;
      }>();

    return Response.json({
      customers,
      mergeCandidates: candidates.results,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
