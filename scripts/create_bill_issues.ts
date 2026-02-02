/**
 * create_bill_issues.ts
 * 新規法案をGitHub Issuesとして自動作成
 * Laws as Code: 法案 = Issue, 可決 = PR merge
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { Octokit } from "@octokit/rest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "..", "data");
const LEGISLATORS_DIR = path.join(DATA_DIR, "index", "legislators");
const TRACKING_FILE = path.join(LEGISLATORS_DIR, "created_issues.json");

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

interface CreatedIssues {
  updated_at: string;
  issues: { [billId: string]: number }; // billId -> issue number
}

interface BillsData {
  updated_at: string;
  source: string;
  total_count: number;
  bills: Bill[];
}

// ステータスに応じたラベル
function getStatusLabel(status: string): string {
  switch (status) {
    case "成立":
      return "成立";
    case "廃案":
      return "廃案";
    case "撤回":
      return "撤回";
    case "継続審議":
      return "継続審議";
    default:
      return "審議中";
  }
}

// 法案タイプに応じたラベル
function getBillTypeLabel(type: string, proposerType: string): string {
  if (proposerType === "閣法") return "閣法";
  if (type.includes("衆") || proposerType === "衆法") return "衆法";
  if (type.includes("参") || proposerType === "参法") return "参法";
  return "議員立法";
}

// ハウスラベル
function getHouseLabel(house: string): string {
  return house === "参議院" ? "参議院" : "衆議院";
}

async function loadCreatedIssues(): Promise<CreatedIssues> {
  try {
    if (fs.existsSync(TRACKING_FILE)) {
      const data = fs.readFileSync(TRACKING_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.log("No existing tracking file, starting fresh");
  }
  return {
    updated_at: new Date().toISOString(),
    issues: {},
  };
}

function saveCreatedIssues(data: CreatedIssues): void {
  data.updated_at = new Date().toISOString();
  fs.writeFileSync(TRACKING_FILE, JSON.stringify(data, null, 2), "utf-8");
}

async function ensureLabels(octokit: Octokit, owner: string, repo: string): Promise<void> {
  const labels = [
    // 基本ラベル
    { name: "法案", color: "0366d6", description: "法律案" },
    { name: "閣法", color: "1d76db", description: "内閣提出法案" },
    { name: "衆法", color: "5319e7", description: "衆議院議員提出法案" },
    { name: "参法", color: "d93f0b", description: "参議院議員提出法案" },
    { name: "議員立法", color: "006b75", description: "議員提出法案" },
    // 状態ラベル
    { name: "成立", color: "0e8a16", description: "成立した法案" },
    { name: "廃案", color: "b60205", description: "廃案となった法案" },
    { name: "撤回", color: "e4e669", description: "撤回された法案" },
    { name: "継続審議", color: "fbca04", description: "継続審議中の法案" },
    { name: "審議中", color: "c5def5", description: "審議中の法案" },
    // 院別ラベル
    { name: "衆議院", color: "bfdadc", description: "衆議院で審議" },
    { name: "参議院", color: "d4c5f9", description: "参議院で審議" },
    // 会派ラベル
    { name: "会派/自民", color: "e74c3c", description: "自由民主党提出" },
    { name: "会派/立憲", color: "3498db", description: "立憲民主党提出" },
    { name: "会派/公明", color: "f39c12", description: "公明党提出" },
    { name: "会派/維新", color: "27ae60", description: "日本維新の会提出" },
    { name: "会派/国民", color: "9b59b6", description: "国民民主党提出" },
    { name: "会派/共産", color: "c0392b", description: "日本共産党提出" },
    { name: "会派/れいわ", color: "e91e63", description: "れいわ新選組提出" },
    { name: "会派/社民", color: "ff6b6b", description: "社会民主党提出" },
  ];

  for (const label of labels) {
    try {
      await octokit.issues.createLabel({
        owner,
        repo,
        name: label.name,
        color: label.color,
        description: label.description,
      });
      console.log(`  ✅ ラベル作成: ${label.name}`);
    } catch (e: any) {
      if (e.status === 422) {
        // Already exists, try to update
        try {
          await octokit.issues.updateLabel({
            owner,
            repo,
            name: label.name,
            color: label.color,
            description: label.description,
          });
        } catch {
          // Ignore update errors
        }
      }
    }
  }
}

// 提出者名をラベル用に整形（複数名の場合は最初の1人）
function getProposerLabel(proposer: string): string | null {
  if (!proposer || proposer === "内閣") return null;
  // 複数名の場合は最初の1人を取得
  const names = proposer.split(/[、,　 ]/);
  const firstName = names[0]?.trim();
  if (!firstName || firstName.length > 10) return null;
  return `提案者/${firstName}`;
}

// 提出会派をラベル用に整形
function getPartyLabel(party: string): string | null {
  if (!party) return null;
  // 短縮名を使用
  const shortNames: Record<string, string> = {
    "自由民主党": "自民",
    "立憲民主党": "立憲",
    "公明党": "公明",
    "日本維新の会": "維新",
    "国民民主党": "国民",
    "日本共産党": "共産",
    "れいわ新選組": "れいわ",
    "社会民主党": "社民",
  };
  for (const [full, short] of Object.entries(shortNames)) {
    if (party.includes(full)) return `会派/${short}`;
  }
  return null;
}

async function createOrUpdateIssue(
  octokit: Octokit,
  owner: string,
  repo: string,
  bill: Bill,
  existingIssueNumber?: number
): Promise<number | null> {
  const labels = [
    "法案",
    getBillTypeLabel(bill.bill_type, bill.proposer_type),
    getStatusLabel(bill.status),
    getHouseLabel(bill.house),
    `第${bill.diet_session}回国会`,
  ];

  // 提出者ラベルを追加
  const proposerLabel = getProposerLabel(bill.proposer);
  if (proposerLabel) labels.push(proposerLabel);

  // 会派ラベルを追加
  const partyLabel = getPartyLabel(bill.proposer_party || "");
  if (partyLabel) labels.push(partyLabel);

  // 提出者の検索リンク
  const proposerSearchUrl = bill.proposer
    ? `https://github.com/${owner}/${repo}/issues?q=is%3Aissue+label%3A%22提案者%2F${encodeURIComponent(bill.proposer.split(/[、,　 ]/)[0] || "")}%22`
    : null;

  const body = `## 📋 法案情報

| 項目 | 内容 |
|------|------|
| **法案名** | ${bill.bill_name} |
| **種類** | ${bill.bill_type} |
| **国会回次** | 第${bill.diet_session}回国会 |
| **提出院** | ${bill.house} |
| **提出者** | ${bill.proposer || "不明"} |
| **提出会派** | ${bill.proposer_party || "不明"} |
| **提出種別** | ${bill.proposer_type} |
| **状態** | ${bill.status} |

---

### 👤 提出者による他の法案

${proposerSearchUrl ? `[${bill.proposer?.split(/[、,　 ]/)[0] || "提出者"}の提出法案一覧](${proposerSearchUrl})` : "（閣法のため該当なし）"}

---

### 📝 Laws as Code

この Issue は日本の法案を表しています。

- **法案可決** → この Issue をクローズし、法令ファイルを追加する PR を作成
- **法案廃案** → この Issue をクローズ（ラベルを「廃案」に変更）
- **法案修正** → この Issue にコメントを追加

> 🤖 このIssueは [国会会議録API](https://kokkai.ndl.go.jp/) + [SmartNews MRI](https://github.com/smartnews-smri) データから自動生成されました
`;

  const title = `[第${bill.diet_session}回] ${bill.bill_name}`;

  try {
    if (existingIssueNumber) {
      // Update existing issue
      await octokit.issues.update({
        owner,
        repo,
        issue_number: existingIssueNumber,
        title,
        body,
        labels,
        state: bill.status === "成立" || bill.status === "廃案" || bill.status === "撤回" ? "closed" : "open",
      });
      console.log(`  📝 Issue #${existingIssueNumber} 更新: ${bill.bill_name.slice(0, 30)}...`);
      return existingIssueNumber;
    } else {
      // Create new issue
      const response = await octokit.issues.create({
        owner,
        repo,
        title,
        body,
        labels,
      });
      console.log(`  ✅ Issue #${response.data.number} 作成: ${bill.bill_name.slice(0, 30)}...`);

      // If already completed, close it
      if (bill.status === "成立" || bill.status === "廃案" || bill.status === "撤回") {
        await octokit.issues.update({
          owner,
          repo,
          issue_number: response.data.number,
          state: "closed",
        });
      }

      return response.data.number;
    }
  } catch (e: any) {
    console.error(`  ❌ Issue作成失敗: ${bill.bill_name.slice(0, 30)}... - ${e.message}`);
    return null;
  }
}

async function main(): Promise<void> {
  console.log("📋 GitHub Issues 自動作成スクリプト");
  console.log("=".repeat(50));

  // Check for GitHub token
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log("⚠️ GITHUB_TOKEN が設定されていません");
    console.log("  ローカル実行時は: export GITHUB_TOKEN=your_token");
    console.log("  GitHub Actions では自動的に設定されます");
    return;
  }

  // Parse repo info from environment or use default
  const repoFullName = process.env.GITHUB_REPOSITORY || "DaisukeHori/japan-law";
  const [owner, repo] = repoFullName.split("/");

  // 対象国会数（環境変数で制御可能、デフォルト5）
  const numSessions = parseInt(process.env.ISSUES_NUM_SESSIONS || "5", 10);
  // 最大作成数（環境変数で制御可能、デフォルト100）
  const maxCreate = parseInt(process.env.ISSUES_MAX_CREATE || "100", 10);

  console.log(`\n📦 リポジトリ: ${owner}/${repo}`);
  console.log(`📊 設定: 直近${numSessions}国会分、最大${maxCreate}件作成`);

  const octokit = new Octokit({ auth: token });

  // Load bills data
  const billsPath = path.join(LEGISLATORS_DIR, "smri_bills.json");
  if (!fs.existsSync(billsPath)) {
    console.log("❌ 法案データが見つかりません: " + billsPath);
    console.log("  先に auto_update.ts を実行してください");
    return;
  }

  const billsData: BillsData = JSON.parse(fs.readFileSync(billsPath, "utf-8"));
  const bills = billsData.bills;

  console.log(`\n📊 法案総数: ${bills.length} 件`);

  // Load tracking data
  const tracking = await loadCreatedIssues();
  console.log(`  既存Issue: ${Object.keys(tracking.issues).length} 件`);

  // Ensure labels exist
  console.log("\n🏷️ ラベル確認中...");
  await ensureLabels(octokit, owner, repo);

  // Filter to recent bills
  const recentSessions = [...new Set(bills.map((b) => b.diet_session))]
    .filter(s => s > 0)
    .sort((a, b) => b - a)
    .slice(0, numSessions);

  console.log(`  対象国会: ${recentSessions.join(", ")} (直近${numSessions}回)`);

  const recentBills = bills.filter((b) => recentSessions.includes(b.diet_session));
  console.log(`\n📝 対象法案: ${recentBills.length} 件`);

  // Create/update issues
  let created = 0;
  let updated = 0;
  let skipped = 0;

  // 新規作成対象の法案（既存Issueがないもの）を優先
  const newBills = recentBills.filter(b => !tracking.issues[b.id]);
  const existingBills = recentBills.filter(b => tracking.issues[b.id]);

  console.log(`  新規: ${newBills.length} 件, 更新対象: ${existingBills.length} 件`);

  // 新規作成（最大数まで）
  for (const bill of newBills) {
    if (created >= maxCreate) {
      console.log(`  ⚠️ 最大作成数 (${maxCreate}) に達しました`);
      break;
    }

    // Rate limiting: wait between requests
    await new Promise((resolve) => setTimeout(resolve, 500));

    const issueNum = await createOrUpdateIssue(octokit, owner, repo, bill);
    if (issueNum) {
      tracking.issues[bill.id] = issueNum;
      created++;
    } else {
      skipped++;
    }

    // Save periodically
    if (created % 10 === 0) {
      saveCreatedIssues(tracking);
    }
  }

  // 既存Issueの更新（ステータス変更のみ）
  for (const bill of existingBills) {
    const existingIssue = tracking.issues[bill.id];

    // Rate limiting
    await new Promise((resolve) => setTimeout(resolve, 300));

    const issueNum = await createOrUpdateIssue(octokit, owner, repo, bill, existingIssue);
    if (issueNum) {
      updated++;
    }
  }

  // Final save
  saveCreatedIssues(tracking);

  console.log("\n" + "=".repeat(50));
  console.log("📈 結果:");
  console.log(`  新規作成: ${created} 件`);
  console.log(`  更新: ${updated} 件`);
  console.log(`  スキップ: ${skipped} 件`);
  console.log("\n✅ 完了!");
}

main().catch(console.error);
