# realtime-black

「打電話給小黑」：提供 ECCAL 會員使用的網頁即時語音行銷顧問。

## 專案邊界

- 本 repository：網頁通話體驗、OpenAI Realtime 連線、ECCAL 會員驗證與使用額度、通話成果及交付流程。
- [thinkwithblack-mcp](https://github.com/backtrue/thinkwithblack-mcp)：既有行銷 Skills、MCP 工具與會員授權邏輯。語音產品以受權會員身分呼叫，**不在此複製既有行銷方法**。

## 產品決策

- 只開放 ECCAL 會員；每位會員合計免費 5 分鐘，未來可加購分鐘數。
- 第一階段為網頁一鍵通話；AI 依 ThinkWithBlack MCP 方法進行顧問式追問、診斷與策略建議。
- 產出行銷報告、文案、改善計畫，提供 Email 或「報數據」LINE 官方帳號交付。
- LINE 第一版以會員提供領取碼、經核對後由 Codex 協助操作官方帳號網頁後台發送；不使用 Messaging API Push。
- 逐字稿及摘要保存 30 天；商業匯出下載另外計費（細節待定）。
- 真人交接進 ECCAL 後台；一般會員外部廣告與搜尋分析資料串接留待第三階段。
- 本人聲音複製服務尚未選定，須確定權限、音色與延遲後再接入。

## 第一階段架構方向

瀏覽器 WebRTC ↔ OpenAI Realtime API；Cloudflare Worker 負責驗證 ECCAL 會員、控管分鐘數、發放短效 Realtime 憑證及協調工具授權；行銷方法由現有 ThinkWithBlack MCP 提供。永久 API 金鑰與個別會員的 MCP 授權資料不得放入瀏覽器程式。

詳見 [產品規格](docs/product-spec.md) 與 [架構及整合邊界](docs/architecture.md)。

## 目前狀態

已建立規格與整合設計；尚未完成實際通話、ECCAL 串接、聲音複製或 Cloudflare 部署。

**安全注意：此 repository 是 Public。禁止提交 API Key、OAuth Token、Email、LINE 使用者資訊、諮詢內容及其他會員資料。**
