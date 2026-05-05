-- Migration 0023: 錢包綁定（Phase F-3 SIWE）
--
-- 緣起：
--   IdP 不存 private key（非託管原則）。User 用 wallet 簽 SIWE message
--   證明擁有 address，server 驗章後 INSERT 一筆綁定。未來金流 / NFT /
--   虛擬幣場景靠此 binding 認 user vs wallet。
--
-- 表設計：
--   user_wallets — 已綁的 wallet（可多隻；同 user 同 address 唯一）
--   wallet_nonces — SIWE ceremony 第一步的一次性 nonce（5min TTL）
--                  cleanup cron 自動清過期 row

CREATE TABLE IF NOT EXISTS user_wallets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address       TEXT    NOT NULL,                 -- lowercase 0x... 42 chars
  chain_id      INTEGER NOT NULL DEFAULT 1,        -- 1=Ethereum mainnet
  nickname      TEXT,                              -- 使用者命名
  signed_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  UNIQUE(user_id, address)
);

CREATE INDEX IF NOT EXISTS idx_user_wallets_user      ON user_wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_wallets_address   ON user_wallets(address);

CREATE TABLE IF NOT EXISTS wallet_nonces (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nonce        TEXT    NOT NULL UNIQUE,            -- SIWE 規範的 random nonce
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address      TEXT    NOT NULL,                   -- 預先承諾要綁的 address
  chain_id     INTEGER NOT NULL DEFAULT 1,
  expires_at   TEXT    NOT NULL,                   -- 5 分鐘 TTL
  consumed_at  TEXT,                                -- 一次性消耗
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wallet_nonces_expires  ON wallet_nonces(expires_at);
