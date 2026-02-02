/**
 * extract_abbreviations.ts
 * 法令XMLから略称定義を抽出（メモリ効率版・フィルタ強化）
 */

import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(__dirname, "..", "data");
const XML_DIR = path.join(DATA_DIR, "xml");
const INDEX_DIR = path.join(DATA_DIR, "index");

interface LawIndex {
  id: string;
  lawNum: string;
  title: string;
  category: string;
}

function loadLawIndex(): LawIndex[] {
  const indexPath = path.join(INDEX_DIR, "laws.json");
  if (fs.existsSync(indexPath)) {
    const data = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    return data.laws || [];
  }
  return [];
}

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

// 除外すべき略称パターン
function shouldExclude(fullName: string, abbreviation: string): boolean {
  // 「この〇〇」で始まるものは自己参照なので除外
  if (fullName.startsWith("この")) return true;
  if (fullName.startsWith("本")) return true;
  
  // 一般的すぎる略称を除外
  const excludeAbbreviations = [
    "施行日", "改正法", "新法", "旧法", "新令", "旧令",
    "新規則", "旧規則", "新省令", "旧省令", "新様式", "旧様式",
    "機構", "センター", "協会", "委員会", "審議会",
    "裁決等", "訴願等", "申請等", "処分等", "届出等",
    "整備法", "関係政令", "通則法", "基本法",
    "施行令", "施行規則", "施行細則",
  ];
  if (excludeAbbreviations.includes(abbreviation)) return true;
  
  // 1文字の略称は除外
  if (abbreviation.length < 2) return true;
  
  // 数字のみの略称は除外
  if (/^[一二三四五六七八九十〇０-９0-9]+$/.test(abbreviation)) return true;
  
  return false;
}

function extractAbbreviationsFromXml(
  xmlContent: string,
  titleToLaw: Map<string, LawIndex>
): Map<string, { full_name: string; law_id: string | null }> {
  const abbreviations = new Map<string, { full_name: string; law_id: string | null }>();

  // パターン: 「○○法（○○年法律第○号。以下「○○」という。）」
  // または 「○○法（以下「○○」という。）」
  const pattern = /([一-龠ぁ-んァ-ヶａ-ｚＡ-Ｚa-zA-Z・]+(?:法|令|規則|条例))(?:（[^）]*?）)?[^。]{0,30}?以下「([^」]{2,20})」(?:という|と略称する|と総称する)/g;

  let match;
  while ((match = pattern.exec(xmlContent)) !== null) {
    const fullName = match[1];
    const abbreviation = match[2];
    
    // フィルタリング
    if (shouldExclude(fullName, abbreviation)) continue;
    
    // 既知の法令かどうか確認
    const targetLaw = titleToLaw.get(fullName);
    
    // 既知の法令のみを略称として記録（または法令名の形式を持つもの）
    if (targetLaw || fullName.match(/(?:法|令|規則|条例)$/)) {
      abbreviations.set(abbreviation, {
        full_name: fullName,
        law_id: targetLaw?.id || null,
      });
    }
  }

  return abbreviations;
}

async function main(): Promise<void> {
  console.log("📚 略称定義抽出スクリプト（メモリ効率版・フィルタ強化）");
  console.log("=".repeat(50));

  const startTime = Date.now();

  const laws = loadLawIndex();
  console.log(`📋 法令インデックス: ${laws.length} 件`);

  const titleToLaw = new Map<string, LawIndex>();
  for (const law of laws) {
    titleToLaw.set(law.title, law);
  }

  const xmlFiles = getXmlFiles(XML_DIR);
  console.log(`📄 XMLファイル: ${xmlFiles.length} 件`);

  // 略称マップ（集約用）
  const abbreviationMap: Map<string, { 
    full_name: string; 
    law_id: string | null;
    count: number;
  }> = new Map();

  let processedCount = 0;

  console.log("\n🔍 略称定義を抽出中...\n");

  for (const xmlPath of xmlFiles) {
    try {
      const xmlContent = fs.readFileSync(xmlPath, "utf-8");
      const abbrevs = extractAbbreviationsFromXml(xmlContent, titleToLaw);
      
      for (const [abbrev, info] of abbrevs) {
        if (abbreviationMap.has(abbrev)) {
          const existing = abbreviationMap.get(abbrev)!;
          existing.count++;
        } else {
          abbreviationMap.set(abbrev, {
            full_name: info.full_name,
            law_id: info.law_id,
            count: 1,
          });
        }
      }
    } catch (e) {
      // エラー無視
    }

    processedCount++;
    if (processedCount % 1000 === 0) {
      console.log(`  処理済: ${processedCount}/${xmlFiles.length}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n⏱️  処理時間: ${elapsed}秒`);
  console.log(`📊 ユニーク略称数: ${abbreviationMap.size} 件`);

  // 法令IDが紐づいているものをカウント
  let linkedCount = 0;
  for (const [, info] of abbreviationMap) {
    if (info.law_id) linkedCount++;
  }
  console.log(`📊 法令ID紐付け済み: ${linkedCount} 件`);

  // オブジェクト形式に変換
  const outputMap: { [abbrev: string]: any } = {};
  for (const [abbrev, info] of abbreviationMap) {
    outputMap[abbrev] = info;
  }

  // 保存
  const output = {
    updated_at: new Date().toISOString(),
    unique_abbreviations: abbreviationMap.size,
    linked_to_law: linkedCount,
    abbreviation_map: outputMap,
  };

  const outputPath = path.join(INDEX_DIR, "abbreviations.json");
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(`\n💾 保存: ${outputPath}`);

  // トップ20を表示（法令IDが紐づいているもの優先）
  const sorted = Array.from(abbreviationMap.entries())
    .filter(([, info]) => info.law_id !== null)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20);

  console.log("\n📈 よく使われる略称トップ20（法令ID紐付け済み）:");
  for (const [abbrev, info] of sorted) {
    console.log(`   「${abbrev}」→ ${info.full_name} (${info.count}法令で使用)`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ 完了!");
}

main().catch(console.error);
