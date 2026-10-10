// POD receive at head office — replaces Operation/podreceive.aspx.
// Pick a courier document (or find it by a docket no.), tick the PODs that arrived and save.
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { Alert, App, Button, Card, Col, DatePicker, Empty, Input, Row, Space, Table, Tag, Typography } from 'antd';
import { CheckOutlined, SearchOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');

function fyStart(fy) {
  const y = Number(String(fy || '').split('-')[0]);
  return y ? dayjs(`${y}-04-01`) : dayjs().startOf('month');
}

export default function PodReceivePage() {
  const { user } = useAuth();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [docNo, setDocNo] = useState(null);
  const [selected, setSelected] = useState([]);
  const [receiveDate, setReceiveDate] = useState(dayjs());
  const [remark, setRemark] = useState('');
  const [docketSearch, setDocketSearch] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: opts } = useQuery({ queryKey: ['pod-courier-options'], queryFn: () => api.get('/pod-courier/options').then((r) => r.data) });
  const atHo = opts ? user.currentBranch.code === opts.headOffice : true;
  const params = { from: fyStart(user.financialYear).format('YYYY-MM-DD'), to: dayjs().format('YYYY-MM-DD') };
  const pending = useQuery({
    queryKey: ['pod-receive-pending', params, user.currentBranch.code],
    queryFn: () => api.get('/pod-receive/pending', { params }).then((r) => r.data),
    enabled: Boolean(opts) && atHo,
  });
  const doc = useQuery({
    queryKey: ['pod-receive-doc', docNo],
    queryFn: () => api.get(`/pod-receive/docs/${encodeURIComponent(docNo)}`).then((r) => r.data),
    enabled: Boolean(docNo) && atHo,
  });
  const open = useMemo(() => (doc.data?.dockets ?? []).filter((d) => !d.received), [doc.data]);
  useEffect(() => { setSelected(open.map((d) => d.docketNo)); }, [open]);

  async function findByDocket() {
    const no = docketSearch.trim().toUpperCase();
    if (!no) return;
    try {
      const { data } = await api.get(`/pod-receive/by-docket/${encodeURIComponent(no)}`);
      setDocNo(data.docNo);
    } catch (e) {
      message.error(errorMessage(e));
    }
  }

  async function save() {
    if (!selected.length) { message.warning('Select at least one docket no.'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/pod-receive', {
        docNo, receiveDate: receiveDate.format('YYYY-MM-DD'), remark: remark.trim(), dockets: selected,
      });
      modal.success({ title: 'POD received', content: data.message });
      setRemark('');
      queryClient.invalidateQueries({ queryKey: ['pod-receive-pending'] });
      queryClient.invalidateQueries({ queryKey: ['pod-receive-doc'] });
      if (!data.pending) setDocNo(null);
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (opts && !atHo) {
    return (
      <div className="page-card">
        <Typography.Title level={3}>POD Receive</Typography.Title>
        <Alert type="info" showIcon message="POD receive is done at head office"
          description="Switch the current branch (top bar) to the head office branch to receive PODs." />
      </div>
    );
  }

  return (
    <div className="page-card">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>POD Receive (Head Office)</Typography.Title>
        <Space>
          <Input placeholder="Find by docket no." value={docketSearch} onChange={(e) => setDocketSearch(e.target.value)} onPressEnter={findByDocket} style={{ width: 200 }} allowClear />
          <Button icon={<SearchOutlined />} onClick={findByDocket}>Find</Button>
        </Space>
      </Space>
      {(pending.error || doc.error) && <Alert type="error" showIcon message={errorMessage(pending.error || doc.error)} style={{ marginBottom: 12 }} />}
      <Row gutter={12}>
        <Col xs={24} lg={9}>
          <Card size="small" title="Courier documents to receive" style={{ marginBottom: 12 }}>
            <Table
              size="small"
              rowKey="docNo"
              loading={pending.isFetching}
              dataSource={pending.data ?? []}
              pagination={{ defaultPageSize: 10, hideOnSinglePage: true }}
              locale={{ emptyText: 'Nothing in transit to head office' }}
              rowClassName={(r) => (r.docNo === docNo ? 'ant-table-row-selected' : '')}
              onRow={(r) => ({ onClick: () => setDocNo(r.docNo), style: { cursor: 'pointer' } })}
              columns={[
                { title: 'Document', dataIndex: 'docNo' },
                { title: 'Date', dataIndex: 'docDate', render: fmt },
                { title: 'From', dataIndex: 'from' },
                { title: 'IOMs', dataIndex: 'ioms', align: 'right' },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={15}>
          <Card size="small" title={docNo ? `Document ${docNo}` : 'Dockets'}>
            {!docNo ? <Empty description="Pick a courier document or find one by docket no." /> : (
              <>
                <Table
                  size="small"
                  rowKey="docketNo"
                  loading={doc.isFetching}
                  dataSource={doc.data?.dockets ?? []}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                  rowSelection={{
                    selectedRowKeys: selected,
                    onChange: setSelected,
                    getCheckboxProps: (r) => ({ disabled: r.received }),
                  }}
                  columns={[
                    { title: 'Docket no.', dataIndex: 'docketNo' },
                    { title: 'IOM', dataIndex: 'iomNo' },
                    { title: 'IOM date', dataIndex: 'iomDate', render: fmt },
                    { title: 'Consignee', dataIndex: 'consignee', ellipsis: true },
                    { title: 'Pkts', dataIndex: 'packages', align: 'right' },
                    { title: 'Files', dataIndex: 'images', align: 'right' },
                    { title: '', dataIndex: 'received', render: (v) => (v ? <Tag color="green">Received</Tag> : null) },
                  ]}
                />
                <Space wrap style={{ marginTop: 12, width: '100%', justifyContent: 'space-between' }}>
                  <Space wrap>
                    <DatePicker format={DATE_FMT} value={receiveDate} allowClear={false} onChange={setReceiveDate}
                      disabledDate={(d) => d.isAfter(dayjs(), 'day')} aria-label="Receive date" />
                    <Input placeholder="Remark" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={500} style={{ width: 260 }} />
                  </Space>
                  <Button type="primary" icon={<CheckOutlined />} loading={saving} disabled={!selected.length} onClick={save}>
                    Receive {selected.length} POD(s)
                  </Button>
                </Space>
              </>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
