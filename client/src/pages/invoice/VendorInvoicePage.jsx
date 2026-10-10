// Other vendor invoice — replaces Invoice/VendorInvoice.aspx, OthVndInvoiceDetails.aspx and OtherVendorPrint.aspx.
// "New invoice": an other vendor's bill (stationery, repairs, services) with product lines, GST slab per line, the vendor's TDS
// and an optional cost-centre split (required for vendors marked so). Saving posts the PURCHASE/PAYBILL voucher:
// Cr vendor (total − TDS), Dr INPUT CGST / SGST / IGST, Dr the expense ledger (taxable), Cr the TDS ledger.
// "Invoices": list, print (with the voucher), cancel.
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Empty, Form, Input, InputNumber, Radio, Row, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import { DeleteOutlined, PlusOutlined, PrinterOutlined, SaveOutlined, StopOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import SearchSelect from '../../components/SearchSelect.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');
const money = (v) => Number(v || 0).toFixed(2);
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const openPrint = (no) => window.open(`/print/vendor-invoice/${encodeURIComponent(no)}`, '_blank');
const problem = (e) => {
  const details = e.response?.data?.details;
  return details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e);
};
/** Same sums as the server (TaxCalculat): taxable = qty × rate; GST = CGST + SGST, IGST otherwise; TDS on taxable. */
export const lineAmounts = (slab, taxType, quantity, rate, tdsPct) => {
  const taxable = r2(quantity * rate);
  const gst = taxType === 'GST';
  const cgstAmt = r2(taxable * (gst ? slab?.cgst ?? 0 : 0) / 100); const sgstAmt = r2(taxable * (gst ? slab?.sgst ?? 0 : 0) / 100);
  const igstAmt = r2(taxable * (gst ? 0 : slab?.igst ?? 0) / 100);
  const total = r2(taxable + cgstAmt + sgstAmt + igstAmt); const tdsAmt = r2(taxable * tdsPct / 100);
  return { taxable, cgstAmt, sgstAmt, igstAmt, total, tdsAmt, payable: r2(total - tdsAmt) };
};

function NewInvoice({ options }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [vendor, setVendor] = useState(null);
  const [lines, setLines] = useState([]);
  const [costs, setCosts] = useState([]);
  const [line, setLine] = useState({ product: null, text: '', quantity: 1, rate: 0, slab: undefined, description: '' });
  const [cost, setCost] = useState({ type: 'Branch/Hub', target: null, text: '', amount: 0 });
  const partType = Form.useWatch('partType', form) ?? 'Purchase';
  const taxType = Form.useWatch('taxType', form) ?? 'GST';
  const slabs = useMemo(() => new Map(options.slabs.map((s) => [s.value, s])), [options]);
  const tds = vendor?.tds ?? 0;

  const rows = lines.map((l) => ({ ...l, ...lineAmounts(slabs.get(l.slab), taxType, l.quantity, l.rate, tds) }));
  const tot = rows.reduce((t, l) => ({
    taxable: r2(t.taxable + l.taxable), tax: r2(t.tax + l.cgstAmt + l.sgstAmt + l.igstAmt), total: r2(t.total + l.total), tds: r2(t.tds + l.tdsAmt),
  }), { taxable: 0, tax: 0, total: 0, tds: 0 });
  const costTotal = r2(costs.reduce((t, c) => t + c.amount, 0));

  function addLine() {
    if (!line.product) { message.warning('Please Select Valide Product.'); return; }
    if (!(line.quantity > 0) || !(line.rate > 0)) { message.warning('Please Enter Rate or Qty first'); return; }
    if (!line.slab) { message.warning('Select the GST slab'); return; }
    setLines((ls) => [...ls, { key: Date.now(), itemCode: line.product.code, itemName: line.product.name, uom: line.product.uom, sacHsn: line.product.sacHsn, quantity: line.quantity, rate: line.rate, slab: line.slab, description: line.description }]);
    setLine((l) => ({ ...l, product: null, text: '', quantity: 1, rate: 0, description: '' }));
  }
  function addCost() {
    if (!cost.target) { message.warning('Please Select Valide Selection Details.'); return; }
    if (!(cost.amount > 0)) { message.warning('Enter the part amount'); return; }
    if (costs.some((c) => c.type === cost.type && c.code === cost.target.code)) { message.warning('allrady exist . please enter some another'); return; }
    if (r2(costTotal + cost.amount) > tot.taxable) { message.warning('Part Amount should not greater then Taxable Amt'); return; }
    setCosts((cs) => [...cs, { type: cost.type, code: cost.target.code, name: cost.target.name, amount: cost.amount }]);
    setCost((c) => ({ ...c, target: null, text: '', amount: 0 }));
  }

  const save = useMutation({
    mutationFn: (v) => api.post('/vendor-invoices', {
      invoiceDate: v.invoiceDate.format('YYYY-MM-DD'), invoiceFor: v.invoiceFor, partType: v.partType, vendorLedger: vendor.ledger,
      vendorInvNo: v.vendorInvNo || '', purchaseDate: v.purchaseDate ? v.purchaseDate.format('YYYY-MM-DD') : '', expenseLedger: v.expenseLedger,
      tdsLedger: tot.tds > 0 ? v.tdsLedger || 'TDS PAYABLE' : '', taxType: v.taxType, narration: v.narration || '',
      lines: lines.map(({ itemCode, quantity, rate, slab, description }) => ({ itemCode, quantity, rate, slab, description: description || '' })),
      costCentres: costs,
    }),
    onSuccess: (r) => {
      modal.success({ title: 'Record Successfully Added', content: <>Invoice no. <strong>{r.data.invoiceNo}</strong> — total ₹ {money(r.data.totalAmount)}, payable ₹ {money(r.data.payable)}</>, okText: 'Print', onOk: () => openPrint(r.data.invoiceNo) });
      setLines([]); setCosts([]);
      form.setFieldsValue({ vendorInvNo: '', narration: '' });
      queryClient.invalidateQueries({ queryKey: ['vendor-invoices'] });
    },
    onError: (e) => message.error(problem(e)),
  });

  return (
    <Form form={form} layout="vertical"
      initialValues={{ invoiceDate: dayjs(), invoiceFor: options.invoiceFor[0], partType: 'Purchase', taxType: 'GST', tdsLedger: 'TDS PAYABLE' }}
      onFinish={(v) => {
        if (!vendor) { message.warning('Please Select Vendor for Invoice'); return; }
        if (!lines.length) { message.warning('Add Invoice Details First'); return; }
        if (vendor.costCentre && !costs.length) { message.warning('This vendor needs the cost centre split'); return; }
        save.mutate(v);
      }}>
      <Form.Item name="invoiceFor" label="Invoice for"><Radio.Group options={options.invoiceFor} /></Form.Item>
      <Row gutter={12}>
        <Col xs={24} sm={12} md={6}><Form.Item label="Invoice date" name="invoiceDate" rules={[{ required: true }]}><DatePicker format={DATE_FMT} allowClear={false} style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} /></Form.Item></Col>
        <Col xs={24} sm={12} md={6}><Form.Item label="Part type" name="partType"><Select options={options.partTypes.map((p) => ({ value: p, label: p }))} onChange={() => { setLines([]); setLine((l) => ({ ...l, product: null, text: '' })); }} /></Form.Item></Col>
        <Col xs={24} sm={12} md={6}><Form.Item label="Tax type" name="taxType"><Radio.Group options={options.taxTypes} optionType="button" /></Form.Item></Col>
        <Col xs={24} sm={12} md={6}><Form.Item label="Vendor bill no." name="vendorInvNo"><Input maxLength={50} /></Form.Item></Col>
        <Col xs={24} md={12}>
          <Form.Item label="Vendor" required extra={vendor && <Space size={4} wrap><Tag>TDS {vendor.tds}%</Tag>{vendor.costCentre && <Tag color="orange">cost centre required</Tag>}{vendor.gstin && <Tag>GSTIN {vendor.gstin}</Tag>}</Space>}>
            <SearchSelect placeholder="Type vendor name" minChars={2}
              fetcher={(q) => api.get('/vendor-invoices/vendors', { params: { q } }).then((r) => r.data.map((v) => ({ ...v, value: v.ledger, label: v.ledger })))}
              onPick={(v) => { setVendor(v); if (!v.costCentre) setCosts([]); }} onChange={(x) => { if (!x) setVendor(null); }} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12} md={6}><Form.Item label="Vendor bill date" name="purchaseDate"><DatePicker format={DATE_FMT} style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} /></Form.Item></Col>
        <Col xs={24} md={12}>
          <Form.Item label="Expense ledger" name="expenseLedger" rules={[{ required: true, message: 'Please Select Ledger for Invoice.' }]}>
            <SearchSelect placeholder="Type ledger name" minChars={2} fetcher={(q) => api.get('/vendor-invoices/ledgers', { params: { q, kind: 'expense' } }).then((r) => r.data.map((x) => ({ value: x, label: x })))} />
          </Form.Item>
        </Col>
        {tds > 0 && (
          <Col xs={24} md={12}>
            <Form.Item label="TDS ledger" name="tdsLedger" rules={[{ required: true }]}>
              <SearchSelect placeholder="TDS PAYABLE" minChars={1} fetcher={(q) => api.get('/vendor-invoices/ledgers', { params: { q, kind: 'tds' } }).then((r) => r.data.map((x) => ({ value: x, label: x })))} />
            </Form.Item>
          </Col>
        )}
      </Row>

      <Card size="small" title="Invoice details" style={{ marginBottom: 12 }}>
        <Space wrap align="end" style={{ marginBottom: 8 }}>
          <div style={{ width: 260 }}>
            <Typography.Text type="secondary">{partType === 'Pay Bill' ? 'Service (SAC)' : 'Item (HSN)'}</Typography.Text>
            <SearchSelect placeholder="Type product" minChars={1} value={line.text} aria-label="Product"
              fetcher={(q) => api.get('/vendor-invoices/products', { params: { q, partType } }).then((r) => r.data.map((p) => ({ ...p, value: `${p.name} : ${p.code}`, label: `${p.name} : ${p.code}` })))}
              onPick={(p) => setLine((l) => ({ ...l, product: p, text: p.value }))} onChange={(x) => setLine((l) => ({ ...l, text: x ?? '', product: x ? l.product : null }))}
              quickAdd={{
                master: 'product',
                initial: { IsSacHsn: partType === 'Pay Bill' },   // a service (SAC) for Pay Bill, goods (HSN) for Purchase
                toOption: (r) => {
                  const t = (v) => String(v ?? '').trim();
                  return { code: t(r.ProductCode), name: t(r.ProductName), uom: t(r.UOM), sacHsn: t(r.SacHSN), value: `${t(r.ProductName)} : ${t(r.ProductCode)}` };
                },
              }} />
          </div>
          {line.product && <Typography.Text type="secondary">{line.product.uom} · {line.product.sacHsn}</Typography.Text>}
          <InputNumber min={0} value={line.quantity} onChange={(x) => setLine((l) => ({ ...l, quantity: x ?? 0 }))} prefix="Qty" style={{ width: 110 }} aria-label="Quantity" />
          <InputNumber min={0} value={line.rate} onChange={(x) => setLine((l) => ({ ...l, rate: x ?? 0 }))} prefix="Rate" style={{ width: 140 }} aria-label="Rate" />
          <Select placeholder="GST slab" value={line.slab} onChange={(x) => setLine((l) => ({ ...l, slab: x }))} options={options.slabs} style={{ width: 120 }} aria-label="GST slab" />
          <Input placeholder="Description" value={line.description} onChange={(e) => setLine((l) => ({ ...l, description: e.target.value }))} maxLength={500} style={{ width: 180 }} />
          <Button icon={<PlusOutlined />} onClick={addLine}>Add</Button>
        </Space>
        <Table size="small" rowKey="key" dataSource={rows} pagination={false} scroll={{ x: 'max-content' }} locale={{ emptyText: 'Add the bill lines' }}
          columns={[
            { title: 'Item', dataIndex: 'itemName', render: (v, r) => <>{v} <Typography.Text type="secondary">({r.itemCode})</Typography.Text></> },
            { title: 'HSN/SAC', dataIndex: 'sacHsn' }, { title: 'Qty', dataIndex: 'quantity', align: 'right' },
            { title: 'Rate', dataIndex: 'rate', align: 'right', render: money }, { title: 'Taxable', dataIndex: 'taxable', align: 'right', render: money },
            { title: 'Slab', dataIndex: 'slab', render: (v) => slabs.get(v)?.label },
            { title: 'CGST', dataIndex: 'cgstAmt', align: 'right', render: money }, { title: 'SGST', dataIndex: 'sgstAmt', align: 'right', render: money },
            { title: 'IGST', dataIndex: 'igstAmt', align: 'right', render: money }, { title: 'Total', dataIndex: 'total', align: 'right', render: money },
            { title: 'TDS', dataIndex: 'tdsAmt', align: 'right', render: money }, { title: 'Payable', dataIndex: 'payable', align: 'right', render: (v) => <strong>{money(v)}</strong> },
            { title: '', key: 'del', render: (_, r) => <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`Remove ${r.itemName}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== r.key))} /> },
          ]} />
      </Card>

      {(vendor?.costCentre || costs.length > 0) && (
        <Card size="small" title="Cost centre" style={{ marginBottom: 12 }} extra={<Typography.Text type="secondary">₹ {money(costTotal)} of {money(tot.taxable)}</Typography.Text>}>
          <Space wrap align="end" style={{ marginBottom: 8 }}>
            <Select value={cost.type} onChange={(x) => setCost({ type: x, target: null, text: '', amount: cost.amount })} options={options.costTypes.map((c) => ({ value: c, label: c }))} style={{ width: 150 }} aria-label="Cost centre type" />
            <div style={{ width: 240 }}>
              <SearchSelect placeholder={`Select ${cost.type}`} minChars={1} value={cost.text} aria-label="Cost centre"
                fetcher={(q) => api.get('/vendor-invoices/cost-targets', { params: { q, type: cost.type } }).then((r) => r.data.map((t) => ({ ...t, value: `${t.name} : ${t.code}`, label: `${t.name} : ${t.code}` })))}
                onPick={(t) => setCost((c) => ({ ...c, target: t, text: t.value }))} onChange={(x) => setCost((c) => ({ ...c, text: x ?? '', target: x ? c.target : null }))} />
            </div>
            <InputNumber min={0} value={cost.amount} onChange={(x) => setCost((c) => ({ ...c, amount: x ?? 0 }))} prefix="₹" style={{ width: 140 }} aria-label="Part amount" />
            <Button icon={<PlusOutlined />} onClick={addCost}>Add</Button>
          </Space>
          <Table size="small" rowKey={(r) => `${r.type}|${r.code}`} dataSource={costs} pagination={false}
            columns={[
              { title: 'Cost / profit', dataIndex: 'type' }, { title: 'Code', dataIndex: 'code' }, { title: 'Name', dataIndex: 'name' },
              { title: 'Amount', dataIndex: 'amount', align: 'right', render: money },
              { title: '', key: 'del', render: (_, r) => <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`Remove ${r.name}`} onClick={() => setCosts((cs) => cs.filter((x) => x !== r))} /> },
            ]} />
        </Card>
      )}

      <Row gutter={12} align="bottom">
        <Col xs={24} md={12}><Form.Item label="Narration" name="narration"><Input.TextArea rows={2} maxLength={1000} placeholder="Purchase from Vendor … (filled in when left empty)" /></Form.Item></Col>
        <Col xs={24} md={12}>
          <Space wrap style={{ marginBottom: 24, justifyContent: 'flex-end', width: '100%' }}>
            <Typography.Text>Taxable ₹ {money(tot.taxable)} · Tax ₹ {money(tot.tax)} · Total <strong>₹ {money(tot.total)}</strong> · TDS ₹ {money(tot.tds)} · Payable <strong>₹ {money(tot.total - tot.tds)}</strong></Typography.Text>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={save.isPending} disabled={!lines.length || !vendor}>Save</Button>
          </Space>
        </Col>
      </Row>
    </Form>
  );
}

function Invoices() {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [params, setParams] = useState({ from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), status: 'all', search: '' });
  const { data = [], isFetching, error } = useQuery({ queryKey: ['vendor-invoices', params], queryFn: () => api.get('/vendor-invoices', { params }).then((r) => r.data) });
  const cancel = useMutation({
    mutationFn: ({ no, remarks }) => api.post(`/vendor-invoices/${encodeURIComponent(no)}/cancel`, { remarks }),
    onSuccess: (r) => { message.success(r.data.message); queryClient.invalidateQueries({ queryKey: ['vendor-invoices'] }); },
    onError: (e) => message.error(problem(e)),
  });
  const askCancel = (r) => {
    let reason = '';
    modal.confirm({
      title: `Cancel invoice ${r.invoiceNo}?`, content: <><p>Its voucher will be cancelled too.</p><Input placeholder="Reason" onChange={(e) => { reason = e.target.value; }} aria-label="Reason for cancelling" /></>,
      okText: 'Cancel invoice', okButtonProps: { danger: true }, cancelText: 'Keep', onOk: () => cancel.mutateAsync({ no: r.invoiceNo, remarks: reason }),
    });
  };
  return (
    <>
      <Form layout="inline" style={{ rowGap: 8, marginBottom: 12 }} initialValues={{ range: [dayjs(params.from), dayjs(params.to)], status: 'all' }}
        onFinish={(f) => setParams({ from: f.range[0].format('YYYY-MM-DD'), to: f.range[1].format('YYYY-MM-DD'), status: f.status, search: f.search?.trim() || '' })}>
        <Form.Item name="range" label="Invoice date"><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
        <Form.Item name="status"><Select style={{ width: 120 }} options={['all', 'Active', 'Cancelled'].map((x) => ({ value: x, label: x === 'all' ? 'All' : x }))} /></Form.Item>
        <Form.Item name="search"><Input placeholder="Invoice / vendor / bill no." allowClear style={{ width: 210 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Alert type="error" showIcon message={errorMessage(error)} />}
      <Table size="middle" rowKey="invoiceNo" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }} pagination={{ defaultPageSize: 20 }}
        columns={[
          { title: 'Invoice no.', dataIndex: 'invoiceNo' }, { title: 'Date', dataIndex: 'invoiceDate', render: fmt },
          { title: 'Vendor', dataIndex: 'vendorName' }, { title: 'Vendor bill', dataIndex: 'vendorInvNo' }, { title: 'Type', dataIndex: 'partType' },
          { title: 'Expense ledger', dataIndex: 'expenseLedger', ellipsis: true },
          { title: 'Total', dataIndex: 'total', align: 'right', render: money }, { title: 'TDS', dataIndex: 'tds', align: 'right', render: money },
          { title: 'Payable', dataIndex: 'payable', align: 'right', render: money },
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

export default function VendorInvoicePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('new');
  const { data: options, error } = useQuery({ queryKey: ['vendor-invoice-options'], queryFn: () => api.get('/vendor-invoices/options').then((r) => r.data), staleTime: 300_000 });
  return (
    <Card className="page-card" title="Vendor Invoice" extra={<Typography.Text type="secondary">{user.currentBranch.name} : {user.currentBranch.code}</Typography.Text>}>
      {error && <Alert type="error" showIcon message={errorMessage(error)} />}
      <Tabs activeKey={tab} onChange={setTab} destroyOnHidden items={[
        { key: 'new', label: 'New invoice', children: options ? <NewInvoice options={options} /> : <Empty description="Loading…" /> },
        { key: 'list', label: 'Invoices', children: <Invoices /> },
      ]} />
    </Card>
  );
}

/** Route /print/vendor-invoice/:invoiceNo — OtherVendorPrint (OtherVendorBill report) + OthVndInvoiceDetails. */
export function VendorInvoicePrintRoute() {
  const { invoiceNo } = useParams();
  const { data: b, error, isLoading } = useQuery({ queryKey: ['vendor-invoice', invoiceNo], queryFn: () => api.get(`/vendor-invoices/${encodeURIComponent(invoiceNo)}`).then((r) => r.data) });
  if (isLoading) return <div style={{ padding: 40 }}>Loading invoice…</div>;
  if (error) return <div style={{ padding: 40, color: '#c00' }}>{errorMessage(error)}</div>;
  return (
    <div style={{ maxWidth: 1000, margin: '16px auto', padding: 24, background: '#fff', color: '#111', font: '13px/1.5 Calibri, Arial, sans-serif' }}>
      <style>{'@media print { .no-print { display: none } } .vi td, .vi th { border: 1px solid #999; padding: 3px 6px } .vi { border-collapse: collapse; width: 100%; margin-bottom: 12px } .r { text-align: right }'}</style>
      <div className="no-print" style={{ textAlign: 'right' }}><button type="button" onClick={() => window.print()}>Print / Save as PDF</button></div>
      {b.status === 'Cancelled' && <div style={{ color: '#c00', fontWeight: 'bold', textAlign: 'center' }}>CANCELLED — {b.cancelRemarks}</div>}
      <h2 style={{ margin: 0 }}>{b.branch.name}</h2>
      <div>{b.branch.address}{b.branch.gstin && ` · GSTIN ${b.branch.gstin}`}</div>
      <h3 style={{ textAlign: 'center' }}>VENDOR INVOICE ({b.partType.toUpperCase()})</h3>
      <Descriptions size="small" column={2} bordered items={[
        { key: 'no', label: 'Invoice no.', children: b.invoiceNo }, { key: 'd', label: 'Date', children: fmt(b.invoiceDate) },
        { key: 'v', label: 'Vendor', children: <>{b.vendor.name} ({b.vendor.code})<br />{b.vendor.address}</> },
        { key: 'g', label: 'GSTIN / PAN', children: [b.vendor.gstin, b.vendor.pan].filter(Boolean).join(' / ') },
        { key: 'vb', label: 'Vendor bill', children: [b.vendorInvNo, fmt(b.purchaseDate)].filter(Boolean).join(' dated ') },
        { key: 'f', label: 'Invoice for', children: b.invoiceFor },
      ]} />
      <table className="vi" style={{ marginTop: 12 }}>
        <thead><tr><th>#</th><th>Item</th><th>HSN/SAC</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Taxable</th><th className="r">CGST</th><th className="r">SGST</th><th className="r">IGST</th><th className="r">Total</th><th className="r">TDS</th></tr></thead>
        <tbody>
          {b.lines.map((l, i) => (
            <tr key={i}><td>{i + 1}</td><td>{l.itemName}{l.description && <div style={{ color: '#555' }}>{l.description}</div>}</td><td>{l.sacHsn}</td>
              <td className="r">{l.quantity} {l.uom}</td><td className="r">{money(l.rate)}</td><td className="r">{money(l.taxable)}</td>
              <td className="r">{money(l.cgstAmt)}{l.cgst ? ` (${l.cgst}%)` : ''}</td><td className="r">{money(l.sgstAmt)}{l.sgst ? ` (${l.sgst}%)` : ''}</td>
              <td className="r">{money(l.igstAmt)}{l.igst ? ` (${l.igst}%)` : ''}</td><td className="r">{money(l.total)}</td><td className="r">{money(l.tdsAmt)}</td></tr>
          ))}
        </tbody>
        <tfoot>
          <tr><th colSpan={5} className="r">Total</th><th className="r">{money(b.taxable)}</th><th className="r">{money(b.cgstAmt)}</th><th className="r">{money(b.sgstAmt)}</th><th className="r">{money(b.igstAmt)}</th><th className="r">{money(b.total)}</th><th className="r">{money(b.tds)}</th></tr>
          <tr><th colSpan={10} className="r">Payable (total − TDS {b.tdsPct}%)</th><th className="r">{money(b.payable)}</th></tr>
        </tfoot>
      </table>
      {b.costCentres.length > 0 && (
        <table className="vi">
          <thead><tr><th>Cost / profit centre</th><th>Code</th><th>Name</th><th className="r">Amount</th></tr></thead>
          <tbody>{b.costCentres.map((c, i) => <tr key={i}><td>{c.type}</td><td>{c.code}</td><td>{c.name}</td><td className="r">{money(c.amount)}</td></tr>)}</tbody>
        </table>
      )}
      <table className="vi">
        <thead><tr><th>Voucher — ledger</th><th className="r">Dr</th><th className="r">Cr</th></tr></thead>
        <tbody>{b.voucher.map((v, i) => <tr key={i} style={v.cancelled ? { textDecoration: 'line-through', color: '#888' } : undefined}><td>{v.ledger}</td><td className="r">{v.dr ? money(v.dr) : ''}</td><td className="r">{v.cr ? money(v.cr) : ''}</td></tr>)}</tbody>
      </table>
      {b.narration && <p>Narration: {b.narration}</p>}
      <p style={{ textAlign: 'right', marginTop: 48 }}>For {b.branch.name}<br /><br />Authorised signatory</p>
    </div>
  );
}
