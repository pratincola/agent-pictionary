import type { ServerMessage } from "@pictionary/protocol";
import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  agentGuessesRemaining,
  humanGuessGate,
  isDrawersHuman,
  myAgentId,
  phaseOf,
  playerName,
  type RoomViewState,
} from "../state/room.js";
import type { ClientMessageType, ClientPayload } from "../ws.js";

export type SendFn = <T extends ClientMessageType>(
  type: T,
  payload: ClientPayload<T>,
) => Promise<ServerMessage>;

interface Props {
  view: RoomViewState;
  send: SendFn;
  /** Called with the text just before a human.guess goes out, so the reply can show it. */
  onGuessSent: (text: string) => void;
}

export function HumanPanel({ view, send, onGuessSent }: Props) {
  const me = myAgentId(view);
  if (!me) return null;
  const phase = phaseOf(view);
  const gate = humanGuessGate(view);
  const agentLeft = agentGuessesRemaining(view, me);
  const mine = view.snap?.round?.myGuessesRemaining;
  const drawersHuman = isDrawersHuman(view);

  return (
    <section className="panel" aria-label="your team" data-testid="human-panel">
      <h2>
        <span>Your team</span>
        <span className="muted">{playerName(view.snap, me)}</span>
      </h2>
      <div className="team">
        <div className="stats">
          <span className="stat">
            <small>Your agent</small>
            <b data-testid="my-agent">{playerName(view.snap, me)}</b>
          </span>
          {phase === "drawing" || phase === "reveal" ? (
            <>
              <span className="stat">
                <small>Agent guesses left</small>
                <b data-testid="agent-left">{drawersHuman ? "—" : agentLeft}</b>
              </span>
              <span className="stat">
                <small>Your guesses left</small>
                <b data-testid="human-left">{drawersHuman ? "—" : (mine ?? 0)}</b>
              </span>
            </>
          ) : null}
        </div>
        {drawersHuman && phase === "choosing" ? (
          <NoteForm send={send} />
        ) : (
          <GuessForm view={view} gate={gate} send={send} onGuessSent={onGuessSent} />
        )}
      </div>
    </section>
  );
}

function GuessForm({
  view,
  gate,
  send,
  onGuessSent,
}: {
  view: RoomViewState;
  gate: ReturnType<typeof humanGuessGate>;
  send: SendFn;
  onGuessSent: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const roundIndex = view.snap?.round?.roundIndex;

  const prevRound = useRef(roundIndex);
  useEffect(() => {
    if (prevRound.current === roundIndex) return;
    prevRound.current = roundIndex;
    setText("");
    setLocalErr(null);
  }, [roundIndex]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || !gate.enabled || busy) return;
    setBusy(true);
    setLocalErr(null);
    onGuessSent(t);
    try {
      const reply = await send("human.guess", { text: t });
      if (reply.type === "error") setLocalErr(reply.payload.message);
      else setText("");
    } catch (err) {
      setLocalErr(err instanceof Error ? err.message : "send failed");
    } finally {
      setBusy(false);
    }
  };

  const last = view.myLastResult;
  return (
    <>
      <form onSubmit={submit}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!gate.enabled || busy}
          placeholder={gate.enabled ? "Your guess" : gate.reason}
          maxLength={200}
          autoComplete="off"
          data-testid="human-input"
          aria-label="your guess"
        />
        <button
          type="submit"
          className="primary"
          disabled={!gate.enabled || busy || !text.trim()}
          data-testid="human-submit"
        >
          Guess
        </button>
      </form>
      <div className="hint" data-testid="human-hint">
        {gate.reason}
      </div>
      {last ? (
        <div className="guess-result" data-result={last.result} data-testid="human-result">
          {last.text ? `"${last.text}" — ` : ""}
          {last.result === "correct"
            ? "Correct!"
            : last.result === "close"
              ? "Close"
              : last.result === "incorrect"
                ? "Not it"
                : "Too late, the round is over"}
        </div>
      ) : null}
      {localErr ? (
        <div className="error" data-testid="human-error">
          {localErr}
        </div>
      ) : null}
    </>
  );
}

function NoteForm({ send }: { send: SendFn }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const reply = await send("human.note", { text: t });
      if (reply.type === "error") {
        setMsg({
          kind: "error",
          text:
            reply.payload.code === "ENTITLEMENT_REQUIRED"
              ? "Your agent needs the custom word entitlement to receive notes."
              : reply.payload.message,
        });
      } else {
        setMsg({ kind: "ok", text: "Note sent to your agent." });
        setText("");
      }
    } catch (err) {
      setMsg({ kind: "error", text: err instanceof Error ? err.message : "send failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="hint">Your agent is choosing a word. Send it an idea (paid feature).</div>
      <form onSubmit={submit}>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          placeholder="Idea for your agent"
          maxLength={200}
          autoComplete="off"
          data-testid="note-input"
          aria-label="note to your agent"
        />
        <button type="submit" disabled={busy || !text.trim()} data-testid="note-submit">
          Send
        </button>
      </form>
      {msg ? (
        <div className={msg.kind === "error" ? "error" : "muted"} data-testid="note-result">
          {msg.text}
        </div>
      ) : null}
    </>
  );
}
