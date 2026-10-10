// Payment Entry - replaces Accounts/Payment_Entry.aspx.
// The voucher (Dr / Cr) is built automatically from the payment type:
//   Expense        Main Ledger -> Sub-Ledger (with "+ Sub-Ledger", same as Account Master)
//   Advance        driver / employee - posted to his sub-ledger under DRIVER ADVANCE / STAFF ADVANCE
//   Other Ledger   any other postable ledger (vendor, creditor ...)
// Advance Register: advance given / adjusted / balance per person; "Adjust" posts a journal against an expense sub-ledger.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Checkbox, DatePicker, Descriptions, Drawer, Form, Input, InputNumber, Popconfirm, Radio, Segmented, Select, Space,
  Table, Tag, Typography, Tabs,
} from 'antd';
import { Drawer as AntDrawer } from 'antd/es/index.js'; // real antd Drawer (not the preset-aware wrapper) for the entry panels
import { PlusOutlined, WalletOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { MainSubLedgerFields } from '../../components/accounts/SubLedger.jsx';

const money = (v) => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const KIND = {
  EXPENSE: { label: 'Expense', color: 'orange' },
  ADVANCE: { label: 'Advance', color: 'blue' },
  ADV_ADJUST: { label: 'Advance Adjustment', color: 'purple' },
  GENERAL: { label: 'Vendor / Party', color: 'default' },
};
const BILL_KEY = (b) => `${b.billType}|${b.billNo}`;

/** Oldest-first allocation of `amount` over open bills → Map(billKey → amount). */
function autoAllocate(bills, amount) {
  const out = new Map();
  let left = Math.round((Number(amount) || 0) * 100) / 100;
  for (const b of bills) {
    if (left <= 0) break;
    const take = Math.min(b.due, left);
    out.set(BILL_KEY(b), Math.round(take * 100) / 100);
    left = Math.round((left - take) * 100) / 100;
  }
  return out;
}

/** Open bills of the party being paid: tick / edit what this payment settles; the rest stays on account. */
function BillsPicker({ data, loading, alloc, setAlloc, amount, onAmount }) {
  const bills = data?.bills ?? [];
  const allocated = Math.round([...alloc.values()].reduce((a, v) => a + (Number(v) || 0), 0) * 100) / 100;
  const onAccount = Math.round(((Number(amount) || 0) - allocated) * 100) / 100;
  // ticking / editing bills: the payment amount = what is ticked (Auto-allocate keeps the typed amount instead)
  const set = (next) => {
    setAlloc(next);
    const sum = Math.round([...next.values()].reduce((a, v) => a + (Number(v) || 0), 0) * 100) / 100;
    if (sum > 0) onAmount(sum);
  };
  if ((!data && !loading) || data?.billWise === false) return null;
  return (
    <Card size="small" style={{ marginBottom: 16 }} loading={loading}
      title={<Space>Open bills<Tag>{bills.length}</Tag><Typography.Text type="secondary" style={{ fontWeight: 'normal' }}>due ₹ {money(data?.totalDue)}</Typography.Text></Space>}
      extra={bills.length > 0 && (
        <Space size={4}>
          <Button size="small" disabled={!(Number(amount) > 0)} title="Spread the amount entered over the oldest bills"
            onClick={() => setAlloc(autoAllocate(bills, amount))}>Auto-allocate</Button>
          <Button size="small" onClick={() => setAlloc(new Map())}>Clear</Button>
        </Space>
      )}>
      {bills.length > 0 && !alloc.size && (
        <Typography.Paragraph type="secondary" style={{ margin: '0 0 8px' }}>
          Tick the bills to pay (the amount fills in), or type an amount and press Auto-allocate.
        </Typography.Paragraph>
      )}
      {bills.length ? (
        <Table size="small" rowKey={BILL_KEY} pagination={false} dataSource={bills} scroll={{ y: 260 }}
          rowSelection={{
            selectedRowKeys: [...alloc.keys()],
            onChange: (keys) => {
              const next = new Map();
              for (const k of keys) next.set(k, alloc.get(k) ?? bills.find((b) => BILL_KEY(b) === k)?.due ?? 0);
              set(next);
            },
          }}
          columns={[
            { title: 'Bill', dataIndex: 'billNo', render: (v, b) => <Space direction="vertical" size={0}><span>{b.billType === 'OPENING' ? 'Opening balance' : v}</span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>{b.source}{b.date ? ` · ${dayjs(b.date).format('DD/MM/YYYY')}` : ''}</Typography.Text></Space> },
            { title: 'Due', dataIndex: 'due', width: 110, align: 'right', render: (v, b) => <span title={`Bill ${money(b.amount)}, paid ${money(b.paid)}`}>{money(v)}</span> },
            {
              title: 'Pay now', key: 'pay', width: 130, align: 'right',
              render: (_, b) => (alloc.has(BILL_KEY(b)) ? (
                <InputNumber size="small" min={0.01} max={b.due} step={100} value={alloc.get(BILL_KEY(b))} style={{ width: 115 }}
                  onChange={(v) => { const next = new Map(alloc); next.set(BILL_KEY(b), v ?? 0); set(next); }} />
              ) : <Typography.Text type="secondary">—</Typography.Text>),
            },
          ]} />
      ) : <Typography.Text type="secondary">No open bills. The payment will be recorded on account.</Typography.Text>}
      {allocated > 0 && (
        <Typography.Paragraph style={{ margin: '8px 0 0' }}>
          Against bills: <strong>₹ {money(allocated)}</strong>{onAccount > 0 && <> · On account: <strong>₹ {money(onAccount)}</strong></>}
          {onAccount < 0 && <Typography.Text type="danger"> · Bills exceed the amount</Typography.Text>}
        </Typography.Paragraph>
      )}
    </Card>
  );
}
const amountInput = {
  min: 0, step: 100, style: { width: 220 }, prefix: '₹',
  formatter: (val) => `${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ','), parser: (val) => val.replace(/,/g, ''),
};

function useOptions() {
  const { user } = useAuth();
  return useQuery({ queryKey: ['pay-options', user.divCode, user.financialYear], queryFn: () => api.get('/payments/options').then((r) => r.data) });
}

function personOptions(people = []) {
  const opt = (p) => ({ value: p.key, label: p.advance ? `${p.name}  (advance ₹ ${money(p.advance)})` : p.name });
  return [
    { label: 'Drivers', options: people.filter((p) => p.type === 'DRIVER').map(opt) },
    { label: 'Employees', options: people.filter((p) => p.type === 'EMPLOYEE').map(opt) },
  ].filter((g) => g.options.length);
}
const toPerson = (key) => {
  if (!key) return null;
  const [type, ...rest] = String(key).split(':');
  return { type, id: rest.join(':') };
};

function invalidateAll(queryClient) {
  for (const k of ['payables', 'pay-from', 'pay-next', 'payment-list', 'pay-options', 'pay-advances', 'pay-open-bills', 'books', 'account-ledgers', 'account-options']) {
    queryClient.invalidateQueries({ queryKey: [k] });
  }
}

const apiError = (message, e) => {
  const details = e.response?.data?.details;
  message.error(details?.length ? details.map((d) => d.message).join('; ') : errorMessage(e));
};

// ---- New Payment panel ---------------------------------------------------------------------------------------------
function PaymentPanel({ open, preset, onClose, onSaved }) {
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState('EXPENSE');
  const payFrom = Form.useWatch('payFrom', form);
  const amount = Form.useWatch('amount', form);

  const { data: opts } = useOptions();
  const { data: accounts = [] } = useQuery({ queryKey: ['pay-from', user.divCode, user.financialYear], enabled: open, queryFn: () => api.get('/payments/pay-from').then((r) => r.data) });
  const { data: next } = useQuery({ queryKey: ['pay-next', user.currentBranch?.code, user.financialYear], enabled: open, queryFn: () => api.get('/payments/next-no').then((r) => r.data) });
  const { data: ledgers = [] } = useQuery({ queryKey: ['pay-to', user.divCode, user.financialYear], enabled: open && kind === 'GENERAL', queryFn: () => api.get('/payments/pay-to').then((r) => r.data) });
  const payTo = Form.useWatch('payTo', form);
  const [alloc, setAlloc] = useState(new Map());
  const bills = useQuery({
    queryKey: ['pay-open-bills', payTo, user.divCode, user.financialYear], enabled: open && kind === 'GENERAL' && Boolean(payTo),
    queryFn: () => api.get('/payments/open-bills', { params: { ledger: payTo } }).then((r) => r.data),
  });

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setAlloc(new Map());
    setKind(preset?.kind ?? 'EXPENSE');
    // vendor / party: the amount comes from the bills ticked (or is typed), never the whole balance by default
    form.setFieldsValue({ paymentDate: dayjs(), payTo: preset?.code, person: preset?.personKey });
  }, [open, preset, form]);
  // a different party: start again
  useEffect(() => { setAlloc(new Map()); }, [payTo]);

  const fromAcc = accounts.find((a) => a.value === payFrom);
  const short = fromAcc && !fromAcc.od && Number(amount) > fromAcc.balance;

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const body = {
        kind, paymentDate: v.paymentDate.format('YYYY-MM-DD'), payFrom: v.payFrom, amount: v.amount,
        refNo: v.refNo || '', chequeNo: v.chequeNo || '', narration: v.narration || '',
      };
      if (kind === 'EXPENSE') Object.assign(body, { mainLedger: v.mainLedger, subLedger: v.subLedger });
      if (kind === 'ADVANCE') body.person = toPerson(v.person);
      if (kind === 'GENERAL') {
        body.payTo = v.payTo;
        body.bills = [...alloc.entries()].filter(([, a]) => Number(a) > 0)
          .map(([k, a]) => { const [billType, ...no] = k.split('|'); return { billType, billNo: no.join('|'), amount: Number(a) }; });
      }
      const { data } = await api.post('/payments', body);
      message.success(data.message);
      onSaved();
    } catch (e) { apiError(message, e); } finally { setSaving(false); }
  }

  return (
    <AntDrawer open={open} onClose={onClose} title="New Payment" placement="right" width={Math.min(kind === 'GENERAL' ? 680 : 560, window.innerWidth)}
      extra={<Tag color="blue">Voucher No: {next?.paymentNo ?? '…'}</Tag>}
      footer={(
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography.Text>Amount: <strong>₹ {money(amount)}</strong></Typography.Text>
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" loading={saving} onClick={save}>Save Payment</Button>
          </Space>
        </div>
      )}>
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item label="Payment Type">
          <Segmented block value={kind} onChange={setKind} options={opts?.kinds ?? Object.entries(KIND).filter(([k]) => k !== 'ADV_ADJUST').map(([value, k]) => ({ value, label: k.label }))} />
        </Form.Item>

        {kind === 'EXPENSE' && (
          <MainSubLedgerFields form={form} mains={opts?.mains ?? []} onCreated={() => queryClient.invalidateQueries({ queryKey: ['pay-options'] })} />
        )}
        {kind === 'ADVANCE' && (
          <Form.Item name="person" label="Driver / Employee" rules={[{ required: true, message: 'Select the driver / employee' }]}
            extra="Posted to the person's sub-ledger under DRIVER ADVANCE / STAFF ADVANCE.">
            <Select showSearch optionFilterProp="label" placeholder="Select" options={personOptions(opts?.people)} />
          </Form.Item>
        )}
        {kind === 'GENERAL' && (
          <Form.Item name="payTo" label="Pay To (vendor / party ledger)" rules={[{ required: true, message: 'Select the ledger' }]}>
            <Select showSearch optionFilterProp="label" placeholder="Vendor / creditor / other ledger"
              options={ledgers.map((t) => ({ value: t.value, label: t.owed > 0 ? `${t.label}  (payable ₹ ${money(t.owed)})` : t.label }))} />
          </Form.Item>
        )}
        {kind === 'GENERAL' && payTo && (
          <BillsPicker data={bills.data} loading={bills.isFetching} alloc={alloc} setAlloc={setAlloc} amount={amount}
            onAmount={(v) => form.setFieldsValue({ amount: v })} />
        )}

        <Space size={16} align="start" wrap style={{ display: 'flex' }}>
          <Form.Item name="amount" label="Amount" rules={[{ required: true, message: 'Enter the amount' }, { type: 'number', min: 0.01, message: 'Must be greater than 0' }]}
            validateStatus={short ? 'warning' : undefined} help={short ? `Available in ${fromAcc.label}: ₹ ${money(fromAcc.balance)}` : undefined}>
            <InputNumber {...amountInput} />
          </Form.Item>
          <Form.Item name="paymentDate" label="Date" rules={[{ required: true, message: 'Select the date' }]}>
            <DatePicker format="DD/MM/YYYY" allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
          </Form.Item>
        </Space>

        <Form.Item name="payFrom" label="Paid From (Cash / Bank)" rules={[{ required: true, message: 'Select the cash / bank account' }]}>
          <Select showSearch optionFilterProp="label" placeholder="Select account"
            options={accounts.map((a) => ({ value: a.value, label: `${a.label}  (balance ₹ ${money(a.balance)})` }))} />
        </Form.Item>

        <Space size={16} wrap>
          <Form.Item name="refNo" label="Reference No."><Input maxLength={50} style={{ width: 180 }} /></Form.Item>
          <Form.Item name="chequeNo" label="Cheque / UTR No."><Input maxLength={50} style={{ width: 180 }} /></Form.Item>
        </Space>
        <Form.Item name="narration" label="Narration" extra="Generated automatically when left blank."><Input.TextArea rows={2} maxLength={500} /></Form.Item>
      </Form>
    </AntDrawer>
  );
}

// ---- Adjust Advance (journal) --------------------------------------------------------------------------------------
function AdjustPanel({ person, onClose, onSaved }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const { data: opts } = useOptions();
  useEffect(() => { if (person) { form.resetFields(); form.setFieldsValue({ paymentDate: dayjs() }); } }, [person, form]);

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const { data } = await api.post('/payments/adjust-advance', {
        paymentDate: v.paymentDate.format('YYYY-MM-DD'), person: toPerson(person.key), amount: v.amount,
        mainLedger: v.mainLedger, subLedger: v.subLedger, refNo: v.refNo || '', narration: v.narration || '',
      });
      message.success(data.message);
      onSaved();
    } catch (e) { apiError(message, e); } finally { setSaving(false); }
  }

  return (
    <AntDrawer open={Boolean(person)} onClose={onClose} title="Adjust Advance (Journal)" width={Math.min(520, window.innerWidth)}
      footer={(
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" loading={saving} onClick={save}>Post Adjustment</Button>
        </div>
      )}>
      {person && (
        <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}
          items={[
            { key: 'n', label: person.type === 'DRIVER' ? 'Driver' : 'Employee', children: person.name },
            { key: 'b', label: 'Advance balance', children: <strong>₹ {money(person.balance)}</strong> },
            { key: 'e', label: 'Entry', children: 'Dr expense sub-ledger · Cr advance (no cash movement)' },
          ]} />
      )}
      <Form form={form} layout="vertical" requiredMark="optional">
        <MainSubLedgerFields form={form} mains={opts?.mains ?? []} onCreated={() => queryClient.invalidateQueries({ queryKey: ['pay-options'] })} />
        <Space size={16} wrap align="start">
          <Form.Item name="amount" label="Amount"
            rules={[{ required: true, message: 'Enter the amount' }, { type: 'number', min: 0.01, max: person?.balance || undefined, message: `Up to ₹ ${money(person?.balance)}` }]}>
            <InputNumber {...amountInput} />
          </Form.Item>
          <Form.Item name="paymentDate" label="Date" rules={[{ required: true, message: 'Select the date' }]}>
            <DatePicker format="DD/MM/YYYY" allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
          </Form.Item>
        </Space>
        <Form.Item name="refNo" label="Reference / Bill No."><Input maxLength={50} /></Form.Item>
        <Form.Item name="narration" label="Narration" extra="Generated automatically when left blank."><Input.TextArea rows={2} maxLength={500} /></Form.Item>
      </Form>
    </AntDrawer>
  );
}

// ---- tab: Payments -------------------------------------------------------------------------------------------------
function Payments() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [panel, setPanel] = useState(null);
  const [show, setShow] = useState('all');

  const { data: rows = [], isFetching } = useQuery({
    queryKey: ['payables', q, user.divCode, user.financialYear],
    queryFn: () => api.get('/payments/payables', { params: { q } }).then((r) => r.data),
  });
  const totalPayable = useMemo(() => rows.reduce((a, r) => a + r.owed, 0), [rows]);
  const payableCount = useMemo(() => rows.filter((r) => r.owed > 0).length, [rows]);
  const shown = show === 'payable' ? rows.filter((r) => r.owed > 0) : rows;

  return (
    <>
      <Space wrap style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Space wrap>
          <Input.Search placeholder="Search ledger" allowClear onSearch={setQ} style={{ width: 240 }} />
          <Radio.Group optionType="button" value={show} onChange={(e) => setShow(e.target.value)}
            options={[{ value: 'all', label: `All Ledgers (${rows.length})` }, { value: 'payable', label: `Payable (${payableCount})` }]} />
          <Typography.Text type="secondary">Total payable: <strong>₹ {money(totalPayable)}</strong></Typography.Text>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setPanel({ kind: 'EXPENSE' })}>New Payment</Button>
      </Space>
      <Table size="middle" rowKey="code" loading={isFetching} dataSource={shown} scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        rowClassName={(r) => (r.owed > 0 ? 'row-owed' : '')}
        columns={[
          { title: 'Ledger', dataIndex: 'name', sorter: (a, b) => a.name.localeCompare(b.name) },
          { title: 'Main Ledger', dataIndex: 'mainLedger', render: (v) => v || '—' },
          { title: 'Group', dataIndex: 'group', render: (v) => v || '—' },
          { title: 'Balance', dataIndex: 'balance', align: 'right', className: 'money', render: (v) => `₹ ${money(Math.abs(v))} ${v < 0 ? 'Cr' : 'Dr'}` },
          { title: 'Payable', dataIndex: 'owed', align: 'right', className: 'money', sorter: (a, b) => a.owed - b.owed,
            render: (v) => (v > 0 ? <strong>₹ {money(v)}</strong> : <Typography.Text type="secondary">—</Typography.Text>) },
          { title: '', key: 'a', width: 80, render: (_, r) => <Button size="small" onClick={() => setPanel({ kind: 'GENERAL', code: r.code, owed: r.owed })}>Pay</Button> },
        ]}
        summary={() => (shown.length ? (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={4}><strong>Total payable</strong></Table.Summary.Cell>
            <Table.Summary.Cell index={4} align="right" className="money"><strong>₹ {money(totalPayable)}</strong></Table.Summary.Cell>
            <Table.Summary.Cell index={5} />
          </Table.Summary.Row>
        ) : null)}
      />
      <PaymentPanel open={panel !== null} preset={panel} onClose={() => setPanel(null)} onSaved={() => { setPanel(null); invalidateAll(queryClient); }} />
    </>
  );
}

// ---- tab: Advance Register -----------------------------------------------------------------------------------------
function AdvanceRegister() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: opts, isFetching } = useOptions();
  const { data: reg = [] } = useQuery({ queryKey: ['pay-advances', user.divCode, user.financialYear], queryFn: () => api.get('/payments/advances').then((r) => r.data) });
  const [panel, setPanel] = useState(null);
  const [adjust, setAdjust] = useState(null);
  const [q, setQ] = useState('');
  const [openOnly, setOpenOnly] = useState(false);

  const regBy = useMemo(() => new Map(reg.map((r) => [r.key, r])), [reg]);
  const rows = (opts?.people ?? [])
    .map((p) => ({ ...p, given: regBy.get(p.key)?.given ?? 0, adjusted: regBy.get(p.key)?.adjusted ?? 0, balance: p.advance }))
    .filter((p) => (!q || p.name.toLowerCase().includes(q.toLowerCase())) && (!openOnly || p.balance > 0))
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  const outstanding = rows.reduce((a, r) => a + Math.max(r.balance, 0), 0);
  const done = () => { setPanel(null); setAdjust(null); invalidateAll(queryClient); };

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search placeholder="Search driver / employee" allowClear onSearch={setQ} style={{ width: 240 }} />
        <Checkbox checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)}>Outstanding only</Checkbox>
        <Typography.Text type="secondary">Total outstanding: <strong>₹ {money(outstanding)}</strong></Typography.Text>
      </Space>
      <Table size="middle" rowKey="key" loading={isFetching} dataSource={rows} scroll={{ x: 'max-content' }} pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Category', dataIndex: 'type', render: (v) => (v === 'DRIVER' ? 'Driver' : 'Employee') },
          { title: 'Mobile', dataIndex: 'mobile', render: (v) => v || '—' },
          { title: 'Advance Given', dataIndex: 'given', align: 'right', className: 'money', render: (v) => money(v) },
          { title: 'Adjusted', dataIndex: 'adjusted', align: 'right', className: 'money', render: (v) => money(v) },
          { title: 'Balance', dataIndex: 'balance', align: 'right', className: 'money', render: (v) => <strong>₹ {money(v)}</strong> },
          {
            title: '', key: 'a', width: 200,
            render: (_, r) => (
              <Space>
                <Button size="small" onClick={() => setPanel({ kind: 'ADVANCE', personKey: r.key })}>Pay Advance</Button>
                <Button size="small" disabled={!(r.balance > 0)} onClick={() => setAdjust(r)}>Adjust</Button>
              </Space>
            ),
          },
        ]} />
      <PaymentPanel open={panel !== null} preset={panel} onClose={() => setPanel(null)} onSaved={done} />
      <AdjustPanel person={adjust} onClose={() => setAdjust(null)} onSaved={done} />
    </>
  );
}

// ---- tab: View / Cancel --------------------------------------------------------------------------------------------
function PaymentList() {
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
    queryKey: ['payment-list', range[0].format('YYYY-MM-DD'), range[1].format('YYYY-MM-DD'), status, q, user.divCode, user.currentBranch?.code],
    queryFn: () => api.get('/payments', { params: { from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD'), status, q } }).then((r) => r.data),
  });
  const cancel = useMutation({
    mutationFn: (no) => api.post(`/payments/${no}/cancel`, { remarks: 'Cancelled from list' }),
    onSuccess: (r) => { message.success(r.data.message); invalidateAll(queryClient); },
    onError: (e) => apiError(message, e),
  });

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <DatePicker.RangePicker format="DD/MM/YYYY" allowClear={false} value={range} onChange={(v) => v && setRange(v)} />
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: 'active', label: 'Active' }, { value: 'cancelled', label: 'Cancelled' }]} />
        <Input.Search placeholder="Voucher no, ledger, person or narration" allowClear onSearch={setQ} style={{ width: 300 }} />
      </Space>
      <Table size="middle" rowKey="paymentNo" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        columns={[
          { title: 'Voucher No', dataIndex: 'paymentNo', render: (v) => <a onClick={() => setView(v)}>{v}</a> },
          { title: 'Date', dataIndex: 'paymentDate', render: (v) => dayjs(v).format('DD/MM/YYYY') },
          { title: 'Type', dataIndex: 'kind', render: (v) => <Tag color={KIND[v]?.color}>{KIND[v]?.label ?? v}</Tag> },
          { title: 'Main Ledger', dataIndex: 'mainLedger', render: (v) => v || '—' },
          { title: 'Ledger (Dr)', dataIndex: 'payTo' },
          { title: 'Driver / Employee', dataIndex: 'person', render: (v) => v || '—' },
          { title: 'Credit (Cr)', dataIndex: 'payFrom' },
          { title: 'Amount', dataIndex: 'amount', align: 'right', className: 'money', render: (v) => `₹ ${money(v)}` },
          { title: 'Entered By', dataIndex: 'createdBy' },
          { title: 'Status', dataIndex: 'cancelled', render: (v) => (v ? <Tag color="red">Cancelled</Tag> : <Tag color="green">Active</Tag>) },
          {
            title: '', key: 'a', width: 90,
            render: (_, r) => canEdit && !r.cancelled && (
              <Popconfirm title={`Cancel voucher ${r.paymentNo}?`} description="Its accounting entries will be reversed." okText="Cancel Voucher" okButtonProps={{ danger: true }}
                onConfirm={() => cancel.mutateAsync(r.paymentNo)}>
                <Button size="small" danger>Cancel</Button>
              </Popconfirm>
            ),
          },
        ]} />
      <Drawer open={Boolean(view)} onClose={() => setView(null)} width={Math.min(520, window.innerWidth)} title={`Voucher ${view ?? ''}`}>
        <PaymentDetail no={view} />
      </Drawer>
    </>
  );
}

function PaymentDetail({ no }) {
  const { data, isFetching } = useQuery({ queryKey: ['payment', no], enabled: Boolean(no), queryFn: () => api.get(`/payments/${no}`).then((r) => r.data) });
  if (isFetching || !data) return <Typography.Text type="secondary">Loading…</Typography.Text>;
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {data.cancelled && <Alert type="warning" showIcon message={`Cancelled${data.cancelRemarks ? `: ${data.cancelRemarks}` : ''}`} />}
      <Descriptions size="small" column={1} bordered
        items={[
          { key: 't', label: 'Type', children: <Tag color={KIND[data.kind]?.color}>{KIND[data.kind]?.label ?? data.kind}</Tag> },
          { key: 'd', label: 'Date', children: dayjs(data.paymentDate).format('DD/MM/YYYY') },
          ...(data.mainLedger ? [{ key: 'm', label: 'Main Ledger', children: data.mainLedger }] : []),
          { key: 'dr', label: 'Debit (Dr)', children: data.payTo },
          { key: 'cr', label: 'Credit (Cr)', children: data.payFrom },
          ...(data.person ? [{ key: 'p', label: 'Driver / Employee', children: data.person }] : []),
          { key: 'a', label: 'Amount', children: <strong>₹ {money(data.amount)}</strong> },
          ...(data.bills?.length ? [{ key: 'b', label: 'Against bills', children: (
            <Space direction="vertical" size={0}>
              {data.bills.map((b) => <span key={`${b.billType}${b.billNo}`}>{b.billType === 'OPENING' ? 'Opening balance' : `${b.billNo} (${b.label})`}: ₹ {money(b.amount)}</span>)}
            </Space>) }] : []),
          ...(data.refNo ? [{ key: 'r', label: 'Reference No.', children: data.refNo }] : []),
          ...(data.chequeNo ? [{ key: 'c', label: 'Cheque / UTR No.', children: data.chequeNo }] : []),
          { key: 'n', label: 'Narration', children: data.narration || '—' },
          { key: 'u', label: 'Entered By', children: data.createdBy },
        ]} />
    </Space>
  );
}

export default function PaymentEntryPage({ defaultTab = 'new' }) {
  const [tab, setTab] = useState(defaultTab);
  return (
    <Card className="page-card" title={<Space><WalletOutlined />Payment Entry</Space>}>
      <Tabs activeKey={tab} onChange={setTab} destroyOnHidden
        items={[
          { key: 'new', label: 'Payments', children: <Payments /> },
          { key: 'advance', label: 'Advance Register', children: <AdvanceRegister /> },
          { key: 'list', label: 'View / Cancel', children: <PaymentList /> },
        ]} />
    </Card>
  );
}
