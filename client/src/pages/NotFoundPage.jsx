import { useNavigate } from 'react-router-dom';
import { Button, Result } from 'antd';

export default function NotFoundPage() {
  const navigate = useNavigate();
  return <Result status="404" title="Page not found" extra={<Button type="primary" onClick={() => navigate('/')}>Back to dashboard</Button>} />;
}
