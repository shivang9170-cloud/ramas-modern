// ODA master and configuration (replaces Setting/ODA_Master_And_Configuration.aspx): distance bands, weight bands and
// the ODA rate for each distance × weight from an effective date.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, DatePicker, Drawer, Form, InputNumber, Select, Space, Switch, Table, Tabs, Tag } from 'antd';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../api/client.js';
import { date, get, money, send, ymd } from './common.js';

const UNIT = { distance: 'KMs', weight: 'KGs' };

function BandEditor({ kind, band, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    const res = await send(message, () => (band?.id ? api.put(`/oda-config/bands/${kind}/${band.id}`, v) : api.post(`/oda-config/bands/${kind}`, v)));
    setSaving(false);
    if (res) onSaved();
  }
  return (
    <Drawer title={`${band?.id ? 'Edit' : 'New'} ${kind} band`} open={Boolean(band)} onClose={onClose} width={Math.min(420, window.innerWidth)} destroyOnClose
      extra={<Button type="primary" loading={saving} onClick={save}>Save</Button>}>
      <Form form={form} layout="vertical" preserve={false} initialValues={{ active: true, ...band }}>
        <Form.Item name="from" label={`From (${UNIT[kind]})`} rules={[{ required: true, message: 'Enter "From"' }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="to" label={`To (${UNIT[kind]})`} rules={[{ required: true, message: 'Enter "To"' }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
        <Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item>
      </Form>
    </Drawer>
  );
}

function Bands({ kind }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const { data = [], isFetching } = useQuery({ queryKey: ['oda-bands', kind], queryFn: () => get(`/oda-config/bands/${kind}`) });
  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={() => setEditing({})}>New band</Button>
      <Table size="small" rowKey="id" loading={isFetching} dataSource={data} pagination={false}
        columns={[
          { title: 'Band', dataIndex: 'name' },
          { title: 'From', dataIndex: 'from', align: 'right' },
          { title: 'To', dataIndex: 'to', align: 'right' },
          { title: 'Status', dataIndex: 'active', render: (v) => (v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
          { title: '', key: 'e', render: (_, r) => <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`} /> },
        ]} />
      <BandEditor kind={kind} band={editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); queryClient.invalidateQueries({ queryKey: ['oda-bands'] }); }} />
    </>
  );
}

function RateEditor({ rate, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const distances = (useQuery({ queryKey: ['oda-bands', 'distance'], queryFn: () => get('/oda-config/bands/distance') }).data ?? []).filter((b) => b.active);
  const weights = (useQuery({ queryKey: ['oda-bands', 'weight'], queryFn: () => get('/oda-config/bands/weight') }).data ?? []).filter((b) => b.active);
  const editing = Boolean(rate?.id);
  const opt = (list) => list.map((b) => ({ value: b.id, label: b.name }));
  const toBody = (v) => ({ distanceId: v.distanceId, weightId: v.weightId, rate: v.rate, effectiveDate: ymd(v.effectiveDate) });

  async function add() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    const r = toBody(v);
    if (rows.some((x) => x.distanceId === r.distanceId && x.weightId === r.weightId && x.effectiveDate === r.effectiveDate)) {
      message.error('Rate already added for the selection'); return;
    }
    setRows([...rows, r]);
    form.setFieldsValue({ distanceId: undefined, weightId: undefined, rate: undefined });
  }
  async function save() {
    setSaving(true);
    let res;
    if (editing) {
      let v;
      try { v = await form.validateFields(); } catch { setSaving(false); return; }
      res = await send(message, () => api.put(`/oda-config/rates/${rate.id}`, { ...toBody(v), active: v.active }));
    } else {
      res = await send(message, () => api.post('/oda-config/rates', { rows }));
    }
    setSaving(false);
    if (res) { setRows([]); onSaved(); }
  }
  const name = (list, id) => list.find((b) => b.id === id)?.name ?? id;
  return (
    <Drawer title={editing ? 'Edit ODA rate' : 'New ODA rates'} open={Boolean(rate)} onClose={onClose} width={Math.min(640, window.innerWidth)} destroyOnClose
      extra={<Button type="primary" loading={saving} disabled={!editing && !rows.length} onClick={save}>Save</Button>}>
      <Form form={form} layout="vertical" preserve={false}
        initialValues={editing ? { ...rate, effectiveDate: dayjs(rate.effectiveDate) } : { effectiveDate: dayjs() }}>
        <Form.Item name="distanceId" label="Distance" rules={[{ required: true, message: 'Select distance' }]}><Select options={opt(distances)} /></Form.Item>
        <Form.Item name="weightId" label="Weight" rules={[{ required: true, message: 'Select weight' }]}><Select options={opt(weights)} /></Form.Item>
        <Space>
          <Form.Item name="rate" label="Rate (₹)" rules={[{ required: true, message: 'Enter the rate' }]}><InputNumber min={0} /></Form.Item>
          <Form.Item name="effectiveDate" label="Effective from" rules={[{ required: true, message: 'Effective date' }]}><DatePicker format="DD/MM/YYYY" /></Form.Item>
          {editing && <Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item>}
        </Space>
        {!editing && <Button icon={<PlusOutlined />} onClick={add}>Add to list</Button>}
      </Form>
      {!editing && (
        <Table size="small" style={{ marginTop: 12 }} rowKey={(r) => `${r.distanceId}|${r.weightId}|${r.effectiveDate}`} dataSource={rows} pagination={false}
          columns={[
            { title: 'Distance', key: 'd', render: (_, r) => name(distances, r.distanceId) },
            { title: 'Weight', key: 'w', render: (_, r) => name(weights, r.weightId) },
            { title: 'Rate', dataIndex: 'rate', align: 'right', render: money },
            { title: 'Effective', dataIndex: 'effectiveDate', render: date },
            { title: '', key: 'x', render: (_, r) => <Button size="small" danger onClick={() => setRows(rows.filter((x) => x !== r))}>Remove</Button> },
          ]} />
      )}
    </Drawer>
  );
}

function Rates() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);
  const { data = [], isFetching } = useQuery({ queryKey: ['oda-rates'], queryFn: () => get('/oda-config/rates') });
  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={() => setEditing({})}>New rates</Button>
      <Table size="small" rowKey="id" loading={isFetching} dataSource={data}
        columns={[
          { title: 'Distance', dataIndex: 'distanceName' },
          { title: 'Weight', dataIndex: 'weightName' },
          { title: 'Rate', dataIndex: 'rate', align: 'right', render: money },
          { title: 'Effective', dataIndex: 'effectiveDate', render: date },
          { title: 'Status', dataIndex: 'active', render: (v) => (v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
          { title: '', key: 'e', render: (_, r) => <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(r)} aria-label="Edit rate" /> },
        ]} />
      <RateEditor rate={editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); queryClient.invalidateQueries({ queryKey: ['oda-rates'] }); }} />
    </>
  );
}

export default function OdaConfigPage() {
  return (
    <Card className="page-card" title="ODA Master And Configuration">
      <Tabs items={[
        { key: 'distance', label: 'Distance bands', children: <Bands kind="distance" /> },
        { key: 'weight', label: 'Weight bands', children: <Bands kind="weight" /> },
        { key: 'rates', label: 'ODA rates', children: <Rates /> },
      ]} />
    </Card>
  );
}
