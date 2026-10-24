import { useEffect, useRef, useState, type Ref } from "react";
import { Link } from "wouter";
import { Download, Loader2, Printer, ShieldAlert } from "lucide-react";
import { useListProcurementInvoices, type ProcurementInvoice } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { PageHead, ErrorBox, Empty, Rows, money, fdate } from "@/components/shell";
import { cn } from "@/lib/utils";
import { InvoiceSignatureForm, InvoiceSignatureRecord } from "@/components/invoice-signature";
import { downloadInvoicePdf } from "@/lib/invoice-pdf";

function Sheet({ inv, sheetRef }: { inv: ProcurementInvoice; sheetRef: Ref<HTMLElement> }) {
  const sub = inv.unitPrice * inv.quantity;
  return (
    <article ref={sheetRef} className="rounded-md border bg-card p-6 md:p-8" data-testid={`invoice-${inv.id}`}>
      <div className="flex flex-wrap justify-between gap-4 border-b pb-4">
        <div><div className="num text-[11px] uppercase tracking-[0.2em] text-accent">Internal invoice record</div><div className="num text-2xl font-semibold mt-1">{inv.reference}</div></div>
        <div className="num text-sm text-right"><div>Issued {fdate(inv.issuedAt)}</div><div className="text-muted-foreground">Request <Link href={`/requests/${inv.requestId}`} className="underline">#{String(inv.requestId).padStart(4, "0")}</Link></div></div>
      </div>
      <div className="grid grid-cols-2 gap-4 py-4 text-sm border-b">
        <div><div className="text-[11px] uppercase tracking-wider text-muted-foreground">Buyer</div><div className="font-medium">{inv.buyerName}</div></div>
        <div><div className="text-[11px] uppercase tracking-wider text-muted-foreground">Supplier</div><div className="font-medium">{inv.supplierName}</div></div>
      </div>
      <table className="w-full text-xs sm:text-sm my-4 num">
        <thead><tr className="text-[11px] uppercase tracking-wider text-muted-foreground text-left"><th className="font-normal py-1">Item</th><th className="font-normal pl-3 text-right">Qty</th><th className="font-normal pl-3 text-right">Unit</th><th className="font-normal pl-3 text-right">Line</th></tr></thead>
        <tbody>
          <tr className="border-t"><td className="py-2 font-sans">{inv.itemName}</td><td className="pl-3 text-right">{inv.quantity}</td><td className="pl-3 text-right">{money(inv.unitPrice, inv.currency)}</td><td className="pl-3 text-right">{money(sub, inv.currency)}</td></tr>
          <tr className="border-t"><td className="py-2 font-sans" colSpan={3}>Shipping</td><td className="text-right">{money(inv.shippingFee, inv.currency)}</td></tr>
          <tr className="border-t-2 border-foreground"><td className="py-2 font-sans font-semibold" colSpan={3}>Total</td><td className="text-right font-semibold text-base" data-testid={`text-total-${inv.id}`}>{money(inv.totalAmount, inv.currency)}</td></tr>
        </tbody>
      </table>
      <InvoiceSignatureRecord inv={inv} />
      <InvoiceSignatureRecord inv={inv} supplier />
      <div className="rounded bg-muted/60 p-3 text-xs">
        <div className="text-muted-foreground mb-1">{inv.signatureType} · integrity hash, not a certified legal signature</div>
        <code className="num break-all">{inv.signature}</code>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">Internal record only. Not validated by any tax authority and not delivered to the supplier.</p>
    </article>
  );
}

export default function Invoices() {
  const q = useListProcurementInvoices();
  const [sel, setSel] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [signing, setSigning] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!signing) return;
    // Keep navigation and browser shortcuts from leaving a pending immutable save.
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const blockNavigation = (event: MouseEvent) => {
      if ((event.target as Element).closest("a, button")) { event.preventDefault(); event.stopPropagation(); }
    };
    const blockPrint = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") event.preventDefault();
    };
    document.body.dataset.invoiceSaving = "true";
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", blockNavigation, true);
    document.addEventListener("keydown", blockPrint, true);
    return () => {
      delete document.body.dataset.invoiceSaving;
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", blockNavigation, true);
      document.removeEventListener("keydown", blockPrint, true);
    };
  }, [signing]);
  const list = q.data ?? [];
  const cur = list.find((i) => i.id === sel) ?? list[0];
  async function exportPdf() {
    if (!cur || !sheetRef.current || exporting || signing) return;
    setPdfError(null);
    setExporting(true);
    try { await downloadInvoicePdf(sheetRef.current, cur.reference); }
    catch { setPdfError("The PDF could not be generated. Please try again, or use Print and choose Save as PDF."); }
    finally { setExporting(false); }
  }
  return (
    <>
      <div className="no-print"><PageHead kicker="Records" title="Invoices">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!cur || signing || exporting} onClick={() => window.print()} data-testid="button-print"><Printer className="h-4 w-4 mr-1" />Print</Button>
          <Button disabled={!cur || signing || exporting} onClick={exportPdf} data-testid="button-download-pdf">
            {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
            {exporting ? "Preparing PDF…" : "Download PDF"}
          </Button>
        </div>
      </PageHead>
        <div className="flex gap-2 items-start rounded-md border border-accent/30 bg-accent/5 p-3 text-xs mb-6"><ShieldAlert className="h-4 w-4 text-accent shrink-0" />Generated automatically on approval. These are internal buyer and supplier records for this demo, not tax documents.</div>
      </div>
      {pdfError && <p role="alert" className="no-print mb-4 text-sm text-destructive">{pdfError}</p>}
      {signing && <p role="status" className="no-print mb-4 text-sm text-primary">Saving permanent signature evidence. Navigation, printing and download are paused until this finishes.</p>}
      <p className="invoice-print-pending hidden">A signature is being saved. Wait for it to finish, then print a fresh copy.</p>
      {q.isLoading ? <Rows /> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> :
        !list.length ? <Empty title="No invoices yet" body="Approve a supplier offer and its invoice record will appear here."><Link href="/approvals" className="text-primary underline text-sm">Go to approvals</Link></Empty> :
        <div className="invoice-layout grid gap-6 lg:grid-cols-[280px_1fr]">
          <ul className="no-print rounded-md border bg-card divide-y self-start overflow-hidden">
            {list.map((i) => (
              <li key={i.id}><button disabled={signing || exporting} onClick={() => { setSel(i.id); setPdfError(null); }} data-testid={`button-invoice-${i.id}`}
                className={cn("w-full text-left px-4 py-3 transition-colors hover:bg-muted/50", cur?.id === i.id && "bg-primary/5 border-l-2 border-primary")}>
                <div className="num text-sm font-medium">{i.reference}</div>
                <div className="flex justify-between text-xs text-muted-foreground"><span className="truncate">{i.supplierName}</span><span className="num">{money(i.totalAmount, i.currency)}</span></div>
              </button></li>
            ))}
          </ul>
          {cur && <div className="min-w-0">
            <Sheet inv={cur} sheetRef={sheetRef} />
            <InvoiceSignatureForm key={`account-${cur.id}`} inv={cur} onBusyChange={setSigning} disabled={exporting || signing} />
            <InvoiceSignatureForm key={`supplier-${cur.id}`} inv={cur} supplier onBusyChange={setSigning} disabled={exporting || signing} />
          </div>}
        </div>}
    </>
  );
}
