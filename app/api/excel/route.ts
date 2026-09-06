import { env } from 'cloudflare:workers';
import * as XLSX from 'xlsx';
import {
  decryptValue,
  errorResponse,
  getAllowedShops,
  hasPermission,
  maskName,
  ORGANIZATION_ID,
  requirePermission,
  SHOP_NAMES,
  type MotoworksEnv,
} from '@/lib/server/motoworks';
import { buildLegacyWorkbook, inspectLegacyWorkbook } from '@/lib/excel';
import type { ReviewDocument } from '@/lib/domain';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const runtime = env as unknown as MotoworksEnv;
  try {
    const user = await requirePermission(request, runtime, 'excel_export');
    const allowedShops = getAllowedShops(user, 'excel_export');
    if (allowedShops.length === 0) {
      return Response.json({ error: '엑셀 내보내기 권한이 없습니다.' }, { status: 403 });
    }

    const shopPlaceholders = allowedShops.map(() => '?').join(',');
    const rows = await runtime.DB.prepare(
      `SELECT so.id, so.shop_id, s.name AS shop_name, so.approved_service_date,
              so.service_type, so.total_amount,
              c.name AS customer_name,
              v.model AS vehicle_model
         FROM service_orders so
         LEFT JOIN shops s ON s.id = so.shop_id
         LEFT JOIN customers c ON c.id = so.customer_id
         LEFT JOIN vehicles v ON v.id = so.vehicle_id
        WHERE so.organization_id = ? AND so.status = 'approved' AND so.shop_id IN (${shopPlaceholders})
        ORDER BY so.created_at DESC`,
    )
      .bind(ORGANIZATION_ID, ...allowedShops)
      .all<{
        id: string;
        shop_id: string;
        shop_name: string | null;
        approved_service_date: string;
        service_type: string;
        total_amount: number;
        customer_name: string | null;
        vehicle_model: string | null;
      }>();

    const canViewPii = hasPermission(user, 'view_pii');
    const docs: ReviewDocument[] = await Promise.all(
      rows.results.map(async (r) => {
        let customerName = r.customer_name || '고객 미확인';
        if (r.customer_name && r.customer_name.startsWith('v1:') && runtime.DATA_ENCRYPTION_KEY) {
          customerName = await decryptValue(r.customer_name, runtime.DATA_ENCRYPTION_KEY);
        }
        if (!canViewPii) {
          customerName = maskName(customerName);
        }
        return {
          id: r.id,
          fileName: '정비내역서.jpg',
          shopName: r.shop_name || SHOP_NAMES[r.shop_id] || '센터 확인',
          shopCertainty: 'confirmed',
          customerName,
          vehicleLabel: r.vehicle_model || '차종 미확인',
          amount: r.total_amount,
          status: 'approved',
          sourceAvailable: true,
          duplicateCandidate: false,
          fields: [
            {
              id: `${r.id}-date`,
              key: 'service_date',
              label: '정비일',
              rawValue: r.approved_service_date,
              normalizedValue: r.approved_service_date,
              confidence: 1,
              boundingBox: { x: 0, y: 0, width: 0, height: 0 },
              validationStatus: 'valid',
            },
            {
              id: `${r.id}-item`,
              key: 'service_item',
              label: '작업 항목',
              rawValue: '정비 작업',
              normalizedValue: '정비 작업',
              confidence: 1,
              boundingBox: { x: 0, y: 0, width: 0, height: 0 },
              validationStatus: 'valid',
            },
          ],
        };
      }),
    );

    const workbook = buildLegacyWorkbook(docs);
    const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });

    return new Response(buffer, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="motoworks_export.xlsx"',
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const runtime = env as unknown as MotoworksEnv;
  try {
    await requirePermission(request, runtime, 'excel_import');
    const form = await request.formData();
    const file = form.get('file');

    if (!file || !(file instanceof File)) {
      return Response.json({ error: '엑셀 파일을 선택하세요.' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const result = inspectLegacyWorkbook(bytes);

    return Response.json({
      fileName: file.name,
      ...result,
      verified: false,
      message: '기존 엑셀 구조 검사 완료. 미리보기 상태이며 기존 데이터를 덮어쓰지 않습니다.',
    });
  } catch (error) {
    return errorResponse(error);
  }
}
