# realtime-black｜技術架構與整合邊界

更新日：2026-11-04。此為設計方向，不代表 API 已接通、會員功能已驗證或服務已部署。

## 1. 系統分工

| 元件 | 職責 | 不承擔 |
|---|---|---|
| 瀏覽器 UI | ECCAL 登入狀態呈現、麥克風授權、一鍵通話、對話狀態、文字顯示 | 永久 API Key、會員 MCP Token、可信額度結算 |
| realtime-black（Cloudflare） | 可信任的會員驗證入口、通話資格與額度、短效憑證、會話與成果儲存協調 | ThinkWithBlack 原有 Skills 的另一份副本 |
| OpenAI Realtime | WebRTC 語音往返、打斷與語音互動、依配置使用工具 | ECCAL 的權威會員資格與額度 |
| thinkwithblack-mcp | 行銷 Skills、既有 MCP 工具及已實作的會員授權 | 網頁通話 UI、音訊服務 |
| ECCAL | 會員身分、使用資格與分鐘額度權威資料、真人顧問交接 | Realtime 影音傳輸 |

## 2. 已確認的主要技術路徑

1. 會員在 ECCAL 登入，從網頁發起通話。
2. Cloudflare 驗證 ECCAL 會員身分、當期可用額度及並行通話狀態。
3. Cloudflare 以伺服器端 OpenAI API Key 申請短效 Realtime 憑證，將必要的通話設定與安全限制綁定該次會話。
4. 瀏覽器持短效憑證透過 WebRTC 與 OpenAI 建立語音連線，不接觸永久金鑰。
5. 模型透過 ThinkWithBlack MCP 工具執行經授權的行銷方法，顧問式追問並提出建議。
6. Cloudflare 在服務端記錄通話用量，產生/保存該會員的逐字稿、摘要和成果交付工作。
7. 通話結束或額度用盡時，必須能由可信的服務端終止或阻止後續計費使用，不能只依賴前端畫面關閉。

OpenAI 官方支援短效憑證、瀏覽器 WebRTC 與遠端 MCP；詳細格式須以實際整合時的現行文件及回傳為準：
- https://developers.openai.com/api/docs/guides/realtime
- https://developers.openai.com/api/docs/guides/realtime-mcp
- https://openai.github.io/openai-agents-js/guides/voice-agents/quickstart/

## 3. 關鍵安全邊界

- 永久 OpenAI Key、ECCAL 服務金鑰及 MCP OAuth 授權資訊僅存在後端環境。
- Realtime MCP 若採官方託管遠端 MCP 執行，授權資訊應在後端建立會話時注入，不能放入前端程式碼。
- 所有 MCP 呼叫必須綁定已驗證的個別 ECCAL 會員身分，不得共用管理者身分。
- 工具允許清單應以第一期閱讀／分析用途為邊界；不能開放未授權的外部寫入。
- 會員的逐字稿、摘要、報告均必須綁定會員 ID 做存取控制。
- API Credit、免費分鐘數、會員資料與 LINE 聊天對象不可互相當作身分驗證依據。
- 不把私有資料或聲音樣本提交到公開 GitHub repo。

## 4. Cloudflare 資料與會話

建議將短效通話會話狀態與總額度結算分開：Cloudflare 負責追蹤連線，ECCAL 作為會員與額度權威系統。持續連線及並發控管可評估 Durable Objects，但是否使用須視 ECCAL 契約、通話控制介面與測試結果決定。

逐字稿與摘要保存 30 天；需設計到期清除與刪除驗證，不得假設物件的預設生命週期等於產品承諾。是否保存音檔尚未決定。

## 5. 工具呼叫注意

OpenAI Realtime MCP 會先匯入遠端工具清單，可能產生 MCP approval request；工具呼叫完成後的後續 response 亦需要按官方事件流程正確續接。不可只測試「能列出工具」就視為顧問能力完成。

參考：https://developers.openai.com/api/docs/guides/realtime-mcp

## 6. 聲音模組

自訂聲音提供者尚未確認。語音輸入、顧問工具、額度與資料管理不得依賴某家聲音複製服務的專屬契約；聲音驗收須包含本人授權、音色相似度、台灣國語與即時對話延遲。

## 7. 工程前置調查

- 向 ECCAL 核對登入驗證方式、可供 realtime-black 呼叫的會員狀態與額度 API。
- 核對現有 MCP OAuth 流程如何在服務端取得「該會員」授權。
- 確認實際 Realtime 會話能由後端可靠終止／結算，處理 5 分鐘總額度及並行連線。
- 實測一場會員語音通話和一個 MCP 工具呼叫，觀察逐字稿、延遲、錯誤與重連。
- 在執行真實的 Email 或 LINE 成果發送之前，明確確認收件人及對應交付權限。

## 8. 非目標

第一期不修改既有 thinkwithblack-mcp 的公開工具契約，不提供一般會員第三方廣告帳號綁定，不假設自動化 LINE 後台可以無人監督發送，不部署正式電話號碼。
