import type { ExtractedField, ReviewDocument } from './domain';

const expectedFiles = Array.from({ length: 12 }, (_, index) =>
  index === 0
    ? 'KakaoTalk_20260904_152111642.jpg'
    : `KakaoTalk_20260904_152111642_${String(index).padStart(2, '0')}.jpg`,
);

const field = (
  id: string,
  key: string,
  label: string,
  rawValue: string,
  normalizedValue: string,
  confidence: number,
  validationStatus: ExtractedField['validationStatus'],
  validationMessage?: string,
): ExtractedField => ({
  id,
  key,
  label,
  rawValue,
  normalizedValue,
  confidence,
  boundingBox: {
    x: 8 + Number(id.slice(-1)) * 2,
    y: 18 + Number(id.slice(-1)) * 8,
    width: 38,
    height: 7,
  },
  validationStatus,
  validationMessage,
});

export const expectedReviewDocuments: ReviewDocument[] = expectedFiles.map(
  (fileName, index) => {
    const uncertain = index % 3;
    const amount = [35000, 68000, 0, 45000, 92000, 28000][index % 6];
    return {
      id: `doc-0903-${String(index + 1).padStart(2, '0')}`,
      fileName,
      shopName:
        uncertain === 0
          ? '미확인'
          : uncertain === 1
            ? '진바이크 용전점'
            : '코아바이크 자양점',
      shopCertainty: uncertain === 0 ? 'unknown' : 'ai_estimated',
      customerName: ['김○수', '박○진', '이○호', '최○민'][index % 4],
      vehicleLabel: ['PCX (배기량 검수)', 'NMAX 125', '보이저 (모델 검수)'][
        index % 3
      ],
      amount,
      status: 'pending',
      sourceAvailable: false,
      duplicateCandidate: index === 7,
      fields: [
        field(
          `${index}-1`,
          'service_date',
          '정비일',
          '9/3',
          '2026-09-03',
          0.97,
          'valid',
        ),
        field(
          `${index}-2`,
          'shop',
          '매장',
          uncertain === 0 ? '' : uncertain === 1 ? '용전?' : '자양',
          uncertain === 0
            ? ''
            : uncertain === 1
              ? '진바이크 용전점'
              : '코아바이크 자양점',
          uncertain === 0 ? 0.41 : 0.88,
          'review',
          '매장 표시는 사람이 확인해야 합니다.',
        ),
        field(
          `${index}-3`,
          'vehicle_model',
          '차종',
          index % 3 === 0 ? 'PCX' : index % 3 === 1 ? 'N맥스125' : '보이져',
          index % 3 === 1 ? 'NMAX 125' : '',
          index % 3 === 1 ? 0.94 : 0.72,
          'review',
          '제조사·배기량·연식 후보를 확인하세요.',
        ),
        field(
          `${index}-4`,
          'service_item',
          '작업 항목',
          index % 2 ? '엔진오일' : '앞브레이크 패드',
          index % 2 ? '엔진오일 교환' : '앞 브레이크 패드 교환',
          0.93,
          'review',
          '지점별 작업명 별칭 후보입니다.',
        ),
        field(
          `${index}-5`,
          'amount',
          '금액',
          amount ? String(amount) : '0',
          String(amount),
          amount === 0 ? 0.82 : 0.98,
          amount === 0 ? 'review' : 'valid',
          amount === 0 ? '렌트 정비 여부 확인이 필요합니다.' : undefined,
        ),
      ],
    };
  },
);

export const baselineReference = {
  verified: false,
  sourceAvailable: false,
  serviceOrders: 211,
  serviceItems: 324,
  revenue: 6_493_000,
  customers: 178,
  rentalOrders: 54,
  rentalVehicles: 36,
  period: '2026-08-14 ~ 2026-09-02',
  shops: [
    { name: '진바이크 용전점', orders: 96, revenue: 2_670_000 },
    { name: '코아바이크 자양점', orders: 115, revenue: 3_823_000 },
  ],
};

export const recentOrders = [
  {
    id: 'SO-260902-211',
    customer: '김○수',
    vehicle: 'PCX 125 · 23가 4***',
    shop: '진바이크 용전점',
    amount: 45000,
    status: '승인',
  },
  {
    id: 'SO-260902-210',
    customer: '박○진',
    vehicle: 'NMAX 125 · 대전 1***',
    shop: '코아바이크 자양점',
    amount: 78000,
    status: '승인',
  },
  {
    id: 'SO-260901-208',
    customer: '렌트 A사',
    vehicle: '보이저 125 · 18하 2***',
    shop: '진바이크 용전점',
    amount: 0,
    status: '업체 청구',
  },
];
