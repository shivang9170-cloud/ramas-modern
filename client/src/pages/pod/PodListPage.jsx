// POD dispatch list / view / cancel — replaces Operation/POD_Dispatch_Cancel.aspx and POD_Dispatch_View.aspx.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { App, Button, Card, DatePicker, Descriptions, Drawer, Form, Image, Input, Radio, Space, Spin, Table, Tag, Typography } from 'antd';
import { EyeOutlined, FilePdfOutlined, PlusOutlined, StopOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');

/** POD files need the bearer token, so they are fetched as blobs (an <img src> would not send it). */
function PodFile({ file }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoke;
    api.get(`/pod/images/${file.id}`, { responseType: 'blob' })
      .then((r) => { revoke = URL.createObjectURL(r.data); setUrl(revoke); })
      .catch(() => setFailed(true));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [file.id]);
  if (failed) return <Tag color="red">{file.name}: missing</Tag>;
  if (!url) return <Spin size="small" />;
  if (file.type === 'pdf') {
    return <Button size="small" icon={<FilePdfOutlined />} onClick={() => window.open(url, '_blank', 'noopener')}>PDF</Button>;
  }
  return <Image src={url} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 4 }} alt={`POD ${file.name}`} />;
}

function PodDetail({ iomNo, onClose, canCancel }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['pod', iomNo],
    queryFn: () => api.get(`/pod/${encodeURIComponent(iomNo)}`).then((r) => r.data),
    enabled: Boolean(iomNo),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/pod/${encodeURIComponent(iomNo)}/cancel`),
    onSuccess: (r) => {
      message.success(r.data.message);
      queryClient.invalidateQueries({ queryKey: ['pods'] });
      queryClient.invalidateQueries({ queryKey: ['pod', iomNo] });
    },
    onError: (e) => message.error(errorMessage(e)),
  });

  return (
    <Drawer title={`POD dispatch ${iomNo ?? ''}`} open={Boolean(iomNo)} onClose={onClose} width={Math.min(900, window.innerWidth)} loading={isLoading}>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      {data && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="IOM date">{fmt(data.iomDate)}</Descriptions.Item>
            <Descriptions.Item label="Status">
              {data.cancelled ? <Tag color="red">Cancelled</Tag> : data.courierDocNo ? <Tag color="blue">Couriered ({data.courierDocNo})</Tag> : <Tag color="green">Dispatched</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="Sent to">{data.sentTo}</Descriptions.Item>
            <Descriptions.Item label="Created by">{data.createdBy}</Descriptions.Item>
          </Descriptions>
          <Image.PreviewGroup>
            <Table
              size="small"
              rowKey="docketNo"
              pagination={false}
              scroll={{ x: 'max-content' }}
              dataSource={data.dockets}
              columns={[
                { title: 'Docket no.', dataIndex: 'docketNo' },
                { title: 'Consignee', dataIndex: 'consignee' },
                { title: 'Remarks', dataIndex: 'remarks', render: (v) => v || '—' },
                {
                  title: 'POD', key: 'img',
                  render: (_, r) => (r.images.length ? <Space wrap>{r.images.map((f) => <PodFile key={f.id} file={f} />)}</Space> : <Tag>Without image</Tag>),
                },
              ]}
            />
          </Image.PreviewGroup>
          {canCancel && !data.cancelled && !data.courierDocNo && data.fromBranch === user.currentBranch.code && (
            <Button
              danger icon={<StopOutlined />} loading={cancel.isPending}
              onClick={() => modal.confirm({
                title: `Cancel POD dispatch ${iomNo}?`,
                content: 'The dockets can be dispatched again. Uploaded files are kept.',
                okText: 'Cancel dispatch', okButtonProps: { danger: true }, cancelText: 'Keep',
                onOk: () => cancel.mutateAsync(),
              })}
            >
              Cancel POD dispatch
            </Button>
          )}
        </Space>
      )}
    </Drawer>
  );
}

export default function PodListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useState({
    from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), status: 'active', search: '',
  });
  const [open, setOpen] = useState(null);
  const canCancel = ['admin', 'employee'].includes(user.role);

  const { data = [], isFetching, error } = useQuery({
    queryKey: ['pods', params, user.currentBranch.code],
    queryFn: () => api.get('/pod', { params }).then((r) => r.data),
  });

  return (
    <Card
      className="page-card"
      title="POD Dispatch View / Cancel"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/operation/pod/new')}>New POD dispatch</Button>}
    >
      <Form
        layout="inline"
        style={{ rowGap: 8, marginBottom: 12 }}
        initialValues={{ range: [dayjs(params.from), dayjs(params.to)], status: 'active' }}
        onFinish={(v) => setParams({
          from: v.range[0].format('YYYY-MM-DD'), to: v.range[1].format('YYYY-MM-DD'), status: v.status, search: v.search?.trim() || '',
        })}
      >
        <Form.Item name="range" label="Date"><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
        <Form.Item name="status">
          <Radio.Group optionType="button" options={[{ value: 'active', label: 'Active' }, { value: 'cancelled', label: 'Cancelled' }]} />
        </Form.Item>
        <Form.Item name="search"><Input placeholder="IOM / docket no." allowClear style={{ width: 180 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      <Table
        size="middle"
        rowKey="iomNo"
        loading={isFetching}
        dataSource={data}
        scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, showTotal: (t) => `${t} IOMs` }}
        columns={[
          { title: 'IOM no.', dataIndex: 'iomNo' },
          { title: 'Date', dataIndex: 'iomDate', render: fmt },
          { title: 'Sent to', dataIndex: 'sentTo' },
          { title: 'Dockets', dataIndex: 'dockets', render: (d) => d.join(', ') },
          { title: 'Files', dataIndex: 'images', align: 'right' },
          { title: 'By', dataIndex: 'createdBy' },
          { title: '', key: 'view', width: 90, render: (_, r) => <Button size="small" icon={<EyeOutlined />} onClick={() => setOpen(r.iomNo)}>View</Button> },
        ]}
      />
      <PodDetail iomNo={open} onClose={() => setOpen(null)} canCancel={canCancel} />
    </Card>
  );
}
