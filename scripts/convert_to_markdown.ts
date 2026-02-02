/**
 * convert_to_markdown.ts
 * Lawtext形式の法令をMarkdown形式（リンク付き）に変換する
 */

import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(__dirname, "..", "data");
const LAWTEXT_DIR = path.join(DATA_DIR, "lawtext");
const MARKDOWN_DIR = path.join(DATA_DIR, "markdown");
const INDEX_DIR = path.join(DATA_DIR, "index");

// 法令インデックス読み込み
interface LawIndex {
  id: string;
  lawNum: string;
  title: string;
  category: string;
}

let lawIndex: LawIndex[] = [];
let lawTitleToId: Map<string, string> = new Map();

function loadLawIndex(): void {
  const indexPath = path.join(INDEX_DIR, "laws.json");
  if (fs.existsSync(indexPath)) {
    const data = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    lawIndex = data.laws || [];
    
    // タイトル → ID のマッピング作成
    for (const law of lawIndex) {
      lawTitleToId.set(law.title, law.id);
      // 略称も登録（将来拡張用）
    }
  }
}

// ディレクトリ作成
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ディレクトリ内のLawtextファイルを取得
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

// 条項参照をリンクに変換
function addInternalLinks(text: string): string {
  // 同一法令内の条項参照
  // 「第○条」「第○条第○項」などをアンカーリンクに
  const articlePattern = /第([一二三四五六七八九十百千]+)条(?:の([一二三四五六七八九十]+))?(?:第([一二三四五六七八九十]+)項)?/g;
  
  return text.replace(articlePattern, (match) => {
    // アンカーIDを生成（簡易版）
    const anchorId = match.replace(/\s+/g, "");
    return `[${match}](#${anchorId})`;
  });
}

// 他法令への参照をリンクに変換
function addExternalLinks(text: string, currentCategory: string): string {
  // 「○○法（○○年法律第○号）第○条」のパターン
  const lawRefPattern = /([^\s（）「」]+(?:法|令|規則))（([^）]+)）(?:第([一二三四五六七八九十百千]+)条)?/g;
  
  return text.replace(lawRefPattern, (match, lawName, lawNum, articleNum) => {
    const lawId = lawTitleToId.get(lawName);
    
    if (lawId) {
      const law = lawIndex.find((l) => l.id === lawId);
      if (law) {
        const relativePath = getRelativePath(currentCategory, law.category, lawId);
        if (articleNum) {
          return `[${match}](${relativePath}#第${articleNum}条)`;
        } else {
          return `[${lawName}](${relativePath})`;
        }
      }
    }
    
    return match; // リンクできない場合はそのまま
  });
}

// 相対パスを計算
function getRelativePath(fromCategory: string, toCategory: string, toLawId: string): string {
  if (fromCategory === toCategory) {
    return `./${toLawId}.md`;
  } else {
    return `../${toCategory}/${toLawId}.md`;
  }
}

// LawtextをMarkdownに変換
function convertToMarkdown(lawtext: string, lawId: string, category: string): string {
  const lines = lawtext.split("\n");
  const mdLines: string[] = [];
  
  let inArticle = false;
  
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
    
    // 条文タイトル
    if (line.match(/^\s*（.+）\s*$/)) {
      mdLines.push(`#### ${line.trim()}`);
      continue;
    }
    
    // 条文
    if (line.match(/^\s*第[一二三四五六七八九十百千]+条/)) {
      // 条番号をアンカー付きで出力
      const articleMatch = line.match(/^(\s*)(第[一二三四五六七八九十百千]+条(?:の[一二三四五六七八九十]+)?)/);
      if (articleMatch) {
        const indent = articleMatch[1];
        const articleNum = articleMatch[2];
        const rest = line.substring(articleMatch[0].length);
        
        // 相互参照リンクを追加
        let processedRest = addInternalLinks(rest);
        processedRest = addExternalLinks(processedRest, category);
        
        mdLines.push(`<a id="${articleNum}"></a>`);
        mdLines.push(`**${articleNum}**${processedRest}`);
        inArticle = true;
        continue;
      }
    }
    
    // 項番号
    if (line.match(/^[２３４５６７８９０]+\s/)) {
      line = addInternalLinks(line);
      line = addExternalLinks(line, category);
      mdLines.push(line);
      continue;
    }
    
    // 号（箇条書き）
    if (line.match(/^\s*[一二三四五六七八九十]+\s/)) {
      line = addInternalLinks(line);
      line = addExternalLinks(line, category);
      mdLines.push(`- ${line.trim()}`);
      continue;
    }
    
    // その他の行
    line = addInternalLinks(line);
    line = addExternalLinks(line, category);
    mdLines.push(line);
  }
  
  // フッター（被参照リンクのプレースホルダー）
  mdLines.push("");
  mdLines.push("---");
  mdLines.push("");
  mdLines.push("## この法令を参照している法令");
  mdLines.push("");
  mdLines.push("*（自動生成される予定）*");
  mdLines.push("");
  mdLines.push(`---`);
  mdLines.push(`*Generated from [e-Gov法令検索](https://laws.e-gov.go.jp/)*`);
  
  return mdLines.join("\n");
}

// メイン処理
async function main(): Promise<void> {
  console.log("📝 Markdown変換スクリプト（リンク付き）");
  console.log("=".repeat(50));
  
  // 法令インデックス読み込み
  loadLawIndex();
  console.log(`📋 法令インデックス: ${lawIndex.length} 件`);
  
  // カテゴリ一覧
  const categories = [
    "constitution",
    "acts",
    "cabinet_orders",
    "imperial_orders",
    "ministerial_ordinances",
    "rules",
    "misc",
  ];
  
  // 各カテゴリのディレクトリを準備
  for (const category of categories) {
    ensureDir(path.join(MARKDOWN_DIR, category));
  }
  
  // Lawtextファイル一覧を取得
  const lawtextFiles = getLawtextFiles(LAWTEXT_DIR);
  console.log(`📋 ${lawtextFiles.length} 件のLawtextファイルを発見`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < lawtextFiles.length; i++) {
    const lawtextPath = lawtextFiles[i];
    const relativePath = path.relative(LAWTEXT_DIR, lawtextPath);
    const mdPath = path.join(
      MARKDOWN_DIR,
      relativePath.replace(".law.txt", ".md")
    );
    
    const progress = `[${i + 1}/${lawtextFiles.length}]`;
    
    // 既に変換済みならスキップ
    if (fs.existsSync(mdPath)) {
      successCount++;
      continue;
    }
    
    try {
      const lawId = path.basename(lawtextPath, ".law.txt");
      const category = path.dirname(relativePath);
      
      console.log(`${progress} 📝 変換中: ${lawId}`);
      
      const lawtext = fs.readFileSync(lawtextPath, "utf-8");
      const markdown = convertToMarkdown(lawtext, lawId, category);
      
      ensureDir(path.dirname(mdPath));
      fs.writeFileSync(mdPath, markdown, "utf-8");
      
      successCount++;
    } catch (error: any) {
      console.error(`${progress} ❌ エラー: ${path.basename(lawtextPath)}`, error.message);
      errorCount++;
    }
  }
  
  console.log("\n" + "=".repeat(50));
  console.log("✅ 完了!");
  console.log(`  成功: ${successCount} 件`);
  console.log(`  エラー: ${errorCount} 件`);
}

main().catch(console.error);
