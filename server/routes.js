'use strict';

const express = require('express');
const db = require('./db');

const router = express.Router();

const toBook = (row) => ({
  id: row.id,
  title: row.title,
  author: row.author,
  category: row.category,
  read: row.read === 1,
});

const stmts = {
  allBooks: db.prepare('SELECT * FROM books ORDER BY rowid'),
  getBook: db.prepare('SELECT * FROM books WHERE id = ?'),
  setRead: db.prepare('UPDATE books SET read = ? WHERE id = ?'),
  getProgress: db.prepare('SELECT timestamp FROM video_progress WHERE id = 1'),
  setProgress: db.prepare(
    'UPDATE video_progress SET timestamp = ?, updated_at = ? WHERE id = 1'
  ),
};

router.get('/books', (req, res) => {
  const result = { fiction: [], nonfiction: [] };
  for (const row of stmts.allBooks.all()) {
    if (result[row.category]) result[row.category].push(toBook(row));
  }
  res.json(result);
});

router.patch('/books/:id', (req, res) => {
  const book = stmts.getBook.get(req.params.id);
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const read = req.body ? req.body.read : undefined;
  if (typeof read !== 'boolean') {
    return res.status(400).json({ error: '"read" must be a boolean (true or false)' });
  }

  stmts.setRead.run(read ? 1 : 0, req.params.id); // idempotent
  res.status(200).json(toBook(stmts.getBook.get(req.params.id)));
});

router.get('/video-progress', (req, res) => {
  const row = stmts.getProgress.get();
  res.json({ timestamp: row ? row.timestamp : 0 });
});

router.put('/video-progress', (req, res) => {
  const timestamp = req.body ? req.body.timestamp : undefined;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < 0) {
    return res
      .status(400)
      .json({ error: '"timestamp" must be a finite number >= 0' });
  }
  // Single UPDATE statement => atomic in SQLite
  stmts.setProgress.run(timestamp, new Date().toISOString());
  res.json({ timestamp });
});

module.exports = router;
