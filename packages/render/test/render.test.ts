import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { OpLogEntry } from "@pictionary/protocol";
import { describe, expect, it } from "vitest";
import { renderDataUrl, renderPng, visibleOps } from "../src/index.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function pixelAt(png: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const img = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0] as number, d[1] as number, d[2] as number];
}

describe("renderPng", () => {
  it("produces a square PNG of the requested size", async () => {
    const png = renderPng([], { size: 64 });
    expect(png.subarray(0, 4).equals(PNG_MAGIC)).toBe(true);
    const img = await loadImage(png);
    expect(img.width).toBe(64);
    expect(img.height).toBe(64);
    expect(await pixelAt(png, 10, 10)).toEqual([255, 255, 255]);
  });

  it("paints every op kind in logical 1000x1000 coordinates", async () => {
    const png = renderPng(
      [
        { kind: "rect", x: 0, y: 0, w: 500, h: 500, width: 1, color: "#000000", fill: "#ff0000" },
        {
          kind: "ellipse",
          cx: 750,
          cy: 750,
          rx: 200,
          ry: 200,
          width: 1,
          color: "#000000",
          fill: "#0000ff",
        },
        { kind: "line", from: [0, 1000], to: [1000, 0], width: 12, color: "#00ff00" },
        {
          kind: "path",
          points: [
            [500, 100],
            [900, 100],
          ],
          width: 12,
          color: "#000000",
        },
      ],
      { size: 1000 },
    );
    expect(await pixelAt(png, 250, 250)).toEqual([255, 0, 0]); // rect fill
    expect(await pixelAt(png, 750, 750)).toEqual([0, 0, 255]); // ellipse fill
    expect(await pixelAt(png, 500, 500)).toEqual([0, 255, 0]); // diagonal line center
    expect(await pixelAt(png, 700, 100)).toEqual([0, 0, 0]); // path
    expect(await pixelAt(png, 600, 300)).toEqual([255, 255, 255]); // untouched
  });

  it("skips erased log entries", async () => {
    const log: OpLogEntry[] = [
      {
        opSeq: 1,
        op: {
          kind: "rect",
          x: 0,
          y: 0,
          w: 1000,
          h: 1000,
          width: 1,
          color: "#000000",
          fill: "#000000",
        },
        erased: true,
      },
      {
        opSeq: 2,
        op: { kind: "line", from: [0, 500], to: [1000, 500], width: 8, color: "#123456" },
      },
    ];
    expect(visibleOps(log)).toHaveLength(1);
    const png = renderPng(log, { size: 1000 });
    expect(await pixelAt(png, 500, 500)).toEqual([0x12, 0x34, 0x56]);
    expect(await pixelAt(png, 500, 100)).toEqual([255, 255, 255]);
  });

  it("renders a data URL", () => {
    expect(renderDataUrl([], { size: 16 }).startsWith("data:image/png;base64,iVBOR")).toBe(true);
  });
});
