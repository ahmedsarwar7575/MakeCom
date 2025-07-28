const express = require("express");
const puppeteer = require("puppeteer");
const chromium = require("@sparticuz/chromium");

const app = express();
app.use(express.json());
const TIMEOUT = 180000;
app.post("/scrape", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Missing URL" });

  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
      timeout: TIMEOUT,
    });

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(TIMEOUT);
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUT,
    });
    const html = await page.content();
    await browser.close();

    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
