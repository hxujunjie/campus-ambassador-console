import { describe, expect, it } from "vitest";
import {
  calculate,
  countText,
  emptyRow,
  planImport,
  removeRow,
  rowSchema,
  seedWorkspace,
  toCSV,
  workspaceSchema,
} from "../src/domain";

describe("真实数据统计口径", () => {
  it("不把团队成果、上界和退出记录并入非团队拉新记录", () => {
    const w = seedWorkspace();
    const m = calculate(w.rows);
    expect(m.channelCount).toBe(5);
    expect(m.teamCount).toBe(31);
    expect(m.exits).toBe(4);
    expect(m.groupCount).toBeNull();
    expect(w.rows.every((r) => !r.date && !r.dueDate)).toBe(true);
    expect(countText(w.rows.find((r) => r.id === "seed-evening")!)).toBe("< 3");
    expect(w.rows.find((r) => r.id === "seed-friends")!.attribution).toBe(
      "团队",
    );
  });
  it("未知成员数不按零计算；实测零有效", () => {
    const a = {
      ...emptyRow("communities"),
      count: 0,
      countMode: "exact" as const,
      status: "已确认" as const,
    };
    expect(calculate([a]).groupCount).toBe(0);
    expect(calculate([a, emptyRow("communities")]).groupCount).toBeNull();
  });
  it("只把已设截止日期且未完成/取消的任务判断为逾期", () => {
    const a = { ...emptyRow("tasks"), dueDate: "2026-10-01" };
    expect(
      calculate(
        [
          a,
          { ...a, id: "b", status: "已完成" },
          { ...a, id: "c", dueDate: "" },
        ],
        "2026-11-02",
      ).overdue,
    ).toHaveLength(1);
  });
  it("拒绝负数、上界零、无效日期和危险链接", () => {
    const a = emptyRow("recruitment");
    for (const patch of [
      { count: -1 },
      { count: 0, countMode: "lt" },
      { date: "2026-02-30" },
      { evidence: "javascript:alert(1)" },
      { count: 4, countMode: "unknown" },
    ])
      expect(rowSchema.safeParse({ ...a, ...patch }).success).toBe(false);
  });
});
describe("关系与导入", () => {
  it("删除父记录时解除引用，保留运营记录", () => {
    const w = seedWorkspace();
    const next = removeRow(w, "seed-evening");
    expect(next.rows.find((r) => r.id === "setup-count")?.relatedId).toBe("");
    expect(workspaceSchema.safeParse(next).success).toBe(true);
  });
  it("拒绝悬空引用与重复来源", () => {
    const w = seedWorkspace();
    w.rows[0].groupId = "missing";
    expect(workspaceSchema.safeParse(w).success).toBe(false);
    w.rows[0].groupId = "";
    w.rows[0].sourceKey = "same";
    w.rows[1].sourceKey = "same";
    expect(workspaceSchema.safeParse(w).success).toBe(false);
  });
  it("重复 JSON 导入幂等，冲突默认保留本地", () => {
    const w = seedWorkspace();
    const same = planImport(w, structuredClone(w));
    expect(same.added).toBe(0);
    expect(same.updated).toBe(0);
    expect(same.skipped).toBe(w.rows.length);
    const modified = structuredClone(w);
    modified.rows[0].notes = "另一个版本";
    const conflict = planImport(w, modified);
    expect(conflict.conflicts).toBe(1);
    expect(conflict.next.rows[0].notes).toBe(w.rows[0].notes);
    expect(planImport(w, modified, true).next.rows[0].notes).toBe("另一个版本");
  });
  it("企业微信来源去重，并拒绝无稳定来源的候选记录", () => {
    const w = seedWorkspace();
    const r = {
      ...emptyRow("interactions"),
      source: "企业微信 CLI",
      sourceKey: "stable-key",
    };
    const batch = { type: "wecom-candidates", version: 1, rows: [r] };
    const first = planImport(w, batch);
    expect(first.added).toBe(1);
    expect(planImport(first.next, batch).added).toBe(0);
    expect(() =>
      planImport(w, { ...batch, rows: [{ ...r, sourceKey: "" }] }),
    ).toThrow();
  });
  it("不执行导入文件中的文本；CSV 保护公式并正确转义", () => {
    const r = {
      ...emptyRow("content"),
      title: '=HYPERLINK("bad")',
      notes: '逗号,换行\n双引号"',
    };
    const csv = toCSV([r]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('双引号""');
    expect(csv.startsWith("\uFEFF")).toBe(true);
  });
});
