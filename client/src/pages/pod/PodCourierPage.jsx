// POD courier to head office — replaces Operation/POD_Dispatch_To_Head_Office.aspx.
// Tick the POD dispatches (IOMs) of this branch and send them by hand or by courier under one document.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Alert, App, Button, Card, Col, Empty, Form, Input, Radio, Row, Select, Space, Table, Typography } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import MasterSelect from '../../components/masters/MasterSelect.jsx';

const DATE_FMT = 'DD/MM/YYYY';

export default function PodCourierPage() {
  const { user } = useAuth();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);
  const mode = Form.useWatch('mode', form) ?? 'COURIER';

  const { data: opts } = useQuery({ queryKey: ['pod-courier-options'], queryFn: () => api.get('/pod-courier/options').then((r) => r.data) });
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['pod-courier-pending', user.currentBranch.code],
    queryFn: () => api.get('/pod-courier/pending').then((r) => r.data),
  });

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    if (!selected.length) { message.warning('Select the IOMs to send'); return; }
    setSaving(true);
    try {
      const { data: res } = await api.post('/pod-courier', {
        docDate: dayjs().format('YYYY-MM-DD'),
        mode: v.mode,
        personName: v.personName || '',
        courierCode: v.mode === 'COURIER' ? v.courierCode : '',
        awbNo: v.mode === 'COURIER' ? v.awbNo : '',
        ioms: selected,
      });
      modal.success({ title: 'POD courier saved', content: <>Document no. <strong>{res.docNo}</strong> — {res.ioms} IOM(s)</> });
      setSelected([]);
      form.resetFields(['personName', 'awbNo']);
      queryClient.invalidateQueries({ queryKey: ['pod-courier-pending'] });
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-card">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>POD Courier to Head Office</Typography.Title>
        <Typography.Text type="secondary">From: {user.currentBranch.name} : {user.currentBranch.code} · date {dayjs().format(DATE_FMT)} · document no. generated on save</Typography.Text>
      </Space>
      {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}

      <Card size="small" title="POD dispatches waiting to be sent" style={{ marginBottom: 12 }}>
        {data.length || isFetching ? (
          <Table
            size="small"
            rowKey="iomNo"
            loading={isFetching}
            dataSource={data}
            pagination={false}
            scroll={{ x: 'max-content' }}
            rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
            columns={[
              { title: 'IOM no.', dataIndex: 'iomNo' },
              { title: 'Date', dataIndex: 'iomDate', render: (v) => dayjs(v).format(DATE_FMT) },
              { title: 'Addressed to', dataIndex: 'sentTo' },
              { title: 'Dockets', dataIndex: 'dockets', render: (d) => d.join(', ') },
            ]}
          />
        ) : <Empty description="No POD dispatches waiting at this branch" />}
      </Card>

      <Card size="small" title="Send by">
        <Form form={form} layout="vertical" initialValues={{ mode: 'COURIER' }}>
          <Row gutter={12}>
            <Col xs={24} md={6}>
              <Form.Item name="mode" label="Dispatch through">
                <Radio.Group optionType="button" options={[{ value: 'COURIER', label: 'Courier' }, { value: 'SELF', label: 'Self (by hand)' }]} />
              </Form.Item>
            </Col>
            {mode === 'COURIER' ? (
              <>
                <Col xs={12} md={6}>
                  <Form.Item name="courierCode" label="Courier" rules={[{ required: true, message: 'Select the courier' }]}>
                    <MasterSelect master="courier" options={opts?.couriers ?? []} placeholder="Select" />
                  </Form.Item>
                </Col>
                <Col xs={12} md={6}>
                  <Form.Item name="awbNo" label="Airway bill no." rules={[{ required: true, message: 'Enter the airway bill no.' }]}>
                    <Input maxLength={50} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={6}><Form.Item name="personName" label="Contact person"><Input maxLength={100} /></Form.Item></Col>
              </>
            ) : (
              <Col xs={24} md={8}>
                <Form.Item name="personName" label="Carried by" rules={[{ required: true, message: 'Name of the person carrying the PODs' }]}>
                  <Input maxLength={100} />
                </Form.Item>
              </Col>
            )}
          </Row>
          <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
            <Typography.Text>Selected <strong>{selected.length}</strong> IOM(s)</Typography.Text>
            <Button type="primary" icon={<SendOutlined />} loading={saving} disabled={!selected.length} onClick={save}>Save & send</Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
