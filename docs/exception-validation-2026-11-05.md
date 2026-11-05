# G1-02 同版異常流程驗證

日期：2026-11-05

唯一驗收規格為 [Issue #28](https://github.com/backtrue/realtime-black/issues/28)。本輪使用語音 source `ee533fb2b384597a9af158d0d6988a5cb2dc2bff` 的同一組產品程式，新增測試與證據，沒有修改產品行為

| 異常案例 | 核對方式 | 結果 |
|---|---|---|
| 最後一秒搶用 | ECCAL PostgreSQL ＋原生 HTTP／MemberRoom，兩份憑證同時開始及重送 | 僅一筆 1 秒占用，結算一次，餘額 0 |
| 服務端截止 | 原生 gate 的受控音訊與時鐘觸發 engine alarm，既有 Workers cutoff 案例 | 掛斷一次，後續開始拒絕 |
| 工具拒絕 | `test/default-methods.test.ts` 與 `test/member.test.ts` | 私人資料、寫入、錯誤清單及服務失敗均拒絕 |
| 交付失敗 | `test/delivery-state.test.ts`，八個 SQLite／HTTP 案例 | 明確拒絕為 failed，不明為 unknown，只有確認收據為 succeeded |
| 紀錄屆期 | `test/retention.test.ts` 及 storage 案例 | 30 天到期的清單、直接讀取、alarm 與實際儲存清理通過 |

`npm run check` 通過型別、170 Workers、14 前端、3 原生連線及 dry-run。ECCAL 的兩個原生整合與 28 個額度／登入／舊授權相容測試通過，命令與來源見 [發證及搶用驗證](voice-gate-validation-2026-11-05.md)、[交付狀態驗證](delivery-state-validation-2026-11-05.md)

同版產品 source SHA、檢查命令、案例數與原始 log SHA 見 [驗證索引](examples/exception-validation-2026-11-05.json)

## 第一期未完成項目

| 任務 | 目前差異 | 下一個驗收 |
|---|---|---|
| #6 | 自動雙請求與實際帳本通過 | 兩台實際裝置 |
| #13 | 實際模型對話另列驗證 | 小黑本人試聽與教學口吻意見 |
| #23、#24、#27 | Email 與 LINE 的正式交付設定及實收未完成 | 指定寄件與收件、LINE 後台權限、真人監督實送及兩位會員全流程 |
| #29 | 同版正式網頁短通話及成果抽查待完成 | 具可用測試額度的 ECCAL 會員 |
| #30、#31 | 本人聲音服務、樣本與試聽標準待確認 | 本人聲音資格、授權樣本、音色與延遲簽認 |

一般 marin 音色的語音通話與本人聲音分開登記，既有一般語音驗證維持原結果，本人音色狀態為待驗收。Issue #27 與 #28 保持開啟
