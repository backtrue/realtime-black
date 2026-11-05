# ECCAL 測試同步與發布結果

日期：2026-11-05

App 為 [eccal](https://replit.com/@backtrue/eccal)，ID `629e49c6-8dc3-42cd-b86c-d35b18e038dd`，repository 為 backtrue/eccal-new，分支 codex/thinkwithblack-mcp-auth

## Git 同步

本機完成驗收後，兩份測試以 `4ea45881d8e99651361415ef12d3c247fc7f0b89` 推上原分支。Replit Git 顯示無未提交修改，拉取後保留原本沒有檔案差異的發布紀錄，形成 `351b2e56bf05da6b03c946b0eb0408ae3db51248`，parent 為 4ea4588

經 Git 控制項推送後，GitHub 與本機讀回同一 351b2e5，tree 與 4ea4588 完全相同。正式程式及 schema 沿用原檔，增量為發證／並行驗收與舊工具 fixture 更新

## 本次 Republish 已取消

Replit 發布工具回傳 INVALID_ARGUMENT，要求從網站確認資料庫差異。網站 Republish 在 Provision 階段停下，準備執行以下 DROP：

| 資料表 | 發布預覽列出的資料筆數 |
|---|---:|
| voice_reservations | 17 |
| voice_quotas | 3 |
| voice_login_codes | 1 |
| voice_sessions | 4 |

未核准該 migration，已按 Cancel。發布控制項讀回 Build canceled、Current status Live，既有正式 deployment 為 `03b7e1a3-4217-445c-abab-8ac828d50890`

## Replit 外的正式讀回

- ECCAL 首頁為 200
- 使用既有後端服務憑證呼叫匿名身分查核，回 200／null，契約為 eccal-voice-v1
- 語音站既有會員仍登入、餘額 0 秒、12 筆通話紀錄可讀，沒有個人 MCP 授權按鈕

Git、發布取消與正式讀回的去識別結果見 [驗證 JSON](examples/replit-sync-validation-2026-11-05.json)

## 發布阻礙

本機目前可用的專案設定未提供該 Replit 開發資料庫連線。依 [replit-project-work](/Users/backtrue/.codex/skills/replit-project-work/SKILL.md)「Do project work locally」，資料庫差異須在 Replit 外核對；取得開發資料庫的受控連線後，核對既有 0004／0005 語音表，再讓發布差異保留這四張表
