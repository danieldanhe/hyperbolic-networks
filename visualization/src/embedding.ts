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
    const [source, target] = lines[i].split(",").map((s) => s.trim());
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

  return Math.max(1.5, Math.min(gamma, 4.0));
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

function angularDistance(theta1: number, theta2: number): number {
  const diff = Math.abs(theta1 - theta2);
  return Math.min(diff, 2 * Math.PI - diff);
}

function computeChiLogSpace(
  theta1: number,
  theta2: number,
  kappa1: number,
  kappa2: number,
  N: number,
  kBar: number,
  beta: number
): number {
  const deltaTheta = angularDistance(theta1, theta2);
  const mu = beta / (2 * Math.PI * kBar * Math.sin(Math.PI / beta));

  const logChi =
    Math.log(N) +
    Math.log(deltaTheta) -
    Math.log(2 * Math.PI * mu) -
    Math.log(kappa1) -
    Math.log(kappa2);
  return Math.exp(logChi);
}

function connectionProbabilityLogSpace(chi: number, beta: number): number {
  const logChi = Math.log(chi);
  const chiPowBeta = Math.exp(beta * logChi);
  return 1 / (chiPowBeta + 1);
}

function computeLocalLogLikelihood(
  nodeId: string,
  theta: number,
  thetas: Map<string, number>,
  kappas: Map<string, number>,
  adjacency: Map<string, Set<string>>,
  allNodes: string[],
  N: number,
  kBar: number,
  beta: number
): number {
  let logL = 0;
  const neighbors = adjacency.get(nodeId) || new Set();
  const kappa1 = kappas.get(nodeId)!;

  for (const otherNode of allNodes) {
    if (otherNode === nodeId) continue;

    const theta2 = thetas.get(otherNode);
    if (theta2 === undefined) continue;

    const kappa2 = kappas.get(otherNode)!;
    const chi = computeChiLogSpace(
      theta,
      theta2,
      kappa1,
      kappa2,
      N,
      kBar,
      beta
    );
    const p = connectionProbabilityLogSpace(chi, beta);

    const pSafe = Math.max(1e-10, Math.min(1 - 1e-10, p));

    if (neighbors.has(otherNode)) {
      logL += Math.log(pSafe);
    } else {
      logL += Math.log(1 - pSafe);
    }
  }

  return logL;
}

function computeLogLikelihoodGradient(
  nodeId: string,
  theta: number,
  thetas: Map<string, number>,
  kappas: Map<string, number>,
  adjacency: Map<string, Set<string>>,
  allNodes: string[],
  N: number,
  kBar: number,
  beta: number
): number {
  let gradient = 0;
  const neighbors = adjacency.get(nodeId) || new Set();
  const kappa1 = kappas.get(nodeId)!;
  const mu = beta / (2 * Math.PI * kBar * Math.sin(Math.PI / beta));

  for (const otherNode of allNodes) {
    if (otherNode === nodeId) continue;

    const theta2 = thetas.get(otherNode);
    if (theta2 === undefined) continue;

    const kappa2 = kappas.get(otherNode)!;

    const deltaTheta = theta - theta2;
    const absDeltaTheta = Math.abs(deltaTheta);

    const sign =
      absDeltaTheta < Math.PI ? Math.sign(deltaTheta) : -Math.sign(deltaTheta);

    const dChiDTheta = (sign * N) / (2 * Math.PI * mu * kappa1 * kappa2);

    const chi = computeChiLogSpace(
      theta,
      theta2,
      kappa1,
      kappa2,
      N,
      kBar,
      beta
    );
    const p = connectionProbabilityLogSpace(chi, beta);

    const chiPowBeta = Math.pow(chi, beta);
    const dPdChi =
      (-beta * Math.pow(chi, beta - 1)) / Math.pow(chiPowBeta + 1, 2);

    const pSafe = Math.max(1e-10, Math.min(1 - 1e-10, p));
    const dLogLdP = neighbors.has(otherNode) ? 1 / pSafe : -1 / (1 - pSafe);

    gradient += dLogLdP * dPdChi * dChiDTheta;
  }

  return gradient;
}

function optimizeThetaGradientDescent(
  nodeId: string,
  thetas: Map<string, number>,
  kappas: Map<string, number>,
  adjacency: Map<string, Set<string>>,
  allNodes: string[],
  N: number,
  kBar: number,
  beta: number,
  maxIterations: number = 100,
  tolerance: number = 1e-4
): number {
  let theta = thetas.get(nodeId) || 0;
  let learningRate = 0.1;
  let prevGradient = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    const gradient = computeLogLikelihoodGradient(
      nodeId,
      theta,
      thetas,
      kappas,
      adjacency,
      allNodes,
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

    prevGradient = gradient;

    if (Math.abs(gradient) < tolerance) {
      break;
    }
  }

  let thetaAlt = normalizeAngle(theta + Math.PI);
  let learningRateAlt = 0.1;
  let prevGradientAlt = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    const gradient = computeLogLikelihoodGradient(
      nodeId,
      thetaAlt,
      thetas,
      kappas,
      adjacency,
      allNodes,
      N,
      kBar,
      beta
    );

    if (
      Math.sign(gradient) !== Math.sign(prevGradientAlt) &&
      prevGradientAlt !== 0
    ) {
      learningRateAlt *= 0.5;
    }
    learningRateAlt = Math.max(0.001, Math.min(0.2, learningRateAlt));

    const step = learningRateAlt * gradient;
    const clampedStep = Math.max(-0.1, Math.min(0.1, step));
    thetaAlt += clampedStep;
    thetaAlt = normalizeAngle(thetaAlt);

    prevGradientAlt = gradient;

    if (Math.abs(gradient) < tolerance) {
      break;
    }
  }

  const logL1 = computeLocalLogLikelihood(
    nodeId,
    theta,
    thetas,
    kappas,
    adjacency,
    allNodes,
    N,
    kBar,
    beta
  );
  const logL2 = computeLocalLogLikelihood(
    nodeId,
    thetaAlt,
    thetas,
    kappas,
    adjacency,
    allNodes,
    N,
    kBar,
    beta
  );

  return logL1 > logL2 ? theta : thetaAlt;
}

function computeThetaCircularMean(
  nodeId: string,
  thetas: Map<string, number>,
  adjacency: Map<string, Set<string>>
): number {
  const neighbors = adjacency.get(nodeId);
  if (!neighbors || neighbors.size === 0) {
    return normalizeAngle(Math.random() * 2 * Math.PI - Math.PI);
  }

  let sumSin = 0;
  let sumCos = 0;
  let count = 0;

  for (const neighbor of neighbors) {
    const neighborTheta = thetas.get(neighbor);
    if (neighborTheta !== undefined) {
      sumSin += Math.sin(neighborTheta);
      sumCos += Math.cos(neighborTheta);
      count++;
    }
  }

  const meanTheta = Math.atan2(sumSin, sumCos);
  return normalizeAngle(meanTheta);
}

function kappaToR(kappa: number, kappa0: number, R: number): number {
  return R - 2 * Math.log(kappa / kappa0);
}

export async function embedNetwork(
  csv: string
): Promise<{ nodes: EmbeddedNode[]; stats: NetworkStats }> {
  const edges = parseCSV(csv);

  const { nodes, adjacency, degrees } = buildGraph(edges);

  const N = nodes.length;
  const degreeValues = Array.from(degrees.values());
  const kBar = degreeValues.reduce((a, b) => a + b, 0) / N;

  const gamma = estimateGamma(degreeValues);
  const clustering = estimateClustering(nodes, adjacency);
  const beta = estimateBeta(clustering);

  const kappa0 = (kBar * (gamma - 2)) / (gamma - 1);
  const mu = beta / (2 * Math.PI * kBar * Math.sin(Math.PI / beta));
  const R = 2 * Math.log(N / (Math.PI * mu * kappa0 * kappa0));

  const kappas = new Map<string, number>();
  for (const node of nodes) {
    const degree = degrees.get(node)!;
    const kappa = computeKappa(degree, gamma, beta, kBar);
    kappas.set(node, kappa);
  }

  const sortedNodes = [...nodes].sort(
    (a, b) => degrees.get(b)! - degrees.get(a)!
  );
  const thetas = new Map<string, number>();

  const phase1Count = Math.min(100, N);

  for (let i = 0; i < phase1Count; i++) {
    const angle = -Math.PI + (2 * Math.PI * i) / phase1Count;
    thetas.set(sortedNodes[i], angle);
  }

  const rounds = 6;
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < phase1Count; i++) {
      const node = sortedNodes[i];
      thetas.set(
        node,
        optimizeThetaGradientDescent(
          node,
          thetas,
          kappas,
          adjacency,
          sortedNodes.slice(0, phase1Count),
          N,
          kBar,
          beta
        )
      );
    }
  }

  let processed = phase1Count;

  while (processed < N) {
    const batchEnd = Math.min(processed + 20, N);
    const batchNodes = sortedNodes.slice(processed, batchEnd);

    for (const node of batchNodes) {
      thetas.set(node, computeThetaCircularMean(node, thetas, adjacency));
    }

    processed = batchEnd;
  }

  const result: EmbeddedNode[] = nodes.map((node) => ({
    id: node,
    r: kappaToR(kappas.get(node)!, kappa0, R),
    theta: thetas.get(node)!,
    degree: degrees.get(node)!,
    kappa: kappas.get(node)!,
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

  return { nodes: result, stats };
}
