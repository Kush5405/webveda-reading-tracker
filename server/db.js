'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.resolve(process.env.DB_PATH || './data/tracker.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS books (
    id       TEXT PRIMARY KEY,
    title    TEXT NOT NULL,
    author   TEXT NOT NULL,
    category TEXT CHECK(category IN ('fiction', 'nonfiction')),
    read     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS video_progress (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    timestamp  REAL NOT NULL DEFAULT 0,
    updated_at TEXT
  );
`);

const SEED_BOOKS = [
  ['fic-1', 'The Hobbit', 'J.R.R. Tolkien', 'fiction', 0],
  ['fic-2', 'Matilda', 'Roald Dahl', 'fiction', 0],
  ['fic-3', 'The Secret Garden', 'Frances Hodgson Burnett', 'fiction', 0],
  ['nonfic-1', 'The Story of My Life', 'Helen Keller', 'nonfiction', 0],
  ['nonfic-2', 'A Brief History of Time', 'Stephen Hawking', 'nonfiction', 0],
  ['nonfic-3', 'The Diary of a Young Girl', 'Anne Frank', 'nonfiction', 0],
];

const seed = db.transaction(() => {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM books').get();
  if (count === 0) {
    const insert = db.prepare(
      'INSERT INTO books (id, title, author, category, read) VALUES (?, ?, ?, ?, ?)'
    );
    for (const row of SEED_BOOKS) insert.run(...row);
  }
  db.prepare(
    'INSERT OR IGNORE INTO video_progress (id, timestamp, updated_at) VALUES (1, 0, ?)'
  ).run(new Date().toISOString());
});
seed();

module.exports = db;
