import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ApiError, createSession, getOps, getRoom, wsUrlFor } from "../api.js";
import { Canvas } from "../components/Canvas.js";
import { Feed } from "../components/Feed.js";
import { Header } from "../components/Header.js";
import { HumanPanel, type SendFn } from "../components/HumanPanel.js";
import { Lobby } from "../components/Lobby.js";
import { Overlays } from "../components/Overlays.js";
import { Scoreboard } from "../components/Scoreboard.js";
import { navigate } from "../router.js";
import { clearSession, loadSession, saveSession } from "../session.js";
import { initialClock, observe } from "../state/clock.js";
import { hasGap, lastOpSeq } from "../state/opLog.js";
import { initialRoomView, isPairedHuman, phaseOf, playerName, roomReducer } from "../state/room.js";
import { RoomSocket, type SocketStatus } from "../ws.js";

interface Props {
  code: string;
}

/** Poll interval for GET /rooms/:code (ready states and connection dots are not broadcast). */
const ROOM_POLL_MS = 3_000;
/** After this many failed reconnects, ask the REST API whether the room still exists. */
const CHECK_ROOM_AFTER_ATTEMPTS = 3;

export function RoomPage({ code }: Props) {
  const [view, dispatch] = useReducer(roomReducer, initialRoomView);
  const [clock, setClock] = useState(initialClock);
  const [socket, setSocket] = useState<{ status: SocketStatus; attempt: number }>({
    status: "connecting",
    attempt: 0,
  });
  const [fatal, setFatal] = useState<string | null>(null);
  const sockRef = useRef<RoomSocket | null>(null);
  const viewRef = useRef(view);
  const pendingGuess = useRef<string | undefined>(undefined);
  viewRef.current = view;

  // Session + socket lifecycle.
  useEffect(() => {
    let cancelled = false;
    let sock: RoomSocket | null = null;
    let fillInFlight = false;

    const fillGap = async () => {
      if (fillInFlight) return;
      fillInFlight = true;
      try {
        const after = lastOpSeq(viewRef.current.opLog);
        const res = await getOps(code, after);
        if (!cancelled && res.roundIndex === viewRef.current.snap?.round?.roundIndex) {
          dispatch({ type: "merge-ops", ops: res.ops });
        }
      } catch {
        // The next snapshot (reconnect) resyncs anyway.
      } finally {
        fillInFlight = false;
      }
    };

    (async () => {
      let stored = loadSession(code);
      if (!stored) {
        try {
          const session = await createSession(code, "spectator");
          stored = { role: "spectator", session };
          saveSession(code, stored);
        } catch (e) {
          if (!cancelled) setFatal(errorText(e));
          return;
        }
      }
      if (cancelled) return;
      sock = new RoomSocket(wsUrlFor(stored.session), {
        onMessage(msg, localNow) {
          setClock((c) => observe(c, msg.ts, localNow));
          const pendingText = msg.type === "guess.result" ? pendingGuess.current : undefined;
          if (msg.type === "guess.result") pendingGuess.current = undefined;
          if (msg.type === "draw.op" && hasGap(viewRef.current.opLog, msg.payload.opSeq)) {
            void fillGap();
          }
          dispatch({
            type: "message",
            msg,
            localNow,
            ...(pendingText !== undefined ? { pendingText } : {}),
          });
        },
        onStatus(status, attempt) {
          if (cancelled) return;
          setSocket({ status, attempt });
          if (status === "reconnecting" && attempt >= CHECK_ROOM_AFTER_ATTEMPTS) {
            getRoom(code).catch((e: unknown) => {
              if (cancelled) return;
              if (e instanceof ApiError && e.status === 404) {
                clearSession(code);
                setFatal("This room is closed.");
                sock?.close();
              }
            });
          }
        },
      });
      sockRef.current = sock;
      sock.connect();
    })();

    return () => {
      cancelled = true;
      sock?.close();
      sockRef.current = null;
    };
  }, [code]);

  // Room poll: ready flags, connected dots and humans count.
  useEffect(() => {
    if (fatal) return;
    let stop = false;
    const tick = async () => {
      try {
        const room = await getRoom(code);
        if (!stop) dispatch({ type: "players", players: room.players });
      } catch {
        // Transient; the next tick retries.
      }
    };
    const id = setInterval(tick, ROOM_POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [code, fatal]);

  const send: SendFn = (type, payload) => {
    const s = sockRef.current;
    if (!s) return Promise.reject(new Error("not connected"));
    return s.request(type, payload);
  };

  const onGuessSent = useCallback((text: string) => {
    pendingGuess.current = text;
  }, []);

  // Test hook: lets the E2E suite drop the socket to exercise reconnect.
  useEffect(() => {
    const w = window as Window & { __apDropSocket?: () => void };
    w.__apDropSocket = () => sockRef.current?.simulateDrop();
    return () => {
      delete w.__apDropSocket;
    };
  }, []);

  if (fatal) {
    return (
      <div className="join">
        <div className="join-card">
          <h1>Room {code}</h1>
          <p className="error" data-testid="fatal">
            {fatal}
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              clearSession(code);
              navigate("/");
            }}
          >
            Back to join
          </button>
        </div>
      </div>
    );
  }

  const phase = phaseOf(view);
  const drawer = view.snap?.round?.drawerAgentId;
  const note =
    phase === "choosing"
      ? `${playerName(view.snap, drawer)} is choosing a word`
      : phase === "drawing" && view.opLog.ops.length === 0
        ? `Waiting for ${playerName(view.snap, drawer)} to draw`
        : undefined;

  return (
    <div className="room" data-phase={phase}>
      <Header
        code={code}
        view={view}
        clock={clock}
        socket={socket.status}
        attempt={socket.attempt}
      />
      <div className="main">
        <div className="left">
          <div style={{ position: "relative", minHeight: 0, display: "grid" }}>
            <Canvas opLog={view.opLog} note={note} />
            {phase === "lobby" ? <Lobby view={view} send={send} /> : <Overlays view={view} />}
          </div>
          <Scoreboard view={view} />
        </div>
        <div className="right">
          <Feed view={view} />
          {isPairedHuman(view) ? (
            <HumanPanel view={view} send={send} onGuessSent={onGuessSent} />
          ) : null}
        </div>
      </div>
      {view.lastError && view.lastError.replyTo === undefined ? (
        <Toast
          key={view.lastError.at}
          text={view.lastError.message}
          onDone={() => dispatch({ type: "clear-error" })}
        />
      ) : null}
    </div>
  );
}

function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 4_000);
    return () => clearTimeout(id);
  }, [onDone]);
  return (
    <div className="toast" role="status">
      {text}
    </div>
  );
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return "Room not found. Check the code.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong";
}
