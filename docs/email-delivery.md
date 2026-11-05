# Email 成果交付

依 [Issue #23](https://github.com/backtrue/realtime-black/issues/23)與使用者核定，Email 成果只寄到該會員的 ECCAL 登入信箱，使用既有 Resend 帳號寄送

## 會員操作與收件核對

會員在報告、文案或改善計畫下按「寄到 Email」，前端不提供地址輸入。建立工作時，後端向 ECCAL 查詢會員的登入信箱；指定其他地址會被拒絕。派送前與 Resend 呼叫前都重新核對，帳號信箱已變更的舊工作不會寄出

成果連結為本站的 `/#call=…&document=…`，開啟後仍透過 ECCAL 驗證會員，轉傳連結不能讀取其他會員的內容

| 路徑 | 行為 |
|---|---|
| `POST /api/calls/:recordId/deliveries` | 建立本人既有成果的待處理工作，Email 的 recipient 傳空字串，由後端填入登入信箱 |
| `POST /api/calls/:recordId/deliveries/:jobId/email` | 本人要求寄送該 Email 工作，請求不帶本文；驗證會員、Origin、成果版本、保存期限、通路與收件人 |

同一工作的 Email 送出請求重播會回傳既有狀態，已送出、失敗或結果不明的工作不再送出。前端在請求中斷後沿用原操作識別值。LINE 工作繼續由有人監督的派送流程處理

## ECCAL 內部介面

由既有 `THINKWITHBLACK_VOICE_SERVICE_TOKEN` 驗證呼叫者，回應包含 `X-Voice-Contract: eccal-voice-v1` 與 no-store；本文採嚴格 JSON，最大 4 KiB

| 路徑 | 輸入 | 回應 |
|---|---|---|
| `POST /api/voice/internal/email/recipient` | memberId | memberId、登入信箱 recipient |
| `POST /api/voice/internal/email/verify` | memberId、jobId、recordId、documentId、recipient、createdAt | 核對後的會員、工作、成果、信箱與 verifiedAt |
| `POST /api/voice/internal/email/send` | verify 的輸入加 resultUrl | sent／rejected／unknown，成功含 Resend receipt，失敗含固定代碼與可用的 HTTP 狀態 |

ECCAL 從 users 查詢登入信箱，Resend 使用 ECCAL 既有 `RESEND_API_KEY`，信件由已驗證的 `toldyou.co` 網域，以 `AI 小黑 <call@toldyou.co>` 寄出。`VOICE_APP_ORIGIN` 限定成果連結，會員或呼叫者不能替換成其他網站

## 狀態與證據

送出前先保存 sending 狀態，Resend 呼叫使用 `voice-result/:jobId` 作為 Idempotency-Key，最多等待 7 秒。收到有效寄件收據才登記 succeeded；明確拒絕登記 failed，網路錯誤、5xx、模糊回應與不合格收據登記 unknown

failed／unknown 保存固定 failureCode 與可取得的 providerStatus。既有的 isolate 中斷恢復維持結果不明，人工重新核對前不重送

來源：[Resend 寄信 API](https://resend.com/docs/api-reference/emails/send-email) · [Resend Idempotency-Key](https://resend.com/docs/dashboard/emails/idempotency-keys)

## 本機驗證

```sh
npm run check
```

ECCAL checkout 另執行：

```sh
npm run check
REALTIME_BLACK_ROOT=/path/to/realtime-black npm run test:voice-email
npm run test:voice
REALTIME_BLACK_ROOT=/path/to/realtime-black npm run test:voice-contract
REALTIME_BLACK_ROOT=/path/to/realtime-black npm run test:voice-login
npm run build
```

Email 整合測試使用本機隨機 PostgreSQL schema、實際 Express／HTTP adapter／MemberEngine 與受控 Resend 回應，涵蓋登入信箱、跨會員拒絕、重送、信箱變更、網址替換、設定缺少、提供者拒絕及結果不明
