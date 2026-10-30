// Keep Puppeteer's browser inside the project so renders never depend on ~/.cache.
// Only chrome-headless-shell is used (scripts/render.js); skip the full Chrome download.
const { join } = require('path');

module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
  chrome: { skipDownload: true },
};
