import { describe, expect, it, vi } from 'vitest';
import {
  extractMaintenanceDocument,
  extractionToReviewDocument,
  normalizeExtraction,
} from '../lib/gemini';

const sample = {
  document_id: 'ignored-by-normalizer',
  fields: [
    {
      key: 'customer_name',
      raw_value: '김승환',
      normalized_value: '김승환',
      confidence: 0.91,
      bounding_box: { x: 0.1, y: 0.2, width: 0.3, height: 0.08 },
      validation_status: 'review',
      validation_message: null,
    },
    {
      key: 'amount',
      raw_value: '35,000',
      normalized_value: 35000,
      confidence: 0.99,
      bounding_box: { x: 0.5, y: 0.8, width: 0.2, height: 0.07 },
      validation_status: 'valid',
      validation_message: null,
    },
  ],
};

describe('Gemini 정비내역서 판독 계약', () => {
  it('서버가 지정한 문서 ID를 유지하고 좌표와 신뢰도를 정규화한다', () => {
    const result = normalizeExtraction(sample, 'doc:1');
    expect(result.document_id).toBe('doc:1');
    expect(result.fields[0].validation_message).toContain('고객명');
    expect(result.fields[1].normalized_value).toBe(35000);
  });

  it('확정 작업센터를 AI 추정값과 분리해 검수 문서로 만든다', () => {
    const extraction = normalizeExtraction(sample, 'doc:2');
    const document = extractionToReviewDocument({
      extraction,
      fileName: '정비내역.jpg',
      shopName: '진바이크 용전센터',
      fieldIds: ['field:1', 'field:2'],
    });
    expect(document.shopCertainty).toBe('confirmed');
    expect(document.shopName).toBe('진바이크 용전센터');
    expect(document.amount).toBe(35000);
    expect(document.fields[1].id).toBe('field:1');
  });

  it('Gemini 3.8 Flash에 구조화 JSON과 medium 추론을 요청한다', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('JSON 본문이 필요합니다.');
      const body = JSON.parse(init.body);
      expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'secret' });
      expect(body.generationConfig.responseMimeType).toBe('application/json');
      expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('medium');
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(sample) }] } }],
      });
    });
    const result = await extractMaintenanceDocument({
      apiKey: 'secret',
      documentId: 'doc:3',
      fileName: '정비내역.jpg',
      mimeType: 'image/jpeg',
      bytes: new Uint8Array([1, 2, 3]).buffer,
      assignedShopName: '코아바이크 자양센터',
      fetchImpl: fetchImpl as typeof fetch,
    });
    expect(result.document_id).toBe('doc:3');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('extractLicensePlate: Google API 지역 제한(400) 시 isLocationBlocked를 에러 객체에 태깅한다', async () => {
    const { extractLicensePlate } = await import('../lib/gemini');
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: 'User location is not supported for the API use.',
            status: 'FAILED_PRECONDITION',
          },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    });

    await expect(
      extractLicensePlate({
        imageBase64: 'base64data',
        mimeType: 'image/jpeg',
        apiKey: 'test-key',
        fetchImpl: fetchImpl as typeof fetch,
      }),
    ).rejects.toMatchObject({
      isLocationBlocked: true,
      code: 'LOCATION_NOT_SUPPORTED',
    });
  });

  it('extractLicensePlate: 커스텀 baseUrl 설정을 존중하여 요청 URL을 구성한다', async () => {
    const { extractLicensePlate } = await import('../lib/gemini');
    let requestedUrl = '';
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      requestedUrl = String(url);
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    full_plate: '서울 마포 가 1234',
                    plate_digits: '1234',
                    confidence: 0.95,
                    is_uncertain: false,
                  }),
                },
              ],
            },
          },
        ],
      });
    });

    const res = await extractLicensePlate({
      imageBase64: 'base64data',
      mimeType: 'image/jpeg',
      apiKey: 'test-key',
      baseUrl: 'https://gateway.ai.cloudflare.com/v1/test/gemini',
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(requestedUrl).toContain('https://gateway.ai.cloudflare.com/v1/test/gemini/v1beta/models');
    expect(res.plate_digits).toBe('1234');
    expect(res.full_plate).toBe('서울 마포 가 1234');
  });
});
