/**
 * process_summary_queue.ts
 * LLM要約待ちキューを処理してコメントを更新
 * 定期的に実行され、少量ずつ処理（レート制限対策）
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Octokit } from "@octokit/rest";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const LEGISLATORS_DIR = path.join(DATA_DIR, "index", "legislators");
const SUMMARY_QUEUE_FILE = path.join(LEGISLATORS_DIR, "pending_summaries.json");

// GitHub API（Issues更新用）
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
// GitHub Models API（LLM要約用、専用トークンを優先）
const GITHUB_MODELS_TOKEN = process.env.GITHUB_MODELS_TOKEN || process.env.GITHUB_TOKEN;
const GITHUB_MODELS_URL = "https://models.inference.ai.azure.com/chat/completions";

// 1回の実行で処理する最大件数（デフォルト30件、約1分で完了）
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "30", 10);

interface PendingSummary {
  issue_number: number;
  comment_id: number;
  speech: string;
  created_at: string;
}

interface SummaryQueue {
  updated_at: string;
  pending: PendingSummary[];
}

// キューを読み込み
function loadSummaryQueue(): SummaryQueue {
  try {
    if (fs.existsSync(SUMMARY_QUEUE_FILE)) {
      return JSON.parse(fs.readFileSync(SUMMARY_QUEUE_FILE, "utf-8"));
    }
  } catch (e) {
    console.log("⚠️ 要約キューの読み込みに失敗");
  }
  return { updated_at: new Date().toISOString(), pending: [] };
}

// キューを保存
function saveSummaryQueue(queue: SummaryQueue): void {
  queue.updated_at = new Date().toISOString();
  fs.writeFileSync(SUMMARY_QUEUE_FILE, JSON.stringify(queue, null, 2), "utf-8");
}

// LLMで要約を生成（GitHub Models API）
async function generateSummaryWithLLM(speech: string): Promise<string | null> {
  if (!GITHUB_MODELS_TOKEN) {
    console.log("    ⚠️ LLM要約: トークン未設定（GITHUB_MODELS_TOKEN または GITHUB_TOKEN）");
    return null;
  }

  try {
    const truncatedSpeech = speech.length > 2000 ? speech.slice(0, 2000) + "..." : speech;

    const response = await axios.post(
      GITHUB_MODELS_URL,
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "あなたは国会議事録の要約を行うアシスタントです。発言者の主張・立場・結論を1-2文（100文字以内）で簡潔に要約してください。"
          },
          {
            role: "user",
            content: `以下の国会での発言を要約してください:\n\n${truncatedSpeech}`
          }
        ],
        temperature: 0.3,
        max_tokens: 150,
      },
      {
        headers: {
          "Authorization": `Bearer ${GITHUB_MODELS_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 15000
      }
    );

    const text = response.data?.choices?.[0]?.message?.content;
    if (text) {
      return text.trim().replace(/\n/g, " ").slice(0, 200);
    }
  } catch (error: any) {
    if (error.response?.status === 429) {
      console.log("    ⚠️ レート制限に達しました");
      return null;
    }
    console.log(`    ⚠️ LLM要約生成失敗: ${error.message}`);
  }
  return null;
}

// コメント本文から要約部分を更新
function updateCommentBodyWithSummary(originalBody: string, newSummary: string): string {
  // 新フォーマット: > 📝 キーワード要約 → > 🤖 LLM要約
  // 旧フォーマット: > キーワード要約 → > LLM要約 🤖

  // blockquote（> で始まる行）を探して置換
  const lines = originalBody.split("\n");
  let inBlockquote = false;
  let blockquoteStart = -1;
  let blockquoteEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("> ")) {
      if (!inBlockquote) {
        inBlockquote = true;
        blockquoteStart = i;
      }
      blockquoteEnd = i;
    } else if (inBlockquote && lines[i].trim() === "") {
      break;
    } else if (inBlockquote) {
      break;
    }
  }

  if (blockquoteStart >= 0) {
    // blockquote部分を新しい要約で置換（🤖マーカーでLLM要約を示す）
    const before = lines.slice(0, blockquoteStart);
    const after = lines.slice(blockquoteEnd + 1);
    return [...before, `> 🤖 ${newSummary}`, ...after].join("\n");
  }

  return originalBody;
}

async function main(): Promise<void> {
  console.log("🤖 LLM要約キュー処理");
  console.log("=".repeat(50));

  if (!GITHUB_TOKEN) {
    console.log("❌ GITHUB_TOKEN が設定されていません");
    return;
  }

  const repoFullName = process.env.GITHUB_REPOSITORY || "DaisukeHori/japan-law";
  const [owner, repo] = repoFullName.split("/");

  console.log(`📦 リポジトリ: ${owner}/${repo}`);
  console.log(`📊 バッチサイズ: ${BATCH_SIZE} 件`);

  const octokit = new Octokit({ auth: GITHUB_TOKEN });
  const queue = loadSummaryQueue();

  console.log(`\n📋 キュー状態: ${queue.pending.length} 件待ち`);

  if (queue.pending.length === 0) {
    console.log("✅ 処理待ちの要約はありません");
    return;
  }

  // 古いものから処理
  const toProcess = queue.pending.slice(0, BATCH_SIZE);
  let processed = 0;
  let failed = 0;

  console.log(`\n🚀 ${toProcess.length} 件を処理中...`);

  for (const item of toProcess) {
    try {
      // 現在のコメントを取得
      const comment = await octokit.issues.getComment({
        owner,
        repo,
        comment_id: item.comment_id,
      });

      // LLM要約を生成
      const summary = await generateSummaryWithLLM(item.speech);

      if (summary) {
        // コメントを更新
        const newBody = updateCommentBodyWithSummary(comment.data.body || "", summary);

        await octokit.issues.updateComment({
          owner,
          repo,
          comment_id: item.comment_id,
          body: newBody,
        });

        console.log(`  ✅ Issue #${item.issue_number} コメント更新完了`);
        processed++;

        // 処理済みをキューから削除
        queue.pending = queue.pending.filter(p => p.comment_id !== item.comment_id);
      } else {
        console.log(`  ⚠️ Issue #${item.issue_number} 要約生成スキップ`);
        failed++;
      }

      // レート制限対応（2秒間隔）
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error: any) {
      console.log(`  ❌ Issue #${item.issue_number} 処理失敗: ${error.message}`);
      failed++;

      // コメントが削除されている場合はキューから除去
      if (error.status === 404) {
        queue.pending = queue.pending.filter(p => p.comment_id !== item.comment_id);
      }
    }
  }

  // キューを保存
  saveSummaryQueue(queue);

  console.log("\n" + "=".repeat(50));
  console.log("📈 結果:");
  console.log(`  処理完了: ${processed} 件`);
  console.log(`  失敗/スキップ: ${failed} 件`);
  console.log(`  残りキュー: ${queue.pending.length} 件`);
  console.log("\n✅ 完了!");
}

main().catch(console.error);
