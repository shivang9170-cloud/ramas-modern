// Replaces User/UserAccessRights.aspx (+ MenuAccess/Employee_Permission.aspx).
// Tree keys: "M001" main menu, "M001|S001" sub menu, "M001|S001|SS01" sub-sub menu.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { App, Button, Card, Empty, Result, Select, Space, Spin, Tree, Typography } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

function toTree(catalogue) {
  return catalogue.map((m) => ({
    key: m.id,
    title: m.name,
    children: m.children.map((s) => ({
      key: `${m.id}|${s.id}`,
      title: s.name,
      children: s.children?.map((ss) => ({ key: `${m.id}|${s.id}|${ss.id}`, title: ss.name })),
    })),
  }));
}

/** Permissions -> checked tree keys. A sub menu row with no sub-sub id means "whole sub menu". */
function permsToKeys(perms, catalogue) {
  const keys = new Set();
  for (const p of perms) {
    if (p.subSubMenuId) keys.add(`${p.menuId}|${p.subMenuId}|${p.subSubMenuId}`);
    else {
      const sub = catalogue.find((m) => m.id === p.menuId)?.children.find((s) => s.id === p.subMenuId);
      if (sub?.children?.length) sub.children.forEach((ss) => keys.add(`${p.menuId}|${p.subMenuId}|${ss.id}`));
      else keys.add(`${p.menuId}|${p.subMenuId}`);
    }
  }
  return [...keys];
}

/** Checked leaf keys -> permission rows (legacy format: one row per leaf). */
function keysToPerms(keys) {
  return keys
    .map((k) => k.split('|'))
    .filter((parts) => parts.length >= 2)
    .map(([menuId, subMenuId, subSubMenuId]) => ({ menuId, subMenuId, subSubMenuId: subSubMenuId ?? null }));
}

export default function AccessRightsPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [empCode, setEmpCode] = useState();
  const [checked, setChecked] = useState([]);

  const isAdmin = user.role === 'admin';
  const catalogue = useQuery({ queryKey: ['menu-catalogue'], queryFn: () => api.get('/menu/catalogue').then((r) => r.data), enabled: isAdmin });
  const employees = useQuery({ queryKey: ['menu-employees'], queryFn: () => api.get('/menu/employees').then((r) => r.data), enabled: isAdmin });
  const perms = useQuery({
    queryKey: ['permissions', empCode],
    queryFn: () => api.get(`/menu/permissions/${encodeURIComponent(empCode)}`).then((r) => r.data),
    enabled: Boolean(empCode) && isAdmin,
  });

  const treeData = useMemo(() => toTree(catalogue.data ?? []), [catalogue.data]);
  const leafKeys = useMemo(() => {
    const out = new Set();
    const walk = (nodes) => nodes.forEach((n) => (n.children?.length ? walk(n.children) : out.add(n.key)));
    walk(treeData);
    return out;
  }, [treeData]);

  useEffect(() => {
    if (perms.data && catalogue.data) setChecked(permsToKeys(perms.data, catalogue.data));
  }, [perms.data, catalogue.data]);

  const save = useMutation({
    mutationFn: () => api.put(`/menu/permissions/${encodeURIComponent(empCode)}`, {
      permissions: keysToPerms(checked.filter((k) => leafKeys.has(k))),
    }),
    onSuccess: () => message.success('Permissions saved'),
    onError: (e) => message.error(errorMessage(e)),
  });

  if (!isAdmin) return <Result status="403" title="Only the administrator can manage access rights" />;

  return (
    <Card
      className="page-card"
      title="User Access Rights"
      extra={<Button type="primary" icon={<SaveOutlined />} disabled={!empCode} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Select
          showSearch
          placeholder="Select employee"
          style={{ width: '100%', maxWidth: 420 }}
          loading={employees.isLoading}
          value={empCode}
          onChange={setEmpCode}
          optionFilterProp="label"
          options={(employees.data ?? []).map((e) => ({ value: e.code, label: `${e.name} : ${e.code}` }))}
        />
        {!empCode ? <Empty description="Select an employee to edit menu permissions" /> : (
          catalogue.isLoading || perms.isLoading ? <Spin /> : (
            <>
              <Typography.Text type="secondary">{checked.filter((k) => leafKeys.has(k)).length} screens allowed</Typography.Text>
              <Tree
                checkable
                defaultExpandAll
                treeData={treeData}
                checkedKeys={checked}
                onCheck={(keys) => setChecked(keys)}
                selectable={false}
              />
            </>
          )
        )}
      </Space>
    </Card>
  );
}
