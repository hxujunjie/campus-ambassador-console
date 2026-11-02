import { describe, expect, it } from "vitest";
import {
  automationTools,
  createAutomation,
  prepareMutation,
  type AutomationHost,
} from "../src/automation";
import { seedWorkspace, workspaceSchema } from "../src/domain";
import { ConflictError, type Snapshot } from "../src/repository";
function fixture() {
  let snapshot: Snapshot = { workspace: seedWorkspace(), revision: 0 };
  let writes = 0;
  let editing = false;
  const host: AutomationHost = {
    mode: "local",
    getSnapshot: () => snapshot,
    isEditing: () => editing,
    openPage: () => {},
    write: async (workspace, revision) => {
      if (snapshot.revision !== revision) throw new ConflictError();
      writes++;
      snapshot = {
        workspace: workspaceSchema.parse(workspace),
        revision: revision + 1,
      };
      return snapshot;
    },
  };
  return {
    api: createAutomation(host),
    state: () => snapshot,
    writes: () => writes,
    edit: () => {
      editing = true;
    },
  };
}
describe("GPT 网页操作契约", () => {
  it("只改任务状态，保留已有说明、关联和优先级", async () => {
    const f = fixture();
    const before = structuredClone(
      f.state().workspace.rows.find((r) => r.id === "setup-count")!,
    );
    await f.api.mutate({
      expectedRevision: 0,
      operations: [
        { type: "update", id: "setup-count", values: { status: "已完成" } },
      ],
    });
    const after = f.state().workspace.rows.find((r) => r.id === "setup-count")!;
    expect(after.status).toBe("已完成");
    expect(after.notes).toBe(before.notes);
    expect(after.relatedId).toBe(before.relatedId);
    expect(after.priority).toBe(before.priority);
    expect(after.source).toBe("系统建议");
  });
  it("预览不写入，正式新增、读取、更新、删除均有版本回执", async () => {
    const f = fixture();
    const request = {
      expectedRevision: 0,
      operations: [
        { type: "create", kind: "tasks", values: { title: "真实操作任务" } },
      ],
    };
    expect((await f.api.mutate({ ...request, dryRun: true })).saved).toBe(
      false,
    );
    expect(f.writes()).toBe(0);
    const created = await f.api.mutate(request);
    expect(created.saved).toBe(true);
    expect(created.revision).toBe(1);
    const found = f.api.read({ kind: "tasks", search: "真实操作任务" });
    expect(found.total).toBe(1);
    await f.api.mutate({
      expectedRevision: 1,
      operations: [{ type: "delete", id: found.rows[0].id }],
    });
    expect(f.api.read({ search: "真实操作任务" }).total).toBe(0);
  });
  it("非法批次整体拒绝，之前的有效操作也不会保存", async () => {
    const f = fixture();
    await expect(
      f.api.mutate({
        expectedRevision: 0,
        operations: [
          { type: "create", kind: "tasks", values: { title: "不应保存" } },
          { type: "update", id: "seed-competition", values: { count: -1 } },
        ],
      }),
    ).rejects.toThrow();
    expect(f.writes()).toBe(0);
    expect(f.state().workspace.rows).toHaveLength(8);
  });
  it("拒绝旧版本、修改来源标识和伪造不可写字段", async () => {
    const f = fixture();
    await expect(
      f.api.mutate({
        expectedRevision: 3,
        operations: [{ type: "delete", id: "seed-competition" }],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      f.api.mutate({
        expectedRevision: 0,
        operations: [
          {
            type: "update",
            id: "seed-friends",
            values: { source: "手动录入", sourceKey: "fake" },
          },
        ],
      }),
    ).rejects.toThrow();
    expect(f.writes()).toBe(0);
  });
  it("有正在编辑的草稿时保留读取，拒绝外部写入", async () => {
    const f = fixture();
    f.edit();
    expect(f.api.read().total).toBe(8);
    await expect(
      f.api.mutate({
        expectedRevision: 0,
        operations: [{ type: "delete", id: "seed-competition" }],
      }),
    ).rejects.toThrow("草稿");
  });
  it("读取返回副本，不能通过改返回对象绕过持久化", () => {
    const f = fixture();
    const value = f.api.read();
    value.rows[0].count = 999;
    expect(f.state().workspace.rows[0].count).toBe(5);
  });
  it("外部导入默认预览，显式合并后再生效", async () => {
    const f = fixture();
    const incoming = seedWorkspace();
    incoming.rows.push({
      ...incoming.rows[0],
      id: "new-incoming",
      title: "新来源记录",
    });
    const input = { expectedRevision: 0, data: incoming };
    expect((await f.api.importData(input)).saved).toBe(false);
    expect(f.writes()).toBe(0);
    expect((await f.api.importData({ ...input, dryRun: false })).saved).toBe(
      true,
    );
    expect(f.api.read({ search: "新来源记录" }).total).toBe(1);
  });
  it("导出完整 JSON 保留关系，结构化工具可发现", () => {
    const f = fixture();
    expect(
      workspaceSchema.safeParse(
        JSON.parse(f.api.exportData({ format: "json" }).content),
      ).success,
    ).toBe(true);
    expect(JSON.parse(f.api.exportData({ format: "json", kind: "tasks" }).content).rows).toHaveLength(8);
    expect(automationTools(f.api).map((t) => t.name)).toEqual([
      "campus_read_records",
      "campus_change_records",
      "campus_import_records",
      "campus_export_records",
      "campus_open_page",
    ]);
  });
  it("删除通过统一关系清理路径", () => {
    const f = fixture();
    const prepared = prepareMutation(f.state(), {
      expectedRevision: 0,
      operations: [{ type: "delete", id: "seed-evening" }],
    });
    expect(
      prepared.workspace.rows.find((r) => r.id === "setup-count")!.relatedId,
    ).toBe("");
  });
});
