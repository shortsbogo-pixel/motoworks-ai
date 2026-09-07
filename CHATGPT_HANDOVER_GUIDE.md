# 모토웍스 AI(Motoworks AI) 프로젝트 — ChatGPT 인계 및 전체 개발내역 가이드

> **문서 버전**: v2.0 (보안 인증 아키텍처 개편 및 프로덕션 배포 완료)  
> **기준 일시**: 2026-09-07  
> **프로덕션 URL**: `https://motoworks.corepartners.kr`  
> **기술 스택**: Next.js (Vinext / Vite 8.0), Cloudflare Workers (D1 SQLite, R2 Storage), TypeScript, Tailwind CSS, Drizzle ORM, Vitest (59/59 통과)

---

## 1. 프로젝트 개요 및 배경

모토웍스 AI는 이륜차 정비센터(용전센터, 자양센터 등)의 **수기 정비명세서 및 결제 영수증 이미지를 Gemini Vision OCR로 자동 판독**하고, 차량/고객 데이터베이스와 매핑하여 **ERP(정비 주문, 렌트리스 정산, 재고, 엑셀 내보내기)**로 자동 연계하는 엔터프라이즈 정비 관리 시스템입니다.

---

## 2. 지금까지의 전체 개발 및 보안 개편 내역 요약

### ① 인증 및 인가(RBAC) 아키텍처 완전 개편 (최우선 보안 강화)
* **익명 승격 및 취약 헤더 완전 제거**:
  * 과거 개발 편의용이었던 익명 요청의 자동 관리자 승격 로직, `x-motoworks-dev-*` 개발자 헤더, `oai-*` 임의 인증 헤더 처리 경로를 코드 레벨에서 영구 삭제.
  * Node.js 환경변수 분기가 아닌 코드 원천 제거로 환경변수 오설정으로 인한 보안 홀 방지.
* **보안 세션 쿠키 (`motoworks_session`) 기반 인증**:
  * 로그인 경로(`POST /api/auth/login`)에서 Web Crypto HMAC-SHA256 서명 토큰 발급.
  * 쿠키 속성: `HttpOnly`, `Secure`, `SameSite=Lax`, `Max-Age=86400 (24시간)`.
  * 무차별 대입 방지: IP 및 계정 기준 로그인 실패 횟수 추적, 5회 실패 시 15분간 즉시 차단(`429 Too Many Requests`).
  * 타이밍 공격(Timing Attack) 방지: Workers 및 Node 런타임 호환 상수 시간 바이트 비교(`timingSafeEqual`) 구현.
* **비밀번호 단방향 해싱**:
  * 평문 및 단순 SHA-256 저장 완전 배제.
  * 표준 `PBKDF2-HMAC-SHA256` (100,000회 반복, 16바이트 암호학적 난수 솔트) 적용 (`pbkdf2:sha256:100000:salt:hash`).
* **RBAC 권한 계층**:
  * `admin`: 전체 관리 및 사용자 생성/삭제 (`manage_users` 등 전 권한).
  * `shop_manager`: 지점 관리 (정비 승인, 엑셀 내보내기 `excel_export`, 사용자 목록 조회 `view`, 감사 로그 조회 `view_audit`).
  * `staff`: 일반 정비/수기입력 (영수증 업로드 `upload`, 판독값 수정 `edit_extraction`, 조회 `view`).
  * `viewer`: 단순 열람 (`view`).
  * `GET /api/users`는 지점 관리자가 동료 목록을 볼 수 있도록 `view` 권한으로 유지, `POST /api/users`(생성/삭제)는 `manage_users`로 철저히 분리.

### ② PII (개인정보) 암호화 및 번호판 안전 색인
* **고객명 암호화**: `customers.name`을 평문 저장하지 않고 `AES-GCM-256 (v1:iv:ciphertext)` 암호문으로 보관.
* **차량 번호판**: `vehicles.plate_encrypted` 암호화 및 `plate_hash` (HMAC-SHA256 + 고유 Salt) 색인 적용. 뒤 4자리 검색 전용 `plate_digits_hash` 색인 분리.
* **감사 로그(Audit Trail) 마스킹**: `audit_logs` 기록 시 고객명을 `maskName()`(예: 홍*동)으로 마스킹하여 감사 로그를 통한 개인정보 유출 원천 차단.
* **Fail-Fast**: 암호화 키(`DATA_ENCRYPTION_KEY`) 누락 시 임시 키 대체 없이 `503 Service Unavailable` 반환.

### ③ 계정 관리 시스템 (API + 프론트 UI + CLI)
* **백엔드 API (`POST /api/users`)**:
  * `action: 'create_user'`: 이메일 중복 시 409 Conflict 차단, 중복 덮어쓰기 금지, PBKDF2 해싱, `user_shop_roles` 매핑, `audit_logs` 기록.
  * `action: 'delete_user'`: `audit_logs` 등 참조 여부 확인 후 참조 시 `status = 'suspended'`, 무참조 시 `DELETE` 수행.
* **프론트엔드 모달 UI**:
  * `사용자 및 지점 권한` 화면 우측 상단 `[+ 사용자 추가]` 모달 구현.
  * 관리자가 초기 비밀번호를 직접 입력(자동 생성값 화면 노출 차단).
* **100% 대화형 CLI (`scripts/create-user.mjs`)**:
  * 명령행 인자(`argv`)를 제거하고 `stdin` 프롬프트(`readline`)로만 안전하게 입력받아 셸 히스토리에 비밀번호가 남지 않도록 구현.
  * 원격 D1 중복 검사 및 PBKDF2 해싱 적용.

### ④ 프론트엔드 최적화 및 빌드 정상화
* `package.json` 내 불안정했던 `postinstall` 임의 파일 생성 스크립트 완전 제거.
* `components/icons.tsx`에 50여 개 순수 SVG 아이콘을 직접 내장하고 Vite alias(`lucide-react` -> `components/icons.tsx`)를 연결하여 번들 크기 대폭 감축.
* 모바일 반응형 듀얼 레이아웃 (정비 주문/렌트리스 모바일 카드 뷰 + 데스크톱 테이블 뷰, 모바일 카메라 직접 촬영 지원).

---

## 3. 테스트 및 빌드 상태

* **단위 및 통합 테스트**: Vitest **7개 테스트 파일, 59개 테스트 전원 통과 (100% Pass)**
  * `tests/auth_security.test.ts`: PBKDF2 해싱/검증, 세션 토큰 HMAC 서명, 무차별 대입 Rate Limit, 타이밍 공격 방지, RBAC 권한 매핑 전수 검증.
  * `tests/api_integration.test.ts`: Miniflare D1 인메모리 환경에서 401/403 인가 제어, 지점 데이터 격리, 승인 전/후 매출 집계, 409 중복 승인 방지, 엑셀 5개 시트 생성 검증.
  * `tests/plate-normalization.test.ts`, `tests/crypto.test.ts` 등 도메인 단위 테스트 전원 통과.
* **정적 분석 및 린트**: `npm run lint` (oxlint) 0 errors, 0 warnings.
* **타입스크립트 검사**: `npm run typecheck` (tsc --noEmit) 0 errors.
* **프로덕션 빌드**: `npm run build` (vinext build / Vite 8.0) 정상 패키징 완료.

---

## 4. 디렉터리 구조 가이드

```
motoworks-ai/
├── app/
│   ├── api/
│   │   ├── auth/         # login, logout, me (세션 발급 및 검증)
│   │   ├── users/        # 사용자 목록(GET, view), 생성/삭제(POST, manage_users)
│   │   ├── reviews/      # AI 판독 정비명세서 승인/수정/반려 (AES-GCM 암호화)
│   │   ├── orders/       # 정비 주문 목록 및 지점 격리 조회
│   │   ├── excel/        # 정비/매출/고객 5개 시트 엑셀 내보내기
│   │   ├── dashboard/    # 승인 완료 매출/통계 집계
│   │   └── vehicles/     # 번호판 단방향 해시 색인 및 차량 조회
│   ├── page.tsx          # 메인 엔트리
│   └── layout.tsx        # 글로벌 레이아웃
├── components/
│   ├── app-shell.tsx     # 전체 관리자/매니저/스태프 UI 및 [사용자 추가] 모달
│   ├── login-view.tsx    # 로그인 화면
│   └── icons.tsx         # 자체 내장 고성능 SVG 아이콘 팩
├── db/
│   └── schema.ts         # Drizzle ORM D1 스키마 정의
├── drizzle/              # D1 SQL 마이그레이션 파일들
├── lib/
│   ├── server/
│   │   └── motoworks.ts  # 보안, 세션, RBAC, AES-GCM 암호화, PBKDF2 해시 핵심 엔진
│   └── gemini.ts         # Gemini Vision OCR 인터페이스
├── scripts/
│   ├── create-user.mjs         # 100% 대화형 CLI 계정 생성기 (stdin 전용)
│   └── set-admin-password.mjs  # 관리자 비밀번호 재설정 CLI (stdin 전용)
└── tests/                # 59개 단위/통합 테스트 스위트
```

---

## 5. ChatGPT에게 작업을 요청할 때 전달할 추천 프롬프트

ChatGPT(GPT-4o, o1, o3-mini 등)에게 본 압축파일과 함께 아래 내용을 입력하세요:

```markdown
당신은 Cloudflare Workers, Next.js(Vinext), D1(SQLite), R2 및 암호학/보안 아키텍처에 정통한 수석 엔지니어입니다.

첨부된 파일은 '모토웍스 AI(Motoworks AI)' 프로젝트의 최신 소스코드와 인계 가이드(CHATGPT_HANDOVER_GUIDE.md)입니다.
현재 프로덕션(https://motoworks.corepartners.kr)에 배포되어 있으며, 59개 단위/통합 테스트와 빌드가 100% 통과한 상태입니다.
세션 기반 인증(HMAC-SHA256), PBKDF2 비밀번호 해싱, PII AES-GCM-256 암호화, RBAC 권한 분리가 적용되어 있습니다.

[검토 및 작업 요청]
1. `lib/server/motoworks.ts`, `app/api/auth/login/route.ts`, `app/api/users/route.ts`의 인증/인가 및 세션 관리 로직을 적대적 관점(Red-team)에서 검토하고 잠재적 취약점이나 개선점을 제안해주세요.
2. Cloudflare Workers 환경에서 D1 트랜잭션 원자성(batch), 동시성 충돌 방지, R2 업로드 보안에 대해 추가로 보강할 아키텍처 패턴을 설명해주세요.
3. 현장에서 사용할 수 있는 추가 기능(정비 이력 타임라인, 카카오 알림톡 연동, 모바일 오프라인 캐싱 등)에 대한 단계별 구현 계획을 제안해주세요.
```

