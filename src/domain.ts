import { z } from "zod";

export const kinds = [
  "recruitment",
  "communities",
  "interactions",
  "activities",
  "content",
  "tasks",
  "reviews",
] as const;
export type Kind = (typeof kinds)[number];
export const labels: Record<Kind, string> = {
  recruitment: "拉新记录",
  communities: "社群档案",
  interactions: "运营记录",
  activities: "活动",
  content: "内容",
  tasks: "任务",
  reviews: "成果与复盘",
};
export const statuses = [
  "待核实",
  "已确认",
  "未量化",
  "待办",
  "进行中",
  "已完成",
  "已发布",
  "已取消",
] as const;
const optionalDate = z
  .string()
  .refine(
    (v) =>
      !v ||
      (/^\d{4}-\d{2}-\d{2}$/.test(v) &&
        !Number.isNaN(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v),
    "日期无效",
  );
export const rowSchema = z
  .object({
    id: z.string().min(1).max(150),
    kind: z.enum(kinds),
    title: z.string().trim().min(1, "请填写名称").max(160),
    status: z.enum(statuses),
    date: optionalDate.default(""),
    dueDate: optionalDate.default(""),
    channel: z.string().max(100).default(""),
    category: z.string().max(80).default(""),
    count: z.number().int().min(0).max(10000000).nullable().default(null),
    countMode: z.enum(["exact", "lt", "unknown"]).default("unknown"),
    attribution: z.enum(["个人", "团队", "未明确"]).default("未明确"),
    direction: z.enum(["新增", "退出", "其他"]).default("其他"),
    groupId: z.string().max(150).default(""),
    activityId: z.string().max(150).default(""),
    relatedId: z.string().max(150).default(""),
    priority: z.enum(["高", "中", "低"]).default("中"),
    notes: z.string().max(10000).default(""),
    evidence: z
      .string()
      .max(2000)
      .refine((v) => !v || /^https?:\/\//i.test(v), "证据链接须为 HTTP(S) 地址")
      .default(""),
    source: z
      .enum(["用户提供", "手动录入", "企业微信 CLI", "系统建议"])
      .default("手动录入"),
    sourceKey: z.string().max(300).default(""),
    sourceUpdatedAt: z.string().max(50).default(""),
    attachment: z.string().max(2000).default(""),
    updatedAt: z.string().max(50),
  })
  .superRefine((v, ctx) => {
    if (v.countMode !== "unknown" && v.count === null)
      ctx.addIssue({
        code: "custom",
        message: "请填写数量或改为未量化",
        path: ["count"],
      });
    if (v.countMode === "unknown" && v.count !== null)
      ctx.addIssue({
        code: "custom",
        message: "未量化时数量应为空",
        path: ["count"],
      });
    if (v.countMode === "lt" && v.count === 0)
      ctx.addIssue({
        code: "custom",
        message: "小于的上界必须大于 0",
        path: ["count"],
      });
  });
export type Row = z.infer<typeof rowSchema>;
export const workspaceSchema = z
  .object({
    schemaVersion: z.literal(1),
    rows: z.array(rowSchema).max(3000),
    updatedAt: z.string().max(50),
    lastImportAt: z.string().max(50).default(""),
  })
  .superRefine((v, ctx) => {
    const ids = new Set<string>();
    const sourceKeys = new Set<string>();
    for (const row of v.rows) {
      if (ids.has(row.id))
        ctx.addIssue({ code: "custom", message: "存在重复记录标识" });
      ids.add(row.id);
      if (row.sourceKey) {
        if (sourceKeys.has(row.sourceKey))
          ctx.addIssue({ code: "custom", message: "来源记录重复" });
        sourceKeys.add(row.sourceKey);
      }
    }
    for (const row of v.rows) {
      if (
        row.groupId &&
        !v.rows.some((r) => r.id === row.groupId && r.kind === "communities")
      )
        ctx.addIssue({
          code: "custom",
          message: `${row.title} 关联的社群不存在`,
        });
      if (
        row.activityId &&
        !v.rows.some((r) => r.id === row.activityId && r.kind === "activities")
      )
        ctx.addIssue({
          code: "custom",
          message: `${row.title} 关联的活动不存在`,
        });
      if (
        row.relatedId &&
        (!ids.has(row.relatedId) || row.relatedId === row.id)
      )
        ctx.addIssue({
          code: "custom",
          message: `${row.title} 的关联记录无效`,
        });
    }
  });
export type Workspace = z.infer<typeof workspaceSchema>;
export function emptyRow(kind: Kind): Row {
  return rowSchema.parse({
    id: crypto.randomUUID(),
    kind,
    status: kind === "tasks" ? "待办" : "待核实",
    updatedAt: new Date().toISOString(),
    title: "新记录",
  });
}
export function seedWorkspace(): Workspace {
  const now = new Date().toISOString();
  const seed = (id: string, title: string, fields: Partial<Row>) =>
    rowSchema.parse({
      id,
      kind: "recruitment",
      title,
      status: "已确认",
      source: "用户提供",
      updatedAt: now,
      ...fields,
    });
  return {
    schemaVersion: 1,
    updatedAt: now,
    lastImportAt: "",
    rows: [
      seed("seed-competition", "比赛群推广", {
        channel: "比赛群",
        count: 5,
        countMode: "exact",
        direction: "新增",
        notes:
          "用户确认的渠道记录为 5 人；尚无成员明细，跨渠道是否重复待核验。",
      }),
      seed("seed-evening", "晚自习走班", {
        channel: "晚自习走班",
        count: 3,
        countMode: "lt",
        direction: "新增",
        status: "待核实",
        notes:
          "用户描述为不足 3 人，确切人数待核实。3 是严格上界，不是实际人数。",
      }),
      seed("seed-friends", "熟人邀请（团队共同）", {
        channel: "熟人邀请",
        count: 31,
        countMode: "exact",
        attribution: "团队",
        direction: "新增",
        notes:
          "31 人为团队共同成果，不能计为个人独立完成；与其他渠道是否重叠待核验。",
      }),
      seed("seed-clubs", "社团群推广", {
        channel: "社团群",
        direction: "新增",
        status: "未量化",
        notes: "已开展推广，新增人数尚未量化。",
      }),
      seed("seed-exits", "成员退出记录", {
        channel: "待补充",
        count: 4,
        countMode: "exact",
        direction: "退出",
        notes: "用户提供成员退出 4 人；发生日期、所属群及退出原因待补充。",
      }),
      seed("setup-count", "核实晚自习走班的实际人数", {
        kind: "tasks",
        status: "待办",
        source: "系统建议",
        priority: "高",
        relatedId: "seed-evening",
        notes: "补充可核验来源后再修改对应拉新记录。",
      }),
      seed("setup-community", "补齐社群档案与当前成员数", {
        kind: "tasks",
        status: "待办",
        source: "系统建议",
        priority: "高",
        notes: "使用实际群名和核验日期；消息条数不能用于推算群成员数。",
      }),
      seed("setup-wecom", "连接企业微信数据来源", {
        kind: "tasks",
        status: "待办",
        source: "系统建议",
        notes:
          "后续通过企业微信 CLI 抓取授权范围内的运营数据，预览并核验后入库。",
      }),
    ],
  };
}
export function countText(r: Pick<Row, "count" | "countMode">) {
  return r.countMode === "unknown" || r.count === null
    ? "未量化"
    : `${r.countMode === "lt" ? "< " : ""}${r.count}`;
}
export function calculate(
  rows: Row[],
  today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }),
) {
  const growth = rows.filter((r) => r.kind === "recruitment");
  const exact = (direction: Row["direction"], team: boolean) =>
    growth
      .filter(
        (r) =>
          r.direction === direction &&
          r.countMode === "exact" &&
          r.status === "已确认" &&
          (r.attribution === "团队") === team,
      )
      .reduce((s, r) => s + (r.count ?? 0), 0);
  const tasks = rows.filter((r) => r.kind === "tasks");
  const groups = rows.filter((r) => r.kind === "communities");
  const groupsComplete =
    groups.length > 0 &&
    groups.every(
      (r) =>
        r.countMode === "exact" && r.count !== null && r.status === "已确认",
    );
  return {
    channelCount: exact("新增", false),
    teamCount: exact("新增", true),
    exits: exact("退出", false) + exact("退出", true),
    groupCount: groupsComplete
      ? groups.reduce((s, r) => s + r.count!, 0)
      : null,
    pending: rows.filter((r) => ["待核实", "未量化"].includes(r.status)).length,
    tasks,
    openTasks: tasks.filter((r) => !["已完成", "已取消"].includes(r.status)),
    completedTasks: tasks.filter((r) => r.status === "已完成").length,
    overdue: tasks.filter(
      (r) =>
        r.dueDate &&
        r.dueDate < today &&
        !["已完成", "已取消"].includes(r.status),
    ),
    growth,
  };
}
export function removeRow(workspace: Workspace, id: string): Workspace {
  return {
    ...workspace,
    updatedAt: new Date().toISOString(),
    rows: workspace.rows
      .filter((r) => r.id !== id)
      .map((r) => ({
        ...r,
        groupId: r.groupId === id ? "" : r.groupId,
        activityId: r.activityId === id ? "" : r.activityId,
        relatedId: r.relatedId === id ? "" : r.relatedId,
      })),
  };
}
export const exportHeaders = [
  "记录类型",
  "名称",
  "状态",
  "记录日期",
  "截止日期",
  "渠道",
  "类型",
  "数量",
  "统计方式",
  "成果归属",
  "方向",
  "社群",
  "活动",
  "关联记录",
  "优先级",
  "说明",
  "证据链接",
  "来源",
  "更新时间",
];
export function toCSV(rows: Row[], all: Row[] = rows): string {
  const safe = (v: unknown) => {
    let s = String(v ?? "");
    if (/^[\s]*[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const name = (id: string) => all.find((r) => r.id === id)?.title ?? "";
  return (
    "\uFEFF" +
    [
      exportHeaders,
      ...rows.map((r) => [
        labels[r.kind],
        r.title,
        r.status,
        r.date,
        r.dueDate,
        r.channel,
        r.category,
        r.countMode === "unknown" ? "" : r.count,
        r.countMode === "exact"
          ? "确切值"
          : r.countMode === "lt"
            ? "小于"
            : "未量化",
        r.attribution,
        r.direction,
        name(r.groupId),
        name(r.activityId),
        name(r.relatedId),
        r.priority,
        r.notes,
        r.evidence,
        r.source,
        r.updatedAt,
      ]),
    ]
      .map((cols) => cols.map(safe).join(","))
      .join("\r\n")
  );
}
export type ImportPlan = {
  next: Workspace;
  added: number;
  updated: number;
  conflicts: number;
  skipped: number;
  isBackup: boolean;
};
export function planImport(
  current: Workspace,
  data: unknown,
  overwrite = false,
): ImportPlan {
  const batch = z.object({
    type: z.literal("wecom-candidates"),
    version: z.literal(1),
    rows: z.array(rowSchema).max(3000),
  });
  const parsedBatch = batch.safeParse(data);
  const imported = parsedBatch.success
    ? parsedBatch.data.rows
    : workspaceSchema.parse(data).rows;
  let added = 0,
    updated = 0,
    conflicts = 0,
    skipped = 0;
  const rows = structuredClone(current.rows);
  for (const r of imported) {
    if (parsedBatch.success && (!r.sourceKey || r.source !== "企业微信 CLI"))
      throw new Error("企业微信记录必须有稳定来源标识");
    const idx = rows.findIndex(
      (e) => e.id === r.id || (!!r.sourceKey && e.sourceKey === r.sourceKey),
    );
    if (idx < 0) {
      rows.push(r);
      added++;
    } else {
      const same =
        JSON.stringify({ ...rows[idx], id: r.id }) === JSON.stringify(r);
      if (same) {
        skipped++;
        continue;
      }
      if (!overwrite) {
        conflicts++;
        continue;
      }
      const oldId = rows[idx].id;
      if (oldId !== r.id)
        throw new Error("来源标识与记录标识不一致，请检查导入文件");
      rows[idx] = r;
      updated++;
    }
  }
  const next = workspaceSchema.parse({
    ...current,
    rows,
    updatedAt: new Date().toISOString(),
    lastImportAt: new Date().toISOString(),
  });
  return {
    next,
    added,
    updated,
    conflicts,
    skipped,
    isBackup: !parsedBatch.success,
  };
}
