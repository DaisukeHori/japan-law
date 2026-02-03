/**
 * generate_docs.ts
 * ドキュメントサイト用のデータを生成する
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const DOCS_DIR = path.join(__dirname, "..", "docs");
const INDEX_DIR = path.join(DATA_DIR, "index");

interface LawInfo {
  id: string;
  lawNum: string;
  title: string;
  category: string;
}

interface LawIndex {
  updated_at: string;
  total_count: number;
  laws: LawInfo[];
}

interface SearchIndex {
  id: string;
  title: string;
  lawNum: string;
  category: string;
  searchText: string;
}

interface SiteStats {
  total_laws: number;
  by_category: Record<string, number>;
  updated_at: string;
  legislators_count: number;
  parties_count: number;
  bills_count: number;
}

// 議員発言インデックス用インターフェース
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

// ディレクトリ作成
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 法令インデックス読み込み
function loadLawIndex(): LawIndex | null {
  const indexPath = path.join(INDEX_DIR, "laws.json");
  if (fs.existsSync(indexPath)) {
    const data = fs.readFileSync(indexPath, "utf-8");
    return JSON.parse(data);
  }
  return null;
}

// 検索用インデックス生成
function generateSearchIndex(laws: LawInfo[]): SearchIndex[] {
  console.log("🔍 検索インデックスを生成中...");

  const searchIndex: SearchIndex[] = laws.map((law) => ({
    id: law.id,
    title: law.title,
    lawNum: law.lawNum,
    category: law.category,
    searchText: `${law.title} ${law.lawNum}`.toLowerCase(),
  }));

  console.log(`  → ${searchIndex.length} 件のインデックスを生成`);
  return searchIndex;
}

// カテゴリ別統計計算
function calculateCategoryStats(laws: LawInfo[]): Record<string, number> {
  const stats: Record<string, number> = {};

  for (const law of laws) {
    stats[law.category] = (stats[law.category] || 0) + 1;
  }

  return stats;
}

// カテゴリ名の日本語マッピング
const CATEGORY_NAMES: Record<string, string> = {
  constitution: "憲法",
  acts: "法律",
  cabinet_orders: "政令",
  imperial_orders: "勅令",
  ministerial_ordinances: "省令",
  rules: "規則",
  misc: "その他",
};

// 議員データ読み込み
function loadLegislatorsCount(): number {
  const filePath = path.join(INDEX_DIR, "legislators", "legislators.json");
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return data.legislators?.length || 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

// 政党データ読み込み
function loadPartiesCount(): number {
  const filePath = path.join(INDEX_DIR, "legislators", "parties.json");
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return data.parties?.length || 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

// 法案データ読み込み
function loadBillsCount(): number {
  const filePath = path.join(INDEX_DIR, "legislators", "smri_bills.json");
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return data.total_count || 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

// サイト統計生成
function generateSiteStats(laws: LawInfo[]): SiteStats {
  console.log("📊 サイト統計を生成中...");

  const categoryStats = calculateCategoryStats(laws);

  const stats: SiteStats = {
    total_laws: laws.length,
    by_category: categoryStats,
    updated_at: new Date().toISOString(),
    legislators_count: loadLegislatorsCount(),
    parties_count: loadPartiesCount(),
    bills_count: loadBillsCount(),
  };

  console.log(`  → 法令総数: ${stats.total_laws}`);
  console.log(`  → 議員数: ${stats.legislators_count}`);
  console.log(`  → 政党数: ${stats.parties_count}`);
  console.log(`  → 法案数: ${stats.bills_count}`);

  return stats;
}

// カテゴリ別インデックス生成
function generateCategoryIndices(laws: LawInfo[]): void {
  console.log("📂 カテゴリ別インデックスを生成中...");

  const byCategory: Record<string, LawInfo[]> = {};

  for (const law of laws) {
    if (!byCategory[law.category]) {
      byCategory[law.category] = [];
    }
    byCategory[law.category].push(law);
  }

  for (const [category, categoryLaws] of Object.entries(byCategory)) {
    const outputPath = path.join(INDEX_DIR, "categories", `${category}.json`);
    ensureDir(path.dirname(outputPath));

    const output = {
      category,
      category_name: CATEGORY_NAMES[category] || category,
      count: categoryLaws.length,
      laws: categoryLaws,
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
  }

  console.log(`  → ${Object.keys(byCategory).length} カテゴリのインデックスを生成`);
}

// 参照グラフデータの確認
function checkReferenceGraph(): boolean {
  const graphPath = path.join(INDEX_DIR, "reference_graph.json");
  if (fs.existsSync(graphPath)) {
    console.log("✅ 参照グラフデータが存在します");
    return true;
  }
  console.log("⚠️ 参照グラフデータがありません（analyze_references_multi.ts で生成）");
  return false;
}

// 議員発言インデックス読み込み
function loadLegislatorSpeechIndex(): LegislatorSpeechIndex | null {
  const filePath = path.join(INDEX_DIR, "legislators", "legislator_speeches.json");
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

// GitHub リポジトリ情報（環境変数から取得）
function getRepoInfo(): { owner: string; repo: string } {
  const repoFullName = process.env.GITHUB_REPOSITORY || "DaisukeHori/japan-law";
  const [owner, repo] = repoFullName.split("/");
  return { owner, repo };
}

// スタンスバッジを生成
function getStanceBadge(stance: "賛成" | "反対" | "中立"): string {
  switch (stance) {
    case "賛成": return "🟢";
    case "反対": return "🔴";
    default: return "⚪";
  }
}

// 党派色を取得
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
  };
  for (const [name, color] of Object.entries(partyColors)) {
    if (party.includes(name)) return color;
  }
  return "808080";
}

// 議員プロフィールページを生成
function generateLegislatorProfile(
  name: string,
  record: LegislatorRecord,
  owner: string,
  repo: string
): string {
  const { party, speech_count, bills, stance_summary } = record;
  const color = getPartyColor(party);
  const partyBadge = party ? `![${party}](https://img.shields.io/badge/${encodeURIComponent(party)}-${color})` : "";

  // スタンス集計
  const stanceText = [
    stance_summary.support > 0 ? `🟢 賛成: ${stance_summary.support}` : "",
    stance_summary.oppose > 0 ? `🔴 反対: ${stance_summary.oppose}` : "",
    stance_summary.neutral > 0 ? `⚪ 中立: ${stance_summary.neutral}` : "",
  ].filter(Boolean).join(" | ");

  // 法案リスト（日付降順）
  const sortedBills = [...bills].sort((a, b) => b.date.localeCompare(a.date));
  const billRows = sortedBills.slice(0, 50).map(b => {
    const stanceBadge = getStanceBadge(b.stance);
    const issueUrl = `https://github.com/${owner}/${repo}/issues/${b.issue_number}`;
    return `| ${b.date} | [${b.bill_name.slice(0, 40)}${b.bill_name.length > 40 ? "..." : ""}](${issueUrl}) | ${stanceBadge} ${b.stance} | ${b.meeting.slice(0, 20)} |`;
  }).join("\n");

  return `# ${name}

${partyBadge}

## 📊 活動サマリー

| 項目 | 数値 |
|------|------|
| **発言法案数** | ${speech_count} 件 |
| **所属会派** | ${party || "不明"} |

### スタンス内訳

${stanceText || "*データなし*"}

---

## 🔍 関連リンク

- [GitHub Issuesで発言を検索](https://github.com/${owner}/${repo}/issues?q=is%3Aissue+label%3A%22発言者%2F${encodeURIComponent(name)}%22)
- [提案した法案を検索](https://github.com/${owner}/${repo}/issues?q=is%3Aissue+label%3A%22提案者%2F${encodeURIComponent(name)}%22)

---

## 📜 発言した法案一覧

| 日付 | 法案名 | スタンス | 会議 |
|------|--------|----------|------|
${billRows || "*発言データなし*"}

${bills.length > 50 ? `\n> 他 ${bills.length - 50} 件の発言があります` : ""}

---

> 📝 このページは自動生成されています。データは [legislator_speeches.json](../index/legislators/legislator_speeches.json) に基づいています。
`;
}

// 議員一覧ダッシュボードを生成
function generateLegislatorDashboard(
  speechIndex: LegislatorSpeechIndex,
  owner: string,
  repo: string
): string {
  const legislators = Object.entries(speechIndex.legislators)
    .map(([name, record]) => ({ name, ...record }))
    .sort((a, b) => b.speech_count - a.speech_count);

  // 党派別統計
  const partyStats: Record<string, { count: number; speeches: number }> = {};
  for (const leg of legislators) {
    const party = leg.party || "不明";
    if (!partyStats[party]) {
      partyStats[party] = { count: 0, speeches: 0 };
    }
    partyStats[party].count++;
    partyStats[party].speeches += leg.speech_count;
  }

  const partyRows = Object.entries(partyStats)
    .sort((a, b) => b[1].speeches - a[1].speeches)
    .slice(0, 10)
    .map(([party, stats]) => {
      const color = getPartyColor(party);
      const badge = `![${party}](https://img.shields.io/badge/${encodeURIComponent(party)}-${color})`;
      return `| ${badge} | ${stats.count} 名 | ${stats.speeches} 件 |`;
    })
    .join("\n");

  // 上位発言者
  const topSpeakers = legislators.slice(0, 30).map(leg => {
    const stanceBar = [
      leg.stance_summary.support > 0 ? `🟢${leg.stance_summary.support}` : "",
      leg.stance_summary.oppose > 0 ? `🔴${leg.stance_summary.oppose}` : "",
    ].filter(Boolean).join("/") || "⚪";
    const profileLink = `[${leg.name}](./legislators/${encodeURIComponent(leg.name)}.md)`;
    return `| ${profileLink} | ${leg.party || "-"} | ${leg.speech_count} | ${stanceBar} |`;
  }).join("\n");

  return `# 🏛️ 議員活動ダッシュボード

> 最終更新: ${speechIndex.updated_at}

## 📊 概要

| 項目 | 数値 |
|------|------|
| **追跡議員数** | ${speechIndex.total_legislators} 名 |
| **総発言記録** | ${speechIndex.total_speeches} 件 |

---

## 🏢 党派別統計

| 党派 | 議員数 | 発言数 |
|------|--------|--------|
${partyRows}

---

## 🎤 発言数ランキング（上位30名）

| 議員名 | 所属 | 発言数 | スタンス |
|--------|------|--------|----------|
${topSpeakers}

---

## 🔍 検索

### ラベルで検索

- [全ての法案Issue](https://github.com/${owner}/${repo}/issues?q=is%3Aissue+label%3A法案)
- [成立した法案](https://github.com/${owner}/${repo}/issues?q=is%3Aissue+label%3A成立)
- [審議中の法案](https://github.com/${owner}/${repo}/issues?q=is%3Aissue+label%3A審議中)

### 議員を探す

議員名で検索: 上の表から議員名をクリックするか、[発言者ラベル一覧](https://github.com/${owner}/${repo}/labels?q=発言者)から探してください。

---

> 📝 このダッシュボードは自動生成されています。
> データソース: 国会会議録検索システムAPI、SMRI法案データベース
`;
}

// 議員ページを生成
function generateLegislatorPages(speechIndex: LegislatorSpeechIndex): void {
  console.log("👤 議員ページを生成中...");

  const { owner, repo } = getRepoInfo();
  const legislatorsDir = path.join(DOCS_DIR, "legislators");
  ensureDir(legislatorsDir);

  // 個別プロフィールページを生成
  let generated = 0;
  for (const [name, record] of Object.entries(speechIndex.legislators)) {
    // ファイル名から不正な文字を除去
    const safeName = name.replace(/[/\\?%*:|"<>]/g, "_");
    const filePath = path.join(legislatorsDir, `${safeName}.md`);
    const content = generateLegislatorProfile(name, record, owner, repo);
    fs.writeFileSync(filePath, content, "utf-8");
    generated++;
  }

  // ダッシュボードページを生成
  const dashboardPath = path.join(DOCS_DIR, "legislators.md");
  const dashboardContent = generateLegislatorDashboard(speechIndex, owner, repo);
  fs.writeFileSync(dashboardPath, dashboardContent, "utf-8");

  console.log(`  → ${generated} 名の議員プロフィールを生成`);
  console.log(`  → ダッシュボード: ${dashboardPath}`);
}

// メイン処理
async function main(): Promise<void> {
  console.log("📄 ドキュメント生成スクリプト");
  console.log("=".repeat(50));

  // 法令インデックス読み込み
  const lawIndex = loadLawIndex();

  if (!lawIndex || !lawIndex.laws) {
    console.error("❌ 法令インデックスが見つかりません");
    console.log("  → 先に incremental_update.ts を実行してください");
    process.exit(1);
  }

  console.log(`📋 法令インデックス: ${lawIndex.laws.length} 件`);

  // 出力ディレクトリ準備
  ensureDir(path.join(INDEX_DIR, "categories"));
  ensureDir(DOCS_DIR);

  // 検索インデックス生成
  const searchIndex = generateSearchIndex(lawIndex.laws);
  fs.writeFileSync(
    path.join(INDEX_DIR, "search_index.json"),
    JSON.stringify(searchIndex, null, 2),
    "utf-8"
  );

  // サイト統計生成
  const siteStats = generateSiteStats(lawIndex.laws);
  fs.writeFileSync(
    path.join(INDEX_DIR, "site_stats.json"),
    JSON.stringify(siteStats, null, 2),
    "utf-8"
  );

  // カテゴリ別インデックス生成
  generateCategoryIndices(lawIndex.laws);

  // 参照グラフデータ確認
  checkReferenceGraph();

  // 議員ページ生成
  const speechIndex = loadLegislatorSpeechIndex();
  if (speechIndex && Object.keys(speechIndex.legislators).length > 0) {
    generateLegislatorPages(speechIndex);
  } else {
    console.log("⚠️ 議員発言インデックスがありません（create_bill_issues.ts で生成）");
  }

  // 結果表示
  console.log("\n" + "=".repeat(50));
  console.log("✅ ドキュメント生成完了!");
  console.log("");
  console.log("📁 生成されたファイル:");
  console.log(`  - ${path.join(INDEX_DIR, "search_index.json")}`);
  console.log(`  - ${path.join(INDEX_DIR, "site_stats.json")}`);
  console.log(`  - ${path.join(INDEX_DIR, "categories", "*.json")}`);
  if (speechIndex) {
    console.log(`  - ${path.join(DOCS_DIR, "legislators.md")} (ダッシュボード)`);
    console.log(`  - ${path.join(DOCS_DIR, "legislators", "*.md")} (個別プロフィール)`);
  }
  console.log("");
  console.log("📊 統計サマリー:");
  for (const [category, count] of Object.entries(siteStats.by_category)) {
    const name = CATEGORY_NAMES[category] || category;
    console.log(`  - ${name}: ${count} 件`);
  }
  if (speechIndex) {
    console.log(`  - 議員: ${speechIndex.total_legislators} 名`);
    console.log(`  - 発言記録: ${speechIndex.total_speeches} 件`);
  }
}

main().catch(console.error);
