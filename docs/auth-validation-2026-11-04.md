# 跨站登入與個別會員 MCP 授權驗證

產品依據：[產品規格 V0.3](product-spec.md)第 3、6、8 節，對應 Issue #1、#3、#10、#12、#21

## 本輪範圍

ECCAL 使用 `/Users/backtrue/Documents/eccal-new` 既有 `codex/thinkwithblack-mcp-auth`，基底 `e5c07f209cb1a23e7c8bc80b13a093ed66c948f9`；realtime-black 使用 `/Volumes/SD/Call-black` 的 main，基底 `e7e77a360b8ca4f95f95ea9d82d70affcf85beda`。兩邊均加上已有的本機工作目錄變更

ECCAL 新增：`server/voiceLoginState.ts`、`server/voiceLoginRepository.ts`、`server/voiceLoginRoutes.ts`、`server/voiceLogin.test.ts`、`server/voiceMcpContract.test.ts`、`migrations/0005_voice_login.sql`、`docs/voice-login.md`

ECCAL 修改：`server/index.ts` 註冊登入路由、`server/jwtAuth.ts` 加入語音登入的 Google state 與回呼分支、`server/voiceQuotaRoutes.ts` 驗證本站會話、`shared/schema.ts` 追加登入資料表、`.gitignore` 納入新 migration、`package.json` 加入測試命令

realtime-black 新增：`src/auth-crypto.ts`、`src/auth-routes.ts`、`src/mcp-oauth.ts`、`src/member-authorization.ts`、`test/auth-fixture.ts`、`test/auth.test.ts`、本驗證紀錄

realtime-black 修改：`src/worker.ts` 新增 AuthVault 與登入路由、`src/eccal-http.ts` 新增登入交換與帳號核對、`src/mcp.ts` 新增帳號探查與撤銷辨識、`src/contracts.ts` 增加不含 bearer 的授權 handle、`src/member-engine.ts` 驗證 handle，實際工具操作走 AuthVault 序列化；`wrangler.jsonc` 新增 AUTH binding／v2 migration、`.dev.vars.example`、`public/index.html`、`public/app.js`、`test/frontend.node.test.mjs`；相關設定、儲存清冊、Issue 進度與驗證文件同步更新

ThinkWithBlack MCP 必要增量位於 `/Users/backtrue/Documents/ChatGPT/thinkwithblack-mcp`，既有分支 `feat/codex-mcp-dependency-layer`，HEAD `1715fd6bf4197012d205c5747afe1fbab56cb35f`。新增 `src/mcp/methods-scope.ts`、`docs/realtime-methods-scope.md`；修改 `src/oauth/state.ts`、`src/oauth/consent.ts`、`src/mcp/api-handler.ts`、`test/oauth-state.test.ts`、`test/oauth.test.ts`。修改前全文與 SHA-256 在基準目錄的 `mcp/` 與 `mcp/manifest.json`

MCP 既有行銷字典、同步腳本、plugin、generated registry、會員規則及 GSC／GTM 服務均保持原值。本輪 MCP 驗證直接執行 `npx tsc --noEmit`、`npx vitest run test/oauth-state.test.ts test/oauth.test.ts` 與 Wrangler dry-run，不執行會重產行銷檔案的 generator

最初規劃檔案的修改前副本與 SHA-256 保存在 `/tmp/realtime-black-auth-baseline/manifest.json`：ECCAL 六個既有檔案，以及 realtime-black 的 worker、MCP、ECCAL HTTP、首頁、app.js、Wrangler 與 package。後續驗收修正另觸及 `src/contracts.ts`、`src/member-engine.ts`、`test/frontend.node.test.mjs` 與上述相關文件，這些檔案未保存本輪修改前副本，以實際修改清單及可重跑驗證核對。MCP 五個既有檔案另有完整副本及 SHA-256。既有付款、試用、語音額度及 MCP 專案工作保留

## 實作流程

登入由本站建立 10 分鐘的簽章 state，綁定 origin 與瀏覽器 HttpOnly nonce。ECCAL 經既有登入或 Google 登入取得會員後，回傳兩分鐘一次性碼；後端交換成最晚與原 ECCAL JWT 同時到期的本站會話。資料庫保存 code、state 與 session token 的雜湊

ECCAL 登入過程另以簽章 context 綁住當次 state 及登入 JWT，登入途中換成其他帳號會遭拒。語音用的 Google 登入 state 綁定瀏覽器 nonce，專用回呼分支只設定 HttpOnly cookie，再回到 `/api/voice/login`

MCP 採既有 ThinkWithBlack OAuth 同意流程、S256 PKCE、resource audience 及 issuer 核對，要求 `thinkwithblack.use thinkwithblack.methods.read`。方法庫 scope 不擴成 GSC／GTM，既有 base-only client 的預設授權保持原值。每位會員的 AuthVault 分開存放 AES-GCM 密文，並以會員及資料用途作 additional authenticated data

MCP 回呼與每次取得工具授權都呼叫既有 `thinkwithblack_get_account_status`，再由 ECCAL 核對其 Email 是否屬於當前會員。換發與撤銷使用官方服務目前公告的 token endpoint，解除授權先停止本機使用，提供者回應不明時保存加密待確認工作

AuthVault 對外只提供綁會員的 authorization handle，原始 bearer 留在控制器內。工具執行與解除授權共用同一工作佇列，撤銷完成回覆後舊 handle 無法再執行，也不能以 raw MCP client 使用

一期工具限定為 `thinkwithblack_entry_catalog`、`thinkwithblack_entry_read`、`thinkwithblack_marketing_skill_search`、`thinkwithblack_marketing_skill_read`、`thinkwithblack_list_modules`，未要求 GSC／GTM 私人資料 scope

## 驗收清單

- [x] 跨站 state 綁定瀏覽器及 origin，code 只能交換一次
- [x] ECCAL 登入途中換 JWT 拒絕；Google state 不同瀏覽器與簽章竄改拒絕
- [x] 本站 cookie 為 HttpOnly、SameSite=Lax；HTTPS 使用 Secure 與 __Host-，不共用 ECCAL JWT
- [x] PostgreSQL 真實登入交換、8 個並行交換只建立一筆、到期及撤銷拒絕
- [x] MCP S256 PKCE、issuer、session 與瀏覽器綁定，callback 重放及拒絕授權處理
- [x] 兩位會員取得各自工具結果，MCP 帳號不符時拒絕保存並安排撤銷
- [x] 逐次核對個人授權，access token 換發、提供者撤銷與本機解除後拒絕
- [x] OAuth 憑證與 PKCE verifier 密文保存，跨會員解密拒絕，過期清除
- [x] 真實 AuthVault RPC 並行 callback 只交換一次，SQLite 不保存明文 token
- [x] grant → revoke → 延遲工具呼叫拒絕；呼叫與撤銷同一 RPC 佇列，舊 handle 不可重用
- [x] 三個 repo 實際 OAuth client、已安裝 Provider 與 ECCAL PostgreSQL 帳號核對串接，兩會員隔離、換發、撤銷及錯帳號拒絕
- [x] 方法庫 scope 保留至 token 與 refresh；MCP resource 層拒絕私人來源及其他工具

## 已執行檢查

| 指令 | 結果 |
|---|---|
| realtime-black `npm run typecheck` | 通過 |
| realtime-black `npm test -- test/auth.test.ts` | 13 項通過 |
| realtime-black `npm run check` | 133 項 Workers、8 項前端、型別及三個 DO 的 dry-run 建置通過 |
| ECCAL `npm run check` | 通過 |
| ECCAL `npm run test:voice` 與 `REALTIME_BLACK_ROOT=/Volumes/SD/Call-black npm run test:voice-contract` | 17 項 PostgreSQL／HTTP 與 1 項額度跨 repo 通過 |
| ECCAL `REALTIME_BLACK_ROOT=/Volumes/SD/Call-black npm run test:voice-login` | 8 項通過，本機 PostgreSQL 與兩個 repo 的實際登入程式，Google 身分回應受控 |
| ECCAL `REALTIME_BLACK_ROOT=/Volumes/SD/Call-black THINKWITHBLACK_MCP_ROOT=/Users/backtrue/Documents/ChatGPT/thinkwithblack-mcp npm run test:voice-mcp` | 2 項通過，使用實際 OAuth client、已安裝 Provider、MCP SDK 與 PostgreSQL 帳號核對；同意身分及方法內容受控 |
| MCP `npx --no-install tsc --noEmit` | 通過 |
| MCP `npx --no-install vitest run test/oauth-state.test.ts test/oauth.test.ts` | 117 項通過 |
| MCP `npx --no-install wrangler deploy --dry-run --outdir /tmp/realtime-black-mcp-auth-build` | 通過 |
| ECCAL `npm run build` | Vite 前端與 esbuild 後端建置通過 |
| 三個 repo `git diff --check`；ECCAL／MCP 本輪檔案 `secretlint` | 通過 |

最終自查包含 `.dev.vars.example` 的空 `MCP_CLIENT_ID`：HTTPS 使用本站 CIMD，loopback 仍要求已登記的 client。完整 `npm run check` 於 23:58 重跑通過，測試總數不變

## 獨立驗收與交付狀態

2026-11-05 fresh `spec_evaluator` 判定 PASS，逐項核對唯一產品規格、三個 repo 的實際來源、基準副本、權限鏈與測試。驗收修正了 raw bearer 與撤銷交錯、base-only 自動取得 GSC、HTTPS 空 client 設定三項問題，並確認最新程式及測試一致

| 核對項目 | 結果 |
|---|---|
| 登入、Google state、一次性碼、到期及登出 | PASS |
| MCP 個人帳號、PKCE、加密、換發、撤銷及 RPC 序列化 | PASS |
| 方法 scope、provider／SDK／工具權限鏈及私人來源拒絕 | PASS |
| 三個 repo 型別、相關測試與建置 | PASS |
| 新增差異空白檢查及憑證掃描 | PASS |
| PostgreSQL 登入與 MCP 測試 schema 殘留 | 0 |

三個 repo 保持上述既有 branch 與 HEAD，變更位於本機工作目錄。GitHub 本輪未 push；Replit 本輪未同步或 Republish；正式環境尚未套用 migration／設定及發布 MCP 新 scope

## 直接依據

- [MCP Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- 2026-11-04 匿名 GET 讀回 `https://mcp.thinkwithblack.com/.well-known/oauth-authorization-server` 與 `/.well-known/oauth-protected-resource/mcp`：S256、CIMD、authorization_code／refresh_token、issuer 回應、revocation endpoint 為 `/oauth/token`
- ThinkWithBlack MCP 本機 `src/oauth/provider.ts`、`src/oauth/state.ts`、`src/mcp/account-status-tool.ts`、`src/marketing/entry-tools.ts`、`src/marketing/runtime-tools.ts` 及 `src/registry/module-list-tool.ts`

正式設定、migration、MCP 新 scope 發布、跨站瀏覽器 Google 同意與真實 MCP 同意畫面待環境同步後驗收
