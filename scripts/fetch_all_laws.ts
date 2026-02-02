/**
 * fetch_all_laws.ts
 * e-Gov法令APIから全法令XMLを取得する
 */

import axios from "axios";
import * as fs from "fs";
import * as path from "path";

const API_BASE = "https://laws.e-gov.go.jp/api/1";
const DATA_DIR = path.join(__dirname, "..", "data");
const XML_DIR = path.join(DATA_DIR, "xml");

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

// APIレート制限対応（1秒待機）
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ディレクトリ作成
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 法令一覧を取得
async function fetchLawList(): Promise<LawListItem[]> {
  console.log("📋 法令一覧を取得中...");
  
  const response = await axios.get(`${API_BASE}/lawlists/1`, {
    headers: { Accept: "application/json" },
  });
  
  const laws: LawListItem[] = [];
  
  // APIレスポンスから法令リストを抽出
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
  console.log("🏛️ 日本法令データベース - 法令取得スクリプト");
  console.log("=".repeat(50));
  
  // ディレクトリ準備
  for (const category of Object.values(CATEGORY_MAP)) {
    ensureDir(path.join(XML_DIR, category));
  }
  
  // 法令一覧取得
  const lawList = await fetchLawList();
  
  // 進捗管理
  const indexData: LawInfo[] = [];
  let successCount = 0;
  let errorCount = 0;
  
  console.log("\n📥 法令XMLを取得中...");
  
  for (let i = 0; i < lawList.length; i++) {
    const law = lawList[i];
    const progress = `[${i + 1}/${lawList.length}]`;
    
    // カテゴリ判定
    const category = getCategory(law.LawType);
    const xmlPath = path.join(XML_DIR, category, `${law.LawId}.xml`);
    
    // 既にダウンロード済みならスキップ
    if (fs.existsSync(xmlPath)) {
      console.log(`${progress} ⏭️ スキップ: ${law.LawTitle}`);
      indexData.push({
        id: law.LawId,
        lawNum: law.LawNum,
        title: law.LawTitle,
        category,
      });
      successCount++;
      continue;
    }
    
    console.log(`${progress} ⬇️ 取得中: ${law.LawTitle}`);
    
    // XML取得
    const xml = await fetchLawXml(law.LawId);
    
    if (xml) {
      fs.writeFileSync(xmlPath, xml, "utf-8");
      indexData.push({
        id: law.LawId,
        lawNum: law.LawNum,
        title: law.LawTitle,
        category,
      });
      successCount++;
    } else {
      errorCount++;
    }
    
    // レート制限対応
    await sleep(1000);
  }
  
  // インデックス保存
  const indexPath = path.join(DATA_DIR, "index", "laws.json");
  ensureDir(path.dirname(indexPath));
  
  const indexOutput = {
    updated_at: new Date().toISOString(),
    total_count: indexData.length,
    laws: indexData,
  };
  
  fs.writeFileSync(indexPath, JSON.stringify(indexOutput, null, 2), "utf-8");
  
  // 結果表示
  console.log("\n" + "=".repeat(50));
  console.log("✅ 完了!");
  console.log(`  成功: ${successCount} 件`);
  console.log(`  エラー: ${errorCount} 件`);
  console.log(`  インデックス: ${indexPath}`);
}

main().catch(console.error);
