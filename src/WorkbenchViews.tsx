import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Link2,
  Pencil,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Badge, Modal } from "./components";
import { countText, labels, type Kind, type Row } from "./domain";
import {
  dateRange,
  groupMonths,
  initialView,
  PAGE_SIZE,
  recordDate,
  relatedRows,
  type Preset,
  type SavedView,
  type TimeMode,
  type ViewState,
} from "./workspace-views";

const timeLabels: Record<TimeMode, string> = {
  all: "全部日期",
  week: "本周",
  month: "本月",
  lastMonth: "上月",
  custom: "自定义日期",
  undated: "日期待补充",
};
const presetLabels: Record<Preset, string> = {
  "": "全部记录",
  open: "待推进",
  history: "历史任务",
  draft: "筹备内容",
  verify: "待核实",
  published: "已发布",
};

export function ViewToolbar({
  kind,
  view,
  today,
  months,
  saved,
  onChange,
  onSave,
  onRemove,
}: {
  kind: Kind;
  view: ViewState;
  today: string;
  months: string[];
  saved: SavedView[];
  onChange: (change: Partial<ViewState>) => void;
  onSave: (name: string) => boolean;
  onRemove: (id: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [feedback, setFeedback] = useState("");
  const [allViews, setAllViews] = useState(false);
  const range = dateRange(view.timeMode, today, view.start, view.end);
  const presets: Preset[] =
    kind === "tasks"
      ? ["open", "history", "verify", ""]
      : kind === "content"
        ? ["draft", "verify", "published", ""]
        : ["", "verify"];
  const month =
    view.timeMode === "custom" &&
    view.start.slice(0, 7) === view.end.slice(0, 7)
      ? view.start.slice(0, 7)
      : "";
  return (
    <div className="view-toolbar">
      <div className="view-presets" aria-label="常用视图">
        {presets.map((preset) => (
          <button
            key={preset}
            className={`view-pill${view.preset === preset ? " selected" : ""}`}
            onClick={() =>
              onChange({ ...initialView(kind), layout: view.layout, preset })
            }
          >
            {presetLabels[preset]}
          </button>
        ))}
        <select
          aria-label="时间范围"
          value={view.timeMode}
          onChange={(event) =>
            onChange({
              timeMode: event.target.value as TimeMode,
              start: "",
              end: "",
            })
          }
        >
          {Object.entries(timeLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="按年月查找"
          value={month}
          onChange={(event) => {
            if (!event.target.value) return;
            const first = `${event.target.value}-01`;
            onChange({ timeMode: "custom", ...dateRange("month", first) });
          }}
        >
          <option value="">按年月查找</option>
          {months.map((value) => (
            <option key={value} value={value}>
              {value.replace("-", " 年 ")} 月
            </option>
          ))}
        </select>
        <button
          className="view-pill save-view"
          aria-expanded={saving}
          onClick={() => {
            setSaving(!saving);
            setFeedback("");
          }}
        >
          <Save size={13} />
          保存视图
        </button>
      </div>
      {view.timeMode === "custom" && (
        <div className="date-filters inline-date-filters">
          <span>{kind === "tasks" ? "截止日期" : "记录日期"}</span>
          <input
            aria-label="起始日期"
            type="date"
            value={view.start}
            onChange={(e) => onChange({ start: e.target.value })}
          />
          <span>至</span>
          <input
            aria-label="结束日期"
            type="date"
            value={view.end}
            onChange={(e) => onChange({ end: e.target.value })}
          />
          {view.start && view.end && view.start > view.end && (
            <span role="alert">起始日期应早于结束日期</span>
          )}
        </div>
      )}
      <div className="active-view-line">
        <span>
          {presetLabels[view.preset]}
          {range.start && ` · ${range.start} 至 ${range.end || "不限"}`}
          {view.timeMode === "undated" && " · 日期待补充"}
        </span>
        {view.channel && (
          <span className="linked-filter">
            渠道 {view.channel}
            {view.attribution && ` · ${view.attribution}`}
            <button
              aria-label="清除渠道联动"
              onClick={() => onChange({ channel: "", attribution: "" })}
            >
              <X size={13} />
            </button>
          </span>
        )}
        {view.exactOnly && <span>已确认确切值</span>}
        {view.layout !== "board" && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={view.groupByMonth}
              onChange={(event) =>
                onChange({ groupByMonth: event.target.checked })
              }
            />
            按月分组
          </label>
        )}
        <button
          className="text-button"
          onClick={() =>
            onChange({ ...initialView(kind), preset: "", layout: view.layout })
          }
        >
          清除筛选
        </button>
      </div>
      {saved.length > 0 && (
        <div className="saved-view-list">
          {(allViews ? saved : saved.slice(0, 3)).map((entry) => (
            <span className="saved-view" key={entry.id}>
              <button onClick={() => onChange({ ...entry, page: 1 })}>
                {entry.name}
              </button>
              <button
                aria-label={`移除视图${entry.name}`}
                onClick={() => onRemove(entry.id)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {saved.length > 3 && (
            <button
              className="text-button"
              onClick={() => setAllViews(!allViews)}
            >
              {allViews ? "收起视图" : `全部视图 ${saved.length}`}
            </button>
          )}
        </div>
      )}
      {saving && (
        <form
          className="save-view-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && onSave(name.trim())) {
              setName("");
              setSaving(false);
              setFeedback("视图已保存在此浏览器");
            } else
              setFeedback(
                "保存失败，请检查名称与浏览器存储空间，最多保存 40 个视图",
              );
          }}
        >
          <input
            autoFocus
            required
            maxLength={32}
            aria-label="视图名称"
            placeholder="为当前筛选命名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn primary" type="submit">
            保存视图
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => setSaving(false)}
          >
            取消
          </button>
        </form>
      )}
      {feedback && (
        <p className="view-hint" role="status">
          {feedback}
        </p>
      )}
    </div>
  );
}

export function Pagination({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <nav className="pagination" aria-label="记录分页">
      <span>
        共 {total} 条
        {total > 0 &&
          ` · 显示 ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} 条`}
      </span>
      <div>
        <button
          className="btn"
          disabled={page <= 1}
          aria-label="上一页"
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={15} />
        </button>
        <span aria-live="polite">
          {page} / {pages}
        </span>
        <button
          className="btn"
          disabled={page >= pages}
          aria-label="下一页"
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </nav>
  );
}

export function RecordCards({
  rows,
  onOpen,
}: {
  rows: Row[];
  onOpen: (row: Row) => void;
}) {
  return (
    <div className="record-cards">
      {rows.map((row) => (
        <button
          className="record-card"
          key={row.id}
          onClick={() => onOpen(row)}
        >
          <div className="record-card-top">
            <span>{row.category || labels[row.kind]}</span>
            <Badge value={row.status} />
          </div>
          <h3>{row.title}</h3>
          <p>{row.notes || "暂无说明"}</p>
          <div className="record-card-meta">
            <span>
              <CalendarDays size={13} />
              {recordDate(row) || "日期待补充"}
            </span>
            <ChevronRight size={15} />
          </div>
        </button>
      ))}
    </div>
  );
}

export function RecordListing({
  rows,
  allRows,
  filteredRows,
  kind,
  today,
  view,
  canEdit,
  onOpen,
  onEdit,
  onDelete,
  onAttachment,
}: {
  rows: Row[];
  allRows: Row[];
  filteredRows: Row[];
  kind: Kind;
  today: string;
  view: ViewState;
  canEdit: boolean;
  onOpen: (row: Row) => void;
  onEdit: (row: Row) => void;
  onDelete: (row: Row) => void;
  onAttachment: (row: Row) => void;
}) {
  function render(records: Row[]) {
    if (view.layout === "cards")
      return <RecordCards rows={records} onOpen={onOpen} />;
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>名称 / 说明</th>
              <th>
                {kind === "recruitment" ? "渠道 / 方向" : "分类 / 优先级"}
              </th>
              <th>
                {kind === "recruitment" || kind === "communities"
                  ? "数量"
                  : "关联事项"}
              </th>
              {kind === "recruitment" && <th>成果归属</th>}
              <th>状态</th>
              <th>{kind === "tasks" ? "截止日期" : "记录日期"}</th>
              <th>来源</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {records.map((row) => (
              <tr key={row.id}>
                <td>
                  <button className="row-title" onClick={() => onOpen(row)}>
                    {row.title}
                  </button>
                  <p className="row-notes" title={row.notes}>
                    {row.notes || "暂无说明"}
                  </p>
                  {row.evidence && (
                    <a
                      className="evidence-link"
                      href={row.evidence}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Link2 size={12} />
                      查看证据
                    </a>
                  )}
                  {row.attachment && (
                    <button
                      className="evidence-link"
                      onClick={() => onAttachment(row)}
                    >
                      <FolderOpen size={12} />
                      附件
                    </button>
                  )}
                </td>
                <td>
                  {kind === "tasks" ? (
                    <Badge value={row.priority} />
                  ) : (
                    row.channel || row.category || "未分类"
                  )}
                  {kind === "recruitment" && (
                    <small className="cell-sub">{row.direction}</small>
                  )}
                </td>
                <td>
                  {kind === "recruitment" || kind === "communities"
                    ? countText(row)
                    : allRows.find(
                        (other) =>
                          other.id ===
                          (row.groupId || row.activityId || row.relatedId),
                      )?.title || "未关联"}
                </td>
                {kind === "recruitment" && (
                  <td>
                    <span
                      className={row.attribution === "团队" ? "team-tag" : ""}
                    >
                      {row.attribution}
                    </span>
                  </td>
                )}
                <td>
                  <Badge value={row.status} />
                </td>
                <td className="nowrap">
                  {recordDate(row) || <span className="muted">待补充</span>}
                </td>
                <td className="nowrap">
                  <span className="source-tag">{row.source}</span>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      className="icon-btn"
                      aria-label={`编辑${row.title}`}
                      disabled={!canEdit}
                      onClick={() => onEdit(row)}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-btn danger"
                      aria-label={`删除${row.title}`}
                      disabled={!canEdit}
                      onClick={() => onDelete(row)}
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
    );
  }
  if (!view.groupByMonth) return render(rows);
  const totals = new Map(
    groupMonths(filteredRows).map(([month, records]) => [
      month,
      records.length,
    ]),
  );
  return (
    <div className="month-groups">
      {groupMonths(rows).map(([month, records]) => (
        <details
          key={month}
          className="month-group"
          open={!month || month === today.slice(0, 7)}
        >
          <summary>
            {month ? `${month.replace("-", " 年 ")} 月` : "日期待补充"}
            <span>
              {totals.get(month)} 条 · 本页 {records.length} 条
            </span>
          </summary>
          {render(records)}
        </details>
      ))}
    </div>
  );
}

export function RecordDrawer({
  row,
  rows,
  onClose,
  onOpen,
  onEdit,
  canEdit,
}: {
  row: Row | null;
  rows: Row[];
  onClose: () => void;
  onOpen: (row: Row) => void;
  onEdit: (row: Row) => void;
  canEdit: boolean;
}) {
  const links = row ? relatedRows(row, rows) : [];
  return (
    <Dialog.Root
      open={!!row}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className="record-drawer">
          <div className="drawer-head">
            <div>
              <span className="eyebrow">{row ? labels[row.kind] : "记录"}</span>
              <Dialog.Title>{row?.title}</Dialog.Title>
              <Dialog.Description>完整记录与关联事项</Dialog.Description>
            </div>
            <Dialog.Close className="icon-btn" aria-label="关闭记录详情">
              <X size={20} />
            </Dialog.Close>
          </div>
          {row && (
            <>
              <div className="drawer-status">
                <Badge value={row.status} />
                <span>{row.category || "未分类"}</span>
                <button
                  className="btn"
                  disabled={!canEdit}
                  onClick={() => onEdit(row)}
                >
                  <Pencil size={14} />
                  编辑记录
                </button>
              </div>
              <dl className="detail-fields">
                {[
                  ["记录日期", row.date || "待补充"],
                  ["截止日期", row.dueDate || "未设定"],
                  ["渠道", row.channel || "待补充"],
                  ["来源", row.source],
                  ...(["recruitment", "communities"].includes(row.kind)
                    ? [
                        ["数量", countText(row)],
                        ["成果归属", row.attribution],
                      ]
                    : []),
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <section className="detail-section">
                <h3>说明与核验口径</h3>
                <p className="detail-notes">{row.notes || "暂无说明"}</p>
              </section>
              <section className="detail-section">
                <h3>证据与来源</h3>
                {row.evidence ? (
                  <a
                    href={row.evidence}
                    target="_blank"
                    rel="noreferrer"
                    className="text-button"
                  >
                    <Link2 size={14} />
                    打开证据链接
                  </a>
                ) : (
                  <p className="muted">证据链接待补充</p>
                )}
                <p className="detail-updated">
                  更新于{" "}
                  {new Date(row.updatedAt).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    hour12: false,
                  })}
                  （北京时间）
                </p>
                {row.sourceUpdatedAt && (
                  <p className="detail-updated">
                    来源观察时间 {row.sourceUpdatedAt}
                  </p>
                )}
              </section>
              <section className="detail-section">
                <h3>关联事项 {links.length}</h3>
                <div className="detail-links">
                  {links.map((other) => (
                    <button key={other.id} onClick={() => onOpen(other)}>
                      <span>
                        <small>{labels[other.kind]}</small>
                        <strong>{other.title}</strong>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                  {links.length === 0 && <p className="muted">暂无关联记录</p>}
                </div>
              </section>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function GlobalSearch({
  open,
  rows,
  onClose,
  onOpen,
}: {
  open: boolean;
  rows: Row[];
  onClose: () => void;
  onOpen: (row: Row) => void;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  const found = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return [];
    return rows.filter((row) =>
      `${row.title} ${row.notes} ${row.channel} ${row.category}`
        .toLocaleLowerCase()
        .includes(term),
    );
  }, [rows, query]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="搜索全部记录"
      description="跨模块查找历史与当前事项"
      wide
    >
      <label className="search-box global-search-input">
        <Search size={17} />
        <input
          ref={input}
          autoFocus
          aria-label="全局搜索关键词"
          placeholder="搜索名称、渠道或说明"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="global-search-results">
        {found.slice(0, 30).map((row) => (
          <button
            key={row.id}
            onClick={() => {
              onClose();
              onOpen(row);
            }}
          >
            <span>
              <small>
                {labels[row.kind]} · {row.date || "日期待补充"}
              </small>
              <strong>{row.title}</strong>
            </span>
            <Badge value={row.status} />
            <ArrowRight size={14} />
          </button>
        ))}
      </div>
      <p className="view-hint" role="status">
        {query.trim()
          ? `匹配 ${found.length} 条${found.length > 30 ? "，请补充关键词缩小范围" : ""}`
          : "输入关键词开始搜索"}
      </p>
    </Modal>
  );
}

export function StatusChart({
  title,
  rows,
  statuses,
  onSelect,
}: {
  title: string;
  rows: Row[];
  statuses: Row["status"][];
  onSelect: (status: string) => void;
}) {
  const max = Math.max(
    1,
    ...statuses.map(
      (status) => rows.filter((row) => row.status === status).length,
    ),
  );
  return (
    <section className="panel status-chart">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          <p>点击状态查看全部明细</p>
        </div>
        <span className="chart-total">
          {rows.length}
          <small>条</small>
        </span>
      </div>
      <div className="status-bars">
        {statuses.map((status) => {
          const count = rows.filter((row) => row.status === status).length;
          return (
            <button
              key={status}
              aria-label={`${title}：${status} ${count}条`}
              onClick={() => onSelect(status)}
            >
              <span>{status}</span>
              <span className="status-track">
                <i style={{ width: `${(count / max) * 100}%` }} />
              </span>
              <strong>{count}</strong>
            </button>
          );
        })}
      </div>
    </section>
  );
}
