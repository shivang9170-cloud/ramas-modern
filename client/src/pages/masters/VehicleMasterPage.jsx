// Vehicle Master — replaces Master/View_Vechile_Master.aspx (list, status) and Master/Vechile_Master.aspx (add / edit).
// Capacity, container type, body and wheels come from the vehicle type; attached ("Vendor") vehicles carry up to
// ten routes. Saving also binds the vehicle's ledger.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Col, Collapse, DatePicker, Descriptions, Drawer, Form, Input, InputNumber, Popconfirm, Radio, Row,
  Select, Space, Switch, Table, Tag, Typography,
} from 'antd';
import { EditOutlined, PlusOutlined, PoweroffOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import MasterSelect from '../../components/masters/MasterSelect.jsx';

const upper = { style: { textTransform: 'uppercase' } };

function RouteSelect({ value, onChange, initialOptions, disabled }) {
  const [q, setQ] = useState('');
  const { data: found = [], isFetching } = useQuery({
    queryKey: ['vehicle-routes', q],
    queryFn: () => api.get('/vehicles/routes', { params: { q } }).then((r) => r.data),
  });
  const options = useMemo(() => {
    const map = new Map([...(initialOptions ?? []), ...found].map((o) => [o.value, o]));
    return [...map.values()];
  }, [found, initialOptions]);
  return (
    <Select mode="multiple" showSearch filterOption={false} onSearch={setQ} loading={isFetching} value={value} onChange={onChange}
      options={options} disabled={disabled} maxCount={10} placeholder="Search routes" />
  );
}

function VehicleForm({ open, vehicleNo, opts, onClose, onSaved }) {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const vendorType = Form.useWatch('vendorType', form);
  const vehicleType = Form.useWatch('vehicleType', form);
  const editing = Boolean(vehicleNo);

  const { data: vehicle, isFetching, error } = useQuery({
    queryKey: ['vehicle', vehicleNo], enabled: open && editing,
    queryFn: () => api.get(`/vehicles/${vehicleNo}`).then((r) => r.data),
  });
  const { data: vendors = [], isFetching: vendorsLoading } = useQuery({
    queryKey: ['vehicle-vendors', vendorType, user.divCode], enabled: Boolean(vendorType),
    queryFn: () => api.get('/vehicles/vendors', { params: { type: vendorType } }).then((r) => r.data),
  });
  const type = opts?.vehicleTypes?.find((t) => t.value === vehicleType);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (!editing) {
      form.setFieldsValue({ vendorType: 'Self', branch: user.currentBranch?.code, fuelType: 'DIESEL', amc: 'Silver', active: true, routes: [] });
    } else if (vehicle) {
      form.setFieldsValue({ ...vehicle, purchaseDate: vehicle.purchaseDate ? dayjs(vehicle.purchaseDate) : null });
    }
  }, [open, editing, vehicle, form, user.currentBranch?.code]);

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const payload = {
        ...v,
        makerId: v.makerId ?? null,
        routes: v.vendorType === 'Vendor' ? (v.routes ?? []) : [],
        purchaseDate: v.purchaseDate ? v.purchaseDate.format('YYYY-MM-DD') : '',
        invoiceValue: v.invoiceValue ?? null,
        dealMaturityAmount: v.dealMaturityAmount ?? null,
      };
      const { data } = editing ? await api.put(`/vehicles/${vehicleNo}`, payload) : await api.post('/vehicles', payload);
      message.success(data.message);
      onSaved();
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? details.map((d) => d.message).join('; ') : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={editing ? `Edit vehicle ${vehicleNo}` : 'New vehicle'}
      open={open}
      onClose={onClose}
      width={Math.min(860, window.innerWidth)}
      extra={<Button type="primary" loading={saving} disabled={editing && !vehicle} onClick={save}>{editing ? 'Update' : 'Save'}</Button>}
    >
      {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" disabled={editing && isFetching && !vehicle}>
        <Row gutter={12}>
          <Col xs={24} md={8}>
            <Form.Item name="vehicleNo" label="Vehicle no." extra={editing ? undefined : 'e.g. DL01AB1234'}
              rules={editing ? [] : [{ required: true, message: 'Enter vehicle no.' }]}>
              <Input maxLength={15} disabled={editing} {...upper} />
            </Form.Item>
          </Col>
          <Col xs={24} md={10}>
            <Form.Item name="vendorType" label="Vehicle of">
              <Radio.Group optionType="button" options={opts?.vendorTypes ?? []}
                onChange={() => form.setFieldsValue({ vendorCode: undefined })} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="vendorCode" label="Vendor" rules={[{ required: true, message: 'Select vendor' }]}>
              {/* market vehicles: "+ New Market / Temporary Vendor" (in this division) */}
              <MasterSelect master={vendorType === 'MARKET' ? 'temp-vendor' : undefined} quickInitial={{ FTLDIVISION: user.divCode }}
                options={vendors} loading={vendorsLoading}
                notFoundContent={vendorsLoading ? undefined : 'No vendor of this kind in your division'} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="ownerName" label="Owner name" rules={[{ required: true, message: 'Enter owner name' }]}>
              <Input maxLength={100} {...upper} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="vehicleType" label="Vehicle type" rules={[{ required: true, message: 'Select vehicle type' }]}>
              <MasterSelect master="container" options={opts?.vehicleTypes ?? []}
                onChange={(v) => {
                  const t = opts?.vehicleTypes?.find((x) => x.value === v);
                  if (t?.containerSize) form.setFieldValue('containerSize', t.containerSize);
                }}
                onCreated={(row) => { if (row.ContainerSize) form.setFieldValue('containerSize', String(row.ContainerSize).trim()); }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="containerSize" label="Container size" rules={[{ required: true, message: 'Enter container size' }]}>
              <Input maxLength={50} {...upper} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="branch" label="Branch" rules={[{ required: true, message: 'Select branch' }]}>
              <Select showSearch optionFilterProp="label" options={opts?.branches ?? []} />
            </Form.Item>
          </Col>
          {type && (
            <Col xs={24}>
              <Descriptions size="small" bordered column={{ xs: 2, md: 5 }} style={{ marginBottom: 16 }}
                items={[
                  { label: 'Capacity (kg)', children: type.capacity || '—' },
                  { label: 'Container type', children: type.containerType || '—' },
                  { label: 'Body', children: type.body || '—' },
                  { label: 'Wheels', children: type.wheels || '—' },
                  { label: 'Mode', children: type.mode || '—' },
                ]} />
            </Col>
          )}
          <Col xs={12} md={6}>
            <Form.Item name="chassisNo" label="Chassis no." rules={[{ required: true, message: 'Enter chassis no.' }]}>
              <Input maxLength={50} {...upper} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="engineNo" label="Engine no." rules={[{ required: true, message: 'Enter engine no.' }]}>
              <Input maxLength={50} {...upper} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="make" label="Make" rules={[{ required: true, message: 'Enter make' }]}><Input maxLength={50} /></Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="model" label="Model" rules={[{ required: true, message: 'Enter model' }]}><Input maxLength={50} /></Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="makerId" label="Maker"><MasterSelect master="vehicle-maker" toValue={(r) => Number(r.slno)} allowClear options={opts?.makers ?? []} /></Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="fuelType" label="Fuel" rules={[{ required: true, message: 'Select fuel' }]}>
              <Select options={opts?.fuelTypes ?? []} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="tankCapacity" label="Tank capacity (L)" rules={[{ required: true, pattern: /^\d{1,6}$/, message: 'Litres' }]}>
              <Input maxLength={6} inputMode="numeric" />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="amc" label="AMC" rules={[{ required: true, message: 'Select AMC' }]}><Select options={opts?.amcTypes ?? []} /></Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="routes" label="Routes (attached vehicles, up to 10)"
              extra={vendorType === 'Vendor' ? undefined : 'Only attached vendor vehicles have routes'}>
              <RouteSelect disabled={vendorType !== 'Vendor'} initialOptions={vehicle?.routeOptions} />
            </Form.Item>
          </Col>
        </Row>
        <Collapse size="small" items={[{
          key: 'purchase', label: 'Purchase details',
          children: (
            <Row gutter={12}>
              <Col xs={24} md={12}><Form.Item name="dealerName" label="Dealer name"><Input maxLength={100} {...upper} /></Form.Item></Col>
              <Col xs={12} md={6}>
                <Form.Item name="purchaseDate" label="Purchase date">
                  <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6}><Form.Item name="invoiceNo" label="Invoice no."><Input maxLength={50} /></Form.Item></Col>
              <Col xs={24}><Form.Item name="dealerAddress" label="Dealer address"><Input.TextArea rows={2} maxLength={500} /></Form.Item></Col>
              <Col xs={12} md={6}>
                <Form.Item name="invoiceValue" label="Invoice value"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
              </Col>
              <Col xs={12} md={6}>
                <Form.Item name="dealMaturityAmount" label="Deal maturity amount"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
              </Col>
              <Col xs={24}>
                <Typography.Text type="secondary">
                  The purchase voucher and loan / EMI sheet for own vehicles are not available in the new app yet.
                </Typography.Text>
              </Col>
            </Row>
          ),
        }]} />
      </Form>
    </Drawer>
  );
}

export default function VehicleMasterPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [vendorType, setVendorType] = useState('');
  const [editing, setEditing] = useState(null); // null = closed, '' = new, number = edit
  const canEdit = ['admin', 'employee'].includes(user.role);

  const { data: opts } = useQuery({ queryKey: ['vehicle-options'], queryFn: () => api.get('/vehicles/options').then((r) => r.data) });
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['vehicles', q, status, vendorType, user.divCode],
    queryFn: () => api.get('/vehicles', { params: { q, status, vendorType } }).then((r) => r.data),
  });
  const toggle = useMutation({
    mutationFn: ({ vehicleNo, active }) => api.patch(`/vehicles/${vehicleNo}/status`, { active }),
    onSuccess: (r) => { message.success(r.data.message); queryClient.invalidateQueries({ queryKey: ['vehicles'] }); },
    onError: (e) => message.error(errorMessage(e)),
  });
  const typeLabel = (t) => opts?.vendorTypes?.find((x) => x.value.toUpperCase() === String(t).toUpperCase())?.label ?? t;

  return (
    <Card className="page-card" title="Vehicle Master"
      extra={canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('')}>New vehicle</Button>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search placeholder="Vehicle no., vendor, owner or type" allowClear onSearch={setQ} style={{ width: 280 }} />
        <Select value={vendorType} onChange={setVendorType} style={{ width: 180 }}
          options={[{ value: '', label: 'All vehicles' }, ...(opts?.vendorTypes ?? [])]} />
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        <Typography.Text type="secondary">{data.length} vehicle(s) in {user.divName || user.divCode}</Typography.Text>
      </Space>
      {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}
      <Table
        size="middle"
        rowKey="vehicleNo"
        loading={isFetching}
        dataSource={data}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        columns={[
          { title: 'Vehicle no.', dataIndex: 'vehicleNo', sorter: (a, b) => a.vehicleNo.localeCompare(b.vehicleNo) },
          { title: 'Of', dataIndex: 'vendorType', render: typeLabel },
          { title: 'Vendor', dataIndex: 'vendor', render: (v, r) => v || r.vendorCode },
          { title: 'Type', dataIndex: 'vehicleTypeName' },
          { title: 'Capacity', dataIndex: 'capacity', align: 'right' },
          { title: 'Make / model', key: 'mm', render: (_, r) => [r.make, r.model].filter(Boolean).join(' / ') },
          { title: 'Branch', dataIndex: 'branchName' },
          { title: 'Now at', dataIndex: 'currentLocation', render: (v) => v || '—' },
          { title: 'Status', dataIndex: 'active', render: (v) => (v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
          {
            title: '', key: 'a', width: 110,
            render: (_, r) => canEdit && (
              <Space>
                <Button size="small" icon={<EditOutlined />} aria-label={`Edit ${r.vehicleNo}`} onClick={() => setEditing(r.vehicleNo)} />
                <Popconfirm title={`${r.active ? 'Deactivate' : 'Activate'} ${r.vehicleNo}?`}
                  description={r.active ? 'An inactive vehicle is not offered on challans.' : undefined}
                  okText={r.active ? 'Deactivate' : 'Activate'} okButtonProps={{ danger: r.active }}
                  onConfirm={() => toggle.mutateAsync({ vehicleNo: r.vehicleNo, active: !r.active })}>
                  <Button size="small" danger={r.active} icon={<PoweroffOutlined />} aria-label={`${r.active ? 'Deactivate' : 'Activate'} ${r.vehicleNo}`} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <VehicleForm
        open={editing !== null}
        vehicleNo={editing || null}
        opts={opts}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          queryClient.invalidateQueries({ queryKey: ['vehicles'] });
          queryClient.invalidateQueries({ queryKey: ['vehicle'] });
        }}
      />
    </Card>
  );
}
