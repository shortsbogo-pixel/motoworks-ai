import { DatabaseSync } from 'node:sqlite';

const dbPath = 'E:/Projects/motoworks-import-20260906-160143/motoworks-ai/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite';
const db = new DatabaseSync(dbPath);

const now = Date.now();
const orgId = 'core-partners';

db.exec(`
  -- 배치 생성
  INSERT OR IGNORE INTO document_batches (id, organization_id, shop_id, uploaded_by, status, document_count, created_at, updated_at)
  VALUES ('batch_sample_1', '${orgId}', 'yongjeon', 'user:owner:shortsbogo@gmail.com', 'review', 2, ${now}, ${now});

  -- 문서 1: 용전센터 정비명세서 (검수 대기)
  INSERT OR IGNORE INTO documents (id, organization_id, shop_id, batch_id, original_object_key, original_file_name, mime_type, sha256, source_available, created_at, updated_at)
  VALUES ('doc_sample_1', '${orgId}', 'yongjeon', 'batch_sample_1', 'obj_sample_1', '명세서_용전_260906.jpg', 'image/jpeg', 'sha_sample_1', 1, ${now}, ${now});

  INSERT OR IGNORE INTO extraction_jobs (id, organization_id, shop_id, document_id, provider, model, mode, status, created_at, updated_at)
  VALUES ('job_sample_1', '${orgId}', 'yongjeon', 'doc_sample_1', 'gemini', 'gemini-3.8-flash', 'auto', 'completed', ${now}, ${now});

  INSERT OR IGNORE INTO review_tasks (id, organization_id, shop_id, document_id, status, reason_codes_json, created_at, updated_at)
  VALUES ('rt_sample_1', '${orgId}', 'yongjeon', 'doc_sample_1', 'pending', '["LOW_CONFIDENCE_FIELD"]', ${now}, ${now});

  INSERT OR IGNORE INTO extracted_fields (id, organization_id, shop_id, document_id, job_id, field_key, raw_value, normalized_value, confidence, bounding_box_json, validation_status, validation_message, created_at, updated_at)
  VALUES ('fld_s1_1', '${orgId}', 'yongjeon', 'doc_sample_1', 'job_sample_1', 'service_date', '2026-09-06', '2026-09-06', 0.99, '{"x":0.1,"y":0.1,"width":0.3,"height":0.05}', 'valid', NULL, ${now}, ${now}),
         ('fld_s1_2', '${orgId}', 'yongjeon', 'doc_sample_1', 'job_sample_1', 'customer_name', '박대성', '박대성', 0.97, '{"x":0.1,"y":0.2,"width":0.25,"height":0.05}', 'valid', NULL, ${now}, ${now}),
         ('fld_s1_3', '${orgId}', 'yongjeon', 'doc_sample_1', 'job_sample_1', 'phone', '010-3344-5566', '010-3344-5566', 0.95, '{"x":0.4,"y":0.2,"width":0.3,"height":0.05}', 'review', '전화번호 자리수 확인 필요', ${now}, ${now}),
         ('fld_s1_4', '${orgId}', 'yongjeon', 'doc_sample_1', 'job_sample_1', 'vehicle_model', 'PCX 125', 'PCX 125', 0.98, '{"x":0.1,"y":0.3,"width":0.3,"height":0.05}', 'valid', NULL, ${now}, ${now}),
         ('fld_s1_5', '${orgId}', 'yongjeon', 'doc_sample_1', 'job_sample_1', 'vehicle_plate', '34구 7890', '34구 7890', 0.99, '{"x":0.45,"y":0.3,"width":0.3,"height":0.05}', 'valid', NULL, ${now}, ${now}),
         ('fld_s1_6', '${orgId}', 'yongjeon', 'doc_sample_1', 'job_sample_1', 'service_item', '엔진오일 합성유', '엔진오일 100%', 0.96, '{"x":0.1,"y":0.45,"width":0.4,"height":0.05}', 'valid', NULL, ${now}, ${now}),
         ('fld_s1_7', '${orgId}', 'yongjeon', 'doc_sample_1', 'job_sample_1', 'amount', '35,000', '35000', 0.99, '{"x":0.7,"y":0.45,"width":0.2,"height":0.05}', 'valid', NULL, ${now}, ${now}),
         ('fld_s1_8', '${orgId}', 'yongjeon', 'doc_sample_1', 'job_sample_1', 'payment_method', '카드', 'card', 0.99, '{"x":0.5,"y":0.8,"width":0.2,"height":0.05}', 'valid', NULL, ${now}, ${now});

  -- 문서 2: 자양센터 렌트 정비명세서 (검수 대기)
  INSERT OR IGNORE INTO documents (id, organization_id, shop_id, batch_id, original_object_key, original_file_name, mime_type, sha256, source_available, created_at, updated_at)
  VALUES ('doc_sample_2', '${orgId}', 'jayang', 'batch_sample_1', 'obj_sample_2', '명세서_자양_렌트청구.jpg', 'image/jpeg', 'sha_sample_2', 1, ${now}, ${now});

  INSERT OR IGNORE INTO extraction_jobs (id, organization_id, shop_id, document_id, provider, model, mode, status, created_at, updated_at)
  VALUES ('job_sample_2', '${orgId}', 'jayang', 'doc_sample_2', 'gemini', 'gemini-3.8-flash', 'auto', 'completed', ${now}, ${now});

  INSERT OR IGNORE INTO review_tasks (id, organization_id, shop_id, document_id, status, reason_codes_json, created_at, updated_at)
  VALUES ('rt_sample_2', '${orgId}', 'jayang', 'doc_sample_2', 'pending', '["RENTAL_BILLING_CHECK"]', ${now}, ${now});

  INSERT OR IGNORE INTO extracted_fields (id, organization_id, shop_id, document_id, job_id, field_key, raw_value, normalized_value, confidence, bounding_box_json, validation_status, validation_message, created_at, updated_at)
  VALUES ('fld_s2_1', '${orgId}', 'jayang', 'doc_sample_2', 'job_sample_2', 'service_date', '2026-09-06', '2026-09-06', 0.99, '{"x":0.1,"y":0.1,"width":0.3,"height":0.05}', 'valid', NULL, ${now}, ${now}),
         ('fld_s2_2', '${orgId}', 'jayang', 'doc_sample_2', 'job_sample_2', 'customer_name', '에이렌트카', '에이렌트카', 0.98, '{"x":0.1,"y":0.2,"width":0.3,"height":0.05}', 'valid', NULL, ${now}, ${now}),
         ('fld_s2_3', '${orgId}', 'jayang', 'doc_sample_2', 'job_sample_2', 'vehicle_model', 'NMAX 125', 'NMAX 125', 0.97, '{"x":0.1,"y":0.3,"width":0.3,"height":0.05}', 'valid', NULL, ${now}, ${now}),
         ('fld_s2_4', '${orgId}', 'jayang', 'doc_sample_2', 'job_sample_2', 'vehicle_plate', '11하 2233', '11하 2233', 0.99, '{"x":0.45,"y":0.3,"width":0.3,"height":0.05}', 'valid', NULL, ${now}, ${now}),
         ('fld_s2_5', '${orgId}', 'jayang', 'doc_sample_2', 'job_sample_2', 'service_type', '렌트', 'rental', 0.95, '{"x":0.1,"y":0.4,"width":0.2,"height":0.05}', 'review', '렌트사 계약 일치 확인', ${now}, ${now}),
         ('fld_s2_6', '${orgId}', 'jayang', 'doc_sample_2', 'job_sample_2', 'service_item', '타이어 교환(후)', '리어 타이어 교체', 0.95, '{"x":0.1,"y":0.5,"width":0.4,"height":0.05}', 'valid', NULL, ${now}, ${now}),
         ('fld_s2_7', '${orgId}', 'jayang', 'doc_sample_2', 'job_sample_2', 'amount', '95,000', '95000', 0.99, '{"x":0.7,"y":0.5,"width":0.2,"height":0.05}', 'valid', NULL, ${now}, ${now}),
         ('fld_s2_8', '${orgId}', 'jayang', 'doc_sample_2', 'job_sample_2', 'payment_method', '청구', 'rental_billing', 0.99, '{"x":0.5,"y":0.8,"width":0.2,"height":0.05}', 'valid', NULL, ${now}, ${now});
`);

console.log('Seeded review documents successfully into local D1!');
db.close();
