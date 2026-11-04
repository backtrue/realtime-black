# M0-01 ECCAL 串接查核

查核日期：2026-11-04

任務：[Issue #1 核定 ECCAL 串接契約](https://github.com/backtrue/realtime-black/issues/1)

## 已查得的介面

來源為既有 ThinkWithBlack MCP 的 [ECCAL 契約](https://github.com/backtrue/thinkwithblack-mcp/blob/main/src/eccal/contracts.ts)與 [ECCAL 呼叫實作](https://github.com/backtrue/thinkwithblack-mcp/blob/main/src/eccal/client.ts)

| 項目 | 查得內容 |
|---|---|
| ECCAL 來源 | `https://eccal.thinkwithblack.com` |
| 身分交換 | `POST /api/mcp/internal/exchange`，傳入 `code`、`login_state`、`audience`，成功取得 `user_id` |
| 現有 audience | 契約限定 `https://mcp.thinkwithblack.com/mcp` |
| 會員查詢 | `POST /api/mcp/internal/membership`，由後端傳入 `user_id`，回傳會員等級、會員期限、`credits`、選填課程購買狀態與查核時間 |
| 呼叫授權 | ECCAL 服務權杖由後端透過 Authorization 標頭傳送 |
| 回應身分核對 | 會員查詢回傳的 `user_id` 須與請求一致 |

查核時的 GitHub 檔案 blob：`contracts.ts` 為 `a1c9209892edfaa66541c69f3eab096f542d7b6e`，`client.ts` 為 `65b475121a935b23f74f3def6cd2ad2f4d860adf`

## M0-01 初次查核的契約缺口與本機實作

| 待取得項目 | 對應驗收 |
|---|---|
| realtime-black 的登入交換、audience 與回呼設定 | 已有一次性碼、origin／瀏覽器綁定與本站會話；正式設定待套用 |
| 語音通話資格的判定規則 | 本機按現有 ECCAL 會員及 300 秒語音餘額驗證 |
| 可用語音秒數、占用及結算介面 | 已有 PostgreSQL 權威帳本與跨 repo HTTP 對帳 |
| 專用測試環境與有效、失效、無資格身分 | 合成會員的實際 PostgreSQL／HTTP 測試通過，正式測試身分待提供 |

既有 MCP 契約沒有定義語音秒數，`credits` 維持原本點數用途。本機已新增獨立的 `eccal-voice-v1` 語音額度契約與 PostgreSQL 帳本，實作及驗證見 [語音額度驗證紀錄](eccal-voice-validation-2026-11-04.md)

## 第一批既有程式的位置

[開發清單](development-plan.md)第 28～30 行及 Issue #1～#4 記載已有本機版本

本次同步到 `e7e77a360b8ca4f95f95ea9d82d70affcf85beda` 後，realtime-black 的 main 包含 README、產品規格、架構及開發清單四份文件；`git ls-remote --heads --tags origin` 只有 main，GitHub PR 查詢沒有結果

使用者已指示依 Issue 直接實作，目前本機程式與測試的逐項狀態見 [Issue 實作與驗證紀錄](implementation-status.md)

## ECCAL 本機來源讀回

使用者指定 ECCAL 位於 Replit，相關工作依 `replit-project-work` 執行

| 項目 | 2026-11-04 讀回結果 |
|---|---|
| 本機 checkout | `/Users/backtrue/Documents/eccal-new` |
| Git remote | `https://github.com/backtrue/eccal-new.git` |
| 本機分支 | `codex/thinkwithblack-mcp-auth` |
| 本機 HEAD | `e5c07f209cb1a23e7c8bc80b13a093ed66c948f9` |
| 對應遠端分支 HEAD | `a7af3d28f199cc5227806d6a368bf313a01b0f4b` |
| GitHub main HEAD | `6b10adbc0d720448d2100e6e82396730d659ead8` |
| 工作目錄 | 有未提交的付款、試用、會員權限及頁面修改 |
| Replit 當下 workspace 分支與已發布版本 | 待核對 |

### 已讀取的 ECCAL 介面

- `server/jwtAuth.ts` 定義 `/api/auth/user`，使用 JWT middleware 與 `auth_token` cookie
- `server/mcpAuthRoutes.ts` 定義既有 MCP 登入、身分交換、會員及帳號狀態介面，回呼固定為 `https://mcp.thinkwithblack.com/oauth/eccal/callback`
- 本機未提交的 `server/mcpAuthService.ts` 修改會改用包含付費及試用資格的會員 snapshot
- 本機未提交的 `shared/mcpTrial.ts` 定義 168 小時的 MCP 試用，與 realtime-black 的 300 秒語音額度是不同資料

本機新增 `server/voiceQuotaRoutes.ts`，提供後端身分核對、可用秒數、原子占用、冪等結算及本人餘額查詢；`server/voiceLoginRoutes.ts` 提供一次性跨站登入交換、本站會話撤銷與個人 MCP 帳號核對。realtime-black 已有對應 adapter 與 AuthVault，跨 repo PostgreSQL／OAuth Provider 測試通過。正式 migration、設定、MCP scope 發布與真實瀏覽器同意待執行，見 [登入與授權驗證](auth-validation-2026-11-04.md)
