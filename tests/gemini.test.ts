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
});
