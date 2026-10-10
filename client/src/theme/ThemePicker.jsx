// UI chooser: the 20 presets as a vertical LIST in a drawer on the RIGHT.
// Each row = colour swatch + name + menu/style tags. Clicking a row switches the whole app at once.
import { useState } from 'react';
import { Button, List, Space, Tag, Typography } from 'antd';
import { Drawer } from 'antd/es/index.js'; // real antd Drawer — not the preset-aware wrapper in ui/antd.jsx
import { BgColorsOutlined, CheckCircleFilled } from '@ant-design/icons';
import { THEME_KEYS, THEMES, styleTags } from './themes.js';
import { useUiTheme } from './uiContext.js';

function Swatch({ colors }) {
  return (
    <span className="theme-swatch" aria-hidden="true">
      {colors.map((c) => <span key={c} style={{ background: c }} />)}
    </span>
  );
}

export default function ThemePicker({ showLabel = true, type = 'text' }) {
  const { themeKey, theme, setThemeKey } = useUiTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type={type} icon={<BgColorsOutlined />} onClick={() => setOpen(true)} aria-label={`UI: ${theme.name}. Change UI`} title="Change UI">
        {showLabel && theme.name}
      </Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        placement="right"
        width={Math.min(380, window.innerWidth)}
        title="Rang chuniye"
        className="theme-drawer"
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
          Chunte hi turant lag jayega. Save <Tag>Ctrl + S</Tag> se bhi hota hai. Pasand isi browser mein yaad rahegi.
        </Typography.Paragraph>
        <List
          itemLayout="horizontal"
          dataSource={THEME_KEYS}
          renderItem={(k, i) => {
            const t = THEMES[k];
            const active = k === themeKey;
            return (
              <List.Item
                onClick={() => setThemeKey(k)}
                className={`theme-row${active ? ' theme-row-active' : ''}`}
              >
                <List.Item.Meta
                  avatar={<Swatch colors={t.swatch} />}
                  title={(
                    <Space size={6}>
                      <span>{i + 1}. {t.name}</span>
                      {t.dark && <Tag color="default" style={{ marginInlineEnd: 0 }}>Dark</Tag>}
                      {active && <CheckCircleFilled style={{ color: 'var(--accent)' }} aria-label="Current UI" />}
                    </Space>
                  )}
                  description={(
                    <Space size={[4, 4]} wrap>
                      {styleTags(t.layout).map((tag) => (
                        <Tag key={tag} color={tag.startsWith('Menu:') ? 'blue' : undefined} style={{ marginInlineEnd: 0 }}>{tag}</Tag>
                      ))}
                    </Space>
                  )}
                />
              </List.Item>
            );
          }}
        />
      </Drawer>
    </>
  );
}
