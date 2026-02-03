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
const GITHUB_MODELS_URL = "https://models.inference.ai.azure.com/chat/completions";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const LEGISLATORS_DIR = path.join(DATA_DIR, "index", "legislators");
const TRACKING_FILE = path.join(LEGISLATORS_DIR, "created_issues.json");
const SUMMARY_QUEUE_FILE = path.join(LEGISLATORS_DIR, "pending_summaries.json");
const SPEECH_INDEX_FILE = path.join(LEGISLATORS_DIR, "legislator_speeches.json");

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

// 議員別発言インデックス
interface LegislatorSpeech {
  bill_id: string;
  bill_name: string;
  issue_number: number;
  date: string;
  meeting: string;
  stance: "賛成" | "反対" | "中立";
}

interface LegislatorRecord {
  party: string;
  speech_count: number;
  bills: LegislatorSpeech[];
  stance_summary: { support: number; oppose: number; neutral: number };
}

interface LegislatorSpeechIndex {
  updated_at: string;
  total_legislators: number;
  total_speeches: number;
  legislators: Record<string, LegislatorRecord>;
}

// 議員別発言インデックスを読み込み
function loadSpeechIndex(): LegislatorSpeechIndex {
  try {
    if (fs.existsSync(SPEECH_INDEX_FILE)) {
      return JSON.parse(fs.readFileSync(SPEECH_INDEX_FILE, "utf-8"));
    }
  } catch (e) {
    console.log("⚠️ 発言インデックスの読み込みに失敗、新規作成");
  }
  return {
    updated_at: new Date().toISOString(),
    total_legislators: 0,
    total_speeches: 0,
    legislators: {},
  };
}

// 議員別発言インデックスを保存
function saveSpeechIndex(index: LegislatorSpeechIndex): void {
  index.updated_at = new Date().toISOString();
  index.total_legislators = Object.keys(index.legislators).length;
  index.total_speeches = Object.values(index.legislators).reduce((sum, l) => sum + l.speech_count, 0);
  fs.writeFileSync(SPEECH_INDEX_FILE, JSON.stringify(index, null, 2), "utf-8");
}

// 議員の発言をインデックスに追加
function addToSpeechIndex(
  index: LegislatorSpeechIndex,
  speaker: string,
  party: string,
  billId: string,
  billName: string,
  issueNumber: number,
  date: string,
  meeting: string,
  stance: "賛成" | "反対" | "中立"
): void {
  if (!index.legislators[speaker]) {
    index.legislators[speaker] = {
      party,
      speech_count: 0,
      bills: [],
      stance_summary: { support: 0, oppose: 0, neutral: 0 },
    };
  }

  const record = index.legislators[speaker];

  // 重複チェック（同じ法案+日付+会議は追加しない）
  const key = `${billId}|${date}|${meeting}`;
  if (record.bills.some(b => `${b.bill_id}|${b.date}|${b.meeting}` === key)) {
    return;
  }

  record.party = party || record.party; // パーティ情報を更新
  record.speech_count++;
  record.bills.push({ bill_id: billId, bill_name: billName, issue_number: issueNumber, date, meeting, stance });

  // スタンス集計を更新
  if (stance === "賛成") record.stance_summary.support++;
  else if (stance === "反対") record.stance_summary.oppose++;
  else record.stance_summary.neutral++;
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

// 複数名から最初の提案者名を取得（フルネーム維持、スペースは分割しない）
function getFirstProposerName(proposer: string): string | null {
  if (!proposer || proposer === "内閣") return null;
  // カンマ区切りのみで分割（全角・半角カンマ対応）
  // スペースは「姓 名」の区切りの可能性があるため分割しない
  const names = proposer.split(/[、,，]/);
  const firstName = names[0]?.trim();
  if (!firstName || firstName.length > 20) return null; // フルネーム対応で長さ制限緩和
  return firstName;
}

// 提出者名をラベル用に整形（複数名の場合は最初の1人、フルネームで）
function getProposerLabel(proposer: string): string | null {
  const name = getFirstProposerName(proposer);
  if (!name) return null;
  return `提案者/${name}`;
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
  stance?: "賛成" | "反対" | "中立";
  isLlmSummary?: boolean;
}

// 発言から賛否スタンスを検出
function detectStance(speech: string): "賛成" | "反対" | "中立" {
  const supportKeywords = [
    "賛成", "賛成いたします", "賛成の立場", "支持", "支持いたします",
    "歓迎", "評価", "前進", "必要な法案", "重要な法案"
  ];
  const opposeKeywords = [
    "反対", "反対いたします", "反対の立場", "批判", "問題がある",
    "懸念", "不十分", "見直し", "廃案", "撤回"
  ];

  let supportScore = 0;
  let opposeScore = 0;

  for (const keyword of supportKeywords) {
    if (speech.includes(keyword)) supportScore += 1;
  }
  for (const keyword of opposeKeywords) {
    if (speech.includes(keyword)) opposeScore += 1;
  }

  if (supportScore > opposeScore && supportScore >= 2) return "賛成";
  if (opposeScore > supportScore && opposeScore >= 2) return "反対";
  return "中立";
}

// 賛否バッジを生成
function getStanceBadge(stance: "賛成" | "反対" | "中立"): string {
  switch (stance) {
    case "賛成": return "🟢";
    case "反対": return "🔴";
    default: return "⚪";
  }
}

// 役職アイコンを取得
function getRoleIcon(speaker: string): string {
  if (speaker.includes("内閣総理大臣") || speaker.includes("総理")) return "👔";
  if (speaker.includes("大臣")) return "🏛️";
  if (speaker.includes("副大臣") || speaker.includes("政務官")) return "📋";
  if (speaker.includes("委員長") || speaker.includes("議長")) return "🪑";
  if (speaker.includes("参考人") || speaker.includes("公述人")) return "👥";
  return "🎤"; // デフォルト: 議員
}

// 党派カラーを取得（shields.io用）
function getPartyColor(party: string): string {
  const partyColors: Record<string, string> = {
    "自由民主党": "e74c3c",
    "自民": "e74c3c",
    "立憲民主党": "3498db",
    "立憲": "3498db",
    "公明党": "f39c12",
    "公明": "f39c12",
    "日本維新の会": "27ae60",
    "維新": "27ae60",
    "国民民主党": "9b59b6",
    "国民": "9b59b6",
    "日本共産党": "c0392b",
    "共産": "c0392b",
    "れいわ新選組": "e91e63",
    "れいわ": "e91e63",
    "社会民主党": "ff6b6b",
    "社民": "ff6b6b",
    "無所属": "808080",
  };

  for (const [name, color] of Object.entries(partyColors)) {
    if (party.includes(name)) return color;
  }
  return "808080"; // デフォルト: グレー
}

// shields.io党派バッジを生成
function getPartyBadge(party: string): string {
  if (!party) return "";
  const color = getPartyColor(party);
  const shortParty = party.replace(/・.*$/, "").slice(0, 10);
  // shields.io URL（スペースは%20にエンコード）
  const encodedParty = encodeURIComponent(shortParty);
  return `![${shortParty}](https://img.shields.io/badge/${encodedParty}-${color})`;
}

// 議員検索URL（GitHub Issues検索）を生成
function getSpeakerSearchUrl(owner: string, repo: string, speaker: string): string {
  // ラベル「発言者/〇〇」で検索
  const encodedSpeaker = encodeURIComponent(speaker);
  return `https://github.com/${owner}/${repo}/issues?q=is%3Aissue+label%3A%22発言者%2F${encodedSpeaker}%22`;
}

// 議員リンク（検索URL付き）を生成
function getSpeakerLink(owner: string, repo: string, speaker: string): string {
  const url = getSpeakerSearchUrl(owner, repo, speaker);
  const icon = getRoleIcon(speaker);
  return `[${icon} ${speaker}](${url})`;
}

// 発言者ラベル名を生成
function getSpeakerLabelName(speaker: string): string {
  return `発言者/${speaker}`;
}

// 発言者ラベルを作成（存在しない場合）
async function ensureSpeakerLabel(
  octokit: Octokit,
  owner: string,
  repo: string,
  speaker: string
): Promise<void> {
  const labelName = getSpeakerLabelName(speaker);
  try {
    await octokit.issues.createLabel({
      owner,
      repo,
      name: labelName,
      color: "84b6eb",
      description: `${speaker}の発言がある法案`,
    });
  } catch (e: any) {
    // Already exists (422) - ignore
    if (e.status !== 422) {
      console.log(`    ⚠️ ラベル作成スキップ: ${labelName}`);
    }
  }
}

// 議論から上位発言者を取得（発言数順）
function getTopSpeakers(discussions: Discussion[], limit: number = 5): string[] {
  const speakerCounts: Record<string, number> = {};
  for (const d of discussions) {
    speakerCounts[d.speaker] = (speakerCounts[d.speaker] || 0) + 1;
  }

  return Object.entries(speakerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([speaker]) => speaker);
}

// 法案内容をLLMで要約（GitHub Models API）
async function generateBillSummary(billName: string, discussions: Discussion[]): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;

  try {
    // 議論の中から法案の説明・趣旨説明を探す
    const explanations = discussions
      .filter(d => d.speech.includes("趣旨") || d.speech.includes("説明") || d.speech.includes("目的"))
      .slice(0, 3)
      .map(d => d.speech.slice(0, 1000))
      .join("\n\n");

    if (!explanations && discussions.length === 0) {
      return null;
    }

    const context = explanations || discussions.slice(0, 2).map(d => d.speech.slice(0, 500)).join("\n\n");

    const response = await axios.post(
      GITHUB_MODELS_URL,
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "あなたは日本の法案を簡潔に説明するアシスタントです。法案の目的、主な内容、影響を3-5文（200文字以内）で要約してください。専門用語は避け、一般市民にもわかりやすく説明してください。"
          },
          {
            role: "user",
            content: `以下は「${billName}」に関する国会での議論です。この法案の概要を要約してください。\n\n${context}`
          }
        ],
        temperature: 0.3,
        max_tokens: 300,
      },
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 20000
      }
    );

    const text = response.data?.choices?.[0]?.message?.content;
    if (text) {
      return text.trim().slice(0, 400);
    }
  } catch (error: any) {
    if (error.response?.status === 429) {
      console.log("    ⚠️ LLM要約: レート制限");
    } else {
      console.log(`    ⚠️ LLM要約生成失敗: ${error.message}`);
    }
  }
  return null;
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

      // キーワードベース要約を生成（高速）+ スタンス検出
      for (const d of discussions) {
        d.summary = generateSummaryKeyword(d.speech);
        d.stance = detectStance(d.speech);
        d.isLlmSummary = false; // 初期状態はキーワード要約
      }
    }
  } catch (error: any) {
    console.log(`    ⚠️ 議論取得スキップ: ${error.message}`);
  }

  return discussions;
}

// 議論のサマリーテーブルを生成
function generateDiscussionSummary(discussions: Discussion[], owner: string, repo: string): string {
  if (discussions.length === 0) {
    return "*関連する議論はコメント欄に自動追加されます*";
  }

  // 党派別集計
  const partyStats: Record<string, { count: number; support: number; oppose: number }> = {};
  for (const d of discussions) {
    const party = d.party || "不明";
    if (!partyStats[party]) {
      partyStats[party] = { count: 0, support: 0, oppose: 0 };
    }
    partyStats[party].count++;
    if (d.stance === "賛成") partyStats[party].support++;
    if (d.stance === "反対") partyStats[party].oppose++;
  }

  // 発言者リスト（リンク付き）
  const speakers = [...new Set(discussions.map(d => d.speaker))];
  const speakerLinks = speakers.slice(0, 10).map(s => getSpeakerLink(owner, repo, s)).join("、");

  // 党派別テーブル生成
  const partyRows = Object.entries(partyStats)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8) // 上位8党派まで
    .map(([party, stats]) => {
      const badge = getPartyBadge(party);
      const stanceInfo = stats.support > 0 || stats.oppose > 0
        ? ` (🟢${stats.support} / 🔴${stats.oppose})`
        : "";
      return `| ${badge} | ${stats.count}件${stanceInfo} |`;
    })
    .join("\n");

  return `### 📊 議論サマリー

| 党派 | 発言数 |
|------|--------|
${partyRows}

**発言者** (${speakers.length}名): ${speakerLinks}${speakers.length > 10 ? "..." : ""}

*詳細はコメント欄を参照*`;
}

// 議論を個別コメント用に整形（表示改善版）
function formatDiscussionAsComment(discussion: Discussion, owner: string, repo: string): string {
  const speechLink = discussion.speechUrl ? ` [📄](${discussion.speechUrl})` : "";

  // 議員リンク（検索URL付き）
  const speakerLink = getSpeakerLink(owner, repo, discussion.speaker);

  // 党派バッジ（shields.io）
  const partyBadge = getPartyBadge(discussion.party);

  // 賛否バッジ
  const stance = discussion.stance || detectStance(discussion.speech);
  const stanceBadge = getStanceBadge(stance);
  const stanceLabel = stance !== "中立" ? ` ${stanceBadge} ${stance}` : "";

  // 要約マーカー（LLM要約 vs キーワード要約）
  const summaryMarker = discussion.isLlmSummary ? "🤖" : "📝";

  // 全文が長い場合は折りたたみ
  const fullText = discussion.speech.length > 1000
    ? `<details>
<summary>全文を表示（${discussion.speech.length}文字）</summary>

${discussion.speech}

</details>`
    : discussion.speech;

  return `**${speakerLink}** ${partyBadge}${stanceLabel}${speechLink}
📅 ${discussion.date} | 🏛️ ${discussion.meeting}

> ${summaryMarker} ${discussion.summary}

${fullText}`;
}

// 議論を個別コメントとして追加（キューにも追加、発言インデックスも更新）
async function addDiscussionComments(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  discussions: Discussion[],
  summaryQueue: SummaryQueue,
  speechIndex: LegislatorSpeechIndex,
  billId: string,
  billName: string
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
        body: formatDiscussionAsComment(discussion, owner, repo),
      });

      // LLM要約キューに追加（後で処理）
      addToSummaryQueue(summaryQueue, {
        issue_number: issueNumber,
        comment_id: response.data.id,
        speech: discussion.speech,
        created_at: new Date().toISOString(),
      });

      // 発言インデックスに追加
      addToSpeechIndex(
        speechIndex,
        discussion.speaker,
        discussion.party,
        billId,
        billName,
        issueNumber,
        discussion.date,
        discussion.meeting,
        discussion.stance || "中立"
      );
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
  speechIndex: LegislatorSpeechIndex,
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

  // 提出者の検索リンク（フルネームで検索）
  const firstProposer = getFirstProposerName(bill.proposer || "");
  const proposerSearchUrl = firstProposer
    ? `https://github.com/${owner}/${repo}/issues?q=is%3Aissue+label%3A%22提案者%2F${encodeURIComponent(firstProposer)}%22`
    : null;

  // 議論を先に取得してサマリーを生成（新規Issue作成時のみ）
  let discussions: Discussion[] = [];
  let discussionSummary = "*関連する議論はコメント欄に自動追加されます*";
  let billSummary = "*（議論データから法案概要を生成中...）*";

  if (fetchDiscussionData && !existingIssueNumber) {
    discussions = await fetchDiscussions(bill.bill_name, bill.diet_session);
    discussionSummary = generateDiscussionSummary(discussions, owner, repo);

    // LLMで法案内容を要約
    const llmSummary = await generateBillSummary(bill.bill_name, discussions);
    if (llmSummary) {
      billSummary = `> 🤖 ${llmSummary}`;
    } else if (discussions.length > 0) {
      // LLM失敗時はキーワード要約
      const firstExplanation = discussions.find(d =>
        d.speech.includes("趣旨") || d.speech.includes("説明")
      );
      if (firstExplanation) {
        billSummary = `> 📝 ${generateSummaryKeyword(firstExplanation.speech)}`;
      } else {
        billSummary = "*（法案概要は議論コメントを参照）*";
      }
    } else {
      billSummary = "*（関連する議論が見つかりませんでした）*";
    }

    // 全発言者のラベルを追加
    const allSpeakers = [...new Set(discussions.map(d => d.speaker))];
    for (const speaker of allSpeakers) {
      await ensureSpeakerLabel(octokit, owner, repo, speaker);
      labels.push(getSpeakerLabelName(speaker));
    }
  }

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

### 📖 法案概要

${billSummary}

---

### 👤 提出者による他の法案

${proposerSearchUrl ? `[${firstProposer || "提出者"}の提出法案一覧](${proposerSearchUrl})` : "（閣法のため該当なし）"}

---

### 🔍 国会会議録

[国会会議録で検索](https://kokkai.ndl.go.jp/#/search?any=${encodeURIComponent(bill.bill_name.slice(0, 30))}&sessionFrom=${bill.diet_session}&sessionTo=${bill.diet_session})

${discussionSummary}

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
              // 新フォーマット: 🎤 **発言者** badge 🟢賛成 link\n📅 日付 | 🏛️ 会議名
              // 旧フォーマット: **発言者**（党）\n日付 会議名
              const newSpeakerMatch = c.body?.match(/^.+? \*\*(.+?)\*\*/m);
              const newDateMatch = c.body?.match(/📅 (\d{4}-\d{2}-\d{2}) \| 🏛️ (.+?)\n/);
              if (newDateMatch && newSpeakerMatch) {
                return `${newDateMatch[1]}|${newDateMatch[2]}|${newSpeakerMatch[1]}`;
              }
              // 旧フォーマットにもフォールバック
              const oldSpeakerMatch = c.body?.match(/^\*\*(.+?)\*\*（/m);
              const oldDateMatch = c.body?.match(/(\d{4}-\d{2}-\d{2}) (.+?)\n/);
              if (oldDateMatch && oldSpeakerMatch) {
                return `${oldDateMatch[1]}|${oldDateMatch[2]}|${oldSpeakerMatch[1]}`;
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
          await addDiscussionComments(octokit, owner, repo, existingIssueNumber, newDiscussions, summaryQueue, speechIndex, bill.id, bill.bill_name);
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

      // 議論をコメントとして追加（新規作成時のみ、すでに取得済みのdiscussionsを使用）
      if (fetchDiscussionData && discussions.length > 0) {
        console.log(`    💬 ${discussions.length}件の議論をコメントとして追加中...`);
        await addDiscussionComments(octokit, owner, repo, response.data.number, discussions, summaryQueue, speechIndex, bill.id, bill.bill_name);
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
  // 最大作成数（環境変数で制御可能、デフォルト無制限）
  const maxCreateEnv = process.env.ISSUES_MAX_CREATE;
  const maxCreate = maxCreateEnv ? parseInt(maxCreateEnv, 10) : Infinity;

  console.log(`\n📦 リポジトリ: ${owner}/${repo}`);
  console.log(`📊 設定: 直近${numSessions}国会分、最大${maxCreate === Infinity ? "無制限" : maxCreate}件作成`);

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

  // Load speech index
  const speechIndex = loadSpeechIndex();
  console.log(`  議員発言インデックス: ${speechIndex.total_legislators}名 / ${speechIndex.total_speeches}件`);

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

    const issueNum = await createOrUpdateIssue(octokit, owner, repo, bill, summaryQueue, speechIndex, undefined, true);
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
      saveSpeechIndex(speechIndex);
    }
  }

  // 既存Issueの更新（ステータス変更のみ、議論は再取得しない）
  for (const bill of existingBills) {
    const existingIssue = tracking.issues[bill.id];

    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 300));

    const issueNum = await createOrUpdateIssue(octokit, owner, repo, bill, summaryQueue, speechIndex, existingIssue, false);
    if (issueNum) {
      updated++;
    }
  }

  // Final save
  saveCreatedIssues(tracking);
  saveSummaryQueue(summaryQueue);
  saveSpeechIndex(speechIndex);

  console.log("\n" + "=".repeat(50));
  console.log("📈 結果:");
  console.log(`  新規作成: ${created} 件`);
  console.log(`  更新: ${updated} 件`);
  console.log(`  スキップ: ${skipped} 件`);
  console.log(`  LLM要約待ち: ${summaryQueue.pending.length} 件`);
  console.log(`  議員発言インデックス: ${speechIndex.total_legislators}名 / ${speechIndex.total_speeches}件`);
  console.log("\n✅ 完了!");
}

main().catch(console.error);
