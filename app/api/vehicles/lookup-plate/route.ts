import { env } from 'cloudflare:workers';
import { extractLicensePlate } from '@/lib/gemini';
import {
  assertServerEnvironment,
  checkPlateLookupRateLimit,
  decryptValue,
  errorResponse,
  extractPlateDigits,
  hasPermission,
  hashPlateDigits,
  logSecurityAudit,
  maskName,
  maskPhone,
  ORGANIZATION_ID,
  recordLookupNoMatch,
  requirePermission,
  resetLookupNoMatch,
  type MotoworksEnv,
} from '@/lib/server/motoworks';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const runtime = env as unknown as MotoworksEnv;
  try {
    // 1. 부팅 환경 검증 (PLATE_HASH_SECRET 미설정 시 즉시 HTTP 503 throw)
    assertServerEnvironment(runtime);

    // 2. 세션 기반 사용자 인증 및 조직 격리 (파라미터 조작 원천 차단)
    const actor = await requirePermission(request, runtime, 'view');
    const organizationId = ORGANIZATION_ID;

    // 3. 클라이언트 IP 추출 및 Rate Limit & 쿨다운 검증
    const clientIp =
      request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      '127.0.0.1';

    const rateCheck = await checkPlateLookupRateLimit(runtime, clientIp, organizationId);
    if (!rateCheck.allowed) {
      await logSecurityAudit(
        runtime,
        actor.id,
        'security.plate_lookup_blocked',
        'rate_limit',
        clientIp,
        { reason: rateCheck.reason },
        request,
      );
      return Response.json(
        { error: rateCheck.reason },
        {
          status: 429,
          headers: { 'Retry-After': String(rateCheck.retryAfterSeconds ?? 60) },
        },
      );
    }

    // 4. 입력 파싱 (이미지 업로드 또는 수동 텍스트)
    const contentType = request.headers.get('content-type') || '';
    let extractedPlate = '';
    let rawDigits = '';
    let confidence = 1.0;
    let isUncertain = false;

    if (contentType.includes('multipart/form-data')) {
      const geminiKey = runtime.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (!geminiKey) {
        return Response.json(
          { error: 'Gemini API 키가 설정되지 않아 번호판 사진을 판독할 수 없습니다.' },
          { status: 503 },
        );
      }

      const form = await request.formData();
      const file = form.get('image') || form.get('file') || form.get('files');
      if (!(file instanceof File)) {
        return Response.json(
          { error: '업로드된 번호판 사진 파일이 없습니다.' },
          { status: 400 },
        );
      }

      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const imageBase64 = btoa(binary);

      const ocrResult = await extractLicensePlate({
        imageBase64,
        mimeType: file.type || 'image/jpeg',
        apiKey: geminiKey,
        model: runtime.GEMINI_PLATE_MODEL,
      });

      extractedPlate = ocrResult.full_plate;
      rawDigits = ocrResult.plate_digits;
      confidence = ocrResult.confidence;
      isUncertain = ocrResult.is_uncertain;
    } else {
      let body: { plateText?: string; plateDigits?: string } = {};
      try {
        body = (await request.json()) as {
          plateText?: string;
          plateDigits?: string;
        };
      } catch {
        body = {};
      }
      extractedPlate = body.plateText || body.plateDigits || '';
      rawDigits = body.plateDigits || body.plateText || '';
    }

    const digits = extractPlateDigits(rawDigits || extractedPlate);
    if (!digits) {
      await recordLookupNoMatch(runtime, clientIp, organizationId);
      await logSecurityAudit(
        runtime,
        actor.id,
        'vehicle.plate_lookup',
        'vehicle',
        'none',
        { match_type: 'none', rawInput: extractedPlate, reason: 'no_digits' },
        request,
      );
      return Response.json({
        status: 'no_match',
        matchType: 'none',
        extractedPlate,
        plateDigits: '',
        confidence: 0,
        isUncertain: true,
        notice: '번호판 숫자를 인식하지 못했습니다. 번호판 숫자를 직접 입력해 주세요.',
      });
    }

    // 5. 단계적 Fallback 질의
    // 1차 질의: 추출된 숫자 전체(4자리 또는 3자리) 해시로 조회
    const primaryHash = await hashPlateDigits(digits, runtime.PLATE_HASH_SECRET!);
    let matchType: 'exact_4' | 'fallback_3' | 'none' = digits.length === 4 ? 'exact_4' : 'fallback_3';

    let matchedVehicles = await runtime.DB.prepare(
      `SELECT v.id, v.organization_id, v.shop_id, v.customer_id, v.plate_encrypted,
              v.manufacturer, v.model, v.displacement_cc, v.model_year, v.certainty,
              c.name AS customer_name, c.phone_encrypted,
              s.name AS shop_name
         FROM vehicles v
         LEFT JOIN customers c ON c.id = v.customer_id
         LEFT JOIN shops s ON s.id = v.shop_id
        WHERE v.organization_id = ?1 AND v.plate_digits_hash = ?2`,
    )
      .bind(organizationId, primaryHash)
      .all<{
        id: string;
        organization_id: string;
        shop_id: string | null;
        customer_id: string | null;
        plate_encrypted: string | null;
        manufacturer: string | null;
        model: string | null;
        displacement_cc: number | null;
        model_year: number | null;
        certainty: string;
        customer_name: string | null;
        phone_encrypted: string | null;
        shop_name: string | null;
      }>();

    // 2차 Fallback 질의: 4자리 조회 결과가 0건일 때만 뒤 3자리 해시로 추가 질의
    let isFallback = false;
    if (matchedVehicles.results.length === 0 && digits.length === 4) {
      const last3Digits = digits.slice(-3);
      const fallbackHash = await hashPlateDigits(last3Digits, runtime.PLATE_HASH_SECRET!);
      matchedVehicles = await runtime.DB.prepare(
        `SELECT v.id, v.organization_id, v.shop_id, v.customer_id, v.plate_encrypted,
                v.manufacturer, v.model, v.displacement_cc, v.model_year, v.certainty,
                c.name AS customer_name, c.phone_encrypted,
                s.name AS shop_name
           FROM vehicles v
           LEFT JOIN customers c ON c.id = v.customer_id
           LEFT JOIN shops s ON s.id = v.shop_id
          WHERE v.organization_id = ?1 AND v.plate_digits_hash = ?2`,
      )
        .bind(organizationId, fallbackHash)
        .all();

      if (matchedVehicles.results.length > 0) {
        isFallback = true;
        matchType = 'fallback_3';
      }
    }

    // 6. 결과 분기 처리
    // [분기 A] 후보 0건: no_match
    if (matchedVehicles.results.length === 0) {
      const { consecutiveNoMatch, isBlocked } = await recordLookupNoMatch(
        runtime,
        clientIp,
        organizationId,
      );

      await logSecurityAudit(
        runtime,
        actor.id,
        'vehicle.plate_lookup',
        'vehicle',
        'none',
        {
          match_type: 'none',
          extractedPlate,
          plateDigits: digits,
          consecutiveNoMatch,
        },
        request,
      );

      return Response.json({
        status: 'no_match',
        matchType: 'none',
        extractedPlate,
        plateDigits: digits,
        confidence,
        isUncertain,
        isBlocked,
        notice:
          digits.length <= 3
            ? '일치하는 차량이 없습니다. 앞자리가 누락되지 않았는지 확인하세요 (예: 4자리 중 앞자리 미인식).'
            : '등록된 차량 정보가 없습니다. 이 번호판으로 신규 접수할 수 있습니다.',
      });
    }

    // 일치 건 발견 시 연속 실패 카운터 즉시 리셋
    await resetLookupNoMatch(runtime, clientIp, organizationId);

    // 7. PII 권한 통제 및 암호화 복호화
    const canViewPii = hasPermission(actor, 'view_pii');
    const secret = runtime.DATA_ENCRYPTION_KEY;

    const candidates = await Promise.all(
      matchedVehicles.results.map(async (row) => {
        let decryptedPlate = row.plate_encrypted || '';
        if (row.plate_encrypted && secret) {
          decryptedPlate = await decryptValue(row.plate_encrypted, secret);
        }

        let decryptedPhone = row.phone_encrypted || '';
        if (row.phone_encrypted && secret) {
          decryptedPhone = await decryptValue(row.phone_encrypted, secret);
        }

        let rawCustomerName = row.customer_name || '고객 미확인';
        if (rawCustomerName.startsWith('v1:') && secret) {
          rawCustomerName = await decryptValue(rawCustomerName, secret);
        }

        // view_pii 권한 미보유 시 마스킹 적용
        const displayCustomerName = canViewPii ? rawCustomerName : maskName(rawCustomerName);
        const displayPhone = canViewPii ? decryptedPhone : maskPhone(decryptedPhone);

        // 해당 차량의 최근 정비 이력 조회 (최대 3건)
        const recentOrders = await runtime.DB.prepare(
          `SELECT id, approved_service_date, service_type, total_amount
             FROM service_orders
            WHERE organization_id = ?1 AND vehicle_id = ?2 AND status = 'approved'
            ORDER BY approved_service_date DESC LIMIT 3`,
        )
          .bind(organizationId, row.id)
          .all<{
            id: string;
            approved_service_date: string;
            service_type: string;
            total_amount: number;
          }>();

        return {
          vehicleId: row.id,
          fullPlate: decryptedPlate || extractedPlate,
          manufacturer: row.manufacturer,
          model: row.model || '차종 미확정',
          shopName: row.shop_name,
          customerId: row.customer_id,
          customerName: displayCustomerName,
          phone: displayPhone,
          lastServiceDate: recentOrders.results[0]?.approved_service_date ?? null,
          recentOrders: recentOrders.results,
          isFallback,
        };
      }),
    );

    // 개인정보 평문 노출 시 보안 감사로그 기록
    if (canViewPii) {
      await logSecurityAudit(
        runtime,
        actor.id,
        'customer.pii_revealed',
        'customer',
        candidates[0]?.customerId || 'unknown',
        {
          vehicleIds: candidates.map((c) => c.vehicleId),
          revealedFields: ['phone', 'customer_name'],
        },
        request,
      );
    }

    await logSecurityAudit(
      runtime,
      actor.id,
      'vehicle.plate_lookup',
      'vehicle',
      candidates[0]?.vehicleId || 'multiple',
      {
        match_type: matchType,
        candidateCount: candidates.length,
        extractedPlate,
        plateDigits: digits,
      },
      request,
    );

    // [분기 B] 단일 매칭 1건
    if (candidates.length === 1) {
      return Response.json({
        status: 'single_match',
        matchType,
        isFallback,
        candidate: candidates[0],
        extractedPlate,
        plateDigits: digits,
        confidence,
      });
    }

    // [분기 C] 복수 후보 N건
    return Response.json({
      status: 'multiple_matches',
      matchType,
      isFallback,
      candidates,
      extractedPlate,
      plateDigits: digits,
      confidence,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

