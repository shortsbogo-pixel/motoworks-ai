import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import fs from 'node:fs';
import path from 'node:path';
import {
  createSessionToken,
  encryptValue,
  ensureBaseSeed,
  hashPii,
  hashPlateDigits,
  ORGANIZATION_ID,
  type MotoworksEnv,
} from '../lib/server/motoworks';

const TEST_ENCRYPTION_KEY = 'motoworks-test-encryption-key-32chars!';
const TEST_SESSION_SECRET = 'motoworks-test-session-secret-at-least-32chars!';
const TEST_PLATE_SECRET = 'motoworks-test-plate-secret-at-least-32chars!';

let mf: Miniflare;
let d1: D1Database;
let mockEnv: MotoworksEnv;

async function createAuthCookie(userId: string, email: string) {
  const token = await createSessionToken({ userId, email }, TEST_SESSION_SECRET);
  return `motoworks_session=${token}`;
}

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

  await ensureBaseSeed(mockEnv, {
    id: 'user:owner:shortsbogo@gmail.com',
    externalId: 'owner:shortsbogo@gmail.com',
    email: 'shortsbogo@gmail.com',
    displayName: '대표 관리자',
    isOwner: true,
  });
});

afterAll(async () => {
  if (mf) await mf.dispose();
});

describe('수기 현장 접수 (Manual Order Intake) 핵심 4대 안전장치 검증', () => {
  // 1. 멱등성 및 동시성 방어 (Promise.all 더블탭 방어)
  describe('① 멱등성 (Idempotency) 및 동시성 충돌 방어', () => {
    it('동일한 idempotencyKey로 Promise.all 동시 요청 시 1건만 생성되고 두 요청 모두 동일한 200 OK와 orderId를 반환한다', async () => {
      const { POST: postOrder } = await import('../app/api/orders/route');
      const adminCookie = await createAuthCookie('user:owner:shortsbogo@gmail.com', 'shortsbogo@gmail.com');

      const sharedKey = `idem-${crypto.randomUUID()}`;
      const payload = {
        idempotencyKey: sharedKey,
        shopId: 'yongjeon',
        serviceDate: '2026-09-08',
        serviceType: 'personal',
        plateText: '서울 강남 가 8888',
        vehicleModel: '혼다 PCX 125',
        customerName: '홍길동',
        phone: '010-1234-5678',
        items: [
          { name: '엔진오일 교환', quantity: 1, unitPrice: 35000, amount: 35000 },
          { name: '공임', quantity: 1, unitPrice: 15000, amount: 15000 },
        ],
        paymentMethod: 'card',
        paymentAmount: 50000,
      };

      const req1 = new Request('http://localhost:5173/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify(payload),
      });

      const req2 = new Request('http://localhost:5173/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify(payload),
      });

      // 동시 전송 (더블탭 상황 시뮬레이션)
      const [res1, res2] = await Promise.all([postOrder(req1), postOrder(req2)]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      const data1 = (await res1.json()) as any;
      const data2 = (await res2.json()) as any;

      expect(data1.ok).toBe(true);
      expect(data2.ok).toBe(true);
      expect(data1.orderId).toBe(data2.orderId);
      expect(data1.idempotencyKey).toBe(sharedKey);

      // DB 상에 정확히 1건의 service_orders만 생성되었는지 검증
      const countRes = await d1
        .prepare('SELECT COUNT(*) AS cnt FROM service_orders WHERE idempotency_key = ?1')
        .bind(sharedKey)
        .first<{ cnt: number }>();
      expect(countRes?.cnt).toBe(1);

      // 순차적 재시도(네트워크 타임아웃 후 재전송)에서도 동일한 200 OK 및 duplicate: true 반환 확인
      const req3 = new Request('http://localhost:5173/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify(payload),
      });
      const res3 = await postOrder(req3);
      expect(res3.status).toBe(200);
      const data3 = (await res3.json()) as any;
      expect(data3.orderId).toBe(data1.orderId);
      expect(data3.duplicate).toBe(true);
    });
  });

  // 2. D1 Batch 트랜잭션 원자성 (중간 실패 시 전체 롤백)
  describe('② D1 트랜잭션 원자성 (Rollback on Batch Failure)', () => {
    it('service_items 등 배치 쿼리 중 하나가 제약 위반으로 실패하면 orders, payments, vehicles 전체가 롤백된다', async () => {
      const testOrderId = `order:atomic-test-${crypto.randomUUID()}`;
      const testVehId = `veh:atomic-test-${crypto.randomUUID()}`;
      const testPayId = `pay:atomic-test-${crypto.randomUUID()}`;
      const testCustId = `cust:atomic-test-${crypto.randomUUID()}`;
      const now = Date.now();

      const batchStatements = [
        // 1. 신규 고객 등록
        d1.prepare(
          `INSERT INTO customers (id, organization_id, shop_id, name, status, created_at, updated_at)
           VALUES (?1, ?2, 'yongjeon', '롤백테스트고객', 'active', ?3, ?3)`,
        ).bind(testCustId, ORGANIZATION_ID, now),

        // 2. 신규 차량 등록
        d1.prepare(
          `INSERT INTO vehicles (id, organization_id, shop_id, customer_id, plate_encrypted, plate_hash, model, certainty, created_at, updated_at)
           VALUES (?1, ?2, 'yongjeon', ?3, 'enc', 'hash', '테스트바이크', 'confirmed', ?4, ?4)`,
        ).bind(testVehId, ORGANIZATION_ID, testCustId, now),

        // 3. 신규 주문 등록
        d1.prepare(
          `INSERT INTO service_orders (id, organization_id, shop_id, customer_id, vehicle_id, approved_service_date, shop_certainty, service_type, status, total_amount, created_at, updated_at)
           VALUES (?1, ?2, 'yongjeon', ?3, ?4, '2026-09-08', 'confirmed', 'personal', 'review', 50000, ?5, ?5)`,
        ).bind(testOrderId, ORGANIZATION_ID, testCustId, testVehId, now),

        // 4. 결제 등록
        d1.prepare(
          `INSERT INTO payments (id, organization_id, shop_id, service_order_id, method, amount, created_at, updated_at)
           VALUES (?1, ?2, 'yongjeon', ?3, 'card', 50000, ?4, ?4)`,
        ).bind(testPayId, ORGANIZATION_ID, testOrderId, now),

        // 5. 의도적으로 실패하는 service_items (존재하지 않는 shop_id로 FOREIGN KEY 제약 위반 유발)
        d1.prepare(
          `INSERT INTO service_items (id, organization_id, shop_id, service_order_id, normalized_name, quantity, unit_price, amount, created_at, updated_at)
           VALUES (?1, ?2, 'non_existent_shop_triggering_foreign_key_violation', ?3, '오일', 1, 50000, 50000, ?4, ?4)`,
        ).bind(`item:${crypto.randomUUID()}`, ORGANIZATION_ID, testOrderId, now),
      ];

      // 배치 실행 시 5번째 문장의 FK 제약 위반으로 전체 에러 발생 확인
      await expect(d1.batch(batchStatements)).rejects.toThrow();

      // D1 DB 검증: 앞선 4개 문장(customers, vehicles, service_orders, payments)이 하나도 남지 않고 완전 롤백되었는지 확인!
      const custRow = await d1.prepare('SELECT id FROM customers WHERE id = ?1').bind(testCustId).first();
      expect(custRow).toBeNull();

      const vehRow = await d1.prepare('SELECT id FROM vehicles WHERE id = ?1').bind(testVehId).first();
      expect(vehRow).toBeNull();

      const orderRow = await d1.prepare('SELECT id FROM service_orders WHERE id = ?1').bind(testOrderId).first();
      expect(orderRow).toBeNull();

      const payRow = await d1.prepare('SELECT id FROM payments WHERE id = ?1').bind(testPayId).first();
      expect(payRow).toBeNull();
    });
  });

  // 3. 번호판 후보 매칭 및 지점(Shop) 격리 스코핑
  describe('③ 번호판 후보 매칭 및 멀티 테넌트 지점 격리', () => {
    it('숫자 4자리가 같고 한글이 다른 번호판 조회 시 candidates에 해당 차량이 포함된다', async () => {
      const { POST: postLookupPlate } = await import('../app/api/vehicles/lookup-plate/route');
      const adminCookie = await createAuthCookie('user:owner:shortsbogo@gmail.com', 'shortsbogo@gmail.com');

      // 차량 1: yongjeon에 "서울 강남 가 7777" 등록
      const rawPlate = '서울 강남 가 7777';
      const plateHash = await hashPii(rawPlate);
      const digitsHash = await hashPlateDigits('7777', TEST_PLATE_SECRET);
      const plateEncrypted = await encryptValue(rawPlate, TEST_ENCRYPTION_KEY);
      const nameEncrypted = await encryptValue('강남차주', TEST_ENCRYPTION_KEY);

      const custId = `cust:${crypto.randomUUID()}`;
      await d1.prepare(
        `INSERT INTO customers (id, organization_id, shop_id, name, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)`,
      ).bind(custId, ORGANIZATION_ID, 'yongjeon', nameEncrypted, Date.now()).run();

      const vehId = `veh:${crypto.randomUUID()}`;
      await d1.prepare(
        `INSERT INTO vehicles (id, organization_id, shop_id, customer_id, plate_encrypted, plate_hash, plate_digits_hash, model, certainty, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, '혼다 슈퍼커브', 'confirmed', ?8, ?8)`,
      ).bind(vehId, ORGANIZATION_ID, 'yongjeon', custId, plateEncrypted, plateHash, digitsHash, Date.now()).run();

      // 조회: 숫자 4자리는 같으나 한글이 오인식된 "경기 성남 나 7777"로 검색
      const lookupReq = new Request('http://localhost:5173/api/vehicles/lookup-plate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ plateText: '경기 성남 나 7777' }),
      });

      const lookupRes = await postLookupPlate(lookupReq);
      expect(lookupRes.status).toBe(200);
      const data = (await lookupRes.json()) as any;

      // exact는 일치하지 않아야 함
      expect(data.exact).toBeNull();
      // candidates에 4자리(7777) 일치 차량이 포함되어 있어야 함
      expect(data.candidates).toBeDefined();
      expect(data.candidates.length).toBeGreaterThanOrEqual(1);

      const matchedCand = data.candidates.find((c: any) => c.vehicleId === vehId);
      expect(matchedCand).toBeDefined();
      expect(matchedCand.model).toBe('혼다 슈퍼커브');
      expect(matchedCand.customerName).toBe('강남차주');
      expect(matchedCand.fullPlate).toBe('서울 강남 가 7777');
    });

    it('타 지점(jayang)의 동일 숫자 4자리 차량은 조회 지점 권한 외에는 candidates에 유출되지 않는다', async () => {
      const { POST: postLookupPlate } = await import('../app/api/vehicles/lookup-plate/route');

      // jayang 지점에만 소속된 차량 생성
      const jayangPlate = '서울 자양 마 7777';
      const jayangPlateHash = await hashPii(jayangPlate);
      const jayangDigitsHash = await hashPlateDigits('7777', TEST_PLATE_SECRET);
      const jayangPlateEncrypted = await encryptValue(jayangPlate, TEST_ENCRYPTION_KEY);

      const jayangVehId = `veh:${crypto.randomUUID()}`;
      await d1.prepare(
        `INSERT INTO vehicles (id, organization_id, shop_id, plate_encrypted, plate_hash, plate_digits_hash, model, certainty, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, '베스파 GTS300', 'confirmed', ?7, ?7)`,
      ).bind(jayangVehId, ORGANIZATION_ID, 'jayang', jayangPlateEncrypted, jayangPlateHash, jayangDigitsHash, Date.now()).run();

      // yongjeon 권한만 가진 정비사 생성 및 쿠키 발급
      const mechanicId = `user:staff:yongjeon-${crypto.randomUUID()}`;
      await d1.prepare(
        `INSERT INTO users (id, organization_id, external_user_id, email, display_name, status, created_at, updated_at)
         VALUES (?1, ?2, ?1, 'staff.yongjeon@test.com', '용전정비사', 'active', ?3, ?3)`,
      ).bind(mechanicId, ORGANIZATION_ID, Date.now()).run();

      await d1.prepare(
        `INSERT INTO user_shop_roles (id, organization_id, user_id, shop_id, role, role_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'yongjeon', 'staff', 'role:staff', ?4, ?4)`,
      ).bind(`usr:${crypto.randomUUID()}`, ORGANIZATION_ID, mechanicId, Date.now()).run();

      const mechanicCookie = await createAuthCookie(mechanicId, 'staff.yongjeon@test.com');

      const lookupReq = new Request('http://localhost:5173/api/vehicles/lookup-plate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: mechanicCookie },
        body: JSON.stringify({ plateText: '7777' }),
      });

      const lookupRes = await postLookupPlate(lookupReq);
      expect(lookupRes.status).toBe(200);
      const data = (await lookupRes.json()) as any;

      // 용전 정비사의 candidates에는 자양 차량(jayangVehId)이 절대로 포함되면 안 됨
      const leakedJayang = data.candidates?.find((c: any) => c.vehicleId === jayangVehId);
      expect(leakedJayang).toBeUndefined();
    });
  });

  // 4. PII 마스킹(*) 문자열 유입 차단 검증
  describe('④ PII 마스킹 차단 검증 및 허용 필드 정밀화', () => {
    it('고객명, 연락처, 번호판에 마스킹(*)이 포함되어 있으면 400 에러로 차단한다', async () => {
      const { POST: postOrder } = await import('../app/api/orders/route');
      const adminCookie = await createAuthCookie('user:owner:shortsbogo@gmail.com', 'shortsbogo@gmail.com');

      // 마스킹된 고객명
      const res1 = await postOrder(
        new Request('http://localhost:5173/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({
            idempotencyKey: `pii-test-1-${crypto.randomUUID()}`,
            shopId: 'yongjeon',
            customerName: '홍*동',
            plateText: '서울 강남 가 1111',
            items: [{ name: '정비', amount: 10000 }],
          }),
        }),
      );
      expect(res1.status).toBe(400);
      const data1 = (await res1.json()) as any;
      expect(data1.error).toContain('마스킹된 고객명(*)');

      // 마스킹된 연락처
      const res2 = await postOrder(
        new Request('http://localhost:5173/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({
            idempotencyKey: `pii-test-2-${crypto.randomUUID()}`,
            shopId: 'yongjeon',
            customerName: '홍길동',
            phone: '010-****-5678',
            plateText: '서울 강남 가 1111',
            items: [{ name: '정비', amount: 10000 }],
          }),
        }),
      );
      expect(res2.status).toBe(400);

      // 마스킹된 번호판
      const res3 = await postOrder(
        new Request('http://localhost:5173/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({
            idempotencyKey: `pii-test-3-${crypto.randomUUID()}`,
            shopId: 'yongjeon',
            customerName: '홍길동',
            phone: '010-1234-5678',
            plateText: '12*3456',
            items: [{ name: '정비', amount: 10000 }],
          }),
        }),
      );
      expect(res3.status).toBe(400);
    });

    it('정비 메모나 항목 이름에 * 문자가 포함되어 있어도 정상 승인/등록된다', async () => {
      const { POST: postOrder } = await import('../app/api/orders/route');
      const adminCookie = await createAuthCookie('user:owner:shortsbogo@gmail.com', 'shortsbogo@gmail.com');

      const okKey = `pii-memo-ok-${crypto.randomUUID()}`;
      const res = await postOrder(
        new Request('http://localhost:5173/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({
            idempotencyKey: okKey,
            shopId: 'yongjeon',
            customerName: '이순신',
            phone: '010-7777-8888',
            plateText: '서울 강남 라 5555',
            vehicleModel: '혼다 포르자 350',
            items: [{ name: '★특수 점검*공임★', quantity: 1, unitPrice: 20000, amount: 20000 }],
            paymentMethod: 'cash',
            paymentAmount: 20000,
            paymentNote: '*현금영수증 발행 완료*',
            notes: '*긴급정비 요청 건*',
          }),
        }),
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.ok).toBe(true);
    });
  });

  // 5. 검수 우선 원칙 및 권한별 즉시 승인 분기
  describe('⑤ 검수 대기(Review) 우선 원칙 및 즉시 승인(Approval) 권한 분기', () => {
    it('기본 전표 접수는 status = review(검수 대기)로 등록된다', async () => {
      const { POST: postOrder } = await import('../app/api/orders/route');
      const adminCookie = await createAuthCookie('user:owner:shortsbogo@gmail.com', 'shortsbogo@gmail.com');

      const key = `review-test-${crypto.randomUUID()}`;
      const res = await postOrder(
        new Request('http://localhost:5173/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({
            idempotencyKey: key,
            shopId: 'yongjeon',
            customerName: '강감찬',
            plateText: '서울 강남 사 6666',
            items: [{ name: '엔진오일', amount: 30000 }],
            requestImmediateApproval: false,
          }),
        }),
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.status).toBe('review');

      // DB 확인
      const dbRow = await d1
        .prepare('SELECT status FROM service_orders WHERE idempotency_key = ?1')
        .bind(key)
        .first<{ status: string }>();
      expect(dbRow?.status).toBe('review');
    });

    it('관리자 권한자가 requestImmediateApproval = true를 전송하면 status = approved(즉시 승인)로 등록된다', async () => {
      const { POST: postOrder } = await import('../app/api/orders/route');
      const adminCookie = await createAuthCookie('user:owner:shortsbogo@gmail.com', 'shortsbogo@gmail.com');

      const key = `approved-test-${crypto.randomUUID()}`;
      const res = await postOrder(
        new Request('http://localhost:5173/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({
            idempotencyKey: key,
            shopId: 'yongjeon',
            customerName: '을지문덕',
            plateText: '서울 강남 아 7771',
            items: [{ name: '종합 정비', amount: 120000 }],
            requestImmediateApproval: true,
          }),
        }),
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.status).toBe('approved');

      // DB 확인
      const dbRow = await d1
        .prepare('SELECT status, approved_by FROM service_orders WHERE idempotency_key = ?1')
        .bind(key)
        .first<{ status: string; approved_by: string }>();
      expect(dbRow?.status).toBe('approved');
      expect(dbRow?.approved_by).toBe('user:owner:shortsbogo@gmail.com');
    });
  });
});
