// POD received list / cancel — replaces Operation/POD_Received_Cancel.aspx and POD_Received_View.aspx.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { App, Button, Card, DatePicker, Form, Input, Radio, Table, Typography } from 'antd';
import { PlusOutlined, StopOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');

export default function PodReceivedListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [params, setParams] = useState({
    from: dayjs().startOf('month').format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD'), status: 'active', search: '',
  });
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['pod-received', params],
    queryFn: () => api.get('/pod-receive', { params }).then((r) => r.data),
  });
  const cancel = useMutation({
    mutationFn: (docNo) => api.post(`/pod-receive/${encodeURIComponent(docNo)}/cancel`),
    onSuccess: (r) => { message.success(r.data.message); queryClient.invalidateQueries({ queryKey: ['pod-received'] }); },
    onError: (e) => message.error(errorMessage(e)),
  });
  const firstOfDoc = new Set();
  const seen = new Set();
  for (const r of data) if (!seen.has(r.docNo)) { seen.add(r.docNo); firstOfDoc.add(`${r.docNo}|${r.docketNo}`); }

  return (
    <Card className="page-card" title="POD Received View / Cancel"
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/operation/pod-receive/new')}>Receive PODs</Button>}>
      <Form layout="inline" style={{ rowGap: 8, marginBottom: 12 }}
        initialValues={{ range: [dayjs(params.from), dayjs(params.to)], status: 'active' }}
        onFinish={(v) => setParams({ from: v.range[0].format('YYYY-MM-DD'), to: v.range[1].format('YYYY-MM-DD'), status: v.status, search: v.search?.trim() || '' })}>
        <Form.Item name="range" label="Received"><DatePicker.RangePicker format={DATE_FMT} allowClear={false} /></Form.Item>
        <Form.Item name="status">
          <Radio.Group optionType="button" options={[{ value: 'active', label: 'Active' }, { value: 'cancelled', label: 'Cancelled' }]} />
        </Form.Item>
        <Form.Item name="search"><Input placeholder="Document / docket no." allowClear style={{ width: 200 }} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={isFetching}>Show</Button>
      </Form>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      <Table size="middle" rowKey={(r) => `${r.docNo}|${r.docketNo}`} loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 50, showTotal: (t) => `${t} PODs` }}
        columns={[
          { title: 'Document', dataIndex: 'docNo' },
          { title: 'Docket no.', dataIndex: 'docketNo' },
          { title: 'IOM', dataIndex: 'iomNo' },
          { title: 'From', dataIndex: 'from' },
          { title: 'Received', dataIndex: 'receiveDate', render: fmt },
          { title: 'Remark', dataIndex: 'remark', render: (v) => v || '—' },
          { title: 'By', dataIndex: 'createdBy' },
          {
            title: '', key: 'c', width: 170,
            render: (_, r) => (params.status === 'active' && firstOfDoc.has(`${r.docNo}|${r.docketNo}`) ? (
              <Button size="small" danger icon={<StopOutlined />} loading={cancel.isPending && cancel.variables === r.docNo}
                onClick={() => modal.confirm({
                  title: `Cancel receipt of ${r.docNo}?`, content: 'Every POD received on this document goes back to "in transit".',
                  okText: 'Cancel receipt', okButtonProps: { danger: true }, cancelText: 'Keep', onOk: () => cancel.mutateAsync(r.docNo),
                })}>
                Cancel receipt
              </Button>
            ) : null),
          },
        ]} />
      {user.role !== 'admin' && <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>Cancelling works at head office.</Typography.Paragraph>}
    </Card>
  );
}
