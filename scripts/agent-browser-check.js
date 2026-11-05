async (previewPage) => {
  const context = await previewPage.context().browser().newContext({viewport:{width:1440,height:1100}});
  const page = await context.newPage();
  try {
  const checks = [];
  const assert = (ok, message) => { if (!ok) throw new Error(message); checks.push(message); };
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('http://127.0.0.1:5173/#tasks'); await page.reload();
  await page.waitForFunction(() => !!window.campusWorkbench);
  const initial = await page.evaluate(() => window.campusWorkbench.read({ kind: 'tasks' }));
  assert(initial.total === 3, 'GPT 接口可读取真实任务和当前版本');
  const created = await page.evaluate(async revision => window.campusWorkbench.mutate({ expectedRevision: revision, operations: [{ type: 'create', kind: 'tasks', values: { title: 'GPT接口验收临时任务', notes: '验收后删除', priority: '高' } }] }), initial.revision);
  assert(created.saved && await page.getByRole('button', { name: 'GPT接口验收临时任务', exact: true }).isVisible(), 'GPT 新增通过页面同步显示并保存');
  const record = await page.evaluate(() => window.campusWorkbench.read({ kind: 'tasks', search: 'GPT接口验收临时任务' }));
  const changed = await page.evaluate(async ({ id, revision }) => window.campusWorkbench.mutate({ expectedRevision: revision, operations: [{ type: 'update', id, values: { status: '已完成' } }] }), { id: record.rows[0].id, revision: record.revision });
  const readBack = await page.evaluate(() => window.campusWorkbench.read({ search: 'GPT接口验收临时任务' }));
  assert(changed.saved && readBack.rows[0].status === '已完成' && readBack.rows[0].notes === '验收后删除', 'GPT 修改任务状态并回读保留其他字段');
  await page.getByRole('button', { name: '新增任务', exact: true }).first().click();
  const blocked = await page.evaluate(async ({ id, revision }) => { try { await window.campusWorkbench.mutate({ expectedRevision: revision, operations: [{ type: 'delete', id }] }); return false; } catch { return true; } }, { id: record.rows[0].id, revision: readBack.revision });
  assert(blocked, '正在编辑的页面草稿阻止 GPT 写入');
  await page.getByRole('button', { name: '保留草稿并关闭', exact: true }).click();
  const stale = await page.evaluate(async ({ id, revision }) => { try { await window.campusWorkbench.mutate({ expectedRevision: revision - 1, operations: [{ type: 'delete', id }] }); return false; } catch { return true; } }, { id: record.rows[0].id, revision: readBack.revision });
  assert(stale, 'GPT 旧版本提交被拒绝');
  await page.evaluate(async ({ id, revision }) => window.campusWorkbench.mutate({ expectedRevision: revision, operations: [{ type: 'delete', id }] }), { id: record.rows[0].id, revision: readBack.revision });
  assert(await page.getByRole('button', { name: 'GPT接口验收临时任务', exact: true }).count() === 0, 'GPT 删除后页面同步解除记录');
  const exported = await page.evaluate(() => JSON.parse(window.campusWorkbench.exportData({ format: 'json' }).content));
  assert(exported.rows.length === 8, 'GPT 可导出完整数据且验收记录已清理');
  const webMcp = await page.evaluate(() => typeof document.modelContext?.registerTool === 'function');
  return { passed: checks.length, checks, webMcpRegistryAvailable: webMcp };
  } finally { await context.close(); }
}
