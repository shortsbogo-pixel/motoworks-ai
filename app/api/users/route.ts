import { env } from 'cloudflare:workers';
import {
  errorResponse,
  hashPassword,
  HttpError,
  ORGANIZATION_ID,
  Permission,
  requirePermission,
  SHOP_NAMES,
  type MotoworksEnv,
} from '@/lib/server/motoworks';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const runtime = env as unknown as MotoworksEnv;
  try {
    await requirePermission(request, runtime, 'view');

    // 전체 사용자 목록
    const userRows = await runtime.DB.prepare(
      `SELECT id, external_user_id, email, display_name, status, created_at
         FROM users
        WHERE organization_id = ?1
        ORDER BY created_at ASC`,
    )
      .bind(ORGANIZATION_ID)
      .all<{
        id: string;
        external_user_id: string;
        email: string;
        display_name: string | null;
        status: string;
        created_at: number;
      }>();

    // 사용자별 역할 및 센터 배정
    const roleAssignments = await runtime.DB.prepare(
      `SELECT usr.id, usr.user_id, usr.shop_id, s.name AS shop_name,
              usr.role, usr.role_id, r.name AS custom_role_name, r.permissions_json
         FROM user_shop_roles usr
         LEFT JOIN shops s ON s.id = usr.shop_id
         LEFT JOIN roles r ON r.id = usr.role_id
        WHERE usr.organization_id = ?1`,
    )
      .bind(ORGANIZATION_ID)
      .all<{
        id: string;
        user_id: string;
        shop_id: string | null;
        shop_name: string | null;
        role: string;
        role_id: string | null;
        custom_role_name: string | null;
        permissions_json: string | null;
      }>();

    // 권한 그룹 목록
    const roleRows = await runtime.DB.prepare(
      `SELECT id, name, description, permissions_json, created_at
         FROM roles
        WHERE organization_id = ?1
        ORDER BY created_at ASC`,
    )
      .bind(ORGANIZATION_ID)
      .all<{
        id: string;
        name: string;
        description: string | null;
        permissions_json: string;
        created_at: number;
      }>();

    const users = userRows.results.map((u) => {
      const assignments = roleAssignments.results
        .filter((ra) => ra.user_id === u.id)
        .map((ra) => ({
          id: ra.id,
          shopId: ra.shop_id,
          shopName: ra.shop_name || (ra.shop_id ? SHOP_NAMES[ra.shop_id] : '전체 지점'),
          role: ra.role,
          roleId: ra.role_id,
          roleName: ra.custom_role_name || ra.role,
        }));

      return {
        id: u.id,
        email: u.email,
        displayName: u.display_name || u.email,
        status: u.status,
        createdAt: u.created_at,
        assignments,
      };
    });

    const roles = roleRows.results.map((r) => {
      let permissions: Permission[] = [];
      try {
        permissions = JSON.parse(r.permissions_json);
      } catch {
        permissions = [];
      }
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        permissions,
        createdAt: r.created_at,
      };
    });

    return Response.json({ users, roles });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const runtime = env as unknown as MotoworksEnv;
  try {
    const actor = await requirePermission(request, runtime, 'manage_users');
    const body = (await request.json()) as {
      action:
        | 'create_user'
        | 'delete_user'
        | 'create_role'
        | 'update_role'
        | 'assign_role'
        | 'update_user_status';
      email?: string;
      displayName?: string;
      initialPassword?: string;
      name?: string;
      description?: string;
      permissions?: Permission[];
      roleId?: string;
      userId?: string;
      shopId?: string | null;
      role?: string;
      status?: 'pending' | 'active' | 'suspended';
    };

    const now = Date.now();

    // 1. 신규 계정 생성 (PBKDF2 해싱, users + user_shop_roles 등록, audit_logs 기록)
    if (body.action === 'create_user' || (body.email && body.initialPassword)) {
      const email = (body.email || '').trim().toLowerCase();
      const displayName = (body.displayName || '').trim();
      const role = body.role || 'staff';
      const shopId = body.shopId || null;
      const initialPassword = body.initialPassword || '';

      if (!email || !displayName || !role || !initialPassword) {
        throw new HttpError(400, '이메일, 표시 이름, 역할, 초기 비밀번호를 모두 입력해주세요.');
      }

      if (initialPassword.length < 8) {
        throw new HttpError(400, '비밀번호는 최소 8자 이상이어야 합니다.');
      }

      const validRoles = ['admin', 'shop_manager', 'staff', 'viewer'];
      if (!validRoles.includes(role)) {
        throw new HttpError(400, `유효하지 않은 역할입니다. (선택 가능: ${validRoles.join(', ')})`);
      }

      if (shopId && !SHOP_NAMES[shopId]) {
        throw new HttpError(400, '유효하지 않은 센터(지점)입니다.');
      }

      // 이메일 중복 확인 (기존 계정 덮어쓰기 금지)
      const existing = await runtime.DB.prepare(
        `SELECT id FROM users WHERE email = ?1 AND organization_id = ?2 LIMIT 1`,
      )
        .bind(email, ORGANIZATION_ID)
        .first<{ id: string }>();

      if (existing) {
        throw new HttpError(409, `이미 등록된 이메일 계정입니다: ${email}`);
      }

      // 표준 PBKDF2-HMAC-SHA256 (100,000회 반복, 16바이트 솔트) 해싱
      const passwordHash = await hashPassword(initialPassword);
      const userId = `user:${email}`;
      const roleMappingId = `usr_role:${crypto.randomUUID()}`;
      const targetShopId = role === 'admin' ? null : shopId;
      const roleId = `role:${role}`;

      await runtime.DB.batch([
        runtime.DB.prepare(
          `INSERT INTO users
             (id, organization_id, external_user_id, email, display_name, status, password_hash, password_updated_at, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?7, ?7, ?7)`,
        ).bind(userId, ORGANIZATION_ID, email, email, displayName, passwordHash, now),

        runtime.DB.prepare(
          `INSERT INTO user_shop_roles
             (id, organization_id, user_id, shop_id, role, role_id, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
        ).bind(roleMappingId, ORGANIZATION_ID, userId, targetShopId, role, roleId, now),
      ]);

      await logAudit(
        runtime,
        actor.id,
        'user.created',
        'user',
        userId,
        { email, displayName, role, shopId: targetShopId },
        request,
      );

      return Response.json({ ok: true, userId }, { status: 201 });
    }

    // 2. 계정 삭제 (audit_logs 참조 확인: 참조 시 suspended, 무참조 시 삭제)
    if (body.action === 'delete_user') {
      const targetUserId = body.userId;
      if (!targetUserId) {
        throw new HttpError(400, '삭제할 사용자 ID가 필요합니다.');
      }

      if (targetUserId === actor.id) {
        throw new HttpError(400, '현재 로그인된 관리자 계정은 삭제할 수 없습니다.');
      }

      const targetUser = await runtime.DB.prepare(
        `SELECT id, email, display_name FROM users WHERE id = ?1 AND organization_id = ?2 LIMIT 1`,
      )
        .bind(targetUserId, ORGANIZATION_ID)
        .first<{ id: string; email: string; display_name: string }>();

      if (!targetUser) {
        throw new HttpError(404, '해당 사용자를 찾을 수 없습니다.');
      }

      // 참조 확인 (audit_logs)
      const auditRef = await runtime.DB.prepare(
        `SELECT count(*) as count FROM audit_logs WHERE actor_user_id = ?1`,
      )
        .bind(targetUserId)
        .first<{ count: number }>();

      if (auditRef && auditRef.count > 0) {
        // 감사 로그 참조가 남아 있으면 삭제하지 않고 status를 suspended로 변경
        await runtime.DB.prepare(
          `UPDATE users SET status = 'suspended', updated_at = ?2 WHERE id = ?1 AND organization_id = ?3`,
        )
          .bind(targetUserId, now, ORGANIZATION_ID)
          .run();

        await logAudit(
          runtime,
          actor.id,
          'user.suspended_audit_retained',
          'user',
          targetUserId,
          { email: targetUser.email, reason: 'has_audit_references' },
          request,
        );

        return Response.json({
          ok: true,
          action: 'suspended',
          message: '감사 로그 참조가 존재하여 계정을 정지(suspended) 처리했습니다.',
        });
      }

      // 참조 없으면 완전 삭제
      await runtime.DB.batch([
        runtime.DB.prepare(
          `DELETE FROM user_shop_roles WHERE user_id = ?1 AND organization_id = ?2`,
        ).bind(targetUserId, ORGANIZATION_ID),
        runtime.DB.prepare(
          `DELETE FROM users WHERE id = ?1 AND organization_id = ?2`,
        ).bind(targetUserId, ORGANIZATION_ID),
      ]);

      await logAudit(
        runtime,
        actor.id,
        'user.deleted',
        'user',
        targetUserId,
        { email: targetUser.email },
        request,
      );

      return Response.json({ ok: true, action: 'deleted' });
    }

    if (body.action === 'create_role') {
      if (!body.name || !body.permissions || !Array.isArray(body.permissions)) {
        throw new HttpError(400, '권한 그룹 이름과 권한 목록이 필요합니다.');
      }
      const roleId = `role:${crypto.randomUUID()}`;
      await runtime.DB.prepare(
        `INSERT INTO roles
           (id, organization_id, name, description, permissions_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`,
      )
        .bind(
          roleId,
          ORGANIZATION_ID,
          body.name,
          body.description || null,
          JSON.stringify(body.permissions),
          now,
        )
        .run();

      await logAudit(
        runtime,
        actor.id,
        'role.created',
        'role',
        roleId,
        { name: body.name, permissions: body.permissions },
        request,
      );

      return Response.json({ ok: true, roleId });
    }

    if (body.action === 'update_role') {
      if (!body.roleId || !body.name || !body.permissions) {
        throw new HttpError(400, '권한 그룹 ID, 이름, 권한 목록이 필요합니다.');
      }
      await runtime.DB.prepare(
        `UPDATE roles
            SET name = ?2, description = ?3, permissions_json = ?4, updated_at = ?5
          WHERE id = ?1 AND organization_id = ?6`,
      )
        .bind(
          body.roleId,
          body.name,
          body.description || null,
          JSON.stringify(body.permissions),
          now,
          ORGANIZATION_ID,
        )
        .run();

      await logAudit(
        runtime,
        actor.id,
        'role.updated',
        'role',
        body.roleId,
        { name: body.name, permissions: body.permissions },
        request,
      );

      return Response.json({ ok: true });
    }

    if (body.action === 'assign_role') {
      if (!body.userId || !body.role) {
        throw new HttpError(400, '사용자 ID와 역할 정보가 필요합니다.');
      }
      const assignmentId = `usr:${crypto.randomUUID()}`;
      await runtime.DB.prepare(
        `INSERT INTO user_shop_roles
           (id, organization_id, user_id, shop_id, role, role_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)`,
      )
        .bind(
          assignmentId,
          ORGANIZATION_ID,
          body.userId,
          body.shopId ?? null,
          body.role,
          body.roleId ?? null,
          now,
        )
        .run();

      await logAudit(
        runtime,
        actor.id,
        'user.role_assigned',
        'user_shop_roles',
        assignmentId,
        { userId: body.userId, shopId: body.shopId, role: body.role },
        request,
      );

      return Response.json({ ok: true, assignmentId });
    }

    if (body.action === 'update_user_status') {
      if (!body.userId || !body.status) {
        throw new HttpError(400, '사용자 ID와 상태가 필요합니다.');
      }
      await runtime.DB.prepare(
        `UPDATE users
            SET status = ?2, updated_at = ?3
          WHERE id = ?1 AND organization_id = ?4`,
      )
        .bind(body.userId, body.status, now, ORGANIZATION_ID)
        .run();

      await logAudit(
        runtime,
        actor.id,
        'user.status_updated',
        'user',
        body.userId,
        { status: body.status },
        request,
      );

      return Response.json({ ok: true });
    }

    throw new HttpError(400, '지원되지 않는 작업입니다.');
  } catch (error) {
    return errorResponse(error);
  }
}

async function logAudit(
  runtime: MotoworksEnv,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  afterData: unknown,
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
        JSON.stringify(afterData),
        request.headers.get('user-agent'),
        Date.now(),
      )
      .run();
  } catch {
    // 감사 로그 실패가 메인 작업을 중단시키지 않음
  }
}
