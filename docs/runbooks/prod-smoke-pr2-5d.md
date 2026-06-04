# Production positive-smoke checklist — PR2–5d (billing / wallet / invitation / member / account / session events)

- Created: 2026-06-04. A RE-RUNNABLE standard (not a one-off). Run it whenever the deferred positive paths need
  real-prod verification (after a relevant deploy, or to clear the standing owner-waiver).
- Why it exists: PR2–5d shipped with **positive prod smoke owner-waiver-DEFERRED** — only local integration + a
  credential-free smoke (homepage 200 / unauth endpoints → 401/403) were run in prod. This is the concrete,
  executable standard for the POSITIVE paths, so the verification is one fixed standard, not scattered in memory.
- **VERIFICATION PRINCIPLE (Codex):** every emitting step verifies the **actual chain** — D1 mutation **+** audit_log
  **+** event_outbox emission **+** (run the consumer) **+** event_deny_state — **NOT** a UI 200 / API 2xx alone.

--------------------------------------------------------------------------------
## 0. Safety + secret hygiene (READ FIRST)
--------------------------------------------------------------------------------

- **NEVER paste tokens / passwords / CRON_SECRET / raw refresh tokens into any chat or transcript** (feedback_secret_
  container_no_generic_grep). Capture results as COUNTS / STATES / eventIds, never raw secrets.
- Use **throwaway test accounts + a test ORGANIZATION tenant**, never real customer data. The operations are REAL
  (a ban bans a real user; an offboard removes a real membership) — restore with unban / reactivate / re-grant after.
- Prod HTML is cached (max-age 14400) — use an **incognito window** for UI steps (feedback_prod_verify_incognito).
- `event_outbox` / `event_deny_state` / `*_ledger` rows are append-only history — **read only; never delete**.

--------------------------------------------------------------------------------
## 1. Preconditions
--------------------------------------------------------------------------------

- Accounts: **ADMIN** (role admin/super_admin) + **TARGET** user + **INVITEE** user; a test **organization** tenant `T`.
- Browser with Turnstile (incognito) OR **Codex headless Chrome** (reference_codex_prod_verification 4-step).
- D1 read access: `wrangler d1 execute chiyigo_db --remote --command "<SELECT ...>"` (read-only).
- CRON_SECRET configured (Cloudflare secret) — used only as a Bearer header on the consumer call; do NOT echo it.
- **Baseline first** (so deltas are unambiguous), e.g.:
  `SELECT (SELECT COUNT(*) FROM event_outbox) AS outbox, (SELECT COUNT(*) FROM event_deny_state) AS deny;`

--------------------------------------------------------------------------------
## 2. The consumer (advances event_outbox → event_deny_state) — run after each emitting step
--------------------------------------------------------------------------------

`POST https://chiyigo.com/api/admin/cron/event-outbox` with header `Authorization: Bearer <CRON_SECRET>` →
200 + a run report `{swept, claimed, delivered, noop, retried, dlq, gap, fenced, errors[]}`. The 5-min cron also runs
it, but call it manually so the projection is checkable immediately. An event is only in `event_deny_state` AFTER a
consumer run delivers it (status pending → done).

--------------------------------------------------------------------------------
## 3. Sequence — each step: ACTION → EXPECT → VERIFY (D1 / audit / outbox / consumer / projection)
--------------------------------------------------------------------------------

Reference — stream keys + deny effects (frozen contract, domain-events.ts):
- member.invited → `tenant:T:member:<email>` (effect none) · member.joined → `tenant:T:member:<sub>` (undeny)
- member.suspended/offboarded → `tenant:T:member:<sub>` (deny) · reactivated (undeny) · role_changed (soft)
- account.disabled → `account:<sub>` (deny) · account.reenabled (undeny)
- session.revoked → `session:<sub>:device:<ref>` (deny; one-way)

### A. PR2 — billing grant (Option B permanent entitlement)  [D1 + audit + entitlements; NO outbox]
- ACTION: admin step-up (scope `elevated:billing`, for_action `grant_plan`; + the JWT must carry `admin:billing:grant`) → `POST /api/admin/billing/grant`, body (snake_case; **`tenant_id` + `product_id` + `plan_id` are ALL required**; `manual_source` MUST be `admin_override` or `offline_payment`):
  ```json
  { "tenant_id": T, "product_id": "<p>", "plan_id": <planId>, "manual_source": "admin_override", "admin_idempotency_key": "<uuid>", "grant_reason": "smoke" }
  ```
  (the `offline_payment` variant uses `payment_ref` instead of `grant_reason`. A bad `manual_source` / a missing id → 400 ERR_VALIDATION.)
- EXPECT: **200** `{ ok:true, operation_id, status, version }` (a repeat with the same `admin_idempotency_key` → 200 `replay:true`).
- VERIFY D1: `SELECT * FROM tenant_product_access WHERE tenant_id=T;` → an active access row; `SELECT * FROM grant_plan_operations WHERE tenant_id=T ORDER BY id DESC LIMIT 1;` → the grant op (idempotency record).
- VERIFY audit: `SELECT event_type,severity FROM audit_log WHERE event_type='billing.grant.applied' AND user_id=<admin> ORDER BY id DESC LIMIT 1;`
- VERIFY entitlement: `GET /api/tenants/T/entitlements` (as a member) reflects the granted product.
- NOTE: PR2 emits NO domain event (product_access.* deferred to F-2) → no outbox/consumer step here.

### B. PR3 — credit wallet topup / adjust / quota  [D1 + audit; NO outbox]
All three are admin step-up `elevated:billing` + effective `admin:billing:wallet`, but DIFFERENT for_action + method + body.
The credit ledger is `credit_ledger(entry_type, amount, balance_after, ...)` — there is NO `delta`/`reason` column there;
`reason`/`new_limit` live in `quota_config_ledger` (quota only).

- **B1 topup** — step-up for_action `wallet_topup` → `POST /api/admin/billing/wallets/T/topup`, body `{ "amount": 100, "admin_idempotency_key": "<uuid>", "ref": "smoke" }` → EXPECT 200.
  - D1: `SELECT balance FROM credit_wallets WHERE tenant_id=T;` increased by amount;
    `SELECT entry_type, amount, balance_after FROM credit_ledger WHERE tenant_id=T AND entry_type='topup' ORDER BY id DESC LIMIT 1;`
  - view: `GET /api/tenants/T/wallet` shows the new balance. audit: `billing.*` (or `billing.credit.*`) event.
- **B2 adjust** — step-up for_action `wallet_adjust` → `POST /api/admin/billing/wallets/T/adjust`, body `{ "amount": 10, "direction": "credit", "admin_idempotency_key": "<uuid>", "reason": "smoke" }` → EXPECT 200.
  - D1: `SELECT entry_type, amount, balance_after, ref FROM credit_ledger WHERE tenant_id=T AND entry_type='adjust' ORDER BY id DESC LIMIT 1;` (reason is stored in `ref`).
- **B3 quota** — step-up for_action `quota_set`, **PUT** (not POST) → `PUT /api/admin/billing/quotas/T/<productId>`, body `{ "quota_limit": 1000, "period": "lifetime", "admin_idempotency_key": "<uuid>", "reason": "smoke" }` → EXPECT 200.
  - D1: `SELECT quota_limit FROM product_usage_quota WHERE tenant_id=T AND product_id='<p>' AND period='lifetime';`
    `SELECT old_limit, new_limit, reason FROM quota_config_ledger WHERE tenant_id=T AND product_id='<p>' ORDER BY id DESC LIMIT 1;`

### C. PR4 — invitation → accept  [D1 + audit + outbox + consumer + projection]
- CREATE (tenant owner/admin): `POST /api/tenants/T/invitations`, body `{ "email": "<invitee>", "platform_role": "member" }` (snake_case keys — an unknown key → 400) → EXPECT **201** `{ ok:true, invitation_id }` (409 ALREADY_MEMBER / 422 TENANT_INELIGIBLE on those paths).
  - D1: `SELECT status FROM invitations WHERE tenant_id=T AND email='<invitee>';` = pending.
  - outbox: `SELECT stream_key,stream_seq,status FROM event_outbox WHERE event_type='member.invited' AND stream_key='tenant:T:member:<invitee-email>';` exists. (rawToken travels in the invite EMAIL link.)
- ACCEPT (the INVITEE, with their regular access token): `POST /api/invitations/accept`, body `{ "token": "<rawToken>" }` → EXPECT 200 joined.
  - D1: `SELECT status FROM organization_members WHERE tenant_id=T AND user_id=<invitee-sub>;` = active.
  - outbox: `event_outbox` has `member.joined` at `tenant:T:member:<invitee-sub>`.
- CONSUMER → VERIFY BOTH stream projections (run §2 first):
  - joined (undeny): `SELECT denied,deny_effect,last_applied_seq FROM event_deny_state WHERE stream_key='tenant:T:member:<invitee-sub>';` → denied=0, deny_effect='undeny', seq advanced.
  - **invited (effect NONE — Codex #3, don't false-pass on denied alone):** the consumer STILL applies a 'none' event
    (advances the cursor). Verify `SELECT status FROM event_outbox WHERE stream_key='tenant:T:member:<invitee-email>';`
    = **'done'** AND `SELECT denied,deny_effect,last_applied_seq FROM event_deny_state WHERE stream_key='tenant:T:member:<invitee-email>';`
    → deny_effect='none', denied=0, last_applied_seq advanced (proves the consumer PROCESSED it, not silently skipped).

### D. PR4 — member suspend / reactivate / role_change / offboard  [outbox + consumer + projection]
For TARGET membership in `T` (`POST /api/tenants/T/members/<sub>/<action>`; role via `.../role`):
- suspend → member.suspended; consumer → `event_deny_state` `tenant:T:member:<sub>` denied=1.
- reactivate → member.reactivated; consumer → denied=0.
- role (change platform_role via `.../role`) → member.role_changed (**soft** — denied stays the same, so denied alone
  CAN'T confirm processing, Codex #3): verify organization_members.platform_role changed AND the outbox row
  `status='done'` after consumer AND `event_deny_state.last_applied_seq` ADVANCED (deny_effect='soft', denied unchanged).
- offboard → organization_members row removed; member.offboarded; consumer → denied=1.
(Each: verify the D1 row change + the matching `event_outbox` row + post-consumer `event_deny_state` — for deny/undeny
check `denied`; for soft/none ALSO check outbox `status='done'` + `last_applied_seq` advanced, never `denied` alone.)

### E. 5c — account ban / unban  [D1 + audit + outbox + consumer + projection]
- BAN: `POST /api/admin/users/<sub>/ban` → `SELECT status FROM users WHERE id=<sub>;`=banned; `event_outbox` `account.disabled` at `account:<sub>`; audit `admin.*` ban event; consumer → `event_deny_state` `account:<sub>` denied=1.
- UNBAN: `POST /api/admin/users/<sub>/unban` → status=active; `account.reenabled` outbox; consumer → denied=0.

### F. 5d-2 — session revoke  [D1 + audit + outbox + consumer + projection]
- SELF LOGOUT: `POST /api/auth/logout` (refresh cookie/body) → the family's refresh_tokens `revoked_at` set; `event_outbox` `session.revoked` at `session:<sub>:device:<ref>`; consumer → `event_deny_state` denied=1. (ref = the per-login `COALESCE(session_id,'legacy_'||id)`.)
- DEVICES LOGOUT: `POST /api/auth/devices/logout` {device_uuid} → ONE session.revoked per live family on that device; consumer → each denied=1.
- ADMIN DEVICE REVOKE: `POST /api/admin/revoke` {mode:'device', user_id, device_uuid} → same (actor = admin).
- RE-LOGIN CLEAN (contract proof): after a revoke, log in AGAIN on the same browser → a NEW session_id → a NEW streamKey with NO projection row (`event_deny_state` absent / denied=0) — proves "re-login is never permanently denied".
- NEGATIVE: `POST /api/admin/revoke` {mode:'user'} (token_version bump) and a ban → assert ZERO new `session.revoked` outbox rows (token-epoch ≠ deny subject).

### G. 5d-2 large-N alarm (#19) — observability [optional]
- A multi-family revoke whose live-family count on one device exceeds `SESSION_REVOKE_LARGE_N_THRESHOLD` (default 50)
  → the endpoint audit carries `data.large_n=true,n,threshold` (devices/logout severity warn; admin critical), even
  on full success. Hard to exercise in prod (needs many live logins on one device) → primarily integration-tested;
  optional here. If exercised: `SELECT event_data FROM audit_log WHERE event_type IN ('auth.devices.logout','admin.token.revoked.device') ORDER BY id DESC LIMIT 1;` → `large_n`.

### H. 5b — consumer / DLQ (cron already live)
- Confirm the manual consumer call (§2) returns a clean run report and that the steps above moved `event_outbox`
  rows to status `done`. (Optional) DLQ replay: `POST /api/admin/event-dlq/<id>/replay` (scope admin:events:replay +
  step-up) — only if a dead row exists.

--------------------------------------------------------------------------------
## 4. Pass criteria
--------------------------------------------------------------------------------

PER EMITTING OP (C–F), ALL of: ✅ D1 mutation present · ✅ audit_log entry · ✅ event_outbox row · ✅ consumer run
advances it (status done, run report counts move) · ✅ event_deny_state reflects the DENY_EFFECT. For PR2/PR3 (A–B):
✅ D1 rows + ✅ audit + ✅ read-back endpoint. **A UI 200 / API 2xx alone is NOT a pass** (Codex observability finding).

--------------------------------------------------------------------------------
## 5. Recording + restore
--------------------------------------------------------------------------------

- Record a pass/fail row per step (A–H) with the observed counts/states. On a FAIL, capture the `eventId` +
  `stream_key` (NEVER raw tokens) for forensic lookup in event_outbox / event_dlq.
- Restore test state afterwards: unban, reactivate, re-grant as needed. Leave append-only history intact.

--------------------------------------------------------------------------------
## 6. Execution options
--------------------------------------------------------------------------------

- OWNER manual: incognito browser for the authenticated UI/flows + `wrangler d1 execute --remote` for the SELECTs.
- CODEX headless Chrome: hand this file to Codex and run the 4-step prod-verification flow (reference_codex_prod_
  verification) — the consumer call + D1 SELECTs are scriptable; the login/Turnstile steps run in headless Chrome.

--- END prod-smoke checklist (PR2–5d) ---
