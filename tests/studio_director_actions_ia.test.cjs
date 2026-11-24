'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync('tool/tool.html','utf8'),shell=fs.readFileSync('tool/css/workspace_shell.css','utf8'),styles=fs.readFileSync('tool/css/storyboard.css','utf8'),bench=fs.readFileSync('tool/js/studio_director_workbench.js','utf8');
test('conversation controls have visible header ownership',()=>{
 const header=html.split('class="director-chat-drawer-header"')[1].split('</header>')[0];
 const pin=header.indexOf('id="director-chat-pin"'),fresh=header.indexOf('id="director-chat-clear"'),history=header.indexOf('id="director-chat-history-toggle"');
 assert.ok(pin>=0&&pin<fresh&&fresh<history);
 const menu=html.split('id="director-studio-actions-menu"')[1].split('</div>')[0];
 for(const kind of ['read','scene','project','revision','io'])assert.match(menu,new RegExp('data-studio-tool="'+kind+'"'));
 assert.doesNotMatch(menu,/data-studio-tool="(history|new-chat)"/);
 assert.match(shell,/not\(\.studio-revision-mode\) #director-chat-clear \{width:36px/);
 assert.match(shell,/not\(\.studio-revision-mode\) \.studio-header-icon \{display:block/);
});
test('suggested action belongs to composer and preserves explicit handoff',()=>{
 const body=html.split('id="director-chat-messages"')[1];
 assert.ok(body.indexOf('id="studio-action-advisor"')>body.indexOf('class="director-chat-composer"'));
 assert.equal((html.match(/id="studio-action-advisor"/g)||[]).length,1);
 assert.match(styles,/studio-action-advisor \{[\s\S]*?margin:0 0 12px/);
 assert.match(bench,/button\.onclick = function \(\) \{return prepareAdvisorAction\(action,scope\);\}/);
 assert.match(bench,/Only prepare the existing form; Read and Write remain explicit/);
});
test('overflow preserves tools and diagnostic entry but not duplicated navigation',()=>{
 assert.doesNotMatch(bench,/menu\.querySelector\('\[data-studio-tool="(history|new-chat)"\]'\)/);
 assert.match(html,/class="director-studio-actions-divider"/);
 assert.match(bench,/if \(tool === 'revision'\)/);
 assert.match(bench,/if \(tool === 'io'\)/);
});
