// Octroi bill — replaces Invoice/Octroi_Bills.aspx, Octroi_Bill_Summation, Octroi_Bill_Cancel, Octroi_Bill_Report and Octroi_Bill_Print.
// "New bill": the client's dockets booked here; per docket the octroi paid, other charges, service charge % and tax %; one octroi
// receipt no. "Bills": submit to the client, cancel (frees the dockets), print. (Octroi ended with GST in 2017; there is no
// finalize — the legacy finalize page was empty.)
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Alert, App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { PrinterOutlined, SaveOutlined, SearchOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import SearchSelect from '../../components/SearchSelect.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');
const money = (v) => Number(v || 0).toFixed(2);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const STATUS_COLOR = { Generated: 'green', Submitted: 'blue', Received: 'gold', Cancelled: 'red' };
const openPrint = (billNo) => window.open(`/print/octroi-bill/${encodeURIComponent(billNo)}`, '_blank');
const calc = (r) => {
  const charge = r2((r.octroiAmount || 0) * (r.chargePercent || 0) / 100);
  const tax = r2((charge + (r.otherCharges || 0)) * (r.taxPercent || 0) / 100);
  return { charge, tax, total: r2((r.octroiAmount || 0) + (r.otherCharges || 0) + charge + tax) };
};
const problem = (e) => {
  const details = e.response?.data?.details;
  return details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e);
};

function NewBill() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [client, setClient] = useState(null);
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState([]);
  const [defaults, setDefaults] = useState({ chargePercent: 0, taxPercent: 0 });
  const [searching, setSearching] = useState(false);

  async function search() {
    const v = form.getFieldsValue();
    setSearching(true);
    try {
      const { data } = await api.get('/octroi-bills/pending-dockets', {
        params: { clientCode: client.code, from: v.range[0].format('YYYY-MM-DD'), to: v.range[1].format('YYYY-MM-DD'), dockets: v.dockets || '' },
      });
      setRows(data.map((d) => ({ ...d, octroiAmount: 0, otherCharges: 0, ...defaults })));
      setSelected([]);
    } catch (e) { message.error(errorMessage(e)); } finally { setSearching(false); }
  }
  const update = (no, patch) => setRows((rs) => rs.map((r) => (r.docketNo === no ? { ...r, ...patch } : r)));
  const chosen = useMemo(() => (rows ?? []).filter((r) => selected.includes(r.docketNo)), [rows, selected]);
  const total = chosen.reduce((t, r) => t + calc(r).total, 0);

  const save = useMutation({
    mutationFn: (v) => api.post('/octroi-bills', {
      clientCode: client.code, billDate: v.billDate.format('YYYY-MM-DD'), octroiNo: v.octroiNo, remarks: v.remarks || '',
      rows: chosen.map((r) => ({ docketNo: r.docketNo, octroiAmount: r.octroiAmount, otherCharges: r.otherCharges, chargePercent: r.chargePercent, taxPercent: r.taxPercent })),
    }),
    onSuccess: (r) => {
      modal.success({ title: 'Octroi bill generated', content: <>Bill no. <strong>{r.data.billNo}</strong> — {r.data.dockets} docket(s), ₹ {money(r.data.totalAmount)}</>, okText: 'Print', onOk: () => openPrint(r.data.billNo) });
      setRows(null); setSelected([]);
      queryClient.invalidateQueries({ queryKey: ['octroi-bills'] });
    },
    onError: (e) => message.error(problem(e)),
  });
  const num = (r, k, extra = {}) => <InputNumber size="small" min={0} style={{ width: 95 }} value={r[k]} aria-label={`${k} for ${r.docketNo}`} onChange={(x) => update(r.docketNo, { [k]: x ?? 0 })} {...extra} />;

  return (
    <Form form={form} layout="vertical" initialValues={{ billDate: dayjs(), range: [dayjs().startOf('month'), dayjs()] }}
      onFinish={(v) => {
        if (!chosen.length) { message.warning('Select Atleast One Docket'); return; }
        if (chosen.some((r) => !(r.octroiAmount > 0))) { message.warning('Enter the octroi amount of every ticked docket'); return; }
        save.mutate(v);
      }}>
      <Space wrap align="end" style={{ marginBottom: 12 }}>
        <Form.Item label="Client" required style={{ marginBottom: 0, width: 300 }}>
          <SearchSelect placeholder="Type client name" minChars={2}
            fetcher={(q) => api.get('/octroi-bills/clients', { params: { q } }).then((r) => r.data.map((c) => ({ ...c, value: `${c.name} : ${c.code}`, label: `${c.name} : ${c.code}` })))}
            onPick={(c) => { setClient(c); setRows(null); }} onChange={(x) => { if (!x) { setClient(null); setRows(null); } }} />
        </Form.Item>
        <Form.Item label="Bill date" name="billDate" rules={[{ required: true }]} style={{ marginBottom: 0 }}><DatePicker format={DATE_FMT} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} /></Form.Item>
        <Form.Item label="Octroi no." name="octroiNo" rules={[{ required: true, whitespace: true }]} style={{ marginBottom: 0 }}><Input maxLength={50} style={{ width: 160 }} /></Form.Item>
        <Form.Item label="Booked" name="range" style={{ marginBottom: 0 }}><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
        <Form.Item label="Docket nos. (optional)" name="dockets" style={{ marginBottom: 0 }}><Input style={{ width: 160 }} placeholder="D1, D2 …" /></Form.Item>
        <Button icon={<SearchOutlined />} onClick={search} loading={searching} disabled={!client}>Search</Button>
      </Space>
      <Space wrap style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">Default for the search:</Typography.Text>
        <InputNumber size="small" min={0} max={100} suffix="% charge" style={{ width: 130 }} value={defaults.chargePercent} onChange={(x) => setDefaults((d) => ({ ...d, chargePercent: x ?? 0 }))} aria-label="Default service charge %" />
        <InputNumber size="small" min={0} max={100} suffix="% tax" style={{ width: 110 }} value={defaults.taxPercent} onChange={(x) => setDefaults((d) => ({ ...d, taxPercent: x ?? 0 }))} aria-label="Default tax %" />
      </Space>
      {rows && (
        <>
          <Table size="small" rowKey="docketNo" dataSource={rows} pagination={false} scroll={{ x: 'max-content' }}
            rowSelection={{ selectedRowKeys: selected, onChange: setSelected }} locale={{ emptyText: 'No docket of this client booked here is waiting for an octroi bill' }}
            columns={[
              { title: 'Docket no.', dataIndex: 'docketNo' }, { title: 'Booked', dataIndex: 'bookingDate', render: fmt },
              { title: 'Destination', dataIndex: 'destination' }, { title: 'Invoice', dataIndex: 'invoiceNos', ellipsis: true },
              { title: 'Pkts', dataIndex: 'packages', align: 'right' },
              { title: 'Octroi', key: 'oa', render: (_, r) => num(r, 'octroiAmount') },
              { title: 'Other', key: 'oc', render: (_, r) => num(r, 'otherCharges') },
              { title: 'Charge %', key: 'cp', render: (_, r) => num(r, 'chargePercent', { max: 100, style: { width: 75 } }) },
              { title: 'Tax %', key: 'tp', render: (_, r) => num(r, 'taxPercent', { max: 100, style: { width: 75 } }) },
              { title: 'Charge', key: 'c', align: 'right', render: (_, r) => money(calc(r).charge) },
              { title: 'Tax', key: 't', align: 'right', render: (_, r) => money(calc(r).tax) },
              { title: 'Total', key: 'tot', align: 'right', render: (_, r) => <strong>{money(calc(r).total)}</strong> },
            ]} />
          <Space style={{ marginTop: 12, width: '100%', justifyContent: 'space-between' }} wrap>
            <Form.Item name="remarks" noStyle><Input placeholder="Remarks" maxLength={500} style={{ width: 300 }} /></Form.Item>
            <Space wrap>
              <Typography.Text>{chosen.length} docket(s) · <strong>₹ {money(total)}</strong></Typography.Text>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending} disabled={!chosen.length}>Generate bill</Button>
            </Space>
          </Space>
        </>
      )}
    </Form>
  );
}

function Bills() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [params, setParams] = useState({ from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), status: 'all', search: '' });
  const [submitting, setSubmitting] = useState(null);
  const [subForm] = Form.useForm();
  const { data = [], isFetching, error } = useQuery({ queryKey: ['octroi-bills', params], queryFn: () => api.get('/octroi-bills', { params }).then((r) => r.data) });
  const act = useMutation({
    mutationFn: ({ billNo, what, body }) => api.post(`/octroi-bills/${encodeURIComponent(billNo)}/${what}`, body),
    onSuccess: (r) => { message.success(r.data.message); setSubmitting(null); queryClient.invalidateQueries({ queryKey: ['octroi-bills'] }); },
    onError: (e) => message.error(problem(e)),
  });
  const cancel = (r) => {
    let reason = '';
    modal.confirm({
      title: `Cancel octroi bill ${r.billNo}?`, okText: 'Cancel bill', okButtonProps: { danger: true }, cancelText: 'Keep',
      content: <Input placeholder="Reason" onChange={(e) => { reason = e.target.value; }} aria-label="Reason for cancelling" />,
      onOk: () => act.mutateAsync({ billNo: r.billNo, what: 'cancel', body: { remarks: reason } }),
    });
  };
  return (
    <>
      <Form layout="inline" style={{ rowGap: 8, marginBottom: 12 }} initialValues={{ range: [dayjs(params.from), dayjs(params.to)], status: 'all' }}
        onFinish={(f) => setParams({ from: f.range[0].format('YYYY-MM-DD'), to: f.range[1].format('YYYY-MM-DD'), status: f.status, search: f.search?.trim() || '' })}>
        <Form.Item name="range" label="Bill date"><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
        <Form.Item name="status"><Select style={{ width: 130 }} options={['all', 'Generated', 'Submitted', 'Received', 'Cancelled'].map((x) => ({ value: x, label: x === 'all' ? 'All' : x }))} /></Form.Item>
        <Form.Item name="search"><Input placeholder="Bill / octroi no. / client" allowClear style={{ width: 200 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Alert type="error" showIcon message={errorMessage(error)} />}
      <Table size="middle" rowKey="billNo" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }} pagination={{ defaultPageSize: 20 }}
        columns={[
          { title: 'Bill no.', dataIndex: 'billNo' }, { title: 'Date', dataIndex: 'billDate', render: fmt }, { title: 'Client', dataIndex: 'clientName' },
          { title: 'Octroi no.', dataIndex: 'octroiNo' }, { title: 'Dockets', dataIndex: 'dockets', align: 'right' },
          { title: 'Amount', dataIndex: 'totalAmount', align: 'right', render: money },
          { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={STATUS_COLOR[s]}>{s}</Tag> },
          {
            title: '', key: 'act', render: (_, r) => (
              <Space wrap>
                <Button size="small" icon={<PrinterOutlined />} aria-label={`Print ${r.billNo}`} onClick={() => openPrint(r.billNo)} />
                {r.status === 'Generated' && <Button size="small" icon={<SendOutlined />} onClick={() => { subForm.resetFields(); setSubmitting(r); }}>Submit</Button>}
                {['Generated', 'Submitted'].includes(r.status) && <Button size="small" danger icon={<StopOutlined />} onClick={() => cancel(r)}>Cancel</Button>}
              </Space>
            ),
          },
        ]} />
      <Modal title={`Submit ${submitting?.billNo ?? ''}`} open={Boolean(submitting)} onCancel={() => setSubmitting(null)} okText="Submit" confirmLoading={act.isPending}
        onOk={() => subForm.validateFields().then((f) => act.mutate({ billNo: submitting.billNo, what: 'submit', body: { date: f.date.format('YYYY-MM-DD'), receiverName: f.receiverName, receiverPhone: f.receiverPhone || '' } }))}>
        <Form form={subForm} layout="vertical" initialValues={{ date: dayjs() }}>
          <Form.Item label="Submission date" name="date" rules={[{ required: true }]}><DatePicker format={DATE_FMT} style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} /></Form.Item>
          <Form.Item label="Receiver name" name="receiverName" rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item>
          <Form.Item label="Receiver phone" name="receiverPhone"><Input maxLength={30} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export default function OctroiBillPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('new');
  return (
    <Card className="page-card" title="Octroi Bill" extra={<Typography.Text type="secondary">{user.currentBranch.name} : {user.currentBranch.code}</Typography.Text>}>
      <Tabs activeKey={tab} onChange={setTab} destroyOnHidden items={[
        { key: 'new', label: 'New bill', children: <NewBill /> },
        { key: 'list', label: 'Bills', children: <Bills /> },
      ]} />
    </Card>
  );
}

/** Route /print/octroi-bill/:billNo — Octroi_Bill_Print / Octroi_Bill_Report. */
export function OctroiBillPrintRoute() {
  const { billNo } = useParams();
  const { data: b, error, isLoading } = useQuery({ queryKey: ['octroi-bill', billNo], queryFn: () => api.get(`/octroi-bills/${encodeURIComponent(billNo)}`).then((r) => r.data) });
  if (isLoading) return <div style={{ padding: 40 }}>Loading bill…</div>;
  if (error) return <div style={{ padding: 40, color: '#c00' }}>{errorMessage(error)}</div>;
  return (
    <div style={{ maxWidth: 1000, margin: '16px auto', padding: 24, background: '#fff', color: '#111', font: '13px/1.5 Calibri, Arial, sans-serif' }}>
      <style>{'@media print { .no-print { display: none } } .oc td, .oc th { border: 1px solid #999; padding: 3px 6px } .oc { border-collapse: collapse; width: 100% } .r { text-align: right }'}</style>
      <div className="no-print" style={{ textAlign: 'right' }}><button type="button" onClick={() => window.print()}>Print / Save as PDF</button></div>
      {b.status === 'Cancelled' && <div style={{ color: '#c00', fontWeight: 'bold', textAlign: 'center' }}>CANCELLED</div>}
      <h2 style={{ margin: 0 }}>{b.branch.name}</h2>
      <div>{b.branch.address}{b.branch.gstin && ` · GSTIN ${b.branch.gstin}`}</div>
      <h3 style={{ textAlign: 'center' }}>OCTROI BILL</h3>
      <p>Bill no. <strong>{b.billNo}</strong> · Date {fmt(b.billDate)} · Octroi no. <strong>{b.octroiNo}</strong><br />Bill to: {b.client.name}{b.client.address && ` — ${b.client.address}`}</p>
      <table className="oc">
        <thead><tr><th>#</th><th>Docket</th><th>Booked</th><th>Invoice</th><th className="r">Pkts</th><th className="r">Octroi</th><th className="r">Other</th><th className="r">Charge</th><th className="r">Tax</th><th className="r">Total</th></tr></thead>
        <tbody>
          {b.rows.map((r, i) => (
            <tr key={r.docketNo}><td>{i + 1}</td><td>{r.docketNo}</td><td>{fmt(r.bookingDate)}</td><td>{r.invoiceNos}</td><td className="r">{r.packages}</td>
              <td className="r">{money(r.octroiAmount)}</td><td className="r">{money(r.otherCharges)}</td><td className="r">{money(r.charge)} ({r.chargePercent}%)</td>
              <td className="r">{money(r.tax)} ({r.taxPercent}%)</td><td className="r">{money(r.total)}</td></tr>
          ))}
        </tbody>
        <tfoot><tr><th colSpan={9} className="r">Total</th><th className="r">{money(b.totalAmount)}</th></tr></tfoot>
      </table>
      {b.remarks && <p>Remarks: {b.remarks}</p>}
      <p style={{ textAlign: 'right', marginTop: 48 }}>For {b.branch.name}<br /><br />Authorised signatory</p>
    </div>
  );
}
