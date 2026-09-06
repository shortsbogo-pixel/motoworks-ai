import type { GeminiExtraction } from '@/lib/gemini';

export type MotoworksEnv = {
  DB: D1Database;
  FILES: R2Bucket;
  BOOTSTRAP_OWNER_EMAIL?: string;
  DATA_ENCRYPTION_KEY?: string;
  GEMINI_API_KEY?: string;
  GEMINI_VISION_MODEL?: string;
};

export type AuthorizedUser = {
  id: string;
  externalId: string;
  email: string;
  displayName: string;
  isOwner: boolean;
};

export const ORGANIZATION_ID = 'core-partners';
export const SHOP_NAMES: Record<string, string> = {
  yongjeon: '진바이크 용전센터',
  jayang: '코아바이크 자양센터',
};

const SENSITIVE_FIELDS = new Set([
  'customer_name',
  'phone',
  'vehicle_plate',
]);

export async function requireAuthorizedUser(
  request: Request,
  env: MotoworksEnv,
  shopId?: string,
): Promise<AuthorizedUser> {
  const externalId = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email')?.toLowerCase();
  if (!externalId || !email) throw new HttpError(401, '로그인이 필요합니다.');
  const ownerEmail = (env.BOOTSTRAP_OWNER_EMAIL || 'shortsbogo@gmail.com').toLowerCase();
  const isOwner = email === ownerEmail;
  const id = `user:${externalId}`;
  const displayName = decodeDisplayName(request) || email;

  if (isOwner) {
    await ensureOwnerSeed(env, { id, externalId, email, displayName });
    return { id, externalId, email, displayName, isOwner };
  }

  const access = await env.DB.prepare(
    `SELECT u.id, usr.role
       FROM users u
       JOIN user_shop_roles usr ON usr.user_id = u.id
      WHERE u.external_user_id = ?1
        AND u.organization_id = ?2
        AND (usr.shop_id IS NULL OR usr.shop_id = ?3)
      LIMIT 1`,
  )
    .bind(externalId, ORGANIZATION_ID, shopId ?? null)
    .first<{ id: string; role: string }>();
  if (!access) throw new HttpError(403, '이 센터에 대한 권한이 없습니다.');
  return { id: access.id, externalId, email, displayName, isOwner: false };
}

export async function ensureOwnerSeed(
  env: MotoworksEnv,
  user: Pick<AuthorizedUser, 'id' | 'externalId' | 'email' | 'displayName'>,
) {
  const now = Date.now();
  await env.DB.batch([
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
    env.DB.prepare(
      `INSERT OR IGNORE INTO users
         (id, organization_id, external_user_id, email, display_name, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
    ).bind(
      user.id,
      ORGANIZATION_ID,
      user.externalId,
      user.email,
      user.displayName,
      now,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO user_shop_roles
         (id, organization_id, user_id, shop_id, role, created_at, updated_at)
       VALUES (?1, ?2, ?3, NULL, 'admin', ?4, ?4)`,
    ).bind(`owner-role:${user.externalId}`, ORGANIZATION_ID, user.id, now),
  ]);
}

export async function protectExtraction(
  extraction: GeminiExtraction,
  secret?: string,
): Promise<GeminiExtraction> {
  return {
    ...extraction,
    fields: await Promise.all(
      extraction.fields.map(async (field) => {
        if (!SENSITIVE_FIELDS.has(field.key)) return field;
        if (!secret) {
          return {
            ...field,
            raw_value: null,
            normalized_value: null,
            validation_status: 'conflict' as const,
            validation_message: '개인정보 암호화 키가 없어 저장하지 않았습니다.',
          };
        }
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
): Promise<GeminiExtraction> {
  return {
    ...extraction,
    fields: await Promise.all(
      extraction.fields.map(async (field) => {
        if (!SENSITIVE_FIELDS.has(field.key) || !secret) return field;
        return {
          ...field,
          raw_value:
            typeof field.raw_value === 'string'
              ? await decryptValue(field.raw_value, secret)
              : field.raw_value,
          normalized_value:
            typeof field.normalized_value === 'string'
              ? await decryptValue(field.normalized_value, secret)
              : field.normalized_value,
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
  return Response.json({ error: status === 500 ? '서버 처리 중 오류가 발생했습니다.' : message }, { status });
}

async function encryptValue(value: string, secret: string) {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(value),
  );
  return `v1:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipher))}`;
}

async function decryptValue(value: string, secret: string) {
  if (!value.startsWith('v1:')) return value;
  const [, ivText, cipherText] = value.split(':');
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
