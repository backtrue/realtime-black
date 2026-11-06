# 復古版同版異常矩陣

日期：2026-11-06

依 [Issue #28](https://github.com/backtrue/realtime-black/issues/28)，核對正式 source `b647abc`、Cloudflare version `a919d0dd-99d6-4de1-b2a9-f1c996eed5cd`。相關 11 個產品與測試檔均與該來源逐位元組相同

| 情境 | 本版驗證 | 結果 |
|---|---|---|
| 最後一秒搶用 | 本次重跑 ECCAL Express／PostgreSQL＋原生 HTTP／MemberRoom／SQLite，兩份憑證同時開始 | 201／409，只有一筆 1 秒占用，結束重送兩次仍只掛斷及扣秒一次，剩餘 0 |
| 服務端截止 | 同版 MemberEngine alarm 測試與本次原生整合 | 沒有前端倒數仍由後端掛斷，後續開始拒絕 |
| 工具拒絕 | 同版 default-methods 與 member 測試 | 私人來源、寫入工具、錯誤清單及服務失敗均拒絕 |
| 交付失敗 | 同版 delivery-state 的 8 個 HTTP／SQLite／RPC 案例 | pending、succeeded、failed、unknown 實存與讀回正確，拒絕或不明不列成功 |
| 紀錄屆期 | 同版 retention、storage 與 member 測試 | 30 天到期的清單、直接讀取、alarm 及儲存清理通過 |

本版完整檢查為 179 Workers、25 前端、3 原生連線、型別與 dry-run 通過。本次另外執行的 ECCAL 原生整合為 2 passed、0 failed、0 skipped，schema 與 runtime 已清理。來源、命令、log SHA 與逐項證據見 [本版異常索引](examples/exception-validation-2026-11-06.json)

一般服務音色的正式通話，使用者已確認聽到回答並掛斷，見 [復古版正式驗證](retro-release-2026-11-06.md)。本人聲音依 #30／#31 保持待資格、樣本與本人試聽簽認

前置 #27 的兩會員 Email／LINE 全流程尚未完成。#24 等待指定官方帳號及兩位會員送出領取碼，#6 等待兩分頁與兩台實際裝置，#13 等待本人教學口吻意見，#28 保持開啟
