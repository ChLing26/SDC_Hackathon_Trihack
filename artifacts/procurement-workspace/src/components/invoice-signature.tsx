import { useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, PenLine } from "lucide-react";
import {
  ApiError, useSignProcurementInvoice, useSignSupplierProcurementInvoice, getListProcurementInvoicesQueryKey,
  getListProcurementRequestsQueryKey,
  getGetProcurementRequestQueryKey, type ProcurementInvoice,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

export function InvoiceSignatureRecord({ inv, supplier = false }: { inv: ProcurementInvoice; supplier?: boolean }) {
  const signature = supplier ? inv.supplierSignature : inv.electronicSignature;
  const label = supplier ? "Supplier signature" : "Account signature";
  if (!signature) return <section aria-label={label} className="mt-5 rounded-md border border-dashed p-4 text-sm text-muted-foreground"><h2 className="font-semibold">{label}</h2><p>Not recorded yet.</p></section>;
  const accountName = "recordingAccountName" in signature ? signature.recordingAccountName : signature.accountName;
  const accountId = "recordingAccountId" in signature ? signature.recordingAccountId : signature.accountId;
  const time = "recordedAt" in signature ? signature.recordedAt : signature.signedAt;
  return (
    <section className="invoice-signature-record mt-5 min-w-0 rounded-md border border-primary/20 bg-primary/5 p-4" aria-label={label} data-testid={supplier ? "invoice-saved-supplier-signature" : "invoice-saved-signature"}>
      <h2 className="flex items-center gap-2 text-xs font-semibold text-primary"><CheckCircle2 className="h-4 w-4 shrink-0" />{label} · Recorded</h2>
      {supplier && <p className="mt-2 break-words text-xs">Supplier: <strong>{inv.supplierSignature?.supplierName}</strong><br />Entered representative (unverified):</p>}
      <div className="my-3 break-words font-serif text-2xl italic" data-testid="text-signature-name">{signature.typedName}</div>
      <p className="text-xs leading-relaxed">{supplier ? "Recorded by workspace account" : "Signed through account"}: <strong className="break-words">{accountName}</strong> · #{accountId}</p>
      <p className="mt-1 text-xs text-muted-foreground">Server-recorded: {new Date(time).toLocaleString()} ({Intl.DateTimeFormat().resolvedOptions().timeZone})</p>
      <p className="mt-2 break-words text-[11px] text-muted-foreground">Typed-name consent · {signature.consentVersion}. {supplier ? "Internal supplier entry only. Supplier identity and representative authority are not verified." : "Account identity does not verify manager authority."} Not a certified digital signature.</p>
      <div className="mt-3 border-t pt-2 text-[10px] text-muted-foreground">
        Signed document integrity hash
        <code className="num mt-1 block break-all">{signature.documentHash}</code>
      </div>
    </section>
  );
}

export function InvoiceSignatureForm({ inv, onBusyChange, disabled = false, supplier = false }: { inv: ProcurementInvoice; onBusyChange: (busy: boolean) => void; disabled?: boolean; supplier?: boolean }) {
  const id = useId();
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const accountMutation = useSignProcurementInvoice();
  const supplierMutation = useSignSupplierProcurementInvoice();
  const mutation = supplier ? supplierMutation : accountMutation;
  const client = useQueryClient();
  if (supplier ? inv.supplierSignature : inv.electronicSignature) return saved ? <p role="status" className="no-print mt-3 text-sm text-primary">{supplier ? "Supplier" : "Account"} signature saved permanently.</p> : null;

  async function sign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending || disabled) return;
    setError(null);
    if (name.trim().length < 2 || name.trim().length > 120 || !consent) {
      setError(`Enter ${supplier ? "the representative's" : "your"} full name (2–120 characters) and confirm consent before saving.`); return;
    }
    onBusyChange(true);
    try {
      const signed = await mutation.mutateAsync({ invoiceId: inv.id, data: { typedName: name.trim(), consent: true } });
      client.setQueryData<ProcurementInvoice[]>(getListProcurementInvoicesQueryKey(), (old) =>
        old?.map((entry) => entry.id === signed.id ? signed : entry));
      setSaved(true);
      await Promise.all([
        client.invalidateQueries({ queryKey: getListProcurementInvoicesQueryKey() }),
        client.invalidateQueries({ queryKey: getGetProcurementRequestQueryKey(inv.requestId) }),
        client.invalidateQueries({ queryKey: getListProcurementRequestsQueryKey() }),
      ]);
    } catch (cause) {
      setError(cause instanceof ApiError && cause.status === 409
        ? `The ${supplier ? "supplier" : "account"} signature is already recorded. Refreshing its permanent evidence.`
        : cause instanceof ApiError && cause.status === 401 ? "Your session expired. Sign in again, then retry. No replacement was made."
        : cause instanceof ApiError && cause.status === 400 ? "Check the full name (2–120 characters) and confirm consent, then retry."
        : cause instanceof ApiError && cause.status === 404 ? "This invoice is no longer available. Refresh the invoice list."
        : "The signature could not be confirmed. Your entry is retained; check your connection and retry. Any saved signature cannot be replaced.");
      if (cause instanceof ApiError && cause.status === 409) {
        await Promise.all([
          client.invalidateQueries({ queryKey: getListProcurementInvoicesQueryKey() }),
          client.invalidateQueries({ queryKey: getGetProcurementRequestQueryKey(inv.requestId) }),
          client.invalidateQueries({ queryKey: getListProcurementRequestsQueryKey() }),
        ]);
      }
    } finally {
      onBusyChange(false);
    }
  }
  return (
    <section className="no-print mt-5 rounded-md border bg-card p-5" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`} className="flex items-center gap-2 text-sm font-semibold"><PenLine className="h-4 w-4" />{supplier ? "Record supplier e-signature" : "Add account e-signature"}</h2>
      <p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">{supplier
        ? `Record an entry for ${inv.supplierName} through workspace account ${user?.name}. The entered representative is not the authenticated recording account. Supplier identity and authority are not verified. This is internal only, not a supplier portal or certified legal signature.`
        : `Signing as account ${user?.name}. This saves a permanent internal consent record, not a supplier countersignature or certified legal signature.`}</p>
      <form onSubmit={sign} className="mt-4 space-y-3">
        <div>
          <label htmlFor={`${id}-name`} className="mb-1.5 block text-xs font-medium">{supplier ? "Supplier representative's full name" : "Your full name"}</label>
          <input id={`${id}-name`} data-testid={supplier ? "input-supplier-signature-name" : "input-signature-name"} autoComplete={supplier ? "off" : "name"} required minLength={2} maxLength={120}
            value={name} onChange={(event) => setName(event.target.value)} disabled={mutation.isPending || disabled}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </div>
        {name.trim() && <div className="rounded-md bg-muted/50 p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Signature preview</p><p className="mt-1 break-words font-serif text-2xl italic">{name.trim()}</p></div>}
        <label className="flex items-start gap-2 text-xs leading-relaxed">
          <input id={`${id}-consent`} type="checkbox" data-testid={supplier ? "checkbox-supplier-signature-consent" : "checkbox-signature-consent"} checked={consent} required disabled={mutation.isPending || disabled}
            onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
          {supplier
            ? `I confirm I have authority to record this typed signature for the named representative of ${inv.supplierName}, and intend to record it on this invoice for that supplier. I understand supplier identity is not verified and this entry is permanently saved with my recording account and server time and cannot be replaced.`
            : "I intend my typed name to be my electronic signature on this invoice. I understand it will be saved with my account and signing time, and cannot be replaced."}
        </label>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <Button type="submit" disabled={disabled || mutation.isPending || !consent || name.trim().length < 2 || name.trim().length > 120} data-testid={supplier ? "button-sign-supplier-invoice" : "button-sign-invoice"}>
          {mutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PenLine className="mr-2 h-4 w-4" />}
          {mutation.isPending ? "Saving signature…" : supplier ? "Save supplier signature permanently" : "Sign invoice"}
        </Button>
      </form>
    </section>
  );
}
