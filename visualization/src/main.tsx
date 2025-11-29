import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  Fragment,
  StrictMode,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import "./global.scss";
import styles from "./styles.module.scss";
import { Combobox } from "@base-ui-components/react/combobox";
import { Field } from "@base-ui-components/react/field";
import { Fieldset } from "@base-ui-components/react/fieldset";
import { List, type RowComponentProps, useListRef } from "react-window";
import { round } from "mathjs";

import Disc from "./Disc";
import {
  type Edge,
  type EmbeddedNode,
  type NetworkStats,
  embedNetwork,
  parseCSV,
} from "./embedding";
import { bidirectionalGreedyRouting, type RoutingResult } from "./routing";

interface Dataset {
  id: string;
  filename: string;
}

const useComboboxIds = () => {
  const labelId = useId();
  const inputId = useId();
  return { labelId, inputId };
};

const ScreenReaderNotice = () => (
  <section className={styles.screenReaderNotice}>
    <h1 className={styles.pageTitle}>Networks and hyperbolic geometry</h1>
    <p className={styles.screenReaderDescription}>
      This web app is a visual demonstration of complex network structures and{" "}
      <strong>is not compatible with screen readers</strong>. Providing textual
      description for the interactive, graphical model is, unfortunately, beyond
      the scope of this project.
    </p>
  </section>
);

const CoordinateInput = ({
  onValueChange,
  label,
  value,
  helpText,
}: {
  onValueChange: (
    value: string,
    eventDetails: Field.Control.ChangeEventDetails
  ) => void;
  label: string;
  value: number;
  helpText?: string;
}) => (
  <Field.Root className={styles.formRow} render={<li />}>
    <Field.Label className={styles.fieldLabelShort}>
      <var>{label}</var>
    </Field.Label>
    <div className={styles.inputWrapper}>
      <Field.Control
        className={styles.inputControl}
        onValueChange={onValueChange}
        type="number"
        value={value}
      />
      {helpText && (
        <Field.Description className={styles.inputHelp}>
          {helpText}
        </Field.Description>
      )}
    </div>
  </Field.Root>
);

const StatItem = ({
  degrees,
  label,
  value,
  numberType,
}: {
  degrees?: boolean;
  label: string | ReactNode;
  value: string | number;
  numberType?: "integer" | "decimal";
}) => {
  const formatWholeNumber = (num: number) => {
    const separator = "\u2009";
    const absNum = Math.abs(Math.floor(num));
    const str = absNum.toString();
    if (str.length <= 10) {
      const formatted = str.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
      return { formatted, accessible: str };
    } else {
      const exponent = Math.floor(Math.log10(absNum));
      const mantissa = (absNum / 10 ** exponent).toFixed(6);
      const [intPart, fracPart] = mantissa.split(".");
      const groupedFrac = fracPart.replace(/(\d{3})(?=\d)/g, `$1${separator}`);
      let formatted = `${intPart}.${groupedFrac}e+${exponent}`;
      let exponentOrdinal;
      const tenModulo = exponent % 10;
      const hundredModulo = exponent % 100;
      if (tenModulo === 1 && hundredModulo !== 11)
        exponentOrdinal = exponent + "st";
      else if (tenModulo === 2 && hundredModulo !== 12)
        exponentOrdinal = exponent + "nd";
      else if (tenModulo === 3 && hundredModulo !== 13)
        exponentOrdinal = exponent + "rd";
      else exponentOrdinal = exponent + "th";
      let accessible = `${mantissa} times 10 to the ${exponentOrdinal} power`;
      if (degrees) {
        formatted += "°";
        accessible += " degrees";
      }
      return { formatted, accessible };
    }
  };
  const formatDecimalNumber = (num: number) => {
    const separator = "\u2009";
    const absNum = Math.abs(num);
    const intPart = Math.floor(absNum).toString();
    const intLen = intPart.length;
    const maxFracDigits = Math.max(0, 10 - intLen);
    const rounded = absNum.toFixed(maxFracDigits);
    const [intStr, fracStr = ""] = rounded.split(".");
    const groupedInt = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
    const groupedFrac = fracStr.replace(/(\d{3})(?=\d)/g, `$1${separator}`);
    let formatted = fracStr ? `${groupedInt}.${groupedFrac}` : groupedInt;
    let accessible = rounded;
    if (degrees) {
      formatted += "°";
      accessible += " degrees";
    }
    return { formatted, accessible };
  };

  const toDisplay: { formatted: string; accessible: string } =
    typeof value === "number" && numberType === "integer"
      ? formatWholeNumber(value)
      : typeof value === "number" && numberType === "decimal"
      ? formatDecimalNumber(value)
      : { formatted: String(value), accessible: String(value) };

  return (
    <div className={styles.formRow}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={styles.statValue} aria-label={toDisplay.accessible}>
        {toDisplay.formatted.split("\u2009").map((part, index, array) => (
          <Fragment key={index}>
            {part}
            {index < array.length - 1 && (
              <span aria-hidden={true} className={styles.thinSpace} />
            )}
          </Fragment>
        ))}
      </dd>
    </div>
  );
};

const RowComponent = ({
  index,
  style,
  filteredItems,
}: RowComponentProps<{
  filteredItems: { id: string; [key: string]: any }[];
}>) => {
  const item = filteredItems[index];
  if (!item) return null;

  return (
    <Combobox.Item
      className={styles.popupItem}
      key={item.id}
      value={item}
      index={index}
      aria-setsize={filteredItems.length}
      aria-posinset={index + 1}
      style={style}
    >
      {item.id}
    </Combobox.Item>
  );
};

const LabelledCombobox = ({
  items,
  label,
  children,
  value,
  setValue,
}: {
  items: { id: string; [key: string]: any }[];
  label: string | ReactNode;
  children?: ReactNode;
  value: { id: string; [key: string]: any } | null;
  setValue: Dispatch<SetStateAction<{ id: string; [key: string]: any } | null>>;
}) => {
  const { labelId, inputId } = useComboboxIds();
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const listRef = useListRef(null);

  useEffect(() => {
    setSearchValue(value?.id ?? "");
  }, [value]);

  const { contains } = Combobox.useFilter({ sensitivity: "base", value });

  const filteredItems = useMemo(() => {
    return items.filter((item) => contains(item.id, searchValue));
  }, [items, contains, searchValue]);

  return (
    <Field.Root className={styles.formField}>
      <Field.Label className={styles.fieldLabel} htmlFor={inputId} id={labelId}>
        {label}
      </Field.Label>
      <div className={styles.inputWrapper}>
        <Combobox.Root
          virtualized
          filter={contains}
          items={items}
          open={open}
          onOpenChange={setOpen}
          inputValue={searchValue}
          onInputValueChange={setSearchValue}
          itemToStringLabel={(item) => item?.id ?? ""}
          onValueChange={(newValue) => {
            setValue(newValue);
            setSearchValue(newValue?.id ?? "");
          }}
          onItemHighlighted={(item, { reason, index }) => {
            if (!item || !listRef.current) return;
            if (reason === "none" || reason === "keyboard")
              setTimeout(() => {
                listRef.current?.scrollToRow({ index: index });
              }, 0);
          }}
          value={value}
        >
          <Combobox.Input
            aria-labelledby={labelId}
            className={styles.inputControl}
            id={inputId}
          />
          <Combobox.Portal>
            <Combobox.Positioner
              align="start"
              className={styles.popupPositioner}
              sideOffset={4}
            >
              <Combobox.Popup className={styles.popup}>
                {!filteredItems.length && (
                  <div
                    aria-atomic={true}
                    aria-live="polite"
                    className={styles.noResults}
                    role="status"
                  >
                    No results
                  </div>
                )}
                {filteredItems.length > 0 && (
                  <List
                    aria-orientation="vertical"
                    className={styles.popupList}
                    listRef={listRef}
                    role="listbox"
                    rowComponent={RowComponent}
                    rowCount={filteredItems.length}
                    rowHeight={30}
                    rowProps={{ filteredItems }}
                  />
                )}
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </Combobox.Root>
      </div>
      {children}
    </Field.Root>
  );
};

const ToolbarSection = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className={styles.section}>
    <h2 className={styles.sectionHeading}>{title}</h2>
    {children}
  </section>
);

const AboutSection = () => (
  <ToolbarSection title="About">
    <p className={styles.linkGroup}>
      <a
        className={styles.externalLink}
        href="https://github.com/danieldanhe/hyperbolic-networks"
        rel="noopener noreferrer"
        target="_blank"
      >
        GitHub repository
      </a>{" "}
      &middot;{" "}
      <a
        className={styles.externalLink}
        href="https://github.com/danieldanhe/hyperbolic-networks/releases/"
        rel="noopener noreferrer"
        target="_blank"
      >
        Presentation
      </a>
    </p>
    <p className={styles.licenceText}>
      Code licensed under{" "}
      <a
        className={styles.externalLink}
        href="https://github.com/danieldanhe/hyperbolic-networks/blob/main/LICENSE"
        rel="noopener noreferrer"
        target="_blank"
      >
        the Apache License 2.0
      </a>
    </p>
  </ToolbarSection>
);

const NetworkStatistics = ({ stats }: { stats: NetworkStats | undefined }) =>
  stats && (
    <div className={styles.fieldGroup} role="group">
      <h3 className={styles.groupLabel}>Network statistics</h3>
      <dl className={styles.statsList}>
        <StatItem label="Nodes" numberType="integer" value={stats.N} />
        <StatItem
          label="Average degree"
          numberType="decimal"
          value={stats.kBar}
        />
        <StatItem
          label={
            <>
              Power law <var>γ</var>
            </>
          }
          numberType="decimal"
          value={stats.gamma}
        />
        <StatItem
          label="Clustering"
          numberType="decimal"
          value={stats.clustering}
        />
      </dl>
    </div>
  );

const ViewSection = ({
  nodes,
  panR,
  setPanR,
  panTheta,
  setPanTheta,
  zoom,
  setZoom,
  selectedNode,
  setSelectedNode,
}: {
  nodes: EmbeddedNode[];
  panR: number;
  setPanR: Dispatch<SetStateAction<number>>;
  panTheta: number;
  setPanTheta: Dispatch<SetStateAction<number>>;
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  selectedNode: EmbeddedNode | null;
  setSelectedNode: Dispatch<SetStateAction<EmbeddedNode | null>>;
}) => (
  <ToolbarSection title="View">
    <Fieldset.Root className={styles.fieldGroup}>
      <Fieldset.Legend className={styles.groupLabel} render={<legend />}>
        Centre
      </Fieldset.Legend>
      <ul className={styles.fieldList} role="list">
        <CoordinateInput
          label="r"
          onValueChange={(newValue) => setPanR(newValue ? +newValue : 0)}
          value={round(panR, 4)}
        />
        <CoordinateInput
          label="θ"
          onValueChange={(newValue) =>
            setPanTheta(newValue ? (+newValue * Math.PI) / 180 : 0)
          }
          value={round((panTheta * 180) / Math.PI, 2)}
        />
      </ul>
    </Fieldset.Root>
    <Field.Root className={styles.formField}>
      <Field.Label className={styles.fieldLabel}>Zoom</Field.Label>
      <div className={styles.inputWrapper}>
        <Field.Control
          className={styles.inputControl}
          onValueChange={(newValue) => setZoom(newValue ? +newValue : 1)}
          type="number"
          value={round(zoom, 4)}
        />
      </div>
    </Field.Root>
    {nodes && (
      <LabelledCombobox
        items={nodes}
        label="Selected node"
        value={selectedNode}
        setValue={
          setSelectedNode as Dispatch<
            SetStateAction<{ [key: string]: any; id: string } | null>
          >
        }
      >
        {selectedNode && (
          <dl className={styles.statsList}>
            <StatItem
              label={<var>r</var>}
              numberType="decimal"
              value={selectedNode.r}
            />
            <StatItem
              degrees
              label={<var>θ</var>}
              numberType="decimal"
              value={(selectedNode.theta * 180) / Math.PI}
            />
            <StatItem
              label={<var>κ</var>}
              numberType="decimal"
              value={selectedNode.kappa}
            />
            <StatItem
              label="Degree"
              numberType="integer"
              value={selectedNode.degree}
            />
          </dl>
        )}
      </LabelledCombobox>
    )}
  </ToolbarSection>
);

const DataSection = ({
  stats,
  datasets,
  selectedDataset,
  setSelectedDataset,
}: {
  stats: NetworkStats | undefined;
  datasets: Dataset[];
  selectedDataset: Dataset | null;
  setSelectedDataset: Dispatch<SetStateAction<Dataset | null>>;
}) => {
  return (
    <ToolbarSection title="Data">
      <LabelledCombobox
        items={datasets}
        label="Dataset"
        value={selectedDataset}
        setValue={
          setSelectedDataset as Dispatch<
            SetStateAction<{ [key: string]: any; id: string } | null>
          >
        }
      />
      <NetworkStatistics stats={stats} />
    </ToolbarSection>
  );
};

const RoutingPathDisplay = ({
  routingResult,
  selectedNode,
  setSelectedNode,
}: {
  routingResult: RoutingResult | null;
  selectedNode: EmbeddedNode | null;
  setSelectedNode: Dispatch<SetStateAction<EmbeddedNode | null>>;
}) => {
  if (!routingResult || !routingResult.success) return null;

  return (
    <div className={styles.fieldGroup} role="group">
      <h3 className={styles.groupLabel}>Path</h3>
      <ol className={styles.pathList} role="list">
        {routingResult.path.map((node, index) => {
          const [isHovered, setIsHovered] = useState(false);
          const isMeetingPoint = routingResult.meetingNode === node;
          const isRouteEndpoint =
            index === 0 || index === routingResult.path.length - 1;
          const isSelected = selectedNode === node;

          let colour = isHovered ? "#66BB6A" : "#A5D6A7";
          if (isMeetingPoint) {
            colour = isHovered ? "#FFA726" : "#FFCC80";
          } else if (isRouteEndpoint) {
            colour = isHovered ? "#AB47BC" : "#CE93D8";
          } else if (isSelected) {
            colour = isHovered ? "#EF5350" : "#EF9A9A";
          }

          return (
            <li className={styles.pathListItem} key={`${node.id}-${index}`}>
              <button
                className={styles.pathListButton}
                onClick={() =>
                  setSelectedNode(selectedNode === node ? null : node)
                }
                onMouseOver={() => setIsHovered(true)}
                onMouseOut={() => setIsHovered(false)}
                style={{ backgroundColor: colour }}
              >
                {node.id}
                {isMeetingPoint && " (meeting point)"}
                {isRouteEndpoint && " (endpoint)"}
                {isSelected && " (selected)"}
              </button>
            </li>
          );
        })}
      </ol>
      <p className={styles.inputHelp}>
        Click on a node to select or deselect it.
      </p>
    </div>
  );
};

const RoutingSection = ({
  nodes,
  startRouteNode,
  setStartRouteNode,
  endRouteNode,
  setEndRouteNode,
  routingResult,
  selectedNode,
  setSelectedNode,
}: {
  nodes: EmbeddedNode[];
  startRouteNode: EmbeddedNode | null;
  setStartRouteNode: Dispatch<SetStateAction<EmbeddedNode | null>>;
  endRouteNode: EmbeddedNode | null;
  setEndRouteNode: Dispatch<SetStateAction<EmbeddedNode | null>>;
  routingResult: RoutingResult | null;
  selectedNode: EmbeddedNode | null;
  setSelectedNode: Dispatch<SetStateAction<EmbeddedNode | null>>;
}) => (
  <ToolbarSection title="Routing">
    <LabelledCombobox
      items={nodes}
      label="Start node"
      value={startRouteNode}
      setValue={
        setStartRouteNode as Dispatch<
          SetStateAction<{ [key: string]: any; id: string } | null>
        >
      }
    />
    <LabelledCombobox
      items={nodes}
      label="End node"
      value={endRouteNode}
      setValue={
        setEndRouteNode as Dispatch<
          SetStateAction<{ [key: string]: any; id: string } | null>
        >
      }
    />
    {routingResult && routingResult.success && (
      <>
        <dl className={styles.statsList}>
          <StatItem
            label="Path length"
            numberType="integer"
            value={routingResult.pathLength}
          />
          <StatItem
            label="Stretch"
            numberType="decimal"
            value={routingResult.stretch}
          />
          <StatItem
            label="Distance"
            numberType="decimal"
            value={routingResult.distance}
          />
        </dl>
        <RoutingPathDisplay
          routingResult={routingResult}
          selectedNode={selectedNode}
          setSelectedNode={setSelectedNode}
        />
      </>
    )}
    {routingResult && !routingResult.success && (
      <p className={styles.inputHelp}>No path found</p>
    )}
  </ToolbarSection>
);

const App = () => {
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [selectedDataset, setSelectedDataset] = useState<Dataset | null>(null);
  const [csvContent, setCsvContent] = useState<string>("");

  useEffect(() => {
    const loadDatasets = async () => {
      try {
        const response = await fetch("/datasets.csv");
        const csvText = await response.text();
        const lines = csvText.split("\n").slice(1);
        const loadedDatasets: Dataset[] = [];

        for (const line of lines) {
          if (line.trim()) {
            const [label, filename] = line.split(",");
            loadedDatasets.push({ id: label, filename: filename.trim() });
          }
        }

        setDatasets(loadedDatasets);
      } catch (error) {
        console.error("Failed to load datasets:", error);
      }
    };

    loadDatasets();
  }, []);

  useEffect(() => {
    const loadDatasetContent = async () => {
      if (!selectedDataset) return;

      try {
        const response = await fetch(`/${selectedDataset.filename}`);
        const content = await response.text();
        setCsvContent(content);
      } catch (error) {
        console.error("Failed to load dataset content:", error);
      }
    };

    loadDatasetContent();
  }, [selectedDataset]);

  const [nodes, setNodes] = useState<EmbeddedNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [stats, setStats] = useState<NetworkStats>();

  useEffect(() => {
    if (!csvContent) return;

    setEdges(parseCSV(csvContent));
    embedNetwork(csvContent).then((output) => {
      setNodes(output.nodes);
      setStats(output.stats);
    });
  }, [csvContent]);

  const [panR, setPanR] = useState(0);
  const [panTheta, setPanTheta] = useState(0);
  const [zoom, setZoom] = useState(1);

  const [selectedNode, setSelectedNode] = useState<EmbeddedNode | null>(null);

  const [startRouteNode, setStartRouteNode] = useState<EmbeddedNode | null>(
    null
  );
  const [endRouteNode, setEndRouteNode] = useState<EmbeddedNode | null>(null);
  const [routingResult, setRoutingResult] = useState<RoutingResult | null>(
    null
  );

  const adjacency = useMemo(() => {
    const adj = new Map<string, Set<string>>();
    for (const edge of edges) {
      if (!adj.has(edge.source)) adj.set(edge.source, new Set());
      if (!adj.has(edge.target)) adj.set(edge.target, new Set());
      adj.get(edge.source)!.add(edge.target);
      adj.get(edge.target)!.add(edge.source);
    }
    return adj;
  }, [edges]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, EmbeddedNode>();
    nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [nodes]);

  useEffect(() => {
    if (startRouteNode && endRouteNode && adjacency && nodeMap) {
      const result = bidirectionalGreedyRouting(
        startRouteNode,
        endRouteNode,
        adjacency,
        nodeMap
      );
      setRoutingResult(result);
    } else {
      setRoutingResult(null);
    }
  }, [startRouteNode, endRouteNode, adjacency, nodeMap]);

  return (
    <StrictMode>
      <ScreenReaderNotice />
      <aside className={styles.toolbar}>
        <ViewSection
          nodes={nodes}
          panR={panR}
          setPanR={setPanR}
          panTheta={panTheta}
          setPanTheta={setPanTheta}
          zoom={zoom}
          setZoom={setZoom}
          selectedNode={selectedNode}
          setSelectedNode={setSelectedNode}
        />
        <DataSection
          stats={stats}
          datasets={datasets}
          selectedDataset={selectedDataset}
          setSelectedDataset={setSelectedDataset}
        />
        <RoutingSection
          nodes={nodes}
          startRouteNode={startRouteNode}
          setStartRouteNode={setStartRouteNode}
          endRouteNode={endRouteNode}
          setEndRouteNode={setEndRouteNode}
          routingResult={routingResult}
          selectedNode={selectedNode}
          setSelectedNode={setSelectedNode}
        />
        <AboutSection />
      </aside>
      <main className={styles.visualization}>
        <Disc
          nodes={nodes}
          edges={edges}
          panR={panR}
          setPanR={setPanR}
          panTheta={panTheta}
          setPanTheta={setPanTheta}
          zoom={zoom}
          setZoom={setZoom}
          selectedNode={selectedNode}
          setSelectedNode={setSelectedNode}
          routingResult={routingResult}
        />
      </main>
    </StrictMode>
  );
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
