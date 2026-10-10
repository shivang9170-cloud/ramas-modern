// Franchisee bind branch (replaces Setting/Franchisee_Bind_Branch.aspx): the branch a franchisee or master
// franchisee runs. A branch can be bound to one franchisee at a time.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Drawer, Form, Radio, Select, Switch, Table, Tag } from 'antd';
import { FileExcelOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from '../../api/client.js';
import { exportCsv } from '../../utils/exportTable.js';
import { get, send } from './common.js';

function NewBinding({ open, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const type = Form.useWatch('type', form) ?? 1;
  const franchisee = Form.useWatch('franchisee', form);
  const franchisees = useQuery({ queryKey: ['fr-list', type], enabled: open, queryFn: () => get('/bindings/franchisees', { type }) }).data ?? [];
  const branches = useQuery({
    queryKey: ['fr-branches', type, franchisee], enabled: Boolean(franchisee), queryFn: () => get('/bindings/franchisee-branches', { type, franchisee }),
  }).data ?? [];

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    const res = await send(message, () => api.post('/bindings/franchisee-branch', v));
    setSaving(false);
    if (res) onSaved();
  }

  return (
    <Drawer title="Bind franchisee to branch" open={open} onClose={onClose} width={Math.min(520, window.innerWidth)} destroyOnClose
      extra={<Button type="primary" loading={saving} onClick={save}>Save</Button>}>
      <Form form={form} layout="vertical" preserve={false} initialValues={{ type: 1, active: true }}>
        <Form.Item name="type" label="Type">
          <Radio.Group onChange={() => form.setFieldsValue({ franchisee: undefined, branch: undefined })}
            options={[{ value: 1, label: 'Franchisee' }, { value: 2, label: 'Master franchisee' }]} />
        </Form.Item>
        <Form.Item name="franchisee" label="Franchisee" rules={[{ required: true, message: 'Select franchisee' }]}>
          <Select showSearch optionFilterProp="label" options={franchisees} onChange={() => form.setFieldValue('branch', undefined)} />
        </Form.Item>
        <Form.Item name="branch" label="Franchisee branch" rules={[{ required: true, message: 'Select branch' }]}>
          <Select showSearch optionFilterProp="label" options={branches} disabled={!franchisee} />
        </Form.Item>
        <Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Drawer>
  );
}

export default function FranchiseeBranchPage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data = [], isFetching } = useQuery({ queryKey: ['fr-branch'], queryFn: () => get('/bindings/franchisee-branch') });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['fr-branch'] });
  const columns = [
    { title: 'Franchisee', dataIndex: 'franchiseeName' },
    { title: 'Type', dataIndex: 'type', render: (v) => (v === 2 ? 'Master franchisee' : 'Franchisee'), exportValue: (v) => (v === 2 ? 'Master franchisee' : 'Franchisee') },
    { title: 'Branch', dataIndex: 'branchName' },
    {
      title: 'Status', dataIndex: 'active', exportValue: (v) => (v ? 'Active' : 'Inactive'),
      render: (v, r) => <Switch size="small" checked={v} aria-label={`Active ${r.branchName}`}
        onChange={async (a) => { if (await send(message, () => api.patch(`/bindings/franchisee-branch/${r.id}/status`, { active: a }))) refresh(); }} />,
    },
  ];
  return (
    <Card className="page-card" title="Franchisee Bind Branch"
      extra={<>
        <Button icon={<FileExcelOutlined />} disabled={!data.length} onClick={() => exportCsv('Franchise_Bind_Branch', columns, data)} style={{ marginRight: 8 }}>Export</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>New binding</Button>
      </>}>
      <Table size="small" rowKey="id" loading={isFetching} dataSource={data} columns={columns}
        rowClassName={(r) => (r.active ? '' : 'row-muted')} footer={() => <Tag>{data.length} binding(s)</Tag>} />
      <NewBinding open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />
    </Card>
  );
}
