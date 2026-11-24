'use strict';

const path = require('path');
const express = require('express');
require('./db'); // initialise schema + seed
const routes = require('./routes');

const app = express();
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api', routes);

app.use(express.static(path.join(__dirname, '..', '/public')));

// Unknown API routes -> JSON 404
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler (e.g. malformed JSON body -> 400)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.status === 400) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WebVeda tracker listening on http://localhost:${PORT}`));
