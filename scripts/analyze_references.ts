/**
 * analyze_references.ts
 * 法令間の相互参照を解析し、リンク情報を生成する
 */

import * as fs from "fs";
import * as path from "path";
import { XMLParser } from "fast-xml-parser";

const DATA_DIR = path.join(__dirname, "..", "data");
const XML_DIR = path.join(DATA_DIR, "xml");
const INDEX_DIR = path.join(DATA_DIR, "index");

interface LawIndex {
  id: string;
  lawNum: string;
  title: string;
  category: string;
}

interface Reference {
  from_law_id: string;
  from_law_title: string;
  to_law_id: string | null;
  to_law_title: string;
  to_law_num: string | null;
  article: string | null;
  context: string;
}

interface ReferenceGraph {
  updated_at: string;
  total_references: number;
  references: Reference[];
}

interface BacklinkGraph {
  updated_at: string;
  backlinks: Record<string, {
    law_id: string;
    law_title: string;
    referenced_by: {
      law_id: string;
      law_title: string;
      count: number;
    }[];
  }>;
}

// 法令インデックスをロード
function loadLawIndex(): LawIndex[] {
  const indexPath = path.join(INDEX_DIR, "laws.json");
  if (fs.existsSync(indexPath)) {
    const data = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    return data.laws || [];
  }
  return [];
}

// 法令名→ID/情報のマップを作成
function buildLawMaps(laws: LawIndex[]): {
  titleToLaw: Map<string, LawIndex>;
  numToLaw: Map<string, LawIndex>;
  abbreviations: Map<string, LawIndex>;
} {
  const titleToLaw = new Map<string, LawIndex>();
  const numToLaw = new Map<string, LawIndex>();
  const abbreviations = new Map<string, LawIndex>();

  for (const law of laws) {
    titleToLaw.set(law.title, law);
    numToLaw.set(law.lawNum, law);

    // 略称を生成（例：「行政手続法」→「行手法」）
    // 一般的な略称パターン
    if (law.title.endsWith("法")) {
      // 「○○に関する法律」→「○○法」
      const match = law.title.match(/^(.+?)に関する法律$/);
      if (match) {
        abbreviations.set(match[1] + "法", law);
      }
    }
  }

  // よく使われる略称を手動で追加
  const commonAbbreviations: Record<string, string> = {
    "民法": "民法",
    "刑法": "刑法",
    "商法": "商法",
    "憲法": "日本国憲法",
    "会社法": "会社法",
    "民訴法": "民事訴訟法",
    "刑訴法": "刑事訴訟法",
    "行政事件訴訟法": "行政事件訴訟法",
    "行訴法": "行政事件訴訟法",
    "行手法": "行政手続法",
    "行政手続法": "行政手続法",
    "独禁法": "私的独占の禁止及び公正取引の確保に関する法律",
    "独占禁止法": "私的独占の禁止及び公正取引の確保に関する法律",
    "労基法": "労働基準法",
    "労働基準法": "労働基準法",
    "労契法": "労働契約法",
    "著作権法": "著作権法",
    "特許法": "特許法",
    "金商法": "金融商品取引法",
    "金融商品取引法": "金融商品取引法",
    "個人情報保護法": "個人情報の保護に関する法律",
    "番号法": "行政手続における特定の個人を識別するための番号の利用等に関する法律",
    "マイナンバー法": "行政手続における特定の個人を識別するための番号の利用等に関する法律",
  };

  for (const [abbrev, fullTitle] of Object.entries(commonAbbreviations)) {
    const law = titleToLaw.get(fullTitle);
    if (law) {
      abbreviations.set(abbrev, law);
    }
  }

  return { titleToLaw, numToLaw, abbreviations };
}

// XMLから法令参照を抽出
function extractReferencesFromXml(
  xmlContent: string,
  fromLaw: LawIndex,
  maps: ReturnType<typeof buildLawMaps>
): Reference[] {
  const references: Reference[] = [];
  const { titleToLaw, numToLaw, abbreviations } = maps;

  // パターン1: 「○○法（○○年法律第○号）」
  const fullRefPattern = /([^\s（）「」、。]+?(?:法|令|規則|条例))（([^）]+?(?:法律|政令|省令|規則)第[^）]+?号)）/g;

  // パターン2: 「○○法第○条」（法令番号なし）
  const shortRefPattern = /([^\s（）「」、。]+?(?:法|令|規則))第([一二三四五六七八九十百千〇０-９0-9]+)条/g;

  // パターン3: 法令番号のみ「（○○年法律第○号）」
  const numOnlyPattern = /（([^）]+?(?:法律|政令|省令|規則)第[^）]+?号)）/g;

  let match;

  // パターン1の抽出
  while ((match = fullRefPattern.exec(xmlContent)) !== null) {
    const lawName = match[1];
    const lawNum = match[2];
    const context = xmlContent.substring(
      Math.max(0, match.index - 20),
      Math.min(xmlContent.length, match.index + match[0].length + 20)
    );

    // 法令を特定
    let targetLaw = titleToLaw.get(lawName) || 
                    abbreviations.get(lawName) ||
                    numToLaw.get(lawNum);

    references.push({
      from_law_id: fromLaw.id,
      from_law_title: fromLaw.title,
      to_law_id: targetLaw?.id || null,
      to_law_title: lawName,
      to_law_num: lawNum,
      article: null,
      context: context.replace(/[\n\r]/g, " ").trim(),
    });
  }

  // パターン2の抽出
  while ((match = shortRefPattern.exec(xmlContent)) !== null) {
    const lawName = match[1];
    const articleNum = match[2];

    // 自法令への参照は除外
    if (lawName === fromLaw.title) continue;

    let targetLaw = titleToLaw.get(lawName) || abbreviations.get(lawName);

    if (targetLaw) {
      const context = xmlContent.substring(
        Math.max(0, match.index - 20),
        Math.min(xmlContent.length, match.index + match[0].length + 20)
      );

      references.push({
        from_law_id: fromLaw.id,
        from_law_title: fromLaw.title,
        to_law_id: targetLaw.id,
        to_law_title: lawName,
        to_law_num: targetLaw.lawNum,
        article: `第${articleNum}条`,
        context: context.replace(/[\n\r]/g, " ").trim(),
      });
    }
  }

  return references;
}

// XMLファイルを取得
function getXmlFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getXmlFiles(fullPath));
    } else if (entry.name.endsWith(".xml")) {
      files.push(fullPath);
    }
  }
  return files;
}

// 重複を除去
function dedupeReferences(refs: Reference[]): Reference[] {
  const seen = new Set<string>();
  return refs.filter(ref => {
    const key = `${ref.from_law_id}:${ref.to_law_id || ref.to_law_title}:${ref.article || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 被参照グラフを生成
function buildBacklinks(references: Reference[], laws: LawIndex[]): BacklinkGraph {
  const backlinks: BacklinkGraph["backlinks"] = {};

  // 全法令を初期化
  for (const law of laws) {
    backlinks[law.id] = {
      law_id: law.id,
      law_title: law.title,
      referenced_by: [],
    };
  }

  // 参照をカウント
  const countMap = new Map<string, Map<string, number>>();

  for (const ref of references) {
    if (!ref.to_law_id) continue;

    if (!countMap.has(ref.to_law_id)) {
      countMap.set(ref.to_law_id, new Map());
    }
    const fromMap = countMap.get(ref.to_law_id)!;
    fromMap.set(ref.from_law_id, (fromMap.get(ref.from_law_id) || 0) + 1);
  }

  // バックリンクを構築
  for (const [toLawId, fromMap] of countMap) {
    if (!backlinks[toLawId]) continue;

    const lawIndex = laws.find(l => l.id === toLawId);
    
    for (const [fromLawId, count] of fromMap) {
      const fromLaw = laws.find(l => l.id === fromLawId);
      if (fromLaw) {
        backlinks[toLawId].referenced_by.push({
          law_id: fromLawId,
          law_title: fromLaw.title,
          count,
        });
      }
    }

    // 参照数でソート
    backlinks[toLawId].referenced_by.sort((a, b) => b.count - a.count);
  }

  return {
    updated_at: new Date().toISOString(),
    backlinks,
  };
}

// メイン処理
async function main(): Promise<void> {
  console.log("🔗 相互参照解析スクリプト");
  console.log("=".repeat(50));

  // 法令インデックス読み込み
  const laws = loadLawIndex();
  console.log(`📋 法令インデックス: ${laws.length} 件`);

  if (laws.length === 0) {
    console.error("❌ 法令インデックスが空です");
    return;
  }

  // マップ作成
  const maps = buildLawMaps(laws);
  console.log(`📚 法令マップ作成完了`);
  console.log(`   - タイトル: ${maps.titleToLaw.size} 件`);
  console.log(`   - 法令番号: ${maps.numToLaw.size} 件`);
  console.log(`   - 略称: ${maps.abbreviations.size} 件`);

  // XMLファイル一覧
  const xmlFiles = getXmlFiles(XML_DIR);
  console.log(`\n📄 XMLファイル: ${xmlFiles.length} 件`);

  // 参照を抽出
  const allReferences: Reference[] = [];
  let processedCount = 0;

  console.log("\n🔍 参照を解析中...\n");

  for (const xmlPath of xmlFiles) {
    const lawId = path.basename(xmlPath, ".xml");
    const law = laws.find(l => l.id === lawId);

    if (!law) continue;

    try {
      const xmlContent = fs.readFileSync(xmlPath, "utf-8");
      const refs = extractReferencesFromXml(xmlContent, law, maps);
      allReferences.push(...refs);
    } catch (error: any) {
      console.error(`❌ エラー: ${lawId}`, error.message);
    }

    processedCount++;
    if (processedCount % 500 === 0) {
      console.log(`   処理済: ${processedCount}/${xmlFiles.length} (参照: ${allReferences.length}件)`);
    }
  }

  // 重複除去
  const uniqueRefs = dedupeReferences(allReferences);
  console.log(`\n📊 抽出結果:`);
  console.log(`   - 総参照数: ${allReferences.length} 件`);
  console.log(`   - 重複除去後: ${uniqueRefs.length} 件`);

  // 参照グラフを保存
  const referencesOutput: ReferenceGraph = {
    updated_at: new Date().toISOString(),
    total_references: uniqueRefs.length,
    references: uniqueRefs,
  };

  const referencesPath = path.join(INDEX_DIR, "references.json");
  fs.writeFileSync(referencesPath, JSON.stringify(referencesOutput, null, 2), "utf-8");
  console.log(`\n💾 参照グラフを保存: ${referencesPath}`);

  // 被参照グラフを生成・保存
  console.log("\n🔄 被参照グラフを生成中...");
  const backlinks = buildBacklinks(uniqueRefs, laws);

  const backlinksPath = path.join(INDEX_DIR, "backlinks.json");
  fs.writeFileSync(backlinksPath, JSON.stringify(backlinks, null, 2), "utf-8");
  console.log(`💾 被参照グラフを保存: ${backlinksPath}`);

  // 統計
  const referencedLaws = Object.values(backlinks.backlinks)
    .filter(b => b.referenced_by.length > 0)
    .sort((a, b) => b.referenced_by.length - a.referenced_by.length);

  console.log(`\n📈 被参照数トップ10:`);
  for (const law of referencedLaws.slice(0, 10)) {
    const totalRefs = law.referenced_by.reduce((sum, r) => sum + r.count, 0);
    console.log(`   ${law.law_title}: ${law.referenced_by.length}法令から${totalRefs}回参照`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ 完了!");
}

main().catch(console.error);
