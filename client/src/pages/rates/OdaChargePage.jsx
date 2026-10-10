// ODA Charge master (replaces Rate/ODA_Charge.aspx): for a location, the ODA charge by weight band from an effective
// date. The docket's "ODA location" picks the rate in force and fills the ODA charge for the charge weight.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Col, DatePicker, Drawer, Form, InputNumber, Radio, Row, Select, Space, Switch, Table, Tag, Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, errorMessage, get } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import MasterSelect from '../../components/masters/MasterSelect.jsx';

const BANDS = [
  ['upTo100', '0 – 100 kg'], ['upTo200', '101 – 200 kg'], ['upTo300', '201 – 300 kg'], ['upTo400', '301 – 400 kg'],
  ['upTo500', '401 – 500 kg'], ['upTo1000', '501 – 1000 kg'], ['above1000', 'Above 1000 kg'],
];
const money = (v) => (v ? Number(v).toLocaleString('en-IN') : '—');

// branch → city → location, as on the page
function usePlacePickers(branch, city) {
  const branches = useQuery({ queryKey: ['oda-branches'], queryFn: () => get('/oda-charges/branches') });
  const cities = useQuery({ queryKey: ['oda-cities', branch], enabled: Boolean(branch), queryFn: () => get('/oda-charges/cities', { branch }) });
  const locations = useQuery({ queryKey: ['oda-locations', city], enabled: Boolean(city), queryFn: () => get('/oda-charges/locations', { city }) });
  return { branches: branches.data ?? [], cities: cities.data ?? [], locations: locations.data ?? [] };
}

function NewOdaForm({ open, initial, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const branch = Form.useWatch('branch', form);
  const city = Form.useWatch('city', form);
  const { branches, cities, locations } = usePlacePickers(branch, city);

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const { data } = await api.post('/oda-charges', {
        branch: v.branch, city: v.city, location: v.location, distance: v.distance ?? 0,
        charges: Object.fromEntries(BANDS.map(([k]) => [k, v.charges?.[k] ?? 0])),
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
    <Drawer title="New ODA rate" open={open} onClose={onClose} width={Math.min(720, window.innerWidth)} destroyOnClose
      extra={<Button type="primary" loading={saving} onClick={save}>Save</Button>}>
      <Form form={form} layout="vertical" preserve={false}
        initialValues={{ ...initial, effectiveDate: dayjs().add(1, 'day'), charges: Object.fromEntries(BANDS.map(([k]) => [k, 0])) }}>
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item name="branch" label="Branch" rules={[{ required: true, message: 'Select branch' }]}>
              <Select showSearch optionFilterProp="label" options={branches} onChange={() => form.setFieldsValue({ city: undefined, location: undefined })} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="city" label="City" rules={[{ required: true, message: 'Select city' }]}>
              <Select showSearch optionFilterProp="label" options={cities} disabled={!branch} onChange={() => form.setFieldValue('location', undefined)} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="location" label="Location" rules={[{ required: true, message: 'Select location' }]}>
              <MasterSelect master="location" options={locations} disabled={!city} quickInitial={{ City_Code: city, branch_code: branch }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="distance" label="Distance (km)"><InputNumber min={0} max={5000} style={{ width: '100%' }} /></Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="effectiveDate" label="Effective from" rules={[{ required: true, message: 'Effective date' }]} extra="After today">
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => !d.isAfter(dayjs(), 'day')} />
            </Form.Item>
          </Col>
        </Row>
        <Typography.Title level={5}>ODA charge by weight (₹ per docket)</Typography.Title>
        <Row gutter={12}>
          {BANDS.map(([k, label]) => (
            <Col xs={12} md={6} key={k}>
              <Form.Item name={['charges', k]} label={label}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
            </Col>
          ))}
        </Row>
      </Form>
    </Drawer>
  );
}

export default function OdaChargePage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [branch, setBranch] = useState();
  const [city, setCity] = useState();
  const [location, setLocation] = useState();
  const [status, setStatus] = useState('active');
  const [adding, setAdding] = useState(false);
  const canEdit = ['admin', 'employee'].includes(user.role);
  const { branches, cities, locations } = usePlacePickers(branch, city);

  const { data = [], isFetching, error } = useQuery({
    queryKey: ['oda-charges', branch, city, location, status],
    queryFn: () => get('/oda-charges', { branch: branch ?? '', city: city ?? '', location: location ?? '', status }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['oda-charges'] });

  async function toggle(r, active) {
    try {
      const { data: res } = await api.patch(`/oda-charges/${r.id}/status`, { active });
      message.success(res.message);
      refresh();
    } catch (e) { message.error(errorMessage(e)); }
  }

  return (
    <Card className="page-card" title="ODA Charge"
      extra={canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>New ODA rate</Button>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Select allowClear placeholder="Branch" style={{ width: 240 }} value={branch} options={branches} showSearch optionFilterProp="label"
          onChange={(v) => { setBranch(v); setCity(undefined); setLocation(undefined); }} />
        <Select allowClear placeholder="City" style={{ width: 180 }} value={city} options={cities} disabled={!branch}
          onChange={(v) => { setCity(v); setLocation(undefined); }} />
        <Select allowClear placeholder="Location" style={{ width: 200 }} value={location} options={locations} disabled={!city} onChange={setLocation} />
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' }]} />
      </Space>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="The docket takes the rate in force on the booking day (latest effective date on or before today). A new rate is a new version; older ones stay." />
      {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}
      <Table
        size="small"
        rowKey="id"
        loading={isFetching}
        dataSource={data}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 25, showSizeChanger: true }}
        columns={[
          { title: 'Code', dataIndex: 'code' },
          { title: 'Location', key: 'l', render: (_, r) => `${r.locationName} : ${r.location}` },
          { title: 'City', dataIndex: 'cityName' },
          { title: 'Branch', dataIndex: 'branchName' },
          { title: 'Zone', dataIndex: 'zoneName' },
          { title: 'Km', dataIndex: 'distance', align: 'right' },
          ...BANDS.map(([k, label]) => ({ title: label, key: k, align: 'right', render: (_, r) => money(r.charges[k]) })),
          { title: 'Effective', dataIndex: 'effectiveDate', render: (v) => dayjs(v).format('DD/MM/YYYY') },
          {
            title: 'Status', key: 's',
            render: (_, r) => (!r.active ? <Tag>Inactive</Tag> : r.inForce ? <Tag color="green">In force</Tag> : r.upcoming ? <Tag color="blue">Upcoming</Tag> : <Tag color="default">Older version</Tag>),
          },
          ...(canEdit ? [{ title: 'Active', key: 'a', render: (_, r) => <Switch size="small" checked={r.active} onChange={(v) => toggle(r, v)} aria-label={`Active ${r.code}`} /> }] : []),
        ]}
      />
      <NewOdaForm open={adding} initial={{ branch, city, location }} onClose={() => setAdding(false)}
        onSaved={(v) => { setAdding(false); setBranch(v.branch); setCity(v.city); setLocation(v.location); setStatus('all'); refresh(); }} />
    </Card>
  );
}
