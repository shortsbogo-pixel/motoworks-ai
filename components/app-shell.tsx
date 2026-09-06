'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  Bike,
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
  recentOrders,
} from '@/lib/mock-data';
import { shouldHighlightField, type ReviewDocument } from '@/lib/domain';

type View =
  | 'dashboard'
  | 'upload'
  | 'processing'
  | 'review'
  | 'orders'
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

export function AppShell({ userName }: { userName: string }) {
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

      // 5. 렌트 정산
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
    const timer = setTimeout(() => {
      void refreshAllData();
    }, 0);
    return () => clearTimeout(timer);
  }, []);


  return (
    <div className="min-h-screen bg-[#f3f7f6] text-[#102522]">
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[264px] border-r border-white/10 bg-[#082925] text-white transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex h-20 items-center gap-3 border-b border-white/10 px-6">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#22c7a5] text-[#06241f] shadow-[0_8px_24px_rgba(34,199,165,.22)]">
            <Bike size={23} strokeWidth={2.4} />
          </div>
          <div>
            <p className="text-[17px] font-extrabold tracking-[-0.03em]">
              모토웍스 AI
            </p>
            <p className="text-xs text-[#83bdb2]">정비 운영 시스템</p>
          </div>
        </div>
        <nav className="flex h-[calc(100%-160px)] flex-col gap-6 overflow-y-auto px-3 py-5">
          {navGroups.map((group) => (
            <div key={group.label}>
              <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-[.14em] text-[#65978e]">
                {group.label}
              </p>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => navigate(item.id)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${view === item.id ? 'bg-[#16463f] text-white shadow-inner' : 'text-[#b9d3ce] hover:bg-white/5 hover:text-white'}`}
                    >
                      <Icon size={18} />
                      <span className="flex-1">{item.label}</span>
                      {item.id === 'review' && pending > 0 && (
                        <span className="grid min-w-6 place-items-center rounded-full bg-[#ffb54c] px-1.5 py-0.5 text-[11px] font-extrabold text-[#3e2500]">
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
        <div className="absolute inset-x-3 bottom-3 rounded-xl border border-white/10 bg-white/5 p-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-[#b8f4e6] text-sm font-black text-[#0c3a33]">
              김
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{userName}</p>
              <p className="text-xs text-[#83bdb2]">조직 관리자 · 전체 지점</p>
            </div>
          </div>
        </div>
      </aside>
      {sidebarOpen && (
        <button
          aria-label="메뉴 닫기"
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <main className="min-h-screen pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0 lg:pl-[264px]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-[#dbe8e5] bg-[#f8fbfa]/94 px-3 backdrop-blur-xl sm:h-20 sm:gap-4 sm:px-7 lg:px-10">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-extrabold tracking-[-0.025em] sm:text-2xl">
              {titles[view].title}
            </h1>
            <p className="hidden text-sm text-[#57716c] sm:block">
              {titles[view].description}
            </p>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-[#cfe0dc] bg-white px-3 py-2 text-sm text-[#415d57] md:flex">
            <Store size={15} />
            <span>전체 지점</span>
            <ChevronRight size={14} />
          </div>
          <Button
            onClick={() => navigate('upload')}
            className="min-h-11 rounded-xl bg-[#0d6d5d] px-3 text-white hover:bg-[#09594c] sm:px-4"
          >
            <CloudUpload size={17} />
            <span className="hidden sm:inline">사진 업로드</span>
          </Button>
        </header>
        {notice && (
          <div className="mx-4 mt-4 flex items-center justify-between rounded-xl border border-[#9bdfd0] bg-[#e4faf4] px-4 py-3 text-sm font-semibold text-[#0b5c4f] sm:mx-7 lg:mx-10">
            <span>{notice}</span>
            <button onClick={() => setNotice('')} aria-label="알림 닫기">
              <X size={16} />
            </button>
          </div>
        )}
        <div className="p-3 sm:p-7 lg:p-10">
          {view === 'dashboard' && (
            <Dashboard
              pending={pending}
              approvedCount={approvedToday.length}
              approvedRevenue={approvedRevenue}
              stats={dashboardStats}
              orders={orders}
              navigate={navigate}
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
          className="safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-[#cfe0dc] bg-white/96 px-2 pt-1.5 shadow-[0_-8px_24px_rgba(8,41,37,.10)] backdrop-blur-xl lg:hidden"
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
                className={`relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[12px] font-bold transition ${active ? 'bg-[#e4f7f2] text-[#096654]' : 'text-[#627873]'}`}
              >
                <Icon size={20} strokeWidth={active ? 2.5 : 2} />
                <span>{item.label}</span>
                {item.id === 'review' && pending > 0 && (
                  <span className="absolute right-[22%] top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-[#f4a62a] px-1 text-[10px] font-black text-[#3b2500]">
                    {pending}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </main>
    </div>
  );
}

function Dashboard({
  pending,
  approvedCount,
  approvedRevenue,
  stats,
  orders,
  navigate,
}: {
  pending: number;
  approvedCount: number;
  approvedRevenue: number;
  stats: DashboardStats | null;
  orders: OrderRecord[];
  navigate: (view: View) => void;
}) {
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
    : recentOrders;

  return (
    <div className="space-y-7">
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
              className="rounded-xl"
              onClick={() => navigate('review')}
            >
              대기함 열기 <ChevronRight size={16} />
            </Button>
          </div>
          <div className="space-y-3">
            {[
              [
                '매장 미확정',
                4,
                '사진의 지점 표시가 없거나 흐립니다.',
                'bg-[#fff1d6] text-[#9a5b00]',
              ],
              [
                '차종 후보',
                4,
                '배기량 또는 연식을 확정할 수 없습니다.',
                'bg-[#e8edff] text-[#465fc7]',
              ],
              [
                '0원 정비',
                2,
                '렌트 정비 여부를 확인해야 합니다.',
                'bg-[#ffe7e4] text-[#b54538]',
              ],
              [
                '중복 후보',
                1,
                '원본 해시와 작업 항목이 유사합니다.',
                'bg-[#eee8ff] text-[#6b50ad]',
              ],
            ].map(([label, count, description, tone]) => (
              <div
                key={String(label)}
                className="flex items-center gap-4 rounded-xl border border-[#e2ece9] bg-[#fbfdfc] p-4"
              >
                <span
                  className={`grid h-10 w-10 place-items-center rounded-xl text-sm font-black ${tone}`}
                >
                  {count}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{label}</p>
                  <p className="text-sm text-[#667d78]">{description}</p>
                </div>
                <ChevronRight size={17} className="text-[#89a09b]" />
              </div>
            ))}
          </div>
        </section>
        <section className="panel overflow-hidden">
          <div className="border-b border-[#e2ece9] p-5 sm:p-6">
            <p className="eyebrow">기존 데이터</p>
            <h2 className="section-title">재검증 대기</h2>
          </div>
          <div className="p-5 sm:p-6">
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#f2d39e] bg-[#fff8e9] p-4">
              <AlertTriangle
                className="mt-0.5 shrink-0 text-[#c17b0e]"
                size={19}
              />
              <p className="text-sm leading-6 text-[#76521a]">
                원본 엑셀이 전달되지 않아 아래 값은 사용자 제공 기준값입니다.
                매출로 확정하지 않았습니다.
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
              className="mt-6 w-full rounded-xl"
              onClick={() => navigate('excel')}
            >
              <FileSpreadsheet size={16} /> 원본 엑셀 연결
            </Button>
          </div>
        </section>
      </div>
      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#e2ece9] p-5 sm:p-6">
          <div>
            <p className="eyebrow">최근 기록</p>
            <h2 className="section-title">
              승인된 정비 {orders.length > 0 ? `(${orders.length}건 DB 영구저장됨)` : '(참조 예시)'}
            </h2>
          </div>
          <Button variant="ghost" onClick={() => navigate('orders')}>
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
  const tones: Record<string, string> = {
    amber: 'bg-[#fff0d5] text-[#b06a00]',
    green: 'bg-[#dcf8ed] text-[#08745f]',
    blue: 'bg-[#e4f2ff] text-[#246b9a]',
    purple: 'bg-[#eee9ff] text-[#6b52ad]',
  };
  return (
    <button
      onClick={onClick}
      className="panel group min-h-[150px] p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[0_14px_35px_rgba(18,67,59,.1)] sm:min-h-0 sm:p-5"
    >
      <div className="mb-5 flex items-center justify-between">
        <span
          className={`grid h-11 w-11 place-items-center rounded-xl ${tones[tone]}`}
        >
          <Icon size={21} />
        </span>
        {onClick && <ChevronRight size={18} className="text-[#91a8a3]" />}
      </div>
      <p className="text-sm font-semibold text-[#617873]">{label}</p>
      <p className="mt-1 text-[22px] font-black tracking-[-.04em] sm:text-[28px]">{value}</p>
      <p className="mt-2 line-clamp-2 text-xs leading-4 text-[#81938f]">{note}</p>
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
}: {
  documents: ReviewDocument[];
  setDocuments: (value: ReviewDocument[]) => void;
  setNotice: (value: string) => void;
  navigate: (view: View) => void;
  setSelectedId: (value: string) => void;
  setProcessingSummary: (value: ProcessingSummary) => void;
  onUploaded?: () => void;
}) {
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
      files.forEach((file) => form.append('files', file));
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
          className="group grid min-h-[280px] w-full place-items-center rounded-2xl border-2 border-dashed border-[#9ecbc1] bg-[#f3fbf9] p-5 text-center transition hover:border-[#1c9f88] hover:bg-[#ecfaf6] sm:min-h-[360px] sm:p-8"
        >
          <div>
            <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-2xl bg-[#d9f6ee] text-[#0b7865]">
              <CloudUpload size={30} />
            </div>
            <h2 className="text-xl font-extrabold">
              정비내역서 사진을 선택하세요
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[#617873]">
              JPG, PNG, HEIC를 여러 장 선택할 수 있습니다. 원본은 비공개로
              보존하고 보정본을 별도로 만듭니다.
            </p>
            <div className="mt-5 grid gap-2 sm:flex sm:justify-center">
              <Button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="min-h-12 rounded-xl bg-[#0d6d5d] px-5"
              >
                <Camera size={18} /> 바로 촬영
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => inputRef.current?.click()}
                className="min-h-12 rounded-xl border-[#9ecbc1] bg-white px-5"
              >
                <CloudUpload size={18} /> 사진 여러 장 선택
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
  if (!selected)
    return (
      <EmptyState
        title="검수가 모두 끝났습니다"
        text="승인한 건은 정비내역과 매출에 반영되었습니다."
      />
    );
  return (
    <div className="grid min-h-[680px] overflow-hidden rounded-2xl border border-[#dbe8e5] bg-white shadow-[0_10px_34px_rgba(16,62,54,.06)] xl:grid-cols-[330px_1fr]">
      <aside className="border-b border-[#dbe8e5] bg-[#f8fbfa] xl:border-b-0 xl:border-r">
        <div className="border-b border-[#dbe8e5] p-4">
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[#809690]"
              size={16}
            />
            <Input
              aria-label="검수 문서 검색"
              placeholder="고객, 차량, 파일 검색"
              className="rounded-xl border-[#cfe0dc] bg-white pl-9"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <Badge variant="secondary" className="bg-[#fff0d4] text-[#955b08]">
              대기 {pendingDocs.length}
            </Badge>
            <Badge variant="outline">낮은 신뢰도 우선</Badge>
          </div>
        </div>
        <div className="flex snap-x gap-2 overflow-x-auto p-3 xl:block xl:max-h-[590px] xl:space-y-0 xl:overflow-y-auto xl:p-0">
          {pendingDocs.map((document) => {
            const issues =
              document.fields.filter((item) => shouldHighlightField(item))
                .length + Number(document.duplicateCandidate);
            return (
              <button
                aria-label={`${document.customerName} ${document.vehicleLabel} 검수`}
                key={document.id}
                onClick={() => setSelectedId(document.id)}
                className={`min-w-[250px] snap-start rounded-xl border border-[#dbe8e5] p-4 text-left xl:w-full xl:min-w-0 xl:rounded-none xl:border-x-0 xl:border-t-0 ${document.id === selected.id ? 'bg-[#e6f7f2]' : 'bg-white hover:bg-white'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold">
                      {document.customerName} · {document.vehicleLabel}
                    </p>
                    <p className="mt-1 truncate text-xs text-[#6c817c]">
                      {document.fileName}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#fff0d4] px-2 py-1 text-[11px] font-black text-[#9a5d00]">
                    {issues}개
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className="text-[#6c817c]">{document.shopName}</span>
                  <strong>{won.format(document.amount)}</strong>
                </div>
              </button>
            );
          })}
        </div>
      </aside>
      <section className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#dbe8e5] px-5 py-4">
          <div>
            <p className="text-sm font-extrabold">{selected.fileName}</p>
            <p className="text-xs text-[#71857f]">{selected.id} · 2026-09-03</p>
          </div>
          <div className="hidden gap-2 sm:flex">
            <Button
              variant="outline"
              className="rounded-xl text-[#9f4138]"
              onClick={() => resolve('rejected')}
              disabled={resolving}
            >
              <X size={16} /> 반려
            </Button>
            <Button
              className="rounded-xl bg-[#0d6d5d]"
              onClick={() => resolve('approved')}
              disabled={resolving}
            >
              <Check size={16} /> 수정 후 승인
            </Button>
          </div>
        </div>
        <div className="grid lg:grid-cols-[minmax(300px,.9fr)_minmax(360px,1.1fr)]">
          <DocumentPreview document={selected} />
          <div className="p-4 sm:p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="eyebrow">AI 판독</p>
                <h2 className="section-title">확인이 필요한 항목</h2>
              </div>
              <Badge className="bg-[#fff0d4] text-[#945a00] hover:bg-[#fff0d4]">
                {
                  selected.fields.filter((item) => shouldHighlightField(item))
                    .length
                }
                개
              </Badge>
            </div>
            <div className="space-y-4">
              {selected.fields.map((field) => {
                const highlight = shouldHighlightField(field);
                return (
                  <div
                    key={field.id}
                    className={`rounded-xl border p-4 ${highlight ? 'border-[#efcf8b] bg-[#fffbf1]' : 'border-[#dce9e6] bg-[#f9fbfa]'}`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <label
                        htmlFor={field.id}
                        className="text-sm font-extrabold"
                      >
                        {field.label}
                      </label>
                      <span
                        className={`text-xs font-black ${field.confidence >= 0.96 ? 'text-[#14735f]' : 'text-[#b46c00]'}`}
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
                      className={`h-11 rounded-lg bg-white ${highlight ? 'border-[#e3b859]' : 'border-[#cededb]'}`}
                      placeholder="확인 후 입력"
                    />
                    {highlight && (
                      <div className="mt-2 flex gap-2 text-xs leading-5 text-[#8a621f]">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                        <span>{field.validationMessage}</span>
                      </div>
                    )}
                    {field.rawValue &&
                      field.rawValue !== field.normalizedValue && (
                        <p className="mt-2 text-xs text-[#71847f]">
                          원본 판독:{' '}
                          <span className="font-semibold text-[#425b55]">
                            {field.rawValue}
                          </span>
                        </p>
                      )}
                  </div>
                );
              })}
            </div>
            {selected.duplicateCandidate && (
              <div className="mt-4 flex gap-3 rounded-xl border border-[#cebdf0] bg-[#f5f1ff] p-4 text-sm text-[#5a438e]">
                <ListChecks size={18} />
                <div>
                  <p className="font-bold">중복 후보가 있습니다</p>
                  <p className="mt-1 text-xs">
                    이미지 해시·차량번호·작업 항목을 함께 비교한 뒤 승인하세요.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 grid grid-cols-2 gap-2 border-t border-[#dbe8e5] bg-white/96 p-3 shadow-[0_-8px_24px_rgba(8,41,37,.10)] backdrop-blur sm:hidden">
          <Button
            variant="outline"
            className="min-h-12 rounded-xl border-[#d8b5b0] text-[#9f4138]"
            onClick={() => resolve('rejected')}
            disabled={resolving}
          >
            <X size={17} /> 반려
          </Button>
          <Button
            className="min-h-12 rounded-xl bg-[#0d6d5d]"
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
  return (
    <div className="border-b border-[#e2ece9] bg-[#eaf0ee] p-4 lg:border-b-0 lg:border-r lg:p-5">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-extrabold">원본 사진</p>
        <span className="text-xs font-semibold text-[#647a75]">100%</span>
      </div>
      <div className="relative mx-auto aspect-[3/4] max-h-[380px] max-w-[285px] overflow-hidden rounded-lg border border-[#c8d4d1] bg-[#fffdf8] shadow-[0_16px_34px_rgba(27,48,43,.13)] sm:max-h-[520px] sm:max-w-none">
        {document.sourceUrl ? (
          <Image
            src={document.sourceUrl}
            alt={`${document.fileName} 원본 정비내역서`}
            fill
            unoptimized
            sizes="(max-width: 1024px) 285px, 40vw"
            className="bg-[#17211f] object-contain"
          />
        ) : (
        <div className="flex h-full flex-col p-[8%]">
          <div className="border-b-2 border-[#20342f] pb-3 text-center text-xl font-black tracking-[.16em]">
            정 비 내 역 서
          </div>
          <div className="mt-5 grid grid-cols-[90px_1fr] border border-[#8d9c98] text-[11px] leading-8">
            <span className="border-b border-r px-2 font-bold">정비일</span>
            <span className="border-b px-2 font-[cursive]">9 / 3</span>
            <span className="border-b border-r px-2 font-bold">고객명</span>
            <span className="border-b px-2 font-[cursive]">
              {document.customerName}
            </span>
            <span className="border-b border-r px-2 font-bold">차량</span>
            <span className="border-b px-2 font-[cursive]">
              {document.vehicleLabel}
            </span>
            <span className="border-r px-2 font-bold">매장</span>
            <span className="px-2 font-[cursive]">{document.shopName}</span>
          </div>
          <div className="mt-6 flex-1 space-y-3 border-y border-[#8d9c98] py-4 text-sm font-[cursive]">
            <p>
              •{' '}
              {
                document.fields.find((item) => item.key === 'service_item')
                  ?.rawValue
              }
            </p>
            <p>• 점검 및 조정</p>
            <p className="text-right text-base">
              합계 {document.amount.toLocaleString()}원
            </p>
          </div>
          <p className="mt-4 text-center text-xs font-bold">안전 운행하세요</p>
        </div>
        )}
        {document.fields
          .filter((item) => shouldHighlightField(item))
          .slice(0, 3)
          .map((field, index) => (
            <span
              key={field.id}
              className="absolute rounded border-2 border-[#f2a81d] bg-[#ffd56a]/15"
              style={{
                left: `${18 + index * 8}%`,
                top: `${field.boundingBox.y}%`,
                width: `${field.boundingBox.width}%`,
                height: `${field.boundingBox.height}%`,
              }}
            />
          ))}
        {!document.sourceAvailable && (
          <div className="absolute inset-x-4 bottom-4 rounded-lg bg-[#33220f]/90 px-3 py-2 text-center text-xs font-semibold text-white">
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
    : [
        ...approved.map((d) => ({
          id: d.id,
          customer: d.customerName,
          vehicle: d.vehicleLabel,
          shop: d.shopName,
          amount: d.amount,
          status: '오늘 승인 (임시)',
        })),
        ...recentOrders.map((r) => ({
          ...r,
          status: `${r.status} (참조 예시)`,
        })),
      ];

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

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2ece9] p-5 sm:p-6">
        <div>
          <p className="eyebrow">{isDbLive ? '실제 영구 저장 데이터' : '기준 예시 데이터'}</p>
          <h2 className="section-title">
            정비내역 {rows.length}건 {isDbLive ? '(DB 동기화 완료)' : '(검증 대기)'}
          </h2>
        </div>
        <Badge variant={isDbLive ? 'default' : 'outline'} className={isDbLive ? 'bg-[#0d6d5d] text-white' : ''}>
          {isDbLive ? '영구 데이터베이스 반영됨' : '참조 기준값'}
        </Badge>
      </div>
      <OrderTable rows={rows} />
      <div className="border-t border-[#e2ece9] bg-[#f8fbfa] p-5">
        <p className="text-sm font-semibold">
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
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="bg-[#f6f9f8] text-xs uppercase tracking-wide text-[#6d817c]">
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
            <tr key={row.id} className="border-t border-[#e7efed]">
              <td className="px-6 py-4 font-mono text-xs font-bold">
                {row.id}
              </td>
              <td className="px-6 py-4">
                <p className="font-bold">{row.customer}</p>
                <p className="text-xs text-[#71847f]">{row.vehicle}</p>
              </td>
              <td className="px-6 py-4">{row.shop}</td>
              <td className="px-6 py-4 text-right font-extrabold">
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
            className="flex flex-wrap items-center gap-4 border-t border-[#e5eeec] p-5"
          >
            <div className="grid h-11 w-11 place-items-center rounded-full bg-[#dff4ef] font-black text-[#0d6d5d]">
              {name[0] || '고'}
            </div>
            <div className="min-w-[190px] flex-1">
              <p className="font-extrabold">{name}</p>
              <p className="text-sm text-[#70837e]">
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
        <div className="my-5 rounded-xl bg-[#f2f6ff] p-4 text-sm leading-6 text-[#405984]">
          전화번호·차량번호·차종의 일치 근거와 충돌을 함께 보여주고, 사람이
          승인한 병합 이력을 보존합니다. (SHA-256 해시 기반 동명이인 분리)
        </div>
        <div className="rounded-xl border border-[#e0e9e7] p-4">
          <div className="flex justify-between">
            <strong>박○진 ↔ 박진○</strong>
            <Badge variant="outline">후보 87%</Badge>
          </div>
          <ul className="mt-3 space-y-2 text-xs text-[#627873]">
            <li>✓ 전화번호 해시 일치</li>
            <li>✓ 차량번호 일치</li>
            <li className="text-[#ad5f0e]">! 차종 표기 충돌 (확인 필요)</li>
          </ul>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" size="sm" className="flex-1">
              분리 유지
            </Button>
            <Button size="sm" className="flex-1 bg-[#0d6d5d]">
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
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-[#f6f9f8] text-left text-xs text-[#637a74]">
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
              <tr key={row.id} className="border-t border-[#e5eeec]">
                <td className="px-5 py-4">
                  <p className="font-bold">{row.company}</p>
                  <p className="text-xs text-[#70837e]">{row.vehicle}</p>
                </td>
                {[row.base, row.customer, row.billed, row.paid, row.due].map(
                  (value, i) => (
                    <td
                      key={i}
                      className={`px-5 py-4 font-semibold ${i === 4 && value > 0 ? 'text-[#bd5c14]' : ''}`}
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
          note="과거 엑셀 기준값"
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
          {stats?.shops && stats.shops.length > 0 ? '실시간 DB 지점별 매출 현황' : '사용자 제공 기준값'}
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
          <PanelTitle eyebrow="사용자 계정" title={`등록 사용자 및 지점 권한 (${displayUsers.length}명)`} />
          {displayUsers.map((user) => (
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
            </div>
          ))}
        </section>
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
        <div className="divide-y divide-[#e5eeec]">
          {auditLogs.map((log) => (
            <div
              key={log.id}
              className="grid gap-3 p-5 sm:grid-cols-[200px_1fr_auto]"
            >
              <div>
                <p className="font-mono text-xs font-bold text-[#0c3a33]">{log.id.slice(0, 16)}...</p>
                <p className="text-xs text-[#758782]">
                  {new Date(log.createdAt).toLocaleString('ko-KR')}
                </p>
                <p className="text-xs font-semibold text-[#0f6c5b]">{log.shopName}</p>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-[#102522]">{log.action}</p>
                  <span className="rounded bg-[#f0f4f3] px-2 py-0.5 text-[11px] font-mono text-[#5b736e]">
                    {log.entityType} #{log.entityId.slice(0, 8)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[#657a75]">
                  수행자: <strong>{log.actorName}</strong>
                </p>
                {Boolean(log.detail) && (
                  <pre className="mt-2 max-h-24 overflow-auto rounded-lg bg-[#f6f9f8] p-2 text-[11px] text-[#425d57] font-mono">
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
        <div>
          {changedDocs.map((d) => (
            <div
              key={d.id}
              className="grid gap-3 border-t border-[#e5eeec] p-5 sm:grid-cols-[180px_1fr_auto]"
            >
              <div>
                <p className="font-mono text-xs font-bold">{d.id}</p>
                <p className="text-xs text-[#758782]">세션 기록</p>
              </div>
              <div>
                <p className="text-sm font-bold">
                  {d.status === 'approved'
                    ? '검수 승인'
                    : d.status === 'rejected'
                      ? '문서 반려'
                      : '필드 수정'}
                </p>
                <p className="text-xs text-[#657a75]">
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
  return (
    <div className="flex items-center justify-between rounded-xl border border-[#dce8e5] bg-white p-3">
      <span className="text-sm font-semibold">{method}</span>
      <strong>{won.format(amount)}</strong>
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
  const tones = {
    green: 'bg-[#def6ee] text-[#08705d]',
    amber: 'bg-[#fff0d5] text-[#9a5d00]',
    blue: 'bg-[#e4f0ff] text-[#356493]',
  };
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-extrabold ${tones[tone]}`}
    >
      {label}
    </span>
  );
}
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#e7efed] py-2.5 text-sm last:border-0">
      <dt className="text-[#6b817b]">{label}</dt>
      <dd className="max-w-[70%] text-right font-bold">{value}</dd>
    </div>
  );
}
function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid min-h-[420px] place-items-center p-8 text-center">
      <div>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#e2f5f0] text-[#0d725f]">
          <Check size={26} />
        </div>
        <h2 className="mt-5 text-xl font-extrabold">{title}</h2>
        <p className="mt-2 text-sm text-[#667c76]">{text}</p>
      </div>
    </div>
  );
}
