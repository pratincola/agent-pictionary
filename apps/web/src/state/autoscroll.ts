/**
 * Feed autoscroll policy: follow the newest item while the user is at (or
 * near) the bottom; stop following when they scroll up to read; resume when
 * they scroll back down.
 */
export interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** Slack in px so sub-pixel rounding and the last item's margin still count as "at bottom". */
export const BOTTOM_SLACK_PX = 24;

export function isNearBottom(m: ScrollMetrics, slack = BOTTOM_SLACK_PX): boolean {
  return m.scrollHeight - (m.scrollTop + m.clientHeight) <= slack;
}

export interface AutoscrollState {
  /** True while the view should stick to the newest item. */
  readonly following: boolean;
}

export type AutoscrollEvent =
  | { type: "scroll"; metrics: ScrollMetrics }
  | { type: "append" }
  | { type: "reset" };

export const initialAutoscroll: AutoscrollState = { following: true };

export function autoscrollReducer(state: AutoscrollState, ev: AutoscrollEvent): AutoscrollState {
  switch (ev.type) {
    case "scroll": {
      const following = isNearBottom(ev.metrics);
      return following === state.following ? state : { following };
    }
    case "append":
      return state;
    case "reset":
      return state.following ? state : { following: true };
  }
}

/** Decide whether an append should scroll the container to the bottom. */
export function shouldScrollOnAppend(state: AutoscrollState): boolean {
  return state.following;
}
