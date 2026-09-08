import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import fs from 'node:fs';
import path from 'node:path';
import { inspectLegacyWorkbook } from '../lib/excel';
import {
  createSessionToken,
  encryptValue,
  ensureBaseSeed,
  ORGANIZATION_ID,
  type MotoworksEnv,
} from '../lib/server/motoworks';

const TEST_ENCRYPTION_KEY = 'motoworks-test-encryption-key-32chars!';
const TEST_SESSION_SECRET = 'motoworks-test-session-secret-at-least-32chars!';
const TEST_PLATE_SECRET = 'motoworks-test-plate-secret-at-least-32chars!';

let mf: Miniflare;
let d1: D1Database;
let mockEnv: MotoworksEnv;

export async function createAuthCookie(userId: string, email: string) {
  const token = await createSessionToken({ userId, email }, TEST_SESSION_SECRET);
  return `motoworks_session=${token}`;
}

interface JsonErrorResponse {
  error: string;
}

interface OrdersResponse {
  orders: Array<{
    id: string;
    shopId: string;
    customerName: string;
    [key: string]: unknown;
  }>;
  total?: number;
  truncated?: boolean;
}

interface DashboardResponse {
  totalOrders: number;
  totalRevenue: number;
  pendingReviewCount: number;
  rentalOutstanding: number;
  shops: unknown[];
}

// Mock cloudflare:workers so app/api routes import our mockEnv
vi.mock('cloudflare:workers', () => ({
  get env() {
    return mockEnv;
  },
}));

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response(null); } }',
    d1Databases: ['DB'],
  });
  d1 = (await mf.getD1Database('DB')) as unknown as D1Database;

  // Run initial schema migrations
  const migrationFiles = [
    '../drizzle/0000_heavy_apocalypse.sql',
    '../drizzle/0001_add_plate_digits_hash.sql',
    '../drizzle/0002_steep_misty_knight.sql',
    '../drizzle/0003_add_idempotency_key.sql',
  ];

  for (const file of migrationFiles) {
    const sqlPath = path.resolve(__dirname, file);
    if (fs.existsSync(sqlPath)) {
      const sql = fs.readFileSync(sqlPath, 'utf8');
      const statements = sql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);

      for (const stmt of statements) {
        await d1.prepare(stmt).run();
      }
    }
  }

  mockEnv = {
    DB: d1,
    FILES: {
      put: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as R2Bucket,
    DATA_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    BOOTSTRAP_OWNER_EMAIL: 'shortsbogo@gmail.com',
    SESSION_SECRET: TEST_SESSION_SECRET,
    PLATE_HASH_SECRET: TEST_PLATE_SECRET,
  };

  // Seed base organizations, shops, roles, and admin user
  await ensureBaseSeed(mockEnv, {
    id: 'user:owner:shortsbogo@gmail.com',
    externalId: 'owner:shortsbogo@gmail.com',
    email: 'shortsbogo@gmail.com',
    displayName: '대표 관리자',
    isOwner: true,
  });
});

afterAll(async () => {
  if (mf) {
    await mf.dispose();
  }
});

describe('API 통합 시나리오 검증 (tests/api_integration.test.ts)', () => {
  // Scenario 1: 비인가 요청 401 / 403 차단
  describe('시나리오 1: 비인가 요청 401 / 403 권한 제어', () => {
    it('헤더가 없거나 로그인 정보가 없는 요청은 401 또는 403으로 차단된다', async () => {
      const { GET: getOrders } = await import('../app/api/orders/route');

      // 미등록 사용자 헤더
      const reqUnauth = new Request('http://localhost:5173/api/orders', {
        headers: {
          'oai-authenticated-user-id': 'unauth_user_1',
          'oai-authenticated-user-email': 'unauth@test.com',
        },
      });

      const res = await getOrders(reqUnauth);
      expect([401, 403]).toContain(res.status);
    });

    it('지점 권한이 없는 직원이 다른 센터에 접근할 때 403 차단된다', async () => {
      const { PATCH: patchReview } = await import('../app/api/reviews/[id]/route');

      // 용전센터 직원 생성
      const staffEmail = 'yongjeon_staff@example.com';
      const staffExtId = 'ext_yj_staff';
      const staffUserId = `user:${staffExtId}`;
      const now = Date.now();

      await d1
        .prepare(
          `INSERT OR REPLACE INTO users (id, organization_id, external_user_id, email, display_name, status, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)`,
        )
        .bind(staffUserId, ORGANIZATION_ID, staffExtId, staffEmail, '용전직원', now)
        .run();

      await d1
        .prepare(
          `INSERT OR REPLACE INTO user_shop_roles (id, organization_id, user_id, shop_id, role, role_id, created_at, updated_at)
           VALUES ('usr_role_yj', ?1, ?2, 'yongjeon', 'staff', 'role:staff', ?3, ?3)`,
        )
        .bind(ORGANIZATION_ID, staffUserId, now)
        .run();

      // 자양센터 문서 생성
      const docId = 'doc_jayang_test';
      const batchId = 'batch_jayang_test';
      await d1
        .prepare(
          `INSERT OR REPLACE INTO document_batches (id, organization_id, shop_id, uploaded_by, status, created_at, updated_at)
           VALUES (?1, ?2, 'jayang', ?3, 'processed', ?4, ?4)`,
        )
        .bind(batchId, ORGANIZATION_ID, staffUserId, now)
        .run();

      await d1
        .prepare(
          `INSERT OR REPLACE INTO documents (id, organization_id, shop_id, batch_id, original_object_key, original_file_name, mime_type, sha256, created_at, updated_at)
           VALUES (?1, ?2, 'jayang', ?3, 'obj_test', 'test.jpg', 'image/jpeg', 'sha_jy_1', ?4, ?4)`,
        )
        .bind(docId, ORGANIZATION_ID, batchId, now)
        .run();

      await d1
        .prepare(
          `INSERT OR REPLACE INTO review_tasks (id, organization_id, shop_id, document_id, status, reason_codes_json, created_at, updated_at)
           VALUES ('rt_jayang_test', ?1, 'jayang', ?2, 'pending', '[]', ?3, ?3)`,
        )
        .bind(ORGANIZATION_ID, docId, now)
        .run();

      // 용전센터 직원이 자양센터 문서를 승인/반려 시도
      const yjCookie = await createAuthCookie(staffUserId, staffEmail);
      const patchReq = new Request(`http://localhost:5173/api/reviews/${docId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: yjCookie,
        },
        body: JSON.stringify({ status: 'approved' }),
      });

      const res = await patchReview(patchReq, {
        params: Promise.resolve({ id: docId }),
      });

      expect(res.status).toBe(403);
      const json = (await res.json()) as JsonErrorResponse;
      expect(json.error).toContain('권한이 없습니다');
    });
  });

  // Scenario 2: 지점 권한 격리 (자양센터 vs 용전센터 교차 접근 차단)
  describe('시나리오 2: 지점 권한 격리 (자양 vs 용전)', () => {
    it('용전센터 직원은 용전센터 정비 주문만 조회되고 자양센터 주문은 포함되지 않는다', async () => {
      const { GET: getOrders } = await import('../app/api/orders/route');
      const now = Date.now();

      // 자양센터 주문과 용전센터 주문 각각 생성
      await d1
        .prepare(
          `INSERT OR REPLACE INTO service_orders (id, organization_id, shop_id, shop_certainty, service_type, status, total_amount, created_at, updated_at)
           VALUES ('ord_yj_1', ?1, 'yongjeon', 'confirmed', 'regular', 'approved', 50000, ?2, ?2),
                  ('ord_jy_1', ?1, 'jayang', 'confirmed', 'regular', 'approved', 80000, ?2, ?2)`,
        )
        .bind(ORGANIZATION_ID, now)
        .run();

      const yjCookie = await createAuthCookie('user:ext_yj_staff', 'yongjeon_staff@example.com');
      const yjStaffReq = new Request('http://localhost:5173/api/orders', {
        headers: {
          Cookie: yjCookie,
        },
      });

      const res = await getOrders(yjStaffReq);
      expect(res.status).toBe(200);
      const data = (await res.json()) as OrdersResponse;
      expect(data.orders).toBeDefined();

      const shopIds = data.orders.map((o) => o.shopId);
      expect(shopIds).toContain('yongjeon');
      expect(shopIds).not.toContain('jayang');
    });
  });

  // Scenario 3: 승인 전 매출 제외 (대기 문서는 Dashboard 매출에 미포함)
  describe('시나리오 3: 승인 전 대기 문서 매출 제외', () => {
    it('대기(pending) 상태의 정비 주문은 Dashboard 매출 합계 및 주문 수에 포함되지 않는다', async () => {
      const { GET: getDashboard } = await import('../app/api/dashboard/route');
      const now = Date.now();

      // 기존 주문 초기화 및 테스트 데이터 삽입
      await d1.prepare(`DELETE FROM service_orders WHERE organization_id = ?1`).bind(ORGANIZATION_ID).run();

      // approved 1건 (100,000원), pending 1건 (200,000원)
      await d1
        .prepare(
          `INSERT INTO service_orders (id, organization_id, shop_id, shop_certainty, service_type, status, total_amount, created_at, updated_at)
           VALUES ('ord_app_1', ?1, 'yongjeon', 'confirmed', 'regular', 'approved', 100000, ?2, ?2),
                  ('ord_pen_1', ?1, 'yongjeon', 'confirmed', 'regular', 'pending', 200000, ?2, ?2)`,
        )
        .bind(ORGANIZATION_ID, now)
        .run();

      const adminCookie = await createAuthCookie('user:owner:shortsbogo@gmail.com', 'shortsbogo@gmail.com');
      const adminReq = new Request('http://localhost:5173/api/dashboard', {
        headers: {
          Cookie: adminCookie,
        },
      });

      const res = await getDashboard(adminReq);
      expect(res.status).toBe(200);
      const data = (await res.json()) as DashboardResponse;

      // 전체 매출은 approved인 100,000원만 집계되어야 함 (pending인 200,000원은 제외)
      expect(data.totalOrders).toBe(1);
      expect(data.totalRevenue).toBe(100000);
    });
  });

  // Scenario 4: 승인 후 데이터 복원 (approved 승인 시 customers, vehicles, orders에 저장 및 복호화 확인)
  describe('시나리오 4: 승인 처리 및 데이터 암호화 저장·복원', () => {
    it('검수 승인 시 고객명이 AES-GCM 256으로 암호화 저장되고 열람 시 복호화된다', async () => {
      const { PATCH: patchReview } = await import('../app/api/reviews/[id]/route');
      const { GET: getOrders } = await import('../app/api/orders/route');
      const now = Date.now();

      const docId = 'doc_approve_flow_1';
      const batchId = 'batch_approve_flow_1';
      const rawCustomerName = '홍길동';
      const rawPlate = '12가 3456';
      const rawPhone = '010-9999-8888';

      // 1. documents, extraction_jobs, review_tasks, extracted_fields 생성
      await d1
        .prepare(
          `INSERT OR REPLACE INTO document_batches (id, organization_id, shop_id, uploaded_by, status, created_at, updated_at)
           VALUES (?1, ?2, 'yongjeon', 'user:owner:shortsbogo@gmail.com', 'processed', ?3, ?3)`,
        )
        .bind(batchId, ORGANIZATION_ID, now)
        .run();

      await d1
        .prepare(
          `INSERT OR REPLACE INTO documents (id, organization_id, shop_id, batch_id, original_object_key, original_file_name, mime_type, sha256, created_at, updated_at)
           VALUES (?1, ?2, 'yongjeon', ?3, 'obj_flow_1', 'flow.jpg', 'image/jpeg', 'sha_flow_1', ?4, ?4)`,
        )
        .bind(docId, ORGANIZATION_ID, batchId, now)
        .run();

      await d1
        .prepare(
          `INSERT OR REPLACE INTO extraction_jobs (id, organization_id, shop_id, document_id, provider, mode, status, created_at, updated_at)
           VALUES ('job_1', ?1, 'yongjeon', ?2, 'gemini', 'auto', 'completed', ?3, ?3)`,
        )
        .bind(ORGANIZATION_ID, docId, now)
        .run();

      await d1
        .prepare(
          `INSERT OR REPLACE INTO review_tasks (id, organization_id, shop_id, document_id, status, reason_codes_json, created_at, updated_at)
           VALUES ('rt_flow_1', ?1, 'yongjeon', ?2, 'pending', '[]', ?3, ?3)`,
        )
        .bind(ORGANIZATION_ID, docId, now)
        .run();

      const encName = await encryptValue(rawCustomerName, TEST_ENCRYPTION_KEY);
      const encPlate = await encryptValue(rawPlate, TEST_ENCRYPTION_KEY);
      const encPhone = await encryptValue(rawPhone, TEST_ENCRYPTION_KEY);

      await d1
        .prepare(
          `INSERT OR REPLACE INTO extracted_fields (id, organization_id, shop_id, document_id, job_id, field_key, raw_value, normalized_value, confidence, bounding_box_json, validation_status, created_at, updated_at)
           VALUES ('fld_1', ?1, 'yongjeon', ?2, 'job_1', 'customer_name', ?3, ?3, 0.95, '{}', 'valid', ?4, ?4),
                  ('fld_2', ?1, 'yongjeon', ?2, 'job_1', 'vehicle_plate', ?5, ?5, 0.95, '{}', 'valid', ?4, ?4),
                  ('fld_3', ?1, 'yongjeon', ?2, 'job_1', 'phone', ?6, ?6, 0.95, '{}', 'valid', ?4, ?4),
                  ('fld_4', ?1, 'yongjeon', ?2, 'job_1', 'amount', '75,000', '75000', 0.99, '{}', 'valid', ?4, ?4),
                  ('fld_5', ?1, 'yongjeon', ?2, 'job_1', 'service_date', '2026-09-06', '2026-09-06', 0.99, '{}', 'valid', ?4, ?4)`,
        )
        .bind(ORGANIZATION_ID, docId, encName, now, encPlate, encPhone)
        .run();

      // 2. 승인 요청 실행 (관리자)
      const adminCookie = await createAuthCookie('user:owner:shortsbogo@gmail.com', 'shortsbogo@gmail.com');
      const approveReq = new Request(`http://localhost:5173/api/reviews/${docId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
        },
        body: JSON.stringify({
          status: 'approved',
          fields: [
            { id: 'fld_1', key: 'customer_name' },
            { id: 'fld_2', key: 'vehicle_plate' },
            { id: 'fld_3', key: 'phone' },
            { id: 'fld_4', key: 'amount' },
            { id: 'fld_5', key: 'service_date' },
          ],
        }),
      });

      const approveRes = await patchReview(approveReq, {
        params: Promise.resolve({ id: docId }),
      });
      expect(approveRes.status).toBe(200);

      // 3. DB에 직접 저장된 고객명이 암호화되어 평문이 아닌지 확인
      const dbCustomer = await d1
        .prepare(`SELECT name, phone_encrypted FROM customers WHERE organization_id = ?1 ORDER BY created_at DESC LIMIT 1`)
        .bind(ORGANIZATION_ID)
        .first<{ name: string; phone_encrypted: string }>();

      expect(dbCustomer).toBeDefined();
      expect(dbCustomer!.name).not.toBe(rawCustomerName);
      expect(dbCustomer!.name.startsWith('v1:')).toBe(true);

      // 4. GET /api/orders 호출 시 관리자는 복호화된 '홍길동'을 수신하는지 확인
      const ordersReq = new Request('http://localhost:5173/api/orders', {
        headers: {
          Cookie: adminCookie,
        },
      });

      const ordersRes = await getOrders(ordersReq);
      expect(ordersRes.status).toBe(200);
      const ordersData = (await ordersRes.json()) as OrdersResponse;
      const approvedOrder = ordersData.orders.find((o) => o.customerName === rawCustomerName);
      expect(approvedOrder).toBeDefined();
      expect(approvedOrder!.customerName).toBe('홍길동');

      // 5. [신규 왕복 검증] 등록된 차량의 plate_digits_hash 확인 및 lookup-plate 호출 시 single_match 확인
      const dbVehicle = await d1
        .prepare(`SELECT plate_digits_hash FROM vehicles WHERE organization_id = ?1 ORDER BY created_at DESC LIMIT 1`)
        .bind(ORGANIZATION_ID)
        .first<{ plate_digits_hash: string | null }>();

      expect(dbVehicle).toBeDefined();
      expect(dbVehicle!.plate_digits_hash).not.toBeNull();
      expect(typeof dbVehicle!.plate_digits_hash).toBe('string');

      const { POST: postLookupPlate } = await import('../app/api/vehicles/lookup-plate/route');
      const lookupReq = new Request('http://localhost:5173/api/vehicles/lookup-plate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
        },
        body: JSON.stringify({ plateText: rawPlate }),
      });

      const lookupRes = await postLookupPlate(lookupReq);
      const lookupData = (await lookupRes.json()) as any;

      expect(lookupData.status).toBe('single_match');
      expect(lookupData.matchType).toBe('exact_4');
      expect(lookupData.candidate).toBeDefined();
      expect(lookupData.candidate.fullPlate).toBe('12가 3456');
      expect(lookupData.candidate.customerName).toBe('홍길동');
      expect(lookupData.plateDigits).toBe('3456');
    });
  });

  // Scenario 5: 동일 문서 중복 승인 시 409 Conflict 처리
  describe('시나리오 5: 중복 승인 방지 (409 Conflict)', () => {
    it('이미 승인 완료된 문서를 다시 승인 요청하면 409 Conflict를 반환한다', async () => {
      const { PATCH: patchReview } = await import('../app/api/reviews/[id]/route');
      const docId = 'doc_approve_flow_1';

      const adminCookie = await createAuthCookie('user:owner:shortsbogo@gmail.com', 'shortsbogo@gmail.com');
      const duplicateReq = new Request(`http://localhost:5173/api/reviews/${docId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
        },
        body: JSON.stringify({ status: 'approved' }),
      });

      const res = await patchReview(duplicateReq, {
        params: Promise.resolve({ id: docId }),
      });

      expect(res.status).toBe(409);
      const json = (await res.json()) as JsonErrorResponse;
      expect(json.error).toContain('이미 처리된 검수 문서');
    });
  });

  // Scenario 6: Gemini API 키 및 DATA_ENCRYPTION_KEY 누락 시 Fail-Fast
  describe('시나리오 6: 필수 환경변수 누락 시 Fail-Fast (503)', () => {
    it('DATA_ENCRYPTION_KEY가 누락되었을 때 PATCH /api/reviews/[id]는 503을 반환한다', async () => {
      const { PATCH: patchReview } = await import('../app/api/reviews/[id]/route');

      // 임시로 키 제거
      const originalKey = mockEnv.DATA_ENCRYPTION_KEY;
      mockEnv.DATA_ENCRYPTION_KEY = undefined;

      const adminCookie = await createAuthCookie('user:owner:shortsbogo@gmail.com', 'shortsbogo@gmail.com');
      const req = new Request(`http://localhost:5173/api/reviews/any_id`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: adminCookie,
        },
        body: JSON.stringify({ status: 'approved' }),
      });

      const res = await patchReview(req, {
        params: Promise.resolve({ id: 'any_id' }),
      });

      expect(res.status).toBe(503);
      const json = (await res.json()) as JsonErrorResponse;
      expect(json.error).toContain('DATA_ENCRYPTION_KEY가 설정되지 않아');

      // 복구
      mockEnv.DATA_ENCRYPTION_KEY = originalKey;
    });

    it('GEMINI_API_KEY가 누락되었을 때 POST /api/extractions는 503을 반환한다', async () => {
      const { POST: postExtractions } = await import('../app/api/extractions/route');

      // mockEnv.GEMINI_API_KEY 미설정 상태
      const formData = new FormData();
      formData.append('shopId', 'yongjeon');

      const adminCookie = await createAuthCookie('user:owner:shortsbogo@gmail.com', 'shortsbogo@gmail.com');
      const req = new Request('http://localhost:5173/api/extractions', {
        method: 'POST',
        headers: {
          Cookie: adminCookie,
        },
        body: formData,
      });

      const res = await postExtractions(req);
      expect(res.status).toBe(503);
      const json = (await res.json()) as JsonErrorResponse;
      expect(json.error).toContain('Gemini API 키가 아직 연결되지 않았습니다');
    });
  });

  // Scenario 7: Excel 5개 시트 생성 및 합계 일치 검증
  describe('시나리오 7: Excel 5개 시트 생성 및 합계 일치 검증', () => {
    it('/api/excel 엔드포인트가 5개 시트 엑셀을 생성하고 승인된 매출 합계와 일치한다', async () => {
      const { GET: getExcel } = await import('../app/api/excel/route');

      const adminCookie = await createAuthCookie('user:owner:shortsbogo@gmail.com', 'shortsbogo@gmail.com');
      const req = new Request('http://localhost:5173/api/excel', {
        headers: {
          Cookie: adminCookie,
        },
      });

      const res = await getExcel(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('spreadsheetml');

      const arrayBuffer = await res.arrayBuffer();
      expect(arrayBuffer.byteLength).toBeGreaterThan(0);

      const inspection = inspectLegacyWorkbook(arrayBuffer);
      expect(inspection.missingSheets).toHaveLength(0);
      expect(inspection.sheetNames).toEqual([
        '정비내역',
        '정비항목',
        '고객목록',
        '렌트리스',
        '기준정보',
      ]);

      // DB에 승인된 매출 합계와 엑셀의 revenue가 일치하는지 확인
      const dbSum = await d1
        .prepare(`SELECT COALESCE(SUM(total_amount), 0) as total FROM service_orders WHERE organization_id = ?1 AND status = 'approved'`)
        .bind(ORGANIZATION_ID)
        .first<{ total: number }>();

      expect(inspection.revenue).toBe(dbSum!.total);
    });
  });

  // Scenario 8: orders LIMIT 200 잘림 감지 (total 및 truncated)
  describe('시나리오 8: orders LIMIT 200 잘림 감지 (total 및 truncated)', () => {
    const clearAllOrders = async () => {
      await d1.prepare(`DELETE FROM payments WHERE service_order_id IN (SELECT id FROM service_orders WHERE organization_id = ?1)`).bind(ORGANIZATION_ID).run();
      await d1.prepare(`DELETE FROM service_items WHERE service_order_id IN (SELECT id FROM service_orders WHERE organization_id = ?1)`).bind(ORGANIZATION_ID).run();
      await d1.prepare(`DELETE FROM service_orders WHERE organization_id = ?1`).bind(ORGANIZATION_ID).run();
    };

    it('201건 이상을 넣고 GET /api/orders 호출 시 total이 실제 건수(205)와 일치하고 truncated: true가 반환된다', async () => {
      const { GET: getOrders } = await import('../app/api/orders/route');
      const now = Date.now();

      // 기존 주문 초기화
      await clearAllOrders();

      // 205건 대량 삽입 (LIMIT 200 초과)
      const stmts = [];
      for (let i = 1; i <= 205; i++) {
        stmts.push(
          d1.prepare(
            `INSERT INTO service_orders (id, organization_id, shop_id, shop_certainty, service_type, status, total_amount, created_at, updated_at)
             VALUES (?, ?, 'yongjeon', 'confirmed', 'regular', 'approved', 10000, ?, ?)`,
          ).bind(`ord_bulk_${i}`, ORGANIZATION_ID, now + i, now + i),
        );
      }
      await d1.batch(stmts);

      const adminCookie = await createAuthCookie('user:owner:shortsbogo@gmail.com', 'shortsbogo@gmail.com');
      const req = new Request('http://localhost:5173/api/orders', {
        headers: { Cookie: adminCookie },
      });

      const res = await getOrders(req);
      expect(res.status).toBe(200);
      const data = (await res.json()) as OrdersResponse;

      expect(data.orders).toHaveLength(200);
      expect(data.total).toBe(205);
      expect(data.truncated).toBe(true);
    });

    it('200건 이하(150건)일 때 total이 150이고 truncated: false가 반환된다', async () => {
      const { GET: getOrders } = await import('../app/api/orders/route');
      const now = Date.now();

      // 기존 주문 초기화
      await clearAllOrders();

      // 150건 삽입 (LIMIT 200 이하)
      const stmts = [];
      for (let i = 1; i <= 150; i++) {
        stmts.push(
          d1.prepare(
            `INSERT INTO service_orders (id, organization_id, shop_id, shop_certainty, service_type, status, total_amount, created_at, updated_at)
             VALUES (?, ?, 'yongjeon', 'confirmed', 'regular', 'approved', 10000, ?, ?)`,
          ).bind(`ord_sub200_${i}`, ORGANIZATION_ID, now + i, now + i),
        );
      }
      await d1.batch(stmts);

      const adminCookie = await createAuthCookie('user:owner:shortsbogo@gmail.com', 'shortsbogo@gmail.com');
      const req = new Request('http://localhost:5173/api/orders', {
        headers: { Cookie: adminCookie },
      });

      const res = await getOrders(req);
      expect(res.status).toBe(200);
      const data = (await res.json()) as OrdersResponse;

      expect(data.orders).toHaveLength(150);
      expect(data.total).toBe(150);
      expect(data.truncated).toBe(false);
    });

    it('지점 권한이 다른 사용자의 total이 자기 지점 건수만 센다 (타 지점 건수 누출 방지)', async () => {
      const { GET: getOrders } = await import('../app/api/orders/route');
      const now = Date.now();

      // 기존 주문 초기화
      await clearAllOrders();

      // 용전센터 10건, 자양센터 5건 생성
      const stmts = [];
      for (let i = 1; i <= 10; i++) {
        stmts.push(
          d1.prepare(
            `INSERT INTO service_orders (id, organization_id, shop_id, shop_certainty, service_type, status, total_amount, created_at, updated_at)
             VALUES (?, ?, 'yongjeon', 'confirmed', 'regular', 'approved', 10000, ?, ?)`,
          ).bind(`ord_scope_yj_${i}`, ORGANIZATION_ID, now + i, now + i),
        );
      }
      for (let i = 1; i <= 5; i++) {
        stmts.push(
          d1.prepare(
            `INSERT INTO service_orders (id, organization_id, shop_id, shop_certainty, service_type, status, total_amount, created_at, updated_at)
             VALUES (?, ?, 'jayang', 'confirmed', 'regular', 'approved', 20000, ?, ?)`,
          ).bind(`ord_scope_jy_${i}`, ORGANIZATION_ID, now + i, now + i),
        );
      }
      await d1.batch(stmts);

      // 용전센터 직원 쿠키로 조회
      const yjCookie = await createAuthCookie('user:ext_yj_staff', 'yongjeon_staff@example.com');
      const yjReq = new Request('http://localhost:5173/api/orders', {
        headers: { Cookie: yjCookie },
      });

      const yjRes = await getOrders(yjReq);
      expect(yjRes.status).toBe(200);
      const yjData = (await yjRes.json()) as OrdersResponse;

      // 전체 15건 중 자기 지점(용전 10건)만 total로 계산되어야 함
      expect(yjData.total).toBe(10);
      expect(yjData.orders).toHaveLength(10);
      expect(yjData.truncated).toBe(false);
      expect(yjData.orders.every((o) => o.shopId === 'yongjeon')).toBe(true);
    });
  });
});
