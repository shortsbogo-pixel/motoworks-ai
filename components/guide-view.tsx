'use client';

import React from 'react';
import {
  Activity,
  BadgeCheck,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  CircleCheckIcon,
  ClipboardCheck,
  CloudUpload,
  ReceiptText,
  ScanLine,
  ShieldCheck,
  Store,
  Users,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface GuideViewProps {
  navigate: (view: any) => void;
  isEnterprise?: boolean;
  isIndustrial?: boolean;
}

export function GuideView({
  navigate,
  isEnterprise = false,
  isIndustrial = true,
}: GuideViewProps) {
  const steps = [
    {
      step: '01',
      title: '작업센터 선택',
      subtitle: '실제 작업이 이루어진 지점 지정',
      desc: '영수증을 올리기 전 상단 드롭다운에서 [코아바이크 자양센터] 또는 [진바이크 용전센터]를 지정합니다. 지점별로 매출과 고객 정비 이력이 자동 분리 집계됩니다.',
      icon: Store,
      badge: '시작 필수',
      badgeTone: 'blue',
      actionText: '사진 업로드로 이동',
      targetView: 'upload',
      highlights: ['자양센터 / 용전센터 분리 관리', '센터별 권한 자동 필터링'],
    },
    {
      step: '02',
      title: '사진 촬영 및 업로드',
      subtitle: '모바일 카메라 또는 앨범 다중 선택',
      desc: '스마트폰으로 정비 영수증이나 손글씨 명세서의 네 모서리가 보이게 촬영합니다. 고화질 사진이라도 기기 내에서 1초 만에 자동 압축되어 Cloudflare R2 비공개 스토리지로 안전하게 전송됩니다.',
      icon: Camera,
      badge: '현장 셔터',
      badgeTone: 'amber',
      actionText: '카메라 촬영 열기',
      targetView: 'upload',
      highlights: ['스마트폰 바로 촬영 지원', '1초 자동 고속 압축', '여러 장 한 번에 일괄 전송'],
    },
    {
      step: '03',
      title: 'Gemini 3.8 AI 초고속 판독',
      subtitle: '구글 최신 비전 모델의 필드 자동 추출',
      desc: '업로드 즉시 Gemini 3.8 Flash 엔진이 수기 명세서의 고객명, 차량번호, 차종, 교체 부품, 공임비, 결제금액, 분할결제 여부를 3초 이내에 자동 구조화합니다.',
      icon: ScanLine,
      badge: '3초 광학 판독',
      badgeTone: 'purple',
      actionText: 'AI 처리 상태 보기',
      targetView: 'processing',
      highlights: ['차량 모델 / 차량번호 자동 추출', '부품 및 공임비 개별 항목 분리', '손글씨 문맥 자동 보정'],
    },
    {
      step: '04',
      title: '검수 대기함 1초 승인',
      subtitle: '노란색 테두리 항목만 집중 확인',
      desc: 'AI가 96% 이상 확신한 내용은 초록색이며, 손글씨가 흘려 쓰여 확인이 필요한 항목만 노란색 강조 테두리로 표시됩니다. 노란색 항목만 눈으로 0.5초 확인 후 [검수 승인 및 DB 저장]을 누르면 D1 데이터베이스에 영구 암호화 저장됩니다.',
      icon: ClipboardCheck,
      badge: '선별 검수 원칙',
      badgeTone: 'green',
      actionText: '검수 대기함 가기',
      targetView: 'review',
      highlights: ['노란색 강조 필드만 0.5초 확인', '원클릭 DB 영구 승인', '승인 즉시 일일 매출 자동 집계'],
    },
    {
      step: '05',
      title: '고객용 정비명세서 & 알림톡',
      subtitle: '모바일 웹 명세서 및 카카오 알림톡 자동 연동',
      desc: '승인이 완료되면 고객 스마트폰으로 카카오 알림톡이 전송되며, 알림톡 링크를 터치하면 앱 설치 없이 모바일 웹 정비명세서(receipt/:id)가 열립니다. 정비 부품, 공임비, 보증 내역이 투명하게 제공됩니다.',
      icon: ReceiptText,
      badge: '고객 전달',
      badgeTone: 'blue',
      actionText: '정비내역 및 명세서 확인',
      targetView: 'orders',
      highlights: ['카카오 알림톡 자동 발송', '앱 설치 없는 모바일 웹 영수증', '부품별 보증 기간 명시'],
    },
  ];

  const faqs = [
    {
      q: '수기 영수증 글씨가 악필이거나 번져도 잘 읽히나요?',
      a: '네, 구글 Gemini 3.8 Flash 비전 엔진은 오토바이 정비 도메인 사전(차종, 소모품, 공임비 명칭)을 학습하여, 일부 글자가 번지거나 구겨져도 문맥을 추론해 매우 정확하게 판독합니다.',
    },
    {
      q: '현장 정비사가 접속할 때 별도의 앱을 설치해야 하나요?',
      a: '앱 설치가 전혀 필요 없습니다! 스마트폰의 카카오톡 대화방에 [https://motoworks.corepartners.kr] 링크를 보내주시면, 사파리나 크롬 브라우저에서 1초 만에 풀 화면으로 바로 열립니다.',
    },
    {
      q: '실수로 잘못 검수 승인을 눌렀을 때는 어떻게 하나요?',
      a: '좌측 [정비내역] 및 [수정·승인 이력(Audit Log)]에 언제, 누가, 무엇을 수정했는지 원본과 변경 이력이 모두 영구 보존되므로 언제든지 재검토하거나 수정할 수 있습니다.',
    },
  ];

  return (
    <div className="space-y-8">
      {/* 상단 히어로 배너 */}
      <section
        className={`relative overflow-hidden rounded-2xl border p-6 sm:p-8 transition-all ${
          isEnterprise
            ? 'border-blue-200 bg-gradient-to-br from-blue-50/80 via-white to-indigo-50/50 shadow-sm'
            : isIndustrial
              ? 'border-slate-800 bg-gradient-to-br from-[#161d28] via-[#101723] to-[#0c1017] shadow-xl'
              : 'border-slate-800 bg-[#090d16]'
        }`}
      >
        <div className="relative z-10 max-w-3xl">
          <div className="flex items-center gap-2 mb-3">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black font-mono tracking-wider uppercase ${
                isEnterprise
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}
            >
              <BookOpen size={14} /> 현장 실무 가이드
            </span>
            <span className="text-xs text-slate-400 font-medium">
              누구나 1분이면 익히는 원스톱 정비 접수 시스템
            </span>
          </div>

          <h1
            className={`text-2xl sm:text-3xl font-black tracking-tight ${
              isEnterprise ? 'text-slate-900' : 'text-white'
            }`}
          >
            현장 실무 테스트 5단계 순서 가이드
          </h1>
          <p
            className={`mt-3 text-sm sm:text-base leading-relaxed ${
              isEnterprise ? 'text-slate-600' : 'text-slate-300'
            }`}
          >
            정비 현장에서 스마트폰으로 영수증을 촬영하는 순간부터, Gemini 3.8 AI 자동 판독,
            0.5초 선별 검수, 그리고 고객 스마트폰 카카오 알림톡 명세서 발송까지의
            전체 실무 흐름을 단계별로 안내합니다.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              onClick={() => navigate('upload')}
              className={`rounded-xl px-5 py-2.5 font-extrabold text-sm transition shadow-lg active:scale-95 ${
                isEnterprise
                  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-500/20'
                  : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20 border-2 border-amber-600'
              }`}
            >
              <Camera size={16} className="mr-2" />
              지금 1단계: 사진 업로드 해보기
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate('dashboard')}
              className={`rounded-xl px-4 py-2.5 font-bold text-sm transition ${
                isEnterprise
                  ? 'border-slate-300 text-slate-700 hover:bg-slate-100'
                  : 'border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              오늘의 대시보드 바로가기
            </Button>
          </div>
        </div>

        {/* 배경 장식 패턴 */}
        <div className="absolute right-0 top-0 -mt-10 -mr-10 h-72 w-72 rounded-full bg-amber-500/5 blur-3xl pointer-events-none" />
      </section>

      {/* 5단계 카드 리스트 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="eyebrow">STEP-BY-STEP</p>
            <h2
              className={`text-xl font-extrabold ${
                isEnterprise ? 'text-slate-900' : 'text-slate-100'
              }`}
            >
              단계별 실무 안내 & 즉시 실행
            </h2>
          </div>
          <span className="text-xs font-mono font-bold text-slate-400">
            총 5단계 소요시간: 약 1분
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-1">
          {steps.map((s) => {
            const IconComponent = s.icon;
            return (
              <div
                key={s.step}
                className={`group relative rounded-2xl border p-5 sm:p-6 transition-all duration-200 ${
                  isEnterprise
                    ? 'border-slate-200 bg-white shadow-sm hover:border-blue-400 hover:shadow-md'
                    : isIndustrial
                      ? 'border-slate-800 bg-[#161d28] hover:border-amber-500/50 hover:bg-[#1a2332]'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
                  <div className="flex items-start gap-4">
                    {/* 번호 및 아이콘 배지 */}
                    <div
                      className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl font-black font-mono transition-transform duration-200 group-hover:scale-105 ${
                        isEnterprise
                          ? 'bg-blue-50 border border-blue-200 text-blue-600'
                          : isIndustrial
                            ? 'bg-amber-500 text-slate-950 border-2 border-amber-600 shadow-md'
                            : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                      }`}
                    >
                      <IconComponent size={24} strokeWidth={isIndustrial ? 2.5 : 2} />
                    </div>

                    {/* 본문 정보 */}
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-black tracking-widest text-amber-500">
                          STEP {s.step}
                        </span>
                        <h3
                          className={`text-lg font-bold ${
                            isEnterprise ? 'text-slate-900' : 'text-slate-100'
                          }`}
                        >
                          {s.title}
                        </h3>
                        <Badge
                          variant="secondary"
                          className="text-[11px] font-semibold py-0.5 px-2 rounded-md"
                        >
                          {s.subtitle}
                        </Badge>
                      </div>

                      <p
                        className={`text-sm leading-relaxed max-w-2xl ${
                          isEnterprise ? 'text-slate-600' : 'text-slate-300'
                        }`}
                      >
                        {s.desc}
                      </p>

                      {/* 주요 특징 태그 */}
                      <div className="pt-2 flex flex-wrap gap-2">
                        {s.highlights.map((h, i) => (
                          <span
                            key={i}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${
                              isEnterprise
                                ? 'bg-slate-100 text-slate-700 border border-slate-200'
                                : 'bg-[#0f141d] text-slate-300 border border-slate-800'
                            }`}
                          >
                            <CircleCheckIcon size={12} className="text-emerald-400" />
                            {h}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* 바로가기 액션 버튼 */}
                  <div className="shrink-0 flex items-center md:self-center pt-2 md:pt-0 border-t md:border-t-0 border-slate-800/60">
                    <Button
                      onClick={() => navigate(s.targetView)}
                      className={`w-full md:w-auto rounded-xl px-4 py-2.5 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 transition ${
                        isEnterprise
                          ? 'bg-slate-900 hover:bg-blue-600 text-white'
                          : isIndustrial
                            ? 'bg-slate-800 hover:bg-amber-500 hover:text-slate-950 text-slate-200 border border-slate-700'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-slate-950'
                      }`}
                    >
                      <span>{s.actionText}</span>
                      <ChevronRight size={15} />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 모바일 카카오 알림톡 프리뷰 안내 박스 */}
      <section
        className={`rounded-2xl border p-6 sm:p-7 ${
          isEnterprise
            ? 'border-blue-200 bg-white shadow-sm'
            : isIndustrial
              ? 'border-slate-800 bg-[#161d28]'
              : 'border-slate-800 bg-[#090d16]'
        }`}
      >
        <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr] items-center">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge className="bg-yellow-400 text-slate-950 font-black">
                카카오톡 알림톡 연동 규격
              </Badge>
              <span className="text-xs text-slate-400 font-medium">
                검수 승인 즉시 0.5초 만에 고객 스마트폰으로 전송
              </span>
            </div>
            <h3
              className={`text-xl font-extrabold ${
                isEnterprise ? 'text-slate-900' : 'text-white'
              }`}
            >
              고객용 모바일 웹 정비명세서
            </h3>
            <p
              className={`mt-2 text-sm leading-relaxed ${
                isEnterprise ? 'text-slate-600' : 'text-slate-300'
              }`}
            >
              정비가 승인되면 고객에게 카카오 알림톡이 자동 발송됩니다. 알림톡에 포함된
              보안 고유 링크(<code className="px-1 py-0.5 rounded bg-slate-800 text-amber-300 font-mono text-xs">receipt/:id</code>)를
              누르면 전용 모바일 명세서가 열려 고객 만족도와 정비 신뢰도가 극대화됩니다.
            </p>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <Check size={14} className="text-emerald-400" /> 별도 앱 설치 불필요
              </span>
              <span className="flex items-center gap-1">
                <Check size={14} className="text-emerald-400" /> 부품/공임비 투명 공개
              </span>
              <span className="flex items-center gap-1">
                <Check size={14} className="text-emerald-400" /> 지점별 연락처 바로 연결
              </span>
            </div>
          </div>

          {/* 알림톡 말풍선 시뮬레이션 카드 */}
          <div className="bg-[#FAE100] text-[#371D1E] rounded-2xl p-4 shadow-xl font-sans text-xs space-y-2 border border-yellow-500/40 max-w-sm mx-auto w-full">
            <div className="flex items-center justify-between border-b border-[#371D1E]/10 pb-2">
              <span className="font-bold">알림톡 도착</span>
              <span className="text-[10px] text-[#371D1E]/60 font-mono">모토웍스 AI</span>
            </div>
            <p className="font-black text-sm pt-1">[모토웍스 정비완료 안내]</p>
            <p className="text-[11px] leading-relaxed">
              홍길동 고객님, 맡겨주신 오토바이 정비가 완료되었습니다.
            </p>
            <div className="bg-white/70 rounded-lg p-2.5 space-y-1 font-mono text-[11px]">
              <p>■ 센터: 진바이크 용전센터</p>
              <p>■ 차량: 혼다 PCX125 (대전가1234)</p>
              <p>■ 결제: 65,000원 (정비 승인완료)</p>
            </div>
            <div className="pt-2">
              <div className="w-full py-2 bg-[#371D1E] text-white text-center rounded-lg font-bold text-xs">
                ▶ 모바일 정비명세서 및 보증서 확인
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 사용자·지점·권한 관리 가이드 */}
      <section
        className={`rounded-2xl border p-6 sm:p-7 ${
          isEnterprise
            ? 'border-blue-200 bg-white shadow-sm'
            : isIndustrial
              ? 'border-slate-800 bg-[#161d28]'
              : 'border-slate-800 bg-[#090d16]'
        }`}
      >
        <div className="flex items-center gap-2 mb-2">
          <Badge className={`font-black ${
            isEnterprise
              ? 'bg-blue-600 text-white'
              : 'bg-emerald-500 text-slate-950'
          }`}>
            <ShieldCheck size={13} className="mr-1" /> 조직 권한 관리
          </Badge>
          <span className="text-xs text-slate-400 font-medium">
            사용자·지점·권한 페이지 사용법
          </span>
        </div>
        <h3
          className={`text-xl font-extrabold mb-2 ${
            isEnterprise ? 'text-slate-900' : 'text-white'
          }`}
        >
          사용자·권한 관리 페이지 완전 가이드
        </h3>
        <p className={`text-sm mb-6 leading-relaxed ${
          isEnterprise ? 'text-slate-600' : 'text-slate-300'
        }`}>
          이 페이지에서 직원 추가·승인, 역할(권한 그룹) 생성, 지점별 데이터 격리를 관리합니다.
          좌측 메뉴의 <strong>사용자·권한</strong>을 클릭하면 진입할 수 있습니다.
        </p>

        {/* 4개 영역 안내 카드 */}
        <div className="grid gap-4 md:grid-cols-2">
          {/* 영역 1: 등록 사용자 */}
          <div className={`rounded-xl border p-4 sm:p-5 space-y-3 ${
            isEnterprise
              ? 'border-slate-200 bg-slate-50'
              : 'border-slate-800 bg-[#101723]'
          }`}>
            <div className="flex items-center gap-2">
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg font-bold ${
                isEnterprise
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-amber-500 text-slate-950'
              }`}>
                <Users size={18} />
              </div>
              <div>
                <span className="font-mono text-[10px] font-bold text-amber-500 tracking-wider">영역 ①</span>
                <h4 className={`font-bold text-sm ${
                  isEnterprise ? 'text-slate-900' : 'text-slate-100'
                }`}>등록 사용자 및 지점 권한</h4>
              </div>
            </div>
            <ul className={`text-xs space-y-1.5 leading-relaxed ${
              isEnterprise ? 'text-slate-600' : 'text-slate-300'
            }`}>
              <li className="flex items-start gap-1.5">
                <CircleCheckIcon size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                <span>현재 시스템에 등록된 <strong>모든 사용자</strong>가 이름, 이메일, 상태 뱃지와 함께 표시됩니다.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CircleCheckIcon size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                <span>상태 뱃지: <strong className="text-emerald-400">승인 완료</strong>(초록) / <strong className="text-amber-400">승인 대기</strong>(주황) / <strong className="text-slate-400">정지</strong>(회색)</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CircleCheckIcon size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                <span>각 사용자 하단에 <strong>배정된 지점과 역할</strong>이 표시됩니다. (예: 전체 지점 · 조직 관리자)</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CircleCheckIcon size={13} className="text-amber-400 mt-0.5 shrink-0" />
                <span><strong>승인 대기</strong> 상태의 신규 사용자에게만 [승인 및 활성화] 버튼이 나타납니다.</span>
              </li>
            </ul>
          </div>

          {/* 영역 2: RBAC 엄격 격리 */}
          <div className={`rounded-xl border p-4 sm:p-5 space-y-3 ${
            isEnterprise
              ? 'border-slate-200 bg-slate-50'
              : 'border-slate-800 bg-[#101723]'
          }`}>
            <div className="flex items-center gap-2">
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg font-bold ${
                isEnterprise
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-amber-500 text-slate-950'
              }`}>
                <ShieldCheck size={18} />
              </div>
              <div>
                <span className="font-mono text-[10px] font-bold text-amber-500 tracking-wider">영역 ②</span>
                <h4 className={`font-bold text-sm ${
                  isEnterprise ? 'text-slate-900' : 'text-slate-100'
                }`}>RBAC 보안 정책 안내</h4>
              </div>
            </div>
            <ul className={`text-xs space-y-1.5 leading-relaxed ${
              isEnterprise ? 'text-slate-600' : 'text-slate-300'
            }`}>
              <li className="flex items-start gap-1.5">
                <CircleCheckIcon size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                <span><strong>초기 소유자</strong>만 최고 권한을 보유합니다. (대표 관리자)</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CircleCheckIcon size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                <span><strong>신규 가입자</strong>는 반드시 '승인 대기' 상태로 시작 → 관리자 승인 필요</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CircleCheckIcon size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                <span><strong>지점 격리</strong>: 자양센터 ↔ 용전센터 데이터가 완전히 분리됩니다.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CircleCheckIcon size={13} className="text-emerald-400 mt-0.5 shrink-0" />
                <span><strong>AES-GCM 256비트</strong> 암호화 + 모든 변경사항 <strong>영구 감사 로그</strong> 기록</span>
              </li>
            </ul>
          </div>

          {/* 영역 3: 커스텀 역할 목록 */}
          <div className={`rounded-xl border p-4 sm:p-5 space-y-3 ${
            isEnterprise
              ? 'border-slate-200 bg-slate-50'
              : 'border-slate-800 bg-[#101723]'
          }`}>
            <div className="flex items-center gap-2">
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg font-bold ${
                isEnterprise
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-amber-500 text-slate-950'
              }`}>
                <BadgeCheck size={18} />
              </div>
              <div>
                <span className="font-mono text-[10px] font-bold text-amber-500 tracking-wider">영역 ③</span>
                <h4 className={`font-bold text-sm ${
                  isEnterprise ? 'text-slate-900' : 'text-slate-100'
                }`}>커스텀 역할 목록 (기본 4개)</h4>
              </div>
            </div>
            <div className={`text-xs space-y-2 ${
              isEnterprise ? 'text-slate-600' : 'text-slate-300'
            }`}>
              <p className="leading-relaxed">시스템에 미리 정의된 역할 4종이 각각의 권한 태그와 함께 카드로 표시됩니다:</p>
              <div className="space-y-1.5">
                {[
                  { name: '조직 관리자', code: 'admin', desc: '전체 10종 권한 — 사용자 관리, 감사로그까지 모두 가능' },
                  { name: '지점 관리자', code: 'shop_manager', desc: '정비 접수, 검수, 정산, 엑셀 내보내기, 감사로그 열람' },
                  { name: '직원', code: 'staff', desc: '사진 업로드, 판독값 수정만 가능 (조회 포함)' },
                  { name: '열람자', code: 'viewer', desc: '데이터 조회만 가능 — 수정/승인 불가' },
                ].map((r) => (
                  <div key={r.code} className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${
                    isEnterprise ? 'bg-white border border-slate-200' : 'bg-[#0f141d] border border-slate-800'
                  }`}>
                    <span className={`font-bold shrink-0 w-20 ${
                      isEnterprise ? 'text-blue-700' : 'text-amber-400'
                    }`}>{r.name}</span>
                    <span className="font-mono text-[10px] text-slate-500 shrink-0 w-24">{r.code}</span>
                    <span className="text-[11px]">{r.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 영역 4: 새 권한 그룹 생성 */}
          <div className={`rounded-xl border p-4 sm:p-5 space-y-3 ${
            isEnterprise
              ? 'border-slate-200 bg-slate-50'
              : 'border-slate-800 bg-[#101723]'
          }`}>
            <div className="flex items-center gap-2">
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg font-bold ${
                isEnterprise
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-amber-500 text-slate-950'
              }`}>
                <ClipboardCheck size={18} />
              </div>
              <div>
                <span className="font-mono text-[10px] font-bold text-amber-500 tracking-wider">영역 ④</span>
                <h4 className={`font-bold text-sm ${
                  isEnterprise ? 'text-slate-900' : 'text-slate-100'
                }`}>새 커스텀 권한 그룹 만들기</h4>
              </div>
            </div>
            <ul className={`text-xs space-y-1.5 leading-relaxed ${
              isEnterprise ? 'text-slate-600' : 'text-slate-300'
            }`}>
              <li className="flex items-start gap-1.5">
                <span className={`font-mono font-bold text-[10px] mt-0.5 shrink-0 w-3 text-center ${
                  isEnterprise ? 'text-blue-600' : 'text-amber-400'
                }`}>1</span>
                <span><strong>역할 이름</strong> 입력 (예: 야간 정비반장, 외근 기사)</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className={`font-mono font-bold text-[10px] mt-0.5 shrink-0 w-3 text-center ${
                  isEnterprise ? 'text-blue-600' : 'text-amber-400'
                }`}>2</span>
                <span><strong>설명</strong> 입력 (선택사항, 예: 야간 접수 전담)</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className={`font-mono font-bold text-[10px] mt-0.5 shrink-0 w-3 text-center ${
                  isEnterprise ? 'text-blue-600' : 'text-amber-400'
                }`}>3</span>
                <span>허용할 <strong>권한 10종</strong> 중 필요한 항목에 체크</span>
              </li>
              <li className="flex items-start gap-1.5">
                <span className={`font-mono font-bold text-[10px] mt-0.5 shrink-0 w-3 text-center ${
                  isEnterprise ? 'text-blue-600' : 'text-amber-400'
                }`}>4</span>
                <span>[<strong>새 권한 그룹 생성</strong>] 클릭 → 즉시 DB 저장 및 좌측 목록에 추가</span>
              </li>
            </ul>
            <div className={`rounded-lg p-3 text-xs leading-relaxed ${
              isEnterprise
                ? 'bg-blue-50 border border-blue-200 text-blue-800'
                : 'bg-amber-500/10 border border-amber-500/30 text-amber-200'
            }`}>
              <strong>💡 권한 10종:</strong> 기본 조회, 사진 업로드, 판독값 수정, 검수 승인/반려, 정산 관리, 엑셀 가져오기, 엑셀 내보내기, 개인정보 열람, 사용자·권한 관리, 감사로그 열람
            </div>
          </div>
        </div>

        {/* 실무 시나리오 */}
        <div className={`mt-5 rounded-xl border p-4 sm:p-5 ${
          isEnterprise
            ? 'border-blue-200 bg-blue-50/50'
            : 'border-slate-800 bg-[#0f141d]'
        }`}>
          <h4 className={`font-bold text-sm mb-3 flex items-center gap-2 ${
            isEnterprise ? 'text-blue-800' : 'text-amber-400'
          }`}>
            <Activity size={15} /> 실무 활용 시나리오
          </h4>
          <div className={`grid gap-3 md:grid-cols-3 text-xs ${
            isEnterprise ? 'text-slate-600' : 'text-slate-300'
          }`}>
            {[
              {
                scenario: '새 정비사 입사',
                action: '직원이 사이트 접속 → 자동으로 "승인 대기" 등록 → 관리자가 이 페이지에서 [승인 및 활성화] 클릭',
              },
              {
                scenario: '야간 반장에게 승인 권한 부여',
                action: '영역 ④에서 "야간 반장" 역할 생성 → 검수 승인/반려 + 사진 업로드 체크 → 해당 직원에게 할당',
              },
              {
                scenario: '퇴사 또는 권한 회수',
                action: '해당 사용자의 상태를 "정지"로 변경 → 즉시 모든 접근 차단, 감사로그에 영구 기록',
              },
            ].map((s, i) => (
              <div key={i} className={`rounded-lg p-3 space-y-1 ${
                isEnterprise ? 'bg-white border border-slate-200' : 'bg-[#161d28] border border-slate-800'
              }`}>
                <p className={`font-bold ${
                  isEnterprise ? 'text-slate-900' : 'text-slate-100'
                }`}>{s.scenario}</p>
                <p className="leading-relaxed">{s.action}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 바로가기 버튼 */}
        <div className="mt-5 flex flex-wrap gap-3">
          <Button
            onClick={() => navigate('users')}
            className={`rounded-xl px-5 py-2.5 font-bold text-sm flex items-center gap-1.5 transition ${
              isEnterprise
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-2 border-amber-600'
            }`}
          >
            <ShieldCheck size={16} />
            사용자·권한 페이지로 이동
            <ChevronRight size={15} />
          </Button>
        </div>
      </section>

      {/* 현장 담당자 FAQ */}
      <section
        className={`rounded-2xl border p-6 sm:p-7 ${
          isEnterprise
            ? 'border-slate-200 bg-white'
            : isIndustrial
              ? 'border-slate-800 bg-[#161d28]'
              : 'border-slate-800 bg-[#090d16]'
        }`}
      >
        <p className="eyebrow">FAQ</p>
        <h3
          className={`text-xl font-extrabold mb-5 ${
            isEnterprise ? 'text-slate-900' : 'text-slate-100'
          }`}
        >
          현장 담당자 자주 묻는 질문
        </h3>

        <div className="grid gap-4 md:grid-cols-3">
          {faqs.map((f, i) => (
            <div
              key={i}
              className={`rounded-xl border p-4 space-y-2 ${
                isEnterprise
                  ? 'border-slate-200 bg-slate-50'
                  : 'border-slate-800 bg-[#101723]'
              }`}
            >
              <h4
                className={`font-bold text-sm flex items-start gap-1.5 ${
                  isEnterprise ? 'text-slate-900' : 'text-amber-400'
                }`}
              >
                <span>Q.</span> {f.q}
              </h4>
              <p
                className={`text-xs leading-relaxed ${
                  isEnterprise ? 'text-slate-600' : 'text-slate-300'
                }`}
              >
                {f.a}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
