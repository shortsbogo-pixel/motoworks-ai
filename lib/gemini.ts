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
  if (!input.apiKey || !input.apiKey.trim()) {
    throw new Error('Gemini API 키가 설정되지 않았습니다.');
  }
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
                '한국 오토바이 정비내역서/영수증 사진을 정밀 구조화하는 전문 AI 판독기다.',
                '사진에 실제로 기재된 값만 정밀하게 옮겨 적고 없는 내용을 지어내지 않는다.',
                '한국 이륜차 현장 용어 사전을 참조해 표준 용어로 정규화하라:',
                '- 오일류: 엔진오일(10W-40, 50%합성유, 100%합성유, 모튤, 쉘), 미션오일, 브레이크오일(DOT4)',
                '- 구동계: 구동계 세척 및 점검, 구동계 벨트(드라이브 벨트), 무브볼(웨이트롤러), 슬라이드 피스, 클러치 슈, 클러치 아우터',
                '- 제동/소모품: 앞 브레이크 패드, 뒤 브레이크 패드, 디스크 로터, 에어필터, 점화플러그(이리듐), 배터리 교환, 대기어/소기어/체인',
                '- 타이어: 앞 타이어 교체, 뒤 타이어 교체, 피렐리 엔젤스쿠터, 미쉐린 시티그립, 신코 타이어',
                '- 공임: 기본 점검 공임, 밸브 간극 조절, 캘리퍼 오버홀, 카울 탈부착 공임',
                '차종은 혼다 PCX125, 포르자350, 야마하 NMAX125, XMAX300, SYM 조이맥스/크루심, 보이져, 대림/DNA 등 한국 다빈도 스쿠터 모델을 정확히 식별한다.',
                '작업 내역이 여러 줄이면 service_item을 각각 별개의 항목으로 모두 반환한다.',
                '금액(amount)은 부품비와 공임, 부가세가 포함된 최종 합계 금액을 숫자로 정규화한다.',
                '손글씨가 흐리거나 번져 판독이 불확실한 경우 confidence를 0.90 미만으로 낮추고 validation_status를 "review"로 설정하며, 사유를 validation_message에 기록한다.',
                'bounding_box는 문서 내 해당 글자의 실제 사각형 좌표(x, y, width, height, 0~1 상대값)를 정밀하게 추출한다.',
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

export type LicensePlateExtraction = {
  full_plate: string;
  plate_digits: string;
  region: string | null;
  confidence: number;
  is_uncertain: boolean;
};

export const MODEL_DEFAULT_THINKING: Record<string, 'minimal' | 'low' | 'medium'> = {
  'gemini-3.5-flash-lite': 'minimal',
  'gemini-3.7-flash': 'low',
  'gemini-3.8-flash': 'low',
};

export async function extractLicensePlate(input: {
  imageBase64: string;
  mimeType: string;
  apiKey: string;
  model?: string;
}): Promise<LicensePlateExtraction> {
  const model = input.model || 'gemini-3.5-flash-lite';
  const thinkingLevel = MODEL_DEFAULT_THINKING[model] ?? 'low';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${input.apiKey}`;

  const systemPrompt = [
    '대한민국 오토바이(이륜자동차) 번호판 전문 OCR 판독기다.',
    '최우선 목표: 번호판의 숫자 부분(plate_digits)을 가장 정확하게 판독하라.',
    '오토바이 번호판의 일반적 구성은 [지역/시도/구군] + [용도기호(한글 1자: 가, 나, 다, 라 등)] + [숫자 1~4자리]이다.',
    '지역명이나 한글 기호가 흐리거나 가려졌더라도, 숫자 일련번호(plate_digits)는 반드시 정확하게 추출해야 한다.',
    '출력 스키마 규격:',
    '- full_plate: 번호판에 표시된 전체 텍스트 (예: "대전 동 1234", "서울 마포 가 5678", "경기 광주 123")',
    '- plate_digits: 번호판의 숫자만 추출한 값 (예: "1234", "5678", "123"). 특수문자/공백 없이 숫자만 반환.',
    '- region: 시/도 또는 지자체명 (예: "대전", "서울", "경기"). 확인 불가 시 null.',
    '- confidence: 0.0 ~ 1.0 사이의 확신도.',
    '- is_uncertain: 번호판이 심하게 번지거나 가려져 오독 가능성이 높으면 true, 선명하면 false.',
    '추측으로 숫자를 지어내지 말고, 보이는 대로 정확히 추출하라.',
  ].join(' ');

  const responseSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['full_plate', 'plate_digits', 'confidence', 'is_uncertain'],
    properties: {
      full_plate: { type: 'string' },
      plate_digits: { type: 'string' },
      region: { type: ['string', 'null'] },
      confidence: { type: 'number' },
      is_uncertain: { type: 'boolean' },
    },
  };

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: systemPrompt },
          {
            inline_data: {
              mime_type: input.mimeType,
              data: input.imageBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: responseSchema,
      thinking_config: {
        thinking_level: thinkingLevel,
      },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gemini 번호판 판독 실패 (${res.status}): ${safeErrorDetail(errorText)}`);
  }

  const result = (await res.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const rawJson = result.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawJson) {
    throw new Error('Gemini로부터 번호판 판독 결과를 수신하지 못했습니다.');
  }

  const parsed = JSON.parse(rawJson) as LicensePlateExtraction;
  return {
    full_plate: parsed.full_plate || parsed.plate_digits || '',
    plate_digits: (parsed.plate_digits || '').replace(/[^\d]/g, ''),
    region: parsed.region || null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85,
    is_uncertain: Boolean(parsed.is_uncertain),
  };
}

