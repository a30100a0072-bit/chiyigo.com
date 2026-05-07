-- One-shot backfill for d1_migrations ledger
-- 0014-0033 were applied via `wrangler d1 execute --file` without writing
-- to d1_migrations. wrangler `migrations apply` therefore reports them as
-- pending. INSERT historical rows with git-commit timestamps (UTC).
-- After this runs once, `wrangler d1 migrations list --remote` should be
-- empty / "No migrations to apply".

INSERT OR IGNORE INTO d1_migrations (name, applied_at) VALUES
  ('0014_pkce_oidc_fields.sql',                '2026-05-01 13:56:05'),
  ('0015_oauth_clients.sql',                   '2026-05-03 08:01:57'),
  ('0016_revoked_jti.sql',                     '2026-05-03 08:01:57'),
  ('0017_audit_log.sql',                       '2026-05-03 08:01:57'),
  ('0018_users_public_sub.sql',                '2026-05-03 08:01:57'),
  ('0019_refresh_tokens_auth_time.sql',        '2026-05-04 13:40:05'),
  ('0020_oauth_clients_seed.sql',              '2026-05-05 03:18:42'),
  ('0021_webauthn.sql',                        '2026-05-05 06:42:30'),
  ('0022_ip_blacklist.sql',                    '2026-05-05 08:09:45'),
  ('0023_user_wallets.sql',                    '2026-05-05 09:51:23'),
  ('0024_user_kyc.sql',                        '2026-05-05 10:24:01'),
  ('0025_payment_intents.sql',                 '2026-05-05 11:04:03'),
  ('0026_requisition_refund_request.sql',      '2026-05-06 07:16:36'),
  ('0027_rrr_requisition_nullable.sql',        '2026-05-06 08:49:09'),
  ('0028_deals.sql',                           '2026-05-06 08:49:09'),
  ('0029_payment_intents_hardening.sql',       '2026-05-06 11:24:45'),
  ('0030_fix_payment_intents_requisition_fk.sql', '2026-05-06 11:38:00'),
  ('0031_refund_request_amount.sql',           '2026-05-06 12:48:27'),
  ('0032_payment_metadata_archive.sql',        '2026-05-06 13:04:07'),
  ('0033_payment_webhook_dlq.sql',             '2026-05-06 13:31:29');
