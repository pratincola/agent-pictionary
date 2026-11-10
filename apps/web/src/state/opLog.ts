import type { DrawOp, OpLogEntry } from "@pictionary/protocol";

/**
 * The client-side mirror of a round's append-only op log.
 *
 * `generation` increments whenever rendering must start from a blank canvas
 * (snapshot resync, erase, clear, new round). Appends keep the generation,
 * so the renderer can draw only the new ops.
 */
export interface OpLogState {
  readonly ops: readonly OpLogEntry[];
  readonly generation: number;
}

export type OpLogAction =
  | { type: "snapshot"; ops: readonly OpLogEntry[] }
  | { type: "op"; opSeq: number; op: DrawOp }
  | { type: "merge"; ops: readonly OpLogEntry[] }
  | { type: "erased"; opSeq: number }
  | { type: "cleared" }
  | { type: "reset" };

export const emptyOpLog: OpLogState = { ops: [], generation: 0 };

export function lastOpSeq(state: OpLogState): number {
  return state.ops.length === 0 ? 0 : (state.ops[state.ops.length - 1] as OpLogEntry).opSeq;
}

/** True when `opSeq` would leave a hole after the last known op (reconnect gap). */
export function hasGap(state: OpLogState, opSeq: number): boolean {
  return opSeq > lastOpSeq(state) + 1;
}

export function opLogReducer(state: OpLogState, action: OpLogAction): OpLogState {
  switch (action.type) {
    case "snapshot":
      return { ops: sortUnique(action.ops), generation: state.generation + 1 };
    case "reset":
      return { ops: [], generation: state.generation + 1 };
    case "op": {
      if (action.opSeq <= lastOpSeq(state)) {
        // Duplicate or out-of-order delivery: the log already covers it.
        if (state.ops.some((e) => e.opSeq === action.opSeq)) return state;
        return {
          ops: sortUnique([...state.ops, { opSeq: action.opSeq, op: action.op }]),
          generation: state.generation + 1,
        };
      }
      return {
        ops: [...state.ops, { opSeq: action.opSeq, op: action.op }],
        generation: state.generation,
      };
    }
    case "merge": {
      const known = new Set(state.ops.map((e) => e.opSeq));
      const fresh = action.ops.filter((e) => !known.has(e.opSeq));
      if (fresh.length === 0) return state;
      const appendOnly = fresh.every((e) => e.opSeq > lastOpSeq(state));
      const ops = sortUnique([...state.ops, ...fresh]);
      return { ops, generation: appendOnly ? state.generation : state.generation + 1 };
    }
    case "erased": {
      const idx = state.ops.findIndex((e) => e.opSeq === action.opSeq);
      if (idx < 0 || state.ops[idx]?.erased) return state;
      const ops = state.ops.slice();
      ops[idx] = { ...(ops[idx] as OpLogEntry), erased: true };
      return { ops, generation: state.generation + 1 };
    }
    case "cleared": {
      if (state.ops.every((e) => e.erased)) return state;
      return {
        ops: state.ops.map((e) => (e.erased ? e : { ...e, erased: true })),
        generation: state.generation + 1,
      };
    }
  }
}

/** Ops to paint, in order, skipping erased entries. */
export function visibleOps(state: OpLogState): DrawOp[] {
  const out: DrawOp[] = [];
  for (const e of state.ops) if (!e.erased) out.push(e.op);
  return out;
}

function sortUnique(entries: readonly OpLogEntry[]): OpLogEntry[] {
  const byseq = new Map<number, OpLogEntry>();
  for (const e of entries) {
    const prev = byseq.get(e.opSeq);
    // Keep the erased flag if either copy has it.
    byseq.set(e.opSeq, prev?.erased && !e.erased ? { ...e, erased: true } : e);
  }
  return [...byseq.values()].sort((a, b) => a.opSeq - b.opSeq);
}
