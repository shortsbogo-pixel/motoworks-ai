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
    const user = await requirePermission(request, runtime, 'settlement_manage');
    const allowedShops = getAllowedShops(user, 'settlement_manage');
    if (allowedShops.length === 0) {
      return Response.json({ rentals: [] });
    }

    const canViewPii = hasPermission(user, 'view_pii');
    const shopPlaceholders = allowedShops.map(() => '?').join(',');

    const rows = await runtime.DB.prepare(
      `SELECT r.id, r.shop_id, s.name AS shop_name, r.service_order_id,
              r.base_price, r.customer_paid_amount, r.billed_amount,
              r.received_amount, r.outstanding_amount, r.settlement_status,
              rc.name AS rental_company_name,
              v.model AS vehicle_model, v.plate_encrypted
         FROM receivables r
         LEFT JOIN shops s ON s.id = r.shop_id
         LEFT JOIN rental_companies rc ON rc.id = r.rental_company_id
         LEFT JOIN service_orders so ON so.id = r.service_order_id
         LEFT JOIN vehicles v ON v.id = so.vehicle_id
        WHERE r.organization_id = ? AND r.shop_id IN (${shopPlaceholders})
        ORDER BY r.created_at DESC
        LIMIT 100`,
    )
      .bind(ORGANIZATION_ID, ...allowedShops)
      .all<{
        id: string;
        shop_id: string;
        shop_name: string | null;
        service_order_id: string;
        base_price: number;
        customer_paid_amount: number;
        billed_amount: number;
        received_amount: number;
        outstanding_amount: number;
        settlement_status: string;
        rental_company_name: string | null;
        vehicle_model: string | null;
        plate_encrypted: string | null;
      }>();

    const rentals = await Promise.all(
      rows.results.map(async (row) => {
        let plate = '';
        if (row.plate_encrypted && runtime.DATA_ENCRYPTION_KEY) {
          plate = await decryptValue(
            row.plate_encrypted,
            runtime.DATA_ENCRYPTION_KEY,
          );
        }
        if (!canViewPii && plate) {
          plate = plate.replace(/(\d{2,3}[가-힣]\s*)(\d{4})/, '$1****');
        }

        return {
          id: row.id,
          shopId: row.shop_id,
          shopName: row.shop_name || SHOP_NAMES[row.shop_id] || '센터 확인',
          company: row.rental_company_name || '렌트 협력사',
          vehicle: `${row.vehicle_model || '차종 미확인'} · ${plate || '번호 확인'}`,
          base: row.base_price,
          customer: row.customer_paid_amount,
          billed: row.billed_amount,
          paid: row.received_amount,
          due: row.outstanding_amount,
          status:
            row.settlement_status === 'settled'
              ? '정산 완료'
              : row.settlement_status === 'billed'
                ? '청구 완료'
                : '청구 예정',
        };
      }),
    );

    return Response.json({ rentals });
  } catch (error) {
    return errorResponse(error);
  }
}
