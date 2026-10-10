// Project Flow: the documentation of the whole port, shown in the app. The data is /flow-data.json, built together
// with the Word file (flow.docx) by docs/tools/make-flow-doc.cjs from docs/flow-data.mjs, the page inventory, the
// routes files (API) and the tests — regenerate it after each module.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert, Button, Card, Col, Collapse, Descriptions, Empty, Input, Progress, Row, Select, Skeleton, Space, Statistic, Steps,
  Table, Tabs, Tag, Timeline, Typography,
} from 'antd';
import {
  ApiOutlined, AppstoreOutlined, BranchesOutlined, CheckCircleOutlined, ClockCircleOutlined, CodeOutlined, DatabaseOutlined,
  DownloadOutlined, ExperimentOutlined, FileSearchOutlined, FileTextOutlined, FileWordOutlined, NodeIndexOutlined,
  RocketOutlined, SyncOutlined, ToolOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';

const STATUS = {
  done: { label: 'Done', color: 'success', icon: <CheckCircleOutlined /> },
  progress: { label: 'In progress', color: 'processing', icon: <SyncOutlined spin /> },
  next: { label: 'Next', color: 'gold', icon: <ClockCircleOutlined /> },
  later: { label: 'Later', color: 'default', icon: <ClockCircleOutlined /> },
};
const PAGE_STATUS = { Built: 'success', 'In progress': 'processing', 'To do': 'default' };
const METHOD = { GET: 'green', POST: 'blue', PUT: 'orange', PATCH: 'purple', DELETE: 'red' };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const statusTag = (s) => <Tag color={STATUS[s]?.color} icon={STATUS[s]?.icon}>{STATUS[s]?.label ?? s}</Tag>;
const methodTag = (m) => <Tag color={METHOD[m]} style={{ minWidth: 58, textAlign: 'center' }}>{m}</Tag>;
const includes = (q, ...values) => !q || values.some((v) => String(v ?? '').toLowerCase().includes(q.toLowerCase()));

function ApiTable({ rows, showModule = false, pageSize = 10 }) {
  return (
    <Table
      size="small"
      rowKey={(e) => `${e.module}-${e.method}-${e.path}`}
      dataSource={rows}
      pagination={rows.length > pageSize ? { pageSize, showSizeChanger: true } : false}
      scroll={{ x: 'max-content' }}
      columns={[
        ...(showModule ? [{ title: 'Module', dataIndex: 'module', width: 110, render: (v) => <Tag>{v}</Tag> }] : []),
        { title: 'Method', dataIndex: 'method', width: 90, render: methodTag },
        { title: 'Address', dataIndex: 'path', render: (v) => <Typography.Text code>{v}</Typography.Text> },
        { title: 'Purpose', dataIndex: 'purpose', render: (v) => v || <Typography.Text type="secondary">—</Typography.Text> },
      ]}
    />
  );
}

// ---------------------------------------------------------------- tabs
function OverviewTab({ data }) {
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={14}>
        <Card size="small" title={<Space><AppstoreOutlined />Pages by module</Space>}>
          <Table
            size="small" rowKey="module" dataSource={data.modules} pagination={false}
            columns={[
              { title: '#', key: 'n', width: 44, render: (_, __, i) => i + 1 },
              { title: 'Module', dataIndex: 'title' },
              { title: 'Total', dataIndex: 'total', align: 'right', width: 70 },
              { title: 'Built', dataIndex: 'built', align: 'right', width: 70 },
              { title: 'To do', dataIndex: 'todo', align: 'right', width: 70 },
              { title: 'Progress', key: 'p', width: 170, render: (_, m) => <Progress percent={pct(m.built, m.total)} size="small" /> },
            ]}
          />
        </Card>
      </Col>
      <Col xs={24} xl={10}>
        <Card size="small" title={<Space><FileSearchOutlined />What every module&apos;s documentation contains</Space>}>
          <Table
            size="small" rowKey={(r) => r[0]} dataSource={data.standard} pagination={false}
            columns={[
              { title: '#', key: 'n', width: 44, render: (_, __, i) => i + 1 },
              { title: 'Section', dataIndex: 0, width: 150, render: (v) => <Typography.Text strong>{v}</Typography.Text> },
              { title: 'What it holds', dataIndex: 1 },
            ]}
          />
        </Card>
      </Col>
    </Row>
  );
}

function FlowTab({ data }) {
  const current = data.flow.findIndex((f) => f.status !== 'done');
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={8}>
        <Card size="small" title={<Space><NodeIndexOutlined />The journey of a consignment</Space>}>
          <Steps
            direction="vertical" size="small" current={current === -1 ? data.flow.length : current}
            items={data.flow.map((f) => ({
              title: f.step,
              description: f.pages,
              status: f.status === 'done' ? 'finish' : f.status === 'progress' ? 'process' : 'wait',
            }))}
          />
        </Card>
      </Col>
      <Col xs={24} lg={16}>
        <Card size="small" title={<Space><BranchesOutlined />How the modules connect</Space>}>
          <Table
            size="small" rowKey="step" dataSource={data.flow} pagination={false} scroll={{ x: 'max-content' }}
            columns={[
              { title: '#', key: 'n', width: 40, render: (_, __, i) => i + 1 },
              { title: 'Step', dataIndex: 'step', width: 150, render: (v) => <Typography.Text strong>{v}</Typography.Text> },
              { title: 'Pages', dataIndex: 'pages', width: 200 },
              { title: 'What happens', dataIndex: 'what', width: 300 },
              { title: 'Feeds', dataIndex: 'to', width: 160 },
              { title: 'Status', dataIndex: 'status', width: 120, render: statusTag },
            ]}
          />
        </Card>
      </Col>
    </Row>
  );
}

function BuiltTab({ data }) {
  const [q, setQ] = useState('');
  const shown = data.built.filter((m) => includes(q, m.name, m.legacy, m.pages, m.tables, m.connects));
  return (
    <>
      <Input.Search allowClear placeholder="Search built modules (name, page, table …)" onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 420, marginBottom: 12 }} />
      {shown.length ? (
        <Collapse
          accordion={false}
          items={shown.map((m) => ({
            key: m.name,
            label: (
              <Space wrap>
                <Typography.Text strong>{data.built.indexOf(m) + 1}. {m.name}</Typography.Text>
                {statusTag(m.status)}
                {m.endpoints.length > 0 && <Tag icon={<ApiOutlined />}>{m.endpoints.length} endpoints</Tag>}
              </Space>
            ),
            children: (
              <>
                <Descriptions size="small" bordered column={1} styles={{ label: { width: 170 } }} items={[
                  { key: 'l', label: 'Legacy pages', children: m.legacy },
                  { key: 'p', label: 'New pages', children: m.pages },
                  { key: 't', label: 'Database', children: m.tables },
                  { key: 'c', label: 'Connections', children: m.connects },
                  ...(m.rules ? [{ key: 'r', label: 'Rules', children: m.rules }] : []),
                ]} />
                {m.endpoints.length > 0 && (
                  <>
                    <Typography.Title level={5} style={{ marginTop: 16 }}>API endpoints</Typography.Title>
                    <ApiTable rows={m.endpoints} />
                  </>
                )}
              </>
            ),
          }))}
        />
      ) : <Empty description="No module matches" />}
    </>
  );
}

function TodoModule({ m, pages }) {
  const [area, setArea] = useState('');
  const rows = pages.filter((p) => !area || p.area === area);
  return (
    <>
      {m.summary && <Typography.Paragraph>{m.summary}</Typography.Paragraph>}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <Descriptions size="small" bordered column={1} styles={{ label: { width: 130 } }} items={[
            { key: 'f', label: 'Takes data from', children: m.from || '—' },
            { key: 't', label: 'Feeds', children: m.to || '—' },
          ]} />
          {m.plan.length > 0 && (
            <Card size="small" title="Plan" style={{ marginTop: 12 }}>
              <Steps direction="vertical" size="small" current={-1} items={m.plan.map((s) => ({ title: s }))} />
            </Card>
          )}
        </Col>
        <Col xs={24} xl={15}>
          <Space wrap style={{ marginBottom: 8 }}>
            <Typography.Text type="secondary">Areas:</Typography.Text>
            <Tag.CheckableTag checked={!area} onChange={() => setArea('')}>All ({pages.length})</Tag.CheckableTag>
            {m.areas.map((a) => (
              <Tag.CheckableTag key={a.name} checked={area === a.name} onChange={() => setArea(area === a.name ? '' : a.name)}>{a.name} ({a.count})</Tag.CheckableTag>
            ))}
          </Space>
          <Table
            size="small" rowKey="no" dataSource={rows} pagination={rows.length > 12 ? { pageSize: 12 } : false} scroll={{ x: 'max-content' }}
            columns={[
              { title: '#', key: 'n', width: 50, render: (_, __, i) => i + 1 },
              { title: 'Page', dataIndex: 'page', render: (v) => v.replace(/^[^/]+\//, '') },
              { title: 'Area', dataIndex: 'area', render: (v) => <Tag>{v}</Tag> },
              { title: 'Type', dataIndex: 'kind', width: 110 },
              { title: 'KB', dataIndex: 'kb', align: 'right', width: 60 },
              { title: 'Status', dataIndex: 'status', width: 110, render: (v) => <Tag color={PAGE_STATUS[v]}>{v}</Tag> },
            ]}
          />
        </Col>
      </Row>
    </>
  );
}

function TodoTab({ data }) {
  const todo = data.modules.filter((m) => m.todo);
  return (
    <Collapse
      defaultActiveKey={[todo[0]?.module]}
      items={todo.map((m, i) => ({
        key: m.module,
        label: (
          <Row align="middle" gutter={12} style={{ width: '100%' }}>
            <Col flex="auto"><Typography.Text strong>{i + 1}. {m.title}</Typography.Text> <Typography.Text type="secondary">— {m.todo} to do{m.built ? `, ${m.built} built` : ''}</Typography.Text></Col>
            <Col style={{ width: 170 }}><Progress percent={pct(m.built, m.total)} size="small" /></Col>
          </Row>
        ),
        children: <TodoModule m={m} pages={data.pages.filter((p) => p.module === m.module && p.status !== 'Built')} />,
      }))}
    />
  );
}

function PagesTab({ data }) {
  const [q, setQ] = useState('');
  const [module, setModule] = useState();
  const [status, setStatus] = useState();
  const rows = useMemo(() => data.pages.filter((p) => (!module || p.module === module) && (!status || p.status === status) && includes(q, p.page, p.area, p.newRoute)), [data, q, module, status]);
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search allowClear placeholder="Search page, area, address" onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} />
        <Select allowClear placeholder="Module" value={module} onChange={setModule} style={{ width: 200 }} options={data.modules.map((m) => ({ value: m.module, label: `${m.title} (${m.total})` }))} />
        <Select allowClear placeholder="Status" value={status} onChange={setStatus} style={{ width: 160 }} options={['Built', 'In progress', 'To do'].map((s) => ({ value: s, label: s }))} />
        <Typography.Text type="secondary">{rows.length} of {data.pages.length} pages</Typography.Text>
      </Space>
      <Table
        size="small" rowKey="no" dataSource={rows} pagination={{ pageSize: 25, showSizeChanger: true }} scroll={{ x: 'max-content' }}
        columns={[
          { title: '#', dataIndex: 'no', width: 60, sorter: (a, b) => a.no - b.no },
          { title: 'Module', dataIndex: 'module', width: 120, render: (v) => <Tag>{v}</Tag>, sorter: (a, b) => a.module.localeCompare(b.module) },
          { title: 'Legacy page', dataIndex: 'page', sorter: (a, b) => a.page.localeCompare(b.page) },
          { title: 'Area', dataIndex: 'area', width: 180 },
          { title: 'Type', dataIndex: 'kind', width: 110 },
          { title: 'KB', dataIndex: 'kb', align: 'right', width: 70, sorter: (a, b) => a.kb - b.kb },
          { title: 'Status', dataIndex: 'status', width: 120, render: (v) => <Tag color={PAGE_STATUS[v]}>{v}</Tag> },
          { title: 'New address', dataIndex: 'newRoute', render: (v) => (v ? <Typography.Text code>{v}</Typography.Text> : '—') },
        ]}
      />
    </>
  );
}

function ApiTab({ data }) {
  const [q, setQ] = useState('');
  const [module, setModule] = useState();
  const modules = [...new Set(data.endpoints.map((e) => e.module))];
  const rows = data.endpoints.filter((e) => (!module || e.module === module) && includes(q, e.path, e.purpose, e.method));
  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search allowClear placeholder="Search address or purpose" onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} />
        <Select allowClear placeholder="Module" value={module} onChange={setModule} style={{ width: 180 }} options={modules.map((m) => ({ value: m, label: m }))} />
        <Typography.Text type="secondary">{rows.length} of {data.endpoints.length} endpoints</Typography.Text>
      </Space>
      <ApiTable rows={rows} showModule pageSize={25} />
    </>
  );
}

function TechTab({ data }) {
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={14}>
        <Card size="small" title={<Space><CodeOutlined />Folders</Space>}>
          <Table size="small" rowKey={(r) => r[0]} dataSource={data.tech.folders} pagination={false}
            columns={[{ title: 'Folder', dataIndex: 0, render: (v) => <Typography.Text code>{v}</Typography.Text> }, { title: 'Contents', dataIndex: 1 }]} />
        </Card>
        <Card size="small" title={<Space><NodeIndexOutlined />How a page is wired</Space>} style={{ marginTop: 16 }}>
          <Steps direction="vertical" size="small" current={data.tech.inside.length} items={data.tech.inside.map((s) => ({ title: s }))} />
        </Card>
      </Col>
      <Col xs={24} lg={10}>
        <Card size="small" title={<Space><ToolOutlined />Running</Space>}>
          <Steps direction="vertical" size="small" current={-1} items={data.tech.run.map((s) => ({ title: s }))} />
        </Card>
        <Card size="small" title={<Space><DatabaseOutlined />Dev database scripts ({data.tech.sqlFiles.length})</Space>} style={{ marginTop: 16 }}>
          <Space size={[4, 6]} wrap>{data.tech.sqlFiles.map((f) => <Tag key={f}>{f}</Tag>)}</Space>
        </Card>
      </Col>
    </Row>
  );
}

function RoadmapTab({ data }) {
  const dot = { done: 'green', progress: 'blue', next: 'gold', later: 'gray' };
  return (
    <Card size="small">
      <Timeline items={data.roadmap.map((r, i) => ({
        color: dot[r.status],
        children: <Space wrap><Typography.Text strong>{i + 1}.</Typography.Text><span>{r.item}</span>{statusTag(r.status)}</Space>,
      }))} />
    </Card>
  );
}

// ---------------------------------------------------------------- page
export default function ProjectFlowPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['flow-data'],
    queryFn: async () => {
      const r = await fetch('/flow-data.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error('The documentation data (flow-data.json) is missing — run node docs/tools/make-flow-doc.cjs');
      return r.json();
    },
  });

  if (isLoading) return <Card className="page-card"><Skeleton active paragraph={{ rows: 8 }} /></Card>;
  if (error) return <Card className="page-card"><Alert type="error" showIcon message={error.message} /></Card>;
  const s = data.stats;

  return (
    <div className="page-card flow-page">
      <div className="flow-hero">
        <div className="flow-hero-text">
          <Typography.Title level={2} style={{ margin: 0, color: '#fff' }}>Ramas ERP — Project Flow</Typography.Title>
          <Typography.Paragraph style={{ color: 'rgba(255,255,255,0.85)', margin: '6px 0 14px' }}>
            The complete documentation of the migration: the business flow, every module that is built, every page still to do, the API and
            the technical setup. Updated {dayjs(data.generatedAt).format('DD MMM YYYY, HH:mm')}.
          </Typography.Paragraph>
          <Space wrap>
            <Button size="large" icon={<DownloadOutlined />} href="/flow.docx" download="Ramas-ERP-flow.docx">Download Word file</Button>
            <Tag icon={<FileWordOutlined />} className="flow-hero-tag">docs/flow.docx</Tag>
          </Space>
        </div>
        <Progress type="dashboard" percent={pct(s.built, s.pages)} size={130} strokeColor="#ffffff" trailColor="rgba(255,255,255,0.25)"
          format={(v) => <span style={{ color: '#fff' }}>{v}%<br /><span style={{ fontSize: 12 }}>built</span></span>} />
      </div>

      <Row gutter={[12, 12]} style={{ margin: '16px 0' }}>
        {[
          ['Pages built', s.built, <CheckCircleOutlined key="i" />, `of ${s.pages}`],
          ['Pages to do', s.todo, <ClockCircleOutlined key="i" />, ''],
          ['Modules', s.modules, <AppstoreOutlined key="i" />, 'built'],
          ['API endpoints', s.endpoints, <ApiOutlined key="i" />, ''],
          ['Tests', s.tests, <ExperimentOutlined key="i" />, 'passing'],
          ['Dev SQL scripts', s.sqlFiles, <DatabaseOutlined key="i" />, ''],
        ].map(([title, value, icon, suffix]) => (
          <Col key={title} xs={12} md={8} xl={4}>
            <Card size="small" className="flow-stat"><Statistic title={title} value={value} prefix={icon} suffix={<span style={{ fontSize: 13 }}>{suffix}</span>} /></Card>
          </Col>
        ))}
      </Row>

      <Card>
        <Tabs
          items={[
            { key: 'overview', label: <Space><AppstoreOutlined />Overview</Space>, children: <OverviewTab data={data} /> },
            { key: 'flow', label: <Space><NodeIndexOutlined />Business flow</Space>, children: <FlowTab data={data} /> },
            { key: 'built', label: <Space><CheckCircleOutlined />Built modules ({data.built.length})</Space>, children: <BuiltTab data={data} /> },
            { key: 'todo', label: <Space><RocketOutlined />To do ({s.todo})</Space>, children: <TodoTab data={data} /> },
            { key: 'pages', label: <Space><FileTextOutlined />All pages ({s.pages})</Space>, children: <PagesTab data={data} /> },
            { key: 'api', label: <Space><ApiOutlined />API ({s.endpoints})</Space>, children: <ApiTab data={data} /> },
            { key: 'tech', label: <Space><CodeOutlined />Technical</Space>, children: <TechTab data={data} /> },
            { key: 'roadmap', label: <Space><ClockCircleOutlined />Roadmap</Space>, children: <RoadmapTab data={data} /> },
          ]}
        />
      </Card>
    </div>
  );
}
