# PR 0.2c Full Prod Lock — Execution Plan

**狀態**：r3 — 套用 codex r1 全 6 件 + codex r2 全 4 件 finding（兩輪共 2+2 blocker + 2+2 high + state consistency + observability），待 codex r3 review
**作者**：Claude（plan first written at main HEAD `4a1be03`，2026-05-28；r2 patch at `f5bf833`；r3 patch in this commit）
**為何存在**：PR 0.2c-pre-3 全段結（preview-gate-binding-canary PASS，HEAD `830b5d2`）+ sacrificial cleanup 完成（2026-05-28 ~08:00 local Taipei）後，prod lock 18+18=36 rules 是 F-3 Phase 2 cold archive 最後一道**不可逆 7yr** gate。本檔是 Phase 1 prep — 給 codex 在 user 走 walk-through 前 review 完整 36-cmd 序列、失敗劇本、open question。Codex Approve 後 user 才會親自走 Phase 2 walk-through 與 Phase 3 execute；本 session 不會 fire 任何 prod-touching cmd（含 read-only list）。
**範圍**：對 prod bucket `chiyigo-audit-archive` 一次性執行 18 條 `r2 bucket lock add` + 18 條 `r2 bucket lifecycle add`，依 `docs/AUDIT_RETENTION_PLAN.md` line 906 SoT。
**不可逆度**：**最大** — `retention-days` 從 365 / 1095 / 2555 設下去後，對應 prefix 7 年內無 `DELETE` 路徑（admin / root token 都不行）；rollback 只剩「等過期」/「CF support compliance ticket」/「改 cold_class 走新 prefix 棄舊」三條（皆遠高於多花 30 min walk-through）。
**請 codex r3 review**：（a）r2 全 4 件 finding 是否每條都正確套到位；（b）§4.3 object emptiness 改 S3 sigv4 scriptable + raw output fixture 為 gating（含「formal-prefix object found = hard stop forensic SOP」）；（c）§1 SoT trigger 5 條全列 + 每條 evidence/N/A reason；（d）`docs/AUDIT_RETENTION_PLAN.md:801` 加 DO NOT EXECUTE banner；（e）§7 Q5 RESOLVED（codex r2 親查 CF docs 證 lock/lifecycle ID namespace 獨立）。

---

## Changelog: r1 → r2（2026-05-28）

Codex r1 verdict = **Reject until revised**。6 件 finding 全收：

| # | Finding 等級 | r1 抓到 | r2 修法 |
|---|---|---|---|
| 1 | **Blocker** | executable order self-contradictory：§3.3 是 A lock → A lifecycle → B lock → B lifecycle → C lock → C lifecycle，但 §3.4 寫「全 lock 跑完才跑 lifecycle」+ §7 Q1 未 resolved；CF docs 確認 bucket locks > lifecycle rules，所以 lifecycle 先設下去也不會誤刪 | §3 完全重寫：**Phase α 全 18 lifecycle 先（reversible）→ Phase β 18 lock 後依 1y→3y→7y order（partial-fail blast radius ascending）**；§3.4 改寫「為何 lifecycle-first」rationale；§7 Q1 升 **RESOLVED** |
| 2 | **Blocker** | §4 preflight 只檢查 lock/lifecycle 規則表，沒驗 18 個 prefix 真的是 0 objects — bucket lock 對 new + existing objects 都 apply，殘留 canary/誤觸物件會被 1/3/7yr 鎖死 | §4 新增 §4.3 object emptiness check（**3 method 並行**：CF dashboard 視覺 visual confirm 為 primary、S3 sigv4 ListObjectsV2 為 backup、`wrangler r2 bucket info` 為 sampled yardstick）+ explicit gating；§4 原 .3/.4 順移至 .4/.5 |
| 3 | **High** | §5.1 / §5.4 對 4xx already-exists 直接 skip 太寬，可能在 (name) 撞但 (prefix/days) 不對的情況下漏掉一條真正錯誤的 rule | §5.1 / §5.4 改 **strict match-then-skip**：必先 list confirm exact (name, prefix, days, enabled) 4 欄全 match，才可 skip；任何 mismatch / 任何 非-already-exists 4xx = stop run |
| 4 | **High** | wrangler version pin 未 resolved；`package.json:48` `^4.87.0` 允許 minor bump | §3.1 / §4.2 改用 **lockfile-pinned binary**：`npm ci`（pin 至 lockfile 4.87.0 exact）→ `& "$PWD\node_modules\.bin\wrangler.cmd" ...`；§7 Q6 升 RESOLVED |
| 5 | **State Consistency** | per-rule canary on formal prefixes 應 reject — PUT canary after lock 會建立 locked objects 在 prefix 內 1/3/7yr 無法刪；sacrificial 0.2c-pre-3 已 cover propagation enforcement | §3.4 / §7 Q2 升 **REJECTED**：formal prefix 上**禁** per-rule PUT canary；validation 限定 config-list diffing |
| 6 | **Observability** | progress log 缺 milestone checkpoint snapshots，4-tier 跑完無 forensic 證據 | §6.1 新增 **4 milestone checkpoints**（after 18 lifecycle / after 8 × 1y lock / after 12-cumulative × 3y lock / after 18-cumulative × 7y lock final）；每點抓 whoami + version + lock list + lifecycle list + timestamp |

**請 codex r2 驗**：6 件 finding 是否每條都正確收進 r2；新執行序是否無新假設、無漏掉 invariant、無自我矛盾。

---

## Changelog: r2 → r3（2026-05-28）

Codex r2 verdict = **Reject / hold Phase 3**。新發現 4 件 finding（r1 之外的）全收 + Q5 codex 親查 CF docs 答覆：

| # | Finding 等級 | r2 抓到 | r3 修法 |
|---|---|---|---|
| 7 | **Blocker** | §4.3 step 4 對 formal-prefix object found 直接走 `wrangler r2 object delete` 不安全 — 可能是 real archive data / manifest leak / live writer evidence | §4.3 改寫成 **hard-stop forensic SOP**：capture metadata → classify via D1 chunks/aggregate 表 query → 只有「provenance proven test/sacrificial + user explicit approval」才可 delete；任何不明、任何 D1 reference → NEVER delete + incident response |
| 8 | **Blocker** | §1 漏列 `docs/AUDIT_RETENTION_PLAN.md:781` 5 條 SoT trigger（PR 2 dry-run ≥1 month / classify-chunk-manifest-retry-cursor-month-finalize 全綠 / dry-run 沒寫正式 prefix / admin confirmation / preview canary PASS） | §1 新增 §1.4 SoT trigger 表，5 條全列 + 各自 current evidence / N/A reason / user-decision flag |
| 9 | **High** | §4.3 dashboard visual scan 為 gating 對 7yr lock 是 weak forensic proof | §4.3 改成 **S3 sigv4 ListObjectsV2 為 mandatory scriptable gating**，原始 JSON 輸出存 fixture；CF dashboard visual 降為 backup（S3 token 真不可用時的次選）；wrangler bucket info 維持 sampled yardstick |
| 10 | **High** | r2 將 `docs/AUDIT_RETENTION_PLAN.md:801` 對齊改為 non-blocking follow-up，但該段是 executable runbook 仍可被誤讀為 SoT | r3 在 `docs/AUDIT_RETENTION_PLAN.md:801` Per-class lock 段**上方加 DO NOT EXECUTE banner** 標明 superseded by 本 plan §3.3，rule name/prefix/days SoT 仍維持 |
| 11 | Minor | header line 4 `<commit-pending>` 未替換 | r3 補：r2 patch at `f5bf833` |
| Q5 | **RESOLVED by codex r2** | codex 親查 CF docs：lock 與 lifecycle 是 separate config resources，rules[].id 各 namespace。本 plan distinct `lock-*` / `expire-*` 命名 + 4-field exact-match 足夠 | §7 Q5 升 RESOLVED；引用 codex r2 三個 CF docs source |

**請 codex r3 驗**：4 件 finding 是否每條都正確收進 r3；§4.3 新 S3 scriptable gating + hard-stop SOP 是否堵死 r2 cited risk；§1.4 SoT trigger 5 條 evidence 是否真實對齊（特別 dry-run ≥1 month 條目，2026-05-11 至 2026-05-28 ~17 天，需 user explicit waiver 或 defer）；AUDIT_RETENTION_PLAN.md banner 是否清晰阻擋誤觸。

---

## §1 觸發前提（gate 全 PASS 證據 + SoT trigger）

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

### 1.4 SoT trigger conditions（per `docs/AUDIT_RETENTION_PLAN.md:781` — codex r2 finding 8 套用）

`docs/AUDIT_RETENTION_PLAN.md` Step 0.2c 規定 **5 條觸發條件全部滿足**才可執行 prod lock。逐條對齊 evidence / N/A reason：

| # | Trigger（per AUDIT_RETENTION_PLAN.md:781-786） | Evidence / Status as of 2026-05-28 | 結論 |
|---|---|---|---|
| T1 | PR 2 archive worker dry-run 在 prod 跑 ≥ 1 個月 | 最早 dry-run smoke：2026-05-11（per `reference_wrangler_r2_windows_quirk` Quirk 1）；至 2026-05-28 共 ~17 天，**不滿 1 個月**（差 ~13 天）。dry-run worker 仍 active（PR 2.0/2.1a/2.1c/2.1d/2.2a/2.2b/2.2c/2.1b/2.2d/2.3 全部已 deploy；DRY_RUN flag 未翻） | ⚠️ **NOT met** — user 必須在 Phase 2 walk-through 親口決定：(a) defer Phase 3 ~13 天等滿月、(b) 走 explicit waiver（書面寫進 walk-through fixture）+ 理由（如 binding canary 已親驗、各 PR 子段 codex Approved、$0 成本壓力等） |
| T2 | dry-run 期間驗證通過：classify / chunk key / manifest / retry / cursor / month finalize 全綠 | PR 2.0 archive worker skeleton + PR 2.1a/c/d/d.1 state machine + PR 2.2a 6 cold_class round-robin + PR 2.2b admin retry endpoint + PR 2.2c lint hardening + PR 2.1b gzip + PR 2.2d fine-grain scope + PR 2.3 force_purge 真實作；HEAD `759b198` 為 PR 2 全段結 + 後續 PR 3 aggregate（HEAD `a8977f7`）+ PR 0.2c-pre-1c aggregate write-once；單元測試 521 / 整合測試 819 全綠（PR 0.2c-pre-3 baseline，[[project_audit_phase2]]） | ✅ **PASS** — 各功能項 codex review 全 Approved；2026-05-13 02:00 cron F-2 manifest.severities 已自然 prod 驗收（[[project_audit_phase2]]） |
| T3 | dry-run **沒**寫進正式 cold_class prefix（最多寫 `audit-log-dryrun/` 或 preview） | 程式碼層面：cron worker 在 DRY_RUN flag = 1 時走 `audit-log-dryrun/` prefix（archive.ts）/ `audit-log-aggregate-{telemetry,debug}-dryrun/` prefix（aggregate runner）；PR 4 才翻 flag。但「真實 prod state」要靠 §4.3 object emptiness check 直接驗 — 不能用 source code 假設替代 prod verify | ⚠️ **PENDING §4.3 verification**（Phase 2 動工前） — 程式碼設計正確，但 prod 真實 state 必須 Phase 2 跑完 §4.3 scriptable S3 ListObjectsV2 才能 PASS |
| T4 | admin 確認啟動指令、無需回退 | Phase 2 walk-through user 親口確認 | ⚠️ **PENDING Phase 2 walk-through**（無需 Phase 1 行動） |
| T5 | Preview gate binding canary on prod bucket PASS | PR 0.2c-pre-3 完成 2026-05-25；fixture `docs/fixtures/preview-gate-binding-canary-20260525-131627.json`；6-op 全 7 HARD AND PASS；prod binding throw shape === preview fixture | ✅ **PASS** — 已驗收（[[project_audit_phase2]] § PR 0.2c-pre-3 全段結） |

**T1 user-decision gate**：T1 是 5 條 trigger 中**唯一未滿足條件**（NOT met）。Phase 2 walk-through 必須 user 親口決定 defer vs waiver，**不可 Claude / 工具自動決定**。本 plan 預設 listing 為 ⚠️，由 user 在 Phase 2 補 evidence 為 ✅（waiver + 理由）或標 ⏳（defer）。

如 user 選 waiver，建議理由模板（user 可改寫）：
- "0.2c-pre-3 binding canary 在 prod bucket 親驗，等同 worker binding 與 lock interaction 已 production-grade validated"
- "PR 2.0-2.3 / PR 3 / PR 0.2c-pre-1a/1b/1b.1/1b.2/1c/pre-2 / pre-3 全部 codex Approved，dry-run 各 sub-phase 都有 regression test 覆蓋"
- "1-month dry-run 設計是早期 design caveat；經 binding canary 後變 redundant"
- "$0 成本壓力下，多 13 天 dry-run = 多 13 天 audit log 寫 hot path 占 D1 query budget，邊際收益遞減"

或可直接選 defer 13 天，等 2026-06-10 自然滿月。

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

## §3 wrangler cmd 序列（36 條；新執行序：α lifecycle-first → β lock 1y→3y→7y）

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

兩條 shape **完全對齊** `scripts/spike-r2-lock.mjs:270`（lock）+ `:273`（lifecycle）既有 pattern：`<bucket> <name> "<prefix>" --(retention|expire)-days <N> -y`。

**Wrangler runner — lockfile-pinned binary**（codex r1 finding 4 套用）：

```powershell
# Phase 3 動工前一次性 setup（在 chiyigo.com 工作目錄）
npm ci                                                  # 依 package-lock.json 安裝 wrangler exact 4.87.0（lockfile 已 pin）
& "$PWD\node_modules\.bin\wrangler.cmd" --version       # 預期回 "4.87.0"，不接受 4.87.x 之外
$wrangler = "$PWD\node_modules\.bin\wrangler.cmd"       # 絕對路徑、避免 cwd 漂移
```

每條 cmd **改用 `& $wrangler` 取代 `npx wrangler`**（不走 npx，避免 `^4.87.0` caret 漏 minor bump）：

```powershell
$BUCKET = 'chiyigo-audit-archive'
$NAME   = '<rule name>'
$PREFIX = '<prefix value>'
& $wrangler r2 bucket (lock|lifecycle) add $BUCKET $NAME $PREFIX --(retention|expire)-days <N> -y
```

備案（若 `npm ci` 不可行）：`npx --yes wrangler@4.87.0 ...` — 但 codex 推薦 lockfile-pinned binary 為主路徑。

### 3.2 Windows quirks 對齊（per [[reference_wrangler_r2_windows_quirk]]）

| Quirk | 本 PR 適用？ | 因應 |
|---|---|---|
| Q1 (深巢 key get 假陰性) | 否 | 本 PR 不打 `r2 object get` |
| Q2 (`r2 object list` 不存在於 4.87) | **是**（§4.3 emptiness check） | 不走 wrangler list；改 CF dashboard / S3 sigv4 / `bucket info` 三 method |
| Q3 (`r2 object *` 預設打 local miniflare) | 否 | 本 PR 不打 `r2 object *`；若 §4.3 走 S3 sigv4 path 不經 wrangler |
| **Q4** (`r2 bucket lock/lifecycle` 拒 `--remote`) | **是** | 36 條 cmd 全部**不加** `--remote` |
| **Q5** (PowerShell 行寬切長 key) | **是** | 全部 prefix + rule name 走 `$VAR='...'` 賦值再餵 cmd，**禁直接內聯** |
| Q6 (libuv exit-crash benign noise) | 是 | 看到忽略，不影響 cmd outcome |

### 3.3 36 cmd 執行序（α lifecycle-first → β lock 1y → 3y → 7y）

**新執行序 rationale**（codex r1 finding 1 套用，取代 r1 之前的 「all lock → all lifecycle」 default）：

| Phase | Rules | 為什麼這順序最小化 blast radius |
|---|---|---|
| **α — 18 lifecycle first** | reversible setup | lifecycle rule 可 `bucket lifecycle remove` unwind；先設可 verify list 完整 → 才進不可逆 lock |
| **β.1 — 8 × 1y locks** | irreversible，~1y to remediate | 中途 fail：已成 1y locks，~1y 後 retention 過期可解 |
| **β.2 — 4 × 3y locks** | irreversible，~3y to remediate | 中途 fail：β.1 全成 + 部分 3y，blast radius +3y |
| **β.3 — 6 × 7y locks（final）** | irreversible，~7y to remediate | 中途 fail：β.1+β.2 全成 + 部分 7y，半數 7y 比「all 18 一鼓作氣」7y 全爆好 |

**CF docs 證據**：「bucket locks take precedence over lifecycle rules」— lifecycle 先設不會誤刪資料（lock 上線後會 override lifecycle expire），所以 lifecycle 先設**不增加風險**，反而讓 phase α 全 reversible，blast radius 真正最小化。

**每條 cmd 執行樣板**（PowerShell；§3.1 runner setup 已跑完）：
```powershell
$BUCKET = 'chiyigo-audit-archive'
$NAME   = '<rule name>'
$PREFIX = '<prefix value>'
& $wrangler r2 bucket (lock|lifecycle) add $BUCKET $NAME $PREFIX --(retention|expire)-days <N> -y
```

**預期 success 訊息形態**（codex r? 親跑 0.2c-pre-3 對 prod bucket 已驗）：
- Lock add: `Added bucket lock rule '<name>' to bucket '<bucket>'.`（或 `✅` 開頭、wrangler 4.87 文字）
- Lifecycle add: `Added lifecycle rule '<name>' to bucket '<bucket>'.`（同上）
- Walk-through 時對「Added」字串 + rule name + bucket name 三段對得起來才算 success；libuv exit-crash 行（`Assertion failed: ...async.c, line 76`）忽略

---

#### Phase α — 18 lifecycle adds（reversible，可任何 sub-order 跑；本 plan 依 raw → manifest → aggregate 對齊 SoT lifecycle block line 856-897）

```powershell
# ── α.1 audit_log/immutable lifecycle — 2557d ─────────────────────────────
$NAME   = 'expire-immutable'
$PREFIX = 'audit-log/prod/audit_log/immutable/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 2557 -y

# ── α.2 audit_log/security_critical lifecycle — 2557d ─────────────────────
$NAME   = 'expire-sec-critical'
$PREFIX = 'audit-log/prod/audit_log/security_critical/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 2557 -y

# ── α.3 audit_log/security_warn lifecycle — 1097d ─────────────────────────
$NAME   = 'expire-sec-warn'
$PREFIX = 'audit-log/prod/audit_log/security_warn/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 1097 -y

# ── α.4 audit_log/read_audit lifecycle — 1097d ────────────────────────────
$NAME   = 'expire-read-audit'
$PREFIX = 'audit-log/prod/audit_log/read_audit/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 1097 -y

# ── α.5 audit_log/telemetry lifecycle — 367d ──────────────────────────────
$NAME   = 'expire-telemetry'
$PREFIX = 'audit-log/prod/audit_log/telemetry/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y

# ── α.6 audit_log/debug_failure lifecycle — 367d ──────────────────────────
$NAME   = 'expire-debug'
$PREFIX = 'audit-log/prod/audit_log/debug_failure/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y

# ── α.7 admin_audit_log/immutable lifecycle — 2557d ───────────────────────
$NAME   = 'expire-admin-immutable'
$PREFIX = 'audit-log/prod/admin_audit_log/immutable/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 2557 -y

# ── α.8 manifest/audit_log/immutable lifecycle — 2557d ────────────────────
$NAME   = 'expire-manifest-immutable'
$PREFIX = 'manifest/prod/audit_log/immutable/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 2557 -y

# ── α.9 manifest/audit_log/security_critical lifecycle — 2557d ────────────
$NAME   = 'expire-manifest-sec-critical'
$PREFIX = 'manifest/prod/audit_log/security_critical/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 2557 -y

# ── α.10 manifest/admin_audit_log/immutable lifecycle — 2557d ─────────────
$NAME   = 'expire-manifest-admin'
$PREFIX = 'manifest/prod/admin_audit_log/immutable/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 2557 -y

# ── α.11 manifest/audit_log/security_warn lifecycle — 1097d ───────────────
$NAME   = 'expire-manifest-sec-warn'
$PREFIX = 'manifest/prod/audit_log/security_warn/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 1097 -y

# ── α.12 manifest/audit_log/read_audit lifecycle — 1097d ──────────────────
$NAME   = 'expire-manifest-read'
$PREFIX = 'manifest/prod/audit_log/read_audit/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 1097 -y

# ── α.13 manifest/audit_log/telemetry lifecycle — 367d ────────────────────
$NAME   = 'expire-manifest-tele'
$PREFIX = 'manifest/prod/audit_log/telemetry/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y

# ── α.14 manifest/audit_log/debug_failure lifecycle — 367d ────────────────
$NAME   = 'expire-manifest-debug'
$PREFIX = 'manifest/prod/audit_log/debug_failure/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y

# ── α.15 audit-log-aggregate-telemetry/prod/ lifecycle — 367d ─────────────
$NAME   = 'expire-agg-tele'
$PREFIX = 'audit-log-aggregate-telemetry/prod/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y

# ── α.16 audit-log-aggregate-debug/prod/ lifecycle — 367d ─────────────────
$NAME   = 'expire-agg-debug'
$PREFIX = 'audit-log-aggregate-debug/prod/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y

# ── α.17 manifest/audit_log_aggregate_telemetry/ lifecycle — 367d ─────────
$NAME   = 'expire-agg-manifest-tele'
$PREFIX = 'manifest/prod/audit_log_aggregate_telemetry/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y

# ── α.18 manifest/audit_log_aggregate_debug/ lifecycle — 367d ─────────────
$NAME   = 'expire-agg-manifest-debug'
$PREFIX = 'manifest/prod/audit_log_aggregate_debug/'
& $wrangler r2 bucket lifecycle add $BUCKET $NAME $PREFIX --expire-days 367 -y
```

**Phase α 收尾 → §6.1 Checkpoint #1**（18 lifecycle 列表完整 confirmation；strict diff 對齊 §2 manifest）。

---

#### Phase β.1 — 8 × 1y locks（lowest blast radius，~1y to remediate）

```powershell
# ── β.1.1 audit_log/telemetry lock — 1y ───────────────────────────────────
$NAME   = 'lock-telemetry'
$PREFIX = 'audit-log/prod/audit_log/telemetry/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y

# ── β.1.2 audit_log/debug_failure lock — 1y ───────────────────────────────
$NAME   = 'lock-debug'
$PREFIX = 'audit-log/prod/audit_log/debug_failure/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y

# ── β.1.3 manifest/audit_log/telemetry lock — 1y ──────────────────────────
$NAME   = 'lock-manifest-tele'
$PREFIX = 'manifest/prod/audit_log/telemetry/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y

# ── β.1.4 manifest/audit_log/debug_failure lock — 1y ──────────────────────
$NAME   = 'lock-manifest-debug'
$PREFIX = 'manifest/prod/audit_log/debug_failure/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y

# ── β.1.5 audit-log-aggregate-telemetry/prod/ lock — 1y ───────────────────
$NAME   = 'lock-agg-tele'
$PREFIX = 'audit-log-aggregate-telemetry/prod/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y

# ── β.1.6 audit-log-aggregate-debug/prod/ lock — 1y ───────────────────────
$NAME   = 'lock-agg-debug'
$PREFIX = 'audit-log-aggregate-debug/prod/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y

# ── β.1.7 manifest/audit_log_aggregate_telemetry/ lock — 1y ───────────────
$NAME   = 'lock-agg-manifest-tele'
$PREFIX = 'manifest/prod/audit_log_aggregate_telemetry/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y

# ── β.1.8 manifest/audit_log_aggregate_debug/ lock — 1y ───────────────────
$NAME   = 'lock-agg-manifest-debug'
$PREFIX = 'manifest/prod/audit_log_aggregate_debug/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 365 -y
```

**Phase β.1 收尾 → §6.1 Checkpoint #2**（lock list count = 8，rule name 對齊；後續任何 fail 已成 1y blast）。

---

#### Phase β.2 — 4 × 3y locks

```powershell
# ── β.2.1 audit_log/security_warn lock — 3y ───────────────────────────────
$NAME   = 'lock-sec-warn'
$PREFIX = 'audit-log/prod/audit_log/security_warn/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 1095 -y

# ── β.2.2 audit_log/read_audit lock — 3y ──────────────────────────────────
$NAME   = 'lock-read-audit'
$PREFIX = 'audit-log/prod/audit_log/read_audit/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 1095 -y

# ── β.2.3 manifest/audit_log/security_warn lock — 3y ──────────────────────
$NAME   = 'lock-manifest-sec-warn'
$PREFIX = 'manifest/prod/audit_log/security_warn/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 1095 -y

# ── β.2.4 manifest/audit_log/read_audit lock — 3y ─────────────────────────
$NAME   = 'lock-manifest-read'
$PREFIX = 'manifest/prod/audit_log/read_audit/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 1095 -y
```

**Phase β.2 收尾 → §6.1 Checkpoint #3**（lock list count = 12，rule name 對齊；後續 fail 已成 1y + 3y blast）。

---

#### Phase β.3 — 6 × 7y locks（**最後也最不可逆**；跑完前最後一個 mental walk-through）

```powershell
# ── β.3.1 audit_log/immutable lock — 7y ───────────────────────────────────
$NAME   = 'lock-immutable'
$PREFIX = 'audit-log/prod/audit_log/immutable/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 2555 -y

# ── β.3.2 audit_log/security_critical lock — 7y ───────────────────────────
$NAME   = 'lock-sec-critical'
$PREFIX = 'audit-log/prod/audit_log/security_critical/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 2555 -y

# ── β.3.3 admin_audit_log/immutable lock — 7y ─────────────────────────────
$NAME   = 'lock-admin-immutable'
$PREFIX = 'audit-log/prod/admin_audit_log/immutable/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 2555 -y

# ── β.3.4 manifest/audit_log/immutable lock — 7y ──────────────────────────
$NAME   = 'lock-manifest-immutable'
$PREFIX = 'manifest/prod/audit_log/immutable/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 2555 -y

# ── β.3.5 manifest/audit_log/security_critical lock — 7y ──────────────────
$NAME   = 'lock-manifest-sec-critical'
$PREFIX = 'manifest/prod/audit_log/security_critical/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 2555 -y

# ── β.3.6 manifest/admin_audit_log/immutable lock — 7y ────────────────────
$NAME   = 'lock-manifest-admin'
$PREFIX = 'manifest/prod/admin_audit_log/immutable/'
& $wrangler r2 bucket lock add $BUCKET $NAME $PREFIX --retention-days 2555 -y
```

**Phase β.3 收尾 → §6.1 Checkpoint #4 (final)**（lock list count = 18 + lifecycle list count = 18 + Default Multipart Abort Rule；prod lock 全段落定）。

---

**合計：Phase α 18 + Phase β.1 8 + Phase β.2 4 + Phase β.3 6 = 36 cmd。**

### 3.4 為何不在 formal prefix 上跑 per-rule canary（codex r1 finding 5 套用）

`docs/AUDIT_RETENTION_PLAN.md` line 180-181 寫的「每組 lock 設完 sleep 10s + canary PUT 驗 propagation」**對 formal prefix 不適用**：

- 一旦 lock 上 prefix，**任何在該 prefix 上的物件**（含驗 propagation 用的 canary）都被 1/3/7yr 鎖死，無法在 retention 期內 delete
- canary PUT 後 lock 命中 → throw → 但 throw 之前若已建立物件（PUT 成功但 lock 規則延遲生效）→ 物件 stuck 7yr
- canary PUT 在 lock 前 → 物件無 lock 保護，不算 propagation 驗證
- propagation 已在 [[reference_r2_lock_gate_design_evolution]] PR 0.2c-pre-3 對 sacrificial prefix `sacrificial/preview-gate-binding/...` 親驗，**不需再對 formal prefix 重複**

→ Phase α + β 全程**禁** PUT canary on formal prefix。驗證限定 **config-list diffing**（§6.1 4-checkpoint lock/lifecycle list 對齊 §2 manifest）。

> 替代 propagation 驗證（如果 codex 認為對 formal prefix 仍需）：可在 sacrificial 新 prefix `sacrificial/post-prod-lock-canary-<ts>/` 跑一次完整 enforce drill（同 0.2c-pre-3 模式，但 24h 過期）— **獨立 PR**，不在本 PR 範圍。

---

## §4 Pre-flight check（Phase 3 動工前 user 親跑；Phase 1 不跑）

執行序：**全 36 cmd 之前**跑一遍 5 條 check，任一失敗 → 停手回報。

### 4.1 wrangler runner setup + whoami 驗帳號（codex r1 finding 4 套用）

```powershell
# 0. 在 chiyigo.com 工作目錄
npm ci                                                    # 依 lockfile 安裝 wrangler exact 4.87.0
$wrangler = "$PWD\node_modules\.bin\wrangler.cmd"         # 絕對路徑，避免 cwd 漂移
& $wrangler whoami
```

預期輸出含三段：
- email = `a3010030100a@gmail.com`
- account name = chiyigo（user 的 CF account）
- Account ID = `2d2c4b4ddbddec1a5d045533c01d715f`

若 OAuth token 過期 → wrangler 會引導 browser login；重 login 後再跑。

### 4.2 wrangler version 對齊（hard pin）

```powershell
& $wrangler --version
```

預期：**`4.87.0`**（精確；不接受 `4.87.x` 之外的版本）。`npm ci` 已從 `package-lock.json` resolve 至 exact `4.87.0`（`package.json:48` `^4.87.0` 雖允許 caret 但 lockfile 鎖死），本 session 2026-05-28 已驗 `& $wrangler --version` = `4.87.0`。

### 4.3 Object emptiness check（codex r1 finding 2 + codex r2 finding 9 + 7 套用）

**為何必須**：bucket lock 對 **new + existing** objects 都 apply（CF docs 明示）。若 18 個 formal prefix 內任一存在殘留物件（誤觸測試 / sacrificial cleanup 漏網 / 0.2c-pre-3 之前的 dry-run 殘骸），lock 上線後該物件被 1/3/7yr 鎖死無法 delete。`docs/AUDIT_RETENTION_PLAN.md:770` 寫的「`object_count=0`」是歷史快照，不能取代執行前驗證。

**r2 review 變更**：codex r2 認為 dashboard visual scan 對 7yr lock 是 weak forensic proof — 改用 **S3 sigv4 scriptable ListObjectsV2 為 mandatory gating，raw JSON 輸出存 fixture**。

#### Method 1（**mandatory gating**）— S3 sigv4 ListObjectsV2 per prefix + raw output 存 fixture

**前置**：先 Roll 新組 audit-archive-writer S3 limited token（PR 0.2c-pre-1b 期間的 token 已 invalidated，[[project_audit_phase2]]）：
- CF dashboard → R2 → Manage R2 API tokens → Roll audit-archive-writer
- 取得新 Access Key ID + Secret Access Key
- 用 1Password / 同等 secure store；**不**經 IDE selection / Claude transcript（[[feedback_secret_container_no_generic_grep]] / [[feedback_ide_selection_auto_echo_leak]]）

**執行**（fresh PowerShell）：

```powershell
# Vars setup（per [[reference_wrangler_r2_windows_quirk]] Quirk 5 — 不直接內聯長字串）
$env:AWS_ACCESS_KEY_ID     = '<new-limited-token-access-key>'
$env:AWS_SECRET_ACCESS_KEY = '<new-limited-token-secret>'
$ENDPOINT = 'https://2d2c4b4ddbddec1a5d045533c01d715f.r2.cloudflarestorage.com'
$BUCKET   = 'chiyigo-audit-archive'
$FIXTURE_DIR = "docs/fixtures"
$FIXTURE_FILE = "$FIXTURE_DIR/pr-0-2c-prod-lock-emptiness-2026-05-28.json"

# 18 formal prefix list（必與 §2 manifest 1:1 對齊；user 走 walk-through 時可從 plan §2 對照）
$PREFIXES_18 = @(
  'audit-log/prod/audit_log/immutable/',
  'audit-log/prod/audit_log/security_critical/',
  'audit-log/prod/admin_audit_log/immutable/',
  'audit-log/prod/audit_log/security_warn/',
  'audit-log/prod/audit_log/read_audit/',
  'audit-log/prod/audit_log/telemetry/',
  'audit-log/prod/audit_log/debug_failure/',
  'manifest/prod/audit_log/immutable/',
  'manifest/prod/audit_log/security_critical/',
  'manifest/prod/admin_audit_log/immutable/',
  'manifest/prod/audit_log/security_warn/',
  'manifest/prod/audit_log/read_audit/',
  'manifest/prod/audit_log/telemetry/',
  'manifest/prod/audit_log/debug_failure/',
  'audit-log-aggregate-telemetry/prod/',
  'audit-log-aggregate-debug/prod/',
  'manifest/prod/audit_log_aggregate_telemetry/',
  'manifest/prod/audit_log_aggregate_debug/'
)

# Per-prefix scan, raw JSON 收進 fixture
$results = @{
  schema_version = 1
  captured_at = (Get-Date).ToUniversalTime().ToString('o')
  bucket = $BUCKET
  endpoint = $ENDPOINT
  account_id = '2d2c4b4ddbddec1a5d045533c01d715f'
  per_prefix = @{}
}
foreach ($prefix in $PREFIXES_18) {
  # max-keys=5 不只 0/1：撈到 5 個 sample key 可看殘留 pattern
  $raw = aws s3api list-objects-v2 `
    --bucket $BUCKET `
    --prefix $prefix `
    --max-keys 5 `
    --endpoint-url $ENDPOINT `
    --output json
  $parsed = $raw | ConvertFrom-Json
  $results.per_prefix[$prefix] = @{
    raw_response = $parsed
    key_count_observed = if ($parsed.PSObject.Properties.Name -contains 'KeyCount') { $parsed.KeyCount } else { 0 }
    contents_present = ($parsed.PSObject.Properties.Name -contains 'Contents')
  }
}
$results | ConvertTo-Json -Depth 10 | Out-File -FilePath $FIXTURE_FILE -Encoding utf8 -NoNewline
```

**Pass condition**（**ALL 18 prefix 必須同時滿足**）：
- `contents_present` = false（或 = true 但 `key_count_observed` = 0；S3 ListObjectsV2 對空 prefix 預期不含 Contents 欄位）

任一 prefix 失敗（`contents_present = true` AND `key_count_observed >= 1`）→ 走下方「Formal-prefix object found」hard-stop SOP。

**寫進 fixture**：`docs/fixtures/pr-0-2c-prod-lock-emptiness-2026-05-28.json`（per-prefix raw response + key_count + contents_present + timestamps）。Phase 3 commit fixture 與 main plan 文件對齊。

#### Method 2（backup，**若 Method 1 不可行才用**）— CF dashboard visual scan + screenshot 證據

當 S3 limited token Roll 失敗 / aws CLI 不可裝 / 帳號權限不足等 edge case 出現時才走：

1. 打開 https://dash.cloudflare.com → R2 → `chiyigo-audit-archive` → Objects
2. 對 §2 manifest 列的 **18 個 prefix** 一個個 navigate folder tree
3. 對每個 prefix 截圖（含 prefix path 顯示在 breadcrumb + "No objects" / "empty" indicator + timestamp 在角落）
4. 18 張 screenshot 存 `docs/fixtures/pr-0-2c-prod-lock-emptiness-screenshots-2026-05-28/<prefix-slug>.png`
5. fixture JSON 加 `method2_screenshots_dir` 欄位指向資料夾

**注意**：Method 2 是 fallback，不是 default。codex r2 finding 9 明示「dashboard visual scan + screenshot/export evidence 才能取代 scriptable」— 純 visual 不算。

#### Method 3（**sampled yardstick，僅作 sanity check**）— `wrangler r2 bucket info`

```powershell
& $wrangler r2 bucket info chiyigo-audit-archive
```

預期回 `object_count: 0 / Bucket Size: 0 B`。**注意 per [[reference_wrangler_r2_windows_quirk]] Quirk 1：此 cmd 回的 object_count 是 sampled，不反映即時狀態**。所以 Method 3 不能單獨作 gating；只是「如果 Method 3 回非 0，那連 sampled view 都看到物件，肯定有殘留」的反向 sanity check。

#### Gating decision matrix

| Method 1 (S3) | Method 3 (sampled) | Action |
|---|---|---|
| ALL 18 prefix empty | `object_count: 0` | ✅ proceed Phase α |
| ALL 18 prefix empty | `object_count: > 0` | ⚠️ 可能是 18 prefix **外**的物件（sacrificial 殘留 / dry-run 等）；Method 1 已經明確驗 formal prefix 空，仍可 proceed，但**警告 user** Method 3 sampled 看到物件 → 走下方「Formal-prefix object found」step 0（鑑別這些物件是否在 formal prefix 外） |
| 任一 prefix 非空 | 任何 | ❌ **stop run** → 走下方「Formal-prefix object found」hard-stop SOP |
| Method 1 不可行（Method 2 替代） | 任何 | 走 Method 2 並把所有 18 screenshot commit 為證據；其他 Action 同上 |

#### 「Formal-prefix object found」hard-stop SOP（codex r2 finding 7 套用）

**絕對禁止**：看到 formal prefix 內有 object 就跑 `wrangler r2 object delete`。物件可能是 real archive data leak / live writer 痕跡 / manifest 漏網 — delete = data loss + 違反 §安全要求 Tier 0 #3 Correctness 與 #4 Stability。

**Hard-stop SOP**：

**Step 1 — Capture forensic evidence**（per object，**先讀後 nothing else**）：

```powershell
# 對每個被檢出的 key：
$KEY = '<full-key-path-from-Method1-Contents-array>'
$KEY_SLUG = $KEY -replace '/', '__'
aws s3api head-object --bucket $BUCKET --key $KEY --endpoint-url $ENDPOINT --output json > "docs/fixtures/forensic-head-$KEY_SLUG.json"
# 取 size / LastModified / ETag / ContentType / ContentEncoding / Metadata / VersionId（如有）
```

每個 found key 一個 forensic-head fixture。

**Step 2 — Classify provenance via D1 cross-reference**：

對每個 found key 跑 D1 query（在 chiyigo.com workspace 跑，避免敏感 secret container 操作）：

```powershell
# Raw chunks 表
$KEY_SQL = $KEY -replace "'", "''"  # SQL escape single quotes
& $wrangler d1 execute chiyigo_db --remote `
  --command "SELECT * FROM audit_archive_chunks WHERE chunk_key = '$KEY_SQL' OR manifest_key = '$KEY_SQL'"

# Aggregate variants — derive aggregate keys 各 prefix variant 都查（K_data + K_manifest_planned/uploaded/verified/marked_archived = 5 keys per chunk）
& $wrangler d1 execute chiyigo_db --remote `
  --command "SELECT * FROM audit_archive_chunks WHERE chunk_key LIKE 'audit-log-aggregate-%' OR manifest_key LIKE 'manifest/prod/audit_log_aggregate_%'"
```

**Step 3 — Decision tree**：

| 狀態 | 動作 |
|---|---|
| D1 chunks row 有 reference（chunk_key 或任一 state-suffix manifest_key match） | **NEVER delete**；標 incident → 暫停 Phase 3 → 啟動 on-call / user incident response：可能是 real archive data leak（dry-run write 到 formal prefix 而非 dryrun prefix）/ live writer 沒切回 dry-run / 早期 PR 2.0 bug 殘留；走 git history / R2 access log / dashboard activity 完整 forensic provenance |
| D1 no reference + key pattern 含 `dryrun` / `_smoke` / `test` / `spike` 字眼 + LastModified > 30 days + customMetadata 標 `sacrificial=true`（或同等明確 test marker） | **standby for user explicit approval**：將 forensic evidence 給 user 親口確認「這個 object 是 X 測試殘留、可刪」，user 同意後寫進 progress log + Phase 3 fixture，**才**走 `aws s3api delete-object --bucket $BUCKET --key $KEY` （走 S3 limited token；不走 wrangler，避免 owner-bypass 路徑遠期混淆 forensic chain）；delete 完重跑 Method 1 確認 prefix 空才 proceed |
| D1 no reference + key pattern 不明（無 dryrun/test marker、LastModified 近期、無 customMetadata） | **NEVER delete**；保守 incident 路徑同 Row 1；可能是 unknown writer / 早期未文件化的 test path / 外部誤觸 |

**任一 decision row 路徑均不 auto-delete**。本 plan 嚴禁「找到 → 刪 → 跑」的工作流；走 explicit forensic SOP。

### 4.4 lock list 預期空

```powershell
& $wrangler r2 bucket lock list chiyigo-audit-archive
```

預期：**無任何 rule**（cleanup 後狀態，sacrificial `preview-gate-binding-20260525-131627-9416db` 已 remove）。若仍有 rule entry → 停手回報 → 走 cleanup SOP 再跑。

> ⚠️ Phase 1（本 session）**不**跑此 cmd（避免無謂 prod call）；user 在 Phase 3 動工前親跑。

### 4.5 lifecycle list 預期只有 default housekeeping

```powershell
& $wrangler r2 bucket lifecycle list chiyigo-audit-archive
```

預期：**只有** `Default Multipart Abort Rule`（CF 內建 housekeeping，非本 PR 設）。若有其他 entry → 停手回報。

> ⚠️ 同上，Phase 1 不跑。

---

## §5 失敗劇本演練

### 5.1 中途任一條 cmd fail

**場景**：跑到第 N 條（1 ≤ N ≤ 36）任一條失敗（網路、wrangler bug、CF API 5xx、CF 限流、libuv 噴出非 cosmetic error、4xx 非 already-exists）。

**現實 — 依新 phase 結構**：
- 若 fail 發生在 Phase α（lifecycle 18 條） → 已成 N-1 條 **reversible**（`bucket lifecycle remove --id <name>` 可清）；retry 簡單
- 若 fail 發生在 Phase β.1（1y locks） → 已成 1y locks 不可逆但 ~1y 後 retention 過期可解；blast 1y
- 若 fail 發生在 Phase β.2（3y locks） → β.1 全成 + 部分 β.2 不可逆；blast 含 3y
- 若 fail 發生在 Phase β.3（7y locks） → β.1+β.2 全成 + 部分 β.3 不可逆；blast 含 7y

**決策**：
- **rollback 在 Phase α 內**：cmd 失敗可 `lifecycle remove` 清；其他 phase rollback 不存在
- **partial 留著 retry**：唯一可行路徑。已成 N-1 條保留，從 N 開始重跑

**SOP**（codex r1 finding 3 套用 — strict already-exists handling）：
1. 停手記錄 fail cmd 的 stderr / stdout（整段截到 fixture）
2. 看 fail 原因分類：
   - **網路 / 連線錯誤** → 修 + retry 同 cmd
   - **CF API 5xx** → 讀 status.cloudflare.com → 等 5 min 再 retry（不 sleep loop 盲試）
   - **CF API 4xx with "already exists" / equivalent confirmation msg** → **不直接 skip**，先走 list confirm 4-field exact match：
     - `& $wrangler r2 bucket lock list chiyigo-audit-archive`（或 lifecycle list，視 cmd 種類）
     - 對齊 4 欄：(1) name 完全一致 (2) prefix 完全一致 (3) retention-days 或 expire-days 完全一致 (4) enabled / active status 為 true
     - **4/4 match** → 安全 skip，跳到 N+1 cmd
     - **3/4 或以下 match** → **停手** 回報；很可能是同名 rule 在不同 prefix 或 days 上設過（資料 corrupt risk），不可繼續
   - **其他 CF API 4xx**（非 already-exists；如 `400 BadRequest` / `403 Forbidden`） → **停手回報**，不 retry
   - **wrangler OAuth 過期 (401)** → §5.2 SOP
3. retry 後 success → 繼續 N+1 cmd
4. **每一條完成都記錄到 progress log**（手寫文字檔，per `cmd seq num | rule name | prefix | days | success-msg | timestamp`）

### 5.2 wrangler OAuth token 中途過期

**場景**：跑到第 N 條時 wrangler 拋 `Authentication error: Status 401`。

**SOP**：
1. 確認 user 對應的 wrangler login（先 `& $wrangler whoami` 看現有 status）
2. 若 token 確實過期 → `& $wrangler logout` → `& $wrangler login`（browser flow）
3. login 完成後跑 `& $wrangler whoami` 確認回到正確 account（email + Account ID 對齊 §4.1）
4. retry 第 N 條
5. 若 4 重 login 後仍 401 → 停手回報 user，可能是 account 端問題

### 5.3 libuv exit-crash 噴在中間條

**場景**：第 N 條 success log 出來後（顯示 `Added bucket lock rule '...'`），但 wrangler exit 時噴 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`。

**現實**：per [[reference_wrangler_r2_windows_quirk]] Quirk 6 — benign exit-time race，發生在 cmd output flush **之後**，**不影響任何結果**。

**SOP**：忽略，繼續 N+1 cmd。但走 progress log + visual confirm Success 訊息（不只看 exit code）。

### 5.4 同一條 cmd 跑兩次（誤觸 / progress log 混亂；codex r1 finding 3 套用 — strict skip）

**場景**：user 不小心對同一條 rule 跑了兩次 cmd（或 retry 後忘了已成）。

**現實**：wrangler 4.87 對 `bucket lock add` / `bucket lifecycle add` 的同名 rule 大概率回 `4xx already exists`。但「同名 rule 已存在」**不等於**「prefix / days 也對」— 若 user 之前曾用同名設過不同 prefix / days，list 也會回同名，**單看 fail message 會誤 skip 真正錯的 rule**。

**SOP**（**禁直接 skip**）：
1. fail with "already exists" 字樣 → 不直接 skip
2. 走 list verification（同 §5.1 step 2）：
   ```powershell
   & $wrangler r2 bucket lock list chiyigo-audit-archive | findstr <rule-name>
   # 或全 list 後肉眼對 (name, prefix, days, enabled) 4 欄
   ```
3. **4 欄全 match** → 安全 skip，跳下一條
4. **任一欄 mismatch** → 停手；可能是 historical leftover 或誤觸；不可繼續

### 5.5 partial state 沒有 rollback

**確認**：本 plan **不**列出「partial rollback」path 對 Phase β（lock 部分） — 因為不存在。已成部分（lock 條目）依 phase 決定 1y/3y/7y immutable。User walk-through 時必須親口確認接受「Phase β.X 任何一條 lock fail 後，已成 part 就是 partial state，無回頭路；retry 從 fail 那條開始」。

Phase α（lifecycle）內 fail 是 **可 unwind** 的（用 `& $wrangler r2 bucket lifecycle remove <bucket> --id <name>`）；但通常不需要 unwind，直接 retry fail 的那條即可。

### 5.6 Cloudflare 帳號被誤切到他帳

**場景**：wrangler whoami 跑出來的 email / Account ID 不對。

**SOP**：**立刻停手**。一條都不跑。回頭排查 wrangler login state。本 plan 強制 §4.1 在每次 session 進來都重跑。

### 5.7 PowerShell session 中途失常（terminal crash / disconnect）

**場景**：跑到第 N 條時 PowerShell window 意外關閉 / Windows 重開機 / RDP 斷線。

**SOP**：
1. 重開 fresh PowerShell（不在 Claude IDE）
2. 重跑 §4 pre-flight check（`npm ci` 重 setup `$wrangler` + whoami + version + lock list + lifecycle list）— **lock list 與 lifecycle list 不再預期空**，要對著 progress log 確認「已成 N-1 條真的都在 + 沒漂移」
3. 若 list 與 progress log 完全對齊 → 從第 N 條繼續跑
4. 若 list 與 progress log 不一致（多 1 條 / 少 1 條 / 同名但 prefix 異） → **停手** 詳查；可能是 propagation lag / 別人在改 / cmd 跑了但 progress log 沒記

### 5.8 user 看到「Added」success 訊息但 list 沒對應 rule

**場景**：cmd 回 Added but `bucket lock list` 沒看到新 rule。

**現實**：可能 CF propagation 延遲；或 cmd 對錯 bucket。

**SOP**：
1. 等 60s
2. 重跑 `& $wrangler r2 bucket lock list chiyigo-audit-archive`
3. 仍無 → 停手回報；不繼續下一條
4. 走 CF dashboard 視覺驗 R2 bucket > Settings > Bucket Lock 看當下實際狀態

---

## §6 Post-monitor（4 milestone checkpoints + 24hr + 14-day）

### 6.1 4 milestone checkpoints during execution（codex r1 finding 6 套用）

**目的**：每跨一個 phase 抓 forensic snapshot，把 Phase 進度凍結成可審計 fixture。任一 checkpoint 失敗（list 不對齊 §2 manifest）→ 停手回報，不進下一 phase。

**每個 checkpoint 必抓 5 段資料**：
1. `& $wrangler whoami`（account email + ID + name）
2. `& $wrangler --version`（必為 `4.87.0`）
3. `& $wrangler r2 bucket lock list chiyigo-audit-archive`（full output，含每條 rule name / prefix / retention-days / enabled status）
4. `& $wrangler r2 bucket lifecycle list chiyigo-audit-archive`（full output）
5. ISO-8601 UTC timestamp（PowerShell `(Get-Date).ToUniversalTime().ToString('o')`）

**寫進 fixture**：`docs/fixtures/pr-0-2c-full-prod-lock-<YYYY-MM-DD>.json`，per-checkpoint 一個 nested object（schema：`{checkpoint_id, phase, expected_counts, captured_at, whoami, version, lock_list_raw, lifecycle_list_raw}`）。

| Checkpoint | 跑點 | 預期 lock count | 預期 lifecycle count | 預期 rule names |
|---|---|---|---|---|
| **#1** | Phase α 收尾（α.18 跑完） | 0 | 18 + Default Multipart Abort Rule | 18 `expire-*` per §2 manifest |
| **#2** | Phase β.1 收尾（β.1.8 跑完） | 8 | 18 + Default | 8 `lock-{telemetry,debug,manifest-tele,manifest-debug,agg-tele,agg-debug,agg-manifest-tele,agg-manifest-debug}` + 18 `expire-*` |
| **#3** | Phase β.2 收尾（β.2.4 跑完） | 12 | 18 + Default | β.1 8 條 + 4 `lock-{sec-warn,read-audit,manifest-sec-warn,manifest-read}` |
| **#4 (final)** | Phase β.3 收尾（β.3.6 跑完） | 18 | 18 + Default | 全 18 `lock-*` + 全 18 `expire-*`（對齊 §2 manifest 完整集） |

**strict diff method**：checkpoint 採 4-field exact match（同 §5.1 step 2 規則）— rule name、prefix、days、enabled。任一 mismatch → 停手。

**若 checkpoint 過程跑 list cmd 觸發 wrangler 4.87 已知 cosmetic noise**（labelled output / ANSI / libuv exit-crash） → 按 Quirk 5/6 strip 後對；fixture 寫 raw 不 strip 給 future audit。

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

## §7 Open questions — r1 resolution status

### Q1 — Lock vs lifecycle 上序（**RESOLVED by codex r1**）

**Codex r1 verdict**：lifecycle first（reversible setup）→ locks in 1y → 3y → 7y order（partial-fail blast radius ascending）。CF docs 證據：bucket locks > lifecycle rules（lock 後 lifecycle expire 不會誤刪資料）。

**r2 套用**：§3.3 完全重寫 — Phase α 全 18 lifecycle 先 / Phase β 18 lock 後 1y→3y→7y；§3.4 改寫 rationale；`docs/AUDIT_RETENTION_PLAN.md` line 802-897 vs line 178-181 衝突由 codex r1 仲裁解決（採 line 178-181 lifecycle-first，但對 formal prefix 拒 per-rule canary — 見 Q2 resolution）。

**衍生 follow-up**：本 plan 通過後應同步更新 `docs/AUDIT_RETENTION_PLAN.md` line 802-897，把 lock-first 順序改成 lifecycle-first 對齊新 execution sequence；或在 line 906 附近加 note 指向本 plan 作為「實際執行 SoT」。**不阻 Phase 3**；列為衍生 backlog（§9 衍生 memory 追加）。

### Q2 — Per-rule canary on formal prefix（**REJECTED by codex r1**）

**Codex r1 verdict**：reject — PUT canary after lock 會建立 locked objects 在 prefix 內 1/3/7yr 無法刪。Sacrificial 0.2c-pre-3 已 cover propagation enforcement，不需對 formal prefix 重複。Validation 限定 config-list diffing。

**r2 套用**：§3.4 明示拒絕 formal prefix per-rule canary，配 §6.1 4-checkpoint config-list diffing。若未來真需要 formal prefix propagation drill → 走獨立 PR + sacrificial new prefix（同 0.2c-pre-3 模式），不在本 PR 範圍。

### Q3 — Aggregate vs raw 上序（**implicitly RESOLVED by Q1**）

**新狀態**：Q1 resolution 後，上序由 retention tier（1y → 3y → 7y）決定，**不再**由 raw / manifest / aggregate family 決定。同一 tier 內，本 plan 採以下 sub-order：

- Phase β.1（1y）：raw telemetry/debug → manifest tele/debug → aggregate tele/debug → aggregate manifest tele/debug（8 條，依 §3.3 β.1.1 → β.1.8）
- Phase β.2（3y）：raw sec-warn/read-audit → manifest sec-warn/read（4 條，依 §3.3 β.2.1 → β.2.4）
- Phase β.3（7y）：raw immutable/sec-critical/admin-immutable → manifest 3 個（6 條，依 §3.3 β.3.1 → β.3.6）

請 codex r2 確認此 sub-order 是否仍最小化心智 friction（保留 family grouping 在 tier 內）。或建議改其他 sub-order。

### Q4 — Partial state 中間檢查點（**RESOLVED by codex r1 finding 6**）

**Codex r1 verdict**：採 4 milestone checkpoint — after lifecycle / after 1y / after 3y / after 7y final。每點抓 whoami + version + lock list + lifecycle list + timestamp。

**r2 套用**：§6.1 完整實作 4 checkpoint + 5-field fixture schema + 4-field strict diff method。

### Q5 — Rule name uniqueness 風險（**RESOLVED by codex r2 親查 CF docs**）

**Codex r2 answer**：「Cloudflare exposes lock and lifecycle as separate config resources/endpoints: `/lock` and `/lifecycle`, each with its own `rules[].id` described as a unique identifier. I found no official statement that lock IDs and lifecycle IDs share one namespace. Your distinct `lock-*` / `expire-*` names plus 4-field exact-match checks are enough.」

CF docs sources（codex r2 提供）：
- Cloudflare R2 bucket locks docs
- Cloudflare R2 lock API
- Cloudflare R2 lifecycle API

→ 兩 namespace 獨立 + 本 plan distinct prefix（`lock-*` / `expire-*`）+ §5.1/§5.4 4-field exact match = 三層防護。Q5 升 RESOLVED。

### Q6 — wrangler version pin（**RESOLVED by codex r1 finding 4**）

**Codex r1 verdict**：use `.\node_modules\.bin\wrangler.cmd` after `npm ci` + exact `--version` check（preferred）；or `npx --yes wrangler@4.87.0`（backup）。

**r2 套用**：§3.1 / §4.1 / §4.2 全部改用 `$wrangler = "$PWD\node_modules\.bin\wrangler.cmd"` lockfile-pinned binary；§3.3 36 cmd 全部走 `& $wrangler`；備案保留 `npx --yes wrangler@4.87.0` 於 §3.1 末。

### Q7 — Phase 3 執行時長預估（**revised**）

**新預估**：
- §3.1 runner setup（`npm ci` first-time）：~30s-2min（depends on cache state，後續 session 0s）
- §4 pre-flight check：~3-5 min（whoami / version / §4.3 dashboard visual scan 18 prefix 是主要時間 cost）
- §3.3 36 cmd serial（lockfile-pinned binary 跑點本機，無 npx download overhead）：~3-6 min
- §6.1 4 checkpoint（每點 lock list + lifecycle list + 寫 fixture）：~3-4 min
- §6.1 final fixture commit：~2-3 min

**總長預估**：**15-20 min**（保守上限；不含 §4.3 dashboard visual scan 若 user 一邊查證一邊處理殘留）。Codex r1 沒 reject 一次跑完，故本 plan 維持 single-session execution；若 codex r2 認為應拆 session（phase α / β.1 / β.2 / β.3 各一）請建議拆分理由。

---

## §8 Phase 1 → Phase 2 → Phase 3 邊界

本檔（plan doc）= **Phase 1 prep**。Phase 1 收尾條件 = codex r2 Approve plan（含 r1 6 件 finding 全收）。

**Phase 2** = user 親自走 walk-through（per [[feedback_irreversible_action_full_review]]）：
- 從 §1 觸發前提到 §6 post-monitor 全段念過或列 checklist
- 失敗劇本 §5 mental rehearsal
- 一邊念一邊在 fresh PowerShell（不是 Claude IDE）跑 §4 pre-flight check（含 §4.3 18-prefix object emptiness dashboard visual scan）

**Phase 3** = user 親自跑 36 cmd（fresh PS、不是 Claude IDE）：
- §3.1 runner setup → `npm ci` + 設 `$wrangler` 變數
- 對著 §3.3 Phase α → β.1 → β.2 → β.3 順序一條一條跑
- 每條完成都寫 progress log（cmd seq num | rule name | prefix | days | success-msg | timestamp）
- 每 phase 收尾跑 §6.1 對應 checkpoint
- 寫 fixture commit

**Phase 1 嚴守邊界**：本 session **不**跑任何 prod-touching cmd（含 read-only `lock list` / `lifecycle list`）。Phase 1 收尾 = codex r2 Approve plan 後**停手**，給 user 接 Phase 2。

---

## §9 衍生 memory（執行完更新）

Phase 3 完成後，補：
- 更新 [[project_audit_phase2]] —「PR 0.2c full prod lock 全段結」section（HEAD hash / fixture path / 36 rule verify / 24hr no-emit 證據 / 4 checkpoint fixture content / Phase α-β.1-β.2-β.3 各 phase timestamp）
- 若 §5 任何失敗劇本實際發生，補 [[reference_wrangler_r2_windows_quirk]] / 開新 reference memory
- 若 codex r2 在 §7 任何 open question 給出推翻本 r2 的答案，更新本 plan + AUDIT_RETENTION_PLAN.md 對應段
- **(衍生 follow-up，Q1 resolution)**：更新 `docs/AUDIT_RETENTION_PLAN.md` line 802-897 把「lock-first / lifecycle-second」改成「lifecycle-first / lock 1y→3y→7y」對齊新 execution sequence；或於 line 906 附近加 note 指向本 plan 為「實際執行 SoT」
