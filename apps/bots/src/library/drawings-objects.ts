/** Household objects, tools, clothes, instruments and appliances. */
import type { DrawOp } from "@pictionary/protocol";
import {
  BLUE,
  BROWN,
  FILL_BLUE,
  FILL_GREEN,
  FILL_GREY,
  FILL_INK,
  FILL_RED,
  FILL_YELLOW,
  GREEN,
  GREY,
  ORANGE,
  PI,
  PINK,
  RED,
  THICK,
  THIN,
  WHITE_HEX,
  YELLOW,
} from "./palette.js";
import { flame, sparkle } from "./parts.js";
import {
  arc,
  circle,
  cubicPoints,
  curve,
  dashed,
  dot,
  ellipse,
  line,
  mirrorX,
  ngon,
  path,
  polygon,
  rect,
  roundedRect,
  type Style,
  spokes,
  star,
  wave,
  zigzag,
} from "./shapes.js";

type Drawing = () => DrawOp[];

function ellipsePoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a0: number,
  a1: number,
  n = 24,
): [number, number][] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });
}

/** Figure-8 body shared by guitar and violin. */
function stringBody(cx: number, s: Style, waist = 1): DrawOp {
  return path(
    [
      ...ellipsePoints(cx, 690, 240, 190, -0.4, PI + 0.4, 28),
      ...ellipsePoints(cx, 450, 180 * waist, 150, PI - 0.3, PI * 2 + 0.3, 28),
    ],
    s,
  );
}

/** Lines clipped to an ellipse, both directions (racket strings). */
function ellipseGrid(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  step: number,
  s: Style,
): DrawOp[] {
  const out: DrawOp[] = [];
  for (let x = cx - rx + step; x < cx + rx; x += step) {
    const k = Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2));
    out.push(line(x, cy - ry * k, x, cy + ry * k, s));
  }
  for (let y = cy - ry + step; y < cy + ry; y += step) {
    const k = Math.sqrt(Math.max(0, 1 - ((y - cy) / ry) ** 2));
    out.push(line(cx - rx * k, y, cx + rx * k, y, s));
  }
  return out;
}

export const OBJECTS: Record<string, Drawing> = {
  shoe: () => [
    path(
      [
        [120, 720],
        [120, 520],
        [260, 500],
        [380, 400],
        [520, 390],
        ...cubicPoints([520, 390], [640, 400], [800, 520], [900, 600]),
        [900, 720],
        [120, 720],
      ],
      THICK,
    ),
    rect(120, 720, 780, 60, THICK),
    line(260, 500, 320, 700, THIN),
    line(380, 400, 440, 560),
    line(360, 450, 440, 420),
    line(390, 500, 470, 470),
    line(420, 550, 500, 520),
    arc(560, 560, 90, PI, PI * 2, THIN, 10),
    line(140, 760, 880, 760, THIN),
  ],

  spoon: () => [
    ellipse(500, 300, 140, 200, THICK),
    ellipse(500, 300, 90, 140, THIN),
    polygon(
      [
        [470, 495],
        [455, 900],
        [545, 900],
        [530, 495],
      ],
      THICK,
    ),
    arc(500, 900, 45, 0, PI, THICK, 8),
    arc(460, 260, 60, PI * 1.1, PI * 1.5, THIN, 8),
    line(500, 520, 500, 860, THIN),
  ],

  fork: () => [
    polygon(
      [
        [390, 380],
        [610, 380],
        [590, 520],
        [410, 520],
      ],
      THICK,
    ),
    line(400, 380, 400, 110, THICK),
    line(467, 380, 467, 100, THICK),
    line(533, 380, 533, 100, THICK),
    line(600, 380, 600, 110, THICK),
    polygon(
      [
        [465, 520],
        [455, 900],
        [545, 900],
        [535, 520],
      ],
      THICK,
    ),
    arc(500, 900, 45, 0, PI, THICK, 8),
  ],

  snow: () => [
    ...spokes(500, 500, 0, 330, 6, { ...THICK, ...BLUE }),
    ...Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * PI * 2;
      const bx = 500 + 220 * Math.cos(a);
      const by = 500 + 220 * Math.sin(a);
      return [
        line(bx, by, bx + 70 * Math.cos(a + 0.6), by + 70 * Math.sin(a + 0.6), BLUE),
        line(bx, by, bx + 70 * Math.cos(a - 0.6), by + 70 * Math.sin(a - 0.6), BLUE),
      ];
    }).flat(),
    ...Array.from({ length: 6 }, (_, i) => {
      const a = (i / 6) * PI * 2;
      const bx = 500 + 120 * Math.cos(a);
      const by = 500 + 120 * Math.sin(a);
      return [
        line(bx, by, bx + 50 * Math.cos(a + 0.7), by + 50 * Math.sin(a + 0.7), BLUE),
        line(bx, by, bx + 50 * Math.cos(a - 0.7), by + 50 * Math.sin(a - 0.7), BLUE),
      ];
    }).flat(),
    dot(120, 140, 8, "#2b6cb0"),
    dot(880, 200, 8, "#2b6cb0"),
    dot(860, 860, 8, "#2b6cb0"),
    dot(140, 820, 8, "#2b6cb0"),
  ],

  pen: () => [
    roundedRect(180, 440, 560, 120, 30, THICK),
    polygon(
      [
        [740, 450],
        [880, 500],
        [740, 550],
      ],
      THICK,
    ),
    dot(880, 500, 10),
    rect(180, 440, 70, 120, FILL_INK),
    line(270, 420, 450, 420, THICK),
    line(270, 420, 270, 460, THICK),
    line(300, 500, 700, 500, THIN),
  ],

  phone: () => [
    roundedRect(330, 110, 340, 780, 60, THICK),
    rect(360, 200, 280, 560, {}),
    circle(500, 830, 28),
    line(450, 155, 550, 155, THICK),
    dot(420, 155, 9),
    rect(400, 300, 200, 60, THIN),
    rect(400, 400, 200, 60, THIN),
    rect(400, 500, 200, 60, THIN),
  ],

  computer: () => [
    rect(240, 160, 520, 360, THICK),
    rect(270, 190, 460, 300),
    polygon(
      [
        [180, 540],
        [820, 540],
        [900, 640],
        [100, 640],
      ],
      THICK,
    ),
    line(240, 570, 760, 570, THIN),
    line(220, 600, 780, 600, THIN),
    rect(440, 600, 120, 30, THIN),
    dot(500, 500, 6),
  ],

  tv: () => [
    rect(150, 260, 700, 480, THICK),
    rect(190, 300, 620, 400),
    polygon(
      [
        [430, 740],
        [570, 740],
        [620, 830],
        [380, 830],
      ],
      THICK,
    ),
    line(500, 260, 380, 80, THICK),
    line(500, 260, 620, 80, THICK),
    dot(380, 80, 12),
    dot(620, 80, 12),
    line(320, 830, 680, 830, THICK),
    line(230, 340, 300, 340, { color: WHITE_HEX, width: 4 }),
  ],

  lamp: () => [
    polygon(
      [
        [300, 440],
        [700, 440],
        [620, 160],
        [380, 160],
      ],
      THICK,
    ),
    line(500, 440, 500, 840, THICK),
    ellipse(500, 860, 170, 40, THICK),
    arc(500, 440, 60, 0, PI, YELLOW, 10),
    line(300, 500, 230, 620, YELLOW),
    line(700, 500, 770, 620, YELLOW),
    line(500, 540, 500, 640, YELLOW),
    line(380, 540, 340, 640, YELLOW),
    line(620, 540, 660, 640, YELLOW),
  ],

  bell: () => [
    circle(500, 180, 30, { ...THICK, ...YELLOW }),
    path(
      [
        ...cubicPoints([500, 210], [330, 230], [320, 520], [300, 640]),
        [240, 700],
        [760, 700],
        ...cubicPoints([700, 640], [680, 520], [670, 230], [500, 210]),
      ],
      { ...THICK, ...YELLOW },
    ),
    line(240, 700, 760, 700, { ...THICK, ...YELLOW }),
    circle(500, 760, 45, FILL_INK),
    arc(430, 400, 100, PI * 1.1, PI * 1.5, THIN, 8),
    line(160, 300, 220, 360, YELLOW),
    line(840, 300, 780, 360, YELLOW),
  ],

  drum: () => [
    ellipse(500, 330, 300, 90, THICK),
    line(200, 330, 200, 700, THICK),
    line(800, 330, 800, 700, THICK),
    path(ellipsePoints(500, 700, 300, 90, 0, PI), THICK),
    zigzag(200, 360, 800, 360, 6, 300, RED),
    line(500, 120, 350, 300, THICK),
    line(500, 120, 650, 300, THICK),
    dot(500, 110, 18),
  ],

  guitar: () => [
    stringBody(500, { ...THICK, ...BROWN }),
    circle(500, 560, 70, BROWN),
    rect(470, 80, 60, 240, { ...THICK, ...BROWN }),
    rect(450, 20, 100, 70, BROWN),
    rect(430, 720, 140, 30, BROWN),
    line(480, 80, 480, 720, THIN),
    line(500, 80, 500, 720, THIN),
    line(520, 80, 520, 720, THIN),
    line(470, 150, 530, 150, THIN),
    line(470, 220, 530, 220, THIN),
  ],

  piano: () => [
    rect(100, 300, 800, 200, THICK),
    rect(100, 500, 800, 200, THICK),
    ...[200, 300, 400, 500, 600, 700, 800].map((x) => line(x, 500, x, 700)),
    ...[170, 270, 470, 570, 670].map((x) => rect(x, 500, 60, 110, FILL_INK)),
    rect(140, 340, 720, 120),
    line(150, 700, 150, 900, THICK),
    line(850, 700, 850, 900, THICK),
    rect(300, 760, 400, 30),
  ],

  gift: () => [
    rect(200, 470, 600, 400, THICK),
    rect(170, 360, 660, 110, THICK),
    rect(470, 360, 60, 510, FILL_RED),
    line(170, 415, 830, 415, { ...THICK, ...RED }),
    ellipse(410, 290, 80, 50, { ...THICK, ...RED }),
    ellipse(590, 290, 80, 50, { ...THICK, ...RED }),
    dot(500, 320, 20, "#c0392b"),
    line(500, 320, 430, 360, RED),
    line(500, 320, 570, 360, RED),
  ],

  ring: () => [
    circle(500, 610, 230, { width: 12, ...YELLOW }),
    circle(500, 610, 180, YELLOW),
    polygon(
      [
        [500, 230],
        [610, 330],
        [500, 420],
        [390, 330],
      ],
      { ...THICK, ...BLUE },
    ),
    line(390, 330, 610, 330, BLUE),
    line(440, 280, 560, 280, BLUE),
    line(440, 280, 500, 420, THIN),
    line(560, 280, 500, 420, THIN),
    ...sparkle(700, 200, 36),
  ],

  crown: () => [
    polygon(
      [
        [200, 780],
        [200, 380],
        [350, 560],
        [500, 280],
        [650, 560],
        [800, 380],
        [800, 780],
      ],
      { ...THICK, ...YELLOW },
    ),
    line(200, 700, 800, 700, YELLOW),
    dot(200, 380, 18, "#c0392b"),
    dot(500, 280, 18, "#c0392b"),
    dot(800, 380, 18, "#c0392b"),
    circle(350, 740, 20, RED),
    circle(500, 740, 20, RED),
    circle(650, 740, 20, RED),
  ],

  sock: () => [
    polygon(
      [
        [360, 120],
        [620, 120],
        [620, 560],
        [800, 680],
        [740, 840],
        [560, 800],
        [360, 660],
      ],
      THICK,
    ),
    rect(360, 120, 260, 90),
    line(400, 120, 400, 210, THIN),
    line(450, 120, 450, 210, THIN),
    line(500, 120, 500, 210, THIN),
    line(550, 120, 550, 210, THIN),
    line(360, 300, 620, 300, { ...THICK, ...RED }),
    line(360, 360, 620, 360, { ...THICK, ...RED }),
    arc(640, 760, 110, PI * 0.5, PI * 1.1, THIN, 8),
  ],

  glove: () => [
    roundedRect(320, 480, 360, 300, 60, { ...THICK, ...BLUE }),
    roundedRect(330, 220, 76, 300, 38, BLUE),
    roundedRect(416, 150, 76, 370, 38, BLUE),
    roundedRect(502, 170, 76, 350, 38, BLUE),
    roundedRect(588, 240, 76, 280, 38, BLUE),
    path(
      [
        [320, 600],
        [190, 480],
        [150, 520],
        [320, 740],
      ],
      BLUE,
    ),
    line(330, 520, 670, 520, { color: WHITE_HEX, width: 4 }),
    rect(320, 780, 360, 110, { ...THICK, ...BLUE }),
    ...[360, 420, 480, 540, 600, 640].map((x) => line(x, 790, x, 880, THIN)),
  ],

  scarf: () => [
    ellipse(500, 300, 190, 90, THICK),
    ellipse(500, 300, 110, 40),
    polygon(
      [
        [400, 380],
        [560, 390],
        [520, 860],
        [360, 840],
      ],
      THICK,
    ),
    polygon(
      [
        [540, 380],
        [660, 330],
        [820, 760],
        [700, 800],
      ],
      THICK,
    ),
    zigzag(360, 850, 520, 870, 5, 40, THIN),
    zigzag(700, 810, 820, 770, 4, 40, THIN),
    line(390, 500, 550, 510, { ...THICK, ...RED }),
    line(380, 620, 540, 630, { ...THICK, ...RED }),
    line(600, 480, 720, 440, { ...THICK, ...RED }),
    line(640, 600, 760, 560, { ...THICK, ...RED }),
  ],

  shirt: () => [
    polygon(
      [
        [300, 200],
        [420, 160],
        [500, 240],
        [580, 160],
        [700, 200],
        [860, 400],
        [740, 480],
        [700, 430],
        [700, 880],
        [300, 880],
        [300, 430],
        [260, 480],
        [140, 400],
      ],
      THICK,
    ),
    arc(500, 160, 90, 0.2, PI - 0.2, {}, 12),
    line(300, 430, 300, 480, THIN),
    line(700, 430, 700, 480, THIN),
    rect(560, 480, 100, 100, THIN),
    line(320, 840, 680, 840, THIN),
  ],

  pants: () => [
    polygon(
      [
        [300, 120],
        [700, 120],
        [730, 900],
        [560, 900],
        [500, 480],
        [440, 900],
        [270, 900],
      ],
      { ...THICK, ...BLUE },
    ),
    line(300, 190, 700, 190, BLUE),
    line(500, 190, 500, 480, THIN),
    arc(360, 190, 70, 0, PI * 0.6, THIN, 8),
    arc(640, 190, 70, PI * 0.4, PI, THIN, 8),
    line(290, 860, 445, 860, THIN),
    line(555, 860, 710, 860, THIN),
    rect(470, 110, 60, 30, BLUE),
  ],

  dress: () => [
    polygon(
      [
        [380, 180],
        [620, 180],
        [600, 440],
        [840, 900],
        [160, 900],
        [400, 440],
      ],
      { ...THICK, ...PINK },
    ),
    arc(500, 180, 100, 0.2, PI - 0.2, PINK, 12),
    line(380, 180, 350, 80, PINK),
    line(620, 180, 650, 80, PINK),
    line(400, 440, 600, 440, { ...THICK, ...PINK }),
    circle(500, 440, 22, PINK),
    line(460, 600, 420, 860, THIN),
    line(540, 600, 580, 860, THIN),
  ],

  watch: () => [
    rect(390, 100, 220, 220, THICK),
    rect(390, 680, 220, 220, THICK),
    ...[160, 220, 280].map((y) => line(400, y, 600, y, THIN)),
    ...[740, 800, 860].map((y) => line(400, y, 600, y, THIN)),
    circle(500, 500, 210, { width: 12 }),
    circle(500, 500, 170),
    rect(705, 470, 40, 60, THICK),
    line(500, 500, 500, 380, THICK),
    line(500, 500, 590, 540, THICK),
    dot(500, 500, 10),
    dot(500, 350, 7),
    dot(650, 500, 7),
    dot(500, 650, 7),
    dot(350, 500, 7),
  ],

  bag: () => [
    polygon(
      [
        [220, 430],
        [780, 430],
        [860, 880],
        [140, 880],
      ],
      { ...THICK, ...BROWN },
    ),
    arc(500, 430, 180, PI, PI * 2, { ...THICK, ...BROWN }, 20),
    line(220, 430, 780, 430, { ...THICK, ...BROWN }),
    rect(460, 430, 80, 60, BROWN),
    dot(500, 520, 14),
    ...dashed(200, 560, 800, 560, 8, THIN),
    line(240, 470, 240, 800, THIN),
  ],

  box: () => [
    rect(250, 400, 400, 400, { ...THICK, ...BROWN }),
    polygon(
      [
        [250, 400],
        [400, 250],
        [800, 250],
        [650, 400],
      ],
      { ...THICK, ...BROWN },
    ),
    polygon(
      [
        [650, 400],
        [800, 250],
        [800, 650],
        [650, 800],
      ],
      { ...THICK, ...BROWN },
    ),
    line(325, 325, 725, 325, BROWN),
    line(450, 400, 450, 800, THIN),
    line(725, 325, 725, 725, THIN),
  ],

  hammer: () => [
    rect(470, 380, 60, 520, { ...THICK, ...BROWN }),
    rect(280, 220, 440, 160, { ...THICK, ...GREY }),
    path(
      [
        [720, 220],
        [820, 160],
        [860, 240],
        [820, 380],
        [720, 380],
      ],
      { ...THICK, ...GREY },
    ),
    line(820, 240, 760, 300, GREY),
    line(300, 250, 500, 250, THIN),
    line(480, 420, 480, 860, THIN),
    line(520, 420, 520, 860, THIN),
  ],

  nail: () => [
    rect(100, 700, 800, 180, { ...THICK, ...BROWN }),
    line(140, 760, 860, 760, BROWN),
    line(140, 820, 860, 820, BROWN),
    rect(400, 120, 200, 44, FILL_GREY),
    polygon(
      [
        [470, 164],
        [530, 164],
        [520, 820],
        [500, 900],
        [480, 820],
      ],
      { ...THICK, ...GREY },
    ),
    line(500, 200, 500, 680, { ...THIN, ...GREY }),
  ],

  saw: () => [
    polygon(
      [
        [120, 420],
        [700, 420],
        [700, 560],
        [120, 560],
      ],
      { ...THICK, ...GREY },
    ),
    zigzag(120, 560, 700, 560, 18, 34, GREY),
    roundedRect(700, 380, 200, 260, 50, { ...THICK, ...BROWN }),
    roundedRect(740, 440, 110, 140, 40, BROWN),
    line(160, 480, 650, 480, THIN),
    dot(720, 410, 9),
    dot(720, 610, 9),
  ],

  leaf: () => [
    path(
      [
        ...cubicPoints([500, 120], [180, 300], [200, 720], [500, 880]),
        ...cubicPoints([500, 880], [800, 720], [820, 300], [500, 120]),
      ],
      { ...THICK, ...GREEN },
    ),
    line(500, 150, 500, 960, GREEN),
    line(500, 320, 350, 400, GREEN),
    line(500, 320, 650, 400, GREEN),
    line(500, 480, 320, 560, GREEN),
    line(500, 480, 680, 560, GREEN),
    line(500, 640, 360, 720, GREEN),
    line(500, 640, 640, 720, GREEN),
  ],

  grass: () => [
    line(60, 880, 940, 880, { ...THICK, ...GREEN }),
    ...[100, 200, 300, 400, 500, 600, 700, 800].map((x, i) =>
      curve([x, 880], [x + 40, 700], [x + 90, 520 + (i % 3) * 60], { ...THICK, ...GREEN }),
    ),
    ...[150, 350, 550, 750].map((x, i) =>
      curve([x, 880], [x - 30, 740], [x - 60, 620 + (i % 2) * 60], GREEN),
    ),
  ],

  fire: () => [
    ...flame(500, 860, 640, { ...THICK, ...ORANGE }, { ...THICK, ...YELLOW }),
    ...flame(300, 860, 320, ORANGE, YELLOW),
    ...flame(700, 860, 360, ORANGE, YELLOW),
    line(180, 920, 820, 820, { width: 12 }),
    line(180, 820, 820, 920, { width: 12 }),
    dot(220, 300, 9, "#e67e22"),
    dot(760, 260, 9, "#e67e22"),
    dot(460, 120, 9, "#e67e22"),
  ],

  water: () => [
    path(
      [
        ...cubicPoints([500, 120], [500, 300], [280, 420], [280, 580]),
        ...ellipsePoints(500, 580, 220, 220, PI, 0, 24),
        ...cubicPoints([720, 580], [720, 420], [500, 300], [500, 120]),
      ],
      { ...THICK, ...BLUE },
    ),
    arc(420, 600, 120, PI * 0.6, PI * 1.1, THIN, 8),
    wave(60, 940, 880, 4, 22, BLUE),
    wave(140, 860, 940, 3, 18, BLUE),
    dot(760, 300, 10, "#2b6cb0"),
    dot(820, 380, 7, "#2b6cb0"),
  ],

  rock: () => [
    polygon(
      [
        [150, 760],
        [220, 520],
        [360, 400],
        [560, 360],
        [760, 440],
        [860, 620],
        [830, 780],
        [200, 800],
      ],
      { ...THICK, ...GREY },
    ),
    line(360, 400, 420, 560, GREY),
    line(420, 560, 380, 700, GREY),
    line(560, 360, 640, 520, GREY),
    line(640, 520, 760, 560, GREY),
    line(100, 820, 900, 820),
  ],

  stone: () => [
    ellipse(500, 760, 300, 110, { ...THICK, ...GREY }),
    ellipse(500, 580, 230, 90, { ...THICK, ...GREY }),
    ellipse(510, 430, 160, 70, { ...THICK, ...GREY }),
    ellipse(500, 320, 90, 50, { ...THICK, ...GREY }),
    line(100, 880, 900, 880),
    arc(400, 760, 80, PI * 1.1, PI * 1.5, THIN, 8),
    arc(420, 580, 60, PI * 1.1, PI * 1.5, THIN, 8),
  ],

  telescope: () => [
    polygon(
      [
        [200, 700],
        [640, 260],
        [700, 320],
        [260, 760],
      ],
      THICK,
    ),
    polygon(
      [
        [640, 260],
        [760, 120],
        [860, 200],
        [700, 320],
      ],
      THICK,
    ),
    line(180, 740, 240, 790, THICK),
    line(450, 560, 360, 920, THICK),
    line(450, 560, 540, 920, THICK),
    line(450, 560, 450, 900, THICK),
    star(180, 180, 36, 14, 5, FILL_YELLOW),
    star(880, 480, 28, 11, 5, FILL_YELLOW),
    dot(300, 330, 7),
  ],

  microscope: () => [
    rect(250, 840, 500, 60, THICK),
    polygon(
      [
        [420, 250],
        [560, 180],
        [640, 360],
        [500, 430],
      ],
      THICK,
    ),
    rect(450, 100, 110, 100, THICK),
    curve([640, 360], [820, 500], [700, 840], { width: 12 }),
    rect(330, 560, 340, 30, THICK),
    line(500, 430, 530, 560),
    circle(770, 560, 40, THICK),
    circle(500, 500, 30),
    line(350, 590, 350, 840, THICK),
    line(650, 590, 650, 840, THICK),
    rect(380, 600, 240, 20, THIN),
    arc(500, 700, 40, PI * 1.2, PI * 1.8, THIN, 8),
  ],

  compass: () => [
    circle(500, 500, 320, { width: 12 }),
    circle(500, 500, 270),
    polygon(
      [
        [500, 250],
        [560, 500],
        [440, 500],
      ],
      FILL_RED,
    ),
    polygon(
      [
        [500, 750],
        [560, 500],
        [440, 500],
      ],
      THICK,
    ),
    dot(500, 500, 18),
    line(500, 230, 500, 190),
    line(500, 770, 500, 810),
    line(230, 500, 190, 500),
    line(770, 500, 810, 500),
    ...Array.from({ length: 4 }, (_, i) => {
      const a = PI / 4 + (i * PI) / 2;
      return line(
        500 + 255 * Math.cos(a),
        500 + 255 * Math.sin(a),
        500 + 290 * Math.cos(a),
        500 + 290 * Math.sin(a),
        THIN,
      );
    }),
  ],

  anchor: () => [
    circle(500, 160, 55, THICK),
    line(500, 215, 500, 820, { width: 12 }),
    line(320, 340, 680, 340, { width: 12 }),
    arc(500, 580, 270, 0.25, PI - 0.25, { width: 12 }, 24),
    polygon(
      [
        [240, 650],
        [180, 540],
        [300, 580],
      ],
      FILL_INK,
    ),
    polygon(
      [
        [760, 650],
        [820, 540],
        [700, 580],
      ],
      FILL_INK,
    ),
    polygon(
      [
        [460, 860],
        [540, 860],
        [500, 920],
      ],
      FILL_INK,
    ),
  ],

  magnet: () => [
    path(
      [
        [200, 720],
        [200, 440],
        ...ellipsePoints(500, 440, 300, 300, PI, PI * 2),
        [800, 720],
        [660, 720],
        [660, 440],
        ...ellipsePoints(500, 440, 160, 160, PI * 2, PI),
        [340, 720],
        [200, 720],
      ],
      { ...THICK, ...RED },
    ),
    rect(200, 620, 140, 100, FILL_GREY),
    rect(660, 620, 140, 100, FILL_GREY),
    arc(270, 800, 60, PI * 1.2, PI * 1.8, THIN, 8),
    arc(730, 800, 60, PI * 1.2, PI * 1.8, THIN, 8),
    arc(500, 820, 160, PI * 1.15, PI * 1.85, THIN, 12),
    arc(500, 880, 260, PI * 1.15, PI * 1.85, THIN, 12),
  ],

  trophy: () => [
    polygon(
      [
        [300, 200],
        [700, 200],
        [660, 520],
        [500, 600],
        [340, 520],
      ],
      { ...THICK, ...YELLOW },
    ),
    arc(290, 320, 110, PI * 0.5, PI * 1.5, { ...THICK, ...YELLOW }, 12),
    arc(710, 320, 110, PI * 1.5, PI * 2.5, { ...THICK, ...YELLOW }, 12),
    line(300, 200, 700, 200, { ...THICK, ...YELLOW }),
    rect(470, 600, 60, 120, { ...THICK, ...YELLOW }),
    rect(330, 720, 340, 60, { ...THICK, ...YELLOW }),
    rect(280, 780, 440, 70, { ...THICK, ...YELLOW }),
    star(500, 370, 80, 32, 5, FILL_INK),
  ],

  medal: () => [
    polygon(
      [
        [380, 80],
        [620, 80],
        [560, 500],
        [440, 500],
      ],
      { ...THICK, ...RED },
    ),
    line(440, 80, 480, 500, RED),
    line(560, 80, 520, 500, RED),
    circle(500, 650, 210, { width: 12, ...YELLOW }),
    circle(500, 650, 160, YELLOW),
    star(500, 650, 100, 40, 5, FILL_YELLOW),
  ],

  "treasure chest": () => [
    rect(200, 520, 600, 320, { ...THICK, ...BROWN }),
    path([[200, 520], [200, 440], ...ellipsePoints(500, 440, 300, 140, PI, PI * 2), [800, 520]], {
      ...THICK,
      ...BROWN,
    }),
    line(200, 520, 800, 520, { ...THICK, ...BROWN }),
    rect(460, 500, 80, 90, FILL_YELLOW),
    dot(500, 545, 12),
    line(320, 440, 320, 840, BROWN),
    line(680, 440, 680, 840, BROWN),
    circle(300, 420, 40, FILL_YELLOW),
    circle(400, 380, 40, FILL_YELLOW),
    circle(610, 390, 40, FILL_YELLOW),
    circle(700, 430, 40, FILL_YELLOW),
    ...sparkle(880, 300, 30),
  ],

  globe: () => [
    circle(500, 460, 300, { width: 8, ...BLUE }),
    ellipse(500, 460, 120, 300, BLUE),
    ellipse(500, 460, 220, 300, BLUE),
    line(200, 460, 800, 460, BLUE),
    line(240, 320, 760, 320, THIN),
    line(240, 600, 760, 600, THIN),
    arc(500, 460, 340, -0.35 * PI, 0.6 * PI, THICK, 24),
    line(500, 760, 500, 860, THICK),
    rect(370, 860, 260, 40, THICK),
    polygon(
      [
        [380, 380],
        [460, 340],
        [500, 420],
        [430, 480],
      ],
      FILL_GREEN,
    ),
  ],

  hourglass: () => [
    rect(300, 110, 400, 50, { ...THICK, ...BROWN }),
    rect(300, 840, 400, 50, { ...THICK, ...BROWN }),
    polygon(
      [
        [330, 160],
        [670, 160],
        [520, 500],
        [670, 840],
        [330, 840],
        [480, 500],
      ],
      THICK,
    ),
    polygon(
      [
        [400, 330],
        [600, 330],
        [520, 480],
        [480, 480],
      ],
      FILL_YELLOW,
    ),
    polygon(
      [
        [380, 820],
        [620, 820],
        [500, 700],
      ],
      FILL_YELLOW,
    ),
    ...dashed(500, 510, 500, 700, 4, YELLOW),
    line(300, 160, 300, 110, BROWN),
  ],

  calculator: () => [
    roundedRect(300, 100, 400, 800, 40, THICK),
    rect(340, 150, 320, 130),
    ...[0, 1, 2, 3].flatMap((r) =>
      [0, 1, 2, 3].map((c) => rect(345 + c * 82, 330 + r * 130, 62, 95, c === 3 ? FILL_INK : {})),
    ),
    line(620, 220, 620, 190, { color: WHITE_HEX, width: 2 }),
  ],

  toothbrush: () => [
    roundedRect(440, 90, 120, 240, 40, THICK),
    roundedRect(460, 330, 80, 590, 40, { ...THICK, ...BLUE }),
    ...[120, 160, 200, 240, 280].map((y) => line(440, y, 340, y, THICK)),
    line(460, 400, 540, 400, BLUE),
    line(460, 840, 540, 840, BLUE),
    ellipse(300, 110, 60, 30, FILL_BLUE),
  ],

  hairdryer: () => [
    roundedRect(150, 380, 520, 200, 70, THICK),
    polygon(
      [
        [670, 420],
        [830, 440],
        [830, 520],
        [670, 540],
      ],
      THICK,
    ),
    polygon(
      [
        [300, 580],
        [440, 580],
        [400, 900],
        [250, 900],
      ],
      THICK,
    ),
    circle(240, 480, 60),
    line(200, 480, 280, 480, THIN),
    line(240, 440, 240, 520, THIN),
    curve([320, 900], [200, 980], [120, 900], THIN),
    wave(860, 980, 450, 2, 12, BLUE),
    wave(860, 980, 480, 2, 12, BLUE),
    wave(860, 980, 510, 2, 12, BLUE),
    rect(330, 640, 50, 30, THIN),
  ],

  "vacuum cleaner": () => [
    roundedRect(380, 420, 240, 360, 60, THICK),
    polygon(
      [
        [200, 790],
        [800, 790],
        [760, 900],
        [240, 900],
      ],
      THICK,
    ),
    line(560, 420, 700, 110, { width: 12 }),
    rect(650, 60, 100, 50, THICK),
    curve([380, 500], [220, 420], [300, 790], THICK),
    circle(300, 900, 30, THICK),
    circle(700, 900, 30, THICK),
    rect(440, 500, 120, 200, THIN),
    curve([620, 600], [900, 700], [940, 950], THIN),
  ],

  toaster: () => [
    roundedRect(200, 400, 600, 400, 60, THICK),
    rect(290, 420, 170, 30, FILL_INK),
    rect(540, 420, 170, 30, FILL_INK),
    roundedRect(310, 230, 130, 200, 30, { ...THICK, ...BROWN }),
    roundedRect(560, 230, 130, 200, 30, { ...THICK, ...BROWN }),
    rect(810, 520, 40, 70, THICK),
    circle(740, 700, 28, THICK),
    line(260, 800, 260, 850, THICK),
    line(740, 800, 740, 850, THICK),
    arc(375, 260, 40, PI, PI * 2, BROWN, 8),
  ],

  blender: () => [
    rect(340, 70, 320, 50, THICK),
    polygon(
      [
        [330, 120],
        [670, 120],
        [620, 620],
        [380, 620],
      ],
      THICK,
    ),
    roundedRect(300, 620, 400, 240, 40, THICK),
    dot(400, 740, 16),
    dot(500, 740, 16),
    dot(600, 740, 16),
    line(410, 560, 590, 600, GREY),
    line(410, 600, 590, 560, GREY),
    wave(360, 640, 420, 3, 14, BLUE),
    arc(710, 350, 60, PI * 1.5, PI * 2.5, THICK, 10),
  ],

  "washing machine": () => [
    rect(200, 150, 600, 750, THICK),
    line(200, 290, 800, 290),
    circle(500, 590, 210, { width: 12 }),
    circle(500, 590, 150, BLUE),
    wave(380, 620, 620, 3, 14, BLUE),
    circle(300, 220, 32, THICK),
    dot(460, 220, 12),
    dot(540, 220, 12),
    dot(620, 220, 12),
    line(240, 900, 240, 940, THICK),
    line(760, 900, 760, 940, THICK),
  ],

  microwave: () => [
    rect(120, 300, 760, 400, THICK),
    rect(170, 350, 480, 300, THICK),
    rect(220, 400, 380, 200, THIN),
    rect(690, 350, 140, 300),
    dot(760, 420, 14),
    dot(760, 500, 14),
    dot(760, 580, 14),
    line(610, 380, 610, 620, THICK),
    ellipse(410, 580, 120, 24, THIN),
    line(160, 700, 160, 740, THICK),
    line(840, 700, 840, 740, THICK),
  ],

  refrigerator: () => [
    rect(300, 100, 400, 800, THICK),
    line(300, 400, 700, 400, THICK),
    line(350, 190, 350, 350, { width: 12 }),
    line(350, 460, 350, 720, { width: 12 }),
    line(320, 900, 320, 940, THICK),
    line(680, 900, 680, 940, THICK),
    rect(330, 130, 340, 240, THIN),
  ],

  kettle: () => [
    polygon(
      [
        [300, 420],
        [700, 420],
        [760, 800],
        [240, 800],
      ],
      THICK,
    ),
    ellipse(500, 420, 200, 45, THICK),
    circle(500, 370, 25),
    polygon(
      [
        [250, 520],
        [120, 380],
        [180, 350],
        [300, 480],
      ],
      THICK,
    ),
    arc(500, 400, 260, PI * 1.15, PI * 1.85, THICK, 16),
    line(240, 800, 760, 800, THICK),
    curve([140, 330], [100, 270], [150, 210], THIN),
    curve([200, 320], [160, 260], [210, 200], THIN),
  ],

  violin: () => [
    stringBody(500, { ...THICK, ...BROWN }, 0.85),
    rect(475, 60, 50, 260, { ...THICK, ...BROWN }),
    circle(500, 50, 30, BROWN),
    arc(420, 620, 50, PI * 0.5, PI * 1.5, {}, 10),
    arc(580, 620, 50, PI * 1.5, PI * 2.5, {}, 10),
    line(485, 80, 485, 760, THIN),
    line(500, 80, 500, 760, THIN),
    line(515, 80, 515, 760, THIN),
    rect(450, 740, 100, 20, BROWN),
    line(120, 900, 880, 180, THICK),
    line(140, 880, 870, 200, THIN),
  ],

  trumpet: () => [
    line(140, 500, 700, 500, { width: 12, ...YELLOW }),
    polygon(
      [
        [700, 440],
        [920, 320],
        [920, 680],
        [700, 560],
      ],
      { ...THICK, ...YELLOW },
    ),
    rect(100, 470, 50, 60, { ...THICK, ...YELLOW }),
    rect(380, 420, 36, 160, { ...THICK, ...YELLOW }),
    rect(450, 420, 36, 160, { ...THICK, ...YELLOW }),
    rect(520, 420, 36, 160, { ...THICK, ...YELLOW }),
    dot(398, 390, 14, "#e0a800"),
    dot(468, 390, 14, "#e0a800"),
    dot(538, 390, 14, "#e0a800"),
    arc(480, 600, 120, 0, PI, { ...THICK, ...YELLOW }, 16),
  ],

  harp: () => [
    path(
      [
        [220, 900],
        [220, 300],
        ...cubicPoints([220, 300], [240, 80], [560, 60], [740, 180]),
        [780, 900],
      ],
      { width: 12, ...YELLOW },
    ),
    rect(180, 880, 640, 50, { ...THICK, ...YELLOW }),
    ...[290, 350, 410, 470, 530, 590, 650, 710].map((x, i) =>
      line(x, 190 + i * 2 - (i < 4 ? 40 - i * 10 : 0), x, 880, THIN),
    ),
  ],

  xylophone: () => [
    line(140, 300, 860, 300, { ...THICK }),
    line(140, 700, 860, 700, { ...THICK }),
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      rect(
        170 + i * 85,
        500 - (280 - i * 25),
        60,
        2 * (280 - i * 25),
        i % 2 === 0 ? FILL_RED : FILL_BLUE,
      ),
    ),
    line(160, 800, 420, 880, THICK),
    dot(160, 800, 22),
    line(840, 800, 580, 880, THICK),
    dot(840, 800, 22),
  ],

  saxophone: () => [
    path(
      [
        [280, 150],
        [340, 170],
        [410, 240],
      ],
      { width: 12, ...YELLOW },
    ),
    line(410, 240, 500, 760, { width: 12, ...YELLOW }),
    arc(580, 760, 80, PI, 0, { width: 12, ...YELLOW }, 12),
    polygon(
      [
        [620, 760],
        [700, 760],
        [770, 530],
        [610, 560],
      ],
      { ...THICK, ...YELLOW },
    ),
    rect(250, 120, 60, 40, FILL_INK),
    dot(445, 400, 12),
    dot(458, 470, 12),
    dot(471, 540, 12),
    dot(484, 610, 12),
    line(400, 420, 480, 600, THIN),
  ],

  accordion: () => [
    rect(120, 250, 160, 500, THICK),
    rect(720, 250, 160, 500, THICK),
    ...[300, 360, 420, 480, 540, 600, 660].map((y) => line(150, y, 250, y, THIN)),
    ...[320, 400, 480, 560, 640].flatMap((y) => [dot(770, y, 10), dot(830, y, 10)]),
    zigzag(280, 250, 720, 250, 6, 40),
    zigzag(280, 750, 720, 750, 6, 40),
    ...[280, 353, 427, 500, 573, 647, 720].map((x, i) =>
      line(x, i % 2 === 0 ? 250 : 290, x, i % 2 === 0 ? 750 : 710, i % 2 === 0 ? THICK : THIN),
    ),
    line(120, 250, 100, 200, THICK),
    line(880, 250, 900, 200, THICK),
  ],

  "drum kit": () => [
    circle(500, 640, 220, THICK),
    circle(500, 640, 160),
    ellipse(240, 500, 110, 40, THICK),
    line(130, 500, 130, 600, THICK),
    line(350, 500, 350, 600, THICK),
    path(ellipsePoints(240, 600, 110, 40, 0, PI), THICK),
    ellipse(400, 330, 90, 35, THICK),
    ellipse(600, 330, 90, 35, THICK),
    line(310, 330, 310, 420),
    line(490, 330, 490, 420),
    line(510, 330, 510, 420),
    line(690, 330, 690, 420),
    ellipse(830, 280, 120, 22, THICK),
    line(830, 280, 830, 900),
    ellipse(150, 260, 100, 18, THICK),
    line(150, 260, 150, 900),
    line(240, 900, 760, 900, THICK),
  ],

  mailbox: () => [
    roundedRect(200, 420, 500, 280, 130, THICK),
    arc(330, 560, 130, PI * 0.5, PI * 1.5, {}, 16),
    line(330, 430, 330, 690, THIN),
    line(720, 440, 720, 280, THICK),
    rect(720, 280, 90, 60, FILL_RED),
    rect(420, 700, 60, 220, THICK),
    line(300, 920, 600, 920, THICK),
    dot(680, 560, 10),
  ],

  "traffic light": () => [
    roundedRect(380, 90, 240, 700, 60, THICK),
    circle(500, 230, 85, FILL_RED),
    circle(500, 440, 85, THICK),
    circle(500, 650, 85, FILL_GREEN),
    line(500, 790, 500, 950, { width: 12 }),
    line(400, 950, 600, 950, THICK),
    arc(500, 230, 100, PI * 1.1, PI * 1.9, THIN, 10),
  ],

  "stop sign": () => [
    ngon(500, 400, 310, 8, FILL_RED, PI / 8),
    ngon(500, 400, 270, 8, { color: WHITE_HEX, width: 4 }, PI / 8),
    line(330, 400, 670, 400, { color: WHITE_HEX, width: 12 }),
    rect(470, 700, 60, 240, THICK),
    line(380, 940, 620, 940, THICK),
    line(500, 740, 500, 900, { color: WHITE_HEX, width: 2 }),
  ],

  bench: () => [
    rect(150, 480, 700, 60, { ...THICK, ...BROWN }),
    rect(150, 330, 700, 50, { ...THICK, ...BROWN }),
    rect(150, 400, 700, 50, BROWN),
    line(200, 540, 200, 820, THICK),
    line(800, 540, 800, 820, THICK),
    line(200, 380, 200, 480, THICK),
    line(800, 380, 800, 480, THICK),
    line(170, 820, 230, 820, THICK),
    line(770, 820, 830, 820, THICK),
    line(200, 620, 800, 620),
  ],

  swing: () => [
    line(100, 120, 900, 120, { width: 12 }),
    line(140, 120, 60, 900, THICK),
    line(140, 120, 220, 900, THICK),
    line(860, 120, 780, 900, THICK),
    line(860, 120, 940, 900, THICK),
    line(420, 120, 400, 700),
    line(580, 120, 600, 700),
    rect(350, 700, 300, 40, THICK),
    line(60, 900, 940, 900, THIN),
  ],

  seesaw: () => [
    polygon(
      [
        [420, 900],
        [580, 900],
        [500, 600],
      ],
      THICK,
    ),
    line(120, 720, 880, 460, { width: 12, ...RED }),
    line(140, 700, 150, 640),
    line(860, 440, 850, 380),
    circle(230, 600, 50, THICK),
    line(230, 650, 230, 690, THICK),
    circle(770, 330, 50, THICK),
    line(770, 380, 770, 420, THICK),
    line(60, 900, 940, 900, THICK),
  ],

  slide: () => [
    line(200, 900, 200, 200, THICK),
    line(300, 900, 300, 200, THICK),
    ...[300, 420, 540, 660, 780].map((y) => line(200, y, 300, y)),
    curve([300, 200], [520, 220], [900, 880], { width: 12, ...YELLOW }),
    curve([300, 260], [520, 280], [860, 900], YELLOW),
    line(620, 520, 620, 900, THICK),
    line(60, 900, 940, 900, THICK),
    rect(200, 180, 100, 30, THICK),
  ],

  hammock: () => [
    line(120, 900, 120, 200, { width: 12, ...BROWN }),
    line(880, 900, 880, 200, { width: 12, ...BROWN }),
    curve([150, 330], [500, 800], [850, 330], THICK),
    curve([150, 330], [500, 620], [850, 330], THICK),
    line(120, 300, 150, 330, THICK),
    line(880, 300, 850, 330, THICK),
    ...[300, 400, 500, 600, 700].map((x) => {
      const t = (x - 150) / 700;
      const yTop = 330 * (1 - t) ** 2 + 2 * (1 - t) * t * 620 + t * t * 330;
      const yBot = 330 * (1 - t) ** 2 + 2 * (1 - t) * t * 800 + t * t * 330;
      return line(x, yTop, x, yBot, THIN);
    }),
    line(60, 900, 940, 900, THIN),
  ],

  fountain: () => [
    ellipse(500, 820, 420, 80, THICK),
    line(80, 820, 80, 740, THICK),
    line(920, 820, 920, 740, THICK),
    path(ellipsePoints(500, 740, 420, 80, PI, PI * 2), THICK),
    rect(470, 420, 60, 320, THICK),
    ellipse(500, 420, 200, 45, THICK),
    line(500, 400, 500, 200, { ...THICK, ...BLUE }),
    curve([500, 200], [380, 150], [320, 420], BLUE),
    curve([500, 200], [620, 150], [680, 420], BLUE),
    curve([300, 440], [220, 600], [200, 760], BLUE),
    curve([700, 440], [780, 600], [800, 760], BLUE),
    wave(140, 860, 780, 5, 10, BLUE),
  ],

  sandcastle: () => [
    rect(250, 520, 500, 360, { ...THICK, ...YELLOW }),
    rect(170, 400, 170, 480, { ...THICK, ...YELLOW }),
    rect(660, 400, 170, 480, { ...THICK, ...YELLOW }),
    ...[170, 230, 290].map((x) => rect(x, 360, 40, 40, YELLOW)),
    ...[660, 720, 780].map((x) => rect(x, 360, 40, 40, YELLOW)),
    ...[360, 440, 520, 600].map((x) => rect(x, 480, 40, 40, YELLOW)),
    line(500, 480, 500, 240, THICK),
    polygon(
      [
        [500, 240],
        [620, 290],
        [500, 340],
      ],
      FILL_INK,
    ),
    arc(500, 880, 110, PI, PI * 2, YELLOW, 12),
    wave(60, 940, 940, 6, 12, BLUE),
  ],

  chess: () => [
    rect(120, 540, 760, 360, THICK),
    ...[0, 1, 2, 3].flatMap((r) =>
      [0, 1, 2, 3, 4, 5, 6, 7]
        .filter((c) => (r + c) % 2 === 0)
        .map((c) => rect(120 + c * 95, 540 + r * 90, 95, 90, FILL_INK)),
    ),
    circle(320, 300, 55, THICK),
    polygon(
      [
        [290, 350],
        [350, 350],
        [400, 500],
        [240, 500],
      ],
      THICK,
    ),
    polygon(
      [
        [640, 180],
        [720, 180],
        [700, 230],
        [720, 350],
        [640, 350],
        [660, 230],
      ],
      THICK,
    ),
    line(680, 100, 680, 180, THICK),
    line(650, 130, 710, 130, THICK),
    polygon(
      [
        [620, 350],
        [740, 350],
        [780, 500],
        [580, 500],
      ],
      THICK,
    ),
  ],

  "hot air balloon": () => [
    path(
      [
        ...ellipsePoints(500, 360, 300, 300, PI * 0.9, PI * 2.1, 36),
        [600, 620],
        [540, 700],
        [460, 700],
        [400, 620],
      ],
      { ...THICK, ...RED },
    ),
    ellipse(500, 360, 150, 300, RED),
    ellipse(500, 360, 60, 300, RED),
    line(460, 700, 420, 860),
    line(540, 700, 580, 860),
    rect(400, 860, 200, 100, { ...THICK, ...BROWN }),
    line(400, 900, 600, 900, BROWN),
  ],

  soccer: () => [
    rect(100, 180, 800, 420, THICK),
    ...[260, 420, 580, 740].map((x) => line(x, 180, x, 600, THIN)),
    ...[280, 380, 480].map((y) => line(100, y, 900, y, THIN)),
    circle(500, 760, 170, THICK),
    polygon(
      [
        [500, 690],
        [560, 735],
        [540, 800],
        [460, 800],
        [440, 735],
      ],
      FILL_INK,
    ),
    line(500, 690, 500, 600, THIN),
    line(560, 735, 640, 700, THIN),
    line(540, 800, 580, 870, THIN),
    line(460, 800, 420, 870, THIN),
    line(440, 735, 360, 700, THIN),
  ],

  basketball: () => [
    rect(300, 60, 400, 180, THICK),
    ellipse(500, 250, 130, 30, { width: 12, ...ORANGE }),
    ...[400, 450, 500, 550, 600].map((x) => line(x, 270, x - (x - 500) * 0.4, 420, THIN)),
    circle(500, 680, 250, { width: 12, ...ORANGE }),
    line(500, 430, 500, 930, ORANGE),
    line(250, 680, 750, 680, ORANGE),
    arc(260, 680, 240, -PI / 2 + 0.6, PI / 2 - 0.6, ORANGE, 16),
    arc(740, 680, 240, PI / 2 + 0.6, (3 * PI) / 2 - 0.6, ORANGE, 16),
  ],

  tennis: () => [
    ellipse(400, 360, 220, 270, { width: 12 }),
    ...ellipseGrid(400, 360, 200, 250, 50, THIN),
    line(500, 600, 760, 920, { width: 12 }),
    line(540, 650, 700, 850, THIN),
    circle(760, 400, 75, { ...THICK, ...YELLOW }),
    arc(700, 400, 90, -0.6, 0.6, YELLOW, 10),
    arc(820, 400, 90, PI - 0.6, PI + 0.6, YELLOW, 10),
  ],

  golf: () => [
    arc(500, 1000, 600, PI * 1.2, PI * 1.8, { ...THICK, ...GREEN }, 24),
    line(600, 140, 600, 710, THICK),
    polygon(
      [
        [600, 150],
        [800, 220],
        [600, 300],
      ],
      FILL_RED,
    ),
    ellipse(600, 715, 90, 25, FILL_INK),
    circle(300, 660, 48, THICK),
    dot(285, 645, 5),
    dot(315, 650, 5),
    dot(300, 675, 5),
    line(140, 180, 240, 620, THICK),
    polygon(
      [
        [240, 620],
        [300, 700],
        [220, 710],
        [200, 650],
      ],
      THICK,
    ),
  ],

  baseball: () => [
    path(
      [
        [380, 820],
        [860, 300],
        [890, 230],
        [850, 200],
        [790, 260],
        [340, 790],
      ],
      { ...THICK, ...BROWN },
    ),
    circle(320, 860, 40, { ...THICK, ...BROWN }),
    circle(300, 560, 160, THICK),
    arc(220, 560, 170, -0.6, 0.6, RED, 12),
    arc(380, 560, 170, PI - 0.6, PI + 0.6, RED, 12),
    ...[-50, -20, 10, 40].map((d) =>
      line(370 + d * 0.3, 560 + d, 400 + d * 0.3, 565 + d, { ...THIN, ...RED }),
    ),
    ...[-50, -20, 10, 40].map((d) =>
      line(230 - d * 0.3, 560 + d, 200 - d * 0.3, 565 + d, { ...THIN, ...RED }),
    ),
  ],

  bowling: () => [
    circle(330, 620, 230, { width: 12 }),
    dot(290, 540, 22),
    dot(360, 520, 22),
    dot(330, 600, 22),
    polygon(
      [
        [680, 170],
        [760, 170],
        [775, 300],
        [740, 420],
        [800, 560],
        [810, 860],
        [630, 860],
        [640, 560],
        [700, 420],
        [665, 300],
      ],
      THICK,
    ),
    line(678, 330, 762, 330, { ...THICK, ...RED }),
    line(672, 370, 768, 370, { ...THICK, ...RED }),
    line(100, 900, 900, 900, THICK),
  ],

  boxing: () => [
    ...[0, 1].flatMap((side) => {
      const ops: DrawOp[] = [
        ellipse(290, 420, 190, 200, { ...THICK, ...RED }),
        ellipse(440, 520, 60, 90, { ...THICK, ...RED }),
        arc(290, 330, 120, PI * 1.1, PI * 1.9, RED, 12),
        rect(190, 610, 200, 180, { ...THICK, ...RED }),
        line(190, 670, 390, 670, RED),
        line(190, 730, 390, 730, RED),
        line(240, 620, 340, 780, THIN),
        line(340, 620, 240, 780, THIN),
      ];
      return side === 0 ? ops : mirrorX(ops);
    }),
    line(430, 180, 480, 120, THIN),
    line(570, 180, 520, 120, THIN),
  ],

  surfing: () => [
    arc(400, 620, 330, PI * 1.05, PI * 2.05, { width: 12, ...BLUE }, 32),
    arc(520, 560, 200, PI * 1.1, PI * 1.95, BLUE, 20),
    wave(60, 940, 900, 6, 16, BLUE),
    ellipse(620, 700, 230, 45, { ...THICK, ...YELLOW }),
    circle(620, 380, 50, THICK),
    line(620, 430, 600, 570, THICK),
    line(620, 460, 500, 420, THICK),
    line(620, 460, 740, 400, THICK),
    line(600, 570, 520, 680, THICK),
    line(600, 570, 700, 680, THICK),
  ],

  skiing: () => [
    circle(560, 180, 55, THICK),
    line(560, 235, 480, 500, THICK),
    line(480, 500, 400, 700, THICK),
    line(480, 500, 560, 700, THICK),
    line(530, 330, 330, 420, THICK),
    line(530, 330, 720, 400, THICK),
    line(330, 420, 280, 760, THIN),
    line(720, 400, 760, 760, THIN),
    line(100, 760, 700, 680, { width: 8 }),
    line(260, 790, 860, 710, { width: 8 }),
    arc(300, 940, 200, PI * 1.1, PI * 1.9, {}, 12),
    arc(700, 960, 220, PI * 1.1, PI * 1.9, {}, 12),
  ],

  fishing: () => [
    line(140, 860, 620, 180, { width: 8, ...BROWN }),
    circle(300, 660, 40, THICK),
    line(620, 180, 720, 660, THIN),
    arc(700, 680, 30, PI * 1.5, PI * 2.6, THICK, 10),
    wave(60, 940, 560, 6, 16, BLUE),
    ellipse(640, 800, 110, 60, THICK),
    polygon([
      [740, 800],
      [820, 740],
      [820, 860],
    ]),
    dot(580, 785, 8),
  ],

  camping: () => [
    polygon([
      [120, 820],
      [400, 360],
      [680, 820],
    ]),
    polygon([
      [400, 360],
      [330, 820],
      [470, 820],
    ]),
    ...flame(820, 820, 260, { ...THICK, ...ORANGE }, YELLOW),
    line(730, 850, 910, 790, THICK),
    line(730, 790, 910, 850, THICK),
    line(40, 860, 960, 860, THICK),
    arc(840, 200, 90, -PI / 2, PI / 2, THICK, 16),
    arc(800, 200, 100, PI / 2 - 0.3, -PI / 2 + 0.3, THICK, 16),
    star(640, 140, 24, 10, 5, FILL_YELLOW),
    star(180, 180, 24, 10, 5, FILL_YELLOW),
  ],
};
