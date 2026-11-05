import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import worker, { type Env } from "../src/worker";
import { MemberEngine } from "../src/member-engine";
import { HttpEccalQuota } from "../src/eccal-http";
import { cookieName, hash } from "../src/auth-crypto";
import type { Store } from "../src/contracts";
import { fixture } from "./fixture";

describe("M2-07 三類成果連結與重新登入", () => {
  it("走登入交換、登出、重新登入，跨會員與交付身分均不能讀到三類成果", async () => {
    const origin = "https://fixture.invalid", eccalOrigin = "https://eccal.example.test";
    const serviceToken = "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk";
    const runtime = env as unknown as Env;
    const sessions = new Map<string, string>();
    const codes = new Map<string, { memberId: string; state: string }>();
    const exchanges: string[] = [], revoked: string[] = [];
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input), body = JSON.parse(String(init?.body));
      expect(url.startsWith(`${eccalOrigin}/api/voice/internal/`)).toBe(true);
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${serviceToken}`);
      const reply = (value: unknown) => Response.json(value, { headers: { "x-voice-contract": "eccal-voice-v1" } });
      if (url.endsWith("/login/exchange")) {
        const code = codes.get(body.code);
        expect(code?.state).toBe(body.state); codes.delete(body.code);
        const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
        sessions.set(token, code!.memberId); exchanges.push(code!.memberId);
        return reply({ memberId: code!.memberId, sessionToken: token, expiresAt: Date.now() + 60000 });
      }
      if (url.endsWith("/login/revoke")) { revoked.push(body.sessionToken); sessions.delete(body.sessionToken); return reply({ revoked: true }); }
      if (url.endsWith("/authenticate")) {
        const token = String(body.cookie ?? "").split(";").map(value => value.trim()).find(value => value.startsWith(`${cookieName(origin, "session")}=`))?.split("=")[1];
        const memberId = token ? sessions.get(token) : undefined;
        return reply(memberId ? { memberId, eligible: true } : null);
      }
      throw new Error("UNEXPECTED_FIXTURE_HTTP");
    });
    const f = fixture();
    const quota = new HttpEccalQuota(eccalOrigin, serviceToken);
    f.eccal.authenticate = credentials => quota.authenticate(credentials);
    const config = { ...runtime, APP_ORIGIN: origin, ECCAL_ORIGIN: eccalOrigin, ECCAL_SERVICE_TOKEN: serviceToken, ECCAL: f.eccal };
    const request = (path: string, cookie = "", extra: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, { ...extra, headers: { cookie, ...Object.fromEntries(new Headers(extra.headers)) } }), config);
    const login = async (memberId: string) => {
      const start = await request("/auth/login"); expect(start.status).toBe(303);
      const loginCookie = start.headers.get("set-cookie")!.split(";")[0]!;
      const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
      const code = "a".repeat(43); codes.set(code, { memberId, state });
      const response = await request(`/auth/callback?state=${encodeURIComponent(state)}&code=${code}`, loginCookie);
      expect(response.status).toBe(303); expect(response.headers.get("location")).toBe(`${origin}/`);
      const cookie = response.headers.getSetCookie().find(value => value.startsWith(`${cookieName(origin, "session")}=`))!;
      expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure");
      return cookie.split(";")[0]!;
    };
    const memberA = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(await hash("a")));
    const memberB = runtime.MEMBERS.get(runtime.MEMBERS.idFromName(await hash("b")));
    try {
      let callId = "";
      const expected = await runInDurableObject(memberA, async (instance, state) => {
        const store: Store = { get: key => state.storage.get(key), put: (key, value) => state.storage.put(key, value), delete: async key => { await state.storage.delete(key); }, list: prefix => state.storage.list({ prefix }), alarm: at => state.storage.setAlarm(at) };
        const engine = new MemberEngine({ ...f.deps, store });
        (instance as unknown as { engine: MemberEngine }).engine = engine;
        const call = await engine.start({ memberId: "a", eligible: true }, crypto.randomUUID(), "v=0\r\nfixture"); callId = call.id;
        await engine.activate("a", call.id);
        await engine.ingest("a", call.id, { type: "input_audio_buffer.speech_started", event_id: "fixture-audio" });
        await engine.ingest("a", call.id, { type: "conversation.item.input_audio_transcription.completed", item_id: "fixture-user", transcript: "合成成果權限測試：商品頁需要先核對什麼" });
        f.advance(1000); await engine.end("a", call.id);
        const documents = [];
        for (const kind of ["report", "copy", "plan"] as const) documents.push(await engine.document("a", call.id, kind));
        return documents;
      });
      const firstCookie = await login("a");
      const initial = await request(`/api/calls/${callId}`, firstCookie); expect(initial.status).toBe(200);
      expect((await initial.json() as any).documents).toEqual(expected);
      const logout = await request("/auth/logout", firstCookie, { method: "POST", headers: { origin } }); expect(logout.status).toBe(200);
      expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
      const stale = await request(`/api/calls/${callId}`, firstCookie); expect(stale.status).toBe(401);
      const secondCookie = await login("a"), otherCookie = await login("b");
      expect(secondCookie).not.toBe(firstCookie);
      const rows = [];
      for (const document of expected) {
        const link = `${origin}/#call=${callId}&document=${document.id}`;
        const own = await request(`/api/calls/${callId}`, secondCookie);
        expect(own.status).toBe(200); expect(own.headers.get("cache-control")).toBe("no-store");
        expect((await own.json() as any).documents.find((value: any) => value.id === document.id)).toEqual(document);
        const denied = [];
        for (const [identity, cookie, suffix, headers] of [
          ["B", otherCookie, "", {}], ["anonymous", "", "", {}],
          ["email-receipt", "", "?recipient=fixture%40example.invalid&verifiedAt=1", { "x-verified-email": "fixture@example.invalid" }],
          ["line-receipt", "", "?claim=fixture-claim&memberId=a", { authorization: "Bearer fixture-delivery-proof" }],
        ] as const) {
          const response = await request(`/api/calls/${callId}${suffix}`, cookie, { headers });
          expect(response.status).toBe(identity === "B" ? 404 : 401);
          const body = await response.text(); expect(body).not.toContain(document.title); expect(body).not.toContain(document.id); expect(body).not.toContain("documents");
          denied.push({ identity, status: response.status, contentAbsent: true });
        }
        const forged = await request(`/api/calls/other-${callId}`, secondCookie); expect(forged.status).toBe(404);
        rows.push({ kind: document.kind, link: `/#call=fixture-owned-call&document=fixture-${document.kind}`, ownerAfterRelogin: own.status, denied, forgedCall: forged.status, forgedDocument: "Frontend selects only an ID in the current member response" });
        expect(new URL(link).hash).toContain(document.id);
      }
      expect(exchanges).toEqual(["a", "a", "b"]); expect(revoked).toHaveLength(1);
      const receipt = { environment: "Native Workers SQLite; controlled ECCAL HTTP responses and document provider", productionMemberUsed: false, ssoExchanges: exchanges.length, logoutRevocations: revoked.length, revokedSessionStatus: stale.status, sameOwnerAfterRelogin: true, results: rows };
      await expect(JSON.stringify(receipt, null, 2) + "\n").toMatchFileSnapshot("../docs/examples/result-links-validation-2026-11-05.json");
    } finally {
      fetcher.mockRestore();
      for (const stub of [memberA, memberB]) await runInDurableObject(stub, async (_instance, state) => { await state.storage.deleteAll(); await state.storage.deleteAlarm(); });
    }
  });
});
