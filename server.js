const express = require('express');
const puppeteer = require('puppeteer');
const chromium = require('@sparticuz/chromium');

const app = express();
app.use(express.json());

// Browser instance management
let browserInstance = null;
let isBrowserAvailable = true;

// Health check endpoint
app.get('/health', (req, res) => {
  res.send('OK');
});

// Browser launch with retries and error handling
const launchBrowser = async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Launching browser attempt #${attempt}`);
      const browser = await puppeteer.launch({
        args: [
          ...chromium.args,
          '--disable-gpu',
          '--no-sandbox',
          '--single-process',
          '--disable-dev-shm-usage',
          '--disable-setuid-sandbox',
          '--no-zygote',
          '--memory-pressure-off'
        ],
        executablePath: await chromium.executablePath(),
        headless: 'new',
        ignoreHTTPSErrors: true,
        timeout: 180000 // 3 minutes
      });
      console.log('✅ Browser launched successfully');
      return browser;
    } catch (error) {
      console.error(`Browser launch attempt ${attempt} failed:`, error);
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds before retrying
    }
  }
};

// Get browser instance with locking mechanism
const getBrowser = async () => {
  while (!isBrowserAvailable) {
    console.log('Browser in use, waiting...');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  isBrowserAvailable = false;
  
  try {
    if (!browserInstance || !browserInstance.isConnected()) {
      browserInstance = await launchBrowser();
    }
    return browserInstance;
  } finally {
    isBrowserAvailable = true;
  }
};

// Helper function to scroll the page
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });
}

// Scraping endpoint with enhanced content extraction
app.post('/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing URL' });

  let browser, page;
  try {
    browser = await getBrowser();
    page = await browser.newPage();
    
    // Set user agent to mimic a real browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Set timeouts to 3 minutes
    await page.setDefaultNavigationTimeout(180000);
    await page.setDefaultTimeout(180000);
    
    console.log(`Navigating to: ${url}`);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 180000
    });
    
    // Wait for the main content container
    await page.waitForSelector('article', { timeout: 180000 });
    
    // Scroll to trigger lazy-loaded content
    await autoScroll(page);
    
    // Add a small delay to ensure all content is rendered
    await page.waitForTimeout(3000);
    
    // Extract and clean main content
    const mainContentHtml = await page.evaluate(() => {
      try {
        // Find main content container
        const mainElement = document.querySelector('article') || 
                            document.querySelector('main') || 
                            document.querySelector('.main-content') || 
                            document.querySelector('#content') || 
                            document.body;
        
        // Clone to avoid modifying original DOM
        const cleanElement = mainElement.cloneNode(true);
        
        // Remove unwanted elements
        const selectorsToRemove = [
          'header', 'nav', 'footer', '.header', '.navbar', 
          '.footer', '.nav', '.ads', 'script', 'style', 
          'noscript', 'link', 'iframe', 'svg', 'img',
          'aside', '.sidebar', '.ad-container', '.site-header',
          '.site-footer', '.cookie-banner', '.newsletter'
        ];
        
        selectorsToRemove.forEach(selector => {
          cleanElement.querySelectorAll(selector).forEach(el => el.remove());
        });
        
        return cleanElement.outerHTML;
      } catch (error) {
        console.error('DOM processing error:', error);
        return document.documentElement.outerHTML;
      }
    });
    
    res.send(mainContentHtml);
  } catch (err) {
    console.error('Scraping error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (page && !page.isClosed()) {
      await page.close().catch(e => console.error('Error closing page:', e));
    }
  }
});

// Clean up browser on exit
const cleanup = async () => {
  if (browserInstance) {
    console.log('Closing browser...');
    await browserInstance.close().catch(err => console.error('Error closing browser:', err));
    browserInstance = null;
  }
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));