import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  Fragment,
  StrictMode,
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

const useComboboxIds = () => {
  const labelId = useId();
  const inputId = useId();
  return { labelId, inputId };
};

const placeholderData = Array.from({ length: 10000 }, (_, i) => {
  const indexLabel = String(i + 1).padStart(4, "0");
  return { id: String(i), value: `Item ${indexLabel}` };
});

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
  label,
  value,
  numberType,
}: {
  label: string | ReactNode;
  value: string | number;
  numberType?: "whole" | "decimal";
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
      const formatted = `${intPart}.${groupedFrac}e+${exponent}`;
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
      const accessible = `${mantissa} times 10 to the ${exponentOrdinal} power`;
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
    const formatted = fracStr ? `${groupedInt}.${groupedFrac}` : groupedInt;
    const accessible = rounded;
    return { formatted, accessible };
  };

  const toDisplay: { formatted: string; accessible: string } =
    typeof value === "number" && numberType === "whole"
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

const ITEM_HEIGHT = 30;

const RowComponent = ({
  index,
  style,
  filteredItems,
}: RowComponentProps<{ filteredItems: { id: string; value: string }[] }>) => {
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
      {item.value}
    </Combobox.Item>
  );
};

const LabelledCombobox = ({
  items,
  label,
}: //required,
{
  items: { id: string; value: string }[];
  label: string | ReactNode;
  //required?: boolean;
}) => {
  const { labelId, inputId } = useComboboxIds();
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [value, setValue] = useState<{ id: string; value: string } | null>(
    null
  );
  const listRef = useListRef(null);

  const { contains } = Combobox.useFilter({ sensitivity: "base", value });

  const filteredItems = useMemo(() => {
    return items.filter((item) => contains(item.value, searchValue));
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
          value={value}
          onValueChange={(newValue) => {
            setValue(newValue);
            setSearchValue(newValue?.value ?? "");
          }}
          onItemHighlighted={(item, { reason, index }) => {
            if (!item || !listRef.current) return;
            if (reason === "none" || reason === "keyboard")
              setTimeout(() => {
                listRef.current?.scrollToRow({ index: index });
              }, 0);
          }}
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
                    rowHeight={ITEM_HEIGHT}
                    rowProps={{ filteredItems }}
                  />
                )}
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        </Combobox.Root>
      </div>
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

const NetworkStatistics = () => (
  <div className={styles.fieldGroup} role="group">
    <h3 className={styles.groupLabel}>Network statistics</h3>
    <dl className={styles.statsList}>
      <StatItem label="Nodes" numberType="whole" value={12345678901234567890} />
      <StatItem
        label="Connections"
        numberType="whole"
        value={12345678901234567890}
      />
      <StatItem
        label={
          <>
            Power law <var>γ</var>
          </>
        }
        numberType="decimal"
        value={2.3456789012345678901}
      />
      <StatItem
        label="Clustering"
        numberType="decimal"
        value={0.1234567890123456789}
      />
    </dl>
  </div>
);

const ViewSection = ({
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
          helpText="in degrees"
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
    <LabelledCombobox items={placeholderData} label="Highlight node" />
  </ToolbarSection>
);

const DataSection = () => (
  <ToolbarSection title="Data">
    <LabelledCombobox items={placeholderData} label="Dataset" />
    <NetworkStatistics />
  </ToolbarSection>
);

const RoutingSection = () => (
  <ToolbarSection title="Routing">
    <LabelledCombobox items={placeholderData} label="Start node" />
    <LabelledCombobox items={placeholderData} label="End node" />
  </ToolbarSection>
);

const App = () => {
  const [panR, setPanR] = useState(0);
  const [panTheta, setPanTheta] = useState(0);
  const [zoom, setZoom] = useState(1);

  return (
    <StrictMode>
      <ScreenReaderNotice />
      <aside className={styles.toolbar}>
        <ViewSection
          panR={panR}
          setPanR={setPanR}
          panTheta={panTheta}
          setPanTheta={setPanTheta}
          zoom={zoom}
          setZoom={setZoom}
        />
        <DataSection />
        <RoutingSection />
        <AboutSection />
      </aside>
      <main className={styles.visualization}>
        <Disc
          panR={panR}
          setPanR={setPanR}
          panTheta={panTheta}
          setPanTheta={setPanTheta}
          zoom={zoom}
          setZoom={setZoom}
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
