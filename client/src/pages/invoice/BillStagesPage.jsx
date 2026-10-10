// Bill submission and finalize — replaces Invoice/Client_Bill_Summation.aspx (stage="submit") and Bill_Finalized.aspx,
// Bill_Finalized_Cancel.aspx, Client_billFinalise_view.aspx (stage="finalize").
//   submit:   bills of clients submitted at this branch → handed over (date, receiver); undo while not finalized.
//   finalize: submitted bills of this billing (or collection) branch → finalized, voucher Dr client BILLED / Cr UNBILLED;
//             Paid / To Pay bills (PaidAndTopayBill_Finalized) without a submission → Dr pending collection / Cr recovery;
//             cancel finalize while nothing is received.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { App, Button, Card, Col, DatePicker, Form, Input, Radio, Row, Space, Table, Tabs, Typography } from 'antd';
import { CheckOutlined, PrinterOutlined, RollbackOutlined, SendOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { openBillPrint } from './ClientBillPage.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');
const money = (v) => Number(v || 0).toFixed(2);
const problem = (e) => {
  const details = e.response?.data?.details;
  return details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e);
};

const baseColumns = [
  { title: 'Bill no.', dataIndex: 'billNo' },
  { title: 'Bill date', dataIndex: 'billDate', render: fmt },
  { title: 'Due', dataIndex: 'dueDate', render: fmt },
  { title: 'Client / party', dataIndex: 'clientName' },
  { title: 'Type', dataIndex: 'billType' },
  { title: 'Dockets', dataIndex: 'dockets', align: 'right' },
  { title: 'Amount', dataIndex: 'totalAmount', align: 'right', render: money },
];
const printColumn = { title: '', key: 'print', width: 48, render: (_, r) => <Button size="small" icon={<PrinterOutlined />} aria-label={`Print ${r.billNo}`} onClick={() => openBillPrint(r.billNo)} /> };

function Pending({ stage }) {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [search, setSearch] = useState('');
  const [by, setBy] = useState('billing');
  const [selected, setSelected] = useState([]);
  const path = stage === 'submit' ? 'submission' : 'finalize';
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['bill-stage', path, 'pending', by, search],
    queryFn: () => api.get(`/client-bills/${path}`, { params: { stage: 'pending', search, ...(stage === 'finalize' ? { by } : {}) } }).then((r) => r.data),
  });
  const total = data.filter((b) => selected.includes(b.billNo)).reduce((t, b) => t + b.totalAmount, 0);
  const save = useMutation({
    mutationFn: (v) => api.post(`/client-bills/${path}`, {
      bills: selected, date: v.date.format('YYYY-MM-DD'),
      ...(stage === 'submit' ? { receiverName: v.receiverName, receiverPhone: v.receiverPhone || '', remarks: v.remarks || '' } : { by }),
    }),
    onSuccess: (r) => { message.success(r.data.message); setSelected([]); queryClient.invalidateQueries({ queryKey: ['bill-stage'] }); queryClient.invalidateQueries({ queryKey: ['client-bills'] }); },
    onError: (e) => message.error(problem(e)),
  });

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        {stage === 'finalize' && (
          <Radio.Group optionType="button" value={by} onChange={(e) => { setBy(e.target.value); setSelected([]); }}
            options={[{ value: 'billing', label: 'Billing branch wise' }, { value: 'collection', label: 'Collection branch wise' }, { value: 'paidtopay', label: 'Paid / To Pay bills' }]} />
        )}
        <Input.Search placeholder="Bill no. / client" allowClear style={{ width: 240 }} onSearch={(v) => setSearch(v.trim())} aria-label="Search bills" />
      </Space>
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      <Table size="small" rowKey="billNo" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }}
        pagination={{ defaultPageSize: 50, showSizeChanger: true }}
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
        columns={[...baseColumns, ...(stage === 'finalize' ? [{ title: 'Submitted', dataIndex: 'submittedOn', render: fmt }, { title: 'Receiver', dataIndex: 'receiverName' }] : []), printColumn]}
        locale={{ emptyText: stage === 'submit' ? 'No bill waiting for submission at this branch' : 'No submitted bill waiting to be finalized' }} />
      <Form form={form} layout="vertical" style={{ marginTop: 12 }} initialValues={{ date: dayjs() }} onFinish={(v) => save.mutate(v)}>
        <Row gutter={12} align="bottom">
          <Col xs={12} md={4}>
            <Form.Item label={stage === 'submit' ? 'Submission date' : 'Finalize date'} name="date" rules={[{ required: true }]}>
              <DatePicker format={DATE_FMT} style={{ width: '100%' }} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
            </Form.Item>
          </Col>
          {stage === 'submit' && (
            <>
              <Col xs={12} md={5}><Form.Item label="Receiver name" name="receiverName" rules={[{ required: true, whitespace: true, message: 'Enter the receiver name' }]}><Input maxLength={100} /></Form.Item></Col>
              <Col xs={12} md={4}><Form.Item label="Receiver phone" name="receiverPhone"><Input maxLength={30} /></Form.Item></Col>
              <Col xs={24} md={6}><Form.Item label="Remarks" name="remarks"><Input maxLength={500} /></Form.Item></Col>
            </>
          )}
          <Col xs={24} md={5}>
            <Form.Item>
              <Button type="primary" htmlType="submit" icon={stage === 'submit' ? <SendOutlined /> : <CheckOutlined />} loading={save.isPending} disabled={!selected.length} block>
                {stage === 'submit' ? 'Submit' : 'Finalize'} {selected.length || ''} bill(s){selected.length ? ` · ₹ ${money(total)}` : ''}
              </Button>
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </>
  );
}

function Done({ stage }) {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const path = stage === 'submit' ? 'submission' : 'finalize';
  const { data = [], isFetching, error } = useQuery({
    queryKey: ['bill-stage', path, 'done', search],
    queryFn: () => api.get(`/client-bills/${path}`, { params: { stage: 'done', search } }).then((r) => r.data),
  });
  const undo = useMutation({
    mutationFn: (billNo) => api.post(`/client-bills/${encodeURIComponent(billNo)}/${stage === 'submit' ? 'unsubmit' : 'unfinalize'}`),
    onSuccess: (r) => { message.success(r.data.message); queryClient.invalidateQueries({ queryKey: ['bill-stage'] }); queryClient.invalidateQueries({ queryKey: ['client-bills'] }); },
    onError: (e) => message.error(errorMessage(e)),
  });
  const label = stage === 'submit' ? 'Cancel submission' : 'Cancel finalize';
  return (
    <>
      <Input.Search placeholder="Bill no. / client" allowClear style={{ width: 240, marginBottom: 12 }} onSearch={(v) => setSearch(v.trim())} aria-label="Search done bills" />
      {error && <Typography.Text type="danger">{errorMessage(error)}</Typography.Text>}
      <Table size="small" rowKey="billNo" loading={isFetching} dataSource={data} scroll={{ x: 'max-content' }} pagination={{ defaultPageSize: 50 }}
        columns={[
          ...baseColumns,
          { title: 'Submitted', dataIndex: 'submittedOn', render: fmt },
          { title: 'Receiver', dataIndex: 'receiverName' },
          ...(stage === 'finalize' ? [{ title: 'Finalized', dataIndex: 'finalizedOn', render: fmt }] : []),
          printColumn,
          {
            title: '', key: 'undo', render: (_, r) => (
              <Button size="small" danger icon={<RollbackOutlined />} disabled={r.paid} loading={undo.isPending && undo.variables === r.billNo}
                onClick={() => modal.confirm({
                  title: `${label} of ${r.billNo}?`,
                  content: stage === 'submit' ? 'The bill goes back to generated.' : 'The finalize voucher is cancelled and the bill goes back to submitted.',
                  okText: label, okButtonProps: { danger: true }, cancelText: 'Keep', onOk: () => undo.mutateAsync(r.billNo),
                })}>{label}</Button>
            ),
          },
        ]} />
    </>
  );
}

export default function BillStagesPage({ stage = 'submit' }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const base = stage === 'submit' ? '/invoice/bill-submission' : '/invoice/bill-finalize';
  const [tab, setTab] = useState('pending');
  return (
    <Card className="page-card" title={stage === 'submit' ? 'Bill Submission' : 'Bill Finalize'}
      extra={<Space>
        <Typography.Text type="secondary">{user.currentBranch.name} : {user.currentBranch.code}</Typography.Text>
        <Button onClick={() => navigate(stage === 'submit' ? '/invoice/bill-finalize' : '/invoice/bill-submission')}>
          {stage === 'submit' ? 'Go to finalize' : 'Go to submission'}
        </Button>
      </Space>}>
      <Tabs key={base} activeKey={tab} onChange={setTab} destroyOnHidden items={[
        { key: 'pending', label: stage === 'submit' ? 'To submit' : 'To finalize', children: <Pending stage={stage} /> },
        { key: 'done', label: stage === 'submit' ? 'Submitted' : 'Finalized', children: <Done stage={stage} /> },
      ]} />
    </Card>
  );
}
