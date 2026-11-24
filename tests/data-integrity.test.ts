import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { calculate, countText, emptyRow, workspaceSchema, rowSchema, planImport, type Row } from "../src/domain";
import { aggregateChannels, filterRows, initialView } from "../src/workspace-views";

const actual = JSON.parse(readFileSync(new URL("../data/workspace.json", import.meta.url), "utf8"));
const w = workspaceSchema.parse(actual.workspace);
const snap = (id:string,date:string,count:number):Row => ({...emptyRow("interactions"),id,date,count,countMode:"exact",status:"已确认",channel:"社群人数快照"});
describe("V1.4 consistency",()=>{
  it("real production candidate retains history and reads 305",()=>{
    expect(w.rows.length).toBe(actual.workspace.rows.length);
    expect(w.changeLog).toEqual(actual.workspace.changeLog);
    expect(w.narrativeAlerts).toEqual(actual.workspace.narrativeAlerts);
    expect(calculate(w.rows).groupCount).toBe(305);
    expect(calculate(w.rows).groupDate).toBe("2026-11-21");
  });
  it("stage net is separate from gross and overlapping stages are never summed",()=>{
    const m=calculate(w.rows);
    expect(m.stages.map(r=>r.netGrowth!.endCount-r.netGrowth!.startCount)).toEqual([112,24]);
    expect(m.channelCount).toBe(11);
    expect(m.teamCount).toBe(11);
    expect(m.exits).toBe(4);
    expect(countText(m.stages[0])).toContain("+112");
    expect(aggregateChannels(w.rows).reduce((n,r)=>n+r.value,0)).toBe(m.channelCount+m.teamCount);
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
