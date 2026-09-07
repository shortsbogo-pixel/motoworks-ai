import { DatabaseSync } from 'node:sqlite';

const dbPath = 'E:/Projects/motoworks-import-20260906-160143/motoworks-ai/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite';
const db = new DatabaseSync(dbPath);

const now = Date.now();
const orgId = 'core-partners';

db.exec(`
  INSERT OR IGNORE INTO customers (id, organization_id, shop_id, name, phone_encrypted, status, created_at, updated_at)
  VALUES ('cust_sample_1', '${orgId}', 'yongjeon', '김철수', '010-1234-5678', 'active', ${now}, ${now}),
         ('cust_sample_2', '${orgId}', 'jayang', '이영희', '010-9876-5432', 'active', ${now}, ${now});

  INSERT OR IGNORE INTO vehicles (id, organization_id, shop_id, customer_id, model, certainty, created_at, updated_at)
  VALUES ('veh_sample_1', '${orgId}', 'yongjeon', 'cust_sample_1', 'PCX 125', 'confirmed', ${now}, ${now}),
         ('veh_sample_2', '${orgId}', 'jayang', 'cust_sample_2', 'NMAX 125', 'confirmed', ${now}, ${now});

  INSERT OR IGNORE INTO service_orders (id, organization_id, shop_id, customer_id, vehicle_id, approved_service_date, shop_certainty, service_type, status, total_amount, created_at, updated_at)
  VALUES ('ord_sample_1', '${orgId}', 'yongjeon', 'cust_sample_1', 'veh_sample_1', '2026-09-06', 'confirmed', 'personal', 'approved', 85000, ${now}, ${now}),
         ('ord_sample_2', '${orgId}', 'jayang', 'cust_sample_2', 'veh_sample_2', '2026-09-06', 'confirmed', 'rental', 'approved', 145000, ${now}, ${now});

  INSERT OR IGNORE INTO service_items (id, organization_id, shop_id, service_order_id, raw_name, normalized_name, quantity, unit_price, amount, created_at, updated_at)
  VALUES ('item_sample_1', '${orgId}', 'yongjeon', 'ord_sample_1', '엔진오일 교환', '엔진오일 100%', 1, 35000, 35000, ${now}, ${now}),
         ('item_sample_2', '${orgId}', 'yongjeon', 'ord_sample_1', '리어 패드 교환', '브레이크 패드(후)', 1, 50000, 50000, ${now}, ${now}),
         ('item_sample_3', '${orgId}', 'jayang', 'ord_sample_2', '구동계 점검 및 벨트', '드라이브 벨트', 1, 145000, 145000, ${now}, ${now});

  INSERT OR IGNORE INTO payments (id, organization_id, shop_id, service_order_id, method, amount, paid_at, note, created_at, updated_at)
  VALUES ('pay_sample_1', '${orgId}', 'yongjeon', 'ord_sample_1', 'card', 85000, ${now}, '카드 결제', ${now}, ${now}),
         ('pay_sample_2', '${orgId}', 'jayang', 'ord_sample_2', 'rental_billing', 145000, ${now}, '청구 정산', ${now}, ${now});

  INSERT OR IGNORE INTO receivables (id, organization_id, shop_id, service_order_id, base_price, customer_paid_amount, billed_amount, received_amount, outstanding_amount, settlement_status, created_at, updated_at)
  VALUES ('rec_sample_1', '${orgId}', 'jayang', 'ord_sample_2', 145000, 0, 145000, 0, 145000, 'unbilled', ${now}, ${now});
`);

console.log('Sample data seeded successfully into local D1!');
db.close();
