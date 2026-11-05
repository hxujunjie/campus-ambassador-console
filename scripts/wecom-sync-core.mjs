import { createHash } from "node:crypto";
import { rowSchema, workspaceSchema } from "../src/domain.ts";

const hash = (value) => createHash("sha256").update(value).digest("hex");

export function validateSyncConfig(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.groups))
    throw new Error("自动同步配置格式无效，请重新运行 wecom:configure。");
  const branch = value.branch || "main";
  if (
    typeof branch !== "string" ||
    !/^[A-Za-z0-9._/-]+$/.test(branch) ||
    branch.startsWith("-") ||
    branch.includes("..")
  )
    throw new Error("自动同步配置中的 GitHub 分支名称无效。");
  if (value.groups.length < 1 || value.groups.length > 100)
    throw new Error("自动同步配置须包含 1 到 100 个群。");
  const chatIds = new Set();
  const keys = new Set();
  const labels = new Set();
  const groups = value.groups.map((group) => {
    if (
      typeof group?.chatId !== "string" ||
      !group.chatId ||
      typeof group?.label !== "string" ||
      !group.label.trim() ||
      group.label.trim().length > 100 ||
      typeof group?.key !== "string" ||
      !/^[a-f0-9]{32}$/.test(group.key)
    )
      throw new Error("自动同步配置中的群或公开别名无效。");
    if (chatIds.has(group.chatId) || keys.has(group.key))
      throw new Error("自动同步配置包含重复群。");
    if (labels.has(group.label.trim()))
      throw new Error("公开别名不能重复，请为每个群设置不同名称。");
    chatIds.add(group.chatId);
    keys.add(group.key);
    labels.add(group.label.trim());
    return { chatId: group.chatId, label: group.label.trim(), key: group.key };
  });
  return { version: 1, branch, groups };
}

function makeRowId(sourceKey) {
  return `wecom-${hash(sourceKey).slice(0, 32)}`;
}

export function buildSyncRows(config, chats, window, fetchedAt) {
  const normalized = validateSyncConfig(config);
  const rows = [];
  const missingLabels = [];
  for (const group of normalized.groups) {
    const matches = chats.filter((item) => item.chat_id === group.chatId);
    if (matches.length > 1)
      throw new Error("企业微信返回重复群记录；本次自动同步已停止。");
    if (matches.length === 0) {
      missingLabels.push(group.label);
      continue;
    }
    const messageCount = matches[0].msg_count;
    if (!Number.isSafeInteger(messageCount) || messageCount < 0)
      throw new Error("企业微信未返回有效的群消息总数；本次自动同步已停止。");

    const days = Number.isInteger(window.days) ? window.days : 7;
    const communitySourceKey = `wecom:auto:community:${group.key}`;
    const observationSourceKey = `wecom:auto:messages-${days}d:${group.key}`;
    const communityId = makeRowId(communitySourceKey);
    const base = {
      source: "企业微信 CLI",
      sourceUpdatedAt: fetchedAt,
      updatedAt: fetchedAt,
    };
    rows.push(
      rowSchema.parse({
        ...base,
        id: communityId,
        kind: "communities",
        title: group.label,
        status: "未量化",
        count: null,
        countMode: "unknown",
        category: "企业微信群",
        notes:
          "通过企业微信 CLI 读取到群会话。群成员总数与成员变动人数未获取，不能用消息条数推算。线上仅保存配置中的公开别名。",
        sourceKey: communitySourceKey,
      }),
    );
    rows.push(
      rowSchema.parse({
        ...base,
        id: makeRowId(observationSourceKey),
        kind: "interactions",
        title: `${group.label} · 近 ${days} 天消息观察`,
        status: "已确认",
        category: `近 ${days} 天群消息数`,
        date: "",
        count: messageCount,
        countMode: "exact",
        attribution: "未明确",
        direction: "其他",
        groupId: communityId,
        notes:
          `统计窗口：${window.begin_time} 至 ${window.end_time}（北京时间）。数量为企业微信返回的群消息条数，不代表新增、退出、参与人数或群成员总数。同步仅读取群级汇总，不读取或保存聊天正文、发送者标识或附件。`,
        sourceKey: observationSourceKey,
      }),
    );
  }
  return { rows, missingLabels };
}

export function mergeSyncRows(snapshot, incomingRows, fetchedAt) {
  if (!snapshot || !Number.isInteger(snapshot.revision) || snapshot.revision < 0)
    throw new Error("工作台快照版本无效，未覆盖现有数据。");
  const current = workspaceSchema.parse(snapshot.workspace);
  const rows = structuredClone(current.rows);
  let added = 0;
  let updated = 0;

  for (const incoming of incomingRows) {
    const index = rows.findIndex((row) => row.sourceKey === incoming.sourceKey);
    if (index < 0) {
      if (rows.some((row) => row.id === incoming.id))
        throw new Error("企业微信记录标识冲突，未写入工作台。");
      rows.push(incoming);
      added++;
      continue;
    }
    const existing = rows[index];
    if (
      existing.source !== "企业微信 CLI" ||
      existing.kind !== incoming.kind ||
      existing.id !== incoming.id
    )
      throw new Error("自动同步来源与现有记录冲突，未覆盖原记录。");

    // Keep user-entered details (especially a verified community member count).
    // The rolling message observation only refreshes its machine-sourced count.
    rows[index] =
      incoming.kind === "interactions"
        ? rowSchema.parse({
            ...existing,
            count: incoming.count,
            countMode: incoming.countMode,
            groupId: incoming.groupId,
            sourceUpdatedAt: fetchedAt,
            updatedAt: fetchedAt,
          })
        : rowSchema.parse({
            ...existing,
            sourceUpdatedAt: fetchedAt,
            updatedAt: fetchedAt,
          });
    updated++;
  }

  const workspace = workspaceSchema.parse({
    ...current,
    rows,
    updatedAt: fetchedAt,
  });
  return {
    snapshot: { workspace, revision: snapshot.revision + 1 },
    added,
    updated,
  };
}

export function parseSyncSnapshot(value) {
  if (!value || !Number.isInteger(value.revision) || value.revision < 0)
    throw new Error("工作台快照版本无效，未覆盖现有数据。");
  return {
    workspace: workspaceSchema.parse(value.workspace),
    revision: value.revision,
  };
}
