// Miscellaneous / warehouse bills (kind = misc | warehouse) — replaces Invoice/Miscellaneous_Bill.aspx, Warehouse_bill.aspx and
// their submission, finalize, cancel, report and print pages. "New bill": a one-line bill (client, month, service, SAC, GST
// slab, quantity × rate). "Bills": submit to the client, finalize (voucher Dr client BILLED / Cr OUTPUT GST + booking income),
// undo finalize, cancel (until finalized), print.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Alert, App, Button, Card, Col, DatePicker, Descriptions, Form, Input, InputNumber, Modal, Radio, Row, Select, Space, Table, Tabs, Tag, Typography,
} from 'antd';
import { CheckOutlined, PrinterOutlined, RollbackOutlined, SaveOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import SearchSelect from '../../components/SearchSelect.jsx';
import MasterSelect from '../../components/masters/MasterSelect.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');
const money = (v) => Number(v || 0).toFixed(2);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const TITLE = { misc: 'Miscellaneous Bill', warehouse: 'Warehouse Bill' };
const STATUS_COLOR = { Generated: 'green', Submitted: 'blue', Finalized: 'purple', Cancelled: 'red' };
const openPrint = (kind, billNo) => window.open(`/print/other-bill/${kind}/${encodeURIComponent(billNo)}`, '_blank');
const problem = (e) => {
  const details = e.response?.data?.details;
  return details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e);
};

function NewBill({ kind, opts }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [client, setClient] = useState(null);
  const v = Form.useWatch([], form) ?? {};
  const slab = opts.slabs.find((x) => x.value === v.slab);
  // TaxCalculat: the same sums the server makes
  const taxable = r2((v.quantity || 0) * (v.rate || 0));
  const intra = v.taxType === 'Intrastate';
  const tax = slab ? { cgst: intra ? r2(taxable * slab.cgst / 100) : 0, sgst: intra ? r2(taxable * slab.sgst / 100) : 0, igst: intra ? 0 : r2(taxable * slab.igst / 100) } : { cgst: 0, sgst: 0, igst: 0 };
  const total = r2(taxable + tax.cgst + tax.sgst + tax.igst);

  const save = useMutation({
    mutationFn: (f) => api.post(`/other-bills/${kind}`, {
      clientCode: client.code, billDate: f.billDate.format('YYYY-MM-DD'), dueDate: f.dueDate ? f.dueDate.format('YYYY-MM-DD') : '',
      month: f.month, year: String(f.year), serviceType: f.serviceType, serviceFor: f.serviceFor, sac: f.sac, slab: f.slab,
      taxType: f.taxType, quantity: f.quantity, rate: f.rate, remarks: f.remarks || '',
    }),
    onSuccess: (r) => {
      modal.success({ title: 'Bill generated', content: <>Bill no. <strong>{r.data.billNo}</strong> — ₹ {money(r.data.totalAmount)}</>, okText: 'Print', onOk: () => openPrint(kind, r.data.billNo) });
      form.resetFields(['quantity', 'rate', 'remarks']);
      queryClient.invalidateQueries({ queryKey: ['other-bills', kind] });
    },
    onError: (e) => message.error(problem(e)),
  });

  return (
    <Form form={form} layout="vertical" onFinish={(f) => (client ? save.mutate(f) : message.warning('Please Select Vendor for Invoice'))}
      initialValues={{
        billDate: dayjs(), dueDate: dayjs(), month: opts.months[dayjs().month()], year: dayjs().year(), serviceType: 'GTA', serviceFor: 'Others',
        slab: opts.slabs.find((x) => x.label.includes('18'))?.value ?? opts.slabs[0]?.value, taxType: 'Intrastate', quantity: 1,
      }}>
      <Row gutter={12}>
        <Col xs={24} md={8}>
          <Form.Item label="Client" required>
            <SearchSelect placeholder="Type client name" minChars={2}
              fetcher={(q) => api.get(`/other-bills/${kind}/clients`, { params: { q } }).then((r) => r.data.map((c) => ({ ...c, value: `${c.name} : ${c.code}`, label: `${c.name} : ${c.code}` })))}
              onPick={(c) => { setClient(c); form.setFieldsValue({ taxType: c.taxType, dueDate: dayjs(form.getFieldValue('billDate')).add(c.creditPeriod || 0, 'day') }); }}
              onChange={(x) => { if (!x) setClient(null); }} />
          </Form.Item>
        </Col>
        <Col xs={12} md={4}><Form.Item label="Bill date" name="billDate" rules={[{ required: true }]}><DatePicker format={DATE_FMT} style={{ width: '100%' }} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} /></Form.Item></Col>
        <Col xs={12} md={4}><Form.Item label="Due date" name="dueDate"><DatePicker format={DATE_FMT} style={{ width: '100%' }} /></Form.Item></Col>
        <Col xs={12} md={4}><Form.Item label="Month" name="month" rules={[{ required: true }]}><Select options={opts.months.map((m) => ({ value: m, label: m }))} /></Form.Item></Col>
        <Col xs={12} md={4}><Form.Item label="Year" name="year" rules={[{ required: true }]}><InputNumber min={2000} max={2100} style={{ width: '100%' }} /></Form.Item></Col>
        <Col xs={12} md={4}><Form.Item label="Service" name="serviceType"><Radio.Group optionType="button" options={opts.serviceTypes} /></Form.Item></Col>
        <Col xs={12} md={5}><Form.Item label="Service for" name="serviceFor" rules={[{ required: true }]}><Select options={opts.serviceFor.map((x) => ({ value: x, label: x }))} /></Form.Item></Col>
        <Col xs={12} md={4}><Form.Item label="SAC" name="sac" rules={[{ required: true, message: 'Select the SAC' }]}><MasterSelect master="sac" valueField="Sac_Code" options={opts.sacCodes.map((x) => ({ value: x, label: x }))} /></Form.Item></Col>
        <Col xs={12} md={4}><Form.Item label="GST slab" name="slab" rules={[{ required: true }]}><Select options={opts.slabs} /></Form.Item></Col>
        <Col xs={24} md={7}><Form.Item label="GST" name="taxType"><Radio.Group optionType="button" options={opts.taxTypes} /></Form.Item></Col>
        <Col xs={12} md={4}><Form.Item label="Quantity" name="quantity" rules={[{ required: true }]}><InputNumber min={0.01} style={{ width: '100%' }} /></Form.Item></Col>
        <Col xs={12} md={4}><Form.Item label="Rate" name="rate" rules={[{ required: true, message: 'Please Enter Rate' }]}><InputNumber min={0.01} style={{ width: '100%' }} /></Form.Item></Col>
        <Col xs={24} md={16}><Form.Item label="Remarks" name="remarks"><Input maxLength={500} /></Form.Item></Col>
      </Row>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Typography.Text>
          Taxable ₹ {money(taxable)} · {intra ? `CGST ₹ ${money(tax.cgst)} · SGST ₹ ${money(tax.sgst)}` : `IGST ₹ ${money(tax.igst)}`} · <strong>Total ₹ {money(total)}</strong>
        </Typography.Text>
        <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending}>Generate bill</Button>
      </Space>
    </Form>
  );
}

function Bills({ kind }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [params, setParams] = useState({ from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), status: 'all', search: '' });
  const [submitting, setSubmitting] = useState(null);
  const [subForm] = Form.useForm();
  const { data = [], isFetching, error } = useQuery({ queryKey: ['other-bills', kind, params], queryFn: () => api.get(`/other-bills/${kind}`, { params }).then((r) => r.data) });
  const act = useMutation({
    mutationFn: ({ billNo, what, body }) => api.post(`/other-bills/${kind}/${encodeURIComponent(billNo)}/${what}`, body ?? {}),
    onSuccess: (r) => { message.success(r.data.message); setSubmitting(null); queryClient.invalidateQueries({ queryKey: ['other-bills', kind] }); },
    onError: (e) => message.error(problem(e)),
  });
  const today = dayjs().format('YYYY-MM-DD');
  const confirm = (title, content, onOk, danger) => modal.confirm({ title, content, okButtonProps: { danger }, onOk });
  const cancel = (r) => {
    let reason = '';
    modal.confirm({
      title: `Cancel bill ${r.billNo}?`, okText: 'Cancel bill', okButtonProps: { danger: true }, cancelText: 'Keep',
      content: <Input placeholder="Reason" onChange={(e) => { reason = e.target.value; }} aria-label="Reason for cancelling" />,
      onOk: () => act.mutateAsync({ billNo: r.billNo, what: 'cancel', body: { remarks: reason } }),
    });
  };

  return (
    <>
      <Form layout="inline" style={{ rowGap: 8, marginBottom: 12 }} initialValues={{ range: [dayjs(params.from), dayjs(params.to)], status: 'all' }}
        onFinish={(f) => setParams({ from: f.range[0].format('YYYY-MM-DD'), to: f.range[1].format('YYYY-MM-DD'), status: f.status, search: f.search?.trim() || '' })}>
        <Form.Item name="range" label="Bill date"><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
        <Form.Item name="status"><Select style={{ width: 130 }} options={['all', 'Generated', 'Submitted', 'Finalized', 'Cancelled'].map((x) => ({ value: x, label: x === 'all' ? 'All' : x }))} /></Form.Item>
        <Form.Item name="search"><Input placeholder="Bill no. / client" allowClear style={{ width: 180 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Alert type="error" showIcon message={errorMessage(error)} />}
      <Table size="middle" rowKey="billNo" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }} pagination={{ defaultPageSize: 20, showTotal: (t) => `${t} bills` }}
        columns={[
          { title: 'Bill no.', dataIndex: 'billNo' }, { title: 'Date', dataIndex: 'billDate', render: fmt },
          { title: 'Client', dataIndex: 'clientName' }, { title: 'For', key: 'for', render: (_, r) => `${r.month} ${r.year} · ${r.serviceFor}` },
          { title: 'Taxable', dataIndex: 'taxable', align: 'right', render: money }, { title: 'Total', dataIndex: 'total', align: 'right', render: money },
          { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={STATUS_COLOR[s]}>{s}</Tag> },
          {
            title: '', key: 'act', render: (_, r) => (
              <Space wrap>
                <Button size="small" icon={<PrinterOutlined />} aria-label={`Print ${r.billNo}`} onClick={() => openPrint(kind, r.billNo)} />
                {r.status === 'Generated' && <Button size="small" icon={<SendOutlined />} onClick={() => { subForm.resetFields(); setSubmitting(r); }}>Submit</Button>}
                {['Generated', 'Submitted'].includes(r.status) && (
                  <Button size="small" type="primary" icon={<CheckOutlined />} loading={act.isPending && act.variables?.billNo === r.billNo && act.variables?.what === 'finalize'}
                    onClick={() => confirm(`Finalize ${r.billNo}?`, `Voucher: client Dr ₹ ${money(r.total)}; income and GST Cr.`, () => act.mutateAsync({ billNo: r.billNo, what: 'finalize', body: { date: today } }))}>Finalize</Button>
                )}
                {r.status === 'Finalized' && (
                  <Button size="small" icon={<RollbackOutlined />} onClick={() => confirm(`Undo finalize of ${r.billNo}?`, 'The voucher is cancelled.', () => act.mutateAsync({ billNo: r.billNo, what: 'unfinalize' }), true)}>Undo finalize</Button>
                )}
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

export default function OtherBillPage({ kind = 'misc' }) {
  const { user } = useAuth();
  const [tab, setTab] = useState('new');
  const { data: opts, error } = useQuery({ queryKey: ['other-bill-options'], queryFn: () => api.get(`/other-bills/${kind}/options`).then((r) => r.data) });
  return (
    <Card className="page-card" title={TITLE[kind]} extra={<Typography.Text type="secondary">{user.currentBranch.name} : {user.currentBranch.code}</Typography.Text>}>
      {error && <Alert type="error" showIcon message={errorMessage(error)} />}
      {opts && (
        <Tabs activeKey={tab} onChange={setTab} destroyOnHidden items={[
          { key: 'new', label: 'New bill', children: <NewBill kind={kind} opts={opts} /> },
          { key: 'list', label: 'Bills', children: <Bills kind={kind} /> },
        ]} />
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ print (MiscellaneousBillPrint / WarehousePrint)

export function OtherBillPrintPage({ kind, billNo }) {
  const { data: b, error, isLoading } = useQuery({ queryKey: ['other-bill', kind, billNo], queryFn: () => api.get(`/other-bills/${kind}/${encodeURIComponent(billNo)}`).then((r) => r.data) });
  if (isLoading) return <div style={{ padding: 40 }}>Loading bill…</div>;
  if (error) return <div style={{ padding: 40, color: '#c00' }}>{errorMessage(error)}</div>;
  const intra = b.taxType === 'Intrastate';
  return (
    <div style={{ maxWidth: 900, margin: '16px auto', padding: 24, background: '#fff', color: '#111', font: '13px/1.5 Calibri, Arial, sans-serif' }}>
      <style>{'@media print { .no-print { display: none } } .ob td, .ob th { border: 1px solid #999; padding: 4px 6px } .ob { border-collapse: collapse; width: 100% } .r { text-align: right }'}</style>
      <div className="no-print" style={{ textAlign: 'right' }}><button type="button" onClick={() => window.print()}>Print / Save as PDF</button></div>
      {b.status === 'Cancelled' && <div style={{ color: '#c00', fontWeight: 'bold', textAlign: 'center' }}>CANCELLED</div>}
      <h2 style={{ margin: 0 }}>{b.branch.name}</h2>
      <div>{b.branch.address}{b.branch.gstin && ` · GSTIN ${b.branch.gstin}`}</div>
      <h3 style={{ textAlign: 'center' }}>TAX INVOICE — {b.title.toUpperCase()}</h3>
      <Descriptions size="small" bordered column={2} items={[
        { key: 1, label: 'Bill no.', children: b.billNo }, { key: 2, label: 'Bill date', children: fmt(b.billDate) },
        { key: 3, label: 'Bill to', children: <>{b.client.name} ({b.client.code})<br />{b.client.address}{b.client.gstin && <><br />GSTIN {b.client.gstin}</>}</> },
        { key: 4, label: 'Due date', children: fmt(b.dueDate) },
      ]} />
      <table className="ob" style={{ marginTop: 12 }}>
        <thead><tr><th>Description</th><th>SAC</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Taxable</th>{intra ? <><th className="r">CGST</th><th className="r">SGST</th></> : <th className="r">IGST</th>}<th className="r">Total</th></tr></thead>
        <tbody><tr>
          <td>{b.serviceFor} — {b.month} {b.year} ({b.serviceType})</td><td>{b.sac}</td><td className="r">{b.quantity}</td><td className="r">{money(b.rate)}</td>
          <td className="r">{money(b.taxable)}</td>{intra ? <><td className="r">{money(b.cgstAmt)} ({b.cgst}%)</td><td className="r">{money(b.sgstAmt)} ({b.sgst}%)</td></> : <td className="r">{money(b.igstAmt)} ({b.igst}%)</td>}
          <td className="r"><strong>{money(b.total)}</strong></td>
        </tr></tbody>
      </table>
      {b.remarks && <p>Remarks: {b.remarks}</p>}
      <p style={{ textAlign: 'right', marginTop: 48 }}>For {b.branch.name}<br /><br />Authorised signatory</p>
    </div>
  );
}

/** Route /print/other-bill/:kind/:billNo (outside the menu layout). */
export function OtherBillPrintRoute() {
  const { kind, billNo } = useParams();
  return <OtherBillPrintPage kind={kind} billNo={billNo} />;
}
