import * as fs from "fs";
import * as path from "path";
import { fork } from "child_process";

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

async function main() {
  console.log("🔍 マルチプロセスデバッグ v2");
  console.log("=".repeat(50));

  const laws = loadLawIndex();
  console.log("📋 法令数:", laws.length);

  const xmlFiles = getXmlFiles(XML_DIR);
  console.log("📄 XMLファイル数:", xmlFiles.length);

  const testFiles = xmlFiles.slice(0, 50);
  console.log("🧪 テスト件数:", testFiles.length);

  const workerCode = `
const fs = require("fs");
const path = require("path");

process.on("message", (data) => {
  console.error("Worker: メッセージ受信, ファイル数=" + data.xmlFiles.length + ", 法令数=" + data.lawIndex.length);
  
  // 法令IDマップ (id -> law)
  const lawIdMap = new Map();
  // 法令タイトルマップ (title -> law)
  const titleToLaw = new Map();
  
  for (const law of data.lawIndex) {
    lawIdMap.set(law.id, law);
    titleToLaw.set(law.title, law);
  }
  
  console.error("Worker: lawIdMap.size=" + lawIdMap.size + ", titleToLaw.size=" + titleToLaw.size);
  
  const refs = [];
  let processed = 0;
  
  for (const xmlPath of data.xmlFiles) {
    const lawId = path.basename(xmlPath, ".xml");
    const fromLaw = lawIdMap.get(lawId);
    
    if (!fromLaw) {
      continue;
    }
    
    try {
      const xml = fs.readFileSync(xmlPath, "utf-8");
      
      // タイトルマップを使って検索
      for (const [title, law] of titleToLaw) {
        if (law.id === fromLaw.id) continue;
        if (title.length < 3) continue;
        if (xml.includes(title)) {
          refs.push({
            from: fromLaw.title,
            to: title,
          });
        }
      }
    } catch (e) {
      console.error("Worker: Error reading " + xmlPath);
    }
    
    processed++;
  }
  
  console.error("Worker: 処理完了, processed=" + processed + ", refs=" + refs.length);
  process.send({ type: "result", refs: refs });
});
`;

  const workerPath = path.join(__dirname, "_debug_worker2.js");
  fs.writeFileSync(workerPath, workerCode);

  console.log("\n🚀 ワーカー起動...");

  const result = await new Promise((resolve, reject) => {
    const child = fork(workerPath, [], {
      stdio: ["pipe", "pipe", "inherit", "ipc"],
    });

    child.on("message", (msg: any) => {
      console.log("親: メッセージ受信, type=" + msg.type);
      if (msg.type === "result") {
        console.log("親: refs=" + msg.refs.length);
        resolve(msg.refs);
      }
    });

    child.on("error", (err) => {
      console.error("親: エラー", err);
      reject(err);
    });

    child.on("exit", (code) => {
      console.log("親: ワーカー終了, code=" + code);
    });

    console.log("親: データ送信開始");
    child.send({
      xmlFiles: testFiles,
      lawIndex: laws,
    });
    console.log("親: データ送信完了");
  });

  const refs = result as any[];
  console.log("\n📊 結果:", refs.length, "件の参照");
  
  if (refs.length > 0) {
    console.log("最初の5件:");
    for (const r of refs.slice(0, 5)) {
      console.log("  " + r.from + " → " + r.to);
    }
  }
  
  fs.unlinkSync(workerPath);
  console.log("✅ 完了");
}

main().catch(console.error);
