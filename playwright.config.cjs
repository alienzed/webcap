'use strict';
const {defineConfig} = require('@playwright/test');
module.exports=defineConfig({
  testDir:'./tests/browser',
  testMatch:'*.spec.cjs',
  timeout:45_000,
  expect:{timeout:10_000},
  workers:1,
  retries:0,
  reporter:[['list'],['html',{open:'never',outputFolder:'test-results/studio-html'}]],
  outputDir:'test-results/studio-artifacts',
  use:{
    baseURL:'http://127.0.0.1:4200',
    actionTimeout:10_000,
    navigationTimeout:15_000,
    browserName:'chromium',
    screenshot:'only-on-failure',
    trace:'retain-on-failure',
  },
  webServer:{
    command:'node tests/browser/serve-isolated.cjs',
    url:'http://127.0.0.1:4200/',
    reuseExistingServer:false,
    timeout:60_000,
  }
});
