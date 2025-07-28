const express = require('express');
const puppeteer = require('puppeteer');
const chromium = require('@sparticuz/chromium');
const cheerio = require('cheerio'); // For HTML parsing

const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.send('OK');
});

// Global browser instance
let browser;

const launchBrowser = async () => {
  console.log('Launching browser...');
  return puppeteer.launch({
    args: [...chromium.args, '--disable-gpu', '--no-sandbox', '--single-process', '--disable-dev-shm-usage'],
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
    timeout: 180000, // 3 minutes
  });
};

// Launch browser on server start
(async () => {
  try {
    browser = await launchBrowser();
    console.log('✅ Browser launched successfully');
  } catch (err) {
    console.error('❌ Browser launch failed:', err);
  }
})();

app.post('/scrape', async (req, res) => {
  const { url, mainContentSelector = 'main, .main, #main, .content' } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing URL' });

  let page;
  try {
    if (!browser || !browser.isConnected()) {
      console.log('Re-launching browser...');
      browser = await launchBrowser();
    }

    page = await browser.newPage();
    await page.setDefaultNavigationTimeout(180000); // 3 minutes
    await page.setDefaultTimeout(180000); // 3 minutes

    console.log(`Navigating to: ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 180000
    });

    // Wait for main content to be present
    console.log('Waiting for main content...');
    await page.waitForSelector(mainContentSelector, {
      timeout: 180000
    });

    // Execute JavaScript in browser context to extract only main content
    const mainContentHtml = await page.evaluate((selector) => {
      try {
        // Get main content element
        const mainElement = document.querySelector(selector) || document.body;
        
        // Remove unwanted elements
        const elementsToRemove = [
          ...mainElement.querySelectorAll('header, nav, footer, .header, .navbar, .footer, .nav, .ads'),
          ...document.querySelectorAll('script, style, noscript, link')
        ];
        
        elementsToRemove.forEach(el => el.remove());
        
        // Return clean HTML
        return mainElement.innerHTML;
      } catch (error) {
        console.error('DOM processing error:', error);
        return document.documentElement.outerHTML;
      }
    }, mainContentSelector);

    res.send(mainContentHtml);
  } catch (err) {
    console.error('Scraping error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (page && !page.isClosed()) await page.close();
  }
});

// Graceful shutdown
process.on('SIGINT', async () => {
  if (browser) await browser.close();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  if (browser) await browser.close();
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));