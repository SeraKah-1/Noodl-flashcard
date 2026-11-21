import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
const root=resolve('public');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const port=Number(process.env.PORT||3000);
createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(pathname.startsWith('/api/')||pathname==='/mcp'){
   res.writeHead(501,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Local preview has no cloud identity. IndexedDB demo mode works; deploy the Worker for MCP and R2.'}));return;
  }
  const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+sep)&&file!==root)throw Error('Invalid path');
  const bytes=await readFile(file);
  res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(bytes);
 }catch(e){res.writeHead(404);res.end('Not found');}
}).listen(port,()=>console.log(`Noodl Flashcards local preview: http://localhost:${port}`));
