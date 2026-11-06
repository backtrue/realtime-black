# LINE 版同版異常矩陣

日期：2026-11-07

依 [Issue #28](https://github.com/backtrue/realtime-black/issues/28)，本次來源為語音站 `8e6c9bf`、ECCAL `d0558ca`，正式語音 version 為 `8eb29b39-728f-40ad-bf9c-d7a9d64547e3`

| 情境 | 驗證結果與證據 |
| --- | --- |
| 最後一秒搶用 | 同版 ECCAL Express／PostgreSQL、原生 Workers HTTP／SQLite 兩項整合通過；兩份獨立憑證同時開始回 201／409，只占用 1 秒；重送開始 409、重送結束兩次 200，只掛斷與扣秒一次，餘額與未結算占用均為 0 |
| 服務端截止 | 同版 MemberEngine alarm 測試通過，停止前端倒數仍由後端截止 |
| 工具拒絕 | 同版 default-methods 與 member 測試通過，私人資料與寫入工具均拒絕 |
| 交付失敗 | 既有八種 HTTP／SQLite 交付情境、九項 LINE 測試與 ECCAL 八項 LINE 原生契約通過；正式 LINE 停用人工輸入的受控案例為 failed，兩筆實收為 succeeded |
| 紀錄屆期 | 同版 retention、storage、member 與 LINE 測試通過，30 天到期清除紀錄、交付證據與待辦索引 |

語音完整 `npm run check` 為 188 Workers、26 前端、3 原生、型別與 dry-run 通過。ECCAL 43 項相關回歸、型別與建置通過；另保存本版兩項原生 gate 的請求時間、回應與帳本，測試 schema 與 runtime 已清理

[來源及五類案例索引](examples/exception-validation-2026-11-07.json) · [本版原生發證與搶用](examples/line-native-gate-2026-11-07.json) · [正式 LINE 交付與失敗案例](line-validation-2026-11-07.md)

一般服務音色的使用者確認見 [復古版正式通話](retro-release-2026-11-06.md)。本人音色依 #30／#31 等待資格、授權樣本與本人試聽

#28 的前置 #27 仍待完整案例及 #6 的兩分頁、兩台實際裝置驗收，保持開啟
