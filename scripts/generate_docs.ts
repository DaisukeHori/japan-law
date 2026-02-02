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

  // 結果表示
  console.log("\n" + "=".repeat(50));
  console.log("✅ ドキュメント生成完了!");
  console.log("");
  console.log("📁 生成されたファイル:");
  console.log(`  - ${path.join(INDEX_DIR, "search_index.json")}`);
  console.log(`  - ${path.join(INDEX_DIR, "site_stats.json")}`);
  console.log(`  - ${path.join(INDEX_DIR, "categories", "*.json")}`);
  console.log("");
  console.log("📊 統計サマリー:");
  for (const [category, count] of Object.entries(siteStats.by_category)) {
    const name = CATEGORY_NAMES[category] || category;
    console.log(`  - ${name}: ${count} 件`);
  }
}

main().catch(console.error);
