// Bill receipt — replaces Invoice/Bill_Receive.aspx (client bills "To Be Billed", and Paid / To Pay bills).
// Pick the client: its finalized bills collected at this branch with what is still outstanding are listed. Enter, per bill,
// the amount received, TDS, deduction and a small round-off; pick cash or bank (NEFT / cheque …) and save. The voucher
// (Dr cash / bank, TDS, deduction, round-off; Cr the client's BILLED ledger, other income) is posted with the receipt.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Alert, App, Button, Card, Col, DatePicker, Descriptions, Drawer, Empty, Form, Input, InputNumber, Radio, Row, Select, Space, Table, Tabs, Tag, Typography,
} from 'antd';
import { EyeOutlined, SaveOutlined, StopOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import SearchSelect from '../../components/SearchSelect.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');
const money = (v) => Number(v || 0).toFixed(2);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const problem = (e) => {
  const details = e.response?.data?.details;
  return details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e);
};

function NewReceipt() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [client, setClient] = useState(null);
  const [lines, setLines] = useState({});   // billNo → { received, tds, deduction, roundOff }
  const [kind, setKind] = useState('client');   // client: To Be Billed bills; paidtopay: Paid / To Pay bills
  const mode = Form.useWatch('mode', form) ?? 'Cash';
  const otherIncome = Form.useWatch('otherIncome', form) ?? 0;

  const { data: opts, error: optsError } = useQuery({ queryKey: ['bill-receipt-options'], queryFn: () => api.get('/bill-receipts/options').then((r) => r.data) });
  const { data: bills = [], isFetching } = useQuery({
    queryKey: ['bill-receipt-pending', kind, client?.code],
    queryFn: () => api.get('/bill-receipts/pending-bills', { params: { kind, clientCode: client.code } }).then((r) => r.data),
    enabled: Boolean(client),
  });

  const settled = (l) => r2((l?.received || 0) + (l?.tds || 0) + (l?.deduction || 0) + (l?.roundOff || 0));
  const chosen = useMemo(() => bills.filter((b) => settled(lines[b.billNo]) > 0), [bills, lines]);
  const t = chosen.reduce((a, b) => {
    const l = lines[b.billNo];
    return { received: a.received + (l.received || 0), tds: a.tds + (l.tds || 0), deduction: a.deduction + (l.deduction || 0), settled: a.settled + settled(l) };
  }, { received: 0, tds: 0, deduction: 0, settled: 0 });
  const setLine = (billNo, patch) => setLines((ls) => ({ ...ls, [billNo]: { ...ls[billNo], ...patch } }));

  const save = useMutation({
    mutationFn: (v) => api.post('/bill-receipts', {
      kind, clientCode: client.code, receiveDate: v.receiveDate.format('YYYY-MM-DD'), mode: v.mode, bankLedger: v.bankLedger || '',
      payMode: v.mode === 'Bank' ? v.payMode || '' : '', chequeNo: v.chequeNo || '', chequeDate: v.chequeDate ? v.chequeDate.format('YYYY-MM-DD') : '',
      clientBank: v.clientBank || '', manualNo: v.manualNo || '', remarks: v.remarks || '', otherIncome: v.otherIncome || 0,
      bills: chosen.map((b) => ({ billNo: b.billNo, received: lines[b.billNo].received || 0, tds: lines[b.billNo].tds || 0, deduction: lines[b.billNo].deduction || 0, roundOff: lines[b.billNo].roundOff || 0 })),
    }),
    onSuccess: (r) => {
      modal.success({ title: 'Receipt saved', content: <>BR no. <strong>{r.data.brNo}</strong> — {r.data.bills} bill(s), ₹ {money(r.data.received)} received</> });
      setLines({});
      queryClient.invalidateQueries({ queryKey: ['bill-receipt-pending'] });
      queryClient.invalidateQueries({ queryKey: ['bill-receipts'] });
    },
    onError: (e) => message.error(problem(e)),
  });

  if (optsError) return <Alert type="error" showIcon message={errorMessage(optsError)} />;
  const num = (billNo, k, props = {}) => (
    <InputNumber size="small" style={{ width: 100 }} min={0} value={lines[billNo]?.[k]} aria-label={`${k} for ${billNo}`}
      onChange={(x) => setLine(billNo, { [k]: x ?? 0 })} {...props} />
  );

  return (
    <Form form={form} layout="vertical" initialValues={{ receiveDate: dayjs(), mode: 'Cash', payMode: 'NEFT', otherIncome: 0 }}
      onFinish={(v) => {
        if (!chosen.length) { message.warning('Enter the amount received against at least one bill'); return; }
        save.mutate(v);
      }}>
      <Row gutter={12}>
        <Col xs={24}>
          <Form.Item label="Bills">
            <Radio.Group optionType="button" value={kind} onChange={(e) => { setKind(e.target.value); setClient(null); setLines({}); }}
              options={[{ value: 'client', label: 'Client bills (To Be Billed)' }, { value: 'paidtopay', label: 'Paid / To Pay bills' }]} />
          </Form.Item>
        </Col>
        <Col xs={24} md={8}>
          <Form.Item label={kind === 'client' ? 'Client' : 'Party'} required>
            <SearchSelect key={kind} placeholder={kind === 'client' ? 'Type client name' : 'Type consignor / consignee name'} minChars={2}
              fetcher={(q) => api.get('/bill-receipts/clients', { params: { q, kind } })
                .then((r) => r.data.map((c) => ({ ...c, value: `${c.name} : ${c.code}`, label: `${c.name} : ${c.code} — ${c.bills} bill(s), ₹ ${money(c.outstanding)}` })))}
              onPick={(c) => { setClient(c); setLines({}); }}
              onChange={(v) => { if (!v) { setClient(null); setLines({}); } }} />
          </Form.Item>
        </Col>
        <Col xs={12} md={4}>
          <Form.Item label="Receive date" name="receiveDate" rules={[{ required: true }]}>
            <DatePicker format={DATE_FMT} style={{ width: '100%' }} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
          </Form.Item>
        </Col>
        <Col xs={12} md={4}>
          <Form.Item label="Received in" name="mode"><Radio.Group optionType="button" options={['Cash', 'Bank']} /></Form.Item>
        </Col>
        {mode === 'Cash' ? (
          <Col xs={24} md={8}>
            <Form.Item label="Cash ledger">
              <Input value={opts?.cash.name} disabled />
              {opts && !opts.cash.exists && <Typography.Text type="danger">Ledger {opts.cash.name} not found</Typography.Text>}
            </Form.Item>
          </Col>
        ) : (
          <>
            <Col xs={24} md={8}><Form.Item label="Bank" name="bankLedger" rules={[{ required: true, message: 'Select the bank' }]}><Select options={opts?.banks ?? []} /></Form.Item></Col>
            <Col xs={12} md={4}><Form.Item label="Payment mode" name="payMode"><Select options={(opts?.payModes ?? []).map((x) => ({ value: x, label: x }))} /></Form.Item></Col>
            <Col xs={12} md={4}><Form.Item label="Cheque / UTR no." name="chequeNo"><Input maxLength={50} /></Form.Item></Col>
            <Col xs={12} md={4}><Form.Item label="Cheque date" name="chequeDate"><DatePicker format={DATE_FMT} style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} /></Form.Item></Col>
            <Col xs={12} md={6}><Form.Item label="Client's bank" name="clientBank"><Input maxLength={100} /></Form.Item></Col>
          </>
        )}
        <Col xs={12} md={4}><Form.Item label="Manual BR no." name="manualNo"><Input maxLength={50} /></Form.Item></Col>
        <Col xs={12} md={4}><Form.Item label="Other income" name="otherIncome" extra="Extra money, not against a bill"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
        <Col xs={24} md={8}><Form.Item label="Remarks" name="remarks"><Input maxLength={500} /></Form.Item></Col>
      </Row>
      {!client ? <Empty description="Select the client to list its outstanding bills" /> : (
        <>
          <Table size="small" rowKey="billNo" loading={isFetching} dataSource={bills} pagination={false} scroll={{ x: 'max-content' }}
            locale={{ emptyText: 'No outstanding bill of this client at this branch' }}
            columns={[
              { title: 'Bill no.', dataIndex: 'billNo' },
              { title: 'Bill date', dataIndex: 'billDate', render: fmt },
              { title: 'Due', dataIndex: 'dueDate', render: (v) => (dayjs(v).isBefore(dayjs(), 'day') ? <Tag color="red">{fmt(v)}</Tag> : fmt(v)) },
              { title: 'Bill amount', dataIndex: 'billAmount', align: 'right', render: money },
              { title: 'Outstanding', dataIndex: 'outstanding', align: 'right', render: (v) => <strong>{money(v)}</strong> },
              { title: 'Received', key: 'received', render: (_, b) => num(b.billNo, 'received') },
              { title: 'TDS', key: 'tds', render: (_, b) => num(b.billNo, 'tds') },
              { title: 'Deduction', key: 'deduction', render: (_, b) => num(b.billNo, 'deduction') },
              { title: 'Round off', key: 'roundOff', render: (_, b) => num(b.billNo, 'roundOff', { min: -100, max: 100, style: { width: 80 } }) },
              {
                title: 'Balance', key: 'bal', align: 'right', render: (_, b) => {
                  const bal = r2(b.outstanding - settled(lines[b.billNo]));
                  return bal < 0 ? <Tag color="red">{money(bal)}</Tag> : money(bal);
                },
              },
              {
                title: '', key: 'full', render: (_, b) => (
                  <Button size="small" onClick={() => setLine(b.billNo, { received: r2(b.outstanding - (lines[b.billNo]?.tds || 0) - (lines[b.billNo]?.deduction || 0) - (lines[b.billNo]?.roundOff || 0)) })}>Full</Button>
                ),
              },
            ]} />
          <Space style={{ marginTop: 12, width: '100%', justifyContent: 'space-between' }} wrap>
            <Typography.Text>
              {chosen.length} bill(s) · received ₹ {money(t.received)} · TDS ₹ {money(t.tds)} · deduction ₹ {money(t.deduction)} ·
              settled ₹ {money(t.settled)} · <strong>{mode === 'Cash' ? 'cash' : 'bank'} ₹ {money(t.received + (otherIncome || 0))}</strong>
            </Typography.Text>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending} disabled={!chosen.length}>Save receipt</Button>
          </Space>
        </>
      )}
    </Form>
  );
}

function ReceiptDetail({ brNo, onClose }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: ['bill-receipt', brNo], queryFn: () => api.get(`/bill-receipts/${encodeURIComponent(brNo)}`).then((r) => r.data), enabled: Boolean(brNo),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/bill-receipts/${encodeURIComponent(brNo)}/cancel`, { remarks: reason }),
    onSuccess: (r) => { message.success(r.data.message); setReason(''); queryClient.invalidateQueries({ queryKey: ['bill-receipts'] }); queryClient.invalidateQueries({ queryKey: ['bill-receipt', brNo] }); queryClient.invalidateQueries({ queryKey: ['bill-receipt-pending'] }); },
    onError: (e) => message.error(errorMessage(e)),
  });
  return (
    <Drawer title={`Receipt ${brNo ?? ''}`} open={Boolean(brNo)} onClose={onClose} width={Math.min(900, window.innerWidth)} loading={isLoading}>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      {data && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Client">{data.clientName} : {data.clientCode}</Descriptions.Item>
            <Descriptions.Item label="Status">{data.cancelled ? <Tag color="red">Cancelled</Tag> : <Tag color="green">Received</Tag>}</Descriptions.Item>
            <Descriptions.Item label="Date">{fmt(data.receiveDate)}</Descriptions.Item>
            <Descriptions.Item label="In">{data.mode} · {data.ledger}{data.payMode && ` · ${data.payMode}`}{data.chequeNo && ` ${data.chequeNo}`}</Descriptions.Item>
            {data.remarks && <Descriptions.Item label="Remarks" span={2}>{data.remarks}</Descriptions.Item>}
            {data.cancelled && <Descriptions.Item label="Cancelled" span={2}>{data.cancelledBy} — {data.cancelRemarks}</Descriptions.Item>}
          </Descriptions>
          <Table size="small" rowKey="billNo" pagination={false} dataSource={data.bills} scroll={{ x: 'max-content' }}
            columns={[
              { title: 'Bill no.', dataIndex: 'billNo' }, { title: 'Bill date', dataIndex: 'billDate', render: fmt },
              { title: 'Bill amount', dataIndex: 'billAmount', align: 'right', render: money }, { title: 'Received', dataIndex: 'received', align: 'right', render: money },
              { title: 'TDS', dataIndex: 'tds', align: 'right', render: money }, { title: 'Deduction', dataIndex: 'deduction', align: 'right', render: money },
              { title: 'Round off', dataIndex: 'roundOff', align: 'right', render: money }, { title: 'Settled', dataIndex: 'settled', align: 'right', render: money },
            ]} />
          <Typography.Text strong>Voucher</Typography.Text>
          <Table size="small" rowKey="key" pagination={false} dataSource={data.voucher.map((v, i) => ({ ...v, key: i }))}
            columns={[{ title: 'Ledger', dataIndex: 'ledger' }, { title: 'Dr', dataIndex: 'dr', align: 'right', render: money }, { title: 'Cr', dataIndex: 'cr', align: 'right', render: money }]} />
          {!data.cancelled && (
            <Space.Compact style={{ width: '100%' }}>
              <Input placeholder="Reason for cancelling (e.g. cheque bounced)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} aria-label="Reason for cancelling" />
              <Button danger icon={<StopOutlined />} loading={cancel.isPending} disabled={reason.trim().length < 3}
                onClick={() => modal.confirm({ title: `Cancel receipt ${brNo}?`, content: 'Its voucher is cancelled and the bills become outstanding again.', okText: 'Cancel receipt', okButtonProps: { danger: true }, cancelText: 'Keep', onOk: () => cancel.mutateAsync() })}>
                Cancel receipt
              </Button>
            </Space.Compact>
          )}
        </Space>
      )}
    </Drawer>
  );
}

function Receipts() {
  const [params, setParams] = useState({ from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), status: 'active', search: '' });
  const [open, setOpen] = useState(null);
  const { data = [], isFetching, error } = useQuery({ queryKey: ['bill-receipts', params], queryFn: () => api.get('/bill-receipts', { params }).then((r) => r.data) });
  return (
    <>
      <Form layout="inline" style={{ rowGap: 8, marginBottom: 12 }} initialValues={{ range: [dayjs(params.from), dayjs(params.to)], status: 'active' }}
        onFinish={(v) => setParams({ from: v.range[0].format('YYYY-MM-DD'), to: v.range[1].format('YYYY-MM-DD'), status: v.status, search: v.search?.trim() || '' })}>
        <Form.Item name="range" label="Date"><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
        <Form.Item name="status"><Radio.Group optionType="button" options={[{ value: 'active', label: 'Active' }, { value: 'cancelled', label: 'Cancelled' }]} /></Form.Item>
        <Form.Item name="search"><Input placeholder="BR / bill no. / client" allowClear style={{ width: 200 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      <Table size="middle" rowKey="brNo" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }} pagination={{ defaultPageSize: 20, showTotal: (n) => `${n} receipts` }}
        columns={[
          { title: 'BR no.', dataIndex: 'brNo' }, { title: 'Date', dataIndex: 'receiveDate', render: fmt }, { title: 'Client', dataIndex: 'clientName' },
          { title: 'In', key: 'in', render: (_, r) => `${r.mode}${r.payMode ? ` · ${r.payMode}` : ''}` }, { title: 'Bills', dataIndex: 'bills', align: 'right' },
          { title: 'Received', dataIndex: 'received', align: 'right', render: money }, { title: 'TDS', dataIndex: 'tds', align: 'right', render: money },
          { title: 'By', dataIndex: 'createdBy' },
          { title: '', key: 'v', render: (_, r) => <Button size="small" icon={<EyeOutlined />} onClick={() => setOpen(r.brNo)}>View</Button> },
        ]} />
      <ReceiptDetail brNo={open} onClose={() => setOpen(null)} />
    </>
  );
}

export default function BillReceivePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('new');
  return (
    <Card className="page-card" title="Bill Receive" extra={<Typography.Text type="secondary">{user.currentBranch.name} : {user.currentBranch.code}</Typography.Text>}>
      <Tabs activeKey={tab} onChange={setTab} destroyOnHidden items={[
        { key: 'new', label: 'New receipt', children: <NewReceipt /> },
        { key: 'list', label: 'Receipts', children: <Receipts /> },
      ]} />
    </Card>
  );
}
