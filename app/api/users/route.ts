import { env } from 'cloudflare:workers';
import {
  errorResponse,
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
      action: 'create_role' | 'update_role' | 'assign_role' | 'update_user_status';
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
