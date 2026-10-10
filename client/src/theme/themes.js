// The 21 UI presets (Desktop Green first + 20). Each one changes not only the colours but how the app works:
//   nav        where the menu is:            left | right | top
//   labels     where a field's label sits:   top | left | left-right (left of the box, right-aligned)
//   columns    how many boxes per line:      as-is | wide (bigger boxes, fewer per line) | single (one per line)
//                                            | dense (more per line)
//   editor     where a new / edit form opens: drawer-right | drawer-left | drawer-bottom | modal | fullscreen
//   save       where the Save button sits:   header | footer | both | float (a floating button)
//   confirm    ask "Save karein?" before saving
//   size       small | middle | large (text boxes, buttons, tables)
//   table      plain | bordered | striped;  card: outlined | shadow | accent (coloured top edge) | flat
// (ui/antd.jsx applies them to every page; theme/ThemeContext.jsx sets the colours and CSS variables.)
import { theme as antdTheme } from 'antd/es/index.js';

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// ---- colour palettes --------------------------------------------------------------------------------------------
// Each palette: primary + a coordinated set. light/dark pick the algorithm; sider* are the dark menu colours; appBg is
// the page background, cardBg the surface. accentGlow drives the soft ring on hover/focus and the login sheen.
const P = {
  blue: { primary: '#2563eb', sider: '#0b1f3a', siderSub: '#081729', siderSel: '#1d4ed8', appBg: '#eef2f7', cardBg: '#ffffff', headerBorder: '#e4e9f0', logo: '#ffffff', login: 'linear-gradient(140deg, #0b1f3a 0%, #1e3a8a 55%, #2563eb 100%)' },
  night: { primary: '#60a5fa', sider: '#0a0f1a', siderSub: '#060a12', siderSel: '#1e3a8a', appBg: '#0a0e16', cardBg: '#141b26', headerBg: '#111826', headerBorder: '#232c3b', logo: '#dbeafe', dark: true, login: 'linear-gradient(140deg, #060a12 0%, #111826 55%, #1e3a8a 100%)' },
  green: { primary: '#16a34a', light: true, selBg: '#dcfce7', hoverBg: '#f0fdf4', appBg: '#f1f8f3', cardBg: '#ffffff', headerBorder: '#dcebe0', logo: '#15803d', siderBorder: '#e3eee6', login: 'linear-gradient(140deg, #064e3b 0%, #15803d 55%, #4ade80 100%)' },
  maroon: { primary: '#be123c', sider: '#3f0a18', siderSub: '#2c0710', siderSel: '#9f1239', appBg: '#f9f4f4', cardBg: '#ffffff', headerBorder: '#efe0e3', logo: '#ffe4e6', login: 'linear-gradient(140deg, #3f0a18 0%, #9f1239 55%, #e11d48 100%)' },
  teal: { primary: '#0d9488', sider: '#052e2b', siderSub: '#031f1d', siderSel: '#0f766e', appBg: '#eef6f5', cardBg: '#ffffff', headerBorder: '#d6e9e6', logo: '#ccfbf1', login: 'linear-gradient(140deg, #052e2b 0%, #0f766e 55%, #2dd4bf 100%)' },
  orange: { primary: '#ea580c', sider: '#3a1206', siderSub: '#280c04', siderSel: '#c2410c', appBg: '#fbf5f0', cardBg: '#ffffff', headerBorder: '#f1e2d6', logo: '#ffedd5', login: 'linear-gradient(140deg, #3a1206 0%, #c2410c 55%, #fb923c 100%)' },
  purple: { primary: '#7c3aed', sider: '#241046', siderSub: '#180a30', siderSel: '#6d28d9', appBg: '#f5f3fb', cardBg: '#ffffff', headerBorder: '#e6e0f5', logo: '#ede9fe', login: 'linear-gradient(140deg, #241046 0%, #6d28d9 55%, #a78bfa 100%)' },
  slate: { primary: '#475569', sider: '#0f172a', siderSub: '#020617', siderSel: '#334155', appBg: '#eef1f5', cardBg: '#ffffff', headerBorder: '#e2e8f0', logo: '#e2e8f0', login: 'linear-gradient(140deg, #0f172a 0%, #334155 55%, #64748b 100%)' },
  forest: { primary: '#34d399', sider: '#06120d', siderSub: '#030a06', siderSel: '#065f46', appBg: '#07120d', cardBg: '#0f1d16', headerBg: '#0d1a13', headerBorder: '#1c3327', logo: '#a7f3d0', dark: true, login: 'linear-gradient(140deg, #030a06 0%, #065f46 55%, #34d399 100%)' },
  sky: { primary: '#0284c7', light: true, selBg: '#e0f2fe', hoverBg: '#f0f9ff', appBg: '#eef6fc', cardBg: '#ffffff', headerBorder: '#d7e9f5', logo: '#0369a1', siderBorder: '#dcebf5', login: 'linear-gradient(140deg, #0c4a6e 0%, #0284c7 55%, #38bdf8 100%)' },
  indigo: { primary: '#4f46e5', light: true, selBg: '#e0e7ff', hoverBg: '#eef2ff', appBg: '#f3f4fd', cardBg: '#ffffff', headerBorder: '#e2e2f6', logo: '#4338ca', siderBorder: '#e6e6f8', login: 'linear-gradient(140deg, #312e81 0%, #4f46e5 55%, #818cf8 100%)' },
  midnight: { primary: '#a78bfa', sider: '#0d0a1c', siderSub: '#070510', siderSel: '#4c1d95', appBg: '#0b0912', cardBg: '#17132a', headerBg: '#141028', headerBorder: '#2a2445', logo: '#ddd6fe', dark: true, login: 'linear-gradient(140deg, #070510 0%, #4c1d95 55%, #a78bfa 100%)' },
  // Desktop Green: a desktop-application look — dark-green menu bar, green toolbar, mint windows on a lined dark-green desk
  desktopgreen: { primary: '#166534', sider: '#0b3d2b', siderSub: '#082e20', siderSel: '#1b7a4b', appBg: '#0f3d2a', cardBg: '#b9dcc7', headerBg: '#9fcfb2',
    container: '#c4e4d0', elevated: '#b9dcc7', headerBorder: '#0b3d2b', logo: '#dcfce7', login: 'repeating-linear-gradient(45deg, #0b3d2b 0 2px, #0f4a33 2px 12px)' },
  // ---- new premium palettes ----
  aurora: { primary: '#6366f1', light: true, selBg: '#e8e9ff', hoverBg: '#f1f1ff', appBg: '#f4f5fb', cardBg: '#ffffff', headerBorder: '#e6e7f5', logo: '#4f46e5', siderBorder: '#ececfa', login: 'linear-gradient(140deg, #4338ca 0%, #7c3aed 45%, #ec4899 100%)' },
  obsidian: { primary: '#818cf8', sider: '#0b0d12', siderSub: '#06080c', siderSel: '#312e81', appBg: '#0b0e14', cardBg: '#151a23', headerBg: '#121722', headerBorder: '#242b38', logo: '#c7d2fe', dark: true, login: 'linear-gradient(140deg, #06080c 0%, #1e293b 55%, #4338ca 100%)' },
  emerald: { primary: '#059669', light: true, selBg: '#d1fae5', hoverBg: '#ecfdf5', appBg: '#eff7f3', cardBg: '#ffffff', headerBorder: '#d9ece4', logo: '#047857', siderBorder: '#e1efe9', login: 'linear-gradient(140deg, #064e3b 0%, #059669 55%, #6ee7b7 100%)' },
  sunset: { primary: '#e11d48', light: true, selBg: '#ffe4e6', hoverBg: '#fff1f2', appBg: '#fdf3f1', cardBg: '#ffffff', headerBorder: '#f3dcd9', logo: '#be123c', siderBorder: '#f6e0dc', login: 'linear-gradient(140deg, #9f1239 0%, #e11d48 45%, #fb923c 100%)' },
  graphite: { primary: '#f59e0b', sider: '#18181b', siderSub: '#0c0c0e', siderSel: '#3f3f46', appBg: '#101013', cardBg: '#1b1b1f', headerBg: '#19191d', headerBorder: '#2b2b31', logo: '#fde68a', dark: true, login: 'linear-gradient(140deg, #09090b 0%, #27272a 55%, #b45309 100%)' },
  cyan: { primary: '#0891b2', light: true, selBg: '#cffafe', hoverBg: '#ecfeff', appBg: '#eef7fa', cardBg: '#ffffff', headerBorder: '#d5eaf0', logo: '#0e7490', siderBorder: '#ddeef3', login: 'linear-gradient(140deg, #164e63 0%, #0891b2 55%, #22d3ee 100%)' },
  lime: { primary: '#65a30d', light: true, selBg: '#ecfccb', hoverBg: '#f7fee7', appBg: '#f5f8ee', cardBg: '#ffffff', headerBorder: '#e4edcf', logo: '#4d7c0f', siderBorder: '#e9f0da', login: 'linear-gradient(140deg, #365314 0%, #65a30d 55%, #a3e635 100%)' },
  rose: { primary: '#db2777', light: true, selBg: '#fce7f3', hoverBg: '#fdf2f8', appBg: '#fcf1f6', cardBg: '#ffffff', headerBorder: '#f2dce8', logo: '#be185d', siderBorder: '#f6e0ec', login: 'linear-gradient(140deg, #831843 0%, #db2777 55%, #f9a8d4 100%)' },
};

function shadows(dark) {
  if (dark) {
    return {
      boxShadow: '0 1px 2px rgba(0,0,0,.4), 0 2px 8px rgba(0,0,0,.35)',
      boxShadowSecondary: '0 6px 20px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.4)',
      boxShadowTertiary: '0 1px 2px rgba(0,0,0,.35)',
    };
  }
  return {
    boxShadow: '0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.08)',
    boxShadowSecondary: '0 8px 24px rgba(16,24,40,.09), 0 3px 8px rgba(16,24,40,.06)',
    boxShadowTertiary: '0 1px 2px rgba(16,24,40,.05)',
  };
}

function buildAntd(p, size, radius) {
  const algorithm = [p.dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm];
  if (size === 'small') algorithm.push(antdTheme.compactAlgorithm);
  const fontSize = size === 'small' ? 13 : size === 'large' ? 15 : 14;
  // boxes / popups: white unless the palette names its own surface (Desktop Green has no white anywhere)
  const container = p.container ?? (p.dark ? p.cardBg : '#ffffff');
  const elevated = p.elevated ?? (p.dark ? (p.headerBg ?? p.cardBg) : '#ffffff');
  const layout = p.light
    ? { siderBg: '#ffffff', headerBg: 'rgba(255,255,255,0.8)', triggerBg: p.selBg, triggerColor: p.primary, bodyBg: p.appBg }
    : { siderBg: p.sider, headerBg: p.headerBg ?? '#111826', triggerBg: p.siderSub, bodyBg: p.appBg };
  const menu = p.light
    ? { itemSelectedBg: p.selBg, itemSelectedColor: p.primary, itemHoverBg: p.hoverBg, subMenuItemBg: 'transparent', itemBorderRadius: 10, itemMarginInline: 8, itemHeight: 42 }
    : { darkItemBg: 'transparent', darkSubMenuItemBg: 'transparent', darkItemSelectedBg: p.siderSel ?? p.primary, darkItemHoverBg: 'rgba(255,255,255,0.08)', darkPopupBg: p.sider, itemBorderRadius: 10, itemMarginInline: 8, itemHeight: 42 };
  return {
    algorithm,
    token: {
      colorPrimary: p.primary,
      colorInfo: p.primary,
      colorLink: p.primary,
      borderRadius: radius,
      borderRadiusLG: radius + 4,
      borderRadiusSM: Math.max(radius - 2, 2),
      fontSize,
      fontFamily: FONT,
      wireframe: false,
      colorBgLayout: p.appBg,
      colorBgContainer: container,
      colorBgElevated: elevated,
      controlOutlineWidth: 3,
      lineWidthFocus: 3,
      motionDurationMid: '0.18s',
      ...shadows(Boolean(p.dark)),
    },
    components: {
      Layout: layout,
      Menu: menu,
      Card: { paddingLG: 20, borderRadiusLG: radius + 4, boxShadowTertiary: shadows(Boolean(p.dark)).boxShadow },
      Button: { fontWeight: 500, primaryShadow: 'none', defaultShadow: 'none', controlHeight: 36 },
      Table: { headerBg: p.dark ? 'rgba(255,255,255,0.03)' : '#f7f9fc', headerColor: p.dark ? undefined : '#475467', headerSplitColor: 'transparent', borderColor: p.dark ? 'rgba(255,255,255,0.08)' : '#eef1f5', rowHoverBg: p.dark ? 'rgba(255,255,255,0.04)' : (p.hoverBg ?? '#f5f8fc'), cellPaddingBlock: 10 },
      Input: { activeShadow: `0 0 0 3px ${p.primary}22` },
      Select: { controlHeight: 36 },
      Tabs: { horizontalItemGutter: 24, titleFontSize: fontSize },
      Segmented: { borderRadius: radius, trackPadding: 3 },
      Modal: { borderRadiusLG: radius + 6 },
      Drawer: {},
    },
  };
}

function cssFor(p) {
  const container = p.container ?? (p.dark ? p.cardBg : '#ffffff');
  return {
    'app-bg': p.appBg,
    'card-bg': container,
    'header-bg': p.light ? 'rgba(255,255,255,0.72)' : `${(p.headerBg ?? p.sider)}cc`,
    'header-border': p.headerBorder ?? '#e6e9ef',
    'logo-color': p.logo ?? '#ffffff',
    accent: p.primary,
    'accent-soft': `${p.primary}1f`,
    'login-bg': p.login,
    'sider-bg': p.light ? '#ffffff' : p.sider,
    'menu-letter-bg': p.light ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.14)',
    'group-title': p.light ? 'rgba(0, 0, 0, 0.42)' : 'rgba(255, 255, 255, 0.5)',
    'sider-border': p.siderBorder ?? 'transparent',
    stripe: p.dark ? 'rgba(255, 255, 255, 0.035)' : 'rgba(15, 23, 42, 0.022)',
    shadow: p.dark ? '0 8px 24px rgba(0,0,0,.45)' : '0 8px 24px rgba(16,24,40,.09)',
    'shadow-sm': p.dark ? '0 1px 2px rgba(0,0,0,.4)' : '0 1px 3px rgba(16,24,40,.08)',
  };
}

// ---- the themes --------------------------------------------------------------------------------------------------
// WHERE things are is the same in every theme (user's choice 2026-10-09: "sab theme me location pehle theme jaisi"):
// the Desktop Green layout — menu bar on top, caption strip above each box with the boxes joined in a grid, more boxes per
// line, forms open as a centred window, Save at the bottom, status bar at the bottom of the screen (and Docket Entry's
// charges + Save bar). Each theme keeps only its own DESIGN: colours, corner roundness, card / table style, size.
// POSITIONS is applied last, so a preset cannot move anything.
const POSITIONS = {
  nav: 'top', labels: 'grid', columns: 'dense', editor: 'modal', save: 'footer', confirm: false, statusBar: true,
};
// defaults for the *visual* knobs (a theme may override any of these)
const BASE_STYLE = { size: 'middle', table: 'plain', card: 'shadow', radius: 10 };

// [key, name, palette, description, visualStyle]. (The `nav` values below are from before 2026-10-09 and are overridden by
// POSITIONS — kept so the earlier menu variety can be brought back by dropping POSITIONS.nav.)
const PRESETS = [
  // ---- the house theme, first in the list (user's choice 2026-10-08): looks and works like a desktop application —
  // menu bar + toolbar on top, every page a window with a title bar, forms open as dialog windows, labels left of the
  // boxes and the boxes joined edge to edge in a grid, bevelled buttons, status bar at the bottom; green + dark green.
  // The look is in styles.css ([data-ui-theme="desktop-green"]); labels 'grid' is in ui/antd.jsx. ----
  ['desktop-green', 'Desktop Green', 'desktopgreen', 'Desktop software look: menu bar, windows, joined boxes, status bar — green',
    { nav: 'top', labels: 'grid', columns: 'dense', editor: 'modal', radius: 0, size: 'small', card: 'outlined', table: 'bordered', statusBar: true }],
  // ---- 7 LEFT-menu themes (menu baayein) ----
  ['aurora', 'Aurora', 'aurora', 'Soft, airy indigo with big rounded cards', { nav: 'left', radius: 16 }],
  ['classic', 'Classic Blue', 'blue', 'Professional blue, crisp bordered cards', { nav: 'left', radius: 6, card: 'outlined', table: 'bordered' }],
  ['indigo', 'Indigo', 'indigo', 'Bright indigo, rounded and clean', { nav: 'left', radius: 12 }],
  ['emerald', 'Emerald', 'emerald', 'Light green with a coloured card top', { nav: 'left', radius: 10, card: 'accent', table: 'striped' }],
  ['maroon', 'Maroon', 'maroon', 'Formal maroon, bordered cards', { nav: 'left', radius: 6, card: 'outlined', table: 'bordered' }],
  ['obsidian', 'Obsidian', 'obsidian', 'Deep calm dark, soft shadows', { nav: 'left', radius: 12 }],
  ['slate', 'Slate Compact', 'slate', 'Neutral grey, compact and dense', { nav: 'left', radius: 6, size: 'small', card: 'outlined', table: 'bordered' }],
  // ---- 7 TOP-menu themes (menu upar) ----
  ['teal', 'Teal', 'teal', 'Calm teal, soft shadows', { nav: 'top', radius: 10 }],
  ['sky', 'Sky', 'sky', 'Light sky blue, striped tables', { nav: 'top', radius: 12, table: 'striped' }],
  ['fresh', 'Fresh Green', 'green', 'Fresh green, large and comfortable', { nav: 'top', radius: 12, size: 'large' }],
  ['amber', 'Amber', 'orange', 'Warm orange, coloured card top', { nav: 'top', radius: 8, card: 'accent', table: 'striped' }],
  ['cyan', 'Cyan', 'cyan', 'Cool cyan, clean and bright', { nav: 'top', radius: 10 }],
  ['night', 'Night Blue', 'night', 'Blue on black, soft shadows', { nav: 'top', radius: 8 }],
  ['midnight', 'Midnight', 'midnight', 'Purple on black, rounded', { nav: 'top', radius: 14 }],
  // ---- 6 RIGHT-menu themes (menu daayein) ----
  ['royal', 'Royal Purple', 'purple', 'Rich purple with a coloured card top', { nav: 'right', radius: 10, card: 'accent' }],
  ['sunset', 'Sunset', 'sunset', 'Warm rose-amber, very rounded', { nav: 'right', radius: 18 }],
  ['rose', 'Rose', 'rose', 'Bright rose-pink, rounded cards', { nav: 'right', radius: 12 }],
  ['lime', 'Lime', 'lime', 'Fresh lime green, striped tables', { nav: 'right', radius: 10, table: 'striped' }],
  ['forest', 'Forest', 'forest', 'Green on black, striped tables', { nav: 'right', radius: 10, table: 'striped' }],
  ['graphite', 'Graphite Gold', 'graphite', 'Sharp dark graphite, flat and dense', { nav: 'right', radius: 4, size: 'small', card: 'flat', table: 'bordered' }],
];

export const THEMES = Object.fromEntries(PRESETS.map(([key, name, pal, description, style]) => {
  const p = P[pal];
  const layout = { ...BASE_STYLE, ...style, ...POSITIONS };
  return [key, {
    key,
    name,
    description,
    dark: Boolean(p.dark),
    menuTheme: p.light ? 'light' : 'dark',
    swatch: [p.light ? '#ffffff' : p.sider, p.primary, p.appBg],
    layout,
    antd: buildAntd(p, layout.size, layout.radius),
    css: cssFor(p),
  }];
}));

export const THEME_KEYS = Object.keys(THEMES);
export const DEFAULT_THEME = 'desktop-green';

// Short style tags for the chooser: the theme's visual personality (positions are the same in every theme).
export function styleTags(l) {
  return [
    (l.radius >= 14 ? 'Zyada rounded' : l.radius <= 6 ? 'Sharp corners' : 'Rounded'),
    { shadow: 'Soft shadow', outlined: 'Bordered cards', accent: 'Coloured top', flat: 'Flat cards' }[l.card],
    { striped: 'Striped table', bordered: 'Bordered table', plain: null }[l.table],
    { small: 'Compact', large: 'Large', middle: null }[l.size],
  ].filter(Boolean);
}
