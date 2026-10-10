// Franchisee ↔ client (replaces Setting/Bind_Franchisee_to_Client.aspx and Setting/Franchisee_to_Client_View.aspx):
// tick the clients a franchisee handles; the list tab switches bindings on / off. A client belongs to one franchisee.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Input, Select, Space, Switch, Table, Tabs, Tag } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { api } from '../../api/client.js';
import { date, get, send } from './common.js';

function BindTab({ onSaved }) {
  const { message } = App.useApp();
  const [franchisee, setFranchisee] = useState();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const franchisees = useQuery({ queryKey: ['frc-franchisees'], queryFn: () => get('/bindings/franchisee-list') }).data ?? [];
  const { data = [], isFetching, refetch } = useQuery({
    queryKey: ['frc-clients', term], enabled: term !== null, queryFn: () => get('/bindings/clients', { search: term }),
  });

  async function save() {
    if (!franchisee) { message.error('Select franchisee'); return; }
    if (!picked.length) { message.error('Please select at least one client'); return; }
    setSaving(true);
    const res = await send(message, () => api.post('/bindings/franchisee-client', { franchisee, clients: picked }));
    setSaving(false);
    if (res) { setPicked([]); refetch(); onSaved(); }
  }

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select showSearch optionFilterProp="label" placeholder="Franchisee" style={{ width: 300 }} options={franchisees} value={franchisee} onChange={setFranchisee} />
        <Input.Search placeholder="Client name" allowClear style={{ width: 260 }} value={search} onChange={(e) => setSearch(e.target.value)} onSearch={setTerm} />
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>Save</Button>
      </Space>
      <Table size="small" rowKey="client" loading={isFetching} dataSource={data}
        rowSelection={{ selectedRowKeys: picked, onChange: setPicked, getCheckboxProps: (r) => ({ disabled: Boolean(r.boundTo) }) }}
        columns={[
          { title: 'Client', dataIndex: 'clientName' },
          { title: 'Code', dataIndex: 'client' },
          { title: 'Franchisee', dataIndex: 'boundTo', render: (v) => (v ? <Tag color="blue">{v}</Tag> : <Tag>Not bound</Tag>) },
        ]} />
    </>
  );
}

function ListTab() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const { data = [], isFetching } = useQuery({ queryKey: ['frc-list', search], queryFn: () => get('/bindings/franchisee-client', { search }) });
  return (
    <>
      <Input.Search placeholder="Franchisee or client" allowClear style={{ width: 300, marginBottom: 12 }} onSearch={setSearch} />
      <Table size="small" rowKey="id" loading={isFetching} dataSource={data}
        columns={[
          { title: 'Franchisee', dataIndex: 'franchiseeName' },
          { title: 'Client', dataIndex: 'clientName' },
          { title: 'Bound by', dataIndex: 'createdBy' },
          { title: 'On', dataIndex: 'createdDate', render: date },
          {
            title: 'Active', dataIndex: 'active',
            render: (v, r) => <Switch size="small" checked={v} aria-label={`Active ${r.clientName}`}
              onChange={async (a) => {
                if (await send(message, () => api.patch(`/bindings/franchisee-client/${r.id}/status`, { active: a }))) {
                  queryClient.invalidateQueries({ queryKey: ['frc-list'] });
                }
              }} />,
          },
        ]} />
    </>
  );
}

export default function FranchiseeClientPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const tab = params.get('tab') === 'list' ? 'list' : 'bind';
  return (
    <Card className="page-card" title="Franchisee To Client">
      <Tabs activeKey={tab} onChange={(k) => setParams(k === 'list' ? { tab: 'list' } : {})} items={[
        { key: 'bind', label: 'Bind clients', children: <BindTab onSaved={() => queryClient.invalidateQueries({ queryKey: ['frc-list'] })} /> },
        { key: 'list', label: 'Franchisee to client list', children: <ListTab /> },
      ]} />
    </Card>
  );
}
