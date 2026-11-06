import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

// 本機介面驗收使用合成會員與媒體，不連接正式帳號或外部服務
const sessions = new Map();
const scenarios = ['member','guest','zero','ineligible','mic-pending','mic-denied','connection-failed','hangup-pending','tool-wait'];
const names = ['可用會員','未登入','零額度','資格不足','等待麥克風','拒絕麥克風','連線失敗','掛斷待確認','工具等待'];
const usage = { elapsedSeconds: 21, audioStarted: true, waitingForTool: false };
const record = () => ({ id:'preview-call', status:'ended', createdAt:1793894400000, settlement:{billedSeconds:21,remainingSeconds:232}, usage, transcript:[{role:'user',text:'合成案例：請核對網站轉換率'},{role:'assistant',text:'先核對同一期間的付款訂單與漏斗資料'}], documents:[{id:'preview-summary',kind:'summary',title:'合成諮詢摘要',findings:[{kind:'member',text:'合成會員的網站轉換率問題'}]},{id:'preview-report',kind:'report',title:'合成行銷報告',findings:[{kind:'recommendation',text:'核對期間、來源、去重與已付款訂單數'}]}], deliveries:[] });
const media = `
const scenario=new URL(location.href).searchParams.get('scenario')||'member';
let allow;
const track={_enabled:true,get enabled(){return this._enabled},set enabled(value){this._enabled=value;const out=document.getElementById('preview-track');if(out)out.textContent=value?'測試音軌：收音中':'測試音軌：已靜音'},stop(){const out=document.getElementById('preview-track');if(out)out.textContent='測試音軌：已停止'}};
Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{async getUserMedia(){if(scenario==='mic-denied')throw new DOMException('Fixture denied','NotAllowedError');if(scenario==='mic-pending')await new Promise(resolve=>{allow=resolve});return{getTracks:()=>[track],getAudioTracks:()=>[track]}}}});
window.RTCPeerConnection=class{
 connectionState='new';addTrack(){}createDataChannel(){return{readyState:'open',send(){},close(){this.readyState='closed'}}}
 async createOffer(){if(scenario==='connection-failed')throw Error('Fixture connection failed');return{type:'offer',sdp:'v=0\\r\\nfixture'}}
 async setLocalDescription(){}async setRemoteDescription(){this.connectionState='connected';this.onconnectionstatechange?.()}
 close(){this.connectionState='closed';this.onconnectionstatechange?.()}
};
document.addEventListener('DOMContentLoaded',()=>{document.getElementById('preview-allow')?.addEventListener('click',()=>allow?.());document.getElementById('preview-confirm')?.addEventListener('click',async()=>{await fetch('/__preview/confirm',{method:'POST'})});});
`;
http.createServer(async (req,res) => {
  try {
    const url=new URL(req.url,'http://127.0.0.1');
    const send=(status,value,type='application/json')=>{res.writeHead(status,{'content-type':type,'cache-control':'no-store'});res.end(type==='application/json'?JSON.stringify(value):value)};
    let id=req.headers.cookie?.match(/(?:^|; )dialer_preview=([^;]+)/)?.[1], state=sessions.get(id);
    if(url.pathname==='/__preview')return send(200,'<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>撥號介面驗收情境</title><h1>本機介面驗收</h1><p>合成會員與通話，操作不會撥打或寄信</p><ul>'+scenarios.map((s,i)=>`<li><a href="/?scenario=${s}">${names[i]}</a></li>`).join('')+'</ul><a href="/?scenario=member#call=preview-call&document=preview-report">成果深層連結</a></html>','text/html; charset=utf-8');
    if(url.pathname==='/__preview/media.js')return send(200,media,'text/javascript');
    if(url.pathname==='/__preview/style.css')return send(200,'.preview-banner{position:fixed;z-index:10;top:0;inset-inline:0;text-align:center;padding:5px 8px;font:12px/1.4 system-ui;background:#eee8d8;color:#302c24}.preview-banner a,.preview-banner button{color:inherit;margin-inline:6px}.preview-banner output{display:block}', 'text/css');
    if(url.pathname==='/'){
      const scenario=scenarios.includes(url.searchParams.get('scenario'))?url.searchParams.get('scenario'):'member';
      id=randomUUID();state={scenario,records:[record()],balance:scenario==='zero'?0:232};sessions.set(id,state);
      res.setHeader('set-cookie',`dialer_preview=${id}; Path=/; SameSite=Strict; HttpOnly`);
      res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
      let html=await readFile(new URL('../../public/index.html',import.meta.url),'utf8');
      html=html.replace('<script type="module"','<link rel="stylesheet" href="/__preview/style.css"><script src="/__preview/media.js"></script><script type="module"');
      const controls=(scenario==='mic-pending'?'<button id="preview-allow" type="button">允許測試音軌</button>':'')+(scenario==='hangup-pending'?'<button id="preview-confirm" type="button">服務端確認結束</button>':'');
      html=html.replace('<body>','<body><aside class="preview-banner">本機介面驗收 · 合成會員與通話<a href="/__preview">切換情境</a>'+controls+'<output id="preview-track">使用合成測試音軌</output></aside>');
      return send(200,html,'text/html; charset=utf-8');
    }
    if(['/app.js','/style.css'].includes(url.pathname))return send(200,await readFile(new URL('../../public'+url.pathname,import.meta.url),'utf8'),url.pathname.endsWith('.js')?'text/javascript':'text/css');
    if(!state)return send(401,{error:'LOGIN_REQUIRED'});
    if(url.pathname==='/auth/login'){res.writeHead(302,{location:'/?scenario=member'});return res.end()}
    if(url.pathname==='/auth/status')return send(200,{authenticated:state.scenario!=='guest'});
    if(url.pathname==='/auth/logout'){state.scenario='guest';return send(200,{loggedOut:true})}
    if(state.scenario==='guest')return send(401,{error:'LOGIN_REQUIRED'});
    if(url.pathname==='/api/me')return send(200,{eligible:state.scenario!=='ineligible',remainingSeconds:state.balance});
    if(url.pathname==='/__preview/confirm'){for(const r of state.records.filter(r=>r.status==='ending')){r.status='ended';r.settlement={billedSeconds:21,remainingSeconds:211};r.usage=usage;}state.balance=211;return send(200,{confirmed:true})}
    if(url.pathname==='/api/calls'&&req.method==='GET')return send(200,state.records);
    if(url.pathname==='/api/calls'&&req.method==='POST'){
      if(!state.balance||state.scenario==='ineligible')return send(403,{error:state.balance?'MEMBER_INELIGIBLE':'QUOTA_EXHAUSTED'});
      if(state.records.some(r=>r.status==='active'||r.status==='ending'))return send(409,{error:'CALL_ALREADY_ACTIVE'});
      const r={...record(),id:'preview-'+randomUUID(),status:'active',createdAt:Date.now(),settlement:undefined,usage:state.scenario==='tool-wait'?{elapsedSeconds:15,audioStarted:true,waitingForTool:true}:usage};state.records.unshift(r);return send(201,{id:r.id,sdp:'v=0\r\nfixture',deadline:Date.now()+232000});
    }
    const match=/^\/api\/calls\/([^/]+)(?:\/(end|documents|deliveries)(?:\/([^/]+)\/email)?)?$/.exec(url.pathname);
    const r=state.records.find(r=>r.id===match?.[1]);if(!r)return send(404,{error:'RECORD_NOT_FOUND'});
    if(match[2]==='end'){r.status=state.scenario==='hangup-pending'?'ending':'ended';if(r.status==='ended'){r.settlement={billedSeconds:21,remainingSeconds:211};state.balance=211;}return send(200,r)}
    if(match[2]==='documents'){const doc={...record().documents[1],id:'preview-'+randomUUID()};r.documents.push(doc);return send(200,doc)}
    if(match[2]==='deliveries'){
      if(match[3])return send(200,{state:'succeeded'});
      let body='';for await(const part of req)body+=part;const input=JSON.parse(body);const job={id:'preview-job',documentId:input.documentId,channel:input.channel,state:'pending',createdAt:Date.now()};r.deliveries.push(job);return send(200,{job,claimCode:input.channel==='line'?'preview-once-code':undefined});
    }
    return send(200,r);
  } catch { res.writeHead(500);res.end('Preview fixture failed'); }
}).listen(8788,'127.0.0.1',()=>console.log('本機介面驗收：http://127.0.0.1:8788/__preview'));
