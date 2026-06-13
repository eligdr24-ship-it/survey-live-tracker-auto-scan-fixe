# Survey Live Tracker - Render Ready v7

Fresh GitHub + Render ready version.

## Fixed in this version
- Google Maps short URLs are no longer marked Live just because they return HTTP 302.
- Google Maps links are checked with a real Chrome/Puppeteer browser on Render.
- The checker scans the rendered page text for phrases such as:
  - This review is no longer available
  - Review is no longer available
  - No longer available
  - Review not found
  - Content unavailable
  - Survey closed / unavailable / expired
- If the browser checker fails, Google Maps links show Unknown instead of false Live.
- Added **Open Link** button for every uploaded link.
- After clicking **Add to Tracker**, the uploaded link is marked **Added to Tracker** and the button changes to **Added**.
- Auto Check now runs as a backstage scan job, so it can process all links without timing out.
- Added **Check Selected** and **Select Visible** for checking multiple specific rows.
- Dashboard refreshes every few seconds while a scan is running.

## Deploy on Render
1. Create a new GitHub repository.
2. Upload all files from this folder.
3. Create a new Render Web Service.
4. Use these settings:
   - Build Command: `npm install && npx puppeteer browsers install chrome`
   - Start Command: `npm start`
   - Node Version: 20
5. Add a persistent disk mounted at `/var/data`.

## Important
The first Render build can take a few minutes because it installs Chrome for the browser checker.
