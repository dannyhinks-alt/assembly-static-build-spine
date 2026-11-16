// Live 10-point model integrity & independent self-test.
// Checks 6–8 deliberately re-derive their answers with separate code paths (plain loops over the raw
// workspace, memoised longest-path recursion) so an engine regression cannot mark its own homework.
import type { BopRow, Id, Workspace } from '../types';
import { FACTORY_SCOPE } from '../types';
import type { Model } from './model';
import { buildModel } from './model';

export interface IntegrityCheck {
  n: number;
  key: string;
  title: string;
  pass: boolean;
  detail: string;
}
export interface IntegrityReport {
  checks: IntegrityCheck[];
  passed: number;
  allPass: boolean;
  factory: Model;
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
const list = (xs: string[], max = 6) => (xs.length > max ? `${xs.slice(0, max).join(', ')} +${xs.length - max} more` : xs.join(', '));

export function runIntegrity(ws: Workspace): IntegrityReport {
  const factory = buildModel(ws, FACTORY_SCOPE);
  const active = new Set(ws.fpds.filter((f) => f.active).map((f) => f.fpdId));
  const rows = ws.rows.filter((r) => active.has(r.fpdId));
  const leaves: BopRow[] = [];
  for (const r of rows) {
    if (r.children && r.children.length) leaves.push(...r.children);
    else leaves.push(r);
  }
  const s = ws.settings;
  const steps = Math.max(0, Math.floor(s.learning.selectedBuild) - 1);
  const lc =
    steps >= s.learning.stepBuilds
      ? s.learning.stabilisedPct / 100
      : Math.min(Math.max(s.learning.firstBuildPct, s.learning.stabilisedPct), Math.max(Math.min(s.learning.firstBuildPct, s.learning.stabilisedPct), s.learning.firstBuildPct - s.learning.stepReductionPct * steps)) / 100;
  const af = Math.max(0.01, s.calendar.activeTimeFactorPct / 100);
  const eff = Math.max(0.01, s.calendar.labourEfficiencyPct / 100);
  const checks: IntegrityCheck[] = [];
  const add = (key: string, title: string, pass: boolean, ok: string, bad: string) =>
    checks.push({ n: checks.length + 1, key, title, pass, detail: pass ? ok : bad });

  // 1 — DAG has no cycles
  add('cycle', 'Zero cyclic predecessors in the CPM network', !factory.cpm.hasCycle,
    `${rows.length} nodes sort topologically with no loops.`,
    `Loop detected through: ${list(factory.cpm.cycleOps)}. Break one predecessor link.`);

  // 2 — predecessor references resolve
  const known = new Set<string>();
  for (const r of ws.rows) {
    known.add(r.opId.trim());
    for (const c of r.children ?? []) known.add(c.opId.trim());
  }
  const dangling: string[] = [];
  for (const l of [...rows, ...leaves])
    for (const p of l.predecessors) {
      const ref = p.trim();
      if (ref && ref.toLowerCase() !== 'none' && !known.has(ref)) dangling.push(`${l.opId}→${ref}`);
    }
  const uniqDangling = [...new Set(dangling)];
  add('refs', 'Every predecessor reference resolves to a real Op #', uniqDangling.length === 0,
    'All predecessor links point at existing operations.',
    `${uniqDangling.length} dangling link(s): ${list(uniqDangling)}.`);

  // 3 — unique op IDs
  const seen = new Map<string, number>();
  for (const r of ws.rows) {
    seen.set(r.opId.trim(), (seen.get(r.opId.trim()) ?? 0) + 1);
    for (const c of r.children ?? []) if (c.opId.trim() !== r.opId.trim()) seen.set(c.opId.trim(), (seen.get(c.opId.trim()) ?? 0) + 1);
  }
  const dup = [...seen.entries()].filter(([k, v]) => v > 1 || k === '').map(([k]) => k || '(blank)');
  add('unique', 'Route Code / Op # values are unique and non-blank', dup.length === 0,
    `${seen.size} distinct Op # values.`, `Duplicate or blank Op #: ${list(dup)}.`);

  // 4 — weights on lift ops
  const missing: string[] = [];
  for (const l of leaves) {
    if (l.liftCount <= 0) continue;
    const comps = l.componentIds.map((id) => ws.components.find((c) => c.id === id));
    if (comps.length === 0 || comps.some((c) => !c || c.weightKg == null || c.weightKg <= 0)) missing.push(l.opId);
  }
  add('weights', 'Zero missing component weights on lift operations', missing.length === 0,
    `${leaves.filter((l) => l.liftCount > 0).length} lift op(s) all carry a weighed component.`,
    `No component or no weight on lift op(s): ${list(missing)}.`);

  // 5 — merged work blocks reconcile to underlying activities
  const bad: string[] = [];
  let blocks = 0;
  for (const r of rows) {
    if (!r.children || !r.children.length) continue;
    blocks++;
    let run = 0, touch = 0, man = 0, lifts = 0, moves = 0;
    for (const c of r.children) {
      run += c.runHrs; touch += c.touchHrs; man += c.manningHrs; lifts += c.liftCount; moves += c.moveCount;
    }
    if (!close(run, r.runHrs) || !close(touch, r.touchHrs) || !close(man, r.manningHrs) || lifts !== r.liftCount || moves !== r.moveCount) bad.push(r.opId);
  }
  add('merge', 'Merged KTP Work Blocks reconcile exactly to their activities', bad.length === 0,
    blocks ? `${blocks} Work Block(s) reconcile on hours, lifts and moves.` : 'No merged Work Blocks — nothing to reconcile.',
    `Header ≠ sum of activities on: ${list(bad)}. Unmerge and re-merge to rebuild.`);

  // 6 — independent labour-hours recalculation
  let labour = 0;
  for (const l of leaves) labour += (l.manningHrs * l.crewSize * lc) / eff;
  add('labour', 'Independent recalculation of total labour hours', close(labour, factory.totals.labourHrs),
    `Engine and independent sum agree at ${labour.toFixed(1)} h.`,
    `Engine ${factory.totals.labourHrs.toFixed(3)} h vs independent ${labour.toFixed(3)} h.`);

  // 7 — independent critical-path recalculation (memoised longest path)
  const owner = new Map<string, Id>();
  for (const r of rows) {
    owner.set(r.opId.trim(), r.id);
    for (const c of r.children ?? []) if (!owner.has(c.opId.trim())) owner.set(c.opId.trim(), r.id);
  }
  const preds = new Map<Id, Id[]>();
  const dur = new Map<Id, number>();
  const prevInFpd = new Map<Id, Id>();
  for (const r of rows) {
    const kids = r.children && r.children.length ? r.children : [r];
    dur.set(r.id, kids.reduce((a, k) => a + (Math.max(k.runHrs, k.manningHrs) / af) * lc, 0));
    const inside = new Set(kids.map((k) => k.opId.trim()).concat(r.opId.trim()));
    const refs = new Set<string>();
    for (const k of [r, ...kids]) for (const p of k.predecessors) if (p.trim() && p.trim().toLowerCase() !== 'none' && !inside.has(p.trim())) refs.add(p.trim());
    const ps = new Set<Id>();
    for (const ref of refs) {
      const o = owner.get(ref);
      if (o && o !== r.id) ps.add(o);
    }
    if (r.taskType === 'Sequential' && refs.size === 0 && prevInFpd.has(r.fpdId)) ps.add(prevInFpd.get(r.fpdId)!);
    prevInFpd.set(r.fpdId, r.id);
    preds.set(r.id, [...ps]);
  }
  const memo = new Map<Id, number>();
  const visiting = new Set<Id>();
  const longest = (id: Id): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let best = 0;
    for (const p of preds.get(id) ?? []) best = Math.max(best, longest(p));
    visiting.delete(id);
    const v = best + (dur.get(id) ?? 0);
    memo.set(id, v);
    return v;
  };
  let cp = 0;
  for (const r of rows) cp = Math.max(cp, longest(r.id));
  add('cpm', 'Independent recalculation of critical-path duration', factory.cpm.hasCycle ? false : close(cp, factory.cpm.durationHrs),
    `Forward pass and longest-path recursion agree at ${cp.toFixed(1)} elapsed h.`,
    factory.cpm.hasCycle ? 'Cannot verify while the network contains a loop (see check 1).' : `Engine ${factory.cpm.durationHrs.toFixed(3)} h vs independent ${cp.toFixed(3)} h.`);

  // 8 — independent lift count
  let lifts = 0;
  let liftOps = 0;
  for (const l of leaves) {
    lifts += l.liftCount;
    if (l.liftCount > 0) liftOps++;
  }
  add('lifts', 'Independent recalculation of lift counts', lifts === factory.totals.lifts && liftOps === factory.lifts.length,
    `${lifts} lift(s) across ${liftOps} lift op(s) on both paths.`,
    `Engine ${factory.totals.lifts} lifts / ${factory.lifts.length} ops vs independent ${lifts} / ${liftOps}.`);

  // 9 — time logic & referential integrity
  const issues: string[] = [];
  const zoneIds = new Set(ws.zones.map((z) => z.id));
  const resIds = new Set(ws.resources.map((r) => r.id));
  const cmpIds = new Set(ws.components.map((c) => c.id));
  const fpdIds = new Set(ws.fpds.map((f) => f.fpdId));
  for (const l of leaves) {
    if (l.runHrs < 0 || l.touchHrs < 0 || l.manningHrs < 0) issues.push(`${l.opId}: negative time`);
    if (l.touchHrs > l.manningHrs + 1e-9) issues.push(`${l.opId}: touch > manning`);
    if (!(l.crewSize >= 1)) issues.push(`${l.opId}: crew < 1`);
    if (!fpdIds.has(l.fpdId)) issues.push(`${l.opId}: unknown FPD`);
    if ((l.originZoneId && !zoneIds.has(l.originZoneId)) || (l.destZoneId && !zoneIds.has(l.destZoneId))) issues.push(`${l.opId}: unknown zone`);
    if (!l.destZoneId) issues.push(`${l.opId}: no destination zone`);
    if (l.componentIds.some((c) => !cmpIds.has(c))) issues.push(`${l.opId}: unknown component`);
    if ([...l.rigIds, ...l.craneIds, ...l.riggingIds, ...l.vehicleIds, ...l.standIds].some((x) => !resIds.has(x))) issues.push(`${l.opId}: unknown resource tag`);
  }
  add('logic', 'Time logic and reference integrity (Touch ≤ Manning, valid links)', issues.length === 0,
    `${leaves.length} activities pass time-logic and link checks.`, `${issues.length} issue(s): ${list(issues, 4)}.`);

  // 10 — assumptions
  const open = ws.assumptions.filter((a) => !a.confirmed);
  add('assumptions', 'All planning assumptions confirmed', open.length === 0,
    `${ws.assumptions.length} assumption(s) confirmed.`,
    `${open.length} unconfirmed assumption(s) — review in Tab 9 › Assumptions Register.`);

  const passed = checks.filter((c) => c.pass).length;
  return { checks, passed, allPass: passed === checks.length, factory };
}
