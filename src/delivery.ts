import { AppError, type CallRecord, type DeliveryPort, type DeliveryResult, type EmailFailureCode } from "./contracts";

export function boundedDelivery(port: DeliveryPort): DeliveryPort {
  const call = async <T>(operation: () => Promise<T>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([operation(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new AppError("DELIVERY_UNAVAILABLE")), 10000); })]); }
    finally { clearTimeout(timer); }
  };
  return { verify: (job, proof) => call(() => port.verify(job, proof)), send: (job, resultUrl) => call(() => port.send(job, resultUrl)) };
}

export type DeliveryState = "pending" | "sending" | "unknown" | "failed" | "succeeded";
export type Delivery = {
  id: string; memberId: string; documentId: string; channel: "email" | "line";
  recipient: string; verifiedAt: number | null; state: DeliveryState;
  providerReceipt?: string; claimedAt?: number;
  failureCode?: "DOCUMENT_STALE" | EmailFailureCode; providerStatus?: number;
};
export type { DeliveryResult } from "./contracts";
export async function sendDelivery(delivery: Delivery, send: (delivery: Delivery) => Promise<DeliveryResult>, persist: (delivery: Delivery) => Promise<void>, supervised = false) {
  if (delivery.verifiedAt === null) throw new AppError("RECIPIENT_UNVERIFIED", 403);
  if (delivery.channel === "line" && !supervised) throw new AppError("LINE_SUPERVISION_REQUIRED", 403);
  if (delivery.state !== "pending") throw new AppError("DELIVERY_ALREADY_ATTEMPTED", 409);
  delivery.state = "sending";
  await persist(delivery);
  let result: DeliveryResult;
  try { result = await send(delivery); } catch { result = { outcome: "unknown" }; }
  if (!result) result = { outcome: "unknown" };
  if (result.outcome === "sent" && typeof result.receipt === "string" && result.receipt) { delivery.state = "succeeded"; delivery.providerReceipt = result.receipt; }
  else {
    delivery.state = result.outcome === "rejected" ? "failed" : "unknown";
    if (result.outcome !== "sent") { delivery.failureCode = result.failureCode; delivery.providerStatus = result.providerStatus; }
  }
  await persist(delivery);
  return delivery;
}
export function redeemClaim(claim: { memberId: string; deliveryId: string; digest: string; expiresAt: number; usedAt: number | null }, input: { memberId: string; deliveryId: string; digest: string; now: number }) {
  if (claim.memberId !== input.memberId || claim.deliveryId !== input.deliveryId || claim.digest !== input.digest || claim.expiresAt <= input.now || claim.usedAt !== null) throw new AppError("CLAIM_INVALID", 403);
  return { ...claim, usedAt: input.now };
}
export function handoff(record: CallRecord) {
  const summary = record.documents.find(document => document.kind === "summary" && document.sourceRevision === record.transcriptRevision);
  if (!summary) throw new AppError("SUMMARY_REQUIRED", 409);
  return {
    memberId: record.memberId,
    problemSummary: summary.title,
    confirmedFacts: summary.findings.filter(finding => ["member", "tool"].includes(finding.kind)),
    aiDiagnosis: summary.findings.filter(finding => ["inference", "recommendation"].includes(finding.kind)),
    documents: record.documents.filter(document => document.kind !== "summary" && document.sourceRevision === record.transcriptRevision),
    pendingQuestions: summary.findings.filter(finding => finding.kind === "unknown"),
  };
}
