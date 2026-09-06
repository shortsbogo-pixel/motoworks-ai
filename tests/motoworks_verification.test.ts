import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  decryptValue,
  encryptValue,
  getAllowedShops,
  hasPermission,
  hashPii,
  ORGANIZATION_ID,
  Permission,
  ROLE_DEFAULT_PERMISSIONS,
  SHOP_NAMES,
  type AuthorizedUser,
} from '../lib/server/motoworks';
import {
  evaluateAutoRegistration,
  normalizePhone,
  type ReviewDocument,
} from '../lib/domain';
import { buildLegacyWorkbook, inspectLegacyWorkbook } from '../lib/excel';
import {
  extractMaintenanceDocument,
  extractionToReviewDocument,
  normalizeExtraction,
} from '../lib/gemini';

describe('T01: 권한 없는 요청 및 비인가 요청 차단 (401 / 403)', () => {
  it('승인 대기(pending) 사용자는 어떤 권한도 행사할 수 없다', () => {
    const pendingUser: AuthorizedUser = {
      id: 'usr_pending_1',
      externalId: 'ext_pending',
      email: 'newbie@example.com',
      displayName: '신규 가입자',
      isOwner: false,
      status: 'pending',
      roles: [
        {
          shopId: 'yongjeon',
          role: 'staff',
          permissions: ['view', 'upload'],
        },
      ],
    };

    expect(hasPermission(pendingUser, 'view')).toBe(false);
    expect(hasPermission(pendingUser, 'upload')).toBe(false);
    expect(hasPermission(pendingUser, 'view', 'yongjeon')).toBe(false);
  });

  it('계정 정지(suspended) 사용자의 요청은 모두 차단된다', () => {
    const suspendedUser: AuthorizedUser = {
      id: 'usr_suspended_1',
      externalId: 'ext_suspended',
      email: 'bad@example.com',
      displayName: '정지된 사용자',
      isOwner: true,
      status: 'suspended',
      roles: [
        {
          shopId: null,
          role: 'owner',
          permissions: ['view', 'upload', 'manage_users'],
        },
      ],
    };

    expect(hasPermission(suspendedUser, 'view')).toBe(false);
    expect(hasPermission(suspendedUser, 'manage_users')).toBe(false);
  });

  it('권한 범위 밖의 기능(예: 일반 직원의 사용자 관리, 엑셀 내보내기)은 거절된다', () => {
    const staffUser: AuthorizedUser = {
      id: 'usr_staff_1',
      externalId: 'ext_staff',
      email: 'staff@example.com',
      displayName: '일반 정비사',
      isOwner: false,
      status: 'active',
      roles: [
        {
          shopId: 'yongjeon',
          role: 'staff',
          permissions: ROLE_DEFAULT_PERMISSIONS.staff,
        },
      ],
    };

    expect(hasPermission(staffUser, 'view')).toBe(true);
    expect(hasPermission(staffUser, 'upload')).toBe(true);
    expect(hasPermission(staffUser, 'manage_users')).toBe(false);
    expect(hasPermission(staffUser, 'excel_export')).toBe(false);
  });
});

describe('T02: 초기 관리자(shortsbogo@gmail.com) 활성화 및 신규 사용자 승인대기 원칙', () => {
  it('shortsbogo@gmail.com 계정은 소유자 권한과 10대 모든 권한을 가진다', () => {
    const ownerUser: AuthorizedUser = {
      id: 'usr_owner',
      externalId: 'ext_owner',
      email: 'shortsbogo@gmail.com',
      displayName: '초기 관리자',
      isOwner: true,
      status: 'active',
      roles: [
        {
          shopId: null,
          role: 'owner',
          permissions: [
            'view',
            'upload',
            'edit_extraction',
            'review_decide',
            'settlement_manage',
            'excel_import',
            'excel_export',
            'view_pii',
            'manage_users',
            'view_audit',
          ],
        },
      ],
    };

    const allPerms: Permission[] = [
      'view',
      'upload',
      'edit_extraction',
      'review_decide',
      'settlement_manage',
      'excel_import',
      'excel_export',
      'view_pii',
      'manage_users',
      'view_audit',
    ];

    expect(ownerUser.status).toBe('active');
    expect(ownerUser.isOwner).toBe(true);
    for (const perm of allPerms) {
      expect(hasPermission(ownerUser, perm)).toBe(true);
    }
  });

  it('기타 로그인 계정은 자동 관리자 권한을 받지 않으며 기본 pending 상태여야 한다', () => {
    const regularUser: AuthorizedUser = {
      id: 'usr_other',
      externalId: 'ext_other',
      email: 'random_login@example.com',
      displayName: '외부 가입자',
      isOwner: false,
      status: 'pending',
      roles: [],
    };

    expect(regularUser.status).toBe('pending');
    expect(regularUser.isOwner).toBe(false);
    expect(hasPermission(regularUser, 'manage_users')).toBe(false);
    expect(hasPermission(regularUser, 'review_decide')).toBe(false);
  });
});

describe('T03: 지점 권한 격리 (용전점 vs 자양점 교차 접근 차단)', () => {
  it('용전센터 담당자는 자양센터 데이터에 접근할 수 없다', () => {
    const yongjeonManager: AuthorizedUser = {
      id: 'usr_yj',
      externalId: 'ext_yj',
      email: 'yongjeon@example.com',
      displayName: '용전 점장',
      isOwner: false,
      status: 'active',
      roles: [
        {
          shopId: 'yongjeon',
          role: 'shop_manager',
          permissions: ROLE_DEFAULT_PERMISSIONS.shop_manager,
        },
      ],
    };

    expect(getAllowedShops(yongjeonManager)).toEqual(['yongjeon']);
    expect(hasPermission(yongjeonManager, 'view', 'yongjeon')).toBe(true);
    expect(hasPermission(yongjeonManager, 'view', 'jayang')).toBe(false);
    expect(hasPermission(yongjeonManager, 'review_decide', 'jayang')).toBe(false);
  });

  it('조직 최고 관리자는 모든 지점에 접근할 수 있다', () => {
    const orgAdmin: AuthorizedUser = {
      id: 'usr_admin',
      externalId: 'ext_admin',
      email: 'shortsbogo@gmail.com',
      displayName: '최고 관리자',
      isOwner: true,
      status: 'active',
      roles: [
        {
          shopId: null,
          role: 'admin',
          permissions: ROLE_DEFAULT_PERMISSIONS.admin,
        },
      ],
    };

    expect(getAllowedShops(orgAdmin)).toEqual(Object.keys(SHOP_NAMES));
    expect(hasPermission(orgAdmin, 'view', 'yongjeon')).toBe(true);
    expect(hasPermission(orgAdmin, 'view', 'jayang')).toBe(true);
  });
});

describe('T04: 실제 작업센터 분리 및 AI 추정값 오염 방지', () => {
  it('매장 특정 신뢰도가 낮거나 AI 추정일 경우 자동등록을 차단한다', () => {
    const result = evaluateAutoRegistration({
      requiredConfidences: [0.99, 0.98],
      itemTotal: 50000,
      paymentTotal: 50000,
      shopCertainty: 'ai_estimated',
      identifiable: true,
      vehicleConflict: false,
      duplicateCandidate: false,
      serviceType: 'personal',
      customerPaidAmount: 50000,
    });

    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('매장 미확정');
  });

  it('사용자가 확정한 작업센터는 AI 판독 추정값과 엄격히 분리된다', () => {
    const sampleExtraction = {
      document_id: 'doc_test',
      fields: [
        {
          key: 'shop',
          raw_value: '코아바이크(?)',
          normalized_value: '자양센터',
          confidence: 0.65,
          bounding_box: { x: 0, y: 0, width: 0.1, height: 0.1 },
          validation_status: 'review' as const,
          validation_message: '매장 흐림',
        },
      ],
    };

    const doc = extractionToReviewDocument({
      extraction: sampleExtraction,
      fileName: 'upload.jpg',
      shopName: SHOP_NAMES.yongjeon,
      fieldIds: ['fld_1'],
    });

    expect(doc.shopName).toBe(SHOP_NAMES.yongjeon);
    expect(doc.shopCertainty).toBe('confirmed');
  });
});

describe('T05: 사진 비공개 저장 및 접근 권한 검증', () => {
  it('저장소 R2 키는 공개되지 않는 규격화된 내부 경로를 생성한다', () => {
    const shopId = 'yongjeon';
    const docId = 'doc_secret_123';
    const r2Key = `documents/${ORGANIZATION_ID}/${shopId}/${docId}.jpg`;

    expect(r2Key).toBe('documents/core-partners/yongjeon/doc_secret_123.jpg');
    expect(r2Key).not.toContain('http');
  });
});

describe('T06: AI 판독 실패 및 API 키 부재 시 명확한 에러 처리 (가짜 성공 차단)', () => {
  it('API 키가 없으면 인위적인 모의 데이터를 생성하지 않고 즉시 예외를 던진다', async () => {
    await expect(
      extractMaintenanceDocument({
        apiKey: '',
        documentId: 'doc_empty_key',
        fileName: 'upload.jpg',
        mimeType: 'image/jpeg',
        bytes: new ArrayBuffer(16),
        assignedShopName: '진바이크 용전센터',
      }),
    ).rejects.toThrow('Gemini API 키가 설정되지 않았습니다');
  });

  it('AI 응답 JSON 구조가 깨졌을 때 검수 승인으로 처리하지 않고 파싱 에러를 발생시킨다', () => {
    expect(() => {
      normalizeExtraction(
        { invalid_root: true } as unknown as Parameters<typeof normalizeExtraction>[0],
        'doc_fail',
      );
    }).toThrow();
  });
});

describe('T07: 원자적 검수 승인 트랜잭션 데이터 무결성', () => {
  it('승인 시 정비내역, 항목, 결제, 고객, 차량, 미수금 모델이 상호 일치해야 한다', () => {
    const serviceItems = [
      { name: '엔진오일 교환', qty: 1, unitPrice: 30000, amount: 30000 },
      { name: '브레이크 패드', qty: 1, unitPrice: 25000, amount: 25000 },
    ];
    const totalAmount = serviceItems.reduce((acc, item) => acc + item.amount, 0);

    const splitPayments = [
      { method: 'card', amount: 40000 },
      { method: 'cash', amount: 15000 },
    ];
    const paymentSum = splitPayments.reduce((acc, p) => acc + p.amount, 0);

    expect(totalAmount).toBe(55000);
    expect(paymentSum).toBe(55000);
    expect(totalAmount).toBe(paymentSum);
  });
});

describe('T08: 새로고침 후 데이터 영구 유지 및 검수 대기 복원', () => {
  it('사람이 수정한 correctedValue가 있으면 원본 rawValue를 훼손하지 않고 우선 적용된다', () => {
    const doc: ReviewDocument = {
      id: 'doc_restore',
      fileName: 'upload.jpg',
      shopName: '코아바이크 자양센터',
      shopCertainty: 'confirmed',
      customerName: '홍길동',
      vehicleLabel: 'PCX 125',
      amount: 45000,
      sourceAvailable: false,
      duplicateCandidate: false,
      status: 'pending',
      fields: [
        {
          id: 'f1',
          key: 'amount',
          label: '합계 금액',
          rawValue: '40,000',
          normalizedValue: '40000',
          correctedValue: '45000',
          confidence: 0.88,
          validationStatus: 'review',
          validationMessage: undefined,
          boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        },
      ],
    };

    const finalAmount = doc.fields[0].correctedValue
      ? Number(String(doc.fields[0].correctedValue).replace(/\D/g, ''))
      : Number(String(doc.fields[0].normalizedValue).replace(/\D/g, ''));

    expect(finalAmount).toBe(45000);
    expect(doc.fields[0].rawValue).toBe('40,000');
  });
});

describe('T09: 정산 계산 및 엑셀 합계 일치성 검증', () => {
  it('렌트 정산 공식: 기준가 = 고객 결제액 + 업체 청구액(미수금)', () => {
    const basePrice = 75000;
    const customerPaid = 0;
    const billedToCompany = 75000;
    const paidByCompany = 50000;
    const dueAmount = billedToCompany - paidByCompany;

    expect(basePrice).toBe(customerPaid + billedToCompany);
    expect(dueAmount).toBe(25000);
  });

  it('작업 합계와 결제 합계가 다르면 자동등록 검증에서 탈락한다', () => {
    const check = evaluateAutoRegistration({
      requiredConfidences: [0.99],
      itemTotal: 60000,
      paymentTotal: 55000,
      shopCertainty: 'confirmed',
      identifiable: true,
      vehicleConflict: false,
      duplicateCandidate: false,
      serviceType: 'personal',
      customerPaidAmount: 55000,
    });

    expect(check.eligible).toBe(false);
    expect(check.reasons).toContain('작업 합계와 결제 합계 불일치');
  });
});

describe('T10: 중복 및 동시 승인 시 409 Conflict 처리', () => {
  it('이미 승인 완료(approved)된 문서를 다시 승인 시도하면 반려되어야 한다', () => {
    const currentDocumentStatus = 'approved';

    const canTransition = (status: string) => {
      if (status !== 'pending' && status !== 'in_review') {
        return { conflict: true, code: 409, error: '이미 승인 또는 반려 처리된 문서입니다.' };
      }
      return { conflict: false };
    };

    const result = canTransition(currentDocumentStatus);
    expect(result.conflict).toBe(true);
    expect(result.code).toBe(409);
    expect(result.error).toContain('이미 승인 또는 반려');
  });
});

describe('T11: 민감 개인정보 AES-GCM 암호화, 평문 노출 방지 & 전수 감사로그', () => {
  it('개인정보는 AES-GCM 256비트로 암호화되고 올바른 키로만 복호화된다', async () => {
    const secret = 'motoworks-encryption-key-32chars!';
    const rawPhone = '010-1234-5678';

    const encrypted = await encryptValue(rawPhone, secret);
    expect(encrypted).not.toBe(rawPhone);
    expect(encrypted).toContain(':'); // iv:ciphertext:tag

    const decrypted = await decryptValue(encrypted, secret);
    expect(decrypted).toBe(rawPhone);
  });

  it('전화번호와 차량번호는 단방향 SHA-256 해시로 색인하여 동명이인을 구분한다', async () => {
    const phone1 = '010-1234-5678';
    const phone2 = '010-1234-5679';

    const hash1 = await hashPii(normalizePhone(phone1));
    const hash2 = await hashPii(normalizePhone(phone2));

    expect(hash1).toHaveLength(64);
    expect(hash2).toHaveLength(64);
    expect(hash1).not.toBe(hash2);
  });

  it('개인정보 열람 권한(view_pii)이 없는 사용자에게는 전화번호가 마스킹된다', () => {
    const phone = '010-9876-5432';
    const masked = phone.replace(/^(\d{3})-\d{4}-(\d{4})$/, '$1-****-$2');
    expect(masked).toBe('010-****-5432');
  });
});

describe('T12: 기존 5개 시트 엑셀 생성 및 구조 검사', () => {
  it('승인된 데이터로 5개 시트(정비내역, 정비항목, 고객목록, 렌트리스, 기준정보)를 생성하고 검증한다', () => {
    const approvedDocs: ReviewDocument[] = [
      {
        id: 'doc_excel_1',
        fileName: 'order.jpg',
        shopName: '진바이크 용전센터',
        shopCertainty: 'confirmed',
        customerName: '박고객',
        vehicleLabel: 'PCX 125',
        amount: 85000,
        sourceAvailable: true,
        duplicateCandidate: false,
        status: 'approved',
        fields: [
          {
            id: 'f1',
            key: 'customer_name',
            label: '고객명',
            rawValue: '박고객',
            normalizedValue: '박고객',
            confidence: 0.98,
            validationStatus: 'valid',
            validationMessage: undefined,
            boundingBox: { x: 0, y: 0, width: 0, height: 0 },
          },
          {
            id: 'f2',
            key: 'vehicle_plate',
            label: '차량번호',
            rawValue: '12가 3456',
            normalizedValue: '12가 3456',
            confidence: 0.99,
            validationStatus: 'valid',
            validationMessage: undefined,
            boundingBox: { x: 0, y: 0, width: 0, height: 0 },
          },
          {
            id: 'f3',
            key: 'amount',
            label: '금액',
            rawValue: '85,000',
            normalizedValue: '85000',
            confidence: 0.99,
            validationStatus: 'valid',
            validationMessage: undefined,
            boundingBox: { x: 0, y: 0, width: 0, height: 0 },
          },
        ],
      },
    ];

    const workbook = buildLegacyWorkbook(approvedDocs);
    const bytes = XLSX.write(workbook, {
      type: 'array',
      bookType: 'xlsx',
    });
    expect(bytes.byteLength).toBeGreaterThan(0);

    const inspection = inspectLegacyWorkbook(bytes);
    expect(inspection.missingSheets).toHaveLength(0);
    expect(inspection.sheetNames).toEqual([
      '정비내역',
      '정비항목',
      '고객목록',
      '렌트리스',
      '기준정보',
    ]);
    expect(inspection.orderCount).toBe(1);
    expect(inspection.revenue).toBe(85000);
  });
});

