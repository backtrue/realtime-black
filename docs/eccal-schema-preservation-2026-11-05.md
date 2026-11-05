# ECCAL 發布刪表修正與資料保留

日期：2026-11-05

App 為 [ECCAL](https://eccal.thinkwithblack.com)，Replit app ID 為 `629e49c6-8dc3-42cd-b86c-d35b18e038dd`，repository 為 backtrue/eccal-new，沿用 codex/thinkwithblack-mcp-auth 分支

## 原因與修正

正式庫有四張語音表，開發庫缺少這四張表。Replit 發布會直接比對兩邊資料庫，因此原本產生刪除正式語音表的 migration；該次發布已取消

現有 source 與 0004／0005 migration 已定義四表。這次新增的保留資料工具只執行既有 `CREATE TABLE IF NOT EXISTS` 與索引 SQL，先備份、核對所有既有 public 表資料，再用交易補齊開發庫，並逐表比對正式結構摘要

來源：[Replit 發布資料庫變更](https://docs.replit.com/features/data-and-storage/publish-database-changes) · [ECCAL 修正提交](https://github.com/backtrue/eccal-new/commit/2e841c427d63053b87be999275740bbcb58ae1f2)

## 備份與資料核對

正式庫以唯讀連線完成 3,777,878 bytes 全庫備份，權限為 0600；備份已在本機獨立測試庫成功還原，還原出的 63 張 public 表可讀，四張語音表筆數一致，測試庫已清理

開發庫連線限 Replit 內部使用。使用者先核准唯讀取得連線資訊，再明確核准本次在 Replit Shell 執行補表與資料核對；其餘程式、測試與正式查核仍在 Replit 外進行

開發庫補齊四表後，原有 59 張表的整體資料摘要前後同為 `79435c60ee9e1b8d3e70d0a9bbd5fe10f90db395bc4c4d7cba583576f7381d15`。新增結構與正式庫摘要一致

正式發布前後，全部 63 張 public 表的筆數與逐列內容摘要完全相同，沒有缺表或資料變更。整體 SHA-256 前後同為 `1661b393b7f6e169d4e82751d6d3f328cc6e78d62f7db1362353378cf6bbf0e3`

| 正式資料表 | 發布前 | 發布後 |
|---|---:|---:|
| voice_quotas | 3 | 3 |
| voice_reservations | 17 | 17 |
| voice_login_codes | 1 | 1 |
| voice_sessions | 4 | 4 |

## 測試、同步與發布

- 保留資料工具的 7 項本機測試、語法檢查與 diff 檢查通過，fresh spec_evaluator 已獨立驗收 PASS
- 實際正式結構摘要在本機獨立測試庫套用兩份 migration 成功，既有資料不變
- 修正提交 `2e841c427d63053b87be999275740bbcb58ae1f2` 已推上原分支並由 Replit Git 拉取
- Republish 成功，沒有出現原本的四表刪除核准要求，發布控制項顯示 Live
- 新發布紀錄為 `059dd26d4963b5e2afed2a6573fd35a8efe3657c`，parent 為 2e841c4，0 changed files；build ID 為 `90c09a5f-6346-46bd-9470-d1f26fe37b93`，發布紀錄時間為台灣時間 2026-11-05 22:46:47
- 該發布紀錄已由 Replit Git 推上 GitHub，GitHub、Replit 與本機均為 059dd26

發布工具回傳的 deployment ID 沿用 `03b7e1a3-4217-445c-abab-8ac828d50890`；本次新發布依據為完整發布流程、Live 時間更新，以及新 build／發布提交

## 正式路徑讀回

ECCAL 首頁 200；匿名內部身分查核 200／null，契約為 eccal-voice-v1，回應為 no-store

語音站完整重新整理後，既有會員仍登入、餘額 0 秒、12 筆通話紀錄可讀。展開既有「轉換率診斷方法與第一個查核數字」摘要，MK-453 方法資料與既有內容正常顯示

去識別結果見 [驗證 JSON](examples/eccal-schema-preservation-2026-11-05.json)。#29 的正式短通話仍需可用測試額度；#23／#24 的實收流程依 D4／D5 接續處理
