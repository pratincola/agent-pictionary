/**
 * Programmatic line drawings for common pool words. Each returns ops in
 * drawing order (outline first, details last) so a streamed drawing reads
 * well as it appears. Everything is built from circles, lines and polylines.
 */
import type { DrawOp } from "@pictionary/protocol";
import {
  arc,
  circle,
  ellipse,
  heart,
  line,
  path,
  polygon,
  rect,
  type Style,
  star,
  wave,
} from "./shapes.js";

const THICK: Style = { width: 8 };
const THIN: Style = { width: 2 };
const YELLOW: Style = { color: "#e0a800" };
const RED: Style = { color: "#c0392b" };
const BLUE: Style = { color: "#2b6cb0" };
const GREEN: Style = { color: "#2f855a" };
const BROWN: Style = { color: "#8b5a2b" };

type Drawing = () => DrawOp[];

const PI = Math.PI;

export const DRAWINGS: Record<string, Drawing> = {
  sun: () => [
    circle(500, 500, 160, { ...YELLOW, width: 8 }),
    ...Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * PI * 2;
      return line(
        500 + 210 * Math.cos(a),
        500 + 210 * Math.sin(a),
        500 + 300 * Math.cos(a),
        500 + 300 * Math.sin(a),
        YELLOW,
      );
    }),
  ],

  moon: () => [
    arc(500, 500, 280, -PI / 2, PI / 2, THICK),
    arc(400, 500, 300, PI / 2 - 0.42, -PI / 2 + 0.42, THICK, 32),
    circle(300, 250, 6, THIN),
    circle(250, 330, 5, THIN),
  ],

  star: () => [star(500, 520, 320, 130, 5, THICK)],

  heart: () => [heart(500, 480, 320, { ...RED, width: 8 })],

  cloud: () => [
    arc(380, 540, 120, PI * 0.6, PI * 1.55, THICK),
    arc(500, 460, 150, PI * 1.05, PI * 1.95, THICK),
    arc(650, 540, 120, PI * 1.45, PI * 2.4, THICK),
    line(300, 650, 720, 650, THICK),
  ],

  rain: () => [
    ...DRAWINGS.cloud!().map((op) => ({ ...op, color: "#1f2430" })),
    ...[350, 450, 550, 650].map((x) => line(x, 720, x - 30, 820, BLUE)),
    ...[400, 500, 600].map((x) => line(x, 850, x - 30, 950, BLUE)),
  ],

  tree: () => [
    rect(455, 620, 90, 280, BROWN),
    circle(500, 420, 200, GREEN),
    circle(360, 520, 120, GREEN),
    circle(640, 520, 120, GREEN),
    line(500, 620, 500, 480, BROWN),
    line(500, 560, 430, 500, BROWN),
    line(500, 540, 580, 470, BROWN),
  ],

  house: () => [
    rect(250, 500, 500, 350),
    polygon([
      [200, 500],
      [500, 230],
      [800, 500],
    ]),
    rect(440, 660, 120, 190),
    circle(530, 760, 8, THIN),
    rect(300, 560, 100, 90),
    rect(600, 560, 100, 90),
    line(350, 560, 350, 650, THIN),
    line(300, 605, 400, 605, THIN),
    line(650, 560, 650, 650, THIN),
    line(600, 605, 700, 605, THIN),
    rect(620, 290, 70, 130),
  ],

  cat: () => [
    circle(500, 400, 190),
    polygon([
      [360, 270],
      [330, 110],
      [460, 220],
    ]),
    polygon([
      [640, 270],
      [670, 110],
      [540, 220],
    ]),
    ellipse(430, 380, 28, 40),
    ellipse(570, 380, 28, 40),
    polygon([
      [470, 450],
      [530, 450],
      [500, 490],
    ]),
    arc(470, 510, 30, 0, PI, THIN),
    arc(530, 510, 30, 0, PI, THIN),
    line(380, 470, 230, 450, THIN),
    line(380, 495, 230, 510, THIN),
    line(620, 470, 770, 450, THIN),
    line(620, 495, 770, 510, THIN),
    ellipse(500, 740, 240, 150),
    line(400, 860, 400, 920, THICK),
    line(600, 860, 600, 920, THICK),
    path(
      [
        [740, 740],
        [860, 680],
        [880, 560],
      ],
      THICK,
    ),
  ],

  dog: () => [
    circle(500, 330, 170),
    ellipse(330, 380, 60, 130, { fill: "#1f2430" }),
    ellipse(670, 380, 60, 130, { fill: "#1f2430" }),
    circle(440, 300, 18, { fill: "#1f2430" }),
    circle(560, 300, 18, { fill: "#1f2430" }),
    ellipse(500, 390, 36, 24, { fill: "#1f2430" }),
    arc(460, 420, 40, 0, PI * 0.9, THIN, 10),
    arc(540, 420, 40, PI * 0.1, PI, THIN, 10),
    ellipse(500, 420, 25, 40, { ...RED, width: 2 }),
    ellipse(500, 720, 220, 140),
    line(380, 850, 380, 950, THICK),
    line(450, 850, 450, 950, THICK),
    line(550, 850, 550, 950, THICK),
    line(620, 850, 620, 950, THICK),
    path(
      [
        [720, 700],
        [820, 620],
        [860, 520],
      ],
      THICK,
    ),
  ],

  fish: () => [
    ellipse(480, 500, 260, 150),
    polygon([
      [720, 500],
      [880, 380],
      [880, 620],
    ]),
    circle(330, 470, 18, { fill: "#1f2430" }),
    arc(560, 500, 110, -PI / 2, PI / 2, THIN, 16),
    path(
      [
        [440, 350],
        [520, 280],
        [600, 360],
      ],
      THIN,
    ),
    path(
      [
        [240, 480],
        [260, 500],
        [240, 520],
      ],
      THIN,
    ),
    circle(300, 300, 12, THIN),
    circle(340, 240, 18, THIN),
  ],

  bird: () => [
    ellipse(520, 520, 200, 120),
    circle(300, 430, 80),
    polygon([
      [230, 430],
      [140, 450],
      [230, 470],
    ]),
    circle(280, 410, 10, { fill: "#1f2430" }),
    path([
      [450, 480],
      [560, 330],
      [700, 460],
    ]),
    polygon([
      [700, 500],
      [880, 420],
      [880, 560],
    ]),
    line(470, 640, 470, 740, THIN),
    line(560, 640, 560, 740, THIN),
    line(440, 740, 500, 740, THIN),
    line(530, 740, 590, 740, THIN),
  ],

  apple: () => [
    circle(500, 560, 260, { ...RED, width: 8 }),
    arc(500, 320, 60, PI * 0.9, PI * 1.6, { ...RED, width: 8 }, 12),
    line(500, 300, 520, 200, BROWN),
    ellipse(600, 240, 80, 35, GREEN),
  ],

  banana: () => [
    path(
      [
        ...Array.from({ length: 25 }, (_, i) => {
          const a = PI * 0.15 + (i / 24) * PI * 0.7;
          return [500 + 400 * Math.cos(a), 220 + 400 * Math.sin(a)] as [number, number];
        }),
        ...Array.from({ length: 25 }, (_, i) => {
          const a = PI * 0.85 - (i / 24) * PI * 0.7;
          return [500 + 290 * Math.cos(a), 220 + 290 * Math.sin(a)] as [number, number];
        }),
        [500 + 400 * Math.cos(PI * 0.15), 220 + 400 * Math.sin(PI * 0.15)],
      ],
      { ...YELLOW, width: 8 },
    ),
    arc(500, 220, 345, PI * 0.2, PI * 0.8, { ...YELLOW, width: 2 }, 24),
    line(860, 400, 900, 350, BROWN),
    line(140, 400, 100, 350, BROWN),
  ],

  ball: () => [
    circle(500, 500, 300, THICK),
    arc(500, 500, 300, PI * 1.25, PI * 1.75, {}, 16),
    arc(500, 820, 220, PI * 1.25, PI * 1.75, {}, 16),
    polygon([
      [500, 400],
      [580, 460],
      [550, 560],
      [450, 560],
      [420, 460],
    ]),
    line(500, 400, 500, 320, THIN),
    line(580, 460, 660, 420, THIN),
    line(550, 560, 600, 640, THIN),
    line(450, 560, 400, 640, THIN),
    line(420, 460, 340, 420, THIN),
  ],

  book: () => [
    polygon([
      [200, 300],
      [500, 360],
      [500, 760],
      [200, 700],
    ]),
    polygon([
      [800, 300],
      [500, 360],
      [500, 760],
      [800, 700],
    ]),
    line(260, 380, 450, 420, THIN),
    line(260, 460, 450, 500, THIN),
    line(260, 540, 450, 580, THIN),
    line(740, 380, 550, 420, THIN),
    line(740, 460, 550, 500, THIN),
    line(740, 540, 550, 580, THIN),
  ],

  chair: () => [
    rect(300, 200, 60, 500),
    rect(640, 200, 60, 500),
    rect(360, 220, 280, 60),
    rect(360, 340, 280, 60),
    rect(300, 520, 400, 60),
    line(330, 580, 330, 880, THICK),
    line(670, 580, 670, 880, THICK),
  ],

  table: () => [
    polygon([
      [150, 380],
      [850, 380],
      [850, 440],
      [150, 440],
    ]),
    line(190, 440, 190, 820, THICK),
    line(810, 440, 810, 820, THICK),
    line(310, 440, 310, 720, THICK),
    line(690, 440, 690, 720, THICK),
    line(190, 620, 310, 580, THIN),
    line(810, 620, 690, 580, THIN),
  ],

  door: () => [
    rect(300, 150, 400, 750, THICK),
    rect(340, 200, 320, 700),
    circle(620, 560, 18, { fill: "#1f2430" }),
    rect(380, 240, 240, 220, THIN),
    rect(380, 520, 240, 320, THIN),
  ],

  window: () => [
    rect(200, 200, 600, 600, THICK),
    line(500, 200, 500, 800),
    line(200, 500, 800, 500),
    rect(150, 800, 700, 40),
    path(
      [
        [250, 260],
        [250, 440],
        [430, 260],
      ],
      THIN,
    ),
  ],

  hat: () => [
    ellipse(500, 650, 380, 70, THICK),
    rect(320, 250, 360, 400),
    rect(320, 560, 360, 60, { fill: "#1f2430" }),
    arc(500, 250, 180, PI, PI * 2, {}, 16),
  ],

  cup: () => [
    rect(300, 300, 350, 400),
    ellipse(475, 300, 175, 40),
    arc(700, 500, 120, -PI / 2, PI / 2, THICK, 16),
    path(
      [
        [400, 240],
        [380, 160],
        [420, 90],
      ],
      THIN,
    ),
    path(
      [
        [550, 240],
        [530, 160],
        [570, 90],
      ],
      THIN,
    ),
  ],

  key: () => [
    circle(280, 420, 150, THICK),
    circle(280, 420, 60),
    line(430, 420, 850, 420, THICK),
    line(850, 420, 850, 540, THICK),
    line(760, 420, 760, 510, THICK),
    line(680, 420, 680, 490, THICK),
  ],

  bed: () => [
    rect(150, 500, 700, 200),
    rect(150, 300, 60, 400),
    rect(790, 480, 60, 220),
    rect(230, 420, 240, 80),
    line(180, 700, 180, 800, THICK),
    line(820, 700, 820, 800, THICK),
    arc(650, 500, 180, PI, PI * 2, THIN, 16),
  ],

  clock: () => [
    circle(500, 500, 330, THICK),
    circle(500, 500, 300, THIN),
    ...Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * PI * 2;
      const r1 = i % 3 === 0 ? 240 : 270;
      return line(
        500 + r1 * Math.cos(a),
        500 + r1 * Math.sin(a),
        500 + 295 * Math.cos(a),
        500 + 295 * Math.sin(a),
      );
    }),
    line(500, 500, 500, 300, THICK),
    line(500, 500, 650, 500, THICK),
    circle(500, 500, 12, { fill: "#1f2430" }),
  ],

  flower: () => [
    line(500, 560, 500, 920, GREEN),
    ellipse(430, 780, 80, 35, GREEN),
    ellipse(570, 840, 80, 35, GREEN),
    ...Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * PI * 2;
      return circle(500 + 110 * Math.cos(a), 420 + 110 * Math.sin(a), 70, RED);
    }),
    circle(500, 420, 60, { ...YELLOW, fill: "#e0a800" }),
  ],

  boat: () => [
    polygon([
      [150, 600],
      [850, 600],
      [740, 740],
      [260, 740],
    ]),
    line(500, 600, 500, 180, THICK),
    polygon([
      [520, 200],
      [820, 560],
      [520, 560],
    ]),
    polygon([
      [480, 260],
      [240, 560],
      [480, 560],
    ]),
    wave(100, 900, 800, 4, 20, BLUE),
  ],

  sailboat: () => DRAWINGS.boat!(),

  flag: () => [
    line(250, 120, 250, 900, THICK),
    polygon([
      [250, 140],
      [780, 240],
      [250, 440],
    ]),
    line(250, 220, 650, 290, THIN),
    line(250, 300, 650, 290, THIN),
    circle(250, 110, 20, { fill: "#1f2430" }),
    line(170, 900, 330, 900, THICK),
  ],

  egg: () => [
    path(
      [
        ...Array.from({ length: 61 }, (_, i) => {
          const t = (i / 60) * PI * 2;
          const y = Math.sin(t);
          const k = 1 + 0.25 * -Math.cos(t);
          return [500 + 210 * Math.sin(t) * k, 520 - 280 * Math.cos(t) + 0 * y] as [number, number];
        }),
      ],
      THICK,
    ),
    arc(420, 420, 60, PI * 0.9, PI * 1.4, THIN, 10),
  ],

  pizza: () => [
    polygon([
      [500, 900],
      [150, 250],
      [850, 250],
    ]),
    arc(500, 900, 760, -PI / 2 - 0.5, -PI / 2 + 0.5, THICK, 20),
    circle(500, 420, 40, RED),
    circle(380, 330, 40, RED),
    circle(620, 330, 40, RED),
    circle(450, 580, 40, RED),
    circle(560, 700, 30, RED),
  ],

  cake: () => [
    rect(220, 560, 560, 240),
    rect(300, 420, 400, 140),
    ellipse(500, 420, 200, 40),
    ellipse(500, 560, 280, 50),
    rect(488, 300, 24, 120),
    ellipse(500, 270, 14, 28, { ...YELLOW, fill: "#e0a800" }),
    wave(220, 780, 620, 5, 15, THIN),
    ...[300, 420, 540, 660].map((x) => circle(x, 720, 14, { ...RED, fill: "#c0392b" })),
  ],

  snake: () => [
    path(
      Array.from({ length: 41 }, (_, i) => {
        const t = i / 40;
        return [150 + 650 * t, 500 + Math.sin(t * PI * 3) * 180] as [number, number];
      }),
      { width: 12 },
    ),
    ellipse(840, 500, 60, 40, THICK),
    circle(860, 485, 8, { fill: "#1f2430" }),
    path(
      [
        [900, 500],
        [950, 500],
        [970, 480],
      ],
      { ...RED, width: 2 },
    ),
    path(
      [
        [950, 500],
        [970, 520],
      ],
      { ...RED, width: 2 },
    ),
  ],

  umbrella: () => [
    arc(500, 520, 380, PI, PI * 2, THICK, 32),
    line(120, 520, 880, 520),
    ...[-2, -1, 0, 1].map((i) => arc(500 + i * 190 + 95, 520, 95, 0, PI, {}, 12)),
    line(500, 140, 500, 520, THIN),
    line(500, 520, 500, 860, THICK),
    arc(460, 860, 40, 0, PI, THICK, 12),
  ],

  bicycle: () => [
    circle(280, 640, 170, THICK),
    circle(720, 640, 170, THICK),
    polygon([
      [280, 640],
      [450, 360],
      [600, 360],
      [720, 640],
    ]),
    line(450, 360, 530, 640),
    line(530, 640, 280, 640),
    line(600, 360, 540, 240),
    line(500, 240, 640, 240),
    line(450, 360, 410, 300),
    line(360, 300, 460, 300, THICK),
    circle(530, 640, 30),
  ],

  bike: () => DRAWINGS.bicycle!(),

  glasses: () => [
    circle(330, 500, 160, THICK),
    circle(670, 500, 160, THICK),
    arc(500, 480, 70, PI, PI * 2, {}, 10),
    line(170, 480, 70, 420, THICK),
    line(830, 480, 930, 420, THICK),
  ],

  ladder: () => [
    line(330, 100, 300, 900, THICK),
    line(670, 100, 700, 900, THICK),
    ...Array.from({ length: 7 }, (_, i) => {
      const y = 180 + i * 110;
      const spread = (y - 100) / 800;
      return line(330 - 30 * spread, y, 670 + 30 * spread, y);
    }),
  ],

  kite: () => [
    polygon([
      [500, 120],
      [740, 400],
      [500, 760],
      [260, 400],
    ]),
    line(500, 120, 500, 760, THIN),
    line(260, 400, 740, 400, THIN),
    path(
      [
        [500, 760],
        [470, 830],
        [520, 890],
        [480, 950],
      ],
      THIN,
    ),
    polygon([
      [470, 830],
      [430, 810],
      [440, 850],
    ]),
    polygon([
      [520, 890],
      [560, 870],
      [550, 910],
    ]),
  ],

  balloon: () => [
    ellipse(500, 380, 220, 270, { ...RED, width: 8 }),
    polygon(
      [
        [480, 650],
        [520, 650],
        [500, 680],
      ],
      RED,
    ),
    path(
      [
        [500, 680],
        [470, 760],
        [530, 840],
        [490, 930],
      ],
      THIN,
    ),
    arc(400, 300, 100, PI * 1.05, PI * 1.45, THIN, 8),
  ],

  rocket: () => [
    rect(400, 300, 200, 420),
    arc(500, 300, 100, PI, PI * 2, {}, 16),
    polygon([
      [400, 600],
      [300, 760],
      [400, 720],
    ]),
    polygon([
      [600, 600],
      [700, 760],
      [600, 720],
    ]),
    circle(500, 440, 50, BLUE),
    polygon(
      [
        [430, 720],
        [500, 900],
        [570, 720],
      ],
      RED,
    ),
    polygon(
      [
        [470, 720],
        [500, 820],
        [530, 720],
      ],
      YELLOW,
    ),
  ],

  mountain: () => [
    polygon([
      [80, 820],
      [380, 260],
      [600, 620],
      [720, 420],
      [940, 820],
    ]),
    path(
      [
        [330, 360],
        [360, 400],
        [390, 360],
        [420, 400],
        [440, 370],
      ],
      THIN,
    ),
    path(
      [
        [690, 480],
        [720, 510],
        [760, 490],
      ],
      THIN,
    ),
    line(50, 820, 950, 820, THICK),
    circle(820, 200, 60, YELLOW),
  ],

  train: () => [
    rect(100, 500, 300, 260),
    rect(400, 580, 450, 180),
    rect(140, 360, 180, 140),
    rect(170, 400, 120, 70, THIN),
    rect(230, 260, 80, 120),
    circle(220, 800, 50),
    circle(360, 800, 50),
    circle(560, 800, 50),
    circle(760, 800, 50),
    line(80, 850, 920, 850, THICK),
    ...[460, 580, 700].map((x) => rect(x, 620, 80, 70, THIN)),
    circle(260, 200, 30, THIN),
    circle(330, 150, 40, THIN),
  ],

  candle: () => [
    rect(420, 380, 160, 480),
    ellipse(500, 380, 80, 25),
    line(500, 380, 500, 300, THIN),
    ellipse(500, 240, 40, 70, { ...YELLOW, fill: "#e0a800" }),
    ellipse(500, 260, 15, 30, { ...RED, width: 2 }),
    wave(420, 580, 420, 2, 10, THIN),
    ellipse(500, 880, 220, 40),
  ],

  pencil: () => [
    polygon([
      [200, 300],
      [700, 300],
      [700, 460],
      [200, 460],
    ]),
    polygon([
      [700, 300],
      [880, 380],
      [700, 460],
    ]),
    polygon(
      [
        [820, 355],
        [880, 380],
        [820, 405],
      ],
      { fill: "#1f2430" },
    ),
    rect(140, 300, 60, 160, RED),
    line(200, 380, 700, 380, THIN),
  ],

  snowman: () => [
    circle(500, 760, 190),
    circle(500, 460, 140),
    circle(500, 240, 100),
    circle(465, 220, 10, { fill: "#1f2430" }),
    circle(535, 220, 10, { fill: "#1f2430" }),
    polygon(
      [
        [500, 250],
        [600, 265],
        [500, 275],
      ],
      { ...RED, color: "#e67e22" },
    ),
    arc(500, 270, 40, 0.3, PI - 0.3, THIN, 10),
    circle(500, 420, 10, { fill: "#1f2430" }),
    circle(500, 480, 10, { fill: "#1f2430" }),
    circle(500, 540, 10, { fill: "#1f2430" }),
    line(360, 440, 220, 360, BROWN),
    line(640, 440, 780, 360, BROWN),
    rect(430, 110, 140, 40),
    rect(460, 50, 80, 60),
  ],

  rainbow: () => [
    arc(500, 760, 420, PI, PI * 2, { color: "#c0392b", width: 12 }, 32),
    arc(500, 760, 380, PI, PI * 2, { color: "#e67e22", width: 12 }, 32),
    arc(500, 760, 340, PI, PI * 2, { color: "#e0a800", width: 12 }, 32),
    arc(500, 760, 300, PI, PI * 2, { color: "#2f855a", width: 12 }, 32),
    arc(500, 760, 260, PI, PI * 2, { color: "#2b6cb0", width: 12 }, 32),
    arc(500, 760, 220, PI, PI * 2, { color: "#6b46c1", width: 12 }, 32),
    arc(140, 760, 70, PI * 0.9, PI * 2.1, {}, 16),
    arc(860, 760, 70, PI * 0.9, PI * 2.1, {}, 16),
  ],

  "ice cream": () => [
    polygon([
      [340, 480],
      [660, 480],
      [500, 900],
    ]),
    line(380, 560, 600, 620, THIN),
    line(420, 660, 560, 700, THIN),
    line(400, 520, 620, 560, THIN),
    circle(500, 380, 170, { ...RED, width: 8 }),
    arc(500, 380, 170, PI * 0.2, PI * 0.8, {}, 12),
  ],

  lightning: () => [
    polygon(
      [
        [560, 100],
        [340, 520],
        [480, 520],
        [400, 900],
        [700, 420],
        [560, 420],
        [660, 100],
      ],
      { ...YELLOW, width: 8 },
    ),
  ],

  tent: () => [
    polygon([
      [120, 800],
      [500, 220],
      [880, 800],
    ]),
    polygon([
      [500, 220],
      [400, 800],
      [600, 800],
    ]),
    line(500, 220, 500, 120, THIN),
    line(120, 800, 60, 880, THIN),
    line(880, 800, 940, 880, THIN),
    line(40, 880, 960, 880, THICK),
  ],

  car: () => [
    polygon([
      [100, 620],
      [220, 460],
      [380, 440],
      [460, 330],
      [720, 330],
      [820, 450],
      [900, 480],
      [900, 620],
    ]),
    line(100, 620, 900, 620),
    circle(290, 640, 90, THICK),
    circle(730, 640, 90, THICK),
    circle(290, 640, 30),
    circle(730, 640, 30),
    polygon(
      [
        [470, 360],
        [580, 360],
        [580, 450],
        [410, 450],
      ],
      THIN,
    ),
    polygon(
      [
        [610, 360],
        [710, 360],
        [790, 450],
        [610, 450],
      ],
      THIN,
    ),
    line(590, 460, 590, 620, THIN),
    circle(880, 540, 20, YELLOW),
  ],

  owl: () => [
    ellipse(500, 540, 220, 300),
    circle(420, 420, 80),
    circle(580, 420, 80),
    circle(420, 420, 30, { fill: "#1f2430" }),
    circle(580, 420, 30, { fill: "#1f2430" }),
    polygon([
      [470, 500],
      [530, 500],
      [500, 560],
    ]),
    polygon([
      [320, 300],
      [280, 180],
      [400, 260],
    ]),
    polygon([
      [680, 300],
      [720, 180],
      [600, 260],
    ]),
    arc(400, 560, 60, PI * 0.8, PI * 1.8, THIN, 10),
    arc(600, 560, 60, PI * 1.2, PI * 2.2, THIN, 10),
    line(300, 840, 700, 840, BROWN),
    line(450, 840, 430, 900, THIN),
    line(550, 840, 570, 900, THIN),
  ],

  butterfly: () => [
    line(500, 250, 500, 800, THICK),
    ellipse(360, 420, 160, 180),
    ellipse(640, 420, 160, 180),
    ellipse(380, 650, 110, 130),
    ellipse(620, 650, 110, 130),
    path(
      [
        [500, 250],
        [440, 150],
      ],
      THIN,
    ),
    path(
      [
        [500, 250],
        [560, 150],
      ],
      THIN,
    ),
    circle(360, 420, 40, RED),
    circle(640, 420, 40, RED),
  ],

  spider: () => [
    circle(500, 520, 130),
    circle(500, 360, 60),
    ...[-1, 1].flatMap((s) =>
      [0, 1, 2, 3].map((i) =>
        path([
          [500 + s * 100, 440 + i * 50],
          [500 + s * 260, 340 + i * 90],
          [500 + s * 320, 440 + i * 110],
        ]),
      ),
    ),
    line(500, 50, 500, 300, THIN),
  ],

  robot: () => [
    rect(330, 120, 340, 260),
    rect(280, 400, 440, 360),
    rect(390, 190, 70, 70),
    rect(540, 190, 70, 70),
    rect(410, 300, 180, 30),
    line(500, 120, 500, 60, THIN),
    circle(500, 50, 15),
    rect(180, 420, 100, 260),
    rect(720, 420, 100, 260),
    rect(340, 760, 110, 150),
    rect(550, 760, 110, 150),
    circle(500, 530, 50, THIN),
    rect(400, 620, 200, 90, THIN),
  ],
};

export const LIBRARY_WORDS: readonly string[] = Object.keys(DRAWINGS);
