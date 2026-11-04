# M2-11 真人顧問交接格式

對應 [Issue #25](https://github.com/backtrue/realtime-black/issues/25)，格式由 `src/delivery.ts` 的 `handoff` 產生

| 欄位 | 內容 | 對照來源 |
|---|---|---|
| `memberId` | 此次諮詢所屬會員 | 原通話的會員歸屬 |
| `problemSummary` | 具體描述會員問題的摘要 | 目前版本摘要的標題 |
| `confirmedFacts` | 會員提供的事實與工具資料，保留兩者分類 | 摘要的 member、tool 項目及 sourceIds |
| `aiDiagnosis` | AI 判斷與改善建議，保留兩者分類 | 摘要的 inference、recommendation 項目及 sourceIds |
| `documents` | 同次諮詢的報告、文案與改善計畫 | 與目前逐字稿版本一致的成果 |
| `pendingQuestions` | 待確認資訊與尚未解決的問題 | 摘要的 unknown 項目及 sourceIds |

## 核對樣本

[合成諮詢及交接結果](examples/handoff-consultation.json)同時收錄原始測試紀錄與實際函式輸出，使用合成會員、受控工具回應及測試成果

樣本的問題為測試商品 A 的購物車到訂單流失，已知條件有售價、漏斗數字及每週 4 小時的人力限制。運費呈現與放棄結帳原因保留於待確認事項，沒有寫成已知原因

可用以下指令從測試資料重新產生樣本

```sh
npm run example:handoff
```
