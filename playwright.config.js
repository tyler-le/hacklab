'use strict';
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  use: {
    headless: process.env.HEADED !== '1',
    launchOptions: {
      slowMo: parseInt(process.env.SLOW_MO || '0'),
    },
  },
});
