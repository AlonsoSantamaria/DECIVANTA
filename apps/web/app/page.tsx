"use client";

import { useMemo, useState } from "react";
import { canRecordExecutiveAction, mergeEvidenceKinds } from "./judge-view-model";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
const SESSION_KEY = "decivanta-demo-session";

type OrionSnapshot = {
  runId: string;
  status: "COMPLETED" | "GUIDANCE_UNAVAILABLE";
  conflictDetected: boolean;
  facts: { authorizedCapex: string; committedOpeningDate: string; standardAdditionalCapex: string; standardDelayDays: number; acceleratedAdditionalCapex: string; acceleratedProtectsDate: boolean };
  evidence: Array<{ epistemicType: string; sourceType: string }>;
  guidance: { status: "GUIDANCE_AVAILABLE"; recommendedAction: string; summary: string; explanation: string; uncertaintyStatement: string } | { status: "GUIDANCE_UNAVAILABLE"; failureReason: string };
};

type ExternalSnapshot = {
  event: { eventCode: string; title: string; sourcePublisher: string; sourceUrl: string; publishedDate: string; effectiveDate: string; priorRatePercent: string; currentRatePercent: string };
  relevance: { relevant: boolean; connectedToBusinessContext: boolean };
  businessContext: { name: string; authorizedCapex: string; committedOpeningDate: string; retrievedTypes: string[] };
  potentialImpact: { cost: boolean; schedule: boolean; quantified: boolean };
  executiveAttentionRequired: boolean;
  guidance: { recommendedAction: string; summary: string; potentialImpact: string; uncertaintyStatement: string };
};

type Result = { orion: OrionSnapshot; external: ExternalSnapshot };
type Recorded = { nextReviewDate: string; types: string[] };

function money(value: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value));
}

function futureDate(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!API_BASE) throw new Error("Public API configuration is unavailable.");
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { "content-type": "application/json", ...(options.headers ?? {}) } });
  const body = await response.json().catch(() => ({ status: "INVALID_RESPONSE" })) as { status?: string };
  if (!response.ok) throw new Error(body.status === "GUIDANCE_UNAVAILABLE" ? "Executive guidance is temporarily unavailable." : "DECIVANTA could not complete this step. Please try again.");
  return body as T;
}

async function sessionToken(): Promise<string> {
  const stored = window.localStorage.getItem(SESSION_KEY);
  if (stored) return stored;
  const created = await api<{ sessionToken: string }>("/v1/demo/sessions", { method: "POST", body: "{}" });
  window.localStorage.setItem(SESSION_KEY, created.sessionToken);
  return created.sessionToken;
}

async function createSessionToken(): Promise<string> {
  const created = await api<{ sessionToken: string }>("/v1/demo/sessions", { method: "POST", body: "{}" });
  window.localStorage.setItem(SESSION_KEY, created.sessionToken);
  return created.sessionToken;
}

function Label({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "gold" | "neutral" | "verified" }) {
  return <span className={`label label-${tone}`}>{children}</span>;
}

export default function Home() {
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "recording" | "recorded" | "error">("idle");
  const [progress, setProgress] = useState("Ready to monitor");
  const [result, setResult] = useState<Result | null>(null);
  const [recorded, setRecorded] = useState<Recorded | null>(null);
  const [error, setError] = useState("");
  const [nextReviewDate, setNextReviewDate] = useState(futureDate(7));

  const guidanceAvailable = result ? canRecordExecutiveAction(result.orion.guidance.status) : false;
  const evidenceKinds = useMemo(() => result ? mergeEvidenceKinds(result.orion.evidence.map((item) => item.epistemicType),result.external.businessContext.retrievedTypes) : [], [result]);

  async function runWatch() {
    setPhase("loading"); setError(""); setRecorded(null);
    try {
      const token = await createSessionToken();
      const headers = { authorization: `Bearer ${token}` };
      setProgress("Reviewing active ORION commitments");
      const orion = await api<{ snapshot: OrionSnapshot }>("/v1/missions/orion/reviews", { method: "POST", headers, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) });
      setProgress("Receiving verified external signal");
      await api("/v1/missions/orion/external-events", { method: "POST", headers, body: "{}" });
      setProgress("Connecting the signal to executive memory");
      const external = await api<{ snapshot: ExternalSnapshot }>("/v1/missions/orion/external-intelligence-reviews", { method: "POST", headers, body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) });
      setResult({ orion: orion.snapshot, external: external.snapshot });
      setProgress("Executive attention required"); setPhase("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "DECIVANTA could not complete the watch.");
      setPhase("error");
    }
  }

  async function recordAction() {
    if (!result || !guidanceAvailable) return;
    setPhase("recording"); setError("");
    try {
      const token = await sessionToken();
      const headers = { authorization: `Bearer ${token}` };
      await api("/v1/missions/orion/actions", { method: "POST", headers, body: JSON.stringify({ runId: result.orion.runId, nextReviewDate, idempotencyKey: crypto.randomUUID() }) });
      const context = await api<{ nextReviewDate: string; types: string[] }>("/v1/missions/orion/context-retrievals", { method: "POST", headers, body: "{}" });
      setRecorded({ nextReviewDate: context.nextReviewDate, types: context.types });
      setPhase("recorded");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The executive action could not be recorded.");
      setPhase("ready");
    }
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="DECIVANTA home">DECIVANTA<span>.</span></a>
        <div className="topbar-meta"><span className="live-dot" /> Executive intelligence watch</div>
      </header>

      <section className="hero" id="top">
        <div>
          <Label tone="gold">Synthetic demonstration data</Label>
          <p className="eyebrow">Longitudinal executive intelligence</p>
          <h1>She acts because<br />she remembers.</h1>
          <p className="hero-copy">DECIVANTA watches changing conditions, reconnects them to the decisions they affect, and brings the right issue back to executive attention.</p>
        </div>
        <aside className="watch-card" aria-live="polite">
          <div className="watch-card-head"><span>ORION INDUSTRIAL PARK</span><Label tone={phase === "ready" || phase === "recorded" ? "gold" : "verified"}>{phase === "ready" || phase === "recorded" ? "ATTENTION" : "MONITORING"}</Label></div>
          <p className="watch-status">{progress}</p>
          <p className="watch-detail">One verified signal. One remembered business context. One accountable next step.</p>
          <button className="primary" onClick={runWatch} disabled={phase === "loading" || phase === "recording"}>{phase === "loading" ? "DECIVANTA is reviewing…" : result ? "Run watch again" : "Run executive watch"}<span aria-hidden="true">→</span></button>
          {error && <p className="error" role="alert">{error}</p>}
        </aside>
      </section>

      {result && <div className="experience" aria-live="polite">
        <section className="attention panel-accent">
          <div className="section-number">01</div>
          <div className="section-body">
            <div className="section-heading"><p className="eyebrow">Attention</p><Label tone="gold">Executive review required</Label></div>
            <h2>A verified tariff change may alter the ORION procurement decision.</h2>
            <p className="lead">{result.external.guidance.summary}</p>
            <div className="signal-line"><span className="signal-icon">↗</span><div><strong><a href={result.external.event.sourceUrl} target="_blank" rel="noreferrer">{result.external.event.title}</a></strong><span>{result.external.event.sourcePublisher} · Effective {result.external.event.effectiveDate}</span></div></div>
          </div>
        </section>

        <section className="split-section">
          <div className="section-number">02</div>
          <div className="section-body">
            <p className="eyebrow">Context</p>
            <h2>The decision this signal touches.</h2>
            <div className="context-grid">
              <article><span>Business case</span><strong>{result.external.businessContext.name}</strong><p>First building operational in time to receive the client&apos;s first tenant.</p></article>
              <article><span>Authorized CAPEX</span><strong>{money(result.orion.facts.authorizedCapex)}</strong><p>Approved capital envelope currently under watch.</p></article>
              <article><span>Committed opening</span><strong>{result.orion.facts.committedOpeningDate}</strong><p>Schedule protection is the critical objective.</p></article>
            </div>
          </div>
        </section>

        <section className="split-section evidence-section">
          <div className="section-number">03</div>
          <div className="section-body">
            <p className="eyebrow">Evidence &amp; memory trace</p>
            <h2>Why DECIVANTA connected the signal.</h2>
            <div className="memory-grid">
              <article><Label>Fact</Label><p>The client previously rejected a general CAPEX increase.</p></article>
              <article><Label>Decision</Label><p>The client later accepted added cost when it protected the committed opening date.</p></article>
              <article><Label>Observed pattern</Label><p>Cost tolerance appears conditional on schedule protection—not a permanent preference.</p></article>
            </div>
            <details>
              <summary>View technical evidence <span>Managed MCP · vector memory · Bedrock</span></summary>
              <ol className="trace">
                <li><span>Signal received</span><strong>{result.external.event.eventCode}</strong></li>
                <li><span>Memory retrieved</span><strong>{evidenceKinds.join(" · ")}</strong></li>
                <li><span>Business context connected</span><strong>CockroachDB canonical records</strong></li>
                <li><span>Potential impact evaluated</span><strong>Deterministic policy</strong></li>
                <li><span>Recommendation generated</span><strong>Amazon Bedrock</strong></li>
              </ol>
            </details>
          </div>
        </section>

        <section className="split-section">
          <div className="section-number">04</div>
          <div className="section-body">
            <p className="eyebrow">Potential impact</p>
            <h2>Material exposure is possible, not yet quantified.</h2>
            <div className="impact-grid">
              <article><span className="impact-icon">$</span><div><strong>Cost exposure</strong><p>Covered steel inputs may increase procurement cost.</p></div><Label tone="gold">Potential</Label></article>
              <article><span className="impact-icon">◷</span><div><strong>Schedule exposure</strong><p>Supplier or sourcing changes may affect the committed date.</p></div><Label tone="gold">Potential</Label></article>
            </div>
            <p className="uncertainty"><strong>What remains unknown:</strong> {result.external.guidance.uncertaintyStatement}</p>
          </div>
        </section>

        <section className="split-section recommendation">
          <div className="section-number">05</div>
          <div className="section-body">
            <p className="eyebrow">Recommendation</p>
            {guidanceAvailable ? <><h2>Review ORION&apos;s procurement exposure before preserving the current path.</h2><p className="lead">{result.external.guidance.potentialImpact}</p><div className="recommendation-rule"><span>DECIVANTA recommends</span><strong>Present both procurement alternatives and request verified supplier exposure.</strong></div></> : <div className="degraded"><Label tone="gold">Guidance temporarily unavailable</Label><h2>The verified evidence remains available.</h2><p>DECIVANTA preserved the retrieved memory and deterministic impact assessment. No recommendation was fabricated. Run the watch again to retry guidance.</p></div>}
          </div>
        </section>

        <section className="action-panel">
          <div><p className="eyebrow">06 · Executive action</p><h2>The decision remains yours.</h2><p>Record the next step and DECIVANTA will preserve it as institutional memory.</p></div>
          <div className="action-form">
            <label><span>Selected action</span><strong>Review procurement exposure with the client</strong></label>
            <label htmlFor="next-review"><span>Next executive review</span><input id="next-review" type="date" min={futureDate(1)} value={nextReviewDate} onChange={(event)=>setNextReviewDate(event.target.value)} /></label>
            <button className="primary" onClick={recordAction} disabled={!guidanceAvailable || phase === "recording" || phase === "recorded"}>{phase === "recording" ? "Recording…" : phase === "recorded" ? "Action recorded" : "Record executive action"}<span aria-hidden="true">→</span></button>
            {!guidanceAvailable && <small>Action recording is disabled until validated guidance is available.</small>}
          </div>
        </section>

        {recorded && <section className="follow-up">
          <div className="success-mark">✓</div><div><p className="eyebrow">07 · Follow-up</p><h2>DECIVANTA will remember this.</h2><p>The executive decision, authorization condition, commitment, and next review were persisted and retrieved from memory.</p><div className="follow-up-meta"><span>Next review <strong>{recorded.nextReviewDate}</strong></span><span>Memory types <strong>{recorded.types.join(" · ")}</strong></span></div></div>
        </section>}
      </div>}

      <footer><span>DECIVANTA</span><p>Executive intelligence with traceable memory and human authority.</p><div><span>CockroachDB</span><span>AWS Bedrock</span></div></footer>
    </main>
  );
}
