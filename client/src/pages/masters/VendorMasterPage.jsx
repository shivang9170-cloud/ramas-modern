// Vendor Master — replaces Master/Vendor_Entry.aspx.
// List + a drawer to add / edit a vendor. Saving also binds the vendor's ledger
// ("NAME :CODE :BRANCH :BRANCHCODE", Sundry Creditors) for every ticked division — the challan
// screen lists vendors through that ledger.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Checkbox, Col, DatePicker, Drawer, Form, Input, InputNumber, Popconfirm, Radio, Row, Select, Space, Switch,
  Table, Tag, Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import MasterSelect from '../../components/masters/MasterSelect.jsx';

const upper = { style: { textTransform: 'uppercase' } };

function VendorForm({ open, code, opts, onClose, onSaved }) {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const stateCode = Form.useWatch('stateCode', form);
  const gstRegistered = Form.useWatch('gstRegistered', form);
  const editing = Boolean(code);

  const { data: vendor, isFetching, error } = useQuery({
    queryKey: ['vendor', code], enabled: open && editing,
    queryFn: () => api.get(`/vendors/${code}`).then((r) => r.data),
  });
  const { data: cities = [] } = useQuery({
    queryKey: ['vendor-cities', stateCode], enabled: Boolean(stateCode),
    queryFn: () => api.get('/vendors/cities', { params: { state: stateCode } }).then((r) => r.data),
  });

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (!editing) {
      form.setFieldsValue({
        vendorType: 'VENDOR', modes: ['RD'], branch: user.currentBranch?.code, active: true, gstRegistered: true, fastTag: false,
        approvalDate: dayjs(), divisions: [user.divCode],
      });
    } else if (vendor) {
      form.setFieldsValue({ ...vendor, approvalDate: vendor.approvalDate ? dayjs(vendor.approvalDate) : null });
    }
  }, [open, editing, vendor, form, user.currentBranch?.code, user.divCode]);

  // An approver saved by the old page who is no longer an active employee stays selectable.
  const approvers = vendor && vendor.approvedBy && !opts?.approvers?.some((a) => a.value === vendor.approvedBy)
    ? [...(opts?.approvers ?? []), { value: vendor.approvedBy, label: vendor.approvedByText }]
    : opts?.approvers ?? [];

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const payload = { ...v, approvalDate: v.approvalDate.format('YYYY-MM-DD'), gstin: v.gstRegistered ? v.gstin : '' };
      const { data } = editing ? await api.put(`/vendors/${code}`, payload) : await api.post('/vendors', payload);
      message.success(data.message, data.message.length > 60 ? 8 : 3);
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
      title={editing ? `Edit vendor ${vendor?.name ?? ''} : ${code}` : 'New vendor'}
      open={open}
      onClose={onClose}
      width={Math.min(860, window.innerWidth)}
      extra={<Button type="primary" loading={saving} disabled={editing && !vendor} onClick={save}>{editing ? 'Update' : 'Save'}</Button>}
    >
      {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" disabled={editing && isFetching && !vendor}>
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="name" label="Vendor name" extra={editing ? 'The name is part of the vendor ledger and cannot be changed' : undefined}
              rules={editing ? [] : [{ required: true, min: 2, message: 'Enter vendor name' }]}>
              <Input maxLength={100} disabled={editing} {...upper} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="vendorType" label="Vendor type" rules={[{ required: true, message: 'Select vendor type' }]}>
              <Select options={opts?.vendorTypes ?? []} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="branch" label="Branch" rules={[{ required: true, message: 'Select branch' }]}
              extra={editing && vendor ? 'Changing the branch creates a ledger under the new branch name' : undefined}>
              <Select showSearch optionFilterProp="label" options={opts?.branches ?? []} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="modes" label="Modes" rules={[{ required: true, type: 'array', min: 1, message: 'Tick at least one mode' }]}>
              <Checkbox.Group options={opts?.modes ?? []} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="stateCode" label="State" rules={[{ required: true, message: 'Select state' }]}>
              <MasterSelect master="state" options={opts?.states ?? []} onChange={() => form.setFieldValue('cityCode', undefined)} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="cityCode" label="City" rules={[{ required: true, message: 'Select city' }]}>
              <MasterSelect master="city" options={cities} disabled={!stateCode} quickInitial={{ state_code: stateCode }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="pinCode" label="PIN code" rules={[{ pattern: /^\d{6}$/, message: '6 digits' }]}>
              <Input maxLength={6} inputMode="numeric" />
            </Form.Item>
          </Col>
          <Col xs={24}><Form.Item name="address" label="Address"><Input.TextArea rows={2} maxLength={500} /></Form.Item></Col>
          <Col xs={24} md={8}>
            <Form.Item name="contactPerson" label="Contact person" rules={[{ required: true, message: 'Enter contact person' }]}>
              <Input maxLength={100} {...upper} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="phone" label="Phone" rules={[{ required: true, pattern: /^\d{6,15}$/, message: '6–15 digits' }]}>
              <Input maxLength={15} inputMode="tel" />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}><Form.Item name="fax" label="Fax"><Input maxLength={50} /></Form.Item></Col>
          <Col xs={24} md={8}>
            <Form.Item name="email" label="E-mail" rules={[{ type: 'email', message: 'Invalid e-mail' }]}><Input maxLength={100} /></Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="pan" label="PAN" rules={[{ pattern: /^[A-Za-z]{5}\d{4}[A-Za-z]$/, message: 'AAAAA9999A' }]}>
              <Input maxLength={10} {...upper} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="tdsPercent" label="TDS %" rules={[{ required: true, message: 'Enter TDS %' }]}
              tooltip="Deducted from the vendor's hire on every challan">
              <InputNumber min={0} max={99.99} step={0.5} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="gstRegistered" label="Registered for GST">
              <Radio.Group optionType="button" options={[{ value: true, label: 'Yes' }, { value: false, label: 'No' }]} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="gstin" label="GSTIN" rules={gstRegistered
              ? [{ required: true, message: 'Enter GSTIN' }, { pattern: /^\d{2}[A-Za-z0-9]{13}$/, message: '15 characters' }] : []}>
              <Input maxLength={15} disabled={!gstRegistered} {...upper} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="fastTag" label="FASTag" valuePropName="checked"><Switch /></Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="ifsc" label="IFSC" rules={[{ pattern: /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/, message: '11 characters, e.g. HDFC0001234' }]}>
              <Input maxLength={11} {...upper} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="accountNo" label="Bank account no." rules={[{ pattern: /^\d{6,20}$/, message: 'Digits only' }]}>
              <Input maxLength={20} inputMode="numeric" />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}>
            <Form.Item name="approvalDate" label="Approval date" rules={[{ required: true, message: 'Enter approval date' }]}>
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="approvedBy" label="Approved by" rules={[{ required: true, message: 'Select who approved' }]}>
              <Select showSearch optionFilterProp="label" options={approvers} />
            </Form.Item>
          </Col>
          <Col xs={12} md={8}><Form.Item name="confLetterNo" label="Confirmation letter no."><Input maxLength={50} {...upper} /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="sapCode" label="SAP code"><Input maxLength={20} /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="manualCode" label="Manual code"><Input maxLength={20} /></Form.Item></Col>
          <Col xs={24}>
            <Form.Item name="divisions" label="Divisions" tooltip="The vendor ledger is created for every division ticked"
              rules={[{ required: true, type: 'array', min: 1, message: 'Tick at least one division' }]}>
              <Checkbox.Group options={opts?.divisions ?? []} />
            </Form.Item>
          </Col>
          <Col xs={24}><Form.Item name="remarks" label="Remarks"><Input maxLength={500} /></Form.Item></Col>
        </Row>
      </Form>
    </Drawer>
  );
}

export default function VendorMasterPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('');
  const [editing, setEditing] = useState(null); // null = closed, '' = new, code = edit
  const canEdit = ['admin', 'employee'].includes(user.role);

  const { data: opts } = useQuery({ queryKey: ['vendor-options'], queryFn: () => api.get('/vendors/options').then((r) => r.data) });
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['vendors', q, status, type, user.divCode],
    queryFn: () => api.get('/vendors', { params: { q, status, type } }).then((r) => r.data),
  });
  const remove = useMutation({
    mutationFn: (code) => api.delete(`/vendors/${code}`),
    onSuccess: (r) => { message.success(r.data.message); queryClient.invalidateQueries({ queryKey: ['vendors'] }); },
    onError: (e) => message.error(errorMessage(e)),
  });
  const typeLabel = (t) => opts?.vendorTypes?.find((x) => x.value === t)?.label ?? t;
  const modeLabel = (m) => opts?.modes?.find((x) => x.value === m)?.label ?? m;

  return (
    <Card className="page-card" title="Vendor Master"
      extra={canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('')}>New vendor</Button>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search placeholder="Name, code, city, phone or GSTIN" allowClear onSearch={setQ} style={{ width: 280 }} />
        <Select value={type} onChange={setType} style={{ width: 170 }}
          options={[{ value: '', label: 'All types' }, ...(opts?.vendorTypes ?? [])]} />
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        <Typography.Text type="secondary">{data.length} vendor(s) in {user.divName || user.divCode}</Typography.Text>
      </Space>
      {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}
      <Table
        size="middle"
        rowKey="code"
        loading={isFetching}
        dataSource={data}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        columns={[
          { title: 'Code', dataIndex: 'code', sorter: (a, b) => a.code.localeCompare(b.code) },
          { title: 'Vendor', dataIndex: 'name', sorter: (a, b) => a.name.localeCompare(b.name) },
          { title: 'Type', dataIndex: 'vendorType', render: typeLabel },
          { title: 'Modes', dataIndex: 'modes', render: (m) => m.map((x) => <Tag key={x}>{modeLabel(x)}</Tag>) },
          { title: 'Branch', dataIndex: 'branch' },
          { title: 'City', dataIndex: 'city' },
          { title: 'Contact', key: 'c', render: (_, r) => [r.contactPerson, r.phone].filter(Boolean).join(' · ') },
          { title: 'TDS %', dataIndex: 'tdsPercent', align: 'right' },
          { title: 'GSTIN', dataIndex: 'gstin', render: (v) => v || '—' },
          { title: 'Status', dataIndex: 'active', render: (v) => (v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
          {
            title: '', key: 'a', width: 110,
            render: (_, r) => canEdit && (
              <Space>
                <Button size="small" icon={<EditOutlined />} aria-label={`Edit ${r.name}`} onClick={() => setEditing(r.code)} />
                <Popconfirm title={`Delete ${r.name}?`} description="Only possible if no challan, vehicle, rate or ledger entry uses it."
                  okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => remove.mutateAsync(r.code)}>
                  <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${r.name}`} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <VendorForm
        open={editing !== null}
        code={editing || null}
        opts={opts}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          queryClient.invalidateQueries({ queryKey: ['vendors'] });
          queryClient.invalidateQueries({ queryKey: ['vendor'] });
        }}
      />
    </Card>
  );
}
