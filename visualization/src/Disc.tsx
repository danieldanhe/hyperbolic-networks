import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { Line, Text } from "@react-three/drei";

import { type Edge, type EmbeddedNode } from "./embedding";
import { type RoutingResult } from "./routing";

function euclideanToHyperbolic(
  x: number,
  y: number
): { r: number; theta: number } {
  const rEuclidean = Math.sqrt(x * x + y * y);
  const rHyperbolic = 2 * Math.atanh(rEuclidean);
  const theta = Math.atan2(y, x);
  return { r: rHyperbolic, theta };
}

function moebiusTranslate(
  zx: number,
  zy: number,
  cx: number,
  cy: number
): { x: number; y: number } {
  const numX = zx - cx;
  const numY = zy - cy;

  const denReal = 1 - (zx * cx + zy * cy);
  const denImag = -(zy * cx - zx * cy);

  const denNorm = denReal * denReal + denImag * denImag;

  return {
    x: (numX * denReal + numY * denImag) / denNorm,
    y: (numY * denReal - numX * denImag) / denNorm,
  };
}

function projectToDisc(
  r: number,
  theta: number,
  panR: number = 0,
  panTheta: number = 0,
  zoom: number = 1
): { x: number; y: number } {
  const effectiveR = Math.tanh((r * zoom) / 2);
  const zx = effectiveR * Math.cos(theta);
  const zy = effectiveR * Math.sin(theta);

  const panREuclidean = Math.tanh(panR / 2);
  const cx = panREuclidean * Math.cos(panTheta);
  const cy = panREuclidean * Math.sin(panTheta);

  return moebiusTranslate(zx, zy, cx, cy);
}

function generateGeodesicPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  segments: number = 20
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];

  const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  if (dist < 0.1) {
    points.push(new THREE.Vector3(x1, y1, 0));
    points.push(new THREE.Vector3(x2, y2, 0));
    return points;
  }

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const midR = Math.sqrt(midX ** 2 + midY ** 2);

  const pushFactor = 0.3 * dist;
  const controlX = midX * (1 - pushFactor / (midR + 0.01));
  const controlY = midY * (1 - pushFactor / (midR + 0.01));

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const s = 1 - t;
    const x = s * s * x1 + 2 * s * t * controlX + t * t * x2;
    const y = s * s * y1 + 2 * s * t * controlY + t * t * y2;
    points.push(new THREE.Vector3(x, y, 0));
  }

  return points;
}

let minimumDegree = 1;
let maximumDegree = 10;

const Node = ({
  node,
  position,
  isSelected,
  isHovered,
  isOnPath,
  isMeetingPoint,
  isRouteEndpoint,
  onSelect,
  onHover,
}: {
  node: EmbeddedNode;
  position: { x: number; y: number };
  isSelected: boolean;
  isHovered: boolean;
  isOnPath: boolean;
  isMeetingPoint: boolean;
  isRouteEndpoint: boolean | undefined;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
}) => {
  const { gl } = useThree();

  const hyperbolicSize =
    0.8 +
    (3.2 * Math.log(node.degree / minimumDegree)) /
      Math.log(maximumDegree / minimumDegree);
  const rEuclidean = Math.sqrt(
    position.x * position.x + position.y * position.y
  );

  const scaleFactor = 1 - rEuclidean * rEuclidean;
  const size = Math.max(0.001, (hyperbolicSize * scaleFactor) / 20);

  const textSize = size * 0.8;

  const hideText = rEuclidean > 0.95 || size < 0.01;

  let colour = isHovered ? "#42A5F5" : "#90CAF9";
  if (isMeetingPoint) {
    colour = isHovered ? "#FFA726" : "#FFCC80";
  } else if (isRouteEndpoint) {
    colour = isHovered ? "#AB47BC" : "#CE93D8";
  } else if (isOnPath) {
    colour = isHovered ? "#66BB6A" : "#A5D6A7";
  } else if (isSelected) {
    colour = isHovered ? "#EF5350" : "#EF9A9A";
  }

  return (
    <group position={[position.x, position.y, 0.1]}>
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          gl.domElement.style.cursor = "pointer";
          onHover(true);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          gl.domElement.style.cursor = "default";
          onHover(false);
        }}
      >
        <circleGeometry args={[size, 32]} />
        <meshBasicMaterial color={colour} side={THREE.DoubleSide} />
      </mesh>

      {!hideText && (
        <Text
          position={[0, 0, 0.2]}
          fontSize={textSize}
          color="#000000"
          anchorX="center"
          anchorY="middle"
          whiteSpace="nowrap"
          maxWidth={size * 2}
        >
          {node.id}
        </Text>
      )}
    </group>
  );
};

const Edge = ({
  points,
  isOnPath,
  isForwardPath,
  isBackwardPath,
}: {
  points: THREE.Vector3[];
  isOnPath: boolean;
  isForwardPath: boolean;
  isBackwardPath: boolean;
}) => {
  const thicknesses = useMemo(() => {
    return points.map((p) => {
      const r = Math.sqrt(p.x * p.x + p.y * p.y);
      const baseThickness = isOnPath ? 3 : 1.5;
      const thickness = baseThickness * (1 - r * r);
      return thickness;
    });
  }, [points, isOnPath]);

  const widthAttribute = useMemo(() => {
    const interleavedWidths = [];
    for (const width of thicknesses) {
      interleavedWidths.push(width, width, width);
    }
    return new THREE.BufferAttribute(new Float32Array(interleavedWidths), 3);
  }, [thicknesses]);

  let colour = "#000000";
  if (isForwardPath && isBackwardPath) {
    colour = "#BF360C";
  } else if (isForwardPath) {
    colour = "#F57F17";
  } else if (isBackwardPath) {
    colour = "#E65100";
  } else if (isOnPath) {
    colour = "#F57F17";
  }

  return (
    <Line
      points={points}
      color={colour}
      lineWidth={isOnPath ? 3 : 1}
      dashed={false}
      opacity={0.5}
    >
      <bufferGeometry attach="geometry">
        <bufferAttribute
          attach="attributes-instanceStart"
          args={[widthAttribute.array, widthAttribute.itemSize]}
        />
      </bufferGeometry>
    </Line>
  );
};

const DiscBoundary = () => {
  return (
    <group>
      <mesh position={[0, 0, -0.1]}>
        <circleGeometry args={[1, 128]} />
        <meshBasicMaterial color="#f0f0f0" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, -0.05]}>
        <ringGeometry args={[0.995, 1.0, 128]} />
        <meshBasicMaterial color="#333333" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};

const CameraController = ({
  onPan,
  onZoom,
}: {
  onPan: (dx: number, dy: number) => void;
  onZoom: (delta: number) => void;
}) => {
  const { gl } = useThree();

  const isPanning = useRef(false);
  const lastMouseX = useRef(0);
  const lastMouseY = useRef(0);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 0) {
        event.preventDefault();
        isPanning.current = true;
        lastMouseX.current = event.clientX;
        lastMouseY.current = event.clientY;
        gl.domElement.style.cursor = "grabbing";
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      if (isPanning.current) {
        const deltaX = event.clientX - lastMouseX.current;
        const deltaY = event.clientY - lastMouseY.current;

        const sensitivity = 0.001;

        onPan(deltaX * sensitivity, -deltaY * sensitivity);

        lastMouseX.current = event.clientX;
        lastMouseY.current = event.clientY;
      }
    };

    const onMouseUp = () => {
      isPanning.current = false;
      gl.domElement.style.cursor = "default";
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const zoomSpeed = 0.001;
      onZoom(-event.deltaY * zoomSpeed);
    };

    gl.domElement.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    gl.domElement.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      gl.domElement.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      gl.domElement.removeEventListener("wheel", onWheel);
    };
  }, [gl, onPan, onZoom]);

  return null;
};

const Scene = ({
  nodes,
  edges,
  selectedNode,
  hoveredNode,
  routingResult,
  onSelectNode,
  onHoverNode,
  panR,
  panTheta,
  zoom,
  onPan,
  onZoom,
}: {
  nodes: EmbeddedNode[];
  edges: Edge[];
  selectedNode: EmbeddedNode | null;
  hoveredNode: EmbeddedNode | null;
  routingResult: RoutingResult | null;
  onSelectNode: (node: EmbeddedNode | null) => void;
  onHoverNode: (node: EmbeddedNode | null) => void;
  panR: number;
  panTheta: number;
  zoom: number;
  onPan: (deltaR: number, deltaTheta: number) => void;
  onZoom: (delta: number) => void;
}) => {
  const nodePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    nodes.forEach((node) => {
      positions.set(
        node.id,
        projectToDisc(node.r, node.theta, panR, panTheta, zoom)
      );
    });
    return positions;
  }, [nodes, panR, panTheta, zoom]);

  const pathEdgeSet = useMemo(() => {
    if (!routingResult || !routingResult.success) return new Set<string>();

    const edgeSet = new Set<string>();
    for (let i = 0; i < routingResult.path.length - 1; i++) {
      const a = routingResult.path[i].id;
      const b = routingResult.path[i + 1].id;
      edgeSet.add(`${a}-${b}`);
      edgeSet.add(`${b}-${a}`);
    }
    return edgeSet;
  }, [routingResult]);

  const forwardEdgeSet = useMemo(() => {
    if (!routingResult || !routingResult.success) return new Set<string>();

    const edgeSet = new Set<string>();
    for (let i = 0; i < routingResult.forwardPath.length - 1; i++) {
      const a = routingResult.forwardPath[i].id;
      const b = routingResult.forwardPath[i + 1].id;
      edgeSet.add(`${a}-${b}`);
      edgeSet.add(`${b}-${a}`);
    }
    return edgeSet;
  }, [routingResult]);

  const backwardEdgeSet = useMemo(() => {
    if (!routingResult || !routingResult.success) return new Set<string>();

    const edgeSet = new Set<string>();
    for (let i = 0; i < routingResult.backwardPath.length - 1; i++) {
      const a = routingResult.backwardPath[i].id;
      const b = routingResult.backwardPath[i + 1].id;
      edgeSet.add(`${a}-${b}`);
      edgeSet.add(`${b}-${a}`);
    }
    return edgeSet;
  }, [routingResult]);

  const pathNodeSet = useMemo(() => {
    if (!routingResult || !routingResult.success) return new Set<string>();
    return new Set(routingResult.path.map(node => node.id));
  }, [routingResult]);

  const edgeGeometries = useMemo(() => {
    return edges
      .map((edge) => {
        const sourcePos = nodePositions.get(edge.source);
        const targetPos = nodePositions.get(edge.target);

        if (sourcePos && targetPos) {
          const edgeKey = `${edge.source}-${edge.target}`;
          const isOnPath = pathEdgeSet.has(edgeKey);
          const isForward = forwardEdgeSet.has(edgeKey);
          const isBackward = backwardEdgeSet.has(edgeKey);

          return {
            key: edgeKey,
            points: generateGeodesicPoints(
              sourcePos.x,
              sourcePos.y,
              targetPos.x,
              targetPos.y
            ),
            isOnPath,
            isForward,
            isBackward,
          };
        }
        return null;
      })
      .filter(Boolean) as {
      key: string;
      points: THREE.Vector3[];
      isOnPath: boolean;
      isForward: boolean;
      isBackward: boolean;
    }[];
  }, [edges, nodePositions, pathEdgeSet, forwardEdgeSet, backwardEdgeSet]);

  return (
    <>
      <DiscBoundary />

      <group>
        {edgeGeometries.map(
          ({ key, points, isOnPath, isForward, isBackward }) => (
            <Edge
              key={key}
              points={points}
              isOnPath={isOnPath}
              isForwardPath={isForward}
              isBackwardPath={isBackward}
            />
          )
        )}
      </group>

      <group>
        {nodes.map((node) => {
          const position = nodePositions.get(node.id);
          if (!position) return null;

          const isMeetingPoint = routingResult?.meetingNode === node;
          const isOnPath = pathNodeSet.has(node.id);
          const isRouteEndpoint =
            routingResult?.success &&
            (node === routingResult.path[0] ||
              node === routingResult.path[routingResult.path.length - 1]);

          return (
            <Node
              key={node.id}
              node={node}
              position={position}
              isSelected={selectedNode === node}
              isHovered={hoveredNode === node}
              isOnPath={isOnPath}
              isMeetingPoint={isMeetingPoint}
              isRouteEndpoint={isRouteEndpoint}
              onSelect={() => onSelectNode(selectedNode === node ? null : node)}
              onHover={(hovering) => onHoverNode(hovering ? node : null)}
            />
          );
        })}
      </group>

      <CameraController onPan={onPan} onZoom={onZoom} />
    </>
  );
};

const ViewportSynchronizer = () => {
  const { size, camera, gl } = useThree();

  const updateCameraZoom = () => {
    const { width, height } = size;
    const scaleFactor = Math.min(width, height);
    camera.zoom = scaleFactor / 2;
    camera.updateProjectionMatrix();
  };

  useEffect(() => {
    updateCameraZoom();

    const handleResize = () => {
      updateCameraZoom();
      gl.setPixelRatio(window.devicePixelRatio);
    };

    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, [size, camera, gl]);

  return null;
};

const Disc = ({
  nodes,
  edges,
  panR,
  setPanR,
  panTheta,
  setPanTheta,
  zoom,
  setZoom,
  selectedNode,
  setSelectedNode,
  routingResult,
}: {
  nodes: EmbeddedNode[];
  edges: Edge[];
  panR: number;
  setPanR: Dispatch<SetStateAction<number>>;
  panTheta: number;
  setPanTheta: Dispatch<SetStateAction<number>>;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  selectedNode: EmbeddedNode | null;
  setSelectedNode: Dispatch<SetStateAction<EmbeddedNode | null>>;
  routingResult: RoutingResult | null;
}) => {
  const [hoveredNode, setHoveredNode] = useState<EmbeddedNode | null>(null);

  const handlePan = useCallback(
    (dx: number, dy: number) => {
      const currentREuclidean = Math.tanh(panR / 2);
      const currentX = currentREuclidean * Math.cos(panTheta);
      const currentY = currentREuclidean * Math.sin(panTheta);

      const newCenterEuclidean = moebiusTranslate(currentX, currentY, dx, dy);

      const { r: newR, theta: newTheta } = euclideanToHyperbolic(
        newCenterEuclidean.x,
        newCenterEuclidean.y
      );

      setPanR(newR);
      setPanTheta(newTheta);
    },
    [panR, panTheta, setPanR, setPanTheta]
  );

  const handleZoom = useCallback((delta: number) => {
    const factor = Math.exp(delta);
    setZoom((prev) => Math.max(0.02, Math.min(50, prev * factor)));
  }, [setZoom]);

  return (
    <Canvas
      orthographic
      camera={{ zoom: 400, position: [0, 0, 10] }}
      resize={{ scroll: false }}
    >
      <ViewportSynchronizer />
      <Scene
        nodes={nodes}
        edges={edges}
        hoveredNode={hoveredNode}
        onHoverNode={setHoveredNode}
        selectedNode={selectedNode}
        onSelectNode={setSelectedNode}
        routingResult={routingResult}
        panR={panR}
        panTheta={panTheta}
        zoom={zoom}
        onPan={handlePan}
        onZoom={handleZoom}
      />
    </Canvas>
  );
};

export default Disc;
