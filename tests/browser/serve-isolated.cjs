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
  fs.rmSync(path.join(root,'test-results','studio-temp-root.txt'),{force:true});
  process.exit(code);
}
process.once('SIGTERM', () => cleanup(0));
process.once('SIGINT', () => cleanup(130));
process.once('exit', () => {if (!cleaning) fs.rmSync(temp,{recursive:true,force:true});});

function portAvailableOn(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', error=>reject(new Error('Acceptance port '+port+' is unavailable: '+error.message)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
function portAvailable() { return portAvailableOn(4200); }
(async () => {
  await portAvailable(); // Refuse to reuse a running WebCap process on port 4200.
  const useLocalModels=process.env.WEBCAP_ACCEPTANCE_MODE==='live';
  if (!useLocalModels) await portAvailableOn(4211);
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
  if (useLocalModels) {
    // Read only inference-related fields; never copy the real app configuration
    // or redirect the isolated app to the user's writable Project/Set roots.
    const source=process.env.WEBCAP_TEST_CONFIG
      ? path.resolve(process.env.WEBCAP_TEST_CONFIG)
      : path.join(root,'tool','config.json');
    if (!fs.existsSync(source))
      throw new Error('Real-model acceptance needs a local WebCap config: '+source);
    const real=JSON.parse(fs.readFileSync(source,'utf8'));
    const realDirector=real.storyboard && real.storyboard.director;
    if (!realDirector || typeof realDirector!=='object')
      throw new Error('Configured Studio Director runtime was not found in '+source);
    cfg.storyboard=cfg.storyboard||{};
    cfg.storyboard.director=JSON.parse(JSON.stringify(realDirector));
    cfg.director_model=process.env.WEBCAP_TEST_DIRECTOR_MODEL ||
      String(real.director_model||'');
    // Local GGUF discovery needs the user's model directory, but WebCap
    // application writes remain exclusively under the temporary roots.
    cfg.filesystem.models=String(real.filesystem?.models||'');
    if (real.training?.wsl_distribution)
      cfg.training.wsl_distribution=real.training.wsl_distribution;
    console.log('Real-model acceptance: using existing Director configuration (read-only) from',source,
      '; selected model:',cfg.director_model||'(first available)');
  } else {
    cfg.director_model='acceptance::acceptance-model';
    cfg.storyboard=cfg.storyboard||{};
    cfg.storyboard.director={
      ...(cfg.storyboard.director||{}),
      mode:'remote',
      remote_endpoints:[{id:'acceptance',name:'Acceptance',
        endpoint:'http://127.0.0.1:4211',enabled:true}]
    };
  }
  fs.writeFileSync(path.join(temp,'tool/config.json'),JSON.stringify(cfg,null,2));
  fs.mkdirSync(path.dirname(logFile),{recursive:true});
  fs.writeFileSync(path.join(root,'test-results','studio-temp-root.txt'),temp);
  const logs = fs.openSync(logFile,'w');
  if (!useLocalModels) {
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
