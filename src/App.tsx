import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  LayoutDashboard,
  UserPlus,
  Users,
  CalendarDays,
  SquareCheckBig,
  ChartNoAxesCombined,
  Cloud,
  Database,
  Plus,
  Search,
  Download,
  ArrowUpRight,
  ArrowRight,
  RefreshCw,
  ChevronRight,
  Menu,
  Pencil,
  Trash2,
  FileText,
  Upload,
  ShieldCheck,
  CircleHelp,
  Check,
  LogOut,
  Link2,
  FolderOpen,
  AlertCircle,
  X,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Badge, Modal } from "./components";
import AgentAccess from "./AgentAccess";
import {
  calculate,
  countText,
  emptyRow,
  kinds,
  labels,
  planImport,
  removeRow,
  rowSchema,
  statuses,
  toCSV,
  type ImportPlan,
  type Kind,
  type Row,
  type Workspace,
} from "./domain";
import {
  attachmentURL,
  ConflictError,
  cloudMode,
  connectGitHub,
  currentUser,
  githubMode,
  hasGitHubWriteAccess,
  loadWorkspace,
  LOCAL_KEY,
  login,
  logout,
  saveWorkspace,
  uploadEvidence,
  type Snapshot,
} from "./repository";

const pages = [
  {
    id: "overview",
    title: "运营总览",
    short: "总览",
    icon: LayoutDashboard,
    subtitle: "从真实记录出发，看见运营进展。",
  },
  {
    id: "recruitment",
    title: "拉新管理",
    short: "拉新",
    icon: UserPlus,
    subtitle: "追踪每个渠道，保留成果归属与核验口径。",
  },
  {
    id: "community",
    title: "社群运营",
    short: "社群",
    icon: Users,
    subtitle: "管理社群档案，记录每一次有价值的互动。",
  },
  {
    id: "activity",
    title: "活动与内容",
    short: "活动",
    icon: CalendarDays,
    subtitle: "从想法到发布，让活动与内容形成积累。",
  },
  {
    id: "tasks",
    title: "任务中心",
    short: "任务",
    icon: SquareCheckBig,
    subtitle: "明确下一步，让计划逐一落地。",
  },
  {
    id: "reviews",
    title: "成果与复盘",
    short: "复盘",
    icon: ChartNoAxesCombined,
    subtitle: "留下证据，记录经验，找到下一次的改进点。",
  },
] as const;
type Page = (typeof pages)[number]["id"];
const nowDate = () =>
  new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "full",
    timeZone: "Asia/Shanghai",
  }).format(new Date());
function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function readableError(e: unknown) {
  if (e && typeof e === "object" && "issues" in e)
    return (e as { issues: { message: string }[] }).issues
      .slice(0, 3)
      .map((i) => i.message)
      .join("；");
  return e instanceof Error ? e.message : "操作失败，请稍后重试";
}
function timeText(iso: string) {
  return iso
    ? new Date(iso).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "尚未导入";
}

export default function App() {
  const [page, setPage] = useState<Page>(() =>
    pages.some((p) => p.id === location.hash.slice(1))
      ? (location.hash.slice(1) as Page)
      : "overview",
  );
  const [tab, setTab] = useState<Kind>("communities");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [user, setUser] = useState<string | null>(null);
  const [githubWriteAccess, setGitHubWriteAccess] = useState(!githubMode);
  const [githubTokenInput, setGitHubTokenInput] = useState("");
  const [githubAuthError, setGitHubAuthError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [dataOpen, setDataOpen] = useState(false);
  const [editor, setEditor] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [source, setSource] = useState("");
  const [direction, setDirection] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [sort, setSort] = useState("updated");
  const [kanban, setKanban] = useState(true);
  const [dateFiltersOpen, setDateFiltersOpen] = useState(false);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [importData, setImportData] = useState<unknown>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [importError, setImportError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const workspace = snapshot?.workspace;
  const activePage = pages.find((p) => p.id === page)!;
  const kind: Kind =
    page === "community"
      ? tab === "interactions"
        ? "interactions"
        : "communities"
      : page === "activity"
        ? tab === "content"
          ? "content"
          : "activities"
        : page === "recruitment"
          ? "recruitment"
          : page === "reviews"
            ? "reviews"
            : "tasks";
  const rows = workspace?.rows ?? [];
  const latestWecomFetch = rows
    .filter((r) => r.source === "企业微信 CLI")
    .map((r) => r.sourceUpdatedAt || r.updatedAt)
    .sort()
    .at(-1);
  const metrics = useMemo(() => calculate(rows), [rows]);
  const filtered = useMemo(
    () =>
      rows
        .filter(
          (r) =>
            r.kind === kind &&
            (!query ||
              `${r.title} ${r.notes} ${r.channel} ${r.category}`
                .toLowerCase()
                .includes(query.toLowerCase())) &&
            (!filter || r.status === filter) &&
            (!source || r.source === source) &&
            (!direction || r.direction === direction) &&
            (!start || (!!r.date && r.date >= start)) &&
            (!end || (!!r.date && r.date <= end)),
        )
        .sort((a, b) =>
          sort === "title"
            ? a.title.localeCompare(b.title, "zh")
            : sort === "date"
              ? b.date.localeCompare(a.date)
              : b.updatedAt.localeCompare(a.updatedAt),
        ),
    [rows, kind, query, filter, source, direction, start, end, sort],
  );
  const importPlan = useMemo<{ plan?: ImportPlan; error?: string }>(() => {
    if (!workspace || !importData) return {};
    try {
      return { plan: planImport(workspace, importData, overwrite) };
    } catch (e) {
      return { error: readableError(e) };
    }
  }, [workspace, importData, overwrite]);

  async function reload() {
    setBusy(true);
    setError("");
    try {
      const u = await currentUser();
      setUser(u);
      if (u || githubMode) {
        setSnapshot(await loadWorkspace());
        setGitHubWriteAccess(!githubMode || (!!u && hasGitHubWriteAccess()));
        setChangedElsewhere(false);
      }
    } catch (e) {
      if (githubMode && !hasGitHubWriteAccess()) {
        setGitHubWriteAccess(false);
        setUser(null);
      }
      setError(readableError(e));
    } finally {
      setLoaded(true);
      setBusy(false);
    }
  }
  useEffect(() => {
    void reload();
  }, []);
  useEffect(() => {
    const handle = () => {
      const hash = location.hash.slice(1);
      if (pages.some((p) => p.id === hash)) setPage(hash as Page);
    };
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!snapshot || (!user && !githubMode)) return;
    const storage = (event: StorageEvent) => {
      if (event.key === LOCAL_KEY) setChangedElsewhere(true);
    };
    window.addEventListener("storage", storage);
    const timer = cloudMode || githubMode
      ? setInterval(async () => {
          if (document.visibilityState !== "visible" || saving.current) return;
          try {
            const remote = await loadWorkspace();
            if (remote.revision !== snapshot.revision)
              setChangedElsewhere(true);
          } catch {
            /* Explicit refresh exposes actionable errors without disrupting a draft. */
          }
        }, 30000)
      : undefined;
    return () => {
      window.removeEventListener("storage", storage);
      clearInterval(timer);
    };
  }, [snapshot, user]);
  function navigate(next: Page) {
    setPage(next);
    location.hash = next;
    setQuery("");
    setFilter("");
    setSource("");
    setDirection("");
    setStart("");
    setEnd("");
    setMobileNav(false);
  }
  async function commit(next: Workspace): Promise<Snapshot | null> {
    if (!snapshot || saving.current) return null;
    if (githubMode && !githubWriteAccess) {
      setDataOpen(true);
      setError("当前以 GitHub 公开只读方式浏览。请先在数据中心连接编辑权限。");
      return null;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await saveWorkspace(
        { ...next, updatedAt: new Date().toISOString() },
        snapshot.revision,
      );
      setSnapshot(saved);
      setChangedElsewhere(false);
      return saved;
    } catch (e) {
      if (githubMode && !hasGitHubWriteAccess()) {
        setGitHubWriteAccess(false);
        setUser(null);
      }
      setError(readableError(e));
      return null;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function openEditor(row: Row) {
    if (githubMode && !githubWriteAccess) {
      setDataOpen(true);
      setToast("连接 GitHub 编辑权限后即可修改记录");
      return;
    }
    setEditor(row);
  }
  async function enableGitHubEditing() {
    setBusy(true);
    setGitHubAuthError("");
    try {
      const account = await connectGitHub(githubTokenInput);
      setGitHubTokenInput("");
      setUser(account);
      setGitHubWriteAccess(true);
      await reload();
      setToast("GitHub 编辑权限已连接");
    } catch (e) {
      setGitHubAuthError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveRow(row: Row) {
    if (!workspace) return;
    const nextRows = rows.some((r) => r.id === row.id)
      ? rows.map((r) => (r.id === row.id ? row : r))
      : [...rows, row];
    if (await commit({ ...workspace, rows: nextRows })) {
      setEditor(null);
      setToast("记录已保存");
    }
  }
  async function changeTask(row: Row, status: Row["status"]) {
    if (!workspace) return;
    if (
      await commit({
        ...workspace,
        rows: rows.map((r) =>
          r.id === row.id
            ? { ...r, status, updatedAt: new Date().toISOString() }
            : r,
        ),
      })
    )
      setToast("任务状态已更新");
  }
  function exportJSON() {
    if (workspace)
      download(
        "校园运营工作台_完整备份.json",
        JSON.stringify(workspace, null, 2),
      );
  }
  async function pickImport(file?: File) {
    setImportError("");
    setImportData(null);
    setOverwrite(false);
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setImportError("文件不能超过 1 MB");
      return;
    }
    try {
      setImportData(JSON.parse(await file.text()));
    } catch {
      setImportError(
        "文件不是有效的 JSON，请选择工作台备份或企业微信候选数据文件。",
      );
    }
  }
  async function doImport() {
    if (!importPlan.plan) return;
    const p = importPlan.plan;
    if (await commit(p.next)) {
      setImportData(null);
      setToast(`已导入 ${p.added} 条新记录，更新 ${p.updated} 条`);
    }
  }
  function exportReview() {
    const text = `# 校园 AI 运营复盘\n\n生成时间：${timeText(new Date().toISOString())}\n\n## 已确认的数据口径\n\n- 非团队渠道新增记录：${metrics.channelCount}（渠道记录之和，未经跨渠道去重，不等于个人拉新人数）\n- 团队共同邀请记录：${metrics.teamCount}（不计入个人成果）\n- 成员退出记录：${metrics.exits}\n- 群成员数合计：${metrics.groupCount ?? "待核实"}（不同群可能存在重复成员）\n- 待核实 / 未量化记录：${metrics.pending}\n- 考核日期：未提供\n\n## 运营记录与证据\n\n${rows
      .filter((r) => r.kind !== "tasks")
      .map(
        (r) =>
          `### ${r.title}\n\n- 类型：${labels[r.kind]}｜状态：${r.status}｜数量：${countText(r)}｜归属：${r.attribution}\n- 记录日期：${r.date || "未提供"}｜来源：${r.source}\n- 说明：${r.notes || "待补充"}\n- 证据：${r.evidence || "未提供"}\n`,
      )
      .join(
        "\n",
      )}\n## 下一步\n\n${metrics.openTasks.map((r) => `- ${r.title}${r.dueDate ? `（截止 ${r.dueDate}）` : "（未设截止日期）"}`).join("\n")}\n`;
    download("校园运营_成果与复盘.md", text, "text/markdown;charset=utf-8");
  }

  if (!loaded)
    return (
      <div className="loading-screen">
        <div className="brand-mark">AI</div>
        <p>正在打开你的工作台…</p>
      </div>
    );
  if (cloudMode && !user) return <Login error={error} onLogin={reload} />;
  if (!workspace)
    return (
      <div className="loading-screen">
        <AlertCircle />
        <h2>暂时无法读取工作区</h2>
        <p role="alert">{error}</p>
        <button className="btn primary" onClick={reload}>
          重新读取
        </button>
        <p>本地数据不会被自动重置，请保留浏览器数据。</p>
      </div>
    );

  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-backdrop"
          aria-label="收起导航"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        id="workspace-navigation"
        className={`sidebar ${mobileNav ? "open" : ""}`}
      >
        <a
          href="#overview"
          className="brand"
          onClick={() => navigate("overview")}
        >
          <div className="brand-mark">
            <Cloud size={26} />
          </div>
          <div>
            <strong>校园 AI 工作台</strong>
            <span>腾讯云 AI 校园大使</span>
          </div>
        </a>
        <div className="workspace-label">
          <span className="workspace-avatar">许</span>
          <div>
            <strong>我的运营空间</strong>
            <span>个人工作区 · V1.0</span>
          </div>
          <ChevronRight size={14} />
        </div>
        <div className="nav-caption">工作空间</div>
        <nav>
          {pages.map((p) => (
            <button
              key={p.id}
              className={`nav-item ${page === p.id ? "active" : ""}`}
              onClick={() => navigate(p.id)}
            >
              <p.icon size={19} />
              <span>{p.title}</span>
              {p.id === "tasks" && metrics.openTasks.length > 0 && (
                <small>{metrics.openTasks.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="small-note">
            <span className="spark">✦</span>
            <strong>让行动留下痕迹</strong>
            <p>
              真实记录每一步，
              <br />
              让下一次运营更有方向。
            </p>
          </div>
          <button className="nav-item" onClick={() => setDataOpen(true)}>
            <Database size={18} />
            数据与同步
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-footer">
            <span className={`status-dot ${cloudMode || githubMode ? "" : "local"}`} />
            {githubMode ? "GitHub 公共数据模式" : cloudMode ? "CloudBase 云端模式" : "本地开发模式"}
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-btn mobile-only"
              aria-label="打开导航"
              aria-expanded={mobileNav}
              aria-controls="workspace-navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={21} />
            </button>
            <span>工作空间</span>
            <ChevronRight size={14} />
            <strong>{activePage.title}</strong>
          </div>
          <div className="top-actions">
            <span className="save-label">
              <span className="status-dot" />
              {busy ? "正在处理" : githubMode ? githubWriteAccess ? "已同步到 GitHub" : "GitHub 公开只读" : cloudMode ? "云端保存" : "本地已保存"}
            </span>
            <button
              className="icon-btn"
              title="重新读取数据"
              aria-label="重新读取数据"
              onClick={reload}
              disabled={busy || !!editor}
            >
              <RefreshCw size={17} className={busy ? "spin" : ""} />
            </button>
            <button className="btn subtle" onClick={() => setDataOpen(true)}>
              <Database size={16} />
              <span>数据中心</span>
            </button>
            <span className="avatar" title="个人运营工作区">
              许
            </span>
          </div>
        </header>
        <main
          className={`page-content page-${page}${page === "tasks" && kanban ? " is-board" : ""}`}
        >
          {error && (
            <div className="banner error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button
                className="icon-btn"
                aria-label="关闭错误提示"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {githubMode && !githubWriteAccess && (
            <div className="banner amber">
              <ShieldCheck size={18} />
              <span>所有人都可以查看公开数据。连接工作台指定的 GitHub 编辑权限后，才能保存修改。</span>
              <button className="text-button" onClick={() => setDataOpen(true)}>连接编辑权限</button>
            </div>
          )}
          {changedElsewhere && (
            <div className="banner amber">
              <RefreshCw size={18} />
              <span>
                其他窗口或设备有新数据。请导出备份后重新读取，以免覆盖。
              </span>
              <button
                className="text-button"
                disabled={busy || !!editor}
                onClick={reload}
              >
                重新读取
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">CAMPUS AMBASSADOR / WORKSPACE</div>
              <h1>
                {activePage.title}
                <span className="version">V1.0</span>
              </h1>
              <p>{activePage.subtitle}</p>
            </div>
            <div className="heading-actions">
              {page === "overview" ? (
                <>
                  <button className="btn" onClick={exportReview}>
                    <Download size={16} />
                    导出复盘
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => openEditor({ ...emptyRow("recruitment"), title: "" })}
                    disabled={githubMode && !githubWriteAccess}
                  >
                    <Plus size={17} />
                    记录新行动
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="btn"
                    onClick={() =>
                      download(
                        `校园运营_${labels[kind]}.csv`,
                        toCSV(filtered, rows),
                        "text/csv;charset=utf-8",
                      )
                    }
                  >
                    <Download size={16} />
                    导出 CSV
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => openEditor({ ...emptyRow(kind), title: "" })}
                    disabled={githubMode && !githubWriteAccess}
                  >
                    <Plus size={17} />
                    新增{labels[kind]}
                  </button>
                </>
              )}
            </div>
          </div>
          {page === "overview" ? (
            <>
              <section className="welcome">
                <div>
                  <div className="welcome-kicker">
                    <span className="blue-dot" />
                    我的校园运营
                  </div>
                  <h2>
                    把每一次行动，
                    <br className="mobile-only" />
                    变成可追溯的成长。
                  </h2>
                  <p>
                    记录渠道、连接社群、沉淀成果。今天也从一个具体行动开始。
                  </p>
                  <span className="date-label">{nowDate()}</span>
                </div>
                <div className="welcome-visual" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="float-card float-one">
                    <Users size={20} />
                    <span>连接校园</span>
                    <Check size={13} />
                  </div>
                  <div className="visual-core">
                    <ChartNoAxesCombined size={42} />
                  </div>
                  <div className="float-card float-two">
                    <span className="mini-bars">
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>持续积累</span>
                    <ArrowUpRight size={15} />
                  </div>
                </div>
              </section>
              <div className="metric-grid">
                <Metric
                  title="已确认渠道新增记录"
                  value={metrics.channelCount}
                  unit="人次"
                  note="非团队口径 · 未跨渠道去重"
                  icon={<UserPlus size={20} />}
                  color="blue"
                />
                <Metric
                  title="团队共同邀请记录"
                  value={metrics.teamCount}
                  unit="人次"
                  note="团队成果 · 不计为个人独立成果"
                  icon={<Users size={20} />}
                  color="purple"
                />
                <Metric
                  title="已确认成员退出记录"
                  value={metrics.exits}
                  unit="人次"
                  note="退出单列 · 不用于推算群净增长"
                  icon={<ArrowUpRight size={20} />}
                  color="orange"
                />
                <Metric
                  title="群成员数合计"
                  value={metrics.groupCount ?? "待补充"}
                  unit={metrics.groupCount !== null ? "人次" : ""}
                  note="各群实测数之和 · 非去重总人数"
                  icon={<ShieldCheck size={20} />}
                  color="teal"
                />
              </div>
              <div className="dashboard-grid">
                <section className="panel chart-panel">
                  <PanelHeader
                    title="拉新渠道表现"
                    sub="已确认的确切值，按成果归属区分"
                    action={
                      <button
                        className="text-button"
                        onClick={() => navigate("recruitment")}
                      >
                        查看记录 <ArrowRight size={14} />
                      </button>
                    }
                  />
                  <div className="chart-legend">
                    <span>
                      <i style={{ background: "#4b7df5" }} />
                      非团队渠道记录
                    </span>
                    <span>
                      <i style={{ background: "#9b8afb" }} />
                      团队共同成果
                    </span>
                  </div>
                  <GrowthChart rows={rows} />
                  <div className="chart-foot">
                    <CircleHelp size={14} />
                    {
                      rows.filter(
                        (r) =>
                          r.kind === "recruitment" &&
                          r.direction === "新增" &&
                          (r.countMode !== "exact" || r.status !== "已确认"),
                      ).length
                    }{" "}
                    条新增记录尚无已确认确切值，暂不纳入图表。
                  </div>
                </section>
                <section className="panel todo-panel">
                  <PanelHeader
                    title="接下来做什么"
                    sub={`${metrics.openTasks.length} 项待推进 · ${metrics.overdue.length} 项逾期`}
                    action={
                      <button
                        className="text-button"
                        onClick={() => navigate("tasks")}
                      >
                        全部 <ArrowRight size={14} />
                      </button>
                    }
                  />
                  {metrics.openTasks.length ? (
                    <div className="task-preview-list">
                      {metrics.openTasks.slice(0, 4).map((t) => (
                        <div className="task-preview" key={t.id}>
                          <button
                            className="task-checkbox"
                            aria-label={`完成任务：${t.title}`}
                            disabled={busy || (githubMode && !githubWriteAccess)}
                            onClick={() => changeTask(t, "已完成")}
                          />
                          <button
                            className="task-preview-text"
                            onClick={() => openEditor(t)}
                          >
                            <strong>{t.title}</strong>
                            <span>
                              {t.dueDate || "未设截止日期"} · {t.source}
                            </span>
                          </button>
                          {t.priority === "高" && (
                            <span className="priority-mark">高</span>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty compact">
                      <SquareCheckBig size={28} />
                      <p>暂时没有待推进任务</p>
                    </div>
                  )}
                  <button
                    className="add-inline"
                    onClick={() => openEditor({ ...emptyRow("tasks"), title: "" })}
                    disabled={githubMode && !githubWriteAccess}
                  >
                    <Plus size={16} />
                    添加一个下一步
                  </button>
                </section>
              </div>
              <div className="dashboard-bottom">
                <section className="panel">
                  <PanelHeader
                    title="数据核验清单"
                    sub="缺失信息保留为空，数据有据可查"
                    action={
                      <span className="badge amber">
                        {metrics.pending} 条待处理
                      </span>
                    }
                  />
                  <div className="verification-list">
                    {rows
                      .filter((r) => ["待核实", "未量化"].includes(r.status))
                      .slice(0, 4)
                      .map((r) => (
                        <button key={r.id} onClick={() => openEditor(r)}>
                          <span className="verification-icon">
                            <CircleHelp size={17} />
                          </span>
                          <div>
                            <strong>{r.title}</strong>
                            <span>{r.notes}</span>
                          </div>
                          <Badge value={r.status} />
                          <ChevronRight size={15} />
                        </button>
                      ))}
                    {metrics.pending === 0 && (
                      <p className="empty-text">暂无待核验记录。</p>
                    )}
                  </div>
                </section>
                <section className="panel source-panel">
                  <PanelHeader title="数据连接" sub="保留每条记录的来源" />
                  <div className="source-line">
                    <div className="source-logo">
                      <Database size={21} />
                    </div>
                    <div>
                      <strong>
                        {githubMode ? "GitHub 公开数据文件" : cloudMode ? "CloudBase 云端数据库" : "浏览器本地工作区"}
                      </strong>
                      <span>
                        {githubMode ? "所有人可读 · 指定 GitHub 账号可写" : cloudMode ? "同一账号跨设备读取 · 版本冲突保护" : "当前浏览器保存 · 可导出完整备份"}
                      </span>
                    </div>
                    <Badge value={githubMode ? githubWriteAccess ? "已授权" : "公开" : cloudMode ? "已连接" : "本地"} />
                  </div>
                  <div className="source-line">
                    <div className="source-logo greenish">
                      <Link2 size={21} />
                    </div>
                    <div>
                      <strong>企业微信 CLI</strong>
                      <span>
                        {latestWecomFetch
                          ? `最近抓取：${timeText(latestWecomFetch)}`
                          : "待选择来源并导入 · 授权凭据留在本机"}
                      </span>
                    </div>
                  </div>
                  <button
                    className="btn full"
                    onClick={() => setDataOpen(true)}
                  >
                    管理数据与同步 <ArrowRight size={15} />
                  </button>
                </section>
              </div>
            </>
          ) : (
            <>
              {page === "recruitment" && (
                <div className="notice">
                  <ShieldCheck size={18} />
                  <p>
                    渠道记录可能重叠，不能相加作为去重拉新人数；团队成果单独归属。“小于
                    3”仅表示上界，退出人数不直接用于推算净增长。
                  </p>
                </div>
              )}
              {page === "reviews" && (
                <div className="review-banner">
                  <div>
                    <span className="eyebrow">REVIEW & LEARN</span>
                    <h2>用事实描述成果，用复盘推动下一步。</h2>
                    <p>
                      考核日期：未提供 · 现有证据链接{" "}
                      {
                        rows.filter((r) => !!r.evidence || !!r.attachment)
                          .length
                      }{" "}
                      条 · 已完成任务 {metrics.completedTasks} 项
                    </p>
                  </div>
                  <button className="btn" onClick={exportReview}>
                    <FileText size={16} />
                    生成复盘文档
                  </button>
                </div>
              )}
              <section className="panel data-panel">
                {page !== "tasks" && (
                  <div className="data-tabs">
                    {(page === "community"
                      ? (["communities", "interactions"] as Kind[])
                      : page === "activity"
                        ? (["activities", "content"] as Kind[])
                        : [kind]
                    ).map((k) => (
                      <button
                        className={kind === k ? "selected" : ""}
                        onClick={() => {
                          setTab(k);
                          setQuery("");
                          setFilter("");
                        }}
                        key={k}
                      >
                        {labels[k]}
                        <span>{rows.filter((r) => r.kind === k).length}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div
                  className={`filters${page === "tasks" ? " task-filters" : ""}`}
                >
                  <label className="search-box">
                    <Search size={17} />
                    <input
                      aria-label="搜索记录"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="搜索名称、渠道或说明…"
                    />
                  </label>
                  <select
                    aria-label="状态筛选"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="">全部状态</option>
                    {statuses.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                  <select
                    aria-label="来源筛选"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="">全部来源</option>
                    {["用户提供", "手动录入", "企业微信 CLI", "系统建议"].map(
                      (s) => (
                        <option key={s}>{s}</option>
                      ),
                    )}
                  </select>
                  {kind === "recruitment" && (
                    <select
                      aria-label="方向筛选"
                      value={direction}
                      onChange={(e) => setDirection(e.target.value)}
                    >
                      <option value="">全部方向</option>
                      {["新增", "退出", "其他"].map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  )}
                  <select
                    aria-label="排序"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="updated">最近更新</option>
                    <option value="date">记录日期</option>
                    <option value="title">名称排序</option>
                  </select>
                  {page === "tasks" && (
                    <>
                      <button
                        className={`btn filter-toggle${dateFiltersOpen || start || end ? " selected" : ""}`}
                        aria-expanded={dateFiltersOpen || !!start || !!end}
                        onClick={() => setDateFiltersOpen((v) => !v)}
                      >
                        <CalendarDays size={14} />
                        日期筛选
                      </button>
                      <div className="task-view-toolbar">
                        <div className="segmented">
                          <button
                            className={kanban ? "selected" : ""}
                            onClick={() => setKanban(true)}
                          >
                            看板
                          </button>
                          <button
                            className={!kanban ? "selected" : ""}
                            onClick={() => setKanban(false)}
                          >
                            列表
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
                {(page !== "tasks" || dateFiltersOpen || start || end) && (
                  <div className="date-filters">
                    <span>记录日期</span>
                    <input
                      aria-label="起始日期"
                      type="date"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                    />
                    <span>至</span>
                    <input
                      aria-label="结束日期"
                      type="date"
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                    />
                    {(query ||
                      filter ||
                      source ||
                      start ||
                      end ||
                      direction) && (
                      <button
                        className="text-button"
                        onClick={() => {
                          setQuery("");
                          setFilter("");
                          setSource("");
                          setStart("");
                          setEnd("");
                          setDirection("");
                        }}
                      >
                        清除筛选
                      </button>
                    )}
                    <span className="result-count">
                      共 {filtered.length} 条记录
                      {(start || end) && " · 未填日期的记录已排除"}
                    </span>
                  </div>
                )}
                {filtered.length === 0 ? (
                  <Empty
                    kind={kind}
                    filtered={
                      !!(query || filter || source || start || end || direction)
                    }
                    onAdd={() => openEditor({ ...emptyRow(kind), title: "" })}
                  />
                ) : kind === "tasks" && kanban ? (
                  <div className="kanban">
                    {[
                      "待办",
                      "进行中",
                      "已完成",
                      ...(filtered.some((t) => t.status === "已取消")
                        ? ["已取消"]
                        : []),
                    ].map((s) => {
                      const column = filtered.filter((t) =>
                        s === "待办"
                          ? !["进行中", "已完成", "已取消"].includes(t.status)
                          : t.status === s,
                      );
                      return (
                        <div className="kanban-column" key={s}>
                          <h3>
                            <span
                              className={`kanban-dot ${s === "已完成" ? "done" : s === "进行中" ? "doing" : ""}`}
                            />
                            {s}
                            <small>{column.length}</small>
                          </h3>
                          <div
                            className="kanban-cards"
                            role="region"
                            aria-label={`${s}任务`}
                            tabIndex={column.length ? 0 : undefined}
                          >
                            {column.map((t) => (
                              <article className="task-card" key={t.id}>
                                <div className="task-card-top">
                                  <button
                                    className="task-card-title"
                                    onClick={() => openEditor(t)}
                                    title={t.title}
                                  >
                                    {t.title}
                                  </button>
                                  <button
                                    className="icon-btn"
                                    aria-label={`编辑${t.title}`}
                                    onClick={() => openEditor(t)}
                                  >
                                    <Pencil size={14} />
                                  </button>
                                </div>
                                <p title={t.notes}>{t.notes || "暂无说明"}</p>
                                <div className="task-card-footer">
                                  <div className="task-card-meta">
                                    <Badge value={t.priority} />
                                    {t.relatedId && (
                                      <span className="relation">
                                        <Link2 size={12} />
                                        {
                                          rows.find((r) => r.id === t.relatedId)
                                            ?.title
                                        }
                                      </span>
                                    )}
                                    {(t.dueDate || !t.relatedId) && (
                                      <span>{t.dueDate || "未设截止日期"}</span>
                                    )}
                                  </div>
                                  <select
                                    aria-label={`任务状态：${t.title}`}
                                    value={t.status}
                                    disabled={busy || (githubMode && !githubWriteAccess)}
                                    onChange={(e) =>
                                      changeTask(
                                        t,
                                        e.target.value as Row["status"],
                                      )
                                    }
                                  >
                                    {[
                                      "待办",
                                      "进行中",
                                      "已完成",
                                      "已取消",
                                      ...(![
                                        "待办",
                                        "进行中",
                                        "已完成",
                                        "已取消",
                                      ].includes(t.status)
                                        ? [t.status]
                                        : []),
                                    ].map((v) => (
                                      <option key={v}>{v}</option>
                                    ))}
                                  </select>
                                </div>
                              </article>
                            ))}
                            {column.length === 0 && (
                              <div className="kanban-empty">
                                <span>
                                  <SquareCheckBig size={22} />
                                </span>
                                <strong>暂无{s}任务</strong>
                                <p>
                                  {s === "已完成"
                                    ? "完成一次行动，在这里留下进展。"
                                    : s === "进行中"
                                      ? "开始推进的任务会出现在这里。"
                                      : "下一步行动，可以从一个小任务开始。"}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>名称 / 说明</th>
                          {kind === "recruitment" ? (
                            <>
                              <th>渠道 / 方向</th>
                              <th>数量</th>
                              <th>成果归属</th>
                            </>
                          ) : (
                            <>
                              <th>类型 / 优先级</th>
                              <th>
                                {kind === "communities"
                                  ? "实测成员数"
                                  : "关联社群 / 活动"}
                              </th>
                            </>
                          )}
                          <th>状态</th>
                          <th>{kind === "tasks" ? "截止日期" : "记录日期"}</th>
                          <th>来源</th>
                          <th className="actions-column">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <button
                                className="row-title"
                                onClick={() => openEditor(r)}
                              >
                                {r.title}
                              </button>
                              <p className="row-notes" title={r.notes}>
                                {r.notes || "暂无说明"}
                              </p>
                              {r.evidence && (
                                <a
                                  className="evidence-link"
                                  href={r.evidence}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <Link2 size={12} />
                                  查看证据
                                </a>
                              )}
                              {r.attachment && (
                                <button
                                  className="text-button evidence-link"
                                  onClick={async () => {
                                    try {
                                      window.open(
                                        await attachmentURL(r.attachment),
                                        "_blank",
                                        "noopener,noreferrer",
                                      );
                                    } catch (e) {
                                      setError(readableError(e));
                                    }
                                  }}
                                >
                                  <FolderOpen size={12} />
                                  附件
                                </button>
                              )}
                            </td>
                            {kind === "recruitment" ? (
                              <>
                                <td>
                                  {r.channel || "—"}
                                  <small className="cell-sub">
                                    {r.direction}
                                  </small>
                                </td>
                                <td className="count-cell">{countText(r)}</td>
                                <td>
                                  <span
                                    className={
                                      r.attribution === "团队" ? "team-tag" : ""
                                    }
                                  >
                                    {r.attribution}
                                  </span>
                                </td>
                              </>
                            ) : (
                              <>
                                <td>
                                  {kind === "tasks" ? (
                                    <Badge value={r.priority} />
                                  ) : (
                                    r.category || "未分类"
                                  )}
                                </td>
                                <td>
                                  {kind === "communities"
                                    ? countText(r)
                                    : rows.find(
                                        (v) =>
                                          v.id ===
                                          (r.groupId ||
                                            r.activityId ||
                                            r.relatedId),
                                      )?.title || "未关联"}
                                </td>
                              </>
                            )}
                            <td>
                              <Badge value={r.status} />
                            </td>
                            <td className="nowrap">
                              {(kind === "tasks" ? r.dueDate : r.date) || (
                                <span className="muted">未提供</span>
                              )}
                            </td>
                            <td className="nowrap">
                              <span className="source-tag">{r.source}</span>
                            </td>
                            <td>
                              <div className="row-actions">
                                <button
                                  className="icon-btn"
                                  aria-label={`编辑${r.title}`}
                                  onClick={() => openEditor(r)}
                                >
                                  <Pencil size={15} />
                                </button>
                                <button
                                  className="icon-btn danger"
                                  aria-label={`删除${r.title}`}
                                  onClick={() => {
                                    if (githubMode && !githubWriteAccess) {
                                      setDataOpen(true);
                                      setToast("连接 GitHub 编辑权限后即可删除记录");
                                    } else setDeleting(r);
                                  }}
                                  disabled={githubMode && !githubWriteAccess}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="table-footer">
                  <ShieldCheck size={13} />
                  记录可追溯，缺失值不按零处理。
                  <span>共 {filtered.length} 条</span>
                </div>
              </section>
            </>
          )}
          <footer className="main-footer">
            <span>校园 AI 工作台 · 个人运营记录</span>
            <span>
              数据更新时间：{timeText(workspace.updatedAt)}（北京时间）
            </span>
          </footer>
        </main>
      </div>
      <AgentAccess
        host={{
          mode: githubMode ? "github" : cloudMode ? "cloudbase" : "local",
          getSnapshot: () => snapshot!,
          isEditing: () => !!editor || !!deleting || busy,
          write: async (next, expectedRevision) => {
            if (!snapshot || snapshot.revision !== expectedRevision)
              throw new ConflictError();
            const saved = await commit(next);
            if (!saved)
              throw new Error(
                "未能保存。请检查页面错误提示，必要时重新读取当前账号的数据。",
              );
            setToast("GPT 操作已保存，可在页面核对");
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            );
            return saved;
          },
          openPage: ({ page: target, view }) => {
            navigate(target);
            if (view) setTab(view);
          },
        }}
      />
      <Editor
        key={editor?.id ?? "closed"}
        row={editor}
        rows={rows}
        busy={busy}
        saveError={error}
        onClose={() => setEditor(null)}
        onSave={saveRow}
      />
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="删除这条记录？"
        description="删除后，该记录的关联引用将被清空。建议先导出备份。"
      >
        <p className="delete-name">{deleting?.title}</p>
        <p className="muted">
          关联引用{" "}
          {
            rows.filter((r) =>
              [r.groupId, r.activityId, r.relatedId].includes(
                deleting?.id ?? "__none__",
              ),
            ).length
          }{" "}
          条。云端附件将保留，可在存储控制台按需清理。
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={() => setDeleting(null)}>
            取消
          </button>
          <button
            className="btn destructive"
            disabled={busy}
            onClick={async () => {
              if (
                deleting &&
                (await commit(removeRow(workspace, deleting.id)))
              ) {
                setDeleting(null);
                setToast("记录已删除");
              }
            }}
          >
            确认删除
          </button>
        </div>
      </Modal>
      <Modal
        open={dataOpen}
        onClose={() => setDataOpen(false)}
        title="数据与同步"
        description="管理保存方式、备份与企业微信数据导入。"
        wide
      >
        <div className="connection-box">
          <div className="source-logo">
            <Database size={22} />
          </div>
          <div>
            <strong>{githubMode ? "GitHub 公共数据工作区" : cloudMode ? "CloudBase 云端工作区" : "本地工作区"}</strong>
            <p>
              {githubMode
                ? "任何人都可读取公开数据；保存修改会提交到 GitHub，并在不同设备间同步。"
                : cloudMode
                  ? "同一账号跨设备同步，每 30 秒检查更新；发现新版本后重新读取。"
                  : "数据保存在当前浏览器。清理浏览器会删除数据，请定期导出备份。"}
            </p>
          </div>
          <Badge value={githubMode ? "公开" : cloudMode ? "云端" : "本地"} />
        </div>
        {githubMode && (
          <div className="data-section">
            <h3>GitHub 编辑授权</h3>
            <p>
              公开读取不需要登录。编辑时连接工作台指定账号的细粒度令牌，仅需授予目标公开仓库的 Contents 读写权限；每次保存都会生成公开提交记录。
            </p>
            {user && githubWriteAccess ? (
              <div className="verification-list">
                <div className="source-line">
                  <ShieldCheck size={18} />
                  <span>已连接 GitHub 账号 {user} · 令牌只保存在当前浏览器标签页会话中</span>
                </div>
                <button
                  className="btn"
                  onClick={async () => {
                    await logout();
                    setUser(null);
                    setGitHubWriteAccess(false);
                    await reload();
                    setToast("已断开编辑授权，仍可公开查看数据");
                  }}
                >
                  <LogOut size={15} />
                  断开编辑授权
                </button>
              </div>
            ) : (
              <>
                <p className="tiny">
                  在 GitHub 创建细粒度个人访问令牌：资源所有者选仓库账号，只选工作台仓库，Repository permissions 中 Contents 设为 Read and write。不要创建经典令牌，也不要把令牌发给他人。
                </p>
                <a className="text-button" href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
                  打开 GitHub 令牌设置 <ArrowUpRight size={13} />
                </a>
                <label className="field full-field">
                  GitHub 细粒度令牌
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={githubTokenInput}
                    onChange={(event) => setGitHubTokenInput(event.target.value)}
                    placeholder="github_pat_…"
                  />
                </label>
                {githubAuthError && (
                  <p className="form-error" role="alert">{githubAuthError}</p>
                )}
                <button
                  className="btn primary"
                  disabled={busy || !githubTokenInput.trim()}
                  onClick={() => void enableGitHubEditing()}
                >
                  <ShieldCheck size={15} />
                  连接 GitHub 编辑权限
                </button>
              </>
            )}
            <p className="tiny">
              仓库中的当前数据、源代码和提交历史均为公开内容；删除或修改数据不会从旧提交中抹去历史版本。请只记录适合公开的信息。
            </p>
          </div>
        )}
        <div className="data-section">
          <h3>备份与导出</h3>
          <p>
            JSON 包含关联关系，可合并导回；CSV
            适合表格分析，按当前页面筛选导出。
          </p>
          <div className="button-row">
            <button className="btn" onClick={exportJSON}>
              <Download size={16} />
              完整 JSON 备份
            </button>
            <button
              className="btn"
              onClick={() =>
                download(
                  "校园运营_全部记录.csv",
                  toCSV(rows),
                  "text/csv;charset=utf-8",
                )
              }
            >
              <Download size={16} />
              全部 CSV
            </button>
            <button className="btn" onClick={exportReview}>
              <FileText size={16} />
              复盘文档
            </button>
          </div>
        </div>
        <div className="data-section">
          <h3>企业微信 CLI 接入</h3>
          <p>
            在已授权的电脑运行抓取脚本，选择本次读取的群。仅拉取最近 7
            天的消息，生成候选运营记录；群成员总数、拉新人数须另行核验。
          </p>
          <div className="command-hint">
            <code>npm run wecom:check</code>
            <code>npm run wecom:pull -- --days 7 --group "实际群名"</code>
          </div>
          <p className="tiny">
            凭据只留在本机，不会写入网页。消息内容作为数据保存，不执行其中的任何命令。相同来源记录重复导入不会重复新增。
          </p>
          <p className="tiny">
            最近一次文件导入：{timeText(workspace.lastImportAt)}
            。抓取时间会保存在每条企业微信记录中。
          </p>
        </div>
        <div className="data-section">
          <h3>导入与核验</h3>
          <p>
            支持工作台 JSON 备份、企业微信候选
            JSON。导入采用合并方式，原有记录保留；企业微信候选记录默认为“待核实”。
          </p>
          <input
            ref={fileRef}
            aria-label="选择导入文件"
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              void pickImport(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {(importError || importPlan.error) && (
            <p role="alert" className="form-error">
              {importError || importPlan.error}
            </p>
          )}
          {importPlan.plan && (
            <div className="import-preview">
              <strong>导入预览</strong>
              <p>
                新增 {importPlan.plan.added} 条 · 更新 {importPlan.plan.updated}{" "}
                条 · 冲突 {importPlan.plan.conflicts} 条 · 相同记录跳过{" "}
                {importPlan.plan.skipped} 条
              </p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                />
                用导入版本更新冲突记录（会覆盖本地修改）
              </label>
              <div className="import-titles">
                {importPlan.plan.next.rows
                  .filter((r) => !rows.some((old) => old.id === r.id))
                  .slice(0, 5)
                  .map((r) => (
                    <div key={r.id}>
                      <span>
                        {labels[r.kind]} · {r.title}
                      </span>
                      <Badge value={r.status} />
                    </div>
                  ))}
              </div>
              <button
                className="btn primary"
                disabled={
                  busy || (githubMode && !githubWriteAccess) || importPlan.plan.added + importPlan.plan.updated === 0
                }
                onClick={doImport}
              >
                <Upload size={16} />
                确认合并导入
              </button>
            </div>
          )}
        </div>
        <div className="data-section">
          <h3>GPT 网页操作</h3>
          <p>
            工作台已提供结构化操作接口与可直接操作的表单。公开访问可读取数据；GitHub
            模式需先连接仓库所有者的编辑令牌，GPT 才可填写记录、更新任务状态、管理关联和导入数据。每次写入检查版本并返回结果；正在编辑草稿时会暂停外部写入。
          </p>
          <p className="tiny">
            支持 WebMCP 的浏览器可发现 campus_* 工具；其他浏览器可通过页面操作或
            window.campusWorkbench
            接口完成。接口沿用当前账号权限，不包含账号密钥，也不会在网页关闭后自动运行。
          </p>
        </div>
        <div className="data-section">
          <h3>{githubMode ? "GitHub Pages 部署" : "云端配置"}</h3>
          <p>
            {githubMode
              ? "WorkBuddy 将公开仓库发布到 GitHub Pages。工作台通过 GitHub Contents API 读取公开 JSON；只有指定账号的细粒度令牌可以写入数据文件。"
              : "按项目 README 创建 CloudBase 环境、启用邮箱登录、应用数据库与存储规则，填写环境变量后重新构建。腾讯云 SecretKey 和企业微信授权信息禁止放入前端。"}
          </p>
          <div className="button-row">
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                await reload();
                setToast("已重新读取工作区");
              }}
            >
              <RefreshCw size={15} />
              重新读取
            </button>
            {cloudMode && (
              <button
                className="btn"
                onClick={async () => {
                  try {
                    await logout();
                    setUser(null);
                    setSnapshot(null);
                    setDataOpen(false);
                  } catch (e) {
                    setError(readableError(e));
                  }
                }}
              >
                <LogOut size={15} />
                退出云端账号
              </button>
            )}
          </div>
        </div>
      </Modal>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}

function PanelHeader({
  title,
  sub,
  action,
}: {
  title: string;
  sub: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel-header">
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
      {action}
    </div>
  );
}
function Metric({
  title,
  value,
  unit,
  note,
  icon,
  color,
}: {
  title: string;
  value: number | string;
  unit: string;
  note: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <section className="metric-card">
      <div className="metric-top">
        <span>{title}</span>
        <span className={`metric-icon ${color}`}>{icon}</span>
      </div>
      <div
        className={`metric-value ${typeof value === "string" ? "text-value" : ""}`}
      >
        {value}
        <small>{unit}</small>
      </div>
      <p>{note}</p>
    </section>
  );
}
function GrowthChart({ rows }: { rows: Row[] }) {
  const data = rows
    .filter(
      (r) =>
        r.kind === "recruitment" &&
        r.direction === "新增" &&
        r.countMode === "exact" &&
        r.status === "已确认",
    )
    .map((r) => ({
      name: r.channel || r.title,
      value: r.count,
      attribution: r.attribution,
    }));
  if (!data.length)
    return (
      <div className="empty compact">
        <ChartNoAxesCombined />
        <p>暂无已确认的渠道数据</p>
      </div>
    );
  return (
    <div className="chart-area">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ left: 0, right: 26, top: 10, bottom: 0 }}
        >
          <CartesianGrid
            horizontal={false}
            stroke="#edf1f7"
            strokeDasharray="4 4"
          />
          <XAxis
            type="number"
            allowDecimals={false}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: "#8894a7" }}
          />
          <YAxis
            dataKey="name"
            type="category"
            width={86}
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 12, fill: "#64748b" }}
          />
          <Tooltip
            cursor={{ fill: "#f5f8ff" }}
            formatter={(v) => [`${v} 人次`, "渠道记录"]}
            contentStyle={{
              border: "1px solid #edf1f7",
              borderRadius: 10,
              fontSize: 12,
            }}
          />
          <Bar
            isAnimationActive={false}
            dataKey="value"
            barSize={26}
            radius={[0, 5, 5, 0]}
            label={{ position: "right", fill: "#64748b", fontSize: 12 }}
          >
            {data.map((r, i) => (
              <Cell
                key={i}
                fill={r.attribution === "团队" ? "#9b8afb" : "#4b7df5"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
function Empty({
  kind,
  filtered,
  onAdd,
}: {
  kind: Kind;
  filtered: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <FolderOpen size={28} />
      </div>
      <h3>{filtered ? "没有匹配的记录" : `开始积累你的${labels[kind]}`}</h3>
      <p>
        {filtered
          ? "试试调整筛选条件或搜索关键词。"
          : "仅记录实际发生的行动，未提供的信息可以留空。"}
      </p>
      {!filtered && (
        <button className="btn" onClick={onAdd}>
          <Plus size={16} />
          新增{labels[kind]}
        </button>
      )}
    </div>
  );
}

function Editor({
  row,
  rows,
  busy,
  saveError,
  onClose,
  onSave,
}: {
  row: Row | null;
  rows: Row[];
  busy: boolean;
  saveError: string;
  onClose: () => void;
  onSave: (row: Row) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Row | null>(row);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  if (!draft) return null;
  const d = draft;
  const field = <K extends keyof Row>(key: K, value: Row[K]) =>
    setDraft({ ...d, [key]: value });
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const parsed = rowSchema.safeParse({
      ...d,
      updatedAt: new Date().toISOString(),
    });
    if (!parsed.success) {
      setError(readableError(parsed.error));
      return;
    }
    await onSave(parsed.data);
  }
  return (
    <Modal
      open={!!row}
      onClose={() => {
        if (!busy && !uploading) onClose();
      }}
      title={`${rows.some((r) => r.id === d.id) ? "编辑" : "新增"}${labels[d.kind]}`}
      description="如实记录行动与证据，未知的数字和日期请留空。"
      wide
    >
      <form onSubmit={submit} className="record-form">
        <label className="field full-field">
          名称 <span className="required">*</span>
          <input
            autoFocus
            value={d.title}
            maxLength={160}
            required
            onChange={(e) => field("title", e.target.value)}
            placeholder="给这条记录起个清晰的名字"
          />
        </label>
        <div className="form-grid">
          <label className="field">
            状态
            <select
              aria-label="状态"
              value={d.status}
              onChange={(e) => field("status", e.target.value as Row["status"])}
            >
              {statuses.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field">
            记录日期
            <input
              type="date"
              value={d.date}
              onChange={(e) => field("date", e.target.value)}
            />
            <small>未提供时留空</small>
          </label>
          {d.kind === "recruitment" && (
            <>
              <label className="field">
                拉新渠道
                <input
                  value={d.channel}
                  maxLength={100}
                  onChange={(e) => field("channel", e.target.value)}
                  placeholder="例如：比赛群"
                />
              </label>
              <label className="field">
                记录方向
                <select
                  aria-label="记录方向"
                  value={d.direction}
                  onChange={(e) =>
                    field("direction", e.target.value as Row["direction"])
                  }
                >
                  {["新增", "退出", "其他"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                成果归属
                <select
                  aria-label="成果归属"
                  value={d.attribution}
                  onChange={(e) =>
                    field("attribution", e.target.value as Row["attribution"])
                  }
                >
                  {["个人", "团队", "未明确"].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          {[
            "recruitment",
            "communities",
            "interactions",
            "activities",
            "content",
          ].includes(d.kind) && (
            <>
              <label className="field">
                {d.kind === "communities" ? "成员数统计方式" : "数量统计方式"}
                <select
                  aria-label="数量统计方式"
                  value={d.countMode}
                  onChange={(e) =>
                    setDraft({
                      ...d,
                      countMode: e.target.value as Row["countMode"],
                      count: e.target.value === "unknown" ? null : d.count,
                    })
                  }
                >
                  <option value="unknown">未量化 / 未知</option>
                  <option value="exact">确切值</option>
                  <option value="lt">严格小于（上界）</option>
                </select>
              </label>
              <label className="field">
                {d.countMode === "lt"
                  ? "数量上界（不含）"
                  : d.kind === "communities"
                    ? "实测成员数"
                    : "数量"}
                <input
                  aria-label="数量"
                  type="number"
                  min={d.countMode === "lt" ? 1 : 0}
                  step={1}
                  max={10000000}
                  disabled={d.countMode === "unknown"}
                  value={d.count ?? ""}
                  onChange={(e) =>
                    field(
                      "count",
                      e.target.value === "" ? null : Number(e.target.value),
                    )
                  }
                  placeholder="未知时请选未量化"
                />
              </label>
            </>
          )}
          {d.kind !== "recruitment" && (
            <label className="field">
              {d.kind === "reviews" ? "成果 / 复盘类型" : "分类"}
              <input
                value={d.category}
                maxLength={80}
                onChange={(e) => field("category", e.target.value)}
                placeholder={
                  d.kind === "reviews"
                    ? "例如：阶段复盘 / 经验 / 成果"
                    : "自行填写分类"
                }
              />
            </label>
          )}
          {d.kind === "tasks" && (
            <>
              <label className="field">
                优先级
                <select
                  aria-label="优先级"
                  value={d.priority}
                  onChange={(e) =>
                    field("priority", e.target.value as Row["priority"])
                  }
                >
                  {["高", "中", "低"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                截止日期
                <input
                  type="date"
                  value={d.dueDate}
                  onChange={(e) => field("dueDate", e.target.value)}
                />
                <small>不自动设置考核或任务期限</small>
              </label>
            </>
          )}
          {d.kind !== "communities" && (
            <label className="field">
              关联社群
              <select
                aria-label="关联社群"
                value={d.groupId}
                onChange={(e) => field("groupId", e.target.value)}
              >
                <option value="">未关联</option>
                {rows
                  .filter((r) => r.kind === "communities")
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {d.kind !== "activities" && (
            <label className="field">
              关联活动
              <select
                aria-label="关联活动"
                value={d.activityId}
                onChange={(e) => field("activityId", e.target.value)}
              >
                <option value="">未关联</option>
                {rows
                  .filter((r) => r.kind === "activities")
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {["tasks", "reviews"].includes(d.kind) && (
            <label className="field">
              关联记录
              <select
                aria-label="关联记录"
                value={d.relatedId}
                onChange={(e) => field("relatedId", e.target.value)}
              >
                <option value="">未关联</option>
                {rows
                  .filter((r) => r.id !== d.id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {labels[r.kind]} · {r.title}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
        <label className="field full-field">
          说明 / 核验口径
          <textarea
            rows={4}
            maxLength={10000}
            value={d.notes}
            onChange={(e) => field("notes", e.target.value)}
            placeholder="记录行动、结果、待核验的信息。企业微信消息只作为待核验素材。"
          />
        </label>
        <label className="field full-field">
          证据链接
          <input
            type="url"
            value={d.evidence}
            onChange={(e) => field("evidence", e.target.value)}
            placeholder="https://…（仅 HTTP / HTTPS）"
          />
        </label>
        {cloudMode && (
          <label className="field full-field">
            证据附件（最大 10 MB）
            <input
              type="file"
              disabled={uploading || busy}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setUploading(true);
                setError("");
                try {
                  field("attachment", await uploadEvidence(f));
                } catch (err) {
                  setError(readableError(err));
                } finally {
                  setUploading(false);
                }
              }}
            />
            <small>
              {uploading
                ? "正在上传…"
                : d.attachment
                  ? "已有云端附件；重新选择会替换记录中的附件引用。"
                  : "附件按个人账号限制读取。"}
            </small>
          </label>
        )}
        <div className="form-source">
          <ShieldCheck size={14} />
          来源：{d.source}
          {d.sourceUpdatedAt && ` · 抓取于 ${timeText(d.sourceUpdatedAt)}`}
          {d.sourceKey && " · 已启用来源去重"}
        </div>
        {(error || saveError) && (
          <p className="form-error" role="alert">
            {error || saveError}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="btn"
            onClick={onClose}
            disabled={busy || uploading}
          >
            取消
          </button>
          <button
            className="btn primary"
            disabled={busy || uploading}
            type="submit"
          >
            {busy ? "正在保存…" : "保存记录"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Login({
  error: initialError,
  onLogin,
}: {
  error: string;
  onLogin: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand-mark">
          <Cloud size={28} />
        </div>
        <div className="eyebrow">CAMPUS AI WORKSPACE</div>
        <h1>让行动留下痕迹。</h1>
        <p>登录个人运营工作区，在不同设备继续记录。</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await login(email, password);
              setPassword("");
              await onLogin();
            } catch (err) {
              setError(readableError(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            邮箱
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="field">
            密码
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn primary full" disabled={busy}>
            {busy ? "正在登录…" : "登录工作台"}
            <ArrowRight size={16} />
          </button>
        </form>
        <p className="tiny">
          首次使用需由环境管理员在 CloudBase 配置邮箱账号。登录问题请查看项目
          README。
        </p>
      </div>
    </div>
  );
}
