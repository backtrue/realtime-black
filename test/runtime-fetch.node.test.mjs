import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, Response } from 'miniflare';

test('五個服務 client 的預設 fetch 在原生 Workers runtime 可完成請求', async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import { HttpEccalQuota } from './src/eccal-http';
      import { McpOAuth } from './src/mcp-oauth';
      import { ThinkWithBlackMcp } from './src/mcp';
      import { OpenAiRealtime, OpenAiDocuments } from './src/openai';
      export default { async fetch() {
        const anonymous = await new HttpEccalQuota('https://eccal.example.test', 'CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk').authenticate({cookie:'', authorization:''});
        const metadata = await new McpOAuth('https://voice.example.test').metadata();
        const tools = await new ThinkWithBlackMcp().list({memberId:'fixture-a', accessToken:'fixture-token', expiresAt:Date.now()+60000, readOnlyTools:['read_method']});
        const realtime = new OpenAiRealtime('fixture-key', 'fixture-model');
        const call = await realtime.create('v=0\\r\\noffer', []);
        await realtime.hangup(call.callId);
        const document = await new OpenAiDocuments('fixture-key', 'fixture-model').generate('report', {transcript:[], tools:[], transcriptionFailures:[]});
        return Response.json({anonymous, issuer:metadata.issuer, tools:tools.map(tool=>tool.name), call, document});
      }};
    ` },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  });
  const requests = [];
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-11-04', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
    outboundService: async request => {
      const url = new URL(request.url); requests.push(url.origin + url.pathname);
      const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      if (url.origin === 'https://eccal.example.test') return new Response('null', { headers: { 'content-type':'application/json', 'x-voice-contract':'eccal-voice-v1' } });
      if (url.pathname === '/.well-known/oauth-protected-resource/mcp') return json({ resource:'https://mcp.thinkwithblack.com/mcp', authorization_servers:['https://mcp.thinkwithblack.com'] });
      if (url.pathname === '/.well-known/oauth-authorization-server') return json({ issuer:url.origin, authorization_endpoint:url.origin+'/authorize', token_endpoint:url.origin+'/oauth/token', revocation_endpoint:url.origin+'/oauth/token', code_challenge_methods_supported:['S256'], scopes_supported:['thinkwithblack.use','thinkwithblack.methods.read'], token_endpoint_auth_methods_supported:['none'], client_id_metadata_document_supported:true });
      if (url.pathname === '/mcp') {
        if (request.method === 'GET') return new Response(null, { status:405 });
        if (request.method === 'DELETE') return new Response(null, { status:200 });
        const body = await request.json();
        if (body.id === undefined) return new Response(null, { status:202 });
        const result = body.method === 'initialize' ? { protocolVersion:'2025-03-26', capabilities:{tools:{}}, serverInfo:{name:'fixture',version:'1'} } : { tools:[{ name:'read_method', inputSchema:{type:'object'} }] };
        return json({jsonrpc:'2.0', id:body.id, result});
      }
      if (url.origin !== 'https://api.openai.com') throw new Error('Unexpected fixture origin');
      if (url.pathname === '/v1/realtime/client_secrets') return json({value:'fixture-ephemeral', expires_at:Math.floor(Date.now()/1000)+10});
      if (url.pathname === '/v1/realtime/calls') return new Response('v=0\r\nanswer', {status:201, headers:{location:'/v1/realtime/calls/rtc_fixture'}});
      if (url.pathname === '/v1/realtime/calls/rtc_fixture/hangup') return new Response(null, {status:200});
      if (url.pathname === '/v1/responses') return json({status:'completed', output:[{content:[{type:'output_text', text:JSON.stringify({kind:'report', title:'fixture', findings:[{kind:'unknown',text:'資料待補',sourceIds:[]}]})}]}]});
      throw new Error('Unexpected fixture path');
    },
  }));
  try {
    const response = await mf.dispatchFetch('https://fixture.example.test/');
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { anonymous:null, issuer:'https://mcp.thinkwithblack.com', tools:['read_method'], call:{callId:'rtc_fixture',sdp:'v=0\r\nanswer'}, document:{kind:'report',title:'fixture',findings:[{kind:'unknown',text:'資料待補',sourceIds:[]}]} });
    assert.deepEqual([...new Set(requests)].sort(), [
      'https://eccal.example.test/api/voice/internal/authenticate',
      'https://mcp.thinkwithblack.com/.well-known/oauth-protected-resource/mcp',
      'https://mcp.thinkwithblack.com/.well-known/oauth-authorization-server',
      'https://mcp.thinkwithblack.com/mcp',
      'https://api.openai.com/v1/realtime/client_secrets',
      'https://api.openai.com/v1/realtime/calls',
      'https://api.openai.com/v1/realtime/calls/rtc_fixture/hangup',
      'https://api.openai.com/v1/responses',
    ].sort());
  } finally { await mf.dispose(); }
});
