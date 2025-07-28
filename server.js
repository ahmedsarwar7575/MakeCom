// server.js
const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json());

app.post('/scrape', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing URL' });

  try {
    const browser = await puppeteer.launch({
        headless: 'new',
        executablePath: puppeteer.executablePath(),
      });
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'networkidle0' });
    const html = await page.content();

    await browser.close();

    res.send(html); // Send full HTML back
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
