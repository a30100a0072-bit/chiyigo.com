// ── erp-architecture.js — ERP 企業平台 互動式架構 ──
// 同支同時服務兩個入口：
//   - /erp-architecture.html（standalone）：完整跑全部（widget + hamburger + theme + neural canvas + lang dropdown）
//   - /index.html 嵌入區（embed）：只跑 widget；host 頁 index.js 處理 theme/lang/hamburger/canvas
// 用 DOM 偵測模式：`#erp-arch-embed` 存在 = embed。
//
// 整支包 IIFE：避免和 case-platform.js / index.js 的 top-level 識別字撞名。

(function(){
const isEmbed = !!document.getElementById('erp-arch-embed');

// 16 L2 領域；x/y 為 stage 百分比，環繞 L1 核心成橢圓
// angle = i*22.5 - 90（從正上方順時針）；rx=40 ry=37
const NODES = [
  { id:'iam',         x:50,    y:13,    tag:'IDENTITY'    },
  { id:'crm',         x:65.31, y:15.80, tag:'CUSTOMER'    },
  { id:'sales',       x:78.28, y:23.84, tag:'SALES'       },
  { id:'finance',     x:86.97, y:35.85, tag:'FINANCE'     },
  { id:'workflow',    x:90,    y:50,    tag:'WORKFLOW'    },
  { id:'event',       x:86.97, y:64.15, tag:'EVENT-BUS'   },
  { id:'data',        x:78.28, y:76.16, tag:'DATA'        },
  { id:'mdm',         x:65.31, y:84.20, tag:'MASTER'      },
  { id:'notify',      x:50,    y:87,    tag:'NOTIFY'      },
  { id:'file',        x:34.69, y:84.20, tag:'FILE'        },
  { id:'integration', x:21.72, y:76.16, tag:'INTEGRATION' },
  { id:'bi',          x:13.03, y:64.15, tag:'ANALYTICS'   },
  { id:'ai',          x:10,    y:50,    tag:'AI'          },
  { id:'metadata',    x:13.03, y:35.85, tag:'METADATA'    },
  { id:'knowledge',   x:21.72, y:23.84, tag:'KNOWLEDGE'   },
  { id:'sre',         x:34.69, y:15.80, tag:'PLATFORM'    },
];

const CORE = { x:50, y:50 };

// 靜態（無 Chain 選中時）：core ↔ 16 領域全連 + 下方 EDGES 跨領域連線
// 點任一節點時，只有 EDGES 上的相鄰節點維持高亮、其餘 dim（同 case-platform pattern）
const EDGES = [
  ['iam','mdm'],          // 身份 → 組織主檔
  ['iam','workflow'],     // 身份 → 簽核權限
  ['crm','sales'],        // CRM → 銷售
  ['sales','finance'],    // 銷售 → 財務
  ['sales','mdm'],        // 銷售 → 商品主檔
  ['sales','file'],       // 銷售 → 合約檔案
  ['finance','integration'], // 財務 → 銀行連接器
  ['finance','file'],     // 財務 → 發票歸檔
  ['workflow','event'],   // 工作流 → 事件
  ['event','data'],       // 事件 → 資料層
  ['event','notify'],     // 事件 → 通知
  ['ai','data'],          // AI → 資料
  ['ai','knowledge'],     // AI → 知識
  ['ai','event'],         // AI → 事件
  ['bi','data'],          // BI → 資料倉儲
  ['mdm','data'],         // MDM → 資料
  ['metadata','workflow'],// Metadata → 動態 workflow
  ['metadata','iam'],     // Metadata → 動態權限
];

// Chain 啟動時改顯示 chain 內部連線
const CHAINS = {
  order:   ['crm', 'sales', 'mdm', 'finance', 'workflow', 'notify', 'bi', 'file'],
  payment: ['sales', 'finance', 'notify', 'bi', 'integration'],
  tenant:  ['iam', 'mdm', 'metadata', 'workflow', 'notify', 'bi'],
  ai:      ['event', 'data', 'ai', 'knowledge', 'notify', 'bi'],
};

const LANGS_I18N = {"zh-TW":{"nav_home":"首頁","nav_services":"服務項目與流程","nav_process":"服務流程","nav_portfolio":"chiyigo作品","nav_about":"關於我們","nav_contact":"需求諮詢","tooltip_theme":"切換明暗","tooltip_lang":"切換語言","status_open":"接案中","cta_btn_m":"開始諮詢 →","footer_tagline":"不是只做漂亮畫面，而是幫你把需求變成真正能用的系統。","member_center":"會員中心","logout":"登出","eyebrow":"// 平台架構","title1":"從一個會員系統","title2":"到企業級 ERP 平台","subtitle":"16 個獨立領域、4 條 Event Chain、L1~L8 八層架構。每一塊都能單獨擴展，也能透過事件編織成完整的企業營運。","stat_domains":"L2 領域","stat_events":"Event Chains","stat_layers":"架構層級","stat_modules":"L3+ 子模組","arch_title":"// L2 領域互動圖","arch_hint":"點任一領域查看 L3 子模組與 Event 流向；切換上方 Chain 看跨領域事件動畫 →","chain_label":"Event Chain：","chain_none":"靜態檢視","chain_order":"建立訂單","chain_payment":"付款成功","chain_tenant":"新租戶開通","chain_ai":"AI 自動決策","chain_note_order":"CRM 接到客戶 → 銷售開單 → MDM 對齊主檔 → 財務開立發票 → Workflow 簽核 → 通知客戶 → BI 更新分析 → 檔案歸檔出貨單","chain_note_payment":"金流回拋 → Sales 對應訂單 → Finance 認列收入 → Notify 發送收據 → BI 即時更新 → Integration 同步銀行","chain_note_tenant":"IAM 建立租戶 → MDM 註冊組織主檔 → Metadata 套用客製欄位 → Workflow 啟動 onboarding → Notify 寄歡迎信 → BI 建立租戶儀表板","chain_note_ai":"Event Bus 接到觸發 → Data 抽取上下文 → AI 推理決策 → Knowledge 引用內部知識 → Notify 推播結果 → BI 紀錄成效","panel_hint":"選擇任一領域，這裡會列出領域職責、L3 子模組、L4 細項、相關 Event 流向與技術選型。","view_full":"查看完整架構 →","lab_purpose":"領域職責","lab_l3":"L3 子模組","lab_l4":"L4 / L5 細項","lab_events":"Event 流向","lab_tech":"技術選型","stack_title":"// 八層架構速覽","layer_l1":"L1 平台層","layer_l1_desc":"企業平台根節點，所有領域共用治理、合規、Feature Flag 與多租戶 Runtime","layer_l24":"L2~L4 領域層","layer_l24_desc":"16 個獨立 L2 領域、各自 L3 子模組與 L4 細項；領域間以 Event 通訊，不共用 DB","layer_l57":"L5~L7 能力層","layer_l57_desc":"Service / Storage / Runtime 三層具體實作：PostgreSQL、Redis、Kafka、Elasticsearch、Vector DB","layer_l8":"L8 部署層","layer_l8_desc":"Kubernetes、Multi-region Failover、Disaster Recovery、Cloudflare CDN、WAF","node_iam":"身份權限","node_crm":"CRM 客戶","node_sales":"銷售管理","node_finance":"財務會計","node_workflow":"工作流 BPM","node_event":"事件驅動","node_data":"資料架構","node_mdm":"主資料 MDM","node_notify":"通知中心","node_file":"檔案文件","node_integration":"整合 / API","node_bi":"分析 BI","node_ai":"AI Native","node_metadata":"Metadata-driven","node_knowledge":"知識平台","node_sre":"平台 SRE / 資安","details":{"iam":{"tag":"IDENTITY","purpose":"集中管理使用者身份、權限與 SSO，是所有領域的信任根；任何跨系統存取都先經過 IAM 驗證。","l3":["身份驗證（登入/SSO）","權限控管（RBAC + ABAC）","租戶隔離","安全防護"],"l4":["OAuth 2.0","OIDC / SAML / SCIM","MFA / Passkey","Device Trust","Session / JWT","Audit Log","Risk Score"],"events":["新租戶開通起點"],"tech":["JWT (jose)","OIDC","WebAuthn","TOTP","Cloudflare Workers"]},"crm":{"tag":"CUSTOMER","purpose":"管理潛在客戶到 VIP 的全旅程，銜接行銷、銷售與客服，是建立訂單的起點。","l3":["潛在客戶 Lead","客戶管理","商機 Pipeline","客服工單"],"l4":["Lead Scoring","Customer 360","Pipeline Forecast","Stage Tracking","SLA","Knowledge Base"],"events":["建立訂單入口"],"tech":["PostgreSQL","Elasticsearch","Kafka","AI Lead Scoring"]},"sales":{"tag":"SALES","purpose":"報價、訂單、合約、訂閱計費的核心交易引擎；金流與庫存的觸發源。","l3":["報價 Quote","訂單 Order","合約 Contract","訂閱 Subscription"],"l4":["Pricing Engine","Order Lifecycle","Approval Workflow","E-signature","Usage Billing","Revenue Recognition"],"events":["建立訂單","付款成功"],"tech":["Saga Pattern","CQRS / Event Sourcing","PostgreSQL"]},"finance":{"tag":"FINANCE","purpose":"最高一致性核心：總帳、應收應付、稅務、財務報表；唯一可以寫入帳務的領域。","l3":["總帳 GL","應收 AR","應付 AP","財務報表"],"l4":["Journal Entry","AR Aging / Dunning","Vendor Bill / AP Reconciliation","Tax Validation","P&L","Balance Sheet","Cash Flow"],"events":["付款成功","建立訂單"],"tech":["ACID","Two-Phase Commit","PostgreSQL HA","Fiscal Period Lock"]},"workflow":{"tag":"WORKFLOW","purpose":"跨系統中樞：BPMN 流程、簽核鏈、規則引擎、SLA 追蹤；所有需要人工或多步驟協作都走這層。","l3":["State Machine","BPMN 流程設計","規則引擎","簽核鏈"],"l4":["Retry","Escalation","SLA Tracking","Condition Engine","Pricing Rules","Validation Rules"],"events":["建立訂單","新租戶開通"],"tech":["Temporal","BPMN 2.0","Drools"]},"event":{"tag":"EVENT-BUS","purpose":"Domain 解耦的訊息總線，承載所有跨領域非同步通訊；可靠性、Retry、Replay、Idempotency 的保證者。","l3":["Event Bus","Domain Event","可靠性機制"],"l4":["Kafka Topic","Consumer Group","DLQ","Replay","Idempotency","Event Versioning"],"events":["AI 自動決策核心"],"tech":["Kafka","RabbitMQ","Schema Registry"]},"data":{"tag":"DATA","purpose":"ACID 交易、分散一致性、全文搜尋、資料倉儲、Lakehouse；所有讀寫的物理基礎。","l3":["交易管理","資料一致性","搜尋架構","資料倉儲"],"l4":["Saga","Optimistic / Pessimistic Lock","Full-text Search","ETL","OLAP","Data Lake"],"events":["AI 自動決策"],"tech":["PostgreSQL","Elasticsearch","Snowflake / Databricks"]},"mdm":{"tag":"MASTER","purpose":"商品、客戶、財務、組織主檔的全域唯一真實版本；解決多系統間「同一客戶五個 ID」的痛點。","l3":["商品主檔","客戶主檔","財務主檔","組織主檔"],"l4":["SKU 標準化","Unified Customer ID","幣別 / 稅率","Region Mapping","Match / Merge"],"events":["建立訂單","新租戶開通"],"tech":["MDM Hub","PostgreSQL","Fuzzy Match"]},"notify":{"tag":"NOTIFY","purpose":"統一發送 Email / SMS / Push / 站內通知與 Webhook；模板、頻率限制、重試集中管理。","l3":["Email","SMS / Push","站內通知","Webhook"],"l4":["Template","Rate Limit","Retry / DLQ","Delivery Tracking"],"events":["建立訂單","付款成功","新租戶開通","AI 自動決策"],"tech":["Resend","Twilio","FCM","Cloudflare Queues"]},"file":{"tag":"FILE","purpose":"企業檔案的版本、權限、OCR、電子簽章與 Lifecycle；發票、合約、出貨單都在這歸檔。","l3":["檔案上傳","權限控制","版本管理","OCR","電子簽章"],"l4":["S3 / R2 Storage","Pre-signed URL","Lifecycle Policy","DocuSign Integration"],"events":["建立訂單"],"tech":["S3 / Cloudflare R2","Tesseract / Textract","DocuSign API"]},"integration":{"tag":"INTEGRATION","purpose":"對外連接器集中地：API Gateway、Webhook、ETL、ERP / Bank / Payment / EDI / SOAP 都在這。","l3":["API Gateway","Webhook","ETL Pipeline","Connector"],"l4":["Rate Limit","OpenAPI Registry","SAP / Oracle Connector","Stripe / ECPay","Bank API","EDI / SOAP"],"events":["付款成功"],"tech":["Kong","Apache Camel","OpenAPI 3.0"]},"bi":{"tag":"ANALYTICS","purpose":"高層 KPI、營運儀表板、預測分析的唯讀讀模型；只讀不寫，避免污染交易資料。","l3":["高層儀表板","營運儀表板","KPI Engine","預測分析"],"l4":["Revenue Dashboard","Churn Analysis","Forecast","Cohort","Retention"],"events":["建立訂單","付款成功","AI 自動決策"],"tech":["Metabase / Tableau","ClickHouse","dbt"]},"ai":{"tag":"AI","purpose":"AI Native：Agent、推薦、預測、詐欺偵測、Copilot；不是外掛，而是嵌入每個流程的決策層。","l3":["AI Agent","AI Recommendation","AI Forecast","AI Fraud Detection","AI Copilot"],"l4":["RAG Pipeline","Vector DB","MCP Integration","SQL Agent","Tool Use"],"events":["AI 自動決策"],"tech":["Claude / GPT","LangChain","pgvector","MCP Protocol"]},"metadata":{"tag":"METADATA","purpose":"Dynamic Form / Workflow / UI / Permission 的後設驅動平台；客製欄位不用改 code，運維直接拉。","l3":["Dynamic Form","Dynamic Workflow","Dynamic Permission","Metadata Runtime"],"l4":["Schema Versioning","Hot Reload","Custom Field","No-code Builder"],"events":["新租戶開通"],"tech":["JSON Schema","GraphQL","Apollo Federation"]},"knowledge":{"tag":"KNOWLEDGE","purpose":"Knowledge Graph / Semantic Search / RAG / Enterprise Wiki；AI 的長期記憶與企業知識資產。","l3":["Knowledge Graph","Semantic Search","Enterprise Wiki","Context Engine"],"l4":["Graph DB","Embedding Pipeline","Hybrid Search","Citation / Lineage"],"events":["AI 自動決策"],"tech":["Neo4j","pgvector","Sentence-BERT"]},"sre":{"tag":"PLATFORM","purpose":"CI/CD、Kubernetes、可觀測性、WAF、Secret、SIEM、Multi-region DR；讓整個平台 24×7 不倒。","l3":["CI/CD","Kubernetes","可觀測性","WAF / DDoS","Secret Manager","Disaster Recovery"],"l4":["Prometheus / Grafana","Sentry","Vault / KMS","Cloudflare WAF","Chaos Engineering","Multi-region Failover"],"events":[],"tech":["Kubernetes","Cloudflare","Grafana","ArgoCD"]}},"picker_label":"快速選擇領域","picker_placeholder":"— 選擇領域 —","picker_overview":"▸ 領域總覽"},"en":{"nav_home":"Home","nav_services":"Services","nav_process":"Process","nav_portfolio":"Portfolio","nav_about":"About","nav_contact":"Contact","tooltip_theme":"Toggle theme","tooltip_lang":"Switch language","status_open":"Open for projects","cta_btn_m":"Start a project →","footer_tagline":"Not just pretty screens — we turn requirements into systems that actually run.","member_center":"Member Center","logout":"Sign out","eyebrow":"// Platform Architecture","title1":"From a member system","title2":"to an enterprise ERP platform","subtitle":"16 bounded contexts · 4 event chains · 8 architectural layers (L1~L8). Each block scales independently, yet weaves into a unified operating fabric through events.","stat_domains":"L2 Domains","stat_events":"Event Chains","stat_layers":"Layers","stat_modules":"L3+ Modules","arch_title":"// L2 Domain Map","arch_hint":"Click any domain for L3 modules + event flow. Pick a Chain above for cross-domain animation →","chain_label":"Event Chain:","chain_none":"Static view","chain_order":"Order Created","chain_payment":"Payment Success","chain_tenant":"Tenant Onboarding","chain_ai":"AI Auto-Decision","chain_note_order":"CRM captures customer → Sales drafts order → MDM aligns master data → Finance issues invoice → Workflow runs approval → Notify customer → BI updates analytics → File archives shipment","chain_note_payment":"Gateway callback → Sales reconciles order → Finance recognizes revenue → Notify sends receipt → BI updates dashboard → Integration syncs bank","chain_note_tenant":"IAM provisions tenant → MDM registers org master → Metadata applies custom fields → Workflow runs onboarding → Notify sends welcome → BI seeds tenant dashboard","chain_note_ai":"Event Bus triggers → Data fetches context → AI reasons → Knowledge cites internal facts → Notify pushes result → BI records outcome","panel_hint":"Pick any domain — purpose, L3 modules, L4 details, related event chains and tech choices appear here.","view_full":"View full architecture →","lab_purpose":"Purpose","lab_l3":"L3 Modules","lab_l4":"L4 / L5 Details","lab_events":"Event Flow","lab_tech":"Tech Choice","stack_title":"// 8-Layer Architecture","layer_l1":"L1 Platform","layer_l1_desc":"Enterprise root: governance, compliance, feature flags, multi-tenant runtime shared by all domains","layer_l24":"L2~L4 Domain","layer_l24_desc":"16 bounded contexts with their own L3 modules and L4 details. Domains communicate via events, never share DB","layer_l57":"L5~L7 Capability","layer_l57_desc":"Service / Storage / Runtime concrete impl: PostgreSQL, Redis, Kafka, Elasticsearch, Vector DB","layer_l8":"L8 Deployment","layer_l8_desc":"Kubernetes, multi-region failover, disaster recovery, Cloudflare CDN, WAF","node_iam":"Identity & Access","node_crm":"CRM Customer","node_sales":"Sales","node_finance":"Finance","node_workflow":"Workflow & BPM","node_event":"Event-Driven","node_data":"Data Architecture","node_mdm":"Master Data (MDM)","node_notify":"Notification","node_file":"Files & Docs","node_integration":"Integration / API","node_bi":"Analytics & BI","node_ai":"AI Native","node_metadata":"Metadata-driven","node_knowledge":"Knowledge Platform","node_sre":"Platform SRE / Sec","details":{"iam":{"tag":"IDENTITY","purpose":"Central authority for identity, permission and SSO — the trust root every other domain depends on.","l3":["AuthN (Login/SSO)","AuthZ (RBAC + ABAC)","Tenant Isolation","Security"],"l4":["OAuth 2.0","OIDC / SAML / SCIM","MFA / Passkey","Device Trust","Session / JWT","Audit Log","Risk Score"],"events":["Origin of Tenant Onboarding"],"tech":["JWT (jose)","OIDC","WebAuthn","TOTP","Cloudflare Workers"]},"crm":{"tag":"CUSTOMER","purpose":"Lead-to-VIP journey across marketing, sales and service — the entry point for every order.","l3":["Lead Capture","Customer Mgmt","Pipeline","Service Tickets"],"l4":["Lead Scoring","Customer 360","Pipeline Forecast","Stage Tracking","SLA","Knowledge Base"],"events":["Order Created entry"],"tech":["PostgreSQL","Elasticsearch","Kafka","AI Lead Scoring"]},"sales":{"tag":"SALES","purpose":"Quote-Order-Contract-Subscription transaction engine — trigger source for payment and inventory.","l3":["Quote","Order","Contract","Subscription"],"l4":["Pricing Engine","Order Lifecycle","Approval Workflow","E-signature","Usage Billing","Revenue Recognition"],"events":["Order Created","Payment Success"],"tech":["Saga Pattern","CQRS / Event Sourcing","PostgreSQL"]},"finance":{"tag":"FINANCE","purpose":"Strongest consistency core: GL, AR, AP, tax, statements — the only domain allowed to write books.","l3":["General Ledger","Accounts Receivable","Accounts Payable","Financial Reports"],"l4":["Journal Entry","AR Aging / Dunning","AP Reconciliation","Tax Validation","P&L","Balance Sheet","Cash Flow"],"events":["Payment Success","Order Created"],"tech":["ACID","Two-Phase Commit","PostgreSQL HA","Fiscal Period Lock"]},"workflow":{"tag":"WORKFLOW","purpose":"Cross-system hub: BPMN flows, approval chains, rule engines, SLA tracking for every multi-step process.","l3":["State Machine","BPMN Designer","Rule Engine","Approval Chain"],"l4":["Retry","Escalation","SLA Tracking","Condition Engine","Pricing Rules","Validation Rules"],"events":["Order Created","Tenant Onboarding"],"tech":["Temporal","BPMN 2.0","Drools"]},"event":{"tag":"EVENT-BUS","purpose":"Decoupled messaging backbone — guarantees retry, replay, idempotency for all async traffic.","l3":["Event Bus","Domain Event","Reliability"],"l4":["Kafka Topic","Consumer Group","DLQ","Replay","Idempotency","Event Versioning"],"events":["Core of AI Auto-Decision"],"tech":["Kafka","RabbitMQ","Schema Registry"]},"data":{"tag":"DATA","purpose":"ACID, distributed consistency, full-text search, warehouse, lakehouse — physical foundation of every read/write.","l3":["Transaction","Consistency","Search","Warehouse"],"l4":["Saga","Optimistic / Pessimistic Lock","Full-text Search","ETL","OLAP","Data Lake"],"events":["AI Auto-Decision"],"tech":["PostgreSQL","Elasticsearch","Snowflake / Databricks"]},"mdm":{"tag":"MASTER","purpose":"Single source of truth for product/customer/finance/org masters — solves the 'same customer, 5 IDs' problem.","l3":["Product Master","Customer Master","Finance Master","Org Master"],"l4":["SKU Standardization","Unified Customer ID","Currency / Tax","Region Mapping","Match / Merge"],"events":["Order Created","Tenant Onboarding"],"tech":["MDM Hub","PostgreSQL","Fuzzy Match"]},"notify":{"tag":"NOTIFY","purpose":"Unified Email / SMS / Push / in-app / webhook delivery — central template, rate-limit and retry.","l3":["Email","SMS / Push","In-app","Webhook"],"l4":["Template","Rate Limit","Retry / DLQ","Delivery Tracking"],"events":["Order Created","Payment Success","Tenant Onboarding","AI Auto-Decision"],"tech":["Resend","Twilio","FCM","Cloudflare Queues"]},"file":{"tag":"FILE","purpose":"Versioning, permission, OCR, e-signature, lifecycle for enterprise documents — where invoices and contracts live.","l3":["Upload","Permission","Version","OCR","E-signature"],"l4":["S3 / R2 Storage","Pre-signed URL","Lifecycle Policy","DocuSign Integration"],"events":["Order Created"],"tech":["S3 / Cloudflare R2","Tesseract / Textract","DocuSign API"]},"integration":{"tag":"INTEGRATION","purpose":"Outbound connector hub: API Gateway, Webhook, ETL, ERP / Bank / Payment / EDI / SOAP all live here.","l3":["API Gateway","Webhook","ETL Pipeline","Connector"],"l4":["Rate Limit","OpenAPI Registry","SAP / Oracle Connector","Stripe / ECPay","Bank API","EDI / SOAP"],"events":["Payment Success"],"tech":["Kong","Apache Camel","OpenAPI 3.0"]},"bi":{"tag":"ANALYTICS","purpose":"Read-only analytic model for execs and ops — never writes back to transactional data.","l3":["Exec Dashboard","Ops Dashboard","KPI Engine","Forecasting"],"l4":["Revenue Dashboard","Churn Analysis","Forecast","Cohort","Retention"],"events":["Order Created","Payment Success","AI Auto-Decision"],"tech":["Metabase / Tableau","ClickHouse","dbt"]},"ai":{"tag":"AI","purpose":"AI-native: agents, recommendation, forecast, fraud, copilot — embedded into every flow, not bolted on.","l3":["AI Agent","Recommendation","Forecast","Fraud Detection","Copilot"],"l4":["RAG Pipeline","Vector DB","MCP Integration","SQL Agent","Tool Use"],"events":["AI Auto-Decision"],"tech":["Claude / GPT","LangChain","pgvector","MCP Protocol"]},"metadata":{"tag":"METADATA","purpose":"Metadata-driven platform for dynamic form / workflow / UI / permission — custom fields without code changes.","l3":["Dynamic Form","Dynamic Workflow","Dynamic Permission","Metadata Runtime"],"l4":["Schema Versioning","Hot Reload","Custom Field","No-code Builder"],"events":["Tenant Onboarding"],"tech":["JSON Schema","GraphQL","Apollo Federation"]},"knowledge":{"tag":"KNOWLEDGE","purpose":"Knowledge Graph, semantic search, RAG, enterprise wiki — long-term memory for the AI layer.","l3":["Knowledge Graph","Semantic Search","Enterprise Wiki","Context Engine"],"l4":["Graph DB","Embedding Pipeline","Hybrid Search","Citation / Lineage"],"events":["AI Auto-Decision"],"tech":["Neo4j","pgvector","Sentence-BERT"]},"sre":{"tag":"PLATFORM","purpose":"CI/CD, Kubernetes, observability, WAF, secret, SIEM, multi-region DR — keeps the platform up 24×7.","l3":["CI/CD","Kubernetes","Observability","WAF / DDoS","Secret Manager","Disaster Recovery"],"l4":["Prometheus / Grafana","Sentry","Vault / KMS","Cloudflare WAF","Chaos Engineering","Multi-region Failover"],"events":[],"tech":["Kubernetes","Cloudflare","Grafana","ArgoCD"]}},"picker_label":"Quick pick domain","picker_placeholder":"— Select domain —","picker_overview":"▸ Domain overview"},"ja":{"nav_home":"ホーム","nav_services":"サービス","nav_process":"プロセス","nav_portfolio":"ポートフォリオ","nav_about":"私たちについて","nav_contact":"お問い合わせ","tooltip_theme":"テーマ切替","tooltip_lang":"言語切替","status_open":"受付中","cta_btn_m":"相談を始める →","footer_tagline":"きれいな画面だけではなく、要件を本当に動くシステムに変えます。","member_center":"メンバーセンター","logout":"ログアウト","eyebrow":"// プラットフォームアーキテクチャ","title1":"会員システムから","title2":"エンタープライズ ERP プラットフォームへ","subtitle":"16 のドメイン・4 つのイベントチェーン・L1〜L8 の 8 層アーキテクチャ。各ブロックは独立して拡張でき、イベントで一つの企業オペレーションへ織り上がる。","stat_domains":"L2 ドメイン","stat_events":"イベントチェーン","stat_layers":"アーキ層数","stat_modules":"L3+ モジュール","arch_title":"// L2 ドメイン マップ","arch_hint":"ドメインをクリックで L3 とイベント表示。上部の Chain でアニメーション →","chain_label":"Event Chain：","chain_none":"静的表示","chain_order":"注文作成","chain_payment":"支払成功","chain_tenant":"新テナント開通","chain_ai":"AI 自動判断","chain_note_order":"CRM が顧客を捕捉 → Sales が起票 → MDM がマスタ整合 → Finance が請求書発行 → Workflow が承認 → Notify が顧客へ通知 → BI が分析更新 → File が出荷書類を保管","chain_note_payment":"ゲートウェイ通知 → Sales が注文照合 → Finance が売上計上 → Notify が領収書送信 → BI 即時更新 → Integration が銀行同期","chain_note_tenant":"IAM がテナント作成 → MDM が組織マスタ登録 → Metadata がカスタム項目適用 → Workflow がオンボーディング → Notify が歓迎メール → BI がダッシュボード生成","chain_note_ai":"Event Bus がトリガ → Data がコンテキスト抽出 → AI が推論 → Knowledge が社内知識を参照 → Notify が結果配信 → BI が成果記録","panel_hint":"ドメインを選択すると、責務・L3・L4・関連イベント・技術選定が表示されます。","view_full":"完全版アーキを見る →","lab_purpose":"ドメイン責務","lab_l3":"L3 モジュール","lab_l4":"L4 / L5 詳細","lab_events":"イベント フロー","lab_tech":"技術選定","stack_title":"// 8 層アーキテクチャ","layer_l1":"L1 プラットフォーム","layer_l1_desc":"全ドメインで共有するガバナンス・コンプラ・Feature Flag・マルチテナント Runtime","layer_l24":"L2〜L4 ドメイン","layer_l24_desc":"16 のドメイン、それぞれの L3・L4。ドメイン間はイベント通信、DB は非共有","layer_l57":"L5〜L7 ケイパビリティ","layer_l57_desc":"Service / Storage / Runtime 具体実装：PostgreSQL、Redis、Kafka、Elasticsearch、Vector DB","layer_l8":"L8 デプロイ","layer_l8_desc":"Kubernetes、マルチリージョン Failover、DR、Cloudflare CDN、WAF","node_iam":"ID と権限","node_crm":"CRM 顧客","node_sales":"セールス","node_finance":"財務会計","node_workflow":"ワークフロー BPM","node_event":"イベント駆動","node_data":"データ基盤","node_mdm":"マスタデータ MDM","node_notify":"通知センター","node_file":"ファイル・文書","node_integration":"統合 / API","node_bi":"分析 BI","node_ai":"AI Native","node_metadata":"Metadata-driven","node_knowledge":"ナレッジ基盤","node_sre":"プラットフォーム SRE / セキュリティ","details":{"iam":{"tag":"IDENTITY","purpose":"ID・権限・SSO を集中管理し、全ドメインの信頼基盤となる。","l3":["認証（ログイン / SSO）","認可（RBAC + ABAC）","テナント分離","セキュリティ"],"l4":["OAuth 2.0","OIDC / SAML / SCIM","MFA / Passkey","Device Trust","Session / JWT","Audit Log","Risk Score"],"events":["テナント開通の起点"],"tech":["JWT (jose)","OIDC","WebAuthn","TOTP","Cloudflare Workers"]},"crm":{"tag":"CUSTOMER","purpose":"見込み客から VIP までの全旅程を管理し、マーケ・営業・サポートを繋ぐ。","l3":["リード","顧客管理","パイプライン","サポートチケット"],"l4":["Lead Scoring","Customer 360","Pipeline Forecast","Stage Tracking","SLA","Knowledge Base"],"events":["注文作成の入口"],"tech":["PostgreSQL","Elasticsearch","Kafka","AI Lead Scoring"]},"sales":{"tag":"SALES","purpose":"見積・受注・契約・サブスクの取引エンジン。","l3":["見積","受注","契約","サブスク"],"l4":["Pricing Engine","Order Lifecycle","Approval Workflow","E-signature","Usage Billing","Revenue Recognition"],"events":["注文作成","支払成功"],"tech":["Saga Pattern","CQRS / Event Sourcing","PostgreSQL"]},"finance":{"tag":"FINANCE","purpose":"最高一貫性の核：総勘定・AR・AP・税務・財務諸表。","l3":["総勘定 GL","AR 売掛","AP 買掛","財務諸表"],"l4":["Journal Entry","AR Aging / Dunning","AP Reconciliation","Tax Validation","P&L","Balance Sheet","Cash Flow"],"events":["支払成功","注文作成"],"tech":["ACID","Two-Phase Commit","PostgreSQL HA","Fiscal Period Lock"]},"workflow":{"tag":"WORKFLOW","purpose":"BPMN・承認・ルールエンジン・SLA を司るクロスシステム中枢。","l3":["State Machine","BPMN 設計","ルールエンジン","承認チェーン"],"l4":["Retry","Escalation","SLA Tracking","Condition Engine","Pricing Rules","Validation Rules"],"events":["注文作成","テナント開通"],"tech":["Temporal","BPMN 2.0","Drools"]},"event":{"tag":"EVENT-BUS","purpose":"ドメイン疎結合のメッセージ基盤。Retry・Replay・冪等性を保証。","l3":["Event Bus","Domain Event","信頼性"],"l4":["Kafka Topic","Consumer Group","DLQ","Replay","Idempotency","Event Versioning"],"events":["AI 自動判断の中核"],"tech":["Kafka","RabbitMQ","Schema Registry"]},"data":{"tag":"DATA","purpose":"ACID、分散整合、全文検索、DWH、Lakehouse — 全 I/O の物理基盤。","l3":["トランザクション","整合性","検索","DWH"],"l4":["Saga","Optimistic / Pessimistic Lock","Full-text Search","ETL","OLAP","Data Lake"],"events":["AI 自動判断"],"tech":["PostgreSQL","Elasticsearch","Snowflake / Databricks"]},"mdm":{"tag":"MASTER","purpose":"商品・顧客・財務・組織マスタの唯一真実。「同一顧客 5 ID」を解決。","l3":["商品マスタ","顧客マスタ","財務マスタ","組織マスタ"],"l4":["SKU 標準化","Unified Customer ID","通貨 / 税率","Region Mapping","Match / Merge"],"events":["注文作成","テナント開通"],"tech":["MDM Hub","PostgreSQL","Fuzzy Match"]},"notify":{"tag":"NOTIFY","purpose":"Email / SMS / Push / アプリ内 / Webhook の統合配信。","l3":["Email","SMS / Push","アプリ内通知","Webhook"],"l4":["Template","Rate Limit","Retry / DLQ","Delivery Tracking"],"events":["注文作成","支払成功","テナント開通","AI 自動判断"],"tech":["Resend","Twilio","FCM","Cloudflare Queues"]},"file":{"tag":"FILE","purpose":"バージョン・権限・OCR・電子署名・ライフサイクル。","l3":["アップロード","権限","バージョン","OCR","電子署名"],"l4":["S3 / R2 Storage","Pre-signed URL","Lifecycle Policy","DocuSign Integration"],"events":["注文作成"],"tech":["S3 / Cloudflare R2","Tesseract / Textract","DocuSign API"]},"integration":{"tag":"INTEGRATION","purpose":"API Gateway・Webhook・ETL・ERP/Bank/Payment/EDI/SOAP の外部接続ハブ。","l3":["API Gateway","Webhook","ETL Pipeline","Connector"],"l4":["Rate Limit","OpenAPI Registry","SAP / Oracle Connector","Stripe / ECPay","Bank API","EDI / SOAP"],"events":["支払成功"],"tech":["Kong","Apache Camel","OpenAPI 3.0"]},"bi":{"tag":"ANALYTICS","purpose":"経営・運用ダッシュボードと予測の読み取り専用モデル。","l3":["経営ダッシュボード","運用ダッシュボード","KPI Engine","予測分析"],"l4":["Revenue Dashboard","Churn Analysis","Forecast","Cohort","Retention"],"events":["注文作成","支払成功","AI 自動判断"],"tech":["Metabase / Tableau","ClickHouse","dbt"]},"ai":{"tag":"AI","purpose":"AI ネイティブ：エージェント・推薦・予測・不正検知・Copilot を各フローに埋め込む。","l3":["AI Agent","推薦","予測","不正検知","Copilot"],"l4":["RAG Pipeline","Vector DB","MCP Integration","SQL Agent","Tool Use"],"events":["AI 自動判断"],"tech":["Claude / GPT","LangChain","pgvector","MCP Protocol"]},"metadata":{"tag":"METADATA","purpose":"動的フォーム・ワークフロー・UI・権限のメタデータ駆動。","l3":["Dynamic Form","Dynamic Workflow","Dynamic Permission","Metadata Runtime"],"l4":["Schema Versioning","Hot Reload","Custom Field","No-code Builder"],"events":["テナント開通"],"tech":["JSON Schema","GraphQL","Apollo Federation"]},"knowledge":{"tag":"KNOWLEDGE","purpose":"Knowledge Graph・セマンティック検索・RAG・社内 Wiki — AI の長期記憶。","l3":["Knowledge Graph","Semantic Search","Enterprise Wiki","Context Engine"],"l4":["Graph DB","Embedding Pipeline","Hybrid Search","Citation / Lineage"],"events":["AI 自動判断"],"tech":["Neo4j","pgvector","Sentence-BERT"]},"sre":{"tag":"PLATFORM","purpose":"CI/CD・Kubernetes・可観測性・WAF・Secret・SIEM・DR を担う基盤層。","l3":["CI/CD","Kubernetes","可観測性","WAF / DDoS","Secret Manager","災害対策"],"l4":["Prometheus / Grafana","Sentry","Vault / KMS","Cloudflare WAF","Chaos Engineering","Multi-region Failover"],"events":[],"tech":["Kubernetes","Cloudflare","Grafana","ArgoCD"]}},"picker_label":"ドメイン選択","picker_placeholder":"— ドメインを選ぶ —","picker_overview":"▸ ドメイン全体"},"ko":{"nav_home":"홈","nav_services":"서비스","nav_process":"프로세스","nav_portfolio":"포트폴리오","nav_about":"소개","nav_contact":"문의","tooltip_theme":"테마 전환","tooltip_lang":"언어 전환","status_open":"프로젝트 수락 중","cta_btn_m":"상담 시작 →","footer_tagline":"보기 좋은 화면이 아니라, 요구사항을 실제로 작동하는 시스템으로 만듭니다.","member_center":"회원센터","logout":"로그아웃","eyebrow":"// 플랫폼 아키텍처","title1":"회원 시스템에서","title2":"엔터프라이즈 ERP 플랫폼으로","subtitle":"16개 도메인 · 4개 이벤트 체인 · L1~L8 8계층. 각 블록은 독립적으로 확장 가능하며, 이벤트로 하나의 기업 운영으로 엮입니다.","stat_domains":"L2 도메인","stat_events":"Event Chain","stat_layers":"아키 계층","stat_modules":"L3+ 모듈","arch_title":"// L2 도메인 맵","arch_hint":"도메인 클릭으로 L3·이벤트 확인. 상단 Chain 으로 애니메이션 →","chain_label":"Event Chain:","chain_none":"정적 보기","chain_order":"주문 생성","chain_payment":"결제 성공","chain_tenant":"신규 테넌트 개통","chain_ai":"AI 자동 결정","chain_note_order":"CRM 고객 확보 → Sales 주문 → MDM 마스터 정합 → Finance 청구 → Workflow 결재 → Notify 알림 → BI 분석 → File 출고서 보관","chain_note_payment":"게이트웨이 콜백 → Sales 주문 매칭 → Finance 수익 인식 → Notify 영수증 → BI 실시간 업데이트 → Integration 은행 동기화","chain_note_tenant":"IAM 테넌트 생성 → MDM 조직 마스터 등록 → Metadata 사용자정의 필드 → Workflow 온보딩 → Notify 환영메일 → BI 대시보드 생성","chain_note_ai":"Event Bus 트리거 → Data 컨텍스트 수집 → AI 추론 → Knowledge 내부 지식 인용 → Notify 결과 전송 → BI 성과 기록","panel_hint":"도메인을 선택하면 책임·L3·L4·관련 이벤트·기술 선정이 표시됩니다.","view_full":"전체 아키 보기 →","lab_purpose":"도메인 책임","lab_l3":"L3 모듈","lab_l4":"L4 / L5 상세","lab_events":"이벤트 흐름","lab_tech":"기술 선정","stack_title":"// 8계층 아키텍처","layer_l1":"L1 플랫폼","layer_l1_desc":"전 도메인이 공유하는 거버넌스·컴플라이언스·Feature Flag·멀티테넌트 런타임","layer_l24":"L2~L4 도메인","layer_l24_desc":"16개 도메인, 각 L3·L4. 도메인 간은 이벤트 통신, DB 비공유","layer_l57":"L5~L7 케이퍼빌리티","layer_l57_desc":"Service / Storage / Runtime: PostgreSQL, Redis, Kafka, Elasticsearch, Vector DB","layer_l8":"L8 배포","layer_l8_desc":"Kubernetes, 멀티리전 Failover, DR, Cloudflare CDN, WAF","node_iam":"신원·권한","node_crm":"CRM 고객","node_sales":"세일즈","node_finance":"재무회계","node_workflow":"워크플로 BPM","node_event":"이벤트 드리븐","node_data":"데이터 아키","node_mdm":"마스터 데이터 MDM","node_notify":"알림 센터","node_file":"파일·문서","node_integration":"통합 / API","node_bi":"분석 BI","node_ai":"AI Native","node_metadata":"Metadata-driven","node_knowledge":"지식 플랫폼","node_sre":"플랫폼 SRE / 보안","details":{"iam":{"tag":"IDENTITY","purpose":"신원·권한·SSO 중앙 관리, 모든 도메인의 신뢰 루트.","l3":["인증 (로그인/SSO)","권한 (RBAC + ABAC)","테넌트 격리","보안"],"l4":["OAuth 2.0","OIDC / SAML / SCIM","MFA / Passkey","Device Trust","Session / JWT","Audit Log","Risk Score"],"events":["테넌트 개통 시작점"],"tech":["JWT (jose)","OIDC","WebAuthn","TOTP","Cloudflare Workers"]},"crm":{"tag":"CUSTOMER","purpose":"리드부터 VIP 까지 전체 여정. 마케팅·세일즈·서비스 연결.","l3":["리드","고객 관리","파이프라인","서비스 티켓"],"l4":["Lead Scoring","Customer 360","Pipeline Forecast","Stage Tracking","SLA","Knowledge Base"],"events":["주문 생성 진입점"],"tech":["PostgreSQL","Elasticsearch","Kafka","AI Lead Scoring"]},"sales":{"tag":"SALES","purpose":"견적·주문·계약·구독 거래 엔진.","l3":["견적","주문","계약","구독"],"l4":["Pricing Engine","Order Lifecycle","Approval Workflow","E-signature","Usage Billing","Revenue Recognition"],"events":["주문 생성","결제 성공"],"tech":["Saga Pattern","CQRS / Event Sourcing","PostgreSQL"]},"finance":{"tag":"FINANCE","purpose":"최강 정합성 코어: GL·AR·AP·세무·재무제표.","l3":["총계정 GL","AR 매출채권","AP 매입채무","재무 보고"],"l4":["Journal Entry","AR Aging / Dunning","AP Reconciliation","Tax Validation","P&L","Balance Sheet","Cash Flow"],"events":["결제 성공","주문 생성"],"tech":["ACID","Two-Phase Commit","PostgreSQL HA","Fiscal Period Lock"]},"workflow":{"tag":"WORKFLOW","purpose":"BPMN·결재·룰 엔진·SLA 의 크로스 시스템 허브.","l3":["State Machine","BPMN 설계","룰 엔진","결재 체인"],"l4":["Retry","Escalation","SLA Tracking","Condition Engine","Pricing Rules","Validation Rules"],"events":["주문 생성","테넌트 개통"],"tech":["Temporal","BPMN 2.0","Drools"]},"event":{"tag":"EVENT-BUS","purpose":"도메인 디커플링 메시지 백본. Retry·Replay·멱등성 보장.","l3":["Event Bus","Domain Event","신뢰성"],"l4":["Kafka Topic","Consumer Group","DLQ","Replay","Idempotency","Event Versioning"],"events":["AI 자동 결정 코어"],"tech":["Kafka","RabbitMQ","Schema Registry"]},"data":{"tag":"DATA","purpose":"ACID·분산 정합·전문 검색·DW·Lakehouse — 모든 I/O 의 물리 기반.","l3":["트랜잭션","정합성","검색","DW"],"l4":["Saga","Optimistic / Pessimistic Lock","Full-text Search","ETL","OLAP","Data Lake"],"events":["AI 자동 결정"],"tech":["PostgreSQL","Elasticsearch","Snowflake / Databricks"]},"mdm":{"tag":"MASTER","purpose":"상품·고객·재무·조직 마스터의 단일 진실. '동일 고객 5 ID' 해결.","l3":["상품 마스터","고객 마스터","재무 마스터","조직 마스터"],"l4":["SKU 표준화","Unified Customer ID","통화 / 세율","Region Mapping","Match / Merge"],"events":["주문 생성","테넌트 개통"],"tech":["MDM Hub","PostgreSQL","Fuzzy Match"]},"notify":{"tag":"NOTIFY","purpose":"Email / SMS / Push / 인앱 / 웹훅 통합 전송.","l3":["Email","SMS / Push","인앱 알림","Webhook"],"l4":["Template","Rate Limit","Retry / DLQ","Delivery Tracking"],"events":["주문 생성","결제 성공","테넌트 개통","AI 자동 결정"],"tech":["Resend","Twilio","FCM","Cloudflare Queues"]},"file":{"tag":"FILE","purpose":"버전·권한·OCR·전자서명·라이프사이클.","l3":["업로드","권한","버전","OCR","전자서명"],"l4":["S3 / R2 Storage","Pre-signed URL","Lifecycle Policy","DocuSign Integration"],"events":["주문 생성"],"tech":["S3 / Cloudflare R2","Tesseract / Textract","DocuSign API"]},"integration":{"tag":"INTEGRATION","purpose":"API Gateway·Webhook·ETL·ERP/Bank/Payment/EDI/SOAP 외부 연결 허브.","l3":["API Gateway","Webhook","ETL Pipeline","Connector"],"l4":["Rate Limit","OpenAPI Registry","SAP / Oracle Connector","Stripe / ECPay","Bank API","EDI / SOAP"],"events":["결제 성공"],"tech":["Kong","Apache Camel","OpenAPI 3.0"]},"bi":{"tag":"ANALYTICS","purpose":"경영·운영 대시보드와 예측의 읽기 전용 모델.","l3":["경영 대시보드","운영 대시보드","KPI Engine","예측 분석"],"l4":["Revenue Dashboard","Churn Analysis","Forecast","Cohort","Retention"],"events":["주문 생성","결제 성공","AI 자동 결정"],"tech":["Metabase / Tableau","ClickHouse","dbt"]},"ai":{"tag":"AI","purpose":"AI 네이티브: 에이전트·추천·예측·이상거래·Copilot 을 각 플로우에 내장.","l3":["AI Agent","추천","예측","이상거래 탐지","Copilot"],"l4":["RAG Pipeline","Vector DB","MCP Integration","SQL Agent","Tool Use"],"events":["AI 자동 결정"],"tech":["Claude / GPT","LangChain","pgvector","MCP Protocol"]},"metadata":{"tag":"METADATA","purpose":"동적 폼·워크플로·UI·권한의 메타데이터 드리븐.","l3":["Dynamic Form","Dynamic Workflow","Dynamic Permission","Metadata Runtime"],"l4":["Schema Versioning","Hot Reload","Custom Field","No-code Builder"],"events":["테넌트 개통"],"tech":["JSON Schema","GraphQL","Apollo Federation"]},"knowledge":{"tag":"KNOWLEDGE","purpose":"Knowledge Graph·시맨틱 검색·RAG·사내 위키 — AI 의 장기 기억.","l3":["Knowledge Graph","Semantic Search","Enterprise Wiki","Context Engine"],"l4":["Graph DB","Embedding Pipeline","Hybrid Search","Citation / Lineage"],"events":["AI 자동 결정"],"tech":["Neo4j","pgvector","Sentence-BERT"]},"sre":{"tag":"PLATFORM","purpose":"CI/CD·Kubernetes·관측성·WAF·시크릿·SIEM·DR — 24×7 가동 책임.","l3":["CI/CD","Kubernetes","관측성","WAF / DDoS","Secret Manager","재해 복구"],"l4":["Prometheus / Grafana","Sentry","Vault / KMS","Cloudflare WAF","Chaos Engineering","Multi-region Failover"],"events":[],"tech":["Kubernetes","Cloudflare","Grafana","ArgoCD"]}},"picker_label":"도메인 선택","picker_placeholder":"— 도메인 선택 —","picker_overview":"▸ 도메인 전체"}};

const STAGE = document.getElementById('erp-stage');
const SVG = document.getElementById('erp-lines');
const PANEL = document.getElementById('erp-panel');
const PANEL_EMPTY = document.getElementById('erp-panel-empty');
const PANEL_BODY = document.getElementById('erp-panel-body');
const PANEL_TAG = document.getElementById('erp-panel-tag');
const PANEL_TITLE = document.getElementById('erp-panel-title');
const PANEL_PURPOSE = document.getElementById('erp-panel-purpose');
const PANEL_L3 = document.getElementById('erp-panel-l3');
const PANEL_L4 = document.getElementById('erp-panel-l4');
const PANEL_EVENTS = document.getElementById('erp-panel-events');
const PANEL_TECH = document.getElementById('erp-panel-tech');
const PANEL_CLOSE = document.getElementById('erp-panel-close');
const CHAIN_BAR = document.getElementById('erp-chain-bar');
const CHAIN_NOTE = document.getElementById('erp-chain-note');
const PICKER = document.getElementById('erp-domain-select');
const PICKER_LABEL = document.querySelector(isEmbed ? '#erp-arch-embed .erp-panel-picker-label' : '.erp-panel-picker-label');

let activeId = null;
let activeChain = null; // null | 'order' | 'payment' | 'tenant' | 'ai'
let curLang = localStorage.getItem('lang') || 'zh-TW';

const isMobile = () => window.matchMedia('(max-width: 960px)').matches;
const isGridEmbed = () => isEmbed && !isMobile();
const tDict = () => LANGS_I18N[curLang] || LANGS_I18N['en'] || {};
const tFallback = () => LANGS_I18N['en'] || LANGS_I18N['zh-TW'] || {};
const nodeLabel = n => {
  const t = tDict(), fb = tFallback();
  return t['node_'+n.id] || fb['node_'+n.id] || n.id;
};
const getDetails = id => {
  const t = tDict(), fb = tFallback();
  return (t.details && t.details[id]) || (fb.details && fb.details[id]) || null;
};
const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

function buildNodes(){
  if (!STAGE) return;
  STAGE.querySelectorAll('.erp-node').forEach(el => el.remove());
  // L1 core
  if (!isGridEmbed()) {
    const core = document.createElement('div');
    core.className = 'erp-node erp-node-core';
    core.dataset.id = 'core';
    core.style.left = CORE.x + '%';
    core.style.top = CORE.y + '%';
    const coreLabel = tDict().title2 || tFallback().title2 || 'ERP Platform';
    core.innerHTML = `<span class="erp-node-dot"></span><span>L1<span class="erp-node-core-sub">${esc(coreLabel)}</span></span>`;
    STAGE.appendChild(core);
  }
  for (const n of NODES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'erp-node';
    btn.dataset.id = n.id;
    btn.style.left = n.x + '%';
    btn.style.top = n.y + '%';
    btn.innerHTML = `<span class="erp-node-dot"></span><span class="erp-node-label">${esc(nodeLabel(n))}</span>`;
    STAGE.appendChild(btn);
  }
}

function buildLines(){
  if (!STAGE || !SVG) return;
  if (isMobile() || isGridEmbed()) { SVG.innerHTML = ''; return; }
  const w = STAGE.clientWidth, h = STAGE.clientHeight;
  SVG.setAttribute('viewBox', `0 0 ${w} ${h}`);
  SVG.innerHTML = '';
  const cx = CORE.x/100 * w, cy = CORE.y/100 * h;

  if (activeChain && CHAINS[activeChain]) {
    // Chain 模式：只畫 chain 內部相鄰連線（帶箭頭）
    const chain = CHAINS[activeChain];
    // arrow marker
    const defs = document.createElementNS('http://www.w3.org/2000/svg','defs');
    defs.innerHTML = `<marker id="erp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="currentColor"/></marker>`;
    SVG.appendChild(defs);
    for (let i=0; i<chain.length-1; i++) {
      const a = NODES.find(x => x.id === chain[i]);
      const b = NODES.find(x => x.id === chain[i+1]);
      if (!a || !b) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1', a.x/100 * w); line.setAttribute('y1', a.y/100 * h);
      line.setAttribute('x2', b.x/100 * w); line.setAttribute('y2', b.y/100 * h);
      line.setAttribute('marker-end', 'url(#erp-arrow)');
      line.classList.add('chain-line');
      line.style.animationDelay = (i * 0.18) + 's';
      SVG.appendChild(line);
    }
  } else {
    // 靜態：core ↔ 16 領域 spoke
    for (const n of NODES) {
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1', cx); line.setAttribute('y1', cy);
      line.setAttribute('x2', n.x/100 * w); line.setAttribute('y2', n.y/100 * h);
      line.dataset.from = 'core'; line.dataset.to = n.id;
      SVG.appendChild(line);
    }
    // EDGES：跨領域虛線
    for (const [a, b] of EDGES) {
      const na = NODES.find(x => x.id === a), nb = NODES.find(x => x.id === b);
      if (!na || !nb) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg','line');
      line.setAttribute('x1', na.x/100 * w); line.setAttribute('y1', na.y/100 * h);
      line.setAttribute('x2', nb.x/100 * w); line.setAttribute('y2', nb.y/100 * h);
      line.dataset.from = a; line.dataset.to = b;
      line.setAttribute('stroke-dasharray', '3 4');
      SVG.appendChild(line);
    }
  }
}

function isConnected(a, b){
  if (a === b) return true;
  return EDGES.some(e => (e[0]===a && e[1]===b) || (e[1]===a && e[0]===b));
}

function renderPanel(id){
  const n = NODES.find(x => x.id === id);
  const d = getDetails(id);
  if (!n || !d) return;
  PANEL_EMPTY.hidden = true;
  PANEL_BODY.hidden = false;
  PANEL_TAG.textContent = d.tag || n.tag;
  PANEL_TITLE.textContent = nodeLabel(n);
  PANEL_PURPOSE.textContent = d.purpose;
  PANEL_L3.innerHTML = (d.l3 || []).map(s => `<li>${esc(s)}</li>`).join('');
  PANEL_L4.innerHTML = (d.l4 || []).map(s => `<span>${esc(s)}</span>`).join('');
  PANEL_EVENTS.innerHTML = (d.events && d.events.length)
    ? d.events.map(s => `<li>${esc(s)}</li>`).join('')
    : `<li class="erp-panel-muted">—</li>`;
  PANEL_TECH.innerHTML = (d.tech || []).map(s => `<span>${esc(s)}</span>`).join('');
}

function clearPanel(){
  if (!PANEL_BODY || !PANEL_EMPTY) return;
  PANEL_BODY.hidden = true;
  PANEL_EMPTY.hidden = false;
}

function buildPicker(){
  if (!PICKER) return;
  const t = tDict(), fb = tFallback();
  PICKER.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = t.picker_placeholder || fb.picker_placeholder || '— —';
  PICKER.appendChild(ph);
  // 多層：每個 L2 為 optgroup，內含「領域總覽 + 各 L3」全部 value 指回 L2 id
  for (const n of NODES) {
    const og = document.createElement('optgroup');
    const tagSuffix = (n.tag ? ' — ' + n.tag : '');
    og.label = nodeLabel(n) + tagSuffix;
    const overview = document.createElement('option');
    overview.value = n.id;
    overview.textContent = t.picker_overview || fb.picker_overview || '▸ 領域總覽';
    og.appendChild(overview);
    const d = getDetails(n.id);
    if (d && Array.isArray(d.l3)) {
      for (const l3 of d.l3) {
        const opt = document.createElement('option');
        opt.value = n.id;
        opt.textContent = '  · ' + l3;
        og.appendChild(opt);
      }
    }
    PICKER.appendChild(og);
  }
  PICKER.value = activeId || '';
  if (PICKER_LABEL) {
    const lbl = t.picker_label || fb.picker_label || '';
    if (lbl) { PICKER_LABEL.textContent = lbl; PICKER.setAttribute('aria-label', lbl); }
  }
}

function setActive(id){
  if (id === 'core') id = null;
  activeId = id;
  STAGE?.querySelectorAll('.erp-node').forEach(el => {
    const eid = el.dataset.id;
    el.classList.toggle('active', eid === id);
    // 在 chain 模式下：非 chain 成員淡化
    if (activeChain && CHAINS[activeChain]) {
      const inChain = CHAINS[activeChain].includes(eid);
      el.classList.toggle('chain-on', inChain && eid !== 'core');
      el.classList.toggle('dim', !inChain && eid !== 'core' && eid !== id);
    } else {
      // 靜態：套 case-platform 的 EDGES 相鄰高亮邏輯——點 X 時，X 自己 + 與 X 有 edge 的鄰居維持亮，其餘 dim
      el.classList.toggle('chain-on', false);
      el.classList.toggle('dim', !!id && eid !== id && eid !== 'core' && !isConnected(id, eid));
    }
  });
  // SVG 連線：靜態模式下，點 X 時跟 X 相連的線亮起，其他 dim（chain-line 在 chain 模式下另控）
  SVG?.querySelectorAll('line').forEach(l => {
    if (l.classList.contains('chain-line')) return;
    const isHit = id && (l.dataset.from === id || l.dataset.to === id);
    l.classList.toggle('active', !!isHit);
    l.classList.toggle('dim', !!id && !isHit);
  });
  if (id) renderPanel(id);
  else clearPanel();
  if (PICKER) PICKER.value = id || '';
  // 手機板：只在 panel 還不在視窗內時才滾動，避免每次切 L2 都被往下拉
  if (id && isMobile() && PANEL) {
    const r = PANEL.getBoundingClientRect();
    const inView = r.top < window.innerHeight && r.bottom > 0;
    if (!inView) setTimeout(() => PANEL.scrollIntoView({behavior:'smooth', block:'start'}), 60);
  }
}

function setChain(name){
  activeChain = (name && CHAINS[name]) ? name : null;
  CHAIN_BAR?.querySelectorAll('.erp-chain-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.chain === (activeChain || 'none'));
  });
  if (CHAIN_NOTE) {
    const t = tDict(), fb = tFallback();
    if (activeChain) {
      const noteKey = 'chain_note_' + activeChain;
      CHAIN_NOTE.textContent = t[noteKey] || fb[noteKey] || '';
      CHAIN_NOTE.hidden = false;
    } else {
      CHAIN_NOTE.textContent = '';
      CHAIN_NOTE.hidden = true;
    }
  }
  buildLines();
  setActive(activeId);
}

if (STAGE) {
  STAGE.addEventListener('click', e => {
    const btn = e.target.closest('.erp-node');
    if (!btn) return;
    const id = btn.dataset.id;
    if (id === 'core') { setActive(null); return; }
    if (id === activeId) setActive(null);
    else setActive(id);
  });
  PANEL_CLOSE?.addEventListener('click', () => setActive(null));
  PICKER?.addEventListener('change', e => setActive(e.target.value || null));
  CHAIN_BAR?.addEventListener('click', e => {
    const btn = e.target.closest('.erp-chain-btn');
    if (!btn) return;
    const c = btn.dataset.chain;
    setChain(c === 'none' ? null : c);
  });
  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => buildLines(), 120);
  });
}

// ── 共用：套用語言到 widget（節點 label + 面板 + chain 註腳 + embed [data-i18n]） ──
function applyArchLang(lang){
  if (!LANGS_I18N[lang]) return;
  curLang = lang;
  STAGE?.querySelectorAll('.erp-node').forEach(el => {
    const id = el.dataset.id;
    if (id === 'core') {
      const sub = el.querySelector('.erp-node-core-sub');
      if (sub) sub.textContent = (tDict().title2 || tFallback().title2 || 'ERP Platform');
      return;
    }
    const n = NODES.find(x => x.id === id);
    if (n) {
      const lbl = el.querySelector('.erp-node-label');
      if (lbl) lbl.textContent = nodeLabel(n);
    }
  });
  if (activeId) renderPanel(activeId);
  buildPicker();
  if (activeChain) {
    const t = tDict(), fb = tFallback();
    if (CHAIN_NOTE) CHAIN_NOTE.textContent = t['chain_note_'+activeChain] || fb['chain_note_'+activeChain] || '';
  }
  // embed 模式：同步 #erp-arch-embed 內所有 [data-i18n]（init + 語言切換都會走這條）
  if (isEmbed) {
    const t = LANGS_I18N[lang];
    document.querySelectorAll('#erp-arch-embed [data-i18n]').forEach(el => {
      const k = el.dataset.i18n;
      if (t[k] !== undefined) el.textContent = t[k];
    });
  }
}

// embed 模式：暴露給 host (index.js) 在 applyLangI 結尾呼叫
window.erpArchSetLang = function(lang){ applyArchLang(lang); };

// ── Init widget ──
if (STAGE) {
  buildNodes();
  buildLines();
  applyArchLang(curLang);
  // standalone 預設選 iam；embed/grid 預設空 panel
  if (!isEmbed && !isMobile()) setActive('iam');
}

// ──────────────────────────────────────────────────────────────
// 以下為 standalone (erp-architecture.html) 專屬：
// embed 模式下 index.js 已處理同樣行為，跳過避免重複綁。
// ──────────────────────────────────────────────────────────────
if (isEmbed) { return; }

// ── i18n（standalone full applyLang） ──
function applyLang(lang){
  if (!LANGS_I18N[lang]) return;
  const t = LANGS_I18N[lang];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n;
    if (t[k] !== undefined) el.textContent = t[k];
  });
  const tBtn = document.getElementById('theme-toggle-btn');
  const mTBtn = document.getElementById('m-theme-btn');
  const lBtn = document.getElementById('lang-toggle-btn');
  if (tBtn) { tBtn.title = t.tooltip_theme; tBtn.setAttribute('aria-label', t.tooltip_theme); }
  if (mTBtn) mTBtn.title = t.tooltip_theme;
  if (lBtn) { lBtn.title = t.tooltip_lang; lBtn.setAttribute('aria-label', t.tooltip_lang); }
  document.querySelectorAll('.lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  document.querySelectorAll('.m-ov-lang-opt').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
  localStorage.setItem('lang', lang);
  applyArchLang(lang);
}

const langToggleBtn = document.getElementById('lang-toggle-btn');
const langDropdown  = document.getElementById('lang-dropdown');
langToggleBtn?.addEventListener('click', e => { e.stopPropagation(); langDropdown?.classList.toggle('open'); });
document.addEventListener('click', () => langDropdown?.classList.remove('open'));
langDropdown?.addEventListener('click', e => {
  const opt = e.target.closest('.lang-opt');
  if (!opt) return;
  applyLang(opt.dataset.lang); langDropdown.classList.remove('open');
});
document.getElementById('m-overlay')?.addEventListener('click', e => {
  const opt = e.target.closest('.m-ov-lang-opt');
  if (!opt) return;
  applyLang(opt.dataset.lang);
});
function toggleTopLangDrop(e){ e.stopPropagation(); document.getElementById('m-top-lang-drop')?.classList.toggle('open'); }
window.toggleTopLangDrop = toggleTopLangDrop;
document.addEventListener('click', () => document.getElementById('m-top-lang-drop')?.classList.remove('open'));
document.getElementById('m-top-lang-drop')?.addEventListener('click', e => {
  const opt = e.target.closest('.lang-opt');
  if (!opt) return;
  applyLang(opt.dataset.lang); document.getElementById('m-top-lang-drop').classList.remove('open');
});
document.getElementById('m-lang-btn')?.addEventListener('click', toggleTopLangDrop);

applyLang(curLang);

// ── Mobile overlay / drag-close ──（與 portfolio.js 同款）
const hamBtn  = document.getElementById('m-ham-btn');
const overlay = document.getElementById('m-overlay');
const topbar  = document.getElementById('m-topbar');
function openMenu(){ hamBtn?.setAttribute('aria-expanded','true'); hamBtn?.classList.add('is-open'); overlay?.classList.add('is-open'); overlay?.removeAttribute('aria-hidden'); topbar?.classList.add('menu-open'); document.body.classList.add('body-lock'); }
function closeMenu(){ hamBtn?.setAttribute('aria-expanded','false'); hamBtn?.classList.remove('is-open'); overlay?.classList.remove('is-open'); overlay?.setAttribute('aria-hidden','true'); topbar?.classList.remove('menu-open'); document.body.classList.remove('body-lock'); }
hamBtn?.addEventListener('click', () => overlay?.classList.contains('is-open') ? closeMenu() : openMenu());
overlay?.addEventListener('click', e => { if (e.target === overlay) closeMenu(); });
overlay?.querySelectorAll('[data-close-overlay]').forEach(el => el.addEventListener('click', () => setTimeout(closeMenu, 120)));
document.addEventListener('keydown', e => { if (e.key==='Escape' && overlay?.classList.contains('is-open')) closeMenu(); });

;(function(){
  const THRESHOLD=110; let startY=0,lastY=0,active=false;
  document.addEventListener('touchstart', e => {
    const ov=document.getElementById('m-overlay'); if(!ov||!ov.classList.contains('is-open'))return;
    const wrap=ov.querySelector('.m-ov-wrap'); if(!wrap)return;
    const t=e.touches[0],r=wrap.getBoundingClientRect();
    if(t.clientY<r.top||t.clientY>r.bottom)return;
    const nav=wrap.querySelector('.m-ov-nav');
    if(nav&&nav.scrollTop>0){const nr=nav.getBoundingClientRect();if(t.clientY>=nr.top&&t.clientY<=nr.bottom)return;}
    startY=t.clientY;lastY=startY;active=true;wrap.style.transition='none';
  }, { passive:true });
  document.addEventListener('touchmove', e => {
    if(!active)return;
    lastY=e.touches[0].clientY; const dy=lastY-startY; if(dy<=0)return;
    const ov=document.getElementById('m-overlay'); const wrap=ov&&ov.querySelector('.m-ov-wrap'); if(!wrap)return;
    wrap.style.transform=`translateY(${dy}px)`;
    const ratio=Math.max(0,1-dy/wrap.offsetHeight*1.5);
    ov.style.background=`rgba(10,12,28,${(0.32*ratio).toFixed(3)})`;
    e.preventDefault();
  }, { passive:false });
  document.addEventListener('touchend', () => {
    if(!active)return; active=false;
    const ov=document.getElementById('m-overlay'); const wrap=ov&&ov.querySelector('.m-ov-wrap');
    if(!wrap){startY=0;lastY=0;return;}
    const dy=lastY-startY; ov.style.background='';
    if(dy>THRESHOLD){
      wrap.style.transition='transform .26s ease'; wrap.style.transform='translateY(100%)';
      setTimeout(()=>{wrap.style.transform='';wrap.style.transition='';ov.classList.remove('is-open');ov.setAttribute('aria-hidden','true');const btn=document.getElementById('m-ham-btn');btn?.classList.remove('is-open');btn?.setAttribute('aria-expanded','false');document.getElementById('m-topbar')?.classList.remove('menu-open');document.body.classList.remove('body-lock');},260);
    } else { wrap.style.transition='transform .42s cubic-bezier(.22,1,.36,1)'; wrap.style.transform=''; setTimeout(()=>{wrap.style.transition='';},420); }
    startY=0;lastY=0;
  }, { passive:true });
})();

// ── Theme toggle ──
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
const doToggle = () => {
  const d = !document.documentElement.classList.contains('theme-dark');
  localStorage.setItem('theme', d ? 'dark' : 'light');
  applyTheme(d);
};
themeBtn?.addEventListener('click', doToggle);
mThemeBtn?.addEventListener('click', doToggle);

// ── Reveal animation ──
const osContent = document.getElementById('os-content');
const revRoot   = window.innerWidth > 768 ? osContent : null;
const revObs    = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('revealed'); revObs.unobserve(e.target); } });
}, { root: revRoot, threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
document.querySelectorAll('[data-reveal]').forEach(el => revObs.observe(el));

// ── Neural canvas（與 portfolio.js / case-platform.js 同款；尊重 prefers-reduced-motion） ──
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

})();
