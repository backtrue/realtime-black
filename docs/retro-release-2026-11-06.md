# 復古轉盤正式發布與測試補額

日期：2026-11-06

[正式入口](https://call.thinkwithblack.com) 已發布「復古轉盤」，中央點按或順時針轉動可進入既有會員語音流程

## 提交與正式版本

| 項目 | 實際版本 |
|---|---|
| Repository／分支 | backtrue/realtime-black／main |
| 功能提交 | `6d5863307b7b0021ccc04e463418059f6277d49d` |
| 發布來源 | `b647abccbd5ddcff0387c33b2b41179217450cab`，只另修正驗證 log 尾端空白 |
| Cloudflare version | `a919d0dd-99d6-4de1-b2a9-f1c996eed5cd` |
| Cloudflare deployment | `14919548-0124-49db-ab82-388411436bfd` |
| 正式流量 | 100% |
| ECCAL 現有發布 | `17020ceff127dec9ab4d773d2705878888b80b91`，build `10ddb496-0e38-497a-bc9e-155cc77634e0` |

`/`、`/app.js`、`/style.css` 均為 200／no-store，正式內容與發布來源逐位元組相同，CSP 維持現有設定。三個檔案 SHA-256、發布時間及版本見 [結構化結果](examples/retro-release-2026-11-06.json)

本機驗收為型別檢查、179 Workers、25 前端、3 原生連線測試與 Wrangler dry-run 全數通過，fresh spec_evaluator 判定 PASS，逐項交接驗收見 [復古轉盤驗收](design/dialer-validation.md)

需要回復前一版時，既有 Email 正式版本為 `ac2518ba-4681-4111-ab28-46d71f1293a2`，可執行 `npx wrangler rollback ac2518ba-4681-4111-ab28-46d71f1293a2 --message "Return to prior Email release"`

## 本版獨立重建與回復演練

從本次正式來源 `b647abc` 的獨立 git archive 執行 npm ci，Wrangler 4.157.0 兩次建置的 bundle SHA-256 同為 `a434244906640e13f664a3f64915fb3bebe6bff33f3d952223165dc8ad805f88`，與本機已發布來源的 bundle 相同

在獨立測試 Worker 發布復古候選，再發布既有 Email source `11197d0`，最後 rollback 回復古候選。候選與回復後 version 均為 `5b4359b4-2c69-4cd7-add2-2afcad739905`，程式 ETag 與正式版相同，三階段九項 HTML／JS／CSS 均為 200／no-store 且與各自來源逐位元組相符

測試使用三個獨立 DO namespace，與正式 namespace 交集為 0，沒有 secret、服務綁定或正式 route。測試 Worker 已移除並讀回 404，暫存來源已清理；正式 deployment／version 與 100% 流量在演練前後相同

本次使用的 [隔離測試設定](examples/retro-rehearsal-2026-11-06-config.json)保留同版 classes、migration v2 與 assets，啟用獨立 workers.dev，ECCAL_ORIGIN 為空、APP_ORIGIN 為測試值。執行步驟為獨立 archive 的 `npm ci`、兩次 `npm run build`、`wrangler deploy --tag b647abc`、以相同測試設定發布 `11197d0`、`wrangler rollback 5b4359b4-2c69-4cd7-add2-2afcad739905 --yes`，最後 `wrangler delete <testWorker> --force` 並核對 Worker 設定 API 為 404

首輪公開檔案斷言失敗，當時未保存具體回應；首輪測試 Worker 已移除，正式服務未變。加入逐回應記錄後，第二輪完整演練通過，兩輪結果與各階段版本見 [本版演練證據](examples/retro-rehearsal-2026-11-06.json)

本版亦以真實 ECCAL Express／本機 PostgreSQL、原生 Worker／MemberRoom／SQLite 完成 2 項發證及最後一秒搶用回歸，0 failed、0 skipped，測試 schema 與 runtime 已清理，見 [本版原生驗證](examples/retro-native-gate-2026-11-06.json)

## 正式會員畫面與單次補額

正式入口的既有會員登入、零額度禁用、12 筆既有紀錄及已寄送報告均可讀取。既有 68 秒通話的本人 API 回應，usage 為 68 秒、audioStarted 為 true、waitingForTool 為 false，與原始結算 68 秒相同

三位測試會員原本皆剩 0 秒。依使用者「你幫我補足」核准，本次對目前登入的測試會員 A 補回 300 秒，調整收據為 `retro-dialer-test-credit-20261106-A`。既有總額欄位維持 300 秒，當前額度使用計數由 300 降至 0；原始通話占用、扣秒與結算收據完整保留，這次補額另留 prepared／committed 收據

執行前完成全庫 3,777,881 bytes、0600 備份，使用相同 PostgreSQL snapshot 在本機還原，63 張 public 表的筆數及內容摘要全部相同。備份 SHA-256 為 `30be7698ec1affb68123d5e7947bfb8677250b9fdd8d0248a46665faa30be7bb`，測試還原庫已清理

補額在 Replit 外以單次交易執行，核對固定會員、Email、預期帳目、無進行中通話及同會員列鎖，再以 guarded update 更新一列。交易前後核對其他會員及全部資料表，只變更目標額度計數；其餘 62 表包含所有 voice_reservations 的筆數與內容摘要均相同。ECCAL source、schema 與 Replit 發布版本維持現有版本

本機 5 項補額驗證與 fresh spec_evaluator 執行前、執行後核對均 PASS。正式 ECCAL balance 回應 200／eccal-voice-v1／no-store，剩餘 300 秒，完整重新整理首頁後顯示 05:00 且中央撥號可用

![正式會員補額後](examples/retro-release-2026-11-06/member-refilled.png)

## 新通話驗收

正式會員已有一通新紀錄：台灣時間 19:18:47 建立、19:18:54 結束，總經過時間 6.617 秒，服務端音訊計時與 ECCAL 均扣 2 秒，剩餘 298 秒。只有一筆新占用，原始結算累計為 302 秒，扣除本次 300 秒測試 credit 後，當前額度使用計數為 2 秒，帳目一致；另外兩位會員仍為 0 秒

結束畫面顯示本次使用 00:02，首頁顯示 04:58，紀錄增為 13 筆。使用者於 2026-11-06 確認「有聽到回答，已掛斷」。這通逐字稿為 0 段、語音辨識失敗 1 段、成果為 0 份，原始結果完整保留

同一正式版登入會員的紀錄面板，可展開既有「轉換率診斷方法與首要查核數字」報告，MK-453 方法、查核建議與 Email 已送出狀態正常顯示，完成成果存取抽查

![新通話後剩餘額度](examples/retro-release-2026-11-06/member-after-short-call.png)

![正式會員成果存取](examples/retro-release-2026-11-06/final-owner-report.png)

## 獨立驗收與 Issue 狀態

fresh spec_evaluator 判定本次正式發布驗證與 #29 自身的發布、短通話、額度、成果存取條件全部 PASS。最新正式唯讀對帳為 298 秒、未結算占用 0，其他會員不變

[G1-03](development-plan.md#g1-03) 明列前置 G1-02，#28 仍等待 #27 的兩會員 Email／LINE 全流程，因此本次結案判定為 NEEDS_WORK，#29 保持開啟。#24 的兩個可用官方帳號已核對管理權限，等待使用者指定「ToldYou 報數據」或「報數據2.0」後接續領取碼與交付驗收

剩餘 Issue 的自動驗證及待決項見 [實作狀態](implementation-status.md)：#6 待兩分頁與兩台實際裝置，#13 待本人教學口吻試聽，#24／#27 待指定 LINE 官方帳號與實收，#30 後續待本人聲音、付費與資料來源契約
