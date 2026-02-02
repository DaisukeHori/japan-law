/**
 * convert_to_lawtext.ts
 * XML形式の法令をLawtext形式に変換する
 * 
 * 注意: lawtextパッケージが必要です
 * npm install lawtext
 */

import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(__dirname, "..", "data");
const XML_DIR = path.join(DATA_DIR, "xml");
const LAWTEXT_DIR = path.join(DATA_DIR, "lawtext");

// ディレクトリ作成
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ディレクトリ内のXMLファイルを取得
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

// XMLをLawtextに変換（簡易版）
// 本格的な変換にはlawtextパッケージを使用してください
function convertToLawtext(xml: string): string {
  // この実装は簡易版です
  // 実際のプロダクションではlawtextパッケージを使用してください
  
  const lines: string[] = [];
  
  // 法令名を抽出
  const titleMatch = xml.match(/<LawTitle[^>]*>([^<]+)<\/LawTitle>/);
  if (titleMatch) {
    lines.push(titleMatch[1]);
    lines.push("");
  }
  
  // 法令番号を抽出
  const numMatch = xml.match(/<LawNum>([^<]+)<\/LawNum>/);
  if (numMatch) {
    lines.push(`（${numMatch[1]}）`);
    lines.push("");
  }
  
  // 条文を抽出（簡易版）
  const articleRegex = /<Article[^>]*>[\s\S]*?<ArticleTitle>([^<]+)<\/ArticleTitle>[\s\S]*?<\/Article>/g;
  let match;
  
  while ((match = articleRegex.exec(xml)) !== null) {
    const articleTitle = match[1];
    lines.push(`  ${articleTitle}`);
    
    // 条文本文を抽出
    const sentenceRegex = /<Sentence[^>]*>([^<]+)<\/Sentence>/g;
    let sentenceMatch;
    const articleXml = match[0];
    
    while ((sentenceMatch = sentenceRegex.exec(articleXml)) !== null) {
      lines.push(sentenceMatch[1]);
    }
    
    lines.push("");
  }
  
  return lines.join("\n");
}

// メイン処理
async function main(): Promise<void> {
  console.log("🔄 Lawtext変換スクリプト");
  console.log("=".repeat(50));
  
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
    ensureDir(path.join(LAWTEXT_DIR, category));
  }
  
  // XMLファイル一覧を取得
  const xmlFiles = getXmlFiles(XML_DIR);
  console.log(`📋 ${xmlFiles.length} 件のXMLファイルを発見`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < xmlFiles.length; i++) {
    const xmlPath = xmlFiles[i];
    const relativePath = path.relative(XML_DIR, xmlPath);
    const lawtextPath = path.join(
      LAWTEXT_DIR,
      relativePath.replace(".xml", ".law.txt")
    );
    
    const progress = `[${i + 1}/${xmlFiles.length}]`;
    
    // 既に変換済みならスキップ
    if (fs.existsSync(lawtextPath)) {
      successCount++;
      continue;
    }
    
    try {
      console.log(`${progress} 🔄 変換中: ${path.basename(xmlPath)}`);
      
      const xml = fs.readFileSync(xmlPath, "utf-8");
      const lawtext = convertToLawtext(xml);
      
      ensureDir(path.dirname(lawtextPath));
      fs.writeFileSync(lawtextPath, lawtext, "utf-8");
      
      successCount++;
    } catch (error: any) {
      console.error(`${progress} ❌ エラー: ${path.basename(xmlPath)}`, error.message);
      errorCount++;
    }
  }
  
  console.log("\n" + "=".repeat(50));
  console.log("✅ 完了!");
  console.log(`  成功: ${successCount} 件`);
  console.log(`  エラー: ${errorCount} 件`);
}

main().catch(console.error);
