const $ = id => document.getElementById(id);
const errors = {
  LOGIN_REQUIRED: "請先登入 ECCAL 會員，再回到這個頁面",
  MEMBER_INELIGIBLE: "目前會員資格無法使用語音顧問",
  QUOTA_EXHAUSTED: "可用通話時間已用完",
  CALL_ALREADY_ACTIVE: "你還有一通進行中的通話，請先結束再撥打",
  ECCAL_NOT_CONFIGURED: "會員服務尚未接通，暫時無法開始通話",
  CALL_NOT_READY: "通話紀錄尚未準備完成，請稍後重新整理",
  TRANSCRIPT_NOT_READY: "逐字稿還在整理，完成後就能產生成果",
  INVALID_DELIVERY_REQUEST: "請確認收件方式與信箱",
  RECIPIENT_INVALID: "請填寫正確的接收信箱",
  RECORD_NOT_FOUND: "找不到這筆通話紀錄，請重新整理清單",
  METHODS_UNAVAILABLE: "小黑的行銷方法暫時無法讀取，請稍後再試",
};
let peer, stream, session, channel;
let responseGenerating = false, audioPlaying = false;
let busy = false;
let eligible = false;
let starting;
let attempt = 0;
async function api(path, init = {}) {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(errors[data.error] ?? "目前無法完成操作，請稍後再試");
  if (path === "/api/calls" && init.method === "POST") {
    const expected = ["deadline", "id", "sdp"];
    const fields = data && typeof data === "object" ? Object.keys(data) : [];
    console.info("call_start_response_boundary", JSON.stringify({
      status: response.status,
      fields: fields.filter(field => expected.includes(field)).sort(),
      unexpectedFieldCount: fields.filter(field => !expected.includes(field)).length,
      types: Object.fromEntries(expected.map(field => [field, typeof data?.[field]])),
      sdpValid: typeof data?.sdp === "string" && data.sdp.startsWith("v=0"),
      cacheControl: response.headers.get("cache-control"),
      credentialFieldsAbsent: !fields.some(field => /key|secret|token|authoriz|callid/i.test(field)),
    }));
  }
  return data;
}
function stopMedia() {
  stream?.getTracks().forEach(track => track.stop()); stream = undefined;
  $("speaker").pause(); $("speaker").srcObject = null;
}
function releaseAudio() {
  stopMedia();
  channel?.close(); channel = undefined;
  peer?.close(); peer = undefined;
  responseGenerating = false; audioPlaying = false;
}
async function membership() {
  try {
    const auth = await api('/auth/status');
    $("login").hidden = auth.authenticated === true;
    $("logout").hidden = auth.authenticated !== true;
    if (auth.authenticated !== true) { eligible = false; $("start").disabled = true; $("membership").textContent = "請先登入 ECCAL 會員"; return; }
    const data = await api("/api/me");
    eligible = data.eligible === true && data.remainingSeconds > 0;
    $("membership").textContent = `剩餘通話時間：${Math.floor(data.remainingSeconds / 60)} 分 ${data.remainingSeconds % 60} 秒`;
    $("start").disabled = !eligible || busy;
  } catch (error) { eligible = false; $("start").disabled = true; $("membership").textContent = error.message; }
}
async function end() {
  attempt += 1;
  const inFlight = starting;
  try {
    if (channel?.readyState === "open") {
      if (responseGenerating) channel.send(JSON.stringify({ type: "response.cancel" }));
      if (audioPlaying) channel.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
    }
  } catch {}
  stopMedia();
  $("stop").disabled = true;
  $("call-status").textContent = "正在結束通話";
  try {
    await inFlight;
    const current = session;
    if (current) {
      const ended = await api(`/api/calls/${current.id}/end`, { method: "POST" }); session = undefined;
      $("call-status").textContent = ended.status === "failed" ? "未接通" : "通話已結束";
    } else $("call-status").textContent = "未接通";
  } catch (error) { $("notice").textContent = error.message; $("call-status").textContent = "正在確認通話結束狀態"; }
  finally { releaseAudio(); if (starting === inFlight) starting = undefined; busy = false; await membership(); await records(); }
}
$("start").addEventListener("click", async () => {
  if (busy || !eligible) return;
  busy = true;
  const ownAttempt = ++attempt;
  $("start").disabled = true; $("stop").disabled = false; $("notice").textContent = "";
  $("call-status").textContent = "正在取得麥克風權限";
  try {
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (ownAttempt !== attempt) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired;
    const connection = new RTCPeerConnection();
    peer = connection;
    for (const track of acquired.getTracks()) connection.addTrack(track, acquired);
    connection.ontrack = event => { if (ownAttempt !== attempt) return; $("speaker").srcObject = event.streams[0]; $("speaker").play().catch(() => { $("notice").textContent = "請允許瀏覽器播放聲音"; }); };
    connection.onconnectionstatechange = () => {
      if (ownAttempt !== attempt) return;
      if (connection.connectionState === "connected") $("call-status").textContent = "已接通，可以開始說話";
      if (["failed", "disconnected", "closed"].includes(connection.connectionState)) void end();
    };
    channel = connection.createDataChannel("oai-events");
    const ownChannel = channel;
    ownChannel.onmessage = event => {
      if (channel !== ownChannel) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "response.created") responseGenerating = true;
        if (message.type === "response.done") responseGenerating = false;
        if (message.type === "output_audio_buffer.started") audioPlaying = true;
        if (["output_audio_buffer.stopped", "output_audio_buffer.cleared"].includes(message.type)) audioPlaying = false;
      } catch {}
    };
    const offer = await connection.createOffer();
    if (ownAttempt !== attempt) return;
    await connection.setLocalDescription(offer);
    if (ownAttempt !== attempt) return;
    $("call-status").textContent = "正在接通 AI 小黑";
    starting = api("/api/calls", { method: "POST", headers: { "content-type": "application/sdp", "idempotency-key": crypto.randomUUID() }, body: offer.sdp });
    session = await starting;
    if (ownAttempt !== attempt) return;
    await connection.setRemoteDescription({ type: "answer", sdp: session.sdp });
    if (ownAttempt !== attempt) return;
  } catch (error) {
    if (ownAttempt !== attempt) return;
    $("notice").textContent = ["NotAllowedError", "PermissionDeniedError"].includes(error.name) ? "麥克風權限未開啟，這次沒有接通" : error.message;
    releaseAudio();
    if (session) { try { await api(`/api/calls/${session.id}/end`, { method: "POST" }); session = undefined; } catch {} }
    $("call-status").textContent = "未接通"; busy = false; $("stop").disabled = true; await membership();
  } finally { if (ownAttempt === attempt) starting = undefined; }
});
$("stop").addEventListener("click", end);
$("logout").addEventListener('click', async () => {
  try { if (busy) await end(); await api('/auth/logout', { method: 'POST' }); await membership(); $("records").replaceChildren(); }
  catch (error) { $("notice").textContent = error.message; }
});
window.addEventListener("pagehide", () => {
  releaseAudio();
  if (session) void fetch(`/api/calls/${session.id}/end`, { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => {});
});
function node(tag, text) { const el = document.createElement(tag); el.textContent = text; return el; }
async function records() {
  try {
    const data = await api("/api/calls");
    const root = $("records"); root.replaceChildren();
    if (!data.length) root.append(node("p", "還沒有通話紀錄"));
    for (const record of data) {
      const article = document.createElement("article");
      article.id = `call-${record.id}`;
      article.append(node("h3", new Date(record.createdAt).toLocaleString("zh-TW")));
      article.append(node("p", { starting: "正在接通", active: "通話中", ending: "正在結算", ended: "通話已結束", failed: "未接通" }[record.status] ?? "正在確認狀態"));
      if (record.pendingTranscripts) article.append(node("p", "逐字稿整理中，完成後會產生摘要"));
      if (record.transcriptionFailures) article.append(node("p", "有部分語音未能辨識，逐字稿未包含這些片段"));
      if (["starting", "active", "ending"].includes(record.status)) {
        const button = node("button", "結束這通通話");
        button.addEventListener("click", async () => { button.disabled = true; try { await api(`/api/calls/${record.id}/end`, { method: "POST" }); await membership(); await records(); } catch (error) { $("notice").textContent = error.message; button.disabled = false; } }); article.append(button);
      }
      const details = document.createElement("details"); details.append(node("summary", "查看逐字稿"));
      for (const line of record.transcript) details.append(node("p", `${line.role === "user" ? "你" : "AI 小黑"}：${line.text}`));
      article.append(details);
      for (const artifact of record.documents) {
        const section = document.createElement("details"); section.append(node("summary", artifact.title));
        section.id = `document-${artifact.id}`;
        for (const finding of artifact.findings) section.append(node("pre", `${{ member: "會員提供", tool: "工具資料", inference: "判斷", recommendation: "建議", unknown: "待確認" }[finding.kind]}：${finding.text}`));
        if (artifact.kind !== "summary") {
          const label = node("label", "接收信箱 ");
          const address = document.createElement("input"); address.type = "email"; address.autocomplete = "email"; label.append(address); section.append(label);
          for (const [channel, title] of [["email", "寄到 Email"], ["line", "用 LINE 領取"]]) {
            const button = node("button", title); button.className = "secondary";
            button.addEventListener("click", async () => {
              if (channel === "email" && !address.value) { $("notice").textContent = "請填寫接收信箱"; return; }
              button.disabled = true;
              try {
                const created = await api(`/api/calls/${record.id}/deliveries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: artifact.id, channel, recipient: channel === "email" ? address.value : "", operationId: crypto.randomUUID() }) });
                section.append(node("p", "等待核對與寄送"));
                if (created.claimCode) { section.append(node("p", "加入「報數據」LINE 官方帳號，傳送以下領取碼")); section.append(node("pre", created.claimCode)); }
              } catch (error) { $("notice").textContent = error.message; button.disabled = false; }
            });
            section.append(button);
          }
        }
        article.append(section);
      }
      for (const delivery of record.deliveries ?? []) article.append(node("p", `${delivery.channel === "email" ? "Email" : "LINE"}：${delivery.failureCode === "DOCUMENT_STALE" ? "內容已更新，請重新申請交付" : { pending: "等待核對與寄送", sending: "正在寄送", unknown: "寄送結果待確認", failed: "寄送失敗", succeeded: "已送出" }[delivery.state]}`));
      if (record.status === "ended") for (const [kind, label] of [["summary", "產生摘要"], ["report", "產生行銷報告"], ["copy", "產生廣告文案"], ["plan", "產生改善計畫"]]) {
        const button = node("button", label); button.className = "secondary";
        button.addEventListener("click", async () => { button.disabled = true; try { await api(`/api/calls/${record.id}/documents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) }); await records(); } catch (error) { $("notice").textContent = error.message; button.disabled = false; } }); article.append(button);
      }
      root.append(article);
    }
    const target = new URLSearchParams(window.location?.hash?.slice(1) ?? "");
    const documentId = target.get("document");
    const callId = target.get("call");
    const selected = documentId ? document.getElementById(`document-${documentId}`) : callId ? document.getElementById(`call-${callId}`) : undefined;
    if (selected) { if (documentId) selected.open = true; selected.scrollIntoView({ block: "start" }); }
    else if (documentId) $("notice").textContent = "找不到這份成果，請確認登入帳號並重新整理";
  } catch (error) { $("records").replaceChildren(node("p", error.message)); }
}
$("refresh").addEventListener("click", records);
const authResult = new URLSearchParams(window.location?.search ?? '').get('auth');
if (authResult === 'login-failed') $("notice").textContent = '登入未完成，請重新登入 ECCAL';
void membership(); void records();
