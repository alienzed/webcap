'use strict';
// Uses the same isolated Flask/browser launcher as deterministic acceptance.
// Unlike the CI suite it reads the local Director model configuration and
// intentionally makes real inference calls. Never part of automatic CI.
process.env.WEBCAP_ACCEPTANCE_MODE='live';
const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'./tests/live',
  testMatch:'*.spec.cjs',
  timeout:480_000,
  expect:{timeout:90_000},
  workers:1,
  retries:0,
  reporter:[['list'],['html',{open:'never',outputFolder:'test-results/studio-live-html'}]],
  outputDir:'test-results/studio-live-artifacts',
  use:{
    baseURL:'http://127.0.0.1:4200',
    browserName:'chromium',
    actionTimeout:15_000,
    navigationTimeout:20_000,
    screenshot:'only-on-failure',
    trace:'retain-on-failure'
  },
  webServer:{
    command:'node tests/browser/serve-isolated.cjs',
    url:'http://127.0.0.1:4200/',
    reuseExistingServer:false,
    timeout:90_000,
    env:{WEBCAP_ACCEPTANCE_MODE:'live'}
  }
});
