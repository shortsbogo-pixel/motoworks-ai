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

export function inspectLegacyWorkbook(data: ArrayBuffer) {
  const workbook = XLSX.read(data, { type: 'array' });
  const missingSheets = LEGACY_SHEET_NAMES.filter(
    (name) => !workbook.SheetNames.includes(name),
  );
  const rows = workbook.Sheets['정비내역']
    ? XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets['정비내역'],
      )
    : [];
  const revenue = rows.reduce(
    (sum, row) => sum + Number(row['합계금액'] ?? row['금액'] ?? 0),
    0,
  );
  return {
    sheetNames: workbook.SheetNames,
    missingSheets,
    orderCount: rows.length,
    revenue,
  };
}
