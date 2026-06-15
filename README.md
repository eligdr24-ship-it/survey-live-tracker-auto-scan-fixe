# Survey Live Tracker - Faster Manual Selected Scan Build

Deploy as a Render **Web Service** (not Static Site).

## Render settings
- Build Command: `npm install`
- Start Command: `npm start`
- Node Version: `20`
- Persistent Disk mount: `/var/data`
- Optional env var: `SCAN_CONCURRENCY=2`

## What changed in this version
- No scan starts automatically by itself.
- Scans run only when you click **Check All Now**, **Check Selected**, or a single row **Check**.
- Faster scanning: the server keeps one Chromium browser open and scans multiple selected links in parallel.
- Google Maps 302 is still not treated as Live.
- It still looks for phrases like “This review is no longer available”.

## Speed note
Google Maps links are slower than regular survey links because the system must open them with a real browser and wait for JavaScript to render the page text. This version reduces time by reusing Chromium and checking 2 links in parallel.

## Test after deploy
Open: `/api/health`
You should see JSON with `ok: true`.

## Features
- Excel/CSV upload
- Open Link button
- Add to Tracker marking
- Select Visible
- Check Selected
- Check All Now
- Google Maps browser checking with bundled Chromium
- 302 redirect is not treated as Live for Google Maps
