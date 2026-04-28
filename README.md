# Gradecast

PSA pre-grading app powered by Google Gemini AI. Estimate card grades from photos before you buy on eBay or send to PSA.

## Features

- **eBay Inspect** — grade listing photos before buying
- **In-Hand Scan** — grade cards you own before submitting
- **Auto centering measurement** — pixel-level border detection
- **Photo quality checks** — flags blur, glare, low light
- **Multi-angle support** — front, back, raking light, detail shots
- **Counterfeit detection** — flags suspect cards
- **Card identification** — auto-detects player, year, set, number
- **Market value estimates** — raw, PSA 8/9/10 with ranges
- **ROI calculator** — projects profit by PSA tier
- **Gem rate estimates** — % chance of PSA 10
- **History** — last 200 cards saved on your device
- **Watchlist** — track cards with target buy prices
- **Submission batch builder** — generate PSA worksheets
- **eBay sold comps** — one-tap deep links to verify values
- **Installable** — add to home screen, works offline-shell

## Setup (Windows)

This guide assumes you have **never used a terminal or GitHub before**. Total time: ~30-45 minutes.

### Step 1: Install the basics (10 min)

1. **Install Node.js** — Go to [nodejs.org](https://nodejs.org), download the LTS version (the green button), run the installer, click Next through everything.
2. **Install Git** — Go to [git-scm.com/download/win](https://git-scm.com/download/win), download, run installer, click Next through everything.
3. **Restart your computer.** Important — this makes the new commands available.

### Step 2: Get a free Gemini API key (2 min)

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
2. Sign in with any Google account
3. Click **Create API key** → **Create API key in new project**
4. **Copy the key.** Save it in Notepad for now.

### Step 3: Get the project files (5 min)

1. Make a folder on your Desktop called `gradecast`
2. Copy all the files from this download into that folder
3. Open the folder. You should see `package.json`, `index.html`, `src/`, `public/`, etc.

### Step 4: Run it locally to test (5 min)

1. In the gradecast folder, **Shift + Right-click** an empty area → **Open PowerShell window here** (or "Open Terminal here")
2. Type these commands one at a time, hitting Enter after each:

   ```
   npm install
   ```

   Wait 1-2 minutes. It downloads dependencies.

   ```
   npm run dev
   ```

3. You'll see `Local: http://localhost:5173/`. Open that URL in your browser.
4. Click the gear icon (top right), paste your Gemini API key, click **Test**, then **Save**.
5. Try grading a card. It should work.

If it works locally, you're done with the hardest part. Press `Ctrl + C` in the terminal to stop the local server.

### Step 5: Put it online (15 min)

This is what makes it a real app on your phone, persistent forever, no laptop needed.

#### Create a GitHub account

1. Go to [github.com](https://github.com), sign up (free).
2. Click the **+** icon top right → **New repository**.
3. Name it `gradecast`. Set to **Public**. Don't add a README. Click **Create repository**.
4. **Leave the next page open** — you'll need the URL it shows.

#### Upload your code

1. Back in PowerShell (in your gradecast folder), run these commands one at a time. Replace `YOUR_USERNAME` with your actual GitHub username:

   ```
   git init
   git add .
   git commit -m "first commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/gradecast.git
   git push -u origin main
   ```

2. It'll ask you to log in to GitHub the first time — follow the popup.
3. Refresh your GitHub repo page. You should see all your files.

#### Deploy with Vercel

1. Go to [vercel.com](https://vercel.com) → **Sign up with GitHub**.
2. After signing in, click **Add New** → **Project**.
3. Find `gradecast` in the list → click **Import**.
4. Leave all settings as default → click **Deploy**.
5. Wait 1-2 minutes. You'll get a URL like `gradecast-abc123.vercel.app`.

**That's your app, live on the internet. Forever. Free.**

### Step 6: Add to your phone home screen (1 min)

1. Open your Vercel URL on your phone (Safari on iOS, Chrome on Android).
2. **iPhone:** Tap the share icon → **Add to Home Screen**.
3. **Android:** Tap the menu → **Install app** or **Add to home screen**.
4. Open it from your home screen — it now works like a real app, full screen, no browser bar.
5. First time you open it, paste your Gemini key in Settings.

## Updating later

If you want to change the code:

1. Edit files in your gradecast folder
2. In PowerShell:
   ```
   git add .
   git commit -m "what I changed"
   git push
   ```
3. Vercel auto-deploys within 30 seconds. Refresh the app on your phone.

## Costs

- **Vercel hosting:** Free forever for personal use
- **GitHub:** Free
- **Gemini API:** Free tier = 1,500 requests/day. You'd have to grade 1,500 cards a day to exceed it.
- **Domain:** Optional. Default Vercel URL works fine. Custom domain is ~$12/year if you want one.

## Privacy

- Your Gemini API key lives only in your browser's local storage on your device.
- Card photos go directly from your browser to Google's API. Never touch any other server.
- History and watchlist data live only on your device.
- The app has no analytics, no tracking, no accounts.

## Troubleshooting

**"npm not recognized"** — You skipped restarting after installing Node.js. Restart and try again.

**"git not recognized"** — Same — restart after installing Git.

**Vercel build fails** — Most common cause: a typo in `package.json`. Make sure all files copied correctly.

**Grade analysis fails** — Open Settings, tap Test on your API key. If Test fails, your key is wrong or quota is exhausted (unlikely on free tier).

**Photos won't upload on iPhone** — iOS sometimes blocks the camera in PWAs. Use the Safari browser version instead, or grant camera permission in Settings → Safari.

## Disclaimer

This is an estimate, not a guarantee. PSA's actual grading involves details photos can't capture. Always verify market values with real eBay sold comps. Don't make large financial decisions based solely on this tool.
