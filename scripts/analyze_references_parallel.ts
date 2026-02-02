/**
 * analyze_references_parallel.ts
 * 法令間の相互参照を解析（マルチスレッド版）
 */

import * as fs from "fs";
import * as path from "path";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import * as os from "os";

const DATA_DIR = path.join(__dirname, "..", "data");
const XML_DIR = path.join(DATA_DIR, "xml");
const INDEX_DIR = path.join(DATA_DIR, "index");

const NUM_WORKERS = Math.max(1, os.cpus().length - 1);

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

// ==================== Worker Thread Code ====================
if (!isMainThread) {
  const { xmlFiles, lawIndex, abbreviations } = workerData;

  const titleToLaw = new Map<string, LawIndex>();
  const numToLaw = new Map<string, LawIndex>();
  const abbrevMap = new Map<string, LawIndex>();

  for (const law of lawIndex) {
    titleToLaw.set(law.title, law);
    numToLaw.set(law.lawNum, law);
  }

  for (const [abbrev, law] of Object.entries(abbreviations)) {
    abbrevMap.set(abbrev, law as LawIndex);
  }

  const allReferences: Reference[] = [];

  for (const xmlPath of xmlFiles) {
    try {
      const xmlContent = fs.readFileSync(xmlPath, "utf-8");
      const lawId = path.basename(xmlPath, ".xml");
      const law = lawIndex.find((l: LawIndex) => l.id === lawId);

      if (law) {
        const refs = extractReferences(xmlContent, law, titleToLaw, numToLaw, abbrevMap);
        allReferences.push(...refs);
      }
    } catch (e) {
      // エラーは無視
    }
  }

  parentPort?.postMessage(allReferences);

  function extractReferences(
    xmlContent: string,
    fromLaw: LawIndex,
    titleToLaw: Map<string, LawIndex>,
    numToLaw: Map<string, LawIndex>,
    abbreviations: Map<string, LawIndex>
  ): Reference[] {
    const references: Reference[] = [];

    // パターン1: 「○○法（○○年法律第○号）」
    const fullRefPattern = /([^\s（）「」、。]+?(?:法|令|規則|条例))（([^）]+?(?:法律|政令|省令|規則)第[^）]+?号)）/g;

    // パターン2: 「○○法第○条」
    const shortRefPattern = /([^\s（）「」、。]+?(?:法|令|規則))第([一二三四五六七八九十百千〇０-９0-9]+)条/g;

    let match;

    while ((match = fullRefPattern.exec(xmlContent)) !== null) {
      const lawName = match[1];
      const lawNum = match[2];
      const context = xmlContent.substring(
        Math.max(0, match.index - 20),
        Math.min(xmlContent.length, match.index + match[0].length + 20)
      );

      let targetLaw = titleToLaw.get(lawName) || abbreviations.get(lawName) || numToLaw.get(lawNum);

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

    while ((match = shortRefPattern.exec(xmlContent)) !== null) {
      const lawName = match[1];
      const articleNum = match[2];

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
}

// ==================== Main Thread Code ====================
if (isMainThread) {
  main().catch(console.error);
}

async function main(): Promise<void> {
  console.log("🔗 相互参照解析スクリプト（マルチスレッド版）");
  console.log(`🖥️  使用スレッド数: ${NUM_WORKERS}`);
  console.log("=".repeat(50));

  const laws = loadLawIndex();
  console.log(`📋 法令インデックス: ${laws.length} 件`);

  if (laws.length === 0) {
    console.error("❌ 法令インデックスが空です");
    return;
  }

  // 略称マップ
  const abbreviations = buildAbbreviations(laws);
  console.log(`📚 略称マップ: ${Object.keys(abbreviations).length} 件`);

  // XMLファイル一覧
  const xmlFiles = getXmlFiles(XML_DIR);
  console.log(`📄 XMLファイル: ${xmlFiles.length} 件`);

  // ファイルをワーカーに分割
  const chunkSize = Math.ceil(xmlFiles.length / NUM_WORKERS);
  const chunks: string[][] = [];

  for (let i = 0; i < xmlFiles.length; i += chunkSize) {
    chunks.push(xmlFiles.slice(i, i + chunkSize));
  }

  console.log(`\n🔍 参照を解析中（${NUM_WORKERS}スレッド並列）...\n`);

  const startTime = Date.now();

  // 並列実行
  const promises = chunks.map((chunk, index) => {
    return new Promise<Reference[]>((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: {
          xmlFiles: chunk,
          lawIndex: laws,
          abbreviations,
        },
      });

      worker.on("message", (refs: Reference[]) => {
        console.log(`  Worker ${index + 1}/${NUM_WORKERS} 完了: ${refs.length} 件の参照`);
        resolve(refs);
      });
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`Worker ${index} exited with code ${code}`));
        }
      });
    });
  });

  const results = await Promise.all(promises);
  const allReferences = results.flat();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n⏱️  処理時間: ${elapsed}秒`);

  // 重複除去
  const uniqueRefs = dedupeReferences(allReferences);
  console.log(`\n📊 抽出結果:`);
  console.log(`   - 総参照数: ${allReferences.length} 件`);
  console.log(`   - 重複除去後: ${uniqueRefs.length} 件`);

  // 保存
  ensureDir(INDEX_DIR);

  const referencesOutput = {
    updated_at: new Date().toISOString(),
    total_references: uniqueRefs.length,
    references: uniqueRefs,
  };

  const referencesPath = path.join(INDEX_DIR, "references.json");
  fs.writeFileSync(referencesPath, JSON.stringify(referencesOutput, null, 2), "utf-8");
  console.log(`\n💾 参照グラフを保存: ${referencesPath}`);

  // 被参照グラフ
  console.log("\n🔄 被参照グラフを生成中...");
  const backlinks = buildBacklinks(uniqueRefs, laws);

  const backlinksPath = path.join(INDEX_DIR, "backlinks.json");
  fs.writeFileSync(backlinksPath, JSON.stringify(backlinks, null, 2), "utf-8");
  console.log(`💾 被参照グラフを保存: ${backlinksPath}`);

  // 統計
  const referencedLaws = Object.values(backlinks.backlinks)
    .filter((b: any) => b.referenced_by.length > 0)
    .sort((a: any, b: any) => b.referenced_by.length - a.referenced_by.length);

  console.log(`\n📈 被参照数トップ10:`);
  for (const law of referencedLaws.slice(0, 10) as any[]) {
    const totalRefs = law.referenced_by.reduce((sum: number, r: any) => sum + r.count, 0);
    console.log(`   ${law.law_title}: ${law.referenced_by.length}法令から${totalRefs}回参照`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ 完了!");
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadLawIndex(): LawIndex[] {
  const indexPath = path.join(INDEX_DIR, "laws.json");
  if (fs.existsSync(indexPath)) {
    const data = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    return data.laws || [];
  }
  return [];
}

function buildAbbreviations(laws: LawIndex[]): { [abbrev: string]: LawIndex } {
  const titleToLaw = new Map<string, LawIndex>();
  for (const law of laws) {
    titleToLaw.set(law.title, law);
  }

  const commonAbbreviations: { [abbrev: string]: string } = {
    "民法": "民法",
    "刑法": "刑法",
    "商法": "商法",
    "憲法": "日本国憲法",
    "会社法": "会社法",
    "民訴法": "民事訴訟法",
    "刑訴法": "刑事訴訟法",
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
  };

  const result: { [abbrev: string]: LawIndex } = {};

  for (const [abbrev, fullTitle] of Object.entries(commonAbbreviations)) {
    const law = titleToLaw.get(fullTitle);
    if (law) {
      result[abbrev] = law;
    }
  }

  return result;
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

function dedupeReferences(refs: Reference[]): Reference[] {
  const seen = new Set<string>();
  return refs.filter(ref => {
    const key = `${ref.from_law_id}:${ref.to_law_id || ref.to_law_title}:${ref.article || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildBacklinks(references: Reference[], laws: LawIndex[]): any {
  const backlinks: any = { backlinks: {} };

  for (const law of laws) {
    backlinks.backlinks[law.id] = {
      law_id: law.id,
      law_title: law.title,
      referenced_by: [],
    };
  }

  const countMap = new Map<string, Map<string, number>>();

  for (const ref of references) {
    if (!ref.to_law_id) continue;

    if (!countMap.has(ref.to_law_id)) {
      countMap.set(ref.to_law_id, new Map());
    }
    const fromMap = countMap.get(ref.to_law_id)!;
    fromMap.set(ref.from_law_id, (fromMap.get(ref.from_law_id) || 0) + 1);
  }

  for (const [toLawId, fromMap] of countMap) {
    if (!backlinks.backlinks[toLawId]) continue;

    for (const [fromLawId, count] of fromMap) {
      const fromLaw = laws.find(l => l.id === fromLawId);
      if (fromLaw) {
        backlinks.backlinks[toLawId].referenced_by.push({
          law_id: fromLawId,
          law_title: fromLaw.title,
          count,
        });
      }
    }

    backlinks.backlinks[toLawId].referenced_by.sort((a: any, b: any) => b.count - a.count);
  }

  backlinks.updated_at = new Date().toISOString();
  return backlinks;
}
