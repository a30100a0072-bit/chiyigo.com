/**
 * Tenant context resolver（B2B 多租戶平台 PR1 — Tenant Foundation）
 *
 * 設計：docs/reviews/pr1-tenant-foundation-plan-2026-05-28.md §5（codex Gate 1 r1→r3 approved）。
 *
 * 三個職責：
 *  1. ensurePersonalTenant —— 確保每個 user 有「自己的 personal tenant + owner membership」，
 *     idempotent / 並發安全（靠 migration 0047 的 partial unique uq_tenants_personal_owner
 *     + organization_members UNIQUE(tenant_id,user_id)）。覆蓋所有 user-creation 路徑
 *     （register / oauth callback / bind-email），不必逐一改 INSERT。
 *  2. resolveActiveTenantClaims —— fresh-login 簽 token 用：active tenant 預設 = personal tenant，
 *     platform_role 永遠 tenant_owner（personal tenant 定義即單一 owner）。
 *  3. resolveIssuanceContextForTenant —— org-switch 用：fail-closed invariant（§20 驗收門）。
 *     tenant_id 一律取自「驗章後的 token sub」或「此函式驗過的 target」，禁信 client 原始輸入。
 *
 * 安全不變量：
 *  - platform_role 一律由 DB membership row 推導，**禁信 client 傳入**。
 *  - personal tenant 只能由其 owner 進入（擋「錯誤 membership row」指向他人 personal tenant，
 *    codex r1 Finding 1）。
 *  - 任何不確定 → fail-closed（{ ok:false }，caller 一律 403 / 不發 token）。
 */

export type PlatformRole = 'tenant_owner' | 'tenant_admin' | 'billing_admin' | 'member'

/** 簽進 access_token 的 tenant claim delta（active tenant + 該 tenant 上的 platform_role）。 */
export type TenantClaims = { tenant_id: number; platform_role: PlatformRole }

/** org-switch / 帶 target tenant 的 issuance 結果（fail-closed）。 */
export type IssuanceResult =
  | { ok: true; tenant_id: number; platform_role: PlatformRole }
  | {
      ok: false
      code:
        | 'TENANT_NOT_FOUND'
        | 'TENANT_NOT_ACTIVE'
        | 'NOT_A_MEMBER'
        | 'MEMBERSHIP_NOT_ACTIVE'
        | 'PERSONAL_TENANT_FOREIGN'
    }

/**
 * D1 binding 型別。取自 ambient `Env`（types/env.d.ts）的 indexed access，
 * 避免在 source 直接引用 `D1Database` global —— 它只在 .d.ts（skipLibCheck）可見，
 * source 檔直接命名會 TS2552。codebase 慣例即走 `Env` 而非裸 CF binding 型別。
 */
type ChiyigoDb = Env['chiyigo_db']

/**
 * 確保 userId 有 personal tenant（+ owner membership），回傳該 tenant id。
 *
 * Idempotent / 並發安全：
 *  - 先讀；命中（backfill 過或非首次登入）→ 1 query。
 *  - 漏建 → INSERT OR IGNORE（partial unique uq_tenants_personal_owner 讓並發只成功一筆）→ re-read。
 *  - owner membership 用 UPSERT：補漏 + 自癒既存 inactive/非 owner → active + tenant_owner
 *    （personal tenant owner 恆 active；D1 單語句非跨表交易，故每次登入補一次）。
 *  - 註：personal tenant 本身的 always-active 由 migration 0047 的 CHECK 在 DB 層保證（不可變 inactive）。
 */
export async function ensurePersonalTenant(db: ChiyigoDb, userId: number): Promise<number> {
  let row = await db
    .prepare(`SELECT id FROM tenants WHERE type = 'personal' AND personal_owner_user_id = ?`)
    .bind(userId)
    .first<{ id: number }>()

  if (!row) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO tenants (type, name, status, personal_owner_user_id)
         VALUES ('personal', 'Personal', 'active', ?)`,
      )
      .bind(userId)
      .run()
    row = await db
      .prepare(`SELECT id FROM tenants WHERE type = 'personal' AND personal_owner_user_id = ?`)
      .bind(userId)
      .first<{ id: number }>()
    if (!row) {
      // 不該發生（剛 INSERT OR IGNORE）；fail-loud 勝過回錯誤 tenant id。
      throw new Error(`ensurePersonalTenant: personal tenant missing after insert for user ${userId}`)
    }
  }

  // UPSERT（非 INSERT OR IGNORE）：personal tenant 的 owner membership 必須 always-active；
  // 若既存 row 被某路徑置為 inactive（suspended）/ 非 tenant_owner，登入時自癒回 active + tenant_owner，
  // 使 fresh-login claim 與 org-switch/list 的 active-membership 篩選一致（codex Gate-2 High）。
  await db
    .prepare(
      `INSERT INTO organization_members (tenant_id, user_id, platform_role, status)
       VALUES (?, ?, 'tenant_owner', 'active')
       ON CONFLICT(tenant_id, user_id)
       DO UPDATE SET status = 'active', platform_role = 'tenant_owner', updated_at = datetime('now')`,
    )
    .bind(row.id, userId)
    .run()

  return row.id
}

/**
 * fresh-login 簽 token 用：active tenant = 使用者的 personal tenant。
 * personal tenant 的 owner 永遠是 tenant_owner，故無需查 membership。
 */
export async function resolveActiveTenantClaims(db: ChiyigoDb, userId: number): Promise<TenantClaims> {
  const tenantId = await ensurePersonalTenant(db, userId)
  return { tenant_id: tenantId, platform_role: 'tenant_owner' }
}

/**
 * org-switch 用：驗 userId 能否切到 targetTenantId，並回該 tenant 上的 platform_role。
 * fail-closed invariant（§20 PR1 驗收門）：任一不符回 { ok:false }，caller 一律 403。
 */
export async function resolveIssuanceContextForTenant(
  db: ChiyigoDb,
  userId: number,
  targetTenantId: number,
): Promise<IssuanceResult> {
  // 1. tenant 存在 + active（soft-deleted 視為不存在）
  const tenant = await db
    .prepare(
      `SELECT id, type, status, personal_owner_user_id, deleted_at FROM tenants WHERE id = ?`,
    )
    .bind(targetTenantId)
    .first<{
      id: number
      type: string
      status: string
      personal_owner_user_id: number | null
      deleted_at: string | null
    }>()
  if (!tenant || tenant.deleted_at !== null) return { ok: false, code: 'TENANT_NOT_FOUND' }
  if (tenant.status !== 'active') return { ok: false, code: 'TENANT_NOT_ACTIVE' }

  // 2. membership 存在 + active
  const m = await db
    .prepare(
      `SELECT platform_role, status FROM organization_members WHERE tenant_id = ? AND user_id = ?`,
    )
    .bind(targetTenantId, userId)
    .first<{ platform_role: string; status: string }>()
  if (!m) return { ok: false, code: 'NOT_A_MEMBER' }
  if (m.status !== 'active') return { ok: false, code: 'MEMBERSHIP_NOT_ACTIVE' }

  // 3. personal tenant owner guard（codex r1 Finding 1）：
  //    personal tenant 只能由其 owner 進入；擋「錯誤 membership row」指向他人 personal tenant。
  if (tenant.type === 'personal' && tenant.personal_owner_user_id !== userId) {
    return { ok: false, code: 'PERSONAL_TENANT_FOREIGN' }
  }

  // 4. platform_role 由 DB 推導（禁信 client）。
  //    SAFETY: organization_members.platform_role 受 migration 0047 CHECK 約束在 PlatformRole 4 值內。
  return { ok: true, tenant_id: tenant.id, platform_role: m.platform_role as PlatformRole }
}
