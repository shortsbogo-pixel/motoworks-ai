'use client';

import { ChangeEvent, createContext, useContext, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Bike,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  CloudUpload,
  Database,
  FileDown,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  ListChecks,
  Menu,
  ReceiptText,
  ScanLine,
  Search,
  Settings2,
  ShieldCheck,
  Store,
  Users,
  WalletCards,
  X,
} from '@/components/icons';
import { GuideView } from '@/components/guide-view';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import {
  baselineReference,
} from '@/lib/mock-data';
import { shouldHighlightField, type ReviewDocument } from '@/lib/domain';
import { optimizeReceiptImage } from '@/lib/client/image-optimizer';
import { LoginView, type UserProfile } from '@/components/login-view';

export type DesignTheme = 'cockpit' | 'enterprise' | 'industrial';

interface DesignThemeContextType {
  theme: DesignTheme;
  isCockpit: boolean;
  isEnterprise: boolean;
  isIndustrial: boolean;
  setTheme: (theme: DesignTheme) => void;
}

const DesignThemeContext = createContext<DesignThemeContextType>({
  theme: 'industrial',
  isCockpit: false,
  isEnterprise: false,
  isIndustrial: true,
  setTheme: () => {},
});

export const useDesignTheme = () => useContext(DesignThemeContext);

type View =
  | 'dashboard'
  | 'upload'
  | 'processing'
  | 'review'
  | 'orders'
  | 'guide'
  | 'customers'
  | 'rentals'
  | 'analytics'
  | 'standards'
  | 'excel'
  | 'users'
  | 'audit';

const navGroups: Array<{
  label: string;
  items: Array<{ id: View; label: string; icon: typeof LayoutDashboard }>;
}> = [
  {
    label: '업무',
    items: [
      { id: 'dashboard', label: '오늘의 대시보드', icon: LayoutDashboard },
      { id: 'upload', label: '사진 일괄 업로드', icon: CloudUpload },
      { id: 'processing', label: 'AI 처리 상태', icon: Activity },
      { id: 'review', label: '검수 대기함', icon: ClipboardCheck },
      { id: 'orders', label: '정비내역', icon: ReceiptText },
      { id: 'guide', label: '현장 실무 가이드', icon: BookOpen },
    ],
  },
  {
    label: '관리',
    items: [
      { id: 'customers', label: '고객·차량', icon: Users },
      { id: 'rentals', label: '렌트·리스 정산', icon: WalletCards },
      { id: 'analytics', label: '매장별 매출', icon: CircleDollarSign },
      { id: 'standards', label: '기준 정보', icon: Settings2 },
      { id: 'excel', label: '엑셀 가져오기·내보내기', icon: FileSpreadsheet },
      { id: 'users', label: '사용자·권한', icon: ShieldCheck },
      { id: 'audit', label: '수정·승인 이력', icon: History },
    ],
  },
];

const titles: Record<View, { title: string; description: string }> = {
  dashboard: {
    title: '오늘의 대시보드',
    description: '승인된 데이터만 매출에 반영됩니다.',
  },
  guide: {
    title: '현장 실무 테스트 5단계 가이드',
    description: '스마트폰 영수증 촬영부터 AI 자동 판독, 0.5초 선별 검수, 고객 카카오 알림톡 명세서까지의 원스톱 실무 프로세스입니다.',
  },
  upload: {
    title: '사진 일괄 업로드',
    description: '휴대폰 사진을 여러 장 올리면 자동 보정과 판독을 시작합니다.',
  },
  processing: {
    title: 'AI 처리 상태',
    description: '업로드부터 검수 등록까지 배치별 진행 상황을 확인합니다.',
  },
  review: {
    title: '검수 대기함',
    description: 'AI가 확신하지 못한 항목만 확인하면 됩니다.',
  },
  orders: {
    title: '정비내역',
    description: '승인된 정비와 분할 결제를 함께 관리합니다.',
  },
  customers: {
    title: '고객·차량 통합 이력',
    description: '자동 병합 없이 연결 후보와 근거를 검토합니다.',
  },
  rentals: {
    title: '렌트·리스 정산',
    description: '기준가, 고객 결제, 업체 청구와 미수금을 분리합니다.',
  },
  analytics: {
    title: '매장별 매출',
    description: '승인된 정비만 집계하며 검증 전 수치는 구분해 표시합니다.',
  },
  standards: {
    title: '기준 정보',
    description: '차종·작업명·가격·자동등록 규칙을 한곳에서 관리합니다.',
  },
  excel: {
    title: '엑셀 가져오기·내보내기',
    description: '기존 5개 시트 호환성을 검사하고 승인 데이터만 내보냅니다.',
  },
  users: {
    title: '사용자·지점·권한',
    description: '조직과 지점 단위로 접근 범위를 관리합니다.',
  },
  audit: {
    title: '수정·승인 이력',
    description: '원본값, AI 제안, 사람의 수정과 승인 근거를 보존합니다.',
  },
};

const won = new Intl.NumberFormat('ko-KR', {
  style: 'currency',
  currency: 'KRW',
  maximumFractionDigits: 0,
});

type ProcessingSummary = {
  batchId: string;
  model: string;
  total: number;
  succeeded: number;
  failed: number;
};

export type OrderRecord = {
  id: string;
  shopId: string;
  shopName: string;
  serviceDate: string;
  serviceType: string;
  status: string;
  totalAmount: number;
  customerName: string;
  phone: string;
  vehicleModel: string;
  plate: string;
  createdAt: number;
  items?: Array<{
    normalized_name: string | null;
    quantity: number;
    unit_price: number;
    amount: number;
  }>;
  payments?: Array<{
    method: string;
    amount: number;
    paid_at: number | null;
    note: string | null;
  }>;
};

export type CustomerRecord = {
  id: string;
  shopId: string;
  shopName: string;
  name: string;
  phone: string;
  status: string;
  createdAt: number;
  vehicles: Array<{
    id: string;
    model: string;
    plate: string;
    certainty: string;
  }>;
};

export type RentalRecord = {
  id: string;
  shopId: string;
  shopName: string;
  company: string;
  vehicle: string;
  base: number;
  customer: number;
  billed: number;
  paid: number;
  due: number;
  status: string;
};

export type AuditLogRecord = {
  id: string;
  shopName: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  detail: unknown;
  createdAt: number;
};

export type DashboardStats = {
  totalOrders: number;
  totalRevenue: number;
  pendingReviewCount: number;
  rentalOutstanding: number;
  shops: Array<{
    id: string;
    name: string;
    orderCount: number;
    revenue: number;
  }>;
};

export type UserAssignment = {
  id: string;
  shopId: string | null;
  shopName: string;
  role: string;
  roleId: string | null;
  roleName: string;
};

export type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  status: string;
  createdAt: number;
  assignments: UserAssignment[];
};

export type RoleRecord = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  createdAt: number;
};

export function AppShell({ userName: initialUserName }: { userName?: string }) {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [view, setView] = useState<View>('dashboard');
  const [documents, setDocuments] = useState<ReviewDocument[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [rentals, setRentals] = useState<RentalRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [usersData, setUsersData] = useState<{ users: UserRecord[]; roles: RoleRecord[] }>({
    users: [],
    roles: [],
  });

  const [selectedId, setSelectedId] = useState('');
  const [processingSummary, setProcessingSummary] =
    useState<ProcessingSummary | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [isPlateModalOpen, setIsPlateModalOpen] = useState(false);
  const [prefillPlate, setPrefillPlate] = useState('');
  const [designTheme, setDesignTheme] = useState<DesignTheme>('industrial');
  const isCockpit = designTheme === 'cockpit';
  const isEnterprise = designTheme === 'enterprise';
  const isIndustrial = designTheme === 'industrial';

  const pending = documents.filter(
    (document) => document.status === 'pending',
  ).length;
  const approvedToday = documents.filter(
    (document) => document.status === 'approved',
  );
  const approvedRevenue = orders.length > 0
    ? orders.reduce((sum, ord) => sum + ord.totalAmount, 0)
    : approvedToday.reduce((sum, doc) => sum + doc.amount, 0);

  const navigate = (next: View) => {
    setView(next);
    setSidebarOpen(false);
    setNotice('');
  };

  const refreshAllData = async () => {
    try {
      // 1. 검수 문서 전체 조회 (pending + approved)
      const extRes = await fetch('/api/extractions?status=all', { cache: 'no-store' });
      if (extRes.ok) {
        const payload = (await extRes.json()) as { documents?: ReviewDocument[] };
        if (payload?.documents) {
          setDocuments(payload.documents);
          setSelectedId((cur) => cur || payload.documents?.[0]?.id || '');
        }
      }

      // 2. 승인된 정비내역
      const ordRes = await fetch('/api/orders', { cache: 'no-store' });
      if (ordRes.ok) {
        const payload = (await ordRes.json()) as { orders?: OrderRecord[] };
        if (payload?.orders) setOrders(payload.orders);
      }

      // 3. 대시보드 통계
      const dashRes = await fetch('/api/dashboard', { cache: 'no-store' });
      if (dashRes.ok) {
        const payload = (await dashRes.json()) as DashboardStats;
        setDashboardStats(payload);
      }

      // 4. 고객/차량
      const custRes = await fetch('/api/customers', { cache: 'no-store' });
      if (custRes.ok) {
        const payload = (await custRes.json()) as { customers?: CustomerRecord[] };
        if (payload?.customers) setCustomers(payload.customers);
      }

      // 5. 렌트/리스 정산
      const rentRes = await fetch('/api/rentals', { cache: 'no-store' });
      if (rentRes.ok) {
        const payload = (await rentRes.json()) as { rentals?: RentalRecord[] };
        if (payload?.rentals) setRentals(payload.rentals);
      }

      // 6. 사용자/권한
      const userRes = await fetch('/api/users', { cache: 'no-store' });
      if (userRes.ok) {
        const payload = (await userRes.json()) as { users: UserRecord[]; roles: RoleRecord[] };
        setUsersData(payload);
      }

      // 7. 감사 이력
      const auditRes = await fetch('/api/audit', { cache: 'no-store' });
      if (auditRes.ok) {
        const payload = (await auditRes.json()) as { logs?: AuditLogRecord[] };
        if (payload?.logs) setAuditLogs(payload.logs);
      }
    } catch {
      // ignore background fetch errors
    }
  };

  useEffect(() => {
    let isMounted = true;
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { user: UserProfile };
          if (isMounted) {
            setCurrentUser(data.user);
            void refreshAllData();
          }
        } else {
          if (isMounted) setCurrentUser(null);
        }
      } catch {
        if (isMounted) setCurrentUser(null);
      } finally {
        if (isMounted) setAuthChecking(false);
      }
    };
    void checkAuth();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setCurrentUser(null);
  };

  if (authChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090d16] text-slate-100">
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <p className="text-sm font-mono text-slate-400">보안 세션 검증 중...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LoginView
        onLoginSuccess={(user) => {
          setCurrentUser(user);
          void refreshAllData();
        }}
      />
    );
  }

  const activeUserName = currentUser.displayName || currentUser.email || initialUserName || '대표 관리자';

  return (
    <DesignThemeContext.Provider
      value={{
        theme: designTheme,
        isCockpit,
        isEnterprise,
        isIndustrial,
        setTheme: setDesignTheme,
      }}
    >
      <div className={`min-h-screen transition-colors duration-200 theme-${designTheme} ${
        isEnterprise
          ? 'bg-[#f8fafc] text-slate-900'
          : isIndustrial
            ? 'bg-[#edf0f5] text-slate-950'
            : 'bg-[#0b0f17] text-slate-100'
      }`}>
        <aside
          className={`fixed inset-y-0 left-0 z-40 w-[264px] border-r transition-all lg:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } ${
            isEnterprise
              ? 'border-slate-200 bg-white text-slate-800 shadow-sm'
              : isIndustrial
                ? 'border-slate-800 bg-[#161d28] text-slate-100 shadow-xl'
                : 'border-slate-800/80 bg-[#090d16] text-slate-100'
          }`}
        >
          <div className={`flex h-20 items-center gap-3 border-b px-6 ${
            isEnterprise
              ? 'border-slate-100'
              : isIndustrial
                ? 'border-slate-800/90'
                : 'border-slate-800/80'
          }`}>
            <div className={`grid h-10 w-10 place-items-center rounded-xl font-black transition ${
              isEnterprise
                ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20'
                : isIndustrial
                  ? 'bg-amber-500 text-slate-950 shadow-[0_0_20px_rgba(245,158,11,0.4)]'
                  : 'bg-emerald-500 text-slate-950 shadow-[0_0_20px_rgba(16,185,129,0.35)]'
            }`}>
              <Bike size={23} strokeWidth={2.4} />
            </div>
            <div>
              <p className={`text-[17px] font-extrabold tracking-[-0.03em] ${
                isEnterprise ? 'text-slate-900' : 'text-slate-100'
              }`}>
                모토웍스 AI
              </p>
              <p className={`text-xs font-mono tracking-wide ${
                isEnterprise
                  ? 'text-blue-600 font-bold'
                  : isIndustrial
                    ? 'text-amber-400 font-bold'
                    : 'text-emerald-400/90'
              }`}>
                {isEnterprise ? '2. ENTERPRISE PRO' : isIndustrial ? '3. WORKSHOP MES' : '1. PRECISION COCKPIT'}
              </p>
            </div>
          </div>
          <nav className="flex h-[calc(100%-160px)] flex-col gap-6 overflow-y-auto px-3 py-5">
            {navGroups.map((group) => (
              <div key={group.label}>
                <p className={`mb-2 px-3 text-[10px] font-bold uppercase tracking-[.18em] ${
                  isEnterprise ? 'text-slate-400 font-semibold' : 'text-slate-500'
                }`}>
                  {group.label}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = view === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => navigate(item.id)}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                          active
                            ? isEnterprise
                              ? 'bg-blue-50 text-blue-700 border border-blue-200/80 shadow-xs font-bold'
                              : isIndustrial
                                ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.2)] font-bold'
                                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.15)] font-bold'
                            : isEnterprise
                              ? 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                              : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                        }`}
                      >
                        <Icon
                          size={18}
                          className={
                            active
                              ? isEnterprise
                                ? 'text-blue-600'
                                : isIndustrial
                                  ? 'text-amber-400'
                                  : 'text-emerald-400'
                              : isEnterprise
                                ? 'text-slate-400'
                                : 'text-slate-500'
                          }
                        />
                        <span className="flex-1">{item.label}</span>
                        {item.id === 'review' && pending > 0 && (
                          <span className={`grid min-w-6 place-items-center rounded-full px-1.5 py-0.5 text-[11px] font-mono font-black ${
                            isEnterprise
                              ? 'bg-blue-100 text-blue-800 border border-blue-300'
                              : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-[0_0_10px_rgba(245,158,11,0.25)]'
                          }`}>
                            {pending}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
          <div className={`absolute inset-x-3 bottom-3 rounded-xl border p-3 ${
            isEnterprise
              ? 'border-slate-200 bg-slate-50/80'
              : 'border-slate-800/80 bg-slate-900/60 backdrop-blur-sm'
          }`}>
            <div className="flex items-center gap-3">
              <div className={`grid h-9 w-9 place-items-center rounded-full text-sm font-black border shrink-0 ${
                isEnterprise
                  ? 'bg-blue-100 text-blue-700 border-blue-200'
                  : isIndustrial
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              }`}>
                {activeUserName[0]}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm font-semibold ${isEnterprise ? 'text-slate-800' : 'text-slate-200'}`}>
                  {activeUserName}
                </p>
                <p className={`text-xs truncate ${isEnterprise ? 'text-slate-400' : 'text-slate-400'}`}>
                  {currentUser?.isOwner ? '대표 관리자 · 전체 권한' : currentUser?.email || '조직 관리자'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                title="보안 로그아웃"
                className={`rounded-lg px-2 py-1 text-xs font-semibold transition shrink-0 ${
                  isEnterprise
                    ? 'text-slate-500 hover:bg-slate-200 hover:text-rose-600'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-rose-400'
                }`}
              >
                로그아웃
              </button>
            </div>
          </div>
        </aside>
        {sidebarOpen && (
          <button
            aria-label="메뉴 닫기"
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-xs lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <main className="min-h-screen pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-[264px]">
          <header className={`sticky top-0 z-20 flex h-16 items-center gap-2 sm:gap-3 border-b px-3 backdrop-blur-xl sm:h-20 sm:gap-4 sm:px-7 lg:px-10 transition-colors ${
            isEnterprise
              ? 'border-slate-200 bg-white/90 shadow-xs text-slate-900'
              : isIndustrial
                ? 'border-slate-800 bg-[#161d28] text-slate-100 shadow-md'
                : 'border-slate-800/80 bg-[#0b0f17]/85 text-slate-100'
          }`}>
            <Button
              variant="ghost"
              size="icon"
              className={`lg:hidden shrink-0 ${
                isEnterprise ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300 hover:bg-slate-800'
              }`}
              onClick={() => setSidebarOpen(true)}
            >
              <Menu />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className={`truncate text-lg font-black tracking-[-0.025em] sm:text-2xl ${
                isEnterprise ? 'text-slate-900' : 'text-slate-100'
              }`}>
                {view === 'review' && isIndustrial ? 'Document Review Station' : titles[view].title}
              </h1>
              <p className={`hidden text-sm sm:block ${
                isEnterprise ? 'text-slate-500' : isIndustrial ? 'text-slate-400 font-medium' : 'text-slate-400'
              }`}>
                {view === 'review' && isIndustrial
                  ? '모빌리티 현장 정비 및 영수증 AI 고대비 검수 스테이션'
                  : titles[view].description}
              </p>
            </div>

            {/* 실시간 3가지 디자인 스위처 (1. 콕핏 ↔ 2. 기업형 ↔ 3. 산업) */}
            <div className={`flex items-center rounded-full border p-1 text-xs font-mono transition-colors ${
              isEnterprise
                ? 'border-slate-200 bg-slate-100'
                : isIndustrial
                  ? 'border-slate-700 bg-[#0f141d]'
                  : 'border-slate-700/80 bg-slate-900/90'
            }`}>
              <button
                type="button"
                onClick={() => setDesignTheme('cockpit')}
                className={`rounded-full px-2.5 py-1 transition font-bold ${
                  isCockpit
                    ? 'bg-emerald-500 text-slate-950 shadow-[0_0_12px_rgba(16,185,129,0.5)] font-black'
                    : isEnterprise
                      ? 'text-slate-600 hover:text-slate-900'
                      : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                1. 콕핏
              </button>
              <button
                type="button"
                onClick={() => setDesignTheme('enterprise')}
                className={`rounded-full px-2.5 py-1 transition font-bold ${
                  isEnterprise
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/40 font-black'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                2. 프로
              </button>
              <button
                type="button"
                onClick={() => setDesignTheme('industrial')}
                className={`rounded-full px-2.5 py-1 transition font-bold ${
                  isIndustrial
                    ? 'bg-amber-500 text-slate-950 shadow-[0_0_12px_rgba(245,158,11,0.5)] font-black'
                    : isEnterprise
                      ? 'text-slate-600 hover:text-slate-900'
                      : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                3. 산업
              </button>
            </div>

            <div className={`hidden items-center gap-2 rounded-full border px-3 py-2 text-sm md:flex ${
              isEnterprise
                ? 'border-slate-200 bg-slate-50 text-slate-700'
                : isIndustrial
                  ? 'border-slate-700 bg-[#0f141d] text-slate-300'
                  : 'border-slate-700/80 bg-slate-900/80 text-slate-300'
            }`}>
              <Store
                size={15}
                className={
                  isEnterprise
                    ? 'text-blue-600'
                    : isIndustrial
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                }
              />
              <span>전체 지점</span>
              <ChevronRight size={14} className={isEnterprise ? 'text-slate-400' : 'text-slate-500'} />
            </div>
            <Button
              type="button"
              onClick={() => setIsPlateModalOpen(true)}
              className={`min-h-11 rounded-xl font-bold px-3 sm:px-4 transition flex items-center gap-1.5 ${
                isEnterprise
                  ? 'border-2 border-blue-600 bg-white text-blue-700 hover:bg-blue-50 font-bold'
                  : isIndustrial
                    ? 'border-2 border-amber-500 bg-[#161d28] text-amber-400 hover:bg-amber-500/15 font-black'
                    : 'border border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
              }`}
            >
              <Camera size={17} />
              <span>번호판 간편접수</span>
            </Button>
            <Button
              onClick={() => navigate('upload')}
              className={`min-h-11 rounded-xl font-black px-3 sm:px-4 transition ${
                isEnterprise
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm font-bold'
                  : isIndustrial
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md font-black tracking-tight'
                    : 'bg-emerald-500 hover:bg-emerald-400 glow-emerald font-bold text-slate-950'
              }`}
            >
              <CloudUpload size={17} />
              <span className="hidden sm:inline">
                {isIndustrial ? 'LIVE TABLET' : '사진 업로드'}
              </span>
            </Button>
          </header>
          {notice && (
            <div className={`mx-4 mt-4 flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-semibold sm:mx-7 lg:mx-10 ${
              isEnterprise
                ? 'border-blue-200 bg-blue-50 text-blue-800'
                : isIndustrial
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 glow-box-amber'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 glow-box-emerald'
            }`}>
              <span>{notice}</span>
              <button
                onClick={() => setNotice('')}
                aria-label="알림 닫기"
                className={
                  isEnterprise
                    ? 'text-blue-600 hover:text-blue-800'
                    : isIndustrial
                      ? 'text-amber-400 hover:text-amber-200'
                      : 'text-emerald-400 hover:text-emerald-200'
                }
              >
                <X size={16} />
              </button>
            </div>
          )}
        <div className="p-3 sm:p-7 lg:p-10">
          {view === 'dashboard' && (
            <Dashboard
              documents={documents}
              pending={pending}
              approvedCount={approvedToday.length}
              approvedRevenue={approvedRevenue}
              stats={dashboardStats}
              orders={orders}
              navigate={navigate}
              onOpenPlateModal={() => setIsPlateModalOpen(true)}
            />
          )}
          {view === 'upload' && (
            <Upload
              documents={documents}
              setDocuments={setDocuments}
              setNotice={setNotice}
              navigate={navigate}
              setSelectedId={setSelectedId}
              setProcessingSummary={setProcessingSummary}
              onUploaded={refreshAllData}
              prefillPlate={prefillPlate}
            />
          )}
          {view === 'processing' && (
            <Processing
              documents={documents}
              summary={processingSummary}
              navigate={navigate}
            />
          )}
          {view === 'review' && (
            <Review
              documents={documents}
              setDocuments={setDocuments}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              setNotice={setNotice}
              onDataChanged={refreshAllData}
            />
          )}
          {view === 'orders' && <Orders approved={approvedToday} orders={orders} />}
          {view === 'guide' && (
            <GuideView
              navigate={navigate}
              isEnterprise={isEnterprise}
              isIndustrial={isIndustrial}
            />
          )}
          {view === 'customers' && <Customers customers={customers} />}
          {view === 'rentals' && <Rentals rentals={rentals} />}
          {view === 'analytics' && (
            <Analytics
              approvedRevenue={approvedRevenue}
              orders={orders}
              stats={dashboardStats}
            />
          )}
          {view === 'standards' && <Standards />}
          {view === 'excel' && (
            <ExcelView
              documents={documents}
              orders={orders}
              setNotice={setNotice}
            />
          )}
          {view === 'users' && (
            <UsersView
              users={usersData.users}
              roles={usersData.roles}
              onRefresh={refreshAllData}
            />
          )}
          {view === 'audit' && (
            <Audit documents={documents} auditLogs={auditLogs} />
          )}
        </div>
        <nav
          aria-label="모바일 주요 메뉴"
          className={`safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t px-2 pt-1.5 backdrop-blur-xl lg:hidden transition-colors ${
            isEnterprise
              ? 'border-slate-200 bg-white/95 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]'
              : 'border-slate-800/90 bg-[#090d16]/95 shadow-[0_-8px_30px_rgba(0,0,0,.6)]'
          }`}
        >
          {[
            { id: 'dashboard' as View, label: '홈', icon: LayoutDashboard },
            { id: 'upload' as View, label: '촬영·업로드', icon: Camera },
            { id: 'review' as View, label: '검수', icon: ClipboardCheck },
            { id: 'orders' as View, label: '정비내역', icon: ReceiptText },
          ].map((item) => {
            const Icon = item.icon;
            const active = view === item.id;
            return (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[12px] font-bold transition ${
                  active
                    ? isEnterprise
                      ? 'bg-blue-50 text-blue-700 border border-blue-200'
                      : isIndustrial
                        ? 'bg-amber-500/15 text-amber-300 border border-amber-500/40'
                        : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                    : isEnterprise
                      ? 'text-slate-500 hover:text-slate-800'
                      : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.5 : 2} />
                <span>{item.label}</span>
                {item.id === 'review' && pending > 0 && (
                  <span className={`absolute right-[22%] top-1 grid min-h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-black font-mono ${
                    isEnterprise
                      ? 'bg-blue-100 text-blue-800 border border-blue-300'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-[0_0_8px_rgba(245,158,11,0.3)]'
                  }`}>
                    {pending}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* 정비 현장 원터치 모바일 플로팅 셔터 버튼 (FAB) */}
        {view !== 'upload' && (
          <button
            type="button"
            onClick={() => navigate('upload')}
            aria-label="현장 영수증 바로 촬영"
            className={`fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-2xl transition duration-200 hover:scale-105 active:scale-95 lg:hidden ${
              isEnterprise
                ? 'bg-blue-600 text-white shadow-blue-500/30'
                : isIndustrial
                  ? 'bg-[#F59E0B] text-slate-950 shadow-amber-500/40 border-2 border-amber-600'
                  : 'bg-emerald-500 text-slate-950 glow-emerald border border-emerald-400'
            }`}
          >
            <Camera size={26} strokeWidth={2.5} />
          </button>
        )}

        {isPlateModalOpen && (
          <PlateLookupModal
            isOpen={isPlateModalOpen}
            onClose={() => setIsPlateModalOpen(false)}
            onNewRegistration={(plate) => {
              setIsPlateModalOpen(false);
              setPrefillPlate(plate);
              navigate('upload');
              setNotice(`판독된 번호판 [${plate}]이(가) 신규 접수 폼에 자동 지정되었습니다.`);
            }}
            onSelectCustomer={(candidate) => {
              setIsPlateModalOpen(false);
              setPrefillPlate(candidate.fullPlate);
              navigate('upload');
              setNotice(`기존 고객 [${candidate.customerName} - ${candidate.model}]의 정비 접수가 시작되었습니다.`);
            }}
          />
        )}
      </main>
    </div>
    </DesignThemeContext.Provider>
  );
}

function Dashboard({
  documents = [],
  pending,
  approvedCount,
  approvedRevenue,
  stats,
  orders,
  navigate,
  onOpenPlateModal,
}: {
  documents?: ReviewDocument[];
  pending: number;
  approvedCount: number;
  approvedRevenue: number;
  stats: DashboardStats | null;
  orders: OrderRecord[];
  navigate: (view: View) => void;
  onOpenPlateModal?: () => void;
}) {
  const { isIndustrial, isEnterprise } = useDesignTheme();
  const effectivePending = stats ? stats.pendingReviewCount : pending;
  const effectiveApprovedCount = stats ? stats.totalOrders : approvedCount;
  const effectiveRevenue = stats ? stats.totalRevenue : approvedRevenue;

  const displayRows = orders.length > 0
    ? orders.slice(0, 5).map((o) => ({
        id: o.id,
        customer: o.customerName,
        vehicle: `${o.vehicleModel || '차종 미지정'} · ${o.plate || '번호 미지정'}`,
        shop: o.shopName,
        amount: o.totalAmount,
        status: 'DB 승인완료',
      }))
    : [];

  return (
    <div className="space-y-6">
      {/* 번호판 OCR 간편 접수 배너 */}
      <div
        onClick={() => onOpenPlateModal?.()}
        className={`cursor-pointer rounded-xl border p-4 transition-all hover:scale-[1.005] flex items-center justify-between gap-4 ${
          isEnterprise
            ? 'border-blue-300 bg-gradient-to-r from-blue-50 to-indigo-50/50 hover:bg-blue-50 shadow-xs'
            : isIndustrial
              ? 'border-2 border-amber-500/70 bg-gradient-to-r from-[#1b2332] to-[#141a24] hover:border-amber-500 shadow-md'
              : 'border border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 to-slate-900 hover:border-emerald-500/60'
        }`}
      >
        <div className="flex items-center gap-3.5">
          <div className={`p-2.5 rounded-xl shrink-0 ${
            isEnterprise
              ? 'bg-blue-600 text-white shadow-sm'
              : isIndustrial
                ? 'bg-amber-500 text-slate-950 font-black shadow-md'
                : 'bg-emerald-500 text-slate-950 glow-emerald font-bold'
          }`}>
            <Camera size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className={`font-black text-base ${isEnterprise ? 'text-blue-950' : 'text-amber-400'}`}>
                번호판 OCR 간편 접수
              </p>
              <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                타이핑 제로
              </span>
            </div>
            <p className={`text-xs mt-0.5 ${isEnterprise ? 'text-slate-600' : 'text-slate-300'}`}>
              입고 오토바이 번호판만 찰칵 찍으면 번호 자동 입력 및 기존 고객 정비 이력을 1초 만에 확인합니다.
            </p>
          </div>
        </div>
        <Button
          type="button"
          className={`shrink-0 rounded-xl font-bold text-xs px-4 py-2 ${
            isEnterprise
              ? 'bg-blue-600 text-white shadow-sm'
              : isIndustrial
                ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                : 'bg-emerald-500 text-slate-950'
          }`}
        >
          바로 촬영
        </Button>
      </div>

      {/* 현장 실무 가이드 퀵 바로가기 배너 */}
      <div
        onClick={() => navigate('guide')}
        className={`cursor-pointer rounded-xl border p-3.5 sm:p-4 transition-all hover:scale-[1.005] flex items-center justify-between gap-4 ${
          isEnterprise
            ? 'border-blue-200 bg-blue-50/60 hover:bg-blue-50'
            : isIndustrial
              ? 'border-slate-800 bg-[#161d28] hover:border-amber-500/50'
              : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg shrink-0 ${isEnterprise ? 'bg-blue-100 text-blue-700' : 'bg-amber-500/20 text-amber-300'}`}>
            <BookOpen size={20} />
          </div>
          <div>
            <p className={`font-bold text-sm ${isEnterprise ? 'text-slate-900' : 'text-slate-100'}`}>
              현장 실무 테스트 5단계 순서 가이드
            </p>
            <p className="text-xs text-slate-400 hidden sm:block">
              스마트폰 촬영부터 Gemini 3.8 AI 판독, 0.5초 검수 승인, 알림톡 명세서 발송까지 한눈에 확인하세요.
            </p>
          </div>
        </div>
        <div className={`flex items-center gap-1 font-extrabold text-xs shrink-0 ${isEnterprise ? 'text-blue-600' : 'text-amber-400'}`}>
          가이드 보기 <ChevronRight size={16} />
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <Metric
          label="검수 대기"
          value={`${effectivePending}건`}
          note={effectivePending > 0 ? "사람의 확인이 필요한 정비서" : "모든 정비서 검수 완료"}
          icon={ClipboardCheck}
          tone="amber"
          onClick={() => navigate('review')}
        />
        <Metric
          label="오늘 승인"
          value={`${effectiveApprovedCount}건`}
          note="DB 영구 저장 완료된 정비"
          icon={BadgeCheck}
          tone="green"
        />
        <Metric
          label="오늘 반영 매출"
          value={won.format(effectiveRevenue)}
          note="검수 승인분만 정밀 집계"
          icon={CircleDollarSign}
          tone="blue"
        />
        <Metric
          label="AI 자동등록"
          value="0건"
          note="기준 신뢰도 96% 미만 자동차단"
          icon={ScanLine}
          tone="purple"
        />
      </section>
      <div className="grid gap-6 xl:grid-cols-[1.45fr_.75fr]">
        <section className="panel p-5 sm:p-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">운영 흐름</p>
              <h2 className="section-title">검수가 필요한 이유</h2>
            </div>
            <Button
              variant="outline"
              className={`rounded-xl transition font-bold ${
                isEnterprise
                  ? 'border-slate-200 text-slate-700 hover:border-blue-500 hover:text-blue-600'
                  : isIndustrial
                    ? 'border-2 border-slate-300 bg-white text-slate-900 hover:border-amber-500 hover:text-amber-700'
                    : 'border-slate-700 text-slate-300 hover:border-emerald-500 hover:text-emerald-400'
              }`}
              onClick={() => navigate('review')}
            >
              대기함 열기 <ChevronRight size={16} />
            </Button>
          </div>
          <div className="space-y-3">
            {[
              [
                '매장 미확정',
                documents.filter(
                  (d) =>
                    d.status === 'pending' &&
                    (d.shopCertainty === 'unknown' || !d.shopName || d.shopName === '미확인'),
                ).length,
                '사진의 지점 표시가 없거나 흐립니다.',
                'bg-amber-500/15 text-amber-400 border border-amber-500/30',
              ],
              [
                '차종 후보',
                documents.filter(
                  (d) =>
                    d.status === 'pending' &&
                    d.fields?.some((f) => f.key === 'vehicle_model' && f.validationStatus === 'review'),
                ).length,
                '배기량 또는 연식을 확정할 수 없습니다.',
                'bg-sky-500/15 text-sky-400 border border-sky-500/30',
              ],
              [
                '0원 정비',
                documents.filter((d) => d.status === 'pending' && d.amount === 0).length,
                '렌트 정비 여부를 확인해야 합니다.',
                'bg-rose-500/15 text-rose-400 border border-rose-500/30',
              ],
              [
                '중복 후보',
                documents.filter((d) => d.status === 'pending' && d.duplicateCandidate).length,
                '원본 해시와 작업 항목이 유사합니다.',
                'bg-purple-500/15 text-purple-400 border border-purple-500/30',
              ],
            ].map(([label, count, description, tone]) => (
              <div
                key={String(label)}
                className={`flex items-center gap-4 rounded-xl border p-4 transition ${
                  isEnterprise
                    ? 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50'
                    : isIndustrial
                      ? 'border-2 border-slate-200 bg-white text-slate-950 hover:bg-slate-50 shadow-xs'
                      : 'border-slate-800/90 bg-slate-900/60 text-slate-100 hover:border-slate-700 hover:bg-slate-900'
                }`}
              >
                <span
                  className={`grid h-10 w-10 place-items-center rounded-xl text-sm font-black font-mono ${tone}`}
                >
                  {count}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`font-bold ${isEnterprise || isIndustrial ? 'text-slate-900' : 'text-slate-100'}`}>{label}</p>
                  <p className={`text-sm ${isEnterprise || isIndustrial ? 'text-slate-500' : 'text-slate-400'}`}>{description}</p>
                </div>
                <ChevronRight size={17} className={isEnterprise || isIndustrial ? 'text-slate-400' : 'text-slate-600'} />
              </div>
            ))}
          </div>
        </section>
        <section className="panel overflow-hidden">
          <div className={`border-b p-5 sm:p-6 ${
            isEnterprise || isIndustrial ? 'border-slate-200' : 'border-slate-800'
          }`}>
            <p className="eyebrow">기존 데이터</p>
            <h2 className="section-title">
              {baselineReference.serviceOrders > 0 ? '재검증 대기' : '기준 엑셀 연결 대기 (0건)'}
            </h2>
          </div>
          <div className="p-5 sm:p-6">
            <div className={`mb-5 flex items-start gap-3 rounded-xl border p-4 ${
              isEnterprise || isIndustrial
                ? 'border-amber-300 bg-amber-50 text-amber-900'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-200/90'
            }`}>
              <AlertTriangle
                className={`mt-0.5 shrink-0 ${isEnterprise || isIndustrial ? 'text-amber-600' : 'text-amber-400'}`}
                size={19}
              />
              <p className="text-sm leading-6">
                {baselineReference.serviceOrders > 0
                  ? '원본 엑셀이 전달되지 않아 아래 값은 사용자 제공 기준값입니다. 매출로 확정하지 않았습니다.'
                  : '등록된 과거 엑셀 데이터가 없습니다. 원본 엑셀 파일을 연결하면 과거 기준값과 비교 분석됩니다.'}
              </p>
            </div>
            <dl className="space-y-3">
              <InfoRow
                label="정비"
                value={`${baselineReference.serviceOrders}건`}
              />
              <InfoRow
                label="정비항목"
                value={`${baselineReference.serviceItems}개`}
              />
              <InfoRow
                label="참조 매출"
                value={won.format(baselineReference.revenue)}
              />
              <InfoRow label="기간" value={baselineReference.period} />
            </dl>
            <Button
              variant="outline"
              className={`mt-6 w-full rounded-xl transition ${
                isEnterprise
                  ? 'border-slate-200 text-slate-700 hover:border-blue-500 hover:text-blue-600'
                  : isIndustrial
                    ? 'border-2 border-slate-300 bg-white text-slate-900 font-bold hover:border-amber-500 hover:text-amber-700'
                    : 'border-slate-700 text-slate-300 hover:border-emerald-500 hover:text-emerald-400'
              }`}
              onClick={() => navigate('excel')}
            >
              <FileSpreadsheet size={16} /> 원본 엑셀 연결
            </Button>
          </div>
        </section>
      </div>
      <section className="panel overflow-hidden">
        <div className={`flex items-center justify-between border-b p-5 sm:p-6 ${
          isEnterprise || isIndustrial ? 'border-slate-200' : 'border-slate-800'
        }`}>
          <div>
            <p className="eyebrow">최근 기록</p>
            <h2 className="section-title">
              승인된 정비 {orders.length > 0 ? `(${orders.length}건)` : '(0건)'}
            </h2>
          </div>
          <Button
            variant="ghost"
            className={`font-bold ${
              isEnterprise
                ? 'text-blue-600 hover:text-blue-700 hover:bg-blue-50'
                : isIndustrial
                  ? 'text-amber-700 hover:text-amber-800 hover:bg-amber-50'
                  : 'text-slate-400 hover:text-emerald-400 hover:bg-slate-800'
            }`}
            onClick={() => navigate('orders')}
          >
            전체 보기 <ChevronRight size={16} />
          </Button>
        </div>
        <OrderTable rows={displayRows} />
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  icon: Icon,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  note: string;
  icon: typeof Activity;
  tone: string;
  onClick?: () => void;
}) {
  const { isIndustrial, isEnterprise } = useDesignTheme();
  const tones: Record<string, string> = {
    amber: isEnterprise
      ? 'bg-amber-50 text-amber-800 border border-amber-300'
      : isIndustrial
        ? 'bg-amber-500/20 text-amber-800 border-2 border-amber-500/50'
        : 'bg-amber-500/15 text-amber-400 border border-amber-500/30 glow-box-amber',
    green: isEnterprise
      ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
      : isIndustrial
        ? 'bg-emerald-500/20 text-emerald-800 border-2 border-emerald-500/50'
        : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 glow-box-emerald',
    blue: isEnterprise
      ? 'bg-blue-50 text-blue-800 border border-blue-300'
      : isIndustrial
        ? 'bg-sky-500/20 text-sky-800 border-2 border-sky-500/50'
        : 'bg-sky-500/15 text-sky-400 border border-sky-500/30',
    purple: isEnterprise
      ? 'bg-purple-50 text-purple-800 border border-purple-300'
      : isIndustrial
        ? 'bg-purple-500/20 text-purple-800 border-2 border-purple-500/50'
        : 'bg-purple-500/15 text-purple-400 border border-purple-500/30',
  };
  return (
    <button
      onClick={onClick}
      className={`panel group min-h-[150px] p-4 text-left transition duration-200 hover:-translate-y-1 sm:min-h-0 sm:p-5 ${
        isEnterprise
          ? 'hover:border-blue-300 hover:shadow-md'
          : isIndustrial
            ? 'hover:border-amber-500 hover:shadow-md'
            : 'hover:border-slate-700 hover:shadow-[0_16px_36px_rgba(0,0,0,0.5)]'
      }`}
    >
      <div className="mb-5 flex items-center justify-between">
        <span
          className={`grid h-11 w-11 place-items-center rounded-xl ${tones[tone]}`}
        >
          <Icon size={21} />
        </span>
        {onClick && (
          <ChevronRight
            size={18}
            className={`transition ${
              isEnterprise
                ? 'text-slate-400 group-hover:text-blue-600'
                : isIndustrial
                  ? 'text-slate-400 group-hover:text-amber-600'
                  : 'text-slate-600 group-hover:text-emerald-400'
            }`}
          />
        )}
      </div>
      <p className={`text-xs font-bold tracking-wide uppercase ${
        isEnterprise || isIndustrial ? 'text-slate-500' : 'text-slate-400'
      }`}>{label}</p>
      <p className={`mt-1 text-[22px] font-black tracking-[-.04em] font-mono tabular-nums sm:text-[28px] ${
        isEnterprise || isIndustrial ? 'text-slate-950' : 'text-slate-100'
      }`}>{value}</p>
      <p className={`mt-2 line-clamp-2 text-xs leading-4 ${
        isEnterprise || isIndustrial ? 'text-slate-500 font-medium' : 'text-slate-500'
      }`}>{note}</p>
    </button>
  );
}

function Upload({
  documents,
  setDocuments,
  setNotice,
  navigate,
  setSelectedId,
  setProcessingSummary,
  onUploaded,
  prefillPlate,
}: {
  documents: ReviewDocument[];
  setDocuments: (value: ReviewDocument[]) => void;
  setNotice: (value: string) => void;
  navigate: (view: View) => void;
  setSelectedId: (value: string) => void;
  setProcessingSummary: (value: ProcessingSummary) => void;
  onUploaded?: () => void;
  prefillPlate?: string;
}) {
  const { isIndustrial, isEnterprise, isCockpit } = useDesignTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [shopId, setShopId] = useState('yongjeon');
  const [submitting, setSubmitting] = useState(false);
  const start = async () => {
    if (!files.length) return;
    setSubmitting(true);
    setNotice('');
    try {
      const form = new FormData();
      form.set('shopId', shopId);
      if (prefillPlate) {
        form.set('prefillPlate', prefillPlate);
      }
      const optimizedFiles = await Promise.all(
        files.map((file) => optimizeReceiptImage(file)),
      );
      optimizedFiles.forEach((file) => form.append('files', file));
      const response = await fetch('/api/extractions', {
        method: 'POST',
        body: form,
      });
      const payload = (await response.json()) as ProcessingSummary & {
        documents?: ReviewDocument[];
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || '사진 판독에 실패했습니다.');
      const next = payload.documents ?? [];
      setDocuments([...next, ...documents]);
      if (next[0]) setSelectedId(next[0].id);
      setProcessingSummary(payload);
      setFiles([]);
      setNotice(
        payload.failed
          ? `${payload.succeeded}장은 검수함에 등록했고 ${payload.failed}장은 판독에 실패했습니다.`
          : `${payload.succeeded}장을 Gemini 3.8 Flash로 판독해 검수함에 등록했습니다.`,
      );
      navigate('processing');
      onUploaded?.();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '사진 판독에 실패했습니다.',
      );
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <section className="panel p-4 sm:p-8">
        {prefillPlate && (
          <div className="mb-5 flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 sm:p-4 text-amber-300">
            <div className="flex items-center gap-2.5">
              <Camera size={19} className="text-amber-400 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-amber-400">번호판 간편 접수 연동 활성화</p>
                <p className="text-sm font-black font-mono tracking-tight text-white sm:text-base">
                  차량 번호판: {prefillPlate}
                </p>
              </div>
            </div>
            <span className="rounded bg-amber-500/20 px-2 py-1 text-[11px] font-mono text-amber-300 font-bold border border-amber-500/30">
              신규 영수증과 자동 연동
            </span>
          </div>
        )}
        <div className="mb-5 grid gap-2 sm:grid-cols-[160px_1fr] sm:items-center">
          <label className="text-sm font-extrabold" htmlFor="work-shop-select">
            실제 작업센터
          </label>
          <Select value={shopId} onValueChange={(value) => setShopId(value ?? 'yongjeon')}>
            <SelectTrigger
              id="work-shop-select"
              className="h-11 w-full rounded-xl border-[#9ecbc1] bg-white"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="yongjeon">진바이크 용전센터</SelectItem>
              <SelectItem value="jayang">코아바이크 자양센터</SelectItem>
            </SelectContent>
          </Select>
          <span className="sm:col-start-2 text-xs leading-5 text-[#6d817c]">
            담당자 권한 범위와 별개로 이번 사진의 실제 작업센터를 저장합니다.
          </span>
        </div>
        <div
          aria-label="정비내역서 사진 선택"
          className={`group relative grid min-h-[280px] w-full place-items-center rounded-2xl border-2 border-dashed p-5 text-center transition sm:min-h-[360px] sm:p-8 ${
            isEnterprise
              ? 'border-slate-300 bg-slate-50/70 hover:border-blue-500 hover:bg-blue-50/40'
              : isIndustrial
                ? 'border-slate-300 bg-[#edf0f5] hover:border-amber-500 hover:bg-amber-50/30'
                : 'border-slate-800 bg-slate-900/50 hover:border-emerald-500 hover:bg-emerald-500/5'
          }`}
        >
          {/* 현장 촬영 뷰파인더 모서리 가이드 (HUD) */}
          <div className="pointer-events-none absolute inset-4 border border-dashed border-slate-500/20 rounded-xl">
            <div className="absolute left-0 top-0 h-4 w-4 border-l-2 border-t-2 border-amber-500/70" />
            <div className="absolute right-0 top-0 h-4 w-4 border-r-2 border-t-2 border-amber-500/70" />
            <div className="absolute bottom-0 left-0 h-4 w-4 border-b-2 border-l-2 border-amber-500/70" />
            <div className="absolute bottom-0 right-0 h-4 w-4 border-b-2 border-r-2 border-amber-500/70" />
          </div>

          <div>
            <div className={`mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl transition ${
              isEnterprise
                ? 'bg-blue-100 text-blue-700'
                : isIndustrial
                  ? 'bg-amber-500 text-slate-950 font-black shadow-md'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 glow-box-emerald'
            }`}>
              <Camera size={32} />
            </div>
            <h2 className={`text-xl font-extrabold ${
              isEnterprise || isIndustrial ? 'text-slate-900' : 'text-slate-100'
            }`}>
              정비내역서 사진을 촬영하거나 선택하세요
            </h2>
            <p className={`mx-auto mt-2 max-w-md text-sm leading-6 ${
              isEnterprise || isIndustrial ? 'text-slate-500' : 'text-slate-400'
            }`}>
              스마트폰 카메라로 정면에서 영수증 모서리가 보이게 찍어주세요.<br />
              고화질 사진은 1초 내로 자동 압축 및 회전 보정되어 전송됩니다.
            </p>
            <div className="mt-5 grid gap-2 sm:flex sm:justify-center">
              <Button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className={`min-h-12 rounded-xl px-6 font-bold transition ${
                  isEnterprise
                    ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
                    : isIndustrial
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-md'
                      : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 glow-emerald font-bold'
                }`}
              >
                <Camera size={19} /> 모바일 바로 촬영
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => inputRef.current?.click()}
                className={`min-h-12 rounded-xl px-5 font-bold transition ${
                  isEnterprise || isIndustrial
                    ? 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                    : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
                }`}
              >
                <CloudUpload size={18} /> 앨범에서 여러 장 선택
              </Button>
            </div>
          </div>
        </div>
        <input
          aria-label="카메라로 정비내역서 촬영"
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
        <input
          aria-label="정비내역서 사진 선택"
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
        {files.length > 0 && (
          <div className="mt-5 rounded-xl border border-[#dce9e6] bg-white p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="font-bold">선택한 사진 {files.length}장</p>
              <button
                className="text-sm text-[#a23f36]"
                onClick={() => setFiles([])}
                disabled={submitting}
              >
                비우기
              </button>
            </div>
            <div className="max-h-44 space-y-2 overflow-y-auto">
              {files.map((file) => (
                <div
                  key={`${file.name}-${file.size}`}
                  className="flex items-center gap-3 rounded-lg bg-[#f5f8f7] px-3 py-2 text-sm"
                >
                  <ScanLine size={16} className="text-[#0d7b68]" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="text-xs text-[#768985]">
                    {Math.max(1, Math.round(file.size / 1024))} KB
                  </span>
                </div>
              ))}
            </div>
            <Button
              onClick={start}
              disabled={submitting}
              className="mt-4 w-full rounded-xl bg-[#0d6d5d]"
            >
              {submitting ? (
                <>
                  <Spinner /> Gemini 판독 중
                </>
              ) : (
                <>
                  <ScanLine size={17} /> AI 판독 시작
                </>
              )}
            </Button>
          </div>
        )}
      </section>
      <aside className="space-y-5">
        <section className="panel p-5">
          <p className="eyebrow">처리 방식</p>
          <h3 className="section-title mb-4">안전한 자동화</h3>
          <div className="space-y-4">
            {[
              ['1', '원본 보존', '이미지 해시와 배치 ID를 함께 기록'],
              ['2', 'AI 구조화', '필드값·신뢰도·근거 위치 저장'],
              ['3', '선별 검수', '불확실한 값만 사람에게 표시'],
              ['4', '승인 반영', '승인 이후에만 매출과 고객 이력 갱신'],
            ].map(([n, title, text]) => (
              <div className="flex gap-3" key={n}>
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#dff6f0] text-xs font-black text-[#0b6b5b]">
                  {n}
                </span>
                <div>
                  <p className="text-sm font-bold">{title}</p>
                  <p className="text-xs leading-5 text-[#6d817c]">{text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="rounded-2xl bg-[#0d3c35] p-5 text-white">
          <div className="flex items-center gap-2 text-[#8fe0cf]">
            <Database size={17} />
            <span className="text-xs font-bold uppercase tracking-widest">
              Gemini 3.8 Flash
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-[#c7ded9]">
            원본은 비공개 저장소에 보존하고 판독 결과는 암호화·검수 대기 상태로 저장합니다. 승인 전에는 매출에 반영하지 않습니다.
          </p>
        </section>
      </aside>
    </div>
  );
}

function Processing({
  documents,
  summary,
  navigate,
}: {
  documents: ReviewDocument[];
  summary: ProcessingSummary | null;
  navigate: (view: View) => void;
}) {
  const items = [
    '원본 저장',
    '회전·원근·명암 보정',
    '손글씨 구조화',
    '업무 규칙 검증',
    '검수함 등록',
  ];
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <section className="panel overflow-hidden">
        <div className="border-b border-[#e2ece9] p-5 sm:p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="eyebrow">
                {summary?.batchId ?? '최근 처리 배치 없음'}
              </p>
              <h2 className="section-title">
                {summary ? `${summary.succeeded}장 처리 완료` : '사진을 먼저 등록하세요'}
              </h2>
            </div>
            <StatusBadge label="검수 대기" tone="amber" />
          </div>
        </div>
        <div className="space-y-6 p-5 sm:p-6">
          {items.map((label) => (
            <div key={label}>
              <div className="mb-2 flex justify-between text-sm">
                <span className="font-semibold">{label}</span>
                <span className="font-bold text-[#0a725f]">완료</span>
              </div>
              <Progress
                value={summary ? 100 : 0}
                className="h-2 bg-[#e4eeec] [&>div]:bg-[#18a989]"
              />
            </div>
          ))}
        </div>
      </section>
      <aside className="panel p-5">
        <p className="eyebrow">결과</p>
        <h2 className="section-title">자동등록 0건</h2>
        <div className="my-5 rounded-xl bg-[#fff8e9] p-4 text-sm leading-6 text-[#79561e]">
          {summary
            ? `${summary.model} 판독을 완료했습니다. 실패한 ${summary.failed}장은 매출이나 검수 데이터에 반영하지 않았습니다.`
            : '사진 업로드 후 실제 처리 결과와 실패 건수를 확인할 수 있습니다.'}
        </div>
        <InfoRow label="이번 배치" value={`${summary?.total ?? 0}건`} />
        <InfoRow
          label="검수 대기"
          value={`${documents.filter((item) => item.status === 'pending').length}건`}
        />
        <InfoRow label="오류" value={`${summary?.failed ?? 0}건`} />
        <Button
          className="mt-6 w-full rounded-xl bg-[#0d6d5d]"
          onClick={() => navigate('review')}
        >
          검수 시작
        </Button>
      </aside>
    </div>
  );
}

function Review({
  documents,
  setDocuments,
  selectedId,
  setSelectedId,
  setNotice,
  onDataChanged,
}: {
  documents: ReviewDocument[];
  setDocuments: (value: ReviewDocument[]) => void;
  selectedId: string;
  setSelectedId: (id: string) => void;
  setNotice: (value: string) => void;
  onDataChanged?: () => void;
}) {
  const [resolving, setResolving] = useState(false);
  const pendingDocs = documents.filter(
    (document) => document.status === 'pending',
  );
  const selected =
    documents.find(
      (document) => document.id === selectedId && document.status === 'pending',
    ) ?? pendingDocs[0];
  const updateField = (fieldId: string, correctedValue: string) =>
    setDocuments(
      documents.map((document) =>
        document.id !== selected?.id
          ? document
          : {
              ...document,
              fields: document.fields.map((field) =>
                field.id === fieldId ? { ...field, correctedValue } : field,
              ),
            },
      ),
    );
  const resolve = async (status: 'approved' | 'rejected') => {
    if (!selected) return;
    setResolving(true);
    try {
      const response = await fetch(
        `/api/reviews/${encodeURIComponent(selected.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status,
            fields: selected.fields
              .filter((field) => field.key !== 'shop')
              .map((field) => ({
                id: field.id,
                key: field.key,
                correctedValue: field.correctedValue ?? field.normalizedValue,
              })),
          }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error || '검수 결과를 저장하지 못했습니다.');
      setDocuments(
        documents.map((document) =>
          document.id === selected.id ? { ...document, status } : document,
        ),
      );
      const next = pendingDocs.find((document) => document.id !== selected.id);
      if (next) setSelectedId(next.id);
      setNotice(
        status === 'approved'
          ? '승인했습니다. 판독값과 승인 이력을 영구 저장했습니다.'
          : '반려했습니다. 원본과 판독 데이터는 감사 이력에 보존됩니다.',
      );
      onDataChanged?.();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : '검수 결과를 저장하지 못했습니다.',
      );
    } finally {
      setResolving(false);
    }
  };
  const { isIndustrial, isEnterprise } = useDesignTheme();

  if (!selected)
    return (
      <EmptyState
        title="검수가 모두 끝났습니다"
        text="승인한 건은 정비내역과 매출에 반영되었습니다."
      />
    );
  return (
    <div className={`grid min-h-[680px] overflow-hidden rounded-2xl transition shadow-xl xl:grid-cols-[330px_1fr] ${
      isEnterprise
        ? 'border border-slate-200 bg-white shadow-md'
        : isIndustrial
          ? 'border-2 border-slate-300 bg-white shadow-xl'
          : 'border border-slate-800 bg-[#0d131f] shadow-[0_16px_40px_rgba(0,0,0,0.5)]'
    }`}>
      <aside className={`border-b xl:border-b-0 xl:border-r ${
        isEnterprise
          ? 'border-slate-200 bg-slate-50/70'
          : isIndustrial
            ? 'border-slate-300 bg-[#f8fafc]'
            : 'border-slate-800 bg-[#090d16]'
      }`}>
        <div className={`border-b p-4 ${
          isEnterprise || isIndustrial ? 'border-slate-200' : 'border-slate-800'
        }`}>
          <div className="relative">
            <Search
              className={`absolute left-3 top-1/2 -translate-y-1/2 ${
                isEnterprise || isIndustrial ? 'text-slate-400' : 'text-slate-500'
              }`}
              size={16}
            />
            <Input
              aria-label="검수 문서 검색"
              placeholder="고객, 차량, 파일 검색"
              className={`rounded-xl pl-9 ${
                isEnterprise
                  ? 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-blue-500'
                  : isIndustrial
                    ? 'border-2 border-slate-300 bg-white text-slate-950 font-bold placeholder:text-slate-400 focus:border-amber-500'
                    : 'border-slate-700 bg-slate-950 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500'
              }`}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <Badge
              variant="secondary"
              className={
                isEnterprise
                  ? 'bg-blue-100 text-blue-800 border border-blue-200 font-bold'
                  : isIndustrial
                    ? 'bg-amber-500 text-slate-950 font-black border border-amber-600'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 glow-box-amber'
              }
            >
              대기 {pendingDocs.length}
            </Badge>
            <Badge
              variant="outline"
              className={
                isEnterprise || isIndustrial
                  ? 'border-slate-200 text-slate-600 font-semibold'
                  : 'border-slate-700 text-slate-400'
              }
            >
              낮은 신뢰도 우선
            </Badge>
          </div>
        </div>
        <div className="flex snap-x gap-2 overflow-x-auto p-3 xl:block xl:max-h-[590px] xl:space-y-0 xl:overflow-y-auto xl:p-0">
          {pendingDocs.map((document) => {
            const issues =
              document.fields.filter((item) => shouldHighlightField(item))
                .length + Number(document.duplicateCandidate);
            const isSelected = document.id === selected.id;
            return (
              <button
                aria-label={`${document.customerName} ${document.vehicleLabel} 검수`}
                key={document.id}
                onClick={() => setSelectedId(document.id)}
                className={`min-w-[250px] snap-start rounded-xl border p-4 text-left transition xl:w-full xl:min-w-0 xl:rounded-none xl:border-x-0 xl:border-t-0 ${
                  isSelected
                    ? isEnterprise
                      ? 'bg-blue-50/80 border-l-4 border-l-blue-600 border-slate-200 text-slate-900 shadow-xs'
                      : isIndustrial
                        ? 'bg-amber-500/15 border-l-4 border-l-amber-500 border-slate-200 text-slate-950 font-bold shadow-xs'
                        : 'bg-emerald-500/10 border-l-2 border-l-emerald-400 border-slate-800 text-slate-100'
                    : isEnterprise || isIndustrial
                      ? 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                      : 'bg-slate-900/30 border-slate-800/80 text-slate-300 hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className={`truncate text-sm font-extrabold ${
                      isEnterprise || isIndustrial ? 'text-slate-950' : 'text-slate-100'
                    }`}>
                      {document.customerName} · {document.vehicleLabel}
                    </p>
                    <p className={`mt-1 truncate text-xs ${
                      isEnterprise || isIndustrial ? 'text-slate-500' : 'text-slate-400'
                    }`}>
                      {document.fileName}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[11px] font-black font-mono border ${
                    isEnterprise
                      ? 'bg-amber-100 text-amber-800 border-amber-300'
                      : isIndustrial
                        ? 'bg-amber-500 text-slate-950 border-amber-600'
                        : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  }`}>
                    {issues}개
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className={isEnterprise || isIndustrial ? 'text-slate-500 font-medium' : 'text-slate-400'}>
                    {document.shopName}
                  </span>
                  <strong className={`font-mono tabular-nums ${
                    isEnterprise
                      ? 'text-blue-600 font-bold'
                      : isIndustrial
                        ? 'text-amber-600 font-black'
                        : 'text-emerald-400'
                  }`}>
                    {won.format(document.amount)}
                  </strong>
                </div>
              </button>
            );
          })}
        </div>
      </aside>
      <section className="min-w-0">
        <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 ${
          isEnterprise
            ? 'border-slate-200 bg-slate-50/90'
            : isIndustrial
              ? 'border-b-2 border-slate-200 bg-slate-100/90'
              : 'border-slate-800 bg-[#0d131f]'
        }`}>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <p className={`text-sm font-extrabold ${
                isEnterprise || isIndustrial ? 'text-slate-950' : 'text-slate-100'
              }`}>
                {selected.fileName}
              </p>
              <p className={`text-xs font-mono ${
                isEnterprise || isIndustrial ? 'text-slate-500' : 'text-slate-400'
              }`}>
                {selected.id} · 2026-09-06
              </p>
            </div>
            {isIndustrial && (
              <div className="flex items-center gap-2 ml-2 pl-3 border-l-2 border-slate-300">
                <span className="rounded-md bg-[#18202F] px-3 py-1 text-xs font-black font-mono text-white shadow-xs">
                  PASS 98%
                </span>
                <span className="rounded-md bg-[#F59E0B] px-3 py-1 text-xs font-black font-mono text-slate-950 shadow-xs">
                  WARNING 1
                </span>
                <span className="rounded-md border-2 border-slate-900 bg-white px-3 py-0.5 text-xs font-black font-mono text-slate-900 shadow-xs">
                  MANUAL CHECK
                </span>
              </div>
            )}
          </div>
          <div className="hidden gap-2 sm:flex">
            <Button
              variant="outline"
              className={`rounded-xl font-bold transition ${
                isEnterprise
                  ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                  : isIndustrial
                    ? 'border-2 border-slate-300 bg-white text-slate-800 hover:bg-rose-50 hover:border-rose-300 hover:text-rose-700 h-10 px-4'
                    : 'border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300'
              }`}
              onClick={() => resolve('rejected')}
              disabled={resolving}
            >
              <X size={16} /> 반려
            </Button>
            <Button
              className={`rounded-xl font-black transition ${
                isEnterprise
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm h-10 px-5'
                  : isIndustrial
                    ? 'bg-[#F59E0B] hover:bg-[#D97706] text-slate-950 shadow-md h-10 px-6 tracking-wide'
                    : 'bg-emerald-500 hover:bg-emerald-400 glow-emerald font-bold text-slate-950'
              }`}
              onClick={() => resolve('approved')}
              disabled={resolving}
            >
              <Check size={16} /> 수정 후 승인
            </Button>
          </div>
        </div>
        <div className="grid lg:grid-cols-[minmax(300px,.9fr)_minmax(360px,1.1fr)]">
          <DocumentPreview document={selected} />
          <div className={`p-4 sm:p-6 ${
            isEnterprise || isIndustrial ? 'bg-white' : 'bg-[#0d131f]'
          }`}>
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className={`eyebrow ${isIndustrial ? 'text-amber-600 font-black' : isEnterprise ? 'text-blue-600 font-bold' : ''}`}>
                  {isIndustrial ? 'Inputs & Field Inspection' : 'AI 판독'}
                </p>
                <h2 className={`section-title ${
                  isEnterprise || isIndustrial ? 'text-slate-950 font-black' : ''
                }`}>
                  확인이 필요한 항목
                </h2>
              </div>
              <Badge className={
                isEnterprise
                  ? 'bg-amber-100 text-amber-800 border border-amber-300 font-bold'
                  : isIndustrial
                    ? 'bg-amber-500 text-slate-950 font-black border border-amber-600 text-xs px-2.5 py-1'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40 glow-box-amber'
              }>
                {
                  selected.fields.filter((item) => shouldHighlightField(item))
                    .length
                }
                개 주의
              </Badge>
            </div>

            {/* In Industrial mode: Badges State & Field Quick Guide */}
            {isIndustrial && (
              <div className="mb-5 rounded-xl border-2 border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700">
                <p className="font-bold text-slate-900 mb-2 flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                  현장 모바일/태블릿 원터치 검수 가이드
                </p>
                <div className="grid grid-cols-3 gap-2 text-center font-mono font-bold">
                  <div className="rounded border border-slate-300 bg-white py-1 text-slate-800 shadow-xs">
                    PASS: 정상 필드
                  </div>
                  <div className="rounded border border-amber-300 bg-amber-100 py-1 text-amber-900 shadow-xs">
                    WARN: 보정 필요
                  </div>
                  <div className="rounded border-2 border-slate-900 bg-white py-0.5 text-slate-900 shadow-xs">
                    CHECK: 수기 입력
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {selected.fields.map((field) => {
                const highlight = shouldHighlightField(field);
                return (
                  <div
                    key={field.id}
                    className={`rounded-xl border p-4 transition ${
                      isEnterprise
                        ? highlight
                          ? 'border-amber-400 bg-amber-50/50 shadow-xs'
                          : 'border-slate-200 bg-slate-50/50'
                        : isIndustrial
                          ? highlight
                            ? 'border-2 border-amber-500 bg-amber-50/70 shadow-xs'
                            : 'border-2 border-slate-200 bg-slate-50/50'
                          : highlight
                            ? 'border-amber-500/40 bg-amber-500/5 glow-box-amber'
                            : 'border-slate-800 bg-slate-900/60'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <label
                        htmlFor={field.id}
                        className={`text-sm font-extrabold ${
                          isEnterprise || isIndustrial ? 'text-slate-900' : 'text-slate-200'
                        }`}
                      >
                        {field.label}
                      </label>
                      <span
                        className={`text-xs font-black font-mono ${
                          field.confidence >= 0.96
                            ? isEnterprise
                              ? 'text-emerald-600 font-bold'
                              : isIndustrial
                                ? 'text-emerald-700 font-black'
                                : 'text-emerald-400'
                            : isEnterprise
                              ? 'text-amber-600 font-bold'
                              : isIndustrial
                                ? 'text-amber-700 font-black'
                                : 'text-amber-400'
                        }`}
                      >
                        {Math.round(field.confidence * 100)}%
                      </span>
                    </div>
                    <Input
                      id={field.id}
                      value={field.correctedValue ?? field.normalizedValue}
                      onChange={(event) =>
                        updateField(field.id, event.target.value)
                      }
                      className={`h-12 rounded-lg font-mono tabular-nums text-base font-bold ${
                        isEnterprise
                          ? `bg-white text-slate-900 ${highlight ? 'border-amber-400 focus:border-amber-500' : 'border-slate-200 focus:border-blue-500'}`
                          : isIndustrial
                            ? `bg-white text-slate-950 border-2 ${highlight ? 'border-amber-500 focus:border-amber-600 ring-2 ring-amber-500/20' : 'border-slate-300 focus:border-amber-500'}`
                            : `bg-slate-950 text-slate-100 ${highlight ? 'border-amber-500/60 focus:border-amber-400' : 'border-slate-700 focus:border-emerald-500'}`
                      }`}
                      placeholder="확인 후 입력"
                    />
                    {highlight && (
                      <div className={`mt-2 flex gap-2 text-xs leading-5 ${
                        isEnterprise || isIndustrial ? 'text-amber-800 font-semibold' : 'text-amber-300'
                      }`}>
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                        <span>{field.validationMessage}</span>
                      </div>
                    )}
                    {field.rawValue &&
                      field.rawValue !== field.normalizedValue && (
                        <p className={`mt-2 text-xs ${
                          isEnterprise || isIndustrial ? 'text-slate-500' : 'text-slate-400'
                        }`}>
                          원본 판독:{' '}
                          <span className={`font-semibold font-mono ${
                            isEnterprise || isIndustrial ? 'text-slate-800' : 'text-slate-300'
                          }`}>
                            {field.rawValue}
                          </span>
                        </p>
                      )}
                  </div>
                );
              })}
            </div>

            {/* Industrial Rugged Action Button */}
            {isIndustrial && (
              <div className="mt-6 pt-4 border-t-2 border-slate-200">
                <Button
                  onClick={() => resolve('approved')}
                  disabled={resolving}
                  className="w-full h-14 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] text-slate-950 font-black text-base shadow-lg tracking-wide transition active:scale-[0.99] flex items-center justify-center gap-2"
                >
                  <Check size={20} strokeWidth={3} />
                  <span>Execute action button (수정 후 최종 승인)</span>
                </Button>
              </div>
            )}

            {selected.duplicateCandidate && (
              <div className="mt-4 flex gap-3 rounded-xl border border-purple-500/40 bg-purple-500/10 p-4 text-sm text-purple-300">
                <ListChecks size={18} className="text-purple-400" />
                <div>
                  <p className="font-bold">중복 후보가 있습니다</p>
                  <p className="mt-1 text-xs text-purple-200/80">
                    이미지 해시·차량번호·작업 항목을 함께 비교한 뒤 승인하세요.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className={`sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 grid grid-cols-2 gap-2 border-t p-3 backdrop-blur sm:hidden ${
          isEnterprise
            ? 'border-slate-200 bg-white/95 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]'
            : isIndustrial
              ? 'border-t-2 border-slate-300 bg-white/98 shadow-[0_-6px_25px_rgba(0,0,0,0.12)]'
              : 'border-slate-800 bg-[#0b0f17]/95 shadow-[0_-8px_30px_rgba(0,0,0,.6)]'
        }`}>
          <Button
            variant="outline"
            className={`min-h-12 rounded-xl font-bold ${
              isEnterprise
                ? 'border-rose-200 text-rose-600 hover:bg-rose-50'
                : isIndustrial
                  ? 'border-2 border-slate-300 bg-white text-slate-900 hover:bg-rose-50 hover:text-rose-700'
                  : 'border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300'
            }`}
            onClick={() => resolve('rejected')}
            disabled={resolving}
          >
            <X size={17} /> 반려
          </Button>
          <Button
            className={`min-h-12 rounded-xl font-black transition ${
              isEnterprise
                ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-sm'
                : isIndustrial
                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md text-base'
                  : 'bg-emerald-500 hover:bg-emerald-400 glow-emerald font-bold text-slate-950'
            }`}
            onClick={() => resolve('approved')}
            disabled={resolving}
          >
            <Check size={17} /> 수정 후 승인
          </Button>
        </div>
      </section>
    </div>
  );
}

function DocumentPreview({ document }: { document: ReviewDocument }) {
  const { isIndustrial, isEnterprise } = useDesignTheme();

  return (
    <div className={`p-4 lg:border-b-0 lg:border-r lg:p-5 ${
      isEnterprise
        ? 'border-b border-slate-200 bg-slate-50/50 lg:border-r-slate-200'
        : isIndustrial
          ? 'border-b-2 border-slate-200 bg-[#e8ecf1] lg:border-r-2 lg:border-r-slate-300'
          : 'border-b border-slate-800 bg-[#070a0f] lg:border-r-slate-800'
    }`}>
      <div className="mb-3 flex items-center justify-between">
        <p className={`text-sm font-extrabold ${
          isEnterprise || isIndustrial ? 'text-slate-900' : 'text-slate-200'
        }`}>
          원본 사진 (OCR 검사기)
        </p>
        <span className={`text-xs font-mono font-bold ${
          isEnterprise
            ? 'text-blue-600 font-bold'
            : isIndustrial
              ? 'text-amber-800 bg-amber-200/70 px-2 py-0.5 rounded border border-amber-300 font-black'
              : 'text-emerald-400'
        }`}>
          {isIndustrial ? '100% HIGH-VIS' : '100% SCALE'}
        </span>
      </div>
      <div className={`relative mx-auto aspect-[3/4] max-h-[380px] max-w-[285px] overflow-hidden rounded-lg sm:max-h-[520px] sm:max-w-none ${
        isEnterprise
          ? 'border border-slate-300 bg-white shadow-md'
          : isIndustrial
            ? 'border-2 border-slate-300 bg-white shadow-xl ring-4 ring-slate-300/40'
            : 'border border-slate-800 bg-[#0b0f17] shadow-[0_16px_40px_rgba(0,0,0,.6)]'
      }`}>
        {document.sourceUrl ? (
          <Image
            src={document.sourceUrl}
            alt={`${document.fileName} 원본 정비내역서`}
            fill
            unoptimized
            sizes="(max-width: 1024px) 285px, 40vw"
            className={`object-contain ${isEnterprise || isIndustrial ? 'bg-white' : 'bg-[#0b0f17]'}`}
          />
        ) : (
        <div className={`flex h-full flex-col p-[8%] ${
          isEnterprise || isIndustrial
            ? 'bg-white text-slate-900'
            : 'bg-[#0d131f] text-slate-200'
        }`}>
          <div className={`border-b-2 pb-3 text-center text-xl font-black tracking-[.16em] ${
            isEnterprise
              ? 'border-blue-600 text-blue-600'
              : isIndustrial
                ? 'border-amber-500 text-slate-950'
                : 'border-emerald-500 text-emerald-400'
          }`}>
            정 비 내 역 서
          </div>
          <div className={`mt-5 grid grid-cols-[90px_1fr] border text-[11px] leading-8 ${
            isEnterprise || isIndustrial
              ? 'border-slate-300 text-slate-800'
              : 'border-slate-700'
          }`}>
            <span className={`border-b border-r px-2 font-bold ${
              isEnterprise || isIndustrial ? 'border-slate-300 bg-slate-50 text-slate-600' : 'border-slate-700 text-slate-400'
            }`}>정비일</span>
            <span className={`border-b px-2 font-mono ${
              isEnterprise || isIndustrial ? 'border-slate-300' : 'border-slate-700'
            }`}>9 / 3</span>
            <span className={`border-b border-r px-2 font-bold ${
              isEnterprise || isIndustrial ? 'border-slate-300 bg-slate-50 text-slate-600' : 'border-slate-700 text-slate-400'
            }`}>고객명</span>
            <span className={`border-b px-2 font-bold ${
              isEnterprise || isIndustrial ? 'border-slate-300 text-slate-950' : 'border-slate-700'
            }`}>
              {document.customerName}
            </span>
            <span className={`border-b border-r px-2 font-bold ${
              isEnterprise || isIndustrial ? 'border-slate-300 bg-slate-50 text-slate-600' : 'border-slate-700 text-slate-400'
            }`}>차량</span>
            <span className={`border-b px-2 ${
              isEnterprise || isIndustrial ? 'border-slate-300' : 'border-slate-700'
            }`}>
              {document.vehicleLabel}
            </span>
            <span className={`border-r px-2 font-bold ${
              isEnterprise || isIndustrial ? 'border-slate-300 bg-slate-50 text-slate-600' : 'border-slate-700 text-slate-400'
            }`}>매장</span>
            <span className="px-2 font-medium">{document.shopName}</span>
          </div>
          <div className={`mt-6 flex-1 space-y-3 border-y py-4 text-sm font-mono ${
            isEnterprise || isIndustrial
              ? 'border-slate-300 text-slate-800'
              : 'border-slate-700'
          }`}>
            <p>
              •{' '}
              {
                document.fields.find((item) => item.key === 'service_item')
                  ?.rawValue
              }
            </p>
            <p>• 점검 및 조정</p>
            <p className={`text-right text-base font-black ${
              isEnterprise
                ? 'text-blue-600'
                : isIndustrial
                  ? 'text-amber-600'
                  : 'text-emerald-400'
            }`}>
              합계 {document.amount.toLocaleString()}원
            </p>
          </div>
          <p className={`mt-4 text-center text-xs font-bold ${
            isEnterprise || isIndustrial ? 'text-slate-400' : 'text-slate-500'
          }`}>
            안전 운행하세요 · 모토웍스 공식 정비
          </p>
        </div>
        )}
        {document.fields
          .filter((item) => shouldHighlightField(item))
          .slice(0, 3)
          .map((field, index) => (
            <span
              key={field.id}
              className={`absolute rounded transition ${
                isEnterprise
                  ? 'border-2 border-blue-500 bg-blue-500/20 shadow-xs'
                  : isIndustrial
                    ? 'border-3 border-amber-500 bg-amber-400/35 shadow-[0_0_16px_rgba(245,158,11,0.6)]'
                    : 'border-2 border-emerald-400 bg-emerald-400/20 glow-box-emerald'
              }`}
              style={{
                left: `${18 + index * 8}%`,
                top: `${field.boundingBox.y}%`,
                width: `${field.boundingBox.width}%`,
                height: `${field.boundingBox.height}%`,
              }}
            />
          ))}
        {!document.sourceAvailable && (
          <div className={`absolute inset-x-4 bottom-4 rounded-lg px-3 py-2 text-center text-xs font-semibold ${
            isEnterprise || isIndustrial
              ? 'bg-slate-900/90 text-white shadow-md'
              : 'bg-[#0b0f17]/95 border border-slate-800 text-slate-300'
          }`}>
            실제 원본 미수신 · Mock 미리보기
          </div>
        )}
      </div>
    </div>
  );
}

function Orders({
  approved,
  orders,
}: {
  approved: ReviewDocument[];
  orders: OrderRecord[];
}) {
  const isDbLive = orders.length > 0;
  const rows = isDbLive
    ? orders.map((o) => ({
        id: o.id,
        customer: o.customerName,
        vehicle: `${o.vehicleModel || '차종 미지정'} · ${o.plate || '번호 미지정'}`,
        shop: o.shopName,
        amount: o.totalAmount,
        status: 'DB 승인완료',
      }))
    : approved.map((d) => ({
        id: d.id,
        customer: d.customerName,
        vehicle: d.vehicleLabel,
        shop: d.shopName,
        amount: d.amount,
        status: '오늘 승인',
      }));

  const paymentBreakdown = {
    card: 0,
    cash: 0,
    transfer: 0,
  };
  if (isDbLive) {
    for (const ord of orders) {
      if (ord.payments) {
        for (const p of ord.payments) {
          if (p.method === 'card') paymentBreakdown.card += p.amount;
          else if (p.method === 'cash') paymentBreakdown.cash += p.amount;
          else if (p.method === 'transfer') paymentBreakdown.transfer += p.amount;
        }
      }
    }
  }

  const { isIndustrial, isEnterprise } = useDesignTheme();

  return (
    <section className="panel overflow-hidden">
      <div className={`flex flex-wrap items-center justify-between gap-3 border-b p-5 sm:p-6 ${
        isEnterprise || isIndustrial ? 'border-slate-200' : 'border-slate-800'
      }`}>
        <div>
          <p className="eyebrow">{isDbLive ? '실제 영구 저장 데이터' : '기준 예시 데이터'}</p>
          <h2 className="section-title">
            정비내역 {rows.length}건 {isDbLive ? '(DB 동기화 완료)' : '(검증 대기)'}
          </h2>
        </div>
        <Badge variant={isDbLive ? 'default' : 'outline'} className={
          isDbLive
            ? isEnterprise
              ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 font-bold'
              : isIndustrial
                ? 'bg-amber-500 text-slate-950 font-black border border-amber-600 shadow-xs'
                : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 glow-box-emerald'
            : isEnterprise || isIndustrial
              ? 'border-slate-200 text-slate-600'
              : 'border-slate-700 text-slate-400'
        }>
          {isDbLive ? '영구 데이터베이스 반영됨' : '참조 기준값'}
        </Badge>
      </div>
      <OrderTable rows={rows} />
      <div className={`border-t p-5 ${
        isEnterprise || isIndustrial ? 'border-slate-200 bg-slate-50/60' : 'border-slate-800 bg-slate-900/60'
      }`}>
        <p className={`text-sm font-semibold ${
          isEnterprise || isIndustrial ? 'text-slate-800' : 'text-slate-300'
        }`}>
          {isDbLive ? '실제 집계된 결제 수단별 금액' : '분할 결제 예시'}
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <PaymentPart method="카드" amount={isDbLive ? paymentBreakdown.card : 30000} />
          <PaymentPart method="현금" amount={isDbLive ? paymentBreakdown.cash : 10000} />
          <PaymentPart method="이체" amount={isDbLive ? paymentBreakdown.transfer : 5000} />
        </div>
      </div>
    </section>
  );
}
function OrderTable({
  rows,
}: {
  rows: Array<{
    id: string;
    customer: string;
    vehicle: string;
    shop: string;
    amount: number;
    status: string;
  }>;
}) {
  const { isIndustrial, isEnterprise } = useDesignTheme();
  if (rows.length === 0) {
    return (
      <div className={`p-8 text-center text-sm ${
        isEnterprise || isIndustrial ? 'text-slate-400' : 'text-slate-500'
      }`}>
        승인된 정비 내역이 없습니다.
      </div>
    );
  }

  return (
    <>
      {/* 모바일 전용 반응형 카드 뷰 */}
      <div className={`divide-y sm:hidden ${
        isEnterprise || isIndustrial ? 'divide-slate-200' : 'divide-slate-800/80'
      }`}>
        {rows.map((row) => (
          <div key={row.id} className={`p-4 space-y-2 ${
            isEnterprise || isIndustrial ? 'bg-white' : 'bg-slate-900/30'
          }`}>
            <div className="flex items-center justify-between">
              <span className={`font-mono text-xs font-bold ${
                isEnterprise || isIndustrial ? 'text-slate-500' : 'text-slate-400'
              }`}>{row.id}</span>
              <StatusBadge
                label={row.status}
                tone={row.status.includes('청구') ? 'blue' : 'green'}
              />
            </div>
            <div className="flex items-baseline justify-between">
              <div>
                <p className={`font-bold text-sm ${
                  isEnterprise || isIndustrial ? 'text-slate-900' : 'text-slate-100'
                }`}>{row.customer}</p>
                <p className={`text-xs ${
                  isEnterprise || isIndustrial ? 'text-slate-500' : 'text-slate-400'
                }`}>{row.vehicle}</p>
              </div>
              <p className={`text-base font-black font-mono tabular-nums ${
                isEnterprise
                  ? 'text-blue-600'
                  : isIndustrial
                    ? 'text-amber-600'
                    : 'text-emerald-400'
              }`}>
                {won.format(row.amount)}
              </p>
            </div>
            <p className={`text-xs font-mono ${
              isEnterprise || isIndustrial ? 'text-slate-500' : 'text-slate-500'
            }`}>
              {row.shop}
            </p>
          </div>
        ))}
      </div>

      {/* 데스크톱 전용 테이블 뷰 */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className={`text-xs uppercase tracking-wider font-mono border-b ${
            isEnterprise || isIndustrial
              ? 'bg-slate-50 text-slate-600 border-slate-200'
              : 'bg-slate-950/80 text-slate-400 border-slate-800'
          }`}>
            <tr>
              <th className="px-6 py-3">정비번호</th>
              <th className="px-6 py-3">고객·차량</th>
              <th className="px-6 py-3">매장</th>
              <th className="px-6 py-3 text-right">금액</th>
              <th className="px-6 py-3">상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={`border-t transition ${
                isEnterprise || isIndustrial
                  ? 'border-slate-200 hover:bg-slate-50'
                  : 'border-slate-800/80 hover:bg-slate-800/50'
              }`}>
                <td className={`px-6 py-4 font-mono text-xs font-bold ${
                  isEnterprise || isIndustrial ? 'text-slate-600' : 'text-slate-300'
                }`}>
                  {row.id}
                </td>
                <td className="px-6 py-4">
                  <p className={`font-bold ${isEnterprise || isIndustrial ? 'text-slate-900' : 'text-slate-100'}`}>{row.customer}</p>
                  <p className={`text-xs ${isEnterprise || isIndustrial ? 'text-slate-500' : 'text-slate-400'}`}>{row.vehicle}</p>
                </td>
                <td className={`px-6 py-4 ${isEnterprise || isIndustrial ? 'text-slate-600' : 'text-slate-300'}`}>{row.shop}</td>
                <td className={`px-6 py-4 text-right font-black font-mono tabular-nums ${
                  isEnterprise
                    ? 'text-blue-600'
                    : isIndustrial
                      ? 'text-amber-600'
                      : 'text-emerald-400'
                }`}>
                  {won.format(row.amount)}
                </td>
                <td className="px-6 py-4">
                  <StatusBadge
                    label={row.status}
                    tone={row.status.includes('청구') ? 'blue' : 'green'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Customers({ customers }: { customers: CustomerRecord[] }) {
  const isDbLive = customers.length > 0;
  const people: Array<[string, string, string, string]> = isDbLive
    ? customers.map((c) => [
        c.name,
        c.phone,
        `${c.vehicles[0]?.model || '차량'} (${c.vehicles[0]?.plate || '번호'}) · ${c.vehicles.length}대 (${c.shopName})`,
        c.status === 'active' ? '확정 연결 (DB)' : '검토 중',
      ])
    : [
        ['김○수', '010-****-2187', 'PCX 125 · 1대', '확정 연결 (참조)'],
        ['박○진', '010-****-7720', 'NMAX 125 · 2대', '연결 후보 (참조)'],
        ['이○호', '010-****-0041', '보이저 후보 · 1대', '연결 후보 (참조)'],
      ];

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <section className="panel overflow-hidden">
        <PanelTitle
          eyebrow={isDbLive ? 'DB 등록 고객' : '고객 목록'}
          title={`연결된 차량과 방문 이력 (${isDbLive ? `${customers.length}명 등록됨` : '참조 예시'})`}
        />
        {people.map(([name, phone, vehicle, status]) => (
          <div
            key={phone + vehicle}
            className="flex flex-wrap items-center gap-4 border-t border-slate-800/80 p-5 bg-slate-900/30 hover:bg-slate-900/60 transition"
          >
            <div className="grid h-11 w-11 place-items-center rounded-full bg-emerald-500/20 font-black text-emerald-300 border border-emerald-500/40">
              {name[0] || '고'}
            </div>
            <div className="min-w-[190px] flex-1">
              <p className="font-extrabold text-slate-100">{name}</p>
              <p className="text-sm text-slate-400 font-mono">
                {phone} · {vehicle}
              </p>
            </div>
            <StatusBadge
              label={status}
              tone={status.includes('확정') ? 'green' : 'amber'}
            />
          </div>
        ))}
      </section>
      <aside className="panel p-5 sm:p-6">
        <p className="eyebrow">병합 검토</p>
        <h2 className="section-title">자동 병합하지 않습니다</h2>
        <div className="my-5 rounded-xl bg-sky-500/10 border border-sky-500/20 p-4 text-sm leading-6 text-sky-200">
          전화번호·차량번호·차종의 일치 근거와 충돌을 함께 보여주고, 사람이
          승인한 병합 이력을 보존합니다. (SHA-256 해시 기반 동명이인 분리)
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex justify-between">
            <strong className="text-slate-100">박○진 ↔ 박진○</strong>
            <Badge variant="outline" className="border-amber-500/40 text-amber-300">후보 87%</Badge>
          </div>
          <ul className="mt-3 space-y-2 text-xs text-slate-400 font-mono">
            <li className="text-emerald-400">✓ 전화번호 해시 일치</li>
            <li className="text-emerald-400">✓ 차량번호 일치</li>
            <li className="text-amber-400">! 차종 표기 충돌 (확인 필요)</li>
          </ul>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 border-slate-700 text-slate-300 hover:border-slate-600">
              분리 유지
            </Button>
            <Button size="sm" className="flex-1 bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 glow-emerald">
              병합 승인
            </Button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Rentals({ rentals }: { rentals: RentalRecord[] }) {
  const isDbLive = rentals.length > 0;
  const rows = isDbLive
    ? rentals.map((r) => ({
        id: r.id,
        company: `${r.company} (${r.shopName})`,
        vehicle: r.vehicle,
        base: r.base,
        customer: r.customer,
        billed: r.billed,
        paid: r.paid,
        due: r.due,
        status: r.status === 'settled' ? '정산 완료' : '청구 예정',
      }))
    : [
        {
          id: 'ref-1',
          company: 'A 렌트 (참조 예시)',
          vehicle: '보이저 125 · 18하 2***',
          base: 42000,
          customer: 0,
          billed: 42000,
          paid: 0,
          due: 42000,
          status: '청구 예정',
        },
        {
          id: 'ref-2',
          company: 'B 리스 (참조 예시)',
          vehicle: 'PCX 125 · 21허 7***',
          base: 55000,
          customer: 0,
          billed: 55000,
          paid: 55000,
          due: 0,
          status: '정산 완료',
        },
      ];
  return (
    <section className="panel overflow-hidden">
      <PanelTitle
        eyebrow={isDbLive ? 'DB 렌트 정산' : '렌트·리스'}
        title={`0원 결제와 업체 청구를 분리 (${isDbLive ? `${rentals.length}건 DB 영구저장` : '참조 예시'})`}
      />
      {/* 모바일 전용 렌트미수금 카드 리스트 */}
      <div className="divide-y divide-slate-800/80 sm:hidden">
        {rows.map((row) => (
          <div key={row.id} className="p-4 space-y-3 bg-slate-900/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-sm text-slate-100">{row.company}</p>
                <p className="text-xs text-slate-400">{row.vehicle}</p>
              </div>
              <StatusBadge
                label={row.status}
                tone={row.status.includes('예정') ? 'amber' : 'green'}
              />
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-950/80 border border-slate-800/80 p-2.5 text-center text-xs">
              <div>
                <span className="text-slate-400">기준가</span>
                <p className="font-semibold font-mono text-slate-200 mt-0.5">{won.format(row.base)}</p>
              </div>
              <div>
                <span className="text-slate-400">고객결제</span>
                <p className="font-semibold font-mono text-slate-200 mt-0.5">{won.format(row.customer)}</p>
              </div>
              <div>
                <span className="text-amber-400 font-bold">미수금</span>
                <p className="font-bold font-mono text-amber-400 mt-0.5">{won.format(row.due)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 데스크톱 전용 테이블 */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-slate-950/80 text-left text-xs uppercase font-mono tracking-wider text-slate-400 border-b border-slate-800">
            <tr>
              {[
                '업체·차량',
                '정비 기준가',
                '고객 결제액',
                '업체 청구액',
                '입금액',
                '미수금',
                '상태',
              ].map((title) => (
                <th key={title} className="px-5 py-3">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-slate-800/80 hover:bg-slate-800/50 transition">
                <td className="px-5 py-4">
                  <p className="font-bold text-slate-100">{row.company}</p>
                  <p className="text-xs text-slate-400">{row.vehicle}</p>
                </td>
                {[row.base, row.customer, row.billed, row.paid, row.due].map(
                  (value, i) => (
                    <td
                      key={i}
                      className={`px-5 py-4 font-semibold font-mono tabular-nums ${i === 4 && value > 0 ? 'text-amber-400 font-bold' : 'text-slate-200'}`}
                    >
                      {won.format(value)}
                    </td>
                  ),
                )}
                <td className="px-5 py-4">
                  <StatusBadge
                    label={row.status}
                    tone={row.status.includes('예정') ? 'amber' : 'green'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Analytics({
  approvedRevenue,
  orders,
  stats,
}: {
  approvedRevenue: number;
  orders: OrderRecord[];
  stats: DashboardStats | null;
}) {
  const currentRevenue = stats ? stats.totalRevenue : approvedRevenue;
  const currentOrders = stats ? stats.totalOrders : orders.length;
  const rentalDue = stats ? stats.rentalOutstanding : 0;
  const liveShops = stats?.shops && stats.shops.length > 0
    ? stats.shops.map((s) => ({
        name: s.name,
        orders: s.orderCount,
        revenue: s.revenue,
      }))
    : baselineReference.shops;
  const max = Math.max(...liveShops.map((shop) => shop.revenue), 1);
  const totalShopRev = liveShops.reduce((sum, s) => sum + s.revenue, 0) || 1;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-4">
        <Metric
          label="승인 반영 매출"
          value={won.format(currentRevenue)}
          note={`실제 DB 승인 ${currentOrders}건 집계`}
          icon={BadgeCheck}
          tone="green"
        />
        <Metric
          label="렌트·리스 미수금"
          value={won.format(rentalDue)}
          note="정산 청구 대기액"
          icon={WalletCards}
          tone="blue"
        />
        <Metric
          label="참조 기준 매출"
          value={won.format(baselineReference.revenue)}
          note={baselineReference.revenue > 0 ? "과거 엑셀 기준값" : "과거 엑셀 미연결 (0원)"}
          icon={Database}
          tone="amber"
        />
        <Metric
          label="검증 상태"
          value={orders.length > 0 ? "DB 연동" : "대기"}
          note={orders.length > 0 ? "실시간 영구 DB 동기화 중" : "원본 파일 미수신"}
          icon={AlertTriangle}
          tone="purple"
        />
      </section>
      <section className="panel p-5 sm:p-7">
        <p className="eyebrow">지점별 현황</p>
        <h2 className="section-title mb-7">
          {stats?.shops && stats.shops.length > 0
            ? '실시간 DB 지점별 매출 현황'
            : baselineReference.revenue > 0
              ? '사용자 제공 기준값'
              : '지점별 매출 현황 (등록 대기 0건)'}
        </h2>
        <div className="space-y-7">
          {liveShops.map((shop) => (
            <div key={shop.name}>
              <div className="mb-2 flex items-end justify-between">
                <div>
                  <p className="font-extrabold">{shop.name}</p>
                  <p className="text-sm text-[#6f837e]">{shop.orders}건</p>
                </div>
                <p className="text-lg font-black">{won.format(shop.revenue)}</p>
              </div>
              <div className="h-10 overflow-hidden rounded-lg bg-[#e7efed]">
                <div
                  className="flex h-full items-center justify-end rounded-lg bg-gradient-to-r from-[#25b89b] to-[#0b6f5e] px-3 text-xs font-bold text-white"
                  style={{
                    width: `${Math.max(Math.round((shop.revenue / max) * 100), shop.revenue > 0 ? 8 : 0)}%`,
                  }}
                >
                  {Math.round((shop.revenue / totalShopRev) * 100)}%
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-7 text-xs text-[#768985]">
          지점별 데이터는 서버 권한 격리에 따라 인가된 지점의 승인 데이터만 정확하게 분리 집계됩니다.
        </p>
      </section>
    </div>
  );
}

function Standards() {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="panel p-5 sm:p-6">
        <p className="eyebrow">자동등록</p>
        <h2 className="section-title mb-5">기본 승인 기준</h2>
        {[
          ['필수 필드 신뢰도', '96% 이상'],
          ['작업 합계 = 결제 합계', '필수'],
          ['매장 상태', '확정만 허용'],
          ['중복 후보', '자동등록 차단'],
          ['개인 정비 0원', '자동등록 차단'],
        ].map(([l, v]) => (
          <InfoRow key={l} label={l} value={v} />
        ))}
      </section>
      <section className="panel p-5 sm:p-6">
        <p className="eyebrow">차종 별칭</p>
        <h2 className="section-title mb-5">후보로만 제안</h2>
        {[
          ['PCX', 'PCX 125 / PCX 160'],
          ['엔맥스', 'NMAX 125 / NMAX 155'],
          ['보이져', '보이저 125 / 보이저 300'],
        ].map(([alias, candidates]) => (
          <div
            key={alias}
            className="flex items-center gap-4 border-b border-[#e7efed] py-3 last:border-0"
          >
            <span className="rounded-lg bg-[#e5f6f2] px-3 py-2 text-sm font-black text-[#0b6b5b]">
              {alias}
            </span>
            <div className="flex-1">
              <p className="text-sm font-bold">{candidates}</p>
              <p className="text-xs text-[#748783]">자동 확정 안 함</p>
            </div>
          </div>
        ))}
      </section>
      <section className="panel p-5 sm:p-6 xl:col-span-2">
        <p className="eyebrow">단일 기준 데이터</p>
        <h2 className="section-title">Python·웹 공통 규칙</h2>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[#607671]">
          매장, 결제수단, 차종 별칭과 자동등록 임계값은 한 모듈에서 관리합니다.
          엑셀 변환기와 화면 검증 로직도 같은 값을 참조합니다.
        </p>
      </section>
    </div>
  );
}

function ExcelView({
  documents,
  orders,
  setNotice,
}: {
  documents: ReviewDocument[];
  orders: OrderRecord[];
  setNotice: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<{
    sheetNames: string[];
    missingSheets: string[];
    orderCount: number;
    revenue: number;
  } | null>(null);
  const onImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/excel', {
        method: 'POST',
        body: form,
      });
      if (res.ok) {
        const payload = (await res.json()) as {
          structure: {
            sheetNames: string[];
            missingSheets: string[];
            orderCount: number;
            revenue: number;
          };
        };
        setResult(payload.structure);
        setNotice(
          `${file.name} 서버 구조 검사를 완료했습니다 (${payload.structure.sheetNames.length}개 시트 검증, ${payload.structure.orderCount}건).`,
        );
      } else {
        const { inspectLegacyWorkbook } = await import('@/lib/excel');
        setResult(inspectLegacyWorkbook(await file.arrayBuffer()));
        setNotice(
          `${file.name} 구조 검사를 완료했습니다. 가져오기는 아직 실행하지 않았습니다.`,
        );
      }
    } catch {
      setNotice('엑셀을 읽지 못했습니다. 파일 형식과 암호 설정을 확인하세요.');
    }
  };

  const handleExport = async () => {
    try {
      const link = document.createElement('a');
      link.href = '/api/excel';
      link.download = `motoworks_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setNotice('DB 승인 데이터 5개 시트(정비내역, 정비항목, 고객목록, 렌트리스, 기준정보) 엑셀 내보내기를 완료했습니다.');
    } catch {
      const { downloadLegacyWorkbook } = await import('@/lib/excel');
      downloadLegacyWorkbook(documents);
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="panel p-5 sm:p-7">
        <div className="grid h-12 w-12 place-items-center rounded-xl bg-[#e3f6f1] text-[#0c725f]">
          <FileSpreadsheet />
        </div>
        <h2 className="mt-5 text-xl font-extrabold">기존 엑셀 가져오기</h2>
        <p className="mt-2 text-sm leading-6 text-[#657a75]">
          원본을 덮어쓰지 않고 시트 구조·건수·매출을 먼저 검사합니다.
        </p>
        <input
          aria-label="기존 엑셀 선택"
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={onImport}
        />
        <Button
          className="mt-6 w-full rounded-xl bg-[#0d6d5d]"
          onClick={() => inputRef.current?.click()}
        >
          <CloudUpload size={17} /> 엑셀 선택 및 서버 검사
        </Button>
        {result && (
          <div className="mt-5 rounded-xl border border-[#d9e6e3] bg-[#f8fbfa] p-4">
            <InfoRow label="시트" value={result.sheetNames.join(', ')} />
            <InfoRow label="정비 건수" value={`${result.orderCount}건`} />
            <InfoRow label="매출 합계" value={won.format(result.revenue)} />
            <InfoRow
              label="누락 시트"
              value={
                result.missingSheets.length
                  ? result.missingSheets.join(', ')
                  : '없음 (5개 표준 시트 완전 일치)'
              }
            />
          </div>
        )}
      </section>
      <section className="panel p-5 sm:p-7">
        <div className="grid h-12 w-12 place-items-center rounded-xl bg-[#e9edff] text-[#4f65bd]">
          <FileDown />
        </div>
        <h2 className="mt-5 text-xl font-extrabold">기존 형식으로 내보내기</h2>
        <p className="mt-2 text-sm leading-6 text-[#657a75]">
          검수 승인된 영구 DB 데이터만 5개 시트로 완전 호환 출력합니다.
        </p>
        <div className="my-5 rounded-xl bg-[#f5f7ff] p-4">
          <InfoRow
            label="DB 승인 데이터"
            value={`${orders.length > 0 ? orders.length : documents.filter((i) => i.status === 'approved').length}건`}
          />
          <InfoRow label="시트 구성" value="정비내역, 정비항목, 고객목록, 렌트리스, 기준정보" />
          <InfoRow label="파일 형식" value="새 XLSX 파일 다운로드" />
        </div>
        <Button
          variant="outline"
          className="w-full rounded-xl border-[#687bd0] text-[#4055ae] hover:bg-[#687bd0]/10"
          onClick={handleExport}
        >
          <FileDown size={17} /> 승인 데이터 5개 시트 내보내기
        </Button>
      </section>
    </div>
  );
}

function UsersView({
  users,
  roles,
  onRefresh,
}: {
  users: UserRecord[];
  roles: RoleRecord[];
  onRefresh?: () => void;
}) {
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [selectedPerms, setSelectedPerms] = useState<string[]>([
    'view',
    'upload',
    'edit_extraction',
    'review_decide',
  ]);
  const [creating, setCreating] = useState(false);
  const [actionNotice, setActionNotice] = useState('');

  // 신규 사용자 추가 모달 상태
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [formEmail, setFormEmail] = useState('');
  const [formDisplayName, setFormDisplayName] = useState('');
  const [formRole, setFormRole] = useState<'admin' | 'shop_manager' | 'staff' | 'viewer'>('staff');
  const [formShopId, setFormShopId] = useState<string>('');
  const [formPassword, setFormPassword] = useState('');
  const [formConfirmPassword, setFormConfirmPassword] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const resetForm = () => {
    setFormEmail('');
    setFormDisplayName('');
    setFormRole('staff');
    setFormShopId('');
    setFormPassword('');
    setFormConfirmPassword('');
    setFormError('');
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formEmail.trim() || !formDisplayName.trim() || !formPassword) {
      setFormError('이메일, 표시 이름, 초기 비밀번호를 모두 입력해주세요.');
      return;
    }
    if (formPassword.length < 8) {
      setFormError('비밀번호는 최소 8자 이상이어야 합니다.');
      return;
    }
    if (formPassword !== formConfirmPassword) {
      setFormError('비밀번호와 비밀번호 확인이 일치하지 않습니다.');
      return;
    }

    setFormSubmitting(true);
    setFormError('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_user',
          email: formEmail.trim().toLowerCase(),
          displayName: formDisplayName.trim(),
          role: formRole,
          shopId: formRole === 'admin' ? null : (formShopId || null),
          initialPassword: formPassword,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || '계정 생성에 실패했습니다.');
      }

      setIsCreateModalOpen(false);
      setActionNotice(`신규 계정 '${formDisplayName}' (${formEmail})이(가) 성공적으로 생성되었습니다.`);
      resetForm();
      onRefresh?.();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '계정 생성 실패');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleDeleteUser = async (userId: string, email: string) => {
    if (!confirm(`정말로 '${email}' 계정을 삭제하시겠습니까?`)) return;
    setUpdatingId(userId);
    setActionNotice('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_user',
          userId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '삭제 처리에 실패했습니다.');
      setActionNotice(data.message || `'${email}' 계정이 삭제되었습니다.`);
      onRefresh?.();
    } catch (err) {
      setActionNotice(err instanceof Error ? err.message : '삭제 처리 실패');
    } finally {
      setUpdatingId(null);
    }
  };

  const allAvailablePerms = [
    { key: 'view', label: '기본 조회' },
    { key: 'upload', label: '사진 업로드' },
    { key: 'edit_extraction', label: '판독값 수정' },
    { key: 'review_decide', label: '검수 승인/반려' },
    { key: 'settlement_manage', label: '정산 관리' },
    { key: 'excel_import', label: '엑셀 가져오기' },
    { key: 'excel_export', label: '엑셀 내보내기' },
    { key: 'view_pii', label: '개인정보 열람' },
    { key: 'manage_users', label: '사용자·권한 관리' },
    { key: 'view_audit', label: '감사로그 열람' },
  ];

  const handleUpdateStatus = async (userId: string, nextStatus: string) => {
    setUpdatingId(userId);
    setActionNotice('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_user_status',
          userId,
          status: nextStatus,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || '상태 변경에 실패했습니다.');
      setActionNotice(`사용자 상태를 '${nextStatus === 'active' ? '승인(활성)' : nextStatus}'(으)로 변경했습니다.`);
      onRefresh?.();
    } catch (err) {
      setActionNotice(err instanceof Error ? err.message : '오류가 발생했습니다.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleCreateRole = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newRoleName.trim()) return;
    setCreating(true);
    setActionNotice('');
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_role',
          name: newRoleName.trim(),
          description: newRoleDesc.trim() || null,
          permissions: selectedPerms,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || '역할 생성에 실패했습니다.');
      setActionNotice(`새 권한 그룹 '${newRoleName}'이 생성되었습니다.`);
      setNewRoleName('');
      setNewRoleDesc('');
      onRefresh?.();
    } catch (err) {
      setActionNotice(err instanceof Error ? err.message : '역할 생성 실패');
    } finally {
      setCreating(false);
    }
  };

  const displayUsers = users.length > 0 ? users : [
    {
      id: 'default-owner',
      email: 'shortsbogo@gmail.com',
      displayName: '김 관리자 (기본 관리자)',
      status: 'active',
      createdAt: 1725600000000,
      assignments: [
        {
          id: 'asgn-1',
          shopId: null,
          shopName: '전체 지점',
          role: 'owner',
          roleId: null,
          roleName: '소유자 / 최고 관리자',
        },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {actionNotice && (
        <div className="rounded-xl border border-[#9bdfd0] bg-[#e4faf4] px-4 py-3 text-sm font-semibold text-[#0b5c4f]">
          {actionNotice}
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between p-5 pb-3">
            <div>
              <p className="eyebrow">사용자 계정</p>
              <h2 className="section-title">등록 사용자 및 지점 권한 ({displayUsers.length}명)</h2>
            </div>
            <Button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="rounded-xl bg-[#0d6d5d] text-xs font-bold text-white hover:bg-[#09594c] flex items-center gap-1.5 shadow-sm px-3.5 py-2"
            >
              <Users size={16} />
              <span>사용자 추가</span>
            </Button>
          </div>
          {displayUsers.map((user) => {
            const isOwnerAccount = user.email.toLowerCase() === 'shortsbogo@gmail.com';
            return (
              <div
                key={user.id}
                className="flex flex-wrap items-center gap-4 border-t border-[#e5eeec] p-5"
              >
                <div className="grid h-10 w-10 place-items-center rounded-full bg-[#e1f5f0] font-black text-[#0c705e]">
                  {user.displayName[0] || '사'}
                </div>
                <div className="min-w-[180px] flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-bold">{user.displayName}</p>
                    <Badge
                      variant={user.status === 'active' ? 'default' : user.status === 'pending' ? 'outline' : 'secondary'}
                      className={user.status === 'active' ? 'bg-[#0d6d5d]' : user.status === 'pending' ? 'border-[#e69824] text-[#b06a00]' : ''}
                    >
                      {user.status === 'active' ? '승인 완료' : user.status === 'pending' ? '승인 대기' : '정지'}
                    </Badge>
                  </div>
                  <p className="text-xs text-[#758782]">{user.email}</p>
                  {user.assignments.map((asgn) => (
                    <p key={asgn.id} className="mt-1 text-xs text-[#0e7462]">
                      • {asgn.shopName} · {asgn.roleName || asgn.role}
                    </p>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  {user.status === 'pending' && (
                    <Button
                      size="sm"
                      className="rounded-lg bg-[#0d6d5d] text-xs font-bold text-white hover:bg-[#09594c]"
                      disabled={updatingId === user.id}
                      onClick={() => handleUpdateStatus(user.id, 'active')}
                    >
                      {updatingId === user.id ? '처리 중...' : '승인 및 활성화'}
                    </Button>
                  )}
                  {!isOwnerAccount && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                      disabled={updatingId === user.id}
                      onClick={() => handleDeleteUser(user.id, user.email)}
                    >
                      삭제
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        {/* 신규 사용자 추가 모달 */}
        {isCreateModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
            <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-[#161d28] p-6 shadow-2xl text-slate-100 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-amber-500 text-slate-950 font-bold">
                    <Users size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">신규 사용자 계정 추가</h3>
                    <p className="text-xs text-slate-400">시스템 접근 권한 및 초기 비밀번호 설정</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { setIsCreateModalOpen(false); resetForm(); }}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
                >
                  <X size={18} />
                </button>
              </div>

              {formError && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/15 p-3 text-xs text-rose-200">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-rose-400" />
                  <span>{formError}</span>
                </div>
              )}

              <form onSubmit={handleCreateUser} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                    이메일 (로그인 ID) *
                  </label>
                  <Input
                    type="email"
                    required
                    placeholder="user@corepartners.kr"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    className="mt-1 h-10 border-slate-700 bg-slate-900/80 text-white placeholder-slate-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                    표시 이름 (성명/직책) *
                  </label>
                  <Input
                    type="text"
                    required
                    placeholder="홍길동 실장"
                    value={formDisplayName}
                    onChange={(e) => setFormDisplayName(e.target.value)}
                    className="mt-1 h-10 border-slate-700 bg-slate-900/80 text-white placeholder-slate-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                      역할 (권한 그룹) *
                    </label>
                    <select
                      value={formRole}
                      onChange={(e) => setFormRole(e.target.value as any)}
                      className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-900/80 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                    >
                      <option value="staff">직원 (staff)</option>
                      <option value="shop_manager">지점 관리자 (shop_manager)</option>
                      <option value="viewer">열람자 (viewer)</option>
                      <option value="admin">조직 관리자 (admin)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                      소속 센터 (지점)
                    </label>
                    <select
                      value={formShopId}
                      disabled={formRole === 'admin'}
                      onChange={(e) => setFormShopId(e.target.value)}
                      className="mt-1 h-10 w-full rounded-md border border-slate-700 bg-slate-900/80 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
                    >
                      <option value="">전체 지점 (기본)</option>
                      <option value="yongjeon">진바이크 용전센터</option>
                      <option value="jayang">코아바이크 자양센터</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 border-t border-slate-800/80 pt-3">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                      초기 비밀번호 (8자 이상) *
                    </label>
                    <Input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      className="mt-1 h-10 border-slate-700 bg-slate-900/80 text-white placeholder-slate-500 font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-300">
                      비밀번호 확인 *
                    </label>
                    <Input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={formConfirmPassword}
                      onChange={(e) => setFormConfirmPassword(e.target.value)}
                      className="mt-1 h-10 border-slate-700 bg-slate-900/80 text-white placeholder-slate-500 font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => { setIsCreateModalOpen(false); resetForm(); }}
                    className="text-slate-400 hover:text-white"
                  >
                    취소
                  </Button>
                  <Button
                    type="submit"
                    disabled={formSubmitting}
                    className="bg-amber-500 font-bold text-slate-950 hover:bg-amber-400"
                  >
                    {formSubmitting ? (
                      <div className="flex items-center gap-1.5">
                        <Spinner size="sm" />
                        <span>생성 중...</span>
                      </div>
                    ) : (
                      '계정 등록 완료'
                    )}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
        <aside className="panel p-5">
          <p className="eyebrow">개인정보 및 보안 원칙</p>
          <h2 className="section-title">RBAC 엄격 격리</h2>
          <ul className="mt-5 space-y-3 text-sm leading-6 text-[#5e746e]">
            <li>• <strong>초기 소유자:</strong> shortsbogo@gmail.com 만 최고 권한 보유</li>
            <li>• <strong>신규 가입자:</strong> 승인 대기(pending) 상태로 시작</li>
            <li>• <strong>지점 격리:</strong> 자양센터 / 용전센터 상호 데이터 엄격 분리</li>
            <li>• <strong>개인정보 암호화:</strong> AES-GCM 256비트 암호화 및 SHA-256 해시 검색</li>
            <li>• <strong>전수 감사:</strong> 승인·수정·상태변경 전 과정 영구 로그</li>
          </ul>
        </aside>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="panel p-5 sm:p-6">
          <p className="eyebrow">권한 그룹</p>
          <h2 className="section-title mb-4">커스텀 역할 목록 ({roles.length}개)</h2>
          <div className="space-y-3">
            {roles.length > 0 ? (
              roles.map((role) => (
                <div key={role.id} className="rounded-xl border border-[#e2ece9] bg-[#fbfdfc] p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-[#0c3a33]">{role.name}</p>
                    <span className="text-xs text-[#6e8580]">{role.description || '설명 없음'}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {role.permissions.map((perm) => (
                      <span key={perm} className="rounded-md bg-[#e4f7f2] px-2 py-0.5 text-[11px] font-semibold text-[#096654]">
                        {perm}
                      </span>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-[#738a84]">생성된 커스텀 역할이 없습니다. 우측 폼에서 추가할 수 있습니다.</p>
            )}
          </div>
        </section>

        <section className="panel p-5 sm:p-6">
          <p className="eyebrow">역할 생성</p>
          <h2 className="section-title mb-4">새 커스텀 권한 그룹 정의</h2>
          <form onSubmit={handleCreateRole} className="space-y-4">
            <div>
              <label htmlFor="role-name-input" className="text-xs font-bold text-[#445b56]">역할 이름</label>
              <Input
                id="role-name-input"
                value={newRoleName}
                onChange={(e) => setNewRoleName(e.target.value)}
                placeholder="예: 야간 정비반장"
                className="mt-1 h-10 rounded-xl bg-white"
                required
              />
            </div>
            <div>
              <label htmlFor="role-desc-input" className="text-xs font-bold text-[#445b56]">설명 (선택)</label>
              <Input
                id="role-desc-input"
                value={newRoleDesc}
                onChange={(e) => setNewRoleDesc(e.target.value)}
                placeholder="예: 정비 접수 및 판독값 수정 권한만 부여"
                className="mt-1 h-10 rounded-xl bg-white"
              />
            </div>
            <div>
              <span className="text-xs font-bold text-[#445b56]">허용 권한 선택 (세부 10종)</span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {allAvailablePerms.map((p) => {
                  const checked = selectedPerms.includes(p.key);
                  return (
                    <label key={p.key} className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedPerms([...selectedPerms, p.key]);
                          else setSelectedPerms(selectedPerms.filter((k) => k !== p.key));
                        }}
                        className="rounded border-[#a1cac1]"
                      />
                      <span>{p.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <Button
              type="submit"
              disabled={creating || !newRoleName.trim()}
              className="w-full rounded-xl bg-[#0d6d5d] text-white"
            >
              {creating ? '역할 등록 중...' : '새 권한 그룹 생성'}
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}

function Audit({
  documents,
  auditLogs,
}: {
  documents: ReviewDocument[];
  auditLogs: AuditLogRecord[];
}) {
  const isDbLive = auditLogs.length > 0;
  const changedDocs = documents.filter(
    (d) =>
      d.status !== 'pending' ||
      d.fields.some((f) => f.correctedValue !== undefined),
  );

  return (
    <section className="panel overflow-hidden">
      <PanelTitle
        eyebrow={isDbLive ? 'DB 영구 감사 이력' : '세션 변경 로그'}
        title={`수정·승인 및 권한 변경 근거 (${isDbLive ? `${auditLogs.length}건 DB 영구 보존됨` : `${changedDocs.length}건`})`}
      />
      {isDbLive ? (
        <div className="divide-y divide-slate-800/80">
          {auditLogs.map((log) => (
            <div
              key={log.id}
              className="grid gap-3 p-5 sm:grid-cols-[200px_1fr_auto] bg-slate-900/20 hover:bg-slate-900/50 transition"
            >
              <div>
                <p className="font-mono text-xs font-bold text-emerald-400">{log.id.slice(0, 16)}...</p>
                <p className="text-xs text-slate-400 font-mono">
                  {new Date(log.createdAt).toLocaleString('ko-KR')}
                </p>
                <p className="text-xs font-semibold text-slate-300">{log.shopName}</p>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-slate-100">{log.action}</p>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-mono text-slate-300">
                    {log.entityType} #{log.entityId.slice(0, 8)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  수행자: <strong className="text-slate-200">{log.actorName}</strong>
                </p>
                {Boolean(log.detail) && (
                  <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-slate-950/90 border border-slate-800/80 p-2 text-[11px] text-emerald-400/90 font-mono">
                    {typeof log.detail === 'string' ? log.detail : JSON.stringify(log.detail, null, 2)}
                  </pre>
                )}
              </div>
              <div>
                <StatusBadge
                  label={log.action.includes('approve') ? '승인' : log.action.includes('status') ? '권한변경' : '수정/작업'}
                  tone={log.action.includes('approve') ? 'green' : 'amber'}
                />
              </div>
            </div>
          ))}
        </div>
      ) : changedDocs.length ? (
        <div className="divide-y divide-slate-800/80">
          {changedDocs.map((d) => (
            <div
              key={d.id}
              className="grid gap-3 p-5 sm:grid-cols-[180px_1fr_auto] bg-slate-900/20 hover:bg-slate-900/50 transition"
            >
              <div>
                <p className="font-mono text-xs font-bold text-emerald-400">{d.id}</p>
                <p className="text-xs text-slate-400">세션 기록</p>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-100">
                  {d.status === 'approved'
                    ? '검수 승인'
                    : d.status === 'rejected'
                      ? '문서 반려'
                      : '필드 수정'}
                </p>
                <p className="text-xs text-slate-400">
                  원본값과 최종값을 분리 보존 · {d.shopName}
                </p>
              </div>
              <StatusBadge
                label={
                  d.status === 'approved'
                    ? '승인'
                    : d.status === 'rejected'
                      ? '반려'
                      : '수정 중'
                }
                tone={d.status === 'approved' ? 'green' : 'amber'}
              />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="아직 변경 이력이 없습니다"
          text="검수 화면에서 값을 수정하거나 승인하면 DB 감사 로그 테이블에 영구 보존됩니다."
        />
      )}
    </section>
  );
}

function PanelTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="p-5 sm:p-6">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="section-title">{title}</h2>
    </div>
  );
}
function PaymentPart({ method, amount }: { method: string; amount: number }) {
  const { isEnterprise, isIndustrial } = useDesignTheme();
  return (
    <div className={`flex items-center justify-between rounded-xl border p-3 ${
      isEnterprise
        ? 'border-slate-200 bg-slate-50 text-slate-900'
        : isIndustrial
          ? 'border-2 border-slate-300 bg-white text-slate-950 shadow-xs'
          : 'border border-slate-800 bg-slate-900/60 text-slate-300'
    }`}>
      <span className="text-sm font-semibold">{method}</span>
      <strong className={`font-mono tabular-nums font-black ${
        isEnterprise
          ? 'text-blue-600'
          : isIndustrial
            ? 'text-amber-600'
            : 'text-emerald-400'
      }`}>{won.format(amount)}</strong>
    </div>
  );
}
function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: 'green' | 'amber' | 'blue';
}) {
  const { isEnterprise, isIndustrial } = useDesignTheme();
  const tones = {
    green: isEnterprise
      ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
      : isIndustrial
        ? 'bg-[#18202F] text-white border border-slate-700 font-black shadow-xs'
        : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 glow-box-emerald',
    amber: isEnterprise
      ? 'bg-amber-50 text-amber-700 border border-amber-300'
      : isIndustrial
        ? 'bg-amber-500 text-slate-950 border border-amber-600 font-black shadow-xs'
        : 'bg-amber-500/15 text-amber-400 border border-amber-500/30 glow-box-amber',
    blue: isEnterprise
      ? 'bg-blue-50 text-blue-700 border border-blue-300'
      : isIndustrial
        ? 'bg-white text-slate-900 border-2 border-slate-900 font-black shadow-xs'
        : 'bg-sky-500/15 text-sky-400 border border-sky-500/30',
  };
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-bold font-mono tracking-tight ${tones[tone]}`}
    >
      {label}
    </span>
  );
}
function InfoRow({ label, value }: { label: string; value: string }) {
  const { isEnterprise, isIndustrial } = useDesignTheme();
  return (
    <div className={`flex items-start justify-between gap-4 border-b py-2.5 text-sm last:border-0 ${
      isEnterprise || isIndustrial ? 'border-slate-200' : 'border-slate-800/80'
    }`}>
      <dt className={isEnterprise || isIndustrial ? 'text-slate-500 font-medium' : 'text-slate-400'}>{label}</dt>
      <dd className={`max-w-[70%] text-right font-bold font-mono tabular-nums ${
        isEnterprise || isIndustrial ? 'text-slate-900' : 'text-slate-100'
      }`}>{value}</dd>
    </div>
  );
}
function EmptyState({ title, text }: { title: string; text: string }) {
  const { isEnterprise, isIndustrial } = useDesignTheme();
  return (
    <div className="grid min-h-[420px] place-items-center p-8 text-center">
      <div>
        <div className={`mx-auto grid h-14 w-14 place-items-center rounded-full ${
          isEnterprise
            ? 'bg-blue-50 border border-blue-200 text-blue-600 shadow-sm'
            : isIndustrial
              ? 'bg-amber-500 text-slate-950 border-2 border-amber-600 shadow-md font-black'
              : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 glow-box-emerald'
        }`}>
          <Check size={26} strokeWidth={isIndustrial ? 3 : 2} />
        </div>
        <h2 className={`mt-5 text-xl font-extrabold ${
          isEnterprise || isIndustrial ? 'text-slate-900' : 'text-slate-100'
        }`}>{title}</h2>
        <p className={`mt-2 text-sm ${
          isEnterprise || isIndustrial ? 'text-slate-500' : 'text-slate-400'
        }`}>{text}</p>
      </div>
    </div>
  );
}

interface PlateCandidate {
  vehicleId: string;
  fullPlate: string;
  manufacturer?: string | null;
  model: string;
  shopName?: string | null;
  customerId?: string | null;
  customerName: string;
  phone: string;
  lastServiceDate?: string | null;
  recentOrders?: Array<{
    id: string;
    approved_service_date: string;
    service_type: string;
    total_amount: number;
  }>;
  isFallback?: boolean;
}

interface PlateLookupResponse {
  status: 'no_match' | 'single_match' | 'multiple_matches';
  matchType?: 'exact_4' | 'fallback_3' | 'none';
  isFallback?: boolean;
  candidate?: PlateCandidate;
  candidates?: PlateCandidate[];
  extractedPlate?: string;
  plateDigits?: string;
  confidence?: number;
  isUncertain?: boolean;
  notice?: string;
  error?: string;
  retryAfter?: number;
}

function PlateLookupModal({
  isOpen,
  onClose,
  onNewRegistration,
  onSelectCustomer,
}: {
  isOpen: boolean;
  onClose: () => void;
  onNewRegistration: (plate: string) => void;
  onSelectCustomer: (candidate: PlateCandidate) => void;
}) {
  const { isIndustrial, isEnterprise } = useDesignTheme();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [plateInput, setPlateInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [isUncertain, setIsUncertain] = useState(false);
  const [result, setResult] = useState<PlateLookupResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  const handleImageSelected = async (file: File) => {
    setImageFile(file);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    setLoading(true);
    setErrorMessage(null);
    setResult(null);

    try {
      const optimizedFile = await optimizeReceiptImage(file);
      const formData = new FormData();
      formData.append('image', optimizedFile);

      const res = await fetch('/api/vehicles/lookup-plate', {
        method: 'POST',
        body: formData,
      });

      const data = (await res.json()) as PlateLookupResponse;

      if (!res.ok) {
        if (res.status === 429) {
          setErrorMessage(
            data.error || '요청 횟수 제한 또는 연속 조회 실패로 인해 15분간 조회가 차단되었습니다.',
          );
        } else if (res.status === 503) {
          setErrorMessage(data.error || '서버 보안 설정(PLATE_HASH_SECRET)이 누락되었습니다.');
        } else {
          setErrorMessage(data.error || '번호판 인식 및 조회에 실패했습니다.');
        }
        return;
      }

      setResult(data);
      if (data.extractedPlate) {
        setPlateInput(data.extractedPlate);
      }
      setConfidence(data.confidence ?? null);
      setIsUncertain(Boolean(data.isUncertain));
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : '네트워크 오류가 발생했습니다.',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleTextLookup = async () => {
    if (!plateInput.trim()) return;
    setLoading(true);
    setErrorMessage(null);
    setResult(null);

    try {
      const res = await fetch('/api/vehicles/lookup-plate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plateText: plateInput.trim() }),
      });

      const data = (await res.json()) as PlateLookupResponse;

      if (!res.ok) {
        if (res.status === 429) {
          setErrorMessage(
            data.error || '요청 횟수 제한 또는 연속 조회 실패로 인해 15분간 조회가 차단되었습니다.',
          );
        } else if (res.status === 503) {
          setErrorMessage(data.error || '서버 보안 설정(PLATE_HASH_SECRET)이 누락되었습니다.');
        } else {
          setErrorMessage(data.error || '번호판 조회에 실패했습니다.');
        }
        return;
      }

      setResult(data);
      if (data.extractedPlate) {
        setPlateInput(data.extractedPlate);
      }
      setConfidence(data.confidence ?? null);
      setIsUncertain(Boolean(data.isUncertain));
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : '네트워크 오류가 발생했습니다.',
      );
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const digitsOnly = plateInput.replace(/[^0-9]/g, '');
  const isShortDigits = digitsOnly.length > 0 && digitsOnly.length <= 3;
  const isLowConfidence = confidence !== null && (confidence < 0.96 || isUncertain);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div
        className={`relative w-full max-w-2xl rounded-2xl border shadow-2xl transition-all overflow-hidden my-auto max-h-[90vh] flex flex-col ${
          isEnterprise
            ? 'border-slate-200 bg-white text-slate-900'
            : isIndustrial
              ? 'border-amber-500/40 bg-[#161d28] text-slate-100 shadow-amber-500/10'
              : 'border-slate-800 bg-[#0d131f] text-slate-100'
        }`}
      >
        <div
          className={`flex items-center justify-between border-b p-5 ${
            isEnterprise
              ? 'border-slate-100 bg-slate-50/70'
              : isIndustrial
                ? 'border-slate-800 bg-[#111722]'
                : 'border-slate-800 bg-slate-950/60'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`grid h-10 w-10 place-items-center rounded-xl font-black ${
                isEnterprise
                  ? 'bg-blue-100 text-blue-700'
                  : isIndustrial
                    ? 'bg-amber-500 text-slate-950 shadow-md'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              }`}
            >
              <Camera size={20} strokeWidth={2.4} />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight">
                번호판 간편접수 & 자동 조회
              </h2>
              <p
                className={`text-xs ${
                  isEnterprise ? 'text-slate-500' : 'text-slate-400'
                }`}
              >
                오토바이 번호판 사진을 인식하여 신규 접수하거나 기존 고객을 조회합니다.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className={`rounded-lg p-2 transition ${
              isEnterprise
                ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImageSelected(f);
                e.target.value = '';
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImageSelected(f);
                e.target.value = '';
              }}
            />

            <Button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={loading}
              className={`h-12 rounded-xl font-bold flex items-center justify-center gap-2 transition ${
                isEnterprise
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : isIndustrial
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold'
              }`}
            >
              <Camera size={18} />
              <span>카메라 바로 촬영</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className={`h-12 rounded-xl font-bold flex items-center justify-center gap-2 transition ${
                isEnterprise || isIndustrial
                  ? 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                  : 'border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800'
              }`}
            >
              <CloudUpload size={18} />
              <span>사진 파일 선택</span>
            </Button>
          </div>

          {imagePreview && (
            <div className="relative rounded-xl border border-slate-700/60 overflow-hidden bg-black/40 p-2 flex items-center gap-4">
              <img
                src={imagePreview}
                alt="번호판 사진"
                className="h-20 w-28 object-cover rounded-lg border border-slate-700 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-400">선택된 번호판 이미지</p>
                <p className="text-sm font-bold text-slate-200 truncate">
                  {imageFile?.name || 'capture.jpg'}
                </p>
                <p className="text-xs text-slate-500 font-mono">
                  {imageFile ? `${Math.round(imageFile.size / 1024)} KB` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setImageFile(null);
                  if (imagePreview) URL.revokeObjectURL(imagePreview);
                  setImagePreview(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white mr-2"
                title="사진 삭제"
              >
                <X size={16} />
              </button>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                인식된 번호판 (직접 수정 및 검색)
              </label>
              <div className="flex items-center gap-2">
                {confidence !== null && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-mono font-bold border ${
                      isLowConfidence
                        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                        : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    }`}
                  >
                    {isLowConfidence ? (
                      <>
                        <AlertTriangle size={12} />
                        확인 필요 ({Math.round((confidence || 0) * 100)}%)
                      </>
                    ) : (
                      <>
                        <Check size={12} />
                        신뢰도 {Math.round(confidence * 100)}%
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  value={plateInput}
                  onChange={(e) => setPlateInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleTextLookup();
                  }}
                  placeholder="예: 서울 강남 가 1234 또는 1234"
                  className={`h-12 font-mono text-base sm:text-lg font-black tracking-wider ${
                    isEnterprise
                      ? 'border-slate-300 bg-white text-slate-900'
                      : isIndustrial
                        ? 'border-slate-700 bg-[#0e141e] text-white'
                        : 'border-slate-700 bg-slate-900 text-white'
                  }`}
                />
              </div>
              <Button
                type="button"
                onClick={() => void handleTextLookup()}
                disabled={loading || !plateInput.trim()}
                variant="outline"
                className={`h-12 px-4 font-bold shrink-0 ${
                  isIndustrial
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                    : ''
                }`}
              >
                <Search size={16} className="mr-1" />
                <span>재조회</span>
              </Button>
            </div>

            <div className="space-y-1">
              {isLowConfidence && (
                <p className="text-xs text-amber-400 font-medium flex items-center gap-1.5">
                  <AlertTriangle size={13} className="shrink-0" />
                  <span>인식 신뢰도가 낮습니다. 번호판을 육안으로 확인 후 필요시 수정하세요. (수정 후 접수 가능)</span>
                </p>
              )}
              {isShortDigits && (
                <p className="text-xs text-amber-400/90 font-medium flex items-center gap-1.5">
                  <AlertTriangle size={13} className="shrink-0" />
                  <span>앞자리가 누락되지 않았는지 확인하세요 (예: 4자리 중 앞자리 1개가 미인식된 경우 직접 보완 가능).</span>
                </p>
              )}
            </div>
          </div>

          {errorMessage && (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-300 text-sm flex items-start gap-3">
              <AlertTriangle size={18} className="text-rose-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-bold">조회 중 문제가 발생했습니다</p>
                <p className="text-xs text-rose-200/90 leading-relaxed">{errorMessage}</p>
              </div>
            </div>
          )}

          {loading && (
            <div className="grid place-items-center py-8">
              <Spinner className={`h-8 w-8 ${isIndustrial ? 'text-amber-400' : 'text-emerald-400'}`} />
              <p className="mt-3 text-sm font-bold text-slate-300 animate-pulse">
                번호판 인식 및 고객 DB 매칭 질의 중...
              </p>
            </div>
          )}

          {!loading && result && (
            <div className="pt-2">
              {result.status === 'no_match' && (
                <div
                  className={`rounded-xl border p-5 space-y-4 ${
                    isEnterprise
                      ? 'border-slate-200 bg-slate-50'
                      : isIndustrial
                        ? 'border-slate-800 bg-[#0f141f]'
                        : 'border-slate-800 bg-slate-900/50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-800 text-slate-400 shrink-0">
                      <Search size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-extrabold text-slate-200">
                        등록된 고객 및 차량 정보가 없습니다
                      </h3>
                      <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                        {result.notice ||
                          '현재 시스템에 저장된 차량이 없습니다. 판독된 번호판으로 신규 고객·차량 정비를 바로 접수합니다.'}
                      </p>
                    </div>
                  </div>

                  <Button
                    type="button"
                    onClick={() => onNewRegistration(plateInput.trim() || result.extractedPlate || '')}
                    className={`w-full h-12 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition ${
                      isEnterprise
                        ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-md'
                        : isIndustrial
                          ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-md'
                          : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold'
                    }`}
                  >
                    <Check size={18} strokeWidth={3} />
                    <span>이 번호판으로 신규 정비 접수 (타이핑 없이 바로 시작)</span>
                  </Button>
                </div>
              )}

              {result.status === 'single_match' && result.candidate && (
                <div
                  className={`rounded-xl border p-5 space-y-4 ${
                    isEnterprise
                      ? 'border-emerald-200 bg-emerald-50/50'
                      : isIndustrial
                        ? 'border-amber-500/40 bg-amber-500/5'
                        : 'border-emerald-500/30 bg-emerald-500/5'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-xs">
                        ✓
                      </span>
                      <h3 className="text-sm font-black text-slate-100">
                        기존 등록 고객 차량 일치
                      </h3>
                    </div>
                    {result.candidate.isFallback && (
                      <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs font-mono font-bold text-amber-300 border border-amber-500/40">
                        3자리 유사 일치
                      </span>
                    )}
                  </div>

                  <div className="rounded-xl bg-slate-950/60 border border-slate-800/80 p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">차주 성명</span>
                      <strong className="text-sm font-extrabold text-slate-100">
                        {result.candidate.customerName}
                      </strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">연락처</span>
                      <span className="text-xs font-mono font-bold text-slate-300">
                        {result.candidate.phone}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">차종 및 매장</span>
                      <span className="text-xs font-bold text-slate-200">
                        {result.candidate.model} · {result.candidate.shopName || '지점 정보 없음'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">확정 번호판</span>
                      <span className="text-xs font-mono font-black text-emerald-400">
                        {result.candidate.fullPlate}
                      </span>
                    </div>

                    {result.candidate.recentOrders && result.candidate.recentOrders.length > 0 && (
                      <div className="pt-2 mt-2 border-t border-slate-800">
                        <p className="text-[11px] font-bold text-slate-400 mb-1.5">최근 정비 이력</p>
                        <div className="space-y-1">
                          {result.candidate.recentOrders.map((ord) => (
                            <div
                              key={ord.id}
                              className="flex items-center justify-between text-[11px] text-slate-400 font-mono"
                            >
                              <span>{ord.approved_service_date?.slice(0, 10) || '최근'} · {ord.service_type || '일반정비'}</span>
                              <span className="font-bold text-slate-300">{won.format(ord.total_amount)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Button
                      type="button"
                      onClick={() => onSelectCustomer(result.candidate!)}
                      className={`h-11 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition ${
                        isEnterprise
                          ? 'bg-blue-600 hover:bg-blue-500 text-white'
                          : isIndustrial
                            ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black'
                            : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold'
                      }`}
                    >
                      <Check size={16} />
                      <span>이 고객으로 정비 접수</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onNewRegistration(plateInput.trim() || result.candidate!.fullPlate)}
                      className="h-11 rounded-xl font-bold text-xs border-slate-700 hover:bg-slate-800 text-slate-300"
                    >
                      <span>신규 차량으로 접수</span>
                    </Button>
                  </div>
                </div>
              )}

              {result.status === 'multiple_matches' && result.candidates && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      일치하는 차량 후보 ({result.candidates.length}건)
                    </h3>
                    <span className="text-[11px] text-slate-400">해당 고객을 선택하세요</span>
                  </div>

                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {result.candidates.map((cand) => (
                      <div
                        key={cand.vehicleId}
                        className={`rounded-xl border p-3 flex items-center justify-between gap-3 transition ${
                          isEnterprise
                            ? 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                            : 'border-slate-800 bg-slate-950/40 hover:bg-slate-900/60'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <strong className="text-sm font-black text-slate-100">
                              {cand.customerName}
                            </strong>
                            <span className="text-xs font-mono text-slate-400">
                              {cand.phone}
                            </span>
                            {cand.isFallback && (
                              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-mono font-bold text-amber-300 border border-amber-500/30">
                                3자리 유사
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {cand.model} · <span className="font-mono text-slate-300">{cand.fullPlate}</span> · {cand.shopName || '지점'}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => onSelectCustomer(cand)}
                          className={`shrink-0 h-8 px-3 rounded-lg font-bold text-xs ${
                            isIndustrial
                              ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black'
                              : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold'
                          }`}
                        >
                          선택
                        </Button>
                      </div>
                    ))}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onNewRegistration(plateInput.trim() || result.extractedPlate || '')}
                    className="w-full h-10 rounded-xl font-bold text-xs border-slate-700 hover:bg-slate-800 text-slate-300"
                  >
                    <span>목록에 없음 - 이 번호판으로 신규 접수</span>
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <div
          className={`flex items-center justify-between border-t p-4 px-6 text-xs font-mono ${
            isEnterprise
              ? 'border-slate-100 bg-slate-50 text-slate-500'
              : 'border-slate-800/80 bg-slate-950/80 text-slate-400'
          }`}
        >
          <span>보안 규정: HMAC-SHA256 해시 검색 · PII 마스킹 보호</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-white"
          >
            닫기
          </Button>
        </div>
      </div>
    </div>
  );
}

