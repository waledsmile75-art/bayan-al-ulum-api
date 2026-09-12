import type { Evidence, RetrievalResult, VerificationResult } from "./types";

const numberPattern = /\b\d+(?:\.\d+)?\b/g;
const unitPattern = /\b(?:mg|kg|weeks?|days?|years?|participants?|people|subjects?)\b/gi;

function numbers(text: string): string[] { return text.match(numberPattern) ?? []; }
function normalized(text: string): string { return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim(); }
function tokens(text: string): Set<string> { return new Set(normalized(text).split(" ").filter((x) => x.length > 2)); }
function overlap(a: string, b: string): number {
  const A = tokens(a); const B = tokens(b); if (!A.size || !B.size) return 0;
  let common = 0; for (const token of A) if (B.has(token)) common += 1;
  return common / Math.max(A.size, B.size);
}

export function detectContradictions(claim: string, evidence: Evidence[]): VerificationResult["contradictions"] {
  const result: VerificationResult["contradictions"] = [];
  const pairs: Array<[Evidence, Evidence]> = [];
  for (let i = 0; i < evidence.length; i += 1) for (let j = i + 1; j < evidence.length; j += 1) pairs.push([evidence[i], evidence[j]]);
  for (const item of evidence) {
    const sentences = item.text.split(/(?<=[.!?])\s+/).filter(Boolean);
    for (let i = 0; i < sentences.length; i += 1) for (let j = i + 1; j < sentences.length; j += 1) pairs.push([{ ...item, text: sentences[i] }, { ...item, text: sentences[j] }]);
  }
  for (const [left, right] of pairs) {
      const a = left.text; const b = right.text;
      const na = numbers(a); const nb = numbers(b);
      if (!na.length || !nb.length || na.join(",") === nb.join(",")) continue;
      const shared = overlap(a, b);
      const contextDifference = /final analysis|completed|baseline|follow[- ]?up|subgroup|treatment group/i.test(`${a} ${b}`);
      if (shared >= 0.25 && contextDifference) {
        result.push({ contradictionType: "contextual_difference", claimScope: claim, evidenceA: a, evidenceB: b, explanation: "الأرقام تصف مجموعتين أو مرحلتين مختلفتين؛ لا يصح دمجها كإجابة واحدة." });
      } else if (shared >= 0.65) {
        result.push({ contradictionType: "direct_conflict", claimScope: claim, evidenceA: a, evidenceB: b, explanation: "النصان يقدمان رقمين مختلفين ضمن النطاق نفسه للادعاء." });
      }
    }
  return result;
}

export function verifyClaim(claim: string, evidence: Evidence[]): VerificationResult {
  if (!evidence.length) return { status: "Insufficient Evidence", answer: "لم أجد في المصادر المتاحة دليلًا كافيًا للإجابة عن هذه النقطة.", confidenceScore: 0, confidenceReasons: ["لم يتم العثور على Evidence مرتبط بالسؤال"], evidence: [], contradictions: [] };
  const contradictions = detectContradictions(claim, evidence);
  const direct = evidence.filter((e) => e.directnessScore >= 0.5 && e.relevanceScore >= 0.45);
  const partial = evidence.filter((e) => e.directnessScore >= 0.35 && e.relevanceScore >= 0.25);
  const claimNumbers = numbers(claim);
  const numericEvidence = evidence.filter((e) => claimNumbers.every((n) => numbers(e.text).includes(n)));
  const hasInferenceLanguage = /prove|caus|effective|سبب|يثبت|يثبت أن|فعّال/i.test(claim);
  const units = unitPattern.test(claim) ? claim.match(unitPattern)?.join(" ") : "";
  const reasons = [
    `relevance=${Math.max(...evidence.map((e) => e.relevanceScore)).toFixed(2)}`,
    `directness=${Math.max(...evidence.map((e) => e.directnessScore)).toFixed(2)}`,
    `coverage=${(numericEvidence.length / Math.max(1, evidence.length)).toFixed(2)}`,
    `source_quality=${evidence[0].sourceQuality}`,
  ];
  if (Math.max(...evidence.map((e) => e.relevanceScore)) < 0.32 || Math.max(...evidence.map((e) => e.directnessScore)) < 0.22) return { status: "Insufficient Evidence", answer: "لم أجد في المصادر المتاحة دليلًا كافيًا للإجابة عن هذه النقطة.", confidenceScore: 0.12, confidenceReasons: [...reasons, "retrieval_relevance_below_verification_threshold"], evidence: [], contradictions: [] };
  if (contradictions.some((c) => c.contradictionType === "direct_conflict")) return { status: "Contradicted", answer: "توجد أدلة متعارضة ضمن النطاق نفسه؛ لا يمكن اختيار رقم واحد دون توضيح المصدر.", confidenceScore: 0.72, confidenceReasons: [...reasons, "direct_conflict_detected"], evidence, contradictions };
  if (hasInferenceLanguage && direct.length) return { status: "Analytical Inference", answer: "تسمح الأدلة باستنتاج تحليلي، لكنها لا تثبت النتيجة كحقيقة مصدرية مباشرة.", confidenceScore: 0.58, confidenceReasons: [...reasons, "claim_requires_causal_or_inferential_reasoning"], evidence, contradictions };
  if (contradictions.some((c) => c.contradictionType === "contextual_difference")) return { status: "Partially Supported", answer: "الأدلة متوافقة جزئيًا لكنها تتناول سياقات مختلفة، لذا لا توجد إجابة رقمية واحدة دون تحديد النطاق.", confidenceScore: 0.64, confidenceReasons: [...reasons, "contextual_difference_detected"], evidence, contradictions };
  if (direct.length && (!claimNumbers.length || numericEvidence.length)) {
    const answer = direct[0].text;
    return { status: "Verified", answer, confidenceScore: Math.min(0.96, 0.55 + direct[0].relevanceScore * 0.25 + direct[0].directnessScore * 0.2), confidenceReasons: [...reasons, units ? `unit_preserved=${units}` : "direct_evidence"], evidence, contradictions };
  }
  if (partial.length) return { status: "Partially Supported", answer: partial[0].text, confidenceScore: 0.5, confidenceReasons: [...reasons, "partial_coverage"], evidence, contradictions };
  return { status: "Unverified", answer: "توجد إشارات ذات صلة، لكن العلاقة مع الادعاء غير كافية للتحقق.", confidenceScore: 0.28, confidenceReasons: [...reasons, "weak_claim_evidence_relationship"], evidence, contradictions };
}
