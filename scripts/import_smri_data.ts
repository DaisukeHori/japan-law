/**
 * import_smri_data.ts
 * スマートニュース メディア研究所の国会議案データベースからデータを取得
 */

import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const LEGISLATORS_DIR = path.join(DATA_DIR, "index", "legislators");

// データソースURL
const SOURCES = {
  house_gian: "https://raw.githubusercontent.com/smartnews-smri/house-of-representatives/main/data/gian.json",
  councillors_gian: "https://raw.githubusercontent.com/smartnews-smri/house-of-councillors/main/data/gian.json",
  councillors_giin: "https://raw.githubusercontent.com/smartnews-smri/house-of-councillors/main/data/giin.json",
};

interface Legislator {
  id: string;
  name: string;
  name_kana?: string;
  party: string;
  party_id: string;
  house: string;
  prefecture?: string;
  is_active: boolean;
  github_label: string;
  source: string;
}

interface Bill {
  id: string;
  diet_session: number;
  bill_type: string;
  bill_name: string;
  proposer: string;
  proposer_party?: string;
  proposer_type: string;
  status: string;
  house: string;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function normalizePartyName(party: string): { name: string; id: string } {
  const partyMap: Record<string, { name: string; id: string }> = {
    "自由民主党": { name: "自由民主党", id: "ldp" },
    "自民": { name: "自由民主党", id: "ldp" },
    "立憲民主党": { name: "立憲民主党", id: "cdp" },
    "立憲": { name: "立憲民主党", id: "cdp" },
    "公明党": { name: "公明党", id: "komei" },
    "公明": { name: "公明党", id: "komei" },
    "日本維新の会": { name: "日本維新の会", id: "ishin" },
    "維新": { name: "日本維新の会", id: "ishin" },
    "国民民主党": { name: "国民民主党", id: "dpfp" },
    "民主": { name: "国民民主党", id: "dpfp" },
    "日本共産党": { name: "日本共産党", id: "jcp" },
    "共産": { name: "日本共産党", id: "jcp" },
    "れいわ新選組": { name: "れいわ新選組", id: "reiwa" },
    "れ新": { name: "れいわ新選組", id: "reiwa" },
    "無所属": { name: "無所属", id: "independent" },
  };

  if (partyMap[party]) return partyMap[party];
  for (const [key, value] of Object.entries(partyMap)) {
    if (party && party.includes(key)) return value;
  }
  return { name: party || "不明", id: "other" };
}

function generateId(name: string): string {
  const hash = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return `legislator_${hash}`;
}

// 配列形式 [[header], [row1], [row2]...] をオブジェクト配列に変換
function convertArrayFormat(data: any): any[] {
  if (!Array.isArray(data)) return [];
  if (data.length === 0) return [];
  
  // 既にオブジェクト形式の場合
  if (!Array.isArray(data[0])) return data;
  
  // 配列形式の場合
  const headers = data[0] as string[];
  return data.slice(1).map((row: any[]) => {
    const obj: any = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}

async function fetchCouncillorsLegislators(): Promise<Legislator[]> {
  console.log("📥 参議院議員データを取得中...");
  
  try {
    const response = await axios.get(SOURCES.councillors_giin, { timeout: 30000 });
    const data = convertArrayFormat(response.data);
    
    const legislators: Legislator[] = [];
    
    for (const item of data) {
      const name = item["議員氏名"] || item["氏名"] || item["名前"];
      if (!name) continue;

      const party = item["会派"] || item["政党"] || "";
      const partyInfo = normalizePartyName(party);

      legislators.push({
        id: generateId(name),
        name,
        name_kana: item["読み方"] || item["氏名よみ"] || undefined,
        party: partyInfo.name,
        party_id: partyInfo.id,
        house: "参議院",
        prefecture: item["選挙区"] || undefined,
        is_active: true,
        github_label: `提案者/${name}`,
        source: "smartnews-smri/house-of-councillors",
      });
    }
    
    console.log(`  → ${legislators.length} 名の参議院議員を取得`);
    return legislators;
  } catch (error: any) {
    console.error("  ❌ 参議院議員データの取得に失敗:", error.message);
    return [];
  }
}

async function fetchBills(): Promise<Bill[]> {
  console.log("\n📥 議案データを取得中...");
  const bills: Bill[] = [];
  
  // 衆議院
  try {
    console.log("  衆議院議案...");
    const response = await axios.get(SOURCES.house_gian, { timeout: 60000 });
    const data = convertArrayFormat(response.data);
    
    for (const item of data) {
      const type = item["議案種類"] || item["種類"] || "";
      if (!type.includes("法") && !type.includes("案")) continue;

      // 審議状況から状態を判定
      const statusText = item["審議状況"] || "";
      let status = "審議中";
      if (statusText.includes("成立")) status = "成立";
      else if (statusText.includes("否決") || statusText.includes("未了") || statusText.includes("審議未了")) status = "廃案";
      else if (statusText.includes("撤回")) status = "撤回";
      else if (statusText.includes("継続")) status = "継続審議";

      // 提出者・提出会派情報
      const proposer = item["議案提出者"] || "";
      const proposerParty = item["議案提出会派"] || "";
      const proposerType = type.includes("閣") ? "閣法" : "衆法";

      bills.push({
        id: `house_${item["掲載回次"]}_${bills.length}`,
        diet_session: parseInt(item["掲載回次"]) || 0,
        bill_type: type,
        bill_name: item["議案件名"] || item["件名"] || "",
        proposer,
        proposer_party: proposerParty,
        proposer_type: proposerType,
        status,
        house: "衆議院",
      });
    }
    console.log(`    → ${bills.filter(b => b.house === "衆議院").length} 件`);
  } catch (error: any) {
    console.error("    ❌ 衆議院議案の取得に失敗:", error.message);
  }
  
  // 参議院
  try {
    console.log("  参議院議案...");
    const response = await axios.get(SOURCES.councillors_gian, { timeout: 60000 });
    const data = convertArrayFormat(response.data);
    
    const startCount = bills.length;
    for (const item of data) {
      const type = item["種類"] || "";
      if (!type.includes("法律案")) continue;

      // 議決結果から状態を判定
      const voteResult = item["参議院本会議経過情報 - 議決"] || item["衆議院本会議経過情報 - 議決"] || "";
      const lawNum = item["その他の情報 - 法律番号"] || "";
      let status = "審議中";
      if (lawNum) status = "成立";
      else if (voteResult.includes("可決")) status = "成立";
      else if (voteResult.includes("否決")) status = "廃案";
      else if (voteResult.includes("撤回")) status = "撤回";

      // 提出者情報
      const proposer = item["議案審議情報一覧 - 発議者"] || item["議案審議情報一覧 - 提出者"] || "";
      const proposerType = type.includes("内閣提出") ? "閣法" : "参法";

      bills.push({
        id: `councillors_${item["審議回次"] || item["提出回次"]}_${bills.length}`,
        diet_session: parseInt(item["審議回次"] || item["提出回次"]) || 0,
        bill_type: type,
        bill_name: item["件名"] || "",
        proposer,
        proposer_type: proposerType,
        status,
        house: "参議院",
      });
    }
    console.log(`    → ${bills.length - startCount} 件`);
  } catch (error: any) {
    console.error("    ❌ 参議院議案の取得に失敗:", error.message);
  }
  
  console.log(`  合計: ${bills.length} 件の法律案`);
  return bills;
}

async function main(): Promise<void> {
  console.log("📊 スマートニュースMRI データ連携スクリプト");
  console.log("=".repeat(50));
  
  ensureDir(LEGISLATORS_DIR);
  
  // 議員データ取得
  const legislators = await fetchCouncillorsLegislators();
  
  console.log(`\n👥 議員データ: ${legislators.length} 名`);
  
  // 議員データ保存
  const legislatorsOutput = {
    updated_at: new Date().toISOString(),
    source: "SmartNews Media Research Institute (MIT License)",
    legislators,
  };
  
  const legislatorsPath = path.join(LEGISLATORS_DIR, "legislators.json");
  fs.writeFileSync(legislatorsPath, JSON.stringify(legislatorsOutput, null, 2), "utf-8");
  console.log(`💾 保存: ${legislatorsPath}`);
  
  // 議案データ取得
  const bills = await fetchBills();
  
  // 議案データ保存
  const billsOutput = {
    updated_at: new Date().toISOString(),
    source: "SmartNews Media Research Institute (MIT License)",
    total_count: bills.length,
    bills,
  };
  
  const billsPath = path.join(LEGISLATORS_DIR, "smri_bills.json");
  fs.writeFileSync(billsPath, JSON.stringify(billsOutput, null, 2), "utf-8");
  console.log(`💾 保存: ${billsPath}`);
  
  // 統計
  console.log("\n" + "=".repeat(50));
  console.log("📈 統計:");
  console.log(`  議員数: ${legislators.length} 名`);
  console.log(`  法律案数: ${bills.length} 件`);
  console.log(`    - 成立: ${bills.filter(b => b.status === "成立").length} 件`);
  console.log(`    - 廃案: ${bills.filter(b => b.status === "廃案").length} 件`);
  
  console.log("\n✅ 完了!");
}

main().catch(console.error);
