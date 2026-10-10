// Client Master — replaces Master/Client_Master.aspx.
// List + a drawer to add / edit a client. Saving also binds the client's BILLED and UNBILLED ledgers
// (docket booking posts to them). The name and billing branch are part of those ledger names, so they
// cannot be changed after the client is created (as in the legacy page once the ledgers existed).
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Checkbox, Col, DatePicker, Divider, Drawer, Form, Input, InputNumber, Popconfirm, Radio, Row, Select, Space,
  Switch, Table, Tag, Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import MasterSelect from '../../components/masters/MasterSelect.jsx';

const upper = { style: { textTransform: 'uppercase' } };

function CitySelect({ value, onChange, initial }) {
  const [q, setQ] = useState('');
  const { data: found = [], isFetching } = useQuery({
    queryKey: ['client-cities', q],
    queryFn: () => api.get('/clients/cities', { params: { q } }).then((r) => r.data),
  });
  const options = useMemo(() => {
    const map = new Map([...(initial ? [initial] : []), ...found].map((o) => [o.value, o]));
    return [...map.values()];
  }, [found, initial]);
  // "+ New City" when the city is not in the master yet; the new city is then searched so it shows in the list
  return (
    <MasterSelect master="city" showSearch filterOption={false} onSearch={setQ} loading={isFetching} value={value} onChange={onChange}
      options={options} placeholder="Type a city" onCreated={(row) => setQ(String(row.city_name ?? '').trim())} />
  );
}

function ClientForm({ open, id, opts, onClose, onSaved }) {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const gstRegistered = Form.useWatch('gstRegistered', form);
  const sameAsClient = Form.useWatch(['billing', 'sameAsClient'], form);
  const isPs = Form.useWatch('isPs', form);
  const editing = Boolean(id);

  const { data: client, isFetching, error } = useQuery({
    queryKey: ['client', id], enabled: open && editing,
    queryFn: () => api.get(`/clients/${id}`).then((r) => r.data),
  });

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (!editing) {
      const here = user.currentBranch?.code;
      form.setFieldsValue({
        branch: here, submissionLocation: here, collectionLocation: here, gstRegistered: true, placeOfSupply: 'INTRASTATE',
        introDate: dayjs(), creditPeriod: 0, billingCycle: '30', creditType: 'Consigner', custType: 0, isPs: false,
        showKmOnPrint: false, discount: false, thirdPartyBilling: false, walkingClient: false, active: true, billing: { sameAsClient: true },
      });
    } else if (client) {
      form.setFieldsValue({
        ...client,
        contractBy: client.contractBy || undefined,
        underClient: client.underClient || undefined,
        natureOfBusinessId: client.natureOfBusinessId ?? undefined,
        introDate: client.introDate ? dayjs(client.introDate) : null,
        poDate: client.poDate ? dayjs(client.poDate) : null,
      });
    }
  }, [open, editing, client, form, user.currentBranch?.code]);

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const payload = {
        ...v,
        introDate: v.introDate.format('YYYY-MM-DD'),
        poDate: v.poDate ? v.poDate.format('YYYY-MM-DD') : '',
        gstin: v.gstRegistered ? v.gstin : '',
        transportId: v.isPs ? v.transportId : '',
        contractBy: v.contractBy ?? '',
        underClient: v.underClient ?? '',
        billing: v.billing?.sameAsClient ? { sameAsClient: true } : { ...v.billing, sameAsClient: false },
      };
      const { data } = editing ? await api.put(`/clients/${id}`, payload) : await api.post('/clients', payload);
      message.success(data.message);
      onSaved();
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? details.map((d) => d.message).join('; ') : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const cityInitial = client?.cityCode ? { value: client.cityCode, label: [client.city, client.state].filter(Boolean).join(', ') } : null;

  return (
    <Drawer
      title={editing ? `Edit client ${client?.name ?? ''} : ${client?.code ?? ''}` : 'New client'}
      open={open}
      onClose={onClose}
      width={Math.min(920, window.innerWidth)}
      extra={<Button type="primary" loading={saving} disabled={editing && !client} onClick={save}>{editing ? 'Update' : 'Save'}</Button>}
    >
      {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" disabled={editing && isFetching && !client}>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="name" label="Client name" extra={editing ? 'Part of the client ledgers — cannot be changed' : undefined}
              rules={editing ? [] : [{ required: true, min: 2, message: 'Enter client name' }]}>
              <Input maxLength={200} disabled={editing} {...upper} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="branch" label="Billing branch" rules={editing ? [] : [{ required: true, message: 'Select billing branch' }]}>
              <Select showSearch optionFilterProp="label" options={opts?.branches ?? []} disabled={editing} />
            </Form.Item>
          </Col>
          <Col xs={12} md={4}>
            <Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="submissionLocation" label="Bill submission at" rules={[{ required: true, message: 'Select' }]}>
              <Select showSearch optionFilterProp="label" options={opts?.branches ?? []} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="collectionLocation" label="Payment collection at" rules={[{ required: true, message: 'Select' }]}>
              <Select showSearch optionFilterProp="label" options={opts?.branches ?? []} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}><Form.Item name="contactPerson" label="Contact person"><Input maxLength={100} {...upper} /></Form.Item></Col>
          <Col xs={24} md={16}>
            <Form.Item name="address" label="Address" rules={[{ required: true, message: 'Enter address' }]}>
              <Input.TextArea rows={2} maxLength={500} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="cityCode" label="City" rules={[{ required: true, message: 'Select city' }]}><CitySelect initial={cityInitial} /></Form.Item>
          </Col>
          <Col xs={12} md={6}><Form.Item name="place" label="Place"><Input maxLength={100} {...upper} /></Form.Item></Col>
          <Col xs={12} md={6}>
            <Form.Item name="pinCode" label="PIN code" rules={[{ pattern: /^\d{6}$/, message: '6 digits' }]}><Input maxLength={6} inputMode="numeric" /></Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="phone" label="Phone" rules={[{ required: true, pattern: /^\d{6,13}$/, message: '6–13 digits' }]}>
              <Input maxLength={13} inputMode="tel" />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="mobile" label="Mobile" rules={[{ required: true, pattern: /^\d{10}$/, message: '10 digits' }]}>
              <Input maxLength={10} inputMode="tel" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="email" label="E-mail" rules={[{ type: 'email', message: 'Invalid e-mail' }]}><Input maxLength={100} /></Form.Item>
          </Col>
          <Col xs={12} md={6}><Form.Item name="fax" label="Fax"><Input maxLength={50} /></Form.Item></Col>
        </Row>

        <Divider orientation="left" plain>Tax</Divider>
        <Row gutter={12}>
          <Col xs={12} md={6}>
            <Form.Item name="gstRegistered" label="Registered for GST">
              <Radio.Group optionType="button" options={[{ value: true, label: 'Yes' }, { value: false, label: 'No' }]} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="gstin" label="GSTIN" rules={gstRegistered
              ? [{ required: true, message: 'Enter GSTIN' }, { pattern: /^\d{2}[A-Za-z0-9]{13}$/, message: '15 characters' }] : []}>
              <Input maxLength={15} disabled={!gstRegistered} {...upper} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="placeOfSupply" label="Place of supply" rules={[{ required: true, message: 'Select' }]}>
              <Select options={opts?.placeOfSupply ?? []} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="pan" label="PAN" rules={[{ pattern: /^[A-Za-z]{5}\d{4}[A-Za-z]$/, message: 'AAAAA9999A' }]}><Input maxLength={10} {...upper} /></Form.Item>
          </Col>
          <Col xs={12} md={6}><Form.Item name="tin" label="TIN"><Input maxLength={50} /></Form.Item></Col>
          <Col xs={12} md={6}>
            <Form.Item name="cinNo" label="CIN" rules={[{ pattern: /^[A-Za-z0-9]{21}$/, message: '21 characters' }]}><Input maxLength={21} {...upper} /></Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" plain>Terms</Divider>
        <Row gutter={12}>
          <Col xs={12} md={6}>
            <Form.Item name="introDate" label="Introduction date" rules={[{ required: true, message: 'Enter date' }]}>
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="creditPeriod" label="Credit period (days)"><InputNumber min={0} max={365} style={{ width: '100%' }} /></Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="billingCycle" label="Billing cycle (days)" rules={[{ required: true, pattern: /^\d{1,3}$/, message: 'Days' }]}>
              <Input maxLength={3} inputMode="numeric" />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="custType" label="Customer type"><Radio.Group optionType="button" options={opts?.custTypes ?? []} /></Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="natureOfBusinessId" label="Nature of business" rules={[{ required: true, message: 'Select' }]}>
              <MasterSelect master="nature-of-business" toValue={(r) => Number(r.ID)} options={opts?.natureOfBusiness ?? []} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="contractBy" label="Contract by"><Select allowClear showSearch optionFilterProp="label" options={opts?.employees ?? []} /></Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="underClient" label="Under client (parent)">
              <Select allowClear showSearch optionFilterProp="label" options={(opts?.parentClients ?? []).filter((c) => c.value !== client?.code)} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="creditType" label="Credit"><Radio.Group optionType="button" options={opts?.creditTypes ?? []} /></Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Space wrap size="large" style={{ marginTop: 30 }}>
              <Form.Item name="discount" valuePropName="checked" noStyle><Checkbox>Discount allowed</Checkbox></Form.Item>
              <Form.Item name="thirdPartyBilling" valuePropName="checked" noStyle><Checkbox>Third-party billing</Checkbox></Form.Item>
              <Form.Item name="walkingClient" valuePropName="checked" noStyle><Checkbox>Walk-in client</Checkbox></Form.Item>
            </Space>
          </Col>
        </Row>

        <Divider orientation="left" plain>Billing details</Divider>
        <Form.Item name={['billing', 'sameAsClient']} valuePropName="checked"><Checkbox>Same as the client above</Checkbox></Form.Item>
        {!sameAsClient && (
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name={['billing', 'name']} label="Bill to name" rules={[{ required: true, message: 'Enter name' }]}><Input maxLength={200} {...upper} /></Form.Item>
            </Col>
            <Col xs={12} md={6}><Form.Item name={['billing', 'phone']} label="Phone"><Input maxLength={20} /></Form.Item></Col>
            <Col xs={12} md={6}>
              <Form.Item name={['billing', 'gstin']} label="GSTIN" rules={[{ pattern: /^$|^\d{2}[A-Za-z0-9]{13}$/, message: '15 characters' }]}>
                <Input maxLength={15} {...upper} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name={['billing', 'address']} label="Bill to address" rules={[{ required: true, message: 'Enter address' }]}>
                <Input.TextArea rows={2} maxLength={500} />
              </Form.Item>
            </Col>
          </Row>
        )}

        <Divider orientation="left" plain>Print and other</Divider>
        <Row gutter={12}>
          <Col xs={12} md={6}>
            <Form.Item name="isPs" label="PS client" valuePropName="checked"><Switch /></Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="transportId" label="Transport id" rules={isPs ? [{ required: true, message: 'Enter transport id' }] : []}>
              <Input maxLength={50} disabled={!isPs} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="showKmOnPrint" label="Show km on print" valuePropName="checked"><Switch /></Form.Item>
          </Col>
          <Col xs={12} md={6}><Form.Item name="printAs" label="Print as"><Input maxLength={200} {...upper} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="poNo" label="PO no."><Input maxLength={50} /></Form.Item></Col>
          <Col xs={12} md={6}>
            <Form.Item name="poDate" label="PO date"><DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} /></Form.Item>
          </Col>
          <Col xs={12} md={6}><Form.Item name="sapCode" label="SAP code"><Input maxLength={20} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="manualCode" label="Manual code"><Input maxLength={20} /></Form.Item></Col>
          <Col xs={24}><Form.Item name="remarks" label="Remarks"><Input maxLength={500} /></Form.Item></Col>
        </Row>
      </Form>
    </Drawer>
  );
}

export default function ClientMasterPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState(null); // null = closed, 0 = new, id = edit
  const canEdit = ['admin', 'employee'].includes(user.role);

  const { data: opts } = useQuery({ queryKey: ['client-options', user.divCode], queryFn: () => api.get('/clients/options').then((r) => r.data) });
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['clients', q, status, user.divCode],
    queryFn: () => api.get('/clients', { params: { q, status } }).then((r) => r.data),
  });
  const remove = useMutation({
    mutationFn: (id) => api.delete(`/clients/${id}`),
    onSuccess: (r) => { message.success(r.data.message); queryClient.invalidateQueries({ queryKey: ['clients'] }); },
    onError: (e) => message.error(errorMessage(e)),
  });

  return (
    <Card className="page-card" title="Client Master"
      extra={canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(0)}>New client</Button>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search placeholder="Name, code, city, GSTIN or phone" allowClear onSearch={setQ} style={{ width: 280 }} />
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        <Typography.Text type="secondary">{data.length} client(s) in {user.divName || user.divCode}</Typography.Text>
      </Space>
      {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}
      <Table
        size="middle"
        rowKey="id"
        loading={isFetching}
        dataSource={data}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        columns={[
          { title: 'Code', dataIndex: 'code', sorter: (a, b) => a.code.localeCompare(b.code) },
          { title: 'Client', dataIndex: 'name', sorter: (a, b) => a.name.localeCompare(b.name) },
          { title: 'Billing branch', dataIndex: 'branchName' },
          { title: 'City', dataIndex: 'city' },
          { title: 'Contact', key: 'c', render: (_, r) => [r.contactPerson, r.mobile || r.phone].filter(Boolean).join(' · ') },
          { title: 'GSTIN', dataIndex: 'gstin', render: (v) => v || '—' },
          { title: 'Credit (days)', dataIndex: 'creditPeriod', align: 'right' },
          { title: 'Status', dataIndex: 'active', render: (v) => (v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
          {
            title: '', key: 'a', width: 110,
            render: (_, r) => canEdit && (
              <Space>
                <Button size="small" icon={<EditOutlined />} aria-label={`Edit ${r.name}`} onClick={() => setEditing(r.id)} />
                <Popconfirm title={`Delete ${r.name}?`} description="Only possible if no docket, rate, login or ledger entry uses it."
                  okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => remove.mutateAsync(r.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${r.name}`} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <ClientForm
        open={editing !== null}
        id={editing || null}
        opts={opts}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          queryClient.invalidateQueries({ queryKey: ['clients'] });
          queryClient.invalidateQueries({ queryKey: ['client'] });
          queryClient.invalidateQueries({ queryKey: ['client-options'] });
        }}
      />
    </Card>
  );
}
