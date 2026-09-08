import { env } from 'cloudflare:workers';
import {
  decryptValue,
  encryptValue,
  errorResponse,
  extractPlateDigits,
  getAllowedShops,
  hasPermission,
  hashPii,
  hashPlateDigits,
  HttpError,
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
      return Response.json({ orders: [], total: 0, truncated: false });
    }

    const targetShops = shopParam
      ? allowedShops.filter((s) => s === shopParam)
      : allowedShops;

    if (targetShops.length === 0) {
      return Response.json({ orders: [], total: 0, truncated: false });
    }

    const canViewPii = hasPermission(user, 'view_pii');
    const shopPlaceholders = targetShops.map(() => '?').join(',');

    const countRow = await runtime.DB.prepare(
      `SELECT COUNT(*) AS total
         FROM service_orders so
        WHERE so.organization_id = ? AND so.shop_id IN (${shopPlaceholders})`,
    )
      .bind(ORGANIZATION_ID, ...targetShops)
      .first<{ total: number }>();

    const total = countRow?.total ?? 0;

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

    const truncated = total > orders.length;

    return Response.json({
      orders,
      total,
      truncated,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const runtime = env as unknown as MotoworksEnv;
  try {
    const body = (await request.json()) as {
      idempotencyKey?: string;
      shopId?: string;
      serviceDate?: string;
      serviceType?: 'personal' | 'rental' | 'lease';
      vehicleId?: string;
      customerId?: string;
      plateText?: string;
      vehicleModel?: string;
      customerName?: string;
      phone?: string;
      items?: Array<{
        name: string;
        quantity?: number;
        unitPrice?: number;
        amount: number;
      }>;
      paymentMethod?: 'card' | 'cash' | 'transfer';
      paymentAmount?: number;
      paymentNote?: string;
      requestImmediateApproval?: boolean;
    };

    // 1. 멱등성 키 필수 검증
    const idempotencyKey = body.idempotencyKey?.trim();
    if (!idempotencyKey) {
      throw new HttpError(400, 'idempotencyKey는 필수입니다.');
    }

    const shopId = body.shopId?.trim();
    if (!shopId) {
      throw new HttpError(400, 'shopId는 필수입니다.');
    }

    // 2. 권한 검증 (해당 지점 등록 권한)
    const user = await requirePermission(request, runtime, 'upload', shopId);

    // 3. PII 마스킹 차단 검증 (고객명, 연락처, 번호판 필드에만 한정)
    const piiFieldsToCheck = [
      { name: '고객명', val: body.customerName },
      { name: '연락처', val: body.phone },
      { name: '차량 번호판', val: body.plateText },
    ];
    for (const field of piiFieldsToCheck) {
      if (typeof field.val === 'string' && field.val.includes('*')) {
        throw new HttpError(
          400,
          `마스킹된 ${field.name}(*)은 저장할 수 없습니다. 기존 ID를 사용하거나 원본 정보를 입력하세요.`,
        );
      }
    }

    const serviceDate =
      body.serviceDate?.trim() || new Date().toISOString().slice(0, 10);
    const serviceType = body.serviceType || 'personal';

    // 작업 항목 검증
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) {
      throw new HttpError(400, '최소 1개 이상의 정비 항목(items)이 필요합니다.');
    }

    const items = rawItems.map((item) => ({
      name: (item.name || '정비 항목').trim(),
      quantity: Number(item.quantity) || 1,
      unitPrice: Number(item.unitPrice) || Number(item.amount) || 0,
      amount: Number(item.amount) || 0,
    }));

    const totalAmount = items.reduce((sum, it) => sum + it.amount, 0);

    // 승인 상태 결정: requestImmediateApproval 요청이고 review_decide 권한이 있을 때만 approved
    const canDecide = hasPermission(user, 'review_decide', shopId);
    const isApproved = Boolean(body.requestImmediateApproval && canDecide);
    const status = isApproved ? 'approved' : 'review';
    const now = Date.now();
    const approvedBy = isApproved ? user.id : null;
    const approvedAt = isApproved ? now : null;

    const encryptionKey =
      runtime.DATA_ENCRYPTION_KEY ||
      process.env.DATA_ENCRYPTION_KEY ||
      (process.env.NODE_ENV === 'test'
        ? 'motoworks-test-encryption-key-32chars!'
        : 'motoworks-dev-local-encryption-key-32chars!');

    // 4. 읽기(SELECT) 선행 완료
    let customerId = body.customerId?.trim() || null;
    let shouldInsertCustomer = false;
    let customerNameEncrypted: string | null = null;
    let phoneEncrypted: string | null = null;

    if (customerId) {
      const existingCustomer = await runtime.DB.prepare(
        `SELECT id FROM customers WHERE id = ?1 AND organization_id = ?2`,
      )
        .bind(customerId, ORGANIZATION_ID)
        .first<{ id: string }>();
      if (!existingCustomer) {
        throw new HttpError(404, '지정된 고객을 찾을 수 없습니다.');
      }
    } else {
      customerId = `cust:${crypto.randomUUID()}`;
      shouldInsertCustomer = true;
      const rawCustomerName = body.customerName?.trim() || '현장 수기접수 고객';
      customerNameEncrypted = await encryptValue(rawCustomerName, encryptionKey);
      if (body.phone?.trim()) {
        phoneEncrypted = await encryptValue(body.phone.trim(), encryptionKey);
      }
    }

    let vehicleId = body.vehicleId?.trim() || null;
    let shouldInsertVehicle = false;
    let plateEncrypted: string | null = null;
    let plateHash: string | null = null;
    let plateDigitsHash: string | null = null;
    const vehicleModel = body.vehicleModel?.trim() || '차종 미확인';

    if (vehicleId) {
      const existingVehicle = await runtime.DB.prepare(
        `SELECT id FROM vehicles WHERE id = ?1 AND organization_id = ?2`,
      )
        .bind(vehicleId, ORGANIZATION_ID)
        .first<{ id: string }>();
      if (!existingVehicle) {
        throw new HttpError(404, '지정된 차량을 찾을 수 없습니다.');
      }
    } else {
      const rawPlate = body.plateText?.trim() || '';
      if (!rawPlate) {
        throw new HttpError(400, '새 차량 등록 시 차량 번호판(plateText)은 필수입니다.');
      }

      plateHash = await hashPii(rawPlate);

      // 이미 같은 번호판의 차량이 해당 지점에 있는지 확인
      const existingByHash = await runtime.DB.prepare(
        `SELECT id FROM vehicles WHERE organization_id = ?1 AND shop_id = ?2 AND plate_hash = ?3 LIMIT 1`,
      )
        .bind(ORGANIZATION_ID, shopId, plateHash)
        .first<{ id: string }>();

      if (existingByHash) {
        vehicleId = existingByHash.id;
      } else {
        vehicleId = `veh:${crypto.randomUUID()}`;
        shouldInsertVehicle = true;
        plateEncrypted = await encryptValue(rawPlate, encryptionKey);
        const digits = extractPlateDigits(rawPlate);
        const secret =
          runtime.PLATE_HASH_SECRET ||
          process.env.PLATE_HASH_SECRET ||
          (process.env.NODE_ENV === 'test'
            ? 'motoworks-test-plate-secret-at-least-32chars!'
            : 'motoworks-plate-keyed-hash-secret-2026-secure-32chars');
        plateDigitsHash =
          digits && secret ? await hashPlateDigits(digits, secret) : null;
      }
    }

    // 5. PK 사전 생성
    const orderId = `order:${crypto.randomUUID()}`;
    const paymentId = `pay:${crypto.randomUUID()}`;
    const auditId = `audit:${crypto.randomUUID()}`;
    const itemIds = items.map(() => `item:${crypto.randomUUID()}`);

    // 6. 단일 D1 batch 쿼리 구성
    const batchQueries: D1PreparedStatement[] = [];

    if (shouldInsertCustomer) {
      batchQueries.push(
        runtime.DB.prepare(
          `INSERT INTO customers
             (id, organization_id, shop_id, name, phone_encrypted, status, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)`,
        ).bind(customerId, ORGANIZATION_ID, shopId, customerNameEncrypted, phoneEncrypted, now),
      );
    }

    if (shouldInsertVehicle) {
      batchQueries.push(
        runtime.DB.prepare(
          `INSERT INTO vehicles
             (id, organization_id, shop_id, customer_id, plate_encrypted, plate_hash, plate_digits_hash, model, certainty, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'confirmed', ?9, ?9)`,
        ).bind(
          vehicleId,
          ORGANIZATION_ID,
          shopId,
          customerId,
          plateEncrypted,
          plateHash,
          plateDigitsHash,
          vehicleModel,
          now,
        ),
      );
    }

    batchQueries.push(
      runtime.DB.prepare(
        `INSERT INTO service_orders
           (id, organization_id, shop_id, customer_id, vehicle_id, approved_service_date, shop_certainty, service_type, status, total_amount, approved_by, approved_at, idempotency_key, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'confirmed', ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)`,
      ).bind(
        orderId,
        ORGANIZATION_ID,
        shopId,
        customerId,
        vehicleId,
        serviceDate,
        serviceType,
        status,
        totalAmount,
        approvedBy,
        approvedAt,
        idempotencyKey,
        now,
      ),
    );

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      batchQueries.push(
        runtime.DB.prepare(
          `INSERT INTO service_items
             (id, organization_id, shop_id, service_order_id, normalized_name, quantity, unit_price, amount, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
        ).bind(
          itemIds[i],
          ORGANIZATION_ID,
          shopId,
          orderId,
          it.name,
          it.quantity,
          it.unitPrice,
          it.amount,
          now,
        ),
      );
    }

    const paymentMethod = body.paymentMethod || 'card';
    const paymentAmount = Number(body.paymentAmount) || totalAmount;
    batchQueries.push(
      runtime.DB.prepare(
        `INSERT INTO payments
           (id, organization_id, shop_id, service_order_id, method, amount, paid_at, note, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
      ).bind(
        paymentId,
        ORGANIZATION_ID,
        shopId,
        orderId,
        paymentMethod,
        paymentAmount,
        now,
        body.paymentNote || null,
        now,
      ),
    );

    batchQueries.push(
      runtime.DB.prepare(
        `INSERT INTO audit_logs
           (id, organization_id, shop_id, actor_user_id, action, entity_type, entity_id, after_json, user_agent, created_at)
         VALUES (?1, ?2, ?3, ?4, 'order.manual_created', 'service_order', ?5, ?6, ?7, ?8)`,
      ).bind(
        auditId,
        ORGANIZATION_ID,
        shopId,
        user.id,
        orderId,
        JSON.stringify({
          orderId,
          idempotencyKey,
          status,
          totalAmount,
          itemCount: items.length,
          vehicleId,
          customerId,
        }),
        request.headers.get('user-agent'),
        now,
      ),
    );

    // 7. 멱등성 방어: batch를 먼저 실행하고, UNIQUE 제약 위반 에러를 catch
    try {
      await runtime.DB.batch(batchQueries);
    } catch (err: unknown) {
      const errMsg = String((err as Error)?.message || err);
      if (errMsg.includes('UNIQUE') && errMsg.includes('idempotency_key')) {
        // UNIQUE 제약 위반 발생 시, 해당 키로 기존 주문 조회하여 200 반환
        const existing = await runtime.DB.prepare(
          `SELECT id, status, total_amount, created_at
             FROM service_orders
            WHERE shop_id = ?1 AND idempotency_key = ?2`,
        )
          .bind(shopId, idempotencyKey)
          .first<{
            id: string;
            status: string;
            total_amount: number;
            created_at: number;
          }>();

        if (existing) {
          return Response.json(
            {
              ok: true,
              orderId: existing.id,
              status: existing.status,
              totalAmount: existing.total_amount,
              idempotencyKey,
              duplicate: true,
            },
            { status: 200 },
          );
        }
      }
      throw err;
    }

    return Response.json(
      {
        ok: true,
        orderId,
        status,
        totalAmount,
        idempotencyKey,
        duplicate: false,
      },
      { status: 200 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

