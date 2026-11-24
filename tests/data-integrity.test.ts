import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { calculate, countText, emptyRow, workspaceSchema, rowSchema, planImport, type Row } from "../src/domain";
import { aggregateChannels, filterRows, initialView } from "../src/workspace-views";

const actual = JSON.parse(readFileSync(new URL("../data/workspace.json", import.meta.url), "utf8"));
const w = workspaceSchema.parse(actual.workspace);
// Frozen minimal Revision 28 fixture: future live edits must not invalidate historical assertions.
const baseline = [
  {
    "id": "seed-friends",
    "kind": "recruitment",
    "title": "熟人邀请（团队共同）",
    "status": "待核实",
    "date": "",
    "channel": "熟人邀请",
    "count": 51,
    "countMode": "exact",
    "attribution": "团队",
    "direction": "新增",
    "updatedAt": "2026-11-15T14:02:44.084Z"
  },
  {
    "id": "seed-exits",
    "kind": "recruitment",
    "title": "成员退出记录",
    "status": "已确认",
    "date": "",
    "channel": "待补充",
    "count": 4,
    "countMode": "exact",
    "attribution": "未明确",
    "direction": "退出",
    "updatedAt": "2026-11-08T10:48:27.612Z"
  },
  {
    "id": "community-cdu-tencent-cloud",
    "kind": "communities",
    "title": "腾讯云 × 成都大学 AI 官方交流社群｜一群（档案名）",
    "status": "已确认",
    "date": "2026-11-05",
    "channel": "企业微信客户群",
    "count": null,
    "countMode": "unknown",
    "attribution": "未明确",
    "direction": "其他",
    "updatedAt": "2026-11-21T11:32:20.012Z"
  },
  {
    "id": "recruitment-20261105-evening-classes",
    "kind": "recruitment",
    "title": "11 月 5 日晚自习走班新增",
    "status": "已确认",
    "date": "2026-11-05",
    "channel": "晚自习走班",
    "count": 8,
    "countMode": "exact",
    "attribution": "团队",
    "direction": "新增",
    "updatedAt": "2026-11-15T14:02:44.084Z"
  },
  {
    "id": "recruitment-20261105-corridor",
    "kind": "recruitment",
    "title": "11 月 5 日连廊交流新增",
    "status": "已确认",
    "date": "2026-11-05",
    "channel": "连廊交流",
    "count": 3,
    "countMode": "exact",
    "attribution": "团队",
    "direction": "新增",
    "updatedAt": "2026-11-05T14:33:29.960Z"
  },
  {
    "id": "history-recruit-class-report-20261110",
    "kind": "recruitment",
    "title": "走班宣讲新增 9 人（日期待核实）",
    "status": "已确认",
    "date": "",
    "channel": "线下走班宣讲",
    "count": 9,
    "countMode": "exact",
    "attribution": "未明确",
    "direction": "新增",
    "updatedAt": "2026-11-15T14:02:44.084Z"
  },
  {
    "id": "history-recruit-friends-report-20261110",
    "kind": "recruitment",
    "title": "好友关系邀请 2 人（日期待核实）",
    "status": "已确认",
    "date": "",
    "channel": "熟人邀请",
    "count": 2,
    "countMode": "exact",
    "attribution": "未明确",
    "direction": "新增",
    "updatedAt": "2026-11-15T14:02:44.084Z"
  },
  {
    "id": "community-cdu-tencent-cloud-2",
    "kind": "communities",
    "title": "腾讯云 × 成都大学 AI 官方交流社群｜二群（档案名）",
    "status": "已确认",
    "date": "2026-11-16",
    "channel": "企业微信客户群",
    "count": null,
    "countMode": "unknown",
    "attribution": "未明确",
    "direction": "其他",
    "updatedAt": "2026-11-21T11:32:20.012Z"
  },
  {
    "id": "snapshot-20261116-two-groups",
    "kind": "interactions",
    "title": "两群合计人数快照：219 人",
    "status": "已确认",
    "date": "2026-11-16",
    "channel": "社群人数快照",
    "count": 219,
    "countMode": "exact",
    "attribution": "未明确",
    "direction": "其他",
    "updatedAt": "2026-11-16T07:14:48.328Z"
  },
  {
    "id": "recruitment-20261116-friends-growth",
    "kind": "recruitment",
    "title": "熟人邀请推动社群增长（195→219 阶段）",
    "status": "已确认",
    "date": "2026-11-16",
    "channel": "熟人邀请",
    "count": null,
    "countMode": "unknown",
    "attribution": "团队",
    "direction": "新增",
    "updatedAt": "2026-11-16T07:14:48.328Z",
    "netGrowth": {
      "startCount": 195,
      "endCount": 219,
      "startDate": ""
    }
  },
  {
    "status": "已确认",
    "date": "2026-11-21",
    "attribution": "未明确",
    "updatedAt": "2026-11-21T11:32:20.012Z",
    "id": "snapshot-20261121-total-305",
    "kind": "interactions",
    "title": "社群人数快照：305 人",
    "channel": "社群人数快照",
    "count": 305,
    "countMode": "exact",
    "direction": "其他"
  },
  {
    "status": "已确认",
    "date": "2026-11-21",
    "attribution": "未明确",
    "updatedAt": "2026-11-21T11:32:20.012Z",
    "id": "recruitment-20261121-online-193-305",
    "kind": "recruitment",
    "title": "线上人员拉新：社群从193人增长至305人",
    "channel": "线上人员拉新",
    "count": null,
    "countMode": "unknown",
    "direction": "新增",
    "netGrowth": {
      "startCount": 193,
      "endCount": 305,
      "startDate": ""
    }
  }
].map(r => rowSchema.parse(r));
const snap = (id:string,date:string,count:number):Row => ({...emptyRow("interactions"),id,date,count,countMode:"exact",status:"已确认",channel:"社群人数快照"});
describe("V1.4 consistency",()=>{
  it("real production candidate retains history and reads 305",()=>{
    expect(w.rows.length).toBe(actual.workspace.rows.length);
    expect(w.changeLog).toEqual(actual.workspace.changeLog);
    expect(w.narrativeAlerts).toEqual(actual.workspace.narrativeAlerts);
    expect(calculate(baseline).groupCount).toBe(305);
    expect(calculate(baseline).groupDate).toBe("2026-11-21");
  });
  it("stage net is separate from gross and overlapping stages are never summed",()=>{
    const m=calculate(baseline);
    expect(m.stages.map(r=>r.netGrowth!.endCount-r.netGrowth!.startCount)).toEqual([112,24]);
    expect(m.channelCount).toBe(11);
    expect(m.teamCount).toBe(11);
    expect(m.exits).toBe(4);
    expect(countText(m.stages[0])).toContain("+112");
    expect(aggregateChannels(baseline).reduce((n,r)=>n+r.value,0)).toBe(m.channelCount+m.teamCount);
  });
  it("chart and filtered detail use the same exact rows",()=>{
    for(const c of aggregateChannels(w.rows)){
      const rows=filterRows(w.rows,"recruitment",{...initialView("recruitment"),channel:c.channel,attribution:c.attribution,exactOnly:true,status:"已确认",direction:"新增"},"2026-11-25");
      const m=calculate(rows);
      expect(m.channelCount+m.teamCount).toBe(c.value);
    }
  });
  it("old date never overrides newer snapshot, zero is valid, conflicting snapshots are explicit",()=>{
    const a=snap("a","2026-11-21",305), b=snap("b","2026-11-20",999), c=snap("c","2026-11-22",0);
    expect(calculate([a,b]).groupCount).toBe(305);
    expect(calculate([a,b,c]).groupCount).toBe(0);
    expect(calculate([a,{...a,id:"d",count:306}]).groupConflict).toBe(true);
    expect(calculate([a,{...a,id:"d",count:306}]).groupCount).toBeNull();
  });
  it("newer explicitly observed complete group totals supersede older snapshot; mixed dates do not",()=>{
    const a=snap("a","2026-11-21",305);
    const g:Row={...emptyRow("communities"),status:"已确认",count:200,countMode:"exact",memberObservedAt:"2026-11-22"};
    const h:Row={...g,id:"g2",count:110};
    expect(calculate([a,g,h]).groupCount).toBe(310);
    expect(calculate([a,g,{...h,memberObservedAt:"2026-11-20"}]).groupCount).toBe(305);
  });
  it("rejects stage mixed with gross; accepts declining stage",()=>{
    const r={...emptyRow("recruitment"),direction:"新增",netGrowth:{startCount:8,endCount:2,startDate:""}};
    expect(rowSchema.safeParse(r).success).toBe(true);
    expect(rowSchema.safeParse({...r,count:6,countMode:"exact"}).success).toBe(false);
  });
  it("reimport is idempotent and preserves V2 history",()=>{
    const p=planImport(w,w);
    expect(p.added+p.updated).toBe(0);
    expect(p.next.changeLog).toEqual(w.changeLog);
  });
});
