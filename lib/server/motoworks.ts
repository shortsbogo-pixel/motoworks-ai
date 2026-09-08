import type { GeminiExtraction } from '@/lib/gemini';

export type MotoworksEnv = {
  DB: D1Database;
  FILES: R2Bucket;
  BOOTSTRAP_OWNER_EMAIL?: string;
  DATA_ENCRYPTION_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_VISION_MODEL?: string;
  GEMINI_PLATE_MODEL?: string;
  GEMINI_BASE_URL?: string;
  PLATE_HASH_SECRET?: string;
  SESSION_SECRET?: string;
};

export type Permission =
  | 'view'
  | 'upload'
  | 'edit_extraction'
  | 'review_decide'
  | 'settlement_manage'
  | 'excel_import'
  | 'excel_export'
  | 'view_pii'
  | 'manage_users'
  | 'view_audit';

export const ALL_PERMISSIONS: Permission[] = [
  'view',
  'upload',
  'edit_extraction',
  'review_decide',
  'settlement_manage',
  'excel_import',
  'excel_export',
  'view_pii',
  'manage_users',
  'view_audit',
];

export const ROLE_DEFAULT_PERMISSIONS: Record<string, Permission[]> = {
  admin: [...ALL_PERMISSIONS],
  shop_manager: [
    'view',
    'upload',
    'edit_extraction',
    'review_decide',
    'settlement_manage',
    'excel_export',
    'view_audit',
  ],
  staff: ['view', 'upload', 'edit_extraction'],
  viewer: ['view'],
};

export type AuthorizedUser = {
  id: string;
  externalId: string;
  email: string;
  displayName: string;
  isOwner: boolean;
  status: 'pending' | 'active' | 'suspended';
  roles: Array<{
    shopId: string | null;
    role: string;
    roleId?: string | null;
    permissions: Permission[];
  }>;
};

export const ORGANIZATION_ID = 'core-partners';
export const SHOP_NAMES: Record<string, string> = {
  yongjeon: '진바이크 용전센터',
  jayang: '코아바이크 자양센터',
};

export const SENSITIVE_FIELDS = new Set([
  'customer_name',
  'phone',
  'vehicle_plate',
]);

export function hasPermission(
  user: AuthorizedUser,
  permission: Permission,
  shopId?: string | null,
): boolean {
  if (user.status !== 'active') return false;
  if (user.isOwner) return true;

  return user.roles.some((r) => {
    const shopMatches = !shopId || r.shopId === null || r.shopId === shopId;
    return shopMatches && r.permissions.includes(permission);
  });
}

export function getAllowedShops(
  user: AuthorizedUser,
  permission: Permission = 'view',
): string[] {
  if (user.status !== 'active') return [];
  if (user.isOwner) return Object.keys(SHOP_NAMES);

  const allowed = new Set<string>();
  for (const r of user.roles) {
    if (r.permissions.includes(permission)) {
      if (r.shopId === null) {
        return Object.keys(SHOP_NAMES);
      }
      allowed.add(r.shopId);
    }
  }
  return Array.from(allowed);
}

// ============================================================================
// 보안 암호화 & 세션 토큰 유틸리티 (Web Crypto API 기반, Node/Workers 호환)
// ============================================================================

/**
 * 상수 시간 바이트 배열 비교 (타이밍 공격 방지)
 * W3C Web Cryptography API 명세에 제외되어 있으므로 비트 XOR 누적 방식으로 구현
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i] ^ b[i];
  }
  return mismatch === 0;
}

/**
 * 표준 PBKDF2-HMAC-SHA256 (100,000회 반복, 16바이트 솔트) 비밀번호 해싱
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    passwordKey,
    256,
  );
  const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(derivedBits), (b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:sha256:100000:${saltHex}:${hashHex}`;
}

/**
 * PBKDF2 해시 검증 (상수 시간 비교 적용)
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') {
    return false;
  }
  const iterations = parseInt(parts[2], 10);
  const saltHex = parts[3];
  const targetHashHex = parts[4];
  if (isNaN(iterations) || !saltHex || !targetHashHex) {
    return false;
  }

  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []);
  const targetBytes = new Uint8Array(targetHashHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []);

  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    targetBytes.length * 8,
  );
  const derivedBytes = new Uint8Array(derivedBits);

  return timingSafeEqual(derivedBytes, targetBytes);
}

export type SessionPayload = {
  userId: string;
  email: string;
  iat: number;
  exp: number;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/**
 * HMAC-SHA256 기반 위조 방지 세션 토큰 생성 (기본 12시간 유효)
 */
export async function createSessionToken(
  payload: { userId: string; email: string },
  secret: string,
  expiresInSeconds: number = 12 * 3600, // 12시간 (현장 교대 근무 보장)
): Promise<string> {
  const now = Date.now();
  const fullPayload: SessionPayload = {
    userId: payload.userId,
    email: payload.email,
    iat: now,
    exp: now + expiresInSeconds * 1000,
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(fullPayload));
  const payloadPart = base64UrlEncode(payloadBytes);

  const key = await getHmacKey(secret);
  const sigBytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart)),
  );
  const sigPart = base64UrlEncode(sigBytes);

  return `${payloadPart}.${sigPart}`;
}

/**
 * HMAC-SHA256 세션 토큰 검증 (서명 불일치 또는 만료 시 null 반환)
 */
export async function verifySessionToken(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadPart, sigPart] = parts;

    const key = await getHmacKey(secret);
    const expectedSig = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadPart)),
    );
    const providedSig = base64UrlDecode(sigPart);

    if (!timingSafeEqual(expectedSig, providedSig)) {
      return null;
    }

    const payloadJson = new TextDecoder().decode(base64UrlDecode(payloadPart));
    const payload = JSON.parse(payloadJson) as SessionPayload;

    if (!payload.userId || !payload.email || !payload.exp) {
      return null;
    }

    if (Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

// ============================================================================
// 로그인 전용 무차별 대입 방지 Rate Limit (5회 실패 시 15분 차단)
// ============================================================================

export async function checkLoginRateLimit(
  runtime: MotoworksEnv,
  email: string,
): Promise<{ allowed: boolean; retryAfterSeconds?: number; reason?: string }> {
  const now = Date.now();
  const key = `login:${email.toLowerCase()}`;

  const row = await runtime.DB.prepare(
    `SELECT consecutive_no_match, blocked_until FROM security_rate_limits WHERE key = ?1`,
  )
    .bind(key)
    .first<{ consecutive_no_match: number; blocked_until: number }>();

  if (row && row.blocked_until > now) {
    const remainingSeconds = Math.ceil((row.blocked_until - now) / 1000);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(remainingSeconds, 1),
      reason: `연속된 로그인 실패(5회 이상)로 계정이 일시 잠금되었습니다. ${remainingSeconds}초 후 다시 시도하세요.`,
    };
  }

  return { allowed: true };
}

export async function recordLoginFailure(
  runtime: MotoworksEnv,
  email: string,
): Promise<{ consecutiveFailures: number; isBlocked: boolean }> {
  const now = Date.now();
  const cooldownPeriodMs = 15 * 60 * 1000; // 15분 차단
  const blockedUntil = now + cooldownPeriodMs;
  const key = `login:${email.toLowerCase()}`;

  await runtime.DB.prepare(
    `INSERT INTO security_rate_limits (key, request_count, window_start, consecutive_no_match, blocked_until, updated_at)
     VALUES (?1, 1, ?2, 1, 0, ?2)
     ON CONFLICT (key) DO UPDATE SET
       consecutive_no_match = consecutive_no_match + 1,
       blocked_until = CASE WHEN consecutive_no_match + 1 >= 5 THEN ?3 ELSE 0 END,
       updated_at = ?2`,
  )
    .bind(key, now, blockedUntil)
    .run();

  const current = await runtime.DB.prepare(
    `SELECT consecutive_no_match, blocked_until FROM security_rate_limits WHERE key = ?1`,
  )
    .bind(key)
    .first<{ consecutive_no_match: number; blocked_until: number }>();

  const failures = current?.consecutive_no_match ?? 1;
  const isBlocked = (current?.blocked_until ?? 0) > now;
  return { consecutiveFailures: failures, isBlocked };
}

export async function resetLoginFailure(
  runtime: MotoworksEnv,
  email: string,
): Promise<void> {
  const now = Date.now();
  const key = `login:${email.toLowerCase()}`;

  await runtime.DB.prepare(
    `UPDATE security_rate_limits
        SET consecutive_no_match = 0,
            blocked_until = 0,
            updated_at = ?1
      WHERE key = ?2`,
  )
    .bind(now, key)
    .run();
}

// ============================================================================
// 사용자 인증 및 권한 검증 (헤더 우회 완전 차단, HMAC 세션 쿠키 필수)
// ============================================================================

export async function requireAuthorizedUser(
  request: Request,
  env: MotoworksEnv,
  shopId?: string,
): Promise<AuthorizedUser> {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)motoworks_session=([^;]+)/);
  if (!match) {
    throw new HttpError(401, '로그인이 필요합니다. 유효한 세션 쿠키가 제공되지 않았습니다.');
  }

  const token = decodeURIComponent(match[1].trim());
  const sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new HttpError(500, '서버에 SESSION_SECRET이 설정되지 않았습니다.');
  }

  const payload = await verifySessionToken(token, sessionSecret);
  if (!payload) {
    throw new HttpError(401, '세션이 만료되었거나 유효하지 않습니다. 다시 로그인해주세요.');
  }

  const userRow = await env.DB.prepare(
    `SELECT id, external_user_id, email, display_name, status FROM users WHERE id = ?1 AND organization_id = ?2 LIMIT 1`,
  )
    .bind(payload.userId, ORGANIZATION_ID)
    .first<{
      id: string;
      external_user_id: string;
      email: string;
      display_name: string | null;
      status: 'pending' | 'active' | 'suspended';
    }>();

  if (!userRow) {
    throw new HttpError(401, '등록되지 않은 사용자입니다.');
  }

  if (userRow.status === 'pending') {
    throw new HttpError(403, '계정 승인 대기 중입니다. 관리자의 승인이 필요합니다.');
  }
  if (userRow.status === 'suspended') {
    throw new HttpError(403, '비활성화된 계정입니다.');
  }

  const ownerEmail = (env.BOOTSTRAP_OWNER_EMAIL || 'shortsbogo@gmail.com').toLowerCase();
  const isOwner = userRow.email.toLowerCase() === ownerEmail;

  const roleRows = await env.DB.prepare(
    `SELECT usr.shop_id, usr.role, usr.role_id, r.permissions_json
       FROM user_shop_roles usr
       LEFT JOIN roles r ON r.id = usr.role_id
      WHERE usr.user_id = ?1 AND usr.organization_id = ?2`,
  )
    .bind(userRow.id, ORGANIZATION_ID)
    .all<{
      shop_id: string | null;
      role: string;
      role_id: string | null;
      permissions_json: string | null;
    }>();

  const roles = roleRows.results.map((row) => {
    let permissions: Permission[] = [];
    if (row.permissions_json) {
      try {
        permissions = JSON.parse(row.permissions_json);
      } catch {
        permissions = ROLE_DEFAULT_PERMISSIONS[row.role] || [];
      }
    } else {
      permissions = ROLE_DEFAULT_PERMISSIONS[row.role] || [];
    }
    return {
      shopId: row.shop_id,
      role: row.role,
      roleId: row.role_id,
      permissions,
    };
  });

  const user: AuthorizedUser = {
    id: userRow.id,
    externalId: userRow.external_user_id,
    email: userRow.email,
    displayName: userRow.display_name || userRow.email,
    isOwner,
    status: userRow.status,
    roles,
  };

  if (shopId && !hasPermission(user, 'view', shopId)) {
    throw new HttpError(403, '이 센터에 대한 권한이 없습니다.');
  }

  return user;
}

export async function requirePermission(
  request: Request,
  env: MotoworksEnv,
  permission: Permission,
  shopId?: string | null,
): Promise<AuthorizedUser> {
  const user = await requireAuthorizedUser(request, env);
  if (user.status === 'pending') {
    throw new HttpError(403, '계정 승인 대기 중입니다. 관리자의 승인이 필요합니다.');
  }
  if (user.status === 'suspended') {
    throw new HttpError(403, '비활성화된 계정입니다.');
  }
  if (!hasPermission(user, permission, shopId)) {
    throw new HttpError(403, `해당 작업(${permission})에 대한 권한이 없습니다.`);
  }
  return user;
}

export async function ensureBaseSeed(
  env: MotoworksEnv,
  user: {
    id: string;
    externalId: string;
    email: string;
    displayName: string;
    isOwner: boolean;
  },
) {
  const now = Date.now();
  const queries = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO organizations (id, name, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?3)`,
    ).bind(ORGANIZATION_ID, '코아파트너스', now),
    ...Object.entries(SHOP_NAMES).map(([id, name]) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO shops
           (id, organization_id, code, name, active, created_at, updated_at)
         VALUES (?1, ?2, ?1, ?3, 1, ?4, ?4)`,
      ).bind(id, ORGANIZATION_ID, name, now),
    ),
    // 기본 역할 4개 시드
    ...Object.entries(ROLE_DEFAULT_PERMISSIONS).map(([roleKey, perms]) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO roles
           (id, organization_id, name, description, permissions_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
      ).bind(
        `role:${roleKey}`,
        ORGANIZATION_ID,
        roleKey === 'admin'
          ? '조직 관리자'
          : roleKey === 'shop_manager'
            ? '지점 관리자'
            : roleKey === 'staff'
              ? '직원'
              : '열람자',
        `${roleKey} 기본 권한 그룹`,
        JSON.stringify(perms),
        now,
      ),
    ),
  ];

  if (user.isOwner) {
    // 최초 관리자는 active 상태 및 전체 admin 권한 부여
    queries.push(
      env.DB.prepare(
        `INSERT INTO users
           (id, organization_id, external_user_id, email, display_name, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)
         ON CONFLICT (external_user_id) DO UPDATE SET status = 'active', display_name = ?5, updated_at = ?6`,
      ).bind(user.id, ORGANIZATION_ID, user.externalId ?? null, user.email, user.displayName, now),
      env.DB.prepare(
        `INSERT OR IGNORE INTO user_shop_roles
           (id, organization_id, user_id, shop_id, role, role_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, NULL, 'admin', 'role:admin', ?4, ?4)`,
      ).bind(`owner-role:${user.externalId ?? user.id}`, ORGANIZATION_ID, user.id, now),
    );
  } else {
    // 일반 신규 사용자는 pending 상태로 생성 (역할 부여 없음)
    queries.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO users
           (id, organization_id, external_user_id, email, display_name, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?6)`,
      ).bind(user.id, ORGANIZATION_ID, user.externalId ?? null, user.email, user.displayName, now),
    );
  }

  await env.DB.batch(queries);
}

export function maskName(name: string): string {
  if (!name || name.length <= 1) return name;
  if (name.length === 2) return `${name[0]}*`;
  return `${name[0]}${'*'.repeat(Math.max(1, name.length - 2))}${name[name.length - 1]}`;
}

export function maskPhone(phone: string): string {
  if (!phone) return phone;
  return phone.replace(/(\d{2,3})[- ]?(\d{3,4})[- ]?(\d{4})/, '$1-****-$3');
}

export function maskPlate(plate: string): string {
  if (!plate) return plate;
  return plate.replace(/\d{4}$/, '****');
}

export async function protectExtraction(
  extraction: GeminiExtraction,
  secret?: string,
): Promise<GeminiExtraction> {
  if (!secret) {
    throw new HttpError(500, 'DATA_ENCRYPTION_KEY가 누락되어 개인정보(고객명/연락처/차량번호) 암호화 처리가 불가능합니다. 저장을 중단합니다.');
  }

  return {
    ...extraction,
    fields: await Promise.all(
      extraction.fields.map(async (field) => {
        if (!SENSITIVE_FIELDS.has(field.key)) return field;
        return {
          ...field,
          raw_value:
            field.raw_value === null
              ? null
              : await encryptValue(String(field.raw_value), secret),
          normalized_value:
            field.normalized_value === null
              ? null
              : await encryptValue(String(field.normalized_value), secret),
        };
      }),
    ),
  };
}

export async function revealExtraction(
  extraction: GeminiExtraction,
  secret?: string,
  canViewPii = true,
): Promise<GeminiExtraction> {
  return {
    ...extraction,
    fields: await Promise.all(
      extraction.fields.map(async (field) => {
        if (!SENSITIVE_FIELDS.has(field.key)) return field;
        if (!secret) return field;

        const decryptedRaw =
          typeof field.raw_value === 'string'
            ? await decryptValue(field.raw_value, secret)
            : field.raw_value;
        const decryptedNormalized =
          typeof field.normalized_value === 'string'
            ? await decryptValue(field.normalized_value, secret)
            : field.normalized_value;

        if (canViewPii) {
          return {
            ...field,
            raw_value: decryptedRaw,
            normalized_value: decryptedNormalized,
          };
        }

        // view_pii 권한 미보유 시 마스킹 적용
        let maskedRaw = decryptedRaw;
        let maskedNormalized = decryptedNormalized;
        if (field.key === 'customer_name') {
          maskedRaw = typeof decryptedRaw === 'string' ? maskName(decryptedRaw) : decryptedRaw;
          maskedNormalized = typeof decryptedNormalized === 'string' ? maskName(decryptedNormalized) : decryptedNormalized;
        } else if (field.key === 'phone') {
          maskedRaw = typeof decryptedRaw === 'string' ? maskPhone(decryptedRaw) : decryptedRaw;
          maskedNormalized = typeof decryptedNormalized === 'string' ? maskPhone(decryptedNormalized) : decryptedNormalized;
        } else if (field.key === 'vehicle_plate') {
          maskedRaw = typeof decryptedRaw === 'string' ? maskPlate(decryptedRaw) : decryptedRaw;
          maskedNormalized = typeof decryptedNormalized === 'string' ? maskPlate(decryptedNormalized) : decryptedNormalized;
        }

        return {
          ...field,
          raw_value: maskedRaw,
          normalized_value: maskedNormalized,
        };
      }),
    ),
  };
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  const status = error instanceof HttpError ? error.status : 500;
  const message =
    error instanceof Error ? error.message : '요청을 처리하지 못했습니다.';
  return Response.json(
    { error: status === 500 ? `서버 처리 중 오류가 발생했습니다: ${message}` : message },
    { status },
  );
}

export async function encryptValue(value: string, secret: string) {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value),
  );
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipher))}`;
}

export async function decryptValue(value: string, secret: string) {
  if (!value || !value.startsWith('v1:')) return value;
  const parts = value.split(':');
  if (parts.length !== 3) return value;
  const [, ivText, cipherText] = parts;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(ivText) },
      await importKey(secret),
      base64ToBytes(cipherText),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return '';
  }
}

export async function hashPii(value: string): Promise<string> {
  const normalized = value.replace(/\s+/g, '').trim().toLowerCase();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalized),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function importKey(secret: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export function assertServerEnvironment(runtime: MotoworksEnv) {
  const secret = runtime.PLATE_HASH_SECRET;
  if (!secret || secret.trim().length < 16) {
    console.error('[FATAL] PLATE_HASH_SECRET이 미설정되었거나 16자 미만입니다.');
    throw new HttpError(
      503,
      '서버 보안 설정(PLATE_HASH_SECRET)이 누락되어 번호판 조회 서비스를 이용할 수 없습니다.',
    );
  }
  const sessionSecret = runtime.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.trim().length < 16) {
    console.error('[FATAL] SESSION_SECRET이 미설정되었거나 16자 미만입니다.');
    throw new HttpError(
      503,
      '서버 보안 설정(SESSION_SECRET)이 누락되어 세션 인증을 진행할 수 없습니다.',
    );
  }
}

export function extractPlateDigits(plate: string): string {
  const cleaned = plate.replace(/[^\d]/g, '');
  if (!cleaned) return '';
  // 뒤에서부터 최대 4자리 (3자리 이하는 원형 보존)
  return cleaned.length > 4 ? cleaned.slice(-4) : cleaned;
}

export async function hashPlateDigits(digits: string, secret: string): Promise<string> {
  if (!secret) {
    throw new Error('[FATAL] PLATE_HASH_SECRET이 누락되었습니다.');
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(digits));
  return [...new Uint8Array(signature)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function checkPlateLookupRateLimit(
  runtime: MotoworksEnv,
  ip: string,
  organizationId: string,
): Promise<{ allowed: boolean; retryAfterSeconds?: number; reason?: string }> {
  const now = Date.now();
  const windowSizeMs = 60 * 1000; // 1분
  const windowBoundary = now - windowSizeMs;
  const keySource = `${ip}:${organizationId}`;
  const key = await hashPii(keySource);

  // 1. 잠금(blocked_until) 상태 확인
  const existing = await runtime.DB.prepare(
    `SELECT request_count, window_start, consecutive_no_match, blocked_until
       FROM security_rate_limits
      WHERE key = ?1`,
  )
    .bind(key)
    .first<{
      request_count: number;
      window_start: number;
      consecutive_no_match: number;
      blocked_until: number;
    }>();

  if (existing && existing.blocked_until > now) {
    const remainingSeconds = Math.ceil((existing.blocked_until - now) / 1000);
    return {
      allowed: false,
      retryAfterSeconds: remainingSeconds,
      reason: `연속 조회 실패(no_match) 5회 초과로 인해 15분간 조회가 일시 차단되었습니다. ${remainingSeconds}초 후 다시 시도하세요.`,
    };
  }

  // 2. 단일 원자적 UPSERT 문으로 카운터 증가
  await runtime.DB.prepare(
    `INSERT INTO security_rate_limits
       (key, request_count, window_start, consecutive_no_match, blocked_until, updated_at)
     VALUES (?1, 1, ?2, 0, 0, ?2)
     ON CONFLICT(key) DO UPDATE SET
       request_count = CASE WHEN window_start < ?3 THEN 1 ELSE request_count + 1 END,
       window_start = CASE WHEN window_start < ?3 THEN ?2 ELSE window_start END,
       updated_at = ?2`,
  )
    .bind(key, now, windowBoundary)
    .run();

  // 3. 업데이트 후의 현재 request_count 조회 및 분당 20회 초과 여부 확인
  const current = await runtime.DB.prepare(
    `SELECT request_count, window_start
       FROM security_rate_limits
      WHERE key = ?1`,
  )
    .bind(key)
    .first<{ request_count: number; window_start: number }>();

  if (current && current.request_count > 20) {
    const remainingSeconds = Math.ceil((current.window_start + windowSizeMs - now) / 1000);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(remainingSeconds, 1),
      reason: `번호판 조회 요청 한도(분당 20회)를 초과했습니다. ${remainingSeconds}초 후 다시 시도하세요.`,
    };
  }

  // 4. 만료 행 누적 방지: 5% 확률로 1시간 이상 비활성된 만료 행 자동 정리 (Lazy Purge)
  if (Math.random() < 0.05) {
    void purgeExpiredRateLimits(runtime).catch(() => {});
  }

  return { allowed: true };
}

export async function purgeExpiredRateLimits(
  runtime: MotoworksEnv,
  olderThanMs: number = 3600 * 1000,
): Promise<number> {
  const now = Date.now();
  const threshold = now - olderThanMs;
  // 1시간 이상 갱신이 없고 현재 잠금 중이 아닌 만료 행 일괄 삭제
  const result = await runtime.DB.prepare(
    `DELETE FROM security_rate_limits
      WHERE updated_at < ?1 AND blocked_until <= ?2`,
  )
    .bind(threshold, now)
    .run();
  return result.meta?.changes ?? 0;
}

export async function recordLookupNoMatch(
  runtime: MotoworksEnv,
  ip: string,
  organizationId: string,
): Promise<{ consecutiveNoMatch: number; isBlocked: boolean }> {
  const now = Date.now();
  const cooldownPeriodMs = 15 * 60 * 1000; // 15분 쿨다운
  const blockedUntil = now + cooldownPeriodMs;
  const keySource = `${ip}:${organizationId}`;
  const key = await hashPii(keySource);

  await runtime.DB.prepare(
    `UPDATE security_rate_limits
        SET consecutive_no_match = consecutive_no_match + 1,
            blocked_until = CASE WHEN consecutive_no_match + 1 >= 5 THEN ?1 ELSE 0 END,
            updated_at = ?2
      WHERE key = ?3`,
  )
    .bind(blockedUntil, now, key)
    .run();

  const current = await runtime.DB.prepare(
    `SELECT consecutive_no_match, blocked_until
       FROM security_rate_limits
      WHERE key = ?1`,
  )
    .bind(key)
    .first<{ consecutive_no_match: number; blocked_until: number }>();

  const consecutive = current?.consecutive_no_match ?? 1;
  const isBlocked = (current?.blocked_until ?? 0) > now;
  return { consecutiveNoMatch: consecutive, isBlocked };
}

export async function resetLookupNoMatch(
  runtime: MotoworksEnv,
  ip: string,
  organizationId: string,
): Promise<void> {
  const now = Date.now();
  const keySource = `${ip}:${organizationId}`;
  const key = await hashPii(keySource);

  await runtime.DB.prepare(
    `UPDATE security_rate_limits
        SET consecutive_no_match = 0,
            updated_at = ?1
      WHERE key = ?2`,
  )
    .bind(now, key)
    .run();
}

export async function logSecurityAudit(
  runtime: MotoworksEnv,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  details: unknown,
  request: Request,
) {
  try {
    await runtime.DB.prepare(
      `INSERT INTO audit_logs
         (id, organization_id, shop_id, actor_user_id, action, entity_type, entity_id, after_json, user_agent, created_at)
       VALUES (?1, ?2, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
    )
      .bind(
        `audit:${crypto.randomUUID()}`,
        ORGANIZATION_ID,
        actorUserId,
        action,
        entityType,
        entityId,
        JSON.stringify(details),
        request.headers.get('user-agent'),
        Date.now(),
      )
      .run();
  } catch (err) {
    console.error('Security audit log failed:', err);
  }
}

