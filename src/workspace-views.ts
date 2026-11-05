import { kinds, type Kind, type Row } from "./domain";

export const MAX_RECORDS = 3000;
export const MAX_WORKSPACE_BYTES = 750 * 1024;
export const PAGE_SIZE = 50;
export const BOARD_PAGE_SIZE = 20;
export const SAVED_VIEWS_KEY = "campus-console:saved-views:v1";
export const DRAFT_KEY = "campus-console:editor-draft:v1";

export type TimeMode =
  | "all"
  | "week"
  | "month"
  | "lastMonth"
  | "custom"
  | "undated";
export type Preset = "" | "open" | "history" | "draft" | "verify" | "published";
export type Layout = "table" | "board" | "cards";
export type ViewState = {
  query: string;
  status: string;
  source: string;
  direction: string;
  start: string;
  end: string;
  sort: string;
  channel: string;
  attribution: string;
  exactOnly: boolean;
  preset: Preset;
  timeMode: TimeMode;
  layout: Layout;
  page: number;
  groupByMonth: boolean;
};
export type SavedView = ViewState & { id: string; kind: Kind; name: string };

export function initialView(kind: Kind): ViewState {
  return {
    query: "",
    status: "",
    source: "",
    direction: "",
    start: "",
    end: "",
    sort: "updated",
    channel: "",
    attribution: "",
    exactOnly: false,
    preset: kind === "tasks" ? "open" : "",
    timeMode: "all",
    layout: kind === "tasks" ? "board" : "table",
    page: 1,
    groupByMonth: false,
  };
}

export function beijingDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((key) => parts.find((p) => p.type === key)!.value)
    .join("-");
}

export function dateRange(mode: TimeMode, today: string, start = "", end = "") {
  if (mode === "custom") return { start, end };
  if (mode === "all" || mode === "undated") return { start: "", end: "" };
  const date = new Date(`${today}T00:00:00Z`);
  if (mode === "week") {
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const first = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 6);
    return { start: first, end: date.toISOString().slice(0, 10) };
  }
  const offset = mode === "lastMonth" ? -1 : 0;
  const year = date.getUTCFullYear(),
    month = date.getUTCMonth() + offset;
  return {
    start: new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10),
  };
}

export function recordDate(row: Row) {
  return row.kind === "tasks" ? row.dueDate : row.date;
}

export function inPeriod(
  date: string,
  range: { start: string; end: string },
  undated = false,
) {
  if (undated) return !date;
  return (
    (!range.start || (!!date && date >= range.start)) &&
    (!range.end || (!!date && date <= range.end))
  );
}

export function filterRows(
  rows: Row[],
  kind: Kind,
  view: ViewState,
  today: string,
) {
  const range = dateRange(view.timeMode, today, view.start, view.end);
  const query = view.query.trim().toLocaleLowerCase();
  return rows
    .filter(
      (row) =>
        row.kind === kind &&
        (!query ||
          `${row.title} ${row.notes} ${row.channel} ${row.category}`
            .toLocaleLowerCase()
            .includes(query)) &&
        (!view.status || row.status === view.status) &&
        (!view.source || row.source === view.source) &&
        (!view.direction || row.direction === view.direction) &&
        (!view.channel || (row.channel || row.title) === view.channel) &&
        (!view.attribution || row.attribution === view.attribution) &&
        (!view.exactOnly || row.countMode === "exact") &&
        (view.preset !== "open" ||
          !["已完成", "已取消"].includes(row.status)) &&
        (view.preset !== "history" ||
          ["已完成", "已取消"].includes(row.status)) &&
        (view.preset !== "draft" ||
          !["已发布", "已取消"].includes(row.status)) &&
        (view.preset !== "verify" ||
          ["待核实", "未量化"].includes(row.status)) &&
        (view.preset !== "published" || row.status === "已发布") &&
        inPeriod(recordDate(row), range, view.timeMode === "undated"),
    )
    .sort((a, b) => {
      if (view.sort === "title") return a.title.localeCompare(b.title, "zh");
      if (view.sort === "date")
        return (
          recordDate(b).localeCompare(recordDate(a)) ||
          b.updatedAt.localeCompare(a.updatedAt)
        );
      return b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
    });
}

export function parseSavedViews(raw: string | null): SavedView[] {
  try {
    const data: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(data)) return [];
    const views: SavedView[] = [];
    for (const entry of data) {
      if (
        !entry ||
        typeof entry !== "object" ||
        !kinds.includes(entry.kind) ||
        typeof entry.id !== "string" ||
        typeof entry.name !== "string" ||
        !entry.name.trim() ||
        entry.name.length > 32
      )
        continue;
      const base = initialView(entry.kind);
      const textFields = [
        "query",
        "status",
        "source",
        "direction",
        "start",
        "end",
        "sort",
        "channel",
        "attribution",
      ] as const;
      for (const key of textFields)
        if (typeof entry[key] === "string") base[key] = entry[key];
      if (
        ["", "open", "history", "draft", "verify", "published"].includes(
          entry.preset,
        )
      )
        base.preset = entry.preset;
      else base.preset = "";
      if (
        ["all", "week", "month", "lastMonth", "custom", "undated"].includes(
          entry.timeMode,
        )
      )
        base.timeMode = entry.timeMode;
      else base.timeMode = base.start || base.end ? "custom" : "all";
      if (["table", "board", "cards"].includes(entry.layout))
        base.layout = entry.layout;
      base.groupByMonth = entry.groupByMonth === true;
      base.exactOnly = entry.exactOnly === true;
      views.push({
        ...base,
        id: entry.id,
        kind: entry.kind,
        name: entry.name.trim(),
      });
    }
    return views.slice(0, 40);
  } catch {
    return [];
  }
}

export function groupMonths(rows: Row[]) {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const month = recordDate(row).slice(0, 7);
    const group = groups.get(month) ?? [];
    group.push(row);
    groups.set(month, group);
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a));
}

export function aggregateChannels(rows: Row[]) {
  const data = new Map<
    string,
    {
      key: string;
      name: string;
      channel: string;
      attribution: Row["attribution"];
      value: number;
    }
  >();
  for (const row of rows) {
    if (
      row.kind !== "recruitment" ||
      row.direction !== "新增" ||
      row.countMode !== "exact" ||
      row.status !== "已确认"
    )
      continue;
    const channel = row.channel || row.title;
    const key = JSON.stringify([channel, row.attribution]);
    const entry = data.get(key) ?? {
      key,
      name: `${channel} · ${row.attribution}`,
      channel,
      attribution: row.attribution,
      value: 0,
    };
    entry.value += row.count ?? 0;
    data.set(key, entry);
  }
  return [...data.values()].sort(
    (a, b) => b.value - a.value || a.name.localeCompare(b.name, "zh"),
  );
}

export function relatedRows(row: Row, rows: Row[]) {
  const ids = new Set(
    [row.groupId, row.activityId, row.relatedId].filter(Boolean),
  );
  return rows.filter(
    (other) =>
      other.id !== row.id &&
      (ids.has(other.id) ||
        [other.groupId, other.activityId, other.relatedId].includes(row.id)),
  );
}
