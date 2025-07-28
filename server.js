const express = require("express");
const puppeteer = require("puppeteer");
const chromium = require("@sparticuz/chromium");

const app = express();
app.use(express.json());

// Health check endpoint
app.get("/health", (req, res) => {
  res.send("OK");
});

// Global browser instance
let browser;

const launchBrowser = async () => {
  console.log("Launching browser...");
  return puppeteer.launch({
    args: [
      ...chromium.args,
      "--disable-gpu",
      "--no-sandbox",
      "--single-process",
    ],
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
  });
};

// Launch browser on server start
(async () => {
  try {
    browser = await launchBrowser();
    console.log("✅ Browser launched successfully");
  } catch (err) {
    console.error("❌ Browser launch failed:", err);
  }
})();

app.post("/scrape", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Missing URL" });

  // Use 3 minute timeout (180000 ms)
  const TIMEOUT = 180000;

  let page;
  try {
    if (!browser || !browser.isConnected()) {
      console.log("Re-launching browser...");
      browser = await launchBrowser();
    }

    page = await browser.newPage();
    await page.setDefaultNavigationTimeout(TIMEOUT);

    console.log(`Navigating to: ${url}`);
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUT,
    });

    const html = await page.content();
    res.send(html);
  } catch (err) {
    console.error("Scraping error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (page && !page.isClosed()) await page.close();
  }
});

// Clean up browser on exit
process.on("SIGINT", () => {
  if (browser) browser.close().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  if (browser) browser.close().then(() => process.exit(0));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
