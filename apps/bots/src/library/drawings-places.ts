/** Buildings, vehicles, landscapes and scenes. */
import type { DrawOp } from "@pictionary/protocol";
import {
  BLUE,
  BROWN,
  FILL_INK,
  FILL_RED,
  FILL_YELLOW,
  GREEN,
  GREY,
  ORANGE,
  PI,
  RED,
  THICK,
  THIN,
  WHITE_HEX,
  YELLOW,
} from "./palette.js";
import { flame, ground, wheel } from "./parts.js";
import {
  arc,
  circle,
  curve,
  dashed,
  dot,
  ellipse,
  line,
  path,
  polygon,
  rect,
  rotate,
  roundedRect,
  type Style,
  scale,
  spokes,
  translate,
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

/** Row of square merlons along y from x0 to x1. */
function battlements(x0: number, x1: number, y: number, size: number, s: Style = {}): DrawOp[] {
  const out: DrawOp[] = [];
  for (let x = x0; x + size <= x1 + 1; x += size * 2) out.push(rect(x, y - size, size, size, s));
  return out;
}

function sunRays(cx: number, cy: number, r: number): DrawOp[] {
  return [
    circle(cx, cy, r, { ...THICK, ...YELLOW }),
    ...spokes(cx, cy, r * 1.3, r * 1.8, 8, YELLOW),
  ];
}

function barn(): DrawOp[] {
  return [
    rect(200, 520, 600, 360, { ...THICK, ...RED }),
    polygon(
      [
        [150, 520],
        [250, 350],
        [400, 230],
        [600, 230],
        [750, 350],
        [850, 520],
      ],
      THICK,
    ),
    rect(400, 640, 200, 240, { ...THICK, ...RED }),
    line(400, 640, 600, 880, RED),
    line(600, 640, 400, 880, RED),
    rect(450, 400, 100, 90),
    line(450, 445, 550, 445, THIN),
    line(500, 400, 500, 490, THIN),
    ground(880),
  ];
}

export const PLACES: Record<string, Drawing> = {
  bus: () => [
    roundedRect(100, 300, 800, 420, 40, { ...THICK, ...YELLOW }),
    ...[150, 300, 450, 600, 750].map((x) => rect(x, 350, 110, 120)),
    line(100, 520, 900, 520, YELLOW),
    rect(320, 540, 120, 180),
    ...wheel(260, 740, 70),
    ...wheel(740, 740, 70),
    dot(140, 600, 18, "#e0a800"),
    dot(860, 600, 18, "#e0a800"),
    line(500, 540, 500, 720, THIN),
  ],

  plane: () => [
    polygon(
      [
        [100, 520],
        [200, 450],
        [700, 430],
        [920, 500],
        [700, 570],
        [200, 570],
      ],
      THICK,
    ),
    polygon(
      [
        [440, 450],
        [600, 180],
        [690, 180],
        [560, 450],
      ],
      THICK,
    ),
    polygon(
      [
        [440, 570],
        [600, 840],
        [690, 840],
        [560, 570],
      ],
      THICK,
    ),
    polygon(
      [
        [130, 460],
        [100, 300],
        [170, 300],
        [250, 450],
      ],
      THICK,
    ),
    ...[300, 360, 420, 720, 780].map((x) => circle(x, 490, 14, THIN)),
    arc(800, 500, 60, PI * 1.5, PI * 2.5, {}, 10),
  ],

  truck: () => [
    polygon(
      [
        [100, 660],
        [100, 440],
        [180, 340],
        [380, 340],
        [380, 660],
      ],
      THICK,
    ),
    rect(380, 280, 520, 380, THICK),
    rect(140, 380, 200, 120),
    ...wheel(210, 700, 70),
    ...wheel(540, 700, 70),
    ...wheel(790, 700, 70),
    line(100, 660, 900, 660, THICK),
    dot(110, 560, 14, "#e0a800"),
    line(420, 320, 860, 320, THIN),
  ],

  ship: () => [
    polygon(
      [
        [80, 620],
        [920, 620],
        [820, 800],
        [180, 800],
      ],
      THICK,
    ),
    rect(250, 500, 500, 120, THICK),
    rect(380, 380, 80, 120, FILL_RED),
    rect(520, 380, 80, 120, FILL_RED),
    arc(420, 330, 40, PI * 1.1, PI * 2, {}, 8),
    arc(560, 320, 50, PI * 1.1, PI * 2, {}, 8),
    circle(300, 700, 22),
    circle(500, 700, 22),
    circle(700, 700, 22),
    line(250, 560, 750, 560, THIN),
    wave(60, 940, 860, 5, 18, BLUE),
  ],

  bridge: () => [
    line(60, 620, 940, 620, { width: 12 }),
    rect(250, 180, 50, 450, THICK),
    rect(700, 180, 50, 450, THICK),
    curve([275, 180], [500, 720], [725, 180]),
    line(275, 180, 60, 620),
    line(725, 180, 940, 620),
    ...[350, 420, 500, 580, 650].map((x) => {
      const t = (x - 275) / 450;
      const y = 180 * (1 - t) ** 2 + 2 * (1 - t) * t * 720 + t * t * 180;
      return line(x, y, x, 620, THIN);
    }),
    line(160, 400, 160, 620, THIN),
    line(840, 400, 840, 620, THIN),
    wave(60, 940, 860, 6, 16, BLUE),
  ],

  road: () => [
    polygon(
      [
        [400, 160],
        [600, 160],
        [920, 900],
        [80, 900],
      ],
      THICK,
    ),
    ...dashed(500, 180, 500, 880, 6, { ...THICK, ...YELLOW }),
    line(40, 160, 960, 160, THIN),
    arc(200, 160, 60, PI, PI * 2, THIN, 10),
    arc(800, 160, 80, PI, PI * 2, THIN, 10),
    line(140, 500, 140, 420, THIN),
    circle(140, 390, 30, THIN),
  ],

  river: () => [
    path(
      Array.from({ length: 21 }, (_, i) => {
        const t = i / 20;
        return [330 + Math.sin(t * PI * 2) * 140, t * 1000] as [number, number];
      }),
      { ...THICK, ...GREEN },
    ),
    path(
      Array.from({ length: 21 }, (_, i) => {
        const t = i / 20;
        return [600 + Math.sin(t * PI * 2) * 140, t * 1000] as [number, number];
      }),
      { ...THICK, ...GREEN },
    ),
    wave(380, 540, 200, 2, 12, BLUE),
    wave(440, 600, 400, 2, 12, BLUE),
    wave(380, 540, 600, 2, 12, BLUE),
    wave(420, 580, 800, 2, 12, BLUE),
    zigzag(120, 300, 220, 300, 3, 40, GREEN),
    zigzag(760, 700, 860, 700, 3, 40, GREEN),
  ],

  beach: () => [
    ...sunRays(820, 180, 70),
    wave(60, 940, 600, 6, 14, BLUE),
    wave(60, 940, 660, 6, 14, BLUE),
    curve([60, 760], [500, 680], [940, 760], { ...THICK, ...YELLOW }),
    arc(330, 520, 180, PI, PI * 2, THICK, 24),
    line(150, 520, 510, 520),
    line(330, 340, 330, 520, THIN),
    line(240, 352, 240, 520, THIN),
    line(420, 352, 420, 520, THIN),
    line(330, 520, 330, 880, THICK),
    circle(620, 800, 60, THICK),
    line(560, 800, 680, 800),
  ],

  island: () => [
    arc(500, 700, 280, PI, PI * 2, THICK, 24),
    wave(60, 940, 700, 6, 16, BLUE),
    wave(60, 940, 780, 6, 16, BLUE),
    curve([500, 700], [520, 450], [560, 260], { width: 12 }),
    curve([560, 260], [420, 180], [320, 260], { ...THICK, ...GREEN }),
    curve([560, 260], [700, 180], [800, 260], { ...THICK, ...GREEN }),
    curve([560, 260], [620, 120], [700, 100], { ...THICK, ...GREEN }),
    curve([560, 260], [500, 120], [420, 100], { ...THICK, ...GREEN }),
    dot(540, 290, 14),
    dot(580, 300, 14),
    circle(150, 160, 60, THICK),
    ...spokes(150, 160, 80, 110, 8),
  ],

  volcano: () => [
    polygon(
      [
        [80, 860],
        [400, 300],
        [600, 300],
        [920, 860],
      ],
      THICK,
    ),
    ellipse(500, 300, 100, 30, { ...THICK, ...RED }),
    path(
      [
        [420, 320],
        [380, 420],
        [340, 480],
        [300, 620],
      ],
      { ...THICK, ...RED },
    ),
    path(
      [
        [580, 320],
        [600, 440],
        [660, 540],
        [700, 700],
      ],
      { ...THICK, ...RED },
    ),
    ...flame(500, 290, 240, { ...THICK, ...ORANGE }, ORANGE),
    circle(360, 120, 40),
    circle(440, 60, 50),
    ground(860),
  ],

  castle: () => [
    rect(240, 500, 520, 380, THICK),
    rect(100, 300, 140, 580, THICK),
    rect(760, 300, 140, 580, THICK),
    ...battlements(100, 240, 300, 35),
    ...battlements(760, 900, 300, 35),
    ...battlements(240, 760, 500, 40),
    path(
      [[430, 880], [430, 720], ...ellipsePoints(500, 720, 70, 70, PI, PI * 2, 12), [570, 880]],
      THICK,
    ),
    rect(150, 420, 40, 70),
    rect(810, 420, 40, 70),
    rect(350, 580, 40, 70),
    rect(610, 580, 40, 70),
    line(170, 265, 170, 160, THIN),
    polygon(
      [
        [170, 160],
        [240, 185],
        [170, 210],
      ],
      FILL_RED,
    ),
    line(830, 265, 830, 160, THIN),
    polygon(
      [
        [830, 160],
        [900, 185],
        [830, 210],
      ],
      FILL_RED,
    ),
    ground(880),
  ],

  lighthouse: () => [
    polygon(
      [
        [380, 860],
        [620, 860],
        [560, 300],
        [440, 300],
      ],
      THICK,
    ),
    rect(430, 220, 140, 80, THICK),
    polygon(
      [
        [410, 220],
        [590, 220],
        [500, 140],
      ],
      THICK,
    ),
    line(410, 440, 590, 440, { width: 12, ...RED }),
    line(400, 580, 600, 580, { width: 12, ...RED }),
    line(390, 720, 610, 720, { width: 12, ...RED }),
    circle(500, 260, 22, FILL_YELLOW),
    line(430, 240, 120, 150, YELLOW),
    line(430, 280, 120, 360, YELLOW),
    line(570, 240, 880, 150, YELLOW),
    line(570, 280, 880, 360, YELLOW),
    arc(500, 900, 220, PI, PI * 2, THICK, 16),
    wave(60, 940, 920, 6, 14),
  ],

  windmill: () => [
    polygon(
      [
        [400, 880],
        [600, 880],
        [560, 420],
        [440, 420],
      ],
      { ...THICK, ...BROWN },
    ),
    polygon(
      [
        [420, 420],
        [580, 420],
        [500, 330],
      ],
      THICK,
    ),
    ...[0, 1, 2, 3].flatMap((i) =>
      rotate(
        [
          polygon(
            [
              [500, 400],
              [500, 100],
              [560, 100],
              [560, 400],
            ],
            THICK,
          ),
          line(530, 120, 530, 380, THIN),
        ],
        (i * PI) / 2 + 0.4,
        500,
        400,
      ),
    ),
    dot(500, 400, 18),
    rect(470, 760, 60, 120),
    ground(880),
  ],

  skyscraper: () => [
    rect(300, 120, 400, 780, THICK),
    rect(120, 500, 180, 400, THICK),
    rect(700, 400, 180, 500, THICK),
    line(500, 120, 500, 30, THICK),
    ...[0, 1, 2, 3, 4, 5].flatMap((r) =>
      [0, 1, 2].map((c) => rect(340 + c * 110, 170 + r * 120, 70, 70, THIN)),
    ),
    ...[560, 680, 800].map((y) => rect(170, y, 80, 50, THIN)),
    ...[460, 580, 700, 820].map((y) => rect(750, y, 80, 50, THIN)),
    ground(900),
  ],

  pyramid: () => [
    polygon(
      [
        [100, 820],
        [500, 180],
        [900, 820],
      ],
      { ...THICK, ...YELLOW },
    ),
    line(500, 180, 620, 820, YELLOW),
    line(300, 500, 560, 500, THIN),
    line(230, 620, 580, 620, THIN),
    line(160, 740, 600, 740, THIN),
    line(560, 500, 760, 500, THIN),
    line(580, 620, 820, 620, THIN),
    ...sunRays(150, 170, 60),
    line(60, 820, 940, 820, THICK),
  ],

  igloo: () => [
    arc(500, 720, 330, PI, PI * 2, { ...THICK, ...BLUE }, 32),
    line(170, 720, 830, 720, { ...THICK, ...BLUE }),
    arc(760, 720, 120, PI, PI * 2, { ...THICK, ...BLUE }, 16),
    ellipse(760, 720, 70, 70, FILL_INK),
    rect(640, 720, 240, 60, { color: WHITE_HEX, width: 1, fill: WHITE_HEX }),
    arc(500, 720, 250, PI, PI * 2, BLUE, 24),
    arc(500, 720, 160, PI, PI * 2, BLUE, 16),
    line(500, 390, 500, 470, BLUE),
    line(390, 480, 400, 560, BLUE),
    line(610, 480, 600, 560, BLUE),
    line(300, 600, 320, 720, BLUE),
    line(700, 600, 680, 720, BLUE),
    line(430, 580, 430, 720, BLUE),
    line(570, 580, 570, 720, BLUE),
    line(60, 720, 940, 720, THICK),
  ],

  barn: () => barn(),

  church: () => [
    rect(250, 520, 500, 360, THICK),
    polygon(
      [
        [200, 520],
        [500, 320],
        [800, 520],
      ],
      THICK,
    ),
    rect(430, 220, 140, 300, THICK),
    polygon(
      [
        [420, 220],
        [580, 220],
        [500, 60],
      ],
      THICK,
    ),
    line(500, 60, 500, 10, THICK),
    line(470, 30, 530, 30, THICK),
    path(
      [[450, 880], [450, 740], ...ellipsePoints(500, 740, 50, 50, PI, PI * 2, 10), [550, 880]],
      THICK,
    ),
    path([
      [300, 700],
      [300, 620],
      ...ellipsePoints(330, 620, 30, 30, PI, PI * 2, 8),
      [360, 700],
      [300, 700],
    ]),
    path([
      [640, 700],
      [640, 620],
      ...ellipsePoints(670, 620, 30, 30, PI, PI * 2, 8),
      [700, 700],
      [640, 700],
    ]),
    ground(880),
  ],

  hospital: () => [
    rect(150, 300, 700, 580, THICK),
    rect(470, 330, 60, 200, FILL_RED),
    rect(400, 400, 200, 60, FILL_RED),
    ...[220, 330].flatMap((x) => [600, 720].map((y) => rect(x, y, 80, 70))),
    ...[590, 700].flatMap((x) => [600, 720].map((y) => rect(x, y, 80, 70))),
    rect(440, 740, 120, 140, THICK),
    line(150, 560, 850, 560, THIN),
    ground(880),
  ],

  circus: () => [
    polygon(
      [
        [100, 520],
        [500, 180],
        [900, 520],
      ],
      { ...THICK, ...RED },
    ),
    zigzag(100, 520, 900, 520, 8, 40, RED),
    line(500, 180, 300, 520, RED),
    line(500, 180, 700, 520, RED),
    polygon(
      [
        [150, 560],
        [850, 560],
        [900, 880],
        [100, 880],
      ],
      THICK,
    ),
    ...[300, 450, 600, 750].map((x) => line(x - 20, 560, x - 30, 880, RED)),
    path(
      [[420, 880], [420, 740], ...ellipsePoints(500, 740, 80, 80, PI, PI * 2, 12), [580, 880]],
      THICK,
    ),
    line(500, 180, 500, 80, THIN),
    polygon(
      [
        [500, 80],
        [600, 110],
        [500, 140],
      ],
      FILL_YELLOW,
    ),
  ],

  helicopter: () => [
    ellipse(460, 540, 230, 130, THICK),
    polygon(
      [
        [670, 500],
        [900, 420],
        [900, 470],
        [680, 560],
      ],
      THICK,
    ),
    circle(900, 440, 50),
    line(850, 440, 950, 440, THICK),
    line(460, 410, 460, 300, THICK),
    line(140, 300, 800, 300, { width: 12 }),
    ellipse(360, 530, 70, 55),
    line(300, 740, 640, 740, THICK),
    line(380, 670, 380, 740),
    line(560, 670, 560, 740),
  ],

  submarine: () => [
    wave(60, 940, 160, 6, 14, BLUE),
    ellipse(480, 580, 380, 140, THICK),
    rect(420, 340, 140, 100, THICK),
    line(540, 340, 540, 220, THICK),
    line(540, 220, 610, 220, THICK),
    circle(330, 580, 28),
    circle(450, 580, 28),
    circle(570, 580, 28),
    line(860, 580, 920, 580, THICK),
    line(920, 520, 920, 640, THICK),
    polygon(
      [
        [720, 460],
        [800, 400],
        [800, 480],
      ],
      THICK,
    ),
    dot(240, 480, 6, "#2b6cb0"),
    dot(200, 400, 7, "#2b6cb0"),
  ],

  tractor: () => [
    rect(200, 300, 260, 260, { ...THICK, ...GREEN }),
    rect(240, 340, 180, 140),
    rect(460, 460, 340, 160, { ...THICK, ...GREEN }),
    line(560, 460, 560, 280, { width: 12 }),
    rect(540, 240, 40, 40),
    ...wheel(260, 720, 180),
    ...wheel(740, 780, 110),
    line(440, 720, 620, 820, THICK),
    ground(890),
  ],

  scooter: () => [
    line(300, 760, 640, 760, { width: 12 }),
    ...wheel(250, 800, 55),
    ...wheel(690, 800, 55),
    line(640, 760, 770, 220, { width: 8 }),
    line(680, 220, 860, 220, { width: 8 }),
    line(690, 200, 690, 240, THICK),
    line(850, 200, 850, 240, THICK),
    arc(250, 800, 80, PI * 1.1, PI * 1.9, THICK, 10),
    arc(690, 800, 80, PI * 1.1, PI * 1.9, THICK, 10),
  ],

  skateboard: () => [
    path(
      [
        [100, 480],
        [180, 410],
        [820, 410],
        [900, 480],
      ],
      { width: 12 },
    ),
    line(180, 440, 820, 440, THIN),
    line(260, 420, 260, 540, THICK),
    line(740, 420, 740, 540, THICK),
    circle(210, 560, 45, THICK),
    circle(310, 560, 45, THICK),
    circle(690, 560, 45, THICK),
    circle(790, 560, 45, THICK),
    line(210, 540, 310, 540, THICK),
    line(690, 540, 790, 540, THICK),
  ],

  canoe: () => [
    path(
      [
        [80, 480],
        [200, 650],
        [500, 700],
        [800, 650],
        [920, 480],
        [700, 520],
        [500, 540],
        [300, 520],
        [80, 480],
      ],
      { ...THICK, ...BROWN },
    ),
    curve([200, 620], [500, 660], [800, 620], BROWN),
    line(300, 530, 320, 620, THIN),
    line(700, 530, 680, 620, THIN),
    line(560, 180, 740, 760, THICK),
    polygon(
      [
        [720, 700],
        [790, 720],
        [800, 820],
        [740, 830],
      ],
      THICK,
    ),
    wave(60, 940, 820, 6, 14, BLUE),
  ],

  ambulance: () => [
    polygon(
      [
        [100, 660],
        [100, 420],
        [280, 420],
        [340, 300],
        [900, 300],
        [900, 660],
      ],
      THICK,
    ),
    line(100, 660, 900, 660, THICK),
    rect(150, 450, 120, 120),
    rect(640, 420, 40, 160, FILL_RED),
    rect(580, 480, 160, 40, FILL_RED),
    rect(520, 250, 140, 50, FILL_RED),
    ...wheel(260, 700, 70),
    ...wheel(740, 700, 70),
    line(360, 340, 480, 340, THIN),
    line(360, 400, 480, 400, THIN),
  ],

  "fire truck": () => [
    rect(100, 420, 800, 260, { ...THICK, ...RED }),
    polygon(
      [
        [640, 420],
        [640, 300],
        [800, 300],
        [900, 420],
      ],
      { ...THICK, ...RED },
    ),
    rect(680, 330, 100, 90),
    line(150, 400, 650, 240, THICK),
    line(170, 450, 670, 290, THICK),
    ...[250, 350, 450, 550].map((x) =>
      line(x, 410 - (x - 150) * 0.32 + 50, x, 410 - (x - 150) * 0.32, THIN),
    ),
    ...wheel(240, 720, 75),
    ...wheel(520, 720, 75),
    ...wheel(780, 720, 75),
    rect(820, 260, 60, 40, FILL_YELLOW),
    circle(400, 560, 40),
    circle(300, 560, 40),
  ],

  tornado: () => [
    arc(380, 170, 110, PI * 0.9, PI * 1.9, GREY, 12),
    arc(530, 150, 130, PI, PI * 2, GREY, 12),
    arc(680, 180, 100, PI * 1.1, PI * 2.1, GREY, 12),
    ellipse(500, 200, 300, 45, { ...THICK, ...GREY }),
    ellipse(510, 330, 230, 38, { ...THICK, ...GREY }),
    ellipse(490, 460, 170, 32, { ...THICK, ...GREY }),
    ellipse(510, 580, 115, 28, { ...THICK, ...GREY }),
    ellipse(490, 690, 70, 22, { ...THICK, ...GREY }),
    ellipse(510, 790, 30, 14, { ...THICK, ...GREY }),
    line(510, 804, 520, 880, { ...THICK, ...GREY }),
    dot(200, 500, 10),
    dot(820, 600, 10),
    line(160, 700, 230, 690, THIN),
    line(780, 420, 860, 410, THIN),
    ground(880),
  ],

  waterfall: () => [
    polygon(
      [
        [100, 900],
        [100, 300],
        [420, 300],
        [420, 900],
      ],
      { ...THICK, ...GREY },
    ),
    line(150, 500, 300, 520, GREY),
    line(180, 700, 330, 720, GREY),
    wave(60, 420, 300, 3, 10, BLUE),
    path(
      Array.from(
        { length: 15 },
        (_, i) => [460 + Math.sin(i) * 8, 300 + i * 40] as [number, number],
      ),
      { ...THICK, ...BLUE },
    ),
    path(
      Array.from(
        { length: 15 },
        (_, i) => [520 + Math.cos(i) * 8, 300 + i * 40] as [number, number],
      ),
      { ...THICK, ...BLUE },
    ),
    path(
      Array.from(
        { length: 15 },
        (_, i) => [580 + Math.sin(i * 1.3) * 8, 300 + i * 40] as [number, number],
      ),
      { ...THICK, ...BLUE },
    ),
    wave(420, 940, 880, 5, 14, BLUE),
    arc(520, 880, 100, PI * 1.1, PI * 1.9, BLUE, 10),
    dot(650, 800, 8, "#2b6cb0"),
    dot(420, 780, 8, "#2b6cb0"),
    ellipse(820, 880, 60, 30, GREY),
  ],

  desert: () => [
    ...sunRays(780, 200, 80),
    curve([60, 760], [300, 620], [560, 760], { ...THICK, ...YELLOW }),
    curve([480, 760], [720, 640], [940, 760], { ...THICK, ...YELLOW }),
    line(60, 760, 940, 760, { ...THICK, ...YELLOW }),
    roundedRect(260, 380, 90, 400, 40, { ...THICK, ...GREEN }),
    path(
      [
        [260, 540],
        [180, 540],
        [180, 420],
      ],
      { width: 12, ...GREEN },
    ),
    path(
      [
        [350, 480],
        [430, 480],
        [430, 380],
      ],
      { width: 12, ...GREEN },
    ),
    line(285, 440, 285, 720, THIN),
    line(325, 440, 325, 720, THIN),
  ],

  cave: () => [
    arc(500, 860, 420, PI, PI * 2, { ...THICK, ...GREY }, 32),
    ellipse(430, 860, 160, 140, FILL_INK),
    rect(0, 860, 1000, 140, { color: WHITE_HEX, width: 1, fill: WHITE_HEX }),
    polygon(
      [
        [340, 740],
        [370, 800],
        [400, 740],
      ],
      { color: WHITE_HEX, width: 4 },
    ),
    polygon(
      [
        [450, 720],
        [480, 790],
        [510, 720],
      ],
      { color: WHITE_HEX, width: 4 },
    ),
    line(620, 600, 700, 640, GREY),
    line(300, 560, 360, 520, GREY),
    ellipse(800, 860, 70, 30, GREY),
    ground(860),
  ],

  sunset: () => [
    arc(500, 600, 190, PI, PI * 2, { width: 12, ...ORANGE }, 24),
    ...spokes(500, 600, 240, 320, 7, ORANGE, PI + 0.26).filter((_, i) => i < 4),
    line(60, 600, 940, 600, THICK),
    wave(60, 940, 680, 6, 14, BLUE),
    wave(60, 940, 760, 6, 14, BLUE),
    wave(60, 940, 840, 6, 14, BLUE),
    line(430, 640, 570, 640, { ...THICK, ...ORANGE }),
    line(450, 700, 550, 700, { ...THICK, ...ORANGE }),
    line(470, 760, 530, 760, { ...THICK, ...ORANGE }),
    path(
      [
        [150, 300],
        [190, 270],
        [230, 300],
      ],
      THIN,
    ),
    path(
      [
        [250, 240],
        [290, 210],
        [330, 240],
      ],
      THIN,
    ),
  ],

  earthquake: () => [
    line(60, 780, 420, 780, { width: 12 }),
    line(580, 820, 940, 820, { width: 12 }),
    zigzag(420, 780, 580, 820, 3, 60, { width: 12 }),
    zigzag(500, 800, 480, 980, 4, 30, THICK),
    ...rotate(
      [
        rect(260, 520, 260, 240, THICK),
        polygon(
          [
            [230, 520],
            [390, 380],
            [550, 520],
          ],
          THICK,
        ),
        rect(360, 640, 60, 120),
      ],
      -0.18,
      390,
      760,
    ),
    ...rotate(
      [
        rect(600, 560, 200, 220, THICK),
        polygon(
          [
            [580, 560],
            [700, 440],
            [820, 560],
          ],
          THICK,
        ),
      ],
      0.15,
      700,
      780,
    ),
    line(120, 500, 180, 500, THIN),
    line(100, 560, 160, 560, THIN),
    line(840, 420, 900, 420, THIN),
    line(860, 480, 920, 480, THIN),
  ],

  farm: () => [
    ...translate(scale(barn(), 0.55, 500, 880), -200, 0),
    rect(700, 420, 140, 460, THICK),
    arc(770, 420, 70, PI, PI * 2, THICK, 12),
    line(700, 560, 840, 560, THIN),
    line(700, 700, 840, 700, THIN),
    ...[80, 160, 240, 320].map((x) => line(x, 760, x, 880, THICK)),
    line(60, 800, 340, 800),
    line(60, 850, 340, 850),
    ...sunRays(880, 150, 55),
    ground(880),
  ],

  stadium: () => [
    ellipse(500, 540, 430, 200, { width: 12 }),
    ellipse(500, 560, 300, 110, THICK),
    rect(380, 520, 240, 80, GREEN),
    line(500, 520, 500, 600, GREEN),
    circle(500, 560, 30, GREEN),
    ...[0.15, 0.35, 0.65, 0.85, 1.15, 1.35, 1.65, 1.85].map((k) =>
      line(
        500 + 300 * Math.cos(k * PI),
        560 + 110 * Math.sin(k * PI),
        500 + 430 * Math.cos(k * PI),
        540 + 200 * Math.sin(k * PI),
        THIN,
      ),
    ),
    line(140, 420, 140, 160, THICK),
    rect(100, 120, 80, 40, THICK),
    line(860, 420, 860, 160, THICK),
    rect(820, 120, 80, 40, THICK),
  ],
};
