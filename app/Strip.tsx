import { cycleStart, type Plan } from "@/lib/coverage";

export type Cell = "on" | "pv" | "ov" | "";

/**
 * 12 cycles from cycle k0: paid (on), this payment (pv), unpaid and already started (ov).
 * Cycles before the person joined stay blank.
 */
export function stripCells(plan: Plan, k0: number, startCycle: number, through: number, upTo: number, today: string): Cell[] {
  return Array.from({ length: 12 }, (_, i) => {
    const k = k0 + i;
    return k < startCycle ? "" : k <= through ? "on" : k <= upTo ? "pv" : cycleStart(plan, k) <= today ? "ov" : "";
  });
}

export default function Strip({ cells, labels }: { cells: Cell[]; labels?: [string, string] }) {
  const row = <span className="strip" aria-hidden>{cells.map((c, i) => <i key={i} className={c} />)}</span>;
  if (!labels) return row;
  return (
    <div className="strip-labelled" aria-hidden>
      {row}
      <span className="strip-ends"><span>{labels[0]}</span><span>{labels[1]}</span></span>
    </div>
  );
}
