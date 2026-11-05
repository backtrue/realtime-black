# Issue #29 Cloudflare 測試發布與回復演練

日期：2026-11-05

從已推送 source `41b7231d9ca3345d688bb41598ac3da80c7237b1` 的 git archive 建立獨立暫存目錄，依 package-lock 執行 npm ci。使用 Wrangler 4.157.0，連續兩次 npm run build 的 JS bundle SHA-256 均為 `1ffb15a10e3b2d7fc26a95264f4a718d4960892d731343bf6c692c03028c9199`

## 測試環境與步驟

測試 Worker 為 `realtime-black-check-0ac3a484`，使用獨立 DO、workers.dev 入口及 migration v2，沒有正式 route、正式 secret 或正式 DO 綁定；ECCAL_ORIGIN 為空，APP_ORIGIN 為測試值。建立前先確認目標不存在

1. wrangler deploy 發布候選 source 41b7231，記錄 version、deployment、100% 流量、script ETag 與三個公開檔案 SHA
2. 在相同測試服務發布已知 source 4d9d3a9，確認不同 version／script ETag 與舊版公開檔案
3. wrangler rollback 指定第一步候選 version，確認流量回到該 version、script ETag 與三個公開檔案完全恢復
4. 移除本次建立的測試 Worker，重新查詢 script-settings 回 404，移除暫存目錄
5. 演練前後讀取正式 realtime-black 的 deployment，ID 與版本流量完全相同

| 階段 | Version | Deployment | 結果 |
|---|---|---|---|
| 41b7231 候選 | `52f79541-5133-4a5c-836d-5ae555e73925` | `51a70709-2af4-493f-ab4f-e4a064571cf9` | 100% 流量，三個公開檔案逐位元組相符 |
| 4d9d3a9 已知版本 | `5fa70901-330f-4b13-b75a-98b03e3a4bc1` | `17c6bb21-5c01-4af7-bbcd-9b67fee9f553` | 100% 流量，三個公開檔案逐位元組相符 |
| 回復 41b7231 | `52f79541-5133-4a5c-836d-5ae555e73925` | `2ae35d5e-25e4-452f-830c-5c68f95df677` | 100% 流量，三個公開檔案逐位元組相符 |

三個階段的首頁、app.js、style.css 均回 200／no-store；隔離環境的會員端點回 503 ECCAL_NOT_CONFIGURED。回復後 script ETag 與首次測試候選一致，也與正式 version 663f8503-6e3f-4f7b-89ee-c562b47eab66 的 script ETag 相同

## 正式上線核對待完成

正式 deployment 5a0c9583-4022-4449-8c16-1b33e312fbd7、version 663f8503-6e3f-4f7b-89ee-c562b47eab66、100% 流量在演練前後完全不變

Issue #29 保持開啟，待已登入且具可用測試額度的 ECCAL 會員，在同一正式版完成網頁短通話、額度及成果存取抽查。三位既有測試會員的正式額度已用盡

重建、各階段版本、檔案 SHA、回復及清理見 [測試演練 JSON](examples/deployment-rehearsal-2026-11-05.json)
