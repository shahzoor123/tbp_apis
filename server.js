import express from 'express';
import puppeteer from 'puppeteer';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4000;

// Enhanced CORS configuration
app.use(cors({
  origin: [
    'http://localhost:3000', 
    'http://localhost:3001', 
    'http://localhost:5000', 
    'http://localhost:5173', 
    'http://localhost:8000',
    'http://127.0.0.1:3000', 
    'http://127.0.0.1:5173',
    'http://127.0.0.1:8000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' })); // Increased limit
app.use(express.static(join(__dirname, 'public')));
// Serve local fonts if present
app.use('/fonts', express.static(join(__dirname, 'fonts')));

// Health endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    environment: 'local',
    timestamp: new Date().toISOString()
  });
});

// Inline Google Fonts styles helper
async function inlineGoogleFonts(html) {
  try {
    const linkRegex = /<link[^>]+href=["'](https:\/\/fonts\.googleapis\.com\/[^"']+)["'][^>]*>/gi;
    const links = [];
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      links.push(match[0]);
    }

    let inlined = html;
    for (const linkTag of links) {
      const urlMatch = linkTag.match(/href=["']([^"']+)["']/i);
      const href = urlMatch?.[1];
      if (!href) continue;
      try {
        const cssRes = await fetch(href);
        if (!cssRes.ok) continue;
        let css = await cssRes.text();
        // Replace gstatic font URLs with absolute https
        css = css.replace(/url\((\/\/fonts\.gstatic\.com[^\)]+)\)/g, 'url(https:$1)');
        css = css.replace(/url\((https:\/\/fonts\.gstatic\.com[^\)]+)\)/g, 'url($1)');
        const styleTag = `<style data-inlined-google-fonts>${css}</style>`;
        inlined = inlined.replace(linkTag, styleTag);
      } catch {}
    }
    return inlined;
  } catch {
    return html;
  }
}

// Enhanced HTML processing function
function processHtmlForRendering(html) {
  // Keep Google Fonts links and imports; only strip scripts/iframes and unsafe external styles
  let processedHtml = html;

  // Inject preconnect hints for Google Fonts if not present
  const hasPreconnectGoogapis = /<link[^>]+rel=["']preconnect["'][^>]+href=["']https:\/\/fonts\.googleapis\.com["'][^>]*>/i.test(processedHtml);
  const hasPreconnectGstatic = /<link[^>]+rel=["']preconnect["'][^>]+href=["']https:\/\/fonts\.gstatic\.com["'][^>]*>/i.test(processedHtml);
  const preconnectLinks = `${hasPreconnectGoogapis ? '' : '<link rel="preconnect" href="https://fonts.googleapis.com">'}${hasPreconnectGstatic ? '' : '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'}`;
  if (preconnectLinks) {
    if (processedHtml.includes('</head>')) {
      processedHtml = processedHtml.replace('</head>', `${preconnectLinks}</head>`);
    } else {
      processedHtml = `${preconnectLinks}${processedHtml}`;
    }
  }

  // Remove any remaining external scripts/iframes
  processedHtml = processedHtml
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '');

  return processedHtml;
}

// Enhanced capture function
async function captureHtml({ html, width = 1200, height = 800, deviceScaleFactor = 2 }) {
  let browser;
  
  try {
    console.log('Starting enhanced capture process...');
    console.log('Input dimensions:', width, 'x', height);

    // Process HTML and inline Google Fonts CSS
    let cleanHtml = processHtmlForRendering(html);
    cleanHtml = await inlineGoogleFonts(cleanHtml);

    // Launch browser with enhanced configuration
    browser = await puppeteer.launch({
      headless: true,
      defaultViewport: { width, height, deviceScaleFactor },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--font-render-hinting=full',
        '--enable-font-antialiasing',
        '--disable-gpu',
        `--window-size=${width},${height}`,
        '--enable-font-antialiasing=true',
        '--enable-webgl=true',
        '--enable-software-rasterizer=true'
      ],
    });

    const page = await browser.newPage();

    // Modern UA helps Google Fonts serve woff2
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');

    // Bypass CSP to allow inline styles we inject
    await page.setBypassCSP(true);

    // Set viewport
    await page.setViewport({ width, height, deviceScaleFactor });

    // Minimal normalization only
    await page.evaluateOnNewDocument(() => {
      const style = document.createElement('style');
      style.textContent = `
        html, body { margin: 0 !important; padding: 0 !important; background: transparent !important; }
        * { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
      `;
      document.head.appendChild(style);
    });

    console.log('Setting HTML content...');
    
    // Set content with enhanced options
    await page.setContent(cleanHtml, { 
      waitUntil: ['domcontentloaded', 'networkidle0'],
      timeout: 120000
    });

    console.log('Waiting for rendering stabilization...');
    
    // Enhanced waiting strategy
    await page.evaluate(async () => {
      try {
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
      } catch {}

      try {
        const test = document.createElement('span');
        test.style.fontFamily = getComputedStyle(document.body).fontFamily || 'sans-serif';
        test.textContent = 'Font Load Check';
        document.body.appendChild(test);
        test.getBoundingClientRect();
        test.remove();
      } catch {}

      const images = Array.from(document.images);
      await Promise.all(images.map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load', resolve);
          img.addEventListener('error', resolve);
        });
      }));

      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => requestAnimationFrame(() => resolve()));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('Taking screenshot...');
    const buffer = await page.screenshot({
      type: 'png',
      omitBackground: true,
      fullPage: false,
      captureBeyondViewport: false,
      optimizeForSpeed: false,
      clip: { x: 0, y: 0, width, height }
    });

    console.log('Screenshot completed, buffer size:', buffer.length);

    await page.close();
    await browser.close();

    console.log('Capture completed successfully!');
    return buffer;

  } catch (error) {
    console.error('Capture error:', error);
    if (browser) await browser.close();
    throw error;
  }
}

// Enhanced render endpoint
app.post('/render', async (req, res) => {
  try {
    console.log('📥 Received render request from:', req.headers.origin);
    
    const { html, width = 1200, height = 800, deviceScaleFactor = 2 } = req.body;

    if (!html || typeof html !== 'string') {
      return res.status(400).json({ error: 'Invalid html payload' });
    }

    console.log('📐 Dimensions:', width, 'x', height, '@ scale', deviceScaleFactor);
    console.log('📄 HTML size:', html.length, 'characters');

    const buffer = await captureHtml({ html, width, height, deviceScaleFactor });

    console.log('✅ Capture successful! Sending', buffer.length, 'bytes');

    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Content-Length': buffer.length.toString(),
      'X-Success': 'true'
    });

    res.send(buffer);

  } catch (error) {
    console.error('❌ Render error:', error);
    res.status(500).json({ 
      error: 'Capture failed', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Enhanced Render API running on http://localhost:${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
});