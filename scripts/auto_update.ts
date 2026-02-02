/**
 * auto_update.ts
 * 法令・議員・政党データの自動更新スクリプト
 * GitHub Actions から定期実行される
 */

import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const INDEX_DIR = path.join(DATA_DIR, "index");
const LEGISLATORS_DIR = path.join(INDEX_DIR, "legislators");

// データソース
const SOURCES = {
  // SMRI - 参議院
  councillors_giin: "https://raw.githubusercontent.com/smartnews-smri/house-of-councillors/main/data/giin.json",
  councillors_gian: "https://raw.githubusercontent.com/smartnews-smri/house-of-councillors/main/data/gian.json",
  councillors_kaiha: "https://raw.githubusercontent.com/smartnews-smri/house-of-councillors/main/data/kaiha.json",

  // SMRI - 衆議院
  house_gian: "https://raw.githubusercontent.com/smartnews-smri/house-of-representatives/main/data/gian.json",

  // 国会会議録API - 最新の議員データ
  kokkai_speech: "https://kokkai.ndl.go.jp/api/speech",
  kokkai_meeting: "https://kokkai.ndl.go.jp/api/meeting",

  // Wikidata SPARQL - 最新の衆議院議員
  wikidata_sparql: "https://query.wikidata.org/sparql",

  // EveryPolitician - 衆議院議員（2017年まで、フォールバック用）
  everypolitician: "https://cdn.jsdelivr.net/gh/everypolitician/everypolitician-data@e3ed459db9aea07b357baa6b8edf355bf348a916/data/Japan/House_of_Representatives/ep-popolo-v1.0.json",
};

interface Legislator {
  id: string;
  name: string;
  name_kana?: string;
  name_en?: string;
  party: string;
  party_id: string;
  house: string;
  prefecture?: string;
  district?: string;
  is_active: boolean;
  birth_date?: string;
  gender?: string;
  source: string;
  updated_at: string;
}

interface Party {
  id: string;
  name: string;
  short_name: string;
  color: string;
  member_count: number;
  official_url?: string;
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
  url?: string;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 配列形式をオブジェクト形式に変換
function convertArrayFormat(data: any): any[] {
  if (!Array.isArray(data)) return [];
  if (data.length === 0) return [];
  if (!Array.isArray(data[0])) return data;

  const headers = data[0] as string[];
  return data.slice(1).map((row: any[]) => {
    const obj: any = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    return obj;
  });
}

// 政党名を正規化
function normalizePartyName(party: string): { name: string; id: string } {
  const partyMap: Record<string, { name: string; id: string }> = {
    "自由民主党": { name: "自由民主党", id: "ldp" },
    "自民党": { name: "自由民主党", id: "ldp" },
    "自民": { name: "自由民主党", id: "ldp" },
    "立憲民主党": { name: "立憲民主党", id: "cdp" },
    "立憲": { name: "立憲民主党", id: "cdp" },
    "公明党": { name: "公明党", id: "komei" },
    "公明": { name: "公明党", id: "komei" },
    "日本維新の会": { name: "日本維新の会", id: "ishin" },
    "維新": { name: "日本維新の会", id: "ishin" },
    "国民民主党": { name: "国民民主党", id: "dpfp" },
    "国民": { name: "国民民主党", id: "dpfp" },
    "日本共産党": { name: "日本共産党", id: "jcp" },
    "共産党": { name: "日本共産党", id: "jcp" },
    "共産": { name: "日本共産党", id: "jcp" },
    "れいわ新選組": { name: "れいわ新選組", id: "reiwa" },
    "れいわ": { name: "れいわ新選組", id: "reiwa" },
    "社会民主党": { name: "社会民主党", id: "sdp" },
    "社民党": { name: "社会民主党", id: "sdp" },
    "社民": { name: "社会民主党", id: "sdp" },
    "NHK党": { name: "NHK党", id: "nhk" },
    "参政党": { name: "参政党", id: "sansei" },
    "無所属": { name: "無所属", id: "independent" },
  };

  if (partyMap[party]) return partyMap[party];
  for (const [key, value] of Object.entries(partyMap)) {
    if (party && party.includes(key)) return value;
  }
  return { name: party || "その他", id: "other" };
}

function generateId(name: string, house: string): string {
  const hash = (name + house).split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return `leg_${hash}`;
}

// 参議院議員データ取得
async function fetchCouncillors(): Promise<Legislator[]> {
  console.log("📥 参議院議員データを取得中...");
  const legislators: Legislator[] = [];

  try {
    const response = await axios.get(SOURCES.councillors_giin, { timeout: 30000 });
    const data = convertArrayFormat(response.data);

    for (const item of data) {
      const name = item["議員氏名"] || item["氏名"] || item["名前"];
      if (!name) continue;

      const party = item["会派"] || item["政党"] || "";
      const partyInfo = normalizePartyName(party);

      legislators.push({
        id: generateId(name, "参議院"),
        name,
        name_kana: item["読み方"] || item["氏名よみ"] || undefined,
        party: partyInfo.name,
        party_id: partyInfo.id,
        house: "参議院",
        prefecture: item["選挙区"] || undefined,
        is_active: true,
        source: "smartnews-smri/house-of-councillors",
        updated_at: new Date().toISOString(),
      });
    }

    console.log(`  → ${legislators.length} 名の参議院議員を取得`);
  } catch (error: any) {
    console.error("  ❌ 参議院議員データの取得に失敗:", error.message);
  }

  return legislators;
}

// 国会会議録APIから現職議員を取得
async function fetchLegislatorsFromKokkaiAPI(): Promise<Legislator[]> {
  console.log("📥 国会会議録APIから議員データを取得中...");
  const seenNames = new Map<string, Legislator>();

  // 最新の国会回次（現在は215回国会が最新 - 2024年秋）
  const currentSession = 215;
  const sessionsToFetch = [213, 212, 211, 210]; // 確実にデータがある回次

  for (const session of sessionsToFetch) {
    console.log(`  第${session}回国会を取得中...`);

    try {
      // 衆議院の発言者を取得（ページネーション付き）
      let startRecord = 1;
      let fetchedInSession = 0;

      while (fetchedInSession < 10000) {
        const url = `${SOURCES.kokkai_speech}?nameOfHouse=${encodeURIComponent("衆議院")}&sessionFrom=${session}&sessionTo=${session}&recordPacking=json&maximumRecords=100&startRecord=${startRecord}`;

        const response = await axios.get(url, { timeout: 60000 });

        const records = response.data?.speechRecord || [];
        const totalRecords = response.data?.numberOfRecords || 0;

        if (records.length === 0) break;

        for (const record of records) {
          const name = record.speaker;
          if (!name || seenNames.has(name) || name === "会議録情報") continue;

          // 議員かどうかを判定
          const group = record.speakerGroup || "";

          // 会派・政党に所属している人のみ
          const isLegislator =
            group.includes("党") ||
            group.includes("会派") ||
            group.includes("自由民主") ||
            group.includes("立憲民主") ||
            group.includes("公明") ||
            group.includes("維新") ||
            group.includes("国民民主") ||
            group.includes("共産") ||
            group.includes("れいわ") ||
            group.includes("社民") ||
            group.includes("無所属");

          if (!isLegislator || !group) continue;

          const partyInfo = normalizePartyName(group);

          seenNames.set(name, {
            id: generateId(name, "衆議院"),
            name,
            name_kana: record.speakerYomi || undefined,
            party: partyInfo.name,
            party_id: partyInfo.id,
            house: "衆議院",
            is_active: true,
            source: `kokkai-api:session-${session}`,
            updated_at: new Date().toISOString(),
          });
        }

        fetchedInSession += records.length;
        startRecord += records.length;

        // 全件取得したら終了
        if (startRecord > totalRecords) break;

        // API制限を避けるため待機
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      console.log(`    → 第${session}回: ${seenNames.size} 名（累計）`);

      // セッション間で待機
      await new Promise((resolve) => setTimeout(resolve, 500));

    } catch (error: any) {
      console.error(`    ⚠️ 第${session}回国会の取得に失敗:`, error.message);
    }
  }

  const legislators = Array.from(seenNames.values());
  console.log(`  → ${legislators.length} 名の衆議院議員を取得（国会会議録API）`);
  return legislators;
}

// 衆議院議員データ取得（国会会議録API → Wikidata → EveryPolitician の順で試す）
async function fetchRepresentatives(): Promise<Legislator[]> {
  console.log("📥 衆議院議員データを取得中...");

  // 1. まず国会会議録APIを試す（最も最新）
  const kokkaiLegislators = await fetchLegislatorsFromKokkaiAPI();
  if (kokkaiLegislators.length >= 200) {
    console.log(`  ✅ 国会会議録APIから ${kokkaiLegislators.length} 名取得`);
    return kokkaiLegislators;
  }

  // 2. 国会会議録APIが不十分ならWikidataを試す
  console.log(`  ⚠️ 国会会議録APIデータが不十分（${kokkaiLegislators.length}名）、Wikidataを試行`);
  const wikidataLegislators = await tryFetchFromWikidata();
  if (wikidataLegislators.length >= 200) {
    console.log(`  ✅ Wikidataから ${wikidataLegislators.length} 名取得`);
    return wikidataLegislators;
  }

  // 3. 両方不十分ならマージして使用、それでも足りなければEveryPoliticianにフォールバック
  const merged = mergeUniqueByName([...kokkaiLegislators, ...wikidataLegislators]);
  if (merged.length >= 200) {
    console.log(`  ✅ 国会会議録API + Wikidata のマージで ${merged.length} 名取得`);
    return merged;
  }

  // 4. 最終フォールバック: EveryPolitician
  console.log(`  ⚠️ データが不十分（${merged.length}名）、EveryPoliticianを使用`);
  return fetchRepresentativesFromEveryPolitician();
}

// 名前でユニーク化（重複排除）
function mergeUniqueByName(legislators: Legislator[]): Legislator[] {
  const seen = new Map<string, Legislator>();
  for (const leg of legislators) {
    // アクティブなものを優先
    const existing = seen.get(leg.name);
    if (!existing || (leg.is_active && !existing.is_active)) {
      seen.set(leg.name, leg);
    }
  }
  return Array.from(seen.values());
}

// Wikidataからの取得を試みる
async function tryFetchFromWikidata(): Promise<Legislator[]> {
  const legislators: Legislator[] = [];

  // 現在の衆議院議員を取得するSPARQLクエリ
  // 就任日が2024年10月以降かつ終了日が設定されていない議員
  const sparqlQuery = `
    SELECT DISTINCT ?mp ?mpLabel ?partyLabel ?districtLabel ?genderLabel ?birthDate ?startDate WHERE {
      ?mp p:P39 ?statement .
      ?statement ps:P39 wd:Q17506823 .  # position held = 衆議院議員

      # 就任日を取得
      ?statement pq:P580 ?startDate .

      # 2024年10月以降に就任
      FILTER(?startDate >= "2024-10-01"^^xsd:dateTime)

      # 終了日が設定されていない
      FILTER NOT EXISTS { ?statement pq:P582 ?endDate . }

      # 所属政党
      OPTIONAL { ?mp wdt:P102 ?party . }

      # 選挙区
      OPTIONAL { ?mp wdt:P768 ?district . }

      # 性別
      OPTIONAL { ?mp wdt:P21 ?gender . }

      # 生年月日
      OPTIONAL { ?mp wdt:P569 ?birthDate . }

      SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
    }
    ORDER BY ?mpLabel
  `;

  try {
    const response = await axios.get(SOURCES.wikidata_sparql, {
      params: {
        query: sparqlQuery,
        format: "json",
      },
      headers: {
        "Accept": "application/sparql-results+json",
        "User-Agent": "JapanLawDatabase/1.0 (https://github.com/DaisukeHori/japan-law)",
      },
      timeout: 60000,
    });

    const results = response.data.results?.bindings || [];
    const seenIds = new Set<string>();

    for (const result of results) {
      const name = result.mpLabel?.value;
      if (!name || seenIds.has(name)) continue;
      seenIds.add(name);

      const partyName = result.partyLabel?.value || "無所属";
      const partyInfo = normalizePartyName(partyName);
      const gender = result.genderLabel?.value;
      const birthDate = result.birthDate?.value?.split("T")[0];
      const district = result.districtLabel?.value;
      const wikidataId = result.mp?.value?.split("/").pop();

      legislators.push({
        id: generateId(name, "衆議院"),
        name,
        party: partyInfo.name,
        party_id: partyInfo.id,
        house: "衆議院",
        district,
        is_active: true,
        birth_date: birthDate,
        gender: gender === "男性" ? "male" : gender === "女性" ? "female" : undefined,
        source: `wikidata:${wikidataId}`,
        updated_at: new Date().toISOString(),
      });
    }

    return legislators;

  } catch (error: any) {
    console.error("  ⚠️ Wikidata取得エラー:", error.message);
    return [];
  }
}

// 衆議院議員データ取得（EveryPoliticianフォールバック用）
async function fetchRepresentativesFromEveryPolitician(): Promise<Legislator[]> {
  console.log("📥 衆議院議員データを取得中（EveryPolitician フォールバック）...");
  const legislators: Legislator[] = [];

  try {
    const response = await axios.get(SOURCES.everypolitician, { timeout: 60000 });
    const data = response.data;

    const persons = data.persons || [];
    const memberships = data.memberships || [];
    const organizations = data.organizations || [];

    const orgMap = new Map();
    for (const org of organizations) {
      orgMap.set(org.id, org);
    }

    const latestMembership = new Map();
    for (const m of memberships) {
      if (m.role === "member" && m.organization_id) {
        const existing = latestMembership.get(m.person_id);
        if (!existing || (m.start_date && (!existing.start_date || m.start_date > existing.start_date))) {
          latestMembership.set(m.person_id, m);
        }
      }
    }

    for (const person of persons) {
      const membership = latestMembership.get(person.id);
      const org = membership ? orgMap.get(membership.organization_id) : null;
      const partyName = org?.name || "無所属";
      const partyInfo = normalizePartyName(partyName);

      legislators.push({
        id: generateId(person.name, "衆議院"),
        name: person.name,
        name_en: person.other_names?.find((n: any) => n.lang === "en")?.name,
        party: partyInfo.name,
        party_id: partyInfo.id,
        house: "衆議院",
        district: membership?.area_id,
        is_active: false, // EveryPoliticianは2017年までのデータ
        birth_date: person.birth_date,
        gender: person.gender,
        source: "everypolitician (2017)",
        updated_at: new Date().toISOString(),
      });
    }

    console.log(`  → ${legislators.length} 名の衆議院議員を取得（参考データ・2017年時点）`);
  } catch (error: any) {
    console.error("  ❌ 衆議院議員データの取得に失敗:", error.message);
  }

  return legislators;
}

// 法案データ取得
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

      const statusText = item["審議状況"] || "";
      let status = "審議中";
      if (statusText.includes("成立")) status = "成立";
      else if (statusText.includes("否決") || statusText.includes("未了")) status = "廃案";
      else if (statusText.includes("撤回")) status = "撤回";
      else if (statusText.includes("継続")) status = "継続審議";

      bills.push({
        id: `house_${item["掲載回次"]}_${bills.length}`,
        diet_session: parseInt(item["掲載回次"]) || 0,
        bill_type: type,
        bill_name: item["議案件名"] || item["件名"] || "",
        proposer: item["議案提出者"] || "",
        proposer_party: item["議案提出会派"] || "",
        proposer_type: type.includes("閣") ? "閣法" : "衆法",
        status,
        house: "衆議院",
        url: item["経過情報URL"] || undefined,
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

      const voteResult = item["参議院本会議経過情報 - 議決"] || item["衆議院本会議経過情報 - 議決"] || "";
      const lawNum = item["その他の情報 - 法律番号"] || "";
      let status = "審議中";
      if (lawNum) status = "成立";
      else if (voteResult.includes("可決")) status = "成立";
      else if (voteResult.includes("否決")) status = "廃案";
      else if (voteResult.includes("撤回")) status = "撤回";

      bills.push({
        id: `councillors_${item["審議回次"] || item["提出回次"]}_${bills.length}`,
        diet_session: parseInt(item["審議回次"] || item["提出回次"]) || 0,
        bill_type: type,
        bill_name: item["件名"] || "",
        proposer: item["議案審議情報一覧 - 発議者"] || item["議案審議情報一覧 - 提出者"] || "",
        proposer_type: type.includes("内閣提出") ? "閣法" : "参法",
        status,
        house: "参議院",
        url: item["議案URL"] || undefined,
      });
    }
    console.log(`    → ${bills.length - startCount} 件`);
  } catch (error: any) {
    console.error("    ❌ 参議院議案の取得に失敗:", error.message);
  }

  console.log(`  合計: ${bills.length} 件の法律案`);
  return bills;
}

// 議員別法案追跡データを生成
interface LegislatorBillsIndex {
  updated_at: string;
  total_proposers: number;
  by_legislator: Record<string, {
    name: string;
    party?: string;
    total_bills: number;
    passed_bills: number;
    success_rate: number;
    bills: Array<{
      id: string;
      name: string;
      session: number;
      status: string;
      house: string;
    }>;
  }>;
}

function generateLegislatorBillsIndex(bills: Bill[], legislators: Legislator[]): LegislatorBillsIndex {
  const byLegislator: LegislatorBillsIndex["by_legislator"] = {};

  // 議員名から議員情報を引けるようにマップを作成
  const legislatorMap = new Map<string, Legislator>();
  for (const leg of legislators) {
    legislatorMap.set(leg.name, leg);
  }

  // 法案から提出者を抽出
  for (const bill of bills) {
    if (bill.proposer_type === "閣法" || !bill.proposer) continue;

    // 複数の提出者を分割
    const proposers = bill.proposer.split(/[、,　 ]+/).map(p => p.trim()).filter(p => p);

    for (const proposerName of proposers) {
      if (!proposerName || proposerName.length < 2) continue;

      if (!byLegislator[proposerName]) {
        const leg = legislatorMap.get(proposerName);
        byLegislator[proposerName] = {
          name: proposerName,
          party: leg?.party || bill.proposer_party,
          total_bills: 0,
          passed_bills: 0,
          success_rate: 0,
          bills: [],
        };
      }

      byLegislator[proposerName].total_bills++;
      if (bill.status === "成立") {
        byLegislator[proposerName].passed_bills++;
      }

      byLegislator[proposerName].bills.push({
        id: bill.id,
        name: bill.bill_name,
        session: bill.diet_session,
        status: bill.status,
        house: bill.house,
      });
    }
  }

  // 成功率を計算
  for (const data of Object.values(byLegislator)) {
    data.success_rate = data.total_bills > 0
      ? Math.round((data.passed_bills / data.total_bills) * 100) / 100
      : 0;
    // 法案を国会回次の新しい順にソート
    data.bills.sort((a, b) => b.session - a.session);
  }

  return {
    updated_at: new Date().toISOString(),
    total_proposers: Object.keys(byLegislator).length,
    by_legislator: byLegislator,
  };
}

// 政党統計を計算
function calculatePartyStats(legislators: Legislator[], bills: Bill[]): Party[] {
  const partyStats: Record<string, { count: number; bills: number; passed: number }> = {};

  // 議員数をカウント
  for (const leg of legislators) {
    if (!partyStats[leg.party_id]) {
      partyStats[leg.party_id] = { count: 0, bills: 0, passed: 0 };
    }
    if (leg.is_active) {
      partyStats[leg.party_id].count++;
    }
  }

  // 法案数をカウント（proposer_partyから）
  const partyNameToId: Record<string, string> = {
    "自由民主党": "ldp", "自民党": "ldp", "自民": "ldp",
    "立憲民主党": "cdp", "立憲": "cdp",
    "公明党": "komei", "公明": "komei",
    "日本維新の会": "ishin", "維新": "ishin",
    "国民民主党": "dpfp", "国民": "dpfp",
    "日本共産党": "jcp", "共産党": "jcp", "共産": "jcp",
    "れいわ新選組": "reiwa",
    "社会民主党": "sdp", "社民党": "sdp",
  };

  for (const bill of bills) {
    if (bill.proposer_type === "閣法") continue;
    const partyStr = bill.proposer_party || "";
    if (!partyStr) continue;

    const parties = partyStr.split(/[;；、,]/);
    for (const p of parties) {
      const pName = p.trim();
      for (const [key, pid] of Object.entries(partyNameToId)) {
        if (pName.includes(key)) {
          if (!partyStats[pid]) {
            partyStats[pid] = { count: 0, bills: 0, passed: 0 };
          }
          partyStats[pid].bills++;
          if (bill.status === "成立") {
            partyStats[pid].passed++;
          }
          break;
        }
      }
    }
  }

  // 政党データを生成
  const partyColors: Record<string, string> = {
    ldp: "#e74c3c",
    cdp: "#3498db",
    komei: "#f39c12",
    ishin: "#27ae60",
    dpfp: "#9b59b6",
    jcp: "#c0392b",
    reiwa: "#e91e63",
    sdp: "#ff6b6b",
    nhk: "#4a4a4a",
    sansei: "#ff9800",
    independent: "#95a5a6",
    other: "#7f8c8d",
  };

  const partyNames: Record<string, { name: string; short: string; url?: string }> = {
    ldp: { name: "自由民主党", short: "自民", url: "https://www.jimin.jp/" },
    cdp: { name: "立憲民主党", short: "立憲", url: "https://cdp-japan.jp/" },
    komei: { name: "公明党", short: "公明", url: "https://www.komei.or.jp/" },
    ishin: { name: "日本維新の会", short: "維新", url: "https://o-ishin.jp/" },
    dpfp: { name: "国民民主党", short: "国民", url: "https://new-kokumin.jp/" },
    jcp: { name: "日本共産党", short: "共産", url: "https://www.jcp.or.jp/" },
    reiwa: { name: "れいわ新選組", short: "れいわ", url: "https://reiwa-shinsengumi.com/" },
    sdp: { name: "社会民主党", short: "社民", url: "https://sdp.or.jp/" },
    nhk: { name: "NHK党", short: "NHK", url: "https://www.nhk-party.jp/" },
    sansei: { name: "参政党", short: "参政", url: "https://www.sanseito.jp/" },
    independent: { name: "無所属", short: "無", url: undefined },
    other: { name: "その他", short: "他", url: undefined },
  };

  const parties: Party[] = [];
  for (const [id, info] of Object.entries(partyNames)) {
    const stats = partyStats[id] || { count: 0, bills: 0, passed: 0 };
    parties.push({
      id,
      name: info.name,
      short_name: info.short,
      color: partyColors[id] || "#666666",
      member_count: stats.count,
      official_url: info.url,
    });
  }

  return parties.sort((a, b) => b.member_count - a.member_count);
}

// メイン処理
async function main(): Promise<void> {
  console.log("🔄 自動更新スクリプト開始");
  console.log("=" .repeat(50));

  ensureDir(LEGISLATORS_DIR);

  // データ取得
  const councillors = await fetchCouncillors();
  const representatives = await fetchRepresentatives();
  const allLegislators = [...councillors, ...representatives];
  const bills = await fetchBills();
  const parties = calculatePartyStats(allLegislators, bills);

  // 保存
  const now = new Date().toISOString();

  // 議員データ
  const legislatorsOutput = {
    updated_at: now,
    source: "SmartNews MRI (参議院) + 国会会議録API/Wikidata/EveryPolitician (衆議院)",
    total_count: allLegislators.length,
    councillors_count: councillors.length,
    representatives_count: representatives.length,
    active_count: allLegislators.filter(l => l.is_active).length,
    legislators: allLegislators,
  };
  fs.writeFileSync(
    path.join(LEGISLATORS_DIR, "legislators.json"),
    JSON.stringify(legislatorsOutput, null, 2),
    "utf-8"
  );
  console.log(`\n💾 議員データ保存: ${allLegislators.length} 名`);

  // 政党データ
  const partiesOutput = {
    updated_at: now,
    parties,
  };
  fs.writeFileSync(
    path.join(LEGISLATORS_DIR, "parties.json"),
    JSON.stringify(partiesOutput, null, 2),
    "utf-8"
  );
  console.log(`💾 政党データ保存: ${parties.length} 政党`);

  // 法案データ
  const billsOutput = {
    updated_at: now,
    source: "SmartNews Media Research Institute",
    total_count: bills.length,
    passed_count: bills.filter(b => b.status === "成立").length,
    bills,
  };
  fs.writeFileSync(
    path.join(LEGISLATORS_DIR, "smri_bills.json"),
    JSON.stringify(billsOutput, null, 2),
    "utf-8"
  );
  console.log(`💾 法案データ保存: ${bills.length} 件`);

  // 統計データ
  const activeCouncillors = councillors.filter(l => l.is_active).length;
  const activeRepresentatives = representatives.filter(l => l.is_active).length;
  const statsOutput = {
    updated_at: now,
    summary: {
      total_legislators: activeCouncillors + activeRepresentatives,
      councillors: activeCouncillors,
      representatives: activeRepresentatives,
      total_bills: bills.length,
      passed_bills: bills.filter(b => b.status === "成立").length,
      overall_success_rate: bills.length > 0
        ? bills.filter(b => b.status === "成立").length / bills.length
        : 0,
    },
    by_party: Object.fromEntries(
      parties.map(p => [p.id, { name: p.name, member_count: p.member_count }])
    ),
  };
  fs.writeFileSync(
    path.join(LEGISLATORS_DIR, "activity_stats.json"),
    JSON.stringify(statsOutput, null, 2),
    "utf-8"
  );
  console.log(`💾 統計データ保存`);

  // 議員別法案追跡データを生成
  const legislatorBills = generateLegislatorBillsIndex(bills, allLegislators);
  fs.writeFileSync(
    path.join(LEGISLATORS_DIR, "legislator_bills.json"),
    JSON.stringify(legislatorBills, null, 2),
    "utf-8"
  );
  console.log(`💾 議員別法案データ保存: ${Object.keys(legislatorBills.by_legislator).length} 名`);

  // サマリー
  const repSource = representatives[0]?.source || "unknown";
  const sourceLabel = repSource.startsWith("kokkai-api") ? "国会会議録API" :
                      repSource.startsWith("wikidata") ? "Wikidata" : "EveryPolitician (2017)";
  console.log("\n" + "=".repeat(50));
  console.log("📈 更新完了:");
  console.log(`  参議院議員: ${councillors.length} 名 (SMRI)`);
  console.log(`  衆議院議員: ${representatives.length} 名 (${sourceLabel})`);
  console.log(`  法案: ${bills.length} 件 (成立: ${bills.filter(b => b.status === "成立").length} 件)`);
  console.log(`  政党: ${parties.length} 党`);
  console.log("\n✅ 完了!");
}

main().catch(console.error);
