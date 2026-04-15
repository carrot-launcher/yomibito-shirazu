import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";

export const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");

const THRESHOLDS: Record<string, number> = {
  "sexual/minors": 0.3,
  "self-harm/instructions": 0.5,
  "illicit/violent": 0.5,
  "sexual": 0.35,
  "harassment": 0.85,
  "harassment/threatening": 0.85,
  "hate": 0.75,
  "hate/threatening": 0.75,
  "violence": 0.86,
  "violence/graphic": 0.85,
  "self-harm": 0.85,
  "illicit": 0.75,
};

export interface ModerationResult {
  ok: boolean;
  reason?: string;
}

/**
 * OpenAI Moderation API で投稿本文をチェック。
 * API 失敗時は Fail-open（投稿を通す）。
 */
export async function moderate(text: string): Promise<ModerationResult> {
  try {
    const res = await fetch("https://api.openai.com/v1/moderations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY.value()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "omni-moderation-latest",
        input: text,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn("[moderation] OpenAI API non-OK response", { status: res.status });
      return { ok: true };
    }
    const data = (await res.json()) as {
      results: Array<{ category_scores: Record<string, number> }>;
    };
    const scores = data.results?.[0]?.category_scores;
    if (!scores) {
      logger.warn("[moderation] OpenAI API response missing category_scores");
      return { ok: true };
    }
    for (const [cat, threshold] of Object.entries(THRESHOLDS)) {
      const score = scores[cat] ?? 0;
      if (score > threshold) {
        logger.info("[moderation] flagged", { category: cat, score });
        return { ok: false, reason: cat };
      }
    }
    return { ok: true };
  } catch (err) {
    logger.error("[moderation] OpenAI API call failed", err);
    return { ok: true };
  }
}
