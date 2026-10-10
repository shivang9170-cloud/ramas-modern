// Client bill print (tax invoice) — replaces the Crystal Reports bill prints (Client_Bill_PrintGST / FTL_Bill_Invoice_Print).
// Opens in its own tab without the menu; the browser's Print (or Save as PDF) prints it on A4.
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { api, errorMessage } from '../../api/client.js';
import { amountInWords } from './amountInWords.js';

const fmt = (v) => (v ? dayjs(v).format('DD/MM/YYYY') : '');
const money = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const css = `
  .bill { max-width: 1050px; margin: 16px auto; padding: 24px; background: #fff; color: #111; font: 12px/1.45 Calibri, Arial, sans-serif; }
  .bill h1 { font-size: 18px; margin: 0; } .bill h2 { font-size: 15px; text-align: center; margin: 12px 0; letter-spacing: 1px; }
  .bill table { width: 100%; border-collapse: collapse; } .bill th, .bill td { border: 1px solid #999; padding: 3px 5px; vertical-align: top; }
  .bill th { background: #eee; } .bill .r { text-align: right; } .bill .noborder td { border: none; padding: 1px 0; }
  .bill .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 10px; }
  .bill .box { border: 1px solid #999; padding: 6px 8px; } .bill .muted { color: #555; }
  .bill .toolbar { text-align: right; margin-bottom: 10px; } .bill .cancelled { color: #c00; font-weight: bold; text-align: center; font-size: 16px; }
  @media print { body { background: #fff; } .bill { margin: 0; padding: 0; max-width: none; } .bill .toolbar { display: none; } @page { size: A4 landscape; margin: 10mm; } }
`;

export default function ClientBillPrintPage() {
  const { billNo } = useParams();
  const { data: b, error, isLoading } = useQuery({
    queryKey: ['client-bill', billNo],
    queryFn: () => api.get(`/client-bills/${encodeURIComponent(billNo)}`).then((r) => r.data),
  });
  useEffect(() => { document.title = `Bill ${billNo}`; }, [billNo]);

  if (isLoading) return <div style={{ padding: 40 }}>Loading bill…</div>;
  if (error) return <div style={{ padding: 40, color: '#c00' }}>{errorMessage(error)}</div>;
  const igst = b.taxType === 'IGST';

  return (
    <div className="bill">
      <style>{css}</style>
      <div className="toolbar"><button type="button" onClick={() => window.print()}>Print / Save as PDF</button></div>
      {b.status === 'Cancelled' && <div className="cancelled">CANCELLED</div>}
      <h1>{b.branch.name}</h1>
      <div className="muted">{b.branch.address}{b.branch.phone && ` · Ph. ${b.branch.phone}`}{b.branch.gstin && ` · GSTIN ${b.branch.gstin}`}{b.branch.state && ` · ${b.branch.state}`}</div>
      <h2>TAX INVOICE</h2>
      <div className="grid2">
        <div className="box">
          <strong>Bill to</strong><br />
          {b.client.name} ({b.client.code})<br />
          {b.client.address}<br />
          {b.client.gstin && <>GSTIN: {b.client.gstin}<br /></>}
          {b.client.state && <>State: {b.client.state}</>}
        </div>
        <div className="box">
          <table className="noborder"><tbody>
            <tr><td>Bill no.</td><td><strong>{b.billNo}</strong>{b.manualBillNo && ` (${b.manualBillNo})`}</td></tr>
            <tr><td>Bill date</td><td>{fmt(b.billDate)}</td></tr>
            <tr><td>Due date</td><td>{fmt(b.dueDate)}</td></tr>
            <tr><td>Period</td><td>{fmt(b.from)} to {fmt(b.to)}</td></tr>
            <tr><td>Service</td><td>{b.serviceType} · SAC {b.sacCode}</td></tr>
            {b.docsEnclosed && <tr><td>Docs enclosed</td><td>{b.docsEnclosed}</td></tr>}
          </tbody></table>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>#</th><th>Docket no.</th><th>Date</th><th>Origin</th><th>Destination</th><th>Invoice no.</th><th>Pkts</th><th>Weight</th>
            <th>Rate</th><th>Freight</th><th>Docket chg</th><th>Other</th><th>Fuel</th>
            {igst ? <th>IGST</th> : <><th>CGST</th><th>SGST</th></>}<th>After tax</th><th>Total</th>
          </tr>
        </thead>
        <tbody>
          {b.dockets.map((d, i) => (
            <tr key={d.docketNo}>
              <td className="r">{i + 1}</td><td>{d.docketNo}</td><td>{fmt(d.bookingDate)}</td><td>{d.origin}</td><td>{d.destination}</td>
              <td>{d.invoiceNos}</td><td className="r">{d.packages}</td><td className="r">{d.weight}</td><td className="r">{d.rate}</td>
              <td className="r">{money(d.freight)}</td><td className="r">{money(d.docketCharge)}</td><td className="r">{money(d.otherCharge)}</td>
              <td className="r">{money(d.fuel)}</td>
              {igst ? <td className="r">{money(d.igst)}</td> : <><td className="r">{money(d.cgst)}</td><td className="r">{money(d.sgst)}</td></>}
              <td className="r">{money(d.afterTax)}</td><td className="r">{money(d.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={9} className="r">Total</th>
            <th className="r">{money(b.totals.freight)}</th><th className="r">{money(b.totals.docketCharge)}</th><th className="r">{money(b.totals.other)}</th>
            <th className="r">{money(b.totals.fuel)}</th>
            {igst ? <th className="r">{money(b.totals.igst)}</th> : <><th className="r">{money(b.totals.cgst)}</th><th className="r">{money(b.totals.sgst)}</th></>}
            <th className="r">{money(b.totals.afterTax)}</th><th className="r">{money(b.totals.total)}</th>
          </tr>
        </tfoot>
      </table>
      <p><strong>Amount in words:</strong> {amountInWords(b.totals.total)}</p>
      {b.remarks && <p><strong>Remarks:</strong> {b.remarks}</p>}
      <div className="grid2" style={{ marginTop: 40 }}>
        <div className="muted">Computer generated bill. Payment due by {fmt(b.dueDate)}.</div>
        <div className="r">For {b.branch.name}<br /><br /><br />Authorised signatory</div>
      </div>
    </div>
  );
}
