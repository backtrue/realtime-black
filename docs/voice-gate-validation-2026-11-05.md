# 會員發證與最後一秒跨 repo 驗證

日期：2026-11-05

驗收依據為 [Issue #1](https://github.com/backtrue/realtime-black/issues/1)、[Issue #3](https://github.com/backtrue/realtime-black/issues/3) 與 [Issue #6](https://github.com/backtrue/realtime-black/issues/6)

## 來源與環境

語音來源為 `ee533fb2b384597a9af158d0d6988a5cb2dc2bff`，ECCAL 為 `codex/thinkwithblack-mcp-auth` 的 `2702955844df9d30947ca49448f8f04e6dfe1055` 加測試增量。產品程式及 schema 均維持原檔

ECCAL 測試提交 `4ea45881d8e99651361415ef12d3c247fc7f0b89` 已推上原分支；Replit Git 已拉取並保留原發布紀錄，同步後提交為 `351b2e56bf05da6b03c946b0eb0408ae3db51248`，與測試提交的 tree 相同

`server/voiceGateContract.test.ts` 載入實際 ECCAL Express 語音路由、JWT 檢查與 PostgreSQL 帳本，以及原生 Workers 的 HTTP、MemberRoom 排隊與 SQLite。原生 outbound bridge 將測試 ECCAL origin 轉接至本機 Express；只轉送應用所需的 Content-Type 與 Authorization。方法定義、語音提供者與音訊開始事件使用受控 fixture

資料只存於本機隨機 `test_voice_gate_*` schema，結束後 schema 已清除、原生 runtime 已停止，沒有使用正式會員、額度或外部提供者

## 發證結果

| 情境 | HTTP | 提供者通話 |
|---|---|---|
| 未登入、過期 JWT、錯簽章、原 JWT 仍有效但 ECCAL 會員已取消 | 401 LOGIN_REQUIRED | 未建立 |
| 零餘額 | 403 QUOTA_EXHAUSTED | 未建立 |
| 受控 eligible:false 契約回應 | 403 MEMBER_INELIGIBLE | 未建立 |
| 有效且有額度 | 201 | 僅建立本人測試通話 |
| 以有效 A 登入，竄改 query／header 為 B | 201 | 占用仍歸 A，B 的 300 秒不變 |

成功回應只有 deadline、id、sdp；另一會員讀取該筆通話為 404。測試通話在未產生音訊時結束，扣 0 秒，餘額回復 300 秒

目前 ECCAL 的資格規則是每位現有會員都有 300 秒，`service.identity` 對存在會員回傳 eligible:true。真實資格失效案例先確認測試會員可讀到 300 秒，接著只在隔離 schema 取消該會員；原 JWT 的簽章與期限仍有效，但實際 ECCAL authenticate 回 null、balance 回 404 MEMBER_NOT_FOUND，語音發證回 401 且沒有建立提供者通話。可用、登入失效與會員資格失效三種前提皆以目前契約驗證

eligible:false 的依賴覆寫另作額外防護測試，對應 MEMBER_INELIGIBLE 拒絕，不用來代替上述實際會員查詢

目前 OpenAiRealtime 的四個內建工具配置經實際 client_secrets API 回 200；使用有效 WebRTC offer，等短效憑證到期後再請求提供者通話，實際回 401，應用層回 REALTIME_UNAVAILABLE。沒有建立提供者通話、保存短效憑證或產生音訊，peer 已關閉

## 最後一秒並行與重送

兩份獨立簽發的測試憑證同時呼叫原生 HTTP，結果為 201 與 409，PostgreSQL 只留一筆 1 秒占用。相同開始操作重送為 409 OPERATION_REPLAYED

受控音訊事件與時鐘到達一秒後，由 MemberEngine alarm 掛斷；兩次結束重送均回 200，提供者只掛斷一次。ECCAL 收據為前一筆扣 299 秒、剩 1 秒；本筆扣 1 秒、剩 0 秒，未結算占用為 0，再開始為 403 QUOTA_EXHAUSTED

原始時間戳、八種發證情境、SQL 收據、source／bundle／helper SHA 與清理見 [去識別證據](examples/voice-gate-validation-2026-11-05.json)。Issue #6 的兩台實際裝置驗收維持待辦

## 命令與跨 repo 測試修正

在 ECCAL checkout 執行：

```sh
REALTIME_BLACK_ROOT=/Volumes/SD/Call-black VOICE_GATE_EVIDENCE=/tmp/call-remaining-voice-gate.json node --import tsx --test server/voiceGateContract.test.ts
```

兩項整合驗證通過、0 skipped。原有 `test:voice-contract` 使用舊 read_method 工具名，在更新後的語音來源失敗為 MCP_TOOL_LIST_INVALID；測試已改用內建 thinkwithblack_entry_catalog，並要求個人 MCP grant 若被呼叫即失敗。重新執行後，工具成功、扣除 30 秒等待，兩通帳目 300 → 210 → 0、另一會員 300，全部通過

ECCAL 17 個額度、1 個跨 repo 額度、8 個登入、2 個舊 OAuth 相容案例及本輪 2 個原生 gate／搶用案例均通過。舊 OAuth 相容檔案首次因缺少 THINKWITHBLACK_MCP_ROOT 而未啟動，補上必要路徑後兩項通過
