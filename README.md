# WebVeda Reading Challenge Tracker

**Live demo:** (https://webveda-reading-tracker.onrender.com/) 

A small full-stack app for tracking a reading challenge. Watch a welcome video (the playback position is remembered across reloads) and tick off books from a Fiction list and a Nonfiction list. All state is stored on the server.

## 1. Tech Stack & Architecture

| Layer     | Choice |
|-----------|--------|
| Backend   | Node.js 20 + Express |
| Database  | SQLite via `better-sqlite3` (synchronous, file-based) |
| Frontend  | Vanilla HTML5 / CSS / JavaScript (ES modules), no framework |
| Packaging | Single Docker container |

```
├── server/
│   ├── index.js       # Express app, static hosting, /api/health
│   ├── routes.js      # REST endpoints
│   ├── db.js          # schema + auto-seeding
│   └── test-api.js    # end-to-end API tests (native fetch)
├── public/            # index.html, styles.css, app.js, welcome.mp4
├── Dockerfile
└── package.json
```

Express serves both the API (`/api/*`) and the static frontend (`public/`) from **one origin**. That means:

- **No build step.** Files in `public/` are served as written.
- **No CORS configuration.** The browser only ever talks to the same origin.
- **One small container** to build, run and deploy.

### API

| Method & path | Body | Success response | Errors |
|---|---|---|---|
| `GET /api/books` | n/a | `{ fiction: [...], nonfiction: [...] }` with `read` as a real boolean | n/a |
| `PATCH /api/books/:id` | `{ "read": true \| false }` | `200` with the updated book (idempotent) | `404` unknown id, `400` if `read` is not strictly a boolean |
| `GET /api/video-progress` | n/a | `{ timestamp }` | n/a |
| `PUT /api/video-progress` | `{ "timestamp": number }` | `200 { timestamp }` | `400` unless a finite number ≥ 0 |
| `GET /api/health` | n/a | `{ status: "ok" }` | n/a |

The six starter books are seeded only when the `books` table is empty, so restarts never overwrite progress.

## 2. Local Setup & Automated Tests

Requires Node 20+.

```bash
npm install
npm start              # http://localhost:3000
node server/test-api.js   # or: npm test
```

Place a `welcome.mp4` in `public/` for the video player (it isn't included in the repo).

The database defaults to `./data/tracker.db` (the folder is created automatically). Override with `DB_PATH` and `PORT`.

`server/test-api.js` starts its own server on a random port with a temporary database, then checks:

- seeded data (3 fiction + 3 nonfiction, all unread, `read` returned as booleans)
- valid updates, including setting a book back to unread
- idempotency (`read: true` sent twice returns `200` both times)
- `404` for an unknown book ID
- `400` for `"true"`, `1`, `0`, `null` and a missing `read`, and that rejected requests don't change data
- video timestamp validation and persistence, including **after a server restart**

## 3. Docker

```bash
docker build -t webveda-tracker .

mkdir -p data
docker run -d --name webveda -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  webveda-tracker
```

The `-v $(pwd)/data:/app/data` mount keeps the SQLite file on your machine, so progress survives `docker stop` / `docker rm` / rebuilds.

Notes:
- The image runs as the unprivileged `node` user (uid 1000). On Linux, if the mounted folder isn't writable, run `sudo chown 1000:1000 data`.
- `npm ci` needs a `package-lock.json`. Run `npm install` once and commit the lockfile before building.

## 4. AI Tools Used & What I Verified

**Tool:** Claude (Anthropic) was used to scaffold the project: the Express/SQLite backend, the vanilla frontend, the test script, the Dockerfile and this README. I reviewed the generated code and ran the checks below myself.

**Verified:**

- **Strict boolean validation.** Sending `{"read": "true"}` or `{"read": 1}` to `PATCH /api/books/:id` returns `400` and leaves the book unchanged (covered by `server/test-api.js`; also try it with `curl`).
- **Video seek timing on reload.** The saved position is applied only after the video's `loadedmetadata` event, and clamped to `video.duration`. Reload the page after pausing mid-video and confirm it resumes at the saved time.
- **Checkbox rollback on failure.** With the server stopped, DevTools set to Offline, or the `PATCH` forced to return `500`, the checkbox returns to its last server-confirmed state, the row is re-enabled, and an error toast appears. The UI never keeps a fake toggled state.

## 5. Trade-offs & Known Limitations

- **Single-user state.** There is no authentication or per-user data. Everyone who opens the app shares one set of read/unread flags and one video position.
- **SQLite concurrency.** SQLite allows one writer at a time. WAL mode and `better-sqlite3`'s synchronous API are fine for this workload, but heavy concurrent writes would hit file locking, and running multiple server instances against one file isn't supported. A multi-user version would move to Postgres.
- **Ephemeral hosting disks.** On platforms like Render, the container filesystem is reset on each deploy unless a persistent disk is attached and mounted at `/app/data`. Without one, progress resets.
- **Intentionally minimal.** No auth, no rate limiting, and no frontend tests. The API is covered by the Node test script and the UI by the manual checks above.
