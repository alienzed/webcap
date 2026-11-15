'use strict';
// Launch a real WebCap server from a disposable copy, never from a user's working install.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn} = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'webcap-browser-'));
const logFile = path.join(root, 'test-results', 'studio-backend.log');
let child, modelProcess, cleaning = false;
function cleanup(code) {
  if (cleaning) return;
  cleaning = true;
  if (child && child.exitCode === null) child.kill('SIGTERM');
  if (modelProcess && modelProcess.exitCode === null) modelProcess.kill('SIGTERM');
  // A file-backed application must not leak acceptance Projects into the real app.
  fs.rmSync(temp, {recursive:true, force:true});
  process.exit(code);
}
process.once('SIGTERM', () => cleanup(0));
process.once('SIGINT', () => cleanup(130));
process.once('exit', () => {if (!cleaning) fs.rmSync(temp,{recursive:true,force:true});});

function portAvailable() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(4200, '127.0.0.1', () => server.close(resolve));
  });
}
(async () => {
  await portAvailable(); // Refuse to reuse a running WebCap process on port 4200.
  for (const name of ['tool','docs','scripts']) {
    if (!fs.existsSync(path.join(root,name))) continue;
    fs.cpSync(path.join(root,name),path.join(temp,name),{
      recursive:true,
      filter:src=>!src.endsWith(path.sep+'config.json') &&
        !src.includes(path.sep+'__pycache__') &&
        !src.includes(path.sep+'.git'+path.sep)
    });
  }
  for (const name of ['sets','data','models']) fs.mkdirSync(path.join(temp,name),{recursive:true});
  const cfg = JSON.parse(fs.readFileSync(path.join(temp,'tool/config.example.json'),'utf8'));
  cfg.filesystem.root = path.join(temp,'sets');
  cfg.filesystem.output_root = path.join(temp,'output');
  cfg.filesystem.app_data_root = path.join(temp,'data');
  cfg.filesystem.models = path.join(temp,'models');
  const liveEndpoint=process.env.WEBCAP_TEST_REMOTE_ENDPOINT;
  const liveModel=process.env.WEBCAP_TEST_REMOTE_MODEL;
  if(Boolean(liveEndpoint)!==Boolean(liveModel))
    throw new Error('Live smoke requires BOTH WEBCAP_TEST_REMOTE_ENDPOINT and WEBCAP_TEST_REMOTE_MODEL.');
  const remoteId=liveEndpoint?'acceptance-live':'acceptance';
  cfg.director_model = remoteId+'::'+(liveModel||'acceptance-model');
  cfg.storyboard = cfg.storyboard || {};
  cfg.storyboard.director = {
    ...(cfg.storyboard.director || {}),
    mode:'remote',
    remote_endpoints:[{
      id:remoteId,name:liveEndpoint?'Live acceptance':'Acceptance',
      endpoint:liveEndpoint||'http://127.0.0.1:4211',enabled:true
    }]
  };
  fs.writeFileSync(path.join(temp,'tool/config.json'),JSON.stringify(cfg,null,2));
  fs.mkdirSync(path.dirname(logFile),{recursive:true});
  const logs = fs.openSync(logFile,'w');
  if (!liveEndpoint) {
    modelProcess=spawn(process.execPath,[path.join(root,'tests/browser/model-boundary.cjs')],{
      cwd:root,stdio:['ignore',logs,logs]
    });
  }
  const python = process.env.WEBCAP_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  child=spawn(python,['-m','tool.server.app'],{
    cwd:temp,env:{...process.env,PYTHONPATH:temp,PYTHONUNBUFFERED:'1'},
    stdio:['ignore',logs,logs]
  });
  child.once('exit',(code,signal)=>{
    console.error('Isolated WebCap exited:',code,signal,'; backend log:',logFile);
    cleanup(code || 1);
  });
  console.log('Starting isolated WebCap; backend log:',logFile);
})().catch(error => {console.error(error);cleanup(1);});
