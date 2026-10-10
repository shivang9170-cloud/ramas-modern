// Contra Entry — replaces Accounts/Contra_Entry.aspx.
// Move money between the firm's own Cash / Bank ledgers. Automated single transfer: pick From (credited) and
// To (debited), enter the amount — the balanced voucher is built for you. Each account shows its current balance.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, DatePicker, Drawer, Form, Input, InputNumber, Popconfirm, Radio, Select, Space, Statistic, Table, Tag, Typography, Tabs,
} from 'antd';
import { ArrowRightOutlined, SaveOutlined, SwapOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const money = (v) => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const balTag = (l) => (l ? <Tag color={l.balance > 0 ? 'green' : l.balance < 0 ? 'red' : 'default'}>Balance: ₹ {money(l.balance)}</Tag> : null);

function NewContra() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const fromCode = Form.useWatch('from', form);
  const toCode = Form.useWatch('to', form);
  const amount = Form.useWatch('amount', form);

  const { data: ledgers = [], isFetching: loadingLedgers } = useQuery({
    queryKey: ['contra-ledgers', user.divCode, user.financialYear],
    queryFn: () => api.get('/contra-entries/ledgers').then((r) => r.data),
  });
  const { data: next } = useQuery({
    queryKey: ['contra-next', user.currentBranch?.code, user.financialYear],
    queryFn: () => api.get('/contra-entries/next-no').then((r) => r.data),
  });

  useEffect(() => { form.setFieldsValue({ contraDate: dayjs() }); }, [form]);

  const byCode = useMemo(() => new Map(ledgers.map((l) => [l.value, l])), [ledgers]);
  const from = byCode.get(fromCode);
  const to = byCode.get(toCode);
  const options = ledgers.map((l) => ({ value: l.value, label: `${l.label}  ·  ₹ ${money(l.balance)}` }));
  const shortAmt = from && !from.od && Number(amount) > from.balance;

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    if (v.from === v.to) { message.error('From and To must be different accounts'); return; }
    setSaving(true);
    try {
      const payload = {
        contraDate: v.contraDate.format('YYYY-MM-DD'),
        refNo: v.refNo || '', chequeNo: v.chequeNo || '', narration: v.narration || '',
        debits: [{ ledger: v.to, amount: v.amount }],      // money in  → debit the To account
        credits: [{ ledger: v.from, amount: v.amount }],   // money out → credit the From account
      };
      const { data } = await api.post('/contra-entries', payload);
      message.success(data.message);
      form.resetFields();
      form.setFieldsValue({ contraDate: dayjs() });
      queryClient.invalidateQueries({ queryKey: ['contra-ledgers'] });
      queryClient.invalidateQueries({ queryKey: ['contra-next'] });
      queryClient.invalidateQueries({ queryKey: ['contra-list'] });
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? details.map((d) => d.message).join('; ') : errorMessage(e));
    } finally { setSaving(false); }
  }

  function swap() {
    form.setFieldsValue({ from: toCode, to: fromCode });
  }

  return (
    <Form form={form} layout="vertical" style={{ maxWidth: 760 }}>
      <Space wrap style={{ marginBottom: 8 }}>
        <Tag color="blue">Contra No: {next?.contraNo ?? '…'}</Tag>
        <Typography.Text type="secondary">FY {user.financialYear} · {user.currentBranch?.name}</Typography.Text>
      </Space>
      <Space size={16} wrap style={{ display: 'flex' }} align="start">
        <Form.Item name="contraDate" label="Date" rules={[{ required: true, message: 'Select date' }]}>
          <DatePicker format="DD/MM/YYYY" allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        </Form.Item>
        <Form.Item name="refNo" label="Reference no."><Input maxLength={50} style={{ width: 180 }} /></Form.Item>
        <Form.Item name="chequeNo" label="Cheque / UTR no."><Input maxLength={50} style={{ width: 180 }} /></Form.Item>
      </Space>

      <Card size="small" style={{ background: 'var(--accent-soft)', marginBottom: 12 }}>
        <Space size={12} align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <Form.Item name="from" label="From account (money out · credited)" rules={[{ required: true, message: 'Select the From account' }]} style={{ marginBottom: 4 }}>
              <Select showSearch optionFilterProp="label" loading={loadingLedgers} options={options} placeholder="Cash / bank account" />
            </Form.Item>
            {balTag(from)}
          </div>
          <Button shape="circle" icon={<SwapOutlined />} onClick={swap} title="Swap From / To" style={{ marginTop: 8 }} />
          <div style={{ flex: 1, minWidth: 240 }}>
            <Form.Item name="to" label="To account (money in · debited)" rules={[{ required: true, message: 'Select the To account' }]} style={{ marginBottom: 4 }}>
              <Select showSearch optionFilterProp="label" loading={loadingLedgers} options={options} placeholder="Cash / bank account" />
            </Form.Item>
            {balTag(to)}
          </div>
        </Space>
      </Card>

      <Space size={16} wrap align="start">
        <Form.Item name="amount" label="Amount" rules={[{ required: true, message: 'Enter amount' }, { type: 'number', min: 0.01, message: 'Greater than 0' }]}
          validateStatus={shortAmt ? 'warning' : undefined} help={shortAmt ? `Only ₹ ${money(from.balance)} available in ${from.label}` : undefined}>
          <InputNumber min={0} step={100} style={{ width: 220 }} prefix="₹"
            formatter={(val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={(val) => val.replace(/,/g, '')} />
        </Form.Item>
      </Space>

      {from && to && Number(amount) > 0 && (
        <Alert type="info" showIcon style={{ margin: '4px 0 12px' }}
          message={<Space wrap>{from.label} <ArrowRightOutlined /> {to.label} <strong>₹ {money(amount)}</strong></Space>} />
      )}

      <Form.Item name="narration" label="Narration (auto; editable)"><Input.TextArea rows={2} maxLength={500} placeholder="Auto-filled if left blank" /></Form.Item>

      <Button type="primary" size="large" icon={<SaveOutlined />} loading={saving} onClick={save}>Save contra</Button>
    </Form>
  );
}

function ViewDrawer({ no, onClose }) {
  const { data, isFetching } = useQuery({ queryKey: ['contra', no], enabled: Boolean(no), queryFn: () => api.get(`/contra-entries/${no}`).then((r) => r.data) });
  return (
    <Drawer open={Boolean(no)} onClose={onClose} width={Math.min(560, window.innerWidth)} title={`Contra ${no ?? ''}`} loading={isFetching}>
      {data && (
        <>
          <Space direction="vertical" style={{ marginBottom: 12 }}>
            <Typography.Text>Date: <strong>{data.contraDate}</strong>{data.cancelled && <Tag color="red" style={{ marginLeft: 8 }}>Cancelled</Tag>}</Typography.Text>
            {data.refNo && <Typography.Text type="secondary">Ref: {data.refNo}</Typography.Text>}
            {data.chequeNo && <Typography.Text type="secondary">Cheque / UTR: {data.chequeNo}</Typography.Text>}
          </Space>
          <Table size="small" pagination={false} rowKey={(r) => r.code + r.side}
            dataSource={[
              ...data.debits.map((d) => ({ ...d, side: 'Dr' })),
              ...data.credits.map((c) => ({ ...c, side: 'Cr' })),
            ]}
            columns={[
              { title: 'Ledger', dataIndex: 'ledger' },
              { title: 'Dr', align: 'right', className: 'money', render: (_, r) => (r.side === 'Dr' ? money(r.amount) : '') },
              { title: 'Cr', align: 'right', className: 'money', render: (_, r) => (r.side === 'Cr' ? money(r.amount) : '') },
            ]}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}><strong>Total</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right" className="money"><strong>{money(data.amount)}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right" className="money"><strong>{money(data.amount)}</strong></Table.Summary.Cell>
              </Table.Summary.Row>
            )} />
          {data.narration && <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>{data.narration}</Typography.Paragraph>}
          {data.cancelled && data.cancelRemarks && <Alert type="warning" showIcon message={`Cancelled: ${data.cancelRemarks}`} />}
        </>
      )}
    </Drawer>
  );
}

function ContraList() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const fy = String(user.financialYear).split('-');
  const [range, setRange] = useState([dayjs(`${fy[0]}-04-01`), dayjs(`${fy[1]}-03-31`)]);
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [view, setView] = useState(null);
  const canEdit = ['admin', 'employee'].includes(user.role);

  const { data = [], isFetching } = useQuery({
    queryKey: ['contra-list', range[0].format('YYYY-MM-DD'), range[1].format('YYYY-MM-DD'), status, q, user.divCode, user.currentBranch?.code],
    queryFn: () => api.get('/contra-entries', { params: { from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD'), status, q } }).then((r) => r.data),
  });
  const cancel = useMutation({
    mutationFn: (no) => api.post(`/contra-entries/${no}/cancel`, { remarks: 'Cancelled from list' }),
    onSuccess: (r) => { message.success(r.data.message); queryClient.invalidateQueries({ queryKey: ['contra-list'] }); queryClient.invalidateQueries({ queryKey: ['contra-ledgers'] }); },
    onError: (e) => message.error(errorMessage(e)),
  });

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <DatePicker.RangePicker format="DD/MM/YYYY" allowClear={false} value={range} onChange={(v) => v && setRange(v)} />
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: 'active', label: 'Active' }, { value: 'cancelled', label: 'Cancelled' }]} />
        <Input.Search placeholder="Contra no, ref or narration" allowClear onSearch={setQ} style={{ width: 260 }} />
      </Space>
      <Table size="middle" rowKey="contraNo" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        columns={[
          { title: 'Contra No', dataIndex: 'contraNo', render: (v) => <a onClick={() => setView(v)}>{v}</a> },
          { title: 'Date', dataIndex: 'contraDate' },
          { title: 'Amount', dataIndex: 'amount', align: 'right', className: 'money', render: (v) => money(v) },
          { title: 'Ref', dataIndex: 'refNo', render: (v) => v || '—' },
          { title: 'Narration', dataIndex: 'narration', ellipsis: true },
          { title: 'By', dataIndex: 'createdBy' },
          { title: 'Status', dataIndex: 'cancelled', render: (v) => (v ? <Tag color="red">Cancelled</Tag> : <Tag color="green">Active</Tag>) },
          {
            title: '', key: 'a', width: 90,
            render: (_, r) => canEdit && !r.cancelled && (
              <Popconfirm title={`Cancel ${r.contraNo}?`} description="The voucher entries will be reversed." okText="Cancel contra" okButtonProps={{ danger: true }}
                onConfirm={() => cancel.mutateAsync(r.contraNo)}>
                <Button size="small" danger>Cancel</Button>
              </Popconfirm>
            ),
          },
        ]} />
      <ViewDrawer no={view} onClose={() => setView(null)} />
    </>
  );
}

export default function ContraEntryPage({ defaultTab = 'new' }) {
  const [tab, setTab] = useState(defaultTab);
  return (
    <Card className="page-card" title="Contra Entry">
      <Tabs activeKey={tab} onChange={setTab}
        items={[
          { key: 'new', label: 'New entry', children: <NewContra /> },
          { key: 'list', label: 'View / cancel', children: <ContraList /> },
        ]} />
    </Card>
  );
}
