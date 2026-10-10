// Replaces login.aspx / Login2.aspx / Client_login.aspx / Franchisee_login.aspx.
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Form, Input, Segmented, Select, Typography } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ThemePicker from '../theme/ThemePicker.jsx';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form] = Form.useForm();
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: options, isLoading, error: optionsError } = useQuery({
    queryKey: ['login-options'],
    queryFn: () => api.get('/auth/options').then((r) => r.data),
  });

  useEffect(() => {
    if (!options) return;
    form.setFieldsValue({
      divCode: form.getFieldValue('divCode') ?? options.divisions[0]?.DivCode,
      financialYear: form.getFieldValue('financialYear') ?? options.financialYears[0]?.Financial_Year,
    });
  }, [options, form]);

  if (user) return <Navigate to={location.state?.from?.pathname || '/'} replace />;

  const onFinish = async (values) => {
    setError(null);
    setSubmitting(true);
    try {
      await login(values);
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-theme"><ThemePicker type="default" /></div>
      <Card className="login-card" variant="borderless">
        <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>Ramas ERP</Typography.Title>
        <Typography.Paragraph type="secondary">Sign in to continue</Typography.Paragraph>

        {optionsError && <Alert type="error" showIcon style={{ marginBottom: 16 }} message="Cannot reach the server" description={errorMessage(optionsError)} />}
        {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} message={error} />}

        <Form form={form} layout="vertical" onFinish={onFinish} initialValues={{ loginType: 'employee' }} requiredMark={false} disabled={submitting}>
          <Form.Item name="loginType" label="Login as">
            <Segmented block options={[
              { label: 'Employee', value: 'employee' },
              { label: 'Franchisee', value: 'franchisee' },
              { label: 'Client', value: 'client' },
            ]} />
          </Form.Item>
          <Form.Item name="divCode" label="Division" rules={[{ required: true, message: 'Select a division' }]}>
            <Select loading={isLoading} options={options?.divisions.map((d) => ({ value: d.DivCode, label: d.DivName }))} />
          </Form.Item>
          <Form.Item name="financialYear" label="Financial year" rules={[{ required: true, message: 'Select a financial year' }]}>
            <Select loading={isLoading} options={options?.financialYears.map((f) => ({ value: f.Financial_Year, label: f.Financial_Year }))} />
          </Form.Item>
          <Form.Item name="username" label="User ID" rules={[{ required: true, whitespace: true, message: 'Enter your user id' }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" autoFocus />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Enter your password' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>Sign in</Button>
        </Form>
      </Card>
    </div>
  );
}
