/**
 * graph_worker.js
 * グラフ到達可能性計算ワーカー（JavaScript版・無限ホップ）
 */

process.on("message", (data) => {
  const { laws, outgoingObj, incomingObj, workerId } = data;

  const results = {};
  let processedCount = 0;

  for (const law of laws) {
    const reachableFrom = computeReachabilityInfinite(law.id, outgoingObj);
    const reachableTo = computeReachabilityInfinite(law.id, incomingObj);

    const maxHopFrom = Object.keys(reachableFrom).length > 0
      ? Math.max(...Object.values(reachableFrom))
      : 0;
    const maxHopTo = Object.keys(reachableTo).length > 0
      ? Math.max(...Object.values(reachableTo))
      : 0;

    results[law.id] = {
      title: law.title,
      reachable_from: reachableFrom,
      reachable_to: reachableTo,
      max_hop_from: maxHopFrom,
      max_hop_to: maxHopTo,
    };

    processedCount++;
    if (processedCount % 50 === 0) {
      process.send({ type: "progress", workerId, processed: processedCount, total: laws.length });
    }
  }

  process.send({ type: "result", data: results });
  process.exit(0);
});

function computeReachabilityInfinite(startId, adjacency) {
  const distances = {};
  const queue = [{ id: startId, dist: 0 }];
  const visited = new Set();
  visited.add(startId);

  while (queue.length > 0) {
    const { id, dist } = queue.shift();

    const neighbors = adjacency[id] || [];
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
