// Account Master — replaces Accounts/LedgerBind_Add.aspx.
// Manage the chart of accounts for the current financial year: account groups and ledgers (account heads).
// Party ledgers (vendor / client / branch, made by their own masters) are shown read-only here.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Checkbox, Divider, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Switch, Table, Tag, Typography,
} from 'antd';
import { ApartmentOutlined, DeleteOutlined, EditOutlined, LockOutlined, PlusOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { AddSubLedgerModal } from '../../components/accounts/SubLedger.jsx';

const upper = { style: { textTransform: 'uppercase' } };
const money = (v) => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// current balance shown Dr-positive: >=0 → "X Dr", <0 → "X Cr"
const balText = (v) => `${money(Math.abs(Number(v) || 0))} ${(Number(v) || 0) < 0 ? 'CR' : 'DR'}`;

// section options grouped by nature: Asset / Liability / Income / Expense
const sectionOptions = (sections = []) => ['Asset', 'Liability', 'Income', 'Expense']
  .map((nat) => ({ label: nat, options: sections.filter((x) => x.nature === nat).map((x) => ({ value: x.value, label: x.label })) }))
  .filter((g) => g.options.length);

function GroupModal({ open, sections, onClose, onCreated }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) form.resetFields(); }, [open, form]);
  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const { data } = await api.post('/account-ledgers/groups', v);
      message.success(data.message);
      onCreated(data.code);
    } catch (e) { message.error(errorMessage(e)); } finally { setSaving(false); }
  }
  return (
    <Modal open={open} onCancel={onClose} title="New account group" okText="Create" confirmLoading={saving} onOk={save}>
      <Form form={form} layout="vertical">
        <Form.Item name="name" label="Group name" rules={[{ required: true, min: 2, message: 'Enter group name' }]}>
          <Input maxLength={100} {...upper} placeholder="e.g. ADMINISTRATIVE EXPENSES" autoFocus />
        </Form.Item>
        <Form.Item name="section" label="Group type" rules={[{ required: true, message: 'Select the group type' }]}
          extra="Decides where its ledgers appear: Balance Sheet (assets / liabilities) or Profit & Loss (income / expenses).">
          <Select showSearch optionFilterProp="label" placeholder="e.g. Indirect Expenses" options={sectionOptions(sections)} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Every account group with its type; the type can be changed here. */
function GroupsDrawer({ open, sections, canEdit, onClose, onNew }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data = [], isFetching } = useQuery({ queryKey: ['account-groups'], enabled: open, queryFn: () => api.get('/account-ledgers/groups').then((r) => r.data) });
  const setSection = useMutation({
    mutationFn: ({ code, section }) => api.put(`/account-ledgers/groups/${code}/section`, { section }),
    onSuccess: (r) => {
      message.success(r.data.message);
      for (const k of ['account-groups', 'account-options', 'books']) queryClient.invalidateQueries({ queryKey: [k] });
    },
    onError: (e) => message.error(errorMessage(e)),
  });
  const missing = data.filter((g) => !g.section).length;
  return (
    <Drawer open={open} onClose={onClose} title="Account Groups" width={Math.min(720, window.innerWidth)}
      extra={canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={onNew}>New group</Button>}>
      {missing > 0 && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`${missing} group(s) have no type yet. Set it so their ledgers appear correctly in the reports.`} />}
      <Table size="small" rowKey="code" loading={isFetching} dataSource={data} pagination={false}
        columns={[
          { title: 'Code', dataIndex: 'code', width: 80 },
          { title: 'Group', dataIndex: 'name' },
          { title: 'Ledgers', dataIndex: 'ledgers', width: 80, align: 'right' },
          {
            title: 'Group type', dataIndex: 'section', width: 260,
            render: (v, g) => (canEdit ? (
              <Select size="small" style={{ width: '100%' }} value={v || undefined} placeholder="Not set" status={v ? undefined : 'warning'}
                options={sectionOptions(sections)} onChange={(section) => setSection.mutate({ code: g.code, section })} />
            ) : (g.sectionLabel || '—')),
          },
          { title: 'Nature', dataIndex: 'nature', width: 90, render: (v) => (v ? <Tag>{v}</Tag> : '—') },
        ]} />
    </Drawer>
  );
}

function LedgerForm({ open, code, opts, onClose, onSaved, onAddGroup }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [parentPick, setParentPick] = useState('');    // system ledgers: only "kiske neeche" can change
  const editing = Boolean(code);
  const isMain = Form.useWatch('isMain', form);

  const { data: ledger, isFetching, error } = useQuery({
    queryKey: ['account-ledger', code], enabled: open && editing,
    queryFn: () => api.get(`/account-ledgers/${code}`).then((r) => r.data),
  });

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (!editing) form.setFieldsValue({ ledgerType: 'Ledger', openingBal: 0, drCr: 'DR', active: true, isMain: false, parentCode: undefined });
    else if (ledger) {
      form.setFieldsValue({ ...ledger, parentCode: ledger.parentCode || undefined });
      setParentPick(ledger.parentCode || '');
    }
  }, [open, editing, ledger, form]);

  useEffect(() => { if (isMain) form.setFieldsValue({ parentCode: undefined }); }, [isMain, form]);

  const fail = (e) => {
    const details = e.response?.data?.details;
    message.error(details?.length ? details.map((d) => d.message).join('; ') : errorMessage(e));
  };

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const body = { ...v, isMain: Boolean(v.isMain), parentCode: v.parentCode || '' };
      const { data } = editing ? await api.put(`/account-ledgers/${code}`, body) : await api.post('/account-ledgers', body);
      message.success(data.message);
      onSaved();
    } catch (e) { fail(e); } finally { setSaving(false); }
  }

  async function saveParent() {
    setSaving(true);
    try {
      const { data } = await api.put(`/account-ledgers/${code}/parent`, { parentCode: parentPick || '' });
      message.success(data.message);
      onSaved();
    } catch (e) { fail(e); } finally { setSaving(false); }
  }

  const readOnly = editing && ledger?.system;
  const mainOptions = (opts?.mains ?? []).filter((m) => m.value !== code);

  return (
    <Drawer
      title={editing ? `Edit ledger ${ledger?.name ?? ''}` : 'New ledger'}
      open={open}
      onClose={onClose}
      width={Math.min(560, window.innerWidth)}
      extra={!readOnly && <Button type="primary" icon={<PlusOutlined />} loading={saving} disabled={editing && !ledger} onClick={save}>{editing ? 'Update' : 'Save'}</Button>}
    >
      {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}
      {readOnly && <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="Party / system ledger" description="This ledger belongs to a vendor, client, branch or another module. Edit it from its own master." />}
      <Form form={form} layout="vertical" disabled={readOnly || (editing && isFetching && !ledger)}>
        <Form.Item name="name" label="Ledger name" rules={[{ required: true, min: 2, message: 'Enter ledger name' }]}>
          <Input maxLength={100} {...upper} placeholder="e.g. OFFICE RENT" />
        </Form.Item>
        <Form.Item name="groupCode" label="Account group" rules={[{ required: true, message: 'Select an account group' }]}>
          <Select
            showSearch optionFilterProp="label" placeholder="Select group"
            options={(opts?.groups ?? []).map((g) => ({ value: g.value, label: g.sectionLabel ? `${g.label}  ·  ${g.sectionLabel}` : `${g.label}  ·  type not set` }))}
            popupRender={(menu) => (
              <>
                {menu}
                <div style={{ padding: 8, borderTop: '1px solid var(--header-border, #eee)' }}>
                  <Button type="link" icon={<PlusOutlined />} onClick={onAddGroup} style={{ padding: 0 }}>Add account group</Button>
                </div>
              </>
            )}
          />
        </Form.Item>
        <Space size={12} style={{ display: 'flex' }} align="start">
          <Form.Item name="ledgerType" label="Type" rules={[{ required: true }]} style={{ flex: 1 }}>
            <Select options={opts?.ledgerTypes ?? []} />
          </Form.Item>
          <Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item>
        </Space>
        <Space size={12} style={{ display: 'flex' }} align="start">
          <Form.Item name="openingBal" label="Opening balance" style={{ flex: 1 }}>
            <InputNumber min={-9999999999} max={9999999999} step={100} style={{ width: '100%' }}
              formatter={(v) => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={(v) => v.replace(/,/g, '')} />
          </Form.Item>
          <Form.Item name="drCr" label="Side">
            <Radio.Group optionType="button" options={opts?.drcr ?? [{ value: 'DR', label: 'Dr' }, { value: 'CR', label: 'Cr' }]} />
          </Form.Item>
        </Space>

        <Divider orientation="left" plain>Ledger Hierarchy</Divider>
        <Form.Item name="isMain" valuePropName="checked"
          extra="A main ledger takes no new entries; its balance is its own past balance plus the total of its sub-ledgers.">
          <Checkbox>Main ledger (has sub-ledgers)</Checkbox>
        </Form.Item>
        <Form.Item name="parentCode" label="Under Main Ledger" extra="Leave blank for an independent ledger.">
          <Select allowClear showSearch optionFilterProp="label" disabled={isMain} placeholder={mainOptions.length ? 'Select main ledger' : 'No main ledger yet'}
            options={mainOptions} />
        </Form.Item>
      </Form>

      {readOnly && (
        <Card size="small" title="Ledger Hierarchy" style={{ marginTop: 8 }}>
          <Space wrap>
            <Select allowClear showSearch optionFilterProp="label" style={{ width: 280 }} value={parentPick || undefined}
              placeholder="Under main ledger" onChange={(v) => setParentPick(v || '')} options={mainOptions} />
            <Button type="primary" loading={saving} onClick={saveParent}>Save</Button>
          </Space>
        </Card>
      )}
    </Drawer>
  );
}

export default function AccountMasterPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [group, setGroup] = useState('');
  const [editing, setEditing] = useState(null); // null = closed, '' = new, code = edit
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [subFor, setSubFor] = useState(null);   // { code, name } of the ledger getting a new sub-ledger
  const canEdit = ['admin', 'employee'].includes(user.role);

  const { data: opts } = useQuery({ queryKey: ['account-options', user.divCode], queryFn: () => api.get('/account-ledgers/options').then((r) => r.data) });
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['account-ledgers', q, status, group, user.divCode, user.financialYear],
    queryFn: () => api.get('/account-ledgers', { params: { q, status, group } }).then((r) => r.data),
  });
  const remove = useMutation({
    mutationFn: (code) => api.delete(`/account-ledgers/${code}`),
    onSuccess: (r) => { message.success(r.data.message); queryClient.invalidateQueries({ queryKey: ['account-ledgers'] }); },
    onError: (e) => message.error(errorMessage(e)),
  });

  // main ledgers already include their sub-ledgers' balance - count every amount once (sub / normal ledgers only)
  const totals = useMemo(() => data.filter((l) => !l.isMain).reduce((a, l) => {
    if (l.drCr === 'CR') a.cr += l.openingBal; else a.dr += l.openingBal;
    a.balance += Number(l.balance) || 0;
    return a;
  }, { dr: 0, cr: 0, balance: 0 }), [data]);

  // tree: each main ledger carries its sub-ledgers as `children` (expand ▸ to see them)
  const tree = useMemo(() => {
    const present = new Set(data.filter((l) => l.isMain).map((l) => l.code));
    const kids = new Map();
    for (const l of data) if (l.parentCode && present.has(l.parentCode)) kids.set(l.parentCode, [...(kids.get(l.parentCode) ?? []), l]);
    return data
      .filter((l) => !(l.parentCode && present.has(l.parentCode)))
      .map((l) => (l.isMain ? { ...l, children: kids.get(l.code) ?? [] } : l));
  }, [data]);

  function refreshOptions() {
    queryClient.invalidateQueries({ queryKey: ['account-options'] });
  }

  return (
    <Card className="page-card" title="Account Master"
      extra={(
        <Space>
          <Button icon={<ApartmentOutlined />} onClick={() => setGroupsOpen(true)}>Account Groups</Button>
          {canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('')}>New ledger</Button>}
        </Space>
      )}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search placeholder="Name, code or group" allowClear onSearch={setQ} style={{ width: 260 }} />
        <Select allowClear placeholder="All groups" style={{ width: 200 }} value={group || undefined}
          onChange={(v) => setGroup(v || '')} showSearch optionFilterProp="label" options={opts?.groups ?? []} />
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        <Typography.Text type="secondary">
          {data.length} ledger(s) · FY {user.financialYear} · {user.divName || user.divCode}
        </Typography.Text>
      </Space>
      {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}
      <Table
        size="middle"
        rowKey="code"
        loading={isFetching}
        dataSource={tree}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        rowClassName={(r) => (r.isMain ? 'row-main-ledger' : '')}
        columns={[
          { title: 'Code', dataIndex: 'code', sorter: (a, b) => a.code.localeCompare(b.code) },
          { title: 'Ledger', dataIndex: 'name', sorter: (a, b) => a.name.localeCompare(b.name),
            render: (v, r) => (
              <Space>
                {r.isMain ? <strong>{v}</strong> : v}
                {r.isMain && <Tag icon={<ApartmentOutlined />} color="blue">Main · {r.subCount ?? 0} sub-ledger{r.subCount === 1 ? '' : 's'}</Tag>}
                {r.system && <Tag icon={<LockOutlined />} color="default">System</Tag>}
              </Space>
            ) },
          { title: 'Group', dataIndex: 'group', render: (v) => v || '—' },
          { title: 'Type', dataIndex: 'ledgerType' },
          { title: 'Opening', dataIndex: 'openingBal', align: 'right', className: 'money',
            render: (v, r) => (r.isMain ? '—' : v ? `${money(v)} ${r.drCr}` : '—'), sorter: (a, b) => a.openingBal - b.openingBal },
          { title: 'Current balance', dataIndex: 'balance', align: 'right', className: 'money',
            render: (v, r) => (r.isMain ? <strong>{balText(v)} <Typography.Text type="secondary" style={{ fontSize: 12 }}>(total)</Typography.Text></strong> : <strong>{balText(v)}</strong>),
            sorter: (a, b) => (a.balance || 0) - (b.balance || 0) },
          { title: 'Status', dataIndex: 'active', render: (v) => (v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
          {
            title: '', key: 'a', width: 200,
            render: (_, r) => canEdit && (
              <Space>
                {!r.parentCode && (
                  <Button size="small" icon={<PlusOutlined />} onClick={() => setSubFor({ code: r.code, name: r.name })}
                    title={`Create a sub-ledger under ${r.name}`}>Sub-Ledger</Button>
                )}
                <Button size="small" icon={<EditOutlined />} aria-label={`Edit ${r.name}`} onClick={() => setEditing(r.code)} />
                {!r.system && (
                  <Popconfirm title={`Delete ${r.name}?`} description="Only possible if no account entry uses it."
                    okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => remove.mutateAsync(r.code)}>
                    <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${r.name}`} />
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
        summary={() => (data.length ? (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={4}><strong>Totals</strong></Table.Summary.Cell>
              <Table.Summary.Cell index={4} align="right" className="money">
                <strong>{money(totals.dr)} DR · {money(totals.cr)} CR</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={5} align="right" className="money"><strong>{balText(totals.balance)}</strong></Table.Summary.Cell>
              <Table.Summary.Cell index={6} colSpan={2} />
            </Table.Summary.Row>
          </Table.Summary>
        ) : null)}
      />
      <LedgerForm
        open={editing !== null}
        code={editing || null}
        opts={opts}
        onClose={() => setEditing(null)}
        onAddGroup={() => setGroupOpen(true)}
        onSaved={() => {
          setEditing(null);
          queryClient.invalidateQueries({ queryKey: ['account-ledgers'] });
          queryClient.invalidateQueries({ queryKey: ['account-ledger'] });
          refreshOptions();   // the main-ledger list may have changed
        }}
      />
      <GroupModal
        open={groupOpen}
        sections={opts?.sections}
        onClose={() => setGroupOpen(false)}
        onCreated={() => { setGroupOpen(false); refreshOptions(); queryClient.invalidateQueries({ queryKey: ['account-groups'] }); }}
      />
      <GroupsDrawer open={groupsOpen} sections={opts?.sections} canEdit={canEdit} onClose={() => setGroupsOpen(false)} onNew={() => setGroupOpen(true)} />
      <AddSubLedgerModal main={subFor} showOpening onClose={() => setSubFor(null)}
        onCreated={() => {
          setSubFor(null);
          queryClient.invalidateQueries({ queryKey: ['account-ledgers'] });
          queryClient.invalidateQueries({ queryKey: ['pay-options'] });
          refreshOptions();
        }} />
    </Card>
  );
}
