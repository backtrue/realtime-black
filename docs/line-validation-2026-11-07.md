# LINE 正式交付驗收

驗證期間：台灣時間 2026-11-06 至 2026-11-07

依 [Issue #24](https://github.com/backtrue/realtime-black/issues/24) 執行，官方帳號為使用者指定的 ToldYou 報數據（@791vlxya）

## 發布版本與資料保留

- 語音站來源 `8e6c9bf026029b2a9a9b415f27fe625aefa0c93c` 已推上 main，Cloudflare version `8eb29b39-728f-40ad-bf9c-d7a9d64547e3`、deployment `b97a22af-0c59-4b71-a37d-80325aa13315` 為 100% 流量，正式 app.js 與來源相同
- ECCAL 來源 `d0558cad60a87bcd34ccc6c68fd89a2a0ee66c70` 已推上既有 codex/thinkwithblack-mcp-auth 分支，Replit Git 拉取後 Republish 成功；發布控制項為 Live，新發布紀錄 `2977a46` 的 parent 為 d0558ca、0 changed files
- ECCAL 核對頁、待辦登記、核對與結果登記均經正式會員路徑操作
- 正式資料庫發布前完成 3,778,748 bytes 全庫備份，權限 0600；發布前後 63 張 public 表的筆數與逐列內容摘要相同，沒有缺表
- 本次來源沒有 schema、migration、套件或環境變數變更

資料摘要、備份與版本見 [去識別驗證 JSON](examples/line-validation-2026-11-07.json)

## 實際交付

兩個隔離的 ECCAL 測試帳號 A、B 由同一位使用者控制，領取碼由其已加入官方帳號的同一個 LINE 帳號主動傳入。每筆待辦分別核對會員、代碼與目前聊天室，並各自核銷

| 案例 | 正式結果 |
| --- | --- |
| A 的既有 MK-453 報告 | LINE 網頁後台 23:44 送出，顯示已讀，桌面 LINE 實收同一成果連結；ECCAL 記為成功並核銷 |
| B 從本人通話紀錄產生報告 | LINE 網頁後台 23:56 送出，顯示已讀，桌面 LINE 實收同一成果連結；ECCAL 記為成功並核銷 |
| 錯碼與錯聊天室 | 正式核對頁拒絕，不回傳成果連結 |
| 把 A 的領取碼填入 B 的待辦 | 拒絕，不回傳成果連結 |
| 成功領取後再用相同碼 | A、B 均回 409 DELIVERY_ALREADY_ATTEMPTED |
| 原送出結果完整重送 | A、B 均回 200，原結果不變；修改收據重送為 409 |
| B 讀取 A、A 讀取 B 的紀錄 | 兩方向皆回 RECORD_NOT_FOUND，本人的成果連結可開啟 |

A 的剩餘額度仍為 298 秒，B 為 0 秒；領取與閱讀既有成果未扣通話秒數

## 無法傳送案例

另建一筆 B 的測試待辦，會員主動傳入第三組領取碼並完成核對。結束該測試聊天室的暫時手動聊天後，LINE 停用訊息輸入框，這筆成果未送出

ECCAL 以實際觀察記為 failed，保存畫面雜湊與原因，沒有成功收據、核銷時間或可再次取得的成果連結；重新核對回 409。原本兩筆實收紀錄仍為 succeeded

獨立審查發現錯碼與錯聊天室的公開截圖裁切範圍未包含錯誤文字後，另以 A 的測試待辦補留原始 HTTP 回應與當下畫面。兩案均為 403、no-store、voice-line-v1，回應分別為 CLAIM_INVALID、RECIPIENT_UNVERIFIED；待辦前後同為 pending，沒有成果連結且內容不變。補證後同樣因 LINE 輸入停用而記為 failed，未再次送出成果；最終為兩筆成功、兩筆受控失敗，沒有未處理測試待辦

結果待確認案例使用實際 Express HTTP、Workers RPC／SQLite 的合成整合測試，unknown 狀態不會記為成功或核銷

官方帳號聊天開啟，使用「手動聊天＋自動回應訊息」，Webhook 關閉、歡迎訊息開啟；測試聊天室的暫時手動聊天已結束

## 檢查與證據

- 語音站 `npm run check`：188 Workers、26 前端、3 原生測試，以及型別與部署預演通過
- ECCAL：型別、建置與 43 項相關回歸通過，包含 8 項 LINE 原生契約測試
- fresh 候選審查 PASS，獨立重跑 Workers 30、前端 26、ECCAL 原生 8 項通過
- 領取建立回應遺失後，同一操作可恢復同一筆待辦與代碼，持久層保留代碼雜湊
- 正式送出、實收與核對畫面以受限檔案保存；公開索引使用會員 A／B、結果與證據 SHA-256

2026-11-07 fresh spec_evaluator `line_published_acceptance` 獨立驗收 PASS，確認 #24 可結案。正式唯讀清單與保存證據一致，兩筆 succeeded／claimed、兩筆 failed／unclaimed，沒有 pending、sending 或 unknown 待辦；公開與受限證據 SHA 均相符

[操作流程](line-delivery.md) · [驗證 JSON 與畫面索引](examples/line-validation-2026-11-07.json)
