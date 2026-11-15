'use strict';
// Controlled OpenAI-compatible *external inference endpoint*. WebCap's Flask
// routes, queue, model request builders, and persistence remain real.
const http=require('node:http');
const port=4211;
const responses=[], calls=[];
function json(res,code,body) {
  res.writeHead(code,{'Content-Type':'application/json'});
  res.end(JSON.stringify(body));
}
function body(req) {
  return new Promise((resolve,reject)=>{
    let text='';
    req.on('data',chunk=>{text+=chunk;if(text.length>2_000_000)req.destroy();});
    req.once('end',()=>{try{resolve(text?JSON.parse(text):{});}catch(e){reject(e);}});
    req.once('error',reject);
  });
}
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1:'+port);
    if(req.method==='GET' && url.pathname==='/models')
      return json(res,200,{object:'list',data:[{id:'acceptance-model',object:'model',status:{value:'loaded'}}]});
    if(req.method==='POST' && (url.pathname==='/chat/completions'||url.pathname==='/v1/chat/completions')) {
      const payload=await body(req);calls.push(payload);
      if(!responses.length) return json(res,503,{error:{message:'No queued controlled response for this inference request'}});
      const item=responses.shift();
      if(item.httpError) return json(res,item.httpError,{error:{message:item.message||'Controlled inference failure'}});
      return json(res,200,{
        id:'acceptance-'+calls.length,object:'chat.completion',model:'acceptance-model',
        choices:[{index:0,message:{role:'assistant',content:typeof item.value==='string'?item.value:JSON.stringify(item.value)},finish_reason:'stop'}],
        usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}
      });
    }
    // Controls are hosted on the fake inference server, not added to WebCap.
    if(url.pathname==='/__acceptance/reset' && req.method==='POST') {
      responses.length=0;calls.length=0;return json(res,200,{ok:true});
    }
    if(url.pathname==='/__acceptance/queue' && req.method==='POST') {
      const item=await body(req);responses.push(item);return json(res,200,{ok:true,queued:responses.length});
    }
    if(url.pathname==='/__acceptance/calls' && req.method==='GET')
      return json(res,200,{calls,remaining:responses.length});
    return json(res,404,{error:'Unknown external inference endpoint'});
  } catch(error){json(res,500,{error:String(error)});}
});
server.listen(port,'127.0.0.1',()=>console.log('Controlled inference endpoint listening on '+port));
process.once('SIGTERM',()=>server.close());
