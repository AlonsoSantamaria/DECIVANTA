"use client";

import { useState } from "react";
import { canRecordExecutiveAction, mergeEvidenceKinds } from "./judge-view-model";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");
const SESSION_KEY = "decivanta-demo-session";

type MissionId = "external" | "business" | "financial";
type Phase = "ready" | "loading" | "verified" | "recording" | "recorded" | "error";
type OrionSnapshot = { runId:string; status:"COMPLETED"|"GUIDANCE_UNAVAILABLE"; conflictDetected:boolean; facts:{authorizedCapex:string;committedOpeningDate:string;standardAdditionalCapex:string;standardDelayDays:number;acceleratedAdditionalCapex:string;acceleratedProtectsDate:boolean}; evidence:Array<{epistemicType:string;sourceType:string}>; guidance:{status:"GUIDANCE_AVAILABLE";recommendedAction:string;summary:string;explanation:string;uncertaintyStatement:string}|{status:"GUIDANCE_UNAVAILABLE";failureReason:string} };
type ExternalSnapshot = { event:{eventCode:string;title:string;sourcePublisher:string;sourceUrl:string;publishedDate:string;effectiveDate:string;priorRatePercent:string;currentRatePercent:string}; relevance:{relevant:boolean;connectedToBusinessContext:boolean}; businessContext:{name:string;authorizedCapex:string;committedOpeningDate:string;retrievedTypes:string[]}; potentialImpact:{cost:boolean;schedule:boolean;quantified:boolean}; executiveAttentionRequired:boolean; guidance:{recommendedAction:string;summary:string;potentialImpact:string;uncertaintyStatement:string} };
type FinancialSnapshot = { conditionMet:boolean;decisionCode:string;guidanceStatus:"GUIDANCE_AVAILABLE";observed:string;recommendation:"REQUEST_REVISED_SCENARIO";reviewRunId:string;shortfall:string;status:"COMPLETED";threshold:string;variance:string };
type LiveResults = { external?:ExternalSnapshot; business?:OrionSnapshot; financial?:FinancialSnapshot };
type FollowUp = { mission:MissionId; nextReviewDate:string; types?:string[] };

const missions: Array<{id:MissionId;number:string;kicker:string;status:string;headline:string;dek:string}> = [
  {id:"external",number:"01",kicker:"External Intelligence · ORION",status:"ATTENTION REQUIRED",headline:"External development may affect a critical ORION assumption.",dek:"A verified tariff change may create cost or schedule exposure."},
  {id:"business",number:"02",kicker:"Business Case Watch · ORION",status:"ACTION REQUIRED",headline:"Current procurement decision presents a cost/schedule trade-off.",dek:"Sarah remembers when the client accepted cost to protect schedule."},
  {id:"financial",number:"03",kicker:"Financial Oversight",status:"REVIEW REQUIRED",headline:"Forecast is USD 1.3M below the executive threshold.",dek:"A condition supporting the Project Atlas decision is no longer met."},
];

function futureDate(days:number){const date=new Date();date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function money(value:string){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(value));}
async function api<T>(path:string,options:RequestInit={}){if(!API_BASE)throw new Error("Public API configuration is unavailable.");const response=await fetch(`${API_BASE}${path}`,{...options,headers:{"content-type":"application/json",...(options.headers??{})}});const body=await response.json().catch(()=>({status:"INVALID_RESPONSE"})) as {status?:string};if(!response.ok)throw new Error(body.status==="GUIDANCE_UNAVAILABLE"?"Executive guidance is temporarily unavailable.":"Sarah could not verify this brief. Please try again.");return body as T;}
async function sessionToken(){const stored=window.localStorage.getItem(SESSION_KEY);if(stored)return stored;const created=await api<{sessionToken:string}>("/v1/demo/sessions",{method:"POST",body:"{}"});window.localStorage.setItem(SESSION_KEY,created.sessionToken);return created.sessionToken;}

function Label({children,tone="neutral"}:{children:React.ReactNode;tone?:"gold"|"neutral"|"verified"}){return <span className={`label label-${tone}`}>{children}</span>}
function TechnicalTrace({items}:{items:Array<[string,string]>}){return <details className="technical-trace"><summary>How DECIVANTA reached this conclusion <span>Technical trace</span></summary><ol>{items.map(([label,value])=><li key={label}><span>{label}</span><strong>{value}</strong></li>)}</ol><div className="sponsor-line"><span>CockroachDB</span><span>Managed MCP</span><span>Vector search</span><span>Amazon Titan</span><span>Amazon Nova</span><span>AWS Lambda</span></div></details>}

export default function Home(){
  const [selected,setSelected]=useState<MissionId|null>(null);
  const [phases,setPhases]=useState<Record<MissionId,Phase>>({external:"ready",business:"ready",financial:"ready"});
  const [live,setLive]=useState<LiveResults>({});
  const [error,setError]=useState("");
  const [nextReviewDate,setNextReviewDate]=useState(futureDate(7));
  const [followUp,setFollowUp]=useState<FollowUp|null>(null);

  function phaseFor(id:MissionId){return phases[id]}
  function updatePhase(id:MissionId,phase:Phase){setPhases(current=>({...current,[id]:phase}))}
  function openMission(id:MissionId){setSelected(id);setError("");setTimeout(()=>document.getElementById("mission-detail")?.scrollIntoView({behavior:"smooth",block:"start"}),0)}

  async function verifyMission(id:MissionId){
    updatePhase(id,"loading");setError("");setFollowUp(null);
    try{
      const token=await sessionToken();const headers={authorization:`Bearer ${token}`};
      if(id==="financial"){
        const response=await api<{snapshot:FinancialSnapshot}>("/v1/demo/reviews",{method:"POST",headers,body:JSON.stringify({idempotencyKey:crypto.randomUUID()})});
        setLive(current=>({...current,financial:response.snapshot}));
      }else if(id==="business"){
        const response=await api<{snapshot:OrionSnapshot}>("/v1/missions/orion/reviews",{method:"POST",headers,body:JSON.stringify({idempotencyKey:crypto.randomUUID()})});
        setLive(current=>({...current,business:response.snapshot}));
      }else{
        const business=await api<{snapshot:OrionSnapshot}>("/v1/missions/orion/reviews",{method:"POST",headers,body:JSON.stringify({idempotencyKey:crypto.randomUUID()})});
        await api("/v1/missions/orion/external-events",{method:"POST",headers,body:"{}"});
        const external=await api<{snapshot:ExternalSnapshot}>("/v1/missions/orion/external-intelligence-reviews",{method:"POST",headers,body:JSON.stringify({idempotencyKey:crypto.randomUUID()})});
        setLive(current=>({...current,business:business.snapshot,external:external.snapshot}));
      }
      updatePhase(id,"verified");
    }catch(caught){setError(caught instanceof Error?caught.message:"Sarah could not verify this brief.");updatePhase(id,"error")}
  }

  async function recordBusinessAction(mission:MissionId){
    const business=live.business;if(!business||business.guidance.status!=="GUIDANCE_AVAILABLE")return;
    updatePhase(mission,"recording");setError("");
    try{const token=await sessionToken();const headers={authorization:`Bearer ${token}`};await api("/v1/missions/orion/actions",{method:"POST",headers,body:JSON.stringify({runId:business.runId,nextReviewDate,idempotencyKey:crypto.randomUUID()})});const context=await api<{nextReviewDate:string;types:string[]}>("/v1/missions/orion/context-retrievals",{method:"POST",headers,body:"{}"});setFollowUp({mission,nextReviewDate:context.nextReviewDate,types:context.types});updatePhase(mission,"recorded");}catch(caught){setError(caught instanceof Error?caught.message:"The executive action could not be recorded.");updatePhase(mission,"verified")}
  }

  async function recordFinancialAction(){
    if(!live.financial)return;updatePhase("financial","recording");setError("");
    try{const token=await sessionToken();const headers={authorization:`Bearer ${token}`};await api("/v1/demo/responses",{method:"POST",headers,body:JSON.stringify({action:"REQUEST_REVISED_SCENARIO",idempotencyKey:crypto.randomUUID(),nextReviewDate,note:"Prepare revised cash scenario for executive review.",reviewRunId:live.financial.reviewRunId})});setFollowUp({mission:"financial",nextReviewDate});updatePhase("financial","recorded");}catch(caught){setError(caught instanceof Error?caught.message:"The executive action could not be recorded.");updatePhase("financial","verified")}
  }

  const verifiedExternal=live.external;const verifiedBusiness=live.business;const verifiedFinancial=live.financial;
  const evidenceKinds=verifiedExternal&&verifiedBusiness?mergeEvidenceKinds(verifiedBusiness.evidence.map(item=>item.epistemicType),verifiedExternal.businessContext.retrievedTypes):["FACT","DECISION","INFERENCE"];

  return <main>
    <header className="topbar"><a className="brand" href="#top">DECIVANTA<span>.</span></a><div className="agent-id"><span className="live-dot"/><strong>Sarah</strong><span>Executive Intelligence Agent</span></div></header>

    <section className="front-page" id="top">
      <div className="masthead"><div><Label tone="gold">Synthetic demonstration data</Label><p className="eyebrow">Good morning</p><h1>I&apos;ve been monitoring<br/>what matters to you.</h1><p className="intro">I found <strong>3 items</strong> worth your attention today.</p></div><div className="promise"><span>DECIVANTA</span><em>She acts because she remembers.</em></div></div>
      <div className="brief-heading"><div><span>Executive intelligence · Today</span><h2>Today&apos;s Executive Brief</h2></div><p>Three developments. Connected to the decisions, assumptions, and commitments they affect.</p></div>
      <div className="mission-grid">{missions.map(mission=><button key={mission.id} className={`mission-card mission-${mission.id}`} onClick={()=>openMission(mission.id)} aria-expanded={selected===mission.id}>
        <div className="card-top"><span>{mission.number}</span><Label tone="gold">{mission.status}</Label></div><p className="card-kicker">{mission.kicker}</p><h3>{mission.headline}</h3><p>{mission.dek}</p><div className="card-link">Open executive brief <span>→</span></div>
      </button>)}</div>
    </section>

    {selected&&<section className="mission-detail" id="mission-detail" aria-live="polite">
      <div className="detail-toolbar"><button onClick={()=>setSelected(null)}>← Today&apos;s brief</button><span>{missions.find(item=>item.id===selected)?.kicker}</span><Label tone={phaseFor(selected)==="verified"||phaseFor(selected)==="recorded"?"verified":"gold"}>{phaseFor(selected)==="verified"||phaseFor(selected)==="recorded"?"LIVE EVIDENCE VERIFIED":missions.find(item=>item.id===selected)?.status}</Label></div>

      {selected==="external"&&<div className="detail-story">
        <section className="story-lead"><p className="eyebrow">What happened</p><h2>A verified tariff change may alter the ORION procurement decision.</h2><p>{verifiedExternal?.guidance.summary??"The United States increased the tariff on covered steel articles and derivatives from 25% to 50%."}</p><a href={verifiedExternal?.event.sourceUrl??"https://www.federalregister.gov/documents/2025/06/09/2025-10524/adjusting-imports-of-aluminum-and-steel-into-the-united-states"} target="_blank" rel="noreferrer">Federal Register · verified source ↗</a></section>
        <StoryGrid items={[["Why it matters","ORION has an approved capital budget, a committed opening date, and an active procurement trade-off."],["What Sarah remembers","The client accepts added cost only when it protects the committed opening date."],["Potential impact","Steel exposure may affect procurement cost or schedule; supplier classification remains unknown."]]}/>
        <Memory evidenceKinds={evidenceKinds}/>
        <Guidance title="Review ORION procurement exposure before preserving the current path." body={verifiedExternal?.guidance.potentialImpact??"Confirm supplier origin, tariff classification, and contractual allocation before committing to a procurement path."}/>
        <ActionPanel phase={phaseFor("external")} verified={Boolean(verifiedExternal&&verifiedBusiness&&canRecordExecutiveAction(verifiedBusiness.guidance.status))} nextReviewDate={nextReviewDate} setNextReviewDate={setNextReviewDate} onVerify={()=>verifyMission("external")} onRecord={()=>recordBusinessAction("external")}/>
        <TechnicalTrace items={[["External event","Federal Register source"],["Relevance retrieval","CockroachDB vector memory"],["Governed access","CockroachDB Managed MCP"],["Embeddings","Amazon Titan Text Embeddings V2"],["Guidance","Amazon Nova via Bedrock"],["Execution","API Gateway · AWS Lambda"]]}/>
      </div>}

      {selected==="business"&&<div className="detail-story">
        <section className="story-lead"><p className="eyebrow">What changed</p><h2>The current procurement decision exposes a cost/schedule trade-off.</h2><p>Standard procurement protects CAPEX but may delay opening. Accelerated procurement adds USD 310K and protects the committed date.</p></section>
        <StoryGrid items={[["Why it matters","ORION's first building must open by March 15, 2027 to receive the client's first tenant."],["What Sarah remembers","The client rejected a general increase, then accepted cost specifically to protect schedule."],["Potential impact",`${money(verifiedBusiness?.facts.standardAdditionalCapex??"120000")} standard premium with a 45-day delay, versus ${money(verifiedBusiness?.facts.acceleratedAdditionalCapex??"310000")} to protect the date.`]]}/>
        <Memory evidenceKinds={verifiedBusiness?.evidence.map(item=>item.epistemicType)??["FACT","DECISION","INFERENCE"]}/>
        {verifiedBusiness?.guidance.status==="GUIDANCE_UNAVAILABLE"?<GuidanceUnavailable/>:<Guidance title="Present both alternatives and recommend accelerated procurement." body={verifiedBusiness?.guidance.explanation??"Make the authorization condition explicit: the additional CAPEX requires written client approval."}/>} 
        <ActionPanel phase={phaseFor("business")} verified={Boolean(verifiedBusiness&&canRecordExecutiveAction(verifiedBusiness.guidance.status))} nextReviewDate={nextReviewDate} setNextReviewDate={setNextReviewDate} onVerify={()=>verifyMission("business")} onRecord={()=>recordBusinessAction("business")}/>
        <TechnicalTrace items={[["Business context","Canonical CockroachDB records"],["Memory retrieval","Managed MCP vector search"],["Decision relation","Deterministic mission policy"],["Guidance","Amazon Nova via Bedrock"],["Persistence","CockroachDB SQL transaction"]]}/>
      </div>}

      {selected==="financial"&&<div className="detail-story">
        <section className="story-lead"><p className="eyebrow">What changed</p><h2>Projected cash is USD 1.3M below the Board-approved threshold.</h2><p>The updated forecast is {money(verifiedFinancial?.observed??"3200000")}. The decision condition requires at least {money(verifiedFinancial?.threshold??"4500000")}.</p></section>
        <StoryGrid items={[["Why it matters","The cash threshold was an explicit condition supporting Project Atlas acceleration."],["What Sarah remembers","BOARD-2026-017 authorized acceleration only while projected cash remained at or above USD 4.5M."],["Potential impact","The essential premise is not met. Continuing without review would depart from the Board's recorded condition."]]}/>
        <Memory evidenceKinds={["FACT","ASSUMPTION","DECISION","CALCULATION"]}/>
        <Guidance title="Request a revised scenario before continuing Project Atlas acceleration." body="Preserve the verified calculation, bring the threshold breach to executive attention, and schedule the next review."/>
        <ActionPanel phase={phaseFor("financial")} verified={Boolean(verifiedFinancial)} nextReviewDate={nextReviewDate} setNextReviewDate={setNextReviewDate} onVerify={()=>verifyMission("financial")} onRecord={recordFinancialAction}/>
        <TechnicalTrace items={[["New signal","Updated cash forecast"],["Decision memory","BOARD-2026-017 via vector retrieval"],["Calculation","USD 3.2M − USD 4.5M = −USD 1.3M"],["Guidance","Amazon Nova via Bedrock"],["Audit trail","CockroachDB SQL + Memory Trace"]]}/>
      </div>}

      {error&&<p className="error" role="alert">{error}</p>}
      {followUp?.mission===selected&&<section className="follow-up"><div className="success-mark">✓</div><div><p className="eyebrow">Follow-up</p><h2>Sarah will remember this.</h2><p>The executive action and next review were recorded as institutional memory.</p><strong>Next executive review · {followUp.nextReviewDate}</strong>{followUp.types&&<span>{followUp.types.join(" · ")}</span>}</div></section>}
    </section>}

    <footer><span>DECIVANTA</span><p>Executive intelligence with traceable memory and human authority.</p><div><span>CockroachDB</span><span>AWS</span></div></footer>
  </main>
}

function StoryGrid({items}:{items:Array<[string,string]>}){return <section className="story-grid">{items.map(([title,body])=><article key={title}><p className="eyebrow">{title}</p><p>{body}</p></article>)}</section>}
function Memory({evidenceKinds}:{evidenceKinds:string[]}){return <section className="memory-band"><div><p className="eyebrow">Evidence &amp; memory trace</p><h3>Why Sarah connected this issue.</h3></div><div>{evidenceKinds.map(kind=><Label key={kind}>{kind.replaceAll("_"," ")}</Label>)}</div><p>Retrieved evidence remains distinguishable from observed patterns and AI guidance.</p></section>}
function Guidance({title,body}:{title:string;body:string}){return <section className="guidance"><p className="eyebrow">AI guidance</p><h3>{title}</h3><p>{body}</p></section>}
function GuidanceUnavailable(){return <section className="guidance degraded"><Label tone="gold">Guidance unavailable</Label><h3>Verified evidence remains available.</h3><p>No recommendation was fabricated. Executive action remains disabled until validated guidance is available.</p></section>}
function ActionPanel({phase,verified,nextReviewDate,setNextReviewDate,onVerify,onRecord}:{phase:Phase;verified:boolean;nextReviewDate:string;setNextReviewDate:(value:string)=>void;onVerify:()=>void;onRecord:()=>void}){return <section className="action-panel"><div><p className="eyebrow">Executive action</p><h3>The decision remains yours.</h3><p>The brief is already available. Verify the live sponsor-backed path when you want to record an action.</p></div><div className="action-form"><button className="secondary" onClick={onVerify} disabled={phase==="loading"||phase==="recording"}>{phase==="loading"?"Verifying sponsor-backed evidence…":verified?"Evidence verified live":"Verify live evidence"}</button><label htmlFor="next-review"><span>Next executive review</span><input id="next-review" type="date" min={futureDate(1)} value={nextReviewDate} onChange={event=>setNextReviewDate(event.target.value)}/></label><button className="primary" onClick={onRecord} disabled={!verified||phase==="recording"||phase==="recorded"}>{phase==="recording"?"Recording…":phase==="recorded"?"Action recorded":"Record executive action"}<span>→</span></button></div></section>}
