import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const cfg=window.KD_CONFIG;
const db=createClient(cfg.url,cfg.anonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
const $=id=>document.getElementById(id);let user=null,account=null,watch=null,lastSent=0,busy=false;
const msg=(s,error=false)=>{$('msg').textContent=s;$('msg').className=error?'error':'muted'};
function emailFor(id){return id.toLowerCase()+'@'+cfg.riderEmailDomain}
function show(logged){$('login').classList.toggle('hidden',logged);$('tracking').classList.toggle('hidden',!logged)}
function buttons(running){$('start').classList.toggle('hidden',running);$('stop').classList.toggle('hidden',!running)}
async function loadAccount(){const {data,error}=await db.from('kd_rider_accounts').select('rider_id,rider_name').eq('auth_uid',user.id).single();if(error)throw error;account=data;$('hello').textContent=account.rider_name+' 기사님';show(true)}
async function init(){const {data}=await db.auth.getUser();user=data.user;if(user){try{await loadAccount()}catch(e){msg('기사 계정 연결 실패: '+e.message,true);await db.auth.signOut();user=null;show(false)}}}
$('signIn').onclick=async()=>{const id=$('id').value.trim().toLowerCase();const pw=$('pw').value;if(!/^[a-z0-9_-]{3,40}$/.test(id)){msg('아이디는 영문 소문자·숫자·_·- 조합 3~40자입니다.',true);return}try{const {data,error}=await db.auth.signInWithPassword({email:emailFor(id),password:pw});if(error)throw error;user=data.user;await loadAccount();$('pw').value='';msg('로그인되었습니다. 위치 공유 시작을 눌러주세요.')}catch(e){msg('로그인 실패: '+e.message,true)}};
async function sendPosition(pos){if(!user||!account||busy)return;const now=Date.now();if(now-lastSent<4500)return;busy=true;try{const {error}=await db.rpc('kd_update_my_location',{p_latitude:pos.coords.latitude,p_longitude:pos.coords.longitude,p_accuracy:pos.coords.accuracy});if(error)throw error;lastSent=Date.now();$('last').textContent='마지막 전송: '+new Date().toLocaleTimeString('ko-KR');$('accuracy').textContent=Math.round(pos.coords.accuracy||0)+'m';$('state').textContent='● GPS 공유 중';$('state').className='success';msg('관리자 지도에 위치를 전송하고 있습니다.')}catch(e){msg('GPS 저장 실패: '+e.message,true)}finally{busy=false}}
$('start').onclick=()=>{if(!navigator.geolocation){msg('이 브라우저는 GPS를 지원하지 않습니다.',true);return}if(watch!==null)return;watch=navigator.geolocation.watchPosition(sendPosition,e=>{msg('위치 권한/수신 오류: '+e.message,true)},{enableHighAccuracy:true,maximumAge:0,timeout:20000});buttons(true);$('state').textContent='위치 수신 대기 중';msg('GPS 권한 요청 중...')};
async function stop(){if(watch!==null){navigator.geolocation.clearWatch(watch);watch=null}buttons(false);$('state').textContent='위치 공유 중지';$('state').className='';if(user){const {error}=await db.rpc('kd_stop_my_location');if(error)msg('공유 종료 서버 반영 실패: '+error.message,true);else msg('위치 공유가 종료되었습니다.')}}
$('stop').onclick=stop;$('signOut').onclick=async()=>{await stop();await db.auth.signOut();user=null;account=null;show(false);msg('로그아웃되었습니다.')};
window.addEventListener('pagehide',()=>{if(watch!==null)navigator.geolocation.clearWatch(watch)});
init();
