import test from 'node:test';import assert from 'node:assert/strict';
import server,{TOOLS,callTool,handleMcp} from '../worker/index.js';
test('MCP tool catalog has NO quiz or AI provider tools',()=>{const names=TOOLS.map(t=>t.name);assert(names.includes('create_deck'));assert(names.includes('import_media_file'));assert(names.includes('app_approve_media'));assert(!names.some(n=>/quiz|brain_dump|gemini|openai_key|smart_sweep|simulation|comic|question_bank/.test(n)));});
test('import_media_file declares actual OpenAI file parameter',()=>{const t=TOOLS.find(x=>x.name==='import_media_file');assert.deepEqual(t._meta['openai/fileParams'],['file']);assert.deepEqual(t.inputSchema.properties.file.required,['download_url','file_id']);});
test('media approval cannot be triggered as create_deck side effect',async()=>{const mockDb={prepare(sql){return {bind(...args){return {first:async()=>null,all:async()=>({results:[]})}}}}};await assert.rejects(callTool('create_deck',{DB:mockDb},'alice',{operationId:'x',title:'Test',cards:[{front:[{type:'image',assetId:'none',alt:'Needs approval'}],back:[{type:'text',text:'Nope'}],clues:[{atSecond:5,text:'A'},{atSecond:10,text:'B'},{atSecond:15,text:'C'}]}]}),/Image not found|requires/);});
test('public worker fails closed without a trusted identity proxy',async()=>{const request=new Request('https://example.org/mcp',{method:'POST',headers:{'oai-authenticated-user-id':'forged','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});const response=await server.fetch(request,{TRUSTED_SITES_PROXY:'false'});assert.equal(response.status,401);assert.match(await response.text(),/trusted ChatGPT Sites/);});

test('Sites can discover MCP tools using the hosted protocol handshake', async () => {
 const request = new Request('https://example.org/mcp', {
  method: 'POST',
  headers: {'oai-authenticated-user-id': 'alice', 'content-type': 'application/json'},
  body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'server/discover'}),
 });
 const response = await handleMcp(request, {TRUSTED_SITES_PROXY: 'true'});
 assert.equal(response.status, 200);
 const {result} = await response.json();
 assert.deepEqual(result.supportedVersions, ['2026-07-28']);
 assert.deepEqual(result.capabilities.tools, {});
});
