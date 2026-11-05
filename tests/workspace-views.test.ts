import { describe, expect, it } from "vitest";
import { emptyRow, type Row } from "../src/domain";
import {
  aggregateChannels,
  beijingDate,
  dateRange,
  filterRows,
  groupMonths,
  initialView,
  parseSavedViews,
} from "../src/workspace-views";

function record(fields: Partial<Row>): Row {
  return { ...emptyRow(fields.kind ?? "recruitment"), ...fields };
}

describe("长期视图的日期和旧数据兼容", () => {
  it("按北京时间跨日，并正确计算跨年与闰月范围", () => {
    expect(beijingDate(new Date("2026-11-05T16:01:00Z"))).toBe("2026-11-06");
    expect(dateRange("lastMonth", "2026-01-10")).toEqual({
      start: "2025-12-01",
      end: "2025-12-31",
    });
    expect(dateRange("month", "2024-02-18")).toEqual({
      start: "2024-02-01",
      end: "2024-02-29",
    });
    expect(dateRange("week", "2026-11-01")).toEqual({
      start: "2026-10-26",
      end: "2026-11-01",
    });
  });

  it("保存的本周规则跨周重新计算，固定日期保持原范围", () => {
    const saved = parseSavedViews(
      JSON.stringify([
        {
          ...initialView("content"),
          id: "weekly",
          kind: "content",
          name: "每周内容",
          timeMode: "week",
        },
      ]),
    );
    expect(dateRange(saved[0].timeMode, "2026-11-05")).toEqual({
      start: "2026-11-02",
      end: "2026-11-08",
    });
    expect(dateRange(saved[0].timeMode, "2026-11-12")).toEqual({
      start: "2026-11-09",
      end: "2026-11-15",
    });
    expect(
      dateRange("custom", "2026-11-12", "2026-10-01", "2026-10-31"),
    ).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  });

  it("V1.2 保存视图按原日期迁移，不猜测为动态本周", () => {
    const saved = parseSavedViews(
      JSON.stringify([
        {
          id: "old",
          kind: "tasks",
          name: "旧视图",
          query: "",
          status: "",
          source: "",
          direction: "",
          start: "2026-10-01",
          end: "2026-10-31",
          sort: "date",
          channel: "",
          layout: "table",
        },
      ]),
    );
    expect(saved[0]).toMatchObject({
      timeMode: "custom",
      layout: "table",
      preset: "",
      start: "2026-10-01",
    });
    expect(parseSavedViews("invalid")).toEqual([]);
  });

  it("默认待办保留跨月未完成任务，历史任务有独立入口", () => {
    const rows = [
      record({
        id: "old-open",
        kind: "tasks",
        status: "进行中",
        dueDate: "2025-12-01",
      }),
      record({
        id: "closed",
        kind: "tasks",
        status: "已完成",
        dueDate: "2026-11-05",
      }),
    ];
    expect(
      filterRows(rows, "tasks", initialView("tasks"), "2026-11-05").map(
        (row) => row.id,
      ),
    ).toEqual(["old-open"]);
    expect(
      filterRows(
        rows,
        "tasks",
        { ...initialView("tasks"), preset: "history" },
        "2026-11-05",
      ).map((row) => row.id),
    ).toEqual(["closed"]);
  });

  it("缺失日期通过专门入口检索，并按年与月组织历史", () => {
    const rows = [
      record({ id: "unknown", date: "" }),
      record({ id: "oct", date: "2026-10-06" }),
      record({ id: "nov", date: "2026-11-05" }),
    ];
    expect(
      filterRows(
        rows,
        "recruitment",
        { ...initialView("recruitment"), timeMode: "undated" },
        "2026-11-05",
      ).map((row) => row.id),
    ).toEqual(["unknown"]);
    expect(groupMonths(rows).map(([month]) => month)).toEqual([
      "2026-11",
      "2026-10",
      "",
    ]);
  });
});

describe("渠道图表与明细采用同一口径", () => {
  it("按渠道和归属汇总，保留确切值并排除上界与未知", () => {
    const rows = [
      record({
        id: "one",
        channel: "走班",
        attribution: "团队",
        status: "已确认",
        direction: "新增",
        countMode: "exact",
        count: 7,
      }),
      record({
        id: "two",
        channel: "走班",
        attribution: "团队",
        status: "已确认",
        direction: "新增",
        countMode: "exact",
        count: 2,
      }),
      record({
        id: "personal",
        channel: "走班",
        attribution: "个人",
        status: "已确认",
        direction: "新增",
        countMode: "exact",
        count: 1,
      }),
      record({
        id: "upper",
        channel: "走班",
        attribution: "团队",
        status: "已确认",
        direction: "新增",
        countMode: "lt",
        count: 3,
      }),
    ];
    expect(
      aggregateChannels(rows).map((entry) => [entry.attribution, entry.value]),
    ).toEqual([
      ["团队", 9],
      ["个人", 1],
    ]);
    const detail = filterRows(
      rows,
      "recruitment",
      {
        ...initialView("recruitment"),
        channel: "走班",
        attribution: "团队",
        direction: "新增",
        status: "已确认",
        exactOnly: true,
      },
      "2026-11-05",
    );
    expect(detail.reduce((total, row) => total + (row.count ?? 0), 0)).toBe(9);
  });
});
