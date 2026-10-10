// Employee Master — replaces Master/Employee_Master.aspx.
// List + a drawer to add / edit an employee. Saving also binds the employee's ledger (Salary Expenses) for every
// ticked division. Photo / document upload is not available yet (the legacy upload was unsafe).
import { useEffect, useState } from 'react';
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
const req = (message) => [{ required: true, message }];
const toDay = (v) => (v ? dayjs(v) : null);

function EmployeeForm({ open, id, opts, onClose, onSaved }) {
  const { user } = useAuth();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const branch = Form.useWatch('branch', form);
  const editing = Boolean(id);

  const { data: employee, isFetching, error } = useQuery({
    queryKey: ['employee', id], enabled: open && editing,
    queryFn: () => api.get(`/employees/${id}`).then((r) => r.data),
  });
  const { data: locations = [], isFetching: locLoading } = useQuery({
    queryKey: ['employee-locations', branch], enabled: Boolean(branch),
    queryFn: () => api.get('/employees/locations', { params: { branch } }).then((r) => r.data),
  });

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (!editing) {
      form.setFieldsValue({
        branch: user.currentBranch?.code, divisions: [user.divCode], company: opts?.companies?.[0]?.value, employmentType: 'OnRole',
        joiningType: '1', joiningDate: dayjs(), effectiveFrom: dayjs(), guardianType: 'Father', gender: 'Male', maritalStatus: '1',
        nationality: 'Indian', active: true, references: [{}, {}, {}], previousCompany: {},
      });
    } else if (employee) {
      form.setFieldsValue({
        ...employee,
        location: employee.location || undefined,
        reportsTo: employee.reportsTo || undefined,
        religion: employee.religion || undefined,
        category: employee.category || undefined,
        bloodGroup: employee.bloodGroup || undefined,
        joiningDate: toDay(employee.joiningDate),
        effectiveFrom: toDay(employee.effectiveFrom),
        dob: toDay(employee.dob),
      });
    }
  }, [open, editing, employee, form, user.currentBranch?.code, user.divCode, opts]);

  function copyPresent() {
    const v = form.getFieldsValue(['presentAddress', 'presentCity', 'presentPin']);
    form.setFieldsValue({ permanentAddress: v.presentAddress, permanentCity: v.presentCity, permanentPin: v.presentPin });
  }

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const d = (x) => x.format('YYYY-MM-DD');
      const payload = {
        ...v,
        location: v.location ?? '',
        reportsTo: v.reportsTo ?? '',
        joiningDate: d(v.joiningDate),
        effectiveFrom: d(v.effectiveFrom),
        dob: d(v.dob),
        totalExperience: v.totalExperience ?? null,
        references: (v.references ?? []).map((r) => ({ name: r?.name ?? '', address: r?.address ?? '', relation: r?.relation ?? '', mobile: r?.mobile ?? '' })),
      };
      const { data } = editing ? await api.put(`/employees/${id}`, payload) : await api.post('/employees', payload);
      message.success(data.message);
      onSaved();
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? details.map((x) => x.message).join('; ') : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      title={editing ? `Edit employee ${employee?.name ?? ''} : ${employee?.code ?? ''}` : 'New employee'}
      open={open}
      onClose={onClose}
      width={Math.min(940, window.innerWidth)}
      extra={<Button type="primary" loading={saving} disabled={editing && !employee} onClick={save}>{editing ? 'Update' : 'Save'}</Button>}
    >
      {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}
      <Form form={form} layout="vertical" disabled={editing && isFetching && !employee}>
        <Row gutter={12}>
          <Col xs={24} md={10}><Form.Item name="name" label="Employee name" rules={req('Enter name')}><Input maxLength={200} {...upper} /></Form.Item></Col>
          <Col xs={12} md={8}>
            <Form.Item name="designation" label="Designation" rules={req('Select designation')}><MasterSelect master="designation" options={opts?.designations ?? []} /></Form.Item>
          </Col>
          <Col xs={12} md={6}><Form.Item name="active" label="Active" valuePropName="checked"><Switch /></Form.Item></Col>
          <Col xs={24} md={8}>
            <Form.Item name="branch" label="Branch" rules={req('Select branch')}>
              <Select showSearch optionFilterProp="label" options={opts?.branches ?? []} onChange={() => form.setFieldValue('location', undefined)} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="location" label="Location" rules={locations.length ? req('Select location') : []}
              extra={branch && !locLoading && !locations.length ? 'This branch has no locations' : undefined}>
              {/* "+ New Location" for this branch when it has none / not the one needed */}
              <MasterSelect master="location" options={locations} loading={locLoading} disabled={!branch} quickInitial={{ branch_code: branch }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="department" label="Department" rules={req('Select department')}><MasterSelect master="department" options={opts?.departments ?? []} /></Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="company" label="Company" rules={req('Select company')}><Select options={opts?.companies ?? []} /></Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="reportsTo" label="Reports to">
              <Select allowClear showSearch optionFilterProp="label" options={(opts?.employees ?? []).filter((e) => e.value !== employee?.code)} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="employmentType" label="Roll"><Radio.Group optionType="button" options={opts?.employmentTypes ?? []} /></Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="divisions" label="Divisions" rules={[{ required: true, type: 'array', min: 1, message: 'Tick at least one division' }]}>
              <Checkbox.Group options={opts?.divisions ?? []} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="joiningType" label="Joining"><Select options={opts?.joiningTypes ?? []} /></Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="joiningDate" label="Joining date" rules={req('Enter joining date')}><DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} /></Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="effectiveFrom" label="Effective from" dependencies={['joiningDate']}
              rules={[...req('Enter date'), ({ getFieldValue }) => ({
                validator: (_, v) => (!v || !getFieldValue('joiningDate') || !v.isBefore(getFieldValue('joiningDate'), 'day')
                  ? Promise.resolve() : Promise.reject(new Error('Not before the joining date'))),
              })]}>
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" plain>Personal</Divider>
        <Row gutter={12}>
          <Col xs={12} md={6}><Form.Item name="guardianType" label="Guardian"><Select options={opts?.guardianTypes ?? []} /></Form.Item></Col>
          <Col xs={12} md={10}><Form.Item name="guardianName" label="Guardian's name" rules={req("Enter guardian's name")}><Input maxLength={100} {...upper} /></Form.Item></Col>
          <Col xs={12} md={8}><Form.Item name="gender" label="Gender"><Radio.Group optionType="button" options={opts?.genders ?? []} /></Form.Item></Col>
          <Col xs={12} md={6}>
            <Form.Item name="dob" label="Date of birth" rules={req('Enter date of birth')}>
              <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
            </Form.Item>
          </Col>
          <Col xs={12} md={6}><Form.Item name="maritalStatus" label="Marital status"><Select options={opts?.maritalStatus ?? []} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="religion" label="Religion" rules={req('Select')}><Select options={opts?.religions ?? []} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="category" label="Category" rules={req('Select')}><Select options={opts?.categories ?? []} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="nationality" label="Nationality" rules={req('Select')}><Select options={opts?.nationalities ?? []} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="bloodGroup" label="Blood group" rules={req('Select')}><Select options={opts?.bloodGroups ?? []} /></Form.Item></Col>
        </Row>

        <Divider orientation="left" plain>Contact</Divider>
        <Row gutter={12}>
          <Col xs={12} md={6}>
            <Form.Item name="mobile" label="Mobile" rules={[{ required: true, pattern: /^\d{10}$/, message: '10 digits' }]}><Input maxLength={10} inputMode="tel" /></Form.Item>
          </Col>
          <Col xs={12} md={6}><Form.Item name="landline" label="Landline"><Input maxLength={20} /></Form.Item></Col>
          <Col xs={24} md={12}>
            <Form.Item name="email" label="E-mail" rules={[{ required: true, type: 'email', message: 'Enter a valid e-mail' }]}><Input maxLength={100} /></Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="presentAddress" label="Present address" rules={req('Enter present address')}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="presentCity" label="City" rules={req('Select city')}><MasterSelect master="city" options={opts?.cities ?? []} /></Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="presentPin" label="PIN" rules={[{ pattern: /^\d{6}$/, message: '6 digits' }]}><Input maxLength={6} inputMode="numeric" /></Form.Item>
          </Col>
          <Col xs={24}><Button size="small" onClick={copyPresent} style={{ marginBottom: 12 }}>Permanent address same as present</Button></Col>
          <Col xs={24} md={12}>
            <Form.Item name="permanentAddress" label="Permanent address" rules={req('Enter permanent address')}><Input.TextArea rows={2} maxLength={500} /></Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="permanentCity" label="City" rules={req('Select city')}><MasterSelect master="city" options={opts?.cities ?? []} /></Form.Item>
          </Col>
          <Col xs={12} md={6}>
            <Form.Item name="permanentPin" label="PIN" rules={[{ pattern: /^\d{6}$/, message: '6 digits' }]}><Input maxLength={6} inputMode="numeric" /></Form.Item>
          </Col>
        </Row>

        <Divider orientation="left" plain>References</Divider>
        {[0, 1, 2].map((i) => (
          <Row gutter={12} key={i}>
            <Col xs={12} md={6}><Form.Item name={['references', i, 'name']} label={i === 0 ? 'Name' : undefined}><Input maxLength={100} {...upper} /></Form.Item></Col>
            <Col xs={12} md={4}><Form.Item name={['references', i, 'relation']} label={i === 0 ? 'Relation' : undefined}><Input maxLength={50} {...upper} /></Form.Item></Col>
            <Col xs={12} md={4}>
              <Form.Item name={['references', i, 'mobile']} label={i === 0 ? 'Mobile' : undefined} rules={[{ pattern: /^\d{10}$/, message: '10 digits' }]}>
                <Input maxLength={10} inputMode="tel" />
              </Form.Item>
            </Col>
            <Col xs={12} md={10}><Form.Item name={['references', i, 'address']} label={i === 0 ? 'Address' : undefined}><Input maxLength={300} {...upper} /></Form.Item></Col>
          </Row>
        ))}

        <Divider orientation="left" plain>Other</Divider>
        <Row gutter={12}>
          <Col xs={24} md={8}><Form.Item name="qualification" label="Highest qualification"><Input maxLength={100} /></Form.Item></Col>
          <Col xs={12} md={4}><Form.Item name="totalExperience" label="Experience (yrs)"><InputNumber min={0} max={59} step={0.5} style={{ width: '100%' }} /></Form.Item></Col>
          <Col xs={12} md={6}>
            <Form.Item name="pan" label="PAN" rules={[{ pattern: /^[A-Za-z]{5}\d{4}[A-Za-z]$/, message: 'AAAAA9999A' }]}><Input maxLength={10} {...upper} /></Form.Item>
          </Col>
          <Col xs={12} md={6}><Form.Item name="passport" label="Passport no."><Input maxLength={20} {...upper} /></Form.Item></Col>
          <Col xs={24} md={8}><Form.Item name={['previousCompany', 'name']} label="Previous company"><Input maxLength={200} {...upper} /></Form.Item></Col>
          <Col xs={24} md={10}><Form.Item name={['previousCompany', 'address']} label="Its address"><Input maxLength={300} {...upper} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name={['previousCompany', 'phone']} label="Its phone"><Input maxLength={20} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="sapCode" label="SAP code"><Input maxLength={20} /></Form.Item></Col>
          <Col xs={12} md={6}><Form.Item name="manualCode" label="Manual code"><Input maxLength={20} /></Form.Item></Col>
          <Col xs={24}>
            <Space wrap size="large">
              <Form.Item name="pf" valuePropName="checked" noStyle><Checkbox>PF</Checkbox></Form.Item>
              <Form.Item name="esi" valuePropName="checked" noStyle><Checkbox>ESI</Checkbox></Form.Item>
              <Form.Item name="professionalTax" valuePropName="checked" noStyle><Checkbox>Professional tax</Checkbox></Form.Item>
              <Form.Item name="lwf" valuePropName="checked" noStyle><Checkbox>LWF</Checkbox></Form.Item>
              <Form.Item name="costVisible" valuePropName="checked" noStyle><Checkbox>Cost visible</Checkbox></Form.Item>
            </Space>
          </Col>
          <Col xs={24}>
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
              Photo and document upload is not available in the new app yet.
            </Typography.Text>
          </Col>
        </Row>
      </Form>
    </Drawer>
  );
}

export default function EmployeeMasterPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [designation, setDesignation] = useState('');
  const [editing, setEditing] = useState(null); // null = closed, 0 = new, id = edit
  const canEdit = ['admin', 'employee'].includes(user.role);

  const { data: opts } = useQuery({ queryKey: ['employee-options'], queryFn: () => api.get('/employees/options').then((r) => r.data) });
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['employees', q, status, designation, user.divCode],
    queryFn: () => api.get('/employees', { params: { q, status, designation } }).then((r) => r.data),
  });
  const remove = useMutation({
    mutationFn: (id) => api.delete(`/employees/${id}`),
    onSuccess: (r) => { message.success(r.data.message); queryClient.invalidateQueries({ queryKey: ['employees'] }); },
    onError: (e) => message.error(errorMessage(e)),
  });

  return (
    <Card className="page-card" title="Employee Master"
      extra={canEdit && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(0)}>New employee</Button>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search placeholder="Name, code, mobile, branch or designation" allowClear onSearch={setQ} style={{ width: 300 }} />
        <Select value={designation} onChange={setDesignation} style={{ width: 190 }}
          options={[{ value: '', label: 'All designations' }, ...(opts?.designations ?? [])]} />
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        <Typography.Text type="secondary">{data.length} employee(s) in {user.divName || user.divCode}</Typography.Text>
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
          { title: 'Name', dataIndex: 'name', sorter: (a, b) => a.name.localeCompare(b.name) },
          { title: 'Designation', dataIndex: 'designationName' },
          { title: 'Branch', dataIndex: 'branchName' },
          { title: 'Department', dataIndex: 'departmentName' },
          { title: 'Mobile', dataIndex: 'mobile' },
          { title: 'Joined', dataIndex: 'joiningDate', render: (v) => (v ? dayjs(v).format('DD/MM/YYYY') : '—') },
          { title: 'Reports to', dataIndex: 'reportsToName', render: (v) => v || '—' },
          { title: 'Status', dataIndex: 'active', render: (v) => (v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
          {
            title: '', key: 'a', width: 110,
            render: (_, r) => canEdit && (
              <Space>
                <Button size="small" icon={<EditOutlined />} aria-label={`Edit ${r.name}`} onClick={() => setEditing(r.id)} />
                <Popconfirm title={`Delete ${r.name}?`} description="Only possible if no login, permission, pickup, DRS, client, vendor or ledger entry uses the employee."
                  okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => remove.mutateAsync(r.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Delete ${r.name}`} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <EmployeeForm
        open={editing !== null}
        id={editing || null}
        opts={opts}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          queryClient.invalidateQueries({ queryKey: ['employees'] });
          queryClient.invalidateQueries({ queryKey: ['employee'] });
          queryClient.invalidateQueries({ queryKey: ['employee-options'] });
        }}
      />
    </Card>
  );
}
