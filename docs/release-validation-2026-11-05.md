# 2026-11-05 提交與正式環境驗證

依據：[產品規格 V0.3](product-spec.md)、Issue #1、#3、#10、#12、#21，以及使用者本次提交、推送、ECCAL 同步發布與正式驗證指示

## GitHub 讀回

| Repository | 分支 | 實作提交 | 遠端讀回 |
|---|---|---|---|
| realtime-black | main | 實作 `e0845c7c44958c50bbb52651a8dc4fbe05d1c404`、正式設定 `b9cde9625d42f7fdf523e51cf3c3a7ecccca1a2c`、原生 fetch 修正 `f51fc0050dedd301d12ae747f151c6464f3acd92` | 三提交均已推送 |
| eccal-new | codex/thinkwithblack-mcp-auth | `be31e6ee81bce7e27caab4ca42b6535ec610a868` | 發布後為 `2702955844df9d30947ca49448f8f04e6dfe1055`，與實作提交的 tree 相同 |
| thinkwithblack-mcp | main | 授權 `b22a53501e021c4b20acc2c2072e76cba90a09fb`、參數限制 `c0a0744b306d6f94134ae42b832ce74a3619d176` | 正式候選為包含兩提交的 `789a263c94b952fa01bbbb2c0dcf6a522e6f018c`，與遠端 main 相同 |

ECCAL 候選從遠端 `a7af3d2` 加入 20 個語音額度／登入檔案與必要增量，保留遠端新增的 dashboard schema。原工作目錄的付款、試用方案及其他頁面修改保留在原處

MCP 候選從正式 main `4a00d964` 加入七個授權檔案與 `scripts/verify-scope.mjs` 的兩項精確 allowlist。保留正式 main 的既有工具、方法與儲存設定

## 發布候選驗證

| 範圍 | 已執行結果 |
|---|---|
| realtime-black | `npm run check`：型別、133 項 Workers、8 項前端、1 項原生 Workers 服務連線、三個 DO dry-run 建置通過 |
| ECCAL | 型別、17 項語音帳本、1 項額度跨 repo、8 項登入、2 項三 repo MCP、前後端建置、指定檔案 secretlint 通過 |
| MCP | 方法參數修正候選 44 個檔案共 2414 項測試通過；最新 main 的正式發布流程另完成安裝、scope、來源、型別、完整測試、全庫 secretlint 及 dry-run 建置 |
| Fresh spec_evaluator | 三個 Git 候選、方法參數限制、正式 migration、語音站設定與原生 fetch 修正通過；整體 NEEDS_WORK，真實會員驗收待完成 |

方法庫授權另封閉既有工具的私人 context 參數：`entry_read` 只接受 `entry_id`、`marketing_skill_read` 只接受 `id`、`marketing_skill_search` 只接受 `query`／`cursor`，其餘三項工具接受空參數。品牌、任務與未知欄位在 handler 前拒絕，混合 batch 整批拒絕，既有不含 methods scope 的 client 保留原有行為

新增 21 個參數／batch／既有 client 回歸案例，修正前 16 個失敗，修正後 OAuth/state 138 項與全套 2414 項通過。首次全套執行有三項匯入／同步測試逾時；原碼重跑該兩個檔案 22 項通過，再以 `VITEST_MAX_WORKERS=2` 執行完整 44 檔全數通過，未修改 timeout。Fresh spec_evaluator 已獨立驗收這次三檔增量並允許提交發布

## MCP 正式發布

使用既有 `VITEST_MAX_WORKERS=2 node scripts/deploy-production.mjs 789a263c94b952fa01bbbb2c0dcf6a522e6f018c`，從乾淨且與遠端 main 相同的候選發布。候選包含本次方法參數修正與 main 新增的搜尋廣告檔期方法，保留正式 main 的新增內容

- Cloudflare deployment：`337ee314-dcd4-4371-85d0-99ae08cfe4c7`
- Cloudflare version：`76a64f8d-290e-4579-bcd3-a1cbf3a23508`，100% 流量
- 提供者時間：`2026-11-04T17:23:38.869492Z`，台灣時間 2026-11-05 01:23
- Authorization metadata 與 protected-resource metadata：200，包含 `thinkwithblack.methods.read`
- 未登入 `/mcp`：401，OAuth challenge 正確
- 發布收據：MCP 候選的 `dist/production-deployment-receipt.json`

## ECCAL Git 同步與 Republish

Replit app：`629e49c6-8dc3-42cd-b86c-d35b18e038dd`，網址 `https://replit.com/@backtrue/eccal`

Git control 核對 remote 為 `backtrue/eccal-new`、分支為 `codex/thinkwithblack-mcp-auth`、沒有未提交檔案。原本尚未推送的 `b07b37b Published your App` 顯示 0 個變更檔案，父提交為 `a7af3d2`

使用 Git control 拉取已推送的實作後，原發布空提交保留為 `22f2f16`，父提交為 `be31e6e`；再經 Git control 推送。外部 Git 讀回兩者 tree 相同，Replit control 顯示同步且沒有未提交修改

Republish 已成功，deployment ID 為 `03b7e1a3-4217-445c-abab-8ac828d50890`，正式網址為 `https://eccal.thinkwithblack.com`

正式入口讀回

| 請求 | 狀態 | 回應 |
|---|---|---|
| `GET /` | 200 | 網站可讀取 |
| `GET /api/voice/login`，沒有 state | 400 | `X-Voice-Contract: eccal-voice-v1`、`LOGIN_STATE_INVALID` |
| `GET /api/voice/login`，語音站實際產生的 state | 302 | 接受 state 並轉向不含參數的 `/api/voice/login` |
| `POST /api/voice/internal/authenticate`，空登入資料且不帶服務憑證 | 401 | `X-Voice-Contract: eccal-voice-v1`、`UNAUTHORIZED_CALLER` |
| 同端點，帶語音站相同的服務憑證 | 200 | 匿名身分為 null |

語音路由、正式 origin 與服務專用憑證已生效

本次發布另產生 0 檔案變更的 `2702955 Published your App`，父提交為 `22f2f16`。已經 Git control 推送，外部 Git 讀回確認 tree 仍與 `be31e6e` 相同，Replit control 再次顯示同步完成

## 正式語音站與資料庫 migration

使用者指定正式網址為 `https://call.thinkwithblack.com`，並明確指示查核 Replit 內的正式資料庫設定。本輪從 Production Database Settings 的 PGHOST／PGDATABASE，對照 Publishing → Production app secrets 的 DATABASE_URL，確認兩處 hostname 與 database 相同

正式資料庫為 PostgreSQL 16.15、`neondb`、`public` schema、非 recovery。透過本機程序從 Replit 外連線執行；連線字串以記憶體管線傳遞，紀錄只保留資料庫身分與 schema

套用前四張語音表的 `to_regclass` 皆為 null。`0004_voice_quotas.sql`、`0005_voice_login.sql` 已在同一交易內套用，使用 transaction advisory lock 與 5 秒 lock timeout；錯誤會停止並回滾。提交後讀回 4 張表、24 個欄位、18 個已驗證限制條件、8 個有效索引。第二次交易重跑兩檔成功，catalog 完全相同

先前 migration 曾完成 catalog 與 replay 核對；本輪 Google 登入實測時，重新依目前發布設定取得 DATABASE_URL，四表 `to_regclass` 均為 null，登入碼寫入回 `42P01`。診斷交易已回滾，隨後針對目前正式連線重新依上述鎖定與交易流程套用同兩檔，再讀回 4／24／18／8 並通過 replay。Google 登入重試後成功回到語音站，顯示剩餘 5 分 0 秒與空通話紀錄

Migration 來源與 `be31e6e` 相同。完整去識別證據與此次重套後 catalog 見 [正式 schema 與 Worker 設定](examples/production-auth-2026-11-05.json)

語音站設定提交：`b9cde9625d42f7fdf523e51cf3c3a7ecccca1a2c`，已推上 main。Wrangler 加入正式 custom domain 與兩個公開 origin；Vitest 使用空 ECCAL_ORIGIN binding，讓各測試維持原有的受控服務設定。完整 133 項 Workers、8 項前端、型別及 dry-run 建置通過

Cloudflare 正式部署

- Deployment：`ac466c34-8b56-4275-8b6e-fb385b5bdf3c`
- Version：`c50b4264-c5f7-44c6-a0bc-f19d94436c2c`，100% 流量，tag `f51fc00`
- 網址：`https://call.thinkwithblack.com`
- APP_ORIGIN：`https://call.thinkwithblack.com`
- ECCAL_ORIGIN：`https://eccal.thinkwithblack.com`
- Secret 名稱讀回：AUTH_VAULT_KEY、ECCAL_SERVICE_TOKEN，皆為 secret_text

| 正式請求 | 讀回 |
|---|---|
| 語音站首頁 | 200、no-store |
| OAuth client metadata | 200，client ID／callback 均為正式語音 origin，scope 為 use＋methods.read |
| `/auth/login` | 303 至 ECCAL `/api/voice/login`；本站 nonce cookie 為 __Host-、HttpOnly、Secure、SameSite=Lax |
| 外站來源 POST `/auth/logout` | 403、ORIGIN_FORBIDDEN |
| `/.dev.vars.example` | 404 |
| `/auth/status`，匿名請求 | 200、authenticated=false、mcpAuthorized=false |
| `/api/me`，匿名請求 | 401、LOGIN_REQUIRED |

## ECCAL 正式設定與真實會員待驗

ECCAL 正式設定已讀回 `VOICE_APP_ORIGIN` 與 `THINKWITHBLACK_VOICE_SERVICE_TOKEN` 名稱。語音站產生的實際登入 state 通過本機相同服務憑證的 HMAC 核對，ECCAL 接受後 302 轉向 `/api/voice/login`。以該服務憑證查詢匿名身分回 200／null，未帶服務憑證回 401／UNAUTHORIZED_CALLER

原生 Workers 執行環境另重現 `fetch` 被當成 client 物件方法後的 `Illegal invocation`，導致正式 `/auth/status` 回 ECCAL_UNAVAILABLE。五個服務 client 的預設值已改為 `fetch.bind(globalThis)`，注入測試 fetch 的介面不變。新增的原生 Workers 整合測試以實際 client 走過 ECCAL、MCP metadata／SDK、Realtime 建立／掛斷與 Documents 請求；修正前 500，修正後通過，並納入 `npm run check`

正式網路設定包含 `global_fetch_strictly_public`，讓同 zone 子請求依公開網路路徑路由；單獨發布此 flag 後仍重現 503，再透過原生 runtime 測試確認上述 receiver 問題。依據：[Cloudflare 公開 fetch 設定](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)、[Illegal invocation 說明](https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors)

正式 Google 跨站登入已成功。第一位會員已從語音站進入 MCP 同意頁，顯示「讀取行銷方法庫並核對目前帳號，僅提供諮詢使用」，目前等待使用者依瀏覽器工具新增存取授權的當下確認。MCP 工具讀取／撤銷、第二位會員隔離與成果連結轉傳拒絕待驗證
