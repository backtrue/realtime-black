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
| Fresh spec_evaluator | 三個 Git 候選、方法參數限制、正式 migration、語音站設定與原生 fetch 修正通過；Issue #10 的真實雙會員授權、方法讀取、越權拒絕與撤銷隔離驗收通過 |

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

真實會員測試時的執行版本已為 `dd26e166-ce7a-4033-8e9e-31885a0314bc`，deployment `328dfb28-f4bb-475d-99b1-e06f4442aedd`，100% 流量。Cloudflare 讀回此版本與本輪 `76a64f8d` 的 script ETag 完全相同，遠端 main 仍為 `789a263c`。原發布收據的當時狀態與實際驗證版本分別記錄於正式證據 JSON

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

正式 Google 跨站登入已成功。第一位會員完成 MCP 同意後，語音站顯示「方法庫授權已完成」，瀏覽器 `/auth/status` 讀回 authenticated=true、mcpAuthorized=true

透過臨時 Cloudflare remote preview 連到正式 AuthVault，使用該會員自己的 grant 完成以下驗證；會員身分由正式資料庫唯一有效的 voice_session 核對，原始 bearer 留在 AuthVault。grant 呼叫可依正常生命週期換發或清理憑證

| 驗證 | 正式結果 |
|---|---|
| 工具清單 | 精確五項方法庫工具，沒有重複 |
| `thinkwithblack_entry_catalog` | 成功，含 E01～E31，433580 bytes |
| `thinkwithblack_entry_read`，`entry_id=E01` | 成功，回 E01，33327 bytes |
| UI 解除授權 | 顯示「已解除方法庫授權」；對應前端 revocationPending=false 的分支 |
| 撤銷後瀏覽器狀態 | authenticated=true、mcpAuthorized=false |
| 撤銷後 grant／舊 handle list／舊 handle call | 均為 403、MCP_AUTH_REQUIRED |
| 會員額度 | 前後均為 300 秒 |

兩份工具結果的 SHA-256、名稱、方法 ID 與長度已保存於正式證據 JSON。臨時 preview 與 broker 已停止，兩個本機連接埠已關閉，臨時驗證憑證已移除

## 第二位會員與 MCP 授權隔離

第二位指定會員完成 Google 跨站登入並顯示 300 秒；授權前 `/auth/status` 為 authenticated=true、mcpAuthorized=false。使用者完成密碼金鑰登入並確認該會員的新 MCP 授權後，語音站顯示「方法庫授權已完成」

正式資料庫 SELECT 核對兩個不同且有效的 voice_session 會員，第二位會員與使用者指定的既有帳號唯一對應。會員 ID 經 FIFO 送入臨時驗證程序，只在記憶體保留；正式 RPC 結果以甲／乙表示

| 驗證 | 正式結果 |
|---|---|
| 甲原本已撤銷的 grant | 403、MCP_AUTH_REQUIRED |
| 乙自己的 grant／五項方法工具 | 成功，工具清單精確且不重複 |
| 乙讀方法目錄／E01 全文 | 成功，433580／33327 bytes，方法 ID 與結果 SHA-256 均與甲的公開方法一致 |
| 乙的有效 handle 改用於甲 | 403、MCP_AUTH_REQUIRED |
| 乙身分呼叫甲的授權物件 | 403、MCP_MEMBER_MISMATCH |
| 甲身分呼叫乙的授權物件 | 403、MCP_MEMBER_MISMATCH |
| 再次撤銷甲 | 成功、revocationPending=false |
| 撤銷甲後，乙的 grant／E01 讀取 | 仍成功 |
| 最終瀏覽器狀態 | 乙 authenticated=true、mcpAuthorized=true、剩餘 300 秒 |

兩輪臨時 preview、broker、連接埠與驗證憑證均已清理。正式 Worker 仍為 `c50b4264`，MCP 仍為 `dd26e166`，皆為 100% 流量。甲維持已撤銷，乙保留自己的有效授權

逐字稿與成果連結跨會員轉傳另依 Issue #21 驗證

## Issue #10 驗收紀錄

- [x] 已附版本、正式環境、實際結果與去識別證據
- [x] 2026-11-05 由 fresh spec_evaluator 核對兩位會員各自授權／工具呼叫、失效 grant、跨會員識別與後端授權邊界，符合 [Issue #10 通過條件](https://github.com/backtrue/realtime-black/issues/10)

Issue #10 已更新驗收勾選、日期與 `831a8d9` 的固定版本證據連結，GitHub 狀態讀回為 closed／completed

## OpenAI 專案、金鑰與正式模型

依使用者指示在既有 API Platform 建立 `call.thinkwithblack.com` 專用專案，並經當下確認建立 `call.thinkwithblack.com-production` 受限金鑰，有效期永不自動到期。權限開放模型清單 Read、Realtime Request 與 Responses Write，其餘保持 None；金鑰存於正式 Worker secret

實際 API 檢查：模型清單 200，Realtime `gpt-realtime-2.1` 十秒 client secret 200，文字 `gpt-6.1-sol` 的 `store:false`／structured output 200、completed

設定提交 `c1a4e152c6e49771a27613da1d33e6425b5f3ea4` 已推送 main，型別、133 Workers、8 frontend、1 native runtime 與 dry-run 建置通過，fresh spec_evaluator 已核對部署候選通過

- Deployment：`c1b6407e-0d7e-43b8-b957-bd8b473e1169`
- Version：`bebd423b-2afa-4448-bb46-959974cecaea`，100% 流量，tag `c1a4e15`
- 模型：REALTIME_MODEL=`gpt-realtime-2.1`、TEXT_MODEL=`gpt-6.1-sol`
- Secret 名稱：OPENAI_API_KEY、ECCAL_SERVICE_TOKEN、AUTH_VAULT_KEY，皆為 secret_text

首頁、前端 JavaScript、OAuth metadata 與匿名登入狀態均正常，回應未包含永久 OpenAI 金鑰，私密設定範例路徑回 404。第二位會員部署後讀回 authenticated=true、mcpAuthorized=true、eligible=true、remainingSeconds=300

完整去識別 API、binding 與入口讀回見 [OpenAI 正式設定證據](examples/production-openai-2026-11-05.json)

## Realtime 接通後五秒斷線修正

內建瀏覽器取得麥克風許可並完成兩次 WebRTC 接通。第一通尚未說話即結束，扣 0 秒；第二通已說話但未聽到回覆，服務端記錄逐字稿失敗 1 筆、扣 3 秒，餘額 297 秒

以合成資料直接連到同一 Realtime 模型，語音回覆為 completed，將其合成音訊交回同一會話後，gpt-4o-transcribe 成功產生逐字事件。測試未使用會員音訊，未保存合成音檔

原生 Workers 實測發現，sideband 使用的五秒 AbortSignal 在 101 upgrade 後仍會中斷 WebSocket：有此計時器時於 5019ms 關閉、代碼 1006；無此計時器時 8747ms 仍維持連線

修正為只在建立連線期間執行五秒計時器，fetch 完成後清除。新增原生 Workers 測試直接執行 MemberRoom.attach，驗證超過五秒仍可接收提供者事件；修改前失敗，修改後通過。型別、133 Workers、8 frontend、2 native runtime 與 dry-run 建置通過

fresh spec_evaluator 核對修正候選通過，提交 `2bef275e34ebc280c9a1f1fda9bc3e46c8a13937` 已推送 main 並發布

- Deployment：`cb5b87e1-4c63-4676-8cf2-d19950e228d6`
- Version：`77253751-6d2e-4f4e-9999-fc897beb3b00`，100% 流量，tag `2bef275`
- 首頁、前端 JavaScript、OAuth metadata 與匿名登入狀態回 200，私密設定範例路徑回 404，回應皆未包含三項後端 secret
- 瀏覽器部署後讀回 authenticated=true、mcpAuthorized=true、eligible=true、remainingSeconds=297

## 真實語音回覆、插話與追問

使用者在五秒斷線修正版完成實際通話，回報「有回覆，插話及追問也正常」。服務端保存 5 筆逐字項目，包含 3 筆會員及 2 筆助理，待轉寫與辨識失敗均為 0；同通有 5 次成功的方法搜尋

該通未成功讀取方法全文。已在 Realtime 指示加入入口目錄、入口分支、適用方法全文及語音應用的順序；搜尋只提供候選，未取得全文時須明確說明。修改只套用於具工具的 Realtime 會話

方法指示提交 `29f57f47c78d0b272bd12eec20daaa4a6d3122fd` 已推送 main。型別、134 Workers、9 frontend、2 native runtime、dry-run 建置、指定檔案 secretlint 通過，fresh spec_evaluator 驗收 PASS

- Deployment：`2e1db52a-3946-4816-9f2b-8b73e31dc7ca`
- Version：`ccec0aad-0e81-445c-adc6-b612d6afa65c`，100% 流量，tag `29f57f4`
- 三項後端 secret binding、兩項正式 origin 與原模型設定均保留
- 首頁、app.js、OAuth metadata、匿名 auth/status 回 200／no-store，私密設定範例回 404，匿名通話紀錄回 401；回應未包含三項後端 secret

同一通方法全文、實際回傳及語音應用的對照結果見下節

## 掛斷順序與舊通話結算

原通話掛斷時，瀏覽器先關閉 peer transport，後端再向提供者掛斷時取得 404，通話停在 ending。已改為立即停止麥克風與播放，保留 transport 到後端 end 請求完成，再於 finally 清理連線

修正提交 `84ff107dd35ec24910d215a0bc15dbc5d2977120` 已推送及正式發布，Worker version `9f213250-065d-41fa-ad88-09ec5916273a`。新增前端回歸在修改前失敗、修改後通過；新增後端證據 RPC 限制 owner，公開回應仍不含提供者或占用識別。fresh spec_evaluator 驗收 PASS

舊通話透過一次性 operator 流程恢復：提供者掛斷回 404，並以已記錄的首段音訊時間、[OpenAI 官方會話最長 60 分鐘](https://developers.openai.com/api/docs/guides/realtime-conversations#session-lifecycle-events)與一分鐘檢查餘裕確認提供者會話期限已過，服務端以當下時間確認結束

正常 MemberRoom alarm 與 ECCAL 結算完成，operator 的 PostgreSQL 查詢只有 SELECT。六段工具等待聯集為 16,213ms，扣除後仍超過本通占用的 297 秒，因此扣 297 秒；先前已扣 3 秒，會員累計扣 300 秒、剩餘 0 秒。結束時間 `2026-11-04T20:40:47.093Z`，保存期限 `2026-12-04T20:40:47.093Z`

結算、ECCAL 本通扣秒、剩餘額度、事件摘要、30 天期限、確認時間、累計扣秒及原始授予額度八項讀回全數一致。瀏覽器已顯示通話結束與摘要，保留 5 筆逐字項目。臨時 broker／preview 已停止，兩個連接埠及臨時憑證已清理

新通話正常掛斷的實測結果見下節；斷線及掛斷 404 的一般服務恢復接續 Issue #8、#9。去識別工具事件、雜湊、帳目及實際版本見 [正式語音證據](examples/production-voice-2026-11-05.json)

## 重新授權與發證回應驗證

第一位測試會員已重新完成個人方法庫授權，語音站顯示授權完成、剩餘 300 秒、開始通話按鈕可用

提交 `46c0164111ae39d4d0d9fa137372e36cffec27bf` 已推送 main 並發布，新增成功發證回應的去識別 console 紀錄：固定允許的欄位名稱與型別、HTTP 狀態、cache-control、SDP 格式布林、未知欄位數及憑證欄位不存在布林。識別值、SDP 原文、deadline 數值及未知欄位名稱與值均排除

新增測試注入識別值、SDP、時間、token 與未知欄位並確認未寫入紀錄，10 項前端測試、dry-run 建置、secretlint 及 fresh spec_evaluator 候選驗收通過

- Deployment：`007fe466-751f-45fe-ae46-b46b2dd310c6`
- Version：`24344d38-9a9a-40d0-9e26-4be28fd588c2`，100% 流量，tag `46c0164`
- 正式 app.js 已包含此項驗證；三項後端 secret binding、兩項 origin 與模型設定均已核對
- 首頁等四項公開入口回 200／no-store，私密設定範例回 404，匿名通話紀錄回 401；回應不含後端 secret

真實成功通話已讀回 HTTP 201，欄位精確為 `deadline`、`id`、`sdp`，型別分別為 number、string、string；未知欄位為 0，SDP 格式與憑證欄位不存在檢查均為 true，cache-control 為 no-store，證據見 [發證回應驗證](examples/production-call-boundary-2026-11-05.json)

使用者確認聽見方法與回答；語音逐字中說出 MK-453 並說明第一個檢查數字。此通正常掛斷後為 ended，扣 68 秒、剩餘 232 秒，6 筆逐字項目包含 2 筆會員與 4 筆助理，待轉寫及辨識失敗均為 0，摘要已產生；保存期限從服務端確認結束起 30 天。方法全文與 ECCAL 帳目核對結果如下

## 同通方法全文與正式帳目對照

正式後端已讀回同一通的三次成功工具呼叫：`thinkwithblack_entry_catalog` → `thinkwithblack_entry_read`（E03）→ `thinkwithblack_marketing_skill_read`。以該會員既有授權重讀 MK-453，全文 18,972 bytes、完整工具結果 77,855 bytes，全文 bytes／SHA-256 均通過，完整工具結果 SHA-256 與該通保存值完全相同

同一通逐字稿已說明 MK-453 的方法名稱與第一個核對數字，方法應用已對照私密逐字稿與全文。使用者也確認聽見方法與回答

服務端事件重算：從第一段實際音訊到確認結束共 76,468ms，三段工具等待聯集 9,276ms，應計 67,192ms，每通合計後向上取整為 68 秒。ECCAL 本通扣 68 秒、累計 68 秒、剩餘 232 秒、原始授予維持 300 秒，事件 digest 與語音站一致；保存期限精確從確認結束起 30 天

後端十項檢查全數通過。本次 readback 的 PostgreSQL 操作只有 SELECT，沒有掛斷、確認結束、結算或額度重設；通話已由一般掛斷流程完成。臨時 preview／broker 已停止，兩個連接埠、FIFO 與臨時 token 均已清理

完整去識別證據見 [正式語音證據的 actualMethodRetest](examples/production-voice-2026-11-05.json)

使用者於 2026-11-05 取消拒絕麥克風的人工實測。Issue #4 依保留範圍核對 AI 身分標示、語音回覆、插話、追問、掛斷與停止音訊；既有麥克風拒絕前端回歸測試持續通過

Issue #11 的同通方法全文與語音應用、Issue #4 保留範圍的語音互動與掛斷，均已於 2026-11-05 分別通過 fresh spec_evaluator 獨立驗收。供驗收的本機私密逐字稿副本已移除，正式會員紀錄依原保存期限保留

## Issue #5 跨通話 300 秒正式驗收

第三位既有 ECCAL 測試會員完成 Google 跨站登入與個人 MCP 授權，從 300 秒及空通話紀錄開始。使用連到正式服務的 Node WebRTC peer 接收模型產生的測試語音；兩通均有實際音訊封包及提供者音訊開始事件

本次使用正式版本 `24344d38-9a9a-40d0-9e26-4be28fd588c2`，deployment `007fe466-751f-45fe-ae46-b46b2dd310c6`，實作提交 `46c0164`。測試前後皆為 100% 流量

| 階段 | 本通應計時間 | 本通扣秒 | ECCAL 累計扣秒 | ECCAL 餘額 | 未結算占用 |
|---|---|---|---|---|---|
| 開始前 | — | — | 0 | 300 | 0 |
| 第一通正常掛斷 | 119,320ms，向上取整 | 120 | 120 | 180 | 0 |
| 登出、SSO 重登、完整重新整理 | — | — | 120 | 180 | 0 |
| 第二通由既有後端截止流程結束 | 180,154ms，以上限 180 秒結算 | 180 | 300 | 0 | 0 |

兩通的工具等待皆為 0ms。每筆語音站結算與 ECCAL reservation 的本通扣秒、剩餘額度及事件 digest 均相同，原始授予仍為 300 秒。保存期限均精確從服務端確認結束起 30 天

第一通結束時間為 `2026-11-05T05:52:52.626Z`；重登後新的有效 voice_session 建立於 `2026-11-05T05:54:18.775Z`，早於第二通開始。瀏覽器依序讀回 300、180、0 秒，零秒時開始通話按鈕停用，兩筆通話均顯示已結束

另外兩位會員的 PostgreSQL 前後讀回分別維持 232 秒與 0 秒。兩通結束後，再登入前者，語音站顯示 3 分 52 秒，個人方法庫授權仍有效

本次 PostgreSQL 查詢均為 SELECT，占用與結算由正式服務執行。沒有重設額度、注入計時事件、回填時間或保存音訊。臨時 preview、broker、兩個連接埠、FIFO 與臨時憑證皆已清理

去識別時間軸、兩筆用量、ECCAL 前後餘額、瀏覽器讀回與清理結果見 [跨通話額度正式證據](examples/production-quota-2026-11-05.json)

Issue #5 已於 2026-11-05 通過 fresh spec_evaluator 獨立驗收，逐項核對兩通扣秒、餘額、重登、會員隔離及個別帳目，判定 PASS
