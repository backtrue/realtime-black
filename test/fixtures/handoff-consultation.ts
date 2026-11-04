import type { CallRecord, Finding, Document } from "../../src/contracts";

const startedAt = Date.parse("2026-11-04T04:00:00Z");
const memberFacts: Finding = { kind: "member", text: "測試商品 A 為單口 65W USB-C 桌面充電座，售價 1500 元；測試期間有 100 次到站、10 次加入購物車及 1 筆訂單", sourceIds: ["fixture-user-1"] };
const method: Finding = { kind: "tool", text: "受控測試方法要求分開核對到站、加入購物車與結帳階段，並保留資料缺口", sourceIds: ["fixture-tool-1"] };
const diagnosis: Finding = { kind: "inference", text: "這組測試資料的購物車到訂單比例為 10%，可先檢查結帳階段；目前沒有資料能確認流失原因", sourceIds: ["fixture-user-1", "fixture-tool-1"] };
const action: Finding = { kind: "recommendation", text: "先在每週 4 小時的限制內檢查運費、付款與結帳事件，再依查核結果安排下一步", sourceIds: ["fixture-user-2", "fixture-tool-1"] };
const unknown: Finding = { kind: "unknown", text: "運費呈現方式與使用者放棄結帳的原因尚未確認", sourceIds: ["fixture-user-2"] };
function document(id: string, kind: Document["kind"], title: string, findings: Finding[]): Document {
  return { id, kind, title, findings, createdAt: startedAt + 125000, sourceRevision: 3 };
}

export const consultation: CallRecord = {
  id: "fixture-handoff-call", memberId: "fixture-member-a", operationId: "fixture-handoff-operation",
  reservation: { id: "fixture-handoff-reservation", memberId: "fixture-member-a", seconds: 300, deadline: startedAt + 300000 },
  callId: "rtc_fixture_handoff", status: "ended", createdAt: startedAt, endedAt: startedAt + 125000, expiresAt: startedAt + 125000 + 30 * 86400000,
  events: [{ id: "fixture-meter-1", type: "reserved", at: startedAt }, { id: "fixture-meter-2", type: "connected", at: startedAt + 5000 }, { id: "fixture-meter-3", type: "ended", at: startedAt + 125000 }],
  settlement: { billedSeconds: 120, remainingSeconds: 180 },
  transcript: [
    { itemId: "fixture-user-1", role: "user", text: "測試商品 A 是單口 65W USB-C 桌面充電座，售價 1500 元。測試期間有 100 次到站、10 次加入購物車、1 筆訂單，我想知道要先改善哪裡", at: startedAt + 5000 },
    { itemId: "fixture-assistant-1", role: "assistant", text: "我先核對漏斗各階段，還需要知道你能投入的時間，以及運費和結帳流程的情況", at: startedAt + 35000 },
    { itemId: "fixture-user-2", role: "user", text: "目前只有我執行，每週能投入 4 小時，運費呈現方式與放棄結帳原因還不知道", at: startedAt + 65000 },
  ],
  itemOrder: [{ id: "fixture-user-1", previousId: null }, { id: "fixture-assistant-1", previousId: "fixture-user-1" }, { id: "fixture-user-2", previousId: "fixture-assistant-1" }],
  transcriptRevision: 3, pendingTranscripts: [], transcriptionFailures: [],
  tools: [{ id: "fixture-tool-1", name: "fixture_read_funnel_method", result: { source: "受控測試回應", text: method.text } }],
  toolResults: {}, deliveries: [],
  documents: [
    document("fixture-summary", "summary", "測試商品 A 的購物車到訂單流失，應在每週 4 小時內優先改善什麼", [memberFacts, method, diagnosis, action, unknown]),
    document("fixture-report", "report", "測試漏斗現況與優先查核項目", [memberFacts, diagnosis, unknown]),
    document("fixture-copy", "copy", "測試商品 A 廣告文案", [{ kind: "recommendation", text: "桌面補電，先看清楚規格。測試商品 A：單口 65W USB-C 桌面充電座，售價 NT$1,500，查看商品規格與購買資訊", sourceIds: ["fixture-user-1"] }]),
    document("fixture-plan", "plan", "每週 4 小時的結帳改善查核", [action, unknown]),
  ],
};
