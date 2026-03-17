import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || process.env.EMBED_TEST_PORT || 8080);
const referenceBaseUrl = (process.env.REFERENCE_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '');

// Agent keys injected into HTML at serve time (keeps keys out of source control)
const landingAgentKey = process.env.LANDING_AGENT_KEY || '';
const tictactoeAgentKey = process.env.TICTACTOE_AGENT_KEY || '';
const showcaseAgentKey = process.env.SHOWCASE_AGENT_KEY || '';

const publicDir = path.join(__dirname, 'public');

// Serve Swagger UI static files (lazy-loaded by integration guide)
const swaggerUiDir = path.join(__dirname, '..', 'node_modules', '@fastify', 'swagger-ui', 'static');
app.use('/swagger-ui', express.static(swaggerUiDir));

// Serve static assets from public directory
app.use('/assets', express.static(publicDir));

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
  return html
    .replace(/__REFERENCE_BASE_URL__/g, referenceBaseUrl)
    .replace(/__LANDING_AGENT_KEY__/g, landingAgentKey)
    .replace(/__TICTACTOE_AGENT_KEY__/g, tictactoeAgentKey)
    .replace(/__SHOWCASE_AGENT_KEY__/g, showcaseAgentKey);
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

app.get('/agent.html', (req, res) => {
  res.type('html').send(renderHtml('agent.html'));
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
  console.log(`Agent keys: landing=${landingAgentKey ? '✅ set' : '⚠️  not set'}, tictactoe=${tictactoeAgentKey ? '✅ set' : '⚠️  not set'}, showcase=${showcaseAgentKey ? '✅ set' : '⚠️  not set'}`);
  if (!landingAgentKey || !tictactoeAgentKey || !showcaseAgentKey) {
    console.log(`  → Set LANDING_AGENT_KEY / TICTACTOE_AGENT_KEY / SHOWCASE_AGENT_KEY in .env`);
  }
});
