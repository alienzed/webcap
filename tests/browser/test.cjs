'use strict';
const {test:base,expect}=require('@playwright/test');
// Keep failures self-diagnosing without changing WebCap routes or DOM.
const test=base.extend({
  // General Studio tests control their own inference responses. The optional
  // Action Advisor is exercised explicitly by its own browser suites.
  advisorEnabled:[false,{option:true}],
  page:async({page,advisorEnabled},use,testInfo)=>{
    if (!advisorEnabled) await page.addInitScript(() => {
      localStorage.setItem('webcap.studio.actionAdvisor.enabled','false');
    });
    const problems=[];
    const live=process.env.WEBCAP_ACCEPTANCE_MODE==='live';
    const exchanges=[];
    const pending=[];
    if(live) {
      page.on('request',req=>{
        if(!req.url().includes('/fs/director/chat') || req.method()!=='POST') return;
        exchanges.push({direction:'browser_to_webcap',path:'/fs/director/chat',body:req.postDataJSON()});
      });
      page.on('response',response=>{
        const url=response.url();
        if(!url.includes('/fs/director/chat') && !url.includes('/fs/director/job?')) return;
        pending.push(response.json().then(body=>{
          if(url.includes('/fs/director/job?') &&
              !['completed','failed','stopped','cancelled','interrupted'].includes(body?.job?.status)) return;
          exchanges.push({direction:'webcap_to_browser',path:url.split('?')[0],body});
        }).catch(error=>exchanges.push({path:url,error:String(error)})));
      });
    }
    page.on('pageerror',error=>problems.push('PAGE ERROR '+String(error.stack||error)));
    page.on('console',message=>{
      if(message.type()==='error') problems.push('CONSOLE ERROR '+message.text());
    });
    page.on('requestfailed',request=>{
      const url=request.url();
      if(url.startsWith('http://127.0.0.1:4200/'))
        problems.push('NETWORK FAILED '+request.method()+' '+url+' : '+String(request.failure()?.errorText));
    });
    await use(page);
    await Promise.allSettled(pending);
    if(live) await testInfo.attach('live-studio-exchanges',{
      body:Buffer.from(JSON.stringify(exchanges,null,2)),contentType:'application/json'
    });
    if(testInfo.status!==testInfo.expectedStatus)
      await testInfo.attach('browser-diagnostics',{
        body:Buffer.from(problems.join('\n')||'No browser errors or failed application requests recorded.'),
        contentType:'text/plain'
      });
  }
});
module.exports={test,expect};
