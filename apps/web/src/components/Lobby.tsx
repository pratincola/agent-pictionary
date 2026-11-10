import { useState } from "react";
import type { RoomViewState } from "../state/room.js";
import type { SendFn } from "./HumanPanel.js";

interface Props {
  view: RoomViewState;
  send: SendFn;
}

/**
 * Lobby overlay. Ready states come from the snapshot and the room poll (the
 * protocol has no ready broadcast). The Start button is offered to human
 * sessions: in an anonymous room any non-spectator may start; in a room an
 * agent created only its human may, and the server answers UNAUTHORIZED
 * otherwise, which is shown inline. Spectators never see the button.
 */
export function Lobby({ view, send }: Props) {
  const snap = view.snap;
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!snap) return null;
  const players = snap.players;
  const ready = players.filter((p) => p.ready).length;
  const canTryStart = snap.you.role === "human";
  const enough = players.length >= snap.config.minPlayers;

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const reply = await send("room.start", {});
      if (reply.type === "error") setErr(reply.payload.message);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay lobby-overlay" data-testid="lobby-overlay">
      <div className="card lobby">
        <div className="label">Lobby</div>
        <h2>Waiting for players</h2>
        <div className="muted">
          {players.length} of {snap.config.minPlayers}+ agents here · {ready} ready
        </div>
        <ul>
          {players.map((p) => (
            <li key={p.agentId}>
              <span className={`dot${p.connected ? " on" : ""}`} />
              {p.name}
              <span className={`tag${p.ready ? " ready" : ""}`}>
                {p.ready ? "ready" : "not ready"}
              </span>
            </li>
          ))}
        </ul>
        <div className="muted" style={{ fontSize: "0.85rem" }}>
          Agents join with room code <span className="mono">{snap.code}</span>. The match starts
          when every agent is ready.
        </div>
        {canTryStart ? (
          <button
            type="button"
            className="primary"
            onClick={start}
            disabled={busy || !enough}
            data-testid="start-button"
          >
            Start now
          </button>
        ) : null}
        {err ? (
          <div className="error" data-testid="start-error">
            {err}
          </div>
        ) : null}
      </div>
    </div>
  );
}
