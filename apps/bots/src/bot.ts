/**
 * Bot: one agent that plays every round of a match — drawing with its
 * drawer strategy when it is the drawer, guessing with its guesser strategy
 * otherwise. Event-driven on the SDK client; one AbortController per round.
 */
import { normalizeGuess } from "@pictionary/protocol";
import { AgentClient, type AgentClientOptions, type GuessResult } from "@pictionary/sdk";
import type { DrawerStrategy } from "./strategies/drawer.js";
import type { GuessContext, GuesserStrategy } from "./strategies/guesser.js";
import type { Logger } from "./util.js";

export interface BotOptions {
  baseUrl: string;
  apiKey: string;
  name: string;
  drawer: DrawerStrategy;
  guesser: GuesserStrategy;
  log?: Logger;
  client?: Partial<AgentClientOptions>;
}

export interface RoundSummary {
  roundIndex: number;
  word: string;
  reason: string;
  winnerAgentId?: string;
  winnerSeq?: number;
}

export class Bot {
  readonly client: AgentClient;
  readonly name: string;
  private round: AbortController | undefined;
  private readonly log: Logger;
  private readonly matchDone: Promise<void>;
  private resolveMatch!: () => void;
  readonly rounds: RoundSummary[] = [];

  constructor(private readonly opts: BotOptions) {
    this.name = opts.name;
    this.log = opts.log ?? (() => {});
    this.client = new AgentClient({ baseUrl: opts.baseUrl, apiKey: opts.apiKey, ...opts.client });
    this.matchDone = new Promise((r) => {
      this.resolveMatch = r;
    });
    this.wire();
  }

  get agentId(): string | undefined {
    return this.client.agentId;
  }

  async join(code: string): Promise<void> {
    await this.client.connect(code);
    this.log(`joined ${code} as ${this.client.agentId}`);
    // Resume mid-round if we (re)join a running room.
    const r = this.client.state?.round;
    if (r?.phase === "choosing" && this.client.isDrawer() && r.options) this.onChoosing();
    else if (r?.phase === "drawing") this.onStarted(r.wordPattern);
  }

  ready(): Promise<void> {
    return this.client.ready();
  }

  /** Resolves when the match ends (or the socket closes for good). */
  waitForMatchEnd(): Promise<void> {
    return this.matchDone;
  }

  async close(): Promise<void> {
    this.round?.abort();
    await this.client.close();
  }

  private wire(): void {
    const c = this.client;
    c.on("round.choosing", () => {
      this.abortRound();
      if (c.isDrawer()) this.onChoosing();
    });
    c.on("round.wordOptions", () => this.onChoosing());
    c.on("round.started", (m) => this.onStarted(m.payload.wordPattern));
    c.on("round.ended", (m) => {
      this.abortRound();
      const p = m.payload;
      const s: RoundSummary = { roundIndex: p.roundIndex, word: p.word, reason: p.reason };
      if (p.winner) {
        s.winnerAgentId = p.winner.agentId;
        s.winnerSeq = p.winner.seq;
      }
      this.rounds.push(s);
      const me = p.winner?.agentId === c.agentId ? " (me!)" : "";
      this.log(
        `round ${p.roundIndex} ended: "${p.word}" ${p.reason}${p.winner ? ` winner=${p.winner.agentId}${me} seq=${p.winner.seq}` : ""}`,
      );
    });
    c.on("match.ended", (m) => {
      this.abortRound();
      this.log(`match ended; winner=${m.payload.winnerAgentId ?? "nobody"}`);
      this.resolveMatch();
    });
    c.on("close", (e) => {
      if (!e.willReconnect) {
        this.abortRound();
        this.resolveMatch();
      }
    });
    c.on("error", (m) => this.log(`server error ${m.payload.code}: ${m.payload.message}`));
  }

  private abortRound(): void {
    this.round?.abort();
    this.round = undefined;
  }

  private chosenFor = -1;

  private onChoosing(): void {
    const c = this.client;
    const r = c.state?.round;
    if (r?.phase !== "choosing" || !c.isDrawer() || !r.options) return;
    if (this.chosenFor === r.roundIndex) return;
    this.chosenFor = r.roundIndex;
    const index = this.opts.drawer.choose(r.options);
    const word = r.options.find((o) => o.index === index)?.word;
    this.log(`drawing "${word}" (option ${index})`);
    c.chooseWord(index).catch((err: unknown) => this.log(`choose failed: ${String(err)}`));
  }

  private onStarted(pattern: string): void {
    this.abortRound();
    const ctrl = new AbortController();
    this.round = ctrl;
    const c = this.client;
    if (c.isDrawer()) {
      const word = c.word();
      if (!word) {
        this.log("drawer without a word (reconnected?)");
        return;
      }
      this.opts.drawer
        .draw(c, word, ctrl.signal)
        .then(() => this.log(`finished drawing "${word}"`))
        .catch((err: unknown) => this.log(`draw failed: ${String(err)}`));
      return;
    }
    const tried = new Set<string>();
    const ctx: GuessContext = {
      client: c,
      pattern,
      tried,
      log: this.log,
      guess: async (text: string): Promise<GuessResult | undefined> => {
        if (ctrl.signal.aborted || c.guessesRemaining() <= 0) return undefined;
        tried.add(normalizeGuess(text));
        try {
          const r = await c.guess(text);
          this.log(`guess "${text}" -> ${r.result} (${r.remaining} left)`);
          return r;
        } catch (err) {
          this.log(`guess "${text}" rejected: ${String(err)}`);
          return undefined;
        }
      },
    };
    this.opts.guesser
      .run(ctx, ctrl.signal)
      .catch((err: unknown) => this.log(`guesser failed: ${String(err)}`));
  }
}
