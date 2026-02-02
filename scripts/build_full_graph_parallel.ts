/**
 * build_full_graph_parallel.ts
 * 法令間の全参照関係をグラフ化し、到達可能性を事前計算する
 * マルチスレッド対応版
 */

import * as fs from "fs";
import * as path from "path";
import { Worker, isMainThread, parentPort, workerData } from "worker_threads";
import * as os from "os";

const DATA_DIR = path.join(__dirname, "..", "data");
const INDEX_DIR = path.join(DATA_DIR, "index");
const GRAPH_DIR = path.join(INDEX_DIR, "graph");

// CPUコア数（ハイパースレッディング考慮）
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

// ==================== Worker Thread Code ====================
if (!isMainThread) {
  // Worker内の処理
  const { taskType, data } = workerData;

  if (taskType === "computeReachability") {
    const { lawIds, outgoingMap, maxHops } = data;
    const results: { [lawId: string]: { [targetId: string]: number } } = {};

    for (const lawId of lawIds) {
      results[lawId] = computeReachabilityBFS(lawId, outgoingMap, maxHops);
    }

    parentPort?.postMessage(results);
  }

  if (taskType === "computeReverseReachability") {
    const { lawIds, incomingMap, maxHops } = data;
    const results: { [lawId: string]: { [sourceId: string]: number } } = {};

    for (const lawId of lawIds) {
      results[lawId] = computeReverseReachabilityBFS(lawId, incomingMap, maxHops);
    }

    parentPort?.postMessage(results);
  }

  // BFS（Worker内）
  function computeReachabilityBFS(
    startId: string,
    outgoing: { [key: string]: string[] },
    maxHops: number
  ): { [targetId: string]: number } {
    const distances: { [targetId: string]: number } = {};
    const queue: { id: string; dist: number }[] = [{ id: startId, dist: 0 }];
    const visited = new Set<string>();
    visited.add(startId);

    while (queue.length > 0) {
      const { id, dist } = queue.shift()!;
      if (dist >= maxHops) continue;

      const neighbors = outgoing[id] || [];
      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          distances[neighborId] = dist + 1;
          queue.push({ id: neighborId, dist: dist + 1 });
        }
      }
    }

    return distances;
  }

  function computeReverseReachabilityBFS(
    targetId: string,
    incoming: { [key: string]: string[] },
    maxHops: number
  ): { [sourceId: string]: number } {
    const distances: { [sourceId: string]: number } = {};
    const queue: { id: string; dist: number }[] = [{ id: targetId, dist: 0 }];
    const visited = new Set<string>();
    visited.add(targetId);

    while (queue.length > 0) {
      const { id, dist } = queue.shift()!;
      if (dist >= maxHops) continue;

      const sources = incoming[id] || [];
      for (const sourceId of sources) {
        if (!visited.has(sourceId)) {
          visited.add(sourceId);
          distances[sourceId] = dist + 1;
          queue.push({ id: sourceId, dist: dist + 1 });
        }
      }
    }

    return distances;
  }
}

// ==================== Main Thread Code ====================
if (isMainThread) {
  main().catch(console.error);
}

async function main(): Promise<void> {
  console.log("🔗 法令参照グラフ構築スクリプト（マルチスレッド版）");
  console.log(`🖥️  使用スレッド数: ${NUM_WORKERS}`);
  console.log("=".repeat(50));

  ensureDir(GRAPH_DIR);

  // データ読み込み
  const laws = loadLawIndex();
  const references = loadReferences();

  console.log(`📋 法令数: ${laws.length}`);
  console.log(`🔗 参照数: ${references.length}`);

  if (laws.length === 0 || references.length === 0) {
    console.error("❌ データがありません。先にanalyze_references.tsを実行してください。");
    return;
  }

  // 法令IDマップ
  const lawMap = new Map<string, LawIndex>();
  for (const law of laws) {
    lawMap.set(law.id, law);
  }

  // グラフ構築
  console.log("\n📊 グラフを構築中...");
  const { outgoing, incoming, outgoingSimple, incomingSimple } = buildAdjacencyList(references);

  // ノード作成
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

  // エッジ作成
  const edges: GraphEdge[] = [];
  for (const [fromId, targets] of outgoing) {
    for (const [toId, count] of targets) {
      edges.push({ from: fromId, to: toId, count });
    }
  }
  console.log(`  エッジ数: ${edges.length} 件`);

  // ノードとエッジを保存
  fs.writeFileSync(
    path.join(GRAPH_DIR, "nodes.json"),
    JSON.stringify({ updated_at: new Date().toISOString(), nodes: activeNodes }, null, 2)
  );
  fs.writeFileSync(
    path.join(GRAPH_DIR, "edges.json"),
    JSON.stringify({ updated_at: new Date().toISOString(), edges }, null, 2)
  );

  // 到達可能性計算（マルチスレッド）
  console.log("\n🔄 到達可能性を計算中（並列処理）...");

  const importantLaws = activeNodes
    .sort((a, b) => b.in_degree - a.in_degree)
    .slice(0, 100);

  console.log(`  重要法令: ${importantLaws.length} 件`);

  const startTime = Date.now();

  // 並列計算：この法令から到達可能な法令
  const reachableFromResults = await runParallelBFS(
    importantLaws.map(l => l.id),
    outgoingSimple,
    50,
    "computeReachability"
  );

  console.log(`  → 順方向計算完了: ${((Date.now() - startTime) / 1000).toFixed(1)}秒`);

  // 並列計算：この法令に到達可能な法令
  const reachableToResults = await runParallelBFS(
    importantLaws.map(l => l.id),
    incomingSimple,
    50,
    "computeReverseReachability"
  );

  console.log(`  → 逆方向計算完了: ${((Date.now() - startTime) / 1000).toFixed(1)}秒`);

  // 結果をマージ
  const reachability: {
    [lawId: string]: {
      title: string;
      reachable_from: { [targetId: string]: number };
      reachable_to: { [sourceId: string]: number };
    };
  } = {};

  for (const law of importantLaws) {
    reachability[law.id] = {
      title: law.title,
      reachable_from: reachableFromResults[law.id] || {},
      reachable_to: reachableToResults[law.id] || {},
    };
  }

  fs.writeFileSync(
    path.join(GRAPH_DIR, "reachability.json"),
    JSON.stringify({ updated_at: new Date().toISOString(), data: reachability }, null, 2)
  );

  // 重要な経路を計算
  console.log("\n🛤️ 重要な経路を計算中...");
  const importantPaths = computeImportantPaths(laws, outgoing, lawMap);

  fs.writeFileSync(
    path.join(GRAPH_DIR, "important_paths.json"),
    JSON.stringify({ updated_at: new Date().toISOString(), paths: importantPaths }, null, 2)
  );

  // 統計情報
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("\n📈 グラフ統計:");
  console.log(`  総ノード数: ${activeNodes.length}`);
  console.log(`  総エッジ数: ${edges.length}`);
  console.log(`  処理時間: ${totalTime}秒`);

  console.log("\n🏆 被参照数トップ10:");
  for (const law of importantLaws.slice(0, 10)) {
    console.log(`  ${law.title}: ${law.in_degree} 法令から参照`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ 完了!");
  console.log(`📁 出力先: ${GRAPH_DIR}`);
}

// 並列BFS実行
async function runParallelBFS(
  lawIds: string[],
  adjacencyMap: { [key: string]: string[] },
  maxHops: number,
  taskType: string
): Promise<{ [lawId: string]: { [targetId: string]: number } }> {
  const chunkSize = Math.ceil(lawIds.length / NUM_WORKERS);
  const chunks: string[][] = [];

  for (let i = 0; i < lawIds.length; i += chunkSize) {
    chunks.push(lawIds.slice(i, i + chunkSize));
  }

  const promises = chunks.map((chunk, index) => {
    return new Promise<{ [lawId: string]: { [targetId: string]: number } }>((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: {
          taskType,
          data: {
            lawIds: chunk,
            [taskType === "computeReachability" ? "outgoingMap" : "incomingMap"]: adjacencyMap,
            maxHops,
          },
        },
      });

      worker.on("message", resolve);
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`Worker ${index} exited with code ${code}`));
        }
      });
    });
  });

  const results = await Promise.all(promises);

  // 結果をマージ
  const merged: { [lawId: string]: { [targetId: string]: number } } = {};
  for (const result of results) {
    Object.assign(merged, result);
  }

  return merged;
}

// ディレクトリ作成
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 法令インデックス読み込み
function loadLawIndex(): LawIndex[] {
  const indexPath = path.join(INDEX_DIR, "laws.json");
  if (fs.existsSync(indexPath)) {
    const data = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    return data.laws || [];
  }
  return [];
}

// 参照データ読み込み
function loadReferences(): { from_law_id: string; to_law_id: string | null }[] {
  const refPath = path.join(INDEX_DIR, "references.json");
  if (fs.existsSync(refPath)) {
    const data = JSON.parse(fs.readFileSync(refPath, "utf-8"));
    return data.references || [];
  }
  return [];
}

// グラフ構築
function buildAdjacencyList(references: { from_law_id: string; to_law_id: string | null }[]): {
  outgoing: Map<string, Map<string, number>>;
  incoming: Map<string, Set<string>>;
  outgoingSimple: { [key: string]: string[] };
  incomingSimple: { [key: string]: string[] };
} {
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

  // Worker用にシンプルなオブジェクト形式に変換
  const outgoingSimple: { [key: string]: string[] } = {};
  const incomingSimple: { [key: string]: string[] } = {};

  for (const [key, value] of outgoing) {
    outgoingSimple[key] = Array.from(value.keys());
  }

  for (const [key, value] of incoming) {
    incomingSimple[key] = Array.from(value);
  }

  return { outgoing, incoming, outgoingSimple, incomingSimple };
}

// 重要な経路を計算
function computeImportantPaths(
  laws: LawIndex[],
  outgoing: Map<string, Map<string, number>>,
  lawMap: Map<string, LawIndex>
): { from: string; to: string; path: string[]; hops: number }[] {
  const importantPaths: { from: string; to: string; path: string[]; hops: number }[] = [];

  const findPath = (fromId: string, toId: string): string[] | null => {
    if (fromId === toId) return [fromId];

    const queue: { id: string; path: string[] }[] = [{ id: fromId, path: [fromId] }];
    const visited = new Set<string>();
    visited.add(fromId);

    while (queue.length > 0) {
      const { id, path } = queue.shift()!;
      const neighbors = outgoing.get(id);
      if (!neighbors) continue;

      for (const [neighborId] of neighbors) {
        if (neighborId === toId) {
          return [...path, neighborId];
        }
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push({ id: neighborId, path: [...path, neighborId] });
        }
      }
    }
    return null;
  };

  const constitutionId = laws.find(l => l.title === "日本国憲法")?.id;
  const civilCodeId = laws.find(l => l.title === "民法")?.id;

  const targetLaws = ["民法", "刑法", "商法", "行政手続法", "会社法", "借地借家法", "消費者契約法"];

  if (constitutionId) {
    for (const lawTitle of targetLaws) {
      const targetLaw = laws.find(l => l.title === lawTitle);
      if (targetLaw) {
        const pathResult = findPath(constitutionId, targetLaw.id);
        if (pathResult) {
          importantPaths.push({
            from: "日本国憲法",
            to: lawTitle,
            path: pathResult.map(id => lawMap.get(id)?.title || id),
            hops: pathResult.length - 1,
          });
        }
      }
    }
  }

  if (civilCodeId) {
    for (const lawTitle of ["会社法", "借地借家法", "消費者契約法", "金融商品取引法"]) {
      const targetLaw = laws.find(l => l.title === lawTitle);
      if (targetLaw && targetLaw.id !== civilCodeId) {
        const pathResult = findPath(civilCodeId, targetLaw.id);
        if (pathResult) {
          importantPaths.push({
            from: "民法",
            to: lawTitle,
            path: pathResult.map(id => lawMap.get(id)?.title || id),
            hops: pathResult.length - 1,
          });
        }
      }
    }
  }

  return importantPaths;
}
