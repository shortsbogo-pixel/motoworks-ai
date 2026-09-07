import readline from 'node:readline';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function hashPassword(password) {
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
  const saltHex = [...salt].map((b) => b.toString(16).padStart(2, '0')).join('');
  const hashHex = [...new Uint8Array(derivedBits)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:sha256:100000:${saltHex}:${hashHex}`;
}

async function main() {
  console.log('================================================================');
  console.log(' 모토웍스 신규 사용자 계정 생성 CLI (100% 대화형 stdin 프롬프트)');
  console.log('================================================================\n');

  try {
    // 1. 이메일 입력
    const rawEmail = await question('1. 사용자 이메일 (로그인 ID): ');
    const email = rawEmail.trim().toLowerCase();
    if (!email || !email.includes('@') || !email.includes('.')) {
      console.error('\n[오류] 올바른 이메일 형식을 입력해주세요.');
      process.exit(1);
    }

    // 2. 표시 이름 입력
    const rawName = await question('2. 표시 이름 (예: 홍길동 매니저): ');
    const displayName = rawName.trim();
    if (!displayName) {
      console.error('\n[오류] 표시 이름을 입력해주세요.');
      process.exit(1);
    }

    // 3. 역할 선택
    console.log('\n[역할 선택]');
    console.log('  1) admin        - 조직 관리자 (전체 권한 및 사용자 관리)');
    console.log('  2) shop_manager - 지점 관리자 (정비/승인/엑셀 내보내기/감사 조회)');
    console.log('  3) staff        - 일반 직원 (영수증 업로드 및 판독값 수정)');
    console.log('  4) viewer       - 단순 열람자 (현황 조회만 가능)');
    const roleInput = (await question('3. 역할 번호 또는 이름 [기본값: 3 (staff)]: ')).trim();
    let role = 'staff';
    if (roleInput === '1' || roleInput === 'admin') role = 'admin';
    else if (roleInput === '2' || roleInput === 'shop_manager') role = 'shop_manager';
    else if (roleInput === '3' || roleInput === 'staff' || !roleInput) role = 'staff';
    else if (roleInput === '4' || roleInput === 'viewer') role = 'viewer';
    else {
      console.error('\n[오류] 지원되지 않는 역할입니다. 1~4번 중 선택하세요.');
      process.exit(1);
    }

    // 4. 지점(센터) 선택
    let shopId = null;
    if (role !== 'admin') {
      console.log('\n[소속 지점 선택]');
      console.log('  1) 전체 지점 (모든 센터 데이터 접근)');
      console.log('  2) yongjeon  (진바이크 용전센터)');
      console.log('  3) jayang    (코아바이크 자양센터)');
      const shopInput = (await question('4. 지점 번호 [기본값: 1]: ')).trim();
      if (shopInput === '2' || shopInput === 'yongjeon') shopId = 'yongjeon';
      else if (shopInput === '3' || shopInput === 'jayang') shopId = 'jayang';
    }

    // 5. 초기 비밀번호 입력
    console.log('\n[비밀번호 설정 - 셸 히스토리 및 인자에 남지 않음]');
    const pw1 = await question('5. 초기 비밀번호 (8자 이상): ');
    if (!pw1 || pw1.length < 8) {
      console.error('\n[오류] 비밀번호는 최소 8자 이상이어야 합니다.');
      process.exit(1);
    }

    const pw2 = await question('6. 초기 비밀번호 확인: ');
    if (pw1 !== pw2) {
      console.error('\n[오류] 입력한 두 비밀번호가 일치하지 않습니다.');
      process.exit(1);
    }

    const now = Date.now();
    console.log('\nCloudflare D1에서 이메일 중복 여부를 확인 중...');

    // 6. 이메일 중복 확인 (기존 계정 덮어쓰기 방지)
    const checkSql = `SELECT id, email FROM users WHERE email = '${email}' LIMIT 1;`;
    const tempCheckFile = `drizzle/_temp_check_${now}.sql`;
    fs.writeFileSync(tempCheckFile, checkSql, 'utf8');
    let checkOutput = '';
    try {
      checkOutput = execSync(`npx wrangler d1 execute motoworks-db --remote --file=${tempCheckFile} --json`, {
        encoding: 'utf8',
      });
    } finally {
      if (fs.existsSync(tempCheckFile)) fs.unlinkSync(tempCheckFile);
    }

    try {
      const parsed = JSON.parse(checkOutput);
      const results = parsed[0]?.results ?? [];
      if (results.length > 0) {
        console.error(`\n[경고] 이미 존재하는 이메일입니다: ${email}`);
        console.error('기존 계정을 덮어쓰지 않고 안전하게 생성을 중단합니다.\n');
        process.exit(1);
      }
    } catch {
      // JSON 파싱 실패 시 fallback 검사
      if (checkOutput.includes(`"email":"${email}"`)) {
        console.error(`\n[경고] 이미 존재하는 이메일입니다: ${email}`);
        process.exit(1);
      }
    }

    // 7. PBKDF2 해시 계산
    console.log('PBKDF2-HMAC-SHA256 (100,000회 반복, 16바이트 솔트) 해시 계산 중...');
    const passwordHash = await hashPassword(pw1);

    // 8. D1 등록 (users + user_shop_roles)
    console.log(`Cloudflare D1(motoworks-db)에 사용자 및 역할 등록 중...`);
    const userId = `user:${email}`;
    const roleMappingId = `usr_role:${now}_${crypto.randomBytes(4).toString('hex')}`;
    const shopValue = shopId ? `'${shopId}'` : 'NULL';

    const insertSql = `
      INSERT INTO users (id, organization_id, external_user_id, email, display_name, status, password_hash, password_updated_at, created_at, updated_at)
      VALUES ('${userId}', 'core-partners', '${email}', '${email}', '${displayName}', 'active', '${passwordHash}', ${now}, ${now}, ${now});

      INSERT INTO user_shop_roles (id, organization_id, user_id, shop_id, role, role_id, created_at, updated_at)
      VALUES ('${roleMappingId}', 'core-partners', '${userId}', ${shopValue}, '${role}', 'role:${role}', ${now}, ${now});
    `;

    const tempInsertFile = `drizzle/_temp_create_user_${now}.sql`;
    fs.writeFileSync(tempInsertFile, insertSql, 'utf8');
    try {
      execSync(`npx wrangler d1 execute motoworks-db --remote --file=${tempInsertFile}`, {
        stdio: 'inherit',
      });
    } finally {
      if (fs.existsSync(tempInsertFile)) fs.unlinkSync(tempInsertFile);
    }

    console.log('\n================================================================');
    console.log(' [완료] 신규 계정이 성공적으로 등록되었습니다.');
    console.log(` - ID/이메일: ${email}`);
    console.log(` - 표시 이름: ${displayName}`);
    console.log(` - 배정 역할: ${role} (role:${role})`);
    console.log(` - 소속 센터: ${shopId ?? '전체 지점'}`);
    console.log(` - 계정 상태: active (승인 완료)`);
    console.log(' - 보안: PBKDF2-HMAC-SHA256 해시 저장 완료');
    console.log('================================================================\n');
  } catch (err) {
    console.error('\n[실패] 오류 발생:', err.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
