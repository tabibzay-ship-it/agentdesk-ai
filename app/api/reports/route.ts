import "server-only";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(data:Record<string,unknown>,status=200){return NextResponse.json(data,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}})}
function admin(){const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("Reports are not configured.");return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})}
function iso(value:string|null){if(!value)return null;const date=new Date(value);return Number.isNaN(date.valueOf())?null:date.toISOString()}

export async function GET(request:Request){
  try{
    const client=admin();const token=/^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization")||"")?.[1];
    if(!token)return json({error:"Sign in required.",code:"UNAUTHORIZED"},401);
    const {data:{user},error:authError}=await client.auth.getUser(token);if(authError||!user)return json({error:"Session expired.",code:"UNAUTHORIZED"},401);
    const url=new URL(request.url),start=iso(url.searchParams.get("start")),end=iso(url.searchParams.get("end")),agentId=url.searchParams.get("agentId");
    if(!start||!end||new Date(start)>=new Date(end)||new Date(end).valueOf()-new Date(start).valueOf()>366*86400000)return json({error:"Choose a valid date range of 366 days or less.",code:"INVALID_RANGE"},400);
    const {data:agent,error:agentError}=await client.from("agent_settings").select("public_agent_id,is_active").eq("user_id",user.id).maybeSingle();
    if(agentError)throw new Error("agent");if(agentId&&(!UUID_RE.test(agentId)||agent?.public_agent_id!==agentId))return json({error:"Agent is not available.",code:"INVALID_AGENT"},400);
    const scoped=(table:string,column="created_at")=>client.from(table).select("id",{count:"exact",head:true}).eq("user_id",user.id).gte(column,start).lt(column,end);
    const [conversations,responses,knowledge,attachments,usage,subscription]=await Promise.all([
      scoped("conversations"),client.from("messages").select("id,conversations!inner(user_id)",{count:"exact",head:true}).eq("conversations.user_id",user.id).eq("role","assistant").gte("created_at",start).lt("created_at",end),
      client.from("knowledge_sources").select("id",{count:"exact",head:true}).eq("user_id",user.id),scoped("chat_attachments"),
      client.from("usage_limits").select("plan,messages_used,monthly_limit").eq("user_id",user.id).maybeSingle(),
      client.from("subscriptions").select("plan_id,status,current_period_end").eq("user_id",user.id).maybeSingle(),
    ]);
    if([conversations.error,responses.error,knowledge.error,attachments.error,usage.error,subscription.error].some(Boolean))throw new Error("summary");
    const rows:Array<{id:string;created_at:string}>=[];for(let from=0;;from+=1000){const result=await client.from("conversations").select("id,created_at").eq("user_id",user.id).gte("created_at",start).lt("created_at",end).order("created_at").range(from,from+999);if(result.error)throw new Error("trend");rows.push(...(result.data??[]));if((result.data??[]).length<1000)break;}
    const buckets=new Map<string,number>();for(const row of rows){const key=new Date(row.created_at).toISOString().slice(0,10);buckets.set(key,(buckets.get(key)||0)+1)}
    const series=[];for(let day=new Date(start);day<new Date(end);day=new Date(day.valueOf()+86400000)){const key=day.toISOString().slice(0,10);series.push({date:key,conversations:buckets.get(key)||0})}
    return json({range:{start,end},agent:{publicAgentId:agent?.public_agent_id??null,isActive:agent?.is_active===true},summary:{conversations:conversations.count??0,aiResponses:responses.count??0,activeAgents:agent?.is_active?1:0,knowledgeSources:knowledge.count??0,attachments:attachments.count??0},usage:usage.data?{plan:usage.data.plan,used:Number(usage.data.messages_used||0),limit:Number(usage.data.monthly_limit||0)}:null,subscription:subscription.data??null,series,unsupported:["tokenUsage","responseFailures","customerSatisfaction","revenue"]});
  }catch{return json({error:"Reports are temporarily unavailable.",code:"REPORTS_FAILED"},503)}
}
