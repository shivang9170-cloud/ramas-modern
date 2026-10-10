// Vendor and vehicle (replaces Setting/Vendor_and_vehicle.aspx): the trucks, flights and trains each vendor (or our own
// fleet) runs. Pick vendor type, vendor and mode, add rows to the list, save them together.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Drawer, Form, Input, InputNumber, Radio, Select, Space, Switch, Table } from 'antd';
import { FileExcelOutlined, PlusOutlined } from '@ant-design/icons';
import { api } from '../../api/client.js';
import { exportCsv } from '../../utils/exportTable.js';
import { get, send } from './common.js';
import MasterSelect from '../../components/masters/MasterSelect.jsx';

function AddVehicles({ open, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [rowForm] = Form.useForm();
  const [rows, setRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const opts = useQuery({ queryKey: ['vv-options'], queryFn: () => get('/vendor-vehicles/options') }).data;
  const vendorType = Form.useWatch('vendorType', form);
  const mode = Form.useWatch('mode', form);
  const vendors = useQuery({ queryKey: ['vv-vendors', vendorType], enabled: Boolean(vendorType), queryFn: () => get('/vendor-vehicles/vendors', { type: vendorType }) }).data ?? [];
  const kind = opts?.modes.find((m) => m.value === mode)?.kind;

  async function add() {
    let r;
    try { r = await rowForm.validateFields(); } catch { return; }
    if (kind === 'train') {
      const t = opts.trains.find((x) => x.value === r.trainCode);
      if (!t) { message.info('The new train is still loading — click Add again'); return; }
      if (rows.some((x) => x.trainCode === r.trainCode)) { message.error(`Train ${t.label} already added`); return; }
      r = { ...r, vehicleName: t.name };
    }
    setRows([...rows, r]);
    rowForm.resetFields();
  }
  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    const res = await send(message, () => api.post('/vendor-vehicles', { ...v, rows }));
    setSaving(false);
    if (res) { setRows([]); onSaved(); }
  }
  const text = (name, label, req) => (
    <Form.Item name={name} label={label} rules={req ? [{ required: true, message: `Enter ${label.toLowerCase()}` }] : []}><Input /></Form.Item>
  );
  const rowCols = {
    air: [{ title: 'Flight no', dataIndex: 'vehicleNo' }, { title: 'Name', dataIndex: 'vehicleName' }],
    train: [{ title: 'Train', dataIndex: 'trainCode' }, { title: 'Name', dataIndex: 'vehicleName' }, { title: 'Direction', dataIndex: 'direction' }, { title: 'Type', dataIndex: 'trainType' }],
    road: [{ title: 'Truck', dataIndex: 'truckNo' }, { title: 'Vehicle', dataIndex: 'vehicleName' }, { title: 'Engine', dataIndex: 'engineNo' }, { title: 'Chassis', dataIndex: 'chassisNo' }, { title: 'Capacity', dataIndex: 'capacity' }],
  };
  return (
    <Drawer title="Add vendor vehicles" open={open} onClose={onClose} width={Math.min(760, window.innerWidth)} destroyOnClose
      extra={<Button type="primary" loading={saving} disabled={!rows.length} onClick={save}>Save</Button>}>
      <Form form={form} layout="vertical" preserve={false}>
        <Space wrap>
          <Form.Item name="vendorType" label="Vendor type" rules={[{ required: true, message: 'Select vendor type' }]}>
            <Radio.Group options={opts?.vendorTypes ?? []} onChange={() => { form.setFieldValue('vendor', undefined); setRows([]); }} />
          </Form.Item>
          <Form.Item name="vendor" label="Vendor" rules={[{ required: true, message: 'Select vendor' }]}>
            <Select showSearch optionFilterProp="label" style={{ width: 280 }} options={vendors} disabled={!vendorType} onChange={() => setRows([])} />
          </Form.Item>
          <Form.Item name="mode" label="Mode" rules={[{ required: true, message: 'Select mode' }]}>
            <Select style={{ width: 140 }} options={opts?.modes ?? []} onChange={() => setRows([])} />
          </Form.Item>
        </Space>
      </Form>
      {kind && (
        <Form form={rowForm} layout="vertical" preserve={false} initialValues={{ direction: 'UP' }}>
          <Space wrap align="end">
            {kind === 'air' && <>{text('vehicleNo', 'Flight no', true)}{text('vehicleName', 'Flight name', true)}</>}
            {kind === 'train' && (
              <>
                <Form.Item name="trainCode" label="Train" rules={[{ required: true, message: 'Select train' }]}>
                  <MasterSelect master="train" style={{ width: 260 }} options={opts.trains}
                    onChange={(v) => rowForm.setFieldValue('direction', opts.trains.find((t) => t.value === v)?.direction ?? 'UP')}
                    onCreated={(r) => rowForm.setFieldValue('direction', String(r.Directions ?? 'UP').trim() || 'UP')} />
                </Form.Item>
                <Form.Item name="direction" label="Direction"><Radio.Group options={['UP', 'DOWN']} /></Form.Item>
                {vendorType === 'SELF' && <Form.Item name="trainType" label="Train type"><Select allowClear style={{ width: 110 }} options={opts.trainTypes} /></Form.Item>}
              </>
            )}
            {kind === 'road' && (
              <>
                <Form.Item name="vehicleName" label="Vehicle name" rules={[{ required: true, message: 'Select vehicle name' }]}><MasterSelect master="vehicle-name" valueField="vehicle_name" style={{ width: 180 }} options={opts.vehicleNames} /></Form.Item>
                {text('truckNo', 'Truck no', true)}{text('engineNo', 'Engine no')}{text('chassisNo', 'Chassis no')}
                {text('model', 'Model')}{text('make', 'Make')}{text('validity', 'Validity')}
                <Form.Item name="capacity" label="Capacity" rules={[{ required: true, message: 'Select capacity' }]}>
                  <MasterSelect master="container" valueField="freight_name" style={{ width: 180 }} options={opts.capacities}
                    onChange={(v) => { const c = opts.capacities.find((x) => x.value === v); rowForm.setFieldsValue({ vehicleCapacity: c?.capacity, containerSize: c?.size }); }}
                    onCreated={(r) => rowForm.setFieldsValue({ vehicleCapacity: Number(r.container_Capacity) || undefined, containerSize: String(r.ContainerSize ?? '').trim() })} />
                </Form.Item>
                <Form.Item name="vehicleCapacity" label="Vehicle capacity"><InputNumber min={0} /></Form.Item>
                {text('containerSize', 'Container size')}{text('state', 'State')}
              </>
            )}
            <Form.Item><Button icon={<PlusOutlined />} onClick={add}>Add</Button></Form.Item>
          </Space>
        </Form>
      )}
      {kind && (
        <Table size="small" rowKey={(r, i) => i} dataSource={rows} pagination={false}
          columns={[...rowCols[kind], { title: '', key: 'x', render: (_, r) => <Button size="small" danger onClick={() => setRows(rows.filter((x) => x !== r))}>Remove</Button> }]} />
      )}
    </Drawer>
  );
}

export default function VendorVehiclePage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [vendorType, setVendorType] = useState('');
  const [mode, setMode] = useState('');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const opts = useQuery({ queryKey: ['vv-options'], queryFn: () => get('/vendor-vehicles/options') }).data;
  const { data = [], isFetching } = useQuery({ queryKey: ['vv-list', vendorType, mode, search], queryFn: () => get('/vendor-vehicles', { vendorType, mode, search }) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['vv-list'] });
  const columns = [
    { title: 'Vendor', dataIndex: 'vendorName' },
    { title: 'Mode', dataIndex: 'modeName' },
    { title: 'Vehicle / flight / train no', key: 'no', dataIndex: 'vehicleNo', render: (v, r) => r.truckNo || v, exportValue: (v, r) => r.truckNo || v },
    { title: 'Name', dataIndex: 'vehicleName' },
    { title: 'Engine', dataIndex: 'engineNo' },
    { title: 'Chassis', dataIndex: 'chassisNo' },
    { title: 'Model', dataIndex: 'model' },
    { title: 'Capacity', dataIndex: 'capacity' },
    { title: 'Direction', dataIndex: 'direction' },
    { title: 'Train type', dataIndex: 'trainType' },
  ];
  return (
    <Card className="page-card" title="Vendor And Vehicle"
      extra={<Space>
        <Button icon={<FileExcelOutlined />} disabled={!data.length} onClick={() => exportCsv('Vendor_Vehicle', columns, data)}>Export</Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>Add vehicles</Button>
      </Space>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Radio.Group optionType="button" value={vendorType} onChange={(e) => setVendorType(e.target.value)}
          options={[{ value: '', label: 'All' }, ...(opts?.vendorTypes ?? [])]} />
        <Select style={{ width: 140 }} value={mode} onChange={setMode} options={[{ value: '', label: 'All modes' }, ...(opts?.modes ?? [])]} />
        <Input.Search placeholder="Vendor or vehicle no" allowClear style={{ width: 240 }} onSearch={setSearch} />
      </Space>
      <Table size="small" rowKey="id" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }}
        columns={[...columns, {
          title: 'Active', dataIndex: 'active',
          render: (v, r) => <Switch size="small" checked={v} aria-label={`Active ${r.truckNo || r.vehicleNo}`}
            onChange={async (a) => { if (await send(message, () => api.patch(`/vendor-vehicles/${r.id}/status`, { active: a }))) refresh(); }} />,
        }]} />
      <AddVehicles open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />
    </Card>
  );
}
