/**
 * 密碼與資安引擎
 * 純 Web Crypto API — 零依賴，相容 Cloudflare V8 Runtime
 *
 * PBKDF2 規格：SHA-256, 100,000 次迭代, 32 bytes 輸出
 * Salt / Token 規格：32 bytes 強亂數，hex 編碼
 * 備用碼規格：10 組，每組 10 bytes 強亂數，格式 XXXXX-XXXXX（base32-like hex）
 */

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEY_LENGTH = 32; // bytes → 256 bits

// ─── 內部工具 ────────────────────────────────────────────────

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes.buffer;
}

// ─── Salt / Token 生成 ────────────────────────────────────────

/** 生成 32 bytes 強亂數 salt，hex 字串 */
export function generateSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bufferToHex(bytes);
}

/** 生成通用安全 Token（用於 email verification、password reset 等），hex 字串 */
export function generateSecureToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bufferToHex(bytes);
}

// ─── PBKDF2 密碼雜湊 ─────────────────────────────────────────

/**
 * 以 PBKDF2-SHA256 雜湊密碼。
 * @param {string} password  明文密碼
 * @param {string} saltHex   hex 格式 salt（來自 generateSalt()）
 * @returns {Promise<string>} hex 格式 hash
 */
export async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: hexToBuffer(saltHex),
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    PBKDF2_KEY_LENGTH * 8
  );
  return bufferToHex(bits);
}

/**
 * 驗證密碼是否與儲存的 hash 相符（constant-time 等長比較）。
 * @param {string} password      明文密碼
 * @param {string} saltHex       原始 salt（hex）
 * @param {string} storedHashHex 資料庫中的 hash（hex）
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, saltHex, storedHashHex) {
  const inputHash = await hashPassword(password, saltHex);
  // 使用 timingSafeEqual 防計時攻擊（固定長度 hex 字串，逐字元比較）
  if (inputHash.length !== storedHashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < inputHash.length; i++) {
    diff |= inputHash.charCodeAt(i) ^ storedHashHex.charCodeAt(i);
  }
  return diff === 0;
}

// ─── 任意 Token 雜湊（用於 DB 儲存）────────────────────────────

/**
 * 以 SHA-256 雜湊任意 Token，用於 email_verifications、password_resets 等表的 token_hash 欄位。
 * 原始 Token 只發給使用者，資料庫只存 hash。
 * @param {string} token  原始 Token（hex 字串）
 * @returns {Promise<string>} hex 格式 SHA-256 hash
 */
export async function hashToken(token) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(token));
  return bufferToHex(digest);
}

// ─── 備用救援碼 ───────────────────────────────────────────────

const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_BYTES = 5; // 每半組 5 bytes → 10 hex chars → 格式 XXXXX-XXXXX

/**
 * 生成 10 組一次性備用救援碼。
 * 回傳格式：{ plain: string[], hashed: string[] }
 *   - plain：顯示給使用者（只出現一次，需提示立即抄寫）
 *   - hashed：SHA-256 hash，儲存至 backup_codes 表
 */
export async function generateBackupCodes() {
  const plain = [];
  const hashed = [];

  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(BACKUP_CODE_BYTES * 2));
    const hex = bufferToHex(bytes); // 20 hex chars
    const formatted = `${hex.slice(0, 5)}-${hex.slice(5, 10)}-${hex.slice(10, 15)}-${hex.slice(15, 20)}`;
    plain.push(formatted);
    hashed.push(await hashToken(hex)); // hash 原始 hex（不含 dash）方便查詢
  }

  return { plain, hashed };
}

/**
 * 驗證使用者輸入的備用碼是否符合某一筆 hash。
 * @param {string} inputCode  使用者輸入（含 dash 格式，或純 hex）
 * @param {string} storedHash 資料庫中的 code_hash
 * @returns {Promise<boolean>}
 */
export async function verifyBackupCode(inputCode, storedHash) {
  // 移除 dash，取得原始 hex
  const raw = inputCode.replace(/-/g, '').toLowerCase();
  const inputHash = await hashToken(raw);
  if (inputHash.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < inputHash.length; i++) {
    diff |= inputHash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}
