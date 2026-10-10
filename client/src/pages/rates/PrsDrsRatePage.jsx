// PRS / DRS Rate Master (replaces Rate/PRS_and_DRS_Rate_Master.aspx): what a pickup / delivery vehicle — an outside
// vendor or an own ("Self") vehicle — is paid per km, per kg or per round trip, by FTL type, from an effective date.
// The PRS / DRS challan will read it.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Col, DatePicker, Drawer, Form, Input, InputNumber, Row, Select, Space, Table, Tag,
} from 'antd';
import { FileExcelOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, errorMessage, get } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { exportCsv } from '../../utils/exportTable.js';
import MasterSelect from '../../components/masters/MasterSelect.jsx';

const money = (v) => (v ? Number(v).toLocaleString('en-IN') : '—');
const date = (v) => (v ? dayjs(v).format('DD/MM/YYYY') : '');

// which amount boxes each rate-on uses (the page disabled the rest and saved 0)
const FIELDS = {
  'Per Km': [['fixKmRate', 'Rate per km (₹)']],
  'Per Kg': [['perKg', 'Rate per kg (₹)']],
  'Round Trip': [['fixKm', 'Fixed km'], ['fixKmRate', 'Amount for fixed km (₹)'], ['extraKmRate', 'Rate per extra km (₹)']],
};

function useOptions() {
  return useQuery({ queryKey: ['prs-drs-options'], queryFn: () => get('/prs-drs-rates/options') }).data
    ?? { vendorTypes: [], rateOn: [], ftlTypes: [] };
}
function useVendors(type) {
  return useQuery({ queryKey: ['prs-drs-vendors', type], enabled: Boolean(type), queryFn: () => get('/prs-drs-rates/vendors', { type }) }).data ?? [];
}

function NewRateForm({ open, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const opts = useOptions();
  const vendorType = Form.useWatch('vendorType', form);
  const vendor = Form.useWatch('vendor', form);
  const rateOn = Form.useWatch('rateOn', form);
  const vendors = useVendors(vendorType);
  const prev = useQuery({
    queryKey: ['prs-drs-prev', vendor, rateOn],
    enabled: Boolean(vendor && rateOn),
    queryFn: () => get('/prs-drs-rates/previous-date', { vendor, rateOn }),
  }).data;

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const { data } = await api.post('/prs-drs-rates', {
        vendorType: v.vendorType, vendor: v.vendor, rateOn: v.rateOn, ftlType: v.ftlType,
        fixKm: v.fixKm ?? 0, fixKmRate: v.fixKmRate ?? 0, extraKmRate: v.extraKmRate ?? 0, perKg: v.perKg ?? 0,
        effectiveDate: v.effectiveDate.format('YYYY-MM-DD'),
      });
      message.success(data.message);
      onSaved(v);
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? details.map((x) => x.message).join('; ') : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer title="New PRS / DRS rate" open={open} onClose={onClose} width={Math.min(720, window.innerWidth)} destroyOnClose
      extra={<Button type="primary" loading={saving} onClick={save}>Save</Button>}>
      <Form form={form} layout="vertical" preserve={false} initialValues={{ effectiveDate: dayjs().add(1, 'day') }}>
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item name="vendorType" label="Vendor type" rules={[{ required: true, message: 'Select vendor type' }]}>
              <Select options={opts.vendorTypes} onChange={() => form.setFieldValue('vendor', undefined)} />
            </Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Form.Item name="vendor" label="Vendor" rules={[{ required: true, message: 'Select vendor' }]}>
              <Select showSearch optionFilterProp="label" options={vendors} disabled={!vendorType} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="rateOn" label="Rate on" rules={[{ required: true, message: 'Select rate on' }]}>
              <Select options={opts.rateOn} onChange={() => form.setFieldsValue({ fixKm: undefined, fixKmRate: undefined, extraKmRate: undefined, perKg: undefined })} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="ftlType" label="FTL type" rules={[{ required: true, message: 'Select FTL type' }]}>
              <MasterSelect master="container" valueField="freight_name" options={opts.ftlTypes} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item label="Previous effective date">
              <Input readOnly value={date(prev?.previousEffectiveDate)} placeholder={vendor && rateOn ? 'None yet' : ''} />
            </Form.Item>
          </Col>
          {(FIELDS[rateOn] ?? []).map(([name, label]) => (
            <Col xs={12} md={8} key={name}>
              <Form.Item name={name} label={label}
                rules={name === 'extraKmRate' ? [] : [{ required: true, message: `Enter ${label.toLowerCase()}` }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          ))}
          <Col xs={12} md={8}>
            <Form.Item name="effectiveDate" label="Effective from" rules={[{ required: true, message: 'Effective date' }]}
              extra="Today or later, in the financial year">
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isBefore(dayjs(), 'day')} />
            </Form.Item>
          </Col>
        </Row>
        {!rateOn && <Alert type="info" showIcon message="Pick “Rate on” to see its amount boxes." />}
      </Form>
    </Drawer>
  );
}

export default function PrsDrsRatePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const opts = useOptions();
  const [vendorType, setVendorType] = useState();
  const [vendor, setVendor] = useState();
  const [rateOn, setRateOn] = useState();
  const [adding, setAdding] = useState(false);
  const canEdit = ['admin', 'employee'].includes(user.role);
  const vendors = useVendors(vendorType);

  const { data = [], isFetching, error } = useQuery({
    queryKey: ['prs-drs-rates', vendorType, vendor, rateOn],
    queryFn: () => get('/prs-drs-rates', { vendorType: vendorType ?? '', vendor: vendor ?? '', rateOn: rateOn ?? '' }),
  });

  const columns = [
    { title: 'Vendor', dataIndex: 'vendorName', exportValue: (v, r) => `${v} : ${r.vendor}`, render: (v, r) => `${v} : ${r.vendor}` },
    { title: 'Type', dataIndex: 'vendorType' },
    { title: 'Rate on', dataIndex: 'rateOn' },
    { title: 'FTL type', dataIndex: 'ftlType' },
    { title: 'Fixed km', dataIndex: 'fixKm', align: 'right', render: money },
    { title: 'Fixed km / per km rate', dataIndex: 'fixKmRate', align: 'right', render: money },
    { title: 'Extra km rate', dataIndex: 'extraKmRate', align: 'right', render: money },
    { title: 'Per kg', dataIndex: 'perKg', align: 'right', render: money },
    { title: 'Effective', dataIndex: 'effectiveDate', render: date, exportValue: date },
    {
      title: 'Status', dataIndex: 'status',
      exportValue: (_, r) => (r.inForce ? 'In force' : r.upcoming ? 'Upcoming' : 'Older version'),
      render: (_, r) => (r.inForce ? <Tag color="green">In force</Tag> : r.upcoming ? <Tag color="blue">Upcoming</Tag> : <Tag>Older version</Tag>),
    },
  ];

  return (
    <Card className="page-card" title="PRS / DRS Rate Master"
      extra={(
        <Space>
          <Button icon={<FileExcelOutlined />} disabled={!data.length} onClick={() => exportCsv('PRS_DRS_RATE', columns, data)}>Export</Button>
          {canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>New rate</Button>}
        </Space>
      )}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select allowClear placeholder="Vendor type" style={{ width: 160 }} value={vendorType} options={opts.vendorTypes}
          onChange={(v) => { setVendorType(v); setVendor(undefined); }} />
        <Select allowClear placeholder="Vendor" style={{ width: 260 }} value={vendor} options={vendors} disabled={!vendorType}
          showSearch optionFilterProp="label" onChange={setVendor} />
        <Select allowClear placeholder="Rate on" style={{ width: 160 }} value={rateOn} options={opts.rateOn} onChange={setRateOn} />
      </Space>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="Per Km: rate × km run. Per Kg: rate × weight. Round Trip: fixed amount for the fixed km, then the extra-km rate. The rate in force is the latest effective date on or before today, per vendor, rate on and FTL type." />
      {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}
      <Table size="small" rowKey="id" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 25, showSizeChanger: true }} columns={columns} />
      <NewRateForm open={adding} onClose={() => setAdding(false)}
        onSaved={(v) => {
          setAdding(false); setVendorType(v.vendorType); setVendor(v.vendor); setRateOn(undefined);
          queryClient.invalidateQueries({ queryKey: ['prs-drs-rates'] });
          queryClient.invalidateQueries({ queryKey: ['prs-drs-prev'] });
        }} />
    </Card>
  );
}
