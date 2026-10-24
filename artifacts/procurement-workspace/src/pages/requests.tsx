import { useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Plus, Search, ChevronRight } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProcurementRequests, useCreateProcurementRequest,
  getListProcurementRequestsQueryKey, getGetProcurementDashboardQueryKey,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { PageHead, ErrorBox, Empty, Rows, StatusTag, STATUS, money, fdate } from "@/components/shell";
import { cn } from "@/lib/utils";

const schema = z.object({
  itemName: z.string().min(2, "At least 2 characters"),
  quantity: z.coerce.number().int().min(1, "Minimum 1"),
  budgetAmount: z.coerce.number().positive("Must be above 0"),
  currency: z.string().length(3, "3-letter code").transform((s) => s.toUpperCase()),
  requiredDeliveryDate: z.string().min(1, "Pick a date"),
  deliveryLocation: z.string().min(2, "At least 2 characters"),
  requesterName: z.string().min(2, "At least 2 characters"),
});
type FormIn = z.input<typeof schema>;

function NewRequest({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, nav] = useLocation();
  const create = useCreateProcurementRequest();
  const form = useForm<FormIn>({
    resolver: zodResolver(schema),
    defaultValues: { itemName: "", quantity: 1, budgetAmount: 0, currency: "MYR", requiredDeliveryDate: "", deliveryLocation: "", requesterName: "" },
  });
  const submit = form.handleSubmit((v) => {
    const data = schema.parse(v);
    create.mutate({ data }, {
      onSuccess: (r) => {
        qc.invalidateQueries({ queryKey: getListProcurementRequestsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetProcurementDashboardQueryKey() });
        toast({ title: "Requirement logged", description: `${r.offers.length} illustrative quotes generated.` });
        form.reset(); onOpenChange(false); nav(`/requests/${r.id}`);
      },
      onError: () => toast({ title: "Could not create request", variant: "destructive" }),
    });
  });
  const F = (name: keyof FormIn, label: string, type = "text", cls = "") => (
    <FormField control={form.control} name={name} render={({ field }) => (
      <FormItem className={cls}>
        <FormLabel className="text-xs">{label}</FormLabel>
        <FormControl><Input type={type} {...field} value={field.value as string | number} data-testid={`input-${name}`} className={type === "number" ? "num" : ""} /></FormControl>
        <FormMessage />
      </FormItem>
    )} />
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">New requirement</DialogTitle>
          <DialogDescription>Describe what you need. Illustrative supplier quotes are generated on submit.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={submit} className="grid grid-cols-6 gap-3">
            {F("itemName", "Item", "text", "col-span-6")}
            {F("quantity", "Quantity", "number", "col-span-2")}
            {F("budgetAmount", "Total budget", "number", "col-span-2")}
            {F("currency", "Currency", "text", "col-span-2")}
            {F("requiredDeliveryDate", "Needed by", "date", "col-span-6 sm:col-span-3")}
            {F("deliveryLocation", "Deliver to", "text", "col-span-6 sm:col-span-3")}
            {F("requesterName", "Requested by", "text", "col-span-6")}
            <div className="col-span-6 flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} data-testid="button-cancel">Cancel</Button>
              <Button type="submit" disabled={create.isPending} data-testid="button-submit-request">{create.isPending ? "Requesting quotes..." : "Submit and get quotes"}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function Requests() {
  const search = useSearch();
  const [open, setOpen] = useState(() => new URLSearchParams(search).get("new") === "1");
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("all");
  const q = useListProcurementRequests();
  const rows = useMemo(() => (q.data ?? [])
    .filter((r) => status === "all" || r.status === status)
    .filter((r) => !term || `${r.itemName} ${r.requesterName} ${r.deliveryLocation} ${r.selectedSupplier ?? ""}`.toLowerCase().includes(term.toLowerCase()))
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)), [q.data, term, status]);

  return (
    <>
      <PageHead kicker="Register" title="Requests">
        <Button onClick={() => setOpen(true)} data-testid="button-new-request"><Plus className="h-4 w-4 mr-1" /> New requirement</Button>
      </PageHead>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search item, requester, location, supplier" className="pl-9 bg-card" data-testid="input-search" />
        </div>
        <div className="flex flex-wrap gap-1 rounded-md border bg-card p-1">
          {["all", ...Object.keys(STATUS)].map((s) => (
            <button key={s} onClick={() => setStatus(s)} data-testid={`button-filter-${s}`}
              className={cn("rounded px-2.5 py-1 text-xs transition-colors", status === s ? "bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {s === "all" ? "All" : STATUS[s].label}
            </button>
          ))}
        </div>
      </div>
      {q.isLoading ? <Rows /> : q.isError ? <ErrorBox onRetry={() => q.refetch()} /> :
        !q.data?.length ? <Empty title="No requirements yet" body="Log your first buying need to compare supplier offers."><Button onClick={() => setOpen(true)}>New requirement</Button></Empty> :
        !rows.length ? <Empty title="Nothing matches" body="Try a different search term or status filter." /> :
        <div className="rounded-md border bg-card overflow-hidden">
          <div className="hidden md:grid grid-cols-[60px_1.6fr_1fr_1fr_120px_140px_20px] gap-3 px-4 py-2 text-[11px] uppercase tracking-wider text-muted-foreground border-b bg-muted/40">
            <span>No.</span><span>Item</span><span>Requester</span><span>Needed by</span><span className="text-right">Budget</span><span>Status</span><span />
          </div>
          {rows.map((r) => (
            <Link key={r.id} href={`/requests/${r.id}`} data-testid={`row-request-${r.id}`}
              className="group grid grid-cols-[1fr_auto] md:grid-cols-[60px_1.6fr_1fr_1fr_120px_140px_20px] gap-x-3 gap-y-1 items-center px-4 py-3 border-b last:border-0 hover:bg-muted/40 transition-colors">
              <span className="num text-xs text-muted-foreground hidden md:block">#{String(r.id).padStart(4, "0")}</span>
              <span className="min-w-0"><span className="font-medium block truncate">{r.itemName}</span><span className="num text-xs text-muted-foreground">{r.quantity} units · {r.offerCount} quotes{r.selectedSupplier ? ` · ${r.selectedSupplier}` : ""}</span></span>
              <span className="text-sm hidden md:block truncate">{r.requesterName}<span className="block text-xs text-muted-foreground truncate">{r.deliveryLocation}</span></span>
              <span className="num text-sm hidden md:block">{fdate(r.requiredDeliveryDate)}</span>
              <span className="num text-sm text-right">{money(r.budgetAmount, r.currency)}</span>
              <span className="col-span-2 md:col-span-1"><StatusTag s={r.status} /></span>
              <ChevronRight className="h-4 w-4 text-muted-foreground hidden md:block transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>}
      <NewRequest open={open} onOpenChange={setOpen} />
    </>
  );
}
