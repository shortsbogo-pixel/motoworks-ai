export const REFERENCE_DATA = {
  shops: [
    { id: 'shop-yongjeon', name: '진바이크 용전점', code: 'YJ' },
    { id: 'shop-jayang', name: '코아바이크 자양점', code: 'JY' },
  ],
  paymentMethods: [
    { id: 'card', label: '카드' },
    { id: 'cash', label: '현금' },
    { id: 'transfer', label: '이체' },
    { id: 'rental_billing', label: '렌트업체 청구' },
  ],
  vehicleManufacturers: ['혼다', '야마하', '스즈키', 'SYM', '대림', 'KR모터스'],
  vehicleAliases: [
    { alias: 'PCX', candidates: ['PCX 125', 'PCX 160'], autoConfirm: false },
    {
      alias: '엔맥스',
      candidates: ['NMAX 125', 'NMAX 155'],
      autoConfirm: false,
    },
    {
      alias: '보이져',
      candidates: ['보이저 125', '보이저 300'],
      autoConfirm: false,
    },
  ],
  autoRegister: {
    requiredFieldConfidence: 0.96,
    requireBalancedPayment: true,
    requireConfirmedShop: true,
    blockDuplicateCandidates: true,
    blockPersonalZeroAmount: true,
  },
} as const;
