import { useSearchParams, useNavigate } from 'react-router-dom';
import { Button, Result, Typography } from 'antd';

export default function NotMigratedPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const page = params.get('page') || '';
  return (
    <Result
      status="info"
      title="This screen has not been migrated yet"
      subTitle={<>Legacy page: <Typography.Text code>{page}</Typography.Text></>}
      extra={<Button type="primary" onClick={() => navigate('/')}>Back to dashboard</Button>}
    />
  );
}
