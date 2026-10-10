// Franchisee commission invoice — replaces Invoice/Franchisee_Commission_Invoice.aspx and Franchisee_Invoice_Cancel.aspx.
// "New invoice": pick the franchisee (with its branch) and the month; the branch's dockets of that month not yet invoiced are
// listed with the commission worked out from the franchisee commission master (Rate → Franchisee Commission), the docket's
// handling and collection charges; tick, optionally add the month's rent / mobile / signage, enter TDS % and save.
// "Invoices": list, print, cancel (frees the dockets).
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Alert, App, Button, Card, Checkbox, DatePicker, Form, Input, InputNumber, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { PrinterOutlined, SaveOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');
const money = (v) => Number(v || 0).toFixed(2);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const openPrint = (no) => window.open(`/print/franchisee-invoice/${encodeURIComponent(no)}`, '_blank');
const problem = (e) => {
  const details = e.response?.data?.details;
  return details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e);
};

function NewInvoice() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const { data: franchisees = [] } = useQuery({ queryKey: ['franchisee-invoice-franchisees'], queryFn: () => api.get('/franchisee-invoices/franchisees').then((r) => r.data) });
  const [searched, setSearched] = useState(null);
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState([]);
  const [monthly, setMonthly] = useState(null);
  const [searching, setSearching] = useState(false);
  const includeMonthly = Form.useWatch('includeMonthly', form) ?? false;
  const tdsPercent = Form.useWatch('tdsPercent', form) ?? 0;

  async function search() {
    const v = await form.validateFields(['franchisee', 'month']);
    const f = franchisees.find((x) => x.value === v.franchisee);
    const params = { franCode: f.code, branchCode: f.branchCode, month: v.month.format('YYYY-MM') };
    setSearching(true);
    try {
      const [p, m] = await Promise.all([api.get('/franchisee-invoices/pending-dockets', { params }), api.get('/franchisee-invoices/monthly', { params })]);
      setRows(p.data); setSelected(p.data.map((d) => d.docketNo)); setMonthly(m.data); setSearched({ ...params, label: f.label });
      form.setFieldsValue({ includeMonthly: !m.data.alreadyOn && m.data.rent + m.data.mobile + m.data.signage > 0 });
    } catch (e) { message.error(errorMessage(e)); } finally { setSearching(false); }
  }
  const chosen = useMemo(() => (rows ?? []).filter((r) => selected.includes(r.docketNo)), [rows, selected]);
  const sum = (k) => r2(chosen.reduce((t, r) => t + r[k], 0));
  const monthlyTotal = includeMonthly && monthly ? r2(monthly.rent + monthly.mobile + monthly.signage) : 0;
  const gross = r2(sum('total') + monthlyTotal);
  const tds = r2(gross * tdsPercent / 100);
  const noRate = chosen.some((r) => !r.masterCode);

  const save = useMutation({
    mutationFn: (v) => api.post('/franchisee-invoices', {
      franCode: searched.franCode, branchCode: searched.branchCode, month: searched.month, invoiceDate: v.invoiceDate.format('YYYY-MM-DD'),
      dockets: chosen.map((r) => r.docketNo), includeMonthly: Boolean(v.includeMonthly), tdsPercent: v.tdsPercent || 0, remarks: v.remarks || '',
    }),
    onSuccess: (r) => {
      modal.success({ title: 'Record Success Fully Added !', content: <>Invoice no. <strong>{r.data.invoiceNo}</strong> — {r.data.dockets} docket(s), gross ₹ {money(r.data.gross)}, net ₹ {money(r.data.net)}</>, okText: 'Print', onOk: () => openPrint(r.data.invoiceNo) });
      setRows(null); setSelected([]); setMonthly(null);
      queryClient.invalidateQueries({ queryKey: ['franchisee-invoices'] });
    },
    onError: (e) => message.error(problem(e)),
  });

  return (
    <Form form={form} layout="vertical" initialValues={{ month: dayjs(), invoiceDate: dayjs(), tdsPercent: 0, includeMonthly: false }}
      onFinish={(v) => {
        if (!chosen.length && !monthlyTotal) { message.warning('Select Atleast One Docket'); return; }
        save.mutate(v);
      }}>
      <Space wrap align="end" style={{ marginBottom: 12 }}>
        <Form.Item label="Franchisee" name="franchisee" rules={[{ required: true, message: 'Select the franchisee' }]} style={{ marginBottom: 0, width: 380 }}>
          <Select showSearch optionFilterProp="label" placeholder="--Select--" options={franchisees} onChange={() => setRows(null)} />
        </Form.Item>
        <Form.Item label="Month" name="month" rules={[{ required: true }]} style={{ marginBottom: 0 }}>
          <DatePicker picker="month" format="MMM YYYY" allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'month')} onChange={() => setRows(null)} />
        </Form.Item>
        <Button icon={<SearchOutlined />} onClick={search} loading={searching}>Search</Button>
      </Space>
      {rows && (
        <>
          {noRate && <Alert type="warning" showIcon style={{ marginBottom: 8 }} message="Some dockets have no franchisee commission master in force for their mode and booking date — their commission is 0. Add one under Rate → Franchisee Commission." />}
          <Table size="small" rowKey="docketNo" dataSource={rows} pagination={false} scroll={{ x: 'max-content', y: 420 }}
            rowSelection={{ selectedRowKeys: selected, onChange: setSelected }} locale={{ emptyText: 'No docket of this branch is waiting for a franchisee invoice this month' }}
            columns={[
              { title: 'Docket no.', dataIndex: 'docketNo' }, { title: 'Booking type', dataIndex: 'bookingType' }, { title: 'Booked', dataIndex: 'bookingDate', render: fmt },
              { title: 'Mode', dataIndex: 'mode' }, { title: 'Load', dataIndex: 'loadType' }, { title: 'Destination', dataIndex: 'destination' },
              { title: 'Pkts', dataIndex: 'packets', align: 'right' }, { title: 'Weight', dataIndex: 'weight', align: 'right' },
              { title: 'Basic freight', dataIndex: 'freight', align: 'right', render: money },
              { title: 'Commission', dataIndex: 'commissionType', render: (v, r) => (r.masterCode ? <>{v} <Typography.Text type="secondary">({r.masterCode})</Typography.Text></> : <Tag color="orange">{v}</Tag>) },
              { title: 'Franchisee amt', dataIndex: 'commission', align: 'right', render: money },
              { title: 'Hand. ch.', dataIndex: 'handling', align: 'right', render: money }, { title: 'Coll. ch.', dataIndex: 'collection', align: 'right', render: money },
              { title: 'Total', dataIndex: 'total', align: 'right', render: (v) => <strong>{money(v)}</strong> },
            ]}
            summary={() => (
              <Table.Summary fixed>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={11}><strong>Ticked: {chosen.length}</strong></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right">{money(sum('commission'))}</Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right">{money(sum('handling'))}</Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right">{money(sum('collection'))}</Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right"><strong>{money(sum('total'))}</strong></Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )} />
          <Space wrap align="end" style={{ marginTop: 12, width: '100%', justifyContent: 'space-between' }}>
            <Space wrap align="end">
              <Form.Item label="Invoice date" name="invoiceDate" rules={[{ required: true }]} style={{ marginBottom: 0 }}><DatePicker format={DATE_FMT} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} /></Form.Item>
              <Form.Item name="includeMonthly" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Checkbox disabled={Boolean(monthly?.alreadyOn) || !(monthly && monthly.rent + monthly.mobile + monthly.signage > 0)}>
                  Rent ₹ {money(monthly?.rent)} + mobile ₹ {money(monthly?.mobile)} + signage ₹ {money(monthly?.signage)}
                  {monthly?.alreadyOn && <Typography.Text type="secondary"> (already on {monthly.alreadyOn})</Typography.Text>}
                </Checkbox>
              </Form.Item>
              <Form.Item label="TDS %" name="tdsPercent" style={{ marginBottom: 0 }}><InputNumber min={0} max={100} style={{ width: 90 }} /></Form.Item>
              <Form.Item name="remarks" style={{ marginBottom: 0 }}><Input placeholder="Remarks" maxLength={500} style={{ width: 220 }} /></Form.Item>
            </Space>
            <Space wrap>
              <Typography.Text>Gross ₹ {money(gross)} · TDS ₹ {money(tds)} · Net <strong>₹ {money(gross - tds)}</strong></Typography.Text>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending} disabled={!chosen.length && !monthlyTotal}>Save</Button>
            </Space>
          </Space>
        </>
      )}
    </Form>
  );
}

function Invoices() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [params, setParams] = useState({ from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), status: 'all', search: '' });
  const { data = [], isFetching, error } = useQuery({ queryKey: ['franchisee-invoices', params], queryFn: () => api.get('/franchisee-invoices', { params }).then((r) => r.data) });
  const cancel = useMutation({
    mutationFn: ({ no, remarks }) => api.post(`/franchisee-invoices/${encodeURIComponent(no)}/cancel`, { remarks }),
    onSuccess: (r) => { message.success(r.data.message); queryClient.invalidateQueries({ queryKey: ['franchisee-invoices'] }); },
    onError: (e) => message.error(problem(e)),
  });
  const askCancel = (r) => {
    let reason = '';
    modal.confirm({
      title: `Cancel invoice ${r.invoiceNo}?`, content: <><p>Its dockets can be invoiced again.</p><Input placeholder="Reason" onChange={(e) => { reason = e.target.value; }} aria-label="Reason for cancelling" /></>,
      okText: 'Cancel invoice', okButtonProps: { danger: true }, cancelText: 'Keep', onOk: () => cancel.mutateAsync({ no: r.invoiceNo, remarks: reason }),
    });
  };
  return (
    <>
      <Form layout="inline" style={{ rowGap: 8, marginBottom: 12 }} initialValues={{ range: [dayjs(params.from), dayjs(params.to)], status: 'all' }}
        onFinish={(f) => setParams({ from: f.range[0].format('YYYY-MM-DD'), to: f.range[1].format('YYYY-MM-DD'), status: f.status, search: f.search?.trim() || '' })}>
        <Form.Item name="range" label="Invoice date"><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
        <Form.Item name="status"><Select style={{ width: 120 }} options={['all', 'Active', 'Cancelled'].map((x) => ({ value: x, label: x === 'all' ? 'All' : x }))} /></Form.Item>
        <Form.Item name="search"><Input placeholder="Invoice no. / franchisee" allowClear style={{ width: 200 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Alert type="error" showIcon message={errorMessage(error)} />}
      <Table size="middle" rowKey="invoiceNo" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }} pagination={{ defaultPageSize: 20 }}
        columns={[
          { title: 'Invoice no.', dataIndex: 'invoiceNo' }, { title: 'Date', dataIndex: 'invoiceDate', render: fmt },
          { title: 'Franchisee', dataIndex: 'franName', render: (v, r) => <>{v} <Typography.Text type="secondary">({r.franBranchName})</Typography.Text></> },
          { title: 'Month', dataIndex: 'month', render: (v) => dayjs(`${v}-01`).format('MMM YYYY') }, { title: 'Dockets', dataIndex: 'dockets', align: 'right' },
          { title: 'Gross', dataIndex: 'gross', align: 'right', render: money }, { title: 'TDS', dataIndex: 'tds', align: 'right', render: money },
          { title: 'Net', dataIndex: 'net', align: 'right', render: money }, { title: 'User', dataIndex: 'createdBy' },
          { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={s === 'Cancelled' ? 'red' : 'green'}>{s}</Tag> },
          {
            title: '', key: 'act', render: (_, r) => (
              <Space>
                <Button size="small" icon={<PrinterOutlined />} aria-label={`Print ${r.invoiceNo}`} onClick={() => openPrint(r.invoiceNo)} />
                {r.status === 'Active' && <Button size="small" danger icon={<StopOutlined />} onClick={() => askCancel(r)}>Cancel</Button>}
              </Space>
            ),
          },
        ]} />
    </>
  );
}

export default function FranchiseeInvoicePage({ defaultTab = 'new' }) {
  const { user } = useAuth();
  const [tab, setTab] = useState(defaultTab);
  return (
    <Card className="page-card" title="Franchisee Commission Invoice" extra={<Typography.Text type="secondary">{user.currentBranch.name} : {user.currentBranch.code}</Typography.Text>}>
      <Tabs activeKey={tab} onChange={setTab} destroyOnHidden items={[
        { key: 'new', label: 'New invoice', children: <NewInvoice /> },
        { key: 'list', label: 'Invoices / cancel', children: <Invoices /> },
      ]} />
    </Card>
  );
}

/** Route /print/franchisee-invoice/:invoiceNo. */
export function FranchiseeInvoicePrintRoute() {
  const { invoiceNo } = useParams();
  const { data: b, error, isLoading } = useQuery({ queryKey: ['franchisee-invoice', invoiceNo], queryFn: () => api.get(`/franchisee-invoices/${encodeURIComponent(invoiceNo)}`).then((r) => r.data) });
  if (isLoading) return <div style={{ padding: 40 }}>Loading invoice…</div>;
  if (error) return <div style={{ padding: 40, color: '#c00' }}>{errorMessage(error)}</div>;
  const monthlyTotal = r2(b.rent + b.mobile + b.signage);
  return (
    <div style={{ maxWidth: 1000, margin: '16px auto', padding: 24, background: '#fff', color: '#111', font: '13px/1.5 Calibri, Arial, sans-serif' }}>
      <style>{'@media print { .no-print { display: none } } .fi td, .fi th { border: 1px solid #999; padding: 3px 6px } .fi { border-collapse: collapse; width: 100%; margin-bottom: 12px } .r { text-align: right }'}</style>
      <div className="no-print" style={{ textAlign: 'right' }}><button type="button" onClick={() => window.print()}>Print / Save as PDF</button></div>
      {b.status === 'Cancelled' && <div style={{ color: '#c00', fontWeight: 'bold', textAlign: 'center' }}>CANCELLED — {b.cancelRemarks}</div>}
      <h2 style={{ margin: 0 }}>{b.branch.name}</h2>
      <div>{b.branch.address}{b.branch.gstin && ` · GSTIN ${b.branch.gstin}`}</div>
      <h3 style={{ textAlign: 'center' }}>FRANCHISEE COMMISSION INVOICE</h3>
      <p>Invoice no. <strong>{b.invoiceNo}</strong> · Date {fmt(b.invoiceDate)} · Bill month <strong>{b.monthLabel}</strong> ({fmt(b.from)} – {fmt(b.to)})<br />
        Franchisee: {b.franName} ({b.franCode}) · Location {b.franBranchName} ({b.franBranch})</p>
      <table className="fi">
        <thead><tr><th>#</th><th>Docket</th><th>Booked</th><th>Type</th><th>Mode</th><th>Destination</th><th className="r">Weight</th><th className="r">Basic freight</th><th>Commission</th><th className="r">Franchisee amt</th><th className="r">Hand.</th><th className="r">Coll.</th><th className="r">Total</th></tr></thead>
        <tbody>
          {b.rows.map((r, i) => (
            <tr key={r.docketNo}><td>{i + 1}</td><td>{r.docketNo}</td><td>{fmt(r.bookingDate)}</td><td>{r.bookingType}</td><td>{r.mode}</td><td>{r.destination}</td>
              <td className="r">{r.weight}</td><td className="r">{money(r.freight)}</td><td>{r.commissionType}</td><td className="r">{money(r.commission)}</td>
              <td className="r">{money(r.handling)}</td><td className="r">{money(r.collection)}</td><td className="r">{money(r.total)}</td></tr>
          ))}
        </tbody>
        <tfoot><tr><th colSpan={9} className="r">Dockets total</th><th className="r">{money(b.commission)}</th><th className="r">{money(b.handling)}</th><th className="r">{money(b.collection)}</th><th className="r">{money(b.commission + b.handling + b.collection)}</th></tr></tfoot>
      </table>
      <table className="fi" style={{ width: 360, marginLeft: 'auto' }}>
        <tbody>
          {monthlyTotal > 0 && <><tr><td>Rent per month</td><td className="r">{money(b.rent)}</td></tr><tr><td>Mobile per month</td><td className="r">{money(b.mobile)}</td></tr><tr><td>Signage per month</td><td className="r">{money(b.signage)}</td></tr></>}
          <tr><th>Gross</th><th className="r">{money(b.gross)}</th></tr>
          <tr><td>TDS {b.tdsPercent}%</td><td className="r">{money(b.tds)}</td></tr>
          <tr><th>Net payable</th><th className="r">{money(b.net)}</th></tr>
        </tbody>
      </table>
      {b.remarks && <p>Remarks: {b.remarks}</p>}
      <p style={{ textAlign: 'right', marginTop: 48 }}>For {b.branch.name}<br /><br />Authorised signatory</p>
    </div>
  );
}
