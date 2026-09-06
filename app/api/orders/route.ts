import { env } from 'cloudflare:workers';
import {
  decryptValue,
  errorResponse,
  getAllowedShops,
  hasPermission,
  maskName,
  maskPhone,
  maskPlate,
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
    const url = new URL(request.url);
    const shopParam = url.searchParams.get('shopId');

    const allowedShops = getAllowedShops(user, 'view');
    if (allowedShops.length === 0) {
      return Response.json({ orders: [] });
    }

    const targetShops = shopParam
      ? allowedShops.filter((s) => s === shopParam)
      : allowedShops;

    if (targetShops.length === 0) {
      return Response.json({ orders: [] });
    }

    const canViewPii = hasPermission(user, 'view_pii');
    const shopPlaceholders = targetShops.map(() => '?').join(',');

    const rows = await runtime.DB.prepare(
      `SELECT so.id, so.shop_id, s.name AS shop_name, so.approved_service_date,
              so.service_type, so.status, so.total_amount, so.created_at,
              c.name AS customer_name, c.phone_encrypted,
              v.model AS vehicle_model, v.plate_encrypted
         FROM service_orders so
         LEFT JOIN shops s ON s.id = so.shop_id
         LEFT JOIN customers c ON c.id = so.customer_id
         LEFT JOIN vehicles v ON v.id = so.vehicle_id
        WHERE so.organization_id = ? AND so.shop_id IN (${shopPlaceholders})
        ORDER BY so.created_at DESC
        LIMIT 200`,
    )
      .bind(ORGANIZATION_ID, ...targetShops)
      .all<{
        id: string;
        shop_id: string;
        shop_name: string | null;
        approved_service_date: string;
        service_type: string;
        status: string;
        total_amount: number;
        created_at: number;
        customer_name: string | null;
        phone_encrypted: string | null;
        vehicle_model: string | null;
        plate_encrypted: string | null;
      }>();

    const orders = await Promise.all(
      rows.results.map(async (row) => {
        let customerName = row.customer_name || '고객 미확인';
        if (row.customer_name && row.customer_name.startsWith('v1:') && runtime.DATA_ENCRYPTION_KEY) {
          customerName = await decryptValue(row.customer_name, runtime.DATA_ENCRYPTION_KEY);
        }
        let phone = '';
        let plate = '';

        if (row.phone_encrypted && runtime.DATA_ENCRYPTION_KEY) {
          phone = await decryptValue(
            row.phone_encrypted,
            runtime.DATA_ENCRYPTION_KEY,
          );
        }
        if (row.plate_encrypted && runtime.DATA_ENCRYPTION_KEY) {
          plate = await decryptValue(
            row.plate_encrypted,
            runtime.DATA_ENCRYPTION_KEY,
          );
        }

        if (!canViewPii) {
          customerName = maskName(customerName);
          phone = maskPhone(phone);
          plate = maskPlate(plate);
        }

        // 해당 정비의 작업 항목 및 결제 내역 조회
        const items = await runtime.DB.prepare(
          `SELECT normalized_name, quantity, unit_price, amount
             FROM service_items
            WHERE service_order_id = ?1`,
        )
          .bind(row.id)
          .all<{
            normalized_name: string | null;
            quantity: number;
            unit_price: number;
            amount: number;
          }>();

        const payments = await runtime.DB.prepare(
          `SELECT method, amount, paid_at, note
             FROM payments
            WHERE service_order_id = ?1`,
        )
          .bind(row.id)
          .all<{
            method: string;
            amount: number;
            paid_at: number | null;
            note: string | null;
          }>();

        return {
          id: row.id,
          shopId: row.shop_id,
          shopName: row.shop_name || SHOP_NAMES[row.shop_id] || '센터 확인',
          serviceDate: row.approved_service_date,
          serviceType: row.service_type,
          status: row.status,
          totalAmount: row.total_amount,
          customerName,
          phone,
          vehicleModel: row.vehicle_model || '차종 미확인',
          plate,
          createdAt: row.created_at,
          items: items.results,
          payments: payments.results,
        };
      }),
    );

    return Response.json({ orders });
  } catch (error) {
    return errorResponse(error);
  }
}
