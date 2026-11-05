# realtime-black

「打電話給小黑」：提供 ECCAL 會員使用的網頁即時語音行銷顧問。

## 專案邊界

- 本 repository：網頁通話體驗、OpenAI Realtime 連線、ECCAL 會員驗證與使用額度、通話成果及交付流程。
- [thinkwithblack-mcp](https://github.com/backtrue/thinkwithblack-mcp)：既有行銷 Skills 與 MCP 工具。AI 小黑透過後端服務綁定預設讀取共用行銷方法，會員登入 ECCAL 即可使用；方法原文持續由 MCP 提供

## 產品決策

- 只開放 ECCAL 會員；每位會員合計免費 5 分鐘，未來可加購分鐘數。
- 第一階段為網頁一鍵通話；AI 依 ThinkWithBlack MCP 方法進行顧問式追問、診斷與策略建議。
- 產出行銷報告、文案、改善計畫，提供 Email 或「報數據」LINE 官方帳號交付。
- LINE 第一版以會員提供領取碼、經核對後由 Codex 協助操作官方帳號網頁後台發送；不使用 Messaging API Push。
- 逐字稿及摘要保存 30 天；商業匯出下載另外計費（細節待定）。
- 真人交接進 ECCAL 後台；一般會員外部廣告與搜尋分析資料串接留待第三階段。
- 本人聲音複製服務尚未選定，須確定權限、音色與延遲後再接入。

## 第一階段架構方向

瀏覽器 WebRTC ↔ OpenAI Realtime API；Cloudflare Worker 負責驗證 ECCAL 會員、控管分鐘數、發放短效 Realtime 憑證及協調工具；行銷方法由 ThinkWithBlack MCP 的內部 CallMethods 入口提供，語音站不要求會員另行授權 MCP，永久金鑰留在後端

詳見 [產品規格](docs/product-spec.md) 與 [架構及整合邊界](docs/architecture.md)。

## 開發任務與驗收

[完整開發任務與驗收清單](docs/development-plan.md) 收錄 38 項任務、各項驗收條件及 10 個待確認事項。可從任務編號開啟對應的 [GitHub Issue](https://github.com/backtrue/realtime-black/issues)，查進度、登記實測結果及驗收證據。

## 目前狀態

已新增 Cloudflare Worker、WebRTC 通話頁、會員通話協調、獨立後端掛斷、MCP 工具呼叫、紀錄保存與成果產出程式，以及 Workers runtime 測試。跨站 ECCAL 登入與本站會話已實作。2026-11-05 依使用者確認，AI 小黑預設使用 ThinkWithBlack MCP，共用方法改由內部服務提供，會員流程只有 ECCAL 登入；原個人 OAuth 實作與驗收列於歷史紀錄

語音站與 MCP 的內建共用方法更新已提交、推上 GitHub 並正式發布。[正式語音入口](https://call.thinkwithblack.com) 的會員登入後直接使用方法，首頁已移除個人 MCP 授權及解除按鈕；正式 Service Binding、方法全文與私人工具拒絕已核對，見 [內建方法驗證](docs/default-methods-validation-2026-11-05.md)

ECCAL 正式 migration、語音設定與 Google 跨站登入已通過。OpenAI 專用受限金鑰與語音／文字模型已部署，使用者已確認語音回覆、插話及追問正常；先前真實同通 MK-453 全文、語音應用與正常掛斷均已對照，正式發證憑證邊界已通過 Issue #2 驗收。拒絕麥克風的人工實測依使用者指示取消；交付通路與本人音色待驗證，歷次版本與讀回見 [正式環境驗證](docs/release-validation-2026-11-05.md)。逐項進度見 [Issue 實作與驗證紀錄](docs/implementation-status.md)，執行與設定見 [本機執行與串接](docs/runtime-integration.md)

**安全注意：此 repository 是 Public。禁止提交 API Key、OAuth Token、Email、LINE 使用者資訊、諮詢內容及其他會員資料。**
