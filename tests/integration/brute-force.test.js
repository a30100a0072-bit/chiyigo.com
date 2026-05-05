/**
 * Phase E-4 — Brute force protection 整合測試
 *
 * 涵蓋：
 *  - utils/brute-force.js 三個函式（cooldown / blacklisted / detect）
 *  - login.js 接點：cooldown 卡 / IP_BLOCKED 卡 / 自動黑名單觸發 / 隔離
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'
import { resetDb, ensureJwtKeys, seedUser, callFunction, jsonPost } from './_helpers.js'
import {
  getUserCooldownSeconds,
  isIpBlacklisted,
  detectAndBlacklistCrossUserScan,
} from '../../functions/utils/brute-force.js'
import { onRequestPost as loginPost } from '../../functions/api/auth/local/login.js'

async function seedFailRow(email, ip, agoSeconds = 0) {
  // 用 datetime('now', '-Ns') 控制 created_at
  await env.chiyigo_db.prepare(
    `INSERT INTO login_attempts (kind, ip, email, created_at)
     VALUES ('login', ?, ?, datetime('now', ?))`,
  ).bind(ip, email, `-${agoSeconds} seconds`).run()
}

function loginReq(body, ip = '1.1.1.1') {
  return jsonPost('http://x/api/auth/local/login', body, {
    'CF-Connecting-IP': ip,
  })
}

describe('utils/brute-force — getUserCooldownSeconds', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('< 3 次失敗 → 0', async () => {
    for (let i = 0; i < 2; i++) await seedFailRow('a@x', '1.1.1.1')
    const sec = await getUserCooldownSeconds(env.chiyigo_db, 'a@x')
    expect(sec).toBe(0)
  })

  it('3 次失敗 → 5 秒 cooldown，且隨時間遞減', async () => {
    for (let i = 0; i < 3; i++) await seedFailRow('a@x', '1.1.1.1')
    const sec = await getUserCooldownSeconds(env.chiyigo_db, 'a@x')
    expect(sec).toBeGreaterThan(0)
    expect(sec).toBeLessThanOrEqual(5)
  })

  it('5 次失敗 → 30 秒階梯', async () => {
    for (let i = 0; i < 5; i++) await seedFailRow('a@x', '1.1.1.1')
    const sec = await getUserCooldownSeconds(env.chiyigo_db, 'a@x')
    expect(sec).toBeGreaterThan(5)
    expect(sec).toBeLessThanOrEqual(30)
  })

  it('10 次失敗 → 1hr (3600s) 階梯', async () => {
    for (let i = 0; i < 10; i++) await seedFailRow('a@x', '1.1.1.1')
    const sec = await getUserCooldownSeconds(env.chiyigo_db, 'a@x')
    expect(sec).toBeGreaterThan(300)
    expect(sec).toBeLessThanOrEqual(3600)
  })

  it('上次失敗已過 cooldown → 回 0', async () => {
    // 3 次失敗都是 60 秒前 → cooldown 5s 已過
    for (let i = 0; i < 3; i++) await seedFailRow('a@x', '1.1.1.1', 60)
    const sec = await getUserCooldownSeconds(env.chiyigo_db, 'a@x')
    expect(sec).toBe(0)
  })

  it('30min 視窗外的失敗不算', async () => {
    for (let i = 0; i < 5; i++) await seedFailRow('a@x', '1.1.1.1', 3600)  // 1hr 前
    const sec = await getUserCooldownSeconds(env.chiyigo_db, 'a@x')
    expect(sec).toBe(0)
  })
})

describe('utils/brute-force — isIpBlacklisted', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('未在黑名單 → null', async () => {
    expect(await isIpBlacklisted(env.chiyigo_db, '1.1.1.1')).toBeNull()
  })

  it('在黑名單且未過期 → 回 reason + expires', async () => {
    const exp = new Date(Date.now() + 3600_000).toISOString().replace('T', ' ').slice(0, 19)
    await env.chiyigo_db.prepare(
      `INSERT INTO ip_blacklist (ip, reason, expires_at) VALUES (?, ?, ?)`,
    ).bind('5.5.5.5', 'cross_user_scan', exp).run()

    const r = await isIpBlacklisted(env.chiyigo_db, '5.5.5.5')
    expect(r?.blocked).toBe(true)
    expect(r?.reason).toBe('cross_user_scan')
  })

  it('過期黑名單 → null（不擋）', async () => {
    const exp = new Date(Date.now() - 1000).toISOString().replace('T', ' ').slice(0, 19)
    await env.chiyigo_db.prepare(
      `INSERT INTO ip_blacklist (ip, reason, expires_at) VALUES (?, ?, ?)`,
    ).bind('6.6.6.6', 'expired', exp).run()
    expect(await isIpBlacklisted(env.chiyigo_db, '6.6.6.6')).toBeNull()
  })
})

describe('utils/brute-force — detectAndBlacklistCrossUserScan', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('< 10 distinct emails → 不黑名單', async () => {
    for (let i = 0; i < 9; i++) await seedFailRow(`u${i}@x`, '7.7.7.7')
    const hit = await detectAndBlacklistCrossUserScan(env.chiyigo_db, '7.7.7.7')
    expect(hit).toBe(false)
    const row = await env.chiyigo_db.prepare(
      `SELECT 1 FROM ip_blacklist WHERE ip = '7.7.7.7'`,
    ).first()
    expect(row).toBeNull()
  })

  it('= 10 distinct emails → 黑名單 24hr', async () => {
    for (let i = 0; i < 10; i++) await seedFailRow(`u${i}@x`, '8.8.8.8')
    const hit = await detectAndBlacklistCrossUserScan(env.chiyigo_db, '8.8.8.8')
    expect(hit).toBe(true)
    const row = await env.chiyigo_db.prepare(
      `SELECT reason, expires_at FROM ip_blacklist WHERE ip = '8.8.8.8'`,
    ).first()
    expect(row?.reason).toBe('cross_user_scan')
    // expires_at 大致是 24hr 後（容許 1min 誤差）
    const expMs = Date.parse(row.expires_at.replace(' ', 'T') + 'Z')
    expect(expMs - Date.now()).toBeGreaterThan(23 * 3600_000)
    expect(expMs - Date.now()).toBeLessThan(25 * 3600_000)
  })

  it('1hr 視窗外的 attempts 不算', async () => {
    for (let i = 0; i < 15; i++) await seedFailRow(`u${i}@x`, '9.9.9.9', 7200)
    const hit = await detectAndBlacklistCrossUserScan(env.chiyigo_db, '9.9.9.9')
    expect(hit).toBe(false)
  })
})

describe('login.js E-4 接點', () => {
  beforeAll(async () => { await ensureJwtKeys() })
  beforeEach(async () => { await resetDb() })

  it('IP 黑名單 → 429 IP_BLOCKED + critical audit', async () => {
    await seedUser({ email: 'normal@x', password: 'GoodPass#1234' })
    const exp = new Date(Date.now() + 3600_000).toISOString().replace('T', ' ').slice(0, 19)
    await env.chiyigo_db.prepare(
      `INSERT INTO ip_blacklist (ip, reason, expires_at) VALUES (?, ?, ?)`,
    ).bind('10.10.10.10', 'cross_user_scan', exp).run()

    const res = await callFunction(loginPost, loginReq(
      { email: 'normal@x', password: 'GoodPass#1234' }, '10.10.10.10',
    ))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.code).toBe('IP_BLOCKED')

    const audit = await env.chiyigo_db.prepare(
      `SELECT severity FROM audit_log WHERE event_type = 'auth.login.ip_blacklisted'`,
    ).first()
    expect(audit?.severity).toBe('critical')
  })

  it('連續失敗 ≥3 次 → cooldown 攔下次嘗試', async () => {
    await seedUser({ email: 'cd@x', password: 'GoodPass#1234' })
    // 3 筆同 email 失敗（不同 IP 避開 IP 限流）
    for (let i = 0; i < 3; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, ip, email) VALUES ('login', ?, ?)`,
      ).bind(`192.168.1.${i}`, 'cd@x').run()
    }
    const res = await callFunction(loginPost, loginReq(
      { email: 'cd@x', password: 'GoodPass#1234' }, '11.11.11.11',
    ))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.code).toBe('COOLDOWN')
    expect(body.retry_after).toBeGreaterThan(0)
  })

  it('自動黑名單：同 IP 撞 10 個 distinct email → critical audit + 下次 IP 直接擋', async () => {
    // 預埋 9 筆 distinct email 從同 IP，之後 1 次密碼錯造成第 10 筆 → 觸發黑名單
    // 預埋 row 都用 5min 前的時間，避開 5/IP/min 但保留在 1hr scan window 內
    const ip = '13.13.13.13'
    for (let i = 0; i < 9; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, ip, email, created_at)
         VALUES ('login', ?, ?, datetime('now', '-5 minutes'))`,
      ).bind(ip, `victim${i}@x`).run()
    }
    await seedUser({ email: 'victim9@x', password: 'GoodPass#1234' })

    const r1 = await callFunction(loginPost, loginReq(
      { email: 'victim9@x', password: 'wrong' }, ip,
    ))
    // 這次密碼錯 → 401 + 同時觸發黑名單寫入
    expect(r1.status).toBe(401)

    const blRow = await env.chiyigo_db.prepare(
      `SELECT reason FROM ip_blacklist WHERE ip = ?`,
    ).bind(ip).first()
    expect(blRow?.reason).toContain('cross_user_scan')

    const audit = await env.chiyigo_db.prepare(
      `SELECT 1 FROM audit_log WHERE event_type = 'auth.login.ip_blacklist_added'`,
    ).first()
    expect(audit).not.toBeNull()

    // 下次同 IP 任何 login → 直接 IP_BLOCKED
    const r2 = await callFunction(loginPost, loginReq(
      { email: 'victim9@x', password: 'GoodPass#1234' }, ip,
    ))
    expect(r2.status).toBe(429)
    expect((await r2.json()).code).toBe('IP_BLOCKED')
  })

  it('成功登入清空 login_attempts → cooldown 重置', async () => {
    const u = await seedUser({ email: 'clear@x', password: 'GoodPass#1234' })
    void u
    for (let i = 0; i < 3; i++) {
      await env.chiyigo_db.prepare(
        `INSERT INTO login_attempts (kind, ip, email) VALUES ('login', ?, ?)`,
      ).bind(`192.168.2.${i}`, 'clear@x').run()
    }
    // 雖然有 3 筆失敗，cooldown 5 秒；等 6 秒前的登入沒法測（不能等），
    // 改驗：cooldown 過後（query 'last_at' 用 60s ago seed → cooldown=0），可登入成功 → 清空
    await env.chiyigo_db.prepare(`DELETE FROM login_attempts WHERE email = 'clear@x'`).run()
    for (let i = 0; i < 3; i++) await seedFailRow('clear@x', '1.2.3.4', 60)  // 60s ago
    const res = await callFunction(loginPost, loginReq(
      { email: 'clear@x', password: 'GoodPass#1234' }, '14.14.14.14',
    ))
    expect(res.status).toBe(200)
    // 成功登入後該 email 的 login_attempts 應被清空（既有行為）
    const cnt = await env.chiyigo_db.prepare(
      `SELECT COUNT(*) AS n FROM login_attempts WHERE email = 'clear@x'`,
    ).first()
    expect(cnt.n).toBe(0)
  })
})
