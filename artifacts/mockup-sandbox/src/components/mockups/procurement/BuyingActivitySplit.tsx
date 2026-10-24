import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  FileText,
  LayoutDashboard,
  Plus,
  Search,
  Settings2,
  ShoppingBag,
  Sparkles,
  Stamp,
  X,
} from "lucide-react";

type Activity = {
  id: string;
  day: string;
  time: string;
  title: string;
  detail: string;
  kind: "quote" | "approved" | "invoice" | "review";
  amount?: string;
};

const activities: Activity[] = [
  { id: "PF-0248", day: "Today", time: "10:42", title: "Three offers received", detail: "A4 copier paper · requested by Amira Tan", kind: "quote", amount: "MYR 1,480" },
  { id: "PF-0246", day: "Today", time: "09:18", title: "Purchase approved", detail: "Ergonomic chairs · signed by Daniel Lee", kind: "approved", amount: "MYR 6,720" },
  { id: "PF-0242", day: "Yesterday", time: "16:05", title: "Invoice matched", detail: "Northline Office Supply · INV-8841", kind: "invoice", amount: "MYR 892.40" },
  { id: "PF-0239", day: "Yesterday", time: "14:31", title: "Approval requested", detail: "Workshop display panels · 12 units", kind: "review", amount: "MYR 4,260" },
  { id: "PF-0235", day: "Mon, 17 Jun", time: "11:24", title: "Supplier quote selected", detail: "USB-C docking stations · Metro Tech", kind: "quote", amount: "MYR 3,150" },
];

const kindStyles: Record<Activity["kind"], { label: string; color: string; bg: string }> = {
  quote: { label: "Quotes", color: "#0f6864", bg: "#e5f2ed" },
  approved: { label: "Approved", color: "#587336", bg: "#edf2e4" },
  invoice: { label: "Invoice", color: "#a65a30", bg: "#f7ece4" },
  review: { label: "Needs review", color: "#a65a30", bg: "#f7ece4" },
};

export default function BuyingActivitySplit() {
  const [filter, setFilter] = useState("Everything");
  const [query, setQuery] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeNav, setActiveNav] = useState("Overview");

  const visibleActivities = useMemo(() => activities.filter((item) => {
    const filterKinds: Record<string, Activity["kind"] | undefined> = {
      Quotes: "quote",
      Approved: "approved",
      Invoice: "invoice",
      "Needs review": "review",
    };
    const matchesFilter = filter === "Everything" || item.kind === filterKinds[filter];
    const matchesQuery = !query || `${item.title} ${item.detail} ${item.id}`.toLowerCase().includes(query.toLowerCase());
    return matchesFilter && matchesQuery;
  }), [filter, query]);

  return (
    <div className="pfv">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap');
        .pfv{--ink:#18312f;--muted:#77847e;--line:#e3e6dd;--paper:#f4f5ef;--card:#fbfcf8;--teal:#174e4a;--coral:#c8754e;min-height:100vh;background:var(--paper);color:var(--ink);font-family:'Manrope',sans-serif;display:flex;font-size:13px}
        .pfv *{box-sizing:border-box}.pfv button,.pfv input{font:inherit}.pfv button{cursor:pointer}
        .pfv .mono{font-family:'DM Mono',monospace;font-variant-numeric:tabular-nums}
        .pfv-sidebar{width:228px;background:#193b39;color:#e8eee7;display:flex;flex-direction:column;flex:none;padding:25px 14px 17px}
        .pfv-brand{display:flex;align-items:center;gap:10px;padding:0 12px 28px}
        .pfv-brandmark{width:31px;height:31px;display:grid;place-items:center;background:#dc895f;color:#fff;border-radius:9px;font-size:13px;font-weight:800;letter-spacing:-.08em}
        .pfv-brandname{font-size:15px;line-height:1;font-weight:800;letter-spacing:-.04em}.pfv-brandline{font:9px 'DM Mono',monospace;color:#9db4a9;letter-spacing:.1em;text-transform:uppercase;margin-top:5px}
        .pfv-section-label{padding:0 12px 9px;color:#829a8f;font:9px 'DM Mono',monospace;letter-spacing:.14em;text-transform:uppercase}
        .pfv-nav{display:grid;gap:4px}.pfv-nav button{border:0;color:#b6c8bd;background:transparent;border-radius:7px;display:flex;align-items:center;gap:11px;text-align:left;padding:10px 12px;transition:background .18s,color .18s}
        .pfv-nav button:hover{background:#254b46;color:white}.pfv-nav button.active{background:#2b514a;color:#fff;box-shadow:inset 3px 0 #df8961}
        .pfv-nav svg{width:16px;height:16px;stroke-width:1.7}.pfv-nav .nav-count{margin-left:auto;padding:2px 6px;border-radius:4px;background:#d9835c;color:white;font:10px 'DM Mono',monospace}
        .pfv-sidebar-foot{margin-top:auto;border-top:1px solid #31534d;padding:16px 8px 0}.pfv-prototype{padding:11px 12px;border:1px solid #365951;border-radius:8px;color:#9bb0a5;font-size:10px;line-height:1.6}
        .pfv-prototype strong{display:block;color:#d7e1d8;font-size:10px;margin-bottom:3px}
        .pfv-work{min-width:0;flex:1;display:flex;flex-direction:column}
        .pfv-topbar{height:62px;padding:0 34px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;background:rgba(251,252,248,.7)}
        .pfv-breadcrumb{font-size:11px;color:var(--muted);display:flex;gap:9px;align-items:center}.pfv-breadcrumb strong{color:var(--ink);font-weight:700}
        .pfv-top-actions{display:flex;align-items:center;gap:10px}.pfv-iconbtn{width:32px;height:32px;display:grid;place-items:center;background:transparent;border:1px solid var(--line);border-radius:7px;color:#586e66;position:relative}
        .pfv-iconbtn svg{width:15px}.pfv-dot{position:absolute;right:6px;top:6px;width:5px;height:5px;background:#ce7750;border-radius:50%}
        .pfv-user{display:flex;align-items:center;gap:8px;margin-left:5px}.pfv-avatar{width:29px;height:29px;border-radius:50%;display:grid;place-items:center;background:#e4c4aa;color:#67432f;font-size:10px;font-weight:800}.pfv-user-name{font-size:11px;font-weight:700}.pfv-user-role{font-size:9px;color:var(--muted);margin-top:1px}
        .pfv-main{width:min(1300px,100%);margin:0 auto;padding:35px 38px 45px;flex:1}
        .pfv-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:24px}
        .pfv-eyebrow{display:flex;align-items:center;gap:8px;color:#b26542;text-transform:uppercase;font:10px 'DM Mono',monospace;letter-spacing:.15em;margin-bottom:9px}
        .pfv-eyebrow:before{content:'';width:18px;height:1px;background:#c8754e}
        .pfv-heading h1{font-size:31px;line-height:1.12;letter-spacing:-.055em;margin:0;font-weight:800}
        .pfv-subtitle{font-size:11px;color:var(--muted);margin-top:8px}
        .pfv-primary{display:flex;align-items:center;gap:8px;background:#174e4a;color:#fff;border:0;border-radius:6px;padding:10px 14px;font-size:11px;font-weight:700;box-shadow:0 2px 0 #103d39;transition:transform .15s,background .15s}
        .pfv-primary:hover{background:#23635c;transform:translateY(-1px)}.pfv-primary svg{width:14px;height:14px}
        .pfv-layout{display:grid;grid-template-columns:minmax(0,1fr) 294px;gap:22px;align-items:start}
        .pfv-ledger{min-width:0;border:1px solid var(--line);border-radius:10px;background:var(--card);overflow:hidden}
        .pfv-ledger-head{padding:18px 21px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}
        .pfv-ledger-title{font-size:13px;font-weight:800;letter-spacing:-.02em}.pfv-ledger-note{font-size:10px;color:var(--muted);margin-top:4px}
        .pfv-search{width:210px;height:31px;display:flex;align-items:center;gap:7px;border:1px solid var(--line);background:#fff;border-radius:6px;padding:0 9px;color:#839189}
        .pfv-search svg{width:13px;height:13px;flex:none}.pfv-search input{border:0;outline:none;background:transparent;min-width:0;width:100%;font-size:10px;color:var(--ink)}.pfv-search input::placeholder{color:#9ba59e}
        .pfv-filterbar{display:flex;align-items:center;gap:5px;padding:11px 20px;border-bottom:1px solid var(--line);background:#f8f9f4}
        .pfv-filter{border:0;background:transparent;color:#75827b;padding:6px 9px;border-radius:5px;font-size:10px;transition:all .15s}
        .pfv-filter.active{background:#e2eeea;color:#17524c;font-weight:700}.pfv-filter:hover{color:#174e4a}
        .pfv-filter-all{margin-left:auto;color:#738178;font:9px 'DM Mono',monospace;letter-spacing:.04em}
        .pfv-table-head,.pfv-row{display:grid;grid-template-columns:minmax(190px,1fr) 124px 112px 100px;align-items:center;gap:12px}
        .pfv-table-head{padding:10px 20px;background:#f2f4ed;color:#8a968e;text-transform:uppercase;font:9px 'DM Mono',monospace;letter-spacing:.08em}
        .pfv-row{padding:15px 20px;border-top:1px solid #edf0e9;min-height:72px;transition:background .15s}.pfv-row:hover{background:#f7f8f3}
        .pfv-item{display:flex;align-items:center;gap:12px;min-width:0}.pfv-type-icon{width:32px;height:32px;border-radius:8px;display:grid;place-items:center;flex:none}
        .pfv-type-icon svg{width:15px;height:15px;stroke-width:1.8}.pfv-item-copy{min-width:0}.pfv-item-title{font-size:11px;font-weight:750;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .pfv-item-detail{font-size:9px;color:var(--muted);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .pfv-ref{font:9px 'DM Mono',monospace;color:#829087}.pfv-time{font:9px 'DM Mono',monospace;color:#6f7c74}
        .pfv-amount{text-align:right;font:10px 'DM Mono',monospace;font-weight:500}
        .pfv-empty{padding:38px 20px;text-align:center;color:#75827b;font-size:11px}
        .pfv-empty strong{display:block;color:var(--ink);font-size:12px;margin-bottom:5px}
        .pfv-sidebarcol{display:grid;gap:14px}
        .pfv-spend{padding:19px 19px 17px;background:#e6eee7;border:1px solid #d6e2d8;border-radius:10px;position:relative;overflow:hidden}
        .pfv-spend:after{content:'';position:absolute;width:105px;height:105px;border:1px solid #cad9ce;border-radius:50%;right:-37px;top:-45px;box-shadow:0 0 0 12px rgba(255,255,255,.14),0 0 0 25px rgba(255,255,255,.1)}
        .pfv-card-kicker{font:9px 'DM Mono',monospace;text-transform:uppercase;letter-spacing:.11em;color:#607a6e;display:flex;align-items:center;justify-content:space-between}
        .pfv-spend-amount{font-size:27px;font-weight:800;letter-spacing:-.06em;margin-top:14px;line-height:1}
        .pfv-spend-caption{font-size:10px;color:#6e8175;margin-top:6px}
        .pfv-progress{height:5px;background:#cad9ce;border-radius:9px;margin-top:18px;overflow:hidden}.pfv-progress span{display:block;width:64%;height:100%;background:#39766b;border-radius:9px}
        .pfv-progress-meta{display:flex;justify-content:space-between;font:9px 'DM Mono',monospace;color:#6a8073;margin-top:8px}
        .pfv-statstack{border:1px solid var(--line);border-radius:10px;background:var(--card);overflow:hidden}
        .pfv-stathead{padding:14px 17px;border-bottom:1px solid var(--line);font-size:11px;font-weight:800}
        .pfv-stat{display:flex;align-items:center;justify-content:space-between;padding:13px 17px;border-bottom:1px solid #edf0e9}.pfv-stat:last-child{border:0}
        .pfv-stat-label{font-size:10px;color:#718078;display:flex;align-items:center;gap:8px}.pfv-stat-label svg{width:13px;height:13px;color:#718c7d}
        .pfv-stat-value{font:14px 'DM Mono',monospace;font-weight:500}.pfv-stat-value.warn{color:#b56343}
        .pfv-insight{background:#f5ebe2;border:1px solid #ecddd1;border-radius:10px;padding:16px 17px;display:flex;gap:11px}
        .pfv-insight-icon{width:27px;height:27px;flex:none;display:grid;place-items:center;background:#f0d8c5;border-radius:7px;color:#a75e3b}.pfv-insight-icon svg{width:14px}
        .pfv-insight-title{font-size:10px;font-weight:800;color:#70432f}.pfv-insight-copy{font-size:9px;color:#876f60;line-height:1.6;margin-top:4px}
        .pfv-insight-link{display:inline-flex;align-items:center;gap:5px;margin-top:8px;color:#a35e3e;border:0;background:none;padding:0;font-size:9px;font-weight:700}
        .pfv-insight-link svg{width:12px}
        .pfv-footnote{padding:14px 2px 0;font-size:9px;color:#929d95;display:flex;align-items:center;gap:6px}.pfv-footnote svg{width:12px;height:12px}
        .pfv-modal-backdrop{position:fixed;inset:0;z-index:20;background:rgba(18,43,40,.4);display:grid;place-items:center;padding:20px}
        .pfv-modal{width:min(410px,100%);background:var(--card);border:1px solid var(--line);border-radius:12px;box-shadow:0 24px 80px rgba(15,42,38,.22);padding:22px}
        .pfv-modal-head{display:flex;justify-content:space-between;align-items:flex-start}.pfv-modal h2{font-size:18px;letter-spacing:-.04em;margin:0}.pfv-modal p{font-size:10px;color:var(--muted);margin:6px 0 19px}
        .pfv-close{border:0;background:transparent;color:#7e8b83;padding:2px}.pfv-close svg{width:17px}
        .pfv-field{display:grid;gap:6px;margin-bottom:12px}.pfv-field label{font-size:9px;color:#718078;font-weight:700}.pfv-field input{height:36px;border:1px solid var(--line);border-radius:6px;background:white;padding:0 10px;outline:none;font-size:11px}.pfv-field input:focus{border-color:#4b8276}
        .pfv-modal-submit{width:100%;justify-content:center;margin-top:5px}.pfv-success{background:#e5f2ed;border:1px solid #cce1d7;padding:12px;border-radius:7px;color:#18584e;font-size:11px;display:flex;gap:8px;align-items:center}.pfv-success svg{width:15px}
        @media(max-width:1050px){.pfv-sidebar{width:190px}.pfv-main{padding:28px 24px}.pfv-layout{grid-template-columns:minmax(0,1fr) 260px}.pfv-topbar{padding:0 24px}.pfv-table-head,.pfv-row{grid-template-columns:minmax(150px,1fr) 95px 90px 90px;gap:8px}}
        @media(max-width:760px){.pfv{display:block}.pfv-sidebar{width:auto;padding:12px 15px;display:block}.pfv-brand{padding:0 4px 12px}.pfv-brandline,.pfv-section-label,.pfv-sidebar-foot{display:none}.pfv-nav{display:flex;overflow:auto;gap:4px}.pfv-nav button{white-space:nowrap;padding:8px 10px;font-size:10px}.pfv-nav svg{width:14px;height:14px}.pfv-topbar{height:50px;padding:0 16px}.pfv-user-copy{display:none}.pfv-main{padding:25px 16px 36px}.pfv-heading{align-items:flex-start;flex-direction:column;margin-bottom:19px}.pfv-heading h1{font-size:27px}.pfv-primary{width:100%;justify-content:center}.pfv-layout{grid-template-columns:1fr;gap:14px}.pfv-sidebarcol{grid-template-columns:1fr 1fr;align-items:start}.pfv-insight{grid-column:1/-1}.pfv-spend{min-height:158px}.pfv-table-head{display:none}.pfv-row{grid-template-columns:minmax(0,1fr) auto;gap:6px 8px;padding:13px 14px;min-height:0}.pfv-item{grid-row:span 2}.pfv-ref{display:none}.pfv-time{text-align:right}.pfv-amount{grid-column:2;text-align:right}.pfv-ledger-head{padding:15px 14px 12px;display:block}.pfv-ledger-head .pfv-search{width:100%;margin-top:12px}.pfv-filterbar{overflow:auto;padding:9px 10px}.pfv-filter{white-space:nowrap;padding:6px 8px}.pfv-filter-all{display:none}}
        @media(max-width:390px){.pfv-sidebarcol{grid-template-columns:1fr}.pfv-insight{grid-column:auto}.pfv-spend{min-height:0}.pfv-nav button{gap:7px}}
      `}</style>

      <aside className="pfv-sidebar">
        <div className="pfv-brand">
          <div className="pfv-brandmark">P.</div>
          <div><div className="pfv-brandname">ProcureFlow</div><div className="pfv-brandline">buying ledger</div></div>
        </div>
        <div className="pfv-section-label">Workspace</div>
        <nav className="pfv-nav" aria-label="Workspace navigation">
          {[
            { name: "Overview", icon: LayoutDashboard },
            { name: "Requests", icon: ShoppingBag },
            { name: "Approvals", icon: Stamp, count: "3" },
            { name: "Invoices", icon: FileText },
            { name: "Insights", icon: Sparkles },
          ].map(({ name, icon: Icon, count }) => (
            <button key={name} className={activeNav === name ? "active" : ""} onClick={() => setActiveNav(name)}>
              <Icon /><span>{name}</span>{count && <span className="nav-count">{count}</span>}
            </button>
          ))}
        </nav>
        <div className="pfv-sidebar-foot">
          <div className="pfv-prototype"><strong>Demo workspace</strong>Supplier quotes are illustrative. Invoices are internal records and are not sent externally.</div>
        </div>
      </aside>

      <section className="pfv-work">
        <header className="pfv-topbar">
          <div className="pfv-breadcrumb"><span>Procurement</span><span>/</span><strong>{activeNav}</strong></div>
          <div className="pfv-top-actions">
            <button className="pfv-iconbtn" aria-label="Search"><Search /></button>
            <button className="pfv-iconbtn" aria-label="Notifications"><Bell /><i className="pfv-dot" /></button>
            <button className="pfv-iconbtn" aria-label="Workspace settings"><Settings2 /></button>
            <div className="pfv-user"><div className="pfv-avatar">AT</div><div className="pfv-user-copy"><div className="pfv-user-name">Amira Tan</div><div className="pfv-user-role">Workspace admin</div></div><ChevronDown size={13} color="#87938b" /></div>
          </div>
        </header>

        <main className="pfv-main">
          <div className="pfv-heading">
            <div>
              <div className="pfv-eyebrow">Tuesday, 18 June 2024 <span style={{ color: "#aab3ab" }}>·</span> Buying desk</div>
              <h1>Buying activity</h1>
              <div className="pfv-subtitle">A clear view of what’s moving across your purchasing desk.</div>
            </div>
            <button className="pfv-primary" onClick={() => { setShowNew(true); setSaved(false); }}><Plus /> New requirement <ArrowUpRight size={13} /></button>
          </div>

          <div className="pfv-layout">
            <section className="pfv-ledger" aria-label="Recent activity">
              <div className="pfv-ledger-head">
                <div><div className="pfv-ledger-title">Recent activity</div><div className="pfv-ledger-note">Latest changes across requests, approvals and invoices</div></div>
                <label className="pfv-search"><Search /><input aria-label="Search activity" placeholder="Search the ledger" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
              </div>
              <div className="pfv-filterbar">
                {["Everything", "Quotes", "Approved", "Invoice", "Needs review"].map((name) => (
                  <button key={name} className={`pfv-filter ${filter === name ? "active" : ""}`} onClick={() => setFilter(name)}>{name}</button>
                ))}
                <span className="pfv-filter-all">{visibleActivities.length} ENTRIES</span>
              </div>
              <div className="pfv-table-head"><span>Activity</span><span>Reference</span><span>Updated</span><span style={{ textAlign: "right" }}>Value</span></div>
              {visibleActivities.length ? visibleActivities.map((item) => {
                const kind = kindStyles[item.kind];
                const Icon = item.kind === "approved" ? Check : item.kind === "invoice" ? FileText : item.kind === "review" ? Clock3 : ShoppingBag;
                return (
                  <article className="pfv-row" key={item.id}>
                    <div className="pfv-item">
                      <div className="pfv-type-icon" style={{ background: kind.bg, color: kind.color }}><Icon /></div>
                      <div className="pfv-item-copy"><div className="pfv-item-title">{item.title}</div><div className="pfv-item-detail">{item.detail}</div></div>
                    </div>
                    <span className="pfv-ref">{item.id}</span>
                    <span className="pfv-time">{item.day} · {item.time}</span>
                    <span className="pfv-amount">{item.amount}</span>
                  </article>
                );
              }) : <div className="pfv-empty"><strong>No activity found</strong>Try another keyword or choose a different filter.</div>}
            </section>

            <aside className="pfv-sidebarcol">
              <section className="pfv-spend">
                <div className="pfv-card-kicker"><span>Budget position</span><CircleDollarSign size={15} /></div>
                <div className="pfv-spend-amount">MYR 38,420</div>
                <div className="pfv-spend-caption">of MYR 60,000 monthly plan</div>
                <div className="pfv-progress"><span /></div>
                <div className="pfv-progress-meta"><span>64% committed</span><span>MYR 21,580 left</span></div>
              </section>
              <section className="pfv-statstack">
                <div className="pfv-stathead">At a glance <span style={{ color: "#93a098", fontWeight: 500 }}>· June</span></div>
                <div className="pfv-stat"><span className="pfv-stat-label"><ShoppingBag /> Active requests</span><strong className="pfv-stat-value">12</strong></div>
                <div className="pfv-stat"><span className="pfv-stat-label"><Clock3 /> Awaiting approval</span><strong className="pfv-stat-value warn">03</strong></div>
                <div className="pfv-stat"><span className="pfv-stat-label"><Check /> Approved this month</span><strong className="pfv-stat-value">18</strong></div>
                <div className="pfv-stat"><span className="pfv-stat-label"><ArrowDownRight /> Saved vs. budget</span><strong className="pfv-stat-value">MYR 2.8k</strong></div>
              </section>
              <section className="pfv-insight">
                <div className="pfv-insight-icon"><Sparkles /></div>
                <div><div className="pfv-insight-title">A useful pattern</div><div className="pfv-insight-copy">Office essentials are averaging 8% below plan this month.</div><button className="pfv-insight-link" onClick={() => setActiveNav("Insights")}>View supplier insights <ArrowRight /></button></div>
              </section>
              <div className="pfv-footnote"><Clock3 /> Updated just now <span>·</span> Refreshes automatically</div>
            </aside>
          </div>
        </main>
      </section>

      {showNew && <div className="pfv-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowNew(false); }}>
        <section className="pfv-modal" role="dialog" aria-modal="true" aria-labelledby="pfv-modal-title">
          <div className="pfv-modal-head"><div><h2 id="pfv-modal-title">New requirement</h2><p>Start a request and invite supplier quotes.</p></div><button className="pfv-close" aria-label="Close" onClick={() => setShowNew(false)}><X /></button></div>
          {saved ? <div className="pfv-success"><Check /> Requirement saved to your draft list.</div> : <form onSubmit={(e) => { e.preventDefault(); setSaved(true); }}>
            <div className="pfv-field"><label htmlFor="item">What do you need?</label><input id="item" required minLength={2} placeholder="e.g. A4 copier paper" /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}><div className="pfv-field"><label htmlFor="qty">Quantity</label><input id="qty" type="number" min="1" defaultValue="1" required /></div><div className="pfv-field"><label htmlFor="budget">Total budget (MYR)</label><input id="budget" type="number" min="1" placeholder="1,200" required /></div></div>
            <div className="pfv-field"><label htmlFor="needed">Needed by</label><input id="needed" type="date" required /></div>
            <button className="pfv-primary pfv-modal-submit" type="submit"><Plus /> Save requirement</button>
          </form>}
        </section>
      </div>}
    </div>
  );
}
