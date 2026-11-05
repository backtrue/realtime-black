# M2-12 通話資料儲存清冊

對應 [Issue #26](https://github.com/backtrue/realtime-black/issues/26)，設定依據為 `wrangler.jsonc`，本機抽查使用 Cloudflare Workers runtime 與 SQLite Durable Object

## 持久儲存

| 位置 | 欄位及內容 | 歸屬與清除 |
|---|---|---|
| MEMBERS 的 `call:{recordId}` | memberId、逐字稿、item 順序、待辨識及失敗識別值、工具結果與續答快取、四類文件、交付地址與狀態、LINE 領取碼雜湊、計時事件、結算結果 | 會員 ID 雜湊決定 DO，讀取再核對 memberId；服務端確認結束後 30 天清除此整筆資料 |
| MEMBERS 的 `operation:{operationId}` | 會員識別值 | 留作重放拒絕，不含通話正文或權杖 |
| MEMBERS 的 `pending-reservation` | 會員、操作與通話識別值、建立時間、占用前餘額 | 原操作完成對帳後刪除 |
| MEMBERS 的 `active` | 通話識別值 | 結算完成後刪除 |
| MEMBERS 的 `settlement:{recordId}` | 會員、通話及占用識別值、占用秒數、計時事件 | 結算完成後刪除；正文到期時可獨立留存對帳，不含逐字稿、工具內容、文件或交付地址 |
| MEMBERS 的 `provider-end:{recordId}` | 會員、通話識別值、提供者確認結束時間 | MemberRoom 消化事件後刪除 |
| CUTOFFS 的 `call` | 會員、通話與提供者會話識別值、截止及確認結束時間、關閉狀態、計時版本 | 掛斷已確認且會員物件收到通知後清除 |
| AUTH 的 `owner` | 會員識別值 | 每位會員各自的 AuthVault，作歸屬核對 |
| AUTH 的 `pending:{state}` | AES-GCM 密文：PKCE verifier、會話指紋與瀏覽器指紋；到期時間 | 最多 10 分鐘，callback 單次消耗或到期清除 |
| AUTH 的 `grant` | AES-GCM 密文：個人 access／refresh token、client ID、授權識別值與期限 | access 到期換發，refresh 最長依既有提供者 30 天期限；解除、失效或到期清除 |
| AUTH 的 `revoke:{id}` | AES-GCM 密文：待提供者確認撤銷的憑證 | 確認撤銷或憑證到期清除 |
| ECCAL 的 `voice_login_codes` | 登入碼、state 雜湊、會員、audience、登入與會話期限、使用時間 | 登入碼最多 2 分鐘，交換只能成功一次，到期分批清除 |
| ECCAL 的 `voice_sessions` | 本站會話 token 雜湊、會員與期限 | 最晚與原 ECCAL JWT 同時到期，登出刪除、到期分批清除 |

`MemberEngine.get`、`list`、`alarm` 都檢查到期時間，清除 `call:` 即涵蓋逐字稿、摘要、成果、工具副本與交付資訊。程式位置為 `src/member-engine.ts`、`src/worker.ts`；型別位於 `src/contracts.ts`

## 記憶體與對外傳遞

| 位置 | 實際資料流 |
|---|---|
| 瀏覽器 | 麥克風直接經 WebRTC 傳至提供者；掛斷關閉音軌，程式沒有 MediaRecorder、音檔下載或 localStorage 寫入 |
| MemberRoom 記憶體 | sideband socket、尚未確認播放完成的回答及轉寫等待狀態；插話時取回的 PCM 依可信截斷點裁切，轉寫成功、失敗或逾時即清除，未寫入 SQLite |
| 服務呼叫記憶體 | 登入 Cookie、Authorization、OpenAI 金鑰與短效憑證供當次後端請求使用；個人 MCP bearer 只在 AuthVault 解密及呼叫，其他模組使用授權識別值 |
| OpenAI | Realtime 音訊及設定；文件請求包含逐字稿、工具內容及缺失識別值，設定 `store: false` |
| MCP | 個別會員 Bearer 與允許工具的參數 |
| 交付 adapter | 該筆工作、核對證據、會員驗證後才能開啟的成果連結；資料範圍見 `src/contracts.ts` |

登入與授權資料不包含通話正文，OAuth 密文使用獨立金鑰與會員／用途驗證資料。正式外送範圍與提供者保存政策見下方抽查紀錄

## 紀錄與測試產物抽查

- `wrangler.jsonc` 的 observability 關閉，`src/` 與 `public/` 沒有 console 紀錄通話或權杖
- `.gitignore` 排除 `.wrangler/`、`dist/`、`test-results/`、`.dev.vars*` 與 `.env*`，只保留空白設定範例
- `docs/examples/handoff-consultation.json` 與測試 fixture 使用合成會員及合成對話，可由 `npm run example:handoff` 重建
- `test/storage.test.ts` 於真實 SQLite DO 跑完整文字、工具、四類文件、Email 與 LINE 待交付工作；全程檢查 Store 寫入未包含測試 SDP、音訊欄位、權杖或 LINE 原碼
- 同一測試在到期前 1 毫秒確認四類文件可讀，到期後執行 alarm，檢查清單與直接讀取拒絕，SQLite 中正文、工具副本、交付地址與碼雜湊均已移除，只留下操作重放識別值

## 2026-11-05 實際儲存與正式設定抽查

設定版號為正式 source `41b7231d9ca3345d688bb41598ac3da80c7237b1`、Cloudflare version `663f8503-6e3f-4f7b-89ee-c562b47eab66`，migration v2

| 抽查 | 實際結果 |
|---|---|
| 合成會員的實際語音與插話 | Native Workers SQLite 的兩個實際 OpenAI 語音案例各留 1 筆通話，均無 audio 欄位、SDP、權杖或正式 key；A 可讀，B 與匿名拒絕 |
| 完整資料生命週期 | 重新執行 storage 與 retention 共 4 項通過；正常通話、工具、四類文件及 Email／LINE 待交付資料集中於會員 call:，期前可讀、到期清除後全列無正文及衍生資料 |
| 儲存查詢 | 測試以 state.storage.list() 讀取全部真實 SQLite KV 列；逐字正文只出現於該筆 call:，原音、事件 token、SDP、MCP bearer 與 LINE 原碼於全程 writes 均未出現 |
| 正式紀錄出口 | Cloudflare script-settings 回 logpush:false、tail_consumers:null、observability:null，原值均保存；部署只有既有 DO、Assets、環境及 secret bindings |
| 程式紀錄內容 | 瀏覽器只記錄發證欄位及型別等邊界資訊，後端掛斷拒絕只記錄 HTTP status；均不輸出通話正文或憑證 |
| Repo 與測試產物 | 75 個 Git 追蹤檔無正式 secret 或三位正式測試會員聯絡資料的精確值，無影音檔；公開語音、文件與交接樣本均為合成測試資料 |

正式紀錄設定由 [Cloudflare Get Worker Script Settings](https://developers.cloudflare.com/api/typescript/resources/workers/subresources/scripts/subresources/settings/methods/get/) 的 GET 端點唯讀取得，未更改設定

Realtime 音訊與插話前綴轉寫交給 OpenAI，文件請求使用 store:false；依 [OpenAI Data controls](https://developers.openai.com/api/docs/guides/your-data)，Realtime 的 application state 為 None，濫用監控預設最長 30 天並有官方所列例外。組織個別保存覆寫設定記為 null，沒有已取得的覆寫證據

MCP 收到會員授權與模型產生的方法參數，參數可能包含模型帶入的對話文字；ECCAL 僅收到登入與用量事件；正式版沒有 DELIVERY binding，尚未對 Email 或 LINE 寄送本產品成果

設定原始值、SHA、儲存查詢及到期前後證據見 [儲存抽查 JSON](examples/storage-validation-2026-11-05.json)
