# Survey Live Tracker - Stable Auto Scan Build

Deploy as a Render **Web Service** (not Static Site).

## Render settings
- Build Command: `npm install`
- Start Command: `npm start`
- Node Version: `20`
- Persistent Disk mount: `/var/data`

## Test after deploy
Open: `/api/health`
You should see JSON with `ok: true`.

## Features
- Excel/CSV upload
- Open Link button
- Add to Tracker marking
- Google Maps browser checking with bundled Chromium
- 302 redirect is not treated as Live for Google Maps
- Auto Check All runs as backstage scan job
- Check Selected and Select Visible


## Manual scanning behavior
This build does **not** start automatic background scanning by itself.
Scans only start when the admin clicks:
- Check All Now
- Check Selected
- a single row Check button

This prevents long automatic scans from running when you only want to work on a few selected links.
