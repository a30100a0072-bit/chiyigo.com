// ── erp-architecture-3d.js — ERP 8 層立體架構頁（Three.js 版本）──
// WebGL 真實 3D：PerspectiveCamera + DirectionalLight + Raycaster picking
// 自託管 three.module.min.js（~180KB gzipped），無外部依賴、CSP 不動
//
// 互動：
//   - 自動 Y 軸 orbit（按鈕可暫停）
//   - 滑鼠/觸控拖曳手動 orbit + 滾輪縮放
//   - Raycaster 抓 layer / satellite 點擊 → side panel
//   - a11y fallback：隱藏 button 清單給鍵盤 / SR 使用者
//   - WebGL context loss → 顯示 fallback 訊息，requestAnimationFrame 自動暫停
//
// 模組化：本檔以 ES module 載入（<script type="module">），無 IIFE 必要

import * as THREE from '/js/vendor/three.module.min.js';

const LANGS_I18N = {"zh-TW":{"nav_home":"首頁","nav_services":"服務項目與流程","nav_process":"服務流程","nav_portfolio":"chiyigo作品","nav_about":"關於我們","nav_contact":"需求諮詢","tooltip_theme":"切換明暗","tooltip_lang":"切換語言","status_open":"接案中","cta_btn_m":"開始諮詢 →","footer_tagline":"不是只做漂亮畫面，而是幫你把需求變成真正能用的系統。","member_center":"會員中心","logout":"登出","eyebrow":"// 平台架構","title1":"從一個會員系統","title2":"到企業級 ERP 平台","subtitle":"16 個獨立領域、4 條 Event Chain、L1~L8 八層架構。每一塊都能單獨擴展，也能透過事件編織成完整的企業營運。","stat_domains":"L2 領域","stat_events":"Event Chains","stat_layers":"架構層級","stat_modules":"L3+ 子模組","arch_title":"// L2 領域互動圖","arch_hint":"點任一領域查看 L3 子模組與 Event 流向；切換上方 Chain 看跨領域事件動畫 →","chain_label":"Event Chain：","chain_none":"靜態檢視","chain_order":"建立訂單","chain_payment":"付款成功","chain_tenant":"新租戶開通","chain_ai":"AI 自動決策","chain_note_order":"CRM 接到客戶 → 銷售開單 → MDM 對齊主檔 → 財務開立發票 → Workflow 簽核 → 通知客戶 → BI 更新分析 → 檔案歸檔出貨單","chain_note_payment":"金流回拋 → Sales 對應訂單 → Finance 認列收入 → Notify 發送收據 → BI 即時更新 → Integration 同步銀行","chain_note_tenant":"IAM 建立租戶 → MDM 註冊組織主檔 → Metadata 套用客製欄位 → Workflow 啟動 onboarding → Notify 寄歡迎信 → BI 建立租戶儀表板","chain_note_ai":"Event Bus 接到觸發 → Data 抽取上下文 → AI 推理決策 → Knowledge 引用內部知識 → Notify 推播結果 → BI 紀錄成效","panel_hint":"選擇任一領域，這裡會列出領域職責、L3 子模組、L4 細項、相關 Event 流向與技術選型。","view_full":"查看完整架構 →","lab_purpose":"領域職責","lab_l3":"L3 子模組","lab_l4":"L4 / L5 細項","lab_events":"Event 流向","lab_tech":"技術選型","stack_title":"// 八層架構速覽","layer_l1":"L1 平台層","layer_l1_desc":"企業平台根節點，所有領域共用治理、合規、Feature Flag 與多租戶 Runtime","layer_l24":"L2~L4 領域層","layer_l24_desc":"16 個獨立 L2 領域、各自 L3 子模組與 L4 細項；領域間以 Event 通訊，不共用 DB","layer_l57":"L5~L7 能力層","layer_l57_desc":"Service / Storage / Runtime 三層具體實作：PostgreSQL、Redis、Kafka、Elasticsearch、Vector DB","layer_l8":"L8 部署層","layer_l8_desc":"Kubernetes、Multi-region Failover、Disaster Recovery、Cloudflare CDN、WAF","node_iam":"身份權限","node_crm":"CRM 客戶","node_sales":"銷售管理","node_finance":"財務會計","node_workflow":"工作流 BPM","node_event":"事件驅動","node_data":"資料架構","node_mdm":"主資料 MDM","node_notify":"通知中心","node_file":"檔案文件","node_integration":"整合 / API","node_bi":"分析 BI","node_ai":"AI Native","node_metadata":"Metadata-driven","node_knowledge":"知識平台","node_sre":"平台 SRE / 資安","details":{"iam":{"tag":"IDENTITY","purpose":"集中管理使用者身份、權限與 SSO，是所有領域的信任根；任何跨系統存取都先經過 IAM 驗證。","l3":["身份驗證（登入/SSO）","權限控管（RBAC + ABAC）","租戶隔離","安全防護"],"l4":["OAuth 2.0","OIDC / SAML / SCIM","MFA / Passkey","Device Trust","Session / JWT","Audit Log","Risk Score"],"events":["新租戶開通起點"],"tech":["JWT (jose)","OIDC","WebAuthn","TOTP","Cloudflare Workers"]},"crm":{"tag":"CUSTOMER","purpose":"管理潛在客戶到 VIP 的全旅程，銜接行銷、銷售與客服，是建立訂單的起點。","l3":["潛在客戶 Lead","客戶管理","商機 Pipeline","客服工單"],"l4":["Lead Scoring","Customer 360","Pipeline Forecast","Stage Tracking","SLA","Knowledge Base"],"events":["建立訂單入口"],"tech":["PostgreSQL","Elasticsearch","Kafka","AI Lead Scoring"]},"sales":{"tag":"SALES","purpose":"報價、訂單、合約、訂閱計費的核心交易引擎；金流與庫存的觸發源。","l3":["報價 Quote","訂單 Order","合約 Contract","訂閱 Subscription"],"l4":["Pricing Engine","Order Lifecycle","Approval Workflow","E-signature","Usage Billing","Revenue Recognition"],"events":["建立訂單","付款成功"],"tech":["Saga Pattern","CQRS / Event Sourcing","PostgreSQL"]},"finance":{"tag":"FINANCE","purpose":"最高一致性核心：總帳、應收應付、稅務、財務報表；唯一可以寫入帳務的領域。","l3":["總帳 GL","應收 AR","應付 AP","財務報表"],"l4":["Journal Entry","AR Aging / Dunning","Vendor Bill / AP Reconciliation","Tax Validation","P&L","Balance Sheet","Cash Flow"],"events":["付款成功","建立訂單"],"tech":["ACID","Two-Phase Commit","PostgreSQL HA","Fiscal Period Lock"]},"workflow":{"tag":"WORKFLOW","purpose":"跨系統中樞：BPMN 流程、簽核鏈、規則引擎、SLA 追蹤；所有需要人工或多步驟協作都走這層。","l3":["State Machine","BPMN 流程設計","規則引擎","簽核鏈"],"l4":["Retry","Escalation","SLA Tracking","Condition Engine","Pricing Rules","Validation Rules"],"events":["建立訂單","新租戶開通"],"tech":["Temporal","BPMN 2.0","Drools"]},"event":{"tag":"EVENT-BUS","purpose":"Domain 解耦的訊息總線，承載所有跨領域非同步通訊；可靠性、Retry、Replay、Idempotency 的保證者。","l3":["Event Bus","Domain Event","可靠性機制"],"l4":["Kafka Topic","Consumer Group","DLQ","Replay","Idempotency","Event Versioning"],"events":["AI 自動決策核心"],"tech":["Kafka","RabbitMQ","Schema Registry"]},"data":{"tag":"DATA","purpose":"ACID 交易、分散一致性、全文搜尋、資料倉儲、Lakehouse；所有讀寫的物理基礎。","l3":["交易管理","資料一致性","搜尋架構","資料倉儲"],"l4":["Saga","Optimistic / Pessimistic Lock","Full-text Search","ETL","OLAP","Data Lake"],"events":["AI 自動決策"],"tech":["PostgreSQL","Elasticsearch","Snowflake / Databricks"]},"mdm":{"tag":"MASTER","purpose":"商品、客戶、財務、組織主檔的全域唯一真實版本；解決多系統間「同一客戶五個 ID」的痛點。","l3":["商品主檔","客戶主檔","財務主檔","組織主檔"],"l4":["SKU 標準化","Unified Customer ID","幣別 / 稅率","Region Mapping","Match / Merge"],"events":["建立訂單","新租戶開通"],"tech":["MDM Hub","PostgreSQL","Fuzzy Match"]},"notify":{"tag":"NOTIFY","purpose":"統一發送 Email / SMS / Push / 站內通知與 Webhook；模板、頻率限制、重試集中管理。","l3":["Email","SMS / Push","站內通知","Webhook"],"l4":["Template","Rate Limit","Retry / DLQ","Delivery Tracking"],"events":["建立訂單","付款成功","新租戶開通","AI 自動決策"],"tech":["Resend","Twilio","FCM","Cloudflare Queues"]},"file":{"tag":"FILE","purpose":"企業檔案的版本、權限、OCR、電子簽章與 Lifecycle；發票、合約、出貨單都在這歸檔。","l3":["檔案上傳","權限控制","版本管理","OCR","電子簽章"],"l4":["S3 / R2 Storage","Pre-signed URL","Lifecycle Policy","DocuSign Integration"],"events":["建立訂單"],"tech":["S3 / Cloudflare R2","Tesseract / Textract","DocuSign API"]},"integration":{"tag":"INTEGRATION","purpose":"對外連接器集中地：API Gateway、Webhook、ETL、ERP / Bank / Payment / EDI / SOAP 都在這。","l3":["API Gateway","Webhook","ETL Pipeline","Connector"],"l4":["Rate Limit","OpenAPI Registry","SAP / Oracle Connector","Stripe / ECPay","Bank API","EDI / SOAP"],"events":["付款成功"],"tech":["Kong","Apache Camel","OpenAPI 3.0"]},"bi":{"tag":"ANALYTICS","purpose":"高層 KPI、營運儀表板、預測分析的唯讀讀模型；只讀不寫，避免污染交易資料。","l3":["高層儀表板","營運儀表板","KPI Engine","預測分析"],"l4":["Revenue Dashboard","Churn Analysis","Forecast","Cohort","Retention"],"events":["建立訂單","付款成功","AI 自動決策"],"tech":["Metabase / Tableau","ClickHouse","dbt"]},"ai":{"tag":"AI","purpose":"AI Native：Agent、推薦、預測、詐欺偵測、Copilot；不是外掛，而是嵌入每個流程的決策層。","l3":["AI Agent","AI Recommendation","AI Forecast","AI Fraud Detection","AI Copilot"],"l4":["RAG Pipeline","Vector DB","MCP Integration","SQL Agent","Tool Use"],"events":["AI 自動決策"],"tech":["Claude / GPT","LangChain","pgvector","MCP Protocol"]},"metadata":{"tag":"METADATA","purpose":"Dynamic Form / Workflow / UI / Permission 的後設驅動平台；客製欄位不用改 code，運維直接拉。","l3":["Dynamic Form","Dynamic Workflow","Dynamic Permission","Metadata Runtime"],"l4":["Schema Versioning","Hot Reload","Custom Field","No-code Builder"],"events":["新租戶開通"],"tech":["JSON Schema","GraphQL","Apollo Federation"]},"knowledge":{"tag":"KNOWLEDGE","purpose":"Knowledge Graph / Semantic Search / RAG / Enterprise Wiki；AI 的長期記憶與企業知識資產。","l3":["Knowledge Graph","Semantic Search","Enterprise Wiki","Context Engine"],"l4":["Graph DB","Embedding Pipeline","Hybrid Search","Citation / Lineage"],"events":["AI 自動決策"],"tech":["Neo4j","pgvector","Sentence-BERT"]},"sre":{"tag":"PLATFORM","purpose":"CI/CD、Kubernetes、可觀測性、WAF、Secret、SIEM、Multi-region DR；讓整個平台 24×7 不倒。","l3":["CI/CD","Kubernetes","可觀測性","WAF / DDoS","Secret Manager","Disaster Recovery"],"l4":["Prometheus / Grafana","Sentry","Vault / KMS","Cloudflare WAF","Chaos Engineering","Multi-region Failover"],"events":[],"tech":["Kubernetes","Cloudflare","Grafana","ArgoCD"]}},"picker_label":"快速選擇領域","picker_placeholder":"— 選擇領域 —","picker_overview":"▸ 領域總覽","l3d_title":"8 層立體架構","l3d_subtitle":"L1~L8 八層直接視覺化堆疊；16 個 L2 領域作為衛星節點環繞中央塔。拖曳旋轉、點任一層或節點查看細節。","l3d_drag_hint":"拖曳旋轉 · 滾輪縮放","l3d_autorotate":"自動旋轉","l3d_paused":"已暫停","l3d_orbit_label":"L2 衛星","layer_1_name":"L1 企業平台","layer_1_desc":"根節點：所有領域共用治理、合規、Feature Flag、多租戶 Runtime、Kill Switch 與配額管理。","layer_2_name":"L2 領域邊界","layer_2_desc":"16 個獨立 L2 領域；不共用 DB、跨域用 Event 通訊；財務為最高一致性核心。","layer_3_name":"L3 子模組","layer_3_desc":"每個 L2 拆解出 3~5 個 L3 子模組（例如 IAM → 身份驗證 / 權限控管 / 租戶隔離 / 安全防護）。","layer_4_name":"L4 細項能力","layer_4_desc":"L3 再拆解出可獨立部署的能力單元（OAuth / SAML / MFA / Device Trust ...）；每個都有明確邊界。","layer_5_name":"L5 服務層","layer_5_desc":"微服務具體實作（Auth Service / Session Service / Token Service / SSO Service）；獨立水平擴展。","layer_6_name":"L6 能力層","layer_6_desc":"Service / Storage / Runtime：PostgreSQL HA / Redis Cluster / Kafka / Elasticsearch / Vector DB。","layer_7_name":"L7 執行層","layer_7_desc":"容器化 Runtime：Pod / Worker / Scheduler / Queue / Cron；負責真正跑 code 的物理位置。","layer_8_name":"L8 部署層","layer_8_desc":"多區域 Failover / Disaster Recovery / Cloudflare CDN / WAF / Kubernetes Cluster；物理基礎設施。","l3d_webgl_fail":"您的瀏覽器不支援 WebGL 或顯示卡資源不足；請使用支援 WebGL 的瀏覽器查看 3D 架構，或前往 2D 版本。","view_2d":"查看 2D 版本 →"},"en":{"nav_home":"Home","nav_services":"Services","nav_process":"Process","nav_portfolio":"Portfolio","nav_about":"About","nav_contact":"Contact","tooltip_theme":"Toggle theme","tooltip_lang":"Switch language","status_open":"Open for projects","cta_btn_m":"Start a project →","footer_tagline":"Not just pretty screens — we turn requirements into systems that actually run.","member_center":"Member Center","logout":"Sign out","eyebrow":"// Platform Architecture","title1":"From a member system","title2":"to an enterprise ERP platform","subtitle":"16 bounded contexts · 4 event chains · 8 architectural layers (L1~L8). Each block scales independently, yet weaves into a unified operating fabric through events.","stat_domains":"L2 Domains","stat_events":"Event Chains","stat_layers":"Layers","stat_modules":"L3+ Modules","arch_title":"// L2 Domain Map","arch_hint":"Click any domain for L3 modules + event flow. Pick a Chain above for cross-domain animation →","chain_label":"Event Chain:","chain_none":"Static view","chain_order":"Order Created","chain_payment":"Payment Success","chain_tenant":"Tenant Onboarding","chain_ai":"AI Auto-Decision","chain_note_order":"CRM captures customer → Sales drafts order → MDM aligns master data → Finance issues invoice → Workflow runs approval → Notify customer → BI updates analytics → File archives shipment","chain_note_payment":"Gateway callback → Sales reconciles order → Finance recognizes revenue → Notify sends receipt → BI updates dashboard → Integration syncs bank","chain_note_tenant":"IAM provisions tenant → MDM registers org master → Metadata applies custom fields → Workflow runs onboarding → Notify sends welcome → BI seeds tenant dashboard","chain_note_ai":"Event Bus triggers → Data fetches context → AI reasons → Knowledge cites internal facts → Notify pushes result → BI records outcome","panel_hint":"Pick any domain — purpose, L3 modules, L4 details, related event chains and tech choices appear here.","view_full":"View full architecture →","lab_purpose":"Purpose","lab_l3":"L3 Modules","lab_l4":"L4 / L5 Details","lab_events":"Event Flow","lab_tech":"Tech Choice","stack_title":"// 8-Layer Architecture","layer_l1":"L1 Platform","layer_l1_desc":"Enterprise root: governance, compliance, feature flags, multi-tenant runtime shared by all domains","layer_l24":"L2~L4 Domain","layer_l24_desc":"16 bounded contexts with their own L3 modules and L4 details. Domains communicate via events, never share DB","layer_l57":"L5~L7 Capability","layer_l57_desc":"Service / Storage / Runtime concrete impl: PostgreSQL, Redis, Kafka, Elasticsearch, Vector DB","layer_l8":"L8 Deployment","layer_l8_desc":"Kubernetes, multi-region failover, disaster recovery, Cloudflare CDN, WAF","node_iam":"Identity & Access","node_crm":"CRM Customer","node_sales":"Sales","node_finance":"Finance","node_workflow":"Workflow & BPM","node_event":"Event-Driven","node_data":"Data Architecture","node_mdm":"Master Data (MDM)","node_notify":"Notification","node_file":"Files & Docs","node_integration":"Integration / API","node_bi":"Analytics & BI","node_ai":"AI Native","node_metadata":"Metadata-driven","node_knowledge":"Knowledge Platform","node_sre":"Platform SRE / Sec","details":{"iam":{"tag":"IDENTITY","purpose":"Central authority for identity, permission and SSO — the trust root every other domain depends on.","l3":["AuthN (Login/SSO)","AuthZ (RBAC + ABAC)","Tenant Isolation","Security"],"l4":["OAuth 2.0","OIDC / SAML / SCIM","MFA / Passkey","Device Trust","Session / JWT","Audit Log","Risk Score"],"events":["Origin of Tenant Onboarding"],"tech":["JWT (jose)","OIDC","WebAuthn","TOTP","Cloudflare Workers"]},"crm":{"tag":"CUSTOMER","purpose":"Lead-to-VIP journey across marketing, sales and service — the entry point for every order.","l3":["Lead Capture","Customer Mgmt","Pipeline","Service Tickets"],"l4":["Lead Scoring","Customer 360","Pipeline Forecast","Stage Tracking","SLA","Knowledge Base"],"events":["Order Created entry"],"tech":["PostgreSQL","Elasticsearch","Kafka","AI Lead Scoring"]},"sales":{"tag":"SALES","purpose":"Quote-Order-Contract-Subscription transaction engine — trigger source for payment and inventory.","l3":["Quote","Order","Contract","Subscription"],"l4":["Pricing Engine","Order Lifecycle","Approval Workflow","E-signature","Usage Billing","Revenue Recognition"],"events":["Order Created","Payment Success"],"tech":["Saga Pattern","CQRS / Event Sourcing","PostgreSQL"]},"finance":{"tag":"FINANCE","purpose":"Strongest consistency core: GL, AR, AP, tax, statements — the only domain allowed to write books.","l3":["General Ledger","Accounts Receivable","Accounts Payable","Financial Reports"],"l4":["Journal Entry","AR Aging / Dunning","AP Reconciliation","Tax Validation","P&L","Balance Sheet","Cash Flow"],"events":["Payment Success","Order Created"],"tech":["ACID","Two-Phase Commit","PostgreSQL HA","Fiscal Period Lock"]},"workflow":{"tag":"WORKFLOW","purpose":"Cross-system hub: BPMN flows, approval chains, rule engines, SLA tracking for every multi-step process.","l3":["State Machine","BPMN Designer","Rule Engine","Approval Chain"],"l4":["Retry","Escalation","SLA Tracking","Condition Engine","Pricing Rules","Validation Rules"],"events":["Order Created","Tenant Onboarding"],"tech":["Temporal","BPMN 2.0","Drools"]},"event":{"tag":"EVENT-BUS","purpose":"Decoupled messaging backbone — guarantees retry, replay, idempotency for all async traffic.","l3":["Event Bus","Domain Event","Reliability"],"l4":["Kafka Topic","Consumer Group","DLQ","Replay","Idempotency","Event Versioning"],"events":["Core of AI Auto-Decision"],"tech":["Kafka","RabbitMQ","Schema Registry"]},"data":{"tag":"DATA","purpose":"ACID, distributed consistency, full-text search, warehouse, lakehouse — physical foundation of every read/write.","l3":["Transaction","Consistency","Search","Warehouse"],"l4":["Saga","Optimistic / Pessimistic Lock","Full-text Search","ETL","OLAP","Data Lake"],"events":["AI Auto-Decision"],"tech":["PostgreSQL","Elasticsearch","Snowflake / Databricks"]},"mdm":{"tag":"MASTER","purpose":"Single source of truth for product/customer/finance/org masters — solves the 'same customer, 5 IDs' problem.","l3":["Product Master","Customer Master","Finance Master","Org Master"],"l4":["SKU Standardization","Unified Customer ID","Currency / Tax","Region Mapping","Match / Merge"],"events":["Order Created","Tenant Onboarding"],"tech":["MDM Hub","PostgreSQL","Fuzzy Match"]},"notify":{"tag":"NOTIFY","purpose":"Unified Email / SMS / Push / in-app / webhook delivery — central template, rate-limit and retry.","l3":["Email","SMS / Push","In-app","Webhook"],"l4":["Template","Rate Limit","Retry / DLQ","Delivery Tracking"],"events":["Order Created","Payment Success","Tenant Onboarding","AI Auto-Decision"],"tech":["Resend","Twilio","FCM","Cloudflare Queues"]},"file":{"tag":"FILE","purpose":"Versioning, permission, OCR, e-signature, lifecycle for enterprise documents — where invoices and contracts live.","l3":["Upload","Permission","Version","OCR","E-signature"],"l4":["S3 / R2 Storage","Pre-signed URL","Lifecycle Policy","DocuSign Integration"],"events":["Order Created"],"tech":["S3 / Cloudflare R2","Tesseract / Textract","DocuSign API"]},"integration":{"tag":"INTEGRATION","purpose":"Outbound connector hub: API Gateway, Webhook, ETL, ERP / Bank / Payment / EDI / SOAP all live here.","l3":["API Gateway","Webhook","ETL Pipeline","Connector"],"l4":["Rate Limit","OpenAPI Registry","SAP / Oracle Connector","Stripe / ECPay","Bank API","EDI / SOAP"],"events":["Payment Success"],"tech":["Kong","Apache Camel","OpenAPI 3.0"]},"bi":{"tag":"ANALYTICS","purpose":"Read-only analytic model for execs and ops — never writes back to transactional data.","l3":["Exec Dashboard","Ops Dashboard","KPI Engine","Forecasting"],"l4":["Revenue Dashboard","Churn Analysis","Forecast","Cohort","Retention"],"events":["Order Created","Payment Success","AI Auto-Decision"],"tech":["Metabase / Tableau","ClickHouse","dbt"]},"ai":{"tag":"AI","purpose":"AI-native: agents, recommendation, forecast, fraud, copilot — embedded into every flow, not bolted on.","l3":["AI Agent","Recommendation","Forecast","Fraud Detection","Copilot"],"l4":["RAG Pipeline","Vector DB","MCP Integration","SQL Agent","Tool Use"],"events":["AI Auto-Decision"],"tech":["Claude / GPT","LangChain","pgvector","MCP Protocol"]},"metadata":{"tag":"METADATA","purpose":"Metadata-driven platform for dynamic form / workflow / UI / permission — custom fields without code changes.","l3":["Dynamic Form","Dynamic Workflow","Dynamic Permission","Metadata Runtime"],"l4":["Schema Versioning","Hot Reload","Custom Field","No-code Builder"],"events":["Tenant Onboarding"],"tech":["JSON Schema","GraphQL","Apollo Federation"]},"knowledge":{"tag":"KNOWLEDGE","purpose":"Knowledge Graph, semantic search, RAG, enterprise wiki — long-term memory for the AI layer.","l3":["Knowledge Graph","Semantic Search","Enterprise Wiki","Context Engine"],"l4":["Graph DB","Embedding Pipeline","Hybrid Search","Citation / Lineage"],"events":["AI Auto-Decision"],"tech":["Neo4j","pgvector","Sentence-BERT"]},"sre":{"tag":"PLATFORM","purpose":"CI/CD, Kubernetes, observability, WAF, secret, SIEM, multi-region DR — keeps the platform up 24×7.","l3":["CI/CD","Kubernetes","Observability","WAF / DDoS","Secret Manager","Disaster Recovery"],"l4":["Prometheus / Grafana","Sentry","Vault / KMS","Cloudflare WAF","Chaos Engineering","Multi-region Failover"],"events":[],"tech":["Kubernetes","Cloudflare","Grafana","ArgoCD"]}},"picker_label":"Quick pick domain","picker_placeholder":"— Select domain —","picker_overview":"▸ Domain overview","l3d_title":"8-Layer 3D Architecture","l3d_subtitle":"L1~L8 stacked in 3D space, 16 L2 domains orbit as satellites. Drag to rotate, click any layer or node for details.","l3d_drag_hint":"Drag to rotate · Scroll to zoom","l3d_autorotate":"Auto-rotate","l3d_paused":"Paused","l3d_orbit_label":"L2 Satellites","layer_1_name":"L1 Platform","layer_1_desc":"Root: governance, compliance, feature flags, multi-tenant runtime, kill switch and quota shared by all domains.","layer_2_name":"L2 Domain Boundary","layer_2_desc":"16 bounded contexts. No shared DB, cross-domain via events. Finance is the strongest consistency core.","layer_3_name":"L3 Sub-Module","layer_3_desc":"Each L2 decomposes into 3~5 L3 modules (e.g. IAM → AuthN / AuthZ / Tenant / Security).","layer_4_name":"L4 Capability","layer_4_desc":"L3 broken into deployable capability units (OAuth / SAML / MFA / Device Trust ...) with clear boundaries.","layer_5_name":"L5 Service","layer_5_desc":"Microservice impls (Auth / Session / Token / SSO Service) — independently scalable.","layer_6_name":"L6 Capability","layer_6_desc":"Service / Storage / Runtime: PostgreSQL HA / Redis Cluster / Kafka / Elasticsearch / Vector DB.","layer_7_name":"L7 Runtime","layer_7_desc":"Containerized runtime: Pod / Worker / Scheduler / Queue / Cron — where code actually executes.","layer_8_name":"L8 Deployment","layer_8_desc":"Multi-region failover / DR / Cloudflare CDN / WAF / Kubernetes — physical infrastructure.","l3d_webgl_fail":"Your browser does not support WebGL or GPU resources are unavailable. Try a WebGL-capable browser, or view the 2D version.","view_2d":"View 2D version →"},"ja":{"nav_home":"ホーム","nav_services":"サービス","nav_process":"プロセス","nav_portfolio":"ポートフォリオ","nav_about":"私たちについて","nav_contact":"お問い合わせ","tooltip_theme":"テーマ切替","tooltip_lang":"言語切替","status_open":"受付中","cta_btn_m":"相談を始める →","footer_tagline":"きれいな画面だけではなく、要件を本当に動くシステムに変えます。","member_center":"メンバーセンター","logout":"ログアウト","eyebrow":"// プラットフォームアーキテクチャ","title1":"会員システムから","title2":"エンタープライズ ERP プラットフォームへ","subtitle":"16 のドメイン・4 つのイベントチェーン・L1〜L8 の 8 層アーキテクチャ。各ブロックは独立して拡張でき、イベントで一つの企業オペレーションへ織り上がる。","stat_domains":"L2 ドメイン","stat_events":"イベントチェーン","stat_layers":"アーキ層数","stat_modules":"L3+ モジュール","arch_title":"// L2 ドメイン マップ","arch_hint":"ドメインをクリックで L3 とイベント表示。上部の Chain でアニメーション →","chain_label":"Event Chain：","chain_none":"静的表示","chain_order":"注文作成","chain_payment":"支払成功","chain_tenant":"新テナント開通","chain_ai":"AI 自動判断","chain_note_order":"CRM が顧客を捕捉 → Sales が起票 → MDM がマスタ整合 → Finance が請求書発行 → Workflow が承認 → Notify が顧客へ通知 → BI が分析更新 → File が出荷書類を保管","chain_note_payment":"ゲートウェイ通知 → Sales が注文照合 → Finance が売上計上 → Notify が領収書送信 → BI 即時更新 → Integration が銀行同期","chain_note_tenant":"IAM がテナント作成 → MDM が組織マスタ登録 → Metadata がカスタム項目適用 → Workflow がオンボーディング → Notify が歓迎メール → BI がダッシュボード生成","chain_note_ai":"Event Bus がトリガ → Data がコンテキスト抽出 → AI が推論 → Knowledge が社内知識を参照 → Notify が結果配信 → BI が成果記録","panel_hint":"ドメインを選択すると、責務・L3・L4・関連イベント・技術選定が表示されます。","view_full":"完全版アーキを見る →","lab_purpose":"ドメイン責務","lab_l3":"L3 モジュール","lab_l4":"L4 / L5 詳細","lab_events":"イベント フロー","lab_tech":"技術選定","stack_title":"// 8 層アーキテクチャ","layer_l1":"L1 プラットフォーム","layer_l1_desc":"全ドメインで共有するガバナンス・コンプラ・Feature Flag・マルチテナント Runtime","layer_l24":"L2〜L4 ドメイン","layer_l24_desc":"16 のドメイン、それぞれの L3・L4。ドメイン間はイベント通信、DB は非共有","layer_l57":"L5〜L7 ケイパビリティ","layer_l57_desc":"Service / Storage / Runtime 具体実装：PostgreSQL、Redis、Kafka、Elasticsearch、Vector DB","layer_l8":"L8 デプロイ","layer_l8_desc":"Kubernetes、マルチリージョン Failover、DR、Cloudflare CDN、WAF","node_iam":"ID と権限","node_crm":"CRM 顧客","node_sales":"セールス","node_finance":"財務会計","node_workflow":"ワークフロー BPM","node_event":"イベント駆動","node_data":"データ基盤","node_mdm":"マスタデータ MDM","node_notify":"通知センター","node_file":"ファイル・文書","node_integration":"統合 / API","node_bi":"分析 BI","node_ai":"AI Native","node_metadata":"Metadata-driven","node_knowledge":"ナレッジ基盤","node_sre":"プラットフォーム SRE / セキュリティ","details":{"iam":{"tag":"IDENTITY","purpose":"ID・権限・SSO を集中管理し、全ドメインの信頼基盤となる。","l3":["認証（ログイン / SSO）","認可（RBAC + ABAC）","テナント分離","セキュリティ"],"l4":["OAuth 2.0","OIDC / SAML / SCIM","MFA / Passkey","Device Trust","Session / JWT","Audit Log","Risk Score"],"events":["テナント開通の起点"],"tech":["JWT (jose)","OIDC","WebAuthn","TOTP","Cloudflare Workers"]},"crm":{"tag":"CUSTOMER","purpose":"見込み客から VIP までの全旅程を管理し、マーケ・営業・サポートを繋ぐ。","l3":["リード","顧客管理","パイプライン","サポートチケット"],"l4":["Lead Scoring","Customer 360","Pipeline Forecast","Stage Tracking","SLA","Knowledge Base"],"events":["注文作成の入口"],"tech":["PostgreSQL","Elasticsearch","Kafka","AI Lead Scoring"]},"sales":{"tag":"SALES","purpose":"見積・受注・契約・サブスクの取引エンジン。","l3":["見積","受注","契約","サブスク"],"l4":["Pricing Engine","Order Lifecycle","Approval Workflow","E-signature","Usage Billing","Revenue Recognition"],"events":["注文作成","支払成功"],"tech":["Saga Pattern","CQRS / Event Sourcing","PostgreSQL"]},"finance":{"tag":"FINANCE","purpose":"最高一貫性の核：総勘定・AR・AP・税務・財務諸表。","l3":["総勘定 GL","AR 売掛","AP 買掛","財務諸表"],"l4":["Journal Entry","AR Aging / Dunning","AP Reconciliation","Tax Validation","P&L","Balance Sheet","Cash Flow"],"events":["支払成功","注文作成"],"tech":["ACID","Two-Phase Commit","PostgreSQL HA","Fiscal Period Lock"]},"workflow":{"tag":"WORKFLOW","purpose":"BPMN・承認・ルールエンジン・SLA を司るクロスシステム中枢。","l3":["State Machine","BPMN 設計","ルールエンジン","承認チェーン"],"l4":["Retry","Escalation","SLA Tracking","Condition Engine","Pricing Rules","Validation Rules"],"events":["注文作成","テナント開通"],"tech":["Temporal","BPMN 2.0","Drools"]},"event":{"tag":"EVENT-BUS","purpose":"ドメイン疎結合のメッセージ基盤。Retry・Replay・冪等性を保証。","l3":["Event Bus","Domain Event","信頼性"],"l4":["Kafka Topic","Consumer Group","DLQ","Replay","Idempotency","Event Versioning"],"events":["AI 自動判断の中核"],"tech":["Kafka","RabbitMQ","Schema Registry"]},"data":{"tag":"DATA","purpose":"ACID、分散整合、全文検索、DWH、Lakehouse — 全 I/O の物理基盤。","l3":["トランザクション","整合性","検索","DWH"],"l4":["Saga","Optimistic / Pessimistic Lock","Full-text Search","ETL","OLAP","Data Lake"],"events":["AI 自動判断"],"tech":["PostgreSQL","Elasticsearch","Snowflake / Databricks"]},"mdm":{"tag":"MASTER","purpose":"商品・顧客・財務・組織マスタの唯一真実。「同一顧客 5 ID」を解決。","l3":["商品マスタ","顧客マスタ","財務マスタ","組織マスタ"],"l4":["SKU 標準化","Unified Customer ID","通貨 / 税率","Region Mapping","Match / Merge"],"events":["注文作成","テナント開通"],"tech":["MDM Hub","PostgreSQL","Fuzzy Match"]},"notify":{"tag":"NOTIFY","purpose":"Email / SMS / Push / アプリ内 / Webhook の統合配信。","l3":["Email","SMS / Push","アプリ内通知","Webhook"],"l4":["Template","Rate Limit","Retry / DLQ","Delivery Tracking"],"events":["注文作成","支払成功","テナント開通","AI 自動判断"],"tech":["Resend","Twilio","FCM","Cloudflare Queues"]},"file":{"tag":"FILE","purpose":"バージョン・権限・OCR・電子署名・ライフサイクル。","l3":["アップロード","権限","バージョン","OCR","電子署名"],"l4":["S3 / R2 Storage","Pre-signed URL","Lifecycle Policy","DocuSign Integration"],"events":["注文作成"],"tech":["S3 / Cloudflare R2","Tesseract / Textract","DocuSign API"]},"integration":{"tag":"INTEGRATION","purpose":"API Gateway・Webhook・ETL・ERP/Bank/Payment/EDI/SOAP の外部接続ハブ。","l3":["API Gateway","Webhook","ETL Pipeline","Connector"],"l4":["Rate Limit","OpenAPI Registry","SAP / Oracle Connector","Stripe / ECPay","Bank API","EDI / SOAP"],"events":["支払成功"],"tech":["Kong","Apache Camel","OpenAPI 3.0"]},"bi":{"tag":"ANALYTICS","purpose":"経営・運用ダッシュボードと予測の読み取り専用モデル。","l3":["経営ダッシュボード","運用ダッシュボード","KPI Engine","予測分析"],"l4":["Revenue Dashboard","Churn Analysis","Forecast","Cohort","Retention"],"events":["注文作成","支払成功","AI 自動判断"],"tech":["Metabase / Tableau","ClickHouse","dbt"]},"ai":{"tag":"AI","purpose":"AI ネイティブ：エージェント・推薦・予測・不正検知・Copilot を各フローに埋め込む。","l3":["AI Agent","推薦","予測","不正検知","Copilot"],"l4":["RAG Pipeline","Vector DB","MCP Integration","SQL Agent","Tool Use"],"events":["AI 自動判断"],"tech":["Claude / GPT","LangChain","pgvector","MCP Protocol"]},"metadata":{"tag":"METADATA","purpose":"動的フォーム・ワークフロー・UI・権限のメタデータ駆動。","l3":["Dynamic Form","Dynamic Workflow","Dynamic Permission","Metadata Runtime"],"l4":["Schema Versioning","Hot Reload","Custom Field","No-code Builder"],"events":["テナント開通"],"tech":["JSON Schema","GraphQL","Apollo Federation"]},"knowledge":{"tag":"KNOWLEDGE","purpose":"Knowledge Graph・セマンティック検索・RAG・社内 Wiki — AI の長期記憶。","l3":["Knowledge Graph","Semantic Search","Enterprise Wiki","Context Engine"],"l4":["Graph DB","Embedding Pipeline","Hybrid Search","Citation / Lineage"],"events":["AI 自動判断"],"tech":["Neo4j","pgvector","Sentence-BERT"]},"sre":{"tag":"PLATFORM","purpose":"CI/CD・Kubernetes・可観測性・WAF・Secret・SIEM・DR を担う基盤層。","l3":["CI/CD","Kubernetes","可観測性","WAF / DDoS","Secret Manager","災害対策"],"l4":["Prometheus / Grafana","Sentry","Vault / KMS","Cloudflare WAF","Chaos Engineering","Multi-region Failover"],"events":[],"tech":["Kubernetes","Cloudflare","Grafana","ArgoCD"]}},"picker_label":"ドメイン選択","picker_placeholder":"— ドメインを選ぶ —","picker_overview":"▸ ドメイン全体","l3d_title":"8 層 3D アーキテクチャ","l3d_subtitle":"L1〜L8 を 3D 空間に積層、16 ドメインが衛星として周回。ドラッグで回転、レイヤーやノードをクリックで詳細。","l3d_drag_hint":"ドラッグで回転 · ホイールでズーム","l3d_autorotate":"自動回転","l3d_paused":"一時停止","l3d_orbit_label":"L2 衛星","layer_1_name":"L1 プラットフォーム","layer_1_desc":"ルート：全ドメイン共有のガバナンス・コンプライアンス・Feature Flag・マルチテナント Runtime・Kill Switch。","layer_2_name":"L2 ドメイン境界","layer_2_desc":"16 のドメイン。DB 共有なし、イベント通信、財務が最強一貫性コア。","layer_3_name":"L3 サブモジュール","layer_3_desc":"各 L2 を 3〜5 個の L3 に分解（IAM → 認証 / 認可 / テナント / セキュリティ）。","layer_4_name":"L4 ケイパビリティ","layer_4_desc":"L3 を独立デプロイ可能な単位に分解（OAuth / SAML / MFA / Device Trust）。","layer_5_name":"L5 サービス","layer_5_desc":"マイクロサービス実装（Auth / Session / Token / SSO Service）独立水平拡張。","layer_6_name":"L6 ケイパビリティ","layer_6_desc":"Service / Storage / Runtime：PostgreSQL HA / Redis / Kafka / Elasticsearch / Vector DB。","layer_7_name":"L7 ランタイム","layer_7_desc":"コンテナ Runtime：Pod / Worker / Scheduler / Queue / Cron。コードが実行される場所。","layer_8_name":"L8 デプロイ","layer_8_desc":"マルチリージョン Failover / DR / Cloudflare CDN / WAF / Kubernetes。物理基盤。","l3d_webgl_fail":"ブラウザが WebGL をサポートしていないか、GPU リソースが不足しています。WebGL 対応ブラウザで開くか、2D 版をご覧ください。","view_2d":"2D 版を見る →"},"ko":{"nav_home":"홈","nav_services":"서비스","nav_process":"프로세스","nav_portfolio":"포트폴리오","nav_about":"소개","nav_contact":"문의","tooltip_theme":"테마 전환","tooltip_lang":"언어 전환","status_open":"프로젝트 수락 중","cta_btn_m":"상담 시작 →","footer_tagline":"보기 좋은 화면이 아니라, 요구사항을 실제로 작동하는 시스템으로 만듭니다.","member_center":"회원센터","logout":"로그아웃","eyebrow":"// 플랫폼 아키텍처","title1":"회원 시스템에서","title2":"엔터프라이즈 ERP 플랫폼으로","subtitle":"16개 도메인 · 4개 이벤트 체인 · L1~L8 8계층. 각 블록은 독립적으로 확장 가능하며, 이벤트로 하나의 기업 운영으로 엮입니다.","stat_domains":"L2 도메인","stat_events":"Event Chain","stat_layers":"아키 계층","stat_modules":"L3+ 모듈","arch_title":"// L2 도메인 맵","arch_hint":"도메인 클릭으로 L3·이벤트 확인. 상단 Chain 으로 애니메이션 →","chain_label":"Event Chain:","chain_none":"정적 보기","chain_order":"주문 생성","chain_payment":"결제 성공","chain_tenant":"신규 테넌트 개통","chain_ai":"AI 자동 결정","chain_note_order":"CRM 고객 확보 → Sales 주문 → MDM 마스터 정합 → Finance 청구 → Workflow 결재 → Notify 알림 → BI 분석 → File 출고서 보관","chain_note_payment":"게이트웨이 콜백 → Sales 주문 매칭 → Finance 수익 인식 → Notify 영수증 → BI 실시간 업데이트 → Integration 은행 동기화","chain_note_tenant":"IAM 테넌트 생성 → MDM 조직 마스터 등록 → Metadata 사용자정의 필드 → Workflow 온보딩 → Notify 환영메일 → BI 대시보드 생성","chain_note_ai":"Event Bus 트리거 → Data 컨텍스트 수집 → AI 추론 → Knowledge 내부 지식 인용 → Notify 결과 전송 → BI 성과 기록","panel_hint":"도메인을 선택하면 책임·L3·L4·관련 이벤트·기술 선정이 표시됩니다.","view_full":"전체 아키 보기 →","lab_purpose":"도메인 책임","lab_l3":"L3 모듈","lab_l4":"L4 / L5 상세","lab_events":"이벤트 흐름","lab_tech":"기술 선정","stack_title":"// 8계층 아키텍처","layer_l1":"L1 플랫폼","layer_l1_desc":"전 도메인이 공유하는 거버넌스·컴플라이언스·Feature Flag·멀티테넌트 런타임","layer_l24":"L2~L4 도메인","layer_l24_desc":"16개 도메인, 각 L3·L4. 도메인 간은 이벤트 통신, DB 비공유","layer_l57":"L5~L7 케이퍼빌리티","layer_l57_desc":"Service / Storage / Runtime: PostgreSQL, Redis, Kafka, Elasticsearch, Vector DB","layer_l8":"L8 배포","layer_l8_desc":"Kubernetes, 멀티리전 Failover, DR, Cloudflare CDN, WAF","node_iam":"신원·권한","node_crm":"CRM 고객","node_sales":"세일즈","node_finance":"재무회계","node_workflow":"워크플로 BPM","node_event":"이벤트 드리븐","node_data":"데이터 아키","node_mdm":"마스터 데이터 MDM","node_notify":"알림 센터","node_file":"파일·문서","node_integration":"통합 / API","node_bi":"분석 BI","node_ai":"AI Native","node_metadata":"Metadata-driven","node_knowledge":"지식 플랫폼","node_sre":"플랫폼 SRE / 보안","details":{"iam":{"tag":"IDENTITY","purpose":"신원·권한·SSO 중앙 관리, 모든 도메인의 신뢰 루트.","l3":["인증 (로그인/SSO)","권한 (RBAC + ABAC)","테넌트 격리","보안"],"l4":["OAuth 2.0","OIDC / SAML / SCIM","MFA / Passkey","Device Trust","Session / JWT","Audit Log","Risk Score"],"events":["테넌트 개통 시작점"],"tech":["JWT (jose)","OIDC","WebAuthn","TOTP","Cloudflare Workers"]},"crm":{"tag":"CUSTOMER","purpose":"리드부터 VIP 까지 전체 여정. 마케팅·세일즈·서비스 연결.","l3":["리드","고객 관리","파이프라인","서비스 티켓"],"l4":["Lead Scoring","Customer 360","Pipeline Forecast","Stage Tracking","SLA","Knowledge Base"],"events":["주문 생성 진입점"],"tech":["PostgreSQL","Elasticsearch","Kafka","AI Lead Scoring"]},"sales":{"tag":"SALES","purpose":"견적·주문·계약·구독 거래 엔진.","l3":["견적","주문","계약","구독"],"l4":["Pricing Engine","Order Lifecycle","Approval Workflow","E-signature","Usage Billing","Revenue Recognition"],"events":["주문 생성","결제 성공"],"tech":["Saga Pattern","CQRS / Event Sourcing","PostgreSQL"]},"finance":{"tag":"FINANCE","purpose":"최강 정합성 코어: GL·AR·AP·세무·재무제표.","l3":["총계정 GL","AR 매출채권","AP 매입채무","재무 보고"],"l4":["Journal Entry","AR Aging / Dunning","AP Reconciliation","Tax Validation","P&L","Balance Sheet","Cash Flow"],"events":["결제 성공","주문 생성"],"tech":["ACID","Two-Phase Commit","PostgreSQL HA","Fiscal Period Lock"]},"workflow":{"tag":"WORKFLOW","purpose":"BPMN·결재·룰 엔진·SLA 의 크로스 시스템 허브.","l3":["State Machine","BPMN 설계","룰 엔진","결재 체인"],"l4":["Retry","Escalation","SLA Tracking","Condition Engine","Pricing Rules","Validation Rules"],"events":["주문 생성","테넌트 개통"],"tech":["Temporal","BPMN 2.0","Drools"]},"event":{"tag":"EVENT-BUS","purpose":"도메인 디커플링 메시지 백본. Retry·Replay·멱등성 보장.","l3":["Event Bus","Domain Event","신뢰성"],"l4":["Kafka Topic","Consumer Group","DLQ","Replay","Idempotency","Event Versioning"],"events":["AI 자동 결정 코어"],"tech":["Kafka","RabbitMQ","Schema Registry"]},"data":{"tag":"DATA","purpose":"ACID·분산 정합·전문 검색·DW·Lakehouse — 모든 I/O 의 물리 기반.","l3":["트랜잭션","정합성","검색","DW"],"l4":["Saga","Optimistic / Pessimistic Lock","Full-text Search","ETL","OLAP","Data Lake"],"events":["AI 자동 결정"],"tech":["PostgreSQL","Elasticsearch","Snowflake / Databricks"]},"mdm":{"tag":"MASTER","purpose":"상품·고객·재무·조직 마스터의 단일 진실. '동일 고객 5 ID' 해결.","l3":["상품 마스터","고객 마스터","재무 마스터","조직 마스터"],"l4":["SKU 표준화","Unified Customer ID","통화 / 세율","Region Mapping","Match / Merge"],"events":["주문 생성","테넌트 개통"],"tech":["MDM Hub","PostgreSQL","Fuzzy Match"]},"notify":{"tag":"NOTIFY","purpose":"Email / SMS / Push / 인앱 / 웹훅 통합 전송.","l3":["Email","SMS / Push","인앱 알림","Webhook"],"l4":["Template","Rate Limit","Retry / DLQ","Delivery Tracking"],"events":["주문 생성","결제 성공","테넌트 개통","AI 자동 결정"],"tech":["Resend","Twilio","FCM","Cloudflare Queues"]},"file":{"tag":"FILE","purpose":"버전·권한·OCR·전자서명·라이프사이클.","l3":["업로드","권한","버전","OCR","전자서명"],"l4":["S3 / R2 Storage","Pre-signed URL","Lifecycle Policy","DocuSign Integration"],"events":["주문 생성"],"tech":["S3 / Cloudflare R2","Tesseract / Textract","DocuSign API"]},"integration":{"tag":"INTEGRATION","purpose":"API Gateway·Webhook·ETL·ERP/Bank/Payment/EDI/SOAP 외부 연결 허브.","l3":["API Gateway","Webhook","ETL Pipeline","Connector"],"l4":["Rate Limit","OpenAPI Registry","SAP / Oracle Connector","Stripe / ECPay","Bank API","EDI / SOAP"],"events":["결제 성공"],"tech":["Kong","Apache Camel","OpenAPI 3.0"]},"bi":{"tag":"ANALYTICS","purpose":"경영·운영 대시보드와 예측의 읽기 전용 모델.","l3":["경영 대시보드","운영 대시보드","KPI Engine","예측 분석"],"l4":["Revenue Dashboard","Churn Analysis","Forecast","Cohort","Retention"],"events":["주문 생성","결제 성공","AI 자동 결정"],"tech":["Metabase / Tableau","ClickHouse","dbt"]},"ai":{"tag":"AI","purpose":"AI 네이티브: 에이전트·추천·예측·이상거래·Copilot 을 각 플로우에 내장.","l3":["AI Agent","추천","예측","이상거래 탐지","Copilot"],"l4":["RAG Pipeline","Vector DB","MCP Integration","SQL Agent","Tool Use"],"events":["AI 자동 결정"],"tech":["Claude / GPT","LangChain","pgvector","MCP Protocol"]},"metadata":{"tag":"METADATA","purpose":"동적 폼·워크플로·UI·권한의 메타데이터 드리븐.","l3":["Dynamic Form","Dynamic Workflow","Dynamic Permission","Metadata Runtime"],"l4":["Schema Versioning","Hot Reload","Custom Field","No-code Builder"],"events":["테넌트 개통"],"tech":["JSON Schema","GraphQL","Apollo Federation"]},"knowledge":{"tag":"KNOWLEDGE","purpose":"Knowledge Graph·시맨틱 검색·RAG·사내 위키 — AI 의 장기 기억.","l3":["Knowledge Graph","Semantic Search","Enterprise Wiki","Context Engine"],"l4":["Graph DB","Embedding Pipeline","Hybrid Search","Citation / Lineage"],"events":["AI 자동 결정"],"tech":["Neo4j","pgvector","Sentence-BERT"]},"sre":{"tag":"PLATFORM","purpose":"CI/CD·Kubernetes·관측성·WAF·시크릿·SIEM·DR — 24×7 가동 책임.","l3":["CI/CD","Kubernetes","관측성","WAF / DDoS","Secret Manager","재해 복구"],"l4":["Prometheus / Grafana","Sentry","Vault / KMS","Cloudflare WAF","Chaos Engineering","Multi-region Failover"],"events":[],"tech":["Kubernetes","Cloudflare","Grafana","ArgoCD"]}},"picker_label":"도메인 선택","picker_placeholder":"— 도메인 선택 —","picker_overview":"▸ 도메인 전체","l3d_title":"8 계층 3D 아키텍처","l3d_subtitle":"L1~L8 을 3D 공간에 적층, 16 도메인이 위성처럼 공전. 드래그로 회전, 레이어/노드 클릭으로 상세.","l3d_drag_hint":"드래그로 회전 · 휠로 줌","l3d_autorotate":"자동 회전","l3d_paused":"일시정지","l3d_orbit_label":"L2 위성","layer_1_name":"L1 플랫폼","layer_1_desc":"루트: 거버넌스·컴플라이언스·Feature Flag·멀티테넌트 런타임·Kill Switch·쿼터.","layer_2_name":"L2 도메인 경계","layer_2_desc":"16 도메인. DB 비공유, 이벤트 통신, 재무가 최강 정합성 코어.","layer_3_name":"L3 서브모듈","layer_3_desc":"각 L2 가 3~5 개 L3 모듈로 분해 (IAM → 인증 / 권한 / 테넌트 / 보안).","layer_4_name":"L4 케이퍼빌리티","layer_4_desc":"L3 를 독립 배포 단위로 분해 (OAuth / SAML / MFA / Device Trust).","layer_5_name":"L5 서비스","layer_5_desc":"마이크로서비스 (Auth / Session / Token / SSO Service) 독립 수평 확장.","layer_6_name":"L6 케이퍼빌리티","layer_6_desc":"Service / Storage / Runtime: PostgreSQL HA / Redis / Kafka / Elasticsearch / Vector DB.","layer_7_name":"L7 런타임","layer_7_desc":"컨테이너 런타임: Pod / Worker / Scheduler / Queue / Cron. 코드가 실행되는 곳.","layer_8_name":"L8 배포","layer_8_desc":"멀티리전 Failover / DR / Cloudflare CDN / WAF / Kubernetes. 물리 인프라.","l3d_webgl_fail":"브라우저가 WebGL 을 지원하지 않거나 GPU 자원이 부족합니다. WebGL 지원 브라우저로 열거나 2D 버전을 보세요.","view_2d":"2D 버전 보기 →"}};

// ── 16 L2 衛星節點：兩環 8 節點，與 CSS 版相同座標規格 ──
const NODES = [
  // Upper ring (y=+100) — Three.js Y 軸上為正
  { id:'iam',         ang:0,     r:300, ty:100,  tag:'IDENTITY'    },
  { id:'crm',         ang:45,    r:300, ty:100,  tag:'CUSTOMER'    },
  { id:'sales',       ang:90,    r:300, ty:100,  tag:'SALES'       },
  { id:'finance',     ang:135,   r:300, ty:100,  tag:'FINANCE'     },
  { id:'workflow',    ang:180,   r:300, ty:100,  tag:'WORKFLOW'    },
  { id:'mdm',         ang:225,   r:300, ty:100,  tag:'MASTER'      },
  { id:'file',        ang:270,   r:300, ty:100,  tag:'FILE'        },
  { id:'integration', ang:315,   r:300, ty:100,  tag:'INTEGRATION' },
  // Lower ring (y=-100)
  { id:'event',       ang:22.5,  r:300, ty:-100, tag:'EVENT-BUS'   },
  { id:'data',        ang:67.5,  r:300, ty:-100, tag:'DATA'        },
  { id:'ai',          ang:112.5, r:300, ty:-100, tag:'AI'          },
  { id:'metadata',    ang:157.5, r:300, ty:-100, tag:'METADATA'    },
  { id:'knowledge',   ang:202.5, r:300, ty:-100, tag:'KNOWLEDGE'   },
  { id:'notify',      ang:247.5, r:300, ty:-100, tag:'NOTIFY'      },
  { id:'bi',          ang:292.5, r:300, ty:-100, tag:'ANALYTICS'   },
  { id:'sre',         ang:337.5, r:300, ty:-100, tag:'PLATFORM'    },
];

// ── 18 條 EDGES（跨領域功能依賴，與 2D 版同步） ──
const EDGES = [
  ['iam','mdm'], ['iam','workflow'], ['iam','metadata'],
  ['crm','sales'], ['sales','finance'], ['sales','mdm'], ['sales','file'],
  ['finance','integration'], ['finance','file'],
  ['workflow','event'], ['workflow','metadata'],
  ['event','data'], ['event','notify'], ['event','ai'],
  ['ai','data'], ['ai','knowledge'],
  ['bi','data'], ['mdm','data'],
];

// ── 配色：分 5 個語意群（業務 / 資料 / AI / I/O / 平台），避免單一色相視覺扁平 ──
const PALETTE = {
  accent:      0x6c6ee5,  // 品牌紫 — 業務核心
  accentLight: 0x8c91ff,  // 淺紫 — highlight
  cyan:        0x4cd6cc,  // 青 — 資料 / 事件 / 主檔
  pink:        0xe57eb6,  // 桃 — AI / 知識 / metadata
  amber:       0xf0b85a,  // 琥珀 — I/O / 通知 / 整合
  green:       0x5edb89,  // 綠 — 分析 BI
  coral:       0xff7a85,  // 珊瑚紅 — 身份 / 資安
};
// 衛星統一品牌紫（外圍簡潔，視覺重心留給內部 8 層）
const NODE_COLOR = Object.fromEntries(
  ['iam','crm','sales','finance','workflow','event','data','mdm','notify','file','integration','bi','ai','metadata','knowledge','sre']
    .map(id => [id, PALETTE.accent])
);
// 8 層紫→藍漸層軸（用戶選定）：上桃 → 紫系下行 → 中段青→藍 → 底部暖色收尾
const LAYER_COLOR = {
  1: 0xe57eb6, // pink — 平台抽象頂層
  2: 0xc79cfc, // lavender — 領域邊界
  3: 0x8b8cef, // periwinkle — 子模組
  4: 0x6c6ee5, // brand purple — 細項
  5: 0x4cd6cc, // cyan — 服務
  6: 0x5fb3e8, // sky blue — 能力 / 儲存
  7: 0xf0b85a, // amber — 執行 Runtime
  8: 0x5edb89, // green — 部署基礎設施
};

// 顏色工具
function hexRGB(hex){ return { r:(hex>>16)&255, g:(hex>>8)&255, b:hex&255 }; }
function rgba(hex, a){ const { r,g,b } = hexRGB(hex); return `rgba(${r},${g},${b},${a})`; }
function lighten(hex, amt=0.4){
  const { r,g,b } = hexRGB(hex);
  const lr = Math.min(255, Math.round(r + (255-r)*amt));
  const lg = Math.min(255, Math.round(g + (255-g)*amt));
  const lb = Math.min(255, Math.round(b + (255-b)*amt));
  return (lr<<16)|(lg<<8)|lb;
}
function hexStr(hex){ return '#' + hex.toString(16).padStart(6, '0'); }

// ── DOM refs ──
const SCENE_EL = document.getElementById('erp3-scene');
const CANVAS = document.getElementById('erp3-canvas');
const A11Y_LIST = document.getElementById('erp3-a11y');
const FALLBACK = document.getElementById('erp3-fallback');
const AUTO_BTN = document.getElementById('erp3-auto-toggle');
const RESET_BTN = document.getElementById('erp3-reset');
const PANEL_EMPTY = document.getElementById('erp3-panel-empty');
const PANEL_BODY = document.getElementById('erp3-panel-body');
const PANEL_TAG = document.getElementById('erp3-panel-tag');
const PANEL_TITLE = document.getElementById('erp3-panel-title');
const PANEL_DESC = document.getElementById('erp3-panel-desc');
const PANEL_L3_BLOCK = document.getElementById('erp3-panel-l3-block');
const PANEL_L4_BLOCK = document.getElementById('erp3-panel-l4-block');
const PANEL_TECH_BLOCK = document.getElementById('erp3-panel-tech-block');
const PANEL_L3 = document.getElementById('erp3-panel-l3');
const PANEL_L4 = document.getElementById('erp3-panel-l4');
const PANEL_TECH = document.getElementById('erp3-panel-tech');
const PANEL_CLOSE = document.getElementById('erp3-panel-close');

// ── State ──
let curLang = localStorage.getItem('lang') || 'zh-TW';
let autoRotate = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
let activeKind = null;
let activeId = null;

const tDict = () => LANGS_I18N[curLang] || LANGS_I18N['en'] || {};
const tFallback = () => LANGS_I18N['en'] || LANGS_I18N['zh-TW'] || {};
const nodeLabel = n => {
  const t = tDict(), fb = tFallback();
  return t['node_'+n.id] || fb['node_'+n.id] || n.id;
};
const layerName = lvl => {
  const t = tDict(), fb = tFallback();
  return t['layer_'+lvl+'_name'] || fb['layer_'+lvl+'_name'] || ('L' + lvl);
};
const layerDesc = lvl => {
  const t = tDict(), fb = tFallback();
  return t['layer_'+lvl+'_desc'] || fb['layer_'+lvl+'_desc'] || '';
};
const getDetails = id => {
  const t = tDict(), fb = tFallback();
  return (t.details && t.details[id]) || (fb.details && fb.details[id]) || null;
};
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ── Canvas-texture helper ──
// 用 2D canvas 畫文字 → 包成 THREE.CanvasTexture
function makeTextTexture({ tag, name, width=512, height=128, accent=PALETTE.accent, highlight=false }){
  const dpr = 2;
  const c = document.createElement('canvas');
  c.width = width * dpr; c.height = height * dpr;
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  const accentLight = lighten(accent, 0.35);
  // 圓角背景
  const r = 16;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(width - r, 0); ctx.quadraticCurveTo(width, 0, width, r);
  ctx.lineTo(width, height - r); ctx.quadraticCurveTo(width, height, width - r, height);
  ctx.lineTo(r, height); ctx.quadraticCurveTo(0, height, 0, height - r);
  ctx.lineTo(0, r); ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  // 漸層底（accent → accentLight，highlight 時更飽和）
  const grad = ctx.createLinearGradient(0, 0, width, height);
  if (highlight) {
    grad.addColorStop(0, rgba(accent, 0.92));
    grad.addColorStop(1, rgba(accentLight, 0.65));
  } else {
    grad.addColorStop(0, rgba(accent, 0.55));
    grad.addColorStop(1, rgba(accentLight, 0.22));
  }
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = hexStr(highlight ? lighten(accent, 0.55) : accent);
  ctx.lineWidth = highlight ? 3 : 2;
  ctx.stroke();
  // tag chip
  if (tag) {
    const tagW = 56, tagH = 26;
    const tagX = 16, tagY = (height - tagH) / 2;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(tagX, tagY, tagW, tagH, 6) : (() => {
      ctx.moveTo(tagX + 6, tagY);
      ctx.lineTo(tagX + tagW - 6, tagY); ctx.quadraticCurveTo(tagX + tagW, tagY, tagX + tagW, tagY + 6);
      ctx.lineTo(tagX + tagW, tagY + tagH - 6); ctx.quadraticCurveTo(tagX + tagW, tagY + tagH, tagX + tagW - 6, tagY + tagH);
      ctx.lineTo(tagX + 6, tagY + tagH); ctx.quadraticCurveTo(tagX, tagY + tagH, tagX, tagY + tagH - 6);
      ctx.lineTo(tagX, tagY + 6); ctx.quadraticCurveTo(tagX, tagY, tagX + 6, tagY);
    })();
    ctx.fillStyle = rgba(accent, 0.6);
    ctx.fill();
    ctx.fillStyle = '#f5f1ff';  // 米白偏紫，跟主體 #f5f1ff 文字色一致
    ctx.font = 'bold 14px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tag, tagX + tagW/2, tagY + tagH/2);
  }
  // name — 米白偏紫 #f5f1ff + 深底陰影增加可讀性（淺色背景時不會死掉）
  ctx.save();
  ctx.shadowColor = 'rgba(26,29,43,0.55)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = '#f5f1ff';
  ctx.font = '600 22px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, tag ? 86 : 24, height/2);
  ctx.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return { tex, canvas: c };
}

// ── Three.js scene setup ──
let renderer, scene, camera, raycaster, mouse;
let towerGroup, satGroup, spine, spineGlow;
const layerMeshes = []; // [{ mesh, lvl, baseTex, hiTex, info }]
const satMeshes = [];   // [{ mesh, node, baseTex, hiTex, info }]
const edgeLines = [];   // [{ line, a, b, mat }]

const cam = { theta: 0.6, phi: 0.18, radius: 850 };
let dragging = false, didDrag = false;
let dragStartX = 0, dragStartY = 0, startTheta = 0, startPhi = 0;
let contextLost = false;

function initScene(){
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
  renderer = new THREE.WebGLRenderer({ canvas: CANVAS, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Lighting — 主要是給 spine 用，texture 已自帶顏色
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const key = new THREE.DirectionalLight(0x8c91ff, 0.6); key.position.set(300, 400, 300); scene.add(key);
  const rim = new THREE.DirectionalLight(0x6c6ee5, 0.3); rim.position.set(-200, 100, -300); scene.add(rim);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  // 中央 spine —— 用 vertexColors 做上下顏色漸層（上桃 → 下綠，呼應 L1~L8 顏色軸）
  const spineGeom = new THREE.CylinderGeometry(3, 3, 600, 24, 1);
  const posCount = spineGeom.attributes.position.count;
  const cAttr = new Float32Array(posCount * 3);
  const topColor = new THREE.Color(PALETTE.pink);
  const botColor = new THREE.Color(PALETTE.green);
  for (let i = 0; i < posCount; i++) {
    const y = spineGeom.attributes.position.getY(i);   // -300..+300
    const t = (y + 300) / 600;                         // 0..1，下 0、上 1
    const col = botColor.clone().lerp(topColor, t);
    cAttr[i*3] = col.r; cAttr[i*3+1] = col.g; cAttr[i*3+2] = col.b;
  }
  spineGeom.setAttribute('color', new THREE.BufferAttribute(cAttr, 3));
  const spineMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85 });
  spine = new THREE.Mesh(spineGeom, spineMat);
  scene.add(spine);

  // 外圈光暈（柔和紫色 halo）
  const glowGeom = new THREE.CylinderGeometry(14, 14, 600, 24);
  const glowMat = new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.22, depthWrite: false });
  spineGlow = new THREE.Mesh(glowGeom, glowMat);
  scene.add(spineGlow);

  // 8 層 tower
  towerGroup = new THREE.Group();
  scene.add(towerGroup);
  for (let lvl = 1; lvl <= 8; lvl++) {
    const tag = 'L' + lvl;
    const name = layerName(lvl);
    const accent = LAYER_COLOR[lvl] || PALETTE.accent;
    const { tex: baseTex } = makeTextTexture({ tag, name, width: 380, height: 64, accent });
    const { tex: hiTex } = makeTextTexture({ tag, name, width: 380, height: 64, accent, highlight: true });
    const geom = new THREE.PlaneGeometry(380, 64);
    const mat = new THREE.MeshBasicMaterial({ map: baseTex, transparent: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = (4.5 - lvl) * 70;  // L1 top, L8 bottom
    mesh.userData = { kind: 'layer', id: lvl };
    towerGroup.add(mesh);
    layerMeshes.push({ mesh, lvl, baseTex, hiTex });
  }

  // 16 衛星
  satGroup = new THREE.Group();
  scene.add(satGroup);
  for (const n of NODES) {
    const accent = NODE_COLOR[n.id] || PALETTE.accent;
    const { tex: baseTex } = makeTextTexture({ tag: n.tag, name: nodeLabel(n), width: 320, height: 72, accent });
    const { tex: hiTex } = makeTextTexture({ tag: n.tag, name: nodeLabel(n), width: 320, height: 72, accent, highlight: true });
    const geom = new THREE.PlaneGeometry(180, 40);
    const mat = new THREE.MeshBasicMaterial({ map: baseTex, transparent: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    const rad = (n.ang * Math.PI) / 180;
    mesh.position.set(Math.sin(rad) * n.r, n.ty, Math.cos(rad) * n.r);
    mesh.userData = { kind: 'node', id: n.id };
    satGroup.add(mesh);
    satMeshes.push({ mesh, node: n, baseTex, hiTex });
  }

  // EDGES 功能線：用 CylinderGeometry 當粗 tube 而不是 Line（多數平台 LineBasicMaterial.linewidth 只 1px，
  // 改用 tube 才能在任何視角呈現可見的粗度）
  const UP = new THREE.Vector3(0, 1, 0);
  for (const [a, b] of EDGES) {
    const na = NODES.find(n => n.id === a);
    const nb = NODES.find(n => n.id === b);
    if (!na || !nb) continue;
    const aRad = (na.ang * Math.PI) / 180;
    const bRad = (nb.ang * Math.PI) / 180;
    const pa = new THREE.Vector3(Math.sin(aRad) * na.r, na.ty, Math.cos(aRad) * na.r);
    const pb = new THREE.Vector3(Math.sin(bRad) * nb.r, nb.ty, Math.cos(bRad) * nb.r);
    const dir = new THREE.Vector3().subVectors(pb, pa);
    const len = dir.length();
    const geom = new THREE.CylinderGeometry(1.6, 1.6, len, 8, 1);
    const mat = new THREE.MeshBasicMaterial({ color: PALETTE.accentLight, transparent: true, opacity: 0.6, depthWrite: false });
    const tube = new THREE.Mesh(geom, mat);
    tube.position.copy(pa).add(dir.clone().multiplyScalar(0.5));
    tube.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
    scene.add(tube);
    edgeLines.push({ line: tube, a, b, mat });
  }
}

// ── EDGES 高亮更新：點 node 時相鄰 edge 變粗變亮、其他 dim ──
function refreshEdges(){
  for (const { line, a, b, mat } of edgeLines) {
    if (activeKind === 'node') {
      const isHit = activeId === a || activeId === b;
      mat.opacity = isHit ? 0.98 : 0.05;
      mat.color.setHex(isHit ? PALETTE.accentLight : PALETTE.accent);
      // 變粗：scale X/Z（cylinder 的徑向），Y 保持長度
      line.scale.x = line.scale.z = isHit ? 2.4 : 1;
    } else {
      mat.opacity = 0.6;
      mat.color.setHex(PALETTE.accentLight);
      line.scale.x = line.scale.z = 1;
    }
  }
}

// ── Camera orbit ──
function updateCamera(){
  camera.position.x = Math.sin(cam.theta) * Math.cos(cam.phi) * cam.radius;
  camera.position.y = Math.sin(cam.phi) * cam.radius + 30;
  camera.position.z = Math.cos(cam.theta) * Math.cos(cam.phi) * cam.radius;
  camera.lookAt(0, 0, 0);
}

// ── Billboarding：所有 layer + satellite 面對相機 ──
function billboardAll(){
  for (const { mesh } of layerMeshes) mesh.quaternion.copy(camera.quaternion);
  for (const { mesh } of satMeshes) mesh.quaternion.copy(camera.quaternion);
}

// ── Active state mesh texture swap ──
function refreshActiveTextures(){
  for (const { mesh, lvl, baseTex, hiTex } of layerMeshes) {
    mesh.material.map = (activeKind === 'layer' && activeId === lvl) ? hiTex : baseTex;
    mesh.material.needsUpdate = true;
  }
  for (const { mesh, node, baseTex, hiTex } of satMeshes) {
    mesh.material.map = (activeKind === 'node' && activeId === node.id) ? hiTex : baseTex;
    mesh.material.needsUpdate = true;
  }
}

// ── Render loop ──
let lastT = 0;
function tick(t){
  if (contextLost) return;
  if (!lastT) lastT = t;
  const dt = (t - lastT) / 1000;
  lastT = t;
  if (autoRotate && !dragging) {
    cam.theta -= dt * 0.18;
  }
  updateCamera();
  billboardAll();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

// ── Resize ──
function onResize(){
  if (!renderer || !camera) return;
  const w = SCENE_EL.clientWidth;
  const h = SCENE_EL.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ── Pointer interaction ──
function onPointerDown(e){
  dragging = true; didDrag = false;
  const p = e.touches ? e.touches[0] : e;
  dragStartX = p.clientX; dragStartY = p.clientY;
  startTheta = cam.theta; startPhi = cam.phi;
  SCENE_EL.setPointerCapture?.(e.pointerId);
}
function onPointerMove(e){
  if (!dragging) return;
  const p = e.touches ? e.touches[0] : e;
  const dx = p.clientX - dragStartX, dy = p.clientY - dragStartY;
  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
  cam.theta = startTheta - dx * 0.005;
  cam.phi = Math.max(-0.2, Math.min(0.7, startPhi + dy * 0.003));
}
function onPointerUp(){ dragging = false; }
function onWheel(e){
  e.preventDefault();
  cam.radius = Math.max(450, Math.min(1500, cam.radius + e.deltaY * 0.8));
}
function onClick(e){
  if (didDrag) return;
  const rect = CANVAS.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const targets = [...layerMeshes.map(x => x.mesh), ...satMeshes.map(x => x.mesh)];
  const hits = raycaster.intersectObjects(targets);
  if (hits.length) {
    const ud = hits[0].object.userData;
    if (activeKind === ud.kind && activeId === ud.id) setActive(null, null);
    else setActive(ud.kind, ud.id);
  } else {
    setActive(null, null);
  }
}

// ── Panel ──
function renderLayerPanel(lvl){
  const t = tDict(), fb = tFallback();
  PANEL_EMPTY.hidden = true;
  PANEL_BODY.hidden = false;
  PANEL_TAG.textContent = 'L' + lvl;
  PANEL_TITLE.textContent = layerName(lvl);
  PANEL_DESC.textContent = layerDesc(lvl);
  PANEL_L3_BLOCK.hidden = true;
  PANEL_L4_BLOCK.hidden = true;
  PANEL_TECH_BLOCK.hidden = true;
}
function renderNodePanel(id){
  const n = NODES.find(x => x.id === id);
  const d = getDetails(id);
  if (!n || !d) return;
  PANEL_EMPTY.hidden = true;
  PANEL_BODY.hidden = false;
  PANEL_TAG.textContent = d.tag || n.tag;
  PANEL_TITLE.textContent = nodeLabel(n);
  PANEL_DESC.textContent = d.purpose || '';
  PANEL_L3.innerHTML = (d.l3 || []).map(s => `<li>${esc(s)}</li>`).join('');
  PANEL_L3_BLOCK.hidden = !d.l3 || !d.l3.length;
  PANEL_L4.innerHTML = (d.l4 || []).map(s => `<span>${esc(s)}</span>`).join('');
  PANEL_L4_BLOCK.hidden = !d.l4 || !d.l4.length;
  PANEL_TECH.innerHTML = (d.tech || []).map(s => `<span>${esc(s)}</span>`).join('');
  PANEL_TECH_BLOCK.hidden = !d.tech || !d.tech.length;
}
function clearPanel(){
  PANEL_BODY.hidden = true;
  PANEL_EMPTY.hidden = false;
  PANEL_L3_BLOCK.hidden = true;
  PANEL_L4_BLOCK.hidden = true;
  PANEL_TECH_BLOCK.hidden = true;
}
function setActive(kind, id){
  activeKind = kind;
  activeId = id;
  refreshActiveTextures();
  refreshEdges();
  if (kind === 'layer') renderLayerPanel(id);
  else if (kind === 'node') renderNodePanel(id);
  else clearPanel();
  // a11y list 同步
  A11Y_LIST?.querySelectorAll('button').forEach(b => {
    const k = b.dataset.kind, i = b.dataset.id;
    b.setAttribute('aria-pressed', (kind === k && String(id) === i) ? 'true' : 'false');
  });
}

// ── A11y fallback button list ──
function buildA11yList(){
  if (!A11Y_LIST) return;
  A11Y_LIST.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = (tDict().l3d_title || 'Architecture') + ' — accessible list';
  h.style.fontSize = '14px';
  h.style.margin = '0 0 8px';
  A11Y_LIST.appendChild(h);
  for (let lvl = 1; lvl <= 8; lvl++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.kind = 'layer';
    b.dataset.id = String(lvl);
    b.textContent = 'L' + lvl + ' — ' + layerName(lvl);
    b.addEventListener('click', () => setActive('layer', lvl));
    A11Y_LIST.appendChild(b);
  }
  for (const n of NODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.kind = 'node';
    b.dataset.id = n.id;
    b.textContent = n.tag + ' — ' + nodeLabel(n);
    b.addEventListener('click', () => setActive('node', n.id));
    A11Y_LIST.appendChild(b);
  }
}

// ── WebGL context loss handler ──
CANVAS?.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  contextLost = true;
  if (FALLBACK) FALLBACK.hidden = false;
});
CANVAS?.addEventListener('webglcontextrestored', () => {
  contextLost = false;
  initScene();
  buildA11yList();
  onResize();
  if (FALLBACK) FALLBACK.hidden = true;
  requestAnimationFrame(tick);
});

// ── Wire toolbar ──
AUTO_BTN?.addEventListener('click', () => {
  autoRotate = !autoRotate;
  AUTO_BTN.setAttribute('aria-pressed', autoRotate ? 'true' : 'false');
  const txt = AUTO_BTN.querySelector('[data-i18n]');
  if (txt) txt.textContent = autoRotate ? (tDict().l3d_autorotate || 'Auto') : (tDict().l3d_paused || 'Paused');
});
RESET_BTN?.addEventListener('click', () => {
  cam.theta = 0.6; cam.phi = 0.18; cam.radius = 850;
});
PANEL_CLOSE?.addEventListener('click', () => setActive(null, null));

SCENE_EL?.addEventListener('pointerdown', onPointerDown);
SCENE_EL?.addEventListener('pointermove', onPointerMove);
SCENE_EL?.addEventListener('pointerup', onPointerUp);
SCENE_EL?.addEventListener('pointercancel', onPointerUp);
SCENE_EL?.addEventListener('pointerleave', onPointerUp);
SCENE_EL?.addEventListener('wheel', onWheel, { passive: false });
SCENE_EL?.addEventListener('click', onClick);
window.addEventListener('resize', onResize);

// ── i18n apply（standalone）──
function rebuildLabelTextures(){
  // 重 build canvas-texture for new language；accent 沿用分類色（不變）
  for (const item of layerMeshes) {
    const tag = 'L' + item.lvl;
    const accent = LAYER_COLOR[item.lvl] || PALETTE.accent;
    item.baseTex.dispose();
    item.hiTex.dispose();
    const { tex: baseTex } = makeTextTexture({ tag, name: layerName(item.lvl), width: 380, height: 64, accent });
    const { tex: hiTex } = makeTextTexture({ tag, name: layerName(item.lvl), width: 380, height: 64, accent, highlight: true });
    item.baseTex = baseTex; item.hiTex = hiTex;
  }
  for (const item of satMeshes) {
    const accent = NODE_COLOR[item.node.id] || PALETTE.accent;
    item.baseTex.dispose();
    item.hiTex.dispose();
    const { tex: baseTex } = makeTextTexture({ tag: item.node.tag, name: nodeLabel(item.node), width: 320, height: 72, accent });
    const { tex: hiTex } = makeTextTexture({ tag: item.node.tag, name: nodeLabel(item.node), width: 320, height: 72, accent, highlight: true });
    item.baseTex = baseTex; item.hiTex = hiTex;
  }
  refreshActiveTextures();
}

// 純 DOM [data-i18n] 套用（不碰 Three.js textures）— init 失敗也能跑
function applyDomI18n(lang){
  const dict = LANGS_I18N[lang] || LANGS_I18N['en'] || LANGS_I18N['zh-TW'];
  if (!dict) return;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n;
    if (dict[k] !== undefined) el.textContent = dict[k];
  });
}

function applyLang(lang){
  if (!LANGS_I18N[lang]) return;
  curLang = lang;
  const t = LANGS_I18N[lang];
  applyDomI18n(lang);
  const tBtn = document.getElementById('theme-toggle-btn');
  const mTBtn = document.getElementById('m-theme-btn');
  const lBtn = document.getElementById('lang-toggle-btn');
  if (tBtn) { tBtn.title = t.tooltip_theme; tBtn.setAttribute('aria-label', t.tooltip_theme); }
  if (mTBtn) mTBtn.title = t.tooltip_theme;
  if (lBtn) { lBtn.title = t.tooltip_lang; lBtn.setAttribute('aria-label', t.tooltip_lang); }
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  document.querySelectorAll('.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
  rebuildLabelTextures();
  buildA11yList();
  if (activeKind === 'layer') renderLayerPanel(activeId);
  else if (activeKind === 'node') renderNodePanel(activeId);
  if (AUTO_BTN) {
    const txt = AUTO_BTN.querySelector('[data-i18n]');
    if (txt) txt.textContent = autoRotate ? (t.l3d_autorotate || 'Auto') : (t.l3d_paused || 'Paused');
  }
}

// ── Lang dropdown / mobile overlay / theme（同款套件，與 case-platform/erp-architecture 一致）──
const langToggleBtn = document.getElementById('lang-toggle-btn');
const langDropdown  = document.getElementById('lang-dropdown');
langToggleBtn?.addEventListener('click', e => { e.stopPropagation(); langDropdown?.classList.toggle('open'); });
document.addEventListener('click', () => langDropdown?.classList.remove('open'));
langDropdown?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLang(opt.dataset.lang); langDropdown.classList.remove('open'); });
document.getElementById('m-overlay')?.addEventListener('click', e => { const opt = e.target.closest('.m-ov-lang-opt'); if (!opt) return; applyLang(opt.dataset.lang); });
function toggleTopLangDrop(e){ e.stopPropagation(); document.getElementById('m-top-lang-drop')?.classList.toggle('open'); }
window.toggleTopLangDrop = toggleTopLangDrop;
document.addEventListener('click', () => document.getElementById('m-top-lang-drop')?.classList.remove('open'));
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => { const opt = e.target.closest('.lang-opt'); if (!opt) return; applyLang(opt.dataset.lang); document.getElementById('m-top-lang-drop').classList.remove('open'); });
document.getElementById('m-lang-btn')?.addEventListener('click', toggleTopLangDrop);

const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
const topbar  = document.getElementById('m-topbar');
function openMenu(){ hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open'); overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden'); topbar?.classList.add('menu-open'); document.body.classList.add('body-lock'); }
function closeMenu(){ hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open'); overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true'); topbar?.classList.remove('menu-open'); document.body.classList.remove('body-lock'); }
hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
document.addEventListener('keydown', e => { if (e.key==='Escape' && overlay?.classList.contains('is-open')) closeMenu(); });

const themeBtn  = document.getElementById('theme-toggle-btn');
const mThemeBtn = document.getElementById('m-theme-btn');
function applyTheme(dark){
  document.documentElement.classList.toggle('theme-dark', dark);
  document.documentElement.classList.toggle('theme-light', !dark);
  [themeBtn, mThemeBtn].forEach(btn => {
    if (!btn) return;
    const sun = btn.querySelector('.icon-sun'), moon = btn.querySelector('.icon-moon');
    if (sun)  sun.hidden = dark;
    if (moon) moon.hidden = !dark;
  });
}
applyTheme(localStorage.getItem('theme') !== 'light');
themeBtn?.addEventListener('click', () => {
  const d = !document.documentElement.classList.contains('theme-dark');
  localStorage.setItem('theme', d ? 'dark' : 'light');
  applyTheme(d);
});
mThemeBtn?.addEventListener('click', () => {
  const d = !document.documentElement.classList.contains('theme-dark');
  localStorage.setItem('theme', d ? 'dark' : 'light');
  applyTheme(d);
});

// Reveal animation
const osContent = document.getElementById('os-content');
const revRoot = window.innerWidth > 768 ? osContent : null;
const revObs = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); revObs.unobserve(e.target); } });
}, { root: revRoot, threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
document.querySelectorAll('[data-reveal]').forEach(el => revObs.observe(el));

// Neural canvas (背景)
(function(){
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const canvas=document.getElementById('neural-canvas');if(!canvas)return;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  let W=0,H=0,nodes=[];const DIST=155;
  function resize(){W=canvas.width=window.innerWidth;H=canvas.height=window.innerHeight}
  function initNodes(){const n=W<768?48:115;nodes=Array.from({length:n},()=>({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.28,vy:(Math.random()-.5)*.28,r:Math.random()*1.1+.4,pulse:Math.random()*Math.PI*2}))}
  const mouse={x:-9999,y:-9999};document.addEventListener('mousemove',e=>{mouse.x=e.clientX;mouse.y=e.clientY});
  let cfg={r:'108',g:'110',b:'229',no:.22,lo:.09};
  function syncCfg(){const s=getComputedStyle(document.documentElement);cfg={r:s.getPropertyValue('--neural-r').trim()||'108',g:s.getPropertyValue('--neural-g').trim()||'110',b:s.getPropertyValue('--neural-b').trim()||'229',no:parseFloat(s.getPropertyValue('--neural-node-opacity').trim()||'.22'),lo:parseFloat(s.getPropertyValue('--neural-line-opacity').trim()||'.09')}}
  syncCfg();new MutationObserver(syncCfg).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  function draw(){ctx.clearRect(0,0,W,H);const{r,g,b,no,lo}=cfg;
    for(const n of nodes){const dx=n.x-mouse.x,dy=n.y-mouse.y,d2=dx*dx+dy*dy;if(d2<16900){const d=Math.sqrt(d2);n.vx+=dx/d*.055;n.vy+=dy/d*.055}n.vx*=.982;n.vy*=.982;n.x+=n.vx;n.y+=n.vy;if(n.x<-12)n.x=W+12;else if(n.x>W+12)n.x=-12;if(n.y<-12)n.y=H+12;else if(n.y>H+12)n.y=-12;n.pulse+=.011;const p=Math.sin(n.pulse)*.25+.75;ctx.beginPath();ctx.arc(n.x,n.y,n.r*p,0,Math.PI*2);ctx.fillStyle=`rgba(${r},${g},${b},${no*p})`;ctx.fill()}
    for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const dx=nodes[i].x-nodes[j].x,dy=nodes[i].y-nodes[j].y,d2=dx*dx+dy*dy;if(d2<DIST*DIST){const a=(1-Math.sqrt(d2)/DIST)*lo;ctx.beginPath();ctx.moveTo(nodes[i].x,nodes[i].y);ctx.lineTo(nodes[j].x,nodes[j].y);ctx.strokeStyle=`rgba(${r},${g},${b},${a})`;ctx.lineWidth=.5;ctx.stroke()}}
    requestAnimationFrame(draw)}
  resize();initNodes();draw();window.addEventListener('resize',()=>{resize();initNodes()});
})();

// Dispose on page unload — 透過 scene.traverse 抓所有現存資源，含 lang 切換後 rebuild 的新 textures
window.addEventListener('beforeunload', () => {
  if (scene) {
    scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose?.();
      const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
      for (const m of mats) {
        if (m.map) m.map.dispose?.();
        m.dispose?.();
      }
    });
  }
  renderer?.dispose?.();
});

// ── Init ──
// DOM i18n 先跑：即使 WebGL 初始化失敗、fallback 訊息也用使用者語言
applyDomI18n(curLang);

if (CANVAS && SCENE_EL) {
  try {
    initScene();
    buildA11yList();
    onResize();
    applyLang(curLang);
    if (AUTO_BTN) AUTO_BTN.setAttribute('aria-pressed', autoRotate ? 'true' : 'false');
    requestAnimationFrame(tick);
  } catch (err) {
    console.error('[erp-3d] init failed:', err);
    if (FALLBACK) FALLBACK.hidden = false;
  }
}
