import { env } from 'cloudflare:workers';
import {
  decryptValue,
  encryptValue,
  errorResponse,
  hashPii,
  ORGANIZATION_ID,
  requirePermission,
  SENSITIVE_FIELDS,
  type MotoworksEnv,
} from '@/lib/server/motoworks';
import { normalizePhone } from '@/lib/domain';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const runtime = env as unknown as MotoworksEnv;
  try {
    const { id } = await context.params;
    const document = await runtime.DB.prepare(
      `SELECT d.shop_id, rt.id AS review_id, rt.status
         FROM documents d
         JOIN review_tasks rt ON rt.document_id = d.id
        WHERE d.id = ?1
        LIMIT 1`,
    )
      .bind(id)
      .first<{ shop_id: string; review_id: string; status: string }>();

    if (!document) {
      return Response.json({ error: '검수 문서를 찾지 못했습니다.' }, { status: 404 });
    }
    if (document.status !== 'pending' && document.status !== 'in_review') {
      return Response.json({ error: '이미 처리된 검수 문서입니다.' }, { status: 409 });
    }

    // 센터별 승인·반려 권한 확인
    const user = await requirePermission(
      request,
      runtime,
      'review_decide',
      document.shop_id,
    );

    const body = (await request.json()) as {
      status?: 'approved' | 'rejected';
      fields?: Array<{ id: string; key: string; correctedValue?: string }>;
      note?: string;
    };

    if (!body.status || !['approved', 'rejected'].includes(body.status)) {
      return Response.json({ error: '승인 또는 반려 상태가 필요합니다.' }, { status: 400 });
    }

    // 서버에 존재하는 실제 extracted_fields 조회 및 대조
    const existingFields = await runtime.DB.prepare(
      `SELECT id, field_key, raw_value, normalized_value, confidence, validation_status
         FROM extracted_fields
        WHERE document_id = ?1`,
    )
      .bind(id)
      .all<{
        id: string;
        field_key: string;
        raw_value: string | null;
        normalized_value: string | null;
        confidence: number;
        validation_status: string;
      }>();

    const existingFieldMap = new Map(
      existingFields.results.map((f) => [f.id, f]),
    );

    // 클라이언트가 전달한 필드가 서버 데이터에 존재하는지 검증
    for (const submitted of body.fields ?? []) {
      if (!existingFieldMap.has(submitted.id)) {
        return Response.json(
          { error: `유효하지 않은 필드 식별자입니다: ${submitted.id}` },
          { status: 400 },
        );
      }
    }

    const now = Date.now();
    const batchQueries = [];
    const submittedMap = new Map(
      (body.fields ?? []).map((f) => [f.id, f.correctedValue ?? '']),
    );

    // 1. 필드 수정값 및 correction_logs 준비
    for (const field of existingFields.results) {
      const corrected = submittedMap.get(field.id);
      if (corrected !== undefined) {
        let valueToStore: string | null = corrected;
        if (SENSITIVE_FIELDS.has(field.field_key)) {
          if (runtime.DATA_ENCRYPTION_KEY) {
            valueToStore = await encryptValue(
              corrected,
              runtime.DATA_ENCRYPTION_KEY,
            );
          } else {
            valueToStore = null;
          }
        }

        batchQueries.push(
          runtime.DB.prepare(
            `UPDATE extracted_fields
                SET corrected_value = ?2, corrected_by = ?3, corrected_at = ?4,
                    validation_status = 'valid', updated_at = ?4
              WHERE id = ?1 AND document_id = ?5`,
          ).bind(field.id, valueToStore, user.id, now, id),
        );

        // 수정 이력 기록
        batchQueries.push(
          runtime.DB.prepare(
            `INSERT INTO correction_logs
               (id, organization_id, shop_id, document_id, field_key, raw_value, suggested_value, final_value, corrected_by, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
          ).bind(
            `corr:${crypto.randomUUID()}`,
            ORGANIZATION_ID,
            document.shop_id,
            id,
            field.field_key,
            field.raw_value,
            field.normalized_value,
            corrected,
            user.id,
            now,
          ),
        );
      }
    }

    // 2. 검수 작업 상태 업데이트 (동시 승인 방지를 위해 status IN ('pending', 'in_review') 조건)
    batchQueries.push(
      runtime.DB.prepare(
        `UPDATE review_tasks
            SET status = ?2, decided_by = ?3, decided_at = ?4,
                decision_note = ?5, updated_at = ?4
          WHERE id = ?1 AND status IN ('pending', 'in_review')`,
      ).bind(
        document.review_id,
        body.status,
        user.id,
        now,
        body.note?.slice(0, 500) ?? null,
      ),
    );

    let createdOrderId: string | null = null;

    // 3. 승인('approved')일 경우 실제 정비·결제·매출·고객·차량 레코드 생성
    if (body.status === 'approved') {
      // 각 필드의 최종 평문값 계산
      const finalValues: Record<string, string> = {};
      for (const f of existingFields.results) {
        if (submittedMap.has(f.id)) {
          finalValues[f.field_key] = submittedMap.get(f.id)!;
        } else if (f.normalized_value) {
          if (
            SENSITIVE_FIELDS.has(f.field_key) &&
            f.normalized_value.startsWith('v1:') &&
            runtime.DATA_ENCRYPTION_KEY
          ) {
            finalValues[f.field_key] = await decryptValue(
              f.normalized_value,
              runtime.DATA_ENCRYPTION_KEY,
            );
          } else {
            finalValues[f.field_key] = f.normalized_value;
          }
        } else {
          finalValues[f.field_key] = '';
        }
      }

      // 날짜
      let serviceDate = finalValues.service_date?.trim();
      if (!serviceDate || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
        serviceDate = new Date(now).toISOString().slice(0, 10);
      }

      // 고객 식별 또는 생성
      const rawCustomerName = finalValues.customer_name?.trim() || '고객 미확인';
      const rawPhone = finalValues.phone ? normalizePhone(finalValues.phone) : '';
      let customerId: string;

      if (rawPhone) {
        const phoneHash = await hashPii(rawPhone);
        const existingCustomer = await runtime.DB.prepare(
          `SELECT id FROM customers WHERE organization_id = ?1 AND phone_hash = ?2 LIMIT 1`,
        )
          .bind(ORGANIZATION_ID, phoneHash)
          .first<{ id: string }>();

        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          customerId = `cust:${crypto.randomUUID()}`;
          const phoneEncrypted = runtime.DATA_ENCRYPTION_KEY
            ? await encryptValue(rawPhone, runtime.DATA_ENCRYPTION_KEY)
            : null;
          batchQueries.push(
            runtime.DB.prepare(
              `INSERT INTO customers
                 (id, organization_id, shop_id, name, phone_encrypted, phone_hash, status, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?7)`,
            ).bind(
              customerId,
              ORGANIZATION_ID,
              document.shop_id,
              rawCustomerName,
              phoneEncrypted,
              phoneHash,
              now,
            ),
          );
        }
      } else {
        customerId = `cust:${crypto.randomUUID()}`;
        batchQueries.push(
          runtime.DB.prepare(
            `INSERT INTO customers
               (id, organization_id, shop_id, name, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)`,
          ).bind(customerId, ORGANIZATION_ID, document.shop_id, rawCustomerName, now),
        );
      }

      // 차량 식별 또는 생성
      const rawPlate = finalValues.vehicle_plate?.trim() || '';
      const vehicleModel = finalValues.vehicle_model?.trim() || '차종 미확인';
      let vehicleId: string;

      if (rawPlate) {
        const plateHash = await hashPii(rawPlate);
        const existingVehicle = await runtime.DB.prepare(
          `SELECT id FROM vehicles WHERE organization_id = ?1 AND plate_hash = ?2 LIMIT 1`,
        )
          .bind(ORGANIZATION_ID, plateHash)
          .first<{ id: string }>();

        if (existingVehicle) {
          vehicleId = existingVehicle.id;
        } else {
          vehicleId = `veh:${crypto.randomUUID()}`;
          const plateEncrypted = runtime.DATA_ENCRYPTION_KEY
            ? await encryptValue(rawPlate, runtime.DATA_ENCRYPTION_KEY)
            : null;
          batchQueries.push(
            runtime.DB.prepare(
              `INSERT INTO vehicles
                 (id, organization_id, shop_id, customer_id, plate_encrypted, plate_hash, model, certainty, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'confirmed', ?8, ?8)`,
            ).bind(
              vehicleId,
              ORGANIZATION_ID,
              document.shop_id,
              customerId,
              plateEncrypted,
              plateHash,
              vehicleModel,
              now,
            ),
          );
        }
      } else {
        vehicleId = `veh:${crypto.randomUUID()}`;
        batchQueries.push(
          runtime.DB.prepare(
            `INSERT INTO vehicles
               (id, organization_id, shop_id, customer_id, model, certainty, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'ai_estimated', ?6, ?6)`,
          ).bind(vehicleId, ORGANIZATION_ID, document.shop_id, customerId, vehicleModel, now),
        );
      }

      // 정비 구분 및 금액
      const isRental =
        finalValues.service_type === '렌트' ||
        finalValues.service_type === 'rental' ||
        finalValues.service_type === 'lease' ||
        finalValues.service_type === '리스';
      const serviceType = isRental ? 'rental' : 'personal';

      const totalAmount =
        Number(String(finalValues.amount || '0').replace(/[^0-9-]/g, '')) || 0;

      // 정비 주문 (service_orders) 생성
      createdOrderId = `so:${crypto.randomUUID()}`;
      batchQueries.push(
        runtime.DB.prepare(
          `INSERT INTO service_orders
             (id, organization_id, shop_id, document_id, customer_id, vehicle_id, approved_service_date, shop_certainty, service_type, status, total_amount, approved_by, approved_at, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'confirmed', ?8, 'approved', ?9, ?10, ?11, ?11, ?11)`,
        ).bind(
          createdOrderId,
          ORGANIZATION_ID,
          document.shop_id,
          id,
          customerId,
          vehicleId,
          serviceDate,
          serviceType,
          totalAmount,
          user.id,
          now,
        ),
      );

      // 작업 항목 (service_items) 생성
      const itemName = finalValues.service_item?.trim() || '정비 작업';
      batchQueries.push(
        runtime.DB.prepare(
          `INSERT INTO service_items
             (id, organization_id, shop_id, service_order_id, raw_name, normalized_name, quantity, unit_price, amount, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7, ?8, ?8)`,
        ).bind(
          `item:${crypto.randomUUID()}`,
          ORGANIZATION_ID,
          document.shop_id,
          createdOrderId,
          itemName,
          itemName,
          totalAmount,
          now,
        ),
      );

      // 결제 내역 (payments) 생성
      let payMethod: 'card' | 'cash' | 'transfer' | 'rental_billing' | 'other' =
        'card';
      const rawMethod = finalValues.payment_method?.trim() || '';
      if (rawMethod.includes('현금')) payMethod = 'cash';
      else if (rawMethod.includes('이체') || rawMethod.includes('계좌'))
        payMethod = 'transfer';
      else if (isRental || rawMethod.includes('청구'))
        payMethod = 'rental_billing';

      batchQueries.push(
        runtime.DB.prepare(
          `INSERT INTO payments
             (id, organization_id, shop_id, service_order_id, method, amount, paid_at, note, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
        ).bind(
          `pay:${crypto.randomUUID()}`,
          ORGANIZATION_ID,
          document.shop_id,
          createdOrderId,
          payMethod,
          totalAmount,
          now,
          rawMethod,
          now,
        ),
      );

      // 렌트/리스 정비인 경우 정산 정보 (receivables) 생성
      if (isRental) {
        batchQueries.push(
          runtime.DB.prepare(
            `INSERT INTO receivables
               (id, organization_id, shop_id, service_order_id, base_price, customer_paid_amount, billed_amount, received_amount, outstanding_amount, settlement_status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?5, 0, ?5, 'unbilled', ?6, ?6)`,
          ).bind(
            `rec:${crypto.randomUUID()}`,
            ORGANIZATION_ID,
            document.shop_id,
            createdOrderId,
            totalAmount,
            now,
          ),
        );
      }

      // 감사 로그 생성
      batchQueries.push(
        runtime.DB.prepare(
          `INSERT INTO audit_logs
             (id, organization_id, shop_id, actor_user_id, action, entity_type, entity_id, after_json, user_agent, created_at)
           VALUES (?1, ?2, ?3, ?4, 'review.approved', 'service_order', ?5, ?6, ?7, ?8)`,
        ).bind(
          `audit:${crypto.randomUUID()}`,
          ORGANIZATION_ID,
          document.shop_id,
          user.id,
          createdOrderId,
          JSON.stringify({
            documentId: id,
            orderId: createdOrderId,
            amount: totalAmount,
            serviceDate,
            customerName: rawCustomerName,
          }),
          request.headers.get('user-agent'),
          now,
        ),
      );
    } else {
      // 반려('rejected')인 경우 감사 로그
      batchQueries.push(
        runtime.DB.prepare(
          `INSERT INTO audit_logs
             (id, organization_id, shop_id, actor_user_id, action, entity_type, entity_id, after_json, user_agent, created_at)
           VALUES (?1, ?2, ?3, ?4, 'review.rejected', 'review_task', ?5, ?6, ?7, ?8)`,
        ).bind(
          `audit:${crypto.randomUUID()}`,
          ORGANIZATION_ID,
          document.shop_id,
          user.id,
          document.review_id,
          JSON.stringify({ documentId: id, note: body.note }),
          request.headers.get('user-agent'),
          now,
        ),
      );
    }

    // 원자적 트랜잭션 실행
    await runtime.DB.batch(batchQueries);

    return Response.json({
      ok: true,
      status: body.status,
      orderId: createdOrderId,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

