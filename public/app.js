const $ = id => document.getElementById(id);
const errors = {
  LOGIN_REQUIRED: "請先登入 ECCAL 會員，再回到這個頁面",
  MEMBER_INELIGIBLE: "目前會員資格無法使用語音顧問",
  QUOTA_EXHAUSTED: "可用通話時間已用完",
  CALL_ALREADY_ACTIVE: "你還有一通進行中的通話，請先結束再撥打",
  ECCAL_NOT_CONFIGURED: "會員服務尚未接通，暫時無法開始通話",
  CALL_NOT_READY: "通話紀錄尚未準備完成，請稍後重新整理",
  TRANSCRIPT_NOT_READY: "逐字稿還在整理，完成後就能產生成果",
  INVALID_DELIVERY_REQUEST: "請確認收件方式後再試一次",
  RECIPIENT_INVALID: "無法核對登入信箱，請重新登入 ECCAL",
  RECIPIENT_UNVERIFIED: "收件人與 ECCAL 登入信箱不符，請重新登入後再試",
  EMAIL_RECIPIENT_UNAVAILABLE: "暫時無法核對 ECCAL 登入信箱，請稍後再試",
  RECORD_NOT_FOUND: "找不到這筆通話紀錄，請重新整理清單",
  METHODS_UNAVAILABLE: "小黑的行銷方法暫時無法讀取，請稍後再試",
};
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
let peer, stream, session, channel;
let responseGenerating = false, audioPlaying = false;
let busy = false, eligible = false, phase = "idle", muted = false;
let starting, attempt = 0, usageTimer, polling = false, ending = false;
let accessMessage = "正在確認會員資格", opener, panel, lastTargetHash;
const fmt = value => {
  const seconds = Math.max(0, Math.ceil(Number(value) || 0));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
function render() {
  $("dialer").dataset.state = phase;
  $("idle-view").hidden = busy;
  $("active-view").hidden = !busy;
  $("start").disabled = !eligible || busy || ending;
  $("history").disabled = busy || ending;
  $("idle-state").textContent = accessMessage;
  $("mute").disabled = phase !== "connected" || !stream;
}
function state(value, text) {
  phase = value;
  $("call-status").textContent = text;
  render();
}
function openPanel(id) {
  if (!panel) opener = document.activeElement?.matches('button,a[href],summary,[tabindex]') ? document.activeElement : $("history");
  if (panel) $(panel).hidden = true;
  panel = id;
  $("dialer-face").inert = true;
  $(id).hidden = false;
  $(id === "records-panel" ? "records-back" : "end-back").focus();
}
function closePanel() {
  if (panel) $(panel).hidden = true;
  panel = undefined;
  $("dialer-face").inert = false;
  const target = opener && !opener.disabled && !opener.hidden && opener.getClientRects().length ? opener : $("history");
  target.focus();
}
for (const id of ["records-panel", "end-panel"]) $(id).addEventListener("keydown", event => {
  if (event.key === "Escape") { event.preventDefault(); closePanel(); }
  if (event.key !== "Tab") return;
  const items = [...$(id).querySelectorAll('button:not(:disabled),a[href],summary,[tabindex="0"]')].filter(item => !item.hidden && item.getClientRects().length);
  const first = items[0], last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
});
$("records-back").addEventListener("click", closePanel);
$("end-back").addEventListener("click", closePanel);
$("history").addEventListener("click", () => { if (!busy && !ending) openPanel("records-panel"); });
$("view-records").addEventListener("click", () => openPanel("records-panel"));
function setMute(value) {
  muted = value;
  for (const track of stream?.getAudioTracks?.() ?? stream?.getTracks() ?? []) track.enabled = !value;
  $("mute").setAttribute("aria-pressed", String(value));
  $("mute-label").textContent = value ? "取消靜音" : "靜音";
  if (phase === "connected") $("call-status").textContent = value ? "麥克風已靜音" : "通話中";
}
$("mute").addEventListener("click", () => { if (phase === "connected" && stream) setMute(!muted); });
function stopMedia() {
  stream?.getTracks().forEach(track => track.stop()); stream = undefined;
  $("speaker").pause(); $("speaker").srcObject = null;
  setMute(false); $("mute").disabled = true;
}
function releaseAudio() {
  stopMedia();
  clearInterval(usageTimer); usageTimer = undefined;
  channel?.close(); channel = undefined;
  if (peer) { peer.onconnectionstatechange = null; peer.ontrack = null; peer.close(); peer = undefined; }
  responseGenerating = false; audioPlaying = false;
}
async function membership() {
  try {
    const auth = await api('/auth/status');
    $("login").hidden = auth.authenticated === true;
    $("logout").hidden = auth.authenticated !== true;
    $("member-label").textContent = auth.authenticated === true ? "ECCAL 會員" : "尚未登入";
    if (auth.authenticated !== true) {
      eligible = false; $("quota").textContent = "--:--";
      accessMessage = "請先登入 ECCAL 會員";
    } else {
      const data = await api("/api/me");
      eligible = data.eligible === true && data.remainingSeconds > 0;
      $("quota").textContent = fmt(data.remainingSeconds);
      accessMessage = data.eligible !== true ? errors.MEMBER_INELIGIBLE : data.remainingSeconds <= 0 ? errors.QUOTA_EXHAUSTED : "";
      $("membership").textContent = accessMessage || `剩餘通話時間：${Math.floor(data.remainingSeconds / 60)} 分 ${data.remainingSeconds % 60} 秒`;
    }
    if (accessMessage) $("membership").textContent = accessMessage;
  } catch (error) { eligible = false; accessMessage = error.message; $("member-label").textContent = "會員確認失敗"; $("membership").textContent = accessMessage; $("quota").textContent = "--:--"; }
  render();
}
function applyUsage(record) {
  if (!record.usage) return;
  $("call-timer").textContent = fmt(record.usage.elapsedSeconds);
  $("meter-status").textContent = record.usage.waitingForTool ? "正在查詢方法，等待時間不計入" : record.usage.audioStarted ? "通話用時由服務端核對" : "第一段音訊後開始計時";
}
async function completed(record) {
  const confirmedAttempt = ++attempt;
  applyUsage(record);
  session = undefined; starting = undefined; ending = false; releaseAudio(); busy = false;
  state("idle", record.status === "failed" ? "未接通" : "通話已結束");
  await membership(); await records();
  if (attempt !== confirmedAttempt || busy) return;
  if (record.status === "ended") {
    $("end-summary").textContent = `本次通話使用 ${fmt(record.settlement?.billedSeconds ?? record.usage?.elapsedSeconds)}，可在通話紀錄查看逐字稿與摘要`;
    openPanel("end-panel");
  } else $("idle-state").textContent = accessMessage || "未接通";
}
async function pollUsage() {
  if (!session || polling && polling.session === session) return;
  const current = session;
  const operation = { session: current };
  polling = operation;
  try {
    const record = await api(`/api/calls/${current.id}`);
    if (session !== current) return;
    applyUsage(record);
    if (["ended", "failed"].includes(record.status)) await completed(record);
    else if (record.status === "ending" && phase !== "ending") { stopMedia(); state("ending", "正在確認通話結束狀態"); $("stop").disabled = false; }
  } catch { if (session === current) $("meter-status").textContent = "正在重新確認服務端用時"; }
  finally { if (polling === operation) polling = false; }
}
function watchUsage() { if (session && !usageTimer) usageTimer = setInterval(pollUsage, 1000); }
async function end() {
  if (ending || !busy && !session && !starting) return;
  const operation = {};
  ending = operation;
  attempt += 1;
  const inFlight = starting;
  try {
    if (channel?.readyState === "open") {
      if (responseGenerating) channel.send(JSON.stringify({ type: "response.cancel" }));
      if (audioPlaying) channel.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
    }
  } catch {}
  stopMedia(); $("stop").disabled = true;
  state("ending", "正在結束通話");
  try {
    await inFlight;
    if (ending !== operation) return;
    if (session) {
      const current = session;
      watchUsage();
      const record = await api(`/api/calls/${current.id}/end`, { method: "POST" });
      if (ending !== operation || session !== current) return;
      if (["ended", "failed"].includes(record.status)) await completed(record);
      else { state("ending", "正在確認通話結束狀態"); $("stop").disabled = false; }
    } else await completed({ status: "failed" });
  } catch (error) {
    if (ending !== operation) return;
    $("notice").textContent = error.message;
    state("ending", "正在確認通話結束狀態"); $("stop").disabled = false;
    watchUsage();
  } finally {
    if (ending === operation) { if (starting === inFlight) starting = undefined; ending = false; render(); }
  }
}
async function startCall() {
  if (busy || ending || !eligible || panel) return;
  busy = true;
  const ownAttempt = ++attempt;
  $("stop").disabled = false; $("notice").textContent = "";
  $("call-timer").textContent = "00:00"; $("meter-status").textContent = "第一段音訊後開始計時";
  state("permission", "正在取得麥克風權限"); $("stop").focus();
  try {
    const acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (ownAttempt !== attempt) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired; setMute(false);
    const connection = new RTCPeerConnection(); peer = connection;
    for (const track of acquired.getTracks()) connection.addTrack(track, acquired);
    connection.ontrack = event => { if (ownAttempt !== attempt) return; $("speaker").srcObject = event.streams[0]; $("speaker").play().catch(() => { $("notice").textContent = "請允許瀏覽器播放聲音"; }); };
    connection.onconnectionstatechange = () => {
      if (ownAttempt !== attempt) return;
      if (connection.connectionState === "connected") { state("connected", "已接通，可以開始說話"); void pollUsage(); }
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
    state("dialing", "正在接通 AI 小黑");
    starting = api("/api/calls", { method: "POST", headers: { "content-type": "application/sdp", "idempotency-key": crypto.randomUUID() }, body: offer.sdp });
    session = await starting;
    if (ownAttempt !== attempt) return;
    await connection.setRemoteDescription({ type: "answer", sdp: session.sdp });
    if (ownAttempt !== attempt) return;
    watchUsage();
  } catch (error) {
    if (ownAttempt !== attempt) return;
    $("notice").textContent = ["NotAllowedError", "PermissionDeniedError"].includes(error.name) ? "麥克風權限未開啟，這次沒有接通" : "連線未完成，請稍後重新撥打";
    if (session) { await end(); return; }
    releaseAudio(); busy = false; $("stop").disabled = true;
    state("idle", "未接通"); await membership(); $("idle-state").textContent = accessMessage || "未接通";
  } finally { if (ownAttempt === attempt) starting = undefined; }
}
let drag, suppressPointerClick = false;
const rotary = $("start");
function resetWheel() { drag = undefined; rotary.removeAttribute("data-dragging"); rotary.style.setProperty("--wheel-turn", "0deg"); }
rotary.addEventListener("click", event => {
  if (suppressPointerClick && event?.detail !== 0) { suppressPointerClick = false; return; }
  suppressPointerClick = false; return startCall();
});
rotary.addEventListener("pointerdown", event => {
  if (rotary.disabled || busy || panel || !event.isPrimary || event.button !== 0) return;
  suppressPointerClick = false;
  const rect = rotary.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  if (Math.hypot(event.clientX - x, event.clientY - y) < rect.width * .22) return;
  drag = { id: event.pointerId, x, y, start: Math.atan2(event.clientY - y, event.clientX - x), amount: 0 };
  rotary.setPointerCapture(event.pointerId); rotary.setAttribute("data-dragging", "");
});
rotary.addEventListener("pointermove", event => {
  if (!drag || event.pointerId !== drag.id) return;
  const angle = Math.atan2(event.clientY - drag.y, event.clientX - drag.x) - drag.start;
  drag.amount = Math.atan2(Math.sin(angle), Math.cos(angle)) * 180 / Math.PI;
  rotary.style.setProperty("--wheel-turn", `${Math.max(-6, Math.min(125, drag.amount))}deg`);
});
rotary.addEventListener("pointerup", event => {
  if (!drag || event.pointerId !== drag.id) return;
  const amount = drag.amount; resetWheel();
  if (Math.abs(amount) > 8) { suppressPointerClick = true; if (amount >= 28) return startCall(); }
});
rotary.addEventListener("pointercancel", () => { if (drag) suppressPointerClick = true; resetWheel(); });
rotary.addEventListener("lostpointercapture", resetWheel);
$("stop").addEventListener("click", end);
$("logout").addEventListener('click', async () => {
  try {
    if (busy) await end();
    if (session) return;
    await api('/auth/logout', { method: 'POST' });
    closePanel(); await membership(); $("records").replaceChildren();
  } catch (error) { $("notice").textContent = error.message; }
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
          section.append(node("p", "Email 成果會寄到你的 ECCAL 登入信箱"));
          for (const [channel, title] of [["email", "寄到 Email"], ["line", "用 LINE 領取"]]) {
            const button = node("button", title); button.className = "secondary";
            const operationId = crypto.randomUUID();
            button.addEventListener("click", async () => {
              button.disabled = true;
              try {
                const created = await api(`/api/calls/${record.id}/deliveries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ documentId: artifact.id, channel, recipient: "", operationId }) });
                const sent = channel === "email" ? await api(`/api/calls/${record.id}/deliveries/${created.job.id}/email`, { method: "POST" }) : created.job;
                section.append(node("p", { pending: "等待核對與寄送", sending: "正在寄送", unknown: "寄送結果待確認，請勿重複寄送", failed: "寄送失敗", succeeded: "已送出" }[sent.state]));
                if (created.claimCode) { section.append(node("p", "加入「ToldYou 報數據」（@791vlxya），在 LINE 傳送以下領取碼")); const join = node('a', '開啟 ToldYou 報數據'); join.href = 'https://line.me/R/ti/p/@791vlxya'; join.target = '_blank'; join.rel = 'noreferrer'; section.append(join); section.append(node("pre", created.claimCode)); }
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
    if (selected) {
      if (lastTargetHash !== window.location.hash) { openPanel("records-panel"); lastTargetHash = window.location.hash; }
      if (documentId) selected.open = true;
      selected.scrollIntoView({ block: "nearest" });
    }
    else if (documentId) $("notice").textContent = "找不到這份成果，請確認登入帳號並重新整理";
  } catch (error) { $("records").replaceChildren(node("p", error.message)); }
}
$("refresh").addEventListener("click", records);
window.addEventListener("hashchange", () => { lastTargetHash = undefined; void records(); });
const authResult = new URLSearchParams(window.location?.search ?? '').get('auth');
if (authResult === 'login-failed') $("notice").textContent = '登入未完成，請重新登入 ECCAL';
void membership(); void records();
