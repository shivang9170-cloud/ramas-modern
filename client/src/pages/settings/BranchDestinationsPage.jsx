// Bind destination to branch (replaces Setting/Bind_Destinationtobranch.aspx): which cities of a state the branch
// delivers, per division — Courier (DIV1001), Parcel (DIV1002), FTL (DIV1003). Only the logged-in division's flag can
// be changed; a franchisee branch of type 2 binds cities without division flags.
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Checkbox, Radio, Select, Space, Table, Tag } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { useAuth } from '../../auth/AuthContext.jsx';
import { api } from '../../api/client.js';
import { get, send } from './common.js';

const DIVISION_FLAG = { DIV1001: 'courier', DIV1002: 'parcel', DIV1003: 'ftl' };

export default function BranchDestinationsPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [branch, setBranch] = useState();
  const [state, setState] = useState();
  const [rows, setRows] = useState([]);
  const [type, setType] = useState(0);
  const [saving, setSaving] = useState(false);
  const own = DIVISION_FLAG[user.divCode];
  const branches = useQuery({ queryKey: ['bind-branches'], queryFn: () => get('/bindings/branches') }).data ?? [];
  const states = useQuery({ queryKey: ['bind-states'], queryFn: () => get('/bindings/states') }).data ?? [];
  const br = branches.find((b) => b.value === branch);
  const { data, isFetching } = useQuery({
    queryKey: ['bind-destinations', branch, state], enabled: Boolean(branch && state),
    queryFn: () => get('/bindings/destinations', { branch, state }),
  });
  useEffect(() => { setRows(data?.cities ?? []); setType(data?.franchiseeType ?? 0); }, [data]);

  const editable = (f) => type !== 2 && (!own || f === own);
  const setFlag = (city, f, v) => setRows((rs) => rs.map((r) => {
    if (r.city !== city) return r;
    const next = { ...r, [f]: v };
    return { ...next, bound: r.ownCity || next.courier || next.parcel || next.ftl };
  }));

  async function save() {
    setSaving(true);
    const res = await send(message, () => api.put('/bindings/destinations', { branch, state, franchiseeType: type, cities: rows }));
    setSaving(false);
    if (res) queryClient.invalidateQueries({ queryKey: ['bind-destinations'] });
  }

  const flag = (f, label) => ({
    title: label, key: f, align: 'center',
    render: (_, r) => <Checkbox checked={r[f]} disabled={!editable(f)} onChange={(e) => setFlag(r.city, f, e.target.checked)} aria-label={`${label} ${r.cityName}`} />,
  });

  return (
    <Card className="page-card" title="Bind Destination To Branch"
      extra={<Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!rows.length} onClick={save}>Save</Button>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select showSearch optionFilterProp="label" placeholder="Branch" style={{ width: 280 }} options={branches} value={branch}
          onChange={(v) => { setBranch(v); setState(branches.find((b) => b.value === v)?.state); }} />
        <Select showSearch optionFilterProp="label" placeholder="State" style={{ width: 200 }} options={states} value={state} onChange={setState} disabled={!branch} />
        {br?.franchisee && (
          <Radio.Group value={type || 1} onChange={(e) => setType(e.target.value)}
            options={[{ value: 1, label: 'Franchisee (division-wise)' }, { value: 2, label: 'Franchisee (all divisions)' }]} />
        )}
      </Space>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message={`You can change the ${own ? own.toUpperCase() : 'division'} column (your division). A city is bound when any division is ticked; the branch's own city always stays bound.`} />
      <Table size="small" rowKey="city" loading={isFetching} dataSource={rows} pagination={{ defaultPageSize: 50 }}
        columns={[
          { title: 'City', dataIndex: 'cityName', render: (v, r) => <>{v} {r.ownCity && <Tag color="blue">Own city</Tag>}</> },
          {
            title: 'Bound', key: 'bound', align: 'center',
            render: (_, r) => <Checkbox checked={r.bound} disabled={type !== 2 || r.ownCity}
              onChange={(e) => setRows((rs) => rs.map((x) => (x.city === r.city ? { ...x, bound: e.target.checked } : x)))} aria-label={`Bound ${r.cityName}`} />,
          },
          flag('courier', 'Courier'), flag('parcel', 'Parcel'), flag('ftl', 'FTL'),
          { title: 'Also bound to', dataIndex: 'otherBranches' },
        ]} />
    </Card>
  );
}
