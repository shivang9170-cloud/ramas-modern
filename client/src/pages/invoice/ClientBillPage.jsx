// Client bill (GST) — replaces Invoice/Client_Bill_GST.aspx (and the older Client_Bill.aspx) and, with bill type Paid /
// To Pay, Invoice/client_topay_paid_bill.aspx (party = the consignor of Paid dockets booked here / the consignee of To Pay
// dockets delivered from here).
// Pick the client (address, due date from the credit period and GST / IGST follow), search its pending dockets billed at
// this branch, tick them and generate the bill. Amounts come from the dockets; a docket whose total does not add up is
// shown but cannot be ticked ("Amount Mismatch, Plz Modify docket").
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Alert, App, Button, Card, Col, DatePicker, Empty, Form, Input, Radio, Row, Select, Space, Table, Tag, Tooltip, Typography,
} from 'antd';
import { PrinterOutlined, SaveOutlined, SearchOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import SearchSelect from '../../components/SearchSelect.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const ymd = (d) => d.format('YYYY-MM-DD');
const money = (v) => Number(v || 0).toFixed(2);
export const openBillPrint = (billNo) => window.open(`/print/client-bill/${encodeURIComponent(billNo)}`, '_blank');

export default function ClientBillPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [params] = useSearchParams();   // ?type=Paid | To Pay (client_topay_paid_bill.aspx)
  const [client, setClient] = useState(null);
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const serviceType = Form.useWatch('serviceType', form);
  const billType = Form.useWatch('billType', form) ?? 'To Be Billed';
  const partyLabel = { 'To Be Billed': 'Client', Paid: 'Consignor (Paid)', 'To Pay': 'Consignee (To Pay)' }[billType];

  const { data: opts, error: optsError } = useQuery({ queryKey: ['client-bill-options'], queryFn: () => api.get('/client-bills/options').then((r) => r.data) });
  const sac = opts?.serviceTypes.find((t) => t.value === serviceType);

  function pickClient(c) {
    setClient(c);
    setRows(null); setSelected([]);
    // txtCompany_TextChanged: address, due date = bill date + credit period, GetTaxType
    form.setFieldsValue({
      address: c.address, taxType: c.taxType, dueDate: dayjs(form.getFieldValue('billDate')).add(c.creditPeriod || 0, 'day'),
    });
  }

  async function search() {
    if (!client) { message.warning('Select the client first'); return; }
    const v = form.getFieldsValue();
    setSearching(true);
    try {
      const { data } = await api.get('/client-bills/pending-dockets', {
        params: {
          billType, clientCode: client.code, from: ymd(v.range[0]), to: ymd(v.range[1]), taxType: v.taxType, bookingMode: v.bookingMode || '',
          delivery: v.delivery, dockets: v.dockets || '',
        },
      });
      setRows(data);
      setSelected(data.filter((d) => !d.problems.length).map((d) => d.docketNo));
      if (!data.length) message.info('Docket not found');
    } catch (e) { message.error(errorMessage(e)); } finally { setSearching(false); }
  }

  const chosen = useMemo(() => (rows ?? []).filter((r) => selected.includes(r.docketNo)), [rows, selected]);
  const t = chosen.reduce((a, r) => ({ freight: a.freight + r.freight, tax: a.tax + r.tax, total: a.total + r.total }), { freight: 0, tax: 0, total: 0 });

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    if (!chosen.length) { message.warning('Select Atleast One Docket'); return; }
    if (v.range[1].isAfter(v.billDate, 'day')) { message.warning('Search To Date Must be less then Bill Date'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/client-bills', {
        billType, clientCode: client.code, billDate: ymd(v.billDate), dueDate: v.dueDate ? ymd(v.dueDate) : '', serviceType: v.serviceType,
        taxType: v.taxType, bookingMode: v.bookingMode || '', rateOn: v.rateOn || '', from: ymd(v.range[0]), to: ymd(v.range[1]),
        address: v.address || '', manualBillNo: v.manualBillNo || '', remarks: v.remarks || '', docsEnclosed: v.docsEnclosed || '',
        dockets: chosen.map((r) => r.docketNo),
      });
      modal.success({
        title: 'Bill generated',
        content: <>Bill no. <strong>{data.billNo}</strong> — {data.dockets} docket(s), ₹ {money(data.totalAmount)}, due {dayjs(data.dueDate).format(DATE_FMT)}</>,
        okText: 'Print bill', onOk: () => openBillPrint(data.billNo),
      });
      await search();
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e));
    } finally { setSaving(false); }
  }

  if (optsError) return <Alert type="error" showIcon message={errorMessage(optsError)} />;

  const columns = [
    { title: 'Docket no.', dataIndex: 'docketNo', fixed: 'left' },
    { title: 'Booked', dataIndex: 'bookingDate', render: (v) => dayjs(v).format(DATE_FMT) },
    { title: 'Invoice no.', dataIndex: 'invoiceNos', ellipsis: true },
    { title: 'Origin', dataIndex: 'origin' },
    { title: 'Destination', dataIndex: 'destination' },
    { title: 'Rate on', dataIndex: 'rateOn' },
    { title: 'Pkts', dataIndex: 'packages', align: 'right' },
    { title: 'Weight', dataIndex: 'weight', align: 'right' },
    { title: 'Rate', dataIndex: 'rate', align: 'right' },
    { title: 'Freight', dataIndex: 'freight', align: 'right', render: money },
    { title: 'Docket chg', dataIndex: 'docketCharge', align: 'right', render: money },
    { title: 'Other', dataIndex: 'otherCharge', align: 'right', render: money },
    { title: 'Fuel', dataIndex: 'fuel', align: 'right', render: money },
    { title: 'IGST', dataIndex: 'igst', align: 'right', render: money },
    { title: 'CGST', dataIndex: 'cgst', align: 'right', render: money },
    { title: 'SGST', dataIndex: 'sgst', align: 'right', render: money },
    { title: 'After tax', dataIndex: 'afterTax', align: 'right', render: money },
    { title: 'Total', dataIndex: 'total', align: 'right', render: (v) => <strong>{money(v)}</strong> },
    {
      title: '', key: 'st', render: (_, r) => (
        <Space size={4}>
          {r.delivered && <Tag color="green">Delivered</Tag>}
          {r.problems.length > 0 && <Tooltip title={r.problems.join('; ')}><Tag color="red">Check docket</Tag></Tooltip>}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-card">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>{billType === 'To Be Billed' ? 'Client Bill (GST)' : `${billType} Bill`}</Typography.Title>
        <Space>
          <Typography.Text type="secondary">Billing at: {user.currentBranch.name} : {user.currentBranch.code}</Typography.Text>
          <Button icon={<UnorderedListOutlined />} onClick={() => navigate('/invoice/client-bill/list')}>Bills</Button>
        </Space>
      </Space>
      <Form form={form} layout="vertical" initialValues={{
        billType: ['Paid', 'To Pay'].includes(params.get('type')) ? params.get('type') : 'To Be Billed', billDate: dayjs(), dueDate: dayjs(), serviceType: 'Courier', taxType: 'GST', delivery: 'All',
        range: [dayjs().startOf('month'), dayjs()],
      }}>
        <Card size="small" title="Bill" style={{ marginBottom: 12 }}>
          <Row gutter={12}>
            <Col xs={24}>
              <Form.Item label="Bill type" name="billType">
                <Radio.Group optionType="button" options={opts?.billTypes ?? ['To Be Billed', 'Paid', 'To Pay']}
                  onChange={() => { setClient(null); setRows(null); setSelected([]); }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item label={partyLabel} required>
                <SearchSelect key={billType} placeholder={`Type ${partyLabel.toLowerCase()} name`} minChars={2}
                  fetcher={(q) => api.get('/client-bills/clients', { params: { q, billType } })
                    .then((r) => r.data.map((c) => ({ ...c, value: `${c.name} : ${c.code}`, label: `${c.name} : ${c.code}` })))}
                  onPick={pickClient}
                  onChange={(v) => { if (!v) { setClient(null); setRows(null); } }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item label="Bill date" name="billDate" rules={[{ required: true }]}>
                <DatePicker format={DATE_FMT} style={{ width: '100%' }} allowClear={false}
                  disabledDate={(d) => d.isAfter(dayjs(), 'day') || d.isBefore(dayjs().subtract(10, 'day'), 'day')}
                  onChange={(d) => client && d && form.setFieldValue('dueDate', d.add(client.creditPeriod || 0, 'day'))} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item label="Due date" name="dueDate" rules={[{ required: true, message: 'Due Date Required' }]}
                extra={client ? `Credit period ${client.creditPeriod || 0} day(s)` : undefined}>
                <DatePicker format={DATE_FMT} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item label="Service type" name="serviceType" rules={[{ required: true }]} extra={sac ? `SAC ${sac.sacCode} · ${sac.subType}` : undefined}>
                <Select options={opts?.serviceTypes ?? []} />
              </Form.Item>
            </Col>
            <Col xs={12} md={4}>
              <Form.Item label="Tax type" name="taxType" rules={[{ required: true }]}>
                <Radio.Group optionType="button" options={opts?.taxTypes ?? ['GST', 'IGST', 'NA']} onChange={() => { setRows(null); setSelected([]); }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}><Form.Item label="Billing address" name="address"><Input.TextArea rows={2} maxLength={500} /></Form.Item></Col>
            <Col xs={12} md={4}><Form.Item label="Manual bill no." name="manualBillNo"><Input maxLength={50} /></Form.Item></Col>
            <Col xs={12} md={4}><Form.Item label="Docs enclosed" name="docsEnclosed"><Input maxLength={200} /></Form.Item></Col>
            <Col xs={24} md={8}><Form.Item label="Remarks" name="remarks"><Input maxLength={500} /></Form.Item></Col>
          </Row>
        </Card>

        <Card size="small" title={client ? `${billType === 'To Be Billed' ? '' : `${billType} `}Dockets of ${client.name}` : 'Dockets'}>
          <Space wrap align="end" style={{ marginBottom: 12 }}>
            <Form.Item label="Booked" name="range" style={{ marginBottom: 0 }}><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
            <Form.Item label="Mode" name="bookingMode" style={{ marginBottom: 0 }}>
              <Select allowClear placeholder="All modes" style={{ width: 130 }} options={opts?.bookingModes ?? []} />
            </Form.Item>
            <Form.Item label="Delivery" name="delivery" style={{ marginBottom: 0 }}><Radio.Group options={opts?.deliveryStatus ?? []} /></Form.Item>
            <Form.Item label="Docket nos. (optional)" name="dockets" style={{ marginBottom: 0 }}>
              <Input placeholder="D1, D2 …" style={{ width: 200 }} />
            </Form.Item>
            <Button type="primary" icon={<SearchOutlined />} onClick={search} loading={searching} disabled={!client}>Search</Button>
          </Space>
          {rows === null ? <Empty description={client ? 'Search to list the dockets to bill' : `Select the ${partyLabel.toLowerCase()} first`} /> : (
            <>
              <Table size="small" rowKey="docketNo" columns={columns} dataSource={rows} scroll={{ x: 'max-content' }}
                pagination={{ defaultPageSize: 50, showSizeChanger: true }}
                rowSelection={{ selectedRowKeys: selected, onChange: setSelected, getCheckboxProps: (r) => ({ disabled: r.problems.length > 0 }) }}
                locale={{ emptyText: 'Docket Not found' }} />
              <Space style={{ marginTop: 12, width: '100%', justifyContent: 'space-between' }} wrap>
                <Typography.Text>
                  Selected <strong>{chosen.length}</strong> docket(s) · freight ₹ {money(t.freight)} · GST ₹ {money(t.tax)} · <strong>Grand total ₹ {money(t.total)}</strong>
                </Typography.Text>
                <Space wrap>
                  <Form.Item name="rateOn" noStyle><Select allowClear placeholder="Rate on (print)" style={{ width: 150 }}
                    options={['WEIGHT', 'BOX', 'KM', 'FTL', 'FREIGHT', 'CATEGORY'].map((x) => ({ value: x, label: x }))} /></Form.Item>
                  <Button type="primary" icon={<SaveOutlined />} onClick={save} loading={saving} disabled={!chosen.length}>Generate bill</Button>
                </Space>
              </Space>
            </>
          )}
        </Card>
      </Form>
      <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
        <PrinterOutlined /> After saving, the bill opens for printing; it can be printed again from the bill list.
      </Typography.Paragraph>
    </div>
  );
}
