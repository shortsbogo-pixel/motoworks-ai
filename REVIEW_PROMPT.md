# 모토웍스 AI 독립 심층 코드 리뷰 요청 프롬프트 (REVIEW_PROMPT)

> **안내**: 아래 프롬프트 전체를 복사하여 **ChatGPT (o1, o3-mini, GPT-4o)** 또는 **Claude (Claude 3.7 Sonnet, Claude 3.5 Sonnet)** 등 최상위 AI 모델에 입력하여 독립적인 아키텍처 및 코드 검토를 진행하십시오.

---

```markdown
당신은 최고 수준의 시니어 클라우드 아키텍트이자 SaaS 보안/금융 트랜잭션 코드 감사관(Lead Auditor)입니다.
지금부터 검토할 시스템은 이륜차(오토바이) 정비센터 프랜차이즈인 코아파트너스(Core Partners: 코아바이크 자양센터 `jayang`, 진바이크 용전센터 `yongjeon`)를 위해 개발된 **"모토웍스 AI (Motoworks AI)"** 정비센터 업무 자동화 시스템입니다.

본 시스템은 종이 명세서 사진 업로드 -> Gemini 3.8 Flash 비전 판독 -> 비즈니스 정합성 검증 -> 원자적 결제/미수금 분할 승인 -> 레거시 5개 시트 엑셀 호환 -> RBAC 및 PII 암호화 보안 체계를 갖춘 실제 운영 가능한 프로덕션 레벨 소프트웨어입니다.

제공된 아키텍처 보고서(`HANDOFF_REVIEW.md`), 테스트 검증 결과서(`TEST_RESULTS.md`), 그리고 주요 소스 코드를 바탕으로 다음 7대 핵심 영역에 대해 비판적이고 엄격한 독립 기술 감사를 수행해 주십시오.

---

### [검토 기준 및 감사 영역]

#### 1. 트랜잭션 원자성 및 동시성 무결성 (Atomicity & Concurrency)
* 엔드포인트: `app/api/reviews/[id]/route.ts`
* 검토 항목:
  - `runtime.DB.batch`를 통한 8개 테이블(`review_documents`, `service_orders`, `service_items`, `payments`, `customers`, `vehicles`, `receivables`, `correction_logs`, `audit_logs`)의 원자적 저장 무결성.
  - 이미 승인된 문서에 대한 동시 다중 승인 요청 시 이중 정산 방지 및 409 Conflict 처리의 안전성.
  - 트랜잭션 도중 예외 발생 시 부분 커밋(Dirty Write) 차단 여부.

#### 2. 역할 기반 접근 제어 (RBAC) 및 멀티테넌시 지점 격리 (Security & Multi-Tenancy)
* 엔드포인트 및 모듈: `lib/auth.ts`, `app/api/documents/[id]/source/route.ts`, `app/api/users/route.ts` 등
* 검토 항목:
  - `shortsbogo@gmail.com` 초기 소유자 부트스트랩 원칙의 신뢰성.
  - 신규 사용자가 로그인하더라도 기본 `pending` 상태로 진입하며 승인 없이는 어떠한 API도 실행할 수 없도록 강제되는지 여부.
  - 자양센터(`jayang`) 담당자가 용전센터(`yongjeon`)의 정비내역, 고객, 첨부 영수증 사진(R2 비공개 객체)에 교차 접근할 수 없는 지점 격리(`canAccessShop`)의 완전성.

#### 3. PII (개인식별정보) 암호화 및 비식별화 (Data Privacy & Compliance)
* 모듈: `lib/crypto.ts`, `lib/auth.ts`
* 검토 항목:
  - 고객명, 전화번호, 주소에 대한 AES-GCM 256 암호화 및 SHA-256 단방향 해시(`phone_hash`, `plate_hash`) 인덱싱 구현의 적절성.
  - `view_pii` 권한이 없는 정비사나 뷰어에게 반환되는 데이터의 마스킹(`010-****-1234`, `홍*동`) 누락 여부.

#### 4. Gemini 3.8 Flash AI 추출 파이프라인 및 Fail-Safe (AI Reliability)
* 모듈: `lib/gemini.ts`, `app/api/extractions/route.ts`
* 검토 항목:
  - `gemini-3.8-flash` 모델 규격 및 `thinkingLevel: medium` 적용의 정확성.
  - `GEMINI_API_KEY` 누락 또는 AI 응답 실패 시 가짜 목데이터(Mock) 주입 없이 즉시 Fail-Fast 에러를 던져 운영 왜곡을 방지하는지 여부.
  - 96% 신뢰도 미만 필드에 대한 자동 검토 대기(`needs_review`) 강제 로직.

#### 5. 이륜차 정비/렌트 특화 비즈니스 정합성 (Business Logic & Reconciliation)
* 모듈: `lib/domain.ts`, `lib/review-state.ts`
* 검토 항목:
  - 정비 항목 합계금액(`item total`)과 결제 총액(`payment total`)의 엄격한 일치 검증.
  - 일반 개인 고객의 0원 결제 차단 및 예외 방지.
  - 렌트/리스 차량의 0원 결제 허용 및 자동 미수금 분할 공식:
    $$\text{기준가} = \text{고객 결제액} + \text{업체 청구액(미수금)}$$
    계산 로직의 정합성과 채권 생성 무결성.

#### 6. 레거시 5개 시트 엑셀 호환성 (Legacy Data Continuity)
* 모듈: `lib/excel.ts`, `app/api/excel/route.ts`
* 검토 항목:
  - 5개 시트(`정비내역`, `정비항목`, `고객목록`, `렌트리스`, `기준정보`)의 양방향 입출력 구조.
  - 승인되지 않은 대기 건이 매출 및 정산 시트에 오염 유입되지 않도록 격리하는 필터링.

#### 7. 프론트엔드 연동 및 런타임 안정성 (Frontend Integration & Architecture)
* 모듈: `components/app-shell.tsx`, `components/icons.tsx`
* 검토 항목:
  - 10개 전체 화면(대시보드, 업로드, 검토/승인, 정비내역, 고객, 렌트/미수금, 통계, 엑셀, 사용자관리, 감사로그)의 실제 백엔드 API 연동 완성도.
  - 손상된 외부 아이콘 의존성 완전 제거 및 자체 SVG 컴포넌트화로 빌드 무결성 확보 여부.

---

### [출력 형식 요구사항]

검토 결과를 다음 구조로 정리하여 작성해 주십시오:

1. **종합 총평 및 아키텍처 완성도 점수 (100점 만점 기준)**
2. **핵심 강점 분석 (Top 5 Architectural Strengths)**
3. **영역별 세부 감사 의견 (위 7개 영역별 심층 분석)**
4. **잠재적 위험 및 엣지 케이스 점검 (Edge Cases & Failure Modes)**
   - 대규모 트래픽 발생 시 병목 가능성
   - 악의적 조작 요청 시 방어 수준
5. **실제 운영(Production) 배포 시 권장되는 추가 체크리스트**
```
