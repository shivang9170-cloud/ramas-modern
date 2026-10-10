// Replaces IOS.master (sidebar menu + header) and User_LoginInfo.ascx (branch switcher).
import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { App, Button, Dropdown, Grid, Input, Layout, Menu, Select, Space, Tag, Typography } from 'antd';
import {
  AppstoreOutlined, BarChartOutlined, CarOutlined, DatabaseOutlined, DollarOutlined, FileTextOutlined, FileWordOutlined,
  KeyOutlined, LogoutOutlined, RiseOutlined, SearchOutlined, SettingOutlined, TeamOutlined, ToolOutlined,
  UserOutlined, WalletOutlined,
} from '@ant-design/icons';
import { api, errorMessage } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { resolveLegacyUrl } from '../routes/legacyRoutes.js';
import { useUiTheme } from '../theme/ThemeContext.jsx';
import ThemePicker from '../theme/ThemePicker.jsx';

const { Header, Sider, Content } = Layout;

function toMenuItems(nodes, parentKey = '') {
  return nodes.map((n) => {
    const key = `${parentKey}${n.id}`;
    if (n.children?.length) {
      return { key, label: n.name, children: toMenuItems(n.children, `${key}/`) };
    }
    const to = resolveLegacyUrl(n.url);
    return { key, label: n.name, to, title: n.name };
  });
}

// Icons for top-level menus (MasterMenu names come from the DB). Needed so the
// collapsed icon rail stays usable; unknown names fall back to their first letter.
const MENU_ICONS = [
  [/MASTER/, DatabaseOutlined],
  [/OPERATION|TMS/, CarOutlined],
  [/REPORT|MIS/, BarChartOutlined],
  [/ADMIN/, SettingOutlined],
  [/ACCOUNT|CASH/, WalletOutlined],
  [/HRM|HR\b|EMPLOYEE/, TeamOutlined],
  [/INVOICE|BILL/, FileTextOutlined],
  [/MARKETING/, RiseOutlined],
  [/RATE|CONTRACT/, DollarOutlined],
  [/SETTING/, ToolOutlined],
  [/USER/, UserOutlined],
];

function menuIcon(name) {
  const upper = String(name || '').toUpperCase();
  const hit = MENU_ICONS.find(([re]) => re.test(upper));
  if (hit) { const Icon = hit[1]; return <Icon />; }
  return <span className="menu-letter" aria-hidden="true">{upper.charAt(0) || '•'}</span>;
}

function collectLeaves(items, out = new Map()) {
  for (const i of items) {
    if (i.children) collectLeaves(i.children, out);
    else if (i.to) out.set(i.key, i);
  }
  return out;
}

// On the phone rail each section opens as ONE pop-out: third-level menus become
// headed groups instead of cascading pop-outs that run off a narrow screen.
function flattenForRail(items) {
  return items.map((top) => (top.children ? {
    ...top,
    children: top.children.map((c) => (c.children ? { type: 'group', key: c.key, label: c.label, children: c.children } : c)),
  } : top));
}

/**
 * compact = sidebar collapsed to icons (phone rail, or desktop "collapse"):
 *   each section opens as one pop-out and closes after navigating.
 * full    = expanded sidebar: sections expand inline, and the section holding
 *   the current page is opened automatically.
 * touch   = phones/tablets: pop-outs open on tap instead of hover.
 */
function SideMenu({ compact = false, touch = false, horizontal = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useUiTheme();
  const [popupKeys, setPopupKeys] = useState([]);
  const [expandedKeys, setExpandedKeys] = useState([]);
  const { data: tree = [], isLoading } = useQuery({ queryKey: ['menu'], queryFn: () => api.get('/menu').then((r) => r.data) });

  const items = useMemo(() => [
    { key: 'home', icon: <AppstoreOutlined />, label: 'Dashboard', to: '/' },
    ...toMenuItems(tree).map((i) => ({ ...i, icon: menuIcon(i.label), label: i.label?.toUpperCase?.() ?? i.label })),
  ], [tree]);
  const leaves = useMemo(() => collectLeaves(items), [items]);
  const current = location.pathname + location.search;
  const selected = [...leaves.values()].find((l) => l.to === current || (l.to !== '/' && current.startsWith(l.to)))?.key ?? (location.pathname === '/' ? 'home' : undefined);

  // Icon mode: pop-out items aren't rendered until opened, so the menu can't
  // tell which section holds the current page — mark that section ourselves.
  const activeSection = selected?.includes('/') ? selected.split('/')[0] : null;
  const shown = useMemo(() => {
    if (!compact) return items;
    return flattenForRail(items).map((i) => (i.key === activeSection ? { ...i, className: 'section-active' } : i));
  }, [items, compact, activeSection]);

  // Keys are paths ("M002/S010/SS01"); open every ancestor of the current page.
  useEffect(() => {
    if (compact || horizontal || !selected) return;
    const parts = selected.split('/');
    const ancestors = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
    if (ancestors.length) setExpandedKeys((keys) => [...new Set([...keys, ...ancestors])]);
  }, [selected, compact, horizontal]);

  if (horizontal) {
    // menu along the top (UI presets with nav "top"): sections drop down; the menu shows "…" when it runs out of room
    return (
      <Menu
        theme={theme.menuTheme}
        mode="horizontal"
        className="app-topnav-menu"
        items={isLoading ? [{ key: 'loading', label: 'Loading…', disabled: true }] : flattenForRail(items)}
        selectedKeys={selected ? [selected] : []}
        onClick={({ key }) => {
          const leaf = leaves.get(key);
          if (leaf?.to) navigate(leaf.to);
        }}
      />
    );
  }

  const openProps = compact
    ? {
      openKeys: popupKeys,
      onOpenChange: (keys) => setPopupKeys(keys.slice(-1)),
      // Phones have no hover, and hover-to-close was flaky on touch.
      triggerSubMenuAction: touch ? 'click' : 'hover',
    }
    : { openKeys: expandedKeys, onOpenChange: setExpandedKeys };

  return (
    <Menu
      theme={theme.menuTheme}
      mode="inline"
      items={isLoading ? [{ key: 'loading', label: 'Loading…', disabled: true }] : shown}
      selectedKeys={selected ? [selected] : []}
      {...openProps}
      onClick={({ key }) => {
        const leaf = leaves.get(key);
        if (leaf?.to) { navigate(leaf.to); setPopupKeys([]); }
      }}
    />
  );
}

function BranchSwitcher() {
  const { user, switchBranch } = useAuth();
  const { message } = App.useApp();
  const { data: branches = [], isLoading } = useQuery({
    queryKey: ['branches', user.userId],
    queryFn: () => api.get('/auth/branches').then((r) => r.data),
  });
  return (
    <Select
      size="middle"
      className="branch-switcher"
      value={user.currentBranch.code}
      loading={isLoading}
      showSearch
      optionFilterProp="label"
      options={(branches.length ? branches : [user.currentBranch]).map((b) => ({ value: b.code, label: `${b.name} : ${b.code}` }))}
      onChange={async (code) => {
        try { await switchBranch(code); message.success('Branch changed'); } catch (e) { message.error(errorMessage(e)); }
      }}
      aria-label="Current branch"
    />
  );
}

/** Desktop-style status bar (themes with layout.statusBar): who / where / which year, and a running clock. */
function StatusBar({ user }) {
  const location = useLocation();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t); }, []);
  return (
    <div className="app-statusbar" role="status">
      <span className="sb-ready">● Ready</span>
      <span>{location.pathname === '/' ? 'Dashboard' : location.pathname.replace(/^\//, '').replace(/\//g, ' › ')}</span>
      <span className="sb-fill" />
      <span>User: {user.userName || user.userId}</span>
      <span>Branch: {user.currentBranch?.name} ({user.currentBranch?.code})</span>
      <span>{user.divName || user.divCode}</span>
      <span>FY {user.financialYear}</span>
      <span>{now.toLocaleDateString('en-IN')} {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  // useBreakpoint() is empty on the first render; fall back to the window width
  // so desktops don't flash the phone rail before it settles.
  const isMobile = screens.lg === undefined ? window.innerWidth < 992 : !screens.lg;
  const [collapsed, setCollapsed] = useState(false);
  // Phones/tablets: the sidebar stays visible as a narrow icon rail; each section
  // opens as a pop-out menu. Desktop: full sidebar, collapsible.
  const railOnly = isMobile;
  const siderCollapsed = railOnly || collapsed;
  // where the menu is (UI preset): left, right or along the top; phones always keep the left icon rail
  const { theme } = useUiTheme();
  const nav = railOnly ? 'left' : theme.layout.nav;

  const userMenu = {
    items: [
      { key: 'info', disabled: true, label: <span>{user.userName || user.userId} <Tag>{user.role}</Tag></span> },
      { type: 'divider' },
      { key: 'pw', icon: <KeyOutlined />, label: 'Change password', onClick: () => navigate('/account/change-password') },
      // the whole project in one Word file (docs/flow.docx)
      { key: 'flow', icon: <FileWordOutlined />, label: 'Project Flow (Word file)', onClick: () => navigate('/project-flow') },
      { key: 'logout', icon: <LogoutOutlined />, label: 'Log out', onClick: logout },
    ],
  };

  const sider = (
    <Sider
      width={260}
      collapsedWidth={railOnly ? 56 : 80}
      collapsible={!railOnly}
      trigger={railOnly ? null : undefined}
      collapsed={siderCollapsed}
      onCollapse={setCollapsed}
      reverseArrow={nav === 'right'}
      className={`app-sider${railOnly ? ' app-sider-rail' : ''}${nav === 'right' ? ' app-sider-right' : ''}`}
      style={{ overflowY: 'auto', overflowX: 'hidden', height: '100vh', position: 'sticky', top: 0 }}
    >
      <div className={`app-logo${siderCollapsed ? ' app-logo-collapsed' : ''}`} title="Ramas ERP">
        🚚{!siderCollapsed && ' RAMAS ERP'}
      </div>
      <SideMenu key={siderCollapsed ? 'compact' : 'full'} compact={siderCollapsed} touch={railOnly} />
    </Sider>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {nav === 'left' && sider}
      <Layout style={{ minWidth: 0 }}>
        {nav === 'top' && (
          <div className="app-topnav">
            <div className="app-logo" title="Ramas ERP">🚚 RAMAS ERP</div>
            <SideMenu horizontal />
          </div>
        )}
        <Header className="app-header">
          <BranchSwitcher />
          <Space className="hide-sm" size={4}>
            <Tag color="blue">{user.divName}</Tag>
            <Tag>FY {user.financialYear}</Tag>
          </Space>
          <div className="spacer" />
          {user.role !== 'client' && !isMobile && (
            <Input.Search
              placeholder="Track docket no."
              allowClear
              style={{ width: 220 }}
              enterButton={<SearchOutlined />}
              onSearch={(v) => v.trim() && navigate(`/tracking?docket=${encodeURIComponent(v.trim())}`)}
            />
          )}
          <ThemePicker showLabel={!isMobile} />
          <Button type="text" icon={<FileWordOutlined />} onClick={() => navigate('/project-flow')} title="Project Flow (Word file)" aria-label="Project Flow (Word file)" />
          <Dropdown menu={userMenu} trigger={['click']}>
            <Button type="text" icon={<UserOutlined />}>
              {!isMobile && <Typography.Text>{user.userName || user.userId}</Typography.Text>}
            </Button>
          </Dropdown>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
        {theme.layout.statusBar && <StatusBar user={user} />}
      </Layout>
      {nav === 'right' && sider}
    </Layout>
  );
}
