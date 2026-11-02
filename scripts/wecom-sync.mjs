import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";

// Read-only CLI bridge. Credentials are managed by wecom-cli, never read or copied here.
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
  const output = execFileSync(bin, entry ? [entry, ...args] : args, {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return output.trim();
}
function json(args) {
  const response = JSON.parse(cli(args));
  if (response.errcode || response.error)
    throw new Error("企业微信读取失败，请在本机检查 CLI 授权和权限。");
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
function hash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
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
        "CLI 返回结构不符合当前版本，请查看 chat --doc 更新适配器。",
      );
    records.push(...response[field]);
    if (!response.has_more) return records;
    if (!response.next_cursor || seen.has(response.next_cursor))
      throw new Error("分页游标异常，已停止抓取，未写入候选文件。");
    cursor = response.next_cursor;
    seen.add(cursor);
  }
  throw new Error("超过 100 页保护限制，已停止。请缩短读取天数。");
}
try {
  const args = process.argv.slice(2);
  const action = args.shift() || "check";
  const value = (key) => {
    const index = args.indexOf(key);
    return index < 0 ? undefined : args[index + 1];
  };
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
  if (action === "check") {
    console.log(
      "企业微信 CLI 版本达标，已授权。凭据保留在本机。\n使用 --list 查看最近群名称，使用 --group 精确选择要读取的群。",
    );
    process.exit(0);
  }
  if (action !== "pull") throw new Error("支持的操作为 check 或 pull。");
  const days = Number(value("--days") || 7);
  if (!Number.isInteger(days) || days < 1 || days > 7)
    throw new Error("--days 必须为 1 到 7 的整数。");
  const end = new Date();
  const begin = new Date(end.getTime() - days * 86400000 + 60000);
  const window = { begin_time: stamp(begin), end_time: stamp(end) };
  const groups = await pages("groups", window, "chats");
  if (args.includes("--list") || !value("--group")) {
    console.log("当前授权范围内、读取窗口有消息的群：");
    groups.forEach((g, i) =>
      console.log(
        `${i + 1}. ${g.chat_name || "未命名群"} · 最近消息 ${g.last_msg_time || "未知"}`,
      ),
    );
    console.log(
      '运行 npm run wecom:pull -- --days 7 --group "实际群名" 读取指定群。',
    );
    process.exit(0);
  }
  const selected = groups.filter((g) => g.chat_name === value("--group"));
  if (selected.length !== 1 || !selected[0].chat_id)
    throw new Error(
      selected.length > 1
        ? "存在多个同名群，请先在企业微信中区分名称。"
        : "未唯一找到指定群，请用 --list 查看本次可读群名称。",
    );
  const group = selected[0];
  const messages = await pages(
    "messages",
    { ...window, chat_id: group.chat_id },
    "messages",
  );
  const groupHash = hash(group.chat_name);
  const groupId = `wecom-group-${groupHash}`;
  const fetched = new Date().toISOString();
  const base = {
    status: "待核实",
    source: "企业微信 CLI",
    sourceUpdatedAt: fetched,
    updatedAt: fetched,
  };
  const rows = [
    {
      ...base,
      id: groupId,
      kind: "communities",
      title: group.chat_name,
      count: null,
      countMode: "unknown",
      sourceKey: `wecom:group:${groupHash}`,
      notes:
        "通过企业微信 CLI 发现的授权群。接口不返回群成员总数，需另行核实；不可用消息条数代替。",
    },
  ];
  const dates = new Map();
  for (const message of messages) {
    const day = message.send_time?.slice(0, 10);
    if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day))
      throw new Error("消息缺少有效时间，无法生成稳定候选记录。");
    if (!dates.has(day)) dates.set(day, []);
    dates.get(day).push(message);
  }
  for (const [day, batch] of [...dates.entries()].sort()) {
    const snippets = batch
      .filter((m) => m.msg_type === "text" && m.text?.content)
      .slice(0, 5)
      .map((m) => `${m.send_time.slice(11)} ${m.text.content.slice(0, 350)}`)
      .join("\n");
    rows.push({
      ...base,
      id: `wecom-day-${hash(`${groupHash}:${day}`)}`,
      kind: "interactions",
      title: `${group.chat_name} · ${day} 消息观察`,
      date: day,
      groupId,
      category: "消息观察（非成员数）",
      countMode: "exact",
      count: batch.length,
      sourceKey: `wecom:messages:${groupHash}:${day}`,
      notes: `读取窗口：${window.begin_time} 至 ${window.end_time}（北京时间）。\n窗口内该日读取到 ${batch.length} 条消息，仅表示消息条数；不能推出新增、退出、群总人数或参与人数。首尾日可能非全天。以下最多 5 条文本摘录仅供核验：\n${snippets || "无文本摘录。"}`,
    });
  }
  const output = resolve(value("--out") || ".wecom/candidates.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(
    output,
    JSON.stringify(
      {
        type: "wecom-candidates",
        version: 1,
        fetchedAt: fetched,
        window,
        rows,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    `已为「${group.chat_name}」生成 ${rows.length} 条待核实候选记录。\n候选文件：${output}\n请在工作台“数据中心”选择文件，预览并确认合并。原始群标识、人员标识和授权信息没有写入候选文件。`,
  );
} catch {
  // Child-process failures can include identifiers or credentials in stderr: do not echo them.
  console.error(
    "读取未完成。请检查 CLI 版本、授权、精确群名与近 7 天读取范围；未自动修改工作台。运行 npm run wecom:check 或 wecom-cli chat --doc 诊断。",
  );
  process.exitCode = 1;
}
