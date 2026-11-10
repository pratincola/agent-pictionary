import { useEffect, useRef, useState } from "react";
import { type ClockState, formatCountdown, remainingMs } from "../state/clock.js";
import { type Phase, phaseOf, playerName, type RoomViewState } from "../state/room.js";
import type { SocketStatus } from "../ws.js";

interface Props {
  code: string;
  view: RoomViewState;
  clock: ClockState;
  socket: SocketStatus;
  attempt: number;
}

const PHASE_LABEL: Record<Phase, string> = {
  connecting: "connecting",
  lobby: "lobby",
  choosing: "choosing",
  drawing: "drawing",
  reveal: "reveal",
  finished: "finished",
};

export function Header({ code, view, clock, socket, attempt }: Props) {
  const phase = phaseOf(view);
  const round = view.snap?.round;
  const deadline =
    phase === "choosing" || phase === "drawing" || phase === "reveal" ? round?.deadline : undefined;
  const left = useCountdown(clock, deadline);
  const word = round?.word;
  const pattern = round?.wordPattern ?? "";
  const roundNo = view.snap?.match
    ? `${(view.snap.match.roundIndex ?? 0) + 1}/${view.snap.match.roundsTotal}`
    : null;

  return (
    <header className="header">
      <div className="code">
        <small>room</small>
        <span data-testid="room-code">{code}</span>
      </div>
      <div className="middle">
        <span className="phase" data-phase={phase} data-testid="phase">
          {PHASE_LABEL[phase]}
          {roundNo && phase !== "finished" ? ` · round ${roundNo}` : ""}
        </span>
        {round ? (
          <span className="drawer-name" data-testid="drawer-name">
            <b>{playerName(view.snap, round.drawerAgentId)}</b> draws
          </span>
        ) : null}
        {word && phase === "reveal" ? (
          <span className="word-pattern revealed" data-testid="word">
            {word}
          </span>
        ) : pattern ? (
          <span
            className="word-pattern"
            data-testid="word-pattern"
            title={`${pattern.replace(/ /g, "").length} letters`}
          >
            {pattern}
          </span>
        ) : null}
      </div>
      <div>
        {deadline !== undefined ? (
          <div
            className={`countdown${left < 10_000 && phase === "drawing" ? " urgent" : ""}`}
            data-testid="countdown"
          >
            {formatCountdown(left)}
          </div>
        ) : null}
        <div className="conn" data-status={socket} data-testid="conn">
          {socket === "open"
            ? "live"
            : socket === "reconnecting"
              ? `reconnecting (${attempt})`
              : socket === "connecting"
                ? "connecting"
                : "disconnected"}
        </div>
      </div>
    </header>
  );
}

/** Milliseconds left until `deadline` on the server clock, refreshed 4x per second. */
export function useCountdown(clock: ClockState, deadline: number | undefined): number {
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const [left, setLeft] = useState(() =>
    deadline === undefined ? 0 : remainingMs(clock, deadline, Date.now()),
  );
  useEffect(() => {
    if (deadline === undefined) {
      setLeft(0);
      return;
    }
    const tick = () => setLeft(remainingMs(clockRef.current, deadline, Date.now()));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline]);
  return left;
}
