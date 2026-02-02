/**
 * convert_to_markdown.ts
 * Lawtext形式の法令をMarkdown形式（リンク付き）に変換する
 * 相互参照リンクと被参照一覧を含む
 */

import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(__dirname, "..", "data");
const LAWTEXT_DIR = path.join(DATA_DIR, "lawtext");
const MARKDOWN_DIR = path.join(DATA_DIR, "markdown");
const INDEX_DIR = path.join(DATA_DIR, "index");

// 法令インデックス
interface LawIndex {
  id: string;
  lawNum: string;
  title: string;
  category: string;
}

// 被参照情報
interface Backlink {
  law_id: string;
  law_title: string;
  referenced_by: {
    law_id: string;
    law_title: string;
    count: number;
  }[];
}

let lawIndex: LawIndex[] = [];
let lawTitleToInfo: Map<string, LawIndex> = new Map();
let lawIdToInfo: Map<string, LawIndex> = new Map();
let backlinks: Record<string, Backlink> = {};
let abbreviations: Map<string, LawIndex> = new Map();

// データ読み込み
function loadData(): void {
  // 法令インデックス
  const indexPath = path.join(INDEX_DIR, "laws.json");
  if (fs.existsSync(indexPath)) {
    const data = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    lawIndex = data.laws || [];
    
    for (const law of lawIndex) {
      lawTitleToInfo.set(law.title, law);
      lawIdToInfo.set(law.id, law);
    }
  }

  // 被参照グラフ
  const backlinksPath = path.join(INDEX_DIR, "backlinks.json");
  if (fs.existsSync(backlinksPath)) {
    const data = JSON.parse(fs.readFileSync(backlinksPath, "utf-8"));
    backlinks = data.backlinks || {};
  }

  // 略称マップ
  buildAbbreviations();
}

// 略称マップを構築
function buildAbbreviations(): void {
  const commonAbbreviations: Record<string, string> = {
    "民法": "民法",
    "刑法": "刑法",
    "商法": "商法",
    "憲法": "日本国憲法",
    "会社法": "会社法",
    "民訴法": "民事訴訟法",
    "刑訴法": "刑事訴訟法",
    "行訴法": "行政事件訴訟法",
    "行手法": "行政手続法",
    "独禁法": "私的独占の禁止及び公正取引の確保に関する法律",
    "労基法": "労働基準法",
    "労契法": "労働契約法",
    "著作権法": "著作権法",
    "特許法": "特許法",
    "金商法": "金融商品取引法",
    "個人情報保護法": "個人情報の保護に関する法律",
  };

  for (const [abbrev, fullTitle] of Object.entries(commonAbbreviations)) {
    const law = lawTitleToInfo.get(fullTitle);
    if (law) {
      abbreviations.set(abbrev, law);
    }
  }
}

// ディレクトリ作成
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// Lawtextファイル一覧を取得
function getLawtextFiles(dir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...getLawtextFiles(fullPath));
    } else if (entry.name.endsWith(".law.txt")) {
      files.push(fullPath);
    }
  }
  return files;
}

// 漢数字をアラビア数字に変換（アンカーID用）
function kanjiToNumber(kanji: string): string {
  const kanjiNums: Record<string, number> = {
    "〇": 0, "一": 1, "二": 2, "三": 3, "四": 4,
    "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
    "十": 10, "百": 100, "千": 1000,
  };

  let result = 0;
  let current = 0;

  for (const char of kanji) {
    const num = kanjiNums[char];
    if (num === undefined) continue;

    if (num >= 10) {
      if (current === 0) current = 1;
      current *= num;
      if (num === 10) {
        result += current;
        current = 0;
      }
    } else {
      current += num;
    }
  }
  result += current;

  return result.toString();
}

// 相対パスを計算
function getRelativePath(fromCategory: string, toLaw: LawIndex): string {
  if (fromCategory === toLaw.category) {
    return `./${toLaw.id}.md`;
  } else {
    return `../${toLaw.category}/${toLaw.id}.md`;
  }
}

// 法令参照をリンクに変換
function addLawLinks(text: string, currentCategory: string, currentLawTitle: string): string {
  // パターン1: 「○○法（○○年法律第○号）第○条」
  const fullRefPattern = /([^\s（）「」、。]+?(?:法|令|規則))（([^）]+?(?:法律|政令|省令|規則)第[^）]+?号)）(?:第([一二三四五六七八九十百千]+)条)?/g;

  text = text.replace(fullRefPattern, (match, lawName, lawNum, articleNum) => {
    const targetLaw = lawTitleToInfo.get(lawName) || abbreviations.get(lawName);
    
    if (targetLaw && targetLaw.title !== currentLawTitle) {
      const relativePath = getRelativePath(currentCategory, targetLaw);
      if (articleNum) {
        const articleId = `第${articleNum}条`;
        return `[${match}](${relativePath}#${articleId})`;
      } else {
        return `[${lawName}](${relativePath})（${lawNum}）`;
      }
    }
    return match;
  });

  // パターン2: 「○○法第○条」（法令番号なし）
  const shortRefPattern = /([^\s（）「」、。\[]+?(?:法|令|規則))第([一二三四五六七八九十百千]+)条/g;

  text = text.replace(shortRefPattern, (match, lawName, articleNum) => {
    // 既にリンク化されている場合はスキップ
    if (text.includes(`[${match}]`)) return match;
    
    const targetLaw = lawTitleToInfo.get(lawName) || abbreviations.get(lawName);
    
    if (targetLaw && targetLaw.title !== currentLawTitle) {
      const relativePath = getRelativePath(currentCategory, targetLaw);
      const articleId = `第${articleNum}条`;
      return `[${match}](${relativePath}#${articleId})`;
    }
    return match;
  });

  return text;
}

// 同一法令内の条項参照をリンクに変換
function addInternalLinks(text: string): string {
  // 「第○条」「第○条第○項」などをアンカーリンクに
  const articlePattern = /(?<!\[)第([一二三四五六七八九十百千]+)条(?:の([一二三四五六七八九十]+))?(?![^\[]*\])/g;

  return text.replace(articlePattern, (match) => {
    return `[${match}](#${match})`;
  });
}

// LawtextをMarkdownに変換
function convertToMarkdown(lawtext: string, lawId: string, category: string): string {
  const lines = lawtext.split("\n");
  const mdLines: string[] = [];
  
  const law = lawIdToInfo.get(lawId);
  const lawTitle = law?.title || "";

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // 法令名（1行目）
    if (i === 0 && line.trim() && !line.startsWith("（")) {
      mdLines.push(`# ${line.trim()}`);
      mdLines.push("");
      continue;
    }

    // 法令番号
    if (line.startsWith("（") && line.endsWith("）") && i < 5) {
      mdLines.push(`*${line}*`);
      mdLines.push("");
      continue;
    }

    // 章・節の見出し
    if (line.match(/^\s*第[一二三四五六七八九十]+章/)) {
      mdLines.push(`## ${line.trim()}`);
      mdLines.push("");
      continue;
    }

    if (line.match(/^\s*第[一二三四五六七八九十]+節/)) {
      mdLines.push(`### ${line.trim()}`);
      mdLines.push("");
      continue;
    }

    // 条文タイトル（括弧で囲まれた行）
    if (line.match(/^\s*（[^）]+）\s*$/) && !line.includes("年") && !line.includes("号")) {
      mdLines.push(`#### ${line.trim()}`);
      continue;
    }

    // 条文（第○条）
    const articleMatch = line.match(/^(\s*)(第[一二三四五六七八九十百千]+条(?:の[一二三四五六七八九十]+)?)/);
    if (articleMatch) {
      const articleNum = articleMatch[2];
      const rest = line.substring(articleMatch[0].length);

      // アンカーを追加
      mdLines.push(`<a id="${articleNum}"></a>`);
      
      // 他法令への参照をリンク化
      let processedRest = addLawLinks(rest, category, lawTitle);
      
      mdLines.push(`**${articleNum}**${processedRest}`);
      continue;
    }

    // 項番号（２、３、４...）
    if (line.match(/^[２３４５６７８９０]+\s/)) {
      line = addLawLinks(line, category, lawTitle);
      mdLines.push(line);
      continue;
    }

    // 号（一、二、三...）
    if (line.match(/^\s*[一二三四五六七八九十]+\s/)) {
      line = addLawLinks(line, category, lawTitle);
      mdLines.push(`- ${line.trim()}`);
      continue;
    }

    // その他の行
    line = addLawLinks(line, category, lawTitle);
    mdLines.push(line);
  }

  // 被参照セクションを追加
  const lawBacklinks = backlinks[lawId];
  mdLines.push("");
  mdLines.push("---");
  mdLines.push("");
  mdLines.push("## この法令を参照している法令");
  mdLines.push("");

  if (lawBacklinks && lawBacklinks.referenced_by.length > 0) {
    // 参照数でソート済み
    for (const ref of lawBacklinks.referenced_by.slice(0, 50)) {
      const refLaw = lawIdToInfo.get(ref.law_id);
      if (refLaw) {
        const relativePath = getRelativePath(category, refLaw);
        mdLines.push(`- [${ref.law_title}](${relativePath}) (${ref.count}箇所)`);
      } else {
        mdLines.push(`- ${ref.law_title} (${ref.count}箇所)`);
      }
    }

    if (lawBacklinks.referenced_by.length > 50) {
      mdLines.push("");
      mdLines.push(`*他 ${lawBacklinks.referenced_by.length - 50} 件の法令から参照されています*`);
    }
  } else {
    mdLines.push("*この法令を参照している法令はありません*");
  }

  mdLines.push("");
  mdLines.push("---");
  mdLines.push(`*Generated from [e-Gov法令検索](https://elaws.e-gov.go.jp/)*`);

  return mdLines.join("\n");
}

// メイン処理
async function main(): Promise<void> {
  console.log("📝 Markdown変換スクリプト（相互参照リンク付き）");
  console.log("=".repeat(50));

  // データ読み込み
  loadData();
  console.log(`📋 法令インデックス: ${lawIndex.length} 件`);
  console.log(`🔗 被参照データ: ${Object.keys(backlinks).length} 件`);
  console.log(`📚 略称マップ: ${abbreviations.size} 件`);

  // カテゴリディレクトリ準備
  const categories = [
    "constitution", "acts", "cabinet_orders", "imperial_orders",
    "ministerial_ordinances", "rules", "misc",
  ];
  for (const category of categories) {
    ensureDir(path.join(MARKDOWN_DIR, category));
  }

  // Lawtextファイル一覧
  const lawtextFiles = getLawtextFiles(LAWTEXT_DIR);
  console.log(`\n📄 Lawtextファイル: ${lawtextFiles.length} 件`);

  let successCount = 0;
  let errorCount = 0;

  console.log("\n🔄 変換中...\n");

  for (let i = 0; i < lawtextFiles.length; i++) {
    const lawtextPath = lawtextFiles[i];
    const relativePath = path.relative(LAWTEXT_DIR, lawtextPath);
    const mdPath = path.join(MARKDOWN_DIR, relativePath.replace(".law.txt", ".md"));
    const lawId = path.basename(lawtextPath, ".law.txt");
    const category = path.dirname(relativePath);

    try {
      const lawtext = fs.readFileSync(lawtextPath, "utf-8");
      const markdown = convertToMarkdown(lawtext, lawId, category);

      ensureDir(path.dirname(mdPath));
      fs.writeFileSync(mdPath, markdown, "utf-8");
      successCount++;
    } catch (error: any) {
      console.error(`❌ エラー: ${lawId}`, error.message);
      errorCount++;
    }

    if ((i + 1) % 500 === 0) {
      console.log(`   処理済: ${i + 1}/${lawtextFiles.length}`);
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ 完了!");
  console.log(`  成功: ${successCount} 件`);
  console.log(`  エラー: ${errorCount} 件`);
}

main().catch(console.error);
