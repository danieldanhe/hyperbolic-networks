import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import { MeshLine, MeshLineMaterial } from "three.meshline";

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
  y2: number
): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];

  const dist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);

  const avgR = Math.sqrt((x1 ** 2 + y1 ** 2 + x2 ** 2 + y2 ** 2) / 2);
  const adaptiveSegments = avgR > 0.8 ? 8 : dist < 0.1 ? 4 : 12;

  if (dist < 0.05) {
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

  for (let i = 0; i <= adaptiveSegments; i++) {
    const t = i / adaptiveSegments;
    const s = 1 - t;
    const x = s * s * x1 + 2 * s * t * controlX + t * t * x2;
    const y = s * s * y1 + 2 * s * t * controlY + t * t * y2;
    points.push(new THREE.Vector3(x, y, 0));
  }

  return points;
}

let minimumDegree = 1;
let maximumDegree = 10;

const InstancedNodes = ({
  nodes,
  nodePositions,
  selectedNode,
  hoveredNode,
  pathNodeSet,
  routingResult,
  onSelect,
  onHover,
}: {
  nodes: EmbeddedNode[];
  nodePositions: Map<string, { x: number; y: number }>;
  selectedNode: EmbeddedNode | null;
  hoveredNode: EmbeddedNode | null;
  pathNodeSet: Set<string>;
  routingResult: RoutingResult | null;
  onSelect: (node: EmbeddedNode | null) => void;
  onHover: (node: EmbeddedNode | null) => void;
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { gl, raycaster, camera, size } = useThree();

  const nodeData = useMemo(() => {
    return nodes
      .map((node) => {
        const position = nodePositions.get(node.id);
        if (!position) return null;

        const hyperbolicSize =
          0.8 +
          (3.2 * Math.log(node.degree / minimumDegree)) /
            Math.log(maximumDegree / minimumDegree);
        const rEuclidean = Math.sqrt(
          position.x * position.x + position.y * position.y
        );
        const scaleFactor = 1 - rEuclidean * rEuclidean;
        const size = Math.max(0.001, (hyperbolicSize * scaleFactor) / 20);

        const isMeetingPoint = routingResult?.meetingNode === node;
        const isOnPath = pathNodeSet.has(node.id);
        const isRouteEndpoint =
          routingResult?.success &&
          (node === routingResult.path[0] ||
            node === routingResult.path[routingResult.path.length - 1]);

        let colour = hoveredNode === node ? "#42A5F5" : "#90CAF9";
        if (isMeetingPoint) {
          colour = hoveredNode === node ? "#FFA726" : "#FFCC80";
        } else if (isRouteEndpoint) {
          colour = hoveredNode === node ? "#AB47BC" : "#CE93D8";
        } else if (isOnPath) {
          colour = hoveredNode === node ? "#66BB6A" : "#A5D6A7";
        } else if (selectedNode === node) {
          colour = hoveredNode === node ? "#EF5350" : "#EF9A9A";
        }

        return { node, position, size, color: new THREE.Color(colour) };
      })
      .filter(Boolean);
  }, [
    nodes,
    nodePositions,
    selectedNode,
    hoveredNode,
    pathNodeSet,
    routingResult,
  ]);

  useLayoutEffect(() => {
    if (!meshRef.current) return;

    const tempObject = new THREE.Object3D();
    const tempColor = new THREE.Color();

    nodeData.forEach((data, i) => {
      if (!data) return;

      tempObject.position.set(data.position.x, data.position.y, 0.1);
      tempObject.scale.setScalar(data.size);
      tempObject.updateMatrix();

      meshRef.current!.setMatrixAt(i, tempObject.matrix);
      meshRef.current!.setColorAt(i, data.color);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  }, [nodeData]);

  const handleClick = useCallback(
    (event: any) => {
      if (!meshRef.current) return;

      const mouse = new THREE.Vector2();
      const rect = gl.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      const intersects = raycaster.intersectObject(meshRef.current);

      if (intersects.length > 0 && intersects[0].instanceId !== undefined) {
        const instanceId = intersects[0].instanceId;
        const data = nodeData[instanceId];
        if (data) {
          event.stopPropagation();
          onSelect(selectedNode === data.node ? null : data.node);
        }
      }
    },
    [nodeData, selectedNode, onSelect, gl, raycaster, camera]
  );

  const handlePointerMove = useCallback(
    (event: any) => {
      if (!meshRef.current) return;

      const mouse = new THREE.Vector2();
      const rect = gl.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObject(meshRef.current);

      if (intersects.length > 0 && intersects[0].instanceId !== undefined) {
        const instanceId = intersects[0].instanceId;
        const data = nodeData[instanceId];
        if (data) {
          gl.domElement.style.cursor = "pointer";
          onHover(data.node);
          return;
        }
      }

      gl.domElement.style.cursor = "default";
      onHover(null);
    },
    [nodeData, onHover, gl, raycaster, camera]
  );

  const handlePointerOut = useCallback(() => {
    gl.domElement.style.cursor = "default";
    onHover(null);
  }, [gl, onHover]);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerout", handlePointerOut);

    return () => {
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerout", handlePointerOut);
    };
  }, [gl, handleClick, handlePointerMove, handlePointerOut]);

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, nodes.length]}>
      <circleGeometry args={[1, 32]} />
      <meshBasicMaterial side={THREE.DoubleSide} />
    </instancedMesh>
  );
};

const NodeLabels = ({
  nodes,
  nodePositions,
}: {
  nodes: EmbeddedNode[];
  nodePositions: Map<string, { x: number; y: number }>;
}) => {
  return (
    <>
      {nodes.map((node) => {
        const position = nodePositions.get(node.id);
        if (!position) return null;

        const rEuclidean = Math.sqrt(
          position.x * position.x + position.y * position.y
        );
        const hyperbolicSize =
          0.8 +
          (3.2 * Math.log(node.degree / minimumDegree)) /
            Math.log(maximumDegree / minimumDegree);
        const scaleFactor = 1 - rEuclidean * rEuclidean;
        const size = Math.max(0.001, (hyperbolicSize * scaleFactor) / 20);

        const hideText = rEuclidean > 0.95 || size < 0.01;
        if (hideText) return null;

        return (
          <Text
            key={node.id}
            position={[position.x, position.y, 0.2]}
            fontSize={size * 1.5}
            color="#000000"
            anchorX="center"
            anchorY="middle"
            whiteSpace="nowrap"
            maxWidth={size * 2}
          >
            {node.id}
          </Text>
        );
      })}
    </>
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
  let colour = "#000000";
  let opacity = 0.2;
  let lineWidth = 0.005;

  if (isForwardPath && isBackwardPath) {
    colour = "#BF360C";
  } else if (isForwardPath) {
    colour = "#F57F17";
  } else if (isBackwardPath) {
    colour = "#E65100";
  } else if (isOnPath) {
    colour = "#F57F17";
  }
  if (isOnPath) {
    opacity = 1;
    lineWidth = 0.01;
  }

  const linePoints = useMemo(() => {
    const arr: number[] = [];
    points.forEach((p) => arr.push(p.x, p.y, p.z));
    return new Float32Array(arr);
  }, [points]);

  const meshLine = useMemo(() => {
    const ml = new MeshLine();
    ml.setPoints(linePoints);
    return ml;
  }, [linePoints]);

  const material = useMemo(() => {
    return new MeshLineMaterial({
      color: new THREE.Color(colour),
      lineWidth,
      transparent: true,
      opacity,
      depthTest: true,
    });
  }, [colour, lineWidth, opacity]);

  return (
    <mesh>
      <primitive object={meshLine} />
      <primitive object={material} attach="material" />
    </mesh>
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

const getTouchDistance = (touches: TouchList): number => {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
};

const CameraController = ({
  onTransformChange,
}: {
  onTransformChange: (panR: number, panTheta: number, zoom: number) => void;
}) => {
  const { gl } = useThree();

  const transformRef = useRef({ panR: 0, panTheta: 0, zoom: 1 });
  const isPanning = useRef(false);
  const lastMouseX = useRef(0);
  const lastMouseY = useRef(0);
  const initialTouchDistance = useRef<number | null>(null);
  const isZooming = useRef(false);

  const updateTransform = useCallback(() => {
    onTransformChange(
      transformRef.current.panR,
      transformRef.current.panTheta,
      transformRef.current.zoom
    );
  }, [onTransformChange]);

  const handlePan = useCallback(
    (dx: number, dy: number) => {
      const currentREuclidean = Math.tanh(transformRef.current.panR / 2);
      const currentX =
        currentREuclidean * Math.cos(transformRef.current.panTheta);
      const currentY =
        currentREuclidean * Math.sin(transformRef.current.panTheta);

      const newCenterEuclidean = moebiusTranslate(currentX, currentY, dx, dy);
      const { r: newR, theta: newTheta } = euclideanToHyperbolic(
        newCenterEuclidean.x,
        newCenterEuclidean.y
      );

      transformRef.current.panR = newR;
      transformRef.current.panTheta = newTheta;
      updateTransform();
    },
    [updateTransform]
  );

  const handleZoom = useCallback(
    (delta: number) => {
      const factor = Math.exp(delta);
      transformRef.current.zoom = Math.max(
        0.02,
        Math.min(50, transformRef.current.zoom * factor)
      );
      updateTransform();
    },
    [updateTransform]
  );

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
        handlePan(deltaX * sensitivity, -deltaY * sensitivity);

        lastMouseX.current = event.clientX;
        lastMouseY.current = event.clientY;
      }
    };

    const onMouseUp = () => {
      if (isPanning.current) {
        isPanning.current = false;
        if (gl.domElement.style.cursor === "grabbing") {
          gl.domElement.style.cursor = "default";
        }
      }
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const zoomSpeed = 0.001;
      handleZoom(-event.deltaY * zoomSpeed);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 2) {
        event.preventDefault();
        isZooming.current = true;
        initialTouchDistance.current = getTouchDistance(event.touches);
        isPanning.current = false;
      } else if (event.touches.length === 1 && !isZooming.current) {
        event.preventDefault();
        isPanning.current = true;
        lastMouseX.current = event.touches[0].clientX;
        lastMouseY.current = event.touches[0].clientY;
        gl.domElement.style.cursor = "grabbing";
      }
    };

    const onTouchMove = (event: TouchEvent) => {
      if (
        isZooming.current &&
        initialTouchDistance.current !== null &&
        event.touches.length === 2
      ) {
        event.preventDefault();
        const currentDistance = getTouchDistance(event.touches);
        const distanceDelta = currentDistance - initialTouchDistance.current;

        const zoomSensitivity = 0.005;
        handleZoom(distanceDelta * zoomSensitivity);

        initialTouchDistance.current = currentDistance;
      } else if (isPanning.current && event.touches.length === 1) {
        event.preventDefault();

        const deltaX = event.touches[0].clientX - lastMouseX.current;
        const deltaY = event.touches[0].clientY - lastMouseY.current;

        const sensitivity = 0.001;
        handlePan(deltaX * sensitivity, -deltaY * sensitivity);

        lastMouseX.current = event.touches[0].clientX;
        lastMouseY.current = event.touches[0].clientY;
      }
    };

    const onTouchEnd = () => {
      isZooming.current = false;
      initialTouchDistance.current = null;

      if (isPanning.current) {
        isPanning.current = false;
        gl.domElement.style.cursor = "default";
      }
    };

    gl.domElement.addEventListener("mousedown", onMouseDown);
    gl.domElement.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    gl.domElement.addEventListener("touchstart", onTouchStart, {
      passive: false,
    });
    gl.domElement.addEventListener("touchmove", onTouchMove, {
      passive: false,
    });
    gl.domElement.addEventListener("touchend", onTouchEnd);

    return () => {
      gl.domElement.removeEventListener("mousedown", onMouseDown);
      gl.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);

      gl.domElement.removeEventListener("touchstart", onTouchStart);
      gl.domElement.removeEventListener("touchmove", onTouchMove);
      gl.domElement.removeEventListener("touchend", onTouchEnd);
    };
  }, [gl, handlePan, handleZoom]);

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
  onTransformChange,
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
  onTransformChange: (panR: number, panTheta: number, zoom: number) => void;
}) => {
  const transformRef = useRef({ panR, panTheta, zoom });

  useEffect(() => {
    transformRef.current = { panR, panTheta, zoom };
  }, [panR, panTheta, zoom]);

  const nodePositions = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>();
    nodes.forEach((node) => {
      positions.set(
        node.id,
        projectToDisc(
          node.r,
          node.theta,
          transformRef.current.panR,
          transformRef.current.panTheta,
          transformRef.current.zoom
        )
      );
    });
    return positions;
  }, [
    nodes,
    transformRef.current.panR,
    transformRef.current.panTheta,
    transformRef.current.zoom,
  ]);

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
      b = routingResult.backwardPath[i + 1].id;
      edgeSet.add(`${a}-${b}`);
      edgeSet.add(`${b}-${a}`);
    }
    return edgeSet;
  }, [routingResult]);

  const pathNodeSet = useMemo(() => {
    if (!routingResult || !routingResult.success) return new Set<string>();
    return new Set(routingResult.path.map((node) => node.id));
  }, [routingResult]);

  const edgeGeometries = useMemo(() => {
    return edges
      .map((edge) => {
        const sourcePos = nodePositions.get(edge.source);
        const targetPos = nodePositions.get(edge.target);

        if (!sourcePos || !targetPos) return null;

        const edgeKey = `${edge.source}-${edge.target}`;
        const isOnPath = pathEdgeSet.has(edgeKey);
        const isForward = forwardEdgeSet.has(edgeKey);
        const isBackward = backwardEdgeSet.has(edgeKey);

        if (isOnPath) {
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

        const sourceR = Math.sqrt(sourcePos.x ** 2 + sourcePos.y ** 2);
        const targetR = Math.sqrt(targetPos.x ** 2 + targetPos.y ** 2);
        const maxR = Math.max(sourceR, targetR);

        const angle1 = Math.atan2(sourcePos.y, sourcePos.x);
        const angle2 = Math.atan2(targetPos.y, targetPos.x);
        const angularSeparation = Math.min(
          Math.abs(angle1 - angle2),
          2 * Math.PI - Math.abs(angle1 - angle2)
        );

        if (maxR > 0.9 && angularSeparation < Math.PI / 4) {
          return null;
        }

        const dist = Math.sqrt(
          (sourcePos.x - targetPos.x) ** 2 + (sourcePos.y - targetPos.y) ** 2
        );
        if (transformRef.current.zoom > 2 && dist < 0.01) {
          return null;
        }

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

      <InstancedNodes
        nodes={nodes}
        nodePositions={nodePositions}
        selectedNode={selectedNode}
        hoveredNode={hoveredNode}
        pathNodeSet={pathNodeSet}
        routingResult={routingResult}
        onSelect={onSelectNode}
        onHover={onHoverNode}
      />

      <NodeLabels nodes={nodes} nodePositions={nodePositions} />

      <CameraController onTransformChange={onTransformChange} />
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

  const handleTransformChange = useCallback(
    (newPanR: number, newPanTheta: number, newZoom: number) => {
      setPanR(newPanR);
      setPanTheta(newPanTheta);
      setZoom(newZoom);
    },
    [setPanR, setPanTheta, setZoom]
  );

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
        onTransformChange={handleTransformChange}
      />
    </Canvas>
  );
};

export default Disc;
