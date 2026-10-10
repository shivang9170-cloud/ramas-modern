// Replaces User/Change_Password.aspx and User/Franchisee_Change_Password.aspx.
// forced: shown on its own (no menu) right after a login with a default / weak password — the app opens after the change.
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Alert, App, Button, Card, Form, Input } from 'antd';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const STRONG = [
  { min: 8, message: 'At least 8 characters' },
  { pattern: /[a-z]/i, message: 'Use at least one letter' },
  { pattern: /\d/, message: 'Use at least one number' },
];

export default function ChangePasswordPage({ forced = false }) {
  const { message } = App.useApp();
  const { applySession, logout } = useAuth();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const change = useMutation({
    mutationFn: (v) => api.post('/auth/change-password', { oldPassword: v.oldPassword, newPassword: v.newPassword }),
    onSuccess: ({ data }) => {
      message.success('Password changed');
      form.resetFields();
      if (data.token) applySession(data);   // the new session (no longer limited to changing the password)
      if (forced) navigate('/', { replace: true });
    },
    onError: (e) => message.error(errorMessage(e)),
  });

  const card = (
    <Card className="page-card login-card" title="Change Password" style={{ maxWidth: 480, margin: forced ? '0 auto' : undefined }}>
      {forced && (
        <Alert type="warning" showIcon style={{ marginBottom: 12 }}
          message="You signed in with a default / weak password. Choose your own password to continue." />
      )}
      <Form form={form} layout="vertical" onFinish={(v) => change.mutate(v)} disabled={change.isPending}>
        <Form.Item name="oldPassword" label="Current password" rules={[{ required: true }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item name="newPassword" label="New password" rules={[{ required: true }, ...STRONG]}
          extra="8 or more characters with letters and numbers; not a default password or your user id.">
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="Confirm new password"
          dependencies={['newPassword']}
          rules={[{ required: true }, ({ getFieldValue }) => ({
            validator: (_, v) => (!v || v === getFieldValue('newPassword') ? Promise.resolve() : Promise.reject(new Error('Passwords do not match'))),
          })]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={change.isPending}>Change password</Button>
        {forced && <Button type="link" onClick={logout} disabled={false}>Log out</Button>}
      </Form>
    </Card>
  );
  return forced ? <div className="login-page">{card}</div> : card;
}
