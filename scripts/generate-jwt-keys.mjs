#!/usr/bin/env node
/**
 * ES256 (ECDSA P-256) JWT 金鑰對生成腳本
 *
 * 執行方式：
 *   node scripts/generate-jwt-keys.mjs
 *
 * 用途：
 *   首次部署或金鑰輪換時執行一次。
 *   輸出 JWT_PRIVATE_KEY 與 JWT_PUBLIC_KEY 兩行環境變數（JWK 格式）。
 *   複製後分別存入：
 *     - .dev.vars（本機開發）
 *     - Cloudflare Pages 儀表板 → Settings → Environment variables（生產環境）
 *
 * 安全提醒：
 *   ⚠️  JWT_PRIVATE_KEY 僅此腳本輸出一次，請立即安全存放。
 *   ⚠️  絕對不要將 JWT_PRIVATE_KEY 提交至 Git。
 *   ✅  JWT_PUBLIC_KEY 可安全對外公開（JWKS 端點使用）。
 */

const { subtle } = globalThis.crypto

// ── 1. 生成 ES256 金鑰對 ──────────────────────────────────────
const { privateKey, publicKey } = await subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,        // extractable = true，允許匯出 JWK
  ['sign', 'verify']
)

// ── 2. 匯出為 JWK 格式 ────────────────────────────────────────
const privateJwk = await subtle.exportKey('jwk', privateKey)
const publicJwk  = await subtle.exportKey('jwk', publicKey)

// ── 3. 設定 kid（由公鑰 x 座標前 8 字元衍生，輪換時便於辨識）
const kid = publicJwk.x.slice(0, 8)

Object.assign(privateJwk, { kid, use: 'sig', alg: 'ES256' })
Object.assign(publicJwk,  { kid, use: 'sig', alg: 'ES256' })

// ── 4. 輸出 ──────────────────────────────────────────────────
const SEP = '─'.repeat(72)

console.log('\n✅  ES256 金鑰對生成成功！\n')
console.log('請將以下兩行貼入 .dev.vars（本機）與 Cloudflare Pages 環境變數（生產）：\n')
console.log(SEP)
console.log(`JWT_PRIVATE_KEY=${JSON.stringify(privateJwk)}`)
console.log(`JWT_PUBLIC_KEY=${JSON.stringify(publicJwk)}`)
console.log(SEP)
console.log(`\n🔑  Key ID (kid): ${kid}`)
console.log('⚠️   Private Key 僅此一次顯示，請立即安全存放，勿提交至 Git。\n')
