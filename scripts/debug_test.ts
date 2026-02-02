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
  console.log("📁 laws.json パス:", indexPath);
  console.log("   存在:", fs.existsSync(indexPath));
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

async function main() {
  console.log("🔍 デバッグテスト");
  
  const laws = loadLawIndex();
  console.log("📋 法令数:", laws.length);
  
  const lawIdMap = new Map<string, LawIndex>();
  for (const law of laws) {
    lawIdMap.set(law.id, law);
  }
  
  const xmlFiles = getXmlFiles(XML_DIR);
  console.log("📄 XMLファイル数:", xmlFiles.length);
  
  if (xmlFiles.length > 0) {
    console.log("\n最初の5件のマッチング確認:");
    for (const f of xmlFiles.slice(0, 5)) {
      const lawId = path.basename(f, ".xml");
      const found = lawIdMap.has(lawId);
      console.log("  " + lawId + ": マップに" + (found ? "存在" : "不在"));
    }
  }
  
  console.log("\n🔬 参照検出テスト（最初の10件）:");
  let refCount = 0;
  for (const xmlPath of xmlFiles.slice(0, 10)) {
    const lawId = path.basename(xmlPath, ".xml");
    const fromLaw = lawIdMap.get(lawId);
    if (!fromLaw) continue;
    
    const xml = fs.readFileSync(xmlPath, "utf-8");
    if (xml.includes("民法")) { console.log("  " + fromLaw.title + " → 民法"); refCount++; }
  }
  console.log("\n発見した参照: " + refCount + " 件");
}

main().catch(console.error);
