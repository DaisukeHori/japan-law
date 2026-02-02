/**
 * create_enactment_prs.ts
 * 成立した法案に対してPRを自動作成
 * Laws as Code: 法案成立 = PR作成 → マージ = 法令化
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
const PR_TRACKING_FILE = path.join(LEGISLATORS_DIR, "created_prs.json");

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
  issues: { [billId: string]: number };
}

interface CreatedPRs {
  updated_at: string;
  prs: { [billId: string]: { pr_number: number; branch: string; merged: boolean } };
}

interface BillsData {
  updated_at: string;
  source: string;
  total_count: number;
  bills: Bill[];
}

async function loadCreatedIssues(): Promise<CreatedIssues> {
  try {
    if (fs.existsSync(TRACKING_FILE)) {
      return JSON.parse(fs.readFileSync(TRACKING_FILE, "utf-8"));
    }
  } catch (e) {
    console.log("No existing issues tracking file");
  }
  return { updated_at: new Date().toISOString(), issues: {} };
}

async function loadCreatedPRs(): Promise<CreatedPRs> {
  try {
    if (fs.existsSync(PR_TRACKING_FILE)) {
      return JSON.parse(fs.readFileSync(PR_TRACKING_FILE, "utf-8"));
    }
  } catch (e) {
    console.log("No existing PR tracking file");
  }
  return { updated_at: new Date().toISOString(), prs: {} };
}

function saveCreatedPRs(data: CreatedPRs): void {
  data.updated_at = new Date().toISOString();
  fs.writeFileSync(PR_TRACKING_FILE, JSON.stringify(data, null, 2), "utf-8");
}

// 法令IDを生成（仮のID - 実際のe-Gov IDがわかればそれを使用）
function generateLawId(bill: Bill): string {
  // 国会回次 + 法案種別 + 連番の形式
  const sessionCode = bill.diet_session.toString().padStart(3, "0");
  const typeCode = bill.proposer_type === "閣法" ? "AC0" :
                   bill.house === "衆議院" ? "AC1" : "AC2";
  return `${sessionCode}${typeCode}000000`;
}

// 法令Markdownファイルを生成
function generateLawMarkdown(bill: Bill): string {
  const enactedDate = new Date().toISOString().split("T")[0];

  return `# ${bill.bill_name.replace(/案$/, "")}

> 第${bill.diet_session}回国会で成立

## 法令情報

| 項目 | 内容 |
|------|------|
| **法令名** | ${bill.bill_name.replace(/案$/, "")} |
| **成立日** | ${enactedDate} |
| **国会回次** | 第${bill.diet_session}回国会 |
| **提出種別** | ${bill.proposer_type} |
| **提出者** | ${bill.proposer || "内閣"} |
| **提出会派** | ${bill.proposer_party || "-"} |

---

## 本則

*（法令本文は e-Gov から取得次第更新されます）*

---

## 附則

*（附則は e-Gov から取得次第更新されます）*

---

> 📝 この法令ファイルは法案成立時に自動生成されました。
> 正式な法令文は [e-Gov法令検索](https://laws.e-gov.go.jp/) で公開後に更新されます。
`;
}

async function createEnactmentPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  bill: Bill,
  issueNumber: number
): Promise<{ pr_number: number; branch: string } | null> {
  const branchName = `enact/session-${bill.diet_session}/${bill.id}`;
  const lawId = generateLawId(bill);
  const filePath = `data/markdown/acts/${lawId}.md`;
  const lawContent = generateLawMarkdown(bill);

  try {
    // 1. mainブランチの最新コミットを取得
    const { data: mainRef } = await octokit.git.getRef({
      owner,
      repo,
      ref: "heads/main",
    });
    const mainSha = mainRef.object.sha;

    // 2. 新しいブランチを作成
    try {
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: mainSha,
      });
      console.log(`    ✅ ブランチ作成: ${branchName}`);
    } catch (e: any) {
      if (e.status === 422) {
        console.log(`    ⚠️ ブランチ既存: ${branchName}`);
      } else {
        throw e;
      }
    }

    // 3. ファイルを作成/更新
    const content = Buffer.from(lawContent).toString("base64");

    try {
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: `📜 法令追加: ${bill.bill_name.replace(/案$/, "")}

第${bill.diet_session}回国会で成立

Closes #${issueNumber}`,
        content,
        branch: branchName,
      });
      console.log(`    ✅ ファイル作成: ${filePath}`);
    } catch (e: any) {
      console.log(`    ⚠️ ファイル作成エラー: ${e.message}`);
    }

    // 4. PRを作成
    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: `📜 [成立] ${bill.bill_name.replace(/案$/, "")}`,
      head: branchName,
      base: "main",
      body: `## 🏛️ 法案成立

### 法案情報
| 項目 | 内容 |
|------|------|
| **法案名** | ${bill.bill_name} |
| **国会回次** | 第${bill.diet_session}回国会 |
| **提出種別** | ${bill.proposer_type} |
| **提出者** | ${bill.proposer || "内閣"} |
| **状態** | ✅ 成立 |

### 関連Issue
- Closes #${issueNumber}

### 追加されるファイル
- \`${filePath}\`

---

### 📝 Laws as Code

このPRがマージされると:
1. 法令ファイルがリポジトリに追加されます
2. 関連するIssue #${issueNumber} が自動的にクローズされます
3. 法令データベースに新しい法令が登録されます

> 🤖 このPRは法案成立を検知して自動生成されました
`,
    });

    console.log(`    ✅ PR作成: #${pr.number}`);

    // 5. PRにラベルを追加
    await octokit.issues.addLabels({
      owner,
      repo,
      issue_number: pr.number,
      labels: ["成立", "法令追加", `第${bill.diet_session}回国会`],
    });

    return { pr_number: pr.number, branch: branchName };

  } catch (e: any) {
    console.error(`    ❌ PR作成失敗: ${e.message}`);
    return null;
  }
}

async function main(): Promise<void> {
  console.log("📜 法案成立PR自動作成スクリプト");
  console.log("=".repeat(50));

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.log("⚠️ GITHUB_TOKEN が設定されていません");
    return;
  }

  const repoFullName = process.env.GITHUB_REPOSITORY || "DaisukeHori/japan-law";
  const [owner, repo] = repoFullName.split("/");

  const maxCreate = parseInt(process.env.PRS_MAX_CREATE || "10", 10);

  console.log(`\n📦 リポジトリ: ${owner}/${repo}`);
  console.log(`📊 設定: 最大${maxCreate}件のPR作成`);

  const octokit = new Octokit({ auth: token });

  // Load data
  const billsPath = path.join(LEGISLATORS_DIR, "smri_bills.json");
  if (!fs.existsSync(billsPath)) {
    console.log("❌ 法案データが見つかりません");
    return;
  }

  const billsData: BillsData = JSON.parse(fs.readFileSync(billsPath, "utf-8"));
  const issues = await loadCreatedIssues();
  const prs = await loadCreatedPRs();

  // 成立した法案でIssueがあり、PRがまだないものを抽出
  const passedBills = billsData.bills.filter(b =>
    b.status === "成立" &&
    issues.issues[b.id] &&
    !prs.prs[b.id]
  );

  console.log(`\n📊 成立法案: ${passedBills.length} 件（PR未作成）`);

  let created = 0;

  for (const bill of passedBills) {
    if (created >= maxCreate) {
      console.log(`\n⚠️ 最大作成数 (${maxCreate}) に達しました`);
      break;
    }

    const issueNumber = issues.issues[bill.id];
    console.log(`\n📜 処理中: ${bill.bill_name.slice(0, 40)}...`);
    console.log(`    Issue: #${issueNumber}`);

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));

    const result = await createEnactmentPR(octokit, owner, repo, bill, issueNumber);

    if (result) {
      prs.prs[bill.id] = {
        pr_number: result.pr_number,
        branch: result.branch,
        merged: false,
      };
      created++;

      // 定期保存
      if (created % 5 === 0) {
        saveCreatedPRs(prs);
      }
    }
  }

  // 最終保存
  saveCreatedPRs(prs);

  console.log("\n" + "=".repeat(50));
  console.log("📈 結果:");
  console.log(`  PR作成: ${created} 件`);
  console.log(`  残り: ${passedBills.length - created} 件`);
  console.log("\n✅ 完了!");
}

main().catch(console.error);
