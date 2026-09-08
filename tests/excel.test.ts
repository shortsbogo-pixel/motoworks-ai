import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  buildLegacyWorkbook,
  inspectLegacyWorkbook,
  LEGACY_SHEET_NAMES,
} from '../lib/excel';
import { expectedReviewDocuments } from '../lib/mock-data';

describe('엑셀 호환', () => {
  it('승인 데이터만 5개 시트로 내보낸다', () => {
    const documents = expectedReviewDocuments.map((document, index) => ({
      ...document,
      status: index === 0 ? ('approved' as const) : document.status,
    }));
    const workbook = buildLegacyWorkbook(documents);
    expect(workbook.SheetNames).toEqual([...LEGACY_SHEET_NAMES]);
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets['정비내역']);
    expect(rows).toHaveLength(1);
  });
  it('대기 데이터는 매출에 포함하지 않는다', () => {
    const workbook = buildLegacyWorkbook(expectedReviewDocuments);
    expect(XLSX.utils.sheet_to_json(workbook.Sheets['정비내역'])).toHaveLength(
      0,
    );
  });
  it('가져오기 전에 시트와 합계를 검사한다', () => {
    const approved = [
      { ...expectedReviewDocuments[0], status: 'approved' as const },
    ];
    const bytes = XLSX.write(buildLegacyWorkbook(approved), {
      type: 'array',
      bookType: 'xlsx',
    });
    const result = inspectLegacyWorkbook(bytes);
    expect(result.missingSheets).toEqual([]);
    expect(result.orderCount).toBe(1);
    expect(result.revenue).toBe(approved[0].amount);
  });
  it('실무 엑셀 시트명(정비내역서, 렌트 관리, 차종 높임표 등) 및 서식 금액을 유연하게 인식한다', () => {
    const wb = XLSX.utils.book_new();
    const orderRows = [
      { 정비번호: 'O-1', 정비일: '2026-09-03', 차종: 'PCX125', 합계금액: '55,000원' },
      { 정비번호: 'O-2', 정비일: '2026-09-03', 차종: 'NMAX125', 금액: 70000 },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orderRows), '정비내역서');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 고객: '홍길동' }]), '고객목록');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 매장: '용전' }]), '매장별 매출');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 렌트사: '코아' }]), '렌트 관리');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 차종: '혼다' }]), '차종 높임표');

    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const result = inspectLegacyWorkbook(bytes);

    expect(result.missingSheets).toEqual([]);
    expect(result.orderCount).toBe(2);
    expect(result.revenue).toBe(125000);
  });
  it('실무 통합 엑셀(정비내역서_2026-09-03_통합.xlsx)의 5개 시트가 모두 매칭되고 누락 시트가 0개다', () => {
    const wb = XLSX.utils.book_new();
    const orderRows = [
      { 정비번호: 'O-101', 정비일: '2026-09-03', 차종: '혼다 PCX125', 합계금액: '150,000원' },
      { 정비번호: 'O-102', 정비일: '2026-09-03', 차종: '야마하 NMAX125', 결제금액: '₩85,000' },
      { 정비번호: 'O-103', 정비일: '2026-09-03', 차종: '포르자350', 총금액: 320000 },
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orderRows), '정비내역서');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 고객ID: 'C1', 이름: '홍길동' }]), '고객목록');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 지점: '진바이크 용전', 매출: 555000 }]), '매장별 매출');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 계약번호: 'R1', 대여사: '코아파트너스' }]), '렌트 관리');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 차종코드: 'PCX', 기준공임: 45000 }]), '차종 높임표');

    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const result = inspectLegacyWorkbook(bytes);

    expect(result.missingSheets).toHaveLength(0);
    expect(result.orderCount).toBe(3);
    expect(result.revenue).toBe(555000);
  });
});

