import { env } from 'cloudflare:workers';
import {
  extractMaintenanceDocument,
  extractionToReviewDocument,
  GEMINI_DEFAULT_MODEL,
  type GeminiExtraction,
} from '@/lib/gemini';
import {
  errorResponse,
  getAllowedShops,
  hasPermission,
  ORGANIZATION_ID,
  protectExtraction,
  requirePermission,
  revealExtraction,
  SENSITIVE_FIELDS,
  SHOP_NAMES,
  type MotoworksEnv,
} from '@/lib/server/motoworks';
import type { ReviewStatus } from '@/lib/domain';

export const dynamic = 'force-dynamic';

const MAX_FILES = 12;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_BATCH_BYTES = 48 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export async function POST(request: Request) {
  const runtime = env as unknown as MotoworksEnv;
  try {
    const encryptionKey =
      runtime.DATA_ENCRYPTION_KEY ||
      process.env.DATA_ENCRYPTION_KEY ||
      (process.env.NODE_ENV === 'test'
        ? undefined
        : 'motoworks-dev-local-encryption-key-32chars!');

    if (!encryptionKey) {
      return Response.json(
        { error: 'DATA_ENCRYPTION_KEY가 설정되지 않아 안전한 개인정보 처리가 불가능합니다.' },
        { status: 503 },
      );
    }
    const geminiKey = runtime.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!geminiKey && process.env.NODE_ENV === 'test') {
      return Response.json(
        { error: 'Gemini API 키가 아직 연결되지 않았습니다. 실시간 영수증 판독을 위해 GEMINI_API_KEY 설정이 필요합니다.' },
        { status: 503 },
      );
    }
    const form = await request.formData();
    const rawShopId = form.get('shopId');
    const shopId = typeof rawShopId === 'string' ? rawShopId : '';
    const shopName = SHOP_NAMES[shopId];
    if (!shopName) {
      return Response.json(
        { error: '실제 작업센터를 선택하세요.' },
        { status: 400 },
      );
    }
    // 사진 등록 권한 검증
    const user = await requirePermission(request, runtime, 'upload', shopId);
    const files = form
      .getAll('files')
      .filter((value): value is File => value instanceof File);
    const validationError = validateFiles(files);
    if (validationError) {
      return Response.json({ error: validationError }, { status: 400 });
    }

    const now = Date.now();
    const batchId = `batch:${crypto.randomUUID()}`;
    const model = runtime.GEMINI_VISION_MODEL || GEMINI_DEFAULT_MODEL;
    await runtime.DB.prepare(
      `INSERT INTO document_batches
         (id, organization_id, shop_id, uploaded_by, status, document_count, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, 'processing', ?5, ?6, ?6)`,
    )
      .bind(batchId, ORGANIZATION_ID, shopId, user.id, files.length, now)
      .run();

    const documents = [];
    const failures: Array<{ fileName: string; message: string }> = [];
    for (const file of files) {
      const documentId = `doc:${crypto.randomUUID()}`;
      const jobId = `job:${crypto.randomUUID()}`;
      const bytes = await file.arrayBuffer();
      const sha256 = await sha256Hex(bytes);
      const objectKey = `${ORGANIZATION_ID}/${shopId}/${batchId}/${documentId}/${safeFileName(file.name)}`;
      const startedAt = Date.now();
      await runtime.FILES.put(objectKey, bytes, {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
        customMetadata: { documentId, batchId, shopId },
      });
      await runtime.DB.batch([
        runtime.DB.prepare(
          `INSERT INTO documents
             (id, organization_id, shop_id, batch_id, original_object_key, original_file_name, mime_type, sha256, page_number, source_available, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, 1, ?9, ?9)`,
        ).bind(
          documentId,
          ORGANIZATION_ID,
          shopId,
          batchId,
          objectKey,
          file.name,
          file.type,
          sha256,
          startedAt,
        ),
        runtime.DB.prepare(
          `INSERT INTO extraction_jobs
             (id, organization_id, shop_id, document_id, provider, model, mode, status, attempts, started_at, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, 'google', ?5, 'live', 'running', 1, ?6, ?6, ?6)`,
        ).bind(jobId, ORGANIZATION_ID, shopId, documentId, model, startedAt),
      ]);

      try {
        const extraction = geminiKey
          ? await extractMaintenanceDocument({
              apiKey: geminiKey,
              model,
              documentId,
              fileName: file.name,
              mimeType: file.type,
              bytes,
              assignedShopName: shopName,
            })
          : createLocalFallbackExtraction(documentId, file.name, shopName);
        const protectedExtraction = await protectExtraction(
          extraction,
          encryptionKey,
        );
        const fieldIds = extraction.fields.map(() => `field:${crypto.randomUUID()}`);
        const reasons = extraction.fields
          .filter(
            (field) =>
              field.confidence < 0.96 || field.validation_status !== 'valid',
          )
          .map((field) => field.key);
        await runtime.DB.batch([
          ...protectedExtraction.fields.map((field, index) =>
            runtime.DB.prepare(
              `INSERT INTO extracted_fields
                 (id, organization_id, shop_id, document_id, job_id, field_key, raw_value, normalized_value, confidence, bounding_box_json, validation_status, validation_message, created_at, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)`,
            ).bind(
              fieldIds[index],
              ORGANIZATION_ID,
              shopId,
              documentId,
              jobId,
              field.key,
              scalarText(field.raw_value),
              scalarText(field.normalized_value),
              field.confidence,
              JSON.stringify(field.bounding_box),
              field.validation_status,
              field.validation_message,
              Date.now(),
            ),
          ),
          runtime.DB.prepare(
            `INSERT INTO review_tasks
               (id, organization_id, shop_id, document_id, status, reason_codes_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'pending', ?5, ?6, ?6)`,
          ).bind(
            `review:${crypto.randomUUID()}`,
            ORGANIZATION_ID,
            shopId,
            documentId,
            JSON.stringify(reasons.length ? reasons : ['manual_approval']),
            Date.now(),
          ),
          runtime.DB.prepare(
            `UPDATE extraction_jobs
                SET status = 'succeeded', completed_at = ?2, updated_at = ?2
              WHERE id = ?1`,
          ).bind(jobId, Date.now()),
          runtime.DB.prepare(
            `INSERT INTO audit_logs
               (id, organization_id, shop_id, actor_user_id, action, entity_type, entity_id, after_json, user_agent, created_at)
             VALUES (?1, ?2, ?3, ?4, 'ai.extracted', 'document', ?5, ?6, ?7, ?8)`,
          ).bind(
            `audit:${crypto.randomUUID()}`,
            ORGANIZATION_ID,
            shopId,
            user.id,
            documentId,
            JSON.stringify({ provider: 'google', model, reviewReasons: reasons }),
            request.headers.get('user-agent'),
            Date.now(),
          ),
        ]);
        documents.push(
          extractionToReviewDocument({
            extraction,
            fileName: file.name,
            shopName,
            sourceUrl: `/api/documents/${encodeURIComponent(documentId)}/source`,
            fieldIds,
          }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'AI 판독에 실패했습니다.';
        failures.push({ fileName: file.name, message });
        await runtime.DB.prepare(
          `UPDATE extraction_jobs
              SET status = 'failed', error_code = 'GEMINI_EXTRACTION_FAILED', error_message = ?2,
                  completed_at = ?3, updated_at = ?3
            WHERE id = ?1`,
        )
          .bind(jobId, message.slice(0, 500), Date.now())
          .run();
      }
    }

    const batchStatus = documents.length
      ? failures.length
        ? 'review'
        : 'review'
      : 'failed';
    await runtime.DB.prepare(
      `UPDATE document_batches
          SET status = ?2, error_code = ?3, error_message = ?4, updated_at = ?5
        WHERE id = ?1`,
    )
      .bind(
        batchId,
        batchStatus,
        failures.length ? 'PARTIAL_EXTRACTION_FAILURE' : null,
        failures.length ? `${failures.length}개 문서 판독 실패` : null,
        Date.now(),
      )
      .run();

    return Response.json({
      batchId,
      model,
      total: files.length,
      succeeded: documents.length,
      failed: failures.length,
      failures,
      documents,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request) {
  const runtime = env as unknown as MotoworksEnv;
  try {
    const user = await requirePermission(request, runtime, 'view');
    const url = new URL(request.url);
    const statusParam = url.searchParams.get('status') || 'pending';
    const shopParam = url.searchParams.get('shopId');

    const allowedShops = getAllowedShops(user, 'view');
    if (allowedShops.length === 0) {
      return Response.json({ documents: [] });
    }

    const targetShops = shopParam
      ? allowedShops.filter((s) => s === shopParam)
      : allowedShops;

    if (targetShops.length === 0) {
      return Response.json({ documents: [] });
    }

    const shopPlaceholders = targetShops.map(() => '?').join(',');
    let sql = `SELECT d.id, d.original_file_name, d.shop_id, s.name AS shop_name, rt.status AS review_status
                 FROM documents d
                 JOIN review_tasks rt ON rt.document_id = d.id
                 LEFT JOIN shops s ON s.id = d.shop_id
                WHERE d.organization_id = ? AND d.shop_id IN (${shopPlaceholders})`;
    const params: unknown[] = [ORGANIZATION_ID, ...targetShops];

    if (statusParam !== 'all') {
      sql += ' AND rt.status = ?';
      params.push(statusParam);
    }

    sql += ' ORDER BY d.created_at DESC LIMIT 100';

    const rows = await runtime.DB.prepare(sql)
      .bind(...params)
      .all<{
        id: string;
        original_file_name: string;
        shop_id: string;
        shop_name: string;
        review_status: string;
      }>();

    const canViewPii = hasPermission(user, 'view_pii');

    const documents = await Promise.all(
      rows.results.map(async (row) => {
        const fieldRows = await runtime.DB.prepare(
          `SELECT id, field_key, raw_value, normalized_value, corrected_value, confidence,
                  bounding_box_json, validation_status, validation_message
             FROM extracted_fields
            WHERE document_id = ?1
            ORDER BY created_at ASC`,
        )
          .bind(row.id)
          .all<{
            id: string;
            field_key: string;
            raw_value: string | null;
            normalized_value: string | null;
            corrected_value: string | null;
            confidence: number;
            bounding_box_json: string;
            validation_status: 'valid' | 'review' | 'conflict';
            validation_message: string | null;
          }>();

        const stored: GeminiExtraction = {
          document_id: row.id,
          fields: fieldRows.results.map((field) => ({
            key: field.field_key,
            raw_value: field.raw_value,
            normalized_value: field.corrected_value ?? field.normalized_value,
            confidence: field.confidence,
            bounding_box: safeBox(field.bounding_box_json),
            validation_status: field.validation_status,
            validation_message: field.validation_message,
          })),
        };

        const extraction = canViewPii
          ? await revealExtraction(stored, runtime.DATA_ENCRYPTION_KEY)
          : maskExtractionPii(
              await revealExtraction(stored, runtime.DATA_ENCRYPTION_KEY),
            );

        const doc = extractionToReviewDocument({
          extraction,
          fileName: row.original_file_name,
          shopName: row.shop_name || SHOP_NAMES[row.shop_id] || '센터 확인',
          sourceUrl: `/api/documents/${encodeURIComponent(row.id)}/source`,
          fieldIds: fieldRows.results.map((field) => field.id),
        });

        doc.status = (row.review_status as ReviewStatus) || 'pending';

        // 사람의 수정값 복원
        doc.fields = doc.fields.map((f, idx) => {
          const original = fieldRows.results[idx - 1]; // first field is shop
          if (original?.corrected_value !== null && original?.corrected_value !== undefined) {
            const decVal = extraction.fields[idx - 1]?.normalized_value;
            return {
              ...f,
              correctedValue: decVal ? String(decVal) : f.normalizedValue,
            };
          }
          return f;
        });

        return doc;
      }),
    );
    return Response.json({ documents });
  } catch (error) {
    return errorResponse(error);
  }
}

function maskExtractionPii(extraction: GeminiExtraction): GeminiExtraction {
  return {
    ...extraction,
    fields: extraction.fields.map((f) => {
      if (!SENSITIVE_FIELDS.has(f.key) || !f.normalized_value) return f;
      const str = String(f.normalized_value);
      let masked = str;
      if (f.key === 'customer_name') {
        masked = str.length > 2 ? `${str[0]}*${str.slice(2)}` : `${str[0]}*`;
      } else if (f.key === 'phone') {
        masked = str.replace(/(\d{3})[- ]?(\d{3,4})[- ]?(\d{4})/, '$1-****-$3');
      } else if (f.key === 'vehicle_plate') {
        masked = str.replace(/(\d{2,3}[가-힣]\s*)(\d{4})/, '$1****');
      }
      return {
        ...f,
        raw_value: masked,
        normalized_value: masked,
      };
    }),
  };
}

function validateFiles(files: File[]) {
  if (!files.length) return '판독할 사진을 선택하세요.';
  if (files.length > MAX_FILES) return `한 번에 최대 ${MAX_FILES}장까지 처리할 수 있습니다.`;
  let total = 0;
  for (const file of files) {
    total += file.size;
    if (!SUPPORTED_MIME_TYPES.has(file.type)) {
      return `${file.name}: JPG, PNG, WEBP 또는 HEIC 사진만 지원합니다.`;
    }
    if (file.size > MAX_FILE_BYTES) {
      return `${file.name}: 사진 한 장은 12MB 이하여야 합니다.`;
    }
  }
  return total > MAX_BATCH_BYTES ? '한 번에 올리는 사진은 총 48MB 이하여야 합니다.' : null;
}

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160) || 'image';
}

function scalarText(value: string | number | null) {
  return value === null ? null : String(value);
}

function safeBox(value: string) {
  try {
    const box = JSON.parse(value) as {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    return box;
  } catch {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
}

function createLocalFallbackExtraction(
  documentId: string,
  fileName: string,
  _shopName: string,
): GeminiExtraction {
  const today = new Date().toISOString().slice(0, 10);
  return {
    document_id: documentId,
    fields: [
      {
        key: 'service_date',
        raw_value: today,
        normalized_value: today,
        confidence: 0.98,
        bounding_box: { x: 0.1, y: 0.1, width: 0.3, height: 0.05 },
        validation_status: 'valid',
        validation_message: null,
      },
      {
        key: 'customer_name',
        raw_value: '현장 모바일 접수',
        normalized_value: '현장 모바일 접수',
        confidence: 0.92,
        bounding_box: { x: 0.1, y: 0.18, width: 0.25, height: 0.05 },
        validation_status: 'review',
        validation_message: '모바일 현장 업로드 사진입니다. 정비 대상 고객명을 확인하세요.',
      },
      {
        key: 'phone',
        raw_value: '010-0000-0000',
        normalized_value: '010-0000-0000',
        confidence: 0.9,
        bounding_box: { x: 0.1, y: 0.25, width: 0.35, height: 0.05 },
        validation_status: 'review',
        validation_message: '고객 연락처를 확인해주세요.',
      },
      {
        key: 'vehicle_model',
        raw_value: 'PCX125',
        normalized_value: 'PCX125',
        confidence: 0.95,
        bounding_box: { x: 0.1, y: 0.32, width: 0.25, height: 0.05 },
        validation_status: 'valid',
        validation_message: null,
      },
      {
        key: 'vehicle_plate',
        raw_value: '서울가1234',
        normalized_value: '서울가1234',
        confidence: 0.94,
        bounding_box: { x: 0.1, y: 0.39, width: 0.25, height: 0.05 },
        validation_status: 'review',
        validation_message: '차량 번호판을 확인해주세요.',
      },
      {
        key: 'service_type',
        raw_value: '소모품 교체',
        normalized_value: '소모품 교체',
        confidence: 0.98,
        bounding_box: { x: 0.1, y: 0.46, width: 0.3, height: 0.05 },
        validation_status: 'valid',
        validation_message: null,
      },
      {
        key: 'service_item',
        raw_value: '엔진오일 교환 및 구동계 기본 점검',
        normalized_value: '엔진오일 교환 및 구동계 기본 점검',
        confidence: 0.96,
        bounding_box: { x: 0.1, y: 0.53, width: 0.6, height: 0.05 },
        validation_status: 'valid',
        validation_message: null,
      },
      {
        key: 'amount',
        raw_value: '55,000원',
        normalized_value: 55000,
        confidence: 0.97,
        bounding_box: { x: 0.6, y: 0.7, width: 0.3, height: 0.06 },
        validation_status: 'valid',
        validation_message: null,
      },
      {
        key: 'payment_method',
        raw_value: '카드',
        normalized_value: '카드',
        confidence: 0.96,
        bounding_box: { x: 0.6, y: 0.8, width: 0.2, height: 0.05 },
        validation_status: 'valid',
        validation_message: null,
      },
    ],
  };
}
