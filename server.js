const express = require('express');
const puppeteer = require('puppeteer');
const chromium = require('@sparticuz/chromium');
const { setTimeout } = require('timers/promises');

const app = express();
app.use(express.json());

// Browser management with request queue
let browserInstance = null;
const requestQueue = [];
let isProcessing = false;
const TIMEOUT_MS = 180000; // 3 minutes

// Health check endpoint
app.get('/health', (req, res) => {
  res.send('OK');
});

// Browser launch with robust error handling
const launchBrowser = async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`Launching browser attempt #${attempt}`);
      return await puppeteer.launch({
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
        timeout: TIMEOUT_MS
      });
    } catch (error) {
      console.error(`Browser launch attempt ${attempt} failed:`, error);
      if (attempt === 3) throw error;
      await setTimeout(5000); // Wait 5 seconds before retrying
    }
  }
};

// Process requests from queue
const processQueue = async () => {
  if (isProcessing || requestQueue.length === 0) return;
  
  isProcessing = true;
  const { req, res } = requestQueue.shift();
  
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing URL' });

    let browser = browserInstance;
    if (!browser || !browser.isConnected()) {
      browserInstance = await launchBrowser();
      browser = browserInstance;
      console.log('✅ Browser launched successfully');
    }

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(TIMEOUT_MS);
    await page.setDefaultTimeout(TIMEOUT_MS);
    
    // Set user agent to avoid bot detection
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    console.log(`Navigating to: ${url}`);
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: TIMEOUT_MS
    });
    
    // Wait for main content to appear
    await page.waitForSelector('body', { timeout: TIMEOUT_MS });
    
    // Extract main content
    const mainContentHtml = await page.evaluate(() => {
      try {
        // Find main content container
        const mainElement = document.querySelector('main') || 
                            document.querySelector('.main-content') || 
                            document.querySelector('#content') || 
                            document.querySelector('article') || 
                            document.body;
        
        // Clone to avoid modifying original DOM
        const cleanElement = mainElement.cloneNode(true);
        
        // Remove unwanted elements
        const selectorsToRemove = [
          'header', 'nav', 'footer', '.header', '.navbar', 
          '.footer', '.nav', '.ads', 'script', 'style', 
          'noscript', 'link', 'iframe', 'svg', 'img',
          'aside', '.sidebar', '.ad-container'
        ];
        
        selectorsToRemove.forEach(selector => {
          cleanElement.querySelectorAll(selector).forEach(el => el.remove());
        });
        
        return cleanElement.innerHTML;
      } catch (error) {
        console.error('DOM processing error:', error);
        return document.documentElement.outerHTML;
      }
    });
    
    res.send(mainContentHtml);
  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    // Always close the page
    if (page && !page.isClosed()) {
      await page.close().catch(e => console.error('Error closing page:', e));
    }
    
    isProcessing = false;
    processQueue(); // Process next request
  }
};

// Request queue handling
app.post('/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing URL' });

  let page;
  try {
    if (!browser || !browser.isConnected()) {
      browser = await launchBrowser();
    }

    page = await browser.newPage();
    
    // Set user agent to mimic a real browser
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Set timeouts to 3 minutes
    await page.setDefaultNavigationTimeout(180000);
    await page.setDefaultTimeout(180000);
    
    console.log(`Navigating to: ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2',  // Wait for network activity to finish
      timeout: 180000
    });
    
    // Wait for the main content container to be present
    await page.waitForSelector('article', { timeout: 180000 });
    
    // Scroll to trigger lazy-loaded content
    await autoScroll(page);
    
    // Add a small delay to ensure all content is rendered
    await page.waitForTimeout(3000);
    
    // Extract the entire article content
    const articleContent = await page.evaluate(() => {
      try {
        const article = document.querySelector('article');
        if (!article) return document.documentElement.outerHTML;
        
        // Return the entire article content
        return article.outerHTML;
      } catch (error) {
        return document.documentElement.outerHTML;
      }
    });
    
    res.send(articleContent);
  } catch (err) {
    console.error('Scraping error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (page && !page.isClosed()) await page.close();
  }
});

// Add this helper function above your route
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