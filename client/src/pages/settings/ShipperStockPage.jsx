// Shipper stock (replaces Setting/Shiper_Master.aspx and Setting/GatePassShiper_Master.aspx): docket-number series
// received at head office. `kind` is "shipper" or "gatepass" (the gate-pass books are kept apart).
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App, Button, Card, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Table, Tag,
} from 'antd';
import { DeleteOutlined, EditOutlined, EyeOutlined, FileExcelOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../api/client.js';
import { exportCsv } from '../../utils/exportTable.js';
import { date, get, problem, send, ymd } from './common.js';

function StockEditor({ kind, row, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const opts = useQuery({ queryKey: ['shipper-options'], queryFn: () => get('/shippers/options') }).data;
  const editing = Boolean(row?.id);
  const start = Form.useWatch('start', form);
  const end = Form.useWatch('end', form);

  async function pickType(t) {
    const { next } = await get(`/shippers/stock/${kind}/next`, { shipperType: t });
    if (next) form.setFieldValue('start', next);
  }
  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    const body = { ...v, receivingDate: ymd(v.receivingDate) };
    const res = await send(message, () => (editing ? api.put(`/shippers/stock/${kind}/${row.id}`, body) : api.post(`/shippers/stock/${kind}`, body)));
    setSaving(false);
    if (res) onSaved();
  }
  return (
    <Drawer title={editing ? 'Edit series' : 'Receive series'} open={Boolean(row)} onClose={onClose} width={Math.min(520, window.innerWidth)} destroyOnClose
      extra={<Button type="primary" loading={saving} onClick={save}>Save</Button>}>
      <Form form={form} layout="vertical" preserve={false}
        initialValues={editing ? { ...row, receivingDate: dayjs(row.receivingDate) } : { grnType: 1, receivingDate: dayjs(), receivedFrom: 'HO' }}>
        <Form.Item name="grnType" label="GRN type"><Radio.Group disabled={editing} options={opts?.grnTypes ?? []} /></Form.Item>
        <Form.Item name="shipperType" label="Shipper type" rules={[{ required: true, message: 'Select shipper type' }]}>
          <Select disabled={editing} options={opts?.shipperTypes ?? []} onChange={pickType} />
        </Form.Item>
        <Form.Item name="receivingDate" label="Receiving date" rules={[{ required: true, message: 'Receiving date' }]}><DatePicker format="DD/MM/YYYY" /></Form.Item>
        <Space>
          <Form.Item name="start" label="Starting series" rules={[{ required: true, message: 'Starting series required' }]}><InputNumber disabled={editing} min={1} style={{ width: 180 }} /></Form.Item>
          <Form.Item name="end" label="End series" rules={[{ required: true, message: 'End series required' }]}><InputNumber disabled={editing} min={1} style={{ width: 180 }} /></Form.Item>
        </Space>
        <p>Quantity: <b>{start && end && end >= start ? end - start + 1 : '—'}</b></p>
        <Form.Item name="receivedFrom" label="Received from" rules={[{ required: true, message: 'Received from required' }]}><Input maxLength={100} /></Form.Item>
      </Form>
    </Drawer>
  );
}

export default function ShipperStockPage({ kind }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [grnType, setGrnType] = useState('');
  const [number, setNumber] = useState('');
  const [editing, setEditing] = useState(null);
  const [numbers, setNumbers] = useState(null);
  const title = kind === 'gatepass' ? 'Gate Pass Shipper Master' : 'Shipper Master';
  const { data = [], isFetching } = useQuery({
    queryKey: ['shipper-stock', kind, grnType, number], queryFn: () => get(`/shippers/stock/${kind}`, { grnType, number }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['shipper-stock'] });
  const columns = [
    { title: 'Shipper type', dataIndex: 'shipperType' },
    { title: 'GRN type', dataIndex: 'grnTypeName' },
    { title: 'Received', dataIndex: 'receivingDate', render: date, exportValue: date },
    { title: 'Starting series', dataIndex: 'startSeries' },
    { title: 'End series', dataIndex: 'endSeries' },
    { title: 'Quantity', dataIndex: 'quantity', align: 'right' },
    { title: 'Received from', dataIndex: 'receivedFrom' },
  ];
  return (
    <Card className="page-card" title={title}
      extra={<Space>
        <Button icon={<FileExcelOutlined />} disabled={!data.length} onClick={() => exportCsv(kind === 'gatepass' ? 'GatePass_Shipper' : 'Shiper_Master', columns, data)}>Export</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>Receive series</Button>
      </Space>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Radio.Group optionType="button" value={grnType} onChange={(e) => setGrnType(e.target.value)}
          options={[{ value: '', label: 'All' }, { value: '1', label: 'Manual LR' }, { value: '2', label: 'IBA LR' }]} />
        <Input.Search placeholder="Docket number" allowClear style={{ width: 220 }} onSearch={setNumber} />
      </Space>
      <Table size="small" rowKey="id" loading={isFetching} dataSource={data}
        columns={[...columns, {
          title: '', key: 'a',
          render: (_, r) => (
            <Space>
              <Button size="small" icon={<EyeOutlined />} aria-label="Numbers" onClick={async () => {
                try { setNumbers({ row: r, list: await get(`/shippers/stock/${kind}/${r.id}/numbers`) }); } catch (e) { message.error(problem(e)); }
              }} />
              <Button size="small" icon={<EditOutlined />} aria-label="Edit" onClick={() => setEditing(r)} />
              <Popconfirm title="Delete this series?" onConfirm={async () => { if (await send(message, () => api.delete(`/shippers/stock/${kind}/${r.id}`))) refresh(); }}>
                <Button size="small" danger icon={<DeleteOutlined />} aria-label="Delete" />
              </Popconfirm>
            </Space>
          ),
        }]} />
      <StockEditor kind={kind} row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />
      <Modal title={`Series ${numbers?.row.startSeries} – ${numbers?.row.endSeries}`} open={Boolean(numbers)} onCancel={() => setNumbers(null)} footer={null} width={560}>
        <Table size="small" rowKey="number" dataSource={numbers?.list ?? []} pagination={{ defaultPageSize: 20 }}
          columns={[
            { title: 'Number', dataIndex: 'number' },
            { title: 'Status', dataIndex: 'status', render: (v) => <Tag color={v.startsWith('Issued') ? 'green' : 'red'}>{v}</Tag> },
            { title: 'Branch', dataIndex: 'branch' },
          ]} />
      </Modal>
    </Card>
  );
}
