-- Migration 0047: Tenant Foundation（B2B 多租戶平台 PR1）
--
-- 上游設計：docs/reviews/pr1-tenant-foundation-plan-2026-05-28.md（✅ codex Gate 1 r1→r3）
--           落實 docs/reviews/chiyigo-platform-architecture-plan-2026-05-28.md §5 / §20。
--
-- 加 tenants + organization_members 兩表，並為既有 user backfill personal tenant。
-- expand-only：不動既有表、不刪欄；既有讀路徑零影響（程式 deploy 後才會讀新表）。
-- 全 idempotent（IF NOT EXISTS / INSERT OR IGNORE），可安全重跑。

-- ── tenants ──────────────────────────────────────────────────────────────────
-- type 為租戶類型唯一判斷依據（決策①；禁用 member_count 等推測）。
-- personal_owner_user_id：僅 personal tenant 有值（= 該 personal tenant 的唯一 owner）；
--   org tenant 一律 NULL。下方 CHECK 強制兩者對應，杜絕半成品 row。
--   注意：這不是被禁的 users.tenant_id —— 它在 tenants 側、只標 personal 歸屬，
--   user 仍可經 organization_members 多對多屬於 N 個 org tenant（多租戶不受限）。
--   它同時是 §6.2 / tenant resolver 的 personal-tenant owner guard 依據（codex r1 Finding 1）。
CREATE TABLE IF NOT EXISTS tenants (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  type                   TEXT    NOT NULL CHECK(type IN ('personal','organization')),
  name                   TEXT    NOT NULL,
  status                 TEXT    NOT NULL DEFAULT 'active'
                                 CHECK(status IN ('active','suspended','closed')),
  personal_owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  deleted_at             TEXT,
  CHECK( (type = 'personal'     AND personal_owner_user_id IS NOT NULL)
      OR (type = 'organization' AND personal_owner_user_id IS NULL) ),
  -- personal tenant 是 user 的 tenant-of-one，生命週期綁 user：停用走 ban user（users.status），
  -- 刪除走 hard-delete user → FK CASCADE 連帶刪此 row。故 personal tenant 不得進 inactive/soft-deleted
  -- 狀態（org tenant 才有 suspended/closed 生命週期）。此 CHECK 讓「inactive personal tenant」DB 層不可達，
  -- 使 fresh-login（resolveActiveTenantClaims）簽出的 active tenant 與 org-switch/list 的 active 篩選一致
  -- （codex Gate-2 High：避免對 inactive/deleted personal tenant 簽出 platform_role=tenant_owner）。
  CHECK( type <> 'personal' OR (status = 'active' AND deleted_at IS NULL) )
);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_type   ON tenants(type);
-- 每個 user 至多一個 personal tenant（ensurePersonalTenant 並發 idempotency 的 DB 護欄）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_personal_owner
  ON tenants(personal_owner_user_id)
  WHERE type = 'personal';

-- ── organization_members（多對多；決策⑤，禁 users.tenant_id）─────────────────────
CREATE TABLE IF NOT EXISTS organization_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  platform_role TEXT    NOT NULL DEFAULT 'member'
                        CHECK(platform_role IN ('tenant_owner','tenant_admin','billing_admin','member')),
  status        TEXT    NOT NULL DEFAULT 'active'
                        CHECK(status IN ('active','invited','suspended')),
  joined_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user        ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_org_members_tenant_role ON organization_members(tenant_id, platform_role);

-- ── backfill：每個未刪 user → personal tenant + owner membership ───────────────
-- INSERT OR IGNORE：partial unique(uq_tenants_personal_owner) + UNIQUE(tenant_id,user_id)
-- 讓 backfill 可重跑不重複建。
INSERT OR IGNORE INTO tenants (type, name, status, personal_owner_user_id, created_at, updated_at)
SELECT 'personal', 'Personal', 'active', u.id, datetime('now'), datetime('now')
FROM users u
WHERE u.deleted_at IS NULL;

INSERT OR IGNORE INTO organization_members (tenant_id, user_id, platform_role, status, joined_at, updated_at)
SELECT t.id, t.personal_owner_user_id, 'tenant_owner', 'active', datetime('now'), datetime('now')
FROM tenants t
WHERE t.type = 'personal' AND t.personal_owner_user_id IS NOT NULL;
