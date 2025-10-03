// server.js
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { removeBackground } from '@imgly/background-removal-node'; // ← Use Node version
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

// ES6 way to get __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Configure Multer with better file handling
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, JPG, and WEBP are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  }
});

// Enable CORS
app.use(cors({
  origin: '*',
  credentials: true
}));

// JSON body parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// ============================================
// BACKGROUND REMOVAL ENDPOINTS
// ============================================


app.post('/api/remove-background', upload.single('image'), async (req, res) => {
    let tempPath = null;
    
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image provided' });
      }
  
      tempPath = req.file.path;
      console.log('📥 Received image:', req.file.originalname);
      console.log('📊 Size:', (req.file.size / 1024).toFixed(2), 'KB');
      console.log('📄 Mime type:', req.file.mimetype);
      
      // Read the file as buffer
      const imageBuffer = await fs.readFile(tempPath);
      
      // Debug: Check file signature to understand the actual format
      const signature = imageBuffer.slice(0, 8).toString('hex').toUpperCase();
      console.log('🔍 File signature:', signature);
      
      // Common file signatures:
      // JPEG: FFD8FF
      // PNG: 89504E470D0A1A0A
      
      // Remove background using buffer directly
      console.log('🎨 Removing background...');
      const startTime = Date.now();
      
      const resultBlob = await removeBackground(imageBuffer, {
        debug: true,
        model: 'medium',
        output: {
          format: 'image/png',
          quality: 0.8
        },
        progress: (key, current, total) => {
          const percent = ((current / total) * 100).toFixed(0);
          console.log(`   ${key}: ${percent}%`);
        }
      });
      
      const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ Background removed in ${processingTime}s`);
      
      // Convert blob to buffer
      const buffer = Buffer.from(await resultBlob.arrayBuffer());
      
      // Clean up temp file
      await fs.unlink(tempPath);
      
      // Send back the processed image
      res.set('Content-Type', 'image/png');
      res.set('X-Processing-Time', processingTime);
      res.send(buffer);
      
    } catch (error) {
      console.error('❌ Background removal error:', error);
      
      // Clean up temp file on error
      if (tempPath) {
        try {
          await fs.unlink(tempPath);
        } catch (e) {
          console.error('Failed to delete temp file:', e);
        }
      }
      
      res.status(500).json({ 
        error: 'Background removal failed. Please try with a different image.',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  });
// ============================================
// HTML TO IMAGE ENDPOINTS (Your existing feature)
// ============================================

app.post('/api/render', async (req, res) => {
  let browser;
  
  try {
    const { html, width = 1200, height = 630 } = req.body;
    
    if (!html) {
      return res.status(400).json({ error: 'HTML content is required' });
    }

    console.log('🌐 Rendering HTML to image...');
    const startTime = Date.now();

    // Launch Puppeteer
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: parseInt(width), height: parseInt(height) });
    await page.setContent(html, { waitUntil: 'networkidle0' });

    // Take screenshot
    const screenshot = await page.screenshot({ type: 'png' });
    
    const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ HTML rendered in ${processingTime}s`);

    await browser.close();

    // Send image
    res.set('Content-Type', 'image/png');
    res.set('X-Processing-Time', processingTime);
    res.send(screenshot);

  } catch (error) {
    console.error('❌ Render error:', error);
    
    if (browser) {
      await browser.close();
    }
    
    res.status(500).json({ 
      error: 'Rendering failed', 
      details: error.message 
    });
  }
});

// ============================================
// HEALTH & INFO ENDPOINTS
// ============================================

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'API is running',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    features: ['background-removal', 'html-render']
  });
});

app.get('/', (req, res) => {
  res.json({ 
    name: 'Render & Background Removal API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /api/health',
      removeBackground: 'POST /api/remove-background (multipart/form-data)',
      renderHTML: 'POST /api/render (JSON body with html, width, height)'
    },
    examples: {
      backgroundRemoval: 'curl -X POST -F "image=@image.jpg" http://localhost:5000/api/remove-background --output result.png',
      htmlRender: 'curl -X POST -H "Content-Type: application/json" -d \'{"html":"<h1>Hello</h1>"}\' http://localhost:5000/api/render --output render.png'
    }
  });
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   🚀 Multi-Purpose API Started            ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`📍 Server: http://localhost:${PORT}`);
  console.log(`🏥 Health: http://localhost:${PORT}/api/health`);
  console.log(`🎨 BG Removal: POST /api/remove-background`);
  console.log(`🌐 HTML Render: POST /api/render`);
  console.log('');
});