# 本機執行與串接

## 執行

```sh
npm ci
npm run check
npm run dev -- --port 8787
```

本機入口為 `http://127.0.0.1:8787`，`npm run check` 執行型別檢查、Workers runtime 測試、通話頁 Node 事件測試、原生 Workers 服務連線測試與 Wrangler dry-run 建置

正式入口為 `https://call.thinkwithblack.com`，Wrangler 已設定 custom domain、APP_ORIGIN 與 ECCAL_ORIGIN。正式部署、資料庫 migration 及各階段讀回見 [正式環境驗證](release-validation-2026-11-05.md)

## 後端設定

將 `.dev.vars.example` 複製為 `.dev.vars` 後，在本機填入設定

| 設定 | 用途 | 設定值或取得方式 |
|---|---|---|
| `OPENAI_API_KEY` | 申請短效憑證、建立及掛斷通話、產生成果 | 專用專案 `call.thinkwithblack.com` 的受限金鑰，存於 Worker secret |
| `REALTIME_MODEL` | 語音模型 | `gpt-realtime-2.1` |
| `TEXT_MODEL` | 摘要、報告、文案及改善計畫模型 | `gpt-6.1-sol` |
| `APP_ORIGIN` | 核對瀏覽器開始及結束請求的來源 | 本機為 `http://127.0.0.1:8787` |
| `ECCAL_ORIGIN` | ECCAL 語音額度 HTTP 來源 | `https://eccal.thinkwithblack.com`，本機測試可用 loopback HTTP |
| `ECCAL_SERVICE_TOKEN` | 語音額度專用後端憑證 | 與 ECCAL 的 `THINKWITHBLACK_VOICE_SERVICE_TOKEN` 相同 |
| `AUTH_VAULT_KEY` | 既有 OAuth 相容入口與舊授權清理使用的 AES-GCM 金鑰 | 獨立 32-byte canonical base64url 後端憑證 |
| `MCP_CLIENT_ID` | 舊版個人 OAuth 相容入口的 client ID | HTTPS 留白使用本站 CIMD metadata；loopback 測試需已登記的 client ID |
| `ECCAL` service binding | 會員與額度 port | 有此綁定時採用此來源 |
| `MCP_METHODS` service binding | 內建共用行銷方法 | `thinkwithblack-mcp` 的 `CallMethods` entrypoint |
| `DELIVERY` service binding | 收件人與營運權限核對、Email／LINE 送出證據 | D4、D5 核定後的交付 adapter |

`wrangler.jsonc` 已設定會員、通話截止與 AuthVault 三個 Durable Object，AuthVault 使用 v2 migration。`src/eccal-http.ts` 實作 `eccal-voice-v1`，在沒有 service binding 時使用 ECCAL HTTP 身分與額度介面，共用行銷方法由 `MCP_METHODS` 內部服務綁定提供，通話與工具流程不讀取個人 MCP grant

OpenAI 金鑰名稱為 `call.thinkwithblack.com-production`，有效期限依使用者核定為永不自動到期，權限限制為模型清單讀取、Realtime 請求及 Responses 生成。正式 API 已驗證 Realtime 十秒短效憑證與 `store:false` 結構化文字回應，部署與請求紀錄見 [OpenAI 正式設定證據](examples/production-openai-2026-11-05.json)

ECCAL 另設定 `VOICE_APP_ORIGIN` 與本站 `APP_ORIGIN` 相同，套用 `0005_voice_login.sql` 後支援一次性登入交換與會話驗證。首頁提供 ECCAL 登入與登出入口，會員登入後可直接使用 AI 小黑的內建行銷方法。跨站流程與測試見 [登入與授權驗證](auth-validation-2026-11-04.md)

ECCAL 已有可在本機執行的 PostgreSQL 語音帳本、四項內部 HTTP 方法及本人餘額查詢，來源為 `backtrue/eccal-new` 的 `docs/voice-quota.md` 與 `server/voiceQuotaRoutes.ts`。兩邊專用憑證只存於後端設定；HTTP 不跟隨轉址，回應超過 8 KiB 拒絕讀取

## ECCAL adapter 的產品內部介面

型別位於 `src/contracts.ts`，由 adapter 將核定的 ECCAL 契約轉換為以下內部方法

| 方法 | 責任 |
|---|---|
| `authenticate` | 從已核定的登入憑證取得會員身分與語音資格，失效登入回傳 null |
| `balance` | 讀取該會員權威的可用語音秒數 |
| `reserve` | 以會員及操作識別值原子占用額度，重送同一操作回傳同一筆占用、可用秒數及接通前截止時間 |
| `settle` | 接收後端事件時間軸，按下列核定規則結算，重送同一占用不重扣 |
| `mcpGrant` | 保留的舊版型別介面，目前通話與工具流程不呼叫 |

每個 ECCAL 呼叫最多等待 10 秒，占用與結算逾時保留原識別值對帳

共用方法經 `DefaultMethods` 呼叫 `MCP_METHODS.list()`／`call(name, args)`，列出與呼叫只接受入口目錄、入口、方法搜尋及方法全文。兩端拒絕品牌、會員、執行與額外來源參數，服務最多等待 10 秒、結果最多 1 MiB；工具失敗時明確保留缺口

Cloudflare 命名 entrypoint 由同帳號 Service Binding 呼叫。MCP 的 CallMethods 從同一份核准套件讀取行銷內容，無個人 OAuth、管理者 bearer、品牌儲存或外部帳戶工具。原公開 /mcp 的 OAuth 與既有個人授權相容程式持續保留，通話路徑使用內建方法服務

本機開發時需同時提供語音 Worker 與 MCP Worker，並讓服務綁定指向 CallMethods；Workers 測試配置使用明確標記的共用方法 fixture，跨 repo 原生驗證則載入兩個實際 bundle

既有 ECCAL 登入與會員 API 的查核見 [M0-01 串接查核](eccal-integration-check.md)

## 通話與保存流程

會員的請求由同一個 MemberRoom 依序處理。後端先保存操作識別值與占用工作，再申請僅供後端使用的短效 Realtime 憑證，交換 SDP 並建立 sideband。瀏覽器取得 SDP、產品通話識別值及截止時間

每通另有 CallCutoff Durable Object，在截止時直接呼叫提供者掛斷。第一個服務端音訊事件開始計時，工具等待不計時，工具回覆後以剩餘秒數更新截止；瀏覽器不依開始時的固定截止自動掛斷。會員的工具呼叫或結算等待不會占用這個獨立截止處理。舊截止到時會先直接讀取會員儲存的最新計時版本，不經工具工作佇列，再核對是否需要掛斷。掛斷取得確認後才結算額度，失敗會保留狀態並重試

2026-11-04 核定的 D2 規則由 `src/metering.ts` 實作：第一段實際音訊到服務端確認結束，扣除工具等待的聯集後，對每通總秒數向上取整；未接通為 0 秒。工具事件以 `toolCallId` 配對。共用方法呼叫最多等待 10 秒，正常逾時會記錄工具結束並恢復剩餘通話時間；獨立截止物件依既有計時保護預留完整剩餘秒數加 20 秒處理窗口，避免逾時邊界提前掛斷。若處理中斷且結果始終未回，仍會在該停止點關閉，未回覆的等待持續排除至確認結束

例如總時間 120 秒、工具等待 30 秒，扣 90 秒；兩段各 0.4 秒的有效時間合計扣 1 秒。ECCAL adapter 須採同一規則，產品會核對回傳用量與事件計算是否一致，差異保留為待對帳工作

輸入逐字稿、已確認播放完成的助理回答、工具結果與成果存放於會員 DO。逐字稿依提供者的 item 前後關係排列；晚到轉寫會使舊成果作廢，摘要依最新逐字稿重建。結束後最多等待 10 秒接收待辨識片段，未能完成的片段會記為辨識失敗，成果明確列出缺口

30 天從服務端確認通話結束起算，到期時直接讀取及清單皆拒絕提供內容，alarm 清除全文。待結算工作只保留識別值及計時事件，與正文期限分開處理。儲存位置及清除抽查見 [通話資料儲存清冊](storage-inventory.md)。插話時已播放片段的逐字對齊見 [Issue #15 驗收](transcript-validation-2026-11-05.md)

## 成果交付

會員可在成果下方指定 Email 或取得 LINE 領取碼，HTTP 入口建立待處理工作，工作與通話紀錄一同持久保存。清單回傳待處理、寄送中、結果不明、失敗或已送出的狀態

LINE 原碼只在建立時回傳給該會員，儲存端保存 SHA-256 雜湊。原成果到期、已成功領取或文件版本改變後不能再派送。Email 指定地址、成果識別值、會員及工作均須對上交付 adapter 回傳的核對範圍

派送入口為後端 MemberRoom RPC，未提供會員可直接要求發送的 HTTP 路由。`DELIVERY.verify` 負責依 D4、D5 核定的方式核對營運權限、收件人及證據；LINE 另須回傳有人監督。`DELIVERY.send` 回傳送出收據、明確拒絕或結果不明，最多等待 10 秒

後端在送出前先持久保存狀態並安排恢復 alarm。中斷後留下的寄送中工作改列結果不明，不自動重送。成功的 LINE 工作另外記錄核銷時間；所有成果連結開啟時仍透過 ECCAL 會員驗證讀取

## 官方實作依據

- [OpenAI Realtime WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime)
- [GPT-Realtime-2.1 模型](https://developers.openai.com/api/docs/models/gpt-realtime-2.1)
- [GPT-6.1 Sol 模型](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [OpenAI 短效憑證](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create)
- [OpenAI sideband 控制](https://developers.openai.com/api/docs/guides/voice-server-controls?voice-api=realtime)
- [OpenAI 後端掛斷](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup)
- [Cloudflare Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Cloudflare Workers 測試](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)

- [Cloudflare Service Binding RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/)
