/**
 * Curated backgrounds (spec §8): soft gradients and abstract shapes built from CSS only.
 * Each has a light and a dark variant. Ids match `BACKGROUNDS` in @doloop/core.
 * The average luminance of each variant is documented so glass fills stay legible;
 * the contrast audit script (scripts/contrast-audit.mjs) verifies text on glass and panel.
 */

export interface BackgroundVariant {
  /** CSS `background` shorthand value. */
  css: string;
  /** Approximate average luminance 0..1, used to pick text colour on glass. */
  luminance: number;
}

export interface BackgroundDef {
  id: string;
  name: string;
  light: BackgroundVariant;
  dark: BackgroundVariant;
}

const glow = (x: string, y: string, color: string, size = '60%') =>
  `radial-gradient(${size} ${size} at ${x} ${y}, ${color}, transparent 70%)`;

export const BACKGROUND_DEFS: BackgroundDef[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    light: {
      css: [
        glow('15%', '20%', 'hsl(215 90% 78% / 0.9)'),
        glow('85%', '25%', 'hsl(275 80% 82% / 0.85)'),
        glow('50%', '90%', 'hsl(340 85% 84% / 0.8)'),
        'linear-gradient(160deg, #dfe6f6 0%, #eee4f3 50%, #f6e3ea 100%)',
      ].join(', '),
      luminance: 0.82,
    },
    dark: {
      css: [
        glow('15%', '20%', 'hsl(220 80% 40% / 0.75)'),
        glow('85%', '25%', 'hsl(275 70% 40% / 0.7)'),
        glow('50%', '90%', 'hsl(340 70% 45% / 0.55)'),
        'linear-gradient(160deg, #0b0d1a 0%, #141030 50%, #1c1024 100%)',
      ].join(', '),
      luminance: 0.09,
    },
  },
  {
    id: 'dusk',
    name: 'Dusk',
    light: {
      css: [
        glow('20%', '80%', 'hsl(25 95% 80% / 0.9)'),
        glow('80%', '20%', 'hsl(260 70% 82% / 0.8)'),
        'linear-gradient(180deg, #e7e2f4 0%, #f7e2d6 100%)',
      ].join(', '),
      luminance: 0.84,
    },
    dark: {
      css: [
        glow('20%', '85%', 'hsl(20 85% 45% / 0.6)'),
        glow('80%', '15%', 'hsl(260 60% 40% / 0.7)'),
        'linear-gradient(180deg, #0f0c1c 0%, #241119 100%)',
      ].join(', '),
      luminance: 0.08,
    },
  },
  {
    id: 'glacier',
    name: 'Glacier',
    light: {
      css: [
        glow('30%', '30%', 'hsl(195 90% 85% / 0.9)', '70%'),
        glow('80%', '80%', 'hsl(210 80% 90% / 0.9)', '60%'),
        'linear-gradient(135deg, #e6f2fb 0%, #eef5fa 100%)',
      ].join(', '),
      luminance: 0.9,
    },
    dark: {
      css: [
        glow('30%', '30%', 'hsl(200 80% 35% / 0.6)', '70%'),
        glow('80%', '80%', 'hsl(215 70% 30% / 0.6)', '60%'),
        'linear-gradient(135deg, #07111c 0%, #0b1a29 100%)',
      ].join(', '),
      luminance: 0.07,
    },
  },
  {
    id: 'meadow',
    name: 'Meadow',
    light: {
      css: [
        glow('20%', '70%', 'hsl(120 55% 80% / 0.9)', '70%'),
        glow('80%', '20%', 'hsl(80 70% 84% / 0.9)', '60%'),
        'linear-gradient(160deg, #e8f4e6 0%, #f0f6e2 100%)',
      ].join(', '),
      luminance: 0.88,
    },
    dark: {
      css: [
        glow('20%', '70%', 'hsl(140 50% 30% / 0.6)', '70%'),
        glow('80%', '20%', 'hsl(90 50% 30% / 0.55)', '60%'),
        'linear-gradient(160deg, #08120b 0%, #0f1a0c 100%)',
      ].join(', '),
      luminance: 0.07,
    },
  },
  {
    id: 'ember',
    name: 'Ember',
    light: {
      css: [
        glow('25%', '25%', 'hsl(15 95% 82% / 0.9)', '65%'),
        glow('75%', '75%', 'hsl(45 95% 82% / 0.9)', '65%'),
        'linear-gradient(135deg, #fbe7df 0%, #fbeed8 100%)',
      ].join(', '),
      luminance: 0.86,
    },
    dark: {
      css: [
        glow('25%', '25%', 'hsl(15 85% 40% / 0.65)', '65%'),
        glow('75%', '75%', 'hsl(40 85% 40% / 0.5)', '65%'),
        'linear-gradient(135deg, #160a08 0%, #1c1108 100%)',
      ].join(', '),
      luminance: 0.08,
    },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    light: {
      css: [
        glow('50%', '0%', 'hsl(220 10% 92% / 1)', '80%'),
        'linear-gradient(180deg, #e9ebef 0%, #dfe2e8 100%)',
      ].join(', '),
      luminance: 0.85,
    },
    dark: {
      css: [
        glow('50%', '0%', 'hsl(220 8% 22% / 1)', '80%'),
        'linear-gradient(180deg, #111318 0%, #0a0b0f 100%)',
      ].join(', '),
      luminance: 0.06,
    },
  },
  {
    id: 'tide',
    name: 'Tide',
    light: {
      css: [
        'repeating-linear-gradient(100deg, transparent 0 60px, hsl(200 80% 60% / 0.06) 60px 61px)',
        glow('10%', '90%', 'hsl(190 90% 78% / 0.95)', '80%'),
        glow('90%', '10%', 'hsl(230 80% 86% / 0.9)', '70%'),
        'linear-gradient(200deg, #e2eefb 0%, #dcf1f5 100%)',
      ].join(', '),
      luminance: 0.86,
    },
    dark: {
      css: [
        'repeating-linear-gradient(100deg, transparent 0 60px, hsl(200 80% 70% / 0.05) 60px 61px)',
        glow('10%', '90%', 'hsl(190 80% 30% / 0.7)', '80%'),
        glow('90%', '10%', 'hsl(230 70% 35% / 0.6)', '70%'),
        'linear-gradient(200deg, #061019 0%, #071a1f 100%)',
      ].join(', '),
      luminance: 0.07,
    },
  },
  {
    id: 'nebula',
    name: 'Nebula',
    light: {
      css: [
        glow('30%', '40%', 'hsl(290 80% 80% / 0.9)', '55%'),
        glow('70%', '60%', 'hsl(200 90% 80% / 0.9)', '55%'),
        glow('50%', '10%', 'hsl(330 90% 85% / 0.8)', '50%'),
        'linear-gradient(135deg, #ece2f6 0%, #e0e9f8 100%)',
      ].join(', '),
      luminance: 0.83,
    },
    dark: {
      css: [
        glow('30%', '40%', 'hsl(290 70% 38% / 0.75)', '55%'),
        glow('70%', '60%', 'hsl(200 80% 35% / 0.7)', '55%'),
        glow('50%', '10%', 'hsl(330 80% 40% / 0.5)', '50%'),
        'linear-gradient(135deg, #0d0716 0%, #06101c 100%)',
      ].join(', '),
      luminance: 0.08,
    },
  },
  {
    id: 'prism',
    name: 'Prism',
    light: {
      css: [
        'conic-gradient(from 210deg at 70% 30%, hsl(0 90% 88% / 0.8), hsl(60 90% 88% / 0.8), hsl(120 70% 88% / 0.8), hsl(200 90% 88% / 0.8), hsl(280 80% 90% / 0.8), hsl(0 90% 88% / 0.8))',
        'linear-gradient(180deg, #f1f1f6 0%, #e9ecf4 100%)',
      ].join(', '),
      luminance: 0.87,
    },
    dark: {
      css: [
        'conic-gradient(from 210deg at 70% 30%, hsl(0 70% 30% / 0.55), hsl(60 70% 30% / 0.5), hsl(120 60% 28% / 0.5), hsl(200 80% 32% / 0.55), hsl(280 70% 32% / 0.55), hsl(0 70% 30% / 0.55))',
        'linear-gradient(180deg, #0c0c14 0%, #0a0a12 100%)',
      ].join(', '),
      luminance: 0.09,
    },
  },
  {
    id: 'monolith',
    name: 'Monolith',
    light: {
      css: [
        'linear-gradient(115deg, transparent 0 55%, hsl(220 15% 82% / 0.6) 55% 100%)',
        glow('20%', '30%', 'hsl(220 20% 96% / 1)', '60%'),
        'linear-gradient(180deg, #e4e7ee 0%, #d9dde6 100%)',
      ].join(', '),
      luminance: 0.84,
    },
    dark: {
      css: [
        'linear-gradient(115deg, transparent 0 55%, hsl(220 15% 12% / 0.9) 55% 100%)',
        glow('20%', '30%', 'hsl(220 15% 18% / 1)', '60%'),
        'linear-gradient(180deg, #0c0e13 0%, #07080c 100%)',
      ].join(', '),
      luminance: 0.05,
    },
  },
];

export function backgroundById(id: string): BackgroundDef {
  return BACKGROUND_DEFS.find((b) => b.id === id) ?? BACKGROUND_DEFS[0]!;
}
