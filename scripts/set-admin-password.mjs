import readline from 'node:readline';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

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
  console.log('====================================================');
  console.log(' 모토웍스 관리자 비밀번호 CLI 설정 (안전한 표준 PBKDF2)');
  console.log('====================================================\n');

  try {
    const inputEmail = await question('관리자 이메일 [기본값: shortsbogo@gmail.com]: ');
    const email = (inputEmail.trim() || 'shortsbogo@gmail.com').toLowerCase();

    const pw1 = await question('새 관리자 비밀번호 (8자 이상): ');
    if (!pw1 || pw1.length < 8) {
      console.error('\n[오류] 비밀번호는 최소 8자 이상이어야 합니다.');
      process.exit(1);
    }

    const pw2 = await question('새 관리자 비밀번호 확인: ');
    if (pw1 !== pw2) {
      console.error('\n[오류] 입력한 두 비밀번호가 일치하지 않습니다.');
      process.exit(1);
    }

    console.log('\nPBKDF2-HMAC-SHA256 (100,000회 반복) 해시 계산 중...');
    const passwordHash = await hashPassword(pw1);
    const now = Date.now();

    console.log(`Cloudflare D1(motoworks-db)에 ${email} 계정 비밀번호 반영 중...`);
    const sql = `UPDATE users SET password_hash = '${passwordHash}', password_updated_at = ${now}, status = 'active' WHERE email = '${email}';`;
    const tempSqlPath = `drizzle/_temp_set_pw_${now}.sql`;
    const fs = await import('node:fs');
    fs.writeFileSync(tempSqlPath, sql, 'utf8');
    try {
      execSync(`npx wrangler d1 execute motoworks-db --remote --file=${tempSqlPath}`, {
        stdio: 'inherit',
      });
    } finally {
      if (fs.existsSync(tempSqlPath)) fs.unlinkSync(tempSqlPath);
    }

    console.log('\n[완료] 관리자 비밀번호가 성공적으로 설정되었습니다.');
    console.log(`- 계정: ${email}`);
    console.log(`- 알고리즘: PBKDF2-HMAC-SHA256 (100,000 iters, 16 bytes salt)`);
    console.log('- 셸 히스토리 및 환경변수에 비밀번호가 저장되지 않았습니다.\n');
  } catch (err) {
    console.error('\n[실패] 오류 발생:', err.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
