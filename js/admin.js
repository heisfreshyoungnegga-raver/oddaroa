// Oddaroa admin portals — shared by admin.html and super-admin.html.
// The page sets window.ODD_PORTAL = 'admin' | 'super'. Role checks here
// are only for display; the API enforces them server-side (same split
// as PrimeStake: super powers never render in the admin portal).
const PORTAL = window.ODD_PORTAL || 'admin';
const token = () => localStorage.getItem('oddaroa-token') || '';
const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), ...(opts.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || ('http_' + res.status));
    err.code = data.error; err.missing = data.missing;
    throw err;
  }
  return data;
}
function errText(e) {
  if (e.code === 'backend_not_configured') return 'Backend not configured yet — set ' + (e.missing || []).join(' + ') + ' on the host first.';
  return 'Error: ' + e.message;
}

let ME = null;
async function boot() {
  if (!token()) return showLogin();
  try {
    const { user } = await api('/api/auth/me');
    ME = user;
    if (user.role !== 'admin' && user.role !== 'super_admin') { showLogin('That account is not an admin account.'); return; }
    if (PORTAL === 'super' && user.role !== 'super_admin') { showLogin('Super Admin Portal — super admins only. Use the Admin Portal for admin accounts.'); return; }
    showDash();
  } catch { showLogin(); }
}
function showLogin(msg) {
  $('loginBox').hidden = false; $('dashBox').hidden = true;
  if (msg) $('loginMsg').textContent = msg;
}
function showDash() {
  $('loginBox').hidden = true; $('dashBox').hidden = false;
  $('whoami').textContent = `${ME.display_name || ME.phone} · ${ME.role.replace('_', ' ')}`;
  loadStats(); loadTips(); loadUsers();
  if (PORTAL === 'super') { loadSettings(); loadInvites(); } else loadSettingsReadOnly();
}

async function doLogin() {
  $('loginMsg').textContent = 'Signing in…';
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ phone: $('lPhone').value.trim(), password: $('lPass').value }) });
    localStorage.setItem('oddaroa-token', data.token);
    ME = data.user;
    if (PORTAL === 'super' && ME.role !== 'super_admin') { $('loginMsg').textContent = 'That account is not a super admin.'; return; }
    if (ME.role !== 'admin' && ME.role !== 'super_admin') { $('loginMsg').textContent = 'That account is not an admin account.'; return; }
    showDash();
  } catch (e) { $('loginMsg').textContent = errText(e); }
}
function logout() { localStorage.removeItem('oddaroa-token'); location.reload(); }

async function loadStats() {
  if (!$('statUsers')) return;
  try {
    const s = await api('/api/admin/stats');
    $('statUsers').textContent = s.users; $('statAdmins').textContent = s.admins;
    $('statVip').textContent = s.vip_active; $('statTips').textContent = s.tips_today;
    $('statPending').textContent = s.tips_pending;
  } catch (e) { $('dashMsg').textContent = errText(e); }
}

async function loadTips() {
  const rows = $('tipRows'); if (!rows) return;
  rows.innerHTML = '';
  try {
    const { tips } = await api('/api/admin/tips');
    tips.forEach(t => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td></td><td></td><td></td><td>${Number(t.odd).toFixed(2)}</td><td>${t.tier}</td>
        <td><select class="field" style="margin:0;padding:5px 8px;width:auto">
          ${['pending', 'won', 'lost', 'void'].map(r => `<option ${r === t.result ? 'selected' : ''}>${r}</option>`).join('')}
        </select></td><td><button class="x-btn" aria-label="Delete tip">×</button></td>`;
      tr.children[0].textContent = t.match; tr.children[1].textContent = t.market; tr.children[2].textContent = t.pick;
      tr.querySelector('select').onchange = async (ev) => { await api('/api/admin/tips', { method: 'PATCH', body: JSON.stringify({ id: t.id, result: ev.target.value }) }); loadStats(); };
      tr.querySelector('.x-btn').onclick = async () => { await api('/api/admin/tips?id=' + encodeURIComponent(t.id), { method: 'DELETE' }); loadTips(); loadStats(); };
      rows.appendChild(tr);
    });
    if (!tips.length) rows.innerHTML = '<tr><td colspan="7" style="color:var(--muted)">No tips yet.</td></tr>';
  } catch (e) { $('dashMsg').textContent = errText(e); }
}
async function addTip() {
  const t = { match: $('tMatch').value.trim(), league: $('tLeague').value.trim(), market: $('tMarket').value.trim(), pick: $('tPick').value.trim(), odd: Number($('tOdd').value), tier: $('tTier').value };
  if (!t.match || !t.market || !t.pick || !(t.odd > 1)) { $('tipMsg').textContent = 'Fill every field, with an odd above 1.00.'; return; }
  try { await api('/api/admin/tips', { method: 'POST', body: JSON.stringify(t) }); $('tipMsg').textContent = 'Tip published.'; loadTips(); loadStats(); }
  catch (e) { $('tipMsg').textContent = errText(e); }
}

async function loadUsers() {
  const rows = $('userRows'); if (!rows) return;
  rows.innerHTML = '';
  try {
    const { users } = await api('/api/admin/users');
    users.forEach(u => {
      const tr = document.createElement('tr');
      const vipTxt = u.vip ? 'VIP to ' + new Date(u.vip_until).toLocaleDateString() : '—';
      let actions = `<button class="btn small" data-a="vip">VIP +30d</button>
        <button class="btn small" data-a="block">${u.status === 'blocked' ? 'Unblock' : 'Block'}</button>`;
      if (PORTAL === 'super' && u.id !== ME.id) {
        actions += ` <select class="field" style="margin:0;padding:5px 8px;width:auto" data-a="role">
            ${['user', 'admin', 'super_admin'].map(r => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select>
          <button class="btn small danger" data-a="del">Delete</button>`;
      }
      tr.innerHTML = `<td></td><td></td><td>${u.role}</td><td>${u.status}</td><td>${vipTxt}</td><td style="white-space:nowrap">${actions}</td>`;
      tr.children[0].textContent = u.display_name || '—'; tr.children[1].textContent = u.phone;
      const q = (sel) => tr.querySelector(`[data-a="${sel}"]`);
      if (q('vip')) q('vip').onclick = async () => { await api('/api/admin/vip', { method: 'POST', body: JSON.stringify({ user_id: u.id, days: 30 }) }); loadUsers(); loadStats(); };
      if (q('block')) q('block').onclick = async () => { try { await api('/api/admin/block', { method: 'POST', body: JSON.stringify({ user_id: u.id, blocked: u.status !== 'blocked' }) }); loadUsers(); } catch (e) { $('dashMsg').textContent = errText(e); } };
      if (q('role')) q('role').onchange = async (ev) => { try { await api('/api/admin/promote', { method: 'POST', body: JSON.stringify({ user_id: u.id, role: ev.target.value }) }); loadUsers(); loadStats(); } catch (e) { $('dashMsg').textContent = errText(e); loadUsers(); } };
      if (q('del')) q('del').onclick = async () => { if (confirm('Delete this user permanently?')) { try { await api('/api/admin/delete-user', { method: 'POST', body: JSON.stringify({ user_id: u.id }) }); loadUsers(); } catch (e) { $('dashMsg').textContent = errText(e); } } };
      rows.appendChild(tr);
    });
    if (!users.length) rows.innerHTML = '<tr><td colspan="6" style="color:var(--muted)">No users yet.</td></tr>';
  } catch (e) { $('dashMsg').textContent = errText(e); }
}

async function loadSettingsReadOnly() {
  const box = $('settingsBox'); if (!box) return;
  try {
    const { settings } = await api('/api/admin/settings');
    box.innerHTML = Object.entries(settings).map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('');
  } catch (e) { box.textContent = errText(e); }
}
async function loadSettings() {
  const box = $('settingsForm'); if (!box) return;
  try {
    const { settings } = await api('/api/admin/settings');
    box.innerHTML = '';
    Object.entries(settings).forEach(([k, v]) => {
      const wrap = document.createElement('div');
      wrap.innerHTML = `<label style="display:block;color:var(--muted);font-size:13px;margin-bottom:4px">${k}</label>
        <div style="display:flex;gap:8px"><input class="field" style="margin:0" value=""><button class="btn small gold">Save</button></div>`;
      const input = wrap.querySelector('input'); input.value = v;
      wrap.querySelector('button').onclick = async () => { await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({ key: k, value: input.value }) }); $('setMsg').textContent = k + ' saved.'; };
      box.appendChild(wrap);
    });
  } catch (e) { $('setMsg').textContent = errText(e); }
}

async function loadInvites() {
  const rows = $('inviteRows'); if (!rows) return;
  try {
    const { invites } = await api('/api/admin/invite');
    rows.innerHTML = invites.map(i => `<tr><td>${i.role}</td><td>${i.status}</td><td>${new Date(i.expires_at).toLocaleString()}</td></tr>`).join('') || '<tr><td colspan="3" style="color:var(--muted)">No invites yet.</td></tr>';
  } catch (e) { $('invMsg').textContent = errText(e); }
}
async function createInvite(role) {
  try {
    const data = await api('/api/admin/invite', { method: 'POST', body: JSON.stringify({ role }) });
    $('invMsg').innerHTML = `One-time ${role} link (48h, shown once): <a href="${data.invite_url}" style="color:var(--gold)">${data.invite_url}</a>`;
    loadInvites();
  } catch (e) { $('invMsg').textContent = errText(e); }
}

document.addEventListener('DOMContentLoaded', () => {
  if ($('loginBtn')) $('loginBtn').onclick = doLogin;
  if ($('logoutBtn')) $('logoutBtn').onclick = logout;
  if ($('addTip')) $('addTip').onclick = addTip;
  if ($('invAdmin')) $('invAdmin').onclick = () => createInvite('admin');
  if ($('invSuper')) $('invSuper').onclick = () => createInvite('super_admin');
  boot();
});
