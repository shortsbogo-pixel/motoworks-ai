import * as XLSX from 'xlsx';
import type { ReviewDocument } from './domain';

export const LEGACY_SHEET_NAMES = [
  '정비내역',
  '정비항목',
  '고객목록',
  '렌트리스',
  '기준정보',
] as const;

export function buildLegacyWorkbook(documents: ReviewDocument[]) {
  const approved = documents.filter(
    (document) => document.status === 'approved',
  );
  const workbook = XLSX.utils.book_new();
  const orderRows = approved.map((document) => ({
    정비번호: document.id,
    정비일:
      document.fields.find((item) => item.key === 'service_date')
        ?.correctedValue ||
      document.fields.find((item) => item.key === 'service_date')
        ?.normalizedValue,
    매장: document.shopName,
    고객명: document.customerName,
    차종: document.vehicleLabel,
    합계금액: document.amount,
    승인상태: '승인',
  }));
  const itemRows = approved.map((document) => ({
    정비번호: document.id,
    작업명:
      document.fields.find((item) => item.key === 'service_item')
        ?.correctedValue ||
      document.fields.find((item) => item.key === 'service_item')
        ?.normalizedValue,
    금액: document.amount,
  }));
  const customerRows = approved.map((document) => ({
    고객ID: `customer-${document.id}`,
    고객명: document.customerName,
    병합상태: '미병합',
  }));
  const rentalRows = approved
    .filter((document) => document.amount === 0)
    .map((document) => ({
      정비번호: document.id,
      기준가: document.amount,
      고객결제액: 0,
      업체청구액: '',
      입금액: '',
      미수금: '',
      정산상태: '검수필요',
    }));
  const ruleRows = [
    { 구분: '자동등록', 기준: '필수 필드 신뢰도', 값: '96%' },
    { 구분: '금액', 기준: '개인 정비 0원', 값: '검수 필요' },
    { 구분: '매장', 기준: '미판독', 값: '미확인 유지' },
  ];
  const sheets = [orderRows, itemRows, customerRows, rentalRows, ruleRows];
  LEGACY_SHEET_NAMES.forEach((name, index) => {
    const sheet = XLSX.utils.json_to_sheet(sheets[index]);
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  });
  return workbook;
}

export function downloadLegacyWorkbook(documents: ReviewDocument[]) {
  XLSX.writeFile(buildLegacyWorkbook(documents), '정비내역서_내보내기.xlsx');
}

export const SHEET_ALIASES: Record<string, string[]> = {
  정비내역: [
    '정비내역',
    '정비내역서',
    '정비 내역',
    '정비 내역서',
    '정비',
    '정비목록',
    '정비 목록',
    '정비이력',
    '정비대장',
    '정비접수',
    '수리내역',
    '수리내역서',
    '정비원장',
    '정비실적',
  ],
  정비항목: [
    '정비항목',
    '정비 항목',
    '매장별 매출',
    '매장별매출',
    '매출',
    '매출내역',
    '작업항목',
    '작업 항목',
    '수리항목',
    '부품공임',
    '공임내역',
    '항목별매출',
  ],
  고객목록: [
    '고객목록',
    '고객 목록',
    '고객명단',
    '고객',
    '고객관리',
    '회원목록',
    '차주목록',
    '고객정보',
    '고객원장',
  ],
  렌트리스: [
    '렌트리스',
    '렌트 관리',
    '렌트관리',
    '렌트/리스',
    '렌트·리스',
    '렌트',
    '리스',
    '렌트차량',
    '렌트이력',
    '대여관리',
    '배차관리',
  ],
  기준정보: [
    '기준정보',
    '기준 정보',
    '차종 높임표',
    '차종높임표',
    '차종 일람표',
    '차종일람표',
    '차종표',
    '단가표',
    '공임표',
    '기본정보',
    '차종정보',
    '기초정보',
    '코드정보',
  ],
};

export function findMatchingSheetName(
  sheetNames: string[],
  category: string,
): string | null {
  const aliases = SHEET_ALIASES[category] || [category];
  for (const name of sheetNames) {
    const normalizedName = name.replace(/\s+/g, '').toLowerCase();
    if (
      aliases.some(
        (alias) => alias.replace(/\s+/g, '').toLowerCase() === normalizedName,
      )
    ) {
      return name;
    }
  }
  return null;
}

export function inspectLegacyWorkbook(data: ArrayBuffer) {
  const workbook = XLSX.read(data, { type: 'array' });
  const missingSheets: string[] = [];

  for (const standardName of LEGACY_SHEET_NAMES) {
    const matched = findMatchingSheetName(workbook.SheetNames, standardName);
    if (!matched) {
      missingSheets.push(standardName);
    }
  }

  const orderSheetName = findMatchingSheetName(workbook.SheetNames, '정비내역');
  const rows = (
    orderSheetName && workbook.Sheets[orderSheetName]
      ? XLSX.utils.sheet_to_json<Record<string, unknown>>(
          workbook.Sheets[orderSheetName],
        )
      : []
  ).filter((r) => Object.values(r).some((v) => v !== null && v !== undefined && v !== ''));

  const revenue = rows.reduce((sum, row) => {
    const rawVal =
      row['합계금액'] ??
      row['합계'] ??
      row['금액'] ??
      row['총금액'] ??
      row['총액'] ??
      row['결제금액'] ??
      row['결제액'] ??
      row['매출금액'] ??
      row['매출액'] ??
      row['공임'] ??
      row['수리비'] ??
      row['수리금액'] ??
      0;
    if (typeof rawVal === 'number') return sum + rawVal;
    if (typeof rawVal === 'string') {
      const clean = Number(rawVal.replace(/[^\d.-]/g, ''));
      return sum + (isNaN(clean) ? 0 : clean);
    }
    return sum;
  }, 0);

  return {
    sheetNames: workbook.SheetNames,
    missingSheets,
    orderCount: rows.length,
    revenue,
  };
}
