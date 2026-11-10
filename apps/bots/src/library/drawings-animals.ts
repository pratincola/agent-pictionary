/** Animals (easy and medium tiers). Most are quadruped() plus one or two signature features. */
import type { DrawOp } from "@pictionary/protocol";
import {
  BLUE,
  BROWN,
  FILL_INK,
  FILL_ORANGE,
  FILL_PINK,
  FILL_WHITE,
  FILL_YELLOW,
  GREEN,
  GREY,
  ORANGE,
  PI,
  PINK,
  PURPLE,
  RED,
  THICK,
  THIN,
  YELLOW,
} from "./palette.js";
import { flame, noseTri, quadruped, triEar, whiskers } from "./parts.js";
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
  type Style,
  wave,
  zigzag,
} from "./shapes.js";

type Drawing = () => DrawOp[];

/** Vertical lines clipped to an ellipse (stripes on a body). */
function stripes(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  xs: number[],
  s: Style = {},
): DrawOp[] {
  return xs.map((x) => {
    const k = Math.sqrt(Math.max(0, 1 - ((x - cx) / rx) ** 2));
    return line(x, cy - ry * k, x, cy + ry * k, s);
  });
}

/** Outline of an ellipse with `bumps` scallops (wool, bush). */
function bumpyEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  bumps: number,
  amp: number,
  s: Style = {},
): DrawOp {
  const n = bumps * 8;
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * PI * 2;
    const k = 1 + (amp * Math.abs(Math.sin((t * bumps) / 2))) / 100;
    pts.push([cx + rx * k * Math.cos(t), cy + ry * k * Math.sin(t)]);
  }
  return path(pts, s);
}

/** Horse: body, long neck, head, mane, tail, legs. Shared by zebra and unicorn. */
function horseBase(s: Style = {}): DrawOp[] {
  return [
    ellipse(580, 600, 240, 140, s),
    polygon(
      [
        [380, 520],
        [310, 300],
        [420, 260],
        [500, 480],
      ],
      s,
    ),
    ellipse(290, 270, 110, 65, s),
    triEar([340, 215], [350, 140], [400, 225], s),
    zigzag(430, 250, 520, 470, 5, 30, s),
    dot(230, 250, 11),
    line(400, 720, 400, 920, { ...THICK, ...s }),
    line(500, 730, 500, 920, { ...THICK, ...s }),
    line(660, 730, 660, 920, { ...THICK, ...s }),
    line(760, 710, 760, 920, { ...THICK, ...s }),
    path(
      [
        [810, 560],
        [920, 640],
        [900, 800],
      ],
      { ...THICK, ...s },
    ),
  ];
}

export const ANIMALS: Record<string, Drawing> = {
  frog: () => [
    ellipse(500, 600, 280, 170, GREEN),
    circle(380, 440, 70, GREEN),
    circle(620, 440, 70, GREEN),
    dot(380, 440, 22),
    dot(620, 440, 22),
    arc(500, 560, 150, 0.25, PI - 0.25, {}, 14),
    path(
      [
        [250, 650],
        [120, 700],
        [160, 840],
        [320, 820],
      ],
      GREEN,
    ),
    path(
      [
        [750, 650],
        [880, 700],
        [840, 840],
        [680, 820],
      ],
      GREEN,
    ),
    line(400, 760, 380, 870, GREEN),
    line(600, 760, 620, 870, GREEN),
    path(
      [
        [330, 870],
        [380, 870],
        [430, 870],
      ],
      GREEN,
    ),
    path(
      [
        [570, 870],
        [620, 870],
        [670, 870],
      ],
      GREEN,
    ),
  ],

  duck: () => [
    ellipse(540, 620, 260, 140),
    circle(300, 400, 95),
    line(330, 490, 380, 560),
    line(230, 480, 300, 560),
    polygon(
      [
        [215, 390],
        [90, 420],
        [215, 450],
      ],
      FILL_ORANGE,
    ),
    dot(285, 370, 11),
    arc(600, 620, 110, PI * 1.1, PI * 1.9, {}, 12),
    polygon([
      [780, 560],
      [900, 470],
      [790, 650],
    ]),
    wave(80, 920, 780, 5, 18, BLUE),
  ],

  cow: () => [
    ...quadruped(),
    ellipse(480, 600, 70, 50, FILL_INK),
    ellipse(660, 560, 55, 40, FILL_INK),
    ellipse(210, 480, 60, 40),
    dot(195, 480, 7),
    dot(230, 480, 7),
    curve([200, 340], [180, 260], [230, 250], THICK),
    curve([330, 340], [350, 260], [310, 250], THICK),
    ellipse(170, 400, 40, 22),
    ellipse(370, 400, 40, 22),
    arc(620, 740, 50, 0, PI, {}, 10),
    path(
      [
        [810, 570],
        [880, 650],
        [860, 760],
      ],
      THIN,
    ),
  ],

  pig: () => [
    ellipse(540, 600, 280, 180, PINK),
    circle(280, 470, 120, PINK),
    ellipse(205, 500, 50, 36, FILL_PINK),
    dot(190, 500, 7),
    dot(220, 500, 7),
    dot(300, 420, 11),
    triEar([230, 370], [200, 270], [300, 350], PINK),
    triEar([330, 350], [380, 270], [390, 380], PINK),
    line(400, 760, 400, 880, { ...THICK, ...PINK }),
    line(500, 770, 500, 880, { ...THICK, ...PINK }),
    line(620, 770, 620, 880, { ...THICK, ...PINK }),
    line(720, 750, 720, 880, { ...THICK, ...PINK }),
    arc(840, 540, 30, PI * 1.5, PI * 3.2, PINK, 16),
  ],

  horse: () => horseBase(),

  sheep: () => [
    bumpyEllipse(560, 600, 250, 150, 12, 14),
    ellipse(260, 470, 85, 70, FILL_INK),
    circle(300, 450, 10, { fill: "#ffffff", width: 2, color: "#ffffff" }),
    ellipse(190, 420, 40, 20, FILL_INK),
    ellipse(330, 400, 40, 20, FILL_INK),
    bumpyEllipse(300, 380, 90, 50, 6, 12),
    line(420, 740, 420, 900, THICK),
    line(520, 750, 520, 900, THICK),
    line(620, 750, 620, 900, THICK),
    line(720, 740, 720, 900, THICK),
  ],

  mouse: () => [
    ellipse(540, 640, 230, 140, GREY),
    ellipse(310, 580, 120, 85, GREY),
    dot(190, 585, 14),
    circle(300, 460, 55, GREY),
    circle(410, 440, 55, GREY),
    dot(330, 560, 10),
    ...whiskers(200, 590, 90),
    curve([770, 640], [980, 700], [900, 900], THICK),
    arc(430, 780, 40, 0, PI, GREY, 10),
    arc(620, 780, 40, 0, PI, GREY, 10),
  ],

  bear: () => [
    ellipse(540, 650, 270, 200, BROWN),
    circle(330, 380, 140, BROWN),
    circle(230, 270, 45, BROWN),
    circle(430, 270, 45, BROWN),
    ellipse(265, 430, 65, 48, BROWN),
    dot(240, 415, 14),
    dot(370, 350, 12),
    line(380, 820, 380, 920, { ...THICK, ...BROWN }),
    line(480, 840, 480, 920, { ...THICK, ...BROWN }),
    line(620, 840, 620, 920, { ...THICK, ...BROWN }),
    line(720, 820, 720, 920, { ...THICK, ...BROWN }),
    arc(300, 460, 30, 0.2, PI * 0.9, THIN, 8),
  ],

  lion: () => [
    polygon(
      Array.from({ length: 32 }, (_, i) => {
        const r = i % 2 === 0 ? 250 : 200;
        const a = (i / 32) * PI * 2;
        return [500 + r * Math.cos(a), 420 + r * Math.sin(a)] as [number, number];
      }),
      ORANGE,
    ),
    circle(500, 420, 150, YELLOW),
    circle(420, 300, 35, YELLOW),
    circle(580, 300, 35, YELLOW),
    dot(445, 390, 13),
    dot(555, 390, 13),
    noseTri(500, 440, 50),
    arc(470, 480, 32, 0, PI, THIN, 8),
    arc(530, 480, 32, 0, PI, THIN, 8),
    ...whiskers(500, 470, 110),
    ellipse(500, 790, 220, 110, YELLOW),
    line(380, 880, 380, 960, { ...THICK, ...YELLOW }),
    line(620, 880, 620, 960, { ...THICK, ...YELLOW }),
    curve([720, 780], [900, 760], [860, 600], YELLOW),
    dot(860, 590, 18, "#e67e22"),
  ],

  fox: () => [
    ellipse(560, 680, 240, 130, ORANGE),
    polygon(
      [
        [320, 330],
        [500, 580],
        [680, 330],
      ],
      ORANGE,
    ),
    triEar([320, 330], [290, 150], [440, 320], ORANGE),
    triEar([560, 320], [710, 150], [680, 330], ORANGE),
    dot(430, 400, 13),
    dot(570, 400, 13),
    dot(500, 555, 16),
    polygon(
      [
        [770, 660],
        [850, 540],
        [950, 560],
        [970, 700],
        [890, 790],
        [780, 740],
      ],
      { ...THICK, ...ORANGE },
    ),
    line(900, 560, 950, 640, ORANGE),
    line(420, 800, 420, 920, { ...THICK, ...ORANGE }),
    line(520, 810, 520, 920, { ...THICK, ...ORANGE }),
    line(640, 810, 640, 920, { ...THICK, ...ORANGE }),
    line(720, 790, 720, 920, { ...THICK, ...ORANGE }),
  ],

  bee: () => [
    ellipse(520, 580, 220, 130, YELLOW),
    ...stripes(520, 580, 220, 130, [440, 520, 600], THICK),
    circle(260, 560, 75),
    dot(240, 540, 12),
    line(230, 490, 180, 400, THIN),
    line(280, 490, 290, 390, THIN),
    dot(180, 400, 8),
    dot(290, 390, 8),
    ellipse(430, 390, 100, 60, THIN),
    ellipse(610, 390, 100, 60, THIN),
    polygon(
      [
        [735, 560],
        [830, 580],
        [735, 600],
      ],
      FILL_INK,
    ),
    line(420, 700, 400, 780, THIN),
    line(520, 710, 520, 790, THIN),
    line(620, 700, 640, 780, THIN),
  ],

  ant: () => [
    circle(240, 520, 70),
    circle(400, 500, 60),
    ellipse(640, 540, 140, 100),
    dot(225, 505, 10),
    line(200, 460, 140, 360, THIN),
    line(260, 455, 280, 350, THIN),
    line(390, 550, 320, 700),
    line(410, 555, 410, 710),
    line(430, 550, 520, 700),
    line(390, 450, 330, 310),
    line(410, 445, 430, 300),
    line(430, 450, 530, 320),
    line(500, 520, 420, 520, THIN),
    line(340, 510, 310, 515, THIN),
  ],

  turtle: () => [
    arc(500, 580, 300, PI, PI * 2, THICK, 32),
    line(200, 580, 800, 580, THICK),
    polygon(
      [
        [420, 400],
        [580, 400],
        [640, 500],
        [580, 580],
        [420, 580],
        [360, 500],
      ],
      GREEN,
    ),
    line(420, 400, 380, 320, GREEN),
    line(580, 400, 620, 320, GREEN),
    line(640, 500, 740, 490, GREEN),
    line(360, 500, 260, 490, GREEN),
    ellipse(150, 560, 75, 50),
    dot(130, 545, 10),
    ellipse(300, 640, 70, 45),
    ellipse(700, 640, 70, 45),
    polygon([
      [820, 560],
      [900, 540],
      [830, 600],
    ]),
  ],

  whale: () => [
    ellipse(450, 580, 330, 170, BLUE),
    polygon(
      [
        [760, 560],
        [900, 440],
        [960, 480],
        [900, 580],
        [960, 660],
        [900, 700],
        [760, 600],
      ],
      BLUE,
    ),
    dot(240, 530, 14),
    arc(330, 640, 190, PI * 0.75, PI * 1.05, {}, 10),
    line(130, 620, 300, 650, THIN),
    line(140, 670, 320, 700, THIN),
    line(170, 720, 360, 740, THIN),
    curve([400, 400], [400, 250], [300, 220], BLUE),
    curve([400, 400], [410, 250], [520, 220], BLUE),
    dot(290, 200, 10, "#2b6cb0"),
    dot(530, 200, 10, "#2b6cb0"),
  ],

  shark: () => [
    polygon(
      [
        [120, 520],
        [300, 420],
        [560, 400],
        [760, 470],
        [880, 360],
        [900, 640],
        [760, 540],
        [560, 600],
        [300, 600],
      ],
      GREY,
    ),
    polygon(
      [
        [470, 410],
        [560, 210],
        [650, 420],
      ],
      GREY,
    ),
    polygon(
      [
        [400, 600],
        [370, 740],
        [540, 605],
      ],
      GREY,
    ),
    dot(230, 490, 12),
    zigzag(150, 545, 340, 570, 5, 24, THIN),
    arc(620, 470, 40, -PI / 2, PI / 2, THIN, 8),
    arc(660, 470, 40, -PI / 2, PI / 2, THIN, 8),
    wave(60, 940, 820, 5, 18, BLUE),
  ],

  crab: () => [
    ellipse(500, 580, 230, 140, RED),
    line(430, 450, 400, 340, RED),
    line(570, 450, 600, 340, RED),
    circle(400, 320, 28, RED),
    circle(600, 320, 28, RED),
    dot(400, 320, 10),
    dot(600, 320, 10),
    line(290, 520, 170, 400, { ...THICK, ...RED }),
    polygon(
      [
        [170, 400],
        [90, 320],
        [140, 300],
        [190, 350],
        [240, 300],
        [230, 390],
      ],
      RED,
    ),
    line(710, 520, 830, 400, { ...THICK, ...RED }),
    polygon(
      [
        [830, 400],
        [910, 320],
        [860, 300],
        [810, 350],
        [760, 300],
        [770, 390],
      ],
      RED,
    ),
    line(320, 650, 200, 760, RED),
    line(390, 690, 310, 820, RED),
    line(470, 715, 450, 850, RED),
    line(680, 650, 800, 760, RED),
    line(610, 690, 690, 820, RED),
    line(530, 715, 550, 850, RED),
    arc(500, 620, 60, 0.3, PI - 0.3, THIN, 8),
  ],

  elephant: () => [
    ellipse(580, 560, 270, 190, GREY),
    circle(270, 420, 135, GREY),
    ellipse(360, 440, 95, 130, GREY),
    curve([170, 470], [50, 640], [170, 780], { width: 12, ...GREY }),
    curve([250, 500], [120, 640], [200, 780], { width: 12, ...GREY }),
    line(220, 510, 130, 580, THICK),
    dot(230, 380, 12),
    line(420, 730, 420, 920, { width: 12, ...GREY }),
    line(530, 745, 530, 920, { width: 12, ...GREY }),
    line(660, 745, 660, 920, { width: 12, ...GREY }),
    line(770, 720, 770, 920, { width: 12, ...GREY }),
    path(
      [
        [840, 540],
        [910, 620],
        [890, 720],
      ],
      THIN,
    ),
  ],

  giraffe: () => [
    ellipse(580, 640, 220, 130, YELLOW),
    polygon(
      [
        [410, 560],
        [340, 190],
        [430, 170],
        [500, 540],
      ],
      YELLOW,
    ),
    ellipse(360, 150, 90, 55, YELLOW),
    line(330, 100, 320, 40, YELLOW),
    line(400, 100, 410, 40, YELLOW),
    dot(320, 40, 10, "#8b5a2b"),
    dot(410, 40, 10, "#8b5a2b"),
    triEar([430, 130], [480, 90], [450, 170], YELLOW),
    dot(300, 140, 10),
    ellipse(520, 600, 40, 30, { ...BROWN, fill: "#8b5a2b" }),
    ellipse(640, 660, 45, 35, { ...BROWN, fill: "#8b5a2b" }),
    ellipse(700, 580, 35, 28, { ...BROWN, fill: "#8b5a2b" }),
    ellipse(410, 350, 28, 40, { ...BROWN, fill: "#8b5a2b" }),
    line(430, 760, 430, 950, { ...THICK, ...YELLOW }),
    line(520, 770, 520, 950, { ...THICK, ...YELLOW }),
    line(650, 770, 650, 950, { ...THICK, ...YELLOW }),
    line(740, 750, 740, 950, { ...THICK, ...YELLOW }),
    line(790, 620, 860, 760, YELLOW),
  ],

  kangaroo: () => [
    ellipse(520, 580, 170, 210, BROWN),
    ellipse(380, 320, 95, 65, BROWN),
    line(430, 380, 470, 430, BROWN),
    line(320, 370, 400, 470, BROWN),
    ellipse(350, 230, 22, 60, BROWN),
    ellipse(430, 225, 22, 60, BROWN),
    dot(310, 305, 10),
    arc(520, 640, 80, 0, PI, BROWN, 12),
    path(
      [
        [400, 470],
        [330, 540],
        [360, 590],
      ],
      BROWN,
    ),
    path(
      [
        [560, 760],
        [520, 880],
        [760, 880],
      ],
      { ...THICK, ...BROWN },
    ),
    path(
      [
        [450, 740],
        [420, 880],
        [620, 880],
      ],
      { ...THICK, ...BROWN },
    ),
    curve([680, 700], [900, 660], [950, 870], { width: 12, ...BROWN }),
  ],

  penguin: () => [
    ellipse(500, 560, 210, 290, THICK),
    ellipse(500, 620, 140, 200, FILL_WHITE),
    dot(445, 330, 12),
    dot(555, 330, 12),
    polygon(
      [
        [465, 380],
        [535, 380],
        [500, 440],
      ],
      FILL_ORANGE,
    ),
    path(
      [
        [300, 440],
        [200, 680],
        [310, 660],
      ],
      THICK,
    ),
    path(
      [
        [700, 440],
        [800, 680],
        [690, 660],
      ],
      THICK,
    ),
    ellipse(430, 870, 65, 25, FILL_ORANGE),
    ellipse(570, 870, 65, 25, FILL_ORANGE),
  ],

  dolphin: () => [
    path(
      [
        ...cubicPoints([130, 560], [250, 330], [650, 330], [860, 440]),
        [930, 380],
        [960, 440],
        [900, 520],
        [960, 600],
        [900, 620],
        [840, 540],
        ...cubicPoints([840, 540], [650, 650], [300, 650], [130, 560]),
      ],
      BLUE,
    ),
    polygon(
      [
        [470, 390],
        [540, 220],
        [610, 400],
      ],
      BLUE,
    ),
    polygon(
      [
        [420, 600],
        [400, 730],
        [540, 610],
      ],
      BLUE,
    ),
    dot(270, 500, 12),
    line(150, 580, 280, 580, THIN),
    wave(60, 940, 840, 5, 18, BLUE),
  ],

  octopus: () => [
    ellipse(500, 380, 220, 200, PURPLE),
    circle(430, 400, 38, PURPLE),
    circle(570, 400, 38, PURPLE),
    dot(430, 405, 14),
    dot(570, 405, 14),
    arc(500, 470, 40, 0.3, PI - 0.3, THIN, 8),
    ...[310, 390, 460, 540, 610, 690].map((x, i) =>
      path(
        Array.from({ length: 13 }, (_, j) => {
          const t = j / 12;
          return [x + Math.sin(t * PI * 2 + i) * 40 + (x - 500) * t * 0.5, 540 + t * 380] as [
            number,
            number,
          ];
        }),
        { ...THICK, ...PURPLE },
      ),
    ),
  ],

  zebra: () => [
    ...horseBase(),
    ...stripes(580, 600, 240, 140, [440, 500, 560, 620, 680, 740], THICK),
    line(360, 320, 440, 300, THICK),
    line(375, 380, 460, 360, THICK),
    line(390, 440, 480, 420, THICK),
  ],

  camel: () => [
    ellipse(540, 640, 260, 120, BROWN),
    arc(430, 560, 100, PI, PI * 2, BROWN, 16),
    arc(650, 560, 100, PI, PI * 2, BROWN, 16),
    line(300, 600, 240, 340, BROWN),
    line(380, 560, 320, 350, BROWN),
    ellipse(260, 320, 80, 45, BROWN),
    triEar([290, 280], [310, 240], [330, 290], BROWN),
    dot(210, 310, 9),
    line(400, 750, 400, 930, { ...THICK, ...BROWN }),
    line(480, 760, 480, 930, { ...THICK, ...BROWN }),
    line(620, 760, 620, 930, { ...THICK, ...BROWN }),
    line(700, 750, 700, 930, { ...THICK, ...BROWN }),
    line(790, 620, 840, 760, BROWN),
  ],

  monkey: () => [
    circle(500, 360, 140, BROWN),
    circle(350, 360, 50, BROWN),
    circle(650, 360, 50, BROWN),
    ellipse(500, 400, 95, 70, BROWN),
    dot(455, 330, 12),
    dot(545, 330, 12),
    dot(485, 395, 6),
    dot(515, 395, 6),
    arc(500, 420, 45, 0.3, PI - 0.3, THIN, 8),
    ellipse(500, 650, 150, 170, BROWN),
    line(370, 600, 240, 760, { ...THICK, ...BROWN }),
    line(630, 600, 760, 760, { ...THICK, ...BROWN }),
    line(430, 800, 380, 930, { ...THICK, ...BROWN }),
    line(570, 800, 620, 930, { ...THICK, ...BROWN }),
    curve([640, 740], [920, 820], [860, 560], BROWN),
    arc(840, 540, 30, PI * 0.5, PI * 2, BROWN, 12),
  ],

  parrot: () => [
    ellipse(500, 560, 150, 220, GREEN),
    circle(470, 320, 100, GREEN),
    polygon(
      [
        [380, 300],
        [290, 330],
        [320, 400],
        [400, 370],
      ],
      ORANGE,
    ),
    circle(480, 300, 22),
    dot(480, 300, 9),
    ellipse(560, 560, 85, 160, GREEN),
    line(520, 770, 570, 960, GREEN),
    line(490, 780, 500, 970, GREEN),
    line(460, 780, 440, 960, GREEN),
    arc(450, 230, 40, PI, PI * 1.8, GREEN, 8),
    line(250, 800, 750, 800, THICK),
    line(460, 770, 440, 800, THIN),
    line(540, 770, 560, 800, THIN),
  ],

  flamingo: () => [
    ellipse(580, 500, 190, 110, PINK),
    path(cubicPoints([420, 450], [220, 460], [240, 230], [380, 240]), { ...THICK, ...PINK }),
    ellipse(370, 230, 65, 45, PINK),
    polygon(
      [
        [320, 240],
        [260, 320],
        [340, 260],
      ],
      FILL_INK,
    ),
    dot(360, 215, 9),
    line(560, 610, 560, 900, PINK),
    path(
      [
        [610, 600],
        [660, 750],
        [610, 900],
      ],
      PINK,
    ),
    arc(620, 480, 120, PI * 1.1, PI * 1.9, PINK, 10),
    wave(80, 920, 900, 5, 14, BLUE),
  ],

  hedgehog: () => [
    ellipse(540, 620, 300, 180, BROWN),
    ...Array.from({ length: 11 }, (_, i) => {
      const a = PI + ((i + 0.5) / 11) * PI;
      return line(
        540 + 290 * Math.cos(a),
        620 + 170 * Math.sin(a),
        540 + 380 * Math.cos(a),
        620 + 260 * Math.sin(a),
        THICK,
      );
    }),
    polygon(
      [
        [250, 640],
        [120, 710],
        [270, 740],
      ],
      BROWN,
    ),
    dot(120, 710, 12),
    dot(300, 610, 10),
    line(400, 790, 400, 860, { ...THICK, ...BROWN }),
    line(700, 790, 700, 860, { ...THICK, ...BROWN }),
  ],

  squirrel: () => [
    ellipse(450, 640, 140, 190, BROWN),
    circle(400, 400, 95, BROWN),
    triEar([340, 330], [330, 240], [400, 310], BROWN),
    triEar([420, 310], [480, 250], [470, 330], BROWN),
    dot(350, 380, 11),
    dot(310, 420, 9),
    curve([560, 790], [880, 800], [760, 460], { width: 12, ...BROWN }),
    curve([760, 460], [680, 200], [520, 280], { width: 12, ...BROWN }),
    ellipse(320, 560, 32, 42, BROWN),
    arc(320, 530, 34, PI, PI * 2, {}, 8),
    line(360, 620, 320, 560, BROWN),
    line(390, 810, 330, 860, { ...THICK, ...BROWN }),
    line(500, 820, 540, 860, { ...THICK, ...BROWN }),
  ],

  lobster: () => [
    ellipse(500, 540, 120, 190, RED),
    arc(500, 740, 110, 0.2, PI - 0.2, RED, 12),
    arc(500, 800, 95, 0.2, PI - 0.2, RED, 12),
    polygon(
      [
        [420, 860],
        [580, 860],
        [620, 940],
        [500, 910],
        [380, 940],
      ],
      RED,
    ),
    line(400, 440, 270, 330, { ...THICK, ...RED }),
    line(600, 440, 730, 330, { ...THICK, ...RED }),
    ellipse(220, 280, 75, 50, RED),
    ellipse(780, 280, 75, 50, RED),
    line(170, 260, 230, 290, RED),
    line(830, 260, 770, 290, RED),
    line(470, 360, 330, 80, THIN),
    line(530, 360, 670, 80, THIN),
    dot(465, 390, 9),
    dot(535, 390, 9),
    line(400, 560, 300, 620, RED),
    line(400, 620, 300, 690, RED),
    line(600, 560, 700, 620, RED),
    line(600, 620, 700, 690, RED),
  ],

  jellyfish: () => [
    arc(500, 430, 250, PI, PI * 2, { ...THICK, ...PINK }, 32),
    wave(250, 750, 430, 4, 22, PINK),
    ...[320, 410, 500, 590, 680].map((x, i) =>
      path(
        Array.from({ length: 13 }, (_, j) => {
          const t = j / 12;
          return [x + Math.sin(t * PI * 3 + i) * 25, 460 + t * 430] as [number, number];
        }),
        PINK,
      ),
    ),
    circle(420, 320, 20, PINK),
    circle(520, 260, 24, PINK),
    circle(600, 340, 18, PINK),
  ],

  dinosaur: () => [
    ellipse(540, 620, 250, 160, GREEN),
    line(350, 520, 220, 260, GREEN),
    line(430, 500, 300, 260, GREEN),
    ellipse(240, 230, 95, 55, GREEN),
    dot(190, 215, 10),
    polygon(
      [
        [770, 560],
        [970, 500],
        [780, 680],
      ],
      GREEN,
    ),
    ...[330, 430, 530, 630, 730].map((x) =>
      polygon(
        [
          [x - 30, 620 - 160 * Math.sqrt(Math.max(0, 1 - ((x - 30 - 540) / 250) ** 2))],
          [x, 400],
          [x + 30, 620 - 160 * Math.sqrt(Math.max(0, 1 - ((x + 30 - 540) / 250) ** 2))],
        ],
        GREEN,
      ),
    ),
    line(420, 760, 420, 920, { ...THICK, ...GREEN }),
    line(520, 775, 520, 920, { ...THICK, ...GREEN }),
    line(640, 770, 640, 920, { ...THICK, ...GREEN }),
    line(720, 750, 720, 920, { ...THICK, ...GREEN }),
  ],

  dragon: () => [
    ellipse(560, 660, 240, 140, GREEN),
    line(380, 580, 270, 400, GREEN),
    line(460, 560, 340, 400, GREEN),
    ellipse(280, 360, 100, 55, GREEN),
    dot(230, 345, 10),
    line(300, 310, 320, 230, GREEN),
    line(340, 320, 370, 250, GREEN),
    ...flame(130, 400, 170, FILL_ORANGE, {}),
    polygon(
      [
        [500, 530],
        [420, 250],
        [560, 380],
        [640, 170],
        [700, 380],
        [820, 300],
        [720, 530],
      ],
      GREEN,
    ),
    polygon(
      [
        [790, 620],
        [980, 580],
        [800, 730],
      ],
      GREEN,
    ),
    line(420, 790, 420, 920, { ...THICK, ...GREEN }),
    line(540, 800, 540, 920, { ...THICK, ...GREEN }),
    line(700, 790, 700, 920, { ...THICK, ...GREEN }),
  ],

  unicorn: () => [
    ...horseBase(),
    polygon(
      [
        [330, 210],
        [250, 60],
        [370, 200],
      ],
      FILL_YELLOW,
    ),
    zigzag(440, 250, 530, 470, 5, 30, { ...PINK, width: 8 }),
    path(
      [
        [810, 560],
        [920, 640],
        [900, 800],
      ],
      { width: 8, ...PINK },
    ),
  ],

  "teddy bear": () => [
    circle(500, 300, 150, BROWN),
    circle(390, 190, 50, BROWN),
    circle(610, 190, 50, BROWN),
    ellipse(500, 350, 70, 50, BROWN),
    dot(500, 335, 14),
    dot(450, 270, 12),
    dot(550, 270, 12),
    ellipse(500, 650, 200, 220, BROWN),
    ellipse(290, 600, 60, 130, BROWN),
    ellipse(710, 600, 60, 130, BROWN),
    ellipse(400, 870, 95, 60, BROWN),
    ellipse(600, 870, 95, 60, BROWN),
    line(500, 500, 500, 600, THIN),
    line(480, 530, 520, 530, THIN),
    line(480, 570, 520, 570, THIN),
  ],

  scarecrow: () => [
    line(500, 120, 500, 940, { ...THICK, ...BROWN }),
    line(230, 480, 770, 480, { ...THICK, ...BROWN }),
    circle(500, 250, 110, YELLOW),
    polygon([
      [340, 160],
      [660, 160],
      [600, 100],
      [560, 40],
      [440, 40],
      [400, 100],
    ]),
    dot(460, 230, 10),
    dot(540, 230, 10),
    polygon([
      [490, 260],
      [510, 260],
      [500, 290],
    ]),
    zigzag(450, 300, 550, 300, 5, 18, THIN),
    polygon([
      [380, 360],
      [620, 360],
      [660, 720],
      [340, 720],
    ]),
    line(380, 360, 230, 480),
    line(620, 360, 770, 480),
    zigzag(220, 490, 260, 540, 3, 20, YELLOW),
    zigzag(780, 490, 740, 540, 3, 20, YELLOW),
    zigzag(360, 730, 420, 800, 3, 20, YELLOW),
    zigzag(640, 730, 580, 800, 3, 20, YELLOW),
  ],
};
