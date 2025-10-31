import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || process.env.EMBED_TEST_PORT || 8080);
const referenceBaseUrl = (process.env.REFERENCE_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '');

const publicDir = path.join(__dirname, 'public');
const iframeSyncPath = path.join(__dirname, 'node_modules', 'iframe-sync', 'index.js');

// Serve static assets from public directory
app.use('/assets', express.static(publicDir));

// Serve iframe-sync library
app.get('/assets/iframe-sync.js', (req, res) => {
  res.type('application/javascript').sendFile(iframeSyncPath);
});

// Serve landing page assets
app.get('/assets/landing-app.js', (req, res) => {
  res.type('application/javascript').sendFile(path.join(publicDir, 'landing-app.js'));
});

app.get('/assets/landing.css', (req, res) => {
  res.type('text/css').sendFile(path.join(publicDir, 'landing.css'));
});

app.get('/assets/tictactoe.css', (req, res) => {
  res.type('text/css').sendFile(path.join(publicDir, 'tictactoe.css'));
});

app.get('/assets/tictactoe-app.js', (req, res) => {
  res.type('application/javascript').sendFile(path.join(publicDir, 'tictactoe-app.js'));
});

function renderHtml(filename) {
  const filePath = path.join(publicDir, filename);
  const html = fs.readFileSync(filePath, 'utf8');
  return html.replace(/__REFERENCE_BASE_URL__/g, referenceBaseUrl);
}

app.get('/', (req, res) => {
  res.type('html').send(renderHtml('landing.html'));
});

app.get('/landing.html', (req, res) => {
  res.type('html').send(renderHtml('landing.html'));
});

app.get('/tictactoe.html', (req, res) => {
  res.type('html').send(renderHtml('tictactoe.html'));
});

// Proxy /embed/* requests to reference server to avoid X-Frame-Options cross-origin issues
app.get('/embed/*', async (req, res) => {
  const embedPath = req.path; // e.g., /embed/ozwell.html
  const targetUrl = `${referenceBaseUrl}${embedPath}`;

  console.log(`[Proxy] ${embedPath} → ${targetUrl}`);

  try {
    const response = await fetch(targetUrl);
    const contentType = response.headers.get('content-type');

    // Forward the response
    if (contentType) {
      res.type(contentType);
    }

    // For text responses (HTML, JS, CSS)
    if (contentType && (contentType.includes('text') || contentType.includes('javascript') || contentType.includes('json'))) {
      const body = await response.text();
      res.send(body);
    } else {
      // For binary responses
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    }
  } catch (error) {
    console.error(`[Proxy Error] ${embedPath}:`, error.message);
    res.status(500).send('Proxy error');
  }
});

// Also proxy POST requests to /embed/* (for chat endpoint)
app.post('/embed/*', express.json(), async (req, res) => {
  const embedPath = req.path;
  const targetUrl = `${referenceBaseUrl}${embedPath}`;

  console.log(`[Proxy POST] ${embedPath} → ${targetUrl}`);

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.type(contentType);
    }

    // Handle streaming responses
    if (response.body) {
      response.body.pipe(res);
    } else {
      const body = await response.text();
      res.send(body);
    }
  } catch (error) {
    console.error(`[Proxy Error] ${embedPath}:`, error.message);
    res.status(500).send('Proxy error');
  }
});

// Proxy /mock/* requests to reference server (for mock chat endpoint)
app.post('/mock/*', express.json(), async (req, res) => {
  const mockPath = req.path;
  const targetUrl = `${referenceBaseUrl}${mockPath}`;

  console.log(`[Proxy POST] ${mockPath} → ${targetUrl}`);

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.type(contentType);
    }

    const body = await response.text();
    res.send(body);
  } catch (error) {
    console.error(`[Proxy Error] ${mockPath}:`, error.message);
    res.status(500).send('Proxy error');
  }
});

app.get('*', (req, res, next) => {
  if (req.path === '/' || req.path === '') {
    return res.type('html').send(renderHtml('landing.html'));
  }
  next();
});

app.use(express.static(publicDir));

app.listen(port, '0.0.0.0', () => {
  console.log(`Embed test host running on port ${port}`);
  console.log(`Using reference server base URL: ${referenceBaseUrl}`);
});
