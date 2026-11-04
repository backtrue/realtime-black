import { vi } from "vitest";
import { MemberEngine } from "../src/member-engine";
import { billedSeconds as calculateBilledSeconds } from "../src/metering";
import { AppError, type CallRecord, type Dependencies, type MeterEvent, type Reservation, type Settlement, type Store } from "../src/contracts";

export function fixture() {
  let now = Date.now();
  const data = new Map<string, unknown>();
  const store: Store = {
    get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
    put: async (key, value) => { data.set(key, structuredClone(value)); },
    delete: async key => { data.delete(key); },
    list: async <T>(prefix: string) => new Map([...data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value) as T])),
    alarm: vi.fn(async () => {}),
  };
  const balances = new Map([["a", 300], ["b", 300]]);
  const reservations = new Map<string, Reservation>();
  const settlements = new Map<string, Settlement>();
  const eccal: Dependencies["eccal"] = {
    authenticate: vi.fn(async credentials => credentials.cookie === "fixture=a" ? { memberId: "a", eligible: true } : null),
    balance: vi.fn(async memberId => balances.get(memberId) ?? 0),
    reserve: vi.fn(async (memberId, operationId) => {
      if (reservations.has(operationId)) return reservations.get(operationId)!;
      const seconds = balances.get(memberId) ?? 0;
      const reservation = { id: operationId, memberId, seconds, deadline: now + seconds * 1000 };
      reservations.set(operationId, reservation);
      return reservation;
    }),
    settle: vi.fn(async (memberId: string, reservationId: string, events: MeterEvent[]) => {
      if (settlements.has(reservationId)) return settlements.get(reservationId)!;
      const reservation = reservations.get(reservationId)!;
      const billedSeconds = calculateBilledSeconds(events, reservation.seconds);
      const remainingSeconds = (balances.get(memberId) ?? 0) - billedSeconds;
      balances.set(memberId, remainingSeconds);
      const settlement = { billedSeconds, remainingSeconds };
      settlements.set(reservationId, settlement);
      return settlement;
    }),
    mcpGrant: vi.fn(async memberId => ({ memberId, accessToken: `fixture-token-${memberId}`, expiresAt: now + 60000, readOnlyTools: ["read_method"] })),
  };
  const realtime = { create: vi.fn(async () => ({ callId: "rtc_fixture", sdp: "v=0\r\nanswer" })), hangup: vi.fn(async () => {}) };
  const mcp = { list: vi.fn(async () => [{ name: "read_method", description: "讀取方法", parameters: { type: "object", properties: {} } }]), call: vi.fn(async () => ({ method: "fixture-only", evidence: "source-1" })) };
  const documents: Dependencies["documents"] = { generate: vi.fn<Dependencies["documents"]["generate"]>(async (kind, record) => ({ kind, title: "測試諮詢", findings: [{ kind: "member", text: "測試會員提供的問題", sourceIds: [record.transcript[0]!.itemId] }] })) };
  const deps: Dependencies = { eccal, realtime, mcp, documents, store, now: () => now, id: () => crypto.randomUUID() };
  const engine = new MemberEngine(deps);
  return { engine, deps, eccal, realtime, mcp, documents, data, store, balances, advance: (milliseconds: number) => { now += milliseconds; }, now: () => now,
    start: async (memberId = "a", operationId = crypto.randomUUID()) => {
      const call = await engine.start({ memberId, eligible: true }, operationId, "v=0\r\nfixture");
      await engine.activate(memberId, call.id);
      return call;
    },
    record: async (id: string) => store.get<CallRecord>(`call:${id}`),
  };
}
export function failure(code: string, status = 503) { return new AppError(code, status); }
