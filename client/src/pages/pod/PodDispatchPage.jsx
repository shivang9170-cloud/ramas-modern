// POD dispatch — replaces Operation/Pod_Dispatch.aspx.
// Add delivered dockets one by one with their signed POD (JPEG or PDF, up to 2 MB each),
// then save them under one IOM no. sent to a branch.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import {
  Alert, App, Button, Card, Checkbox, Col, DatePicker, Empty, Form, Input, Row, Select, Space, Table, Tag, Typography, Upload,
} from 'antd';
import { DeleteOutlined, PaperClipOutlined, PlusOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { api, errorMessage } from '../../api/client.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const DATE_FMT = 'DD/MM/YYYY';
const fmt = (v) => (v ? dayjs(v).format(DATE_FMT) : '');
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 5;

const toBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

export default function PodDispatchPage() {
  const { user } = useAuth();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [add] = Form.useForm();
  const [files, setFiles] = useState([]);
  const [rows, setRows] = useState([]);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const withoutImage = Form.useWatch('withoutImage', add);

  const { data: opts, error } = useQuery({ queryKey: ['pod-options'], queryFn: () => api.get('/pod/options').then((r) => r.data) });

  async function addDocket() {
    let v;
    try { v = await add.validateFields(); } catch { return; }
    const docketNo = v.docketNo.trim().toUpperCase();
    if (rows.some((r) => r.docketNo === docketNo)) { message.warning('Docket no. already in the POD dispatch list'); return; }
    if (!v.withoutImage && !files.length) { message.warning('Attach the POD image or tick "without image"'); return; }
    setChecking(true);
    try {
      const { data } = await api.get(`/pod/check/${encodeURIComponent(docketNo)}`);
      const images = v.withoutImage ? [] : await Promise.all(files.map(async (f) => ({ name: f.name, data: await toBase64(f) })));
      setRows((rs) => [...rs, { ...data, remarks: v.remarks || '', withoutImage: Boolean(v.withoutImage), images, fileNames: files.map((f) => f.name) }]);
      add.resetFields();
      setFiles([]);
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setChecking(false);
    }
  }

  async function save() {
    let v;
    try { v = await form.validateFields(); } catch { return; }
    if (!rows.length) { message.warning('Add at least one docket'); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/pod', {
        iomDate: v.iomDate.format('YYYY-MM-DD'),
        sentTo: v.sentTo,
        dockets: rows.map((r) => ({ docketNo: r.docketNo, remarks: r.remarks, withoutImage: r.withoutImage, images: r.images })),
      });
      modal.success({ title: 'POD dispatch saved', content: <>IOM no. <strong>{data.iomNo}</strong> — {data.dockets} docket(s), {data.images} file(s)</> });
      setRows([]);
    } catch (e) {
      const details = e.response?.data?.details;
      message.error(details?.length ? `${e.response.data.error}: ${details.map((d) => d.message).join('; ')}` : errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  const columns = [
    { title: 'Docket no.', dataIndex: 'docketNo' },
    { title: 'Booked', dataIndex: 'bookingDate', render: fmt },
    { title: 'Delivered', dataIndex: 'deliveredOn', render: fmt },
    { title: 'Consignee', dataIndex: 'consignee', ellipsis: true },
    { title: 'Pkts', dataIndex: 'packages', align: 'right' },
    { title: 'Weight', dataIndex: 'weight', align: 'right' },
    { title: 'Remarks', dataIndex: 'remarks', render: (v) => v || '—' },
    {
      title: 'POD', key: 'files',
      render: (_, r) => (r.withoutImage ? <Tag>Without image</Tag>
        : r.fileNames.map((n) => <Tag key={n} icon={<PaperClipOutlined />}>{n}</Tag>)),
    },
    {
      title: '', key: 'x', width: 60,
      render: (_, r) => <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`Remove ${r.docketNo}`}
        onClick={() => setRows((rs) => rs.filter((x) => x.docketNo !== r.docketNo))} />,
    },
  ];

  // PODs normally go back to head office.
  const headOffice = opts?.branches?.find((b) => b.value === 'B1001')?.value;
  useEffect(() => { if (headOffice && !form.getFieldValue('sentTo')) form.setFieldValue('sentTo', headOffice); }, [headOffice, form]);

  return (
    <div className="page-card">
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }} wrap>
        <Typography.Title level={3} style={{ margin: 0 }}>POD Dispatch</Typography.Title>
        <Typography.Text type="secondary">From: {user.currentBranch.name} : {user.currentBranch.code} · IOM no. is generated on save</Typography.Text>
      </Space>
      {error && <Alert type="error" showIcon message={errorMessage(error)} style={{ marginBottom: 12 }} />}

      <Card size="small" title="Add docket" style={{ marginBottom: 12 }}>
        <Form form={add} layout="vertical" initialValues={{ withoutImage: false }}>
          <Row gutter={12} align="bottom">
            <Col xs={12} md={5}>
              <Form.Item label="Docket no." name="docketNo" rules={[{ required: true, message: 'Enter docket no.' }]}>
                <Input maxLength={30} onPressEnter={addDocket} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}><Form.Item label="Remarks" name="remarks"><Input maxLength={500} /></Form.Item></Col>
            <Col xs={24} md={7}>
              <Form.Item label={`POD image / PDF (max ${MAX_FILES}, 2 MB each)`}>
                <Upload
                  multiple
                  accept=".jpg,.jpeg,.pdf,image/jpeg,application/pdf"
                  fileList={files.map((f) => ({ uid: f.uid, name: f.name, status: 'done' }))}
                  disabled={withoutImage}
                  beforeUpload={(f) => {
                    const okType = /\.(jpe?g|pdf)$/i.test(f.name);
                    if (!okType) { message.error(`${f.name}: only JPEG images and PDF files`); return Upload.LIST_IGNORE; }
                    if (f.size > MAX_BYTES) { message.error(`${f.name} is larger than 2 MB`); return Upload.LIST_IGNORE; }
                    setFiles((fs) => (fs.length >= MAX_FILES ? fs : [...fs, f]));
                    return false; // keep in the browser; sent with the dispatch
                  }}
                  onRemove={(f) => setFiles((fs) => fs.filter((x) => x.uid !== f.uid))}
                >
                  <Button icon={<UploadOutlined />} disabled={withoutImage}>Choose files</Button>
                </Upload>
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item name="withoutImage" valuePropName="checked">
                <Checkbox onChange={(e) => { if (e.target.checked) setFiles([]); }}>Without image</Checkbox>
              </Form.Item>
            </Col>
            <Col xs={12} md={3}>
              <Form.Item><Button type="primary" icon={<PlusOutlined />} loading={checking} onClick={addDocket} block>Add</Button></Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card size="small" title={`Dockets in this IOM (${rows.length})`}>
        {rows.length ? (
          <Table size="small" rowKey="docketNo" columns={columns} dataSource={rows} pagination={false} scroll={{ x: 'max-content' }} />
        ) : <Empty description="Add delivered dockets with their POD" />}
        <Form form={form} layout="vertical" style={{ marginTop: 16 }} initialValues={{ iomDate: dayjs() }}>
          <Row gutter={12} align="bottom">
            <Col xs={12} md={4}>
              <Form.Item label="IOM date" name="iomDate" rules={[{ required: true }]}>
                <DatePicker format={DATE_FMT} style={{ width: '100%' }} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
              </Form.Item>
            </Col>
            <Col xs={12} md={8}>
              <Form.Item label="Send to" name="sentTo" rules={[{ required: true, message: 'Select branch' }]}>
                <Select showSearch optionFilterProp="label" options={opts?.branches ?? []} placeholder="Branch" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12} style={{ textAlign: 'right' }}>
              <Form.Item>
                <Button type="primary" size="large" icon={<SaveOutlined />} loading={saving} disabled={!rows.length} onClick={save}>Save POD dispatch</Button>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>
    </div>
  );
}
