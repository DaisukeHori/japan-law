/**
 * create_bill_issues.ts
 * 新規法案をGitHub Issuesとして自動作成
 * Laws as Code: 法案 = Issue, 可決 = PR merge
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Octokit } from "@octokit/rest";
import axios from "axios";

const KOKKAI_API = "https://kokkai.ndl.go.jp/api/speech";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const LEGISLATORS_DIR = path.join(DATA_DIR, "index", "legislators");
const TRACKING_FILE = path.join(LEGISLATORS_DIR, "created_issues.json");
const SUMMARY_QUEUE_FILE = path.join(LEGISLATORS_DIR, "pending_summaries.json");

// LLM要約待ちキュー
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
    console.log("⚠️ 要約キューの読み込みに失敗、新規作成");
  }
  return { updated_at: new Date().toISOString(), pending: [] };
}

// キューを保存
function saveSummaryQueue(queue: SummaryQueue): void {
  queue.updated_at = new Date().toISOString();
  fs.writeFileSync(SUMMARY_QUEUE_FILE, JSON.stringify(queue, null, 2), "utf-8");
}

// キューに追加
function addToSummaryQueue(queue: SummaryQueue, item: PendingSummary): void {
  // 重複チェック（同じコメントIDは追加しない）
  if (!queue.pending.some(p => p.comment_id === item.comment_id)) {
    queue.pending.push(item);
  }
}

interface Bill {
  id: string;
  diet_session: number;
  bill_type: string;
  bill_name: string;
  proposer: string;
  proposer_party?: string;
  proposer_type: string;
  status: string;
  house: string;
}

interface CreatedIssues {
  updated_at: string;
  issues: { [billId: string]: number }; // billId -> issue number
}

interface BillsData {
  updated_at: string;
  source: string;
  total_count: number;
  bills: Bill[];
}

// ステータスに応じたラベル
function getStatusLabel(status: string): string {
  switch (status) {
    case "成立":
      return "成立";
    case "廃案":
      return "廃案";
    case "撤回":
      return "撤回";
    case "継続審議":
      return "継続審議";
    default:
      return "審議中";
  }
}

// 法案タイプに応じたラベル
function getBillTypeLabel(type: string, proposerType: string): string {
  if (proposerType === "閣法") return "閣法";
  if (type.includes("衆") || proposerType === "衆法") return "衆法";
  if (type.includes("参") || proposerType === "参法") return "参法";
  return "議員立法";
}

// ハウスラベル
function getHouseLabel(house: string): string {
  return house === "参議院" ? "参議院" : "衆議院";
}

async function loadCreatedIssues(): Promise<CreatedIssues> {
  try {
    if (fs.existsSync(TRACKING_FILE)) {
      const data = fs.readFileSync(TRACKING_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.log("No existing tracking file, starting fresh");
  }
  return {
    updated_at: new Date().toISOString(),
    issues: {},
  };
}

function saveCreatedIssues(data: CreatedIssues): void {
  data.updated_at = new Date().toISOString();
  fs.writeFileSync(TRACKING_FILE, JSON.stringify(data, null, 2), "utf-8");
}

async function ensureLabels(octokit: Octokit, owner: string, repo: string): Promise<void> {
  const labels = [
    // 基本ラベル
    { name: "法案", color: "0366d6", description: "法律案" },
    { name: "閣法", color: "1d76db", description: "内閣提出法案" },
    { name: "衆法", color: "5319e7", description: "衆議院議員提出法案" },
    { name: "参法", color: "d93f0b", description: "参議院議員提出法案" },
    { name: "議員立法", color: "006b75", description: "議員提出法案" },
    // 状態ラベル
    { name: "成立", color: "0e8a16", description: "成立した法案" },
    { name: "廃案", color: "b60205", description: "廃案となった法案" },
    { name: "撤回", color: "e4e669", description: "撤回された法案" },
    { name: "継続審議", color: "fbca04", description: "継続審議中の法案" },
    { name: "審議中", color: "c5def5", description: "審議中の法案" },
    // 院別ラベル
    { name: "衆議院", color: "bfdadc", description: "衆議院で審議" },
    { name: "参議院", color: "d4c5f9", description: "参議院で審議" },
    // 会派ラベル
    { name: "会派/自民", color: "e74c3c", description: "自由民主党提出" },
    { name: "会派/立憲", color: "3498db", description: "立憲民主党提出" },
    { name: "会派/公明", color: "f39c12", description: "公明党提出" },
    { name: "会派/維新", color: "27ae60", description: "日本維新の会提出" },
    { name: "会派/国民", color: "9b59b6", description: "国民民主党提出" },
    { name: "会派/共産", color: "c0392b", description: "日本共産党提出" },
    { name: "会派/れいわ", color: "e91e63", description: "れいわ新選組提出" },
    { name: "会派/社民", color: "ff6b6b", description: "社会民主党提出" },
  ];

  for (const label of labels) {
    try {
      await octokit.issues.createLabel({
        owner,
        repo,
        name: label.name,
        color: label.color,
        description: label.description,
      });
      console.log(`  ✅ ラベル作成: ${label.name}`);
    } catch (e: any) {
      if (e.status === 422) {
        // Already exists, try to update
        try {
          await octokit.issues.updateLabel({
            owner,
            repo,
            name: label.name,
            color: label.color,
            description: label.description,
          });
        } catch {
          // Ignore update errors
        }
      }
    }
  }
}

// 提出者名をラベル用に整形（複数名の場合は最初の1人）
function getProposerLabel(proposer: string): string | null {
  if (!proposer || proposer === "内閣") return null;
  // 複数名の場合は最初の1人を取得
  const names = proposer.split(/[、,　 ]/);
  const firstName = names[0]?.trim();
  if (!firstName || firstName.length > 10) return null;
  return `提案者/${firstName}`;
}

// 提出会派をラベル用に整形
function getPartyLabel(party: string): string | null {
  if (!party) return null;
  // 短縮名を使用
  const shortNames: Record<string, string> = {
    "自由民主党": "自民",
    "立憲民主党": "立憲",
    "公明党": "公明",
    "日本維新の会": "維新",
    "国民民主党": "国民",
    "日本共産党": "共産",
    "れいわ新選組": "れいわ",
    "社会民主党": "社民",
  };
  for (const [full, short] of Object.entries(shortNames)) {
    if (party.includes(full)) return `会派/${short}`;
  }
  return null;
}

// 国会会議録APIから法案に関する議論を取得
interface Discussion {
  date: string;
  meeting: string;
  speaker: string;
  party: string;
  speech: string;
  summary: string;
  speechUrl?: string;
}

// 発言から要約を生成（キーワードベースで重要な文を抽出）
function generateSummaryKeyword(speech: string): string {
  // 文に分割（句点または改行で区切る）
  const sentences = speech
    .split(/[。\n]/)
    .map(s => s.trim())
    .filter(s => s.length > 15 && s.length < 300);

  if (sentences.length === 0) return "";

  // 重要度スコアリング用のキーワード
  const highPriorityKeywords = [
    // 賛否・立場
    "賛成", "反対", "支持", "批判", "懸念", "問題",
    // 主張・要求
    "求め", "主張", "提案", "要求", "訴え", "指摘",
    // 結論・判断
    "必要", "重要", "不可欠", "べき", "なければ",
    // 法案関連
    "法案", "改正", "施行", "制度", "政策",
  ];

  const conclusionMarkers = [
    "したがって", "よって", "以上", "結論", "最後に",
    "まとめ", "総じて", "つまり", "要するに",
  ];

  // 各文にスコアを付ける
  const scoredSentences = sentences.map((sentence, index) => {
    let score = 0;

    // キーワードマッチでスコア加算
    for (const keyword of highPriorityKeywords) {
      if (sentence.includes(keyword)) score += 2;
    }

    // 結論マーカーがある文は高スコア
    for (const marker of conclusionMarkers) {
      if (sentence.includes(marker)) score += 5;
    }

    // 質問文は除外（スコア減点）
    if (sentence.includes("？") || sentence.includes("か。")) score -= 3;

    // 挨拶・形式的な文は除外
    if (sentence.match(/^(ただいま|議長|委員長|大臣|御説明|御質問)/)) score -= 5;

    // 後半の文は結論である可能性が高い
    if (index > sentences.length * 0.7) score += 1;

    return { sentence, score, index };
  });

  // スコア順にソートして上位を取得
  scoredSentences.sort((a, b) => b.score - a.score);

  // 最高スコアの文を取得（スコアが同じなら後ろの文を優先）
  const bestSentences = scoredSentences
    .filter(s => s.score > 0)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index); // 元の順序に戻す

  let summary: string;
  if (bestSentences.length > 0) {
    summary = bestSentences.map(s => s.sentence).join("。");
  } else {
    // スコアが低い場合は最初の実質的な文を使用
    summary = sentences[0] || "";
  }

  // 200文字以内に収める
  if (summary.length > 200) {
    summary = summary.slice(0, 197) + "...";
  }

  return summary + (summary.endsWith("。") ? "" : "。");
}

async function fetchDiscussions(billName: string, session: number): Promise<Discussion[]> {
  const discussions: Discussion[] = [];

  try {
    // 法案名で検索（短い名前に加工して検索精度を上げる）
    const searchTerm = billName
      .replace(/の一部を改正する法律案$/, "")
      .replace(/に関する法律案$/, "")
      .slice(0, 30);

    // ページネーションで全件取得
    const PAGE_SIZE = 100;
    let startRecord = 1;
    let totalRecords = 0;
    let fetchedCount = 0;

    do {
      const url = `${KOKKAI_API}?any=${encodeURIComponent(searchTerm)}&sessionFrom=${session}&sessionTo=${session}&recordPacking=json&maximumRecords=${PAGE_SIZE}&startRecord=${startRecord}`;

      const response = await axios.get(url, { timeout: 60000 });

      // 総件数を取得（初回のみ）
      if (startRecord === 1) {
        totalRecords = response.data?.numberOfRecords || 0;
        if (totalRecords > 0) {
          console.log(`    📊 検索結果: ${totalRecords}件`);
        }
      }

      const records = response.data?.speechRecord || [];
      if (records.length === 0) break;

      fetchedCount += records.length;

      for (const record of records) {
        const speech = record.speech || "";
        const speaker = record.speaker || "";

        // ノイズを除外（会議録情報、短すぎる発言、発言者名がない）
        if (!speaker || speaker.includes("会議録情報") || speaker === "（）") continue;
        if (speech.length < 100) continue;

        discussions.push({
          date: record.date || "",
          meeting: record.nameOfMeeting || "",
          speaker: speaker,
          party: record.speakerGroup || "",
          speech: speech,
          summary: "", // 後で生成
          speechUrl: record.speechURL,
        });
      }

      startRecord += PAGE_SIZE;

      // レート制限対応
      if (fetchedCount < totalRecords) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } while (fetchedCount < totalRecords);

    if (discussions.length > 0) {
      console.log(`    ✅ 有効な議論: ${discussions.length}件（総${totalRecords}件中）`);

      // キーワードベース要約を生成（高速）
      for (const d of discussions) {
        d.summary = generateSummaryKeyword(d.speech);
      }
    }
  } catch (error: any) {
    console.log(`    ⚠️ 議論取得スキップ: ${error.message}`);
  }

  return discussions;
}

// 議論を個別コメント用に整形（シンプル版）
function formatDiscussionAsComment(discussion: Discussion): string {
  const link = discussion.speechUrl ? ` [📄](${discussion.speechUrl})` : "";

  // 全文が長い場合は折りたたみ
  const fullText = discussion.speech.length > 1000
    ? `<details>
<summary>全文を表示（${discussion.speech.length}文字）</summary>

${discussion.speech}

</details>`
    : discussion.speech;

  return `**${discussion.speaker}**（${discussion.party}）${link}
${discussion.date} ${discussion.meeting}

> ${discussion.summary}

${fullText}`;
}

// 議論を個別コメントとして追加（キューにも追加）
async function addDiscussionComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  discussions: Discussion[],
  summaryQueue: SummaryQueue
): Promise<void> {
  if (discussions.length === 0) {
    // 議論がない場合は1つのコメントで通知
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `### 💬 国会での議論

*国会会議録APIに該当する議論が見つかりませんでした。*

> 🤖 自動検索結果`,
    });
    return;
  }

  // 各議論を個別コメントとして追加
  for (const discussion of discussions) {
    await new Promise((resolve) => setTimeout(resolve, 300)); // Rate limiting
    try {
      const response = await octokit.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: formatDiscussionAsComment(discussion),
      });

      // LLM要約キューに追加（後で処理）
      addToSummaryQueue(summaryQueue, {
        issue_number: issueNumber,
        comment_id: response.data.id,
        speech: discussion.speech,
        created_at: new Date().toISOString(),
      });
    } catch (e: any) {
      console.log(`    ⚠️ コメント追加失敗: ${e.message}`);
    }
  }
}

async function createOrUpdateIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  bill: Bill,
  summaryQueue: SummaryQueue,
  existingIssueNumber?: number,
  fetchDiscussionData: boolean = true
): Promise<number | null> {
  const labels = [
    "法案",
    getBillTypeLabel(bill.bill_type, bill.proposer_type),
    getStatusLabel(bill.status),
    getHouseLabel(bill.house),
    `第${bill.diet_session}回国会`,
  ];

  // 提出者ラベルを追加
  const proposerLabel = getProposerLabel(bill.proposer);
  if (proposerLabel) labels.push(proposerLabel);

  // 会派ラベルを追加
  const partyLabel = getPartyLabel(bill.proposer_party || "");
  if (partyLabel) labels.push(partyLabel);

  // 提出者の検索リンク
  const proposerSearchUrl = bill.proposer
    ? `https://github.com/${owner}/${repo}/issues?q=is%3Aissue+label%3A%22提案者%2F${encodeURIComponent(bill.proposer.split(/[、,　 ]/)[0] || "")}%22`
    : null;

  const body = `## 📋 法案情報

| 項目 | 内容 |
|------|------|
| **法案名** | ${bill.bill_name} |
| **種類** | ${bill.bill_type} |
| **国会回次** | 第${bill.diet_session}回国会 |
| **提出院** | ${bill.house} |
| **提出者** | ${bill.proposer || "不明"} |
| **提出会派** | ${bill.proposer_party || "不明"} |
| **提出種別** | ${bill.proposer_type} |
| **状態** | ${bill.status} |

---

### 👤 提出者による他の法案

${proposerSearchUrl ? `[${bill.proposer?.split(/[、,　 ]/)[0] || "提出者"}の提出法案一覧](${proposerSearchUrl})` : "（閣法のため該当なし）"}

---

### 🔍 国会会議録

[国会会議録で検索](https://kokkai.ndl.go.jp/#/search?any=${encodeURIComponent(bill.bill_name.slice(0, 30))}&sessionFrom=${bill.diet_session}&sessionTo=${bill.diet_session})

*関連する議論はコメント欄に自動追加されます*

---

### 📝 Laws as Code

この Issue は日本の法案を表しています。

- **法案可決** → この Issue をクローズし、法令ファイルを追加する PR を作成
- **法案廃案** → この Issue をクローズ（ラベルを「廃案」に変更）
- **法案修正** → この Issue にコメントを追加

> 🤖 このIssueは [国会会議録API](https://kokkai.ndl.go.jp/) + [SmartNews MRI](https://github.com/smartnews-smri) データから自動生成されました
`;

  const title = `[第${bill.diet_session}回] ${bill.bill_name}`;

  try {
    if (existingIssueNumber) {
      // Update existing issue
      const newState = bill.status === "成立" || bill.status === "廃案" || bill.status === "撤回" ? "closed" : "open";

      await octokit.issues.update({
        owner,
        repo,
        issue_number: existingIssueNumber,
        title,
        body,
        labels,
        state: newState,
      });
      console.log(`  📝 Issue #${existingIssueNumber} 更新: ${bill.bill_name.slice(0, 30)}...`);

      // ステータス変更時にコメントを追加
      if (newState === "closed") {
        const statusEmoji = bill.status === "成立" ? "✅" : bill.status === "廃案" ? "❌" : "🔙";
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: existingIssueNumber,
          body: `### ${statusEmoji} 法案ステータス更新

**${bill.status}** となりました。

> 🤖 自動更新`,
        });
        console.log(`    📊 ステータス更新コメント追加: ${bill.status}`);
      }

      // 既存Issueにも新しい議論を追記（オプション）
      if (fetchDiscussionData) {
        // 既存コメントを取得して重複チェック
        const existingComments = await octokit.issues.listComments({
          owner,
          repo,
          issue_number: existingIssueNumber,
          per_page: 100,
        });

        // 日付 + 発言者 + 会議名 の組み合わせで重複チェック
        const existingKeys = new Set(
          existingComments.data
            .map(c => {
              // 新フォーマット: **発言者**（党）\n日付 会議名
              const speakerMatch = c.body?.match(/^\*\*(.+?)\*\*（/m);
              const dateMatch = c.body?.match(/(\d{4}-\d{2}-\d{2}) (.+?)\n/);
              if (dateMatch && speakerMatch) {
                return `${dateMatch[1]}|${dateMatch[2]}|${speakerMatch[1]}`;
              }
              return null;
            })
            .filter(Boolean)
        );

        const discussions = await fetchDiscussions(bill.bill_name, bill.diet_session);
        const newDiscussions = discussions.filter(d => {
          const key = `${d.date}|${d.meeting}|${d.speaker}`;
          return !existingKeys.has(key);
        });

        if (newDiscussions.length > 0) {
          console.log(`    💬 ${newDiscussions.length}件の新しい議論を追記中...`);
          await addDiscussionComments(octokit, owner, repo, existingIssueNumber, newDiscussions, summaryQueue);
        }
      }

      return existingIssueNumber;
    } else {
      // Create new issue
      const response = await octokit.issues.create({
        owner,
        repo,
        title,
        body,
        labels,
      });
      console.log(`  ✅ Issue #${response.data.number} 作成: ${bill.bill_name.slice(0, 30)}...`);

      // 議論をコメントとして追加（新規作成時のみ）
      if (fetchDiscussionData) {
        const discussions = await fetchDiscussions(bill.bill_name, bill.diet_session);
        if (discussions.length > 0) {
          console.log(`    💬 ${discussions.length}件の議論をコメントとして追加中...`);
          await addDiscussionComments(octokit, owner, repo, response.data.number, discussions, summaryQueue);
        }
      }

      // If already completed, close it
      if (bill.status === "成立" || bill.status === "廃案" || bill.status === "撤回") {
        await octokit.issues.update({
          owner,
          repo,
          issue_number: response.data.number,
          state: "closed",
        });
      }

      return response.data.number;
    }
  } catch (e: any) {
    console.error(`  ❌ Issue作成失敗: ${bill.bill_name.slice(0, 30)}... - ${e.message}`);
    return null;
  }
}

async function main(): Promise<void> {
  console.log("📋 GitHub Issues 自動作成スクリプト");
  console.log("=".repeat(50));

  // Check for GitHub token
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log("⚠️ GITHUB_TOKEN が設定されていません");
    console.log("  ローカル実行時は: export GITHUB_TOKEN=your_token");
    console.log("  GitHub Actions では自動的に設定されます");
    return;
  }

  // Parse repo info from environment or use default
  const repoFullName = process.env.GITHUB_REPOSITORY || "DaisukeHori/japan-law";
  const [owner, repo] = repoFullName.split("/");

  // 対象国会数（環境変数で制御可能、デフォルト5）
  const numSessions = parseInt(process.env.ISSUES_NUM_SESSIONS || "5", 10);
  // 最大作成数（環境変数で制御可能、デフォルト100）
  const maxCreate = parseInt(process.env.ISSUES_MAX_CREATE || "100", 10);

  console.log(`\n📦 リポジトリ: ${owner}/${repo}`);
  console.log(`📊 設定: 直近${numSessions}国会分、最大${maxCreate}件作成`);

  const octokit = new Octokit({ auth: token });

  // Load bills data
  const billsPath = path.join(LEGISLATORS_DIR, "smri_bills.json");
  if (!fs.existsSync(billsPath)) {
    console.log("❌ 法案データが見つかりません: " + billsPath);
    console.log("  先に auto_update.ts を実行してください");
    return;
  }

  const billsData: BillsData = JSON.parse(fs.readFileSync(billsPath, "utf-8"));
  const bills = billsData.bills;

  console.log(`\n📊 法案総数: ${bills.length} 件`);

  // Load tracking data
  const tracking = await loadCreatedIssues();
  console.log(`  既存Issue: ${Object.keys(tracking.issues).length} 件`);

  // Load summary queue
  const summaryQueue = loadSummaryQueue();
  console.log(`  LLM要約待ち: ${summaryQueue.pending.length} 件`);

  // Ensure labels exist
  console.log("\n🏷️ ラベル確認中...");
  await ensureLabels(octokit, owner, repo);

  // Filter to recent bills
  const recentSessions = [...new Set(bills.map((b) => b.diet_session))]
    .filter(s => s > 0)
    .sort((a, b) => b - a)
    .slice(0, numSessions);

  console.log(`  対象国会: ${recentSessions.join(", ")} (直近${numSessions}回)`);

  const recentBills = bills.filter((b) => recentSessions.includes(b.diet_session));
  console.log(`\n📝 対象法案: ${recentBills.length} 件`);

  // Create/update issues
  let created = 0;
  let updated = 0;
  let skipped = 0;

  // 新規作成対象の法案（既存Issueがないもの）を優先
  const newBills = recentBills.filter(b => !tracking.issues[b.id]);
  const existingBills = recentBills.filter(b => tracking.issues[b.id]);

  console.log(`  新規: ${newBills.length} 件, 更新対象: ${existingBills.length} 件`);

  // 新規作成（最大数まで）
  for (const bill of newBills) {
    if (created >= maxCreate) {
      console.log(`  ⚠️ 最大作成数 (${maxCreate}) に達しました`);
      break;
    }

    // Rate limiting: wait between requests
    await new Promise((resolve) => setTimeout(resolve, 500));

    const issueNum = await createOrUpdateIssue(octokit, owner, repo, bill, summaryQueue, undefined, true);
    if (issueNum) {
      tracking.issues[bill.id] = issueNum;
      created++;
    } else {
      skipped++;
    }

    // Save periodically
    if (created % 10 === 0) {
      saveCreatedIssues(tracking);
      saveSummaryQueue(summaryQueue);
    }
  }

  // 既存Issueの更新（ステータス変更のみ、議論は再取得しない）
  for (const bill of existingBills) {
    const existingIssue = tracking.issues[bill.id];

    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 300));

    const issueNum = await createOrUpdateIssue(octokit, owner, repo, bill, summaryQueue, existingIssue, false);
    if (issueNum) {
      updated++;
    }
  }

  // Final save
  saveCreatedIssues(tracking);
  saveSummaryQueue(summaryQueue);

  console.log("\n" + "=".repeat(50));
  console.log("📈 結果:");
  console.log(`  新規作成: ${created} 件`);
  console.log(`  更新: ${updated} 件`);
  console.log(`  スキップ: ${skipped} 件`);
  console.log(`  LLM要約待ち: ${summaryQueue.pending.length} 件`);
  console.log("\n✅ 完了!");
}

main().catch(console.error);
