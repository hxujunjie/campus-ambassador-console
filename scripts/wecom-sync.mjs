import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { seedWorkspace } from "../src/domain.ts";
import {
  buildSyncRows,
  mergeSyncRows,
  parseSyncSnapshot,
  validateSyncConfig,
} from "./wecom-sync-core.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_PATH = "data/workspace.json";
const CONFIG_PATH = ".wecom/sync-config.json";
const MAX_SNAPSHOT_BYTES = 750 * 1024;

class WeComRequestError extends Error {
  constructor(code = null) {
    super(
      code === 853006
        ? "企业微信当前不提供此数据读取工具（错误代码 853006）。请联系企业微信管理员确认该工具已在企业内开通。"
        : Number.isSafeInteger(code)
          ? `企业微信读取失败（错误代码 ${code}）。请检查应用授权和读取范围。`
          : "企业微信读取失败。请检查 CLI 授权和读取范围。",
    );
  }
}

function cli(args) {
  const entry =
    process.env.WECOM_CLI_ENTRY ||
    (process.platform === "win32"
      ? join(
          process.env.APPDATA || "",
          "npm/node_modules/@wecom/cli/bin/wecom.js",
        )
      : "");
  const bin = entry ? process.execPath : "wecom-cli";
  if (entry && !existsSync(entry))
    throw new Error(
      "找不到企业微信 CLI。请安装 @wecom/cli，或用 WECOM_CLI_ENTRY 指定已安装入口。",
    );
  try {
    return execFileSync(bin, entry ? [entry, ...args] : args, {
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch (error) {
    // The API may return a structured error on stdout with a non-zero exit code.
    // Extract only its numeric code; never print child-process output or stderr.
    try {
      const response = JSON.parse(String(error.stdout || ""));
      if (response.errcode || response.error)
        throw new WeComRequestError(Number(response.errcode));
    } catch (parseError) {
      if (parseError instanceof WeComRequestError) throw parseError;
    }
    throw new Error("企业微信 CLI 请求未完成。");
  }
}

function json(args) {
  let response;
  try {
    response = JSON.parse(cli(args));
  } catch (error) {
    if (error instanceof WeComRequestError) throw error;
    if (error.message === "企业微信 CLI 请求未完成。") throw error;
    throw new Error("企业微信 CLI 返回的数据格式无效。");
  }
  if (response.errcode || response.error)
    throw new WeComRequestError(Number(response.errcode));
  return response.data ?? response;
}

function stamp(time) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(time);
}

function makeWindow(days) {
  const end = new Date();
  const begin = new Date(end.getTime() - days * 86400000 + 60000);
  return {
    begin_time: stamp(begin),
    end_time: stamp(end),
    days,
  };
}

async function pages(resource, params, field) {
  const records = [];
  let cursor = "";
  const seen = new Set();
  for (let page = 0; page < 100; page++) {
    const response = json([
      "chat",
      resource,
      "list",
      "--json",
      JSON.stringify({ ...params, ...(cursor ? { cursor } : {}) }),
    ]);
    if (!Array.isArray(response[field]))
      throw new Error(
        "企业微信 CLI 返回结构不符合当前版本，请查看 chat --doc 更新适配器。",
      );
    records.push(...response[field]);
    if (!response.has_more) return records;
    if (!response.next_cursor || seen.has(response.next_cursor))
      throw new Error("分页游标异常，已停止读取。");
    cursor = response.next_cursor;
    seen.add(cursor);
  }
  throw new Error("超过 100 页保护限制，请缩短读取天数。");
}

function assertCliReady() {
  const version = cli(["--version"]);
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/);
  if (
    !match ||
    Number(match[1]) < 1 ||
    (Number(match[1]) === 1 &&
      (Number(match[2]) < 2 ||
        (Number(match[2]) === 2 && Number(match[3]) < 1)))
  )
    throw new Error("企业微信 CLI 需升级到 1.2.1 或更高版本。");
  if (cli(["auth", "show", "--status"]) !== "authorized")
    throw new Error(
      "企业微信 CLI 尚未授权。请在本机运行 wecom-cli auth init --noninteractive 完成扫码授权。",
    );
}

async function recentGroups(days) {
  const { begin_time, end_time } = makeWindow(days);
  const chats = await pages(
    "groups",
    { begin_time, end_time },
    "chats",
  );
  return { chats, window: { begin_time, end_time, days } };
}

function showGroups(chats) {
  if (!chats.length) {
    console.log("当前授权范围与读取窗口内没有返回有消息的群。");
    return;
  }
  console.log("当前授权范围与读取窗口内有消息的群：");
  chats.forEach((chat, index) =>
    console.log(
      `${index + 1}. ${chat.chat_name || "未命名群"} · 最近消息 ${chat.last_msg_time || "未知"} · ${Number.isSafeInteger(chat.msg_count) ? chat.msg_count : "未知"} 条消息`,
    ),
  );
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
}

function writeJsonAtomic(path, value, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode });
  renameSync(temporary, path);
}

function localPseudonym(groupName) {
  const path = resolve(
    process.env.WECOM_PSEUDONYM_KEY_PATH ||
      resolve(ROOT, ".wecom/private-pseudonym-key"),
  );
  mkdirSync(dirname(path), { recursive: true });
  let secret;
  if (existsSync(path)) secret = readFileSync(path);
  else {
    secret = randomBytes(32);
    writeFileSync(path, secret, { mode: 0o600 });
  }
  return createHmac("sha256", secret)
    .update(groupName)
    .digest("hex")
    .slice(0, 32);
}

function configPath(args) {
  return resolve(ROOT, option(args, "--config", CONFIG_PATH));
}

async function configure(args) {
  assertCliReady();
  const path = configPath(args);
  let previous = { version: 1, branch: "main", groups: [] };
  if (existsSync(path)) {
    try {
      previous = validateSyncConfig(JSON.parse(readFileSync(path, "utf8")));
    } catch {
      throw new Error(
        "已有本机同步配置无法读取；请先备份或移除该配置，再重新运行 wecom:configure。",
      );
    }
  }
  const { chats } = await recentGroups(7);
  if (!chats.length)
    throw new Error("读取窗口内没有可配置的活跃群。");
  showGroups(chats);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const rawSelection = (await rl.question(
      "选择要自动同步的序号（如 1,3；输入“全部”选择所有群）：",
    )).trim();
    const selectedIndexes =
      rawSelection === "全部"
        ? chats.map((_, index) => index)
        : rawSelection
            .split(/[，,\s]+/)
            .filter(Boolean)
            .map((value) => Number(value) - 1);
    if (
      !selectedIndexes.length ||
      selectedIndexes.some(
        (index) => !Number.isInteger(index) || index < 0 || index >= chats.length,
      ) ||
      new Set(selectedIndexes).size !== selectedIndexes.length
    )
      throw new Error("所选序号无效；未保存同步配置。");

    const groups = [];
    for (const index of selectedIndexes) {
      const chat = chats[index];
      const oldGroup = previous.groups.find((item) => item.chatId === chat.chat_id);
      const suggested = oldGroup?.label || `社群 ${groups.length + 1}`;
      const label = (
        await rl.question(
          `为第 ${index + 1} 个群填写线上公开别名（不要填真实群名；回车使用“${suggested}”）：`,
        )
      ).trim();
      groups.push({
        chatId: chat.chat_id,
        label: label || suggested,
        key: oldGroup?.key || randomBytes(16).toString("hex"),
      });
    }
    if (existsSync(path)) {
      const confirm = (await rl.question(
        "本机已有自动同步配置。确认替换？输入 y 继续：",
      )).trim();
      if (confirm.toLowerCase() !== "y") {
        console.log("已保留原配置。");
        return;
      }
    }
    const config = validateSyncConfig({
      version: 1,
      branch: option(args, "--branch", previous.branch),
      groups,
    });
    writeJsonAtomic(path, config);
    console.log(
      `已保存 ${groups.length} 个群的本机同步配置：${path}\n配置仅保留在 .wecom/ 中；线上将只写入你设置的别名和消息总数。`,
    );
  } finally {
    rl.close();
  }
}

function readConfig(args) {
  const path = configPath(args);
  if (!existsSync(path))
    throw new Error(
      "未找到本机同步配置。请先运行 npm run wecom:configure 选择群和公开别名。",
    );
  try {
    return validateSyncConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error("本机同步配置不是有效 JSON；请重新运行 wecom:configure。");
    throw error;
  }
}

function readLocalSnapshot(path) {
  if (!existsSync(path))
    return { workspace: seedWorkspace(), revision: 0 };
  try {
    return parseSyncSnapshot(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    throw new Error("本地工作台快照无效，未覆盖现有数据。");
  }
}

function gitResult(args, cwd) {
  try {
    return {
      status: 0,
      stdout: execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GCM_INTERACTIVE: "Never",
        },
      }),
      stderr: "",
    };
  } catch (error) {
    return {
      status: Number.isInteger(error.status) ? error.status : 1,
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || ""),
    };
  }
}

function runGit(args, cwd) {
  const result = gitResult(args, cwd);
  if (result.status !== 0)
    throw new Error("GitHub 同步操作失败；线上快照未被强制覆盖。");
  return result.stdout;
}

function parseSnapshotText(text) {
  try {
    const parsed = parseSyncSnapshot(JSON.parse(text));
    if (Buffer.byteLength(JSON.stringify(parsed), "utf8") > MAX_SNAPSHOT_BYTES)
      throw new Error("工作台快照超过 750 KB 限额。");
    return parsed;
  } catch {
    throw new Error("GitHub 工作台快照无效，未覆盖现有数据。");
  }
}

function isPushRace(result) {
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  return /non-fast-forward|fetch first|\[rejected\]|failed to push some refs/.test(
    output,
  );
}

function publishSnapshot(incomingRows, fetchedAt, branch, dryRun) {
  const remote = gitResult(["remote", "get-url", "origin"], ROOT);
  const remoteUrl = remote.stdout.trim();
  if (
    remote.status !== 0 ||
    !/^(https?:\/\/github\.com\/|git@github\.com:)/i.test(remoteUrl)
  )
    throw new Error("自动发布需要已配置 GitHub origin 远程仓库。");

  for (let attempt = 1; attempt <= 3; attempt++) {
    runGit(["fetch", "--quiet", "origin", branch], ROOT);
    const ref = `refs/remotes/origin/${branch}`;
    const tempParent = mkdtempSync(join(tmpdir(), "campus-console-wecom-"));
    const checkout = join(tempParent, "snapshot");
    let worktreeAdded = false;
    try {
      runGit(["worktree", "add", "--detach", checkout, ref], ROOT);
      worktreeAdded = true;
      const snapshotPath = join(checkout, DATA_PATH);
      const current = parseSnapshotText(readFileSync(snapshotPath, "utf8"));
      const merged = mergeSyncRows(current, incomingRows, fetchedAt);
      if (Buffer.byteLength(JSON.stringify(merged.snapshot), "utf8") > MAX_SNAPSHOT_BYTES)
        throw new Error("工作台快照超过 750 KB 限额。");
      if (dryRun)
        return { ...merged, published: false, branch };

      writeJsonAtomic(snapshotPath, merged.snapshot);
      runGit(["add", "--", DATA_PATH], checkout);
      const diff = gitResult(["diff", "--cached", "--quiet"], checkout);
      if (diff.status === 0)
        return { ...merged, published: false, branch, unchanged: true };
      if (diff.status !== 1)
        throw new Error("无法比较最新工作台数据，已停止发布。");
      const commit = gitResult(
        [
          "-c",
          "user.name=Campus Console Sync",
          "-c",
          "user.email=campus-console-sync@users.noreply.github.com",
          "commit",
          "-m",
          "Refresh campus activity snapshot",
        ],
        checkout,
      );
      if (commit.status !== 0)
        throw new Error("无法创建工作台数据更新，未发布到 GitHub。");
      const push = gitResult(
        ["push", "--porcelain", "origin", `HEAD:refs/heads/${branch}`],
        checkout,
      );
      if (push.status === 0)
        return { ...merged, published: true, branch };
      if (isPushRace(push) && attempt < 3) continue;
      throw new Error(
        "GitHub 发布失败。请检查本机 GitHub 写入权限和网络后重试；线上数据未被强制覆盖。",
      );
    } finally {
      if (worktreeAdded)
        gitResult(["worktree", "remove", "--force", checkout], ROOT);
      rmSync(tempParent, { recursive: true, force: true });
    }
  }
  throw new Error("GitHub 数据有并发更新；已停止发布，请稍后重新同步。");
}

function reportSync(result, missingLabels, dryRun) {
  if (missingLabels.length)
    console.warn(
      `本次未在授权群列表中找到 ${missingLabels.join("、")}；这些别名对应的旧数据保持不变。`,
    );
  const action = dryRun
    ? "预览完成，未写入"
    : result.published
      ? `已发布到 GitHub ${result.branch}`
      : result.unchanged
        ? "数据未变化，无需发布"
        : "已写入本地工作台快照";
  console.log(
    `${action}。新增 ${result.added} 条，刷新 ${result.updated} 条群级记录。未读取或保存聊天正文。`,
  );
}

async function sync(args) {
  assertCliReady();
  const config = readConfig(args);
  const days = Number(option(args, "--days", "7"));
  if (!Number.isInteger(days) || days !== 7)
    throw new Error("自动同步当前固定为最近 7 天，以保持工作台统计口径一致。");
  const { chats, window } = await recentGroups(days);
  const fetchedAt = new Date().toISOString();
  const { rows, missingLabels } = buildSyncRows(
    config,
    chats,
    window,
    fetchedAt,
  );
  if (!rows.length)
    throw new Error("本次没有匹配到已配置的群；工作台数据未修改。");

  const dryRun = args.includes("--dry-run");
  const publish = args.includes("--publish");
  let result;
  if (publish) {
    result = publishSnapshot(rows, fetchedAt, config.branch, dryRun);
  } else {
    const path = resolve(ROOT, option(args, "--data", DATA_PATH));
    const merged = mergeSyncRows(readLocalSnapshot(path), rows, fetchedAt);
    result = { ...merged, published: false, branch: config.branch };
    if (!dryRun) writeJsonAtomic(path, merged.snapshot);
  }
  reportSync(result, missingLabels, dryRun);
}

async function pull(args) {
  assertCliReady();
  const days = Number(option(args, "--days", "7"));
  if (!Number.isInteger(days) || days < 1 || days > 7)
    throw new Error("--days 必须为 1 到 7 的整数。");
  const { chats, window } = await recentGroups(days);
  if (args.includes("--list") || !option(args, "--group", "")) {
    showGroups(chats);
    console.log(
      '自动更新请运行 npm run wecom:configure；候选预览可运行 npm run wecom:pull -- --days 7 --group "实际群名"。',
    );
    return;
  }
  const groupName = option(args, "--group", "");
  const selected = chats.filter((group) => group.chat_name === groupName);
  if (selected.length !== 1 || !selected[0].chat_id)
    throw new Error(
      selected.length > 1
        ? "存在多个同名群，请先在企业微信中区分名称。"
        : "未唯一找到指定群，请用 --list 查看本次可读群名称。",
    );
  const group = selected[0];
  if (!Number.isSafeInteger(group.msg_count) || group.msg_count < 0)
    throw new Error("企业微信未返回有效的群消息总数，未生成候选文件。");
  const key = localPseudonym(group.chat_name);
  const fetchedAt = new Date().toISOString();
  const config = {
    version: 1,
    groups: [
      {
        chatId: group.chat_id,
        label:
          option(args, "--label", "") || `社群 ${key.slice(0, 4).toUpperCase()}`,
        key,
      },
    ],
  };
  const { rows } = buildSyncRows(config, [group], window, fetchedAt);
  const output = resolve(option(args, "--out", ".wecom/candidates.json"));
  writeJsonAtomic(
    output,
    {
      type: "wecom-candidates",
      version: 1,
      fetchedAt,
      window,
      rows,
    },
  );
  console.log(
    `已生成 ${rows.length} 条候选记录：${output}\n默认使用匿名别名；可用 --label 设置公开名称。文件仅含群级消息条数，不含群名、聊天正文、发送者标识或附件。`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const action = args.shift() || "check";
  if (action === "check") {
    assertCliReady();
    console.log(
      "企业微信 CLI 版本达标且已授权。凭据保留在本机；本自动同步只读取群级消息总数。",
    );
    return;
  }
  if (action === "list") {
    assertCliReady();
    const days = Number(option(args, "--days", "7"));
    if (!Number.isInteger(days) || days < 1 || days > 7)
      throw new Error("--days 必须为 1 到 7 的整数。");
    const { chats } = await recentGroups(days);
    showGroups(chats);
    return;
  }
  if (action === "configure") return configure(args);
  if (action === "pull") return pull(args);
  if (action === "sync") return sync(args);
  throw new Error("支持的操作为 check、list、configure、pull 或 sync。");
}

main().catch((error) => {
  const message =
    error instanceof WeComRequestError ||
    (error instanceof Error &&
      !/\b(chat_id|userid|cursor|token|media_id|open_vid)\b/i.test(error.message))
      ? error.message
      : "同步失败，未将企业微信数据写入工作台。请检查本机 CLI、配置和读取权限。";
  console.error(message);
  process.exitCode = 1;
});
