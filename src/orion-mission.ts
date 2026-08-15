import { createHash, randomUUID } from "node:crypto";
import { EMBEDDING_MODEL_ID, generateBusinessCaseGuidance, GUIDANCE_MODEL_ID, embedText } from "./bedrock-client.js";
import { NORTHSTAR_ORGANIZATION_ID, type McpSecret } from "./contract.js";
import { runManagedMcpMissionRetrieval } from "./mcp-client.js";
import { businessCaseWatchMission, evaluateOrionConflict } from "./missions/business-case-watch.js";
import { sqlPool } from "./sql-client.js";

function digest(value: string): Buffer { return createHash("sha256").update(value, "utf8").digest(); }
function vector(values: number[]): string { return `[${values.join(",")}]`; }

type OrionSnapshot = {
  missionId: string; runId: string; status: "COMPLETED"; conflictDetected: true;
  facts: { authorizedCapex: string; committedOpeningDate: string; standardAdditionalCapex: string; standardDelayDays: number; acceleratedAdditionalCapex: string; acceleratedProtectsDate: true };
  evidence: Array<{ epistemicType: "FACT" | "DECISION" | "OBSERVED_PATTERN"; sourceType: string }>;
  guidance: { recommendedAction: "PRESENT_BOTH_RECOMMEND_ACCELERATED"; summary: string; explanation: string; uncertaintyStatement: string };
};

async function sessionFor(token: string): Promise<{ id: string; generation: string }> {
  const pool = await sqlPool();
  const result = await pool.query<{ id: string; generation: string }>(`SELECT id,generation::STRING AS generation FROM demo_sessions WHERE token_hash=$1::BYTES AND expires_at>now()`, [digest(token)]);
  if (result.rowCount !== 1) throw new Error("DEMO_SESSION_INVALID");
  return result.rows[0];
}

export async function runOrionMission(endpoint: string, secret: McpSecret, token: string, idempotencyKey: string): Promise<{ replayed: boolean; snapshot: OrionSnapshot }> {
  const pool = await sqlPool();
  const session = await sessionFor(token);
  const replay = await pool.query<{ response_snapshot: OrionSnapshot }>(`SELECT response_snapshot FROM mission_runs WHERE session_id=$1::UUID AND mission_id=$2 AND idempotency_key=$3 AND status='COMPLETED'`, [session.id,businessCaseWatchMission.id,idempotencyKey]);
  if (replay.rowCount === 1) return { replayed: true, snapshot: replay.rows[0].response_snapshot };
  const canonical = await pool.query<{ event_id:string; authorized_capex:string; committed_opening_date:string; alternative_a_capex:string; alternative_a_delay_days:string; alternative_a_protects_date:boolean; alternative_b_capex:string; alternative_b_protects_date:boolean }>(
    `SELECT e.id AS event_id,b.authorized_capex::STRING AS authorized_capex,b.committed_opening_date::STRING AS committed_opening_date,e.alternative_a_capex::STRING AS alternative_a_capex,e.alternative_a_delay_days::STRING AS alternative_a_delay_days,e.alternative_a_protects_date,e.alternative_b_capex::STRING AS alternative_b_capex,e.alternative_b_protects_date FROM business_cases b JOIN business_case_events e ON e.business_case_id=b.id WHERE b.mission_id=$1 AND e.event_code='ORION-PROCUREMENT-CONFLICT'`, [businessCaseWatchMission.id]);
  if (canonical.rowCount !== 1) throw new Error("EVIDENCE_UNAVAILABLE");
  const row=canonical.rows[0];
  const evaluation=evaluateOrionConflict({standardDelayDays:Number(row.alternative_a_delay_days),standardProtectsDate:row.alternative_a_protects_date,acceleratedAdditionalCapex:row.alternative_b_capex,acceleratedProtectsDate:row.alternative_b_protects_date});
  if (!businessCaseWatchMission.attentionCondition(evaluation)) throw new Error("ATTENTION_NOT_REQUIRED");
  const signal=await embedText("ORION procurement conflict between protecting approved budget and protecting the committed opening date.");
  const retrieved=await runManagedMcpMissionRetrieval(endpoint,secret,NORTHSTAR_ORGANIZATION_ID,businessCaseWatchMission.id,signal.values);
  const ids=retrieved.matches.map((match)=>match.id);
  const memories=await pool.query<{id:string;epistemic_type:"FACT"|"DECISION"|"OBSERVED_PATTERN";source_type:string}>(`SELECT id,epistemic_type,source_type FROM memory_items WHERE id=ANY($1::UUID[]) AND mission_id=$2 AND session_id IS NULL`,[ids,businessCaseWatchMission.id]);
  const kinds=new Set(memories.rows.map((memory)=>memory.epistemic_type));
  if (!["FACT","DECISION","OBSERVED_PATTERN"].every((kind)=>kinds.has(kind as "FACT"))) throw new Error("MEMORY_UNAVAILABLE");
  const guidance=await generateBusinessCaseGuidance();
  const runId=randomUUID();
  const inferenceText=`Potential procurement decision conflict detected. ${guidance.value.uncertaintyStatement}`;
  const inferenceEmbedding=await embedText(inferenceText);
  const snapshot:OrionSnapshot={missionId:businessCaseWatchMission.id,runId,status:"COMPLETED",conflictDetected:true,facts:{authorizedCapex:row.authorized_capex,committedOpeningDate:row.committed_opening_date,standardAdditionalCapex:row.alternative_a_capex,standardDelayDays:Number(row.alternative_a_delay_days),acceleratedAdditionalCapex:row.alternative_b_capex,acceleratedProtectsDate:true},evidence:memories.rows.map((memory)=>({epistemicType:memory.epistemic_type,sourceType:memory.source_type})),guidance:{...guidance.value}};
  const client=await pool.connect();
  try { await client.query("BEGIN");
    await client.query(`INSERT INTO mission_runs(id,session_id,generation,mission_id,idempotency_key,status,event_id,conflict_detected,response_snapshot,completed_at) VALUES($1::UUID,$2::UUID,$3::INT8,$4,$5,'COMPLETED',$6::UUID,true,$7::JSONB,now())`,[runId,session.id,session.generation,businessCaseWatchMission.id,idempotencyKey,row.event_id,JSON.stringify(snapshot)]);
    for(const [index,match] of retrieved.matches.filter((match)=>ids.includes(match.id)).entries()) await client.query(`INSERT INTO mission_run_matches(mission_run_id,memory_item_id,rank,distance) VALUES($1::UUID,$2::UUID,$3::INT8,$4::DECIMAL)`,[runId,match.id,index+1,match.cosine_distance.toString()]);
    await client.query(`INSERT INTO mission_guidance(id,mission_run_id,model_id,summary,recommended_action,uncertainty_statement) VALUES($1::UUID,$2::UUID,$3,$4,$5,$6)`,[randomUUID(),runId,process.env.GUIDANCE_MODEL_ID??GUIDANCE_MODEL_ID,guidance.value.summary,guidance.value.recommendedAction,guidance.value.uncertaintyStatement]);
    await client.query(`INSERT INTO memory_items(id,organization_id,source_type,source_id,content,language_code,embedding_model,embedding,session_id,generation,mission_id,epistemic_type,provenance) VALUES($1::UUID,$2::UUID,'inference',$3::UUID,$4,'en',$5,$6::VECTOR,$7::UUID,$8::INT8,$9,'INFERENCE',$10::JSONB)`,[randomUUID(),NORTHSTAR_ORGANIZATION_ID,runId,inferenceText,process.env.EMBEDDING_MODEL_ID??EMBEDDING_MODEL_ID,vector(inferenceEmbedding.values),session.id,session.generation,businessCaseWatchMission.id,JSON.stringify({supportedBy:ids,uncertain:true})]);
    await client.query("COMMIT");
  } catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;} finally{client.release();}
  return {replayed:false,snapshot};
}

export async function recordOrionAction(token:string,runId:string,idempotencyKey:string,nextReviewDate:string):Promise<{actionId:string;nextReviewDate:string;replayed:boolean}> {
  if(nextReviewDate<=new Date().toISOString().slice(0,10)) throw new Error("NEXT_REVIEW_DATE_INVALID");
  const pool=await sqlPool(); const session=await sessionFor(token);
  const existing=await pool.query<{id:string;next_review_date:string}>(`SELECT a.id,a.next_review_date::STRING AS next_review_date FROM mission_actions a JOIN mission_runs r ON r.id=a.mission_run_id WHERE r.id=$1::UUID AND r.session_id=$2::UUID AND r.generation=$3::INT8`,[runId,session.id,session.generation]);
  if(existing.rowCount===1) return {actionId:existing.rows[0].id,nextReviewDate:existing.rows[0].next_review_date,replayed:true};
  const owned=await pool.query(`SELECT 1 FROM mission_runs WHERE id=$1::UUID AND session_id=$2::UUID AND generation=$3::INT8 AND status='COMPLETED'`,[runId,session.id,session.generation]); if(owned.rowCount!==1) throw new Error("MISSION_RUN_NOT_FOUND");
  const actionId=randomUUID();
  const records=[
    {sourceType:"executive_decision",kind:"DECISION",content:"Present both procurement alternatives to the client and recommend accelerated procurement."},
    {sourceType:"condition",kind:"CONDITION",content:"Written client authorization is required for the additional USD 310K CAPEX."},
    {sourceType:"commitment",kind:"COMMITMENT",content:"Prepare the standard and accelerated procurement alternatives for client review."},
    {sourceType:"follow_up",kind:"FOLLOW_UP",content:`Next ORION executive review scheduled for ${nextReviewDate}.`},
  ] as const;
  const embedded=await Promise.all(records.map(async(record)=>({...record,embedding:(await embedText(record.content)).values})));
  const client=await pool.connect(); try{await client.query("BEGIN");
    await client.query(`INSERT INTO mission_actions(id,mission_run_id,decision_text,condition_text,commitment_text,next_review_date) VALUES($1::UUID,$2::UUID,$3,$4,$5,$6::DATE)`,[actionId,runId,records[0].content,records[1].content,records[2].content,nextReviewDate]);
    for(const record of embedded) await client.query(`INSERT INTO memory_items(id,organization_id,source_type,source_id,content,language_code,embedding_model,embedding,session_id,generation,mission_id,epistemic_type,provenance) VALUES($1::UUID,$2::UUID,$3,$4::UUID,$5,'en',$6,$7::VECTOR,$8::UUID,$9::INT8,$10,$11,$12::JSONB)`,[randomUUID(),NORTHSTAR_ORGANIZATION_ID,record.sourceType,actionId,record.content,process.env.EMBEDDING_MODEL_ID??EMBEDDING_MODEL_ID,vector(record.embedding),session.id,session.generation,businessCaseWatchMission.id,record.kind,JSON.stringify({missionRunId:runId})]);
    await client.query("COMMIT");
  }catch(error){await client.query("ROLLBACK").catch(()=>undefined);throw error;}finally{client.release();}
  void idempotencyKey;
  return {actionId,nextReviewDate,replayed:false};
}

export async function retrieveOrionContext(endpoint:string,secret:McpSecret,token:string):Promise<{missionId:string;nextReviewDate:string;types:string[]}> {
  const pool=await sqlPool();const session=await sessionFor(token);const embedded=await embedText(businessCaseWatchMission.contextRetrievalText);
  const retrieved=await runManagedMcpMissionRetrieval(endpoint,secret,NORTHSTAR_ORGANIZATION_ID,businessCaseWatchMission.id,embedded.values,session.id,session.generation);
  const types=[...new Set(retrieved.matches.map((match)=>match.source_type))];
  for(const required of ["executive_decision","condition","commitment","follow_up"]) if(!types.includes(required as typeof types[number])) throw new Error("PERSISTED_CONTEXT_UNAVAILABLE");
  const action=await pool.query<{next_review_date:string}>(`SELECT a.next_review_date::STRING AS next_review_date FROM mission_actions a JOIN mission_runs r ON r.id=a.mission_run_id WHERE r.session_id=$1::UUID AND r.generation=$2::INT8 ORDER BY a.created_at DESC LIMIT 1`,[session.id,session.generation]); if(action.rowCount!==1) throw new Error("PERSISTED_CONTEXT_UNAVAILABLE");
  return {missionId:businessCaseWatchMission.id,nextReviewDate:action.rows[0].next_review_date,types};
}
