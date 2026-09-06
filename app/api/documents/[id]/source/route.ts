import { env } from 'cloudflare:workers';
import {
  errorResponse,
  requirePermission,
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
    await requirePermission(request, runtime, 'view', document.shop_id);
    const object = await runtime.FILES.get(document.original_object_key);
    if (!object) {
      // Dev/Demo fallback: generate visual SVG receipt
      const fields = await runtime.DB.prepare(
        `SELECT field_key, raw_value FROM extracted_fields WHERE document_id = ?1`,
      )
        .bind(id)
        .all<{ field_key: string; raw_value: string }>();

      const fMap: Record<string, string> = {};
      for (const f of fields.results) {
        fMap[f.field_key] = f.raw_value;
      }

      const shopTitle =
        document.shop_id === 'yongjeon'
          ? '진바이크 용전센터'
          : '코아바이크 자양센터';
      const date = fMap.service_date || '2026-09-06';
      const cust = fMap.customer_name || '고객';
      const phone = fMap.phone || '';
      const vehicle = `${fMap.vehicle_model || ''} (${fMap.vehicle_plate || ''})`;
      const item = fMap.service_item || '정비 작업';
      const amt = fMap.amount || '0';
      const pay = fMap.payment_method || '카드';

      const svg = `<svg width="400" height="550" viewBox="0 0 400 550" xmlns="http://www.w3.org/2000/svg">
        <rect width="400" height="550" fill="#fdfbf7" stroke="#cbd5e1" stroke-width="2" rx="8" />
        <rect x="20" y="20" width="360" height="510" fill="none" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="4 4" />
        <text x="200" y="55" font-family="sans-serif" font-size="20" font-weight="900" text-anchor="middle" fill="#0f172a" letter-spacing="4">정 비 내 역 서</text>
        <line x1="40" y1="70" x2="360" y2="70" stroke="#0f172a" stroke-width="2" />
        <rect x="40" y="85" width="320" height="150" fill="#ffffff" stroke="#94a3b8" stroke-width="1" rx="4" />
        <line x1="120" y1="85" x2="120" y2="235" stroke="#cbd5e1" stroke-width="1" />
        <line x1="40" y1="122" x2="360" y2="122" stroke="#cbd5e1" stroke-width="1" />
        <line x1="40" y1="160" x2="360" y2="160" stroke="#cbd5e1" stroke-width="1" />
        <line x1="40" y1="197" x2="360" y2="197" stroke="#cbd5e1" stroke-width="1" />
        <text x="50" y="108" font-family="sans-serif" font-size="12" font-weight="bold" fill="#475569">발행센터</text>
        <text x="130" y="108" font-family="sans-serif" font-size="12" font-weight="600" fill="#0f172a">${shopTitle}</text>
        <text x="50" y="145" font-family="sans-serif" font-size="12" font-weight="bold" fill="#475569">정비일자</text>
        <text x="130" y="145" font-family="sans-serif" font-size="12" font-weight="600" fill="#0f172a">${date}</text>
        <text x="50" y="182" font-family="sans-serif" font-size="12" font-weight="bold" fill="#475569">고객정보</text>
        <text x="130" y="182" font-family="sans-serif" font-size="12" font-weight="600" fill="#0f172a">${cust} ${phone ? `(${phone})` : ''}</text>
        <text x="50" y="219" font-family="sans-serif" font-size="12" font-weight="bold" fill="#475569">차량정보</text>
        <text x="130" y="219" font-family="sans-serif" font-size="12" font-weight="600" fill="#0f172a">${vehicle}</text>
        <rect x="40" y="250" width="320" height="170" fill="#ffffff" stroke="#94a3b8" stroke-width="1" rx="4" />
        <line x1="40" y1="285" x2="360" y2="285" stroke="#cbd5e1" stroke-width="1" />
        <text x="50" y="273" font-family="sans-serif" font-size="12" font-weight="bold" fill="#475569">작업 내역</text>
        <text x="310" y="273" font-family="sans-serif" font-size="12" font-weight="bold" fill="#475569" text-anchor="end">금액</text>
        <text x="50" y="315" font-family="sans-serif" font-size="13" font-weight="600" fill="#0f172a">1. ${item}</text>
        <text x="350" y="315" font-family="sans-serif" font-size="13" font-weight="bold" fill="#0f172a" text-anchor="end">${amt}원</text>
        <text x="50" y="345" font-family="sans-serif" font-size="12" fill="#64748b">2. 기본 안전 점검 및 공기압</text>
        <text x="350" y="345" font-family="sans-serif" font-size="12" fill="#64748b" text-anchor="end">무상</text>
        <line x1="40" y1="380" x2="360" y2="380" stroke="#0f172a" stroke-width="1.5" />
        <text x="50" y="405" font-family="sans-serif" font-size="14" font-weight="bold" fill="#0f172a">합계 금액</text>
        <text x="350" y="405" font-family="sans-serif" font-size="16" font-weight="900" fill="#0f766e" text-anchor="end">${amt}원</text>
        <rect x="40" y="435" width="320" height="45" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" rx="4" />
        <text x="50" y="462" font-family="sans-serif" font-size="12" font-weight="bold" fill="#475569">결제 수단:</text>
        <text x="120" y="462" font-family="sans-serif" font-size="12" font-weight="600" fill="#0f172a">${pay}</text>
        <text x="200" y="515" font-family="sans-serif" font-size="11" fill="#94a3b8" text-anchor="middle">모토웍스 정비관리 시스템 전산 영수증</text>
      </svg>`;

      return new Response(svg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
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
