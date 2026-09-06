import { env } from 'cloudflare:workers';
import {
  extractMaintenanceDocument,
  extractionToReviewDocument,
  GEMINI_DEFAULT_MODEL,
  type GeminiExtraction,
} from '@/lib/gemini';
import {
  errorResponse,
  ORGANIZATION_ID,
  protectExtraction,
  requireAuthorizedUser,
  revealExtraction,
  SHOP_NAMES,
  type MotoworksEnv,
} from '@/lib/server/motoworks';

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
    if (!runtime.GEMINI_API_KEY) {
      return Response.json(
        { error: 'Gemini API 키가 아직 연결되지 않았습니다.' },
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
    const user = await requireAuthorizedUser(request, runtime, shopId);
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
        const extraction = await extractMaintenanceDocument({
          apiKey: runtime.GEMINI_API_KEY,
          model,
          documentId,
          fileName: file.name,
          mimeType: file.type,
          bytes,
          assignedShopName: shopName,
        });
        const protectedExtraction = await protectExtraction(
          extraction,
          runtime.DATA_ENCRYPTION_KEY,
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
    await requireAuthorizedUser(request, runtime);
    const rows = await runtime.DB.prepare(
      `SELECT d.id, d.original_file_name, d.shop_id, s.name AS shop_name
         FROM documents d
         JOIN review_tasks rt ON rt.document_id = d.id
         LEFT JOIN shops s ON s.id = d.shop_id
        WHERE d.organization_id = ?1 AND rt.status = 'pending'
        ORDER BY d.created_at DESC
        LIMIT 100`,
    )
      .bind(ORGANIZATION_ID)
      .all<{
        id: string;
        original_file_name: string;
        shop_id: string;
        shop_name: string;
      }>();

    const documents = await Promise.all(
      rows.results.map(async (row) => {
        const fieldRows = await runtime.DB.prepare(
          `SELECT id, field_key, raw_value, normalized_value, confidence,
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
            normalized_value: field.normalized_value,
            confidence: field.confidence,
            bounding_box: safeBox(field.bounding_box_json),
            validation_status: field.validation_status,
            validation_message: field.validation_message,
          })),
        };
        const extraction = await revealExtraction(
          stored,
          runtime.DATA_ENCRYPTION_KEY,
        );
        return extractionToReviewDocument({
          extraction,
          fileName: row.original_file_name,
          shopName: row.shop_name || SHOP_NAMES[row.shop_id] || '센터 확인',
          sourceUrl: `/api/documents/${encodeURIComponent(row.id)}/source`,
          fieldIds: fieldRows.results.map((field) => field.id),
        });
      }),
    );
    return Response.json({ documents });
  } catch (error) {
    return errorResponse(error);
  }
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
