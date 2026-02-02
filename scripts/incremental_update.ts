/**
 * incremental_update.ts
 * e-Gov法令APIから新規・更新法令のみを取得する（インクリメンタル更新）
 */

import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = "https://laws.e-gov.go.jp/api/1";
const DATA_DIR = path.join(__dirname, "..", "data");
const XML_DIR = path.join(DATA_DIR, "xml");
const INDEX_PATH = path.join(DATA_DIR, "index", "laws.json");

// カテゴリマッピング
const CATEGORY_MAP: Record<string, string> = {
  Constitution: "constitution",
  Act: "acts",
  CabinetOrder: "cabinet_orders",
  ImperialOrder: "imperial_orders",
  MinisterialOrdinance: "ministerial_ordinances",
  Rule: "rules",
  Misc: "misc",
};

interface LawListItem {
  LawId: string;
  LawNum: string;
  LawTitle: string;
  LawType?: string;
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

// 法令一覧を取得
async function fetchLawList(): Promise<LawListItem[]> {
  console.log("📋 法令一覧を取得中...");

  const response = await axios.get(`${API_BASE}/lawlists/1`, {
    headers: { Accept: "application/json" },
  });

  const laws: LawListItem[] = [];

  if (response.data?.lawlists) {
    for (const category of response.data.lawlists) {
      if (category.laws) {
        for (const law of category.laws) {
          laws.push({
            LawId: law.law_id,
            LawNum: law.law_num,
            LawTitle: law.law_title,
            LawType: category.category,
          });
        }
      }
    }
  }

  console.log(`  → ${laws.length} 件の法令を発見`);
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

// カテゴリを判定
function getCategory(lawType?: string): string {
  if (!lawType) return "misc";
  return CATEGORY_MAP[lawType] || "misc";
}

// メイン処理
async function main(): Promise<void> {
  console.log("🏛️ 日本法令データベース - インクリメンタル更新");
  console.log("=".repeat(50));

  // ディレクトリ準備
  for (const category of Object.values(CATEGORY_MAP)) {
    ensureDir(path.join(XML_DIR, category));
  }
  ensureDir(path.dirname(INDEX_PATH));

  // 既存インデックス読み込み
  const existingIndex = loadExistingIndex();
  const existingLawIds = new Set(existingIndex?.laws.map(l => l.id) || []);

  console.log(`📊 既存法令: ${existingLawIds.size} 件`);

  // 最新の法令一覧取得
  const lawList = await fetchLawList();

  // 新規法令を特定
  const newLaws = lawList.filter(law => !existingLawIds.has(law.LawId));
  console.log(`🆕 新規法令: ${newLaws.length} 件`);

  // 更新対象（XMLファイルが存在しない法令）
  const missingLaws = lawList.filter(law => {
    const category = getCategory(law.LawType);
    const xmlPath = path.join(XML_DIR, category, `${law.LawId}.xml`);
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
      category: getCategory(law.LawType),
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

    const category = getCategory(law.LawType);
    const xmlPath = path.join(XML_DIR, category, `${law.LawId}.xml`);

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
    category: getCategory(law.LawType),
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
