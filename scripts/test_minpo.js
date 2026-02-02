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

const testXml = "/Users/horidaisuke/Downloads/abc/japan-law/data/xml/acts/131AC0000000011.xml";
const xmlContent = fs.readFileSync(testXml, "utf-8");

const testLawId = "131AC0000000011";
const fromLaw = lawIdMap.get(testLawId);
console.log("Source law:", fromLaw.title, "(" + fromLaw.id + ")");

// 民法を直接検索
const minpo = titleToLaw.get("民法");
console.log("\n民法 info:", minpo);

const name = "民法";
const law = minpo;

console.log("\nChecking: " + name + " (" + law.id + ")");
console.log("  fromLaw.id === law.id:", fromLaw.id === law.id);

// indexOf で検索
const pos = xmlContent.indexOf(name);
console.log("  indexOf(民法):", pos);

if (pos !== -1) {
  const beforeChar = pos > 0 ? xmlContent[pos - 1] : "";
  console.log("  beforeChar:", beforeChar, "(charCode:", beforeChar.charCodeAt(0) + ")");
  console.log("  Regex test:", /[一-龠ぁ-んァ-ヶ]/.test(beforeChar));
  console.log("  Context:", xmlContent.substring(Math.max(0, pos-10), pos+10));
}

// 複数の出現位置をチェック
console.log("\n--- All occurrences of 民法 ---");
let idx = 0;
let count = 0;
while ((idx = xmlContent.indexOf("民法", idx)) !== -1) {
  const before = idx > 0 ? xmlContent[idx - 1] : "";
  const after = xmlContent[idx + 2] || "";
  console.log("  pos " + idx + ": before=" + before + " context=" + xmlContent.substring(Math.max(0, idx-5), idx+10));
  idx++;
  count++;
  if (count > 20) {
    console.log("  ... and more");
    break;
  }
}
