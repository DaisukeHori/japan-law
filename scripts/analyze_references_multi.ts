/**
 * analyze_references_multi.ts
 * 法令間の相互参照を解析（マルチプロセス版）
 */

import * as fs from "fs";
import * as path from "path";
import { fork } from "child_process";
import * as os from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  paragraph: string | null;
  item: string | null;
  ref_type: string;
}

async function main(): Promise<void> {
  console.log("🔗 相互参照解析スクリプト（マルチプロセス版）");
  console.log(`🖥️  使用プロセス数: ${NUM_WORKERS}`);
  console.log("=".repeat(50));

  const startTime = Date.now();

  const laws = loadLawIndex();
  console.log(`📋 法令インデックス: ${laws.length} 件`);

  if (laws.length === 0) {
    console.error("❌ 法令インデックスが空です");
    return;
  }

  const abbreviations = loadAbbreviations(laws);
  console.log(`📚 略称マップ: ${Object.keys(abbreviations).length} 件`);

  const xmlFiles = getXmlFiles(XML_DIR);
  console.log(`📄 XMLファイル: ${xmlFiles.length} 件`);

  const chunkSize = Math.ceil(xmlFiles.length / NUM_WORKERS);
  const chunks: string[][] = [];
  for (let i = 0; i < xmlFiles.length; i += chunkSize) {
    chunks.push(xmlFiles.slice(i, i + chunkSize));
  }

  console.log(`\n🔍 参照を解析中（${NUM_WORKERS}プロセス並列）...\n`);

  // JavaScript版ワーカーを使用
  const workerScript = path.join(__dirname, "analyze_worker.js");

  const promises = chunks.map((chunk, index) => {
    return runWorker(workerScript, {
      xmlFiles: chunk,
      lawIndex: laws,
      abbreviations,
      workerId: index + 1,
      totalWorkers: NUM_WORKERS,
    });
  });

  const results = await Promise.all(promises);
  const allReferences: Reference[] = results.flat();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n⏱️  処理時間: ${elapsed}秒`);

  const uniqueRefs = dedupeReferences(allReferences);
  console.log(`\n📊 抽出結果:`);
  console.log(`   - 総参照数: ${allReferences.length} 件`);
  console.log(`   - 重複除去後: ${uniqueRefs.length} 件`);

  // 参照タイプ別統計
  const typeStats: { [key: string]: number } = {};
  for (const ref of uniqueRefs) {
    typeStats[ref.ref_type] = (typeStats[ref.ref_type] || 0) + 1;
  }
  console.log(`\n📈 参照タイプ別:`);
  for (const [type, count] of Object.entries(typeStats).sort((a, b) => b[1] - a[1])) {
    console.log(`   - ${type}: ${count} 件`);
  }

  ensureDir(INDEX_DIR);

  const referencesOutput = {
    updated_at: new Date().toISOString(),
    total_references: uniqueRefs.length,
    type_stats: typeStats,
    references: uniqueRefs,
  };

  const referencesPath = path.join(INDEX_DIR, "references.json");
  fs.writeFileSync(referencesPath, JSON.stringify(referencesOutput, null, 2), "utf-8");
  console.log(`\n💾 参照グラフを保存: ${referencesPath}`);

  console.log("\n🔄 被参照グラフを生成中...");
  const backlinks = buildBacklinks(uniqueRefs, laws);

  const backlinksPath = path.join(INDEX_DIR, "backlinks.json");
  fs.writeFileSync(backlinksPath, JSON.stringify(backlinks, null, 2), "utf-8");
  console.log(`💾 被参照グラフを保存: ${backlinksPath}`);

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

function runWorker(script: string, data: any): Promise<Reference[]> {
  return new Promise((resolve, reject) => {
    const child = fork(script, [], {
      stdio: ["pipe", "pipe", "inherit", "ipc"],
    });

    let result: Reference[] = [];

    child.on("message", (msg: any) => {
      if (msg.type === "progress") {
        console.log(`  Worker ${msg.workerId}: ${msg.processed}/${msg.total} 件処理済み`);
      } else if (msg.type === "result") {
        result = msg.references;
      }
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve(result);
      } else {
        reject(new Error(`Worker exited with code ${code}`));
      }
    });

    child.on("error", reject);

    child.send(data);
  });
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

function loadAbbreviations(laws: LawIndex[]): { [key: string]: LawIndex } {
  const titleToLaw = new Map<string, LawIndex>();
  for (const law of laws) {
    titleToLaw.set(law.title, law);
  }

  const result: { [abbrev: string]: LawIndex } = {};

  // abbreviations.json から読み込み
  const abbrPath = path.join(INDEX_DIR, "abbreviations.json");
  if (fs.existsSync(abbrPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(abbrPath, "utf-8"));
      const abbrMap = data.abbreviation_map || {};
      
      for (const [abbrev, info] of Object.entries(abbrMap) as [string, any][]) {
        if (info.law_id) {
          const law = laws.find(l => l.id === info.law_id);
          if (law) result[abbrev] = law;
        } else if (info.full_name) {
          const law = titleToLaw.get(info.full_name);
          if (law) result[abbrev] = law;
        }
      }
      console.log(`   - 動的略称: ${Object.keys(result).length} 件`);
    } catch (e) {
      console.log("   - abbreviations.json 読み込み失敗");
    }
  }

  // フォールバック略称（有斐閣法令略語一覧ベース + 慣習的略称）
  const fallback: { [k: string]: string } = {
    // 基本六法・憲法関連
    "憲": "日本国憲法",
    "憲法": "日本国憲法",
    "明憲": "大日本帝国憲法",
    "民": "民法",
    "民法": "民法",
    "民施": "民法施行法",
    "刑": "刑法",
    "刑法": "刑法",
    "刑施": "刑法施行法",
    "商": "商法",
    "商法": "商法",
    "民訴": "民事訴訟法",
    "民訴法": "民事訴訟法",
    "民事訴訟法": "民事訴訟法",
    "刑訴": "刑事訴訟法",
    "刑訴法": "刑事訴訟法",
    "刑事訴訟法": "刑事訴訟法",
    
    // 行政法
    "行訴": "行政事件訴訟法",
    "行訴法": "行政事件訴訟法",
    "行政事件訴訟法": "行政事件訴訟法",
    "行手": "行政手続法",
    "行手法": "行政手続法",
    "行政手続法": "行政手続法",
    "行審": "行政不服審査法",
    "行審法": "行政不服審査法",
    "行政不服審査法": "行政不服審査法",
    "代執": "行政代執行法",
    "行政代執行法": "行政代執行法",
    "国賠": "国家賠償法",
    "国賠法": "国家賠償法",
    "国家賠償法": "国家賠償法",
    "行組": "国家行政組織法",
    "行組法": "国家行政組織法",
    "国公": "国家公務員法",
    "国公法": "国家公務員法",
    "地公": "地方公務員法",
    "地公法": "地方公務員法",
    "自治": "地方自治法",
    "地自法": "地方自治法",
    "地方自治法": "地方自治法",
    "内": "内閣法",
    "内閣法": "内閣法",
    "典": "皇室典範",
    "国会": "国会法",
    "裁": "裁判所法",
    "検察": "検察庁法",
    "警": "警察法",
    "警職": "警察官職務執行法",
    "公選": "公職選挙法",
    "公選法": "公職選挙法",
    "公職選挙法": "公職選挙法",
    "政資": "政治資金規正法",
    
    // 会社法・商事法
    "会社": "会社法",
    "会社法": "会社法",
    "会更": "会社更生法",
    "会更法": "会社更生法",
    "会社更生法": "会社更生法",
    "金商": "金融商品取引法",
    "金商法": "金融商品取引法",
    "金融商品取引法": "金融商品取引法",
    "銀行": "銀行法",
    "銀行法": "銀行法",
    "保険業": "保険業法",
    "保険業法": "保険業法",
    "保険": "保険法",
    "保険法": "保険法",
    "信託": "信託法",
    "信託法": "信託法",
    "信託業": "信託業法",
    "手": "手形法",
    "手形法": "手形法",
    "小": "小切手法",
    "小切手法": "小切手法",
    "社債株式振替": "社債、株式等の振替に関する法律",
    "担信": "担保付社債信託法",
    "商登": "商業登記法",
    "企業担保": "企業担保法",
    "資金決済": "資金決済に関する法律",
    
    // 民事執行・倒産
    "民執": "民事執行法",
    "民執法": "民事執行法",
    "民事執行法": "民事執行法",
    "民保": "民事保全法",
    "民保法": "民事保全法",
    "民事保全法": "民事保全法",
    "破": "破産法",
    "破産法": "破産法",
    "民再": "民事再生法",
    "民再法": "民事再生法",
    "民事再生法": "民事再生法",
    "外国倒産": "外国倒産処理手続の承認援助に関する法律",
    
    // 民事手続
    "民調": "民事調停法",
    "民調法": "民事調停法",
    "仲裁": "仲裁法",
    "仲裁法": "仲裁法",
    "人訴": "人事訴訟法",
    "人訴法": "人事訴訟法",
    "人事訴訟法": "人事訴訟法",
    "家事": "家事事件手続法",
    "家事法": "家事事件手続法",
    "非訟": "非訟事件手続法",
    "非訟法": "非訟事件手続法",
    "人保": "人身保護法",
    "供": "供託法",
    "供託法": "供託法",
    
    // 労働法
    "労基": "労働基準法",
    "労基法": "労働基準法",
    "労働基準法": "労働基準法",
    "労契": "労働契約法",
    "労契法": "労働契約法",
    "労働契約法": "労働契約法",
    "労組": "労働組合法",
    "労組法": "労働組合法",
    "労働組合法": "労働組合法",
    "労調": "労働関係調整法",
    "労派遣": "労働者派遣事業の適正な運営の確保及び派遣労働者の保護等に関する法律",
    "労派法": "労働者派遣事業の適正な運営の確保及び派遣労働者の保護等に関する法律",
    "派遣法": "労働者派遣事業の適正な運営の確保及び派遣労働者の保護等に関する法律",
    "雇均": "雇用の分野における男女の均等な機会及び待遇の確保等に関する法律",
    "均等法": "雇用の分野における男女の均等な機会及び待遇の確保等に関する法律",
    "育介": "育児休業、介護休業等育児又は家族介護を行う労働者の福祉に関する法律",
    "育介法": "育児休業、介護休業等育児又は家族介護を行う労働者の福祉に関する法律",
    "最賃": "最低賃金法",
    "最賃法": "最低賃金法",
    "労安衛": "労働安全衛生法",
    "労安法": "労働安全衛生法",
    "安衛法": "労働安全衛生法",
    "労災": "労働者災害補償保険法",
    "労災法": "労働者災害補償保険法",
    "雇保": "雇用保険法",
    "雇保法": "雇用保険法",
    "雇用保険法": "雇用保険法",
    "職安": "職業安定法",
    "高年": "高年齢者等の雇用の安定等に関する法律",
    "労審": "労働審判法",
    "労審法": "労働審判法",
    "個別労紛": "個別労働関係紛争の解決の促進に関する法律",
    "短時有期": "短時間労働者及び有期雇用労働者の雇用管理の改善等に関する法律",
    "賃確": "賃金の支払の確保等に関する法律",
    "労働承継": "会社分割に伴う労働契約の承継等に関する法律",
    
    // 知的財産
    "特許": "特許法",
    "特許法": "特許法",
    "新案": "実用新案法",
    "実用新案法": "実用新案法",
    "意匠": "意匠法",
    "意匠法": "意匠法",
    "商標": "商標法",
    "商標法": "商標法",
    "著作": "著作権法",
    "著作権法": "著作権法",
    "不正競争": "不正競争防止法",
    "不競法": "不正競争防止法",
    "不正競争防止法": "不正競争防止法",
    
    // 経済法
    "独禁": "私的独占の禁止及び公正取引の確保に関する法律",
    "独禁法": "私的独占の禁止及び公正取引の確保に関する法律",
    "独占禁止法": "私的独占の禁止及び公正取引の確保に関する法律",
    "中小受託": "下請代金支払遅延等防止法",
    "下請法": "下請代金支払遅延等防止法",
    "景表": "不当景品類及び不当表示防止法",
    "景表法": "不当景品類及び不当表示防止法",
    "景品表示法": "不当景品類及び不当表示防止法",
    
    // 消費者法
    "消費契約": "消費者契約法",
    "消契法": "消費者契約法",
    "消費者契約法": "消費者契約法",
    "特定商取引": "特定商取引に関する法律",
    "特商法": "特定商取引に関する法律",
    "特定商取引法": "特定商取引に関する法律",
    "割賦": "割賦販売法",
    "割販法": "割賦販売法",
    "割賦販売法": "割賦販売法",
    "貸金業": "貸金業法",
    "貸金業法": "貸金業法",
    "製造物": "製造物責任法",
    "PL法": "製造物責任法",
    "製造物責任法": "製造物責任法",
    "消費基": "消費者基本法",
    "消費安全": "消費者安全法",
    "消費者被害回復": "消費者の財産的被害等の集団的な回復のための民事の裁判手続の特例に関する法律",
    
    // 不動産・建築
    "借地借家": "借地借家法",
    "借地借家法": "借地借家法",
    "旧借地": "借地法",
    "旧借家": "借家法",
    "宅建業": "宅地建物取引業法",
    "宅建業法": "宅地建物取引業法",
    "宅建法": "宅地建物取引業法",
    "建基": "建築基準法",
    "建基法": "建築基準法",
    "建築基準法": "建築基準法",
    "都計": "都市計画法",
    "都計法": "都市計画法",
    "都市計画法": "都市計画法",
    "建物区分": "建物の区分所有等に関する法律",
    "区分所有法": "建物の区分所有等に関する法律",
    "不登": "不動産登記法",
    "不登法": "不動産登記法",
    "不動産登記法": "不動産登記法",
    "区画整理": "土地区画整理法",
    "収用": "土地収用法",
    "仮登記担保": "仮登記担保契約に関する法律",
    "動産債権譲渡特": "動産及び債権の譲渡の対抗要件に関する民法の特例等に関する法律",
    "住宅品質": "住宅の品質確保の促進等に関する法律",
    "国土利用": "国土利用計画法",
    
    // 税法
    "所税": "所得税法",
    "所得税法": "所得税法",
    "法税": "法人税法",
    "法人税法": "法人税法",
    "消税": "消費税法",
    "消費税法": "消費税法",
    "相税": "相続税法",
    "相続税法": "相続税法",
    "地税": "地方税法",
    "地方税法": "地方税法",
    "税通": "国税通則法",
    "国通法": "国税通則法",
    "国税通則法": "国税通則法",
    "税徴": "国税徴収法",
    "国税徴収法": "国税徴収法",
    "租特": "租税特別措置法",
    "登税": "登録免許税法",
    "印税": "印紙税法",
    "関税": "関税法",
    
    // 入管・国籍
    "入管": "出入国管理及び難民認定法",
    "入管法": "出入国管理及び難民認定法",
    "入管難民法": "出入国管理及び難民認定法",
    "国籍": "国籍法",
    "国籍法": "国籍法",
    "旅券": "旅券法",
    
    // 交通
    "道交": "道路交通法",
    "道交法": "道路交通法",
    "道路交通法": "道路交通法",
    "道": "道路法",
    "道路法": "道路法",
    "道運": "道路運送法",
    "自賠": "自動車損害賠償保障法",
    "自賠法": "自動車損害賠償保障法",
    "車両": "道路運送車両法",
    "航空": "航空法",
    "船員": "船員法",
    "船舶": "船舶法",
    "河": "河川法",
    "港湾": "港湾法",
    
    // 刑事関連
    "少": "少年法",
    "少年法": "少年法",
    "少院": "少年院法",
    "更生": "更生保護法",
    "更生保護法": "更生保護法",
    "刑事収容": "刑事収容施設及び被収容者等の処遇に関する法律",
    "裁判員": "裁判員の参加する刑事裁判に関する法律",
    "通信傍受": "犯罪捜査のための通信傍受に関する法律",
    "組織犯罪": "組織的な犯罪の処罰及び犯罪収益の規制等に関する法律",
    "犯罪収益移転": "犯罪による収益の移転防止に関する法律",
    "犯罪被害保護": "犯罪被害者等の権利利益の保護を図るための刑事手続に付随する措置に関する法律",
    "犯罪被害基": "犯罪被害者等基本法",
    "犯罪被害給付": "犯罪被害者等給付金の支給等による犯罪被害者等の支援に関する法律",
    "心神喪失処遇": "心神喪失等の状態で重大な他害行為を行った者の医療及び観察等に関する法律",
    "検審": "検察審査会法",
    "恩赦": "恩赦法",
    "刑補": "刑事補償法",
    "軽犯": "軽犯罪法",
    "暴力": "暴力行為等処罰ニ関スル法律",
    "暴力団": "暴力団員による不当な行為の防止等に関する法律",
    "盗犯": "盗犯等ノ防止及処分ニ関スル法律",
    "爆発": "爆発物取締罰則",
    "決闘": "決闘罪ニ関スル件",
    "売春": "売春防止法",
    "風俗": "風俗営業等の規制及び業務の適正化等に関する法律",
    "銃刀所持": "銃砲刀剣類所持等取締法",
    "覚醒剤": "覚醒剤取締法",
    "麻薬": "麻薬及び向精神薬取締法",
    "麻薬特": "国際的な協力の下に規制薬物に係る不正行為を助長する行為等の防止を図るための麻薬及び向精神薬取締法等の特例等に関する法律",
    "自動車運転致死傷": "自動車の運転により人を死傷させる行為等の処罰に関する法律",
    "航空強取": "航空機の強取等の処罰に関する法律",
    "人質": "人質による強要行為等の処罰に関する法律",
    "ストーカー": "ストーカー行為等の規制等に関する法律",
    "配偶者暴力": "配偶者からの暴力の防止及び被害者の保護等に関する法律",
    "児童買春": "児童買春、児童ポルノに係る行為等の規制及び処罰並びに児童の保護等に関する法律",
    "児童虐待": "児童虐待の防止等に関する法律",
    "不正アクセス": "不正アクセス行為の禁止等に関する法律",
    "出資取締": "出資の受入れ、預り金及び金利等の取締りに関する法律",
    "公害犯罪": "人の健康に係る公害犯罪の処罰に関する法律",
    "偽造カード": "偽造カード等及び盗難カード等を用いて行われる不正な機械式預貯金払戻し等からの預貯金者の保護等に関する法律",
    "性的姿態撮影": "性的な姿態を撮影する行為等の処罰及び押収物に記録された性的な姿態の影像に係る電磁的記録の消去等に関する法律",
    
    // 社会保障
    "健保": "健康保険法",
    "健保法": "健康保険法",
    "健康保険法": "健康保険法",
    "国健保": "国民健康保険法",
    "国保法": "国民健康保険法",
    "国民健康保険法": "国民健康保険法",
    "介保": "介護保険法",
    "介保法": "介護保険法",
    "介護保険法": "介護保険法",
    "国年": "国民年金法",
    "国年法": "国民年金法",
    "国民年金法": "国民年金法",
    "厚年": "厚生年金保険法",
    "厚年法": "厚生年金保険法",
    "厚生年金保険法": "厚生年金保険法",
    "生活保護": "生活保護法",
    "生保法": "生活保護法",
    "生活保護法": "生活保護法",
    "高齢医療": "高齢者の医療の確保に関する法律",
    "児福": "児童福祉法",
    "児童福祉法": "児童福祉法",
    "児手": "児童手当法",
    "児扶手": "児童扶養手当法",
    "社福": "社会福祉法",
    "老福": "老人福祉法",
    "母福": "母子及び父子並びに寡婦福祉法",
    "障害基": "障害者基本法",
    "障害総合支援": "障害者の日常生活及び社会生活を総合的に支援するための法律",
    "障害雇用": "障害者の雇用の促進等に関する法律",
    "障害差別解消": "障害を理由とする差別の解消の推進に関する法律",
    "障害福祉": "身体障害者福祉法",
    "発達障害": "発達障害者支援法",
    "精神": "精神保健及び精神障害者福祉に関する法律",
    "母体保護": "母体保護法",
    "母子保健": "母子保健法",
    "国公災": "国家公務員災害補償法",
    "地公災": "地方公務員災害補償法",
    
    // 医療
    "医師": "医師法",
    "医療": "医療法",
    "医療法": "医療法",
    "医薬": "医薬品、医療機器等の品質、有効性及び安全性の確保等に関する法律",
    "薬機法": "医薬品、医療機器等の品質、有効性及び安全性の確保等に関する法律",
    "薬剤師": "薬剤師法",
    "臓器移植": "臓器の移植に関する法律",
    "感染症": "感染症の予防及び感染症の患者に対する医療に関する法律",
    "健康増進": "健康増進法",
    "食品衛生": "食品衛生法",
    "食品表示": "食品表示法",
    
    // 教育
    "学教": "学校教育法",
    "学校教育法": "学校教育法",
    "教基": "教育基本法",
    "教育基本法": "教育基本法",
    "教育行政": "地方教育行政の組織及び運営に関する法律",
    "私学": "私立学校法",
    "図": "図書館法",
    
    // 個人情報・IT
    "個人情報": "個人情報の保護に関する法律",
    "個人情報保護法": "個人情報の保護に関する法律",
    "個情法": "個人情報の保護に関する法律",
    "番号": "行政手続における特定の個人を識別するための番号の利用等に関する法律",
    "マイナンバー法": "行政手続における特定の個人を識別するための番号の利用等に関する法律",
    "番号法": "行政手続における特定の個人を識別するための番号の利用等に関する法律",
    "電子署名認証": "電子署名及び認証業務に関する法律",
    "電子債権": "電子記録債権法",
    "電子契約特": "電子消費者契約に関する民法の特例に関する法律",
    "行政情報公開": "行政機関の保有する情報の公開に関する法律",
    "公文書管理": "公文書等の管理に関する法律",
    "情プラ": "特定電気通信による情報の流通によって発生する権利侵害等への対処に関する法律",
    
    // 環境
    "環境基": "環境基本法",
    "環境基本法": "環境基本法",
    "環境影響評価": "環境影響評価法",
    "大気汚染": "大気汚染防止法",
    "水質汚濁": "水質汚濁防止法",
    "土壌汚染": "土壌汚染対策法",
    "廃棄物": "廃棄物の処理及び清掃に関する法律",
    "廃掃法": "廃棄物の処理及び清掃に関する法律",
    "騒音規制": "騒音規制法",
    "振動規制": "振動規制法",
    "悪臭": "悪臭防止法",
    "自然環境": "自然環境保全法",
    "自園": "自然公園法",
    "地球温暖化": "地球温暖化対策の推進に関する法律",
    "動物愛護": "動物の愛護及び管理に関する法律",
    
    // 防衛・安全保障
    "自衛": "自衛隊法",
    "武力攻撃事態": "武力攻撃事態等及び存立危機事態における我が国の平和と独立並びに国及び国民の安全の確保に関する法律",
    "国民保護": "武力攻撃事態等における国民の保護のための措置に関する法律",
    "防衛": "防衛省設置法",
    "安保会議": "国家安全保障会議設置法",
    "特定秘密保護": "特定秘密の保護に関する法律",
    "経済安保": "経済施策を一体的に講ずることによる安全保障の確保の推進に関する法律",
    
    // 災害
    "災害基": "災害対策基本法",
    "災救": "災害救助法",
    "被災者支援": "被災者生活再建支援法",
    "大震法": "大規模地震対策特別措置法",
    "地震特措": "大規模地震対策特別措置法",
    
    // 法人
    "一般法人": "一般社団法人及び一般財団法人に関する法律",
    "公益法人": "公益社団法人及び公益財団法人の認定等に関する法律",
    "独行法": "独立行政法人通則法",
    "非営利活動": "特定非営利活動促進法",
    "NPO法": "特定非営利活動促進法",
    "宗法": "宗教法人法",
    "中協": "中小企業等協同組合法",
    
    // 金融
    "外為法": "外国為替及び外国貿易法",
    "預金保険": "預金保険法",
    "金融サービス": "金融サービスの提供及び利用環境の整備等に関する法律",
    
    // その他重要法律
    "戸": "戸籍法",
    "戸籍法": "戸籍法",
    "住民台帳": "住民基本台帳法",
    "住基法": "住民基本台帳法",
    "利息": "利息制限法",
    "利息制限法": "利息制限法",
    "失火": "失火ノ責任ニ関スル法律",
    "身元保証": "身元保証ニ関スル法律",
    "任意後見": "任意後見契約に関する法律",
    "後見登記": "後見登記等に関する法律",
    "外国裁判権": "外国等に対する我が国の民事裁判権に関する法律",
    "国際海運": "国際海上物品運送法",
    "船主責任制限": "船舶の所有者等の責任の制限に関する法律",
    "法適用": "法の適用に関する通則法",
    "遺言準拠法": "遺言の方式の準拠法に関する法律",
    "扶養準拠法": "扶養義務の準拠法に関する法律",
    "子奪取": "国際的な子の奪取の民事上の側面に関する条約の実施に関する法律",
    "遺言保管": "法務局における遺言書の保管等に関する法律",
    "会計": "会計法",
    "財": "財政法",
    "請願": "請願法",
    "公益通報": "公益通報者保護法",
    "弁護": "弁護士法",
    "弁護士法": "弁護士法",
    "司書": "司法書士法",
    "行書": "行政書士法",
    "公証": "公証人法",
    "税理士": "税理士法",
    "会計士": "公認会計士法",
    "弁理士": "弁理士法",
    "土調士": "土地家屋調査士法",
    "社労士": "社会保険労務士法",
    "執行官": "執行官法",
    "裁判外紛争解決": "裁判外紛争解決手続の利用の促進に関する法律",
    "ADR法": "裁判外紛争解決手続の利用の促進に関する法律",
    "法律支援": "総合法律支援法",
    "外事弁護": "外国弁護士による法律事務の取扱い等に関する法律",
    "フリーランス": "特定受託事業者に係る取引の適正化等に関する法律",
  };

  for (const [abbrev, fullTitle] of Object.entries(fallback)) {
    if (!result[abbrev]) {
      const law = titleToLaw.get(fullTitle);
      if (law) result[abbrev] = law;
    }
  }
  
  console.log(`   - フォールバック略称適用後: ${Object.keys(result).length} 件`);

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
  const backlinks: any = { backlinks: {}, updated_at: new Date().toISOString() };

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
    if (!countMap.has(ref.to_law_id)) countMap.set(ref.to_law_id, new Map());
    const fromMap = countMap.get(ref.to_law_id)!;
    fromMap.set(ref.from_law_id, (fromMap.get(ref.from_law_id) || 0) + 1);
  }

  for (const [toLawId, fromMap] of countMap) {
    if (!backlinks.backlinks[toLawId]) continue;
    for (const [fromLawId, count] of fromMap) {
      const fromLaw = laws.find(l => l.id === fromLawId);
      if (fromLaw) {
        backlinks.backlinks[toLawId].referenced_by.push({
          law_id: fromLawId, law_title: fromLaw.title, count,
        });
      }
    }
    backlinks.backlinks[toLawId].referenced_by.sort((a: any, b: any) => b.count - a.count);
  }

  return backlinks;
}

main().catch(console.error);
