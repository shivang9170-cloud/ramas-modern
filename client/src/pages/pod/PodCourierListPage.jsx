// POD courier list / view / cancel — replaces Operation/POD_Courier_Cancel.aspx and POD_Courier_View.aspx.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { App, Button, Card, Descriptions, Drawer, Radio, Space, Table, Tag, Typography } from 'antd';
import { EyeOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const fmt = (v) => (v ? dayjs(v).format('DD/MM/YYYY') : '');

function CourierDetail({ docNo, onClose }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['pod-courier', docNo],
    queryFn: () => api.get(`/pod-courier/${encodeURIComponent(docNo)}`).then((r) => r.data),
    enabled: Boolean(docNo),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/pod-courier/${encodeURIComponent(docNo)}/cancel`),
    onSuccess: (r) => { message.success(r.data.message); queryClient.invalidateQueries({ queryKey: ['pod-couriers'] }); queryClient.invalidateQueries({ queryKey: ['pod-courier', docNo] }); },
    onError: (e) => message.error(errorMessage(e)),
  });
  const anyReceived = data?.dockets?.some((d) => d.received);

  return (
    <Drawer title={`Courier document ${docNo ?? ''}`} open={Boolean(docNo)} onClose={onClose} width={Math.min(760, window.innerWidth)} loading={isLoading}>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      {data && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Date">{fmt(data.docDate)}</Descriptions.Item>
            <Descriptions.Item label="Status">
              {data.cancelled ? <Tag color="red">Cancelled</Tag> : data.received ? <Tag color="green">Received at HO</Tag> : anyReceived ? <Tag color="gold">Partly received</Tag> : <Tag color="blue">In transit</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Through">{data.mode}{data.courier && ` — ${data.courier}`}</Descriptions.Item>
            <Descriptions.Item label="AWB / person">{data.awbNo || data.person || '—'}</Descriptions.Item>
          </Descriptions>
          <Table size="small" rowKey={(r) => `${r.iomNo}|${r.docketNo}`} pagination={false} dataSource={data.dockets}
            columns={[
              { title: 'IOM no.', dataIndex: 'iomNo' },
              { title: 'Docket no.', dataIndex: 'docketNo' },
              { title: 'At HO', dataIndex: 'received', render: (v) => (v ? <Tag color="green">Received</Tag> : '—') },
            ]} />
          {!data.cancelled && !anyReceived && data.fromCode === user.currentBranch.code && (
            <Button danger icon={<StopOutlined />} loading={cancel.isPending}
              onClick={() => modal.confirm({
                title: `Cancel courier document ${docNo}?`, content: 'Its IOMs go back to "waiting to be sent".',
                okText: 'Cancel document', okButtonProps: { danger: true }, cancelText: 'Keep', onOk: () => cancel.mutateAsync(),
              })}>
              Cancel courier document
            </Button>
          )}
        </Space>
      )}
    </Drawer>
  );
}

export default function PodCourierListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState('active');
  const [open, setOpen] = useState(null);
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['pod-couriers', status, user.currentBranch.code],
    queryFn: () => api.get('/pod-courier', { params: { status } }).then((r) => r.data),
  });

  return (
    <Card className="page-card" title="POD Courier View / Cancel"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/operation/pod-courier/new')}>New courier</Button>}>
      <Space style={{ marginBottom: 12 }}>
        <Radio.Group optionType="button" value={status} onChange={(e) => setStatus(e.target.value)}
          options={[{ value: 'active', label: 'Active' }, { value: 'cancelled', label: 'Cancelled' }]} />
        <Typography.Text type="secondary">Financial year {user.financialYear}</Typography.Text>
      </Space>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      <Table size="middle" rowKey="docNo" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showTotal: (t) => `${t} documents` }}
        columns={[
          { title: 'Document no.', dataIndex: 'docNo' },
          { title: 'Date', dataIndex: 'docDate', render: fmt },
          { title: 'Through', key: 'm', render: (_, r) => (r.mode === 'Courier' ? `${r.courier} · ${r.awbNo}` : `Self · ${r.person}`) },
          { title: 'IOMs', dataIndex: 'ioms', align: 'right' },
          { title: 'At HO', dataIndex: 'received', render: (v) => (v ? <Tag color="green">Received</Tag> : '—') },
          { title: '', key: 'v', width: 90, render: (_, r) => <Button size="small" icon={<EyeOutlined />} onClick={() => setOpen(r.docNo)}>View</Button> },
        ]} />
      <CourierDetail docNo={open} onClose={() => setOpen(null)} />
    </Card>
  );
}
