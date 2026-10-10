import { Card, Descriptions, Divider, Tag, Typography } from 'antd';

const inr = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const m = (v) => inr.format(Number(v) || 0);
const ROW_STYLES = { label: { width: '55%' }, content: { justifyContent: 'flex-end' } };

/** horizontal: one row of joined cells (desktop themes put it in a bar under the form); else the side card. */
export default function TotalsCard({ totals, serverTotals, horizontal = false }) {
  if (!totals) return null;
  const mismatch = serverTotals && Math.abs(serverTotals.grandTotal - totals.grandTotal) > 0.009;
  if (horizontal) {
    const cells = [
      [`Base freight (${totals.rateOn})`, m(totals.baseFreight)],
      ...(totals.discountValue > 0 ? [[`Discount ${totals.discountPercent}%`, `− ${m(totals.discountValue)}`]] : []),
      [<>Freight {totals.minFreightApplied && <Tag color="orange">min</Tag>}</>, m(totals.freight)],
      [`Fuel ${totals.fuelPercent}%`, m(totals.fuelSurcharge)],
      ['Other charges', m(totals.otherCharges)],
      ['Docket charge', m(totals.docketCharge)],
      ['Taxable', m(totals.taxableAmount)],
      ...(totals.taxMode === 'IGST' ? [[`IGST ${totals.igstRate}%`, m(totals.igstAmount)]] : []),
      ...(totals.taxMode === 'GST' ? [[`CGST ${totals.cgstRate}%`, m(totals.cgstAmount)], [`SGST ${totals.sgstRate}%`, m(totals.sgstAmount)]] : []),
      ...(totals.taxMode === 'NA' ? [['GST', 'N/A']] : []),
      ...(totals.additionalTaxTotal > 0 ? [['After tax', m(totals.additionalTaxTotal)]] : []),
    ];
    return (
      <div className="totals-strip" title={mismatch ? `Saved total was ₹ ${m(serverTotals.grandTotal)} — it will be recalculated on save` : undefined}>
        {cells.map(([label, value], i) => (
          <div key={i} className="totals-cell"><span className="totals-label">{label}</span><span className="totals-value money">{value}</span></div>
        ))}
        <div className="totals-cell totals-grand">
          <span className="totals-label">Grand total{mismatch ? ' *' : ''}</span><span className="totals-value money">₹ {m(totals.grandTotal)}</span>
        </div>
      </div>
    );
  }
  return (
    <Card size="small" title="Charges summary" style={{ position: 'sticky', top: 72 }}>
      <Descriptions size="small" column={1} colon={false} styles={ROW_STYLES}>
        <Descriptions.Item label={`Base freight (${totals.rateOn})`}><span className="money">{m(totals.baseFreight)}</span></Descriptions.Item>
        {totals.discountValue > 0 && (
          <Descriptions.Item label={`Discount ${totals.discountPercent}%`}><span className="money">− {m(totals.discountValue)}</span></Descriptions.Item>
        )}
        <Descriptions.Item label={<>Freight {totals.minFreightApplied && <Tag color="orange">min</Tag>}</>}><span className="money">{m(totals.freight)}</span></Descriptions.Item>
        <Descriptions.Item label={`Fuel surcharge ${totals.fuelPercent}%`}><span className="money">{m(totals.fuelSurcharge)}</span></Descriptions.Item>
        <Descriptions.Item label="Other charges"><span className="money">{m(totals.otherCharges)}</span></Descriptions.Item>
        <Descriptions.Item label="Docket charge"><span className="money">{m(totals.docketCharge)}</span></Descriptions.Item>
      </Descriptions>
      <Divider style={{ margin: '8px 0' }} />
      <Descriptions size="small" column={1} colon={false} styles={ROW_STYLES}>
        <Descriptions.Item label="Taxable amount"><strong className="money">{m(totals.taxableAmount)}</strong></Descriptions.Item>
        {totals.taxMode === 'IGST' && <Descriptions.Item label={`IGST ${totals.igstRate}%`}><span className="money">{m(totals.igstAmount)}</span></Descriptions.Item>}
        {totals.taxMode === 'GST' && <Descriptions.Item label={`CGST ${totals.cgstRate}%`}><span className="money">{m(totals.cgstAmount)}</span></Descriptions.Item>}
        {totals.taxMode === 'GST' && <Descriptions.Item label={`SGST ${totals.sgstRate}%`}><span className="money">{m(totals.sgstAmount)}</span></Descriptions.Item>}
        {totals.taxMode === 'NA' && <Descriptions.Item label="GST">Not applicable</Descriptions.Item>}
        {totals.reverseCharge && totals.totalTax > 0 && (
          <Descriptions.Item label=""><Typography.Text type="secondary" style={{ fontSize: 12 }}>GST paid by billing party (not added)</Typography.Text></Descriptions.Item>
        )}
        {totals.additionalTaxTotal > 0 && <Descriptions.Item label="Charges after tax"><span className="money">{m(totals.additionalTaxTotal)}</span></Descriptions.Item>}
      </Descriptions>
      <Divider style={{ margin: '8px 0' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Typography.Text strong>Grand total</Typography.Text>
        <Typography.Title level={3} style={{ margin: 0 }} className="money">₹ {m(totals.grandTotal)}</Typography.Title>
      </div>
      {mismatch && (
        <Typography.Text type="warning" style={{ fontSize: 12 }}>
          Saved total was ₹ {m(serverTotals.grandTotal)} — it will be recalculated on save.
        </Typography.Text>
      )}
    </Card>
  );
}
