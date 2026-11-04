# 2026-11-04 本機驗證紀錄

版本：`e7e77a360b8ca4f95f95ea9d82d70affcf85beda` 加本機工作目錄變更

環境：Node 22.22.3、Wrangler 4.157.0、Vitest 5.1.0、Cloudflare Workers runtime

## 自動檢查

| 指令 | 實際結果 |
|---|---|
| `npm run typecheck` | 通過 |
| `npm test` | 8 個測試檔、133 項通過 |
| `npm run test:frontend` | 8 項通過 |
| `npm run build` | dry-run 通過，綁定 MEMBERS、CUTOFFS、AUTH、ASSETS |
| `npm audit --omit=dev` | 0 個弱點 |
| `node --check public/app.js` | 通過 |
| `git diff --check` | 通過 |

最近一次完整 `npm run check` 於 Asia/Taipei 23:58 執行，Workers 測試耗時約 16.30 秒，包含實際等待 10 秒的辨識逾時案例。ECCAL 與 MCP 的新增授權驗證見 [跨站登入與個別會員授權驗證](auth-validation-2026-11-04.md)

## 已驗證情境

- 有效餘額 300 → 180 → 0，另一會員維持 300
- 第一段音訊起算、工具等待排除、重疊等待聯集、每通合計取整、未接通 0 秒
- 工具等待跨過原截止後保留剩餘額度，20 秒逾時邊界恢復計時
- 舊 alarm 先抵達時直接核對已落盤計時，舊版本更新不能蓋掉新截止
- ECCAL 回傳扣秒與核定時間軸不符時保留對帳工作
- 零、負數、非整數及 NaN 餘額拒絕發證
- 兩個 RPC 同時搶最後一秒，只建立一通
- 重複開始、重複結束、占用逾時與 isolate 中斷恢復
- 未接通的近端恢復 alarm、獨立提供者掛斷與跨控制器競態收斂
- ECCAL 結算 promise 未完成時，截止 Object 仍可完成通知與清理
- 跨會員讀取、MCP 授權錯人、到期與撤銷拒絕
- 唯讀工具允許清單、工具錯誤不冒充取得資料、重複工具事件
- 非同步轉寫依 item 順序重建、晚到條件使舊成果作廢
- 辨識未完成時等待，10 秒後將缺失片段列入明確缺口並產生摘要
- 從服務端確認結束起 30 天清除正文，結算服務中斷仍不延長正文保存
- 真實 SQLite 寫入抽查：逐字稿、四類文件、工具快取、Email 地址及 LINE 碼雜湊一併清除
- 寫入過程沒有測試 SDP、音訊欄位、授權權杖及 LINE 原碼
- 六欄真人交接合成樣本能回對原始來源，舊版本摘要拒絕交接、舊文件排除
- 會員口述與工具來源交叉誤標遭拒
- 交付未核對收件人、通路失敗、不明結果與 LINE 監督條件
- 交付工作持久保存、相同操作重放、實際 RPC 並行派送僅一次
- LINE 領碼雜湊、錯碼、範圍錯置、到期及成功後重複領取拒絕
- 晚到轉寫使舊成果與待寄工作作廢，派送中斷改列結果不明
- HTTP 交付入口拒絕會員自帶核對旗標，狀態讀回不含領取碼或雜湊
- 取消後重撥、拒絕麥克風、開始請求回應前取消的前端事件流程
- 前端不依舊固定截止提早掛斷，提供者連線關閉後清理音訊
- Email 待寄表單、LINE 領取碼與待寄狀態的前端事件流程
- 一次性跨站登入、瀏覽器與會話綁定、登出及到期拒絕
- 個人 MCP PKCE、加密保存、逐次會員核對、換發與撤銷；舊 handle 及錯帳號拒絕
- MCP 新方法庫 scope 的實際 Provider token／refresh、私人來源拒絕及三 repo PostgreSQL 串接

## 加入跨站登入前的本機 HTTP 讀回

| 位置 | 實際結果 |
|---|---|
| `http://127.0.0.1:8787/` | 200、no-store，包含 AI 對話揭露 |
| `/app.js` | 200、no-store，SHA-256 與本機檔案一致，沒有 OPENAI_API_KEY、accessToken、ECCAL_SERVICE_TOKEN 欄位 |
| `/src/worker.ts` | 404 |
| `/.dev.vars.example` | 404 |
| `/api/me` | 503，`ECCAL_NOT_CONFIGURED` |

## 獨立驗收

| 範圍 | 判定 | 已確認結果 |
|---|---|---|
| 通話、額度、MCP、紀錄與成果基礎 Attempt | NEEDS_WORK | 本機型別、測試及建置通過，已回報程式缺陷均已修正；ECCAL、Realtime、MCP、Cloudflare 及人工整合驗收待完成 |
| 持久交付、網頁申請、領碼與後端派送增量 | PASS | fresh spec_evaluator 核對會員隔離、核對範圍、單次派送、收據、不明結果及實作文件，完整 check 通過 |
| 核定計時、動態截止、30 天清除、真人交接與儲存抽查增量 | PASS | fresh spec_evaluator 逐項核對規格、來源及 live code，重跑 78 項相關測試，核對完整 check 的 107 項 Workers、6 項前端與建置結果；兩項截止問題修正後複驗通過 |
| ECCAL 語音額度 HTTP 介面與 realtime-black 串接增量 | PASS | fresh spec_evaluator 獨立重跑 ECCAL 17 項 PostgreSQL／HTTP、跨 repo 1 項、兩邊型別及 realtime-black 120＋6 項；核對原子性、會員隔離、憑證及契約一致性 |
| 跨站登入與個別會員 MCP 授權增量 | PASS | fresh spec_evaluator 核對三 repo 登入、PKCE、帳號隔離、加密、換發、撤銷序列化、方法 scope 與完整權限鏈；133＋8、ECCAL 28、MCP 117 項相關測試與建置通過，見 auth-validation-2026-11-04.md |

## 真實整合待驗

目前未設定 OpenAI 測試金鑰，D2 計時與 D10 起算點已核定。ECCAL 本機語音額度、跨站登入及個人 MCP 授權已通過相關測試。正式環境 migration／設定、MCP 新 scope 發布、真實 Google／MCP 同意及儲存抽查列於 [本機執行與串接](runtime-integration.md)

內建瀏覽器回覆 `Local browser use is disabled in Work settings`，尚未執行瀏覽器聽測、插話與真實雙向音訊驗證

Email 實收、LINE 實送、本人音色及付款驗收依對應 Issue 的前置條件執行，逐項狀態見 [Issue 實作與驗證紀錄](implementation-status.md)

### 提供者結束證據待驗

sideband 中斷後若掛斷持續回傳 404，而且尚未取得任何已確認的結束時間，現有流程會保留 ending 與額度占用。#8、#9 仍需受控 Realtime 測試釐清這條路徑，取得可核對的提供者結束證據

已讀取 [Realtime Calls 方法清單](https://developers.openai.com/api/reference/typescript/resources/realtime/subresources/calls)、[Hang up call](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup)及 [Realtime server events](https://developers.openai.com/api/reference/resources/realtime/server-events)，目前未找到這組 API 的查詢通話狀態方法、session.closed 事件或 404 對應的已結束時間契約
