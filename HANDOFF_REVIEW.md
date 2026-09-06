# 모토웍스 AI (Motoworks AI) 최종 인계 보고서 (HANDOFF_REVIEW)

## 1. 프로젝트 개요 및 배경

* **프로젝트명**: 모토웍스 AI (Motoworks AI) - 정비센터 업무 자동화 및 SaaS 관리 시스템
* **적용 대상**: 코아파트너스 (Core Partners) 소속 2개 정비센터
  * 코아바이크 자양센터 (`jayang`)
  * 진바이크 용전센터 (`yongjeon`)
* **목적**: 종이 정비명세서 및 영수증 사진 업로드, Gemini AI 기반 데이터 추출, 실시간 비즈니스 검증, 분할 결제 및 렌트/리스 미수금 분할 원자적 승인, 레거시 5시트 엑셀 호환 및 RBAC/PII 보안 체계를 갖춘 실제 운영 가능한 정비센터 통합 플랫폼 완성.

---

## 2. 작업 환경 및 메타데이터

* **작업 디렉토리**: `E:\Projects\motoworks-import-20260906-160143\motoworks-ai`
* **작업 브랜치**: `dev`
* **기반 커밋**: `4738f83` (`feat: complete Motoworks AI full production system with RBAC, atomic transactions, 5-sheet excel export/import, clean icons, and T01-T12 verification tests`)
* **런타임 환경**:
  * Node.js: `v24.14.0`
  * npm: `11.9.0`
  * Framework: Next.js 15.1.0 (App Router), React 19, TypeScript 5.7.2
  * Backend Platform: Cloudflare Pages / Workers / D1 (SQLite) / R2 Object Storage 바인딩 호환
* **운영 보호 원칙 준수**:
  * C: 드라이브 원본 수정 없음 (E: 드라이브 격리 개발)
  * `.openai/hosting.json`의 운영 식별자(`appgprj_6a9a86d675fc8191b525c166cd0e2bcd`)를 이용한 임의 배포 일체 차단
  * API Key 누락 시 가짜 목데이터(Mock) 생성 금지 및 Fail-Fast 원칙 준수

---

## 3. 핵심 시스템 아키텍처 및 구현 내역

### 3.1 역할 기반 접근 제어 (RBAC) 및 사용자 생명주기
* **초기 최고 관리자(Owner)**: `shortsbogo@gmail.com`이 시스템의 기본 `owner`로 등록되며 활성(`active`) 상태 유지.
* **신규 사용자 승인제**: 신규 가입 사용자는 무조건 `pending` 상태로 진입하며, 로그인만으로 권한이 승격되지 않음. `manage_users` 권한을 가진 관리자만이 활성화(`active`) 및 역할 부여 가능.
* **지점 격리 (Multi-Tenant & Shop Scoping)**:
  * `jayang`(자양센터) 소속 직원은 `yongjeon`(용전센터)의 문서, 정비내역, 고객 정보, 엑셀 데이터에 접근 불가 (`403 Forbidden` 또는 지점 스코프 필터링 적용).
  * `owner` 및 본사 관리자는 다중 지점(`allowedShops: ['jayang', 'yongjeon']`) 권한으로 통합 조회 가능.
* **커스텀 역할 지원**: 기본 역할(`owner`, `manager`, `mechanic`, `auditor`, `viewer`) 외에 동적 권한 조합을 지원하는 커스텀 역할 생성 및 할당 지원.

### 3.2 문서 업로드 및 R2 비공개 스토리지
* **비공개 스토리지 키 규격**: `documents/{orgId}/{shopId}/{docId}.jpg` 구조로 R2에 저장.
* **직접 노출 차단**: 공개 URL을 통한 원본 사진 열람을 차단하고, `/api/documents/[id]/source` 엔드포인트에서 사용자 세션 및 지점 접근 권한(`canAccessShop`)을 검증한 후 안전하게 스트리밍 반환.

### 3.3 Gemini 3.8 Flash AI 추출 파이프라인
* **모델 규격**: 최신 `gemini-3.8-flash` 지정 및 `thinkingLevel: medium` 적용.
* **Fail-Fast 원칙**: `GEMINI_API_KEY` 부재 시 임의의 가짜 목데이터(Mock)를 주입하지 않고 명확한 에러(`GEMINI_API_KEY is not configured`)를 즉시 반환하여 운영 장애 방지.
* **정합성 규칙 검증**:
  * 신뢰도 96% 미만 항목은 자동 승인 차단 및 `needs_review` 플래그 부여.
  * 정비 항목 금액 합계(`item total`) ≠ 결제 총액(`payment total`) 불일치 시 검증 오류 발생.
  * 일반 고객 0원 결제 차단.
  * 렌트/리스 차량 0원 결제 허용 및 자동 미수금 분할 처리:
    $$\text{기준가} = \text{고객 결제액} + \text{업체 청구액(미수금)}$$

### 3.4 원자적 검토 승인 트랜잭션 (`Atomic DB Batch`)
* **엔드포인트**: `POST /api/reviews/[id]`
* **동시성 충돌 방지**: 이미 승인된 문서(`approved`) 재승인 시도 시 `409 Conflict` 에러 반환.
* **`runtime.DB.batch` 단일 트랜잭션 보장**:
  1. `review_documents`: 상태를 `approved`로 업데이트, 승인자/승인일시 기록.
  2. `service_orders`: 승인된 정비 주문 마스터 레코드 생성.
  3. `service_items`: 정비 항목 상세(공임, 부품 등) 일괄 삽입.
  4. `payments`: 단일 또는 분할 결제(카드 + 현금 등) 내역 원자적 기록.
  5. `customers`: 전화번호 해시(`phone_hash`) 기반으로 기존 고객 조회 및 자동 생성/업데이트.
  6. `vehicles`: 차량번호 해시(`plate_hash`) 기반으로 차량 마스터 자동 등록 및 고객 연동.
  7. `receivables`: 렌트/리스 외상 및 미수금 발생 시 채권 마스터 자동 등록.
  8. `correction_logs`: 관리자가 AI 추출값을 수정한 경우 수정 이력(`field_name`, `original_value`, `corrected_value`) 기록.
  9. `audit_logs`: 문서 승인 감사 로그 기록.

### 3.5 개인정보 보호 (PII Security)
* **암호화 방식**: AES-GCM 256 암호화 (`crypto.subtle` 웹 표준 암호화 API 사용).
* **마스킹 정책**: `view_pii` 권한이 없는 일반 정비사 및 뷰어에게는 이름(`김*수`), 전화번호(`010-****-1234`), 주소(`서울 광진구 ***`) 마스킹 적용.
* **복호화 통제**: `view_pii` 권한을 명시적으로 가진 관리자에게만 원본 복호화 데이터 제공.

### 3.6 레거시 5개 시트 엑셀 호환 엔진
* **지원 시트 구성**:
  1. `정비내역`: 접수일자, 차량번호, 고객명, 총금액, 결제수단, 정비상태 등
  2. `정비항목`: 주문ID, 항목명, 수량, 단가, 공임, 합계금액
  3. `고객목록`: 고객ID, 고객명, 연락처, 주소, 등록차량, 최근방문일
  4. `렌트리스`: 미수금ID, 정비ID, 차량번호, 계약업체, 기준가, 결제액, 청구미수금
  5. `기준정보`: 지점 목록, 정비 항목 단가표, 결제 수단 코드, 권한 코드
* **양방향 지원**:
  * `GET /api/excel`: 최신 DB 데이터를 기반으로 5개 시트 통합 XLSX 생성 및 다운로드.
  * `POST /api/excel`: 업로드된 XLSX 파일의 5개 시트 구조 및 데이터 정합성 검증 (`inspectLegacyWorkbook`).

### 3.7 UI 전면 연동 (AppShell)
* `components/app-shell.tsx`에서 모든 화면에 라이브 백엔드 API를 완벽 연동:
  * 대시보드 (`/api/dashboard` 통계, 지점별 매출, 미수금 현황)
  * 명세서 업로드 (`/api/extractions` 파일 업로드 및 AI 분석)
  * 검토/승인 (`/api/extractions?status=all`, `/api/reviews/[id]` 승인 및 수정)
  * 정비내역 (`/api/orders` 정비 주문, 항목, 결제 내역 조회)
  * 고객관리 (`/api/customers` 고객 및 차량, 병합 후보 분석)
  * 렌트/미수금 (`/api/rentals` 미수금 추적 및 업체 청구)
  * 통계/분석 (지점별, 결제수단별 매출 차트)
  * 엑셀관리 (`/api/excel` 5개 시트 엑셀 내보내기/검사)
  * 사용자관리 (`/api/users` 대기 사용자 활성화 및 권한 설정)
  * 감사로그 (`/api/audit` 시스템 보안 및 작업 이력 추적)
* `components/icons.tsx`: 누락 및 손상된 lucide 아이콘 의존성을 완전히 대체하는 자체 경량 SVG 아이콘 시스템 구현.

---

## 4. 검증 결과 요약

모든 자동화 테스트 및 정적 분석, 프로덕션 빌드가 100% 통과되었습니다. (상세 내용은 `TEST_RESULTS.md` 참조)

* **Vitest 자동화 테스트**: **4개 파일, 33개 테스트 케이스 전원 통과 (100% Pass)**
  * `tests/motoworks_verification.test.ts` (T01 ~ T12 전 요구사항 검증: 12개 테스트 통과)
  * `tests/domain_core.test.ts` (비즈니스 룰 및 렌트미수금/정합성: 9개 테스트 통과)
  * `tests/excel_compatibility.test.ts` (5시트 엑셀 입출력 검증: 5개 테스트 통과)
  * `tests/auth_rbac.test.ts` (RBAC, PII 암호화/마스킹: 7개 테스트 통과)
* **TypeScript 타입 검사 (`npm run typecheck`)**: 오류 0건 (Clean)
* **ESLint 정적 분석 (`npm run lint`)**: 오류 0건, 경고 0건 (Clean)
* **Next.js 프로덕션 빌드 (`npm run build`)**: 11개 API/Page 라우트 정상 컴파일 및 정적 최적화 완료 (5.7초 완료)

---

## 5. 전달 아티팩트 목록

1. `HANDOFF_REVIEW.md` (본 문서): 시스템 아키텍처, 구현 세부사항, 운영 인계 지침
2. `TEST_RESULTS.md`: T01~T12 및 전 테스트 결과, 입력/기대값/실제값 상세 로그
3. `REVIEW_PROMPT.md`: ChatGPT (GPT-4o/o1/o3-mini) 또는 Claude (3.5/3.7 Sonnet) 독립 검토용 정밀 프롬프트
4. `motoworks-ai-clean.zip`: 클린 소스 코드 배포 패키지 (`node_modules`, `.git`, `.next` 등 제외)

---

## 6. 운영 배포 전 확인 체크리스트 및 보호 조치

1. **운영 호스팅 배포 금지 준수**: 사용자 명시적 승인 전까지 `.openai/hosting.json`의 운영 호스팅 배포를 실행하지 않습니다.
2. **Cloudflare D1 & R2 프로덕션 바인딩**:
   * 운영 전환 시 Cloudflare 대시보드에서 프로덕션 D1 데이터베이스(`motoworks-db`) 및 R2 버킷(`motoworks-documents`) 바인딩 설정 필요.
   * D1 마이그레이션 실행: `npx wrangler d1 migrations apply motoworks-db --remote`
3. **환경 변수 설정**:
   * `GEMINI_API_KEY`: Google AI Studio에서 발급받은 실제 API Key 등록.
   * `PII_ENCRYPTION_KEY`: 32바이트 이상의 프로덕션용 비밀키 등록.
   * `JWT_SECRET`: 세션 인증용 비밀키 등록.
4. **초기 관리자 로그인**:
   * `shortsbogo@gmail.com`으로 최초 로그인 시 자동으로 `owner` 권한 부여 및 시스템 설정 가능.
