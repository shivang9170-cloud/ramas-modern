// Branch Master — replaces Master/Branch_Master.aspx.
// List + a drawer to add / edit a branch. State → city → location cascade; the GSTIN defaults
// from the state; saving also binds the branch ledgers (CASH …, TOPAY / PAID RECOVERY, branch).
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, App, Button, Card, Checkbox, Col, Drawer, Form, Input, Popconfirm, Radio, Row, Select, Space, Switch, Table, Tag, Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import MasterSelect from '../../components/masters/MasterSelect.jsx';

const TYPES = [
  { value: 'BRANCH', label: 'Branch' },
  { value: 'HUB', label: 'Hub' },
  { value: 'MF', label: 'Master franchisee' },
  { value: 'FR', label: 'Franchisee' },
];
const typeOf = (b) => (b.isHub ? 'HUB' : b.isMasterFranchisee ? 'MF' : b.isFranchisee ? 'FR' : 'BRANCH');

function BranchForm({ open, branch, onClose, onSaved }) {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const stateCode = Form.useWatch('stateCode', form);
  const cityCode = Form.useWatch('cityCode', form);
  const location = Form.useWatch('location', form);
  const editing = Boolean(branch);

  const { data: opts } = useQuery({ queryKey: ['branch-options'], queryFn: () => api.get('/branches/options').then((r) => r.data) });
  const { data: cities = [] } = useQuery({
    queryKey: ['branch-cities', stateCode], enabled: Boolean(stateCode),
    queryFn: () => api.get('/branches/cities', { params: { state: stateCode } }).then((r) => r.data),
  });
  const { data: locations = [] } = useQuery({
    queryKey: ['branch-locations', cityCode], enabled: Boolean(cityCode),
    queryFn: () => api.get('/branches/locations', { params: { city: cityCode } }).then((r) => r.data),
  });

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(branch
      ? { ...branch, type: typeOf(branch) }
      : { type: 'BRANCH', active: true, docketAutoNumber: false, divisions: [user.divCode], company: opts?.companies?.[0]?.value });
  }, [open, branch, form, user.divCode, opts]);

  const loc = locations.find((l) => l.value === location);
  const linkedElsewhere = loc?.linkedCode && loc.linkedCode !== branch?.code;

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const payload = {
        ...v,
        location: v.location || '',
        isHub: v.type === 'HUB', isMasterFranchisee: v.type === 'MF', isFranchisee: v.type === 'FR',
      };
      delete payload.type;
      const { data } = editing ? await api.put(`/branches/${branch.code}`, payload) : await api.post('/branches', payload);
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
      title={editing ? `Edit branch ${branch.name} : ${branch.code}` : 'New branch'}
      open={open}
      onClose={onClose}
      width={Math.min(820, window.innerWidth)}
      extra={<Button type="primary" loading={saving} onClick={save}>{editing ? 'Update' : 'Save'}</Button>}
    >
      <Form form={form} layout="vertical">
        <Row gutter={12}>
          <Col xs={24} md={12}>
            <Form.Item name="name" label="Branch name" rules={[{ required: true, message: 'Enter branch name' }]}>
              <Input maxLength={100} style={{ textTransform: 'uppercase' }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="shortCode" label="Short code" tooltip="Part of every document number (pickup, manifest, challan…) — must be unique"
              rules={[{ required: true, pattern: /^[A-Za-z0-9]{2,6}$/, message: '2–6 letters/digits' }]}>
              <Input maxLength={6} style={{ textTransform: 'uppercase' }} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="stateCode" label="State" rules={[{ required: true, message: 'Select state' }]}>
              <MasterSelect master="state" options={opts?.states ?? []}
                onChange={(v) => {
                  form.setFieldsValue({ cityCode: undefined, location: undefined });
                  const gst = opts?.states?.find((x) => x.value === v)?.gstin;
                  if (gst && !form.getFieldValue('gstin')) form.setFieldValue('gstin', gst);
                }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="cityCode" label="City" rules={[{ required: true, message: 'Select city' }]}>
              <MasterSelect master="city" options={cities} disabled={!stateCode} quickInitial={{ state_code: stateCode }}
                onChange={() => form.setFieldValue('location', undefined)} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="location" label="Location" extra={loc?.pinCode ? `PIN ${loc.pinCode}` : undefined}
              validateStatus={linkedElsewhere ? 'error' : undefined}
              help={linkedElsewhere ? `Already linked to ${loc.linkedTo}` : undefined}>
              <MasterSelect master="location" allowClear disabled={!cityCode} quickInitial={{ City_Code: cityCode, State_code: stateCode }}
                options={locations.map((l) => ({ value: l.value, label: l.linkedCode && l.linkedCode !== branch?.code ? `${l.label} (${l.linkedTo})` : l.label }))} />
            </Form.Item>
          </Col>
          <Col xs={24} md={16}><Form.Item name="address" label="Address"><Input.TextArea rows={2} maxLength={500} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="place" label="Place"><Input maxLength={100} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name="contactPerson" label="Contact person"><Input maxLength={100} /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="phone" label="Phone"><Input maxLength={50} /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="email" label="E-mail" rules={[{ type: 'email', message: 'Invalid e-mail' }]}><Input maxLength={100} /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="fax" label="Fax"><Input maxLength={50} /></Form.Item></Col>
          <Col xs={12} md={8}>
            <Form.Item name="gstin" label="GSTIN" rules={[{ pattern: /^$|^\d{2}[A-Za-z0-9]{13}$/, message: '15 characters' }]}>
              <Input maxLength={15} style={{ textTransform: 'uppercase' }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="company" label="Company" rules={[{ required: true, message: 'Select company' }]}>
              <Select options={opts?.companies ?? []} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="controllingBranch" label="Controlling branch" rules={[{ required: true, message: 'Select controlling branch' }]}>
              <Select showSearch optionFilterProp="label"
                options={[...(editing ? [{ value: branch.code, label: `${branch.name} : ${branch.code} (itself)` }] : []),
                  ...(opts?.branches ?? []).filter((b) => b.value !== branch?.code)]} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="type" label="Type"><Radio.Group optionType="button" options={TYPES} /></Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="divisions" label="Divisions" tooltip="Ledgers are created for every division ticked" rules={[{ required: true, type: 'array', min: 1, message: 'Tick at least one division' }]}>
              <Checkbox.Group options={opts?.divisions ?? []} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}><Form.Item name="sapCode" label="SAP code"><Input maxLength={30} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="manualCode" label="Manual code"><Input maxLength={30} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="maxLimit" label="Request limit (max)"><Input maxLength={20} inputMode="decimal" /></Form.Item></Col>
          <Col xs={12} md={6}>
            <Form.Item name="docketAutoNumber" label="Computerised docket no." valuePropName="checked"><Switch /></Form.Item>
          </Col>
          <Col xs={24}><Form.Item name="remarks" label="Remarks"><Input maxLength={500} /></Form.Item></Col>
        </Row>
      </Form>
    </Drawer>
  );
}

export default function BranchMasterPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState(null); // null = closed, {} = new, branch = edit
  const canEdit = ['admin', 'employee'].includes(user.role);

  const { data = [], isFetching, error } = useQuery({
    queryKey: ['branches', q, status, user.divCode],
    queryFn: () => api.get('/branches', { params: { q, status } }).then((r) => r.data),
  });
  const remove = useMutation({
    mutationFn: (code) => api.delete(`/branches/${code}`),
    onSuccess: (r) => { message.success(r.data.message); queryClient.invalidateQueries({ queryKey: ['branches'] }); },
    onError: (e) => message.error(errorMessage(e)),
  });

  return (
    <Card className="page-card" title="Branch Master"
      extra={canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>New branch</Button>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search placeholder="Name, code, short code or city" allowClear onSearch={setQ} style={{ width: 280 }} />
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        <Typography.Text type="secondary">{data.length} branch(es) in {user.divName || user.divCode}</Typography.Text>
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
          { title: 'Branch', dataIndex: 'name', sorter: (a, b) => a.name.localeCompare(b.name) },
          { title: 'Short', dataIndex: 'shortCode' },
          { title: 'City', key: 'city', render: (_, r) => `${r.city}${r.state ? `, ${r.state}` : ''}` },
          { title: 'Location', dataIndex: 'locationName', render: (v) => v || '—' },
          { title: 'Controlling', dataIndex: 'controllingBranchName' },
          { title: 'Type', key: 't', render: (_, r) => { const t = typeOf(r); return t === 'BRANCH' ? '—' : <Tag>{TYPES.find((x) => x.value === t).label}</Tag>; } },
          { title: 'Status', dataIndex: 'active', render: (v) => (v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
          {
            title: '', key: 'a', width: 110,
            render: (_, r) => canEdit && (
              <Space>
                <Button size="small" icon={<EditOutlined />} aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)} />
                <Popconfirm title={`Delete ${r.name}?`} description="Only possible if nothing uses this branch." okText="Delete"
                  okButtonProps={{ danger: true }} onConfirm={() => remove.mutateAsync(r.code)}>
                  <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${r.name}`} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <BranchForm
        open={editing !== null}
        branch={editing && editing.code ? editing : null}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); queryClient.invalidateQueries({ queryKey: ['branches'] }); queryClient.invalidateQueries({ queryKey: ['branch-options'] }); }}
      />
    </Card>
  );
}
