# ECCAL 語音額度介面驗證紀錄

日期：2026-11-04，時區 Asia/Taipei

唯一產品規格為 [產品規格 V0.3](product-spec.md)第 3 節，工作要求為補齊 ECCAL 語音額度介面，對應 [Issue #1](https://github.com/backtrue/realtime-black/issues/1)及 #5、#6、#8、#9

## 來源與工作目錄

| 來源 | 本次使用狀態 |
|---|---|
| ECCAL | `/Users/backtrue/Documents/eccal-new`，remote `backtrue/eccal-new`，既有分支 `codex/thinkwithblack-mcp-auth`，HEAD `e5c07f209cb1a23e7c8bc80b13a093ed66c948f9` 加本機增量 |
| realtime-black | `/Volumes/SD/Call-black`，main，HEAD `e7e77a360b8ca4f95f95ea9d82d70affcf85beda` 加本機增量 |
| ECCAL 既有工作 | 付款、MCP 試用及頁面等未提交修改，修改前保存本輪共用檔案基準；原有 routes、權限服務、付款與試用內容保留 |
| 測試資料庫 | 本機 PostgreSQL 16.13，僅使用隨機 `test_voice_*` schema，合成資料於測試後清理 |
| GitHub／Replit／正式服務 | 本輪本機開發，尚未同步、執行正式 migration、Republish 或正式會員驗收 |

## 本輪增量清單

ECCAL 新增：

- `shared/voiceQuota.ts`
- `server/voiceQuotaRepository.ts`
- `server/voiceQuotaService.ts`
- `server/voiceQuotaRoutes.ts`
- `server/voiceQuota.test.ts`
- `server/voiceQuotaContract.test.ts`
- `migrations/0004_voice_quotas.sql`
- `docs/voice-quota.md`

ECCAL 修改：

- `server/index.ts` 新增語音路由 import 與註冊
- `shared/schema.ts` 尾部追加兩個語音表與約束
- `package.json` 新增 `test:voice`、`test:voice-contract`
- `.gitignore` 新增 `0004_voice_quotas.sql` 的特定例外，使 migration 納入可交付檔案

realtime-black 新增：

- `src/eccal-http.ts`
- `test/eccal-http.test.ts`
- `docs/eccal-voice-validation-2026-11-04.md`

realtime-black 修改：

- `src/worker.ts` 以設定選用完整 ECCAL binding 或語音 HTTP 來源
- `.dev.vars.example` 新增 ECCAL origin 與空白後端憑證欄位
- `docs/runtime-integration.md`、`docs/eccal-integration-check.md`、`docs/implementation-status.md`、`docs/validation-2026-11-04.md` 同步契約與實際結果

## 驗收對照

- [x] 每位現有會員累計 300 秒，跨登入與跨通話共用，其他會員額度及既有點數維持原值
- [x] PostgreSQL 會員列鎖與 partial unique index，12 個並行請求只產生一筆占用
- [x] 最後 1 秒的不同裝置操作只有一筆成功
- [x] 同操作占用回傳原識別值與截止，同一時間軸結算不重扣，修改已結算時間軸遭拒
- [x] 第一段音訊起算、工具等待聯集排除、每通合計取整、未接通 0 秒
- [x] 扣秒與結算收據同一交易，收據寫入失敗時全部回復
- [x] 合法、過期、錯簽章與已刪除會員的 JWT 核對；會員只能讀取本人額度
- [x] 內部服務憑證、JSON 與大小檢查、額外欄位拒絕及固定錯誤回應
- [x] HTTP adapter 核對契約版號、會員及帳目，拒絕轉址與過大回應，後端憑證不回傳瀏覽器
- [x] realtime-black live adapter 與通話引擎經 HTTP 寫入真實 PostgreSQL，300 → 210 → 0，另一會員維持 300
- [x] 型別檢查、建置及新增程式憑證掃描通過

## 實際命令結果

| 工作目錄／命令 | 結果 |
|---|---|
| ECCAL `npm run check`，修改前與修改後 | 通過 |
| ECCAL `npm run test:voice` | 17 項通過、0 skipped |
| ECCAL `REALTIME_BLACK_ROOT=/Volumes/SD/Call-black npm run test:voice-contract` | 1 項通過、0 skipped |
| ECCAL `npm run build` | Vite 與後端 esbuild 通過 |
| ECCAL 新增 production code 與 migration 的 `secretlint` | 通過 |
| realtime-black `npm run check` | 120 項 Workers、6 項前端、型別及 dry-run 建置通過；23:00 執行，Workers 耗時 14.91 秒 |

## 獨立驗收

fresh `spec_evaluator` 判定 PASS，逐項核對原子占用、並行結算、跨會員隔離、JWT 與服務憑證、事件計費、兩端契約、migration 包含狀態及本輪差異範圍

驗收者獨立重跑 ECCAL 17 項、跨 repo 1 項、兩邊型別與 realtime-black 120＋6 項檢查，並確認測試後沒有殘留 `test_voice_*` schema。兩個 repo 的 `git diff --check` 均通過
