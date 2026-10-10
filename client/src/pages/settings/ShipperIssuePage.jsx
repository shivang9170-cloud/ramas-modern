// Shipper issue (replaces Setting/Shiper_Issue_Details.aspx and Setting/shiper_issue_details_to_Franchisee.aspx):
// issue part of a received series to a branch — or, with `franchisee`, to a franchisee branch with a charge per
// shipper. A single unused number can be moved to another branch.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App, Button, Card, DatePicker, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Table, Tag,
} from 'antd';
import { DeleteOutlined, EyeOutlined, FileExcelOutlined, PlusOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../api/client.js';
import { exportCsv } from '../../utils/exportTable.js';
import { date, get, money, send, ymd } from './common.js';

function IssueForm({ open, franchisee, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const opts = useQuery({ queryKey: ['shipper-options'], queryFn: () => get('/shippers/options') }).data;
  const branches = useQuery({ queryKey: ['issue-branches', franchisee], queryFn: () => get('/shippers/issue-branches', { franchisee }) }).data ?? [];
  const clients = useQuery({ queryKey: ['issue-clients'], enabled: !franchisee, queryFn: () => get('/shippers/clients') }).data ?? [];
  const [start, end, charge, branch] = [Form.useWatch('start', form), Form.useWatch('end', form), Form.useWatch('perShipperCharge', form), Form.useWatch('branch', form)];
  const qty = start && end && end >= start ? end - start + 1 : 0;

  async function pickType(t) {
    const { next } = await get('/shippers/issues/next', { shipperType: t });
    if (next) form.setFieldValue('start', next);
  }
  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    const res = await send(message, () => api.post('/shippers/issues', { ...v, franchisee, issueDate: ymd(v.issueDate), client: v.client ?? '' }));
    setSaving(false);
    if (res) onSaved();
  }
  return (
    <Drawer title={franchisee ? 'Issue shippers to franchisee' : 'Issue shippers to branch'} open={open} onClose={onClose} width={Math.min(560, window.innerWidth)} destroyOnClose
      extra={<Button type="primary" loading={saving} onClick={save}>Save</Button>}>
      <Form form={form} layout="vertical" preserve={false} initialValues={{ grnType: 1, issueDate: dayjs(), perShipperCharge: 0 }}>
        <Form.Item name="grnType" label="GRN type"><Radio.Group options={opts?.grnTypes ?? []} /></Form.Item>
        <Form.Item name="branch" label={franchisee ? 'Franchisee branch' : 'Branch'} rules={[{ required: true, message: 'Select branch' }]}
          extra={franchisee && branches.find((b) => b.value === branch)?.franchisee}>
          <Select showSearch optionFilterProp="label" options={branches} />
        </Form.Item>
        <Form.Item name="shipperType" label="Shipper type" rules={[{ required: true, message: 'Select shipper type' }]}>
          <Select options={opts?.shipperTypes ?? []} onChange={pickType} />
        </Form.Item>
        {!franchisee && <Form.Item name="client" label="Client (optional)"><Select allowClear showSearch optionFilterProp="label" options={clients} /></Form.Item>}
        <Space wrap>
          <Form.Item name="start" label="Starting series" rules={[{ required: true, message: 'Starting series required' }]}><InputNumber min={1} style={{ width: 170 }} /></Form.Item>
          <Form.Item name="end" label="End series" rules={[{ required: true, message: 'End series required' }]}><InputNumber min={1} style={{ width: 170 }} /></Form.Item>
          <Form.Item name="issueDate" label="Issue date" rules={[{ required: true, message: 'Issue date' }]}><DatePicker format="DD/MM/YYYY" /></Form.Item>
        </Space>
        {franchisee && <Form.Item name="perShipperCharge" label="Charge per shipper (₹)"><InputNumber min={0} /></Form.Item>}
        <p>Quantity: <b>{qty || '—'}</b>{franchisee && qty ? <> · Total charge: <b>₹ {money(qty * (charge || 0))}</b></> : null}</p>
      </Form>
    </Drawer>
  );
}

function NumbersModal({ issue, onClose, onChanged }) {
  const { message } = App.useApp();
  const [moving, setMoving] = useState(null);
  const [toBranch, setToBranch] = useState();
  const branches = useQuery({ queryKey: ['bind-branches'], enabled: Boolean(issue), queryFn: () => get('/bindings/branches') }).data ?? [];
  const { data, refetch } = useQuery({ queryKey: ['issue-numbers', issue?.id], enabled: Boolean(issue), queryFn: () => get(`/shippers/issues/${issue.id}/numbers`) });
  async function move() {
    if (await send(message, () => api.post(`/shippers/issues/${issue.id}/transfer`, { number: moving, toBranch }))) {
      setMoving(null); setToBranch(undefined); refetch(); onChanged();
    }
  }
  return (
    <Modal title={`Series ${issue?.startSeries} – ${issue?.endSeries} (${issue?.branchName})`} open={Boolean(issue)} onCancel={onClose} footer={null} width={640}>
      <Table size="small" rowKey="number" dataSource={data?.numbers ?? []} pagination={{ defaultPageSize: 20 }}
        columns={[
          { title: 'Number', dataIndex: 'number' },
          { title: 'Status', dataIndex: 'status', render: (v) => <Tag color={v === 'Not used' ? 'red' : v.startsWith('Moved') ? 'blue' : 'green'}>{v}</Tag> },
          {
            title: '', key: 'm',
            render: (_, r) => (r.movable && issue?.shipperType === 'GRN Shipper'
              ? <Button size="small" icon={<SwapOutlined />} onClick={() => setMoving(r.number)}>Move</Button> : null),
          },
        ]} />
      <Modal title={`Move ${moving} to another branch`} open={Boolean(moving)} onCancel={() => setMoving(null)} onOk={move} okButtonProps={{ disabled: !toBranch }}>
        <Select showSearch optionFilterProp="label" placeholder="Branch" style={{ width: '100%' }} value={toBranch} onChange={setToBranch}
          options={branches.filter((b) => b.value !== issue?.branch)} />
      </Modal>
    </Modal>
  );
}

function Transfers({ open, onClose }) {
  const { message } = App.useApp();
  const { data = [], refetch } = useQuery({ queryKey: ['shipper-transfers'], enabled: open, queryFn: () => get('/shippers/transfers') });
  return (
    <Modal title="Moved numbers" open={open} onCancel={onClose} footer={null} width={720}>
      <Table size="small" rowKey="id" dataSource={data}
        columns={[
          { title: 'Number', dataIndex: 'shipperNo' },
          { title: 'From', dataIndex: 'fromBranch' },
          { title: 'To', dataIndex: 'toBranch' },
          { title: 'On', dataIndex: 'issueDate', render: date },
          { title: 'By', dataIndex: 'userId' },
          {
            title: '', key: 'c',
            render: (_, r) => (
              <Popconfirm title="Cancel this move?" onConfirm={async () => { if (await send(message, () => api.post(`/shippers/transfers/${r.id}/cancel`))) refetch(); }}>
                <Button size="small" danger>Cancel</Button>
              </Popconfirm>
            ),
          },
        ]} />
    </Modal>
  );
}

export default function ShipperIssuePage({ franchisee = false }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [branch, setBranch] = useState();
  const [grnType, setGrnType] = useState('');
  const [number, setNumber] = useState('');
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [transfers, setTransfers] = useState(false);
  const branches = useQuery({ queryKey: ['issue-branches', franchisee], queryFn: () => get('/shippers/issue-branches', { franchisee }) }).data ?? [];
  const { data = [], isFetching } = useQuery({
    queryKey: ['shipper-issues', franchisee, branch, grnType, number],
    queryFn: () => get('/shippers/issues', { franchisee, branch: branch ?? '', grnType, number }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['shipper-issues'] });
  const columns = [
    { title: 'Branch', dataIndex: 'branchName' },
    { title: 'Shipper type', dataIndex: 'shipperType' },
    { title: 'GRN type', dataIndex: 'grnTypeName' },
    { title: 'Starting series', dataIndex: 'startSeries' },
    { title: 'End series', dataIndex: 'endSeries' },
    { title: 'Quantity', dataIndex: 'quantity', align: 'right' },
    { title: 'Issued', dataIndex: 'issueDate', render: date, exportValue: date },
    ...(franchisee
      ? [{ title: 'Charge / shipper', dataIndex: 'perShipperCharge', align: 'right', render: money }, { title: 'Total charge', dataIndex: 'totalCharge', align: 'right', render: money }]
      : [{ title: 'Client', dataIndex: 'clientName' }]),
  ];
  return (
    <Card className="page-card" title={franchisee ? 'Shipper Issue To Franchisee' : 'Shipper Issue To Branch'}
      extra={<Space>
        {!franchisee && <Button icon={<SwapOutlined />} onClick={() => setTransfers(true)}>Moved numbers</Button>}
        <Button icon={<FileExcelOutlined />} disabled={!data.length} onClick={() => exportCsv(franchisee ? 'Shiper_issue_details_franchisee' : 'Shiper_issue_details', columns, data)}>Export</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>Issue</Button>
      </Space>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select allowClear showSearch optionFilterProp="label" placeholder="Branch" style={{ width: 260 }} options={branches} value={branch} onChange={setBranch} />
        <Radio.Group optionType="button" value={grnType} onChange={(e) => setGrnType(e.target.value)}
          options={[{ value: '', label: 'All' }, { value: '1', label: 'Manual LR' }, { value: '2', label: 'IBA LR' }]} />
        <Input.Search placeholder="Docket number" allowClear style={{ width: 200 }} onSearch={setNumber} />
      </Space>
      <Table size="small" rowKey="id" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }}
        columns={[...columns, {
          title: '', key: 'a',
          render: (_, r) => (
            <Space>
              <Button size="small" icon={<EyeOutlined />} aria-label="Numbers" onClick={() => setViewing(r)} />
              <Popconfirm title="Delete this issue?" onConfirm={async () => { if (await send(message, () => api.delete(`/shippers/issues/${r.id}`))) refresh(); }}>
                <Button size="small" danger icon={<DeleteOutlined />} aria-label="Delete" />
              </Popconfirm>
            </Space>
          ),
        }]} />
      <IssueForm open={adding} franchisee={franchisee} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />
      <NumbersModal issue={viewing} onClose={() => setViewing(null)} onChanged={refresh} />
      <Transfers open={transfers} onClose={() => setTransfers(false)} />
    </Card>
  );
}
