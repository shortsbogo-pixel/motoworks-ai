import { describe, expect, it } from 'vitest';
import { extractPlateDigits, hashPlateDigits } from '../lib/server/motoworks';

describe('이륜차 번호판 일련번호 정규화 및 Keyed Hash 무결성 검증', () => {
  const testSecret = 'motoworks-test-secret-2026-32chars!';

  it('다양한 형식의 번호판에서 숫자부를 정확히 추출한다', () => {
    expect(extractPlateDigits('대전 동 1234')).toBe('1234');
    expect(extractPlateDigits('서울 강남 가 5678')).toBe('5678');
    expect(extractPlateDigits('경기 9999')).toBe('9999');
    expect(extractPlateDigits('1234')).toBe('1234');
  });

  it('3자리 구형/특수 이륜차 번호판은 자릿수를 원형 그대로 보존한다 (padStart 폐기 확인)', () => {
    expect(extractPlateDigits('서울 123')).toBe('123');
    expect(extractPlateDigits('대전 가 12')).toBe('12');
    expect(extractPlateDigits('7')).toBe('7');
  });

  it('3자리(123)와 4자리(0123) 및 (1234)는 서로 다른 HMAC 해시를 가지며 충돌하지 않는다', async () => {
    const hash123 = await hashPlateDigits('123', testSecret);
    const hash0123 = await hashPlateDigits('0123', testSecret);
    const hash1234 = await hashPlateDigits('1234', testSecret);

    expect(hash123).not.toBe(hash0123);
    expect(hash123).not.toBe(hash1234);
    expect(hash0123).not.toBe(hash1234);
  });

  it('동일한 숫자는 동일한 secret에 대해 항상 결정적(deterministic)으로 일치한다', async () => {
    const hashA = await hashPlateDigits('5678', testSecret);
    const hashB = await hashPlateDigits('5678', testSecret);
    expect(hashA).toBe(hashB);
  });

  it('secret이 다르면 동일한 숫자라도 해시가 완전히 분리된다', async () => {
    const hashA = await hashPlateDigits('1234', 'secret-key-alpha-1234567890');
    const hashB = await hashPlateDigits('1234', 'secret-key-beta-12345678901');
    expect(hashA).not.toBe(hashB);
  });

  it('secret이 누락되면 즉시 예외를 throw한다', async () => {
    await expect(hashPlateDigits('1234', '')).rejects.toThrow('[FATAL]');
  });

  it('4자리 번호판의 뒤 3자리 fallback 해시가 3자리 번호판 해시와 정확히 연계된다', async () => {
    const fullPlate = '대전 동 1234';
    const digits = extractPlateDigits(fullPlate); // '1234'
    const last3Digits = digits.slice(-3); // '234'

    const fallbackHash = await hashPlateDigits(last3Digits, testSecret);
    const target3DigitsHash = await hashPlateDigits('234', testSecret);

    expect(fallbackHash).toBe(target3DigitsHash);
  });
});

