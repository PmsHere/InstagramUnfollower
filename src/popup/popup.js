// popup.js — Main popup controller
'use strict';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const scanBtn                 = $('scanBtn');
const clearBtn                = $('clearBtn');
const authBanner              = $('authBanner');
const progressWrap            = $('progressWrap');
const progressLabel           = $('progressLabel');
const progressBarFill         = $('progressBarFill');
const progressCounters        = $('progressCounters');
const errorBox                = $('errorBox');
const errorText               = $('errorText');
const statsBar                = $('statsBar');
const statFollowing           = $('statFollowing');
const statFollowers           = $('statFollowers');
const statNonFollowers        = $('statNonFollowers');
const toolbar                 = $('toolbar');
const searchInput             = $('searchInput');
const filterSelect            = $('filterSelect');
const selectAllBtn            = $('selectAllBtn');
const userList                = $('userList');
const bulkBar                 = $('bulkBar');
const bulkCount               = $('bulkCount');
const deselectAllBtn          = $('deselectAllBtn');
const unfollowSelectedBtn     = $('unfollowSelectedBtn');
const emptyState              = $('emptyState');
const lastScanLabel           = $('lastScanLabel');
const modalOverlay            = $('modalOverlay');
const modalCount              = $('modalCount');
const modalBody               = $('modalBody');
const modalCancel             = $('modalCancel');
const modalConfirm            = $('modalConfirm');
const unfollowProgressOverlay = $('unfollowProgressOverlay');
const unfollowProgressText    = $('unfollowProgressText');
const unfollowProgressFill    = $('unfollowProgressFill');
const unfollowCancelBtn       = $('unfollowCancelBtn');

// ─── State ────────────────────────────────────────────────────────────────────
let allNonFollowers = [];
let filteredUsers   = [];
let selectedIds     = new Set();
let unfollowedIds   = new Set();
let cancelUnfollow  = false;

// ─── Messaging ────────────────────────────────────────────────────────────────
function msg(type, payload = {}) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type, ...payload }, r => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(r);
    });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(async () => {
  await checkAuth();

  const state = await msg('GET_STATE');
  applyState(state);

  if (!state || state.status === 'idle' || state.status === 'error') {
    const cached = await msg('LOAD_CACHED');
    if (cached) applyState(cached);
  }
})();

chrome.runtime.onMessage.addListener(m => {
  if (m.type === 'STATE_UPDATE') applyState(m.state);
});

// ─── Auth (reads cookies via background service worker) ───────────────────────
async function checkAuth() {
  const auth = await msg('GET_AUTH');
  if (!auth || !auth.loggedIn) {
    authBanner.hidden = false;
    scanBtn.disabled = true;
  } else {
    authBanner.hidden = true;
    scanBtn.disabled = false;
  }
  return auth;
}

// ─── Scan ─────────────────────────────────────────────────────────────────────
scanBtn.addEventListener('click', async () => {
  const auth = await checkAuth();
  if (!auth || !auth.loggedIn) return;

  selectedIds.clear();
  unfollowedIds.clear();
  await msg('START_SCAN');
});

clearBtn.addEventListener('click', async () => {
  await msg('CLEAR_DATA');
  allNonFollowers = [];
  filteredUsers = [];
  selectedIds.clear();
  unfollowedIds.clear();
  userList.innerHTML = '';
  hideResults();
  hideProgress();
  errorBox.hidden = true;
  lastScanLabel.textContent = '';
});

// ─── State application ────────────────────────────────────────────────────────
function applyState(state) {
  if (!state) return;

  const scanning = state.status === 'scanning';
  scanBtn.disabled = scanning;

  if (scanning) {
    showProgress(state.progress);
    hideResults();
    errorBox.hidden = true;
  } else {
    hideProgress();
  }

  if (state.status === 'error') {
    showError(state.error);
  } else {
    errorBox.hidden = true;
  }

  if (state.status === 'done' && state.nonFollowers) {
    allNonFollowers = state.nonFollowers;
    showStats(state);
    applyFilters();
    if (state.lastScan) {
      const d = new Date(state.lastScan);
      lastScanLabel.textContent = `Last scan: ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
  }
}

// ─── Progress ─────────────────────────────────────────────────────────────────
function showProgress(p) {
  progressWrap.hidden = false;
  const total = Math.max((p.totalFollowing || 0) + (p.totalFollowers || 0), 1);
  const done  = (p.followingFetched || 0) + (p.followersFetched || 0);
  const pct   = Math.min(100, Math.round((done / total) * 100));

  progressLabel.textContent = p.followersFetched > 0
    ? `Fetching followers… ${p.followersFetched.toLocaleString()} loaded`
    : `Fetching following… ${p.followingFetched.toLocaleString()} loaded`;

  progressBarFill.style.width = pct + '%';
  progressCounters.textContent =
    `Following: ${(p.followingFetched||0).toLocaleString()} · Followers: ${(p.followersFetched||0).toLocaleString()}`;
}

function hideProgress() {
  progressWrap.hidden = true;
  progressBarFill.style.width = '0%';
}

// ─── Results ──────────────────────────────────────────────────────────────────
function showStats(state) {
  statsBar.hidden = false;
  toolbar.hidden  = false;
  statFollowing.textContent    = (state.following?.length || 0).toLocaleString();
  statFollowers.textContent    = (state.followers?.length || 0).toLocaleString();
  statNonFollowers.textContent = (state.nonFollowers?.length || 0).toLocaleString();
}

function hideResults() {
  statsBar.hidden    = true;
  toolbar.hidden     = true;
  bulkBar.hidden     = true;
  emptyState.hidden  = true;
  userList.innerHTML = '';
}

function showError(m) {
  errorBox.hidden = false;
  errorText.textContent = m;
}

// ─── Filter & Search ──────────────────────────────────────────────────────────
function applyFilters() {
  const query  = searchInput.value.toLowerCase().trim();
  const filter = filterSelect.value;

  filteredUsers = allNonFollowers.filter(u => {
    const matchSearch = !query ||
      u.username.toLowerCase().includes(query) ||
      (u.full_name || '').toLowerCase().includes(query);
    const matchFilter =
      filter === 'all' ||
      (filter === 'private'  && u.is_private)  ||
      (filter === 'public'   && !u.is_private) ||
      (filter === 'verified' && u.is_verified);
    return matchSearch && matchFilter;
  });

  renderList(filteredUsers);
}

searchInput.addEventListener('input', applyFilters);
filterSelect.addEventListener('change', applyFilters);

// ─── Render ───────────────────────────────────────────────────────────────────
function renderList(users) {
  userList.innerHTML = '';
  bulkBar.hidden    = true;
  emptyState.hidden = users.length > 0;

  users.forEach(user => {
    const item = document.createElement('div');
    item.className = 'user-item' +
      (selectedIds.has(user.pk)   ? ' selected'   : '') +
      (unfollowedIds.has(user.pk) ? ' unfollowed' : '');
    item.dataset.pk = user.pk;

    const initials   = (user.username || '?').slice(0, 1).toUpperCase();
    const avatarHtml = user.profile_pic_url
      ? `<img class="user-avatar" src="${esc(user.profile_pic_url)}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : `<div class="user-avatar-placeholder">${initials}</div>`;

    const badgesHtml = [
      user.is_verified ? `<span class="badge badge-verified">✓ Verified</span>` : '',
      user.is_private  ? `<span class="badge badge-private">Private</span>`     : '',
    ].join('');

    const unfollowLabel = unfollowedIds.has(user.pk) ? 'Unfollowed' : 'Unfollow';

    item.innerHTML = `
      <div class="user-check">${selectedIds.has(user.pk) ? '✓' : ''}</div>
      ${avatarHtml}
      <div class="user-info">
        <div class="user-username">@${esc(user.username)}</div>
        ${user.full_name ? `<div class="user-fullname">${esc(user.full_name)}</div>` : ''}
      </div>
      <div class="user-badges">${badgesHtml}</div>
      <div class="user-action">
        <button class="btn-unfollow-single" data-pk="${user.pk}">${unfollowLabel}</button>
      </div>
    `;

    item.addEventListener('click', e => {
      if (e.target.closest('.btn-unfollow-single')) return;
      toggleSelect(user.pk, item);
    });

    item.querySelector('.btn-unfollow-single').addEventListener('click', e => {
      e.stopPropagation();
      if (!unfollowedIds.has(user.pk)) unfollowSingle(user, item);
    });

    userList.appendChild(item);
  });

  refreshBulkBar();
}

// ─── Selection ────────────────────────────────────────────────────────────────
function toggleSelect(pk, item) {
  if (selectedIds.has(pk)) {
    selectedIds.delete(pk);
    item.classList.remove('selected');
    item.querySelector('.user-check').textContent = '';
  } else {
    selectedIds.add(pk);
    item.classList.add('selected');
    item.querySelector('.user-check').textContent = '✓';
  }
  refreshBulkBar();
}

selectAllBtn.addEventListener('click', () => {
  const allSel = filteredUsers.every(u => selectedIds.has(u.pk));
  if (allSel) {
    filteredUsers.forEach(u => selectedIds.delete(u.pk));
    selectAllBtn.textContent = 'Select All';
  } else {
    filteredUsers.forEach(u => { if (!unfollowedIds.has(u.pk)) selectedIds.add(u.pk); });
    selectAllBtn.textContent = 'Deselect All';
  }
  renderList(filteredUsers);
});

deselectAllBtn.addEventListener('click', () => { selectedIds.clear(); renderList(filteredUsers); });

function refreshBulkBar() {
  const count = selectedIds.size;
  bulkBar.hidden = count === 0;
  bulkCount.textContent = `${count} selected`;
}

// ─── Single unfollow ──────────────────────────────────────────────────────────
async function unfollowSingle(user, item) {
  const btn = item.querySelector('.btn-unfollow-single');
  btn.textContent = '…';
  btn.disabled = true;

  const result = await msg('UNFOLLOW_USER', { userId: user.pk });

  if (result && result.ok) {
    unfollowedIds.add(user.pk);
    selectedIds.delete(user.pk);
    item.classList.add('unfollowed');
    item.classList.remove('selected');
    btn.textContent = 'Unfollowed';
    statNonFollowers.textContent = (allNonFollowers.length - unfollowedIds.size).toLocaleString();
  } else {
    btn.textContent = 'Error';
    setTimeout(() => { btn.textContent = 'Unfollow'; btn.disabled = false; }, 2000);
  }
  refreshBulkBar();
}

// ─── Bulk unfollow ────────────────────────────────────────────────────────────
unfollowSelectedBtn.addEventListener('click', () => {
  const toUnfollow = filteredUsers.filter(u => selectedIds.has(u.pk) && !unfollowedIds.has(u.pk));
  if (!toUnfollow.length) return;

  modalCount.textContent = toUnfollow.length;
  modalBody.innerHTML = `
    <div>This will unfollow ${toUnfollow.length} account(s):</div>
    <div class="user-name-list">${toUnfollow.map(u => `<span>@${esc(u.username)}</span>`).join('')}</div>
  `;
  modalOverlay.hidden = false;
  modalConfirm._queue = toUnfollow;
});

modalCancel.addEventListener('click', () => { modalOverlay.hidden = true; });

modalConfirm.addEventListener('click', async () => {
  const queue = modalConfirm._queue;
  modalOverlay.hidden = true;
  await runBulkUnfollow(queue);
});

unfollowCancelBtn.addEventListener('click', () => { cancelUnfollow = true; });

async function runBulkUnfollow(users) {
  cancelUnfollow = false;
  unfollowProgressOverlay.hidden = false;
  let done = 0;

  for (const user of users) {
    if (cancelUnfollow) break;
    unfollowProgressText.textContent = `Unfollowing @${user.username}… (${done + 1}/${users.length})`;
    unfollowProgressFill.style.width = `${Math.round((done / users.length) * 100)}%`;

    const result = await msg('UNFOLLOW_USER', { userId: user.pk });
    if (result?.ok) {
      unfollowedIds.add(user.pk);
      selectedIds.delete(user.pk);
      const item = userList.querySelector(`[data-pk="${user.pk}"]`);
      if (item) {
        item.classList.add('unfollowed');
        item.classList.remove('selected');
        const btn = item.querySelector('.btn-unfollow-single');
        if (btn) btn.textContent = 'Unfollowed';
        const chk = item.querySelector('.user-check');
        if (chk) chk.textContent = '';
      }
    }
    done++;
  }

  unfollowProgressFill.style.width = '100%';
  unfollowProgressText.textContent = cancelUnfollow
    ? `Stopped after ${done} unfollows.`
    : `Done! Unfollowed ${done} account(s).`;
  statNonFollowers.textContent = (allNonFollowers.length - unfollowedIds.size).toLocaleString();
  refreshBulkBar();
  setTimeout(() => { unfollowProgressOverlay.hidden = true; }, 2000);
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
