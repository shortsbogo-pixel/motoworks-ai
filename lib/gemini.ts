import type { ExtractedField, ReviewDocument } from './domain';

export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash';

export const FIELD_LABELS: Record<string, string> = {
  service_date: '정비일',
  customer_name: '고객명',
  phone: '연락처',
  vehicle_model: '차종',
  vehicle_plate: '차량번호',
  service_type: '정비 구분',
  service_item: '작업 항목',
  amount: '금액',
  payment_method: '결제수단',
};

const extractionResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['document_id', 'fields'],
  properties: {
    document_id: { type: 'string' },
    fields: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'key',
          'raw_value',
          'normalized_value',
          'confidence',
          'bounding_box',
          'validation_status',
          'validation_message',
        ],
        properties: {
          key: { type: 'string', enum: Object.keys(FIELD_LABELS) },
          raw_value: { type: ['string', 'null'] },
          normalized_value: { type: ['string', 'number', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          bounding_box: {
            type: 'object',
            additionalProperties: false,
            required: ['x', 'y', 'width', 'height'],
            properties: {
              x: { type: 'number', minimum: 0, maximum: 1 },
              y: { type: 'number', minimum: 0, maximum: 1 },
              width: { type: 'number', minimum: 0, maximum: 1 },
              height: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
          validation_status: {
            type: 'string',
            enum: ['valid', 'review', 'conflict'],
          },
          validation_message: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const;

type GeminiField = {
  key: string;
  raw_value: string | null;
  normalized_value: string | number | null;
  confidence: number;
  bounding_box: { x: number; y: number; width: number; height: number };
  validation_status: 'valid' | 'review' | 'conflict';
  validation_message: string | null;
};

export type GeminiExtraction = {
  document_id: string;
  fields: GeminiField[];
};

export async function extractMaintenanceDocument(input: {
  apiKey: string;
  model?: string;
  documentId: string;
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
  assignedShopName: string;
  fetchImpl?: typeof fetch;
}): Promise<GeminiExtraction> {
  const model = input.model || GEMINI_DEFAULT_MODEL;
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: [
                '한국 오토바이 정비내역서 사진을 구조화하는 판독기다.',
                '사진에 실제로 보이는 값만 옮기고 추측해서 채우지 않는다.',
                '손글씨가 불명확하면 값을 비우고 confidence를 낮추며 review로 표시한다.',
                '날짜는 YYYY-MM-DD, 금액은 숫자만, 전화번호와 차량번호는 원문을 유지한다.',
                '작업이 여러 개면 service_item을 여러 번 반환한다.',
                'bounding_box는 이미지 전체를 0~1로 본 상대 좌표다.',
                '지점은 시스템이 별도로 확정하므로 사진에서 지점을 추출하지 않는다.',
              ].join(' '),
            },
          ],
        },
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `문서 ID: ${input.documentId}\n파일명: ${input.fileName}\n확정 작업센터: ${input.assignedShopName}\n필요한 필드를 판독하라.`,
              },
              {
                inlineData: {
                  mimeType: input.mimeType,
                  data: arrayBufferToBase64(input.bytes),
                },
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: extractionResponseSchema,
          thinkingConfig: { thinkingLevel: 'medium' },
        },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini API ${response.status}: ${safeErrorDetail(detail)}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    promptFeedback?: { blockReason?: string };
  };
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? '')
    .join('')
    .trim();
  if (!text) {
    throw new Error(
      payload.promptFeedback?.blockReason
        ? `Gemini 응답 차단: ${payload.promptFeedback.blockReason}`
        : 'Gemini가 판독 결과를 반환하지 않았습니다.',
    );
  }
  return normalizeExtraction(JSON.parse(text), input.documentId);
}

export function normalizeExtraction(
  value: unknown,
  documentId: string,
): GeminiExtraction {
  if (!value || typeof value !== 'object') {
    throw new Error('Gemini 판독 결과가 객체가 아닙니다.');
  }
  const candidate = value as { fields?: unknown };
  if (!Array.isArray(candidate.fields) || candidate.fields.length === 0) {
    throw new Error('Gemini 판독 필드가 비어 있습니다.');
  }
  const seen = new Set<string>();
  const fields = candidate.fields
    .map((item): GeminiField | null => {
      if (!item || typeof item !== 'object') return null;
      const field = item as Partial<GeminiField>;
      if (!field.key || !FIELD_LABELS[field.key]) return null;
      const repeatableKey = field.key === 'service_item';
      if (!repeatableKey && seen.has(field.key)) return null;
      seen.add(field.key);
      const box = field.bounding_box ?? { x: 0, y: 0, width: 1, height: 1 };
      return {
        key: field.key,
        raw_value: stringOrNull(field.raw_value),
        normalized_value: scalarOrNull(field.normalized_value),
        confidence: clamp(Number(field.confidence) || 0, 0, 1),
        bounding_box: {
          x: clamp(Number(box.x) || 0, 0, 1),
          y: clamp(Number(box.y) || 0, 0, 1),
          width: clamp(Number(box.width) || 0, 0, 1),
          height: clamp(Number(box.height) || 0, 0, 1),
        },
        validation_status: ['valid', 'review', 'conflict'].includes(
          String(field.validation_status),
        )
          ? (field.validation_status as GeminiField['validation_status'])
          : 'review',
        validation_message:
          stringOrNull(field.validation_message) ??
          (Number(field.confidence) < 0.96
            ? `${FIELD_LABELS[field.key]} 확인이 필요합니다.`
            : null),
      };
    })
    .filter((field): field is GeminiField => field !== null);
  if (!fields.length) throw new Error('지원되는 판독 필드가 없습니다.');
  return { document_id: documentId, fields };
}

export function extractionToReviewDocument(input: {
  extraction: GeminiExtraction;
  fileName: string;
  shopName: string;
  sourceUrl?: string;
  fieldIds?: string[];
}): ReviewDocument {
  const fieldValue = (key: string) =>
    String(
      input.extraction.fields.find((field) => field.key === key)
        ?.normalized_value ?? '',
    );
  const amount = Number(fieldValue('amount').replace(/[^0-9-]/g, '')) || 0;
  const fields: ExtractedField[] = [
    {
      id: `${input.extraction.document_id}-shop`,
      key: 'shop',
      label: '실제 작업센터',
      rawValue: input.shopName,
      normalizedValue: input.shopName,
      confidence: 1,
      boundingBox: { x: 0, y: 0, width: 0, height: 0 },
      validationStatus: 'valid',
    },
    ...input.extraction.fields.map((field, index) => ({
      id:
        input.fieldIds?.[index] ??
        `${input.extraction.document_id}-${field.key}-${index}`,
      key: field.key,
      label: FIELD_LABELS[field.key] ?? field.key,
      rawValue: String(field.raw_value ?? ''),
      normalizedValue: String(field.normalized_value ?? ''),
      confidence: field.confidence,
      boundingBox: {
        x: field.bounding_box.x * 100,
        y: field.bounding_box.y * 100,
        width: field.bounding_box.width * 100,
        height: field.bounding_box.height * 100,
      },
      validationStatus: field.validation_status,
      validationMessage: field.validation_message ?? undefined,
    })),
  ];
  return {
    id: input.extraction.document_id,
    fileName: input.fileName,
    shopName: input.shopName,
    shopCertainty: 'confirmed',
    customerName: fieldValue('customer_name') || '고객명 확인',
    vehicleLabel: fieldValue('vehicle_model') || '차종 확인',
    amount,
    status: 'pending',
    sourceAvailable: true,
    sourceUrl: input.sourceUrl,
    duplicateCandidate: false,
    fields,
  };
}

function scalarOrNull(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return value.trim();
  return JSON.stringify(value);
}

function stringOrNull(value: unknown): string | null {
  const scalar = scalarOrNull(value);
  return scalar === null ? null : String(scalar);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function safeErrorDetail(detail: string) {
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } };
    return parsed.error?.message?.slice(0, 300) || '호출 실패';
  } catch {
    return detail.replace(/AIza[\w-]+/g, '[API_KEY]').slice(0, 300);
  }
}
