import { describe, expect, it } from "vitest";
import { handoff } from "../src/delivery";
import { consultation } from "./fixtures/handoff-consultation";

describe("M2-11 真人交接樣本", () => {
  it("六類資料可核對回同次諮詢與三類成果", () => {
    const result = handoff(structuredClone(consultation));
    expect(result.memberId).toBe("fixture-member-a");
    expect(result.problemSummary).toContain("購物車到訂單流失");
    expect(result.confirmedFacts.map(item => item.kind)).toEqual(["member", "tool"]);
    expect(result.aiDiagnosis.map(item => item.kind)).toEqual(["inference", "recommendation"]);
    expect(result.documents.map(item => item.kind)).toEqual(["report", "copy", "plan"]);
    expect(result.pendingQuestions.map(item => item.kind)).toEqual(["unknown"]);
    const sourceIds = new Set([...consultation.transcript.map(item => item.itemId), ...consultation.tools.map(item => item.id)]);
    for (const finding of [...result.confirmedFacts, ...result.aiDiagnosis, ...result.pendingQuestions, ...result.documents.flatMap(document => document.findings)]) {
      for (const id of finding.sourceIds) expect(sourceIds.has(id)).toBe(true);
    }
    expect(result.confirmedFacts.some(item => item.text.includes("流失原因"))).toBe(false);
    expect(result.pendingQuestions[0]?.text).toContain("原因尚未確認");
  });
  it("沒有目前版本摘要時不產生交接", () => {
    const record = structuredClone(consultation);
    record.transcriptRevision += 1;
    expect(() => handoff(record)).toThrow("SUMMARY_REQUIRED");
  });
  it("排除舊版本成果", () => {
    const record = structuredClone(consultation);
    record.documents = record.documents.map(document => document.kind === "report" ? { ...document, sourceRevision: 2 } : document);
    expect(handoff(record).documents.map(document => document.kind)).toEqual(["copy", "plan"]);
  });
});
