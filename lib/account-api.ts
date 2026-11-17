import "server-only";
import { createClient } from "@supabase/supabase-js";

export async function accountApi(request: Request) {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) return null;
  const token=/^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization")||"")?.[1];
  if(!token) return null;
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error}=await admin.auth.getUser(token);
  return error||!user?null:{admin,user};
}
