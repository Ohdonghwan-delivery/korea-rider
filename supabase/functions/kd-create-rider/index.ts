import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'Method not allowed'},405);
 try{
  const url=Deno.env.get('SUPABASE_URL')!;
  const anon=Deno.env.get('SUPABASE_ANON_KEY')!;
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const bearer=req.headers.get('Authorization')||'';
  if(!bearer.startsWith('Bearer '))return json({error:'로그인이 필요합니다.'},401);
  const authClient=createClient(url,anon,{global:{headers:{Authorization:bearer}}});
  const {data:{user},error:authError}=await authClient.auth.getUser();
  if(authError||!user)return json({error:'유효하지 않은 관리자 로그인'},401);
  const adminClient=createClient(url,service);
  const {data:admin,error:adminError}=await adminClient.from('kd_admins').select('user_id').eq('user_id',user.id).maybeSingle();
  if(adminError||!admin)return json({error:'관리자 권한 없음'},403);
  const {rider_id,rider_name,password}=await req.json();
  if(typeof rider_id!=='string'||!/^[a-z0-9_-]{3,40}$/.test(rider_id)||typeof rider_name!=='string'||!rider_name.trim()||rider_name.length>80||typeof password!=='string'||password.length<8)return json({error:'아이디·이름·비밀번호 형식 오류'},400);
  const email=rider_id+'@riders.koreadelivery.invalid';
  const {data:created,error:createError}=await adminClient.auth.admin.createUser({email,password,email_confirm:true});
  if(createError||!created.user)return json({error:createError?.message||'계정 생성 실패'},400);
  const {error:profileError}=await adminClient.from('rider_accounts').insert({auth_uid:created.user.id,rider_id,rider_name:rider_name.trim()});
  if(profileError){await adminClient.auth.admin.deleteUser(created.user.id);return json({error:'기사 등록 실패: '+profileError.message},400)}
  return json({ok:true,rider_id});
 }catch(e){return json({error:String(e instanceof Error?e.message:e)},500)}
});
