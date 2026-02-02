/**
 * graph_worker.ts
 * グラフ到達可能性計算ワーカー
 */

interface GraphNode {
  id: string;
  title: string;
  category: string;
  out_degree: number;
  in_degree: number;
}

// 親プロセスからのメッセージを受信
process.on("message", (data: {
  laws: GraphNode[];
  outgoingObj: { [key: string]: string[] };
  incomingObj: { [key: string]: string[] };
  maxHops: number;
  workerId: number;
}) => {
  const { laws, outgoingObj, incomingObj, maxHops, workerId } = data;

  const results: {
    [lawId: string]: {
      title: string;
      reachable_from: { [targetId: string]: number };
      reachable_to: { [sourceId: string]: number };
    };
  } = {};

  let processedCount = 0;

  for (const law of laws) {
    // この法令から到達可能な法令
    const reachableFrom = computeReachability(law.id, outgoingObj, maxHops);
    // この法令に到達可能な法令
    const reachableTo = computeReverseReachability(law.id, incomingObj, maxHops);

    results[law.id] = {
      title: law.title,
      reachable_from: reachableFrom,
      reachable_to: reachableTo,
    };

    processedCount++;
    if (processedCount % 10 === 0) {
      process.send!({ type: "progress", workerId, processed: processedCount });
    }
  }

  // 結果を親プロセスに送信
  process.send!({ type: "result", data: results });
  process.exit(0);
});

function computeReachability(
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

function computeReverseReachability(
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
