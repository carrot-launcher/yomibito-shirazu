/**
 * OpenAI Moderation API のスコアを確認するためのローカルツール。
 *
 * 実行方法:
 *   export OPENAI_API_KEY=sk-...
 *   cd functions
 *   npx ts-node src/scripts/testModeration.ts "テストしたい文字列"
 *
 * 複数文をまとめてテストしたい場合は、1行ずつスペース区切りで渡す:
 *   npx ts-node src/scripts/testModeration.ts "歌A" "歌B" "歌C"
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// openaiModeration.ts と同期して保つこと
const THRESHOLDS: Record<string, number> = {
  "sexual/minors": 0.3,
  "self-harm/instructions": 0.5,
  "illicit/violent": 0.5,
  sexual: 0.35,
  harassment: 0.85,
  "harassment/threatening": 0.85,
  hate: 0.75,
  "hate/threatening": 0.75,
  violence: 0.86,
  "violence/graphic": 0.85,
  "self-harm": 0.85,
  illicit: 0.75,
};

const BAR_WIDTH = 20;

function scoreBar(score: number): string {
  const filled = Math.round(score * BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

async function checkOne(text: string): Promise<void> {
  const res = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "omni-moderation-latest", input: text }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API status=${res.status} body=${body}`);
  }
  const data = (await res.json()) as {
    results: Array<{
      flagged: boolean;
      categories: Record<string, boolean>;
      category_scores: Record<string, number>;
    }>;
  };
  const result = data.results[0];
  const scores = result.category_scores;

  console.log("\n" + "=".repeat(70));
  console.log(`input: ${text}`);
  console.log("=".repeat(70));

  // 閾値ありのカテゴリと、閾値なしのカテゴリ（参考表示）を分ける
  const thresholded = Object.keys(THRESHOLDS);
  const others = Object.keys(scores).filter((k) => !thresholded.includes(k));

  let rejected = false;
  let maxMargin = -Infinity;
  let maxMarginCat = "";

  console.log("\n  [閾値付きカテゴリ]");
  for (const cat of thresholded) {
    const score = scores[cat] ?? 0;
    const threshold = THRESHOLDS[cat];
    const hit = score > threshold;
    const marker = hit ? "❌ NG" : "✓  OK";
    const margin = score - threshold;
    if (hit) rejected = true;
    if (!hit && margin > maxMargin) {
      maxMargin = margin;
      maxMarginCat = cat;
    }
    console.log(
      `  ${padRight(cat, 26)} ${score.toFixed(4)} ${scoreBar(score)} [th ${threshold}] ${marker}` +
        (hit ? ` (超過 +${margin.toFixed(4)})` : "")
    );
  }

  if (others.length > 0) {
    console.log("\n  [閾値なしカテゴリ（参考表示）]");
    for (const cat of others) {
      const score = scores[cat] ?? 0;
      console.log(`  ${padRight(cat, 26)} ${score.toFixed(4)} ${scoreBar(score)}`);
    }
  }

  console.log("\n  " + "-".repeat(50));
  if (rejected) {
    console.log("  判定: ❌ 拒否（上記の NG カテゴリによる）");
  } else {
    console.log("  判定: ✓ 通過");
    if (maxMarginCat) {
      console.log(
        `    最も閾値に近いカテゴリ: ${maxMarginCat} (余裕 ${Math.abs(maxMargin).toFixed(4)})`
      );
    }
  }
}

async function main(): Promise<void> {
  if (!OPENAI_API_KEY) {
    console.error("ERROR: OPENAI_API_KEY 環境変数が設定されていません。");
    console.error("  firebase functions:secrets:access OPENAI_API_KEY で取得して export してください。");
    process.exit(1);
  }
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) {
    console.error("使い方: npx ts-node src/scripts/testModeration.ts \"テスト文字列1\" [\"テスト文字列2\" ...]");
    process.exit(1);
  }
  for (const input of inputs) {
    try {
      await checkOne(input);
    } catch (err) {
      console.error(`\nERROR for input "${input}":`, err);
    }
  }
}

main();
