import type { GuessFeedItem } from "@pictionary/protocol";
import { useEffect, useLayoutEffect, useReducer, useRef } from "react";
import { autoscrollReducer, initialAutoscroll, shouldScrollOnAppend } from "../state/autoscroll.js";
import { playerName, type RoomViewState } from "../state/room.js";

interface Props {
  view: RoomViewState;
}

const RESULT_LABEL: Record<GuessFeedItem["result"], string> = {
  correct: "correct",
  incorrect: "miss",
  close: "close",
  late: "late",
  round_over: "late",
};

export function Feed({ view }: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const [scroll, dispatch] = useReducer(autoscrollReducer, initialAutoscroll);
  const feed = view.feed;
  const roundIndex = view.snap?.round?.roundIndex;

  // New round: pin to the bottom again.
  const prevRound = useRef(roundIndex);
  useEffect(() => {
    if (prevRound.current === roundIndex) return;
    prevRound.current = roundIndex;
    dispatch({ type: "reset" });
  }, [roundIndex]);

  // Autoscroll on append unless the user scrolled up.
  const count = feed.length;
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || count === 0) return;
    if (shouldScrollOnAppend(scroll)) el.scrollTop = el.scrollHeight;
  }, [count, scroll]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    dispatch({
      type: "scroll",
      metrics: {
        scrollTop: el.scrollTop,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
      },
    });
  };

  const jump = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    dispatch({ type: "reset" });
  };

  return (
    <section className="panel" aria-label="guess feed">
      <h2>
        <span>Guesses</span>
        <span className="muted" data-testid="feed-count">
          {feed.length}
        </span>
      </h2>
      <div className="feed-body">
        <ul className="feed-list" ref={listRef} onScroll={onScroll} data-testid="feed">
          {feed.length === 0 ? <li className="feed-empty">No guesses yet.</li> : null}
          {feed.map((g) => (
            <li
              key={g.seq}
              className="feed-item"
              data-result={g.result}
              data-source={g.source}
              data-testid="feed-item"
            >
              <span className="who">
                {playerName(view.snap, g.agentId)}
                <span className={`badge ${g.source}`}>{g.source}</span>
              </span>
              <span className="text">{g.text}</span>
              <span className="result">{RESULT_LABEL[g.result]}</span>
            </li>
          ))}
        </ul>
        {!scroll.following && feed.length > 0 ? (
          <button type="button" className="feed-jump" onClick={jump}>
            Jump to latest
          </button>
        ) : null}
      </div>
    </section>
  );
}
