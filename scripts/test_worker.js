const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const INDEX_DIR = path.join(DATA_DIR, "index");

// 法令インデックス読み込み
const lawIndex = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, "laws.json"), "utf-8")).laws;
console.log("法令インデックス:", lawIndex.length, "件");

// titleToLawマップ作成
const titleToLaw = new Map();
for (const law of lawIndex) {
  titleToLaw.set(law.title, law);
}

// 民法を探す
const minpo = titleToLaw.get("民法");
console.log("民法:", minpo ? `found (${minpo.id})` : "not found");

// 刑法を探す
const keiho = titleToLaw.get("刑法");
console.log("刑法:", keiho ? `found (${keiho.id})` : "not found");

// テストXMLを読み込んで参照検索
const testXml = "/Users/horidaisuke/Downloads/abc/japan-law/data/xml/acts/129AC0000000089.xml";
const xmlContent = fs.readFileSync(testXml, "utf-8");

// 民法が含まれているか
if (xmlContent.includes("民法")) {
  console.log("XMLに民法が含まれています");
  const pos = xmlContent.indexOf("民法");
  console.log("Context:", xmlContent.substring(Math.max(0, pos-20), pos+50));
}

// lawIdMapでlawIdを取得できるか確認
const lawIdMap = new Map();
for (const law of lawIndex) {
  lawIdMap.set(law.id, law);
}

const testLawId = "129AC0000000089";
const fromLaw = lawIdMap.get(testLawId);
console.log("\nfromLaw for", testLawId, ":", fromLaw ? fromLaw.title : "NOT FOUND");
