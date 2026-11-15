'use strict';
const {test:base,expect}=require('@playwright/test');
// Keep failures self-diagnosing without changing WebCap routes or DOM.
const test=base.extend({
  page:async({page},use,testInfo)=>{
    const problems=[];
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
    if(testInfo.status!==testInfo.expectedStatus)
      await testInfo.attach('browser-diagnostics',{
        body:Buffer.from(problems.join('\n')||'No browser errors or failed application requests recorded.'),
        contentType:'text/plain'
      });
  }
});
module.exports={test,expect};
