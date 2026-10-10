// Chart kit for the analytics dashboard, on Apache ECharts: animated, hover tooltips, legend click to hide / show a series,
// zoom + slider on long series, toolbox (switch bar / line / stacked, data view, save as image), follows the antd theme
// (light / dark) and animates to new numbers when the data refreshes (live mode). Every chart takes onSelect for click-through.
// Components: Bars, Lines, Combo, Donut, Heatmap, Funnel, Gauge, Scatter, Sparkline, Kpi, ChartCard.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Empty, Space, Tag, Tooltip, Typography, theme } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, InfoCircleOutlined } from '@ant-design/icons';
import * as echarts from 'echarts/core';
import { BarChart, FunnelChart, GaugeChart, HeatmapChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import {
  DataZoomComponent, GraphicComponent, GridComponent, LegendComponent, MarkLineComponent, ToolboxComponent, TooltipComponent, VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, PieChart, HeatmapChart, FunnelChart, GaugeChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent,
  DataZoomComponent, ToolboxComponent, VisualMapComponent, GraphicComponent, MarkLineComponent, CanvasRenderer]);

// Tooltips are HTML: every name that comes from data (client, city, ledger, …) is escaped so it can never run as markup.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const PALETTE = ['#1677ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16', '#2f54eb', '#a0d911', '#8c8c8c', '#5cdbd3'];

// ------------------------------------------------------------------ number formats
export const fmt = {
  num: (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }),
  dec: (v) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 }),
  pct: (v) => `${Number(v || 0).toFixed(1)}%`,
  inr: (v) => `₹ ${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
  short: (v) => {
    const a = Math.abs(Number(v || 0));
    if (a >= 1e7) return `${(v / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
    if (a >= 1e5) return `${(v / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
    if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
    return `${Math.round(v * 10) / 10}`;
  },
  inrShort: (v) => `₹${fmt.short(v)}`,
  kg: (v) => `${fmt.short(v)} kg`,
  days: (v) => `${Number(v || 0).toFixed(1)} d`,
};

// ------------------------------------------------------------------ base chart
const luminance = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return 1;
  const v = parseInt(m[1], 16);
  return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
};

function useLook() {
  const { token } = theme.useToken();
  return useMemo(() => ({
    dark: luminance(token.colorBgContainer) < 0.5, text: token.colorText, sub: token.colorTextSecondary, grid: token.colorBorderSecondary,
    bg: token.colorBgElevated, border: token.colorBorder, font: token.fontFamily,
  }), [token]);
}

/** Common look: palette, animation, tooltip box, legend, axes colours. */
function base(look, extra = {}) {
  return {
    color: PALETTE, backgroundColor: 'transparent', animationDuration: 800, animationDurationUpdate: 600, animationEasing: 'cubicOut',
    textStyle: { color: look.sub, fontFamily: look.font },
    tooltip: {
      confine: true, backgroundColor: look.bg, borderColor: look.border, textStyle: { color: look.text, fontSize: 12 },
      extraCssText: 'box-shadow: 0 6px 16px rgba(0,0,0,.18); border-radius: 6px;',
    },
    legend: { top: 0, left: 0, type: 'scroll', textStyle: { color: look.sub }, pageTextStyle: { color: look.sub }, itemWidth: 12, itemHeight: 8 },
    ...extra,
  };
}
const axis = (look, o = {}) => ({
  axisLine: { lineStyle: { color: look.grid } }, axisTick: { show: false }, axisLabel: { color: look.sub, fontSize: 11, hideOverlap: true },
  splitLine: { lineStyle: { color: look.grid, type: 'dashed' } }, ...o,
});
const toolbox = (look, types) => ({
  right: 0, top: -4, itemSize: 13, iconStyle: { borderColor: look.sub },
  feature: {
    ...(types ? { magicType: { type: types, title: { line: 'Line', bar: 'Bar', stack: 'Stack', tiled: 'Side by side' } } } : {}),
    dataView: { readOnly: true, title: 'Data', lang: ['Data', 'Close', 'Refresh'], backgroundColor: look.bg, textColor: look.text, textareaColor: look.bg, textareaBorderColor: look.border, buttonColor: PALETTE[0] },
    saveAsImage: { title: 'Save image', pixelRatio: 2, backgroundColor: look.dark ? '#141414' : '#fff' },
  },
});
const zoom = (on) => (on ? [
  { type: 'inside', xAxisIndex: 0, zoomOnMouseWheel: 'shift', moveOnMouseWheel: false },
  { type: 'slider', xAxisIndex: 0, height: 14, bottom: 2, brushSelect: false, showDetail: false },
] : []);

/** One ECharts instance: resizes with its box, animates to new options, forwards clicks. */
export function EChart({ option, height = 240, onClick, onAxisClick }) {
  const el = useRef(null);
  const chart = useRef(null);
  const handlers = useRef({});
  handlers.current = { onClick, onAxisClick };
  useEffect(() => {
    const c = echarts.init(el.current, null, { renderer: 'canvas' });
    chart.current = c;
    c.on('click', (p) => handlers.current.onClick?.(p));
    c.getZr().on('click', (e) => {
      if (!handlers.current.onAxisClick || e.target) return;
      const pt = [e.offsetX, e.offsetY];
      if (!c.containPixel('grid', pt)) return;
      const [idx] = c.convertFromPixel({ seriesIndex: 0 }, pt);
      if (Number.isFinite(idx)) handlers.current.onAxisClick(Math.round(idx));
    });
    // a resize can still be queued when the chart goes away (tab switch, live refresh): never touch a disposed chart
    const ro = new ResizeObserver(() => { if (!c.isDisposed()) c.resize(); });
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      if (chart.current === c) chart.current = null;
      if (!c.isDisposed()) c.dispose();
    };
  }, []);
  const live = () => (chart.current && !chart.current.isDisposed() ? chart.current : null);
  useEffect(() => {
    live()?.setOption(option, { replaceMerge: ['series', 'xAxis', 'yAxis', 'dataZoom', 'visualMap', 'graphic'] });
  }, [option]);
  useEffect(() => { live()?.resize(); }, [height]);
  return <div ref={el} style={{ width: '100%', height, cursor: onClick || onAxisClick ? 'pointer' : undefined }} />;
}

// ------------------------------------------------------------------ card
export function ChartCard({ no, title, help, extra, children, empty, height }) {
  return (
    <Card size="small" className="dash-card" style={{ height: '100%' }}
      title={<Space size={6}>{no && <Tag style={{ marginInlineEnd: 0 }}>#{no}</Tag>}<span>{title}</span>
        {help && <Tooltip title={help}><InfoCircleOutlined style={{ color: 'var(--ant-color-text-tertiary, #999)' }} /></Tooltip>}</Space>}
      extra={extra}>
      {empty ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No data in this period" style={{ minHeight: height ?? 160 }} /> : children}
    </Card>
  );
}

// ------------------------------------------------------------------ bars
/** series: [{ key, label, color }]; horizontal for top lists; colorBy(d, i) colours single bars. */
export function Bars({ data, x, series, stacked = false, horizontal = false, height = 240, format = fmt.short, labelWidth = 130, colorBy, onSelect }) {
  const look = useLook();
  const option = useMemo(() => {
    const cats = data.map((d) => String(d[x] ?? ''));
    const many = !horizontal && data.length > 16;
    const catAxis = axis(look, {
      type: 'category', data: cats, inverse: horizontal,
      axisLabel: { color: look.sub, fontSize: 11, hideOverlap: !horizontal, width: horizontal ? labelWidth - 10 : 90, overflow: 'truncate', interval: horizontal ? 0 : 'auto' },
      splitLine: { show: false },
    });
    const valAxis = axis(look, { type: 'value', axisLabel: { color: look.sub, fontSize: 11, formatter: format } });
    const total = (i) => series.reduce((t, s) => t + Number(data[i][s.key] || 0), 0);
    return base(look, {
      tooltip: { ...base(look).tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: format },
      legend: series.length > 1 ? base(look).legend : { show: false },
      toolbox: toolbox(look, horizontal ? null : series.length > 1 ? ['bar', 'line', 'stack'] : ['bar', 'line']),
      grid: { left: 4, right: horizontal ? 56 : 12, top: 28, bottom: many ? 24 : 4, containLabel: true },
      xAxis: horizontal ? valAxis : catAxis, yAxis: horizontal ? catAxis : valAxis,
      dataZoom: zoom(many),
      series: series.map((s, si) => ({
        type: 'bar', name: s.label, stack: stacked ? 'total' : undefined, barMaxWidth: horizontal ? 18 : 42,
        itemStyle: { color: s.color ?? PALETTE[si % PALETTE.length], borderRadius: stacked ? 0 : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0] },
        emphasis: { focus: 'series' },
        label: horizontal && (!stacked || si === series.length - 1)
          ? { show: true, position: 'right', color: look.sub, fontSize: 11, formatter: (p) => format(stacked ? total(p.dataIndex) : p.value) } : undefined,
        data: data.map((d, i) => ({ value: Number(d[s.key] || 0), itemStyle: colorBy ? { color: colorBy(d, i) } : undefined })),
      })),
    });
  }, [data, x, series, stacked, horizontal, format, labelWidth, colorBy, look]);
  const h = horizontal ? Math.max(120, data.length * 26 + 40) : height;
  return <EChart option={option} height={h} onClick={onSelect ? (p) => p.componentType === 'series' && onSelect(data[p.dataIndex], series[p.seriesIndex]) : undefined} />;
}

// ------------------------------------------------------------------ lines
export function Lines({ data, x, series, area = false, height = 240, format = fmt.short, xFormat = (v) => v, min0 = true, onSelect }) {
  const look = useLook();
  const option = useMemo(() => {
    const many = data.length > 20;
    return base(look, {
      tooltip: { ...base(look).tooltip, trigger: 'axis', valueFormatter: format },
      legend: series.length > 1 ? base(look).legend : { show: false },
      toolbox: toolbox(look, ['line', 'bar']),
      grid: { left: 4, right: 12, top: 28, bottom: many ? 24 : 4, containLabel: true },
      xAxis: axis(look, { type: 'category', boundaryGap: false, data: data.map((d) => xFormat(d[x])), splitLine: { show: false } }),
      yAxis: axis(look, { type: 'value', scale: !min0, axisLabel: { color: look.sub, fontSize: 11, formatter: format } }),
      dataZoom: zoom(many),
      series: series.map((s, si) => {
        const col = s.color ?? PALETTE[si % PALETTE.length];
        return {
          type: 'line', name: s.label, smooth: 0.3, showSymbol: data.length <= 40, symbolSize: 6, lineStyle: { width: 2, color: col, type: s.dashed ? 'dashed' : 'solid' },
          itemStyle: { color: col }, emphasis: { focus: 'series' },
          areaStyle: area ? { opacity: 1, color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: `${col}55` }, { offset: 1, color: `${col}05` }]) } : undefined,
          markLine: !min0 ? { silent: true, symbol: 'none', lineStyle: { color: look.sub, type: 'dashed' }, data: [{ yAxis: 0 }], label: { show: false } } : undefined,
          data: data.map((d) => Number(d[s.key] || 0)),
        };
      }),
    });
  }, [data, x, series, area, format, xFormat, min0, look]);
  return <EChart option={option} height={height} onClick={onSelect ? (p) => p.componentType === 'series' && onSelect(data[p.dataIndex]) : undefined}
    onAxisClick={onSelect ? (i) => data[i] && onSelect(data[i]) : undefined} />;
}

/** Bars on the left axis and one line on the right axis (e.g. freight + cumulative %, hire + margin %). */
export function Combo({ data, x, bars, line, height = 250, format = fmt.short, lineFormat = fmt.pct, lineMax, onSelect }) {
  const look = useLook();
  const lc = line.color ?? PALETTE[3];
  const option = useMemo(() => base(look, {
    tooltip: {
      ...base(look).tooltip, trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (ps) => `<b>${esc(ps[0]?.axisValueLabel ?? '')}</b><br/>${ps.map((p) => `${p.marker} ${esc(p.seriesName)}: <b>${p.seriesName === line.label ? lineFormat(p.value) : format(p.value)}</b>`).join('<br/>')}`,
    },
    toolbox: toolbox(look, null),
    grid: { left: 4, right: 4, top: 28, bottom: data.length > 16 ? 24 : 4, containLabel: true },
    xAxis: axis(look, { type: 'category', data: data.map((d) => String(d[x] ?? '')), axisLabel: { color: look.sub, fontSize: 11, hideOverlap: true, width: 90, overflow: 'truncate' }, splitLine: { show: false } }),
    yAxis: [
      axis(look, { type: 'value', axisLabel: { color: look.sub, fontSize: 11, formatter: format } }),
      axis(look, { type: 'value', max: lineMax, splitLine: { show: false }, axisLabel: { color: lc, fontSize: 11, formatter: lineFormat } }),
    ],
    dataZoom: zoom(data.length > 16),
    series: [
      ...bars.map((b, bi) => ({
        type: 'bar', name: b.label, barMaxWidth: 40, itemStyle: { color: b.color ?? PALETTE[bi], borderRadius: [3, 3, 0, 0] }, emphasis: { focus: 'series' },
        data: data.map((d) => Number(d[b.key] || 0)),
      })),
      { type: 'line', name: line.label, yAxisIndex: 1, smooth: 0.3, symbolSize: 7, lineStyle: { width: 2, color: lc }, itemStyle: { color: lc }, data: data.map((d) => Number(d[line.key] || 0)) },
    ],
  }), [data, x, bars, line, format, lineFormat, lineMax, lc, look]);
  const defs = [...bars, line];
  return <EChart option={option} height={height} onClick={onSelect ? (p) => p.componentType === 'series' && onSelect(data[p.dataIndex], defs[p.seriesIndex]) : undefined} />;
}

// ------------------------------------------------------------------ donut
export function Donut({ data, name = 'name', value, format = fmt.num, height = 230, centerLabel = 'Total', onSelect }) {
  const look = useLook();
  const total = data.reduce((t, d) => t + Number(d[value] || 0), 0);
  const option = useMemo(() => base(look, {
    tooltip: { ...base(look).tooltip, trigger: 'item', formatter: (p) => `${p.marker} ${esc(p.name)}<br/><b>${format(p.value)}</b> (${p.percent}%)` },
    legend: {
      ...base(look).legend, orient: 'vertical', top: 'middle', left: '54%', right: 0, icon: 'circle',
      formatter: (n) => { const v = Number(data.find((d) => String(d[name]) === n)?.[value] || 0); return `${n.length > 18 ? `${n.slice(0, 17)}…` : n}  ${total ? ((v / total) * 100).toFixed(1) : 0}%`; },
    },
    toolbox: toolbox(look, null),
    graphic: [
      { type: 'text', left: '26%', top: '45%', style: { text: fmt.short(total), fill: look.text, fontSize: 18, fontWeight: 600, align: 'center' } },
      { type: 'text', left: '26%', top: '56%', style: { text: centerLabel, fill: look.sub, fontSize: 11, align: 'center' } },
    ],
    series: [{
      type: 'pie', radius: ['48%', '72%'], center: ['27%', '52%'], avoidLabelOverlap: true, label: { show: false }, labelLine: { show: false },
      itemStyle: { borderColor: look.dark ? '#141414' : '#fff', borderWidth: 2, borderRadius: 4 },
      emphasis: { scale: true, scaleSize: 6, itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,.25)' } },
      data: data.map((d) => ({ name: String(d[name] ?? ''), value: Number(d[value] || 0) })),
    }],
  }), [data, name, value, format, centerLabel, total, look]);
  return <EChart option={option} height={height} onClick={onSelect ? (p) => p.componentType === 'series' && onSelect(data[p.dataIndex]) : undefined} />;
}

// ------------------------------------------------------------------ heatmap
/** rows / cols: label arrays; value(rowIndex, colIndex) → number. */
export function Heatmap({ rows, cols, value, format = fmt.num, color = PALETTE[0], labelWidth = 70, onSelect }) {
  const look = useLook();
  const option = useMemo(() => {
    const cells = rows.flatMap((_, ri) => cols.map((__, ci) => [ci, ri, value(ri, ci)]));
    const max = Math.max(1, ...cells.map((c) => c[2]));
    return base(look, {
      tooltip: { ...base(look).tooltip, trigger: 'item', formatter: (p) => `${esc(rows[p.value[1]])} · ${esc(cols[p.value[0]])}<br/><b>${format(p.value[2])}</b>` },
      toolbox: toolbox(look, null),
      grid: { left: 4, right: 8, top: 24, bottom: 34, containLabel: true },
      xAxis: axis(look, { type: 'category', data: cols, splitLine: { show: false } }),
      yAxis: axis(look, { type: 'category', data: rows, splitLine: { show: false }, axisLabel: { color: look.sub, fontSize: 11, width: labelWidth, overflow: 'truncate' } }),
      visualMap: {
        min: 0, max, calculable: true, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 120, itemWidth: 10, textStyle: { color: look.sub, fontSize: 10 },
        inRange: { color: [look.dark ? '#1f1f1f' : '#f0f5ff', color] }, formatter: (v) => fmt.short(v),
      },
      series: [{ type: 'heatmap', data: cells, itemStyle: { borderColor: look.dark ? '#141414' : '#fff', borderWidth: 2, borderRadius: 3 },
        emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0,0,0,.3)' } } }],
    });
  }, [rows, cols, value, format, color, labelWidth, look]);
  return <EChart option={option} height={Math.max(160, rows.length * 26 + 80)}
    onClick={onSelect ? (p) => p.componentType === 'series' && p.value?.[2] > 0 && onSelect(p.value[1], p.value[0]) : undefined} />;
}

// ------------------------------------------------------------------ funnel, gauge, scatter, sparkline
export function Funnel({ steps, format = fmt.num, onSelect }) {
  const look = useLook();
  const top = steps[0]?.value || 1;
  const option = useMemo(() => base(look, {
    tooltip: {
      ...base(look).tooltip, trigger: 'item', formatter: (p) => {
        const i = p.dataIndex; const prev = i ? steps[i - 1].value : steps[0].value;
        return `${p.marker} ${esc(p.name)}<br/><b>${format(p.value)}</b><br/>${((p.value / top) * 100).toFixed(1)}% of booked · ${prev ? ((p.value / prev) * 100).toFixed(1) : 0}% of previous step`;
      },
    },
    toolbox: toolbox(look, null),
    series: [{
      type: 'funnel', sort: 'none', left: '8%', right: '8%', top: 24, bottom: 4, minSize: '18%', gap: 3,
      label: { position: 'inside', color: '#fff', fontWeight: 600, formatter: (p) => `${p.name}: ${format(p.value)} (${((p.value / top) * 100).toFixed(0)}%)` },
      itemStyle: { borderWidth: 0 }, emphasis: { label: { fontSize: 14 } },
      data: steps.map((s) => ({ name: s.label, value: s.value })),
    }],
  }), [steps, format, top, look]);
  return <EChart option={option} height={Math.max(220, steps.length * 42)} onClick={onSelect ? (p) => p.componentType === 'series' && onSelect(steps[p.dataIndex]) : undefined} />;
}

export function Gauge({ value, label, good = 85, warn = 70, suffix = '%' }) {
  const look = useLook();
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const col = v >= good ? PALETTE[1] : v >= warn ? PALETTE[2] : PALETTE[3];
  const option = useMemo(() => base(look, {
    series: [{
      type: 'gauge', startAngle: 200, endAngle: -20, min: 0, max: 100, radius: '95%', center: ['50%', '62%'],
      progress: { show: true, width: 14, roundCap: true, itemStyle: { color: col } }, axisLine: { roundCap: true, lineStyle: { width: 14, color: [[1, look.grid]] } },
      pointer: { show: false }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
      title: { offsetCenter: [0, '38%'], color: look.sub, fontSize: 11 },
      detail: { offsetCenter: [0, '0%'], valueAnimation: true, fontSize: 24, fontWeight: 700, color: look.text, formatter: (x) => `${Number(x).toFixed(1)}${suffix}` },
      data: [{ value: v, name: label }],
    }],
  }), [v, label, col, suffix, look]);
  return <EChart option={option} height={170} />;
}

export function Scatter({ data, x, y, size, label, xFormat = fmt.short, yFormat = fmt.short, height = 250, xLabel, yLabel, onSelect }) {
  const look = useLook();
  const option = useMemo(() => {
    const smax = Math.max(1, ...data.map((d) => Number(d[size] || 0)));
    return base(look, {
      tooltip: { ...base(look).tooltip, trigger: 'item', formatter: (p) => { const d = data[p.dataIndex]; return `<b>${esc(d[label])}</b><br/>${esc(xLabel ?? x)}: ${xFormat(d[x])}<br/>${esc(yLabel ?? y)}: ${yFormat(d[y])}<br/>${esc(size)}: ${fmt.num(d[size])}`; } },
      toolbox: toolbox(look, null),
      grid: { left: 4, right: 16, top: 30, bottom: 4, containLabel: true },
      xAxis: axis(look, { type: 'value', name: xLabel, nameTextStyle: { color: look.sub }, axisLabel: { color: look.sub, fontSize: 11, formatter: xFormat } }),
      yAxis: axis(look, { type: 'value', name: yLabel, nameTextStyle: { color: look.sub }, axisLabel: { color: look.sub, fontSize: 11, formatter: yFormat } }),
      series: [{
        type: 'scatter', emphasis: { focus: 'self', scale: 1.3 },
        data: data.map((d, i) => ({ value: [Number(d[x] || 0), Number(d[y] || 0)], symbolSize: 8 + 30 * Math.sqrt(Number(d[size] || 0) / smax), itemStyle: { color: PALETTE[i % PALETTE.length], opacity: 0.75 } })),
      }],
    });
  }, [data, x, y, size, label, xFormat, yFormat, xLabel, yLabel, look]);
  return <EChart option={option} height={height} onClick={onSelect ? (p) => p.componentType === 'series' && onSelect(data[p.dataIndex]) : undefined} />;
}

export function Sparkline({ values, color = PALETTE[0], height = 38 }) {
  const option = useMemo(() => ({
    animationDuration: 800, grid: { left: 0, right: 0, top: 4, bottom: 2 },
    xAxis: { type: 'category', show: false, boundaryGap: false, data: (values ?? []).map((_, i) => i) }, yAxis: { type: 'value', show: false, scale: true },
    series: [{ type: 'line', data: values ?? [], smooth: 0.4, showSymbol: false, lineStyle: { width: 1.6, color },
      areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: `${color}44` }, { offset: 1, color: `${color}00` }]) } }],
  }), [values, color]);
  if (!values?.length) return null;
  return <EChart option={option} height={height} />;
}

/** Counts up to the new number (also when live data changes it). */
function useCountUp(target, ms = 700) {
  const [v, setV] = useState(Number(target) || 0);
  const from = useRef(Number(target) || 0);
  useEffect(() => {
    const start = Date.now(); const a = from.current; const b = Number(target) || 0;
    if (a === b) return undefined;
    const t = setInterval(() => {
      const k = Math.min(1, (Date.now() - start) / ms); const e = 1 - (1 - k) ** 3;
      setV(a + (b - a) * e);
      if (k >= 1) { clearInterval(t); from.current = b; }
    }, 30);
    return () => { clearInterval(t); from.current = b; setV(b); };
  }, [target, ms]);
  return v;
}

/** A number with its change against the previous period; invert = lower is better; glows when live data changes it. */
export function Kpi({ no, title, value, prev, format = fmt.num, spark, invert = false, help, sub, onSelect }) {
  const shown = useCountUp(value);
  const [flash, setFlash] = useState(false);
  const last = useRef(value);
  useEffect(() => {
    if (last.current === value) return undefined;
    last.current = value; setFlash(true);
    const t = setTimeout(() => setFlash(false), 1500);
    return () => clearTimeout(t);
  }, [value]);
  const change = prev ? ((value - prev) / Math.abs(prev)) * 100 : null;
  const good = change === null ? null : invert ? change <= 0 : change >= 0;
  return (
    <Card size="small" className="dash-card" hoverable={Boolean(onSelect)} onClick={onSelect}
      style={{ height: '100%', cursor: onSelect ? 'pointer' : undefined, transition: 'box-shadow .4s', boxShadow: flash ? `0 0 0 2px ${PALETTE[0]}` : undefined }}>
      <Space size={6} style={{ fontSize: 12 }}>
        {no && <Tag style={{ marginInlineEnd: 0 }}>#{no}</Tag>}
        <Typography.Text type="secondary">{title}</Typography.Text>
        {help && <Tooltip title={help}><InfoCircleOutlined style={{ color: 'var(--ant-color-text-tertiary, #999)' }} /></Tooltip>}
      </Space>
      <div style={{ fontSize: 22, fontWeight: 600, margin: '4px 0 0' }}>{format(shown)}</div>
      <div style={{ fontSize: 12, minHeight: 18 }}>
        {change !== null && (
          <Typography.Text type={good ? 'success' : 'danger'}>
            {change >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(change).toFixed(1)}%
          </Typography.Text>
        )}
        {change !== null && <Typography.Text type="secondary"> vs {format(prev)}</Typography.Text>}
        {sub && <Typography.Text type="secondary">{sub}</Typography.Text>}
      </div>
      {spark && <Sparkline values={spark} color={good === false ? PALETTE[3] : PALETTE[0]} />}
    </Card>
  );
}
