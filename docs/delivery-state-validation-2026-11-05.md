# M2-08 交付狀態驗收

日期：2026-11-05

唯一驗收規格為 [Issue #22](https://github.com/backtrue/realtime-black/issues/22)：模擬尚未發送、通路拒絕、結果不明與確認送出，逐筆核對狀態、成果、通路與送出證據

## 測試環境與來源

產品來源為 realtime-black `ee533fb2b384597a9af158d0d6988a5cb2dc2bff`；新增 `test/delivery-state.test.ts`，載入實際 MemberEngine、MemberRoom RPC、HTTP 路由與 SQLite Durable Object。會員、文件與兩個交付通路使用受控 fixture，測試沒有寄送外部訊息

## 實際結果

| 通路回應 | Email 狀態 | LINE 狀態 | 通路嘗試 | 收據 |
|---|---|---|---|---|
| 尚未送出 | pending | pending | 0 | 無 |
| 明確拒絕 | failed | failed | 1 | 無 |
| 結果不明 | unknown | unknown | 1 | 無 |
| 確認送出並附受控收據 | succeeded | succeeded | 1 | 受控收據與原成果、通路一致 |

八個案例都從 HTTP 建立工作、重送相同操作，再檢查 SQLite 實存值。兩個尚未送出的案例不派送，其餘六個經後端 RPC 派送。重建 MemberEngine 後，HTTP 狀態、文件與通路仍一致；本人讀取 200、另一會員 404、匿名 401。只有附確認收據的回應登記成功

完整結果由測試快照產生，見 [去識別證據](examples/delivery-state-validation-2026-11-05.json)

## 檢查

- `CI=1 npx vitest run test/delivery-state.test.ts`：1 個整合案例、八組情境通過
- `npm run check`：型別、170 Workers、14 前端、3 原生連線、dry-run 全數通過

Email 實收依 [Issue #23](https://github.com/backtrue/realtime-black/issues/23)，LINE 真人監督實送依 [Issue #24](https://github.com/backtrue/realtime-black/issues/24) 驗收
