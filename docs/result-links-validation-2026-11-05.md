# Issue #21 成果連結與會員身分驗收

日期：2026-11-05

產品 source `41b7231d9ca3345d688bb41598ac3da80c7237b1`，正式 version `663f8503-6e3f-4f7b-89ee-c562b47eab66`。本次在 Native Cloudflare Workers SQLite 執行實際 Worker HTTP 路由、MemberRoom、MemberEngine、authRoutes 與 HttpEccalQuota；ECCAL HTTP 回應、會員及文件產出為受控合成資料

## 三類成果的存取紀錄

以正常 MemberEngine 流程開始合成通話、接收文字、確認結束，再依序產生 report、copy、plan 三類成果並保存於同一筆 SQLite 紀錄

登入從 /auth/login 取得綁定瀏覽器的 state，經真實 callback 驗證及一次性登入碼交換取得 HttpOnly／Secure cookie。A 首次可讀，POST /auth/logout 後原 cookie 回 401，再次經同一登入流程取得不同 cookie 後三份成果均完整相符；B 亦經登入流程取得自己的 cookie

| 成果 | A 重新登入 | B 同一連結 | 匿名 | Email 收件證明 | LINE 領取證明 | 竄改通話 ID |
|---|---|---|---|---|---|---|
| 行銷報告 | 200、原件相符 | 404 | 401 | 401 | 401 | 404 |
| 廣告文案 | 200、原件相符 | 404 | 401 | 401 | 401 | 404 |
| 改善計畫 | 200、原件相符 | 404 | 401 | 401 | 401 | 404 |

拒絕回應均不含文件 ID、標題或 documents；本人回應為 no-store。Email 測試帶入收件信箱與自稱核對的 header，LINE 測試帶入領取碼、會員欄位與交付 bearer，均不能取代登入 cookie

## 前端連結選取

連結採 /#call=…&document=…，頁面先以 same-origin cookie 與 no-store 讀取目前會員的紀錄，再依文件識別值展開該份內容。實際 app.js 的 Node 頁面測試逐一開啟 report、copy、plan，均只展開指定文件；改為他人文件 ID 時找不到內容，顯示確認登入帳號的提示

三類成果的同一筆後端請求均走會員歸屬核對，URL 中的文件 ID、Email 或 LINE 身分不會讓 API 讀取別人的資料

## 可重跑驗證與證據

完整 npm run check 通過型別、156 項 Workers、14 項前端、3 項原生連線及 dry-run 建置，成果存取快照在完整回歸中再次相符

- test/result-links.test.ts 直接核對三份成果、三次登入碼交換、一次登出撤銷、舊 cookie 拒絕及各身分存取，並輸出穩定的 JSON 存取快照
- test/frontend.node.test.mjs 核對三類 hash 開啟、cookie／快取設定與錯誤文件 ID
- [存取快照 JSON](examples/result-links-validation-2026-11-05.json) 由 toMatchFileSnapshot 直接寫出，連結識別值以固定合成標籤表示

正式頁面與 Google 登入的既有讀回另見 [跨站登入及會員授權紀錄](auth-validation-2026-11-04.md)及[正式發布紀錄](release-validation-2026-11-05.md)
