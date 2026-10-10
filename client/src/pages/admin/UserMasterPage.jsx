// User Master (staff logins) — replaces User/User_Master.aspx. Admin only.
// A login belongs to an employee; it starts in the home branch and may switch to the other ticked branches.
// Menu rights are given in Admin → User Access Rights. Passwords are never shown; a new one can be set.
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Checkbox, Drawer, Form, Input, Popconfirm, Radio, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

function LoginForm({ open, login, opts, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const editing = Boolean(login);
  const homeBranch = Form.useWatch('homeBranch', form);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    if (editing) {
      form.setFieldsValue({
        homeBranch: login.branches[0]?.id, branches: login.branches.slice(1).map((b) => b.id), active: login.active,
      });
    } else {
      form.setFieldsValue({ active: true, branches: [] });
    }
  }, [open, editing, login, form]);

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    setSaving(true);
    try {
      const payload = { homeBranch: v.homeBranch, branches: (v.branches ?? []).filter((b) => b !== v.homeBranch), active: v.active, password: v.password ?? '' };
      const { data } = editing
        ? await api.put(`/users/${login.userId}`, payload)
        : await api.post('/users', { ...payload, employee: v.employee });
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
      title={editing ? `Login ${login.name} : ${login.userId}` : 'New login'}
      open={open}
      onClose={onClose}
      width={Math.min(560, window.innerWidth)}
      extra={<Button type="primary" loading={saving} onClick={save}>{editing ? 'Update' : 'Create login'}</Button>}
    >
      <Form form={form} layout="vertical">
        {!editing && (
          <Form.Item name="employee" label="Employee" extra="Active employees of this division who have no login yet"
            rules={[{ required: true, message: 'Select employee' }]}>
            <Select showSearch optionFilterProp="label" options={opts?.employees ?? []}
              notFoundContent="Every active employee already has a login — add the employee in Employee Master first" />
          </Form.Item>
        )}
        <Form.Item name="password" label={editing ? 'New password (leave blank to keep the current one)' : 'Password'}
          rules={[
            ...(editing ? [] : [{ required: true, message: 'Enter a password' }]),
            { min: 6, message: 'At least 6 characters' },
            { pattern: /^\S(.*\S)?$/, message: 'Cannot start or end with a space' },
          ]}>
          <Input.Password maxLength={50} autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="confirm" label="Confirm password" dependencies={['password']}
          rules={[({ getFieldValue }) => ({
            validator: (_, v) => ((getFieldValue('password') ?? '') === (v ?? '') ? Promise.resolve() : Promise.reject(new Error('Passwords do not match'))),
          })]}>
          <Input.Password maxLength={50} autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="homeBranch" label="Home branch" extra="The login starts in this branch" rules={[{ required: true, message: 'Select home branch' }]}>
          <Select showSearch optionFilterProp="label" options={opts?.branches ?? []} />
        </Form.Item>
        <Form.Item name="branches" label="May also switch to">
          <Checkbox.Group options={(opts?.branches ?? []).map((b) => ({ ...b, disabled: b.value === homeBranch }))} />
        </Form.Item>
        <Form.Item name="active" label="Login active" valuePropName="checked"><Switch /></Form.Item>
        <Typography.Text type="secondary">
          Menu rights are set in <Link to="/admin/access-rights">User Access Rights</Link>.
        </Typography.Text>
      </Form>
    </Drawer>
  );
}

export default function UserMasterPage() {
  const { user } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [editing, setEditing] = useState(null); // null = closed, {} = new, login = edit

  const { data: opts } = useQuery({ queryKey: ['user-options', user.divCode], queryFn: () => api.get('/users/options').then((r) => r.data) });
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['users', q, status, user.divCode],
    queryFn: () => api.get('/users', { params: { q, status } }).then((r) => r.data),
  });
  const remove = useMutation({
    mutationFn: (userId) => api.delete(`/users/${userId}`),
    onSuccess: (r) => {
      message.success(r.data.message);
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['user-options'] });
    },
    onError: (e) => message.error(errorMessage(e)),
  });

  if (user.role !== 'admin') return <Alert type="warning" showIcon message="Only the administrator can manage logins." />;

  return (
    <Card className="page-card" title="User Master (logins)"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>New login</Button>}>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search placeholder="User id, name or home branch" allowClear onSearch={setQ} style={{ width: 260 }} />
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        <Typography.Text type="secondary">{data.length} login(s) in {user.divName || user.divCode}</Typography.Text>
      </Space>
      {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}
      <Table
        size="middle"
        rowKey="userId"
        loading={isFetching}
        dataSource={data}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        columns={[
          { title: 'User id', dataIndex: 'userId', sorter: (a, b) => a.userId.localeCompare(b.userId) },
          {
            title: 'Employee', dataIndex: 'name',
            render: (v, r) => (r.employeeActive ? v : <Space>{v}<Tag color="orange">employee inactive</Tag></Space>),
          },
          { title: 'Home branch', dataIndex: 'homeBranch' },
          { title: 'Can switch to', dataIndex: 'branches', render: (b) => b.slice(1).map((x) => <Tag key={x.id}>{x.name}</Tag>) },
          { title: 'Created', dataIndex: 'createdAt' },
          { title: 'Status', dataIndex: 'active', render: (v) => (v ? <Tag color="green">Active</Tag> : <Tag>Inactive</Tag>) },
          {
            title: '', key: 'a', width: 110,
            render: (_, r) => (
              <Space>
                <Button size="small" icon={<EditOutlined />} aria-label={`Edit login ${r.userId}`} onClick={() => setEditing(r)} />
                <Popconfirm title={`Delete the login of ${r.name}?`} description="The employee and the menu rights stay; only the sign-in is removed."
                  okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => remove.mutateAsync(r.userId)}>
                  <Button size="small" danger icon={<DeleteOutlined />} aria-label={`Delete login ${r.userId}`} disabled={r.userId === user.userId} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <LoginForm
        open={editing !== null}
        login={editing?.userId ? editing : null}
        opts={opts}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          queryClient.invalidateQueries({ queryKey: ['users'] });
          queryClient.invalidateQueries({ queryKey: ['user-options'] });
        }}
      />
    </Card>
  );
}
