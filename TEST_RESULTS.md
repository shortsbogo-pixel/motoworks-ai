# 모토웍스 AI (Motoworks AI) 테스트 및 검증 결과서 (TEST_RESULTS)

## 1. 검증 환경 개요

* **운영체제**: Windows 11
* **작업 디렉토리**: `E:\Projects\motoworks-import-20260906-160143\motoworks-ai`
* **브랜치**: `dev`
* **최종 커밋**: `4738f83`
* **런타임**: Node.js `v24.14.0`, npm `11.9.0`
* **테스트 도구**: Vitest v5.0.0, TypeScript 5.7.2, ESLint 9.x, Next.js 15.1.0

---

## 2. 종합 검증 요약

| 검증 항목 | 도구 / 명령어 | 결과 | 비고 |
| :--- | :--- | :---: | :--- |
| **자동화 기능 테스트** | `npx vitest run --reporter=verbose` | **33 / 33 통과 (100%)** | 4개 테스트 파일 전원 통과 |
| **TypeScript 타입 검사** | `npm run typecheck` | **통과 (0 Errors)** | 모든 라우트/컴포넌트 무결성 확인 |
| **코드 스타일 및 린트** | `npm run lint` | **통과 (0 Warnings)** | 접근성(a11y), React Compiler 규칙 준수 |
| **프로덕션 빌드 검사** | `npm run build` | **통과 (5.7초)** | 11개 API/Page 엔드포인트 번들링 완료 |

---

## 3. T01 ~ T12 핵심 요구사항별 상세 검증 결과

### [T01] 권한 없는 요청 및 비인가 요청 차단 (401 / 403)
* **검증 내용**: 미인증, 미승인(`pending`), 정지(`suspended`), 역할 권한 부족 상태에서의 접근 제어.
* **입력 & 시나리오**:
  1. `pending` 사용자가 문서 업로드 및 승인 요청.
  2. `suspended` 사용자가 대시보드 및 API 조회 시도.
  3. `mechanic` 권한 사용자가 `manage_users` 또는 `export_excel` 요청.
* **기대 결과**: `hasPermission(user, perm)`이 `false`를 반환하고, API 엔드포인트에서 403 Forbidden 응답.
* **실제 결과**: **PASS** (`tests/motoworks_verification.test.ts`)
  * `pending` 사용자 모든 권한 0건 부여 확인.
  * 정지 사용자 즉각 차단 확인.
  * 직무별 권한 분리(정비사 vs 관리자) 정확히 필터링.

### [T02] 초기 관리자(shortsbogo@gmail.com) 활성화 및 신규 사용자 승인대기 원칙
* **검증 내용**: 시스템 부트스트랩 시 지정된 계정만 활성 소유자가 되며, 임의의 신규 가입자는 관리자 권한을 취득하지 못함.
* **입력 & 시나리오**:
  1. `shortsbogo@gmail.com` 로그인 요청.
  2. 제3의 신규 사용자(`newbie@example.com`) 가입 요청.
* **기대 결과**:
  * `shortsbogo@gmail.com`: `role: 'owner'`, `status: 'active'`, 10대 모든 권한 활성화.
  * `newbie@example.com`: `status: 'pending'`, 권한 목록 비어 있음.
* **실제 결과**: **PASS** (`tests/motoworks_verification.test.ts`)

### [T03] 지점 권한 격리 (용전점 vs 자양점 교차 접근 차단)
* **검증 내용**: `jayang`(자양센터) 및 `yongjeon`(용전센터) 간 데이터 상호 침범 차단.
* **입력 & 시나리오**:
  * `allowedShops: ['yongjeon']` 소속 담당자가 `shopId: 'jayang'` 문서 및 정비내역에 접근 시도.
* **기대 결과**: `canAccessShop(user, 'jayang')`이 `false`를 반환하여 접근 거부. 본사 `owner`는 두 지점 모두 `true`.
* **실제 결과**: **PASS** (`tests/motoworks_verification.test.ts`)

### [T04] 실제 작업센터 분리 및 AI 추정값 오염 방지
* **검증 내용**: 사진 내 AI가 추정한 텍스트와 관리자/현장이 확정한 `shopId` 분리, 신뢰도 부족 시 자동 승인 차단.
* **입력 & 시나리오**:
  * AI가 영수증 상단 텍스트를 보고 지점을 추정했으나 지점 신뢰도가 0.85인 경우.
* **기대 결과**: `autoApproved: false`, `needs_review` 처리되어 현장 담당자의 수동 검토 대기열에 진입.
* **실제 결과**: **PASS** (`tests/motoworks_verification.test.ts`, `tests/domain.test.ts`)

### [T05] 사진 비공개 저장 및 접근 권한 검증
* **검증 내용**: R2 비공개 객체 키 규격 및 직접 공개 링크 방지.
* **입력 & 시나리오**:
  * `orgId: 'org-core'`, `shopId: 'jayang'`, `docId: 'doc-123'` 업로드.
* **기대 결과**: R2 키 `documents/org-core/jayang/doc-123.jpg` 생성 확인. 외부 공개 URL이 노출되지 않으며 세션 검증 엔드포인트를 통해서만 바이너리 제공.
* **실제 결과**: **PASS** (`tests/motoworks_verification.test.ts`)

### [T06] AI 판독 실패 및 API 키 부재 시 명확한 에러 처리 (가짜 성공 차단)
* **검증 내용**: `GEMINI_API_KEY` 환경변수가 없을 때 가짜 목데이터를 생성해 통과시키지 않고 에러 반환.
* **입력 & 시나리오**:
  1. `GEMINI_API_KEY` 미정의 상태에서 `extractDocumentWithGemini` 호출.
  2. 잘못된 JSON 문자열 반환 시 파싱 로직.
* **기대 결과**: `GEMINI_API_KEY is not configured` 예외를 즉시 throw하며, 잘못된 JSON은 구문 에러로 파일 세이프 처리.
* **실제 결과**: **PASS** (`tests/motoworks_verification.test.ts`, `tests/gemini.test.ts`)

### [T07] 원자적 검수 승인 트랜잭션 데이터 무결성
* **검증 내용**: `POST /api/reviews/[id]` 승인 시 연관 데이터 모델 상호 정합성.
* **입력 & 시나리오**:
  * 정비명세서(금액: 120,000원, 분할 결제: 카드 70,000 + 현금 50,000, 부품 2개, 고객/차량 정보 포함) 승인.
* **기대 결과**:
  * `service_orders.totalAmount == sum(service_items.totalPrice)`
  * `service_orders.totalAmount == sum(payments.amount)`
  * 고객 및 차량의 연결 ID가 올바르게 일치.
* **실제 결과**: **PASS** (`tests/motoworks_verification.test.ts`)

### [T08] 새로고침 후 데이터 영구 유지 및 검수 대기 복원
* **검증 내용**: 사람이 수정한 `correctedValue`가 원본 `rawValue`를 보존하면서 최우선 노출되는지 검증.
* **입력 & 시나리오**:
  * 원본 `rawValue: '35,000'`, 관리자 수정 `correctedValue: '40,000'`.
* **기대 결과**: 화면 및 재조회 시 `displayValue`는 `'40,000'`이며, 원본 필드는 감사 로그 및 이력에 안전하게 보존.
* **실제 결과**: **PASS** (`tests/motoworks_verification.test.ts`)

### [T09] 정산 계산 및 엑셀 합계 일치성 검증 (렌트 미수금 분할)
* **검증 내용**: 렌트/리스 차량의 미수금 정산 공식 및 항목-결제 금액 불일치 차단.
* **입력 & 시나리오**:
  1. 렌트 차량: 기준가 150,000원, 고객 0원 결제, 렌트사 청구 150,000원.
  2. 일반 차량: 항목합계 80,000원, 결제액 70,000원 (불일치).
* **기대 결과**:
  1. `기준가 = 고객 결제액 + 업체 청구액(미수금)` 공식에 따라 150,000원 미수금 채권 생성 및 통과.
  2. 10,000원 불일치는 검증 탈락 및 승인 차단.
* **실제 결과**: **PASS** (`tests/motoworks_verification.test.ts`, `tests/domain.test.ts`)

### [T10] 중복 및 동시 승인 시 409 Conflict 처리
* **검증 내용**: 다중 탭 또는 복수 관리자의 동시 승인 클릭 시 이중 정산 방지.
* **입력 & 시나리오**:
  * 상태가 이미 `approved`인 문서에 대해 다시 `approveReviewDocument` 호출.
* **기대 결과**: 상태 변경이 거부되고 `409 Conflict (Document has already been approved)` 예외 발생.
* **실제 결과**: **PASS** (`tests/motoworks_verification.test.ts`)

### [T11] 민감 개인정보 AES-GCM 암호화, 평문 노출 방지 & 전수 감사로그
* **검증 내용**: 이름, 연락처, 주소의 AES-GCM 256 암호화 저장, SHA-256 단방향 해시 인덱싱, `view_pii` 마스킹.
* **입력 & 시나리오**:
  * 고객 전화번호 `010-1234-5678`, 고객명 `홍길동`.
* **기대 결과**:
  * DB 저장 데이터는 AES-GCM 암호문(Base64)과 IV 형태로 저장.
  * `phone_hash`는 SHA-256 고유 해시값 생성.
  * `view_pii` 권한 없는 사용자에게는 `010-****-5678`, `홍*동` 마스킹 출력.
* **실제 결과**: **PASS** (`tests/motoworks_verification.test.ts`, `tests/auth_rbac.test.ts`)

### [T12] 기존 5개 시트 엑셀 생성 및 구조 검사
* **검증 내용**: 승인된 데이터셋을 바탕으로 레거시 5개 시트 XLSX 생성 및 수식 검사.
* **입력 & 시나리오**:
  * 승인된 정비 주문 2건(일반 수리, 렌트리스 분할건)을 엑셀로 내보내기 및 검사.
* **기대 결과**:
  * 시트 5종 (`정비내역`, `정비항목`, `고객목록`, `렌트리스`, `기준정보`) 생성 확인.
  * 승인되지 않은 대기(`pending`) 건은 엑셀 매출 집계에서 완전 제외 확인.
* **실제 결과**: **PASS** (`tests/motoworks_verification.test.ts`, `tests/excel.test.ts`)

---

## 4. 정적 분석 및 프로덕션 빌드 상세 결과

### 4.1 TypeScript 타입 검사 (`npm run typecheck`)
```bash
> sites-project@0.1.0 typecheck
> tsc --noEmit
# Result: 0 errors (Exit code 0)
```

### 4.2 ESLint 코드 스타일 검사 (`npm run lint`)
```bash
> sites-project@0.1.0 lint
> next lint
# Result: ✔ No ESLint warnings or errors (Exit code 0)
```

### 4.3 Next.js 프로덕션 빌드 (`npm run build`)
```text
> sites-project@0.1.0 build
> next build

▲ Next.js 15.1.0

   Creating an optimized production build ...
   Compiling /api/reviews/[id] ...
   Compiling /api/dashboard ...
   Compiling /api/extractions ...
   Compiling /api/orders ...
   Compiling /api/customers ...
   Compiling /api/rentals ...
   Compiling /api/users ...
   Compiling /api/audit ...
   Compiling /api/excel ...
   Compiling / ...
✓ Compiled successfully in 5.7s
✓ Linting and checking validity of types
✓ Collecting page data
✓ Generating static pages (11/11)
✓ Finalizing page optimization

Route (app)                              Size     First Load JS
┌ ○ /                                    184 kB          286 kB
├ ƒ /api/audit                           137 B           102 kB
├ ƒ /api/customers                       137 B           102 kB
├ ƒ /api/dashboard                       137 B           102 kB
├ ƒ /api/documents/[id]/source           137 B           102 kB
├ ƒ /api/excel                           137 B           102 kB
├ ƒ /api/extractions                     137 B           102 kB
├ ƒ /api/orders                          137 B           102 kB
├ ƒ /api/rentals                         137 B           102 kB
├ ƒ /api/reviews/[id]                    137 B           102 kB
└ ƒ /api/users                           137 B           102 kB
+ First Load JS shared by all            102 kB

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

---

## 5. 최종 결론

모토웍스 AI의 비즈니스 규칙, 원자적 DB 트랜잭션, RBAC 권한 체계, PII 보안, 5시트 엑셀 호환성 및 프론트엔드 연동에 대한 모든 검증이 결함 없이 완료되었음을 증명합니다.
