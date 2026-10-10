// The chosen UI preset (one of the 20 in themes.js), remembered in this browser. Sets the CSS variables and data
// attributes on <html> (styles.css uses them), gives Ant Design its theme and size, and adds Ctrl+S = Save.
import { useEffect, useMemo, useState } from 'react';
import { ConfigProvider } from 'antd/es/index.js';
import { DEFAULT_THEME, THEMES } from './themes.js';
import { UiContext, useUiTheme } from './uiContext.js';

const STORAGE_KEY = 'ramas.uiTheme';

function loadKey() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && THEMES[v] ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Ctrl+S (Cmd+S): press the Save button of the open form — the top-most drawer / popup first, else the page. */
function saveShortcut(e) {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
  e.preventDefault();
  const visible = (el) => el.offsetParent !== null && !el.disabled;
  const layers = [...document.querySelectorAll('.ant-drawer-open .ant-drawer-content, .ant-modal-wrap:not([style*="display: none"]) .ant-modal-content')];
  const scopes = [...layers.reverse(), document];
  for (const scope of scopes) {
    const btn = [...scope.querySelectorAll('.save-action')].find(visible);
    if (btn) { btn.click(); return; }
  }
}

export function UiThemeProvider({ children }) {
  const [themeKey, setThemeKey] = useState(loadKey);
  const theme = THEMES[themeKey];

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, themeKey); } catch { /* private window: keep it for this visit only */ }
    const root = document.documentElement;
    root.dataset.uiTheme = themeKey;
    root.style.colorScheme = theme.dark ? 'dark' : 'light';
    for (const [k, v] of Object.entries(theme.css)) root.style.setProperty(`--${k}`, v);
    const l = theme.layout;
    Object.assign(root.dataset, { uiNav: l.nav, uiSave: l.save, uiTable: l.table, uiCard: l.card, uiEditor: l.editor, uiSize: l.size });
  }, [themeKey, theme]);

  useEffect(() => {
    window.addEventListener('keydown', saveShortcut);
    return () => window.removeEventListener('keydown', saveShortcut);
  }, []);

  const value = useMemo(() => ({ themeKey, theme, setThemeKey }), [themeKey, theme]);
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export { useUiTheme };

/** ConfigProvider with the chosen preset's Ant Design theme and size. */
export function ThemedConfig({ children, ...rest }) {
  const { theme } = useUiTheme();
  return <ConfigProvider {...rest} theme={theme.antd} componentSize={theme.layout.size}>{children}</ConfigProvider>;
}
