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
});
