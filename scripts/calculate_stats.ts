/**
 * calculate_stats.ts
 * GitHub Issuesから議員の活動統計を計算する
 */

import { Octokit } from "@octokit/rest";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(__dirname, "..", "data");
const LEGISLATORS_DIR = path.join(DATA_DIR, "index", "legislators");

// 環境変数
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const GITHUB_OWNER = process.env.GITHUB_OWNER || "DaisukeHori";
const GITHUB_REPO = process.env.GITHUB_REPO || "japan-law";

interface Legislator {
  id: string;
  name: string;
  party: string;
  party_id: string;
  house: string;
}

interface Bill {
  id: string;
  bill_number: string;
  name: string;
  proposer_id: string;
  proposer_name: string;
  co_proposers: string[];
  party_id: string;
  submission_date: string;
  status: string;
  category: string;
  github_issue: number;
}

interface LegislatorStats {
  id: string;
  name: string;
  party: string;
  house: string;
  total_bills: number;
  passed_bills: number;
  rejected_bills: number;
  pending_bills: number;
  success_rate: number;
  as_main_proposer: number;
  as_co_proposer: number;
  first_bill_date: string | null;
  last_bill_date: string | null;
  bills_by_year: Record<string, number>;
  bills_by_category: Record<string, number>;
}

// ディレクトリ作成
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 議員マスタ読み込み
function loadLegislators(): Legislator[] {
  const filePath = path.join(LEGISLATORS_DIR, "legislators.json");
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return data.legislators || [];
  }
  return [];
}

// 法案データ読み込み
function loadBills(): Bill[] {
  const filePath = path.join(LEGISLATORS_DIR, "bills.json");
  if (fs.existsSync(filePath)) {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return data.bills || [];
  }
  return [];
}

// GitHub Issuesから法案データを収集
async function collectBillsFromIssues(): Promise<Bill[]> {
  if (!GITHUB_TOKEN) {
    console.log("⚠️ GITHUB_TOKEN が設定されていません。既存データを使用します。");
    return loadBills();
  }
  
  const octokit = new Octokit({ auth: GITHUB_TOKEN });
  const bills: Bill[] = [];
  
  console.log("📋 GitHub Issuesを取得中...");
  
  try {
    const issues = await octokit.paginate(octokit.issues.listForRepo, {
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO,
      state: "all",
      per_page: 100,
    });
    
    // 議員マスタからname→id変換用マップ作成
    const legislators = loadLegislators();
    const nameToId = new Map<string, string>();
    for (const leg of legislators) {
      nameToId.set(leg.name, leg.id);
    }
    
    for (const issue of issues) {
      // ラベルから情報を抽出
      const labels = issue.labels.map((l: any) => 
        typeof l === "string" ? l : l.name
      );
      
      // 種別ラベルがあるもののみ法案として扱う
      const typeLabel = labels.find((l: string) => l.startsWith("種別/"));
      if (!typeLabel) continue;
      
      // 提案者を抽出
      const proposerLabel = labels.find((l: string) => l.startsWith("提案者/"));
      const proposerName = proposerLabel ? proposerLabel.replace("提案者/", "") : "不明";
      
      // 政党を抽出
      const partyLabel = labels.find((l: string) => l.startsWith("政党/"));
      const partyName = partyLabel ? partyLabel.replace("政党/", "") : "不明";
      
      // 状態を抽出
      const statusLabel = labels.find((l: string) => l.startsWith("状態/"));
      const status = statusLabel 
        ? statusLabel.replace("状態/", "") 
        : (issue.state === "closed" ? "成立" : "審議中");
      
      // 分野を抽出
      const categoryLabel = labels.find((l: string) => l.startsWith("分野/"));
      const category = categoryLabel ? categoryLabel.replace("分野/", "") : "その他";
      
      bills.push({
        id: `issue-${issue.number}`,
        bill_number: issue.title.replace("[法案] ", ""),
        name: issue.title.replace("[法案] ", ""),
        proposer_id: nameToId.get(proposerName) || "unknown",
        proposer_name: proposerName,
        co_proposers: [],
        party_id: partyToId(partyName),
        submission_date: issue.created_at?.split("T")[0] || "",
        status,
        category,
        github_issue: issue.number,
      });
    }
    
    console.log(`  → ${bills.length} 件の法案を取得`);
  } catch (error: any) {
    console.error("❌ GitHub API エラー:", error.message);
    return loadBills();
  }
  
  return bills;
}

// 政党名→IDの変換
function partyToId(partyName: string): string {
  const mapping: Record<string, string> = {
    "自由民主党": "ldp",
    "立憲民主党": "cdp",
    "公明党": "komei",
    "日本維新の会": "ishin",
    "国民民主党": "dpfp",
    "日本共産党": "jcp",
    "れいわ新選組": "reiwa",
    "無所属": "independent",
  };
  return mapping[partyName] || "other";
}

// 統計計算
function calculateStats(legislators: Legislator[], bills: Bill[]): Record<string, LegislatorStats> {
  const stats: Record<string, LegislatorStats> = {};
  
  // 議員ごとの統計を初期化
  for (const leg of legislators) {
    stats[leg.id] = {
      id: leg.id,
      name: leg.name,
      party: leg.party,
      house: leg.house,
      total_bills: 0,
      passed_bills: 0,
      rejected_bills: 0,
      pending_bills: 0,
      success_rate: 0,
      as_main_proposer: 0,
      as_co_proposer: 0,
      first_bill_date: null,
      last_bill_date: null,
      bills_by_year: {},
      bills_by_category: {},
    };
  }
  
  // 法案データから統計を計算
  for (const bill of bills) {
    const mainStats = stats[bill.proposer_id];
    
    if (mainStats) {
      mainStats.total_bills++;
      mainStats.as_main_proposer++;
      
      // 状態別カウント
      if (bill.status === "成立") {
        mainStats.passed_bills++;
      } else if (bill.status === "廃案" || bill.status === "撤回") {
        mainStats.rejected_bills++;
      } else {
        mainStats.pending_bills++;
      }
      
      // 日付
      if (!mainStats.first_bill_date || bill.submission_date < mainStats.first_bill_date) {
        mainStats.first_bill_date = bill.submission_date;
      }
      if (!mainStats.last_bill_date || bill.submission_date > mainStats.last_bill_date) {
        mainStats.last_bill_date = bill.submission_date;
      }
      
      // 年別
      if (bill.submission_date) {
        const year = bill.submission_date.substring(0, 4);
        mainStats.bills_by_year[year] = (mainStats.bills_by_year[year] || 0) + 1;
      }
      
      // 分野別
      mainStats.bills_by_category[bill.category] = 
        (mainStats.bills_by_category[bill.category] || 0) + 1;
    }
    
    // 共同提出者
    for (const coId of bill.co_proposers) {
      const coStats = stats[coId];
      if (coStats) {
        coStats.total_bills++;
        coStats.as_co_proposer++;
        
        if (bill.status === "成立") coStats.passed_bills++;
        else if (bill.status === "廃案" || bill.status === "撤回") coStats.rejected_bills++;
        else coStats.pending_bills++;
      }
    }
  }
  
  // 成功率を計算
  for (const stat of Object.values(stats)) {
    const decided = stat.passed_bills + stat.rejected_bills;
    stat.success_rate = decided > 0 ? stat.passed_bills / decided : 0;
  }
  
  return stats;
}

// メイン処理
async function main(): Promise<void> {
  console.log("📊 議員統計計算スクリプト");
  console.log("=".repeat(50));
  
  ensureDir(LEGISLATORS_DIR);
  
  // データ読み込み
  const legislators = loadLegislators();
  console.log(`👤 議員マスタ: ${legislators.length} 件`);
  
  // GitHub Issuesから法案データ収集
  const bills = await collectBillsFromIssues();
  
  // 法案データ保存
  const billsOutput = {
    updated_at: new Date().toISOString(),
    bills,
  };
  fs.writeFileSync(
    path.join(LEGISLATORS_DIR, "bills.json"),
    JSON.stringify(billsOutput, null, 2),
    "utf-8"
  );
  
  // 統計計算
  const statsByLegislator = calculateStats(legislators, bills);
  
  // サマリー
  const summary = {
    total_legislators: legislators.length,
    total_bills: bills.length,
    passed_bills: bills.filter((b) => b.status === "成立").length,
    overall_success_rate: 0,
  };
  summary.overall_success_rate = summary.total_bills > 0
    ? summary.passed_bills / summary.total_bills
    : 0;
  
  // 統計出力
  const statsOutput = {
    updated_at: new Date().toISOString(),
    summary,
    by_legislator: statsByLegislator,
  };
  
  fs.writeFileSync(
    path.join(LEGISLATORS_DIR, "activity_stats.json"),
    JSON.stringify(statsOutput, null, 2),
    "utf-8"
  );
  
  console.log("\n" + "=".repeat(50));
  console.log("✅ 完了!");
  console.log(`  議員数: ${summary.total_legislators}`);
  console.log(`  法案数: ${summary.total_bills}`);
  console.log(`  成立数: ${summary.passed_bills}`);
}

main().catch(console.error);
