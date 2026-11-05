# AI 小黑內建行銷方法驗證

日期：2026-11-05

依使用者確認，AI 小黑回答行銷問題時，預設就使用 ThinkWithBlack MCP 的共用方法。會員只需登入 ECCAL，不另行綁定、同意或授權 MCP

## 實作與存取範圍

語音站以 MCP_METHODS Service Binding 連到 thinkwithblack-mcp 的 CallMethods entrypoint，提供入口目錄、入口、方法搜尋與方法全文四個工具。方法原文由 MCP 既有套件及 schema 產生，讀取停點與續答內容沿用原函式

開始通話與工具呼叫不再取得個人 MCP grant，首頁移除授權及解除按鈕，登入狀態只核對 ECCAL。MemberRoom 繼續核對會員、資格、額度及紀錄歸屬，模型預設先讀方法再分析

內部方法入口拒絕會員帳戶、私人品牌、GSC／廣告帳戶、外部寫入與額外來源參數。原公開 MCP OAuth 及其工具契約持續沿用；既有授權相容程式與到期清理保留，語音共用方法不依賴個人或管理者 OAuth

## 自動驗證

| 檢查 | 實際結果 |
|---|---|
| 語音站完整檢查 | 型別、169 Workers、14 前端、3 原生連線及 dry-run 通過 |
| MCP 完整檢查 | 2,438 Vitest、46 Python、型別、scope、secretlint 及 dry-run 通過 |
| 與原有 MCP 工具比對 | 四個共用方法的回傳內容與原 OAuth 工具相同 |
| 兩服務原生 RPC 與 SQLite | 兩位受控會員皆回 201，個人 grant 呼叫 0 次 |
| 實際方法讀回 | 兩位均讀到 E03 與 MK-453，全文 18,972 bytes、SHA 相同且逐位元組雜湊核對成功 |
| 會員隔離 | 本人 200、他人 404、匿名 401 |
| 私人來源與寫入 | gsc_query、pause_ad、夾帶 brand_key 的方法請求均拒絕 |
| OpenAI 工具配置 | 實際 OpenAiRealtime.create 組出的四個工具 schema 經 client_secrets API 接受，回 200 |

兩服務原生驗證載入實際語音及 MCP bundle，ECCAL 身分／額度與 Realtime 提供者使用受控 fixture。OpenAI 配置查核不建立提供者通話、不保存短效憑證、不產生音訊。正式會員額度與紀錄未改動

完整回應、模型、版本基準、source／bundle SHA 及 runtime 清理見 [驗證 JSON](examples/default-methods-validation-2026-11-05.json)
