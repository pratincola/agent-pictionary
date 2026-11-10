/** Food and drink (easy and medium tiers). */
import type { DrawOp } from "@pictionary/protocol";
import {
  BROWN,
  BROWN_HEX,
  FILL_BROWN,
  FILL_GREEN,
  FILL_INK,
  FILL_PINK,
  FILL_YELLOW,
  GREEN,
  ORANGE,
  PI,
  PINK,
  PURPLE,
  RED,
  THICK,
  THIN,
  YELLOW,
} from "./palette.js";
import { sparkle } from "./parts.js";
import {
  arc,
  circle,
  cubicPoints,
  curve,
  dot,
  ellipse,
  line,
  path,
  polygon,
  rect,
  roundedRect,
  type Style,
  star,
  wave,
  zigzag,
} from "./shapes.js";

type Drawing = () => DrawOp[];

/** Half ellipse (top half when a0=PI..2PI) as path points. */
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

function spiral(cx: number, cy: number, r0: number, turns: number, s: Style): DrawOp {
  const n = Math.round(turns * 24);
  return path(
    Array.from({ length: n + 1 }, (_, i) => {
      const t = i / n;
      const a = t * turns * PI * 2;
      const r = r0 * (1 - t);
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }),
    s,
  );
}

export const FOOD: Record<string, Drawing> = {
  bread: () => [
    path(
      [
        [200, 800],
        [200, 520],
        ...ellipsePoints(500, 520, 300, 220, PI, PI * 2),
        [800, 520],
        [800, 800],
        [200, 800],
      ],
      { ...THICK, ...BROWN },
    ),
    line(220, 760, 780, 760, THIN),
    line(380, 400, 440, 340, BROWN),
    line(480, 370, 540, 310, BROWN),
    line(580, 370, 640, 310, BROWN),
    line(680, 400, 740, 340, BROWN),
    line(120, 860, 880, 860, THICK),
  ],

  cheese: () => [
    polygon(
      [
        [100, 720],
        [900, 720],
        [900, 400],
        [100, 580],
      ],
      { ...THICK, ...YELLOW },
    ),
    polygon(
      [
        [100, 580],
        [900, 400],
        [760, 320],
        [100, 500],
      ],
      YELLOW,
    ),
    circle(300, 650, 40, YELLOW),
    circle(520, 600, 55, YELLOW),
    circle(760, 560, 35, YELLOW),
    circle(420, 560, 22, YELLOW),
    circle(680, 660, 24, YELLOW),
  ],

  carrot: () => [
    polygon(
      [
        [320, 320],
        [480, 320],
        [410, 920],
      ],
      { ...THICK, ...ORANGE },
    ),
    line(340, 450, 460, 450, ORANGE),
    line(355, 560, 445, 560, ORANGE),
    line(370, 680, 430, 680, ORANGE),
    line(400, 310, 320, 120, { ...THICK, ...GREEN }),
    line(400, 310, 410, 90, { ...THICK, ...GREEN }),
    line(400, 310, 500, 140, { ...THICK, ...GREEN }),
    line(400, 310, 560, 230, { ...THICK, ...GREEN }),
  ],

  corn: () => [
    ellipse(500, 500, 115, 340, YELLOW),
    line(440, 220, 440, 780, { ...THIN, ...YELLOW }),
    line(500, 165, 500, 835, { ...THIN, ...YELLOW }),
    line(560, 220, 560, 780, { ...THIN, ...YELLOW }),
    ...[280, 360, 440, 520, 600, 680].map((y) => {
      const k = Math.sqrt(Math.max(0, 1 - ((y - 500) / 340) ** 2)) * 115;
      return line(500 - k, y, 500 + k, y, { ...THIN, ...YELLOW });
    }),
    path(
      [
        [440, 540],
        ...cubicPoints([440, 540], [330, 700], [230, 820], [250, 950]),
        ...cubicPoints([250, 950], [380, 900], [470, 860], [480, 790]),
      ],
      { ...THICK, ...GREEN },
    ),
    path(
      [
        [560, 540],
        ...cubicPoints([560, 540], [670, 700], [770, 820], [750, 950]),
        ...cubicPoints([750, 950], [620, 900], [530, 860], [520, 790]),
      ],
      { ...THICK, ...GREEN },
    ),
    line(500, 840, 500, 980, { ...THICK, ...GREEN }),
  ],

  grape: () => [
    line(500, 360, 530, 180, THICK),
    ellipse(620, 260, 80, 40, GREEN),
    ...[350, 450, 550, 650].map((x) => circle(x, 420, 52, PURPLE)),
    ...[400, 500, 600].map((x) => circle(x, 510, 52, PURPLE)),
    ...[450, 550].map((x) => circle(x, 600, 52, PURPLE)),
    circle(500, 690, 52, PURPLE),
  ],

  lemon: () => [
    ellipse(500, 540, 300, 190, { ...THICK, ...YELLOW }),
    polygon(
      [
        [190, 520],
        [120, 540],
        [190, 560],
      ],
      { ...THICK, ...YELLOW },
    ),
    polygon(
      [
        [810, 520],
        [880, 540],
        [810, 560],
      ],
      { ...THICK, ...YELLOW },
    ),
    arc(520, 560, 220, PI * 1.1, PI * 1.45, THIN, 10),
    line(560, 350, 600, 260, GREEN),
    ellipse(680, 240, 90, 38, GREEN),
  ],

  orange: () => [
    circle(400, 560, 260, { ...THICK, ...ORANGE }),
    line(400, 300, 400, 250, GREEN),
    ellipse(480, 240, 80, 32, GREEN),
    circle(780, 700, 150, { ...THICK, ...ORANGE }),
    circle(780, 700, 120, ORANGE),
    ...Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * PI * 2;
      return line(780, 700, 780 + 120 * Math.cos(a), 700 + 120 * Math.sin(a), ORANGE);
    }),
  ],

  pear: () => [
    path(
      Array.from({ length: 61 }, (_, i) => {
        const t = (i / 60) * PI * 2;
        const k = 0.5 + 0.5 * ((1 - Math.cos(t)) / 2) ** 1.3;
        return [500 + 240 * Math.sin(t) * k, 560 - 300 * Math.cos(t)] as [number, number];
      }),
      { ...THICK, ...GREEN },
    ),
    line(500, 260, 520, 170, { ...THICK, ...BROWN }),
    ellipse(590, 190, 70, 30, GREEN),
    line(530, 190, 650, 185, THIN),
    arc(560, 640, 160, PI * 1.5, PI * 1.9, THIN, 8),
    dot(480, 850, 6),
  ],

  strawberry: () => [
    path(
      [
        ...cubicPoints([500, 880], [250, 700], [240, 360], [420, 330]),
        [580, 330],
        ...cubicPoints([580, 330], [760, 360], [750, 700], [500, 880]),
      ],
      { ...THICK, ...RED },
    ),
    star(500, 320, 150, 60, 6, FILL_GREEN),
    line(500, 320, 500, 230, GREEN),
    ...[
      [400, 480],
      [520, 440],
      [620, 500],
      [440, 600],
      [560, 580],
      [500, 720],
      [380, 700],
    ].map(([x, y]) => ellipse(x as number, y as number, 10, 16, FILL_INK)),
  ],

  watermelon: () => [
    arc(500, 320, 420, 0, PI, { width: 12, ...GREEN }, 32),
    line(80, 320, 920, 320, { ...THICK, ...GREEN }),
    arc(500, 320, 350, 0, PI, { width: 8, ...RED }, 32),
    ...[
      [400, 420],
      [560, 400],
      [320, 520],
      [500, 540],
      [660, 500],
      [440, 640],
    ].map(([x, y]) => ellipse(x as number, y as number, 12, 20, FILL_INK)),
  ],

  mushroom: () => [
    path([...ellipsePoints(500, 500, 320, 260, PI, PI * 2), [180, 500]], { ...THICK, ...RED }),
    polygon(
      [
        [400, 500],
        [380, 860],
        [620, 860],
        [600, 500],
      ],
      THICK,
    ),
    circle(380, 380, 36, RED),
    circle(520, 300, 42, RED),
    circle(650, 400, 30, RED),
    circle(470, 450, 22, RED),
    line(300, 860, 700, 860),
  ],

  cookie: () => [
    circle(500, 500, 300, { ...THICK, ...BROWN }),
    circle(400, 400, 28, FILL_INK),
    circle(560, 360, 24, FILL_INK),
    circle(650, 520, 30, FILL_INK),
    circle(480, 560, 26, FILL_INK),
    circle(360, 600, 22, FILL_INK),
    circle(560, 680, 28, FILL_INK),
    arc(500, 500, 250, PI * 0.7, PI * 0.9, THIN, 6),
  ],

  candy: () => [
    ellipse(500, 500, 200, 140, { ...THICK, ...PINK }),
    polygon(
      [
        [300, 500],
        [150, 400],
        [170, 500],
        [150, 600],
      ],
      PINK,
    ),
    polygon(
      [
        [700, 500],
        [850, 400],
        [830, 500],
        [850, 600],
      ],
      PINK,
    ),
    arc(420, 500, 120, PI * 1.5, PI * 2.5, PINK, 12),
    arc(500, 500, 120, PI * 1.5, PI * 2.5, PINK, 12),
    arc(580, 500, 120, PI * 1.5, PI * 2.5, PINK, 12),
  ],

  donut: () => [
    circle(500, 500, 320, { ...THICK, ...BROWN }),
    circle(500, 500, 110, { ...THICK, ...BROWN }),
    path(
      Array.from({ length: 73 }, (_, i) => {
        const t = (i / 72) * PI * 2;
        const r = 260 + 20 * Math.sin(t * 9);
        return [500 + r * Math.cos(t), 500 + r * Math.sin(t)] as [number, number];
      }),
      PINK,
    ),
    line(330, 330, 370, 300, PINK),
    line(600, 280, 640, 300, PINK),
    line(720, 450, 750, 490, PINK),
    line(300, 560, 330, 600, PINK),
    line(560, 720, 600, 700, PINK),
    line(680, 640, 720, 660, PINK),
  ],

  hamburger: () => [
    path([...ellipsePoints(500, 460, 340, 200, PI, PI * 2), [160, 460]], { ...THICK, ...BROWN }),
    dot(380, 340, 8, BROWN_HEX),
    dot(480, 300, 8, BROWN_HEX),
    dot(600, 310, 8, BROWN_HEX),
    dot(680, 380, 8, BROWN_HEX),
    zigzag(150, 500, 850, 500, 12, 30, GREEN),
    polygon([
      [170, 540],
      [830, 540],
      [880, 620],
      [120, 620],
    ]),
    rect(170, 610, 660, 60, FILL_BROWN),
    polygon(
      [
        [160, 680],
        [840, 680],
        [840, 740],
        [780, 790],
        [220, 790],
        [160, 740],
      ],
      { ...THICK, ...BROWN },
    ),
  ],

  "hot dog": () => [
    roundedRect(120, 380, 760, 260, 120, THICK),
    roundedRect(160, 430, 680, 120, 60, { ...THICK, ...RED }),
    zigzag(200, 490, 800, 490, 8, 34, { ...THICK, ...YELLOW }),
    line(160, 640, 840, 640),
    line(130, 500, 870, 500, THIN),
    dot(300, 410, 6),
    dot(500, 400, 6),
    dot(700, 410, 6),
  ],

  sandwich: () => [
    roundedRect(150, 280, 700, 140, 70, THICK),
    zigzag(150, 450, 850, 450, 12, 34, GREEN),
    polygon([
      [140, 500],
      [860, 500],
      [900, 560],
      [180, 560],
    ]),
    rect(170, 560, 660, 50, RED),
    roundedRect(150, 620, 700, 130, 50, THICK),
    dot(350, 330, 7),
    dot(500, 310, 7),
    dot(650, 330, 7),
  ],

  spaghetti: () => [
    ellipse(500, 640, 400, 150, THICK),
    ellipse(500, 640, 320, 100, THIN),
    ...[560, 600, 640, 680].map((y, i) => wave(230, 770, y, 6 + i, 18, YELLOW)),
    circle(380, 580, 45, FILL_BROWN),
    circle(540, 620, 45, FILL_BROWN),
    circle(660, 570, 40, FILL_BROWN),
    line(760, 280, 620, 560),
    line(740, 280, 780, 280),
    line(740, 280, 740, 330, THIN),
    line(760, 280, 760, 330, THIN),
    line(780, 280, 780, 330, THIN),
  ],

  sushi: () => [
    circle(330, 560, 180, THICK),
    circle(330, 560, 120),
    circle(330, 560, 50, FILL_PINK),
    rect(290, 520, 30, 30, FILL_GREEN),
    ellipse(720, 660, 150, 70),
    polygon(
      [
        [560, 620],
        [880, 600],
        [900, 540],
        [580, 560],
      ],
      FILL_PINK,
    ),
    line(80, 760, 920, 760, THICK),
    line(600, 300, 900, 420, THIN),
    line(640, 260, 940, 380, THIN),
  ],

  taco: () => [
    arc(500, 450, 360, 0, PI, { width: 12, ...YELLOW }, 32),
    arc(500, 450, 300, 0, PI, YELLOW, 32),
    zigzag(170, 440, 830, 440, 10, 44, GREEN),
    circle(300, 420, 36, FILL_INK),
    circle(520, 400, 36, FILL_INK),
    circle(720, 430, 32, FILL_INK),
    dot(420, 440, 14),
    dot(620, 450, 14),
    dot(360, 480, 12),
  ],

  pancake: () => [
    ellipse(500, 860, 430, 70, THICK),
    ellipse(500, 700, 300, 70, THICK),
    ellipse(500, 600, 300, 70, { ...THICK, fill: "#ffffff" }),
    ellipse(500, 500, 300, 70, { ...THICK, fill: "#ffffff" }),
    polygon(
      [
        [440, 440],
        [560, 440],
        [580, 480],
        [460, 480],
      ],
      FILL_YELLOW,
    ),
    wave(260, 740, 520, 5, 12, BROWN),
    line(300, 540, 300, 620, { ...THICK, ...BROWN }),
    line(420, 560, 420, 660, { ...THICK, ...BROWN }),
    line(600, 560, 600, 640, { ...THICK, ...BROWN }),
    line(720, 540, 720, 600, { ...THICK, ...BROWN }),
  ],

  popcorn: () => [
    polygon(
      [
        [290, 520],
        [710, 520],
        [760, 920],
        [240, 920],
      ],
      THICK,
    ),
    line(370, 520, 350, 920, { ...THICK, ...RED }),
    line(460, 520, 450, 920, { ...THICK, ...RED }),
    line(550, 520, 560, 920, { ...THICK, ...RED }),
    line(640, 520, 660, 920, { ...THICK, ...RED }),
    circle(350, 460, 70, YELLOW),
    circle(450, 380, 80, YELLOW),
    circle(570, 370, 75, YELLOW),
    circle(660, 450, 70, YELLOW),
    circle(500, 470, 60, YELLOW),
    circle(520, 250, 40, YELLOW),
  ],

  pretzel: () => [
    path(
      Array.from({ length: 73 }, (_, k) => {
        const a = (k / 72) * PI * 2;
        const d = Math.exp(-(((a - PI * 1.5) / 0.45) ** 2)) * 110;
        return [500 + 300 * Math.cos(a), 540 + 270 * Math.sin(a) + d] as [number, number];
      }),
      { width: 12, ...BROWN },
    ),
    curve([290, 720], [500, 560], [660, 330], { width: 12, ...BROWN }),
    curve([710, 720], [500, 560], [340, 330], { width: 12, ...BROWN }),
    dot(500, 820, 6),
    dot(250, 480, 6),
    dot(750, 480, 6),
    dot(370, 300, 6),
    dot(630, 300, 6),
    dot(420, 680, 6),
    dot(580, 680, 6),
  ],

  lollipop: () => [
    circle(500, 360, 230, { ...THICK, ...PINK }),
    spiral(500, 360, 200, 3, PINK),
    line(500, 590, 500, 950, { ...THICK }),
    polygon(
      [
        [500, 620],
        [420, 580],
        [420, 660],
      ],
      THIN,
    ),
    polygon(
      [
        [500, 620],
        [580, 580],
        [580, 660],
      ],
      THIN,
    ),
    ...sparkle(640, 230, 30),
  ],

  cupcake: () => [
    polygon(
      [
        [290, 560],
        [710, 560],
        [650, 900],
        [350, 900],
      ],
      THICK,
    ),
    line(400, 560, 420, 900, THIN),
    line(500, 560, 500, 900, THIN),
    line(600, 560, 580, 900, THIN),
    arc(500, 560, 240, PI, PI * 2, { ...THICK, ...PINK }, 24),
    arc(500, 450, 170, PI, PI * 2, { ...THICK, ...PINK }, 20),
    arc(500, 360, 100, PI, PI * 2, { ...THICK, ...PINK }, 16),
    dot(500, 250, 28, "#c0392b"),
    line(500, 225, 520, 170, THIN),
  ],

  noodles: () => [
    ellipse(500, 560, 340, 80, THICK),
    arc(500, 560, 340, 0.1, PI - 0.1, THICK, 24),
    ...[520, 550, 580].map((y, i) => wave(200, 800, y, 7 + i, 14, YELLOW)),
    line(720, 180, 420, 540),
    line(770, 200, 470, 560),
    curve([420, 300], [380, 230], [430, 160], THIN),
    curve([560, 320], [520, 250], [570, 180], THIN),
  ],

  pumpkin: () => [
    ellipse(500, 580, 330, 250, { ...THICK, ...ORANGE }),
    ellipse(500, 580, 200, 250, ORANGE),
    ellipse(500, 580, 80, 250, ORANGE),
    polygon(
      [
        [470, 330],
        [480, 240],
        [540, 230],
        [530, 330],
      ],
      { ...THICK, ...GREEN },
    ),
    curve([540, 250], [640, 190], [680, 260], GREEN),
    line(470, 330, 530, 330, ORANGE),
  ],
};
