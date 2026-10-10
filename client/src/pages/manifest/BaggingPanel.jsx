// Bagging on the manifest screen (courier divisions only — TMS manifests whole dockets). Grouping by hand:
//   tick dockets  → "Make bag"         (e.g. 4 dockets → Bag B1, then 2 dockets → Bag B2)
//   tick bags     → "Make master bag"  (B1 + B2 → Master bag M1)
//   packets (optional, below bags): tick dockets → "Make packet"; tick packets → "Make bag"
// Scanning a docket ticks it. F2 / F3 / F4 = make packet / bag / master bag from what is ticked. "Unpack" puts the
// contents back. Dockets left outside every bag go on the manifest loose. "Auto bag" is an optional one-click helper.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Col, Empty, Input, Row, Segmented, Space, Tag, Typography } from 'antd';
import { ClearOutlined, InboxOutlined, ScanOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  LEVEL_LABEL, autoBag, breakContainer, looseContainers, looseDockets, makeContainer, removeDocket, totals,
} from './bagging.js';

const COLOR = { MASTER: 'purple', BAG: 'blue', PACKET: 'green' };
const fmtT = (t) => `${t.dockets} docket${t.dockets === 1 ? '' : 's'} · ${t.packages} pkts · ${t.weight.toFixed(2)} kg`;

function ContainerCard({ node, nodes, rowsByNo, ticked, onTick, onSeal, onUnpack, onRemoveDocket }) {
  const t = totals(nodes, node.key, rowsByNo);
  const kids = nodes.filter((c) => c.parent === node.key);
  return (
    <div className={`bag-card${ticked ? ' bag-card-ticked' : ''}`}>
      <Space size={6} wrap style={{ width: '100%' }}>
        {onTick && <Checkbox checked={ticked} onChange={(e) => onTick(e.target.checked)} aria-label={`Tick ${node.key}`} />}
        <Tag color={COLOR[node.level]} style={{ marginInlineEnd: 0, fontWeight: 700 }}>{LEVEL_LABEL[node.level]} {node.key}</Tag>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{fmtT(t)}</Typography.Text>
        <Button size="small" type="link" onClick={() => onUnpack(node.key)} style={{ padding: 0 }}>Unpack</Button>
      </Space>
      {node.level !== 'PACKET' && (
        <Input size="small" placeholder="Seal no." value={node.sealNo} maxLength={30} style={{ width: 140, marginTop: 4 }}
          onChange={(e) => onSeal(node.key, e.target.value)} aria-label={`Seal no. of ${node.key}`} />
      )}
      {kids.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {kids.map((k) => <Tag key={k.key} color={COLOR[k.level]}>{k.key} ({totals(nodes, k.key, rowsByNo).dockets})</Tag>)}
        </div>
      )}
      {node.dockets?.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {node.dockets.map((d) => (
            <Tag key={d} closable onClose={(e) => { e.preventDefault(); onRemoveDocket(d); }} style={{ marginBottom: 2 }}>{d}</Tag>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * state: { on, levels, limits, nodes } + setState(patch); rows = docket rows on screen; selected / onSelect = the
 * manifest's ticked dockets (a docket put in a bag is put on the manifest too).
 */
export default function BaggingPanel({ state, setState, rows, selected, onSelect, message }) {
  const { on, levels, limits, nodes } = state;
  const [pick, setPick] = useState({ dockets: [], containers: [] });   // ticked in the panel
  const [scanText, setScanText] = useState('');
  const scanRef = useRef(null);
  const rowsByNo = useMemo(() => new Map(rows.map((r) => [r.docketNo, r])), [rows]);
  const all = useMemo(() => rows.map((r) => r.docketNo), [rows]);
  const loose = looseDockets(nodes, all);
  const packets = looseContainers(nodes, 'PACKET');
  const bags = looseContainers(nodes, 'BAG');
  const masters = looseContainers(nodes, 'MASTER');

  // ticks that no longer apply (docket bagged, container packed) drop off
  useEffect(() => {
    setPick((p) => ({
      dockets: p.dockets.filter((d) => loose.includes(d)),
      containers: p.containers.filter((k) => nodes.some((n) => n.key === k && !n.parent)),
    }));
  }, [nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const tickDocket = (d, v) => setPick((p) => ({ ...p, dockets: v ? [...new Set([...p.dockets, d])] : p.dockets.filter((x) => x !== d) }));
  const tickContainer = (k, v) => setPick((p) => ({ ...p, containers: v ? [...new Set([...p.containers, k])] : p.containers.filter((x) => x !== k) }));
  const pickedOf = (level) => pick.containers.filter((k) => nodes.find((n) => n.key === k)?.level === level);

  function make(level) {
    const children = level === 'PACKET' ? [] : level === 'BAG' ? pickedOf('PACKET') : [...pickedOf('PACKET'), ...pickedOf('BAG')];
    const made = makeContainer(nodes, level, { dockets: pick.dockets, children });
    if (!made.key) {
      message.warning(level === 'MASTER' ? 'Tick the bags (or dockets) to put in the master bag' : `Tick the dockets${level === 'BAG' && levels.PACKET ? ' or packets' : ''} to put in the ${LEVEL_LABEL[level].toLowerCase()}`);
      return;
    }
    const inside = new Set([...selected, ...pick.dockets]);
    onSelect([...inside]);   // bagged dockets go on the manifest
    setState({ nodes: made.nodes });
    setPick({ dockets: [], containers: [] });
    message.success(`${LEVEL_LABEL[level]} ${made.key} made`);
    scanRef.current?.focus();
  }

  function scan(raw) {
    const no = String(raw ?? '').trim().toUpperCase();
    if (!no) return;
    if (!rowsByNo.has(no)) { message.warning(`${no} is not in the list (search first, or it is already manifested)`); return; }
    if (!loose.includes(no)) { message.info(`${no} is already in a bag`); return; }
    tickDocket(no, true);
  }

  // F2 / F3 / F4 = make packet / bag / master bag
  useEffect(() => {
    if (!on) return undefined;
    const keys = { F2: 'PACKET', F3: 'BAG', F4: 'MASTER' };
    const onKey = (e) => {
      const level = keys[e.key];
      if (!level || (level === 'PACKET' && !levels.PACKET)) return;
      e.preventDefault();
      make(level);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const cardProps = {
    nodes, rowsByNo,
    onSeal: (key, sealNo) => setState({ nodes: nodes.map((x) => (x.key === key ? { ...x, sealNo } : x)) }),
    onUnpack: (key) => setState({ nodes: breakContainer(nodes, key) }),
    onRemoveDocket: (d) => setState({ nodes: removeDocket(nodes, d) }),
  };
  const looseSelected = loose.filter((d) => selected.includes(d));
  const allLooseTicked = loose.length > 0 && loose.every((d) => pick.dockets.includes(d));

  return (
    <div className="bagging-panel">
      <Space wrap align="center" style={{ marginBottom: 8 }}>
        <InboxOutlined />
        <Segmented size="small" value={on ? 'BAGS' : 'NONE'} onChange={(v) => setState({ on: v === 'BAGS' })}
          options={[{ value: 'BAGS', label: 'With bags' }, { value: 'NONE', label: 'Without bags (whole dockets)' }]} />
        {on && (
          <Checkbox checked={levels.PACKET} disabled={nodes.some((n) => n.level === 'PACKET')}
            onChange={(e) => setState({ levels: { ...levels, PACKET: e.target.checked } })}>Use packets (inside bags)</Checkbox>
        )}
      </Space>

      {on && (
        <>
          {/* what is ticked → which container to make */}
          <Space wrap className="bag-actions">
            <Input ref={scanRef} prefix={<ScanOutlined />} placeholder="Scan / type docket no. + Enter (ticks it)" style={{ width: 280 }}
              value={scanText} onChange={(e) => setScanText(e.target.value)} onPressEnter={() => { scan(scanText); setScanText(''); }}
              aria-label="Scan docket" />
            <Typography.Text strong>
              Ticked: {pick.dockets.length} docket{pick.dockets.length === 1 ? '' : 's'}
              {levels.PACKET ? `, ${pickedOf('PACKET').length} packet(s)` : ''}, {pickedOf('BAG').length} bag(s)
            </Typography.Text>
            {levels.PACKET && <Button onClick={() => make('PACKET')}>Make packet (F2)</Button>}
            <Button type="primary" onClick={() => make('BAG')}>Make bag (F3)</Button>
            <Button type="primary" ghost onClick={() => make('MASTER')}>Make master bag (F4)</Button>
            <Button icon={<ThunderboltOutlined />} disabled={!looseSelected.length}
              title="Puts the ticked-for-manifest loose dockets into bags (and master bags) by the Division Master limits"
              onClick={() => setState({ nodes: autoBag(nodes, looseSelected, levels, limits) })}>Auto bag</Button>
            <Button icon={<ClearOutlined />} disabled={!nodes.length} onClick={() => setState({ nodes: [] })}>Unpack all</Button>
          </Space>

          <Row gutter={8} className="bag-columns">
            <Col xs={24} md={levels.PACKET ? 6 : 8}>
              <div className="bag-col">
                <div className="bag-col-head">
                  <Checkbox checked={allLooseTicked} indeterminate={!allLooseTicked && pick.dockets.length > 0} disabled={!loose.length}
                    onChange={(e) => setPick((p) => ({ ...p, dockets: e.target.checked ? [...loose] : [] }))}>
                    Loose dockets ({loose.length})
                  </Checkbox>
                </div>
                {loose.length ? loose.map((d) => {
                  const r = rowsByNo.get(d);
                  return (
                    <div key={d} className={`bag-row${pick.dockets.includes(d) ? ' bag-card-ticked' : ''}`}>
                      <Checkbox checked={pick.dockets.includes(d)} onChange={(e) => tickDocket(d, e.target.checked)}>
                        <strong>{d}</strong> <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r?.packages} pkts · {Number(r?.weight ?? 0).toFixed(1)} kg</Typography.Text>
                      </Checkbox>
                    </div>
                  );
                }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="All dockets are in bags" />}
              </div>
            </Col>
            {levels.PACKET && (
              <Col xs={24} md={6}>
                <div className="bag-col">
                  <div className="bag-col-head">Packets not in a bag ({packets.length})</div>
                  {packets.map((n) => (
                    <ContainerCard key={n.key} node={n} {...cardProps} ticked={pick.containers.includes(n.key)} onTick={(v) => tickContainer(n.key, v)} />
                  ))}
                </div>
              </Col>
            )}
            <Col xs={24} md={levels.PACKET ? 6 : 8}>
              <div className="bag-col">
                <div className="bag-col-head">Bags not in a master bag ({bags.length})</div>
                {bags.map((n) => (
                  <ContainerCard key={n.key} node={n} {...cardProps} ticked={pick.containers.includes(n.key)} onTick={(v) => tickContainer(n.key, v)} />
                ))}
              </div>
            </Col>
            <Col xs={24} md={levels.PACKET ? 6 : 8}>
              <div className="bag-col">
                <div className="bag-col-head">Master bags ({masters.length})</div>
                {masters.map((n) => <ContainerCard key={n.key} node={n} {...cardProps} />)}
              </div>
            </Col>
          </Row>
          {looseSelected.length > 0 && nodes.length > 0 && (
            <Alert type="info" showIcon style={{ marginTop: 8 }}
              message={`${looseSelected.length} docket(s) ticked for the manifest are not in a bag — they go loose (or put them in a bag first).`} />
          )}
        </>
      )}
    </div>
  );
}
