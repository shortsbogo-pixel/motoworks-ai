import { describe, expect, it } from 'vitest';
import {
  buildDuplicateFingerprint,
  evaluateAutoRegistration,
  normalizePhone,
} from '../lib/domain';

const valid = {
  requiredConfidences: [0.99, 0.98],
  itemTotal: 45000,
  paymentTotal: 45000,
  shopCertainty: 'confirmed' as const,
  identifiable: true,
  vehicleConflict: false,
  duplicateCandidate: false,
  serviceType: 'personal' as const,
  customerPaidAmount: 45000,
};

describe('자동등록 규칙', () => {
  it('모든 조건이 맞을 때만 등록한다', () =>
    expect(evaluateAutoRegistration(valid)).toEqual({
      eligible: true,
      reasons: [],
    }));
  it('미확정 매장과 낮은 신뢰도를 검수로 보낸다', () => {
    const result = evaluateAutoRegistration({
      ...valid,
      requiredConfidences: [0.95],
      shopCertainty: 'ai_estimated',
    });
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('필수 필드 신뢰도 96% 미만');
    expect(result.reasons).toContain('매장 미확정');
  });
  it('개인 0원은 차단하고 렌트 0원은 허용한다', () => {
    expect(
      evaluateAutoRegistration({
        ...valid,
        itemTotal: 0,
        paymentTotal: 0,
        customerPaidAmount: 0,
      }).eligible,
    ).toBe(false);
    expect(
      evaluateAutoRegistration({
        ...valid,
        itemTotal: 0,
        paymentTotal: 0,
        customerPaidAmount: 0,
        serviceType: 'rental',
      }).eligible,
    ).toBe(true);
  });
  it('결제 합계 불일치와 중복 후보를 차단한다', () => {
    const result = evaluateAutoRegistration({
      ...valid,
      paymentTotal: 40000,
      duplicateCandidate: true,
    });
    expect(result.reasons).toEqual([
      '작업 합계와 결제 합계 불일치',
      '중복 후보 존재',
    ]);
  });
});

describe('식별 및 중복 보조 로직', () => {
  it('전화번호 표기를 정규화한다', () =>
    expect(normalizePhone('010 1234 5678')).toBe('010-1234-5678'));
  it('작업 순서가 달라도 같은 중복 지문을 만든다', () => {
    const base = {
      imageHash: 'abc',
      batchId: 'b1',
      shopId: 's1',
      vehiclePlate: '12가3456',
    };
    const a = buildDuplicateFingerprint({
      ...base,
      items: [
        { name: '오일', amount: 20000 },
        { name: '패드', amount: 30000 },
      ],
    });
    const b = buildDuplicateFingerprint({
      ...base,
      items: [
        { name: '패드', amount: 30000 },
        { name: '오일', amount: 20000 },
      ],
    });
    expect(a).toBe(b);
  });
});
