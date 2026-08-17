export const executiveSequence = [
  "Attention",
  "Context",
  "Evidence & Memory Trace",
  "Potential Impact",
  "Recommendation",
  "Executive Action",
  "Follow-up",
] as const;

export function mergeEvidenceKinds(orionKinds:string[],externalKinds:string[]):string[]{
  return [...new Set([...orionKinds,...externalKinds])].sort();
}

export function canRecordExecutiveAction(status:"GUIDANCE_AVAILABLE"|"GUIDANCE_UNAVAILABLE"):boolean{
  return status==="GUIDANCE_AVAILABLE";
}
