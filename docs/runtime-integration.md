# 本機執行與串接

## 執行

```sh
npm ci
npm run check
npm run dev -- --port 8787
```

本機入口為 `http://127.0.0.1:8787`，`npm run check` 執行型別檢查、Workers runtime 測試、通話頁 Node 事件測試與 Wrangler dry-run 建置

## 後端設定

將 `.dev.vars.example` 複製為 `.dev.vars` 後，在本機填入設定

| 設定 | 用途 | 目前需取得的資料 |
|---|---|---|
| `OPENAI_API_KEY` | 申請短效憑證、建立及掛斷通話、產生成果 | 專用測試專案金鑰 |
| `REALTIME_MODEL` | 語音模型 | 測試專案可用的 Realtime 模型名稱 |
| `TEXT_MODEL` | 摘要、報告、文案及改善計畫模型 | 測試專案可用的文字模型名稱 |
| `APP_ORIGIN` | 核對瀏覽器開始及結束請求的來源 | 本機為 `http://127.0.0.1:8787` |
| `ECCAL_ORIGIN` | ECCAL 語音額度 HTTP 來源 | `https://eccal.thinkwithblack.com`，本機測試可用 loopback HTTP |
| `ECCAL_SERVICE_TOKEN` | 語音額度專用後端憑證 | 與 ECCAL 的 `THINKWITHBLACK_VOICE_SERVICE_TOKEN` 相同 |
| `AUTH_VAULT_KEY` | AuthVault 的 AES-GCM 金鑰 | 獨立 32-byte canonical base64url 後端憑證 |
| `MCP_CLIENT_ID` | 已登記的 MCP OAuth client ID | HTTPS 留白使用本站 CIMD metadata；loopback 測試需已登記的 client ID |
| `ECCAL` service binding | 完整會員、額度與個別會員 MCP 授權 port | 有此綁定時採用此完整來源 |
| `DELIVERY` service binding | 收件人與營運權限核對、Email／LINE 送出證據 | D4、D5 核定後的交付 adapter |

`wrangler.jsonc` 已設定會員、通話截止與 AuthVault 三個 Durable Object，AuthVault 使用 v2 migration。`src/eccal-http.ts` 實作 `eccal-voice-v1`，在沒有 service binding 時使用 ECCAL HTTP 身分與額度介面，個別會員 MCP grant 由自己的 AuthVault 提供

ECCAL 另設定 `VOICE_APP_ORIGIN` 與本站 `APP_ORIGIN` 相同，套用 `0005_voice_login.sql` 後支援一次性登入交換與會話驗證。首頁提供 ECCAL 登入、個人方法庫授權、解除與登出入口。跨站流程與測試見 [登入與授權驗證](auth-validation-2026-11-04.md)

ECCAL 已有可在本機執行的 PostgreSQL 語音帳本、四項內部 HTTP 方法及本人餘額查詢，來源為 `backtrue/eccal-new` 的 `docs/voice-quota.md` 與 `server/voiceQuotaRoutes.ts`。兩邊專用憑證只存於後端設定；HTTP 不跟隨轉址，回應超過 8 KiB 拒絕讀取

## ECCAL adapter 的產品內部介面

型別位於 `src/contracts.ts`，由 adapter 將核定的 ECCAL 契約轉換為以下內部方法

| 方法 | 責任 |
|---|---|
| `authenticate` | 從已核定的登入憑證取得會員身分與語音資格，失效登入回傳 null |
| `balance` | 讀取該會員權威的可用語音秒數 |
| `reserve` | 以會員及操作識別值原子占用額度，重送同一操作回傳同一筆占用、可用秒數及接通前截止時間 |
| `settle` | 接收後端事件時間軸，按下列核定規則結算，重送同一占用不重扣 |
| `mcpGrant` | 回傳該會員目前有效的授權識別值、期限及核定的唯讀工具清單 |

每次工具呼叫重新取得該會員 grant，後端只呼叫固定 ThinkWithBlack MCP 入口。會員不能傳入 MCP 來源、權杖或授權標頭。每個 ECCAL 呼叫最多等待 10 秒；占用與結算逾時會保留原識別值對帳

MCP 使用既有 OAuth 同意頁與 S256 PKCE，要求 `thinkwithblack.use thinkwithblack.methods.read`。AuthVault 逐次以該會員 token 查詢帳號，再由 ECCAL 核對歸屬；換發與撤銷使用 metadata 公告的 `/oauth/token`。token 留在 AuthVault，工具執行與撤銷共用同一工作佇列，撤銷回覆後舊授權識別值拒絕使用。瀏覽器不取得 MCP token，儲存端保存綁定會員及用途的密文

`thinkwithblack.methods.read` 已正式發布，限制為帳號核對及五項行銷方法工具，並拒絕與 GSC／GTM scope 混用。2026-11-05 讀回提供者的公開 metadata 已包含新 scope，Cloudflare 版本及 ECCAL 發布結果見 [正式環境驗證](release-validation-2026-11-05.md)

既有 ECCAL 登入與會員 API 的查核見 [M0-01 串接查核](eccal-integration-check.md)

## 通話與保存流程

會員的請求由同一個 MemberRoom 依序處理。後端先保存操作識別值與占用工作，再申請僅供後端使用的短效 Realtime 憑證，交換 SDP 並建立 sideband。瀏覽器取得 SDP、產品通話識別值及截止時間

每通另有 CallCutoff Durable Object，在截止時直接呼叫提供者掛斷。第一個服務端音訊事件開始計時，工具等待不計時，工具回覆後以剩餘秒數更新截止；瀏覽器不依開始時的固定截止自動掛斷。會員的工具呼叫或結算等待不會占用這個獨立截止處理。舊截止到時會先直接讀取會員儲存的最新計時版本，不經工具工作佇列，再核對是否需要掛斷。掛斷取得確認後才結算額度，失敗會保留狀態並重試

2026-11-04 核定的 D2 規則由 `src/metering.ts` 實作：第一段實際音訊到服務端確認結束，扣除工具等待的聯集後，對每通總秒數向上取整；未接通為 0 秒。工具事件以 `toolCallId` 配對。工具呼叫包含最多各 10 秒的會員授權與 MCP 等待，正常逾時會記錄工具結束並恢復剩餘通話時間；獨立截止物件預留完整剩餘秒數加這段最長等待，避免逾時邊界提前掛斷。若處理中斷且結果始終未回，仍會在該停止點關閉，未回覆的等待持續排除至確認結束

例如總時間 120 秒、工具等待 30 秒，扣 90 秒；兩段各 0.4 秒的有效時間合計扣 1 秒。ECCAL adapter 須採同一規則，產品會核對回傳用量與事件計算是否一致，差異保留為待對帳工作

輸入逐字稿、已確認播放完成的助理回答、工具結果與成果存放於會員 DO。逐字稿依提供者的 item 前後關係排列；晚到轉寫會使舊成果作廢，摘要依最新逐字稿重建。結束後最多等待 10 秒接收待辨識片段，未能完成的片段會記為辨識失敗，成果明確列出缺口

30 天從服務端確認通話結束起算，到期時直接讀取及清單皆拒絕提供內容，alarm 清除全文。待結算工作只保留識別值及計時事件，與正文期限分開處理。儲存位置及清除抽查見 [通話資料儲存清冊](storage-inventory.md)。插話時已播放片段的逐字對齊列在 Issue #15 待驗收項目

## 成果交付

會員可在成果下方指定 Email 或取得 LINE 領取碼，HTTP 入口建立待處理工作，工作與通話紀錄一同持久保存。清單回傳待處理、寄送中、結果不明、失敗或已送出的狀態

LINE 原碼只在建立時回傳給該會員，儲存端保存 SHA-256 雜湊。原成果到期、已成功領取或文件版本改變後不能再派送。Email 指定地址、成果識別值、會員及工作均須對上交付 adapter 回傳的核對範圍

派送入口為後端 MemberRoom RPC，未提供會員可直接要求發送的 HTTP 路由。`DELIVERY.verify` 負責依 D4、D5 核定的方式核對營運權限、收件人及證據；LINE 另須回傳有人監督。`DELIVERY.send` 回傳送出收據、明確拒絕或結果不明，最多等待 10 秒

後端在送出前先持久保存狀態並安排恢復 alarm。中斷後留下的寄送中工作改列結果不明，不自動重送。成功的 LINE 工作另外記錄核銷時間；所有成果連結開啟時仍透過 ECCAL 會員驗證讀取

## 官方實作依據

- [OpenAI Realtime WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?voice-api=realtime)
- [OpenAI 短效憑證](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create)
- [OpenAI sideband 控制](https://developers.openai.com/api/docs/guides/voice-server-controls?voice-api=realtime)
- [OpenAI 後端掛斷](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup)
- [Cloudflare Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Cloudflare Workers 測試](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)
