// service-worker.js — Background Service Worker (Manifest V3)

const INSTAGRAM_API_BASE = 'https://www.instagram.com/api/v1';
const DELAY_MS = 1200;
const MAX_RETRIES = 3;

// ─── State ────────────────────────────────────────────────────────────────────
let scanState = {
  status: 'idle',
  following: [],
  followers: [],
  nonFollowers: [],
  progress: { followingFetched: 0, followersFetched: 0, totalFollowing: 0, totalFollowers: 0 },
  error: null,
  lastScan: null,
};

// ─── Cookie reader (no content script needed) ─────────────────────────────────
async function getInstagramAuth() {
  const getCookie = (name) =>
    new Promise(resolve =>
      chrome.cookies.get({ url: 'https://www.instagram.com', name }, c => resolve(c?.value || ''))
    );

  const csrfToken = await getCookie('csrftoken');
  const dsUserId  = await getCookie('ds_user_id');
  const sessionId = await getCookie('sessionid');

  return {
    csrfToken,
    dsUserId,
    userId: dsUserId,
    sessionId,
    loggedIn: !!(csrfToken && dsUserId && sessionId),
  };
}

// ─── Messaging ────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'GET_AUTH': {
        const auth = await getInstagramAuth();
        sendResponse(auth);
        break;
      }
      case 'START_SCAN': {
        const auth = await getInstagramAuth();
        if (!auth.loggedIn) {
          sendResponse({ ok: false, error: 'NOT_LOGGED_IN' });
        } else {
          startScan(auth);
          sendResponse({ ok: true });
        }
        break;
      }
      case 'GET_STATE':
        sendResponse(scanState);
        break;
      case 'UNFOLLOW_USER': {
        try {
          const auth = await getInstagramAuth();
          const result = await unfollowUser(msg.userId, auth.csrfToken);
          sendResponse(result);
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        break;
      }
      case 'CLEAR_DATA':
        scanState = {
          status: 'idle', following: [], followers: [], nonFollowers: [],
          progress: { followingFetched: 0, followersFetched: 0, totalFollowing: 0, totalFollowers: 0 },
          error: null, lastScan: null,
        };
        await chrome.storage.local.remove(['scanResult']);
        sendResponse({ ok: true });
        break;
      case 'LOAD_CACHED': {
        const cached = await chrome.storage.local.get('scanResult');
        sendResponse(cached.scanResult || null);
        break;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function broadcast(update) {
  Object.assign(scanState, update);
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state: scanState }).catch(() => {});
}

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const wait = Math.pow(2, attempt) * 5000;
        broadcast({ error: `Rate limited. Waiting ${wait / 1000}s…` });
        await sleep(wait);
        continue;
      }
      if (res.status === 401) throw new Error('NOT_LOGGED_IN');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      if (attempt === retries - 1) throw e;
      await sleep(2000 * (attempt + 1));
    }
  }
}

// ─── Fetch following ──────────────────────────────────────────────────────────
async function fetchAllFollowing(userId, csrfToken) {
  const users = [];
  let nextMaxId = null;
  do {
    const params = new URLSearchParams({ count: '200' });
    if (nextMaxId) params.set('max_id', nextMaxId);
    const res = await fetchWithRetry(
      `${INSTAGRAM_API_BASE}/friendships/${userId}/following/?${params}`,
      {
        headers: {
          'x-csrftoken': csrfToken,
          'x-ig-app-id': '936619743392459',
          'x-requested-with': 'XMLHttpRequest',
          'Referer': 'https://www.instagram.com/',
        },
        credentials: 'include',
      }
    );
    const data = await res.json();
    users.push(...(data.users || []));
    nextMaxId = data.next_max_id || null;
    broadcast({
      progress: { ...scanState.progress, followingFetched: users.length, totalFollowing: data.count || users.length },
      status: 'scanning',
    });
    await sleep(DELAY_MS);
  } while (nextMaxId);
  return users;
}

// ─── Fetch followers ──────────────────────────────────────────────────────────
async function fetchAllFollowers(userId, csrfToken) {
  const users = [];
  let nextMaxId = null;
  do {
    const params = new URLSearchParams({ count: '200' });
    if (nextMaxId) params.set('max_id', nextMaxId);
    const res = await fetchWithRetry(
      `${INSTAGRAM_API_BASE}/friendships/${userId}/followers/?${params}`,
      {
        headers: {
          'x-csrftoken': csrfToken,
          'x-ig-app-id': '936619743392459',
          'x-requested-with': 'XMLHttpRequest',
          'Referer': 'https://www.instagram.com/',
        },
        credentials: 'include',
      }
    );
    const data = await res.json();
    users.push(...(data.users || []));
    nextMaxId = data.next_max_id || null;
    broadcast({
      progress: { ...scanState.progress, followersFetched: users.length, totalFollowers: data.count || users.length },
      status: 'scanning',
    });
    await sleep(DELAY_MS);
  } while (nextMaxId);
  return users;
}

// ─── Main scan ────────────────────────────────────────────────────────────────
async function startScan(auth) {
  if (scanState.status === 'scanning') return;
  broadcast({
    status: 'scanning', following: [], followers: [], nonFollowers: [], error: null,
    progress: { followingFetched: 0, followersFetched: 0, totalFollowing: 0, totalFollowers: 0 },
  });
  try {
    const following = await fetchAllFollowing(auth.userId, auth.csrfToken);
    const followers = await fetchAllFollowers(auth.userId, auth.csrfToken);
    const followerIds = new Set(followers.map(u => u.pk));
    const nonFollowers = following.filter(u => !followerIds.has(u.pk));
    const result = {
      status: 'done', following, followers, nonFollowers, error: null,
      lastScan: new Date().toISOString(),
      progress: {
        followingFetched: following.length, followersFetched: followers.length,
        totalFollowing: following.length, totalFollowers: followers.length,
      },
    };
    await chrome.storage.local.set({ scanResult: result });
    broadcast(result);
  } catch (err) {
    const errMsg = err.message === 'NOT_LOGGED_IN'
      ? 'Not logged into Instagram. Open instagram.com, log in, then try again.'
      : `Scan failed: ${err.message}`;
    broadcast({ status: 'error', error: errMsg });
  }
}

// ─── Unfollow ─────────────────────────────────────────────────────────────────
async function unfollowUser(userId, csrfToken) {
  const res = await fetchWithRetry(
    `${INSTAGRAM_API_BASE}/friendships/destroy/${userId}/`,
    {
      method: 'POST',
      headers: {
        'x-csrftoken': csrfToken,
        'x-ig-app-id': '936619743392459',
        'x-requested-with': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://www.instagram.com/',
      },
      credentials: 'include',
      body: `user_id=${userId}`,
    }
  );
  await sleep(1500);
  const data = await res.json();
  return { ok: true, friendship_status: data.friendship_status };
}
