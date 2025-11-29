import {
  type Dispatch,
  type FC,
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

import { embedNetwork } from "./embedding";

type EmbeddedNode = {
  id: string;
  r: number;
  theta: number;
  kappa: number;
  degree: number;
};

type Edge = {
  source: string;
  target: string;
};

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

// Inside the Node component definition...

const Node: FC<{
  node: EmbeddedNode;
  position: { x: number; y: number };
  isSelected: boolean;
  isHovered: boolean;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
}> = ({ node, position, isSelected, isHovered, onSelect, onHover }) => {
  const { gl } = useThree();

  const hyperbolicSize = 0.5 + node.degree * 0.2;
  const rEuclidean = Math.sqrt(
    position.x * position.x + position.y * position.y
  );
  
  const scaleFactor = 1 - rEuclidean * rEuclidean;
  const size = Math.max(0.001, (hyperbolicSize * scaleFactor) / 20);

  const textSize = size * 0.8;

  const hideText = rEuclidean > 0.95 || size < 0.01; 

  const color = isSelected ? "#ef4444" : isHovered ? "#60a5fa" : "#3b82f6";

  return (
    <group position={[position.x, position.y, 0.1]}>
      {/* Node Mesh */}
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
        <meshBasicMaterial color={color} side={THREE.DoubleSide} />
      </mesh>
      
      {!hideText && (
        <Text
          position={[0, 0, 0.2]}
          fontSize={textSize}
          color="#000"
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

const Edge: FC<{
  points: THREE.Vector3[];
}> = ({ points }) => {
  const thicknesses = useMemo(() => {
    return points.map((p) => {
      const r = Math.sqrt(p.x * p.x + p.y * p.y);
      const thickness = 1.5 * (1 - r * r);
      return thickness;
    });
  }, [points]);

  const widthAttribute = useMemo(() => {
    const interleavedWidths = [];
    for (const width of thicknesses) {
      interleavedWidths.push(width, width, width);
    }
    return new THREE.BufferAttribute(new Float32Array(interleavedWidths), 3);
  }, [thicknesses]);

  return (
    <Line points={points} color="#000" lineWidth={1} dashed={false}>
      <bufferGeometry attach="geometry">
        <bufferAttribute
          attach="attributes-instanceStart"
          args={[widthAttribute.array, widthAttribute.itemSize]}
        />
      </bufferGeometry>
    </Line>
  );
};

const DiscBoundary: FC = () => {
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

const CameraController: FC<{
  onPan: (dx: number, dy: number) => void;
  onZoom: (delta: number) => void;
}> = ({ onPan, onZoom }) => {
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

const Scene: FC<{
  nodes: EmbeddedNode[];
  edges: Edge[];
  selectedNode: string | null;
  hoveredNode: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onHoverNode: (nodeId: string | null) => void;
  panR: number;
  panTheta: number;
  zoom: number;
  onPan: (deltaR: number, deltaTheta: number) => void;
  onZoom: (delta: number) => void;
}> = ({
  nodes,
  edges,
  selectedNode,
  hoveredNode,
  onSelectNode,
  onHoverNode,
  panR,
  panTheta,
  zoom,
  onPan,
  onZoom,
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

  const edgeGeometries = useMemo(() => {
    return edges
      .map((edge) => {
        const sourcePos = nodePositions.get(edge.source);
        const targetPos = nodePositions.get(edge.target);

        if (sourcePos && targetPos) {
          return {
            key: `${edge.source}-${edge.target}`,
            points: generateGeodesicPoints(
              sourcePos.x,
              sourcePos.y,
              targetPos.x,
              targetPos.y
            ),
          };
        }
        return null;
      })
      .filter(Boolean) as { key: string; points: THREE.Vector3[] }[];
  }, [edges, nodePositions]);

  return (
    <>
      <DiscBoundary />

      <group>
        {edgeGeometries.map(({ key, points }) => (
          <Edge key={key} points={points} />
        ))}
      </group>

      <group>
        {nodes.map((node) => {
          const position = nodePositions.get(node.id);
          if (!position) return null;

          return (
            <Node
              key={node.id}
              node={node}
              position={position}
              isSelected={selectedNode === node.id}
              isHovered={hoveredNode === node.id}
              onSelect={() =>
                onSelectNode(selectedNode === node.id ? null : node.id)
              }
              onHover={(hovering) => onHoverNode(hovering ? node.id : null)}
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
  panR,
  setPanR,
  panTheta,
  setPanTheta,
  zoom,
  setZoom,
}: {
  panR: number;
  setPanR: Dispatch<SetStateAction<number>>;
  panTheta: number;
  setPanTheta: Dispatch<SetStateAction<number>>;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
}) => {
  const csvContent = `source,target
A,B
B,C
C,A
A,D
D,E
E,A`;

  embedNetwork(csvContent).then((nodes) => {
    console.log(JSON.stringify(nodes, null, 2));
  });

  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

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

    setZoom((prev) => +Math.max(0.02, Math.min(50, prev * factor)));
  }, []);

  const sampleNodes: EmbeddedNode[] = [
    { id: "This is a very long label to test what happens.", r: 0.5, theta: 0, degree: 4, kappa: 2.4 },
    { id: "B", r: 1.2, theta: Math.PI / 3, degree: 2, kappa: 1.6 },
    { id: "C", r: 1.2, theta: (2 * Math.PI) / 3, degree: 2, kappa: 1.6 },
    { id: "D", r: 1.2, theta: Math.PI, degree: 2, kappa: 1.6 },
    { id: "E", r: 1.2, theta: (-2 * Math.PI) / 3, degree: 2, kappa: 1.6 },
    { id: "F", r: 1.2, theta: -Math.PI / 3, degree: 2, kappa: 1.6 },
    { id: "G", r: 1.8, theta: Math.PI / 6, degree: 1, kappa: 1.2 },
    { id: "H", r: 1.8, theta: (5 * Math.PI) / 6, degree: 1, kappa: 1.2 },
  ];

  const sampleEdges: Edge[] = [
    { source: "This is a very long label to test what happens.", target: "B" },
    { source: "This is a very long label to test what happens.", target: "C" },
    { source: "This is a very long label to test what happens.", target: "D" },
    { source: "This is a very long label to test what happens.", target: "E" },
    { source: "This is a very long label to test what happens.", target: "F" },
    { source: "B", target: "G" },
    { source: "C", target: "H" },
    { source: "B", target: "C" },
    { source: "D", target: "E" },
  ];

  return (
    <Canvas
      orthographic
      camera={{ zoom: 400, position: [0, 0, 10] }}
      resize={{ scroll: false }}
    >
      <ViewportSynchronizer />
      <Scene
        nodes={sampleNodes}
        edges={sampleEdges}
        selectedNode={selectedNode}
        hoveredNode={hoveredNode}
        onSelectNode={setSelectedNode}
        onHoverNode={setHoveredNode}
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
