# Instagram Unfollowers Tracker
### A Brave/Chrome Extension (Manifest V3)

Find everyone you follow who doesn't follow you back — and optionally unfollow them directly from the extension.

---

## Table of Contents
1. [What It Does](#what-it-does)
2. [Installation](#installation)
3. [Usage Guide](#usage-guide)
4. [How It Works (Technical)](#how-it-works-technical)
5. [Instagram API Limitations & Restrictions](#instagram-api-limitations--restrictions)
6. [Security & Privacy](#security--privacy)
7. [Troubleshooting](#troubleshooting)
8. [Folder Structure](#folder-structure)

---

## What It Does

| Feature | Details |
|---|---|
| **Scan** | Fetches your full following + followers lists and computes non-followers |
| **Display** | Clean, searchable list with avatars, verified/private badges |
| **Filter** | Filter by All / Public / Private / Verified |
| **Select** | Checkbox per row, Select All, bulk deselect |
| **Unfollow** | Single-click or bulk unfollow with confirmation dialog |
| **Progress** | Live progress bar during scan |
| **Cache** | Results stored locally — no re-scan needed on reopen |
| **Rate-safe** | Delays between every API call and unfollow to avoid triggering Instagram's rate limits |

---

## Installation

### Prerequisites
- Brave Browser (or any Chromium browser — Chrome, Edge, etc.)
- An active Instagram account (logged in at instagram.com)

### Steps

1. **Download or clone this repository:**
   ```
   git clone https://github.com/PmsHere/instagram-unfollowers
   ```
   Or download and unzip the ZIP file.

2. **Open Brave's extensions page:**
   - Type `brave://extensions` in the address bar and press Enter.
   - (Chrome users: `chrome://extensions`)

3. **Enable Developer Mode:**
   - Toggle the **Developer mode** switch in the top-right corner.

4. **Load the extension:**
   - Click **"Load unpacked"**.
   - Select the root folder of this project (the folder containing `manifest.json`).

5. **Pin it (optional):**
   - Click the puzzle-piece icon in the toolbar.
   - Click the pin icon next to **Instagram Unfollowers Tracker**.

6. **Log into Instagram:**
   - Open [instagram.com](https://www.instagram.com) in a tab and make sure you're logged in.

7. **Click the extension icon** to open the panel. You're ready!

---

## Usage Guide

### Running a Scan
1. Open the extension popup.
2. If you see a yellow warning — open instagram.com and log in first.
3. Click **"Scan My Account"**.
4. Wait for the scan to complete (may take 1–3 minutes for large accounts due to rate-limit delays).
5. The panel shows your stats and a list of non-followers.

### Searching & Filtering
- Use the **search box** to filter by username or display name.
- Use the **dropdown** to filter by: All / Public / Private / Verified.

### Selecting Users
- Click any row to toggle its checkbox.
- **Select All** selects every user currently visible (respects search/filter).
- The **bulk action bar** appears at the bottom when any user is selected.

### Unfollowing
- **Single:** Click the "Unfollow" button on any row.
- **Bulk:** Select multiple users → click "Unfollow Selected" → review the list → confirm.
- A progress modal tracks each unfollow and can be stopped mid-way.

### Clearing Data
- Click **"Clear Data"** to wipe cached results and reset the panel.

---

## How It Works (Technical)

### Architecture

```
manifest.json
src/
  background/
    service-worker.js   ← Core logic: API calls, scan orchestration
  content/
    content.js          ← Injected into instagram.com to read auth cookies
  popup/
    popup.html          ← UI shell
    popup.css           ← Styling
    popup.js            ← UI controller, state management
  icons/
    icon{16,32,48,128}.png
```

### Auth Flow
The extension reads three values from instagram.com's cookies via the content script:
- `csrftoken` — CSRF token required for POST requests
- `ds_user_id` — Your numeric Instagram user ID
- `sessionid` — Session cookie (used implicitly by `credentials: 'include'`)

These are read **client-side only** and are never sent anywhere except back to instagram.com's own APIs.

### API Endpoints Used

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/friendships/{userId}/following/` | Paginated list of users you follow |
| `GET /api/v1/friendships/{userId}/followers/` | Paginated list of your followers |
| `POST /api/v1/friendships/destroy/{userId}/` | Unfollow a user |

These are Instagram's **internal mobile API endpoints** — the same ones the official app uses. They are not part of a public developer API.

### Pagination
Both `following` and `followers` endpoints return up to 200 users per page with a `next_max_id` cursor. The extension fetches all pages automatically with a ~1.2 second delay between requests.

### Rate Limiting Strategy
- 1,200ms delay between pagination requests
- 1,500ms delay between each unfollow
- Exponential backoff on 429 responses (5s → 10s → 20s)

---

## Instagram API Limitations & Restrictions

### ⚠ Important — Read Before Using

#### 1. No Official Public API
Instagram deprecated its public API for follower/following data in 2018. This extension uses internal endpoints that the Instagram web and mobile apps use. These are **not documented or officially supported** for third-party use.

#### 2. Terms of Service
Instagram's ToS (Section 3) prohibits:
- Automated or scripted access to the platform without written permission
- Collecting user data in unauthorized ways

**Using this extension may technically violate Instagram's ToS.** The risk of account action depends on your usage patterns:
- Low volume (dozens of unfollows, occasional scans) → Low risk
- High volume (hundreds of unfollows in rapid succession) → Higher risk

**Use responsibly. You assume all risk.**

#### 3. Rate Limits
Instagram actively enforces rate limits:
- Scanning large accounts (5,000+ following) takes several minutes due to enforced delays
- Unfollowing too quickly can trigger a temporary "Action Blocked" penalty
- The extension adds deliberate delays to minimize this risk — **do not try to speed it up**

#### 4. Account Action Block
If Instagram detects unusual activity, you may see:
- "Action Blocked" — temporary restriction on follow/unfollow
- Session expiry — you'll be logged out
- In rare, extreme cases: permanent account suspension

The extension cannot "unfollow" from Instagram's perspective differently than you would manually — it uses the exact same API call — but the automated pattern may be detectable.

#### 5. Private Accounts
The extension correctly lists private accounts you follow. However, **you cannot see who follows a private account** you're not connected to — this only matters for the logged-in user's own followers/following lists, which are always accessible.

#### 6. Large Accounts
For accounts following 10,000+ people, a scan may take 5–10+ minutes. The extension handles this gracefully with a live progress bar.

---

## Security & Privacy

### What the extension can access:
- **Your Instagram cookies** (read-only, never exfiltrated) — only used to authenticate requests back to instagram.com
- **Your following/followers lists** — stored in `chrome.storage.local` on your device only
- **instagram.com** — the only external host this extension communicates with

### What the extension cannot and does not do:
- Send your data to any third-party server
- Read your messages, posts, or any other Instagram data
- Modify your profile
- Access other websites
- Operate without your explicit action (no background scanning)

### Data Storage
Results are cached in `chrome.storage.local` (sandboxed to this extension, on your device only). Click "Clear Data" to remove everything.

### Permissions Explained

| Permission | Why |
|---|---|
| `storage` | Cache scan results locally |
| `activeTab` | Read auth info from the active Instagram tab |
| `scripting` | Inject content script to read cookies |
| `host_permissions: instagram.com` | Make authenticated API requests |

---

## Troubleshooting

**"Open instagram.com and log in first"**
→ The extension didn't find a logged-in Instagram session. Open instagram.com, log in, then retry.

**"Rate limited. Waiting Ns…"**
→ Instagram throttled the request. The extension will automatically retry. Wait patiently.

**"HTTP 401"**
→ Your session expired. Refresh instagram.com to re-authenticate.

**Scan stops partway**
→ Instagram may have returned an error mid-scan. Try again — results from a partial scan won't be shown to avoid misleading data.

**"Action Blocked" on Instagram after unfollowing**
→ You unfollowed too many accounts too quickly (even with the built-in delay). Instagram has blocked the action temporarily. Wait 24–48 hours before retrying.

**Avatars not loading**
→ Normal — Instagram CDN links are session-bound and sometimes expire. The extension shows initials as a fallback.

---

## Folder Structure

```
instagram-unfollowers/
├── manifest.json
├── README.md
└── src/
    ├── background/
    │   └── service-worker.js
    ├── content/
    │   └── content.js
    ├── icons/
    │   ├── icon16.png
    │   ├── icon32.png
    │   ├── icon48.png
    │   └── icon128.png
    └── popup/
        ├── popup.html
        ├── popup.css
        └── popup.js
```

No build step required — pure vanilla JavaScript, no bundler, no npm.

---

## License

MIT — use freely, modify freely, no warranty.

> This project is not affiliated with, endorsed by, or connected to Instagram or Meta.
