// Vendor rate masters (replaces Rate/Vendor_Road_Rate_Master, Vendor_Air_Rate_Master, Vendor_Train_Rate_Master):
// what we pay a vendor to carry our load between two cities — by road, air or train. `kind` picks the tab the legacy
// menu opened; every rate runs from an effective date and the latest one on or before today is in force.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Col, DatePicker, Drawer, Form, InputNumber, Radio, Row, Select, Space, Switch, Table, Tabs, Tag,
} from 'antd';
import { FileExcelOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { api, get } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { exportCsv } from '../../utils/exportTable.js';
import { date, money, send, ymd } from '../settings/common.js';

const TYPE_LABEL = { VENDOR: 'Vendor', SELF: 'Self', COLOADER: 'Co-loader' };
const AIR_CHARGE_LABEL = {
  uptoWeight: 'Up to weight (kg)', uptoWeightCharge: 'Up to weight charge', awbDo: 'AWB / DO', fscPerKg: 'FSC / kg', unitPerKg: 'Unit / kg',
  minUnitCharge: 'Min unit charge', xrayPerKg: 'X-ray / kg', minXrayCharge: 'Min X-ray charge', tspOutPerKg: 'TSP out / kg',
  minTspOutCharge: 'Min TSP out', tspInPerKg: 'TSP in / kg', minTspInCharge: 'Min TSP in', serviceTax: 'Service tax %',
};

/** City picker that searches the city master as you type. */
function CitySelect(props) {
  const [opts, setOpts] = useState([]);
  return (
    <Select showSearch filterOption={false} placeholder="Type city" {...props}
      onSearch={(q) => { if (q.trim()) get('/vendor-rates/cities', { q: q.trim() }).then(setOpts).catch(() => {}); }}
      options={opts} />
  );
}

function statusTag(r) {
  if (!r.active) return <Tag>Off</Tag>;
  if (r.inForce) return <Tag color="green">In force</Tag>;
  if (r.upcoming) return <Tag color="blue">Upcoming</Tag>;
  return <Tag>Older version</Tag>;
}

function RateForm({ kind, open, onClose, onSaved }) {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const opts = useQuery({ queryKey: ['vr-options'], queryFn: () => get('/vendor-rates/options') }).data;
  const vendorType = Form.useWatch('vendorType', form);
  const vendor = Form.useWatch('vendor', form);
  const rateMode = Form.useWatch('rateMode', form);
  const ftlRateType = Form.useWatch('ftlRateType', form);
  const rateType = Form.useWatch('rateType', form);
  const vendors = useQuery({ queryKey: ['vr-vendors', kind, vendorType], enabled: Boolean(vendorType), queryFn: () => get('/vendor-rates/vendors', { kind, type: vendorType }) }).data ?? [];
  const carriers = useQuery({ queryKey: ['vr-carriers', kind, vendor], enabled: kind !== 'road' && Boolean(vendor), queryFn: () => get('/vendor-rates/carriers', { kind, vendor }) }).data ?? [];
  const [a, b] = String(user.financialYear || '').split('-').map((x) => x.trim());

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    const body = {
      ...v, effectiveDate: ymd(v.effectiveDate),
      ...(v.startDate ? { startDate: ymd(v.startDate), endDate: ymd(v.endDate) } : {}),
    };
    const res = await send(message, () => api.post(`/vendor-rates/${kind}`, body));
    setSaving(false);
    if (res) onSaved();
  }

  const coloader = vendorType === 'COLOADER';
  return (
    <Drawer title={`New ${kind} rate`} open={open} onClose={onClose} width={Math.min(760, window.innerWidth)} destroyOnClose
      extra={<Button type="primary" loading={saving} onClick={save}>Save</Button>}>
      <Form form={form} layout="vertical" preserve={false}
        initialValues={{
          vendorType: 'VENDOR', effectiveDate: dayjs().add(1, 'day'), rateType: '2', shift: 'Morning', slabs: [], charges: {},
          ...(kind !== 'train' && a && b ? { startDate: dayjs(`${a}-04-01`), endDate: dayjs(`${b}-03-31`) } : {}),
        }}>
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item name="vendorType" label="Vendor type">
              <Radio.Group optionType="button" options={(opts?.vendorTypes?.[kind] ?? []).map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
                onChange={() => form.setFieldsValue({ vendor: undefined, flight: undefined, train: undefined })} />
            </Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Form.Item name="vendor" label="Vendor" rules={[{ required: true, message: 'Select Vendor Name!!' }]}>
              <Select showSearch optionFilterProp="label" options={vendors} onChange={() => form.setFieldsValue({ flight: undefined, train: undefined })} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}><Form.Item name="origin" label="Origin" rules={[{ required: true, message: 'Enter Origin!!' }]}><CitySelect /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="destination" label="Destination" rules={[{ required: true, message: 'Enter Destination!!' }]}><CitySelect /></Form.Item></Col>
          <Col xs={12} md={8}>
            <Form.Item name="effectiveDate" label="Effective from" rules={[{ required: true, message: 'Effective date' }]}>
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isBefore(dayjs(), 'day')} />
            </Form.Item>
          </Col>
          {kind !== 'train' && (
            <>
              <Col xs={12} md={8}><Form.Item name="startDate" label="Start date" rules={[{ required: true }]}><DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} /></Form.Item></Col>
              <Col xs={12} md={8}><Form.Item name="endDate" label="End date" rules={[{ required: true }]}><DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} /></Form.Item></Col>
            </>
          )}
        </Row>

        {kind === 'road' && (
          <Row gutter={12}>
            {!coloader && (
              <Col xs={12} md={8}>
                <Form.Item name="rateMode" label="Rate mode" rules={[{ required: true, message: 'Select the rate mode' }]}>
                  <Select options={(opts?.roadModes ?? []).map((m) => ({ value: m, label: { FTL: 'FTL', PKG: 'Per kg (PKG)', PKM: 'Per km (PKM)' }[m] }))} />
                </Form.Item>
              </Col>
            )}
            {!coloader && rateMode === 'FTL' && (
              <>
                <Col xs={12} md={8}>
                  <Form.Item name="ftlRateType" label="FTL rate type" rules={[{ required: true, message: 'Select the FTL rate type' }]}>
                    <Select options={(opts?.ftlRateTypes ?? []).map((m) => ({ value: m, label: m }))} />
                  </Form.Item>
                </Col>
                <Col xs={12} md={8}>
                  <Form.Item name="ftlAmount" label={ftlRateType === 'FTL PKM' ? 'FTL per km (₹)' : 'FTL amount (₹)'} rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                </Col>
              </>
            )}
            {(coloader || rateMode === 'PKG') && (
              <Col xs={12} md={8}><Form.Item name="perKg" label="Rate per kg (₹)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            )}
            {!coloader && rateMode === 'PKM' && (
              <Col xs={12} md={8}><Form.Item name="perKm" label="Rate per km (₹)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            )}
          </Row>
        )}

        {kind === 'air' && (
          <>
            <Row gutter={12}>
              <Col xs={24} md={10}>
                <Form.Item name="flight" label="Flight" rules={[{ required: true, message: 'Select the flight' }]}
                  extra={vendor && !carriers.length ? 'Add the vendor\'s flights on Setting → Vendor and Vehicle' : null}>
                  <Select options={carriers} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}><Form.Item name="shift" label="Shift"><Select options={(opts?.shifts ?? []).map((x) => ({ value: x, label: x }))} /></Form.Item></Col>
              <Col xs={12} md={8}><Form.Item name="ratePerKg" label="Rate per kg (₹)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
            </Row>
            <Card size="small" title="Weight slabs (optional)" style={{ marginBottom: 12 }}>
              <Form.List name="slabs">
                {(fields, { add, remove }) => (
                  <>
                    {fields.map((f) => (
                      <Space key={f.key} align="baseline">
                        <Form.Item name={[f.name, 'from']} rules={[{ required: true }]}><InputNumber min={0} placeholder="From kg" /></Form.Item>
                        <Form.Item name={[f.name, 'to']} rules={[{ required: true }]}><InputNumber min={0} placeholder="To kg" /></Form.Item>
                        <Form.Item name={[f.name, 'rate']} rules={[{ required: true }]}><InputNumber min={0} placeholder="Rate" /></Form.Item>
                        <MinusCircleOutlined onClick={() => remove(f.name)} aria-label="Remove slab" />
                      </Space>
                    ))}
                    <Button type="dashed" icon={<PlusOutlined />} onClick={() => {
                      const s = form.getFieldValue('slabs') || [];
                      add({ from: s.length ? Number(s[s.length - 1].to || 0) + 1 : 0 });   // the next slab starts one kg on
                    }}>Add slab</Button>
                  </>
                )}
              </Form.List>
            </Card>
            {vendorType === 'SELF' && (
              <Card size="small" title="Airline charges (own consignments)">
                <Row gutter={12}>
                  {Object.entries(AIR_CHARGE_LABEL).map(([k, label]) => (
                    <Col xs={12} md={6} key={k}><Form.Item name={['charges', k]} label={label}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
                  ))}
                </Row>
              </Card>
            )}
          </>
        )}

        {kind === 'train' && (
          <Row gutter={12}>
            <Col xs={24} md={10}><Form.Item name="train" label="Train" rules={[{ required: true, message: 'Select the train' }]}><Select showSearch optionFilterProp="label" options={carriers} /></Form.Item></Col>
            <Col xs={24} md={14}>
              <Form.Item name="rateType" label="Rate type"><Radio.Group optionType="button" options={opts?.trainRateTypes ?? []} /></Form.Item>
            </Col>
            {rateType === '1'
              ? <Col xs={12} md={8}><Form.Item name="ratePerKg" label="Rate per kg (₹)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
              : <Col xs={12} md={8}><Form.Item name="tripCost" label="Trip cost (₹)" rules={[{ required: true, message: 'Enter Trip Cost!!' }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>}
            <Col xs={12} md={8}><Form.Item name="ddAmount" label="DD amount (₹)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
        )}
      </Form>
    </Drawer>
  );
}

const COLUMNS = {
  road: [
    { title: 'Mode', dataIndex: 'rateMode', render: (v, r) => (v === 'FTL' ? `FTL (${r.ftlRateType})` : v) },
    { title: 'FTL', dataIndex: 'ftlAmount', align: 'right', render: money },
    { title: 'Per kg', dataIndex: 'perKg', align: 'right', render: money },
    { title: 'Per km', dataIndex: 'perKm', align: 'right', render: money },
  ],
  air: [
    { title: 'Code', dataIndex: 'code' },
    { title: 'Flight', dataIndex: 'flight', render: (v, r) => `${v} ${r.flightName} · ${r.shift}` },
    { title: 'Per kg', dataIndex: 'ratePerKg', align: 'right', render: money },
    { title: 'Slabs', dataIndex: 'slabRate', render: (v) => (v ? <Tag color="purple">Slabs</Tag> : null) },
  ],
  train: [
    { title: 'Train', dataIndex: 'train' },
    { title: 'Rate type', dataIndex: 'rateTypeName' },
    { title: 'Per kg', dataIndex: 'ratePerKg', align: 'right', render: money },
    { title: 'Trip cost', dataIndex: 'tripCost', align: 'right', render: money },
    { title: 'DD amount', dataIndex: 'ddAmount', align: 'right', render: money },
  ],
};

function RateList({ kind }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data = [], isFetching, error } = useQuery({ queryKey: ['vr-list', kind], queryFn: () => get(`/vendor-rates/${kind}`) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['vr-list', kind] });
  const columns = [
    { title: 'Vendor', dataIndex: 'vendorName', render: (v, r) => `${v || r.vendor} (${r.vendorType})` },
    { title: 'Origin', dataIndex: 'originName' },
    { title: 'Destination', dataIndex: 'destinationName' },
    ...COLUMNS[kind],
    { title: 'Effective', dataIndex: 'effectiveDate', render: date, exportValue: date },
    { title: 'Status', dataIndex: 'status', render: (_, r) => statusTag(r), exportValue: (_, r) => (r.inForce ? 'In force' : r.upcoming ? 'Upcoming' : r.active ? 'Older' : 'Off') },
  ];
  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>New {kind} rate</Button>
        <Button icon={<FileExcelOutlined />} disabled={!data.length} onClick={() => exportCsv(`Vendor_${kind}_Rate_Master`, columns, data)}>Export</Button>
      </Space>
      {error && <Alert type="error" showIcon message={String(error.message)} style={{ marginBottom: 12 }} />}
      <Table size="small" rowKey="id" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }}
        columns={[...columns, {
          title: 'Active', key: 'a',
          render: (_, r) => <Switch size="small" checked={r.active} aria-label={`Active ${r.id}`}
            onChange={async (v) => { if (await send(message, () => api.patch(`/vendor-rates/${kind}/${r.id}/status`, { active: v }))) refresh(); }} />,
        }]} />
      <RateForm kind={kind} open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />
    </>
  );
}

export default function VendorRatesPage({ kind = 'road' }) {
  const navigate = useNavigate();
  return (
    <Card className="page-card" title="Vendor Rate Master">
      <Tabs activeKey={kind} onChange={(k) => navigate(`/rates/vendor-${k}`)} items={[
        { key: 'road', label: 'Road', children: <RateList kind="road" /> },
        { key: 'air', label: 'Air', children: <RateList kind="air" /> },
        { key: 'train', label: 'Train', children: <RateList kind="train" /> },
      ]} />
    </Card>
  );
}
