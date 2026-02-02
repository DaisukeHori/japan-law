/**
 * build_graph_multi.ts
 * 法令参照グラフを構築（マルチプロセス・無限ホップ対応）
 */

import * as fs from "fs";
import * as path from "path";
import { fork } from "child_process";
import * as os from "os";

const DATA_DIR = path.join(__dirname, "..", "data");
const INDEX_DIR = path.join(DATA_DIR, "index");
const GRAPH_DIR = path.join(INDEX_DIR, "graph");

const NUM_WORKERS = Math.max(1, os.cpus().length - 1);

interface LawIndex {
  id: string;
  lawNum: string;
  title: string;
  category: string;
}

interface GraphNode {
  id: string;
  title: string;
  category: string;
  out_degree: number;
  in_degree: number;
}

interface GraphEdge {
  from: string;
  to: string;
  count: number;
}

async function main(): Promise<void> {
  console.log("🔗 法令参照グラフ構築スクリプト（マルチプロセス・無限ホップ）");
  console.log(`🖥️  使用プロセス数: ${NUM_WORKERS}`);
  console.log("=".repeat(50));

  const startTime = Date.now();
  ensureDir(GRAPH_DIR);

  const laws = loadLawIndex();
  const references = loadReferences();

  console.log(`📋 法令数: ${laws.length}`);
  console.log(`🔗 参照数: ${references.length}`);

  if (laws.length === 0 || references.length === 0) {
    console.error("❌ データがありません");
    return;
  }

  const lawMap = new Map<string, LawIndex>();
  for (const law of laws) {
    lawMap.set(law.id, law);
  }

  console.log("\n📊 グラフを構築中...");
  const { outgoing, incoming, outgoingObj, incomingObj } = buildAdjacencyList(references);

  const nodes: GraphNode[] = [];
  for (const law of laws) {
    nodes.push({
      id: law.id,
      title: law.title,
      category: law.category,
      out_degree: outgoing.get(law.id)?.size || 0,
      in_degree: incoming.get(law.id)?.size || 0,
    });
  }

  const activeNodes = nodes.filter(n => n.out_degree > 0 || n.in_degree > 0);
  console.log(`  アクティブノード: ${activeNodes.length} 件`);

  const edges: GraphEdge[] = [];
  for (const [fromId, targets] of outgoing) {
    for (const [toId, count] of targets) {
      edges.push({ from: fromId, to: toId, count });
    }
  }
  console.log(`  エッジ数: ${edges.length} 件`);

  fs.writeFileSync(
    path.join(GRAPH_DIR, "nodes.json"),
    JSON.stringify({ updated_at: new Date().toISOString(), nodes: activeNodes }, null, 2)
  );
  fs.writeFileSync(
    path.join(GRAPH_DIR, "edges.json"),
    JSON.stringify({ updated_at: new Date().toISOString(), edges }, null, 2)
  );

  console.log("\n🔄 全法令の到達可能性を計算中（無限ホップ）...");
  console.log(`  対象: ${activeNodes.length} 法令`);

  const chunkSize = Math.ceil(activeNodes.length / NUM_WORKERS);
  const chunks: GraphNode[][] = [];
  for (let i = 0; i < activeNodes.length; i += chunkSize) {
    chunks.push(activeNodes.slice(i, i + chunkSize));
  }

  // JavaScript版ワーカーを使用
  const workerScript = path.join(__dirname, "graph_worker.js");

  const promises = chunks.map((chunk, index) => {
    return runWorker(workerScript, {
      laws: chunk,
      outgoingObj,
      incomingObj,
      workerId: index + 1,
    });
  });

  const results = await Promise.all(promises);

  const reachability: any = {};
  for (const result of results) {
    Object.assign(reachability, result);
  }

  let totalReachablePairs = 0;
  let maxHop = 0;
  for (const lawId of Object.keys(reachability)) {
    const data = reachability[lawId];
    totalReachablePairs += Object.keys(data.reachable_from).length;
    totalReachablePairs += Object.keys(data.reachable_to).length;
    maxHop = Math.max(maxHop, data.max_hop_from, data.max_hop_to);
  }

  console.log(`\n📈 到達可能性統計:`);
  console.log(`  到達可能ペア数: ${totalReachablePairs.toLocaleString()}`);
  console.log(`  最大ホップ数: ${maxHop}`);

  fs.writeFileSync(
    path.join(GRAPH_DIR, "reachability.json"),
    JSON.stringify({
      updated_at: new Date().toISOString(),
      stats: {
        total_nodes: activeNodes.length,
        total_edges: edges.length,
        total_reachable_pairs: totalReachablePairs,
        max_hop: maxHop,
      },
      data: reachability
    }, null, 2)
  );

  console.log("\n🛤️ 重要な経路を計算中...");
  const importantPaths = computeImportantPaths(laws, outgoing, lawMap);

  fs.writeFileSync(
    path.join(GRAPH_DIR, "important_paths.json"),
    JSON.stringify({ updated_at: new Date().toISOString(), paths: importantPaths }, null, 2)
  );

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n📈 グラフ統計:");
  console.log(`  総ノード数: ${activeNodes.length}`);
  console.log(`  総エッジ数: ${edges.length}`);
  console.log(`  処理時間: ${totalTime}秒`);

  const sortedByInDegree = [...activeNodes].sort((a, b) => b.in_degree - a.in_degree);
  console.log("\n🏆 被参照数トップ10:");
  for (const law of sortedByInDegree.slice(0, 10)) {
    console.log(`  ${law.title}: ${law.in_degree} 法令から参照`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ 完了!");
}

function runWorker(script: string, data: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = fork(script, [], {
      stdio: ["pipe", "pipe", "inherit", "ipc"],
    });

    let result: any = {};

    child.on("message", (msg: any) => {
      if (msg.type === "progress") {
        console.log(`  Worker ${msg.workerId}: ${msg.processed}/${msg.total} 完了`);
      } else if (msg.type === "result") {
        result = msg.data;
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

function loadReferences(): { from_law_id: string; to_law_id: string | null }[] {
  const refPath = path.join(INDEX_DIR, "references.json");
  if (fs.existsSync(refPath)) {
    const data = JSON.parse(fs.readFileSync(refPath, "utf-8"));
    return data.references || [];
  }
  return [];
}

function buildAdjacencyList(references: { from_law_id: string; to_law_id: string | null }[]) {
  const outgoing = new Map<string, Map<string, number>>();
  const incoming = new Map<string, Set<string>>();

  for (const ref of references) {
    if (!ref.from_law_id || !ref.to_law_id) continue;

    if (!outgoing.has(ref.from_law_id)) {
      outgoing.set(ref.from_law_id, new Map());
    }
    const targets = outgoing.get(ref.from_law_id)!;
    targets.set(ref.to_law_id, (targets.get(ref.to_law_id) || 0) + 1);

    if (!incoming.has(ref.to_law_id)) {
      incoming.set(ref.to_law_id, new Set());
    }
    incoming.get(ref.to_law_id)!.add(ref.from_law_id);
  }

  const outgoingObj: { [key: string]: string[] } = {};
  const incomingObj: { [key: string]: string[] } = {};

  for (const [key, value] of outgoing) {
    outgoingObj[key] = Array.from(value.keys());
  }
  for (const [key, value] of incoming) {
    incomingObj[key] = Array.from(value);
  }

  return { outgoing, incoming, outgoingObj, incomingObj };
}

function computeImportantPaths(
  laws: LawIndex[],
  outgoing: Map<string, Map<string, number>>,
  lawMap: Map<string, LawIndex>
): any[] {
  const paths: any[] = [];

  const findPath = (fromId: string, toId: string): string[] | null => {
    if (fromId === toId) return [fromId];
    const queue: { id: string; path: string[] }[] = [{ id: fromId, path: [fromId] }];
    const visited = new Set<string>([fromId]);

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;
      const neighbors = outgoing.get(id);
      if (!neighbors) continue;

      for (const [neighborId] of neighbors) {
        if (neighborId === toId) return [...path, neighborId];
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push({ id: neighborId, path: [...path, neighborId] });
        }
      }
    }
    return null;
  };

  const targetLaws = ["民法", "刑法", "商法", "行政手続法", "会社法", "労働基準法"];
  const constitutionId = laws.find(l => l.title === "日本国憲法")?.id;

  if (constitutionId) {
    for (const title of targetLaws) {
      const target = laws.find(l => l.title === title);
      if (target) {
        const result = findPath(constitutionId, target.id);
        if (result) {
          paths.push({
            from: "日本国憲法",
            to: title,
            path: result.map(id => lawMap.get(id)?.title || id),
            hops: result.length - 1,
          });
        }
      }
    }
  }

  return paths;
}

main().catch(console.error);
