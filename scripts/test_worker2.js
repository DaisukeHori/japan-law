const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const INDEX_DIR = path.join(DATA_DIR, "index");

// 法令インデックス読み込み
const lawIndex = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, "laws.json"), "utf-8")).laws;

// titleToLawマップ作成
const titleToLaw = new Map();
const lawIdMap = new Map();
for (const law of lawIndex) {
  titleToLaw.set(law.title, law);
  lawIdMap.set(law.id, law);
}

// 131AC0000000011.xml は民法を参照しているはず
const testXml = "/Users/horidaisuke/Downloads/abc/japan-law/data/xml/acts/131AC0000000011.xml";
const xmlContent = fs.readFileSync(testXml, "utf-8");

const testLawId = "131AC0000000011";
const fromLaw = lawIdMap.get(testLawId);
console.log("Source law:", fromLaw ? fromLaw.title : "NOT FOUND");

// 民法を探す
const minpo = titleToLaw.get("民法");
console.log("Target 民法:", minpo ? `id=${minpo.id}` : "not found");

// XMLに民法が含まれているか
if (xmlContent.includes("民法")) {
  console.log("\n✓ XMLに民法が含まれています");
  const pos = xmlContent.indexOf("民法");
  console.log("Context:", xmlContent.substring(Math.max(0, pos-30), pos+80));
}

// knownLawNamesを構築して検索
const knownLawNames = [];
for (const law of lawIndex) {
  knownLawNames.push({ name: law.title, law });
}
knownLawNames.sort((a, b) => b.name.length - a.name.length);

console.log("\n--- Testing reference extraction ---");
const seen = new Set();
let foundRefs = 0;

for (const { name, law } of knownLawNames) {
  if (law.id === fromLaw.id) continue;
  if (seen.has(law.id)) continue;
  if (name.length < 2) continue;

  const pos = xmlContent.indexOf(name);
  if (pos === -1) continue;

  // 部分一致チェック
  const beforeChar = pos > 0 ? xmlContent[pos - 1] : "";
  if (beforeChar && /[一-龠ぁ-んァ-ヶ]/.test(beforeChar)) {
    console.log(`Skip ${name} - partial match (before: ${beforeChar})`);
    continue;
  }

  seen.add(law.id);
  foundRefs++;
  if (foundRefs <= 10) {
    console.log(`Found ref: ${name} (${law.id})`);
  }
}

console.log(`\nTotal references found: ${foundRefs}`);
