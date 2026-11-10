/**
 * Compact text views for an LLM player. Nothing here ever includes another
 * agent's guess text: agents never receive `guess.feed` (server redaction),
 * and the state summary only reports counts and scores.
 */
import type { ScoreTable } from "@pictionary/protocol";
import type { AgentState } from "@pictionary/sdk";
import { secondsLeft, visibleOpLog } from "@pictionary/sdk";
import type { BufferedEvent } from "./session.js";

export function playerName(state: AgentState | undefined, agentId: string): string {
  const p = state?.players.find((x) => x.agentId === agentId);
  const name = p?.name ?? agentId.slice(0, 8);
  return state?.you.agentId === agentId ? `${name} (you)` : name;
}

export function formatScores(state: AgentState | undefined, scores: ScoreTable): string {
  const entries = Object.entries(scores).sort((a, b) => b[1].points - a[1].points);
  if (entries.length === 0) return "none yet";
  return entries
    .map(
      ([id, s]) =>
        `${playerName(state, id)} ${s.points}${s.humanPoints ? ` (human ${s.humanPoints})` : ""}`,
    )
    .join(", ");
}

export function roleOf(state: AgentState): "drawer" | "guesser" | "none" {
  if (!state.round) return "none";
  return state.round.drawerAgentId === state.you.agentId ? "drawer" : "guesser";
}

export function formatState(state: AgentState | undefined, pending: string[] = []): string {
  if (!state) return "Not in a room. Call join_room (or create_room then join_room).";
  const lines: string[] = [];
  const me = state.you.agentId ? playerName(state, state.you.agentId).replace(" (you)", "") : "?";
  lines.push(`room ${state.code} · status ${state.status} · you: ${me}`);

  if (state.match) {
    const m = state.match;
    const order = m.order.map((id) => playerName(state, id)).join(" > ");
    lines.push(`match: round ${m.roundIndex + 1}/${m.roundsTotal} · drawer order: ${order}`);
    lines.push(`scores: ${formatScores(state, m.scores)}`);
  }

  const r = state.round;
  if (r) {
    const role = roleOf(state);
    const left = secondsLeft(state);
    const drawer = playerName(state, r.drawerAgentId);
    lines.push(`round ${r.roundIndex + 1}: phase ${r.phase} · ${left}s left · drawer ${drawer}`);
    lines.push(`your role: ${role}`);
    if (r.phase === "choosing") {
      if (role === "drawer") {
        if (r.word) lines.push(`word chosen: "${r.word}" · waiting for the round to start`);
        else if (r.options)
          lines.push(
            `word options: ${r.options.map((o) => `${o.index}="${o.word}" (${o.difficulty})`).join(", ")} · call choose_word {index}`,
          );
        else lines.push("waiting for word options (wait_for_event round.wordOptions)");
      } else lines.push("drawer is choosing a word; wait_for_event round.started");
    } else if (r.phase === "drawing") {
      if (role === "drawer") {
        lines.push(`word: "${r.word ?? "?"}" (draw it; never write letters)`);
        lines.push(`wrong guesses by others so far: ${r.wrongGuesses ?? 0}`);
      } else {
        const letters = r.wordPattern.replace(/\s/g, "").length;
        lines.push(`word pattern: "${r.wordPattern}" (${letters} letters)`);
        lines.push(
          `your guesses remaining: ${r.myGuessesRemaining ?? state.config.guessesPerAgent}`,
        );
      }
    } else if (r.phase === "reveal") {
      lines.push(`the word was "${r.word ?? "?"}"`);
    }
    const visible = visibleOpLog(state).length;
    lines.push(`canvas ops: ${r.ops.length} total, ${visible} visible`);
  } else if (state.status === "lobby") {
    lines.push("lobby: call ready when you are ready; the match starts when everyone is ready");
  } else if (state.status === "finished") {
    lines.push("match finished; leave_room or join another room");
  }

  const last = state.lastRoundEnded;
  if (last && r?.phase !== "drawing") {
    const w = last.winner ? `winner ${playerName(state, last.winner.agentId)}` : "no winner";
    lines.push(`last round: "${last.word}" ended by ${last.reason} · ${w}`);
  }

  if (state.notes.length) lines.push(`notes from your human: ${state.notes.join(" | ")}`);

  const players = state.players
    .map(
      (p) =>
        `${playerName(state, p.agentId)}[${p.connected ? "connected" : "offline"}${p.ready ? ", ready" : ""}${p.humans ? `, ${p.humans} human` : ""}]`,
    )
    .join(" ");
  lines.push(`players: ${players}`);
  if (pending.length) lines.push(`unread events: ${pending.join(", ")}`);
  return lines.join("\n");
}

export function formatEvent(e: BufferedEvent, state: AgentState | undefined): string {
  const ago = Math.max(0, Math.round((Date.now() - e.at) / 1000));
  const head = `[${e.type}]${ago > 1 ? ` (${ago}s ago)` : ""}`;
  const m = e.message;
  switch (m.type) {
    case "connection.closed":
      return `${head} connection closed (${m.code}${m.reason ? ` ${m.reason}` : ""}); join_room again`;
    case "room.playerJoined":
      return `${head} ${m.payload.name} joined`;
    case "room.playerLeft":
      return `${head} ${m.payload.name} left`;
    case "match.started":
      return `${head} match ${m.payload.matchId}: ${m.payload.roundsTotal} rounds; drawer order ${m.payload.order.map((id) => playerName(state, id)).join(" > ")}`;
    case "round.choosing": {
      const you = m.payload.drawerAgentId === state?.you.agentId;
      const opts = state?.round?.options;
      const tail = you
        ? opts
          ? ` — your options: ${opts.map((o) => `${o.index}="${o.word}" (${o.difficulty})`).join(", ")} — call choose_word {index}`
          : " — wait_for_event round.wordOptions, then choose_word"
        : " — wait_for_event round.started";
      return `${head} round ${m.payload.roundIndex + 1}: ${playerName(state, m.payload.drawerAgentId)} is choosing a word${tail}`;
    }
    case "round.wordOptions":
      return `${head} your word options: ${m.payload.options.map((o) => `${o.index}="${o.word}" (${o.difficulty})`).join(", ")} — call choose_word {index}`;
    case "human.note":
      return `${head} note from your human: ${m.payload.text}`;
    case "round.started": {
      const you = m.payload.drawerAgentId === state?.you.agentId;
      const secs = state ? secondsLeft(state) : 0;
      const letters = m.payload.wordPattern.replace(/\s/g, "").length;
      return you
        ? `${head} round ${m.payload.roundIndex + 1} started; you draw "${state?.round?.word ?? "?"}" (${secs}s). Call draw now.`
        : `${head} round ${m.payload.roundIndex + 1} started; ${playerName(state, m.payload.drawerAgentId)} draws; pattern "${m.payload.wordPattern}" (${letters} letters, ${secs}s). Use get_canvas_png then guess.`;
    }
    case "round.ended": {
      const p = m.payload;
      const w = p.winner
        ? `winner ${playerName(state, p.winner.agentId)} (${p.winner.source})`
        : "no winner";
      return `${head} round ${p.roundIndex + 1} ended (${p.reason}): the word was "${p.word}"; ${w}; round points: ${formatScores(state, p.roundScores)}; totals: ${formatScores(state, p.scores)}`;
    }
    case "match.ended":
      return `${head} match over; winner ${m.payload.winnerAgentId ? playerName(state, m.payload.winnerAgentId) : "nobody"}; final: ${formatScores(state, m.payload.scores)}`;
    case "guess.count":
      return `${head} wrong guesses by others so far: ${m.payload.wrongGuesses}`;
    case "draw.erased":
      return `${head} op ${m.payload.opSeq} erased`;
    case "draw.cleared":
      return `${head} canvas cleared`;
    case "error":
      return `${head} server error ${m.payload.code}: ${m.payload.message}`;
    default:
      return `${head}`;
  }
}
