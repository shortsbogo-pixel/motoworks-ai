import type { GeminiExtraction } from '@/lib/gemini';

export type MotoworksEnv = {
  DB: D1Database;
  FILES: R2Bucket;
  BOOTSTRAP_OWNER_EMAIL?: string;
  DATA_ENCRYPTION_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_VISION_MODEL?: string;
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

export async function requireAuthorizedUser(
  request: Request,
  env: MotoworksEnv,
  shopId?: string,
): Promise<AuthorizedUser> {
  let externalId = request.headers.get('oai-authenticated-user-id');
  let email = request.headers.get('oai-authenticated-user-email')?.toLowerCase();
  let displayName = decodeDisplayName(request);

  // 로컬 개발 및 테스트 환경 지원 (개발 모드에서만 명시적 헤더 또는 기본값 허용)
  const isDev = process.env.NODE_ENV !== 'production';
  if ((!externalId || !email) && isDev) {
    const devEmail = request.headers.get('x-motoworks-dev-email')?.toLowerCase();
    const devId = request.headers.get('x-motoworks-dev-id');
    const devName = request.headers.get('x-motoworks-dev-name');
    if (devEmail) {
      email = devEmail;
      externalId = devId || `dev:${devEmail}`;
      displayName = devName || devEmail;
    } else {
      // 로컬 개발 기본 시뮬레이션: 최초 관리자
      const ownerEmail = (env.BOOTSTRAP_OWNER_EMAIL || 'shortsbogo@gmail.com').toLowerCase();
      email = ownerEmail;
      externalId = `owner:${ownerEmail}`;
      displayName = '최초 관리자';
    }
  }

  if (!externalId || !email) throw new HttpError(401, '로그인이 필요합니다.');
  const ownerEmail = (env.BOOTSTRAP_OWNER_EMAIL || 'shortsbogo@gmail.com').toLowerCase();
  const isOwner = email === ownerEmail;
  const id = `user:${externalId}`;
  displayName = displayName || email;

  // DB 기본 구조 및 사용자 시드 보장
  await ensureBaseSeed(env, { id, externalId, email, displayName, isOwner });

  const userRow = await env.DB.prepare(
    `SELECT id, email, display_name, status FROM users WHERE external_user_id = ?1 AND organization_id = ?2 LIMIT 1`,
  )
    .bind(externalId, ORGANIZATION_ID)
    .first<{
      id: string;
      email: string;
      display_name: string | null;
      status: 'pending' | 'active' | 'suspended';
    }>();

  if (!userRow) {
    throw new HttpError(401, '등록되지 않은 사용자입니다.');
  }

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
    externalId,
    email: userRow.email,
    displayName: userRow.display_name || userRow.email,
    isOwner,
    status: userRow.status,
    roles,
  };

  if (user.status === 'pending') {
    throw new HttpError(403, '계정 승인 대기 중입니다. 관리자의 승인이 필요합니다.');
  }
  if (user.status === 'suspended') {
    throw new HttpError(403, '비활성화된 계정입니다.');
  }
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
      ).bind(user.id, ORGANIZATION_ID, user.externalId, user.email, user.displayName, now),
      env.DB.prepare(
        `INSERT OR IGNORE INTO user_shop_roles
           (id, organization_id, user_id, shop_id, role, role_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, NULL, 'admin', 'role:admin', ?4, ?4)`,
      ).bind(`owner-role:${user.externalId}`, ORGANIZATION_ID, user.id, now),
    );
  } else {
    // 일반 신규 사용자는 pending 상태로 생성 (역할 부여 없음)
    queries.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO users
           (id, organization_id, external_user_id, email, display_name, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?6)`,
      ).bind(user.id, ORGANIZATION_ID, user.externalId, user.email, user.displayName, now),
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

function decodeDisplayName(request: Request) {
  if (
    request.headers.get('oai-authenticated-user-full-name-encoding') !==
    'percent-encoded-utf-8'
  )
    return null;
  const value = request.headers.get('oai-authenticated-user-full-name');
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
