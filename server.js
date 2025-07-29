const express = require('express');
const puppeteer = require('puppeteer');
const chromium = require('@sparticuz/chromium');
const { setTimeout } = require('timers/promises');

const app = express();
app.use(express.json());

// Browser management variables
let browserInstance = null;
let browserInUse = false;
const BROWSER_LAUNCH_DELAY = 5000; // 5 seconds delay between launches

// Health check endpoint
app.get('/health', (req, res) => {
  res.send('OK');
});

// Function to safely launch browser with retries
const safeLaunchBrowser = async () => {
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Launching browser attempt ${attempt}...`);
      const browser = await puppeteer.launch({
        args: [
          ...chromium.args,
          '--disable-gpu',
          '--no-sandbox',
          '--single-process',
          '--disable-dev-shm-usage',
          '--disable-setuid-sandbox',
          '--no-zygote'
        ],
        executablePath: await chromium.executablePath(),
        headless: 'new',
        ignoreHTTPSErrors: true,
        timeout: 180000 // 3 minutes
      });
      
      console.log('✅ Browser launched successfully');
      return browser;
    } catch (err) {
      console.error(`❌ Browser launch attempt ${attempt} failed:`, err);
      
      if (attempt < maxRetries) {
        console.log(`Waiting ${BROWSER_LAUNCH_DELAY}ms before retry...`);
        await setTimeout(BROWSER_LAUNCH_DELAY);
      } else {
        throw err;
      }
    }
  }
};

// Get browser instance with locking mechanism
const getBrowser = async () => {
  while (browserInUse) {
    console.log('Browser in use, waiting...');
    await setTimeout(1000);
  }
  
  browserInUse = true;
  
  try {
    if (!browserInstance || !browserInstance.isConnected()) {
      browserInstance = await safeLaunchBrowser();
    }
    return browserInstance;
  } finally {
    browserInUse = false;
  }
};

app.post('/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing URL' });

  let browser, page;
  try {
    browser = await getBrowser();
    page = await browser.newPage();
    
    // Set timeouts to 3 minutes
    await page.setDefaultNavigationTimeout(180000);
    await page.setDefaultTimeout(180000);
    
    console.log(`Navigating to: ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 180000
    });
    
    // Wait for main content to load
    console.log('Waiting for main content...');
    await page.waitForFunction(() => {
      const mainContent = document.querySelector('main') || 
                          document.querySelector('.main-content') || 
                          document.querySelector('#content') || 
                          document.body;
      return mainContent.innerText.trim() !== '';
    }, { timeout: 180000 });
    
    // Extract and clean main content
    const mainContentHtml = await page.evaluate(() => {
      try {
        // Find main content container
        const mainElement = document.querySelector('main') || 
                            document.querySelector('.main-content') || 
                            document.querySelector('#content') || 
                            document.body;
        
        // Clone to avoid modifying original DOM
        const cleanElement = mainElement.cloneNode(true);
        
        // Remove unwanted elements
        const selectorsToRemove = [
          'header', 'nav', 'footer', '.header', '.navbar', 
          '.footer', '.nav', '.ads', 'script', 'style', 
          'noscript', 'link', 'iframe', 'svg', 'img'
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
  } catch (err) {
    console.error('Scraping error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (page && !page.isClosed()) await page.close();
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