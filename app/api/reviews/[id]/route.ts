import { env } from 'cloudflare:workers';
import {
  errorResponse,
  ORGANIZATION_ID,
  protectExtraction,
  requireAuthorizedUser,
  type MotoworksEnv,
} from '@/lib/server/motoworks';
import type { GeminiExtraction } from '@/lib/gemini';

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
    if (!document) return Response.json({ error: '검수 문서를 찾지 못했습니다.' }, { status: 404 });
    if (document.status !== 'pending' && document.status !== 'in_review') {
      return Response.json({ error: '이미 처리된 검수 문서입니다.' }, { status: 409 });
    }
    const user = await requireAuthorizedUser(request, runtime, document.shop_id);
    const body = (await request.json()) as {
      status?: 'approved' | 'rejected';
      fields?: Array<{ id: string; key: string; correctedValue?: string }>;
      note?: string;
    };
    if (!body.status || !['approved', 'rejected'].includes(body.status)) {
      return Response.json({ error: '승인 또는 반려 상태가 필요합니다.' }, { status: 400 });
    }
    const rawFields: GeminiExtraction = {
      document_id: id,
      fields: (body.fields ?? []).map((field) => ({
        key: field.key,
        raw_value: null,
        normalized_value: field.correctedValue ?? null,
        confidence: 1,
        bounding_box: { x: 0, y: 0, width: 0, height: 0 },
        validation_status: 'valid',
        validation_message: null,
      })),
    };
    const protectedFields = await protectExtraction(
      rawFields,
      runtime.DATA_ENCRYPTION_KEY,
    );
    const now = Date.now();
    const fieldUpdates = (body.fields ?? []).map((field, index) =>
      runtime.DB.prepare(
        `UPDATE extracted_fields
            SET corrected_value = ?2, corrected_by = ?3, corrected_at = ?4,
                validation_status = 'valid', updated_at = ?4
          WHERE id = ?1 AND document_id = ?5`,
      ).bind(
        field.id,
        protectedFields.fields[index]?.normalized_value ?? field.correctedValue ?? null,
        user.id,
        now,
        id,
      ),
    );
    await runtime.DB.batch([
      ...fieldUpdates,
      runtime.DB.prepare(
        `UPDATE review_tasks
            SET status = ?2, decided_by = ?3, decided_at = ?4,
                decision_note = ?5, updated_at = ?4
          WHERE id = ?1`,
      ).bind(document.review_id, body.status, user.id, now, body.note?.slice(0, 500) ?? null),
      runtime.DB.prepare(
        `INSERT INTO audit_logs
           (id, organization_id, shop_id, actor_user_id, action, entity_type, entity_id, after_json, user_agent, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'review_task', ?6, ?7, ?8, ?9)`,
      ).bind(
        `audit:${crypto.randomUUID()}`,
        ORGANIZATION_ID,
        document.shop_id,
        user.id,
        `review.${body.status}`,
        document.review_id,
        JSON.stringify({ documentId: id, correctedFieldCount: fieldUpdates.length }),
        request.headers.get('user-agent'),
        now,
      ),
    ]);
    return Response.json({ ok: true, status: body.status });
  } catch (error) {
    return errorResponse(error);
  }
}
