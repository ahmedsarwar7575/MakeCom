const express = require('express');
const puppeteer = require('puppeteer');
const chromium = require('@sparticuz/chromium');

const app = express();
app.use(express.json());

// Increase timeout to 2 minutes (120000 ms)
const PAGE_TIMEOUT = 180000;

app.post('/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing URL' });

  let browser;
  try {
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-sandbox',
      ],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
      timeout: PAGE_TIMEOUT,
    });

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(PAGE_TIMEOUT);
    await page.setDefaultTimeout(PAGE_TIMEOUT);

    // More resilient navigation with retries
    let html;
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
      try {
        await page.goto(url, { 
          waitUntil: 'domcontentloaded',
          timeout: PAGE_TIMEOUT
        });
        html = await page.content();
        break;
      } catch (err) {
        if (i === maxRetries - 1) throw err;
        console.log(`Retry ${i + 1} for ${url}`);
        await new Promise(r => setTimeout(r, 5000)); // wait 5s between retries
      }
    }

    res.send(html);
  } catch (err) {
    console.error('Scraping error:', err);
    res.status(500).json({ 
      error: err.message,
      type: err.name 
    });
  } finally {
    if (browser) await browser.close().catch(e => console.error('Browser close error:', e));
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));