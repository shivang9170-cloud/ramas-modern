// The chosen UI preset, shared without importing antd (ui/antd.jsx wraps antd and reads this — no import cycle).
import { createContext, useContext } from 'react';
import { DEFAULT_THEME, THEMES } from './themes.js';

export const UiContext = createContext({ themeKey: DEFAULT_THEME, theme: THEMES[DEFAULT_THEME], setThemeKey: () => {} });

export const useUiTheme = () => useContext(UiContext);
export const useUiLayout = () => useContext(UiContext).theme.layout;
