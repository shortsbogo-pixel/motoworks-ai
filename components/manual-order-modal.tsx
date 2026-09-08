'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  Banknote,
  Camera,
  Check,
  ChevronRight,
  CloudUpload,
  CreditCard,
  Plus,
  ReceiptText,
  Search,
  Trash,
  X,
  WalletCards,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useDesignTheme } from '@/components/app-shell';
import { optimizeReceiptImage } from '@/lib/client/image-optimizer';

export interface VehicleCandidate {
  vehicleId: string;
  plateMasked: string;
  fullPlate: string;
  model: string;
  customerName: string;
  phone: string;
  customerId?: string | null;
  shopId?: string;
  shopName?: string | null;
  lastServiceDate?: string | null;
  recentOrders?: Array<{
    id: string;
    approved_service_date: string;
    service_type: string;
    total_amount: number;
  }>;
  isFallback?: boolean;
}

export interface ManualOrderItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface ManualOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (orderId: string, status: string, isDuplicate?: boolean) => void;
  initialPlate?: string;
  initialShopId?: string;
  canDecide?: boolean;
}

const COMMON_SERVICE_ITEMS = [
  { name: '엔진오일 및 필터 교환', unitPrice: 35000 },
  { name: '앞/뒤 브레이크 패드 교체', unitPrice: 45000 },
  { name: '구동계(벨트/웨이트) 점검 교체', unitPrice: 85000 },
  { name: '점화플러그 교체', unitPrice: 20000 },
  { name: '앞/뒤 타이어 교체', unitPrice: 75000 },
  { name: '배터리 교체 및 충전계통 점검', unitPrice: 55000 },
  { name: '정기 종합 점검 및 공임', unitPrice: 30000 },
];

export function ManualOrderModal({
  isOpen,
  onClose,
  onSuccess,
  initialPlate = '',
  initialShopId = 'yongjeon',
  canDecide = false,
}: ManualOrderModalProps) {
  const { isIndustrial, isEnterprise } = useDesignTheme();

  // 멱등성 키: 모달이 열릴 때 1회 생성, 재시도 시 유지, 모달 닫힐 때 초기화
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  // 스텝 상태: 'lookup' | 'candidates' | 'entry'
  const [step, setStep] = useState<'lookup' | 'candidates' | 'entry'>('lookup');

  // Step 1 상태
  const [plateInput, setPlateInput] = useState(initialPlate);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupConfidence, setLookupConfidence] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<VehicleCandidate[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);

  // 선택된 차량 / 고객 정보
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleCandidate | null>(null);
  const [isNewVehicle, setIsNewVehicle] = useState(false);

  // 신규 차량/고객 직접 입력 필드
  const [customPlate, setCustomPlate] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [customCustomerName, setCustomCustomerName] = useState('');
  const [customPhone, setCustomPhone] = useState('');

  // Step 2 전표 입력 상태
  const [shopId, setShopId] = useState(initialShopId);
  const [serviceDate, setServiceDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [serviceType, setServiceType] = useState<'personal' | 'rental' | 'lease'>('personal');
  const [items, setItems] = useState<ManualOrderItem[]>([
    {
      id: crypto.randomUUID(),
      name: '엔진오일 및 필터 교환',
      quantity: 1,
      unitPrice: 35000,
      amount: 35000,
    },
  ]);
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'cash' | 'transfer'>('card');
  const [paymentAmount, setPaymentAmount] = useState<number>(35000);
  const [paymentNote, setPaymentNote] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [requestImmediateApproval, setRequestImmediateApproval] = useState(false);

  // 제출 상태
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 모달 라이프사이클: 열릴 때 키 1회 생성
  useEffect(() => {
    if (isOpen) {
      const newKey = crypto.randomUUID();
      setIdempotencyKey(newKey);
      setStep(initialPlate ? 'entry' : 'lookup');
      setPlateInput(initialPlate);
      setCustomPlate(initialPlate);
      setSelectedVehicle(null);
      setIsNewVehicle(!initialPlate);
      setSubmitError(null);
      setLookupError(null);
    } else {
      setIdempotencyKey('');
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImagePreview(null);
      setImageFile(null);
    }
  }, [isOpen, initialPlate]);

  // 총 금액 자동 계산
  const totalAmount = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);

  // 항목 금액 변경 시 결제 금액 동기화
  useEffect(() => {
    setPaymentAmount(totalAmount);
  }, [totalAmount]);

  // 번호판 이미지 업로드 및 AI 판독
  const handleImageSelected = async (file: File) => {
    setImageFile(file);
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    const url = URL.createObjectURL(file);
    setImagePreview(url);
    setLookupLoading(true);
    setLookupError(null);

    try {
      const optimized = await optimizeReceiptImage(file);
      const formData = new FormData();
      formData.append('image', optimized);

      const res = await fetch('/api/vehicles/lookup-plate', {
        method: 'POST',
        body: formData,
      });

      const data = (await res.json()) as any;
      if (!res.ok) {
        throw new Error(data.error || '번호판 인식 및 조회에 실패했습니다.');
      }

      handleLookupSuccess(data);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : '조회 중 오류가 발생했습니다.');
    } finally {
      setLookupLoading(false);
    }
  };

  // 텍스트 번호판 조회
  const handleTextLookup = async () => {
    const query = plateInput.trim();
    if (!query) return;

    setLookupLoading(true);
    setLookupError(null);

    try {
      const res = await fetch('/api/vehicles/lookup-plate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plateText: query }),
      });

      const data = (await res.json()) as any;
      if (!res.ok) {
        throw new Error(data.error || '번호판 조회에 실패했습니다.');
      }

      handleLookupSuccess(data);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : '조회 중 오류가 발생했습니다.');
    } finally {
      setLookupLoading(false);
    }
  };

  // 조회 결과 분기 처리 (규격: exact 일치 시 자동 진행, candidates 노출 시 후보 카드 표시)
  const handleLookupSuccess = (data: {
    plateText?: string;
    extractedPlate?: string;
    confidence?: number;
    exact?: VehicleCandidate | null;
    candidates?: VehicleCandidate[];
    candidate?: VehicleCandidate | null;
    status?: string;
  }) => {
    const detectedPlate = data.plateText || data.extractedPlate || plateInput.trim();
    setPlateInput(detectedPlate);
    setCustomPlate(detectedPlate);
    setLookupConfidence(data.confidence ?? null);

    const exactMatch = data.exact || (data.status === 'single_match' ? data.candidate : null);
    const candidateList = data.candidates || (data.candidate ? [data.candidate] : []);

    if (exactMatch) {
      // 1. 완전 일치 차량 존재: 자동 선택 후 Step 2로 즉시 이동
      setSelectedVehicle(exactMatch);
      setIsNewVehicle(false);
      setStep('entry');
    } else if (candidateList.length > 0) {
      // 2. 4자리 일치 후보 차량 존재: 후보 카드 목록 노출
      setCandidates(candidateList);
      setStep('candidates');
    } else {
      // 3. 일치 차량 없음: 신규 등록 분기로 안내
      setSelectedVehicle(null);
      setIsNewVehicle(true);
      setStep('entry');
    }
  };

  // 후보 차량 선택
  const handleSelectCandidate = (cand: VehicleCandidate) => {
    setSelectedVehicle(cand);
    setIsNewVehicle(false);
    setCustomPlate(cand.fullPlate);
    setStep('entry');
  };

  // 신규 차량으로 등록 선택
  const handleRegisterAsNew = () => {
    setSelectedVehicle(null);
    setIsNewVehicle(true);
    setStep('entry');
  };

  // 정비 항목 추가
  const addItem = (preset?: { name: string; unitPrice: number }) => {
    const newItem: ManualOrderItem = {
      id: crypto.randomUUID(),
      name: preset?.name || '신규 정비 항목',
      quantity: 1,
      unitPrice: preset?.unitPrice || 0,
      amount: preset?.unitPrice || 0,
    };
    setItems((prev) => [...prev, newItem]);
  };

  // 정비 항목 수정
  const updateItem = (
    id: string,
    field: keyof ManualOrderItem,
    val: string | number,
  ) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const updated = { ...it, [field]: val };
        if (field === 'quantity' || field === 'unitPrice') {
          updated.amount = Number(updated.quantity || 0) * Number(updated.unitPrice || 0);
        }
        return updated;
      }),
    );
  };

  // 정비 항목 삭제
  const removeItem = (id: string) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  // 전표 최종 제출
  const handleSubmitOrder = async () => {
    setSubmitting(true);
    setSubmitError(null);

    try {
      // PII 마스킹 검증: 신규 입력 시 '*' 차단
      if (isNewVehicle) {
        if (customCustomerName.includes('*')) {
          throw new Error('고객명에 마스킹 문자(*)가 포함되어 있습니다. 실명을 입력하세요.');
        }
        if (customPhone.includes('*')) {
          throw new Error('연락처에 마스킹 문자(*)가 포함되어 있습니다. 원본 번호를 입력하세요.');
        }
        if (customPlate.includes('*')) {
          throw new Error('차량 번호판에 마스킹 문자(*)가 포함되어 있습니다. 정확한 번호판을 입력하세요.');
        }
        if (!customPlate.trim()) {
          throw new Error('차량 번호판을 입력해주세요.');
        }
      }

      if (items.length === 0) {
        throw new Error('최소 1개 이상의 정비 항목이 필요합니다.');
      }

      const payload = {
        idempotencyKey, // 멱등성 방어 키 (재시도 시에도 동일)
        shopId,
        serviceDate,
        serviceType,
        vehicleId: selectedVehicle?.vehicleId,
        customerId: selectedVehicle?.customerId,
        plateText: isNewVehicle ? customPlate.trim() : undefined,
        vehicleModel: isNewVehicle ? customModel.trim() || '차종 미지정' : undefined,
        customerName: isNewVehicle ? customCustomerName.trim() || '현장 수기접수' : undefined,
        phone: isNewVehicle ? customPhone.trim() : undefined,
        items: items.map((it) => ({
          name: it.name.trim(),
          quantity: Number(it.quantity) || 1,
          unitPrice: Number(it.unitPrice) || 0,
          amount: Number(it.amount) || 0,
        })),
        paymentMethod,
        paymentAmount: Number(paymentAmount) || totalAmount,
        paymentNote: paymentNote.trim() || undefined,
        notes: orderNotes.trim() || undefined,
        requestImmediateApproval: Boolean(canDecide && requestImmediateApproval),
      };

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as any;

      if (!res.ok) {
        throw new Error(data.error || '전표 등록에 실패했습니다.');
      }

      // 성공 콜백 호출
      onSuccess(data.orderId, data.status, Boolean(data.duplicate));
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '저장 중 오류가 발생했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm overflow-y-auto">
      <div
        className={`relative w-full max-w-2xl rounded-2xl border shadow-2xl transition-all overflow-hidden my-auto max-h-[92vh] flex flex-col ${
          isEnterprise
            ? 'border-slate-200 bg-white text-slate-900'
            : isIndustrial
              ? 'border-amber-500/40 bg-[#161d28] text-slate-100 shadow-amber-500/10'
              : 'border-slate-800 bg-[#0d131f] text-slate-100'
        }`}
      >
        {/* 모달 상단 헤더 */}
        <div
          className={`flex items-center justify-between border-b p-5 ${
            isEnterprise
              ? 'border-slate-100 bg-slate-50/80'
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
              <ReceiptText size={20} strokeWidth={2.4} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black tracking-tight">현장 수기 정비 접수</h2>
                <span
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                    isEnterprise
                      ? 'bg-blue-100 text-blue-800'
                      : isIndustrial
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'bg-emerald-500/20 text-emerald-300'
                  }`}
                >
                  {step === 'lookup'
                    ? '1단계: 번호판 인식'
                    : step === 'candidates'
                      ? '1-B단계: 후보 차량 선택'
                      : '2단계: 수리내역 및 결제'}
                </span>
              </div>
              <p
                className={`text-xs mt-0.5 ${
                  isEnterprise ? 'text-slate-500' : 'text-slate-400'
                }`}
              >
                번호판 촬영 기반 즉석 전표 발행 · 중복 결제 방어(Idempotent)
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

        {/* 모달 본문 */}
        <div className="p-5 sm:p-6 space-y-6 overflow-y-auto flex-1">
          {/* STEP 1: 번호판 인식 및 검색 */}
          {step === 'lookup' && (
            <div className="space-y-5">
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
                  disabled={lookupLoading}
                  className={`h-12 rounded-xl font-bold flex items-center justify-center gap-2 transition ${
                    isEnterprise
                      ? 'bg-blue-600 hover:bg-blue-500 text-white'
                      : isIndustrial
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black'
                        : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold'
                  }`}
                >
                  <Camera size={18} />
                  <span>카메라로 번호판 촬영</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={lookupLoading}
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
                    alt="촬영된 번호판"
                    className="h-20 w-28 object-cover rounded-lg border border-slate-700 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-400">촬영된 이미지</p>
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
                  >
                    <X size={16} />
                  </button>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  직접 번호판 입력 또는 번호판 뒷자리 (4자리)
                </label>
                <div className="flex gap-2">
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
                  <Button
                    type="button"
                    onClick={() => void handleTextLookup()}
                    disabled={lookupLoading || !plateInput.trim()}
                    className={`h-12 px-5 font-bold shrink-0 ${
                      isIndustrial
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black'
                        : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold'
                    }`}
                  >
                    <Search size={16} className="mr-1" />
                    <span>조회</span>
                  </Button>
                </div>
              </div>

              {lookupLoading && (
                <div className="grid place-items-center py-6">
                  <Spinner className={`h-8 w-8 ${isIndustrial ? 'text-amber-400' : 'text-emerald-400'}`} />
                  <p className="mt-2 text-xs font-bold text-slate-400 animate-pulse">
                    번호판 판독 및 지점 데이터베이스 질의 중...
                  </p>
                </div>
              )}

              {lookupError && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-300 text-xs flex items-center gap-2">
                  <AlertTriangle size={16} className="shrink-0 text-rose-400" />
                  <span>{lookupError}</span>
                </div>
              )}

              <div className="pt-2 border-t border-slate-800">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleRegisterAsNew()}
                  className="w-full text-xs text-slate-400 hover:text-slate-200"
                >
                  번호판 조회 없이 바로 수기 전표 작성하기 →
                </Button>
              </div>
            </div>
          )}

          {/* STEP 1-B: 후보 차량 선택 (작업 3: 4자리 일치 후보 카드 목록) */}
          {step === 'candidates' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-slate-200">
                    일치하는 후보 차량 ({candidates.length}건)
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    번호판 숫자 4자리가 일치하는 등록 차량입니다. 차주와 차종을 확인 후 선택하세요.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep('lookup')}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  다시 검색
                </Button>
              </div>

              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {candidates.map((cand) => (
                  <div
                    key={cand.vehicleId}
                    className={`rounded-xl border p-4 transition flex items-center justify-between gap-3 ${
                      isEnterprise
                        ? 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                        : isIndustrial
                          ? 'border-slate-800 bg-slate-900/60 hover:border-amber-500/40'
                          : 'border-slate-800 bg-slate-950/60 hover:border-emerald-500/40'
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <strong className="text-sm font-extrabold text-slate-100">
                          {cand.customerName}
                        </strong>
                        <span className="text-xs font-mono text-slate-400">{cand.phone}</span>
                        {cand.isFallback && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            3자리 일치
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-300">
                        {cand.model} · <span className="font-mono font-bold text-emerald-400">{cand.fullPlate}</span>
                      </p>
                      <p className="text-[11px] text-slate-500">
                        소속: {cand.shopName || '지점'} · 최근 정비: {cand.lastServiceDate || '기록 없음'}
                      </p>
                    </div>

                    <Button
                      type="button"
                      onClick={() => handleSelectCandidate(cand)}
                      className={`h-9 px-3.5 rounded-lg text-xs font-black shrink-0 ${
                        isIndustrial
                          ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black'
                          : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold'
                      }`}
                    >
                      <Check size={14} className="mr-1" />
                      이 차량 선택
                    </Button>
                  </div>
                ))}
              </div>

              {/* 작업 3 요구사항: '새 차량으로 등록' 버튼은 목록 맨 아래에 두고 기본 선택으로 만들지 않음 */}
              <div className="pt-3 border-t border-slate-800/80">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRegisterAsNew}
                  className={`w-full h-11 rounded-xl text-xs font-bold border-dashed transition ${
                    isEnterprise
                      ? 'border-slate-300 hover:bg-slate-50 text-slate-700'
                      : 'border-slate-700 hover:bg-slate-800 text-slate-300'
                  }`}
                >
                  <Plus size={14} className="mr-1.5" />
                  <span>목록에 없음 — 신규 차량으로 새로 등록하기</span>
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: 수리내역(정비 항목) 및 결제 정보 입력 */}
          {step === 'entry' && (
            <div className="space-y-6">
              {/* 고객 & 차량 요약 카드 */}
              <div
                className={`rounded-xl border p-4 ${
                  isEnterprise
                    ? 'border-slate-200 bg-slate-50'
                    : isIndustrial
                      ? 'border-slate-800 bg-[#0e1420]'
                      : 'border-slate-800 bg-slate-950/80'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    {selectedVehicle ? '기존 등록 고객 차량' : '신규 접수 차량'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setStep('lookup')}
                    className="text-xs text-slate-400 hover:text-white underline"
                  >
                    차량 다시 찾기
                  </button>
                </div>

                {selectedVehicle ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div>
                      <span className="text-slate-500 block">차주</span>
                      <strong className="text-slate-200 font-bold text-sm">
                        {selectedVehicle.customerName}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">연락처</span>
                      <span className="text-slate-300 font-mono">{selectedVehicle.phone}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">차종</span>
                      <span className="text-slate-300 font-bold">{selectedVehicle.model}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 block">번호판</span>
                      <span className="text-emerald-400 font-mono font-black text-sm">
                        {selectedVehicle.fullPlate}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">
                        차량 번호판 <span className="text-rose-400">*</span>
                      </label>
                      <Input
                        value={customPlate}
                        onChange={(e) => setCustomPlate(e.target.value)}
                        placeholder="예: 서울 강남 가 1234"
                        className="h-10 text-xs font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">차종 모델</label>
                      <Input
                        value={customModel}
                        onChange={(e) => setCustomModel(e.target.value)}
                        placeholder="예: 혼다 PCX 125"
                        className="h-10 text-xs font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">차주 성명</label>
                      <Input
                        value={customCustomerName}
                        onChange={(e) => setCustomCustomerName(e.target.value)}
                        placeholder="예: 홍길동 (마스킹 * 금지)"
                        className="h-10 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 block mb-1">연락처</label>
                      <Input
                        value={customPhone}
                        onChange={(e) => setCustomPhone(e.target.value)}
                        placeholder="예: 010-1234-5678 (마스킹 * 금지)"
                        className="h-10 text-xs font-mono"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* 기본 정비 정보: 일자, 지점, 유형 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-400 block mb-1">정비 일자</label>
                  <Input
                    type="date"
                    value={serviceDate}
                    onChange={(e) => setServiceDate(e.target.value)}
                    className="h-10 text-xs font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 block mb-1">정비 지점</label>
                  <select
                    value={shopId}
                    onChange={(e) => setShopId(e.target.value)}
                    className={`w-full h-10 rounded-lg px-3 text-xs font-bold border ${
                      isEnterprise
                        ? 'border-slate-300 bg-white text-slate-900'
                        : 'border-slate-700 bg-slate-900 text-slate-100'
                    }`}
                  >
                    <option value="yongjeon">진바이크 용전센터</option>
                    <option value="jayang">코아바이크 자양센터</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 block mb-1">정비 구분</label>
                  <select
                    value={serviceType}
                    onChange={(e) => setServiceType(e.target.value as any)}
                    className={`w-full h-10 rounded-lg px-3 text-xs font-bold border ${
                      isEnterprise
                        ? 'border-slate-300 bg-white text-slate-900'
                        : 'border-slate-700 bg-slate-900 text-slate-100'
                    }`}
                  >
                    <option value="personal">일반(개인) 정비</option>
                    <option value="rental">렌트 정비</option>
                    <option value="lease">리스 정비</option>
                  </select>
                </div>
              </div>

              {/* 정비 항목 (동적 라인 아이템) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      정비 항목 및 공임 ({items.length}개)
                    </h3>
                  </div>
                  <div className="flex items-center gap-1.5 overflow-x-auto max-w-[280px] sm:max-w-none">
                    <span className="text-[11px] text-slate-500 mr-1 shrink-0">자주 쓰는 항목:</span>
                    {COMMON_SERVICE_ITEMS.slice(0, 3).map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => addItem(preset)}
                        className={`text-[11px] px-2 py-0.5 rounded border shrink-0 transition ${
                          isIndustrial
                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
                            : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
                        }`}
                      >
                        + {preset.name.split(' ')[0]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  {items.map((it, idx) => (
                    <div
                      key={it.id}
                      className={`p-3 rounded-xl border flex flex-wrap sm:flex-nowrap items-center gap-2 ${
                        isEnterprise
                          ? 'border-slate-200 bg-white'
                          : 'border-slate-800 bg-slate-950/40'
                      }`}
                    >
                      <div className="w-6 text-center text-xs font-mono text-slate-500">
                        #{idx + 1}
                      </div>
                      <div className="flex-1 min-w-[140px]">
                        <Input
                          value={it.name}
                          onChange={(e) => updateItem(it.id, 'name', e.target.value)}
                          placeholder="작업 내용 / 부품명"
                          className="h-9 text-xs font-semibold"
                        />
                      </div>
                      <div className="w-16">
                        <Input
                          type="number"
                          min="1"
                          value={it.quantity}
                          onChange={(e) => updateItem(it.id, 'quantity', Number(e.target.value))}
                          placeholder="수량"
                          className="h-9 text-xs text-center font-mono"
                        />
                      </div>
                      <div className="w-24">
                        <Input
                          type="number"
                          step="1000"
                          value={it.unitPrice}
                          onChange={(e) => updateItem(it.id, 'unitPrice', Number(e.target.value))}
                          placeholder="단가"
                          className="h-9 text-xs text-right font-mono"
                        />
                      </div>
                      <div className="w-24 text-right pr-1">
                        <span className="text-xs font-bold font-mono text-slate-200">
                          {Number(it.amount || 0).toLocaleString()}원
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(it.id)}
                        disabled={items.length <= 1}
                        className={`p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-30 disabled:cursor-not-allowed`}
                        title="항목 삭제"
                      >
                        <Trash size={15} />
                      </button>
                    </div>
                  ))}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => addItem()}
                  className="w-full h-9 rounded-xl text-xs font-bold border-dashed border-slate-700 hover:bg-slate-800 text-slate-300"
                >
                  <Plus size={14} className="mr-1" />
                  정비 항목 추가
                </Button>
              </div>

              {/* 결제 정보 및 합계 */}
              <div
                className={`p-4 rounded-xl border space-y-4 ${
                  isEnterprise
                    ? 'border-slate-200 bg-slate-50'
                    : isIndustrial
                      ? 'border-amber-500/30 bg-[#141b26]'
                      : 'border-slate-800 bg-slate-900/50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-400">총 정비 금액</span>
                  <div className="text-right">
                    <strong
                      className={`text-xl font-black font-mono tabular-nums ${
                        isIndustrial ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {totalAmount.toLocaleString()}원
                    </strong>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-400 block mb-1.5">
                      결제 수단
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('card')}
                        className={`h-9 rounded-lg text-xs font-bold border flex items-center justify-center gap-1 transition ${
                          paymentMethod === 'card'
                            ? isIndustrial
                              ? 'border-amber-500 bg-amber-500 text-slate-950 font-black'
                              : 'border-emerald-500 bg-emerald-500 text-slate-950 font-bold'
                            : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        <CreditCard size={13} />
                        <span>카드</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('cash')}
                        className={`h-9 rounded-lg text-xs font-bold border flex items-center justify-center gap-1 transition ${
                          paymentMethod === 'cash'
                            ? isIndustrial
                              ? 'border-amber-500 bg-amber-500 text-slate-950 font-black'
                              : 'border-emerald-500 bg-emerald-500 text-slate-950 font-bold'
                            : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        <Banknote size={13} />
                        <span>현금</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('transfer')}
                        className={`h-9 rounded-lg text-xs font-bold border flex items-center justify-center gap-1 transition ${
                          paymentMethod === 'transfer'
                            ? isIndustrial
                              ? 'border-amber-500 bg-amber-500 text-slate-950 font-black'
                              : 'border-emerald-500 bg-emerald-500 text-slate-950 font-bold'
                            : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        <WalletCards size={13} />
                        <span>이체</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-slate-400 block mb-1.5">
                      수납 금액
                    </label>
                    <Input
                      type="number"
                      step="1000"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(Number(e.target.value))}
                      className="h-9 text-xs font-mono font-bold text-right"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-400 block mb-1">
                    정비 메모 / 특이사항
                  </label>
                  <Input
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="고객 요청사항 또는 정비 특이사항 메모"
                    className="h-9 text-xs"
                  />
                </div>

                {/* 즉시 승인 옵션 (관리자/지점장 권한자 전용) */}
                {canDecide ? (
                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-xs font-bold text-slate-200">즉시 승인 및 매출 반영</span>
                      <p className="text-[11px] text-slate-400">
                        체크 시 검수 대기를 건너뛰고 즉시 승인 완료 상태로 저장됩니다.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={requestImmediateApproval}
                      onChange={(e) => setRequestImmediateApproval(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-700 text-amber-500 focus:ring-amber-400"
                    />
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    ℹ️ 기본적으로 <strong>[검수 대기]</strong> 상태로 등록되며, 매니저 승인 후 매출에 반영됩니다.
                  </p>
                )}
              </div>

              {submitError && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-rose-300 text-xs flex items-center gap-2">
                  <AlertTriangle size={16} className="shrink-0 text-rose-400" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* 제출 버튼 */}
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep('lookup')}
                  disabled={submitting}
                  className="h-12 px-5 rounded-xl text-xs font-bold border-slate-700 hover:bg-slate-800 text-slate-300"
                >
                  이전으로
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleSubmitOrder()}
                  disabled={submitting || totalAmount <= 0}
                  className={`flex-1 h-12 rounded-xl text-sm font-black flex items-center justify-center gap-2 transition ${
                    isEnterprise
                      ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-md'
                      : isIndustrial
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-md'
                        : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold'
                  }`}
                >
                  {submitting ? (
                    <>
                      <Spinner className="h-4 w-4" />
                      <span>원자적 전표 커밋 중...</span>
                    </>
                  ) : (
                    <>
                      <Check size={18} strokeWidth={3} />
                      <span>
                        {requestImmediateApproval
                          ? '정비 전표 즉시 승인 등록'
                          : '정비 전표 등록 (검수 대기)'}
                      </span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* 모달 하단 보안 푸터 */}
        <div
          className={`flex items-center justify-between border-t p-3.5 px-6 text-[11px] font-mono ${
            isEnterprise
              ? 'border-slate-100 bg-slate-50 text-slate-500'
              : 'border-slate-800/80 bg-slate-950/80 text-slate-400'
          }`}
        >
          <span>멱등성 식별키: {idempotencyKey.slice(0, 8)}...</span>
          <span>D1 Batch 원자적 트랜잭션 보장</span>
        </div>
      </div>
    </div>
  );
}
