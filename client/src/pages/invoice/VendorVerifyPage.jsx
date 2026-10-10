// Vendor bill verification — replaces Invoice/Vendor_Invoice_For_Varification.aspx, VendorPendingInvoiceReport.aspx and
// Vendor_Invoice_Print.aspx. A transport vendor's bill is checked against its lorry challans (CHT): tick the challans, enter the
// current payment against each balance, save. "Pending report" lists the verified bills per challan with the balance left;
// print and cancel from there. (The legacy PRS / DRS challan option is not ported.)
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Alert, App, Button, Card, Checkbox, Col, DatePicker, Form, Input, InputNumber, Row, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { PrinterOutlined, SaveOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');
const money = (v) => Number(v || 0).toFixed(2);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const openPrint = (no) => window.open(`/print/vendor-bill/${encodeURIComponent(no)}`, '_blank');
const problem = (e) => {
  const details = e.response?.data?.details;
  return details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e);
};
const useOptions = () => useQuery({ queryKey: ['vendor-verify-options'], queryFn: () => api.get('/vendor-invoices/verify/options').then((r) => r.data), staleTime: 300_000 });

function Verify() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const { data: options } = useOptions();
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState([]);
  const [searched, setSearched] = useState(null);
  const [searching, setSearching] = useState(false);

  async function search() {
    const v = await form.validateFields(['vendorCode', 'mode', 'range']);
    setSearching(true);
    try {
      const { data } = await api.get('/vendor-invoices/verify/challans', {
        params: { vendorCode: v.vendorCode, mode: v.mode, from: v.range[0].format('YYYY-MM-DD'), to: v.range[1].format('YYYY-MM-DD') },
      });
      setRows(data.map((c) => ({ ...c, currentPayment: c.balance })));
      setSelected(data.map((c) => c.challanNo));   // chk_all: every challan ticked after a search
      setSearched({ vendorCode: v.vendorCode, mode: v.mode });
    } catch (e) { message.error(errorMessage(e)); } finally { setSearching(false); }
  }
  const chosen = useMemo(() => (rows ?? []).filter((r) => selected.includes(r.challanNo)), [rows, selected]);
  const sum = (k) => r2(chosen.reduce((t, r) => t + r[k], 0));
  const totalPaid = sum('currentPayment');

  const save = useMutation({
    mutationFn: (v) => api.post('/vendor-invoices/verify', {
      vendorCode: searched.vendorCode, mode: searched.mode, billDate: v.billDate.format('YYYY-MM-DD'), vendorRefNo: v.vendorRefNo || '',
      billAmount: v.billAmount, deduction: v.deduction || 0, narration: v.narration || '',
      rows: chosen.map((r) => ({ challanNo: r.challanNo, currentPayment: r.currentPayment })),
    }),
    onSuccess: (r) => {
      modal.success({ title: 'Successfully verified', content: <>Bill no. <strong>{r.data.billNo}</strong> ({r.data.receiptCode}) — current payment ₹ {money(r.data.totalPaid)}</>, okText: 'Print', onOk: () => openPrint(r.data.billNo) });
      setRows(null); setSelected([]); form.setFieldsValue({ vendorRefNo: '', billAmount: null, deduction: 0, narration: '' });
      queryClient.invalidateQueries({ queryKey: ['vendor-verify-report'] });
    },
    onError: (e) => message.error(problem(e)),
  });

  return (
    <Form form={form} layout="vertical" initialValues={{ mode: 'RD', range: [dayjs().startOf('month'), dayjs()], billDate: dayjs(), deduction: 0 }}
      onFinish={(v) => {
        if (!chosen.length) { message.warning('select any challan'); return; }
        if (chosen.some((r) => !(r.currentPayment > 0) || r.currentPayment > r.balance)) { message.warning('Each current payment must be more than 0 and not more than the balance'); return; }
        save.mutate(v);
      }}>
      <Space wrap align="end" style={{ marginBottom: 12 }}>
        <Form.Item label="Challan type" style={{ marginBottom: 0 }}><Tag>CHT challan</Tag></Form.Item>
        <Form.Item label="Vendor" name="vendorCode" rules={[{ required: true, message: 'Select the vendor' }]} style={{ marginBottom: 0, width: 260 }}>
          <Select showSearch optionFilterProp="label" placeholder="--Select--" options={options?.vendors} onChange={() => setRows(null)} />
        </Form.Item>
        <Form.Item label="Mode" name="mode" rules={[{ required: true }]} style={{ marginBottom: 0, width: 120 }}><Select options={options?.modes} onChange={() => setRows(null)} /></Form.Item>
        <Form.Item label="Challan date" name="range" style={{ marginBottom: 0 }}><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
        <Button icon={<SearchOutlined />} onClick={search} loading={searching}>Search</Button>
      </Space>
      {rows && (
        <>
          <Table size="small" rowKey="challanNo" dataSource={rows} pagination={false} scroll={{ x: 'max-content' }}
            rowSelection={{ selectedRowKeys: selected, onChange: setSelected }} locale={{ emptyText: 'No challan of this vendor has a balance to verify' }}
            columns={[
              { title: 'Document no.', dataIndex: 'challanNo' }, { title: 'Doc date', dataIndex: 'challanDate', render: fmt },
              { title: 'Truck', dataIndex: 'truckNo' }, { title: 'Weight', dataIndex: 'weight', align: 'right' },
              { title: 'Destination', dataIndex: 'destination' },
              { title: 'Challan amount', dataIndex: 'freight', align: 'right', render: money },
              { title: 'Amount paid', dataIndex: 'advance', align: 'right', render: money },
              { title: 'Balance', dataIndex: 'balance', align: 'right', render: (v, r) => <>{money(v)}{r.covered > 0 && <Typography.Text type="secondary"> (earlier bills {money(r.covered)})</Typography.Text>}</> },
              {
                title: 'Current payment', key: 'cp', render: (_, r) => (
                  <InputNumber size="small" min={0} max={r.balance} style={{ width: 110 }} value={r.currentPayment} aria-label={`Current payment for ${r.challanNo}`}
                    onChange={(x) => setRows((rs) => rs.map((y) => (y.challanNo === r.challanNo ? { ...y, currentPayment: x ?? 0 } : y)))} />
                ),
              },
              { title: 'Pending balance', key: 'pb', align: 'right', render: (_, r) => money(r2(r.balance - r.currentPayment)) },
            ]}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={6}><strong>Ticked: {chosen.length}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">{money(sum('freight'))}</Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right">{money(sum('advance'))}</Table.Summary.Cell>
                <Table.Summary.Cell index={3} align="right">{money(sum('balance'))}</Table.Summary.Cell>
                <Table.Summary.Cell index={4}><strong>{money(totalPaid)}</strong></Table.Summary.Cell>
                <Table.Summary.Cell index={5} align="right">{money(r2(sum('balance') - totalPaid))}</Table.Summary.Cell>
              </Table.Summary.Row>
            )} />
          <Row gutter={12} style={{ marginTop: 12 }}>
            <Col xs={24} sm={12} md={4}><Form.Item label="Bill date" name="billDate" rules={[{ required: true }]}><DatePicker format={DATE_FMT} allowClear={false} style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} /></Form.Item></Col>
            <Col xs={24} sm={12} md={4}><Form.Item label="Vendor's bill no." name="vendorRefNo"><Input maxLength={50} /></Form.Item></Col>
            <Col xs={24} sm={12} md={4}><Form.Item label="Bill amount" name="billAmount" rules={[{ required: true, message: 'Enter the bill amount' }]}><InputNumber min={0} style={{ width: '100%' }} placeholder={money(totalPaid)} /></Form.Item></Col>
            <Col xs={24} sm={12} md={4}><Form.Item label="Deduction" name="deduction"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item label="Narration" name="narration"><Input.TextArea rows={1} maxLength={1000} /></Form.Item></Col>
          </Row>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Typography.Text>Current payment <strong>₹ {money(totalPaid)}</strong></Typography.Text>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending} disabled={!chosen.length}>Verify</Button>
          </Space>
        </>
      )}
    </Form>
  );
}

function Report() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { data: options } = useOptions();
  const [params, setParams] = useState({ from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), vendorCode: '', pendingOnly: 'false' });
  const { data = [], isFetching, error } = useQuery({ queryKey: ['vendor-verify-report', params], queryFn: () => api.get('/vendor-invoices/verify/report', { params }).then((r) => r.data) });
  const cancel = useMutation({
    mutationFn: ({ no, remarks }) => api.post(`/vendor-invoices/verify/${encodeURIComponent(no)}/cancel`, { remarks }),
    onSuccess: (r) => { message.success(r.data.message); queryClient.invalidateQueries({ queryKey: ['vendor-verify-report'] }); },
    onError: (e) => message.error(problem(e)),
  });
  const askCancel = (r) => {
    let reason = '';
    modal.confirm({
      title: `Cancel vendor bill ${r.billNo}?`, content: <><p>All its challans open again for verification.</p><Input placeholder="Reason" onChange={(e) => { reason = e.target.value; }} aria-label="Reason for cancelling" /></>,
      okText: 'Cancel bill', okButtonProps: { danger: true }, cancelText: 'Keep', onOk: () => cancel.mutateAsync({ no: r.billNo, remarks: reason }),
    });
  };
  const firstOfBill = new Set(data.map((r, i) => (i === 0 || data[i - 1].billNo !== r.billNo ? i : -1)));
  return (
    <>
      <Form layout="inline" style={{ rowGap: 8, marginBottom: 12 }} initialValues={{ range: [dayjs(params.from), dayjs(params.to)], vendorCode: '', pendingOnly: false }}
        onFinish={(f) => setParams({ from: f.range[0].format('YYYY-MM-DD'), to: f.range[1].format('YYYY-MM-DD'), vendorCode: f.vendorCode || '', pendingOnly: String(Boolean(f.pendingOnly)) })}>
        <Form.Item name="range" label="Bill date"><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
        <Form.Item name="vendorCode"><Select style={{ width: 220 }} showSearch optionFilterProp="label" options={[{ value: '', label: 'All vendors' }, ...(options?.vendors ?? [])]} /></Form.Item>
        <Form.Item name="pendingOnly" valuePropName="checked"><Checkbox>Pending balance only</Checkbox></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Alert type="error" showIcon message={errorMessage(error)} />}
      <Table size="middle" rowKey={(r) => `${r.billNo}|${r.challanNo}`} loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }} pagination={{ defaultPageSize: 50 }}
        columns={[
          { title: 'Bill no.', dataIndex: 'billNo' }, { title: 'Bill date', dataIndex: 'billDate', render: fmt }, { title: 'Vendor', dataIndex: 'vendorName' },
          { title: 'Challan no.', dataIndex: 'challanNo' }, { title: 'Challan amount', dataIndex: 'freight', align: 'right', render: money },
          { title: 'Adv amount paid', dataIndex: 'advance', align: 'right', render: money },
          { title: 'Current payment', dataIndex: 'currentPayment', align: 'right', render: money },
          { title: 'Balance', dataIndex: 'challanPending', align: 'right', render: (v) => (v > 0 ? <Typography.Text type="warning">{money(v)}</Typography.Text> : money(v)) },
          { title: 'Last payment date', dataIndex: 'paymentDate', render: fmt },
          {
            title: '', key: 'act', render: (_, r, i) => firstOfBill.has(i) && (
              <Space>
                <Button size="small" icon={<PrinterOutlined />} aria-label={`Print ${r.billNo}`} onClick={() => openPrint(r.billNo)} />
                <Button size="small" danger icon={<StopOutlined />} onClick={() => askCancel(r)}>Cancel</Button>
              </Space>
            ),
          },
        ]} />
    </>
  );
}

export default function VendorVerifyPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('verify');
  return (
    <Card className="page-card" title="Vendor Invoice Verification" extra={<Typography.Text type="secondary">{user.currentBranch.name} : {user.currentBranch.code}</Typography.Text>}>
      <Tabs activeKey={tab} onChange={setTab} destroyOnHidden items={[
        { key: 'verify', label: 'Verify bill', children: <Verify /> },
        { key: 'report', label: 'Pending report', children: <Report /> },
      ]} />
    </Card>
  );
}

/** Route /print/vendor-bill/:billNo — Vendor_Invoice_Print (Getvendorinvoiceprint). */
export function VendorBillPrintRoute() {
  const { billNo } = useParams();
  const { data: b, error, isLoading } = useQuery({ queryKey: ['vendor-bill', billNo], queryFn: () => api.get(`/vendor-invoices/verify/${encodeURIComponent(billNo)}`).then((r) => r.data) });
  if (isLoading) return <div style={{ padding: 40 }}>Loading bill…</div>;
  if (error) return <div style={{ padding: 40, color: '#c00' }}>{errorMessage(error)}</div>;
  return (
    <div style={{ maxWidth: 900, margin: '16px auto', padding: 24, background: '#fff', color: '#111', font: '13px/1.5 Calibri, Arial, sans-serif' }}>
      <style>{'@media print { .no-print { display: none } } .vb td, .vb th { border: 1px solid #999; padding: 3px 6px } .vb { border-collapse: collapse; width: 100% } .r { text-align: right }'}</style>
      <div className="no-print" style={{ textAlign: 'right' }}><button type="button" onClick={() => window.print()}>Print / Save as PDF</button></div>
      {b.status === 'Cancelled' && <div style={{ color: '#c00', fontWeight: 'bold', textAlign: 'center' }}>CANCELLED — {b.cancelRemarks}</div>}
      <h2 style={{ margin: 0 }}>{b.branch.name}</h2>
      <div>{b.branch.address}</div>
      <h3 style={{ textAlign: 'center' }}>VENDOR BILL VERIFICATION</h3>
      <p>Bill no. <strong>{b.billNo}</strong> ({b.receiptCode}) · Date {fmt(b.billDate)}{b.vendorRefNo && ` · Vendor's bill ${b.vendorRefNo}`}<br />
        Vendor: {b.vendor.name} ({b.vendor.code}){b.vendor.gstin && ` · GSTIN ${b.vendor.gstin}`}</p>
      <table className="vb">
        <thead><tr><th>#</th><th>Challan</th><th>Date</th><th>Truck</th><th className="r">Challan amount</th><th className="r">Advance</th><th className="r">Current payment</th><th className="r">Pending</th></tr></thead>
        <tbody>{b.challans.map((c, i) => <tr key={c.challanNo}><td>{i + 1}</td><td>{c.challanNo}</td><td>{fmt(c.challanDate)}</td><td>{c.truckNo}</td><td className="r">{money(c.freight)}</td><td className="r">{money(c.advance)}</td><td className="r">{money(c.currentPayment)}</td><td className="r">{money(c.pending)}</td></tr>)}</tbody>
        <tfoot><tr><th colSpan={6} className="r">Total</th><th className="r">{money(b.paid)}</th><th className="r">{money(b.pending)}</th></tr></tfoot>
      </table>
      <p>Bill amount ₹ {money(b.billAmount)} · Deduction ₹ {money(b.deduction)}{b.narration && <><br />Narration: {b.narration}</>}</p>
      <p style={{ textAlign: 'right', marginTop: 48 }}>Verified by<br /><br />Authorised signatory</p>
    </div>
  );
}
