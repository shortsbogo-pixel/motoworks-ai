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
    const user = await requirePermission(request, runtime, 'view');
    const allowedShops = getAllowedShops(user, 'view');

    if (allowedShops.length === 0) {
      return Response.json({
        totalOrders: 0,
        totalRevenue: 0,
        pendingReviewCount: 0,
        rentalOutstanding: 0,
        shops: [],
      });
    }

    const shopPlaceholders = allowedShops.map(() => '?').join(',');

    // 승인된 전체 정비 및 매출
    const totals = await runtime.DB.prepare(
      `SELECT COUNT(id) AS total_orders, COALESCE(SUM(total_amount), 0) AS total_revenue
         FROM service_orders
        WHERE organization_id = ? AND status = 'approved' AND shop_id IN (${shopPlaceholders})`,
    )
      .bind(ORGANIZATION_ID, ...allowedShops)
      .first<{ total_orders: number; total_revenue: number }>();

    // 지점별 승인 건수 및 매출
    const shopRows = await runtime.DB.prepare(
      `SELECT s.id, s.name,
              COUNT(so.id) AS order_count,
              COALESCE(SUM(so.total_amount), 0) AS revenue
         FROM shops s
         LEFT JOIN service_orders so ON so.shop_id = s.id AND so.status = 'approved'
        WHERE s.organization_id = ? AND s.id IN (${shopPlaceholders})
        GROUP BY s.id, s.name`,
    )
      .bind(ORGANIZATION_ID, ...allowedShops)
      .all<{
        id: string;
        name: string;
        order_count: number;
        revenue: number;
      }>();

    // 검수 대기 건수
    const pendingCount = await runtime.DB.prepare(
      `SELECT COUNT(rt.id) AS pending_count
         FROM review_tasks rt
        WHERE rt.organization_id = ? AND rt.status = 'pending' AND rt.shop_id IN (${shopPlaceholders})`,
    )
      .bind(ORGANIZATION_ID, ...allowedShops)
      .first<{ pending_count: number }>();

    // 렌트/리스 미수금 합계
    const rentalReceivables = await runtime.DB.prepare(
      `SELECT COALESCE(SUM(outstanding_amount), 0) AS total_due
         FROM receivables
        WHERE organization_id = ? AND shop_id IN (${shopPlaceholders})`,
    )
      .bind(ORGANIZATION_ID, ...allowedShops)
      .first<{ total_due: number }>();

    return Response.json({
      totalOrders: totals?.total_orders ?? 0,
      totalRevenue: totals?.total_revenue ?? 0,
      pendingReviewCount: pendingCount?.pending_count ?? 0,
      rentalOutstanding: rentalReceivables?.total_due ?? 0,
      shops: shopRows.results.map((r) => ({
        id: r.id,
        name: r.name || SHOP_NAMES[r.id] || r.id,
        orderCount: r.order_count,
        revenue: r.revenue,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
