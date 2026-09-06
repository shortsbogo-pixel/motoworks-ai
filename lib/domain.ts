export type Certainty = 'confirmed' | 'ai_estimated' | 'unknown';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export type ValidationStatus = 'valid' | 'review' | 'conflict';

export type ExtractedField = {
  id: string;
  key: string;
  label: string;
  rawValue: string;
  normalizedValue: string;
  correctedValue?: string;
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number };
  validationStatus: ValidationStatus;
  validationMessage?: string;
};

export type ReviewDocument = {
  id: string;
  fileName: string;
  shopName: string;
  shopCertainty: Certainty;
  customerName: string;
  vehicleLabel: string;
  amount: number;
  status: ReviewStatus;
  sourceAvailable: boolean;
  sourceUrl?: string;
  duplicateCandidate: boolean;
  fields: ExtractedField[];
};

export type AutoRegisterInput = {
  requiredConfidences: number[];
  itemTotal: number;
  paymentTotal: number;
  shopCertainty: Certainty;
  identifiable: boolean;
  vehicleConflict: boolean;
  duplicateCandidate: boolean;
  serviceType: 'personal' | 'rental';
  customerPaidAmount: number;
};

export type AutoRegisterResult = {
  eligible: boolean;
  reasons: string[];
};

export const DEFAULT_AUTO_REGISTER_THRESHOLD = 0.96;

export function evaluateAutoRegistration(
  input: AutoRegisterInput,
  threshold = DEFAULT_AUTO_REGISTER_THRESHOLD,
): AutoRegisterResult {
  const reasons: string[] = [];
  if (input.requiredConfidences.some((value) => value < threshold)) {
    reasons.push(`필수 필드 신뢰도 ${Math.round(threshold * 100)}% 미만`);
  }
  if (input.itemTotal !== input.paymentTotal)
    reasons.push('작업 합계와 결제 합계 불일치');
  if (input.shopCertainty !== 'confirmed') reasons.push('매장 미확정');
  if (!input.identifiable) reasons.push('고객 또는 차량 식별 불가');
  if (input.vehicleConflict) reasons.push('기존 차량 정보 충돌');
  if (input.duplicateCandidate) reasons.push('중복 후보 존재');
  if (input.serviceType === 'personal' && input.customerPaidAmount === 0) {
    reasons.push('개인 정비 0원');
  }
  return { eligible: reasons.length === 0, reasons };
}

export function shouldHighlightField(
  field: ExtractedField,
  threshold = DEFAULT_AUTO_REGISTER_THRESHOLD,
) {
  return field.confidence < threshold || field.validationStatus !== 'valid';
}

export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11)
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10)
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return value.trim();
}

export function buildDuplicateFingerprint(parts: {
  imageHash: string;
  batchId: string;
  shopId: string;
  vehiclePlate: string;
  items: Array<{ name: string; amount: number }>;
}) {
  const items = [...parts.items]
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    .map((item) => `${item.name}:${item.amount}`)
    .join('|');
  return [
    parts.imageHash,
    parts.batchId,
    parts.shopId,
    parts.vehiclePlate,
    items,
  ].join('::');
}
