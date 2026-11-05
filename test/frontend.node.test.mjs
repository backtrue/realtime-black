import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import vm from "node:vm";

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function audio() { let stops = 0; return { getTracks: () => [{ stop() { stops += 1; } }], stops: () => stops }; }
async function page(getUserMedia, startResponse, recordsResponse = [], deliveryResponse, authOptions = {}) {
  class Element {
    listeners = new Map(); textContent = ""; disabled = false; children = []; srcObject = null;
    addEventListener(name, handler) { this.listeners.set(name, handler); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    pause() {} async play() {}
  }
  const elements = new Map(["start", "stop", "speaker", "membership", "call-status", "notice", "records", "refresh", "login", "logout", "mcp-connect", "mcp-revoke"].map(id => [id, new Element()]));
  const requests = [], connections = [], intervals = [], logs = [];
  let authStatus = authOptions.status ?? { authenticated: true, mcpAuthorized: true };
  class Peer {
    connectionState = "new"; remoteDescriptions = [];
    constructor() { connections.push(this); }
    addTrack() {} createDataChannel() { return { close() {} }; }
    async createOffer() { return { type: "offer", sdp: "v=0\r\noffer" }; }
    async setLocalDescription() {}
    async setRemoteDescription(value) { this.remoteDescriptions.push(value); }
    close() { this.connectionState = "closed"; }
  }
  const context = vm.createContext({
    console: { info: (...args) => logs.push(args) },
    document: { getElementById: id => elements.get(id), createElement: () => new Element() },
    navigator: { mediaDevices: { getUserMedia } }, RTCPeerConnection: Peer, crypto: { randomUUID },
    window: { addEventListener() {}, location: { hash: "" } }, URLSearchParams, Date, setInterval: callback => { intervals.push(callback); return intervals.length; }, clearInterval() {},
    fetch: async (path, init) => {
      requests.push({ path, init });
      let data;
      if (path === '/auth/status') data = authStatus;
      else if (path === '/auth/logout') { authStatus = { authenticated: false, mcpAuthorized: false }; data = { loggedOut: true }; }
      else if (path === '/auth/mcp/revoke') { authStatus = { authenticated: true, mcpAuthorized: false }; data = { authorized: false, revocationPending: authOptions.revocationPending === true }; }
      else if (path === "/api/me") data = { eligible: true, remainingSeconds: 300 };
      else if (path === "/api/calls" && init?.method === "POST") data = startResponse ? await startResponse() : { id: "fixture-call", sdp: "v=0\r\nanswer", deadline: Date.now() + 300000 };
      else if (path.endsWith("/end")) data = authOptions.endResponse ? await authOptions.endResponse() : { status: "ended" };
      else if (path.endsWith("/deliveries")) data = deliveryResponse ?? { job: { state: "pending" } };
      else data = recordsResponse;
      return { ok: true, status: path === "/api/calls" && init?.method === "POST" ? 201 : 200, headers: new Headers({ "cache-control": "no-store" }), json: async () => data };
    },
  });
  vm.runInContext(source, context);
  await flush();
  return { elements, requests, connections, logs, click: id => elements.get(id).listeners.get("click")(), tick: () => { for (const callback of intervals) callback(); } };
}

test("發證回應只記錄欄位統計，識別值、SDP、未知欄位與憑證不進紀錄", async () => {
  for (const extra of [{}, { access_token: "private-token-value", "private-field-name": "private-field-value" }]) {
    const p = await page(async () => audio(), async () => ({ id: "private-call-identifier", sdp: "v=0\r\nprivate-sdp-value", deadline: 1790000000123, ...extra }));
    assert.equal(p.logs.length, 0);
    await p.click("start");
    assert.equal(p.logs.length, 1);
    assert.equal(p.logs[0][0], "call_start_response_boundary");
    const audit = JSON.parse(p.logs[0][1]);
    assert.deepEqual(audit.fields, ["deadline", "id", "sdp"]);
    assert.deepEqual(audit.types, { deadline: "number", id: "string", sdp: "string" });
    assert.equal(audit.status, 201);
    assert.equal(audit.cacheControl, "no-store");
    assert.equal(audit.sdpValid, true);
    assert.equal(audit.unexpectedFieldCount, Object.keys(extra).length);
    assert.equal(audit.credentialFieldsAbsent, !Object.keys(extra).length);
    assert.doesNotMatch(JSON.stringify(p.logs), /private-|1790000000123|access_token/);
    await p.click("stop");
    assert.equal(p.logs.length, 1);
  }
});

test("取消等待中的麥克風後重撥，舊授權不建立通話或關掉新麥克風", async () => {
  const first = deferred(), second = deferred();
  let count = 0;
  const p = await page(() => (++count === 1 ? first.promise : second.promise));
  const original = p.click("start");
  await p.click("stop");
  const retry = p.click("start");
  const oldAudio = audio(), newAudio = audio();
  first.resolve(oldAudio); await original;
  assert.equal(oldAudio.stops(), 1);
  assert.equal(p.connections.length, 0);
  second.resolve(newAudio); await retry;
  assert.equal(p.connections.length, 1);
  assert.equal(newAudio.stops(), 0);
  assert.equal(p.requests.filter(request => request.path === "/api/calls" && request.init?.method === "POST").length, 1);
  await p.click("stop"); assert.equal(newAudio.stops(), 1);
});

test("拒絕麥克風時不發開始請求並正確呈現未接通", async () => {
  const p = await page(async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); });
  await p.click("start");
  assert.equal(p.connections.length, 0);
  assert.equal(p.requests.some(request => request.init?.method === "POST"), false);
  assert.match(p.elements.get("notice").textContent, /麥克風權限未開啟/);
  assert.equal(p.elements.get("call-status").textContent, "未接通");
});

test("掛斷立即停止收音播放，等待後端確認後才關閉 WebRTC", async () => {
  const ended = deferred(), stream = audio();
  const p = await page(async () => stream, undefined, [], undefined, { endResponse: () => ended.promise });
  await p.click("start");
  const ending = p.click("stop");
  await flush();
  assert.equal(stream.stops(), 1);
  assert.notEqual(p.connections[0].connectionState, "closed");
  assert.equal(p.elements.get("call-status").textContent, "正在結束通話");
  ended.resolve({ status: "ended" });
  await ending;
  assert.equal(p.connections[0].connectionState, "closed");
  assert.equal(p.elements.get("call-status").textContent, "通話已結束");
});

test("發證請求尚未回來就取消，回應抵達後結束伺服器會話且不播放", async () => {
  const response = deferred(), stream = audio();
  const p = await page(async () => stream, () => response.promise);
  const starting = p.click("start"); await flush();
  const ending = p.click("stop");
  response.resolve({ id: "cancelled-call", sdp: "v=0\r\nanswer", deadline: Date.now() + 300000 });
  await Promise.all([starting, ending]);
  assert.equal(stream.stops(), 1);
  assert.equal(p.connections[0].remoteDescriptions.length, 0);
  assert.equal(p.requests.filter(request => request.path === "/api/calls/cancelled-call/end").length, 1);
});

test("前端不按舊截止提早掛斷，提供者關閉後清理音訊", async () => {
  const stream = audio();
  const p = await page(async () => stream, async () => ({ id: "fixture-call", sdp: "v=0\r\nanswer", deadline: Date.now() - 1000 }));
  await p.click("start"); p.tick(); await flush();
  assert.equal(p.requests.some(request => request.path.endsWith("/end")), false);
  assert.equal(stream.stops(), 0);
  p.connections[0].connectionState = "closed";
  p.connections[0].onconnectionstatechange();
  await flush();
  assert.equal(stream.stops(), 1);
  assert.equal(p.requests.filter(request => request.path.endsWith("/end")).length, 1);
});

test("成果頁可建立 Email 待寄送，僅提交指定信箱與成果", async () => {
  const record = { id: "fixture-call", status: "ended", createdAt: Date.now(), transcript: [], documents: [{ id: "fixture-doc", kind: "report", title: "合成報告", findings: [] }], deliveries: [] };
  const p = await page(async () => audio(), undefined, [record]);
  const walk = node => [node, ...node.children.flatMap(walk)];
  const nodes = walk(p.elements.get("records"));
  const label = nodes.find(node => node.textContent === "接收信箱 "); label.children[0].value = "fixture@example.invalid";
  await nodes.find(node => node.textContent === "寄到 Email").listeners.get("click")();
  const request = p.requests.find(request => request.path.endsWith("/deliveries"));
  const input = JSON.parse(request.init.body);
  assert.equal(input.documentId, "fixture-doc"); assert.equal(input.recipient, "fixture@example.invalid"); assert.equal(input.channel, "email"); assert.equal("verifiedAt" in input, false);
  assert.ok(walk(p.elements.get("records")).some(node => node.textContent === "等待核對與寄送"));
});

test("LINE 領取頁顯示一次性代碼並維持待寄送狀態", async () => {
  const record = { id: "fixture-call", status: "ended", createdAt: Date.now(), transcript: [], documents: [{ id: "fixture-doc", kind: "plan", title: "合成計畫", findings: [] }], deliveries: [] };
  const p = await page(async () => audio(), undefined, [record], { job: { state: "pending" }, claimCode: "fixture-once-code" });
  const walk = node => [node, ...node.children.flatMap(walk)];
  await walk(p.elements.get("records")).find(node => node.textContent === "用 LINE 領取").listeners.get("click")();
  const nodes = walk(p.elements.get("records"));
  assert.ok(nodes.some(node => node.textContent === "fixture-once-code"));
  assert.ok(nodes.some(node => node.textContent === "等待核對與寄送"));
  assert.equal(JSON.parse(p.requests.find(request => request.path.endsWith("/deliveries")).init.body).recipient, "");
});

test('未登入呈現ECCAL登入入口，沒有方法庫授權時不開始通話', async () => {
  let mediaRequests = 0;
  const guest = await page(async () => { mediaRequests += 1; return audio(); }, undefined, [], undefined, { status: { authenticated: false, mcpAuthorized: false } });
  assert.equal(guest.elements.get('login').hidden, false); assert.equal(guest.elements.get('start').disabled, true);
  await guest.click('start'); assert.equal(mediaRequests, 0);
  const member = await page(async () => { mediaRequests += 1; return audio(); }, undefined, [], undefined, { status: { authenticated: true, mcpAuthorized: false } });
  assert.equal(member.elements.get('mcp-connect').hidden, false); assert.equal(member.elements.get('start').disabled, true);
  await member.click('start'); assert.equal(mediaRequests, 0);
});
test('解除授權待確認時不顯示已完成，登出清理會員畫面', async () => {
  const p = await page(async () => audio(), undefined, [], undefined, { revocationPending: true });
  await p.click('mcp-revoke');
  assert.match(p.elements.get('notice').textContent, /正在確認方法庫端的撤銷結果/);
  assert.equal(p.elements.get('mcp-connect').hidden, false); assert.equal(p.elements.get('start').disabled, true);
  await p.click('logout');
  assert.equal(p.elements.get('login').hidden, false); assert.equal(p.elements.get('logout').hidden, true);
  assert.equal(p.elements.get('records').children.length, 0);
});
