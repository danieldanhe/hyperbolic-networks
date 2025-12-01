export type Edge = { source: string; target: string };
export type EmbeddedNode = {
  id: string;
  r: number;
  theta: number;
  kappa: number;
  degree: number;
};
export type NetworkStats = {
  N: number;
  kBar: number;
  gamma: number;
  beta: number;
  clustering: number;
  R: number;
  kappa0: number;
};

export function parseCSV(csv: string): Edge[] {
  const lines = csv.trim().split("\n");
  const edges: Edge[] = [];

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",").map((s) => s.trim());
    if (parts.length < 2) continue;

    const source = parts[0];
    const target = parts[1];
    if (source && target) {
      edges.push({ source, target });
    }
  }

  return edges;
}

function buildGraph(edges: Edge[]): {
  nodes: string[];
  adjacency: Map<string, Set<string>>;
  degrees: Map<string, number>;
} {
  const adjacency = new Map<string, Set<string>>();
  const nodeSet = new Set<string>();

  for (const { source, target } of edges) {
    nodeSet.add(source);
    nodeSet.add(target);

    if (!adjacency.has(source)) adjacency.set(source, new Set());
    if (!adjacency.has(target)) adjacency.set(target, new Set());

    adjacency.get(source)!.add(target);
    adjacency.get(target)!.add(source);
  }

  const nodes = Array.from(nodeSet);
  const degrees = new Map<string, number>();

  for (const node of nodes) {
    degrees.set(node, adjacency.get(node)?.size || 0);
  }

  return { nodes, adjacency, degrees };
}

function estimateGamma(degrees: number[]): number {
  const sortedDegrees = degrees.filter((d) => d > 0).sort((a, b) => b - a);

  const tailSize = Math.floor(sortedDegrees.length * 0.2);
  const tail = sortedDegrees.slice(0, Math.max(tailSize, 10));

  const kMin = tail[tail.length - 1];
  const n = tail.length;

  const sumLogRatio = tail.reduce((sum, k) => sum + Math.log(k / kMin), 0);
  let gamma = 1 + n / sumLogRatio;

  return Math.max(2.01, Math.min(gamma, 4.0));
}

function estimateClustering(
  nodes: string[],
  adjacency: Map<string, Set<string>>
): number {
  let totalClustering = 0;
  let count = 0;

  const sampleNodes = nodes.length > 1000 ? nodes.slice(0, 1000) : nodes;

  for (const node of sampleNodes) {
    const neighbors = adjacency.get(node);
    if (!neighbors || neighbors.size < 2) continue;

    const neighborArray = Array.from(neighbors);
    let triangles = 0;
    let possibleTriangles = 0;

    for (let i = 0; i < neighborArray.length; i++) {
      for (let j = i + 1; j < neighborArray.length; j++) {
        possibleTriangles++;
        if (adjacency.get(neighborArray[i])?.has(neighborArray[j])) {
          triangles++;
        }
      }
    }

    if (possibleTriangles > 0) {
      totalClustering += triangles / possibleTriangles;
      count++;
    }
  }

  return count > 0 ? totalClustering / count : 0;
}

function estimateBeta(clustering: number): number {
  return 1.0 + 1.75 * clustering;
}

function computeKappa(
  degree: number,
  gamma: number,
  beta: number,
  kBar: number
): number {
  const kappa0 = (kBar * (gamma - 2)) / (gamma - 1);
  const kappaEstimate = degree - gamma / beta;
  return Math.max(kappa0, kappaEstimate);
}

function normalizeAngle(theta: number): number {
  let normalized = theta % (2 * Math.PI);
  if (normalized > Math.PI) {
    normalized -= 2 * Math.PI;
  } else if (normalized <= -Math.PI) {
    normalized += 2 * Math.PI;
  }
  return normalized;
}

function kappaToR(kappa: number, kappa0: number, R: number): number {
  const logTerm = Math.log(kappa / kappa0);
  return R - 2 * logTerm;
}

function computeLogLikelihoodGradientFast(
  targetIdx: number,
  theta: number,
  thetas: Float64Array,
  kappas: Float64Array,
  adjSets: Set<number>[],
  activeCount: number,
  N: number,
  kBar: number,
  beta: number
): number {
  let gradient = 0;
  const neighbors = adjSets[targetIdx];
  const kappa1 = kappas[targetIdx];
  const mu = beta / (2 * Math.PI * kBar * Math.sin(Math.PI / beta));

  const baseChiFactor = N / (2 * Math.PI * mu * kappa1);

  for (let i = 0; i < activeCount; i++) {
    if (i === targetIdx) continue;

    const theta2 = thetas[i];
    const kappa2 = kappas[i];

    const deltaThetaRaw = theta - theta2;
    const absDeltaTheta = Math.abs(deltaThetaRaw);

    const minDeltaTheta = Math.min(absDeltaTheta, 2 * Math.PI - absDeltaTheta);

    const sign =
      absDeltaTheta < Math.PI
        ? Math.sign(deltaThetaRaw)
        : -Math.sign(deltaThetaRaw);

    const chi = (N * minDeltaTheta) / (2 * Math.PI * mu * kappa1 * kappa2);

    const dChiDTheta = (sign * baseChiFactor) / kappa2;
    const chiPowBeta = Math.pow(chi, beta);

    const dPdChi =
      (-beta * Math.pow(chi, beta - 1)) / Math.pow(chiPowBeta + 1, 2);

    const p = 1 / (chiPowBeta + 1);
    const pSafe = Math.max(1e-10, Math.min(1 - 1e-10, p));

    const dLogLdP = neighbors.has(i) ? 1 / pSafe : -1 / (1 - pSafe);

    gradient += dLogLdP * dPdChi * dChiDTheta;
  }

  return gradient;
}

function computeLocalLogLikelihoodFast(
  targetIdx: number,
  theta: number,
  thetas: Float64Array,
  kappas: Float64Array,
  adjSets: Set<number>[],
  activeCount: number,
  N: number,
  kBar: number,
  beta: number
): number {
  let logL = 0;
  const neighbors = adjSets[targetIdx];
  const kappa1 = kappas[targetIdx];
  const mu = beta / (2 * Math.PI * kBar * Math.sin(Math.PI / beta));

  for (let i = 0; i < activeCount; i++) {
    if (i === targetIdx) continue;

    const theta2 = thetas[i];
    const kappa2 = kappas[i];

    const diff = Math.abs(theta - theta2);
    const minDeltaTheta = Math.min(diff, 2 * Math.PI - diff);

    const chi = (N * minDeltaTheta) / (2 * Math.PI * mu * kappa1 * kappa2);

    const chiPowBeta = Math.pow(chi, beta);
    const p = 1 / (chiPowBeta + 1);

    const pSafe = Math.max(1e-10, Math.min(1 - 1e-10, p));

    if (neighbors.has(i)) {
      logL += Math.log(pSafe);
    } else {
      logL += Math.log(1 - pSafe);
    }
  }

  return logL;
}

function optimizeThetaGradientDescentFast(
  targetIdx: number,
  thetas: Float64Array,
  kappas: Float64Array,
  adjSets: Set<number>[],
  activeCount: number,
  N: number,
  kBar: number,
  beta: number,
  maxIterations: number = 100,
  tolerance: number = 2e-4
): number {
  let theta = thetas[targetIdx];
  let learningRate = 0.1;
  let prevGradient = 0;
  let stagnantCount = 0;
  let bestTheta = theta;
  let bestLogL = -Infinity;

  for (let iter = 0; iter < maxIterations; iter++) {
    const gradient = computeLogLikelihoodGradientFast(
      targetIdx,
      theta,
      thetas,
      kappas,
      adjSets,
      activeCount,
      N,
      kBar,
      beta
    );

    if (Math.sign(gradient) !== Math.sign(prevGradient) && prevGradient !== 0) {
      learningRate *= 0.5;
    }
    learningRate = Math.max(0.001, Math.min(0.2, learningRate));

    const step = learningRate * gradient;
    const clampedStep = Math.max(-0.1, Math.min(0.1, step));
    theta += clampedStep;
    theta = normalizeAngle(theta);

    const currentLogL = computeLocalLogLikelihoodFast(
      targetIdx,
      theta,
      thetas,
      kappas,
      adjSets,
      activeCount,
      N,
      kBar,
      beta
    );
    if (currentLogL > bestLogL) {
      bestLogL = currentLogL;
      bestTheta = theta;
    }

    if (Math.abs(clampedStep) < tolerance * 0.1) {
      stagnantCount++;
      if (stagnantCount > 5) break;
    } else {
      stagnantCount = 0;
    }

    prevGradient = gradient;
    if (Math.abs(gradient) < tolerance) break;
  }

  return bestTheta;
}

function computeThetaCircularMeanFast(
  targetIdx: number,
  thetas: Float64Array,
  adjSets: Set<number>[]
): number {
  const neighbors = adjSets[targetIdx];
  if (neighbors.size === 0) {
    return normalizeAngle(Math.random() * 2 * Math.PI - Math.PI);
  }

  let sumSin = 0;
  let sumCos = 0;

  for (const neighborIdx of neighbors) {
    const neighborTheta = thetas[neighborIdx];
    sumSin += Math.sin(neighborTheta);
    sumCos += Math.cos(neighborTheta);
  }

  const meanTheta = Math.atan2(sumSin, sumCos);
  return normalizeAngle(meanTheta);
}

export async function embedNetwork(csv: string): Promise<{
  nodes: EmbeddedNode[];
  stats: NetworkStats;
  stringAdjacency: Map<string, Set<string>>;
}> {
  const edges = parseCSV(csv);
  const { nodes, adjacency: stringAdjacency, degrees } = buildGraph(edges);

  const N = nodes.length;
  const degreeValues = Array.from(degrees.values());
  const kBar = degreeValues.reduce((a, b) => a + b, 0) / N;

  const gamma = estimateGamma(degreeValues);
  const clustering = estimateClustering(nodes, stringAdjacency);
  const beta = estimateBeta(clustering);

  const kappa0 = (kBar * (gamma - 2)) / (gamma - 1);
  const mu = beta / (2 * Math.PI * kBar * Math.sin(Math.PI / beta));
  const R = 2 * Math.log(N / (Math.PI * mu * kappa0 * kappa0));

  const sortedNodes = [...nodes].sort(
    (a, b) => degrees.get(b)! - degrees.get(a)!
  );

  const nodeToIndex = new Map<string, number>();
  sortedNodes.forEach((id, index) => nodeToIndex.set(id, index));

  const thetas = new Float64Array(N);
  const kappas = new Float64Array(N);
  const adjSets: Set<number>[] = new Array(N);

  for (let i = 0; i < N; i++) {
    const nodeId = sortedNodes[i];
    const degree = degrees.get(nodeId)!;

    kappas[i] = computeKappa(degree, gamma, beta, kBar);

    const stringNeighbors = stringAdjacency.get(nodeId) || new Set();
    const intNeighbors = new Set<number>();
    for (const nStr of stringNeighbors) {
      if (nodeToIndex.has(nStr)) {
        intNeighbors.add(nodeToIndex.get(nStr)!);
      }
    }
    adjSets[i] = intNeighbors;
  }

  const phase1Count = Math.min(500, N);

  for (let i = 0; i < phase1Count; i++) {
    thetas[i] = -Math.PI + (2 * Math.PI * i) / phase1Count;
  }
  for (let i = phase1Count; i < N; i++) {
    thetas[i] = Math.random() * 2 * Math.PI - Math.PI;
  }

  const rounds = 6;
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < phase1Count; i++) {
      thetas[i] = optimizeThetaGradientDescentFast(
        i,
        thetas,
        kappas,
        adjSets,
        phase1Count,
        N,
        kBar,
        beta
      );
    }
  }

  let processed = phase1Count;

  while (processed < N) {
    const batchEnd = Math.min(processed + 100, N);

    for (let i = processed; i < batchEnd; i++) {
      thetas[i] = computeThetaCircularMeanFast(i, thetas, adjSets);
    }

    processed = batchEnd;
  }

  const result: EmbeddedNode[] = sortedNodes.map((id, index) => ({
    id: id,
    r: kappaToR(kappas[index], kappa0, R),
    theta: thetas[index],
    degree: degrees.get(id)!,
    kappa: kappas[index],
  }));

  const stats: NetworkStats = {
    N,
    kBar,
    gamma,
    beta,
    clustering,
    R,
    kappa0,
  };

  return { nodes: result, stats, stringAdjacency };
}
