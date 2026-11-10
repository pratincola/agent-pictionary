import { type FormEvent, useState } from "react";
import { ApiError, createRoom, createSession } from "../api.js";
import { navigate } from "../router.js";
import { saveSession } from "../session.js";

export function JoinPage() {
  const [code, setCode] = useState("");
  const [isHuman, setIsHuman] = useState(false);
  const [pairCode, setPairCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const join = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    setBusy(true);
    setErr(null);
    try {
      if (isHuman) {
        const pc = pairCode.trim().toUpperCase();
        if (!pc) throw new Error("Enter your pair code");
        const session = await createSession(c, "human", pc);
        saveSession(c, { role: "human", pairCode: pc, session });
      } else {
        const session = await createSession(c, "spectator");
        saveSession(c, { role: "spectator", session });
      }
      navigate(`/r/${c}`);
    } catch (ex) {
      setErr(errorText(ex));
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const room = await createRoom();
      // The creator joins as an (unpaired) human so it may press Start in the lobby.
      const session = await createSession(room.code, "human");
      saveSession(room.code, { role: "human", session });
      setCreated(room.code);
    } catch (ex) {
      setErr(errorText(ex));
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="join">
        <div className="join-card">
          <h1>Room created</h1>
          <p className="muted">Share this code with the agents (and their humans):</p>
          <div className="big-code" data-testid="created-code">
            {created}
          </div>
          <button
            type="button"
            className="primary"
            onClick={() => navigate(`/r/${created}`)}
            data-testid="enter-room"
          >
            Enter the room
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="join">
      <form className="join-card" onSubmit={join}>
        <h1>Agent Pictionary</h1>
        <p className="muted" style={{ margin: 0 }}>
          Agents draw and guess. You watch — or coach your own agent.
        </p>
        <label>
          Room code
          <input
            type="text"
            className="code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={8}
            autoComplete="off"
            data-testid="code-input"
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={isHuman}
            onChange={(e) => setIsHuman(e.target.checked)}
            data-testid="human-toggle"
          />
          I am an agent's human
        </label>
        {isHuman ? (
          <label>
            Pair code (from your agent's registration)
            <input
              type="text"
              className="code-input"
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value.toUpperCase())}
              placeholder="PAIR CODE"
              autoComplete="off"
              data-testid="pair-input"
            />
          </label>
        ) : null}
        <button
          type="submit"
          className="primary"
          disabled={busy || !code.trim()}
          data-testid="join-button"
        >
          {isHuman ? "Join as human" : "Watch"}
        </button>
        {err ? (
          <div className="error" data-testid="join-error">
            {err}
          </div>
        ) : null}
        <div className="divider" />
        <div className="row">
          <span className="muted" style={{ flex: 1 }}>
            No room yet?
          </span>
          <button type="button" onClick={create} disabled={busy} data-testid="create-button">
            Create room
          </button>
        </div>
      </form>
    </div>
  );
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "ROOM_NOT_FOUND") return "No room with that code.";
    if (e.code === "UNAUTHORIZED") return "Unknown pair code.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong";
}
