import { env } from 'cloudflare:workers';
import {
  decryptValue,
  maskName,
  SHOP_NAMES,
  type MotoworksEnv,
} from '@/lib/server/motoworks';

export const dynamic = 'force-dynamic';

export default async function ReceiptPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const runtime = env as unknown as MotoworksEnv;
  const encryptionKey =
    runtime.DATA_ENCRYPTION_KEY ||
    process.env.DATA_ENCRYPTION_KEY ||
    (process.env.NODE_ENV === 'test'
      ? undefined
      : 'motoworks-dev-local-encryption-key-32chars!');

  let orderData = null;
  let itemsData: Array<{ raw_name: string; amount: number; quantity: number }> = [];

  try {
    const order = await runtime.DB.prepare(
      `SELECT so.id, so.shop_id, so.approved_service_date, so.total_amount, so.status,
              c.name AS customer_name,
              v.model AS vehicle_model, v.plate_encrypted
         FROM service_orders so
         LEFT JOIN customers c ON c.id = so.customer_id
         LEFT JOIN vehicles v ON v.id = so.vehicle_id
        WHERE so.id = ?1 OR so.document_id = ?1
        LIMIT 1`,
    )
      .bind(id)
      .first<{
        id: string;
        shop_id: string;
        approved_service_date: string;
        total_amount: number;
        status: string;
        customer_name: string | null;
        vehicle_model: string | null;
        plate_encrypted: string | null;
      }>();

    if (order) {
      let plate = '***';
      if (order.plate_encrypted && encryptionKey && order.plate_encrypted.startsWith('v1:')) {
        try {
          const raw = await decryptValue(order.plate_encrypted, encryptionKey);
          plate = raw.slice(0, 3) + '****';
        } catch {
          plate = '***';
        }
      }

      let customer = '고객님';
      if (order.customer_name) {
        if (encryptionKey && order.customer_name.startsWith('v1:')) {
          try {
            const raw = await decryptValue(order.customer_name, encryptionKey);
            customer = maskName(raw);
          } catch {
            customer = '고객님';
          }
        } else {
          customer = maskName(order.customer_name);
        }
      }

      const items = await runtime.DB.prepare(
        `SELECT raw_name, amount, quantity FROM service_items WHERE service_order_id = ?1`,
      )
        .bind(order.id)
        .all<{ raw_name: string; amount: number; quantity: number }>();

      orderData = {
        id: order.id,
        shopName: SHOP_NAMES[order.shop_id] || order.shop_id,
        date: order.approved_service_date,
        totalAmount: order.total_amount,
        status: order.status,
        customer,
        vehicleModel: order.vehicle_model || '스쿠터/오토바이',
        plate,
      };
      itemsData = items.results || [];
    }
  } catch {
    orderData = null;
  }

  if (!orderData) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4 bg-slate-950 text-slate-100 font-sans">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-center shadow-xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
            !
          </div>
          <h1 className="text-lg font-bold">정비명세서를 찾을 수 없습니다</h1>
          <p className="mt-2 text-sm text-slate-400">
            유효하지 않은 링크이거나 정비 검수가 아직 완료되지 않은 문서입니다.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen justify-center p-3 sm:p-6 bg-[#090d16] text-slate-100 font-sans">
      <div className="w-full max-w-lg space-y-4">
        {/* 상단 알림 배너 */}
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.15)] flex items-center justify-between">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">MOTOWORKS DIGITAL RECEIPT</span>
            <p className="text-base font-extrabold text-white mt-0.5">{orderData.customer}님의 정비가 완료되었습니다</p>
          </div>
          <span className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-black text-slate-950">
            정비완료
          </span>
        </div>

        {/* 전자 영수증 카드 */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-5 sm:p-7 shadow-2xl space-y-6">
          <div className="border-b border-slate-800 pb-4 flex justify-between items-start">
            <div>
              <h2 className="text-xl font-black text-white">{orderData.shopName}</h2>
              <p className="text-xs text-slate-400 mt-1">정비일자: {orderData.date}</p>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-mono text-slate-500">ID: {orderData.id.slice(-8)}</span>
              <p className="text-xs font-bold text-amber-400 mt-0.5">{orderData.vehicleModel}</p>
            </div>
          </div>

          {/* 세부 정비 항목 리스트 */}
          <div>
            <h3 className="text-xs font-bold text-slate-400 mb-3 tracking-wide">정비 작업 및 교체 부품 내역</h3>
            <div className="space-y-2.5">
              {itemsData.length > 0 ? (
                itemsData.map((item, idx) => (
                  <div key={idx} className="flex justify-between items-center rounded-xl bg-slate-950/60 p-3 border border-slate-800/80">
                    <div>
                      <p className="text-sm font-bold text-slate-100">{item.raw_name}</p>
                      <p className="text-xs text-slate-500">수량: {item.quantity}EA</p>
                    </div>
                    <span className="font-mono font-bold text-sm text-slate-200">
                      {item.amount.toLocaleString()}원
                    </span>
                  </div>
                ))
              ) : (
                <div className="rounded-xl bg-slate-950/60 p-3.5 border border-slate-800/80 flex justify-between items-center">
                  <p className="text-sm font-bold text-slate-100">정기 점검 및 소모품 교체</p>
                  <span className="font-mono font-bold text-sm text-slate-200">
                    {orderData.totalAmount.toLocaleString()}원
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 최종 합계 */}
          <div className="border-t border-slate-800 pt-4 flex justify-between items-center">
            <span className="text-base font-extrabold text-slate-300">총 결제 금액</span>
            <span className="text-2xl font-black font-mono text-emerald-400">
              {orderData.totalAmount.toLocaleString()}원
            </span>
          </div>

          {/* 보증 및 안내사항 */}
          <div className="rounded-xl bg-slate-950/40 p-3.5 border border-slate-800/60 text-xs text-slate-400 space-y-1">
            <p className="font-semibold text-slate-300">🛡️ 모토웍스 안심 정비 보증 안내</p>
            <p>• 교체된 정품 부품은 제조사 보증 기준에 따라 품질이 보증됩니다.</p>
            <p>• 안전 운행을 위해 다음 정기 점검 주기(3,000km 주행 후)에 재방문해 주세요.</p>
          </div>
        </div>

        {/* 하단 브랜드 푸터 */}
        <p className="text-center text-[11px] text-slate-500">
          Powered by MOTOWORKS AI Platform · 지점 전산 영수증 인증 시스템
        </p>
      </div>
    </main>
  );
}
