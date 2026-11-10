import type { ScoreTable } from "@pictionary/protocol";
import { useEffect, useState } from "react";
import { drawerId, myAgentId, type RoomViewState, standings } from "../state/room.js";

interface Props {
  view: RoomViewState;
}

/** How long per-round deltas stay visible after `round.ended`. */
export const DELTA_VISIBLE_MS = 8_000;

export function Scoreboard({ view }: Props) {
  const rows = standings(view);
  const drawer = drawerId(view);
  const me = myAgentId(view);
  const deltas = useTransientDeltas(view.lastDeltas);
  const inLobby = view.snap?.status === "lobby";

  return (
    <section className="panel scoreboard" aria-label="players">
      <h2>
        <span>Players</span>
        <span className="muted">{rows.length}</span>
      </h2>
      <table>
        <thead>
          <tr>
            <th>Agent</th>
            <th>Humans</th>
            <th style={{ textAlign: "right" }}>Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const d = deltas?.[p.agentId]?.points ?? 0;
            const cls = [p.agentId === drawer ? "drawer" : "", p.agentId === me ? "me" : ""]
              .filter(Boolean)
              .join(" ");
            return (
              <tr key={p.agentId} className={cls} data-testid="player-row" data-agent={p.agentId}>
                <td>
                  <span
                    className={`dot${p.connected ? " on" : ""}`}
                    title={p.connected ? "connected" : "disconnected"}
                  />
                  {p.name}
                  {p.agentId === drawer ? <span className="tag drawing">drawing</span> : null}
                  {inLobby ? (
                    <span className={`tag${p.ready ? " ready" : ""}`}>
                      {p.ready ? "ready" : "not ready"}
                    </span>
                  ) : null}
                  {p.agentId === me ? <span className="tag">you</span> : null}
                </td>
                <td className="muted">{p.humans}</td>
                <td className="points" data-testid="points">
                  {p.points}
                  {d > 0 ? <span className="delta">+{d}</span> : null}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={3} className="muted">
                No agents yet
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}

/** Show the latest round's deltas for a few seconds, then hide them. */
function useTransientDeltas(deltas: ScoreTable | null): ScoreTable | null {
  const [visible, setVisible] = useState<ScoreTable | null>(deltas);
  useEffect(() => {
    setVisible(deltas);
    if (!deltas) return;
    const id = setTimeout(() => setVisible(null), DELTA_VISIBLE_MS);
    return () => clearTimeout(id);
  }, [deltas]);
  return visible;
}
