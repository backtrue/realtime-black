# Issue #15 插話逐字稿驗收

日期：2026-11-05

原回歸案例中，插話清除播放後，晚到的全文與 stopped 事件將「未播放的結尾」寫進逐字稿。修正後依提供者的 conversation.item.truncated 截斷點，取回 PCM 音訊並只轉寫已播放的前綴，晚到全文不會覆寫前綴

停止播放時立即沿同一條 sideband 送出 retrieve，音訊在記憶體等待可信截斷點後裁切；掛斷及原計時不等待取回或轉寫。轉寫沿現有 OpenAI Realtime 服務使用 gpt-4o-transcribe，完成或失敗即清除暫存音訊

事件與轉寫介面依 [OpenAI Realtime server events](https://developers.openai.com/api/reference/resources/realtime/server-events)及 [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)，截斷點與 PCM 長度另由實際提供者結果核對

## 同版實際語音對話

Native Cloudflare Workers SQLite runtime 執行實際 MemberRoom、MemberEngine、公開 HTTP 路由與 OpenAI client。會員與帳本為受控測試資料；兩段使用者語音由實際模型生成，經 RTP 傳入同一通 gpt-realtime-2.1，未使用麥克風或建立正式會員紀錄

合成器每段實際說出的全文先與指定台詞逐字核對，再送入對話。第一段提供充電座、100 次到站、10 次加購、1 筆訂單，要求覆述並追問；第二段插話說「先停一下，我每週只有四小時。請只告訴我第一個要查的數字」

| 檢查 | 實際結果 |
|---|---|
| 追問與插話 | 指定台詞與實際合成語音相符，最終逐字稿保留會員追問 |
| 已播放內容 | 插話助理項目保存前綴並標記 interrupted，未保存後續生成全文 |
| 對話順序 | 首題的連續 ASR 片段 → 已播助理前綴 → 會員追問 → 完整答覆 |
| 會員隔離 | A 讀取 200，B 404，未登入 401；拒絕回應無逐字稿 |
| 儲存 | SQLite 無 audio、SDP、access token、refresh token、client secret 或正式 key |
| 結束 | 原生 WebRTC 提供者確認結束，所有本機 runtime 已關閉 |

## 播放中直接掛斷

以相同 source SHA 與 runtime bundle，在播放 2.5 秒時取消生成、清除播放並立即呼叫 end。提供者確認截斷點 2,660ms，保存「網站到站有一百次。」，後面的加購、訂單及流程說明未列為已說

掛斷請求 299ms 完成，實扣 3 秒、餘 297 秒。回應時仍有一筆待轉寫，完成後 endedAt 與 settlement 均不變；沒有待處理轉寫或辨識失敗，音訊及憑證未寫入儲存

## 檢查與實際證據

完整 `npm run check` 通過型別、155 項 Workers、13 項前端、3 項原生連線及 dry-run 建置。插話測試涵蓋前綴、重送、零播放、較長音訊裁切、不足音訊拒絕、ASR 失敗，以及 retrieval 逾時、轉寫成功／失敗均不增加計費。音訊台詞與順序判斷另有 8 項純測試通過

實際台詞、逐字稿、生成全文對照、提供者截斷點、三種身分讀取、帳目與清理見 [逐字稿驗收證據](examples/transcript-validation-2026-11-05.json)
