# Issue #16 本次諮詢摘要自動驗收

日期：2026-11-05

依 [M2-02](development-plan.md#m2-02)，以 source `4d9d3a934b56da003c53b9e5d4c23143af13d726` 的 MemberEngine.document 與 OpenAiDocuments 執行，實際模型為 gpt-6.1-sol。通話、會員與工具回應為合成測試資料，儲存使用受控記憶體 store

測試通話包含商品、100 次到站／10 次加購／1 筆訂單、一人每週 4 小時限制、受控漏斗方法、AI 建議的 1＋2＋1 小時查核順序，以及運費呈現與放棄原因未知的問題

| 摘要內容 | 原始依據與分類 |
|---|---|
| 問題與現況 | 商品及優先改善問題來自 fixture-user-1，工時限制來自 fixture-user-2，分類 member |
| 方法 | 受控方法要求分開核對各漏斗階段，引用 fixture-tool-1，分類 tool |
| 診斷 | 10%／10%／1% 可由 100／10／1 重算，分類 inference，未認定運費或價格是流失原因 |
| 建議 | 第一、二、三步分別為 1、2、1 小時，引用 fixture-assistant-2，與通話中的 AI 建議相符 |
| 待釐清 | 統計口徑、開始結帳、付款失敗、運費呈現及放棄原因列為 unknown |

實際請求回 HTTP 200／completed，耗時 19,070ms，store:false，通過正式程式的來源與分類驗證。摘要保存於同一筆通話、sourceRevision 為 4，會員 A 讀回與產出完全一致；會員 B 讀取及要求產生同一筆摘要皆回 404

所有寫入均為原通話紀錄，完整輸入、模型摘要、保存結果及跨會員拒絕見 [摘要與會員隔離證據](examples/summary-validation-2026-11-05.json)

2026-11-05 fresh spec_evaluator 核對五種內容分類、來源與數字、同次通話保存、會員讀回與跨會員拒絕，Issue #16 判定 PASS
