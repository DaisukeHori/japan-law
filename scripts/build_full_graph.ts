/**
 * build_full_graph.ts
 * 法令間の全参照関係をグラフ化し、到達可能性を事前計算する
 * 
 * 出力:
 * - graph_nodes.json: ノード一覧
 * - graph_edges.json: エッジ一覧（直接参照）
 * - reachability.json: 各法令から到達可能な法令とホップ数
 * - important_paths.json: 重要な法令間の最短経路
 */

import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(__dirname, "..", "data");
const INDEX_DIR = path.join(DATA_DIR, "index");
const GRAPH_DIR = path.join(INDEX_DIR, "graph");

interface LawIndex {
  id: string;
  lawNum: string;
  title: string;
  category: string;
}

interface Reference {
  from_law_id: string;
  from_law_title: string;
  to_law_id: string | null;
  to_law_title: string;
}

interface GraphNode {
  id: string;
  title: string;
  category: string;
  out_degree: number;  // この法令が参照している法令数
  in_degree: number;   // この法令を参照している法令数
}

interface GraphEdge {
  from: string;
  to: string;
  count: number;
}

interface Reachability {
  [lawId: string]: {
    title: string;
    // 到達可能な法令: { 法令ID: ホップ数 }
    reachable_from: { [targetId: string]: number };  // この法令から到達可能
    reachable_to: { [sourceId: string]: number };    // この法令に到達可能
  };
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
function loadReferences(): Reference[] {
  const refPath = path.join(INDEX_DIR, "references.json");
  if (fs.existsSync(refPath)) {
    const data = JSON.parse(fs.readFileSync(refPath, "utf-8"));
    return data.references || [];
  }
  return [];
}

// グラフ構築（隣接リスト）
function buildAdjacencyList(
  references: Reference[]
): { outgoing: Map<string, Map<string, number>>; incoming: Map<string, Set<string>> } {
  // outgoing[A][B] = Aが Bを参照している回数
  const outgoing = new Map<string, Map<string, number>>();
  // incoming[B] = Bを参照している法令のSet
  const incoming = new Map<string, Set<string>>();

  for (const ref of references) {
    if (!ref.from_law_id || !ref.to_law_id) continue;

    // Outgoing
    if (!outgoing.has(ref.from_law_id)) {
      outgoing.set(ref.from_law_id, new Map());
    }
    const targets = outgoing.get(ref.from_law_id)!;
    targets.set(ref.to_law_id, (targets.get(ref.to_law_id) || 0) + 1);

    // Incoming
    if (!incoming.has(ref.to_law_id)) {
      incoming.set(ref.to_law_id, new Set());
    }
    incoming.get(ref.to_law_id)!.add(ref.from_law_id);
  }

  return { outgoing, incoming };
}

// BFSで到達可能性を計算
function computeReachability(
  startId: string,
  outgoing: Map<string, Map<string, number>>,
  maxHops: number = 100
): Map<string, number> {
  const distances = new Map<string, number>();
  const queue: { id: string; dist: number }[] = [{ id: startId, dist: 0 }];
  const visited = new Set<string>();
  visited.add(startId);

  while (queue.length > 0) {
    const { id, dist } = queue.shift()!;

    if (dist >= maxHops) continue;

    const neighbors = outgoing.get(id);
    if (!neighbors) continue;

    for (const [neighborId] of neighbors) {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        distances.set(neighborId, dist + 1);
        queue.push({ id: neighborId, dist: dist + 1 });
      }
    }
  }

  return distances;
}

// 逆方向の到達可能性（この法令に到達できる法令）
function computeReverseReachability(
  targetId: string,
  incoming: Map<string, Set<string>>,
  outgoing: Map<string, Map<string, number>>,
  maxHops: number = 100
): Map<string, number> {
  // 逆グラフでBFS
  const distances = new Map<string, number>();
  const queue: { id: string; dist: number }[] = [{ id: targetId, dist: 0 }];
  const visited = new Set<string>();
  visited.add(targetId);

  while (queue.length > 0) {
    const { id, dist } = queue.shift()!;

    if (dist >= maxHops) continue;

    const sources = incoming.get(id);
    if (!sources) continue;

    for (const sourceId of sources) {
      if (!visited.has(sourceId)) {
        visited.add(sourceId);
        distances.set(sourceId, dist + 1);
        queue.push({ id: sourceId, dist: dist + 1 });
      }
    }
  }

  return distances;
}

// 最短経路を復元（BFS）
function findShortestPath(
  fromId: string,
  toId: string,
  outgoing: Map<string, Map<string, number>>
): string[] | null {
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
}

// メイン処理
async function main(): Promise<void> {
  console.log("🔗 法令参照グラフ構築スクリプト（無限ホップ対応）");
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
  const { outgoing, incoming } = buildAdjacencyList(references);

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

  // 参照関係があるノードのみフィルタ
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

  // 到達可能性計算（重要な法令のみ詳細計算）
  console.log("\n🔄 到達可能性を計算中...");

  // 被参照数トップ100の法令を「重要な法令」とする
  const importantLaws = activeNodes
    .sort((a, b) => b.in_degree - a.in_degree)
    .slice(0, 100);

  console.log(`  重要法令: ${importantLaws.length} 件（被参照数トップ100）`);

  const reachability: Reachability = {};
  let processedCount = 0;

  for (const law of importantLaws) {
    // この法令から到達可能な法令
    const reachableFrom = computeReachability(law.id, outgoing, 50);
    // この法令に到達可能な法令
    const reachableTo = computeReverseReachability(law.id, incoming, outgoing, 50);

    reachability[law.id] = {
      title: law.title,
      reachable_from: Object.fromEntries(reachableFrom),
      reachable_to: Object.fromEntries(reachableTo),
    };

    processedCount++;
    if (processedCount % 10 === 0) {
      console.log(`  処理済: ${processedCount}/${importantLaws.length}`);
    }
  }

  fs.writeFileSync(
    path.join(GRAPH_DIR, "reachability.json"),
    JSON.stringify({ updated_at: new Date().toISOString(), data: reachability }, null, 2)
  );

  // 重要な経路を計算（憲法→主要法律など）
  console.log("\n🛤️ 重要な経路を計算中...");

  const importantPaths: { from: string; to: string; path: string[]; hops: number }[] = [];
  
  // 憲法を起点とした経路
  const constitutionId = laws.find(l => l.title === "日本国憲法")?.id;
  const majorLaws = ["民法", "刑法", "商法", "行政手続法", "会社法"];
  
  if (constitutionId) {
    for (const lawTitle of majorLaws) {
      const targetLaw = laws.find(l => l.title === lawTitle);
      if (targetLaw) {
        const pathResult = findShortestPath(constitutionId, targetLaw.id, outgoing);
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

  // 民法を起点とした経路
  const civilCodeId = laws.find(l => l.title === "民法")?.id;
  if (civilCodeId) {
    for (const lawTitle of ["会社法", "借地借家法", "消費者契約法"]) {
      const targetLaw = laws.find(l => l.title === lawTitle);
      if (targetLaw) {
        const pathResult = findShortestPath(civilCodeId, targetLaw.id, outgoing);
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

  fs.writeFileSync(
    path.join(GRAPH_DIR, "important_paths.json"),
    JSON.stringify({ updated_at: new Date().toISOString(), paths: importantPaths }, null, 2)
  );

  // 統計情報
  console.log("\n📈 グラフ統計:");
  console.log(`  総ノード数: ${activeNodes.length}`);
  console.log(`  総エッジ数: ${edges.length}`);
  console.log(`  平均出次数: ${(edges.length / activeNodes.length).toFixed(2)}`);

  // 最も参照されている法令トップ10
  console.log("\n🏆 被参照数トップ10:");
  for (const law of importantLaws.slice(0, 10)) {
    console.log(`  ${law.title}: ${law.in_degree} 法令から参照`);
  }

  // 最も多くを参照している法令トップ10
  const mostReferencing = [...activeNodes]
    .sort((a, b) => b.out_degree - a.out_degree)
    .slice(0, 10);
  console.log("\n📚 参照数トップ10:");
  for (const law of mostReferencing) {
    console.log(`  ${law.title}: ${law.out_degree} 法令を参照`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ 完了!");
  console.log(`📁 出力先: ${GRAPH_DIR}`);
}

main().catch(console.error);
