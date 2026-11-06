import { AppError, type CallRecord, type MeterEvent, type Reservation } from "./contracts";

// 會員授權與 MCP 各最多等待 10 秒
export const TOOL_WAIT_LIMIT_MS = 20000;

function timeline(events: MeterEvent[], until: number) {
  if (!Number.isSafeInteger(until) || events.some(event => !Number.isSafeInteger(event.at))) throw new AppError("METER_EVENTS_INVALID");
  const unique = [...new Map(events.map(event => [event.id, event])).values()].sort((a, b) => a.at - b.at);
  const connected = unique.find(event => event.type === "connected")?.at;
  const end = Math.min(until, unique.find(event => event.type === "ended")?.at ?? until);
  const starts = new Map<string, number>();
  const intervals: Array<[number, number]> = [];
  for (const event of unique) {
    if (event.at > end) break;
    if (event.type === "tool_started") {
      const key = event.toolCallId ?? event.id.replace(/^tool-start:/, "");
      if (!starts.has(key)) starts.set(key, event.at);
    }
    if (event.type === "tool_finished") {
      const key = event.toolCallId ?? event.id.replace(/^tool-end:/, "");
      const start = starts.get(key);
      if (start !== undefined) { intervals.push([start, event.at]); starts.delete(key); }
    }
  }
  for (const start of starts.values()) intervals.push([start, end]);
  intervals.sort((a, b) => a[0] - b[0]);
  let waiting = 0;
  let coveredUntil = connected ?? end;
  for (const [from, to] of intervals) {
    const left = Math.max(from, connected ?? end, coveredUntil);
    const right = Math.min(to, end);
    if (right > left) waiting += right - left;
    coveredUntil = Math.max(coveredUntil, right);
  }
  return { elapsed: connected === undefined ? 0 : Math.max(0, end - connected - waiting), connected, openTools: [...starts.values()] };
}

export function billedSeconds(events: MeterEvent[], reservedSeconds: number): number {
  const ended = events.find(event => event.type === "ended");
  if (!ended || !Number.isSafeInteger(reservedSeconds) || reservedSeconds < 0) throw new AppError("METER_EVENTS_INVALID");
  return Math.min(reservedSeconds, Math.ceil(timeline(events, ended.at).elapsed / 1000));
}

export function callUsage(record: Pick<CallRecord, "events" | "reservation" | "settlement">, now: number) {
  const state = timeline(record.events, now);
  return {
    elapsedSeconds: record.settlement?.billedSeconds ?? Math.min(record.reservation.seconds, Math.ceil(state.elapsed / 1000)),
    audioStarted: state.connected !== undefined,
    waitingForTool: !record.events.some(event => event.type === "ended") && state.openTools.length > 0,
  };
}

export function callDeadline(record: { events: MeterEvent[]; reservation: Reservation }, now: number): number {
  const state = timeline(record.events, now);
  if (state.connected === undefined) return record.reservation.deadline;
  const remaining = Math.max(0, record.reservation.seconds * 1000 - state.elapsed);
  if (remaining === 0) return now;
  if (state.openTools.length) return Math.min(...state.openTools) + TOOL_WAIT_LIMIT_MS + remaining;
  return now + remaining;
}
