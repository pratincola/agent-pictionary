import { useEffect, useRef } from "react";
import { CanvasPainter } from "../canvas/render.js";
import type { OpLogState } from "../state/opLog.js";

interface Props {
  opLog: OpLogState;
  /** Text shown under the drawing (e.g. "waiting for the drawer"). */
  note?: string | undefined;
}

/**
 * Square canvas that fills its container. Redraws are batched with
 * requestAnimationFrame: many `draw.op` messages in one frame cost one paint.
 */
export function Canvas({ opLog, note }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painterRef = useRef<CanvasPainter | null>(null);
  const latest = useRef(opLog);
  latest.current = opLog;
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const painter = new CanvasPainter(canvas);
    painterRef.current = painter;
    const fitCanvas = () => {
      const r = wrap.getBoundingClientRect();
      const size = Math.max(64, Math.floor(Math.min(r.width, r.height) - 24));
      painter.resize(size, window.devicePixelRatio || 1);
      painter.sync(latest.current);
    };
    fitCanvas();
    const ro = new ResizeObserver(fitCanvas);
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      painterRef.current = null;
    };
  }, []);

  useEffect(() => {
    latest.current = opLog;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      painterRef.current?.sync(latest.current);
    });
  }, [opLog]);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        data-testid="canvas"
        data-ops={opLog.ops.length}
        data-generation={opLog.generation}
        aria-label="drawing"
      />
      {note ? <div className="canvas-note">{note}</div> : null}
    </div>
  );
}
