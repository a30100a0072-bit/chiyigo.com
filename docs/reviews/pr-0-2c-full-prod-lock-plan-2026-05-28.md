# PR 0.2c Full Prod Lock — Execution Plan

**狀態**：draft v1 — 待 codex review
**作者**：Claude（plan first written at main HEAD `4a1be03`，2026-05-28）
**為何存在**：PR 0.2c-pre-3 全段結（preview-gate-binding-canary PASS，HEAD `830b5d2`）+ sacrificial cleanup 完成（2026-05-28 ~08:00 local Taipei）後，prod lock 18+18=36 rules 是 F-3 Phase 2 cold archive 最後一道**不可逆 7yr** gate。本檔是 Phase 1 prep — 給 codex 在 user 走 walk-through 前 review 完整 36-cmd 序列、失敗劇本、open question。Codex Approve 後 user 才會親自走 Phase 2 walk-through 與 Phase 3 execute；本 session 不會 fire 任何 prod-touching cmd（含 read-only list）。
**範圍**：對 prod bucket `chiyigo-audit-archive` 一次性執行 18 條 `r2 bucket lock add` + 18 條 `r2 bucket lifecycle add`，依 `docs/AUDIT_RETENTION_PLAN.md` line 906 SoT。
**不可逆度**：**最大** — `retention-days` 從 365 / 1095 / 2555 設下去後，對應 prefix 7 年內無 `DELETE` 路徑（admin / root token 都不行）；rollback 只剩「等過期」/「CF support compliance ticket」/「改 cold_class 走新 prefix 棄舊」三條（皆遠高於多花 30 min walk-through）。
**請 codex review**：（a）36 rules manifest 與 line 906 SoT 是否 1:1 對齊；（b）wrangler cmd shape 是否與 `scripts/spike-r2-lock.mjs:270/273` 既有 pattern 一致；（c）partial state 處理是否考慮周全；（d）lock 與 lifecycle 上序、aggregate vs raw 上序是否最小化爆炸半徑；（e）失敗劇本是否漏掉真實場景。

---

## §1 觸發前提（gate 全 PASS 證據）

執行 PR 0.2c full prod lock 的**全部前提**必須在執行前重新對齊。Phase 1 收尾不檢查 prod live state（避免無謂 read-only call）；Phase 2 walk-through 開始前由 user 親自確認，Phase 3 動工前每條再 inline 確認一次。

### 1.1 子 PR gate chain 全 PASS

| Gate | 完成日 | 驗證點 | 來源 |
|---|---|---|---|
| 0.2c-pre-1a（write-once R2 key + state-suffix manifest） | 2026-05-22 | runFreshChunkPipeline 硬寫死 `KEY_SCHEME_WRITE_ONCE` | [[project_audit_phase2]] |
| 0.2c-pre-1b（S3 sigv4 spike 親驗 lock enforce） | 2026-05-23 | fixture `docs/fixtures/r2-lock-spike-2026-05-23.json` | [[project_audit_phase2]] § PR 0.2c-pre-1b |
| 0.2c-pre-1b.1（Worker binding canary on preview bucket） | 2026-05-24 | outcome (b) — binding enforce + classifier MISS；fixture `r2-lock-binding-canary-2026-05-24.json` | [[project_audit_phase2]] § PR 0.2c-pre-1b.1 |
| 0.2c-pre-1b.2（isR2LockError canonical phrase + numeric code path） | 2026-05-24 | classifier 加 path (2) message-pattern + `R2_LOCK_KNOWN_NUMERIC_CODES={10069}` | [[project_audit_phase2]] § PR 0.2c-pre-1b.2 |
| 0.2c-pre-1c（aggregate worker write-once parallel refactor） | 2026-05-24 | telemetry + debug runner state-suffix manifest + lock-aware retry + aggregate-namespaced emit | [[project_audit_phase2]] § PR 0.2c-pre-1c |
| 0.2c-pre-2（force_purge 423 catch raw + aggregate） | 2026-05-24 | retry endpoint isR2LockError → 423 + `R2_LOCK_DETECTED` + `force_purge_blocked_by_lock` critical emit | [[project_audit_phase2]] § PR 0.2c-pre-2 |
| 0.2c-pre-3（preview-gate-binding-canary on **prod bucket**） | 2026-05-25 | 6-op canary 全 7 HARD AND PASS；fixture `docs/fixtures/preview-gate-binding-canary-20260525-131627.json`；prod binding throw shape === preview fixture | [[project_audit_phase2]] § PR 0.2c-pre-3 全段結 |
| 0.2c-pre-3 sacrificial cleanup | 2026-05-28 ~08:00 local Taipei | sacrificial lock rule + lifecycle rule removed；`bucket lock list` 空；`bucket lifecycle list` 只剩 `Default Multipart Abort Rule` | [[project_audit_phase2]] § 24h sacrificial lock state |

**全部已 PASS**。執行 Phase 3 不再回溯這些 gate。

### 1.2 14-day post-lock watch 屬於上線後

PR 0.2c **完成後**才開始 14-day no-incident watch（監控 `audit.archive.r2_lock_detected` / `audit.aggregate_archive.{telemetry,debug}.r2_lock_detected` / `*.force_purge_blocked_by_lock` 任一非零 emit）。**不阻**本 PR Phase 3 動工。

### 1.3 環境前提

- wrangler version：**4.87.0**（與 0.2c-pre-3 canary baseline 一致，不升）
- 執行帳號：a3010030100a@gmail.com（user [[user_profile]]）
- Account ID：`2d2c4b4ddbddec1a5d045533c01d715f`（[[cloudflare_credentials]]）
- Prod bucket：`chiyigo-audit-archive`（與 0.2c-pre-3 同）
- Terminal：**fresh PowerShell**，**不**在 Claude Code 連的 IDE（避免 [[feedback_ide_selection_auto_echo_leak]]）
- OS：Windows 10 / PowerShell 5.1

---

## §2 36 rules manifest（per `docs/AUDIT_RETENTION_PLAN.md` line 906 SoT）

**全 18 個 prefix × 2 種 rule（lock + lifecycle）= 36 條規則**。Lock retention-days 與 lifecycle expire-days 永遠差 2（lifecycle 給 lock 過期後 +2 day cushion 才開始物理刪除）。

### 2.1 Raw audit-log/ (7 prefix × 2 = 14 rules)

| # | prefix | retention-days | expire-days | cold_class | rule name (lock) | rule name (lifecycle) |
|---|---|---|---|---|---|---|
| 1 | `audit-log/prod/audit_log/immutable/` | 2555 (7y) | 2557 | raw immutable | `lock-immutable` | `expire-immutable` |
| 2 | `audit-log/prod/audit_log/security_critical/` | 2555 (7y) | 2557 | raw security_critical | `lock-sec-critical` | `expire-sec-critical` |
| 3 | `audit-log/prod/admin_audit_log/immutable/` | 2555 (7y) | 2557 | raw admin_immutable | `lock-admin-immutable` | `expire-admin-immutable` |
| 4 | `audit-log/prod/audit_log/security_warn/` | 1095 (3y) | 1097 | raw security_warn | `lock-sec-warn` | `expire-sec-warn` |
| 5 | `audit-log/prod/audit_log/read_audit/` | 1095 (3y) | 1097 | raw read_audit | `lock-read-audit` | `expire-read-audit` |
| 6 | `audit-log/prod/audit_log/telemetry/` | 365 (1y) | 367 | raw telemetry | `lock-telemetry` | `expire-telemetry` |
| 7 | `audit-log/prod/audit_log/debug_failure/` | 365 (1y) | 367 | raw debug_failure | `lock-debug` | `expire-debug` |

### 2.2 manifest/ (7 prefix × 2 = 14 rules)

| # | prefix | retention-days | expire-days | cold_class | rule name (lock) | rule name (lifecycle) |
|---|---|---|---|---|---|---|
| 8 | `manifest/prod/audit_log/immutable/` | 2555 (7y) | 2557 | manifest immutable | `lock-manifest-immutable` | `expire-manifest-immutable` |
| 9 | `manifest/prod/audit_log/security_critical/` | 2555 (7y) | 2557 | manifest security_critical | `lock-manifest-sec-critical` | `expire-manifest-sec-critical` |
| 10 | `manifest/prod/admin_audit_log/immutable/` | 2555 (7y) | 2557 | manifest admin_immutable | `lock-manifest-admin` | `expire-manifest-admin` |
| 11 | `manifest/prod/audit_log/security_warn/` | 1095 (3y) | 1097 | manifest security_warn | `lock-manifest-sec-warn` | `expire-manifest-sec-warn` |
| 12 | `manifest/prod/audit_log/read_audit/` | 1095 (3y) | 1097 | manifest read_audit | `lock-manifest-read` | `expire-manifest-read` |
| 13 | `manifest/prod/audit_log/telemetry/` | 365 (1y) | 367 | manifest telemetry | `lock-manifest-tele` | `expire-manifest-tele` |
| 14 | `manifest/prod/audit_log/debug_failure/` | 365 (1y) | 367 | manifest debug_failure | `lock-manifest-debug` | `expire-manifest-debug` |

### 2.3 Aggregate (4 prefix × 2 = 8 rules)

| # | prefix | retention-days | expire-days | cold_class | rule name (lock) | rule name (lifecycle) |
|---|---|---|---|---|---|---|
| 15 | `audit-log-aggregate-telemetry/prod/` | 365 (1y) | 367 | aggregate-telemetry | `lock-agg-tele` | `expire-agg-tele` |
| 16 | `audit-log-aggregate-debug/prod/` | 365 (1y) | 367 | aggregate-debug | `lock-agg-debug` | `expire-agg-debug` |
| 17 | `manifest/prod/audit_log_aggregate_telemetry/` | 365 (1y) | 367 | aggregate-telemetry-manifest | `lock-agg-manifest-tele` | `expire-agg-manifest-tele` |
| 18 | `manifest/prod/audit_log_aggregate_debug/` | 365 (1y) | 367 | aggregate-debug-manifest | `lock-agg-manifest-debug` | `expire-agg-manifest-debug` |

### 2.4 Retention 分布

| Retention | Lock 條數 | Lifecycle 條數 | 用途 |
|---|---|---|---|
| 7 年（2555 / 2557） | 6 | 6 | immutable / security_critical / admin_audit_log/immutable（金融 + 合規） |
| 3 年（1095 / 1097） | 4 | 4 | security_warn / read_audit |
| 1 年（365 / 367） | 8 | 8 | telemetry / debug_failure / aggregate × 2 |
| **合計** | **18** | **18** | **36 rules** |

---

## §3 wrangler cmd 序列（36 條）

### 3.1 Shape 驗證（已對 `--help` 跑過，本 session 2026-05-28）

wrangler 4.87.0 `r2 bucket lock add` shape：
```
wrangler r2 bucket lock add <bucket> [name] [prefix]
  POSITIONALS: bucket (required) / name (used to identify and manage rule) / prefix
  OPTIONS:     --retention-days <N> | --retention-date YYYY-MM-DD | --retention-indefinite
               -J/--jurisdiction | -y/--force (skip confirmation)
  NOTE:        無 --remote flag（bucket-level policy 永遠 remote；對齊 [[reference_wrangler_r2_windows_quirk]] Quirk 4）
```

wrangler 4.87.0 `r2 bucket lifecycle add` shape：
```
wrangler r2 bucket lifecycle add <bucket> [name] [prefix]
  POSITIONALS: bucket (required) / name / prefix
  OPTIONS:     --expire-days <N> | --expire-date YYYY-MM-DD
               --ia-transition-days | --ia-transition-date
               --abort-multipart-days
               -J/--jurisdiction | -y/--force
  NOTE:        無 --remote flag（同上）
```

兩條 shape **完全對齊** `scripts/spike-r2-lock.mjs:270`（lock）+ `:273`（lifecycle）既有 pattern：
```js
`npx wrangler r2 bucket lock add ${REQUIRED_BUCKET} ${ruleName} "${prefix}" --retention-days ${RETENTION_DAYS} -y`
`npx wrangler r2 bucket lifecycle add ${REQUIRED_BUCKET} ${ruleName}-cleanup "${prefix}" --expire-days ${RETENTION_DAYS + 1} -y`
```

→ 本 PR 36 cmd 全部沿用此 shape：`<bucket> <name> "<prefix>" --(retention|expire)-days <N> -y`。

### 3.2 Windows quirks 對齊（per [[reference_wrangler_r2_windows_quirk]]）

| Quirk | 本 PR 適用？ | 因應 |
|---|---|---|
| Q1 (深巢 key get 假陰性) | 否 | 本 PR 不打 `r2 object get` |
| Q2 (`r2 object list` 不存在於 4.87) | 否 | 本 PR 不打 `r2 object list` |
| Q3 (`r2 object *` 預設打 local miniflare) | 否 | 本 PR 不打 `r2 object *`；如有 post-monitor probe 必加 `--remote` |
| **Q4** (`r2 bucket lock/lifecycle` 拒 `--remote`) | **是** | 36 條 cmd 全部**不加** `--remote` |
| **Q5** (PowerShell 行寬切長 key) | **是** | 全部 prefix + rule name 走 `$VAR='...'` 賦值再餵 cmd，**禁直接內聯** |
| Q6 (libuv exit-crash benign noise) | 是 | 看到忽略，不影響 cmd outcome |

### 3.3 36 cmd block（依 2.1 / 2.2 / 2.3 順序，每條附預期 success 訊息）

**每條 cmd 的執行樣板（PowerShell）**：
```powershell
$BUCKET = 'chiyigo-audit-archive'
$NAME   = '<rule name>'
$PREFIX = '<prefix value>'
$DAYS   = <N>
npx wrangler r2 bucket (lock|lifecycle) add $BUCKET $NAME $PREFIX --(retention|expire)-days $DAYS -y
```
（`$VAR` 不直接內聯到 cmd 一行，per Q5）

**預期 success 訊息形態**（codex r? 親跑 0.2c-pre-3 對 prod bucket 已驗）：
- Lock add: `Added bucket lock rule '<name>' to bucket '<bucket>'.`（或 `✅` 開頭、wrangler 4.87 文字）
- Lifecycle add: `Added lifecycle rule '<name>' to bucket '<bucket>'.`（同上）
- Walk-through 時對「Added」字串 + rule name + bucket name 三段對得起來就算 success；libuv exit-crash 行（`Assertion failed: ...async.c, line 76`）忽略

**Pairing principle（本 plan 偏離 SoT 順序的明示說明）**：本 plan §3.3 每個 lock cmd 的後面 (lock #N) 與 lifecycle cmd (lifecycle #N) **同 prefix 同 sub-position**（A.3 lock-admin-immutable ↔ A.10 expire-admin-immutable），方便 walk-through 一對一心智配對 + progress log 對位。

`docs/AUDIT_RETENTION_PLAN.md` SoT lifecycle 區塊本身**內部不一致**：line 856-869 audit-log/ lifecycle 把 `expire-admin-immutable` 排在第 7 條（線下方），但 line 802-822 lock 區塊把 `lock-admin-immutable` 排在第 3 條（線上方）。manifest/ block 則內部一致（lock 與 lifecycle 都把 admin 排在第 3）。本 plan 統一採 lock-position 為配對基準，與 manifest/ block 的 SoT 行為一致 — 只在 audit-log/ lifecycle 順序上偏離 SoT。

如果 codex 認為應該嚴格鏡像 SoT 順序而非配對性原則，請於 §7 Q3 額外列回，並建議是否同步修 SoT line 860/868 達內部一致。

---

**Block A — Raw `audit-log/` 7 lock + 7 lifecycle = 14 cmd**

```powershell
# ── A.1 (rule #1) audit_log/immutable — 7y ────────────────────────────────
$BUCKET = 'chiyigo-audit-archive'
$NAME   = 'lock-immutable'
$PREFIX = 'audit-log/prod/audit_log/immutable/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 2555 -y

# ── A.2 (rule #2) audit_log/security_critical — 7y ────────────────────────
$NAME   = 'lock-sec-critical'
$PREFIX = 'audit-log/prod/audit_log/security_critical/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 2555 -y

# ── A.3 (rule #3) admin_audit_log/immutable — 7y ──────────────────────────
$NAME   = 'lock-admin-immutable'
$PREFIX = 'audit-log/prod/admin_audit_log/immutable/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 2555 -y

# ── A.4 (rule #4) audit_log/security_warn — 3y ────────────────────────────
$NAME   = 'lock-sec-warn'
$PREFIX = 'audit-log/prod/audit_log/security_warn/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 1095 -y

# ── A.5 (rule #5) audit_log/read_audit — 3y ───────────────────────────────
$NAME   = 'lock-read-audit'
$PREFIX = 'audit-log/prod/audit_log/read_audit/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 1095 -y

# ── A.6 (rule #6) audit_log/telemetry — 1y ────────────────────────────────
$NAME   = 'lock-telemetry'
$PREFIX = 'audit-log/prod/audit_log/telemetry/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y

# ── A.7 (rule #7) audit_log/debug_failure — 1y ────────────────────────────
$NAME   = 'lock-debug'
$PREFIX = 'audit-log/prod/audit_log/debug_failure/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y

# ── A.8 (rule #1 lifecycle) audit_log/immutable — 2557d ───────────────────
$NAME   = 'expire-immutable'
$PREFIX = 'audit-log/prod/audit_log/immutable/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 2557 -y

# ── A.9 audit_log/security_critical — 2557d ───────────────────────────────
$NAME   = 'expire-sec-critical'
$PREFIX = 'audit-log/prod/audit_log/security_critical/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 2557 -y

# ── A.10 admin_audit_log/immutable — 2557d ────────────────────────────────
$NAME   = 'expire-admin-immutable'
$PREFIX = 'audit-log/prod/admin_audit_log/immutable/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 2557 -y

# ── A.11 audit_log/security_warn — 1097d ──────────────────────────────────
$NAME   = 'expire-sec-warn'
$PREFIX = 'audit-log/prod/audit_log/security_warn/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 1097 -y

# ── A.12 audit_log/read_audit — 1097d ─────────────────────────────────────
$NAME   = 'expire-read-audit'
$PREFIX = 'audit-log/prod/audit_log/read_audit/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 1097 -y

# ── A.13 audit_log/telemetry — 367d ───────────────────────────────────────
$NAME   = 'expire-telemetry'
$PREFIX = 'audit-log/prod/audit_log/telemetry/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y

# ── A.14 audit_log/debug_failure — 367d ───────────────────────────────────
$NAME   = 'expire-debug'
$PREFIX = 'audit-log/prod/audit_log/debug_failure/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y
```

**Block B — `manifest/` 7 lock + 7 lifecycle = 14 cmd**

```powershell
# ── B.1 (rule #8) manifest/audit_log/immutable — 7y ───────────────────────
$NAME   = 'lock-manifest-immutable'
$PREFIX = 'manifest/prod/audit_log/immutable/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 2555 -y

# ── B.2 manifest/audit_log/security_critical — 7y ─────────────────────────
$NAME   = 'lock-manifest-sec-critical'
$PREFIX = 'manifest/prod/audit_log/security_critical/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 2555 -y

# ── B.3 manifest/admin_audit_log/immutable — 7y ───────────────────────────
$NAME   = 'lock-manifest-admin'
$PREFIX = 'manifest/prod/admin_audit_log/immutable/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 2555 -y

# ── B.4 manifest/audit_log/security_warn — 3y ─────────────────────────────
$NAME   = 'lock-manifest-sec-warn'
$PREFIX = 'manifest/prod/audit_log/security_warn/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 1095 -y

# ── B.5 manifest/audit_log/read_audit — 3y ────────────────────────────────
$NAME   = 'lock-manifest-read'
$PREFIX = 'manifest/prod/audit_log/read_audit/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 1095 -y

# ── B.6 manifest/audit_log/telemetry — 1y ─────────────────────────────────
$NAME   = 'lock-manifest-tele'
$PREFIX = 'manifest/prod/audit_log/telemetry/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y

# ── B.7 manifest/audit_log/debug_failure — 1y ─────────────────────────────
$NAME   = 'lock-manifest-debug'
$PREFIX = 'manifest/prod/audit_log/debug_failure/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y

# ── B.8 manifest/audit_log/immutable lifecycle — 2557d ────────────────────
$NAME   = 'expire-manifest-immutable'
$PREFIX = 'manifest/prod/audit_log/immutable/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 2557 -y

# ── B.9 manifest/audit_log/security_critical lifecycle — 2557d ────────────
$NAME   = 'expire-manifest-sec-critical'
$PREFIX = 'manifest/prod/audit_log/security_critical/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 2557 -y

# ── B.10 manifest/admin_audit_log/immutable lifecycle — 2557d ─────────────
$NAME   = 'expire-manifest-admin'
$PREFIX = 'manifest/prod/admin_audit_log/immutable/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 2557 -y

# ── B.11 manifest/audit_log/security_warn lifecycle — 1097d ───────────────
$NAME   = 'expire-manifest-sec-warn'
$PREFIX = 'manifest/prod/audit_log/security_warn/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 1097 -y

# ── B.12 manifest/audit_log/read_audit lifecycle — 1097d ──────────────────
$NAME   = 'expire-manifest-read'
$PREFIX = 'manifest/prod/audit_log/read_audit/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 1097 -y

# ── B.13 manifest/audit_log/telemetry lifecycle — 367d ────────────────────
$NAME   = 'expire-manifest-tele'
$PREFIX = 'manifest/prod/audit_log/telemetry/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y

# ── B.14 manifest/audit_log/debug_failure lifecycle — 367d ────────────────
$NAME   = 'expire-manifest-debug'
$PREFIX = 'manifest/prod/audit_log/debug_failure/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y
```

**Block C — Aggregate 4 lock + 4 lifecycle = 8 cmd**

```powershell
# ── C.1 (rule #15) audit-log-aggregate-telemetry/prod/ — 1y ───────────────
$NAME   = 'lock-agg-tele'
$PREFIX = 'audit-log-aggregate-telemetry/prod/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y

# ── C.2 audit-log-aggregate-debug/prod/ — 1y ──────────────────────────────
$NAME   = 'lock-agg-debug'
$PREFIX = 'audit-log-aggregate-debug/prod/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y

# ── C.3 manifest/audit_log_aggregate_telemetry/ — 1y ──────────────────────
$NAME   = 'lock-agg-manifest-tele'
$PREFIX = 'manifest/prod/audit_log_aggregate_telemetry/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y

# ── C.4 manifest/audit_log_aggregate_debug/ — 1y ──────────────────────────
$NAME   = 'lock-agg-manifest-debug'
$PREFIX = 'manifest/prod/audit_log_aggregate_debug/'
npx wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y

# ── C.5 audit-log-aggregate-telemetry/prod/ lifecycle — 367d ──────────────
$NAME   = 'expire-agg-tele'
$PREFIX = 'audit-log-aggregate-telemetry/prod/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y

# ── C.6 audit-log-aggregate-debug/prod/ lifecycle — 367d ──────────────────
$NAME   = 'expire-agg-debug'
$PREFIX = 'audit-log-aggregate-debug/prod/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y

# ── C.7 manifest/audit_log_aggregate_telemetry/ lifecycle — 367d ──────────
$NAME   = 'expire-agg-manifest-tele'
$PREFIX = 'manifest/prod/audit_log_aggregate_telemetry/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y

# ── C.8 manifest/audit_log_aggregate_debug/ lifecycle — 367d ──────────────
$NAME   = 'expire-agg-manifest-debug'
$PREFIX = 'manifest/prod/audit_log_aggregate_debug/'
npx wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y
```

**合計：A.14 + B.14 + C.8 = 36 cmd。**

### 3.4 上序選擇（**待 codex 決**，先寫 default — 見 §7 Q1）

Default proposal：**全 lock 跑完才跑 lifecycle**（block A → block B → block C 都是「先全 lock、後全 lifecycle」），sub-block 內 raw → manifest → aggregate。理由：

- 1 = **failure-mode 一致性**：若中途 fail，已成部分全是 lock（最不可逆的那種），lifecycle 缺失等同沒設過期清理 — 影響等同 lock 設完但忘了 lifecycle，**不會出現「lifecycle 已設但 lock 未設」的奇怪中間態**
- 2 = SoT runbook（`docs/AUDIT_RETENTION_PLAN.md` line 802-897）就是按這順序排
- 3 = `spike-r2-lock.mjs:270/273` 也是 lock 先輸出、lifecycle 後

**競爭順序**（同檔 line 180-181「先 lifecycle、後 lock + 每組 sleep 10s + canary」與 default 衝突）— 列 §7 Q1 給 codex 決，**Phase 1 不強行擇一**。

---

## §4 Pre-flight check（Phase 3 動工前 user 親跑；Phase 1 不跑）

執行序：**全 36 cmd 之前**跑一遍 4 條 check，任一失敗 → 停手回報。

### 4.1 wrangler whoami 驗帳號

```powershell
npx wrangler whoami
```

預期輸出含三段：
- email = `a3010030100a@gmail.com`
- account name = chiyigo（user 的 CF account）
- Account ID = `2d2c4b4ddbddec1a5d045533c01d715f`

若 OAuth token 過期 → wrangler 會引導 browser login；重 login 後再跑。

### 4.2 wrangler version 對齊

```powershell
npx wrangler --version
```

預期：**`4.87.0`**（精確；不接受 `4.87.x` 之外的版本）。本 session 2026-05-28 已驗。

### 4.3 lock list 預期空

```powershell
npx wrangler r2 bucket lock list chiyigo-audit-archive
```

預期：**無任何 rule**（cleanup 後狀態，sacrificial `preview-gate-binding-20260525-131627-9416db` 已 remove）。若仍有 rule entry → 停手回報 → 走 cleanup SOP 再跑。

> ⚠️ Phase 1（本 session）**不**跑此 cmd（避免無謂 prod call）；user 在 Phase 3 動工前親跑。

### 4.4 lifecycle list 預期只有 default housekeeping

```powershell
npx wrangler r2 bucket lifecycle list chiyigo-audit-archive
```

預期：**只有** `Default Multipart Abort Rule`（CF 內建 housekeeping，非本 PR 設）。若有其他 entry → 停手回報。

> ⚠️ 同上，Phase 1 不跑。

---

## §5 失敗劇本演練

### 5.1 中途任一條 cmd fail

**場景**：跑到第 N 條（1 ≤ N ≤ 36）任一條失敗（網路、wrangler bug、CF API 5xx、CF 限流、libuv 噴出非 cosmetic error）。

**現實**：已成 N-1 條已 LIVE 在 prod bucket，**lock 部分（rule ≤ 18 範圍）全部 7yr 不可逆**，lifecycle 部分可手動 remove（per AUDIT_RETENTION_PLAN.md cleanup pattern）但無意義。

**決策**：
- **rollback 不存在**（Tier 0 conjunctive blocker — 7yr 是 immutable）
- **partial 留著 retry**：是唯一可行路徑。已成 N-1 條保留，從 N 開始重跑
- 不需 unwind 已成部分（即使 unwind 也只能 lifecycle remove；lock 永遠在）

**SOP**：
1. 停手記錄 fail cmd 的 stderr / stdout（整段截到 fixture）
2. 看 fail 原因：
   - 網路 / wrangler bug → 修 + retry 同 cmd
   - CF API 5xx → 等 5 min 再 retry（不重試 sleep loop，先讀 status.cloudflare.com）
   - CF API 4xx（如 already-exists） → 跳到下一條（rule 已存在等同這條已完成）
   - wrangler OAuth 過期 → 重 login → retry
3. retry 後 success → 繼續 N+1 cmd
4. **每一條完成都記錄到 progress log**（手寫文字檔，per `cmd seq num | rule name | success-msg | timestamp`）

### 5.2 wrangler OAuth token 中途過期

**場景**：跑到第 N 條時 wrangler 拋 `Authentication error: Status 401`。

**SOP**：
1. 確認 user 對應的 wrangler login（先 `npx wrangler whoami` 看現有 status）
2. 若 token 確實過期 → `npx wrangler logout` → `npx wrangler login`（browser flow）
3. login 完成後跑 `npx wrangler whoami` 確認回到正確 account（email + Account ID 對齊 §4.1）
4. retry 第 N 條
5. 若 4 重 login 後仍 401 → 停手回報 user，可能是 account 端問題

### 5.3 libuv exit-crash 噴在中間條

**場景**：第 N 條 success log 出來後（顯示 `Added bucket lock rule '...'`），但 wrangler exit 時噴 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`。

**現實**：per [[reference_wrangler_r2_windows_quirk]] Quirk 6 — benign exit-time race，發生在 cmd output flush **之後**，**不影響任何結果**。

**SOP**：忽略，繼續 N+1 cmd。但走 progress log + visual confirm Success 訊息（不只看 exit code）。

### 5.4 同一條 cmd 跑兩次（誤觸 / progress log 混亂）

**場景**：user 不小心對同一條 rule 跑了兩次 cmd。

**現實**：wrangler 4.87 對 `bucket lock add` / `bucket lifecycle add` 的同名 rule 大概率回 `4xx already exists`（per CF API 行為），可能會直接 fail。**不太可能**會建立兩條同名 rule（rule name 是 unique key）。

**SOP**：fail = 等同已成（rule 已在），跳到下一條。

### 5.5 partial state 任一條 rule live 後就 7yr 不可逆

**確認**：本 plan **不**列出「partial rollback」path — 因為不存在。已成部分（lock 條目）全 7yr immutable。User walk-through 時必須親口確認接受「N-1 lock 已 live、剩 36-N+1 條 retry」這個 partial state 是可接受的 — 任何 lock 上 prod 之後就沒回頭路。

### 5.6 Cloudflare 帳號被誤切到他帳

**場景**：wrangler whoami 跑出來的 email / Account ID 不對。

**SOP**：**立刻停手**。一條都不跑。回頭排查 wrangler login state。本 plan 強制 §4.1 在每次 session 進來都重跑。

### 5.7 PowerShell session 中途失常（terminal crash / disconnect）

**場景**：跑到第 N 條時 PowerShell window 意外關閉 / Windows 重開機 / RDP 斷線。

**SOP**：
1. 重開 fresh PowerShell（不在 Claude IDE）
2. 重跑 §4 pre-flight check（whoami / version / lock list / lifecycle list）— **lock list 與 lifecycle list 不再預期空**，要對著 progress log 確認「已成 N-1 條真的都在」
3. 從第 N 條繼續跑

### 5.8 user 看到「Added」success 訊息但 list 沒對應 rule

**場景**：cmd 回 Added but `bucket lock list` 沒看到新 rule。

**現實**：可能 CF propagation 延遲；或 cmd 對錯 bucket。

**SOP**：
1. 等 60s
2. 重跑 `bucket lock list`
3. 仍無 → 停手回報；不繼續下一條
4. 走 CF dashboard 視覺驗 R2 bucket > Settings > Bucket Lock 看當下實際狀態

---

## §6 Post-monitor（24hr + 14-day）

### 6.1 立即驗證（36 cmd 全跑完當下）

```powershell
npx wrangler r2 bucket lock list chiyigo-audit-archive
```
預期：**18 條 lock rule**，rule name 對齊 §2 manifest。

```powershell
npx wrangler r2 bucket lifecycle list chiyigo-audit-archive
```
預期：**18 條 lifecycle rule + Default Multipart Abort Rule**，rule name 對齊 §2 manifest。

兩 list 寫進 fixture：`docs/fixtures/pr-0-2c-full-prod-lock-<YYYY-MM-DD>.json`

### 6.2 24hr watch（Day 0 → Day 1）

監控以下 3 個 event family 任一非零 emit：
- `audit.archive.r2_lock_detected`（raw archive worker 命中）
- `audit.aggregate_archive.telemetry.r2_lock_detected`（aggregate telemetry runner 命中）
- `audit.aggregate_archive.debug.r2_lock_detected`（aggregate debug runner 命中）
- `audit.archive.force_purge_blocked_by_lock`（admin force_purge 走 423 路徑）
- `audit.aggregate_archive.telemetry.force_purge_blocked_by_lock`
- `audit.aggregate_archive.debug.force_purge_blocked_by_lock`

**任一非零 emit = 立刻 forensic 跑因果**（emit context 帶 traceId / chunk_id / prefix）。

### 6.3 14-day no-incident watch（Day 1 → Day 14）

連續 14 天 no incident → 觸發 2.1c endgame discard → 4a live flip → canary 2 週 → 4b cron purge（依 [[project_audit_phase2]] 既定 sequence）。

任一日 incident → 排查 root cause；不阻 14-day 計時，但**incident 修完才能往 2.1c**。

---

## §7 給 codex 的 open questions（Phase 1 review 抓手）

以下 7 條請 codex r1 第一輪明確 verdict：

### Q1 — Lock vs lifecycle 上序選擇（內部 SoT 衝突）

`docs/AUDIT_RETENTION_PLAN.md` 有**兩處衝突**的順序記載：
- **Line 802-897**（runbook 主體）：lock add × 18 全跑完，**才** lifecycle add × 18（block 順序）
- **Line 178-181**（PR 0.2c-pre runbook 「執行順序原則」）：**先設 lifecycle**（無 retention enforce，只是過期清理），**後設 lock**（不可逆）；每組 lock 設完 sleep 10s + canary PUT 驗 propagation

兩條 SoT 互斥。本 plan §3 default 採前者（lock first），理由列在 §3.4。請 codex 仲裁，哪條是正確的、為何另一條被推翻或仍 valid？

> 預設 answer hint（供 codex 評）：line 802-897 是「runbook 指令清單」屬實作 SoT；line 178-181 是早期設計筆記，可能 stale。但若 codex 認為 lifecycle 先設更安全（lifecycle 是 reversible），可推翻 default。

### Q2 — Per-rule canary 是否必要？

Line 181 寫「每組 lock 設完 sleep 10s + canary PUT 驗 propagation」對齊 [[feedback_r2_lock_propagation_canary]]：**rule API 200 ≠ 對 prefix 生效；canary PUT 確認真擋**。

本 plan §3 default **不**做 per-rule canary（理由：preview-gate-binding-canary 已 PASS 證 prod bucket binding enforce；不需重複每 prefix 都試）。但若 codex 認為 prod 每個 prefix 都要獨立 canary（per-prefix propagation 風險不能外推），請列出建議的 canary 順序與時程。

### Q3 — Aggregate vs raw 上序

本 plan §3 採 raw → manifest → aggregate 順序（block A → B → C）。是否該改成「先 1y rules（最低風險）→ 3y → 7y（最高風險）」分群？

理由評估：
- raw → manifest → aggregate 是「資料 → 索引 → 衍生」邏輯順序，與 cron worker 寫入順序對齊
- 1y → 3y → 7y 是「retention 風險 ascending」，若中途 fail，已成部分 retention 較短，blast radius 較小

請 codex 仲裁。

### Q4 — Partial state 是否需要中間檢查點？

跑 36 條中間，是否每跑 6 條（或 9 條 / 12 條）就 `bucket lock list` + `lifecycle list` 對 progress log 一次？

理由：
- Pros：早期發現「Added but not in list」的 propagation lag / 帳號錯切問題
- Cons：CF API call ×6 額外風險（API 5xx / rate limit）+ 拖長執行時間

請 codex 評是否值得。若值得，建議 checkpoint 間隔。

### Q5 — Rule name uniqueness 風險

CF rule name 是 unique key（per AUDIT_RETENTION_PLAN.md observed 行為）。但本 PR 18 個 lock rule name + 18 個 lifecycle rule name **全不撞**（命名 `lock-*` vs `expire-*`）。

問題：CF bucket 是否 **lock rule name + lifecycle rule name** 共享同一 namespace？若共享，「`lock-tele`」與「`expire-tele`」算同 namespace 不撞，但若 user 不小心改 `expire-tele` 成 `lock-tele` 會炸。本 plan 假設兩 namespace 獨立 — 請 codex 驗證 CF 文件 / 4.87 wrangler 行為。

### Q6 — wrangler version pin 機制

wrangler 4.87.0 是當前 codex baseline，但 user 機器若 `npx wrangler` 拉到 latest，可能拿到 4.88+。是否該寫成 `npx wrangler@4.87.0 r2 ...` 強制版本？

理由：
- Pros：絕對對齊 0.2c-pre-3 親驗 baseline
- Cons：npx 每次 cmd 下載 wrangler tarball 拖速度（除非已 cached）

請 codex 評。Phase 1 已驗本機 wrangler --version=4.87.0；Phase 3 動工前再 §4.2 確認一次。

### Q7 — Phase 3 執行時長預估

每條 cmd 約 5-10 sec（wrangler npx overhead + CF API call），36 cmd serial 預估 3-6 min；若加 10s sleep between（per [[feedback_r2_lock_propagation_canary]] 第二代設計），多 6 min；若加 §4 pre-flight + §6.1 立即驗證，總長預估 **10-15 min**。

請 codex 評估是否合理；若 codex 認為應該分 session 跑（如 raw / manifest / aggregate 各一 session）、不一次全跑，請列理由。

---

## §8 Phase 1 → Phase 2 → Phase 3 邊界

本檔（plan doc）= **Phase 1 prep**。Phase 1 收尾條件 = codex Approve plan。

**Phase 2** = user 親自走 walk-through（per [[feedback_irreversible_action_full_review]]）：
- 從 §1 觸發前提到 §6 post-monitor 全段念過或列 checklist
- 失敗劇本 §5 mental rehearsal
- 一邊念一邊在 fresh PowerShell（不是 Claude IDE）跑 §4 pre-flight check

**Phase 3** = user 親自跑 36 cmd（fresh PS、不是 Claude IDE）：
- 對著 §3.3 36-cmd block 一條一條跑
- 每條完成都寫 progress log（cmd seq num | rule name | success-msg | timestamp）
- 跑完跑 §6.1 立即驗證
- 寫 fixture commit

**Phase 1 嚴守邊界**：本 session **不**跑任何 prod-touching cmd（含 read-only `lock list` / `lifecycle list`）。Phase 1 收尾 = codex Approve plan 後**停手**，給 user 接 Phase 2。

---

## §9 衍生 memory（執行完更新）

Phase 3 完成後，補：
- 更新 [[project_audit_phase2]] —「PR 0.2c full prod lock 全段結」section（HEAD hash / fixture path / 36 rule verify / 24hr no-emit 證據）
- 若 §5 任何失敗劇本實際發生，補 [[reference_wrangler_r2_windows_quirk]] / 開新 reference memory
- 若 codex 在 §7 任何 open question 給出推翻本 plan default 的答案，更新本 plan + AUDIT_RETENTION_PLAN.md 對應段
