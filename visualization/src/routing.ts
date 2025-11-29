import { type EmbeddedNode } from "./embedding";

export type RoutingResult = {
  success: boolean;
  path: EmbeddedNode[];
  forwardPath: EmbeddedNode[];
  backwardPath: EmbeddedNode[];
  meetingNode: EmbeddedNode | null;
  distance: number;
  stretch: number;
  pathLength: number;
};

function hyperbolicDistance(node1: EmbeddedNode, node2: EmbeddedNode): number {
  const deltaTheta = Math.abs(node1.theta - node2.theta);
  const minDeltaTheta = Math.min(deltaTheta, 2 * Math.PI - deltaTheta);

  const coshTerm = Math.cosh(node1.r) * Math.cosh(node2.r);
  const sinhTerm =
    Math.sinh(node1.r) * Math.sinh(node2.r) * Math.cos(minDeltaTheta);

  const arg = coshTerm - sinhTerm;
  return Math.acosh(Math.max(1, arg));
}

function findClosestNeighbour(
  _currentNode: EmbeddedNode,
  targetNode: EmbeddedNode,
  neighbours: EmbeddedNode[],
  visited: Set<string>,
  previousNode: EmbeddedNode | null
): EmbeddedNode | null {
  let bestNode: EmbeddedNode | null = null;
  let bestDistance = Infinity;

  for (const neighbour of neighbours) {
    if (
      visited.has(neighbour.id) ||
      (previousNode && neighbour.id === previousNode.id)
    ) {
      continue;
    }

    const dist = hyperbolicDistance(neighbour, targetNode);

    if (dist < bestDistance) {
      bestDistance = dist;
      bestNode = neighbour;
    }
  }

  return bestNode;
}

export function greedyRouting(
  startNode: EmbeddedNode,
  endNode: EmbeddedNode,
  adjacency: Map<string, Set<string>>,
  nodeMap: Map<string, EmbeddedNode>
): EmbeddedNode[] | null {
  if (startNode.id === endNode.id) {
    return [startNode];
  }

  const path: EmbeddedNode[] = [startNode];
  const visited = new Set<string>([startNode.id]);
  let currentNode = startNode;
  let previousNode: EmbeddedNode | null = null;

  while (true) {
    const neighbourIds = adjacency.get(currentNode.id);
    if (!neighbourIds) break;

    const neighbours = Array.from(neighbourIds)
      .map((id) => nodeMap.get(id))
      .filter((n): n is EmbeddedNode => n !== undefined);

    const nextNode = findClosestNeighbour(
      currentNode,
      endNode,
      neighbours,
      visited,
      previousNode
    );

    if (!nextNode) {
      return null;
    }

    path.push(nextNode);
    visited.add(nextNode.id);
    previousNode = currentNode;

    if (nextNode.id === endNode.id) {
      return path;
    }

    currentNode = nextNode;
  }

  return null;
}

export function bidirectionalGreedyRouting(
  startNode: EmbeddedNode,
  endNode: EmbeddedNode,
  adjacency: Map<string, Set<string>>,
  nodeMap: Map<string, EmbeddedNode>
): RoutingResult {
  if (startNode.id === endNode.id) {
    return {
      success: true,
      path: [startNode],
      forwardPath: [startNode],
      backwardPath: [],
      meetingNode: startNode,
      distance: 0,
      stretch: 1,
      pathLength: 0,
    };
  }

  const forwardPath: EmbeddedNode[] = [startNode];
  const backwardPath: EmbeddedNode[] = [endNode];

  const forwardVisited = new Set<string>([startNode.id]);
  const backwardVisited = new Set<string>([endNode.id]);

  let forwardCurrent = startNode;
  let backwardCurrent = endNode;
  let forwardPrevious: EmbeddedNode | null = null;
  let backwardPrevious: EmbeddedNode | null = null;

  while (true) {
    let forwardMoved = false;
    const forwardNeighbourIds = adjacency.get(forwardCurrent.id);
    if (forwardNeighbourIds) {
      const forwardNeighbours = Array.from(forwardNeighbourIds)
        .map((id) => nodeMap.get(id))
        .filter((n): n is EmbeddedNode => n !== undefined);

      const forwardNext = findClosestNeighbour(
        forwardCurrent,
        endNode,
        forwardNeighbours,
        forwardVisited,
        forwardPrevious
      );

      if (forwardNext) {
        forwardPath.push(forwardNext);
        forwardVisited.add(forwardNext.id);

        if (backwardVisited.has(forwardNext.id)) {
          const meetingIndex = backwardPath.findIndex(
            (node) => node.id === forwardNext.id
          );
          const fullPath = [
            ...forwardPath,
            ...backwardPath.slice(0, meetingIndex).reverse(),
          ];

          const directDistance = hyperbolicDistance(startNode, endNode);

          let pathDistance = 0;
          for (let i = 0; i < fullPath.length - 1; i++) {
            pathDistance += hyperbolicDistance(fullPath[i], fullPath[i + 1]);
          }

          return {
            success: true,
            path: fullPath,
            forwardPath: forwardPath,
            backwardPath: backwardPath.slice(0, meetingIndex + 1),
            meetingNode: forwardNext,
            distance: pathDistance,
            stretch: pathDistance / directDistance,
            pathLength: fullPath.length - 1,
          };
        }

        forwardPrevious = forwardCurrent;
        forwardCurrent = forwardNext;
        forwardMoved = true;

        if (forwardNext.id === endNode.id) {
          const directDistance = hyperbolicDistance(startNode, endNode);

          let pathDistance = 0;
          for (let i = 0; i < forwardPath.length - 1; i++) {
            pathDistance += hyperbolicDistance(
              forwardPath[i],
              forwardPath[i + 1]
            );
          }

          return {
            success: true,
            path: forwardPath,
            forwardPath: forwardPath,
            backwardPath: [],
            meetingNode: endNode,
            distance: pathDistance,
            stretch: pathDistance / directDistance,
            pathLength: forwardPath.length - 1,
          };
        }
      }
    }

    let backwardMoved = false;
    const backwardNeighbourIds = adjacency.get(backwardCurrent.id);
    if (backwardNeighbourIds) {
      const backwardNeighbours = Array.from(backwardNeighbourIds)
        .map((id) => nodeMap.get(id))
        .filter((n): n is EmbeddedNode => n !== undefined);

      const backwardNext = findClosestNeighbour(
        backwardCurrent,
        startNode,
        backwardNeighbours,
        backwardVisited,
        backwardPrevious
      );

      if (backwardNext) {
        backwardPath.push(backwardNext);
        backwardVisited.add(backwardNext.id);

        if (forwardVisited.has(backwardNext.id)) {
          const meetingIndex = forwardPath.findIndex(
            (node) => node.id === backwardNext.id
          );
          const fullPath = [
            ...forwardPath.slice(0, meetingIndex + 1),
            ...backwardPath.slice(0, -1).reverse(),
          ];

          const directDistance = hyperbolicDistance(startNode, endNode);

          let pathDistance = 0;
          for (let i = 0; i < fullPath.length - 1; i++) {
            pathDistance += hyperbolicDistance(fullPath[i], fullPath[i + 1]);
          }

          return {
            success: true,
            path: fullPath,
            forwardPath: forwardPath.slice(0, meetingIndex + 1),
            backwardPath: backwardPath,
            meetingNode: backwardNext,
            distance: pathDistance,
            stretch: pathDistance / directDistance,
            pathLength: fullPath.length - 1,
          };
        }

        backwardPrevious = backwardCurrent;
        backwardCurrent = backwardNext;
        backwardMoved = true;

        if (backwardNext.id === startNode.id) {
          const fullPath = [...forwardPath, ...backwardPath.slice(1).reverse()];

          const directDistance = hyperbolicDistance(startNode, endNode);

          let pathDistance = 0;
          for (let i = 0; i < fullPath.length - 1; i++) {
            pathDistance += hyperbolicDistance(fullPath[i], fullPath[i + 1]);
          }

          return {
            success: true,
            path: fullPath,
            forwardPath: forwardPath,
            backwardPath: backwardPath,
            meetingNode: startNode,
            distance: pathDistance,
            stretch: pathDistance / directDistance,
            pathLength: fullPath.length - 1,
          };
        }
      }
    }

    if (!forwardMoved && !backwardMoved) {
      return {
        success: false,
        path: [],
        forwardPath: forwardPath,
        backwardPath: backwardPath,
        meetingNode: null,
        distance: Infinity,
        stretch: Infinity,
        pathLength: 0,
      };
    }
  }
}
