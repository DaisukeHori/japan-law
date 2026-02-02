const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const INDEX_DIR = path.join(DATA_DIR, "index");

const lawIndex = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, "laws.json"), "utf-8")).laws;

const titleToLaw = new Map();
const lawIdMap = new Map();
for (const law of lawIndex) {
  titleToLaw.set(law.title, law);
  lawIdMap.set(law.id, law);
}

// 略称マップ
const abbrPath = path.join(INDEX_DIR, "abbreviations.json");
const abbrData = JSON.parse(fs.readFileSync(abbrPath, "utf-8"));
const abbrevMap = new Map();
for (const [key, value] of Object.entries(abbrData.abbreviation_map || {})) {
  if (value.law_id) {
    const law = lawIndex.find(l => l.id === value.law_id);
    if (law) abbrevMap.set(key, law);
  }
}
console.log("略称マップ:", abbrevMap.size, "件");

// knownLawNames構築
const knownLawNames = [];
for (const law of lawIndex) {
  knownLawNames.push({ name: law.title, law });
}
for (const [abbrev, law] of abbrevMap) {
  knownLawNames.push({ name: abbrev, law });
}
knownLawNames.sort((a, b) => b.name.length - a.name.length);
console.log("knownLawNames:", knownLawNames.length, "件");

// 民法のエントリを確認
const minpoEntries = knownLawNames.filter(x => x.name.includes("民法"));
console.log("\n民法関連エントリ:", minpoEntries.length, "件");
minpoEntries.slice(0, 10).forEach(x => console.log("  ", x.name, "->", x.law.id));

// テスト: 別のファイル（会社法を使う法令）で試す
const testFiles = [
  "/Users/horidaisuke/Downloads/abc/japan-law/data/xml/acts/417AC0000000086.xml",  // 会社法
  "/Users/horidaisuke/Downloads/abc/japan-law/data/xml/acts/323AC0000000131.xml",  // 商法
];

for (const testXml of testFiles) {
  if (!fs.existsSync(testXml)) continue;
  
  const xmlContent = fs.readFileSync(testXml, "utf-8");
  const testLawId = path.basename(testXml, ".xml");
  const fromLaw = lawIdMap.get(testLawId);
  
  if (!fromLaw) {
    console.log("\nSkipping", testLawId, "- not in index");
    continue;
  }
  
  console.log("\n=== Testing:", fromLaw.title, "(" + fromLaw.id + ") ===");
  
  const seen = new Set();
  const refs = [];
  
  for (const { name, law } of knownLawNames) {
    if (law.id === fromLaw.id) continue;
    if (seen.has(law.id)) continue;
    if (name.length < 2) continue;
    
    const pos = xmlContent.indexOf(name);
    if (pos === -1) continue;
    
    const beforeChar = pos > 0 ? xmlContent[pos - 1] : "";
    if (beforeChar && /[一-龠ぁ-んァ-ヶ]/.test(beforeChar)) {
      continue;
    }
    
    seen.add(law.id);
    refs.push({ name, lawId: law.id });
  }
  
  console.log("Found", refs.length, "references");
  refs.slice(0, 5).forEach(r => console.log("  ", r.name, "->", r.lawId));
}
