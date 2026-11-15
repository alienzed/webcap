'use strict';
if (!process.env.WEBCAP_TEST_REMOTE_ENDPOINT || !process.env.WEBCAP_TEST_REMOTE_MODEL)
  throw new Error('Set WEBCAP_TEST_REMOTE_ENDPOINT and WEBCAP_TEST_REMOTE_MODEL for opt-in live smoke.');
const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'./tests/live',testMatch:'*.spec.cjs',
  timeout:120_000,expect:{timeout:15_000},
  workers:1,retries:0,
  reporter:[['list'],['html',{open:'never',outputFolder:'test-results/studio-live-html'}]],
  outputDir:'test-results/studio-live-artifacts',
  use:{baseURL:'http://127.0.0.1:4200',browserName:'chromium',
    screenshot:'only-on-failure',trace:'retain-on-failure'},
  webServer:{
    command:'node tests/browser/serve-isolated.cjs',
    url:'http://127.0.0.1:4200/',
    reuseExistingServer:false,timeout:60_000
  }
});
