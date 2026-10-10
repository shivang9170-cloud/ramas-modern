// Franchisee rates (replaces Rate/Franchisee_Commission_Master.aspx and Rate/Franchisees_Pickup_Delivery.aspx):
// what franchisees earn — the commission master (rent / mobile / signage, base-freight %, road rows per booking type,
// train / air %) and each franchisee's pickup charge and delivery commission per consignment.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App, Button, Card, Col, DatePicker, Drawer, Form, InputNumber, Radio, Row, Select, Space, Table, Tabs, Tag,
} from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, get } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { date, money, send, ymd } from '../settings/common.js';

const status = (r) => (r.inForce ? <Tag color="green">In force</Tag> : r.upcoming ? <Tag color="blue">Upcoming</Tag> : <Tag>Older version</Tag>);
const num = (props) => <InputNumber min={0} style={{ width: '100%' }} {...props} />;

function CommissionForm({ open, onClose, onSaved }) {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const opts = useQuery({ queryKey: ['fr-rate-options'], queryFn: () => get('/franchisee-rates/options') }).data;
  const mode = Form.useWatch('mode', form);
  const [a, b] = String(user.financialYear || '').split('-').map((x) => x.trim());

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    const res = await send(message, () => api.post('/franchisee-rates/commissions', {
      ...v, startDate: ymd(v.startDate), endDate: ymd(v.endDate), effectiveDate: ymd(v.effectiveDate), rows: v.rows ?? [],
    }));
    setSaving(false);
    if (res) onSaved();
  }

  return (
    <Drawer title="New franchisee commission" open={open} onClose={onClose} width={Math.min(900, window.innerWidth)} destroyOnClose
      extra={<Button type="primary" loading={saving} onClick={save}>Save</Button>}>
      <Form form={form} layout="vertical" preserve={false}
        initialValues={{ mode: 'RD', commissionMode: 'BookingType', effectiveDate: dayjs().add(1, 'day'), rows: [],
          ...(a && b ? { startDate: dayjs(`${a}-04-01`), endDate: dayjs(`${b}-03-31`) } : {}) }}>
        <Row gutter={12}>
          <Col xs={24} md={8}><Form.Item name="mode" label="Mode"><Radio.Group optionType="button" options={opts?.modes ?? []} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="commissionMode" label="Commission on"><Select options={opts?.commissionModes ?? []} /></Form.Item></Col>
          <Col xs={8} md={8}><Form.Item name="effectiveDate" label="Effective from" rules={[{ required: true }]}><DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isBefore(dayjs(), 'day')} /></Form.Item></Col>
          <Col xs={8} md={6}><Form.Item name="startDate" label="Start date" rules={[{ required: true }]}><DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={8} md={6}><Form.Item name="endDate" label="End date" rules={[{ required: true }]}><DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={3}><Form.Item name="rent" label="Rent / month">{num()}</Form.Item></Col>
          <Col xs={12} md={3}><Form.Item name="mobileBills" label="Mobile / month">{num()}</Form.Item></Col>
          <Col xs={12} md={3}><Form.Item name="signage" label="Signage / month">{num()}</Form.Item></Col>
          <Col xs={12} md={3}><Form.Item name="baseFreightPercent" label="On base freight %">{num({ max: 100 })}</Form.Item></Col>
          {mode === 'TR' && (
            <>
              <Col xs={12} md={6}><Form.Item name="trainPercent" label="Train commission %">{num({ max: 100 })}</Form.Item></Col>
              <Col xs={12} md={6}><Form.Item name="trainPerRail" label="Per rail (₹)">{num()}</Form.Item></Col>
            </>
          )}
          {mode === 'AI' && <Col xs={12} md={6}><Form.Item name="airPercent" label="Air commission %" rules={[{ required: true }]}>{num({ max: 100 })}</Form.Item></Col>}
        </Row>
        {mode === 'RD' && (
          <Card size="small" title="Road commission by booking type">
            <Form.List name="rows">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((f) => (
                    <Form.Item noStyle key={f.key} shouldUpdate>
                      {() => {
                        const cat = form.getFieldValue(['rows', f.name, 'category']);
                        return (
                          <Space wrap align="baseline" style={{ marginBottom: 8 }}>
                            <Form.Item name={[f.name, 'bookingType']} rules={[{ required: true, message: 'Booking type' }]}><Select style={{ width: 130 }} placeholder="Booking type" options={opts?.bookingTypes ?? []} /></Form.Item>
                            <Form.Item name={[f.name, 'category']} rules={[{ required: true, message: 'Category' }]}><Select style={{ width: 150 }} placeholder="Category" options={opts?.categories ?? []} /></Form.Item>
                            {cat === 'LTL' && (
                              <>
                                <Form.Item name={[f.name, 'upTo3Tons']}><InputNumber min={0} max={100} placeholder="% up to 3 t" /></Form.Item>
                                <Form.Item name={[f.name, 'from3To6Tons']}><InputNumber min={0} max={100} placeholder="% 3–6 t" /></Form.Item>
                              </>
                            )}
                            {(cat === 'FTL36' || cat === 'FTL916') && (
                              <Form.Item name={[f.name, 'vehicleType']} rules={[{ required: true, message: 'Vehicle type' }]}>
                                <Select style={{ width: 170 }} placeholder="Vehicle type" options={(cat === 'FTL36' ? opts?.vehicleTypes.ftl36 : opts?.vehicleTypes.ftl916) ?? []} />
                              </Form.Item>
                            )}
                            {cat && cat !== 'LTL' && (
                              <>
                                <Form.Item name={[f.name, 'perConsignment']}><InputNumber min={0} placeholder={cat === 'TRAILER' ? '₹ per vehicle' : '₹ per consignment'} /></Form.Item>
                                <Form.Item name={[f.name, 'sharePercent']}><InputNumber min={0} max={100} placeholder="Share %" /></Form.Item>
                              </>
                            )}
                            <MinusCircleOutlined onClick={() => remove(f.name)} aria-label="Remove row" />
                          </Space>
                        );
                      }}
                    </Form.Item>
                  ))}
                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ bookingType: 'Paid', category: 'LTL' })}>Add row</Button>
                </>
              )}
            </Form.List>
          </Card>
        )}
      </Form>
    </Drawer>
  );
}

function Commissions() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data = [], isFetching } = useQuery({ queryKey: ['fr-commissions'], queryFn: () => get('/franchisee-rates/commissions') });
  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={() => setAdding(true)}>New commission</Button>
      <Table size="small" rowKey="id" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }}
        expandable={{
          rowExpandable: (r) => r.rows.length > 0,
          expandedRowRender: (r) => (
            <Table size="small" pagination={false} rowKey={(x, i) => i} dataSource={r.rows} columns={[
              { title: 'Booking type', dataIndex: 'bookingType' }, { title: 'Category', dataIndex: 'category' },
              { title: 'Detail', key: 'd', render: (_, x) => (x.category === 'LTL 03 Tons'
                ? `${x.upTo3Tons}% up to 3 t · ${x.from3To6Tons}% 3–6 t`
                : `${x.category === 'FTL Trailor' ? '' : `${x.vehicleType} · `}₹${x.perConsignment} · share ${x.sharePercent}%`) },
            ]} />
          ),
        }}
        columns={[
          { title: 'Code', dataIndex: 'code' }, { title: 'Mode', dataIndex: 'modeName' },
          { title: 'Rent', dataIndex: 'rent', align: 'right', render: money }, { title: 'Mobile', dataIndex: 'mobileBills', align: 'right', render: money },
          { title: 'Signage', dataIndex: 'signage', align: 'right', render: money }, { title: 'Base frt %', dataIndex: 'baseFreightPercent', align: 'right' },
          { title: 'Train %', dataIndex: 'trainPercent', align: 'right' }, { title: 'Air %', dataIndex: 'airPercent', align: 'right' },
          { title: 'Effective', dataIndex: 'effectiveDate', render: date }, { title: 'Status', key: 's', render: (_, r) => status(r) },
        ]} />
      <CommissionForm open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); queryClient.invalidateQueries({ queryKey: ['fr-commissions'] }); }} />
    </>
  );
}

function PickupDeliveryForm({ open, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const opts = useQuery({ queryKey: ['fr-rate-options'], queryFn: () => get('/franchisee-rates/options') }).data;
  const franchisees = useQuery({ queryKey: ['fr-rate-franchisees'], queryFn: () => get('/franchisee-rates/franchisees') }).data ?? [];
  const docType = Form.useWatch('docType', form);
  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    const res = await send(message, () => api.post('/franchisee-rates/pickup-delivery', { ...v, effectiveDate: ymd(v.effectiveDate) }));
    setSaving(false);
    if (res) onSaved();
  }
  return (
    <Drawer title="New pickup / delivery rates" open={open} onClose={onClose} width={Math.min(620, window.innerWidth)} destroyOnClose
      extra={<Button type="primary" loading={saving} onClick={save}>Save</Button>}>
      <Form form={form} layout="vertical" preserve={false} initialValues={{ docType: 'NONDOC', effectiveDate: dayjs().add(1, 'day'), rows: [{}] }}>
        <Form.Item name="franchisee" label="Franchisee" rules={[{ required: true, message: 'Select the franchisee' }]}><Select showSearch optionFilterProp="label" options={franchisees} /></Form.Item>
        <Space wrap>
          <Form.Item name="docType" label="Type"><Radio.Group optionType="button" options={opts?.docTypes ?? []} onChange={() => form.setFieldValue('rows', [{}])} /></Form.Item>
          <Form.Item name="effectiveDate" label="Effective from" rules={[{ required: true }]}><DatePicker format="DD/MM/YYYY" disabledDate={(d) => d.isBefore(dayjs(), 'day')} /></Form.Item>
        </Space>
        <Form.List name="rows">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <Space key={f.key} wrap align="baseline">
                  {docType === 'NONDOC'
                    ? <Form.Item name={[f.name, 'band']} rules={[{ required: true, message: 'Weight band' }]}><Select style={{ width: 150 }} placeholder="Weight band" options={(opts?.weightBands ?? []).map((x) => ({ value: x, label: x }))} /></Form.Item>
                    : <Tag>Per document</Tag>}
                  <Form.Item name={[f.name, 'pickup']}><InputNumber min={0} placeholder="Pickup ₹" /></Form.Item>
                  <Form.Item name={[f.name, 'perConsignment']}><InputNumber min={0} placeholder="Per consignment ₹" /></Form.Item>
                  {docType === 'NONDOC' && fields.length > 1 && <MinusCircleOutlined onClick={() => remove(f.name)} aria-label="Remove band" />}
                </Space>
              ))}
              {docType === 'NONDOC' && <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})}>Add weight band</Button>}
            </>
          )}
        </Form.List>
      </Form>
    </Drawer>
  );
}

function PickupDelivery() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data = [], isFetching } = useQuery({ queryKey: ['fr-pd'], queryFn: () => get('/franchisee-rates/pickup-delivery') });
  return (
    <>
      <Button type="primary" icon={<PlusOutlined />} style={{ marginBottom: 12 }} onClick={() => setAdding(true)}>New rates</Button>
      <Table size="small" rowKey="id" loading={isFetching} dataSource={data} columns={[
        { title: 'Franchisee', dataIndex: 'franchiseeName' }, { title: 'Type / band', dataIndex: 'band' },
        { title: 'Pickup', dataIndex: 'pickup', align: 'right', render: money }, { title: 'Per consignment', dataIndex: 'perConsignment', align: 'right', render: money },
        { title: 'Effective', dataIndex: 'effectiveDate', render: date }, { title: 'Status', key: 's', render: (_, r) => status(r) },
      ]} />
      <PickupDeliveryForm open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); queryClient.invalidateQueries({ queryKey: ['fr-pd'] }); }} />
    </>
  );
}

export default function FranchiseeRatesPage({ tab = 'commission' }) {
  const navigate = useNavigate();
  return (
    <Card className="page-card" title="Franchisee Rates">
      <Tabs activeKey={tab} onChange={(k) => navigate(k === 'commission' ? '/rates/franchisee-commission' : '/rates/franchisee-pickup-delivery')} items={[
        { key: 'commission', label: 'Commission master', children: <Commissions /> },
        { key: 'pickup', label: 'Pickup / delivery', children: <PickupDelivery /> },
      ]} />
    </Card>
  );
}
