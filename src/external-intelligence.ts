import { createHash, randomUUID } from "node:crypto";
import { EMBEDDING_MODEL_ID, GUIDANCE_MODEL_ID, embedText, generateExternalIntelligenceGuidance } from "./bedrock-client.js";
import { NORTHSTAR_ORGANIZATION_ID, type McpSecret } from "./contract.js";
import { runManagedMcpMissionRetrieval } from "./mcp-client.js";
import { businessCaseWatchMission } from "./missions/business-case-watch.js";
import {
  VERIFIED_STEEL_TARIFF_EVENT,
  evaluateExternalEvent,
  externalIntelligenceWatchMission,
} from "./missions/external-intelligence-watch.js";
import { sqlPool } from "./sql-client.js";

const EXTERNAL_EVENT_ID = "40000000-0000-4000-8000-000000000001";

function digest(value: string): Buffer { return createHash("sha256").update(value, "utf8").digest(); }
function vector(values: number[]): string { return `[${values.join(",")}]`; }

function eventCanonicalText(): string {
  const event = VERIFIED_STEEL_TARIFF_EVENT;
  return [event.eventCode,event.title,event.eventType,event.jurisdiction,event.affectedCategory,event.priorRatePercent,event.currentRatePercent,event.effectiveDate,event.publishedDate,event.sourcePublisher,event.sourceUrl].join("|");
}

async function sessionFor(token: string): Promise<{ id: string; generation: string }> {
  const pool = await sqlPool();
  const result = await pool.query<{ id: string; generation: string }>(
    "SELECT id,generation::STRING AS generation FROM demo_sessions WHERE token_hash=$1::BYTES AND expires_at>now()",
    [digest(token)],
  );
  if (result.rowCount !== 1) throw new Error("DEMO_SESSION_INVALID");
  return result.rows[0];
}

export async function acquireVerifiedExternalEvent(token: string): Promise<{
  eventCode: string; acquired: boolean; sourcePublisher: string; sourceUrl: string;
}> {
  await sessionFor(token);
  const event = VERIFIED_STEEL_TARIFF_EVENT;
  const pool = await sqlPool();
  await pool.query(`
    INSERT INTO external_events (
      id,organization_id,event_code,title,event_type,jurisdiction,affected_category,
      prior_rate_percent,current_rate_percent,effective_date,published_date,source_publisher,source_url,content_hash
    ) VALUES ($1::UUID,$2::UUID,$3,$4,$5,$6,$7,$8::DECIMAL,$9::DECIMAL,$10::DATE,$11::DATE,$12,$13,$14::BYTES)
    ON CONFLICT (event_code) DO UPDATE SET source_url=excluded.source_url
  `,[EXTERNAL_EVENT_ID,NORTHSTAR_ORGANIZATION_ID,event.eventCode,event.title,event.eventType,event.jurisdiction,event.affectedCategory,event.priorRatePercent,event.currentRatePercent,event.effectiveDate,event.publishedDate,event.sourcePublisher,event.sourceUrl,digest(eventCanonicalText())]);
  return {eventCode:event.eventCode,acquired:true,sourcePublisher:event.sourcePublisher,sourceUrl:event.sourceUrl};
}

type ExternalIntelligenceSnapshot = {
  missionId: string;
  runId: string;
  status: "COMPLETED";
  event: { eventCode: string; title: string; sourcePublisher: string; sourceUrl: string; publishedDate: string; effectiveDate: string; priorRatePercent: string; currentRatePercent: string };
  relevance: { relevant: true; connectedToBusinessContext: true };
  businessContext: { name: string; authorizedCapex: string; committedOpeningDate: string; retrievedTypes: string[] };
  potentialImpact: { cost: true; schedule: true; quantified: false };
  executiveAttentionRequired: true;
  guidance: { recommendedAction: "REVIEW_ORION_PROCUREMENT_EXPOSURE"; summary: string; potentialImpact: string; uncertaintyStatement: string };
};

export async function runExternalIntelligenceMission(endpoint:string,secret:McpSecret,token:string,idempotencyKey:string):Promise<{replayed:boolean;snapshot:ExternalIntelligenceSnapshot}> {
  const pool=await sqlPool();
  const session=await sessionFor(token);
  const replay=await pool.query<{response_snapshot:ExternalIntelligenceSnapshot}>(`SELECT response_snapshot FROM external_intelligence_runs WHERE session_id=$1::UUID AND generation=$2::INT8 AND mission_id=$3 AND idempotency_key=$4 AND status='COMPLETED'`,[session.id,session.generation,externalIntelligenceWatchMission.id,idempotencyKey]);
  if(replay.rowCount===1)return{replayed:true,snapshot:replay.rows[0].response_snapshot};
  const eventResult=await pool.query<{id:string;event_code:string;title:string;event_type:string;affected_category:string;prior_rate_percent:string;current_rate_percent:string;effective_date:string;published_date:string;source_publisher:string;source_url:string;content_hash:Buffer}>(`SELECT id,event_code,title,event_type,affected_category,prior_rate_percent::STRING AS prior_rate_percent,current_rate_percent::STRING AS current_rate_percent,effective_date::STRING AS effective_date,published_date::STRING AS published_date,source_publisher,source_url,content_hash FROM external_events WHERE event_code=$1`,[VERIFIED_STEEL_TARIFF_EVENT.eventCode]);
  if(eventResult.rowCount!==1)throw new Error("EXTERNAL_EVENT_UNAVAILABLE");
  const event=eventResult.rows[0];
  if(!event.content_hash.equals(digest(eventCanonicalText()))||event.source_url!==VERIFIED_STEEL_TARIFF_EVENT.sourceUrl)throw new Error("EXTERNAL_EVENT_PROVENANCE_INVALID");
  const embedded=await embedText(`${event.title}. Assess relevance to ${externalIntelligenceWatchMission.contextRetrievalText}`);
  const retrieved=await runManagedMcpMissionRetrieval(endpoint,secret,NORTHSTAR_ORGANIZATION_ID,businessCaseWatchMission.id,embedded.values);
  const ids=retrieved.matches.map((match)=>match.id);
  const memories=await pool.query<{id:string;epistemic_type:string;source_type:string}>(`SELECT id,epistemic_type,source_type FROM memory_items WHERE id=ANY($1::UUID[]) AND mission_id=$2 AND session_id IS NULL`,[ids,businessCaseWatchMission.id]);
  const types=new Set(memories.rows.map((memory)=>memory.epistemic_type));
  const contextReady=["FACT","DECISION","OBSERVED_PATTERN"].every((type)=>types.has(type));
  if(!contextReady)throw new Error("MEMORY_UNAVAILABLE");
  const businessCase=await pool.query<{name:string;authorized_capex:string;committed_opening_date:string}>(`SELECT name,authorized_capex::STRING AS authorized_capex,committed_opening_date::STRING AS committed_opening_date FROM business_cases WHERE mission_id=$1`,[businessCaseWatchMission.id]);
  if(businessCase.rowCount!==1)throw new Error("BUSINESS_CONTEXT_UNAVAILABLE");
  const evaluation=evaluateExternalEvent({eventType:event.event_type,priorRatePercent:Number(event.prior_rate_percent),currentRatePercent:Number(event.current_rate_percent),affectedCategory:event.affected_category,retrievedBusinessContext:contextReady});
  if(!externalIntelligenceWatchMission.attentionCondition(evaluation))throw new Error("ATTENTION_NOT_REQUIRED");
  const guidance=await generateExternalIntelligenceGuidance();
  const runId=randomUUID();
  const inferenceText=`Verified external steel tariff change may affect ORION procurement cost or schedule. ${guidance.value.uncertaintyStatement}`;
  const inferenceEmbedding=await embedText(inferenceText);
  const canonical=businessCase.rows[0];
  const snapshot:ExternalIntelligenceSnapshot={missionId:externalIntelligenceWatchMission.id,runId,status:"COMPLETED",event:{eventCode:event.event_code,title:event.title,sourcePublisher:event.source_publisher,sourceUrl:event.source_url,publishedDate:event.published_date,effectiveDate:event.effective_date,priorRatePercent:event.prior_rate_percent,currentRatePercent:event.current_rate_percent},relevance:{relevant:true,connectedToBusinessContext:true},businessContext:{name:canonical.name,authorizedCapex:canonical.authorized_capex,committedOpeningDate:canonical.committed_opening_date,retrievedTypes:[...types].sort()},potentialImpact:{cost:true,schedule:true,quantified:false},executiveAttentionRequired:true,guidance:{...guidance.value}};
  const client=await pool.connect();
  try{await client.query("BEGIN");
    await client.query(`INSERT INTO external_intelligence_runs(id,session_id,generation,mission_id,idempotency_key,event_id,status,relevant,connected_to_business_context,potential_cost_impact,potential_schedule_impact,executive_attention_required,response_snapshot,completed_at) VALUES($1::UUID,$2::UUID,$3::INT8,$4,$5,$6::UUID,'COMPLETED',true,true,true,true,true,$7::JSONB,now())`,[runId,session.id,session.generation,externalIntelligenceWatchMission.id,idempotencyKey,event.id,JSON.stringify(snapshot)]);
    for(const [index,match] of retrieved.matches.filter((match)=>ids.includes(match.id)).entries())await client.query(`INSERT INTO external_intelligence_matches(run_id,memory_item_id,rank,distance) VALUES($1::UUID,$2::UUID,$3::INT8,$4::DECIMAL)`,[runId,match.id,index+1,match.cosine_distance.toString()]);
    await client.query(`INSERT INTO external_intelligence_guidance(id,run_id,model_id,summary,recommended_action,potential_impact,uncertainty_statement) VALUES($1::UUID,$2::UUID,$3,$4,$5,$6,$7)`,[randomUUID(),runId,process.env.GUIDANCE_MODEL_ID??GUIDANCE_MODEL_ID,guidance.value.summary,guidance.value.recommendedAction,guidance.value.potentialImpact,guidance.value.uncertaintyStatement]);
    await client.query(`INSERT INTO memory_items(id,organization_id,source_type,source_id,content,language_code,embedding_model,embedding,session_id,generation,mission_id,epistemic_type,provenance) VALUES($1::UUID,$2::UUID,'inference',$3::UUID,$4,'en',$5,$6::VECTOR,$7::UUID,$8::INT8,$9,'INFERENCE',$10::JSONB)`,[randomUUID(),NORTHSTAR_ORGANIZATION_ID,runId,inferenceText,process.env.EMBEDDING_MODEL_ID??EMBEDDING_MODEL_ID,vector(inferenceEmbedding.values),session.id,session.generation,externalIntelligenceWatchMission.id,JSON.stringify({externalEventId:event.id,sourceUrl:event.source_url,supportedBy:ids,quantified:false})]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
  return{replayed:false,snapshot};
}
