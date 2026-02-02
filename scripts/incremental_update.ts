/**
 * incremental_update.ts
 * e-Gov法令APIから新規・更新法令のみを取得する（インクリメンタル更新）
 */

import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { XMLParser } from "fast-xml-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = "https://laws.e-gov.go.jp/api/1";
const DATA_DIR = path.join(__dirname, "..", "data");
const XML_DIR = path.join(DATA_DIR, "xml");
const INDEX_PATH = path.join(DATA_DIR, "index", "laws.json");

// カテゴリマッピング（カテゴリ番号 → フォルダ名）
const CATEGORY_MAP: Record<number, string> = {
  1: "acts",           // 全法令
  2: "cabinet_orders", // 政令
  3: "ministerial_ordinances", // 府省令
  4: "rules",          // 規則
};

// 法令IDからカテゴリを推定
function getCategoryFromLawId(lawId: string): string {
  if (lawId.includes("CONSTITUTION")) return "constitution";
  if (lawId.includes("AC")) return "acts";
  if (lawId.includes("CO")) return "cabinet_orders";
  if (lawId.includes("IO")) return "imperial_orders";
  if (lawId.includes("M")) return "ministerial_ordinances";
  if (lawId.includes("R")) return "rules";
  return "misc";
}

interface LawListItem {
  LawId: string;
  LawNum: string;
  LawTitle: string;
  category: string;
}

interface LawInfo {
  id: string;
  lawNum: string;
  title: string;
  category: string;
}

interface LawIndex {
  updated_at: string;
  total_count: number;
  laws: LawInfo[];
}

// XMLパーサー
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

// APIレート制限対応
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ディレクトリ作成
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 既存のインデックスを読み込み
function loadExistingIndex(): LawIndex | null {
  try {
    if (fs.existsSync(INDEX_PATH)) {
      const data = fs.readFileSync(INDEX_PATH, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.warn("⚠️ 既存インデックスの読み込みに失敗しました");
  }
  return null;
}

// 既存インデックスからカテゴリマップを作成
function buildCategoryMap(index: LawIndex | null): Map<string, string> {
  const map = new Map<string, string>();
  if (index?.laws) {
    for (const law of index.laws) {
      map.set(law.id, law.category);
    }
  }
  return map;
}

// 法令一覧を取得（XML解析）
async function fetchLawList(): Promise<LawListItem[]> {
  console.log("📋 法令一覧を取得中...");

  const laws: LawListItem[] = [];

  // カテゴリ1（全法令）のみ取得
  try {
    const response = await axios.get(`${API_BASE}/lawlists/1`, {
      headers: { Accept: "application/xml" },
      responseType: "text",
    });

    const parsed = xmlParser.parse(response.data);
    const dataRoot = parsed.DataRoot;

    if (dataRoot?.Result?.Code !== "0" && dataRoot?.Result?.Code !== 0) {
      console.error("❌ APIエラー:", dataRoot?.Result?.Message);
      return laws;
    }

    // LawNameListInfo を配列として処理
    let lawList = dataRoot?.ApplData?.LawNameListInfo;
    if (!lawList) {
      console.warn("⚠️ 法令データが見つかりません");
      return laws;
    }

    // 単一要素の場合は配列に変換
    if (!Array.isArray(lawList)) {
      lawList = [lawList];
    }

    for (const law of lawList) {
      const lawId = law.LawId || "";
      laws.push({
        LawId: lawId,
        LawNum: law.LawNo || "",
        LawTitle: law.LawName || "",
        category: getCategoryFromLawId(lawId),
      });
    }

    console.log(`  → ${laws.length} 件の法令を発見`);
  } catch (error: any) {
    console.error("❌ 法令一覧の取得に失敗:", error.message);
  }

  return laws;
}

// 法令XMLを取得
async function fetchLawXml(lawId: string): Promise<string | null> {
  try {
    const response = await axios.get(`${API_BASE}/lawdata/${lawId}`, {
      headers: { Accept: "application/xml" },
      responseType: "text",
    });
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 404) {
      console.warn(`  ⚠️ 法令が見つかりません: ${lawId}`);
    } else {
      console.error(`  ❌ エラー: ${lawId}`, error.message);
    }
    return null;
  }
}

// メイン処理
async function main(): Promise<void> {
  console.log("🏛️ 日本法令データベース - インクリメンタル更新");
  console.log("=".repeat(50));

  // ディレクトリ準備
  const categories = ["constitution", "acts", "cabinet_orders", "imperial_orders", "ministerial_ordinances", "rules", "misc"];
  for (const category of categories) {
    ensureDir(path.join(XML_DIR, category));
  }
  ensureDir(path.dirname(INDEX_PATH));

  // 既存インデックス読み込み
  const existingIndex = loadExistingIndex();
  const existingLawIds = new Set(existingIndex?.laws.map(l => l.id) || []);
  const existingCategoryMap = buildCategoryMap(existingIndex);

  console.log(`📊 既存法令: ${existingLawIds.size} 件`);

  // 最新の法令一覧取得
  const lawList = await fetchLawList();

  if (lawList.length === 0) {
    console.log("⚠️ 法令一覧を取得できませんでした。既存インデックスを維持します。");
    return;
  }

  // 既存カテゴリを使用（存在しない場合のみ推測）
  for (const law of lawList) {
    const existingCategory = existingCategoryMap.get(law.LawId);
    if (existingCategory) {
      law.category = existingCategory;
    }
  }

  // 新規法令を特定
  const newLaws = lawList.filter(law => !existingLawIds.has(law.LawId));
  console.log(`🆕 新規法令: ${newLaws.length} 件`);

  // 更新対象（XMLファイルが存在しない法令）
  const missingLaws = lawList.filter(law => {
    const xmlPath = path.join(XML_DIR, law.category, `${law.LawId}.xml`);
    return !fs.existsSync(xmlPath);
  });
  console.log(`📁 XMLファイルなし: ${missingLaws.length} 件`);

  // 更新対象を決定（新規 + XMLなし）
  const updateTargets = [...new Map([...newLaws, ...missingLaws].map(l => [l.LawId, l])).values()];
  console.log(`🎯 更新対象: ${updateTargets.length} 件`);

  if (updateTargets.length === 0) {
    console.log("\n✅ 更新対象なし - 全法令は最新状態です");

    // インデックスのみ更新
    const indexData: LawInfo[] = lawList.map(law => ({
      id: law.LawId,
      lawNum: law.LawNum,
      title: law.LawTitle,
      category: law.category,
    }));

    const indexOutput: LawIndex = {
      updated_at: new Date().toISOString(),
      total_count: indexData.length,
      laws: indexData,
    };

    fs.writeFileSync(INDEX_PATH, JSON.stringify(indexOutput, null, 2), "utf-8");
    console.log(`📄 インデックスを更新: ${indexData.length} 件`);
    return;
  }

  // 進捗管理
  let successCount = 0;
  let errorCount = 0;

  console.log("\n📥 法令XMLを取得中...");

  for (let i = 0; i < updateTargets.length; i++) {
    const law = updateTargets[i];
    const progress = `[${i + 1}/${updateTargets.length}]`;

    const xmlPath = path.join(XML_DIR, law.category, `${law.LawId}.xml`);

    console.log(`${progress} ⬇️ 取得中: ${law.LawTitle}`);

    const xml = await fetchLawXml(law.LawId);

    if (xml) {
      fs.writeFileSync(xmlPath, xml, "utf-8");
      successCount++;
    } else {
      errorCount++;
    }

    // レート制限対応
    await sleep(1000);
  }

  // インデックス再構築
  const indexData: LawInfo[] = lawList.map(law => ({
    id: law.LawId,
    lawNum: law.LawNum,
    title: law.LawTitle,
    category: law.category,
  }));

  const indexOutput: LawIndex = {
    updated_at: new Date().toISOString(),
    total_count: indexData.length,
    laws: indexData,
  };

  fs.writeFileSync(INDEX_PATH, JSON.stringify(indexOutput, null, 2), "utf-8");

  // 結果表示
  console.log("\n" + "=".repeat(50));
  console.log("✅ インクリメンタル更新完了!");
  console.log(`  新規取得: ${successCount} 件`);
  console.log(`  エラー: ${errorCount} 件`);
  console.log(`  総法令数: ${indexData.length} 件`);
}

main().catch(console.error);
