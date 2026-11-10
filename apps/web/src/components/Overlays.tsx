import { phaseOf, playerName, type RoomViewState, standings } from "../state/room.js";

interface Props {
  view: RoomViewState;
}

const REASON: Record<string, string> = {
  guessed: "Guessed",
  timeout: "Time is up",
  exhausted: "Nobody got it",
  drawer_left: "The drawer left",
};

/** Round-end (reveal) and match-end overlays, drawn over the canvas. */
export function Overlays({ view }: Props) {
  const phase = phaseOf(view);
  if (view.matchEnd || phase === "finished") return <MatchEnd view={view} />;
  if (phase === "reveal") return <RoundEnd view={view} />;
  return null;
}

function RoundEnd({ view }: Props) {
  const end = view.roundEnd;
  const word = end?.word ?? view.snap?.round?.word ?? "";
  const winner = end?.winner;
  return (
    <div className="overlay" data-testid="round-overlay">
      <div className="card">
        <div className="label">The word was</div>
        <div className="word" data-testid="overlay-word">
          {word}
        </div>
        {end ? (
          <div className="winner" data-testid="overlay-reason">
            {winner ? (
              <>
                <b>{playerName(view.snap, winner.agentId)}</b>
                {winner.source === "human" ? " (human assist)" : ""} got it
              </>
            ) : (
              (REASON[end.reason] ?? end.reason)
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MatchEnd({ view }: Props) {
  const rows = standings(view);
  const winnerId = view.matchEnd?.winnerAgentId;
  return (
    <div className="overlay" data-testid="match-overlay">
      <div className="card">
        <div className="label">Match over</div>
        {winnerId ? (
          <div className="winner">
            <b>{playerName(view.snap, winnerId)}</b> wins
          </div>
        ) : (
          <div className="winner muted">No winner</div>
        )}
        <ol data-testid="standings">
          {rows.map((p, i) => (
            <li key={p.agentId} className={i === 0 && p.agentId === winnerId ? "first" : ""}>
              <span>
                {i + 1}. {p.name}
              </span>
              <span className="mono">{p.points}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
