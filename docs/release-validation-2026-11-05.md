# 2026-11-05 提交與正式環境驗證

依據：[產品規格 V0.3](product-spec.md)、Issue #1、#3、#10、#12、#21，以及使用者本次提交、推送、ECCAL 同步發布與正式驗證指示

## GitHub 讀回

| Repository | 分支 | 實作提交 | 遠端讀回 |
|---|---|---|---|
| realtime-black | main | `e0845c7c44958c50bbb52651a8dc4fbe05d1c404` | 相同 SHA |
| eccal-new | codex/thinkwithblack-mcp-auth | `be31e6ee81bce7e27caab4ca42b6535ec610a868` | 發布後為 `2702955844df9d30947ca49448f8f04e6dfe1055`，與實作提交的 tree 相同 |
| thinkwithblack-mcp | main | `b22a53501e021c4b20acc2c2072e76cba90a09fb` | 相同 SHA |

ECCAL 候選從遠端 `a7af3d2` 加入 20 個語音額度／登入檔案與必要增量，保留遠端新增的 dashboard schema。原工作目錄的付款、試用方案及其他頁面修改保留在原處

MCP 候選從正式 main `4a00d964` 加入七個授權檔案與 `scripts/verify-scope.mjs` 的兩項精確 allowlist。保留正式 main 的既有工具、方法與儲存設定

## 發布候選驗證

| 範圍 | 已執行結果 |
|---|---|
| realtime-black | `npm run check`：型別、133 項 Workers、8 項前端、三個 DO dry-run 建置通過；50 個 repo 檔案 secretlint 通過 |
| ECCAL | 型別、17 項語音帳本、1 項額度跨 repo、8 項登入、2 項三 repo MCP、前後端建置、指定檔案 secretlint 通過 |
| MCP | 安裝、scope 1811 個路徑、來源查核、型別、44 個檔案共 2393 項測試、全庫 secretlint、dry-run 建置通過 |
| Fresh spec_evaluator | 三個 Git 候選的程式、差異範圍與本機驗證通過；整體 NEEDS_WORK，正式 migration、設定及真實會員驗收待完成 |

## MCP 正式發布

使用既有 `scripts/deploy-production.mjs b22a53501e021c4b20acc2c2072e76cba90a09fb`，從乾淨且與當時遠端 main 相同的候選發布

- Cloudflare deployment：`7b0767d0-8e7a-4676-9f41-fa16246250a8`
- Cloudflare version：`62a5c92a-21f4-4736-a390-7fe5016f33ac`，100% 流量
- 提供者時間：`2026-11-04T16:22:40.821259Z`，台灣時間 2026-11-05 00:22
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
| `GET /api/voice/login` | 503 | `X-Voice-Contract: eccal-voice-v1`、`VOICE_LOGIN_NOT_CONFIGURED` |
| `POST /api/voice/internal/authenticate`，空登入資料且不帶服務憑證 | 503 | `X-Voice-Contract: eccal-voice-v1`、`VOICE_NOT_CONFIGURED` |

新路由已在正式版本生效，語音登入 origin／服務專用設定尚未完成

本次發布另產生 0 檔案變更的 `2702955 Published your App`，父提交為 `22f2f16`。已經 Git control 推送，外部 Git 讀回確認 tree 仍與 `be31e6e` 相同，Replit control 再次顯示同步完成

## 正式 migration 與會員驗證前置

目前兩個本機 ECCAL checkout 與執行環境沒有正式 PostgreSQL 連線設定；語音站正式 origin 尚未指定，`APP_ORIGIN` 範例維持本機網址

已向使用者詢問正式語音網址與 Replit 外的正式資料庫連線設定位置。依指定 `replit-project-work`，Replit 內只操作 Git 同步／拉取及 Republish，資料庫與環境設定在 Replit 外處理

待取得上述位置後，依序套用並讀回 `0004_voice_quotas.sql`、`0005_voice_login.sql`，核對兩邊的語音專用設定，完成語音站發布，再以真實會員驗證跨站登入、MCP 同意、兩會員隔離、解除授權及成果連結轉傳拒絕
