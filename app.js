// ═══════════════════════════════════════════════════════════════
//   KAS DESA - Frontend Logic (GitHub Pages + GAS API)
// ═══════════════════════════════════════════════════════════════

const GAS_URL_KEY = 'kas_desa_gas_url';
const STATE_CACHE_KEY = 'kas_desa_state_cache';
const SYNC_QUEUE_KEY = 'kas_desa_sync_queue';

let gasUrl = localStorage.getItem(GAS_URL_KEY) || '';
let syncQueue = JSON.parse(localStorage.getItem(SYNC_QUEUE_KEY) || '[]');

let cashflowChart, categoryChart;

let state = {
  transactions: [
    { id: 'TRX-001', date: '2026-05-01', type: 'pemasukan', category: '[DD] Earmark', subCategory: 'Penerimaan Transfer', desc: 'Transfer Dana Desa Earmark', amount: 50000000, payMethod: 'Transfer', status: 'approved', user: 'admin' },
    { id: 'TRX-002', date: '2026-05-02', type: 'pengeluaran', category: '[ADD] Siltap', subCategory: 'Belanja Pegawai', desc: 'Gaji Perangkat Desa Mei', amount: 15000000, payMethod: 'Transfer', status: 'approved', user: 'admin' },
  ],
  sources: [
    { type: 'DD', name: 'Earmark', initialBalance: 0, description: 'Dana Desa yang sudah ditentukan penggunaannya', active: 'Aktif' },
    { type: 'DD', name: 'NonEarmark', initialBalance: 0, description: 'Dana Desa bebas/reguler', active: 'Aktif' },
    { type: 'ADD', name: 'Siltap', initialBalance: 0, description: 'Alokasi Dana Desa untuk Penghasilan Tetap', active: 'Aktif' },
    { type: 'ADD', name: 'Operasional', initialBalance: 0, description: 'Alokasi Dana Desa untuk Operasional', active: 'Aktif' },
    { type: 'PAD', name: 'PAD', initialBalance: 0, description: 'Pendapatan Asli Desa', active: 'Aktif' },
    { type: 'BHPR', name: 'BHPR', initialBalance: 0, description: 'Bagi Hasil Pajak & Retribusi', active: 'Aktif' },
    { type: 'DLL', name: 'Lain-lain', initialBalance: 0, description: 'Pendapatan Lain-lain yang Sah', active: 'Aktif' },
  ],
  categories: [
    { name: 'Belanja Pegawai', type: 'pengeluaran' }, { name: 'Belanja Barang & Jasa', type: 'pengeluaran' },
    { name: 'Belanja Modal', type: 'pengeluaran' }, { name: 'Belanja Operasional', type: 'pengeluaran' },
    { name: 'Belanja Tak Terduga', type: 'pengeluaran' },
    { name: 'Penerimaan Transfer', type: 'pemasukan' }, { name: 'Penerimaan PAD', type: 'pemasukan' },
    { name: 'Penerimaan Lainnya', type: 'pemasukan' },
  ],
  references: ['DD Earmark', 'DD NonEarmark', 'ADD Siltap', 'ADD Operasional', 'PAD', 'DLL', 'BHPR', 'Non-APBDes'],
  settings: { saldo_lalu: 0 },
  config: { NAMA_KANTOR: 'Kantor Desa Patihan', BATAS_APPROVAL: 5000000 },
  env: { active: 'PROD', name: 'Production' }
};

// Load cached state if exists (based on last environment)
const lastEnv = localStorage.getItem('kas_desa_last_env') || 'PROD';
const cachedState = localStorage.getItem(STATE_CACHE_KEY + '_' + lastEnv);
if (cachedState) {
  state = JSON.parse(cachedState);
}
state.simulations = state.simulations || [];
state.isSimulationModeActive = state.isSimulationModeActive || false;




// ─── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const d = document.getElementById('trx-date');
  if (d) d.value = new Date().toISOString().split('T')[0];
  const savedTheme = localStorage.getItem('kas_desa_theme');
  if (savedTheme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  updateThemeIcon();
  if (gasUrl) {
    document.getElementById('set-gas-url').value = gasUrl;
    fetchFromGAS();
  } else {
    document.getElementById('setup-banner').style.display = 'flex';
    updateUI();
  }

  window.addEventListener('online', handleConnectivityChange);
  window.addEventListener('offline', handleConnectivityChange);
  updateSyncBadge();
});

function toggleUserRole() {
  const nameEl = document.getElementById('user-name');
  const avatarEl = document.getElementById('user-avatar');
  if (nameEl.innerText === 'Admin') {
    nameEl.innerText = 'Staff';
    avatarEl.innerText = 'S';
    showToast('Login sebagai Staff (Approval Aktif)', 'info');
  } else {
    nameEl.innerText = 'Admin';
    avatarEl.innerText = 'A';
    showToast('Login sebagai Admin (Approval Mati)', 'success');
  }
  updateUI();
}

function handleConnectivityChange() {
  const isOnline = navigator.onLine;
  document.getElementById('conn-status').textContent = isOnline ? 'Online' : 'Offline';
  if (isOnline) {
    showToast('Koneksi kembali! Menyingkronkan data...', 'success');
    syncOfflineActions();
  } else {
    showToast('Anda sedang offline. Perubahan akan disimpan secara lokal.', 'info');
  }
}


// ─── GAS API ───────────────────────────────────────────────────
async function fetchFromGAS() {
  if (!gasUrl) { updateUI(); return; }
  showLoading(true);
  try {
    const r = await fetch(gasUrl + '?action=getAllData');
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    state.transactions = d.transactions || [];
    state.sources = d.sources || [];

    state.settings = d.settings || {};
    state.config = d.config || state.config;
    state.env = d.env || state.env;
    state.references = d.references || [];

    const envCacheKey = STATE_CACHE_KEY + '_' + state.env.active;
    localStorage.setItem(envCacheKey, JSON.stringify(state));
    localStorage.setItem('kas_desa_last_env', state.env.active);

    document.getElementById('conn-status').textContent = 'Online';
    document.getElementById('setup-banner').style.display = 'none';

    if (d.dbStatus === 'needs_init') {
      showToast('Struktur database (Silpa) belum siap. Harap klik "Tes Koneksi" di Pengaturan untuk inisialisasi.', 'warning');
    } else {
      showToast('Data berhasil dimuat dari server!', 'success');
    }

    // Cek jika tahun aktif tidak punya transaksi, tapi tahun lain punya transaksi (hanya lakukan jika belum diset manual)
    const yr = getActiveYear();
    if (!state.settings || !state.settings.tahun_anggaran) {
      const hasTrxInActiveYear = (state.transactions || []).some(t => getYearFromDateString(t.date) === yr);
      if (!hasTrxInActiveYear && state.transactions.length > 0) {
        const years = state.transactions.map(t => getYearFromDateString(t.date)).filter(Boolean);
        if (years.length > 0) {
          // Ambil tahun transaksi terbaru dari spreadsheet
          const mostRecentYear = years.sort((a, b) => Number(b) - Number(a))[0];
          if (mostRecentYear && mostRecentYear !== yr) {
            if (!state.settings) state.settings = {};
            state.settings.tahun_anggaran = Number(mostRecentYear);
            localStorage.setItem(envCacheKey, JSON.stringify(state));
            showToast(`Tahun Anggaran disesuaikan ke ${mostRecentYear} sesuai data di Google Sheets!`, 'info');
          }
        }
      }
    }

  } catch (e) {
    document.getElementById('conn-status').textContent = 'Offline';
    showToast('Gagal terhubung (Mode Offline aktif): ' + e.message, 'error');
  }


  showLoading(false);
  updateUI();
}

async function postToGAS(body) {
  if (!gasUrl) return null;

  if (!navigator.onLine) {
    queueOfflineAction(body);
    return { success: true, status: 'offline', offline: true };
  }

  try {
    const r = await fetch(gasUrl, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' } });
    return await r.json();
  } catch (e) {
    queueOfflineAction(body);
    return { success: true, status: 'offline', offline: true };
  }
}

function queueOfflineAction(body) {
  syncQueue.push({ id: Date.now(), body, timestamp: new Date() });
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(syncQueue));
  updateSyncBadge();
  showToast('Tersimpan offline! Akan disinkronkan saat online.', 'info');
}

async function syncOfflineActions() {
  if (syncQueue.length === 0) return;

  showLoading(true);
  let successCount = 0;
  const newQueue = [];

  for (const item of syncQueue) {
    try {
      const r = await fetch(gasUrl, { method: 'POST', body: JSON.stringify(item.body), headers: { 'Content-Type': 'text/plain' } });
      const res = await r.json();
      if (res.success) successCount++;
      else newQueue.push(item);
    } catch (e) {
      newQueue.push(item);
    }
  }

  syncQueue = newQueue;
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(syncQueue));
  updateSyncBadge();
  showLoading(false);

  if (successCount > 0) {
    showToast(`${successCount} data berhasil disinkronkan!`, 'success');
    fetchFromGAS();
  }
}

function updateSyncBadge() {
  const el = document.getElementById('sync-status');
  const countEl = document.getElementById('sync-count');
  if (el && countEl) {
    const count = syncQueue.length;
    el.style.display = count > 0 ? 'flex' : 'none';
    countEl.innerText = count;
  }
}

function clearSyncQueue() {
  if (syncQueue.length === 0) return;
  if (!confirm(`Ada ${syncQueue.length} data antrian sinkronisasi yang macet.\nData ini mungkin gagal dikirim karena error di server.\n\nApakah Anda ingin MENGHAPUS antrian ini secara paksa?`)) return;

  syncQueue = [];
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(syncQueue));
  updateSyncBadge();
  showToast('Antrian sinkronisasi berhasil dihapus.', 'success');
}


function saveGasUrl() {
  const url = document.getElementById('set-gas-url').value.trim();
  if (!url) { showToast('URL tidak boleh kosong!', 'error'); return; }
  gasUrl = url;
  localStorage.setItem(GAS_URL_KEY, url);
  showToast('URL tersimpan!', 'success');
  fetchFromGAS();
  closeModal('modal-settings');
}

async function testConnection() {
  const url = document.getElementById('set-gas-url').value.trim();
  if (!url) { showToast('Masukkan URL terlebih dahulu', 'error'); return; }
  showToast('Menginisialisasi database...', 'info');
  try {
    const r = await fetch(url + '?action=initDB');
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    showToast('Koneksi berhasil & Database siap!', 'success');
    fetchFromGAS();
  } catch (e) { showToast('Gagal: ' + e.message, 'error'); }
}

function standardizeCategory(cat) {
  if (!cat) return '';
  const clean = String(cat).trim();
  const matched = (state.references || []).find(ref => matchCategory(clean, ref));
  return matched || clean;
}

// ─── UPDATE UI ─────────────────────────────────────────────────
function updateUI() {
  // Standardize transaction categories in-memory to prevent duplicate categories like [PAD] PAD vs PAD
  if (state.transactions && state.references) {
    state.transactions.forEach(t => {
      t.category = standardizeCategory(t.category);
    });
  }

  updateStats(); renderRecentTransactions(); renderFullTransactions();
  renderBudgets(); renderApprovals(); renderMiniApprovals();
  updateReportUI(); renderRKD(); populateDropdowns(); populateReferenceDropdowns();

  renderSettingsSources(); renderSettingsReferences(); renderNonApbdesPage(); initCharts();
  renderSimulations();
  updateSimulationModeUI();

  updateEnvUI();
  updateSettingsUI();
}

function updateSettingsUI() {
  const apbdes = state.settings?.APBDes || 'Awal';
  const apbdesSelect = document.getElementById('set-apbdes');
  if (apbdesSelect) apbdesSelect.value = apbdes;

  const tahun = state.settings?.tahun_anggaran || state.config?.TAHUN_ANGGARAN || new Date().getFullYear();
  const tahunInput = document.getElementById('set-tahun');
  if (tahunInput) tahunInput.value = tahun;

  const sidebarTahun = document.getElementById('sidebar-tahun');
  if (sidebarTahun) sidebarTahun.textContent = tahun;

  const sidebarApbdes = document.getElementById('sidebar-apbdes');
  if (sidebarApbdes) sidebarApbdes.textContent = apbdes;

  const sourceYearInput = document.getElementById('set-source-year');
  if (sourceYearInput && !sourceYearInput.value) {
    sourceYearInput.value = tahun;
  }
}

// Helper: ekstrak tahun dari string tanggal apa saja secara robust
function getYearFromDateString(dateStr) {
  if (!dateStr) return '';
  const clean = String(dateStr).trim();
  // Pola 1: YYYY di awal (misal: 2025-05-12 atau 2025/05/12)
  const matchStart = clean.match(/^(\d{4})/);
  if (matchStart) return matchStart[1];
  // Pola 2: YYYY di akhir (misal: 12-05-2025 atau 12/05/2025 atau 12 Mei 2025)
  const matchEnd = clean.match(/(\d{4})$/);
  if (matchEnd) return matchEnd[1];

  // Pola 3: parsing tanggal standar browser
  try {
    const d = new Date(clean);
    if (!isNaN(d.getTime())) {
      return String(d.getFullYear());
    }
  } catch (e) { }

  return '';
}

// Helper: dapatkan tahun anggaran aktif
function getActiveYear() {
  return String(state.settings?.tahun_anggaran || state.config?.TAHUN_ANGGARAN || new Date().getFullYear());
}

// Helper: filter transaksi sesuai tahun anggaran aktif secara robust
function getActiveTrx() {
  const yr = getActiveYear();
  let txs = [...(state.transactions || [])];
  if (state.isSimulationModeActive) {
    txs = txs.concat(state.simulations || []);
  }
  return txs.filter(t => getYearFromDateString(t.date) === yr);
}

// Helper: mencocokkan kategori transaksi dengan sumber dana secara dinamis dan toleran format
function matchCategory(tCategory, ref) {
  if (!tCategory || !ref) return false;
  const cleanCategory = String(tCategory).trim().toLowerCase();

  const parseClean = (str) => {
    let s = str.replace(/^\[.*?\]\s*/, '');
    s = s.replace(/^(add|dd|pad|dll|bhpr)\s+/i, '');
    return s.trim().toLowerCase();
  };

  if (typeof ref === 'object') {
    const typeClean = String(ref.type || '').trim().toLowerCase();
    const nameClean = String(ref.name || '').trim().toLowerCase();
    const fullLabel = `[${typeClean}] ${nameClean}`.toLowerCase();
    if (cleanCategory === fullLabel) return true;
    if (cleanCategory === nameClean) return true;
    return parseClean(cleanCategory) === parseClean(nameClean);
  }

  const cleanRef = String(ref).trim().toLowerCase();
  if (cleanCategory === cleanRef) return true;

  return parseClean(cleanCategory) === parseClean(cleanRef);
}

async function saveTahunAnggaran() {
  const val = document.getElementById('set-tahun')?.value;
  if (!val || isNaN(val)) { showToast('Masukkan tahun yang valid!', 'error'); return; }
  await saveSetting('tahun_anggaran', Number(val));
}

async function saveSetting(key, value) {
  if (!state.settings) state.settings = {};
  state.settings[key] = value;
  const envKey = STATE_CACHE_KEY + '_' + (state.env?.active || 'PROD');
  localStorage.setItem(envKey, JSON.stringify(state));
  updateUI(); // Langsung perbarui tampilan

  if (gasUrl) {
    try {
      showLoading(true);
      await postToGAS({ action: 'updateSettings', key, value });
      showToast('Pengaturan disimpan!', 'success');
      if (key === 'tahun_anggaran') {
        await fetchFromGAS(); // Muat ulang semua data untuk tahun baru secara otomatis!
      }
      showLoading(false);
    } catch (e) {
      showLoading(false);
      showToast('Gagal menyimpan ke server', 'error');
    }
  } else {
    showToast('Pengaturan disimpan (lokal)', 'success');
  }
}

function updateEnvUI() {
  const badge = document.getElementById('env-badge');
  if (badge) {
    badge.textContent = state.env.name;
    badge.className = 'env-badge env-' + state.env.active.toLowerCase();
  }
  const select = document.getElementById('set-env-active');
  if (select) select.value = state.env.active;
}

async function changeEnvironment() {
  const env = document.getElementById('set-env-active').value;
  if (env === state.env.active) return;
  if (!confirm(`Pindah ke lingkungan ${env}? Data akan dimuat ulang.`)) {
    document.getElementById('set-env-active').value = state.env.active;
    return;
  }

  if (gasUrl) {
    showLoading(true);
    try {
      const r = await fetch(gasUrl + '?action=switchEnv&env=' + env);
      const d = await r.json();
      if (d.success) {
        showToast(d.message, 'success');
        await fetchFromGAS();
      } else {
        throw new Error(d.message);
      }
    } catch (e) {
      showToast('Gagal ganti env: ' + e.message, 'error');
      document.getElementById('set-env-active').value = state.env.active;
    }
    showLoading(false);
  } else {
    state.env.active = env;
    state.env.name = env.charAt(0) + env.slice(1).toLowerCase();
    showToast('Lingkungan lokal diubah (simulasi)', 'info');
    updateUI();
  }
}


function updateStats() {
  const isPerubahan = (state.settings?.APBDes || 'Awal') === 'Perubahan';
  const yr = getActiveYear();

  // Hitung initial balance total yang cocok dengan tahun aktif (prioritas tahun aktif, fallback ke global)
  const uniqueCategories = [...new Set((state.sources || []).map(s => `[${s.type}] ${s.name}`))];
  const totalSourcesInit = uniqueCategories.reduce((sum, cat) => {
    const matchYr = (state.sources || []).find(s => matchCategory(cat, s) && String(s.year || '') === yr);
    const matchGlobal = (state.sources || []).find(s => matchCategory(cat, s) && !s.year);
    const src = matchYr || matchGlobal || { initialBalance: 0 };
    return sum + Number(src.initialBalance || 0);
  }, 0);

  const init = isPerubahan
    ? totalSourcesInit + Number(state.settings?.saldo_lalu || 0)
    : 0;

  const trx = getActiveApbdesTrx(); // Filter berdasarkan tahun anggaran aktif (hanya APBDes)
  const inc = trx.filter(t => isPemasukan(t) && isApproved(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
  const exp = trx.filter(t => isPengeluaran(t) && isApproved(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
  const pend = trx.filter(t => (t.status || '').trim().toLowerCase() === 'pending').length;
  const silpaEl = document.getElementById('stat-silpa');
  if (silpaEl) {
    const silpaCard = silpaEl.closest('.stat-card');
    if (silpaCard) silpaCard.style.display = isPerubahan ? '' : 'none';
  }
  setText('stat-silpa', formatIDR(init));
  setText('stat-income', formatIDR(inc)); setText('stat-expense', formatIDR(exp));
  setText('stat-balance', formatIDR(init + inc - exp)); setText('stat-pending', pend);
  const b = document.getElementById('badge-approval');
  if (b) { b.innerText = pend; b.style.display = pend > 0 ? 'flex' : 'none'; }
}

function renderRecentTransactions() {
  const el = document.getElementById('recent-transactions-list'); if (!el) return; el.innerHTML = '';
  const sorted = [...getActiveApbdesTrx()].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!sorted.length) { el.innerHTML = '<tr><td colspan="5" class="empty-state"><p>Belum ada transaksi di tahun ' + getActiveYear() + '</p></td></tr>'; return; }
  sorted.slice(0, 5).forEach(t => {
    const r = document.createElement('tr');
    r.innerHTML = `<td>${fmtDate(t.date)}</td><td><b>${t.category || '-'}</b></td><td>${t.desc}</td><td style="color:${t.type === 'pemasukan' ? 'var(--success)' : 'var(--danger)'};font-weight:700">${t.type === 'pemasukan' ? '+' : '-'} ${formatIDR(t.amount)}</td><td><span class="status-badge status-${(t.status || '').toLowerCase()}">${t.status}</span></td>`;
    el.appendChild(r);
  });
}

function renderFullTransactions() {
  const el = document.getElementById('full-transactions-list'); if (!el) return; el.innerHTML = '';
  const sorted = [...getActiveApbdesTrx()].sort((a, b) => new Date(b.date) - new Date(a.date));
  if (!sorted.length) { el.innerHTML = '<tr><td colspan="8" class="empty-state"><p>Belum ada transaksi di tahun ' + getActiveYear() + '</p></td></tr>'; return; }
  sorted.forEach(t => {
    const r = document.createElement('tr');
    r.innerHTML = `<td><code style="font-size:0.7rem;background:#f1f5f9;padding:2px 5px;border-radius:4px">${t.id}</code></td><td>${fmtDate(t.date)}</td><td><span class="status-badge status-${t.type === 'pemasukan' ? 'approved' : 'rejected'}" style="font-size:0.6rem">${t.type === 'pemasukan' ? 'MASUK' : 'KELUAR'}</span></td><td>${t.category || '-'}</td><td>${t.desc}</td><td style="font-weight:700">${formatIDR(t.amount)}</td><td><span class="status-badge status-${(t.status || '').toLowerCase()}">${t.status}</span></td><td><button class="btn btn-outline btn-sm" onclick="confirmDelete('${t.id}')"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button></td>`;
    el.appendChild(r);
  });
  lucide.createIcons();
}

function renderBudgets() {
  const elSilpa = document.getElementById('budget-list-silpa');
  const elCurrent = document.getElementById('budget-list-current');
  if (!elSilpa || !elCurrent) return;

  elSilpa.innerHTML = ''; elCurrent.innerHTML = '';
  const isPerubahan = (state.settings?.APBDes || 'Awal') === 'Perubahan';

  const titleSilpa = document.getElementById('budget-title-silpa');
  if (titleSilpa) titleSilpa.style.display = isPerubahan ? '' : 'none';
  elSilpa.style.display = isPerubahan ? '' : 'none';

  const defaultDescriptions = {
    'DD Earmark': 'Dana Desa yang sudah ditentukan penggunaannya',
    'DD NonEarmark': 'Dana Desa bebas/reguler',
    'ADD Siltap': 'Alokasi Dana Desa untuk Penghasilan Tetap',
    'ADD Operasional': 'Alokasi Dana Desa untuk Operasional',
    'PAD': 'Pendapatan Asli Desa',
    'BHPR': 'Bagi Hasil Pajak & Retribusi',
    'DLL': 'Pendapatan Lain-lain yang Sah'
  };

  // --- 1. Anggaran Tahun Berjalan (Berdasarkan Sheet Referensi) ---
  const activeTrx = getActiveApbdesTrx();
  (state.references || []).forEach(refLabel => {
    const matchYr = (state.sources || []).find(s => (s.type === refLabel || '[' + s.type + '] ' + s.name === refLabel || s.name === refLabel) && String(s.year || '') === getActiveYear());
    const matchGlobal = (state.sources || []).find(s => (s.type === refLabel || '[' + s.type + '] ' + s.name === refLabel || s.name === refLabel) && !s.year);
    const original = matchGlobal || matchYr || {};

    const cleanLabel = refLabel.replace(/silpa/gi, '').replace(/\s+/g, ' ').trim();
    let cleanDesc = (original.description || '').replace(/silpa/gi, '').replace(/\s+/g, ' ').trim();
    if (!cleanDesc || cleanDesc.toLowerCase().includes('import')) {
      cleanDesc = defaultDescriptions[cleanLabel] || cleanDesc;
    }

    const income = activeTrx
      .filter(t => matchCategory(t.category, refLabel) && isPemasukan(t) && isApproved(t))
      .reduce((s, t) => s + Number(t.amount || 0), 0);

    const spentCurrent = activeTrx
      .filter(t => matchCategory(t.category, refLabel) && isPengeluaran(t) && isApproved(t))
      .reduce((s, t) => s + Number(t.amount || 0), 0);

    elCurrent.appendChild(createBudgetCard(cleanLabel, cleanDesc, income, spentCurrent, 'Tahun Berjalan'));
  });

  // --- 2. Anggaran SiLPA (Berdasarkan Sheet Silpa/Master) ---
  if (isPerubahan) {
    const activeSources = (state.sources || []).filter(src => {
      const catLabel = `[${src.type}] ${src.name}`;
      const matchYr = (state.sources || []).find(s => matchCategory(catLabel, s) && String(s.year || '') === getActiveYear());
      if (matchYr) return src === matchYr;
      return !src.year;
    });

    activeSources.forEach(src => {
      const label = `[${src.type}] ${src.name}`;
      const init = Number(src.initialBalance || 0);
      const spentSilpa = activeTrx
        .filter(t => matchCategory(t.category, src) && isPengeluaran(t) && isApproved(t))
        .reduce((s, t) => s + Number(t.amount || 0), 0);

      elSilpa.appendChild(createBudgetCard(label, src.description || '', init, spentSilpa, 'SiLPA'));
    });
  }

  lucide.createIcons();
}

function createBudgetCard(label, desc, pagu, realisasi, type) {
  const pct = pagu > 0 ? Math.min(100, (realisasi / pagu) * 100) : 0;
  let clr = 'var(--success)';
  if (pct > 90) clr = 'var(--danger)';
  else if (pct > 75) clr = 'var(--warning)';
  else if (pct > 50) clr = 'var(--info)';

  const c = document.createElement('div');
  c.className = 'card';
  c.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:0.9rem">
      <div>
        <h4 style="font-weight:700;color:var(--text-title);font-size:0.9rem">${label}</h4>
        <span style="font-size:0.7rem;color:var(--text-muted)">${desc || ''}</span>
      </div>
      <span style="font-size:0.8rem;font-weight:700;color:${clr}">${pct.toFixed(1)}%</span>
    </div>
    <div style="background:#f1f5f9;height:7px;border-radius:4px;overflow:hidden;margin-bottom:0.9rem">
      <div style="width:${pct}%;height:100%;background:${clr};transition:width 1s;border-radius:4px"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:0.75rem">
      <span>Realisasi: <b style="color:var(--danger)">${formatIDR(realisasi)}</b></span>
      <span>Pagu ${type}: <b>${formatIDR(pagu)}</b></span>
    </div>`;
  return c;
}

function renderApprovals() {
  const el = document.getElementById('approval-list'); if (!el) return; el.innerHTML = '';
  const pend = getActiveTrx().filter(t => (t.status || '').trim().toLowerCase() === 'pending');
  if (!pend.length) { el.innerHTML = '<div class="empty-state"><p>Tidak ada pengajuan pending di tahun ' + getActiveYear() + '</p></div>'; return; }
  pend.forEach(t => {
    const d = document.createElement('div'); d.className = 'approval-item';
    d.innerHTML = `<div><div style="font-weight:700;color:var(--text-title);margin-bottom:0.2rem">${t.desc}</div><div style="font-size:0.75rem;color:var(--text-muted)">${t.category} • ${fmtDate(t.date)}</div></div><div style="text-align:right"><div style="font-weight:800;color:var(--text-title);margin-bottom:0.6rem">${formatIDR(t.amount)}</div><div id="approval-btns-${t.id}" style="display:flex;gap:0.4rem;justify-content:flex-end"><button class="btn btn-danger btn-sm" onclick="processApproval('${t.id}','rejected')">Tolak</button><button class="btn btn-success btn-sm" onclick="processApproval('${t.id}','approved')">Setujui</button></div></div>`;
    el.appendChild(d);
  });
}

function renderMiniApprovals() {
  const el = document.getElementById('mini-approval-list'); if (!el) return; el.innerHTML = '';
  const pend = getActiveTrx().filter(t => (t.status || '').trim().toLowerCase() === 'pending');
  if (!pend.length) { el.innerHTML = '<div class="empty-state" style="padding:1.25rem 0"><p>Tidak ada antrian</p></div>'; return; }
  pend.slice(0, 3).forEach(t => {
    const d = document.createElement('div');
    d.style.cssText = 'padding:0.6rem 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center';
    d.innerHTML = `<div><div style="font-weight:600;font-size:0.8rem">${t.desc}</div><div style="font-size:0.7rem;color:var(--text-muted)">${formatIDR(t.amount)}</div></div><button class="btn-icon" onclick="showPage('approval')"><i data-lucide="chevron-right"></i></button>`;
    el.appendChild(d);
  }); lucide.createIcons();
}

function updateReportUI() {
  const isPerubahan = (state.settings?.APBDes || 'Awal') === 'Perubahan';
  const trx = getActiveApbdesTrx();
  const yr = getActiveYear();

  // Hitung initial balance total yang cocok dengan tahun aktif (prioritas tahun aktif, fallback ke global)
  const uniqueCategories = [...new Set((state.sources || []).map(s => `[${s.type}] ${s.name}`))];
  const totalSourcesInit = uniqueCategories.reduce((sum, cat) => {
    const matchYr = (state.sources || []).find(s => matchCategory(cat, s) && String(s.year || '') === yr);
    const matchGlobal = (state.sources || []).find(s => matchCategory(cat, s) && !s.year);
    const src = matchYr || matchGlobal || { initialBalance: 0 };
    return sum + Number(src.initialBalance || 0);
  }, 0);

  const inc = trx.filter(t => isPemasukan(t) && isApproved(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
  const exp = trx.filter(t => isPengeluaran(t) && isApproved(t)).reduce((s, t) => s + Number(t.amount || 0), 0);

  const init = totalSourcesInit + Number(state.settings?.saldo_lalu || 0);

  // Sembunyikan/tampilkan baris SiLPA di laporan
  const silpaRow = document.getElementById('rep-silpa')?.closest('.card');
  if (silpaRow) silpaRow.style.display = '';
  setText('rep-silpa', formatIDR(init));
  setText('rep-income', formatIDR(inc)); setText('rep-expense', formatIDR(exp)); setText('rep-balance', formatIDR(init + inc - exp));

  const el = document.getElementById('report-category-list'); if (!el) return; el.innerHTML = '';

  const baselineCategories = (state.references || []).filter(r => r !== 'Non-APBDes');

  // Dapatkan seluruh rincian kategori/sumber dana unik secara dinamis dari transaksi tahun berjalan DAN master sumber dana
  const trxCategories = [...new Set([
    ...baselineCategories,
    ...uniqueCategories.map(c => standardizeCategory(c)),
    ...trx.map(t => standardizeCategory(t.category)).filter(Boolean)
  ])];

  if (trxCategories.length === 0) {
    const r = document.createElement('tr');
    r.innerHTML = `<td colspan="6" style="text-align:center;color:var(--text-muted);font-style:italic;padding:1.5rem">
      ⚠️ Belum ada transaksi atau sumber dana di tahun ${yr}.
    </td>`;
    el.appendChild(r);
    return;
  }

  trxCategories.forEach(cat => {
    // Cari data master silpa yang cocok untuk mendapatkan initial balance baseline jika ada
    // Prioritaskan yang tahunnya cocok dengan yr, baru yang global/tanpa tahun
    const matchYr = (state.sources || []).find(s => matchCategory(cat, s) && String(s.year || '') === yr);
    const matchGlobal = (state.sources || []).find(s => matchCategory(cat, s) && !s.year);
    const src = matchYr || matchGlobal || { type: '', name: cat, initialBalance: 0 };

    const si = trx.filter(t => matchCategory(t.category, cat) && isPemasukan(t) && isApproved(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
    const so = trx.filter(t => matchCategory(t.category, cat) && isPengeluaran(t) && isApproved(t)).reduce((s, t) => s + Number(t.amount || 0), 0);

    // Saldo awal tahun aktif = initialBalance (TANPA carry-over karena SiLPA sudah valid)
    const ib = Number(src.initialBalance || 0);
    const finalBalance = ib + si - so;

    const r = document.createElement('tr');
    r.innerHTML = `
      <td><b>${cat}</b></td>
      <td>${formatIDR(ib)}</td>
      <td class="txt-success">+${formatIDR(si)}</td>
      <td class="txt-danger">-${formatIDR(so)}</td>
      <td style="font-weight:800">${formatIDR(finalBalance)}</td>
    `;
    el.appendChild(r);
  });
  lucide.createIcons();
}

async function sendToSilpa(cat, finalBalance) {
  const yr = getActiveYear();
  const nextYear = Number(yr) + 1;

  // Hitung saldo akhir secara akurat untuk semua kategori terkait demi menjamin sifat IDEMPOTEN (tidak terjadi penjumlahan berulang saat diklik berkali-kali)
  const trx = getActiveApbdesTrx();
  const beforeTrx = (state.transactions || []).filter(t => {
    const tYear = getYearFromDateString(t.date);
    return tYear && Number(tYear) < Number(yr) && isApproved(t);
  });

  function getFinalBalanceFor(categoryName) {
    const matchYr = (state.sources || []).find(s => matchCategory(categoryName, s) && String(s.year || '') === yr);
    const matchGlobal = (state.sources || []).find(s => matchCategory(categoryName, s) && !s.year);
    const src = matchYr || matchGlobal || { type: '', name: categoryName, initialBalance: 0 };

    const si = trx.filter(t => matchCategory(t.category, categoryName) && isPemasukan(t) && isApproved(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
    const so = trx.filter(t => matchCategory(t.category, categoryName) && isPengeluaran(t) && isApproved(t)).reduce((s, t) => s + Number(t.amount || 0), 0);

    const prevInc = beforeTrx.filter(t => matchCategory(t.category, categoryName) && isPemasukan(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
    const prevExp = beforeTrx.filter(t => matchCategory(t.category, categoryName) && isPengeluaran(t)).reduce((s, t) => s + Number(t.amount || 0), 0);

    return Number(src.initialBalance || 0) + prevInc - prevExp + si - so;
  }

  let parsed = parseCategory(cat);
  let targetCat = cat;
  let valueToSend = finalBalance;
  let specialMessage = '';

  const normalizedCat = cat.replace(/\s+/g, '').toLowerCase();

  if (normalizedCat.includes('earmark')) {
    // DD Earmark & DD NonEarmark saling dijumlahkan ke DD NonEarmark
    const balEarmark = getFinalBalanceFor('[DD] Earmark');
    const balNonEarmark = getFinalBalanceFor('[DD] NonEarmark');
    valueToSend = balEarmark + balNonEarmark;
    parsed = { type: 'DD', name: 'NonEarmark' };
    targetCat = '[DD] NonEarmark';

    if (!normalizedCat.includes('non')) {
      specialMessage = `\n\n💡 Sesuai regulasi khusus, sisa saldo [DD] Earmark (${formatIDR(balEarmark)}) akan digabungkan dengan saldo [DD] NonEarmark (${formatIDR(balNonEarmark)}) menjadi total ${formatIDR(valueToSend)} sebagai Saldo Awal [DD] NonEarmark tahun berikutnya.`;
    }
  } else if (normalizedCat.includes('siltap') || (normalizedCat.includes('add') && normalizedCat.includes('operasional'))) {
    // ADD Siltap & ADD Operasional saling dijumlahkan ke ADD Operasional
    const balSiltap = getFinalBalanceFor('[ADD] Siltap');
    const balOperasional = getFinalBalanceFor('[ADD] Operasional');
    valueToSend = balSiltap + balOperasional;
    parsed = { type: 'ADD', name: 'Operasional' };
    targetCat = '[ADD] Operasional';

    if (normalizedCat.includes('siltap')) {
      specialMessage = `\n\n💡 Sesuai regulasi khusus, sisa saldo [ADD] Siltap (${formatIDR(balSiltap)}) akan digabungkan dengan saldo [ADD] Operasional (${formatIDR(balOperasional)}) menjadi total ${formatIDR(valueToSend)} sebagai Saldo Awal [ADD] Operasional tahun berikutnya.`;
    }
  }

  if (!confirm(`Kirim Saldo Akhir tahun ${yr} untuk ${cat} sebesar ${formatIDR(finalBalance)} ke master Silpa tahun ${nextYear} (${targetCat})?${specialMessage}`)) {
    return;
  }

  showLoading(true);

  // Optimistic UI Update
  const yearStr = String(nextYear);
  const existingIdx = state.sources.findIndex(s => s.type === parsed.type && s.name === parsed.name && String(s.year || '') === yearStr);
  if (existingIdx !== -1) {
    state.sources[existingIdx].initialBalance = valueToSend;
  } else {
    state.sources.push({ type: parsed.type, name: parsed.name, initialBalance: valueToSend, description: `Carryover gabungan dari TA ${yr}`, active: 'Aktif', year: yearStr });
  }

  localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(state));
  updateUI();

  if (gasUrl) {
    try {
      const res = await postToGAS({
        action: 'saveSumberDana',
        type: parsed.type,
        name: parsed.name,
        initialBalance: valueToSend,
        description: `Carryover gabungan dari TA ${yr}`,
        year: yearStr
      });
      if (res?.success) {
        showToast(`Berhasil mengirim saldo ke Silpa ${targetCat} TA ${nextYear}!`, 'success');
        await fetchFromGAS();
      } else {
        throw new Error(res?.message || 'Gagal menyimpan ke server');
      }
    } catch (e) {
      showToast('Gagal mengirim ke server: ' + e.message, 'error');
    }
  } else {
    showToast(`Berhasil menyimpan offline sebagai Saldo Awal ${targetCat} TA ${nextYear}!`, 'success');
  }
  showLoading(false);
}

function parseCategory(cat) {
  const match = String(cat).match(/^\[(.*?)\]\s*(.*)$/);
  if (match) {
    return { type: match[1].trim(), name: match[2].trim() };
  }
  return { type: String(cat).trim(), name: String(cat).trim() };
}

function renderRKD() {
  const el = document.getElementById('rkd-list'); if (!el) return; el.innerHTML = '';

  // SiLPA selalu digunakan di RKD, terlepas dari setting APBDes
  const yr = getActiveYear();
  const uniqueCategories = [...new Set((state.sources || []).map(s => `[${s.type}] ${s.name}`))];
  const totalSourcesInit = uniqueCategories.reduce((sum, cat) => {
    const matchYr = (state.sources || []).find(s => matchCategory(cat, s) && String(s.year || '') === yr);
    const matchGlobal = (state.sources || []).find(s => matchCategory(cat, s) && !s.year);
    const src = matchYr || matchGlobal || { initialBalance: 0 };
    return sum + Number(src.initialBalance || 0);
  }, 0);
  const silpa = totalSourcesInit + Number(state.settings?.saldo_lalu || 0);

  const monthFilter = document.getElementById('rkd-month-filter')?.value || 'all';

  // Filter hanya transaksi via bank (Transfer) yang sudah approved
  const bankTrxAll = [...getActiveApbdesTrx()]
    .filter(t => (t.payMethod || '').trim().toLowerCase() === 'transfer' && isApproved(t))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  let prevMonthTrx = [];
  let currentMonthTrx = bankTrxAll;

  if (monthFilter !== 'all') {
    prevMonthTrx = bankTrxAll.filter(t => {
      const parts = String(t.date || '').split('-');
      if (parts.length >= 2) return Number(parts[1]) < Number(monthFilter);
      return false;
    });
    currentMonthTrx = bankTrxAll.filter(t => {
      const parts = String(t.date || '').split('-');
      if (parts.length >= 2) return parts[1] === monthFilter;
      return false;
    });
  }

  const prevDebet = prevMonthTrx.filter(t => isPemasukan(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
  const prevKredit = prevMonthTrx.filter(t => isPengeluaran(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
  const saldoBerjalanAwal = silpa + prevDebet - prevKredit;

  const debetBulanIni = currentMonthTrx.filter(t => isPemasukan(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
  const kreditBulanIni = currentMonthTrx.filter(t => isPengeluaran(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
  setText('rkd-debet', formatIDR(saldoBerjalanAwal + debetBulanIni));
  setText('rkd-kredit', formatIDR(kreditBulanIni));
  setText('rkd-saldo', formatIDR(saldoBerjalanAwal + debetBulanIni - kreditBulanIni));

  // Baris pertama: Saldo Awal (SiLPA atau Pindahan)
  const rowSilpa = document.createElement('tr');
  rowSilpa.style.cssText = 'background:var(--primary-light);font-style:italic';
  rowSilpa.innerHTML = `
    <td style="color:var(--text-muted);font-size:0.75rem">-</td>
    <td>-</td>
    <td style="font-weight:600;color:var(--primary)">${monthFilter === 'all' ? 'Saldo Awal (SiLPA)' : 'Saldo Pindahan Bulan Sebelumnya'}</td>
    <td>-</td>
    <td class="txt-success" style="font-weight:700">${formatIDR(saldoBerjalanAwal)}</td>
    <td>-</td>
    <td style="font-weight:800;color:var(--primary)">${formatIDR(saldoBerjalanAwal)}</td>`;
  el.appendChild(rowSilpa);

  if (!currentMonthTrx.length) {
    const rowEmpty = document.createElement('tr');
    rowEmpty.innerHTML = '<td colspan="7" class="empty-state"><p>Belum ada transaksi bank di periode ini</p></td>';
    el.appendChild(rowEmpty);
    return;
  }

  // Group pengeluaran (kredit) dengan tanggal dan sumber dana yang sama (Subtotal)
  const groupedBankTrx = [];
  const creditGroups = {};

  currentMonthTrx.forEach(t => {
    if (t.type === 'pengeluaran') {
      const key = `${t.date}_${t.category}`;
      if (!creditGroups[key]) {
        creditGroups[key] = { ...t, desc: t.desc, amount: Number(t.amount || 0) };
        groupedBankTrx.push(creditGroups[key]);
      } else {
        creditGroups[key].amount += Number(t.amount || 0);
        creditGroups[key].desc += ', ' + t.desc;
      }
    } else {
      groupedBankTrx.push(t);
    }
  });

  groupedBankTrx.sort((a, b) => new Date(a.date) - new Date(b.date));

  let saldoBerjalan = saldoBerjalanAwal;
  groupedBankTrx.forEach((t, i) => {
    const isDebet = t.type === 'pemasukan';
    if (isDebet) saldoBerjalan += Number(t.amount || 0);
    else saldoBerjalan -= Number(t.amount || 0);

    const r = document.createElement('tr');
    r.innerHTML = `
      <td style="color:var(--text-muted);font-size:0.75rem">${i + 1}</td>
      <td>${fmtDate(t.date)}</td>
      <td>${t.desc}</td>
      <td><span style="font-size:0.7rem;font-weight:600;color:var(--primary)">${t.category || '-'}</span></td>
      <td class="txt-success" style="font-weight:700">${isDebet ? formatIDR(t.amount) : '-'}</td>
      <td class="txt-danger"  style="font-weight:700">${!isDebet ? formatIDR(t.amount) : '-'}</td>
      <td style="font-weight:800;color:${saldoBerjalan >= 0 ? 'var(--primary)' : 'var(--danger)'}">${formatIDR(saldoBerjalan)}</td>`;
    el.appendChild(r);
  });
}

// ─── ACTIONS ───────────────────────────────────────────────────
async function saveTransaction() {
  const isSimulasi = document.getElementById('trx-is-simulasi')?.checked || false;

  const data = {
    type: document.getElementById('trx-type').value,
    date: document.getElementById('trx-date').value,
    category: document.getElementById('trx-category').value,
    subCategory: '',
    amount: parseFloat(document.getElementById('trx-amount').value),
    desc: document.getElementById('trx-desc').value,
    payMethod: document.getElementById('trx-pay-method')?.value || 'Transfer',
    notes: document.getElementById('trx-notes')?.value || '',
    user: document.getElementById('user-name')?.innerText.toLowerCase() || 'web'
  };
  const currentUserName = data.user;

  if (!data.amount || !data.desc) { showToast('Isi jumlah dan deskripsi!', 'error'); return; }

  // Budget Validation — SiLPA hanya dipakai jika APBDes = Perubahan
  if (data.type === 'pengeluaran' && data.category) {
    const isPerubahan = (state.settings?.APBDes || 'Awal') === 'Perubahan';
    const totalBudget = isPerubahan
      ? (state.sources || []).filter(s => matchCategory(data.category, s) && String(s.year || '') === getActiveYear()).reduce((sum, s) => sum + Number(s.initialBalance || 0), 0)
      : 0;
    const activeTrx = getActiveTrx();
    const totalSpent = activeTrx.filter(t => t.category === data.category && t.type === 'pengeluaran' && t.status !== 'rejected').reduce((sum, t) => sum + Number(t.amount || 0), 0);
    // Hitung pemasukan untuk sumber dana ini sebagai batas alternatif
    const totalIncome = activeTrx.filter(t => t.category === data.category && t.type === 'pemasukan' && isApproved(t)).reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const remaining = (totalBudget + totalIncome) - totalSpent;

    if (totalBudget === 0 && totalIncome === 0) {
      showToast(`Error: Belum ada anggaran/pemasukan untuk ${data.category}. Transaksi ditolak.`, 'error');
      return;
    } else if (data.amount > remaining) {
      showToast(`Warning: Saldo ${data.category} tidak mencukupi! Sisa: ${formatIDR(remaining)}`, 'error');
      return;
    }
  }

  if (isSimulasi) {
    const tempId = 'TRX-SIM-' + Date.now();
    const simData = { ...data, id: tempId, status: 'simulation' };
    state.simulations = state.simulations || [];
    state.simulations.unshift(simData);

    const envKey = STATE_CACHE_KEY + '_' + (state.env?.active || 'PROD');
    localStorage.setItem(envKey, JSON.stringify(state));
    updateUI();
    showToast('Draf simulasi pengeluaran berhasil disimpan!', 'warning');
    closeModal('modal-transaksi');
    return;
  }

  // Optimistic UI Update
  const isAdmin = currentUserName === 'admin';
  const initialStatus = (isAdmin || data.type === 'pemasukan' || data.amount < (state.config?.BATAS_APPROVAL || 5000000)) ? 'approved' : 'pending';

  const tempId = 'TRX-TEMP-' + Date.now();
  const optimisticData = { ...data, id: tempId, status: initialStatus };
  state.transactions.unshift(optimisticData);
  const envKey = STATE_CACHE_KEY + '_' + (state.env?.active || 'PROD');
  localStorage.setItem(envKey, JSON.stringify(state));
  updateUI();

  if (gasUrl) {
    postToGAS({ action: 'saveTransaction', data }).then(res => {
      if (res?.success && !res.offline) {
        showToast('Transaksi tersinkronisasi ke server!', 'success');
        // Optionally refresh data if you want the real server ID
        // fetchFromGAS(); 
      }
    });
  } else {
    showToast('Tersimpan (mode lokal)', 'success');
  }

  closeModal('modal-transaksi');
}


async function processApproval(id, status) {
  // Show Loading Spinner on the item
  const btnContainer = document.getElementById(`approval-btns-${id}`);
  if (btnContainer) {
    btnContainer.innerHTML = '<div class="spinner" style="width:20px;height:20px;border-width:2.5px;"></div>';
  }

  if (gasUrl) {
    const res = await postToGAS({ action: 'updateApproval', id, status });
    if (res?.success && !res.offline) {
      showToast('Status diperbarui di server!', 'success');
    } else if (res?.offline) {
      showToast('Status disimpan offline!', 'info');
    }
  } else {
    // Simulasi delay untuk mode lokal agar loading terlihat
    await new Promise(r => setTimeout(r, 600));
    showToast('Status diperbarui (lokal)', 'success');
  }

  // Final UI Update
  const t = state.transactions.find(tx => tx.id === id);
  if (t) {
    t.status = status;
    localStorage.setItem(STATE_CACHE_KEY + '_' + (state.env?.active || 'PROD'), JSON.stringify(state));
    updateUI();
  }
}

async function confirmDelete(id) {
  // Cek jika ini transaksi simulasi
  const isSim = (state.simulations || []).some(t => t.id === id);
  if (isSim) {
    if (confirm('Hapus draf simulasi pengeluaran ini?')) {
      hapusSimulasi(id);
    }
    return;
  }

  const trx = state.transactions.find(t => t.id === id);
  if (!trx) return;

  const notes = trx.notes || '';
  if (notes.startsWith('LINKED_SETOR_RKD:')) {
    const linkId = notes.split(':')[1];
    const linkedTrxs = state.transactions.filter(t => (t.notes || '').startsWith('LINKED_SETOR_RKD:' + linkId));

    const confirmMsg = `Transaksi ini merupakan bagian dari setoran sisa Non-APBDes ke RKD.\nMenghapus transaksi ini akan secara otomatis MENGHAPUS kedua pasangan transaksinya:\n` +
      `- Pengeluaran Non-APBDes\n- Pemasukan APBDes\nAgar pembukuan Anda tetap seimbang.\n\nApakah Anda yakin ingin melanjutkan?`;

    if (!confirm(confirmMsg)) return;

    showLoading(true);
    try {
      const idsToDelete = linkedTrxs.map(t => t.id);
      state.transactions = state.transactions.filter(t => !idsToDelete.includes(t.id));
      localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(state));
      updateUI();

      if (gasUrl) {
        for (const tid of idsToDelete) {
          await postToGAS({ action: 'deleteTransaction', id: tid });
        }
        showToast('Kedua transaksi setoran berhasil dihapus!', 'success');
      } else {
        showToast('Kedua transaksi setoran dihapus (lokal)', 'success');
      }
    } catch (e) {
      showToast('Gagal menghapus: ' + e.message, 'error');
    } finally {
      showLoading(false);
    }
    return;
  }

  if (!confirm('Hapus transaksi ' + id + '?')) return;

  // Optimistic UI Update
  state.transactions = state.transactions.filter(t => t.id !== id);
  localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(state));
  updateUI();

  if (gasUrl) {
    postToGAS({ action: 'deleteTransaction', id });
    showToast('Dihapus!', 'success');
  } else {
    showToast('Dihapus (lokal)', 'success');
  }
}


async function addSource() {
  const type = document.getElementById('set-source-type').value;
  const name = document.getElementById('set-source-name').value;
  const init = parseFloat(document.getElementById('set-source-init').value) || 0;
  const yearInput = document.getElementById('set-source-year')?.value || '';

  if (!name) { showToast('Nama rincian wajib diisi!', 'error'); return; }

  // Optimistic UI Update (Check for existing first)
  const yearStr = yearInput ? String(yearInput).trim() : '';
  const existingIdx = state.sources.findIndex(s => s.type === type && s.name === name && String(s.year || '') === yearStr);
  if (existingIdx !== -1) {
    state.sources[existingIdx].initialBalance = init;
  } else {
    state.sources.push({ type, name, initialBalance: init, description: '', active: 'Aktif', year: yearStr });
  }

  localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(state));
  updateUI();

  if (gasUrl) {
    postToGAS({ action: 'saveSumberDana', type, name, initialBalance: init, description: '', year: yearStr });
  }

  document.getElementById('set-source-name').value = '';
  document.getElementById('set-source-init').value = '';
  if (document.getElementById('set-source-year')) document.getElementById('set-source-year').value = '';
  showToast(existingIdx !== -1 ? 'Silpa diperbarui!' : 'Silpa ditambahkan!', 'success');
}

async function deleteSource(type, name, year) {
  const yrStr = year ? String(year).trim() : '';
  const label = yrStr ? `[${type}] ${name} (${yrStr})` : `[${type}] ${name}`;
  if (!confirm(`Hapus Silpa ${label}? Semua transaksi terkait tetap ada namun pagu akan hilang.`)) return;

  // Optimistic UI Update
  state.sources = state.sources.filter(s => !(s.type === type && s.name === name && String(s.year || '') === yrStr));
  localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(state));
  updateUI();

  if (gasUrl) {
    postToGAS({ action: 'deleteSumberDana', type, name, year: yrStr });
    showToast('Dihapus!', 'success');
  } else {
    showToast('Dihapus (lokal)', 'success');
  }
}

function openEditSource(type, name, year) {
  const yrStr = year ? String(year).trim() : '';
  const src = state.sources.find(s => s.type === type && s.name === name && String(s.year || '') === yrStr);
  if (!src) return;
  document.getElementById('edit-source-old-type').value = src.type;
  document.getElementById('edit-source-old-name').value = src.name;
  document.getElementById('edit-source-old-year').value = src.year || '';
  document.getElementById('edit-source-type').value = src.type;
  document.getElementById('edit-source-name').value = src.name;
  document.getElementById('edit-source-init').value = src.initialBalance;
  document.getElementById('edit-source-year').value = src.year || '';
  document.getElementById('edit-source-desc').value = src.description || '';
  openModal('modal-edit-source');
}

async function saveEditedSource() {
  const oldType = document.getElementById('edit-source-old-type').value;
  const oldName = document.getElementById('edit-source-old-name').value;
  const oldYear = document.getElementById('edit-source-old-year').value;
  const newType = document.getElementById('edit-source-type').value;
  const newName = document.getElementById('edit-source-name').value;
  const newYear = document.getElementById('edit-source-year').value;
  const init = parseFloat(document.getElementById('edit-source-init').value) || 0;
  const desc = document.getElementById('edit-source-desc').value;

  if (gasUrl) {
    showLoading(true);
    const res = await postToGAS({
      action: 'editSumberDana',
      oldType, oldName, oldYear,
      newType, newName, newYear,
      initialBalance: init,
      description: desc
    });
    showLoading(false);
    if (res?.success) { showToast('Silpa diperbarui!', 'success'); await fetchFromGAS(); }
    else showToast('Gagal memperbarui Silpa', 'error');

  } else {
    const idx = state.sources.findIndex(s => s.type === oldType && s.name === oldName && String(s.year || '') === String(oldYear));
    if (idx !== -1) {
      const oldLabel = `[${oldType}] ${oldName}`;
      const newLabel = `[${newType}] ${newName}`;
      state.sources[idx] = { type: newType, name: newName, initialBalance: init, description: desc, active: 'Aktif', year: newYear };
      // Local cascade
      state.transactions.forEach(t => { if (t.category === oldLabel) t.category = newLabel; });
      showToast('Silpa diperbarui (lokal)', 'success');
      updateUI();
    }
  }
  closeModal('modal-edit-source');
}

function renderSettingsSources() {
  const el = document.getElementById('settings-source-list'); if (!el) return; el.innerHTML = '';

  const yr = getActiveYear();
  const hasCurrentYearSilpa = (state.sources || []).some(s => String(s.year || '') === yr);
  const importContainer = document.getElementById('import-silpa-container');
  if (importContainer) {
    if (!hasCurrentYearSilpa) {
      importContainer.innerHTML = `
        <button class="btn btn-outline btn-sm" onclick="importSilpaFromPrevYear()" style="color:#6366f1;border-color:#6366f1;display:inline-flex;align-items:center;gap:6px;font-size:0.75rem;padding:0.3rem 0.6rem">
          <i data-lucide="download" style="width:12px;height:12px"></i> Import dari TA Sebelumnya
        </button>
      `;
    } else {
      importContainer.innerHTML = '';
    }
  }

  const activeSources = (state.sources || []).filter(s => String(s.year || '') === yr || !s.year);
  activeSources.forEach(s => {
    const r = document.createElement('tr');
    r.innerHTML = `
      <td style="font-weight:600">${s.type}</td>
      <td>${s.name}</td>
      <td>${formatIDR(s.initialBalance || 0)}</td>
      <td style="font-size:0.8rem;color:var(--text-muted)">${s.year || 'Global'}</td>
      <td style="display:flex;gap:0.4rem">
        <button class="btn btn-outline btn-sm" onclick="openEditSource('${s.type}','${s.name}','${s.year || ''}')"><i data-lucide="edit-3" style="width:13px;height:13px"></i></button>
        <button class="btn btn-danger btn-sm" onclick="deleteSource('${s.type}','${s.name}','${s.year || ''}')"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
      </td>`;
    el.appendChild(r);
  });
  lucide.createIcons();
}

async function importSilpaFromPrevYear() {
  const yr = getActiveYear();
  const prevYear = Number(yr) - 1;

  if (!confirm(`Import saldo awal tahun anggaran ${yr} dengan menghitung saldo sisa/akhir dari tahun anggaran ${prevYear}?`)) {
    return;
  }

  showLoading(true);

  // 1. Dapatkan transaksi tahun sebelumnya (approved)
  const prevTrx = (state.transactions || []).filter(t => {
    const tYear = getYearFromDateString(t.date);
    return tYear && Number(tYear) === prevYear && isApproved(t);
  });

  // 2. Dapatkan transaksi SEBELUM tahun sebelumnya (untuk menghitung saldo awal tahun sebelumnya)
  const beforePrevTrx = (state.transactions || []).filter(t => {
    const tYear = getYearFromDateString(t.date);
    return tYear && Number(tYear) < prevYear && isApproved(t);
  });

  // Helper kalkulasi sisa akhir prevYear untuk kategori tertentu
  function getPrevYearFinalBalance(categoryName) {
    const matchYr = (state.sources || []).find(s => matchCategory(categoryName, s) && String(s.year || '') === String(prevYear));
    const matchGlobal = (state.sources || []).find(s => matchCategory(categoryName, s) && !s.year);
    const src = matchYr || matchGlobal || { type: '', name: categoryName, initialBalance: 0 };

    const si = prevTrx.filter(t => matchCategory(t.category, categoryName) && isPemasukan(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
    const so = prevTrx.filter(t => matchCategory(t.category, categoryName) && isPengeluaran(t)).reduce((s, t) => s + Number(t.amount || 0), 0);

    const prevInc = beforePrevTrx.filter(t => matchCategory(t.category, categoryName) && isPemasukan(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
    const prevExp = beforePrevTrx.filter(t => matchCategory(t.category, categoryName) && isPengeluaran(t)).reduce((s, t) => s + Number(t.amount || 0), 0);

    return Number(src.initialBalance || 0) + prevInc - prevExp + si - so;
  }

  // 3. Temukan semua kategori unik dari prevYear (dari master sources atau dari transaksi prevYear)
  const prevCategories = new Set();
  (state.sources || []).forEach(s => {
    if (String(s.year || '') === String(prevYear) || !s.year) {
      prevCategories.add(`[${s.type}] ${s.name}`);
    }
  });
  prevTrx.forEach(t => {
    if (t.category) prevCategories.add(t.category);
  });

  const categoriesArray = [...prevCategories];
  if (categoriesArray.length === 0) {
    showToast(`Tidak ditemukan data/transaksi di tahun ${prevYear} untuk di-import.`, 'info');
    showLoading(false);
    return;
  }

  // 4. Hitung & terapkan regulasi khusus
  // DD Earmark & DD NonEarmark digabung ke DD NonEarmark
  // ADD Siltap & ADD Operasional digabung ke ADD Operasional
  const finalBalances = {};
  categoriesArray.forEach(cat => {
    finalBalances[cat] = getPrevYearFinalBalance(cat);
  });

  const importedSources = [];

  // Hitung gabungan regulasi khusus
  const earmarkKeys = Object.keys(finalBalances).filter(k => k.replace(/\s+/g, '').toLowerCase().includes('earmark') && !k.replace(/\s+/g, '').toLowerCase().includes('non'));
  const nonEarmarkKeys = Object.keys(finalBalances).filter(k => k.replace(/\s+/g, '').toLowerCase().includes('nonearmark'));
  const siltapKeys = Object.keys(finalBalances).filter(k => k.replace(/\s+/g, '').toLowerCase().includes('siltap'));
  const operasionalKeys = Object.keys(finalBalances).filter(k => k.replace(/\s+/g, '').toLowerCase().includes('add') && k.replace(/\s+/g, '').toLowerCase().includes('operasional'));

  const totalDDBalance = earmarkKeys.reduce((s, k) => s + finalBalances[k], 0) + nonEarmarkKeys.reduce((s, k) => s + finalBalances[k], 0);
  const totalADDBalance = siltapKeys.reduce((s, k) => s + finalBalances[k], 0) + operasionalKeys.reduce((s, k) => s + finalBalances[k], 0);

  // Proses semua kategori
  const processedCats = new Set();

  if (earmarkKeys.length > 0 || nonEarmarkKeys.length > 0) {
    importedSources.push({ type: 'DD', name: 'NonEarmark', initialBalance: totalDDBalance, description: `Import gabungan dari TA ${prevYear}`, active: 'Aktif', year: String(yr) });
    earmarkKeys.forEach(k => processedCats.add(k));
    nonEarmarkKeys.forEach(k => processedCats.add(k));
  }

  if (siltapKeys.length > 0 || operasionalKeys.length > 0) {
    importedSources.push({ type: 'ADD', name: 'Operasional', initialBalance: totalADDBalance, description: `Import gabungan dari TA ${prevYear}`, active: 'Aktif', year: String(yr) });
    siltapKeys.forEach(k => processedCats.add(k));
    operasionalKeys.forEach(k => processedCats.add(k));
  }

  // Proses kategori lainnya yang tidak terkena pengalihan khusus
  categoriesArray.forEach(cat => {
    if (processedCats.has(cat)) return;
    const bal = finalBalances[cat];
    if (bal <= 0) return; // Lewati jika tidak ada saldo sisa
    const parsed = parseCategory(cat);
    importedSources.push({ type: parsed.type, name: parsed.name, initialBalance: bal, description: `Import dari TA ${prevYear}`, active: 'Aktif', year: String(yr) });
  });

  if (importedSources.length === 0) {
    showToast(`Seluruh sisa saldo tahun ${prevYear} bernilai Rp 0. Tidak ada yang perlu di-import.`, 'info');
    showLoading(false);
    return;
  }

  // 5. Simpan ke state dan server
  // Bersihkan entry yr yang lama (jika ada) dan gabungkan dengan yang baru di-import
  state.sources = state.sources.filter(s => String(s.year || '') !== String(yr));
  state.sources.push(...importedSources);
  localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(state));
  updateUI();

  if (gasUrl) {
    try {
      for (const src of importedSources) {
        await postToGAS({
          action: 'saveSumberDana',
          type: src.type,
          name: src.name,
          initialBalance: src.initialBalance,
          description: src.description,
          year: src.year
        });
      }
      showToast(`Berhasil meng-import ${importedSources.length} Silpa dari TA ${prevYear}!`, 'success');
      await fetchFromGAS();
    } catch (e) {
      showToast('Sinkronisasi server gagal: ' + e.message, 'error');
    }
  } else {
    showToast(`Berhasil meng-import ${importedSources.length} Silpa secara offline!`, 'success');
  }
  showLoading(false);
}





function populateReferenceDropdowns() {
  const refs = state.references || [];
  ['set-source-type', 'edit-source-type'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      const v = el.value;
      el.innerHTML = refs.map(t => `<option value="${t}">${t}</option>`).join('');
      if (v) el.value = v;
    }
  });
}

function renderSettingsReferences() {
  const el = document.getElementById('set-ref-list');
  if (!el) return;
  el.innerHTML = '';

  const refs = state.references || [];
  if (refs.length === 0) {
    el.innerHTML = '<span style="font-size:0.8rem;color:var(--text-muted)">Belum ada referensi sumber dana.</span>';
    return;
  }

  refs.forEach(ref => {
    const tag = document.createElement('div');
    tag.style.cssText = 'background:var(--primary-light);color:var(--primary);padding:0.3rem 0.6rem;border-radius:20px;font-size:0.75rem;font-weight:700;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--primary-glow);';
    tag.innerHTML = `
      <span>${ref}</span>
      <button onclick="deleteCustomReferensi('${ref}')" style="background:transparent;border:none;color:var(--primary);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;padding:0;font-size:0.95rem;line-height:1;" title="Hapus kategori">
        <i data-lucide="x" style="width:12px;height:12px"></i>
      </button>
    `;
    el.appendChild(tag);
  });
  lucide.createIcons();
}

async function addCustomReferensi() {
  const nameInput = document.getElementById('set-ref-name');
  if (!nameInput) return;
  const name = nameInput.value.trim();
  if (!name) { showToast('Nama kategori tidak boleh kosong!', 'error'); return; }

  if ((state.references || []).includes(name)) {
    showToast('Kategori tersebut sudah ada!', 'error');
    return;
  }

  // Optimistic UI
  if (!state.references) state.references = [];
  state.references.push(name);
  const envKey = STATE_CACHE_KEY + '_' + (state.env?.active || 'PROD');
  localStorage.setItem(envKey, JSON.stringify(state));
  updateUI();
  nameInput.value = '';

  if (gasUrl) {
    showLoading(true);
    try {
      const res = await postToGAS({ action: 'saveReferensi', name });
      if (res?.success) {
        showToast('Kategori referensi berhasil ditambahkan!', 'success');
        await fetchFromGAS();
      } else {
        throw new Error(res?.message || 'Gagal menyimpan ke server');
      }
    } catch (e) {
      showToast(e.message, 'error');
    }
    showLoading(false);
  } else {
    showToast('Kategori referensi ditambahkan (lokal)', 'success');
  }
}

async function deleteCustomReferensi(name) {
  if (['DD Earmark', 'DD NonEarmark', 'ADD Siltap', 'ADD Operasional', 'PAD', 'DLL', 'BHPR'].includes(name)) {
    if (!confirm(`Kategori "${name}" adalah kategori sistem bawaan.\nApakah Anda benar-benar yakin ingin menghapusnya? Tindakan ini bisa merusak konsistensi data default.`)) return;
  } else {
    if (!confirm(`Hapus kategori utama "${name}"?`)) return;
  }

  // Optimistic UI
  state.references = (state.references || []).filter(r => r !== name);
  const envKey = STATE_CACHE_KEY + '_' + (state.env?.active || 'PROD');
  localStorage.setItem(envKey, JSON.stringify(state));
  updateUI();

  if (gasUrl) {
    showLoading(true);
    try {
      const res = await postToGAS({ action: 'deleteReferensi', name });
      if (res?.success) {
        showToast('Kategori referensi berhasil dihapus!', 'success');
        await fetchFromGAS();
      } else {
        throw new Error(res?.message || 'Gagal menghapus di server');
      }
    } catch (e) {
      showToast(e.message, 'error');
    }
    showLoading(false);
  } else {
    showToast('Kategori referensi dihapus (lokal)', 'success');
  }
}

function populateDropdowns() {

  const s1 = document.getElementById('trx-category');
  if (s1) {
    const v = s1.value;
    s1.innerHTML = '<option value="">-- Pilih Sumber Dana --</option>';
    (state.references || []).forEach(t => {
      const o = document.createElement('option');
      o.value = t; o.text = t;
      s1.add(o);
    });
    if (v) s1.value = v;
  }
}

// ─── NAV / UI ──────────────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page-content').forEach(p => p.style.display = 'none');
  const p = document.getElementById('page-' + id); if (p) p.style.display = 'block';
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const n = document.getElementById('nav-' + id); if (n) n.classList.add('active');
  if (window.innerWidth <= 1024) document.getElementById('sidebar').classList.remove('active');
}
function openModal(id, isSimulation = false) {
  document.getElementById(id).style.display = 'flex';
  if (id === 'modal-transaksi') {
    populateDropdowns();
    updateModalBudgetInfo();

    const titleEl = document.getElementById('modal-transaksi-title');
    const cbContainer = document.getElementById('trx-is-simulasi-container');
    const cb = document.getElementById('trx-is-simulasi');

    if (isSimulation) {
      if (titleEl) titleEl.textContent = 'Transaksi Baru (Simulasi)';
      if (cbContainer) cbContainer.style.display = 'flex';
      if (cb) cb.checked = true;
    } else {
      if (titleEl) titleEl.textContent = 'Transaksi Baru';
      if (cbContainer) cbContainer.style.display = 'none';
      if (cb) cb.checked = false;
    }
  }
}
function closeModal(id) {
  document.getElementById(id).style.display = 'none';
  if (id === 'modal-transaksi') resetFormTransaksi();
}
function resetFormTransaksi() {
  document.getElementById('trx-type').value = 'pengeluaran';
  document.getElementById('trx-date').value = '';
  const cat = document.getElementById('trx-category');
  if (cat) {
    cat.value = '';
    cat.disabled = false;
  }
  document.getElementById('trx-amount').value = '';
  document.getElementById('trx-desc').value = '';
  const pm = document.getElementById('trx-pay-method');
  if (pm) pm.value = 'Transfer';
  const notes = document.getElementById('trx-notes');
  if (notes) notes.value = '';
}
function openSettings() { openModal('modal-settings'); }
function showLoading(s) { document.getElementById('loading').style.display = s ? 'flex' : 'none'; }
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('active'); }

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? '' : 'dark');
  localStorage.setItem('kas_desa_theme', isDark ? 'light' : 'dark');
  updateThemeIcon();
}
function updateThemeIcon() {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.innerHTML = isDark ? '<i data-lucide="sun"></i>' : '<i data-lucide="moon"></i>';
  lucide.createIcons();
}

function handleSearch(val) {
  const q = val.toLowerCase();
  const rows = document.querySelectorAll('#full-transactions-list tr');
  rows.forEach(r => { r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none'; });
}

// ─── CHARTS ────────────────────────────────────────────────────
function initCharts() {
  const c1 = document.getElementById('cashflowChart'); if (!c1) return;
  if (cashflowChart) cashflowChart.destroy(); if (categoryChart) categoryChart.destroy();
  const activeTrx = getActiveApbdesTrx();
  const dates = []; for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); dates.push(d.toISOString().split('T')[0]); }
  const iD = dates.map(d => activeTrx.filter(t => (t.date || '').includes(d) && t.type === 'pemasukan' && isApproved(t)).reduce((s, t) => s + (t.amount || 0), 0));
  const eD = dates.map(d => activeTrx.filter(t => (t.date || '').includes(d) && t.type === 'pengeluaran' && isApproved(t)).reduce((s, t) => s + (t.amount || 0), 0));
  cashflowChart = new Chart(c1.getContext('2d'), {
    type: 'line', data: {
      labels: dates.map(d => d.split('-')[2] + '/' + d.split('-')[1]), datasets: [
        { label: 'Pemasukan', data: iD, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#10b981' },
        { label: 'Pengeluaran', data: eD, borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.08)', fill: true, tension: 0.4, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: '#ef4444' }
      ]
    }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { usePointStyle: true, padding: 16 } } }, scales: { y: { beginAtZero: true, grid: { color: '#f1f5f9' } }, x: { grid: { display: false } } } }
  });

  const c2 = document.getElementById('categoryChart'); if (!c2) return;
  const cl = [...new Set(activeTrx.filter(t => t.type === 'pengeluaran' && isApproved(t)).map(t => t.category))];
  const cd = cl.map(c => activeTrx.filter(t => t.category === c && t.type === 'pengeluaran' && isApproved(t)).reduce((s, t) => s + (t.amount || 0), 0));
  categoryChart = new Chart(c2.getContext('2d'), { type: 'doughnut', data: { labels: cl.length ? cl : ['Belum ada'], datasets: [{ data: cd.length ? cd : [1], backgroundColor: cl.length ? ['#6366f1', '#3b82f6', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6'] : ['#e2e8f0'], borderWidth: 0 }] }, options: { responsive: true, cutout: '70%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, padding: 10, font: { size: 10 } } } } } });
}

// ─── TOAST & HELPERS ───────────────────────────────────────────
function showToast(msg, type = 'info') {
  let c = document.querySelector('.toast-container');
  if (!c) { c = document.createElement('div'); c.className = 'toast-container'; document.body.appendChild(c); }
  const t = document.createElement('div'); t.className = 'toast ' + type;
  const ic = { success: 'check-circle', error: 'alert-circle', info: 'info' };
  t.innerHTML = `<i data-lucide="${ic[type] || 'info'}" style="width:16px;height:16px"></i> ${msg}`;
  c.appendChild(t); lucide.createIcons();
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(100px)'; setTimeout(() => t.remove(), 300); }, 3500);
}
function formatIDR(a) { return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(a || 0); }
function fmtDate(d) { try { return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return d; } }
function setText(id, v) { const e = document.getElementById(id); if (e) e.innerText = v; }
function isApproved(t) {
  const s = (t.status || '').trim().toLowerCase();
  if (s === 'simulation') return state.isSimulationModeActive;
  return s === 'approved' || s === '';
}
function isPemasukan(t) { return (t.type || '').trim().toLowerCase() === 'pemasukan'; }
function isPengeluaran(t) { return (t.type || '').trim().toLowerCase() === 'pengeluaran'; }

function isNonApbdesTrx(t) {
  if (!t || !t.category) return false;
  const cat = String(t.category).trim().toLowerCase();
  return cat.includes('non-apbdes') || cat.includes('non apbdes');
}

function getActiveApbdesTrx() {
  return getActiveTrx().filter(t => !isNonApbdesTrx(t));
}

function openModalNonApbdes() {
  openModal('modal-transaksi');
  const catSelect = document.getElementById('trx-category');
  if (catSelect) {
    catSelect.value = 'Non-APBDes';
    // If Non-APBDes isn't in references, add it on the fly
    if (catSelect.value !== 'Non-APBDes') {
      const opt = document.createElement('option');
      opt.value = 'Non-APBDes';
      opt.text = 'Non-APBDes';
      catSelect.add(opt);
      catSelect.value = 'Non-APBDes';
    }
    catSelect.disabled = true; // lock it
  }
}

function openModalSetorRKD() {
  const trx = getActiveTrx().filter(isNonApbdesTrx);
  const inc = trx.filter(t => isPemasukan(t) && isApproved(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
  const exp = trx.filter(t => isPengeluaran(t) && isApproved(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
  const saldo = inc - exp;

  if (saldo <= 0) {
    showToast('Tidak ada sisa saldo Non-APBDes untuk disetor ke RKD.', 'error');
    return;
  }

  // Populate APBDes Category
  const catSelect = document.getElementById('setor-rkd-category');
  if (catSelect) {
    catSelect.innerHTML = '<option value="">-- Pilih Sumber Dana APBDes --</option>';
    let hasPAD = false;
    (state.references || []).filter(r => r !== 'Non-APBDes').forEach(ref => {
      const opt = document.createElement('option');
      opt.value = ref;
      opt.text = ref;
      catSelect.add(opt);
      if (ref === 'PAD') hasPAD = true;
    });
    if (hasPAD) {
      catSelect.value = 'PAD';
    }
  }

  document.getElementById('setor-rkd-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('setor-rkd-amount').value = saldo;
  document.getElementById('setor-rkd-amount').dataset.max = saldo;
  document.getElementById('setor-rkd-desc').value = 'Setoran sisa Non-APBDes ke RKD';

  openModal('modal-setor-rkd');
}

async function prosesSetorRKD() {
  const date = document.getElementById('setor-rkd-date').value;
  const amount = Number(document.getElementById('setor-rkd-amount').value || 0);
  const maxAvailable = Number(document.getElementById('setor-rkd-amount').dataset.max || 0);
  const categoryTo = document.getElementById('setor-rkd-category').value;
  const desc = document.getElementById('setor-rkd-desc').value.trim();

  if (!date) {
    showToast('Pilih tanggal setoran terlebih dahulu.', 'error');
    return;
  }
  if (!categoryTo) {
    showToast('Pilih sumber dana tujuan RKD terlebih dahulu.', 'error');
    return;
  }
  if (amount <= 0) {
    showToast('Jumlah setor tidak valid.', 'error');
    return;
  }
  if (amount > maxAvailable) {
    showToast(`Jumlah setoran melebihi saldo tersedia (${formatIDR(maxAvailable)}).`, 'error');
    return;
  }

  const confirmMsg = `Anda akan mentransfer sisa Non-APBDes sebesar ${formatIDR(amount)} pada tanggal ${fmtDate(date)} masuk ke RKD (${categoryTo}). Lanjutkan?`;
  if (!confirm(confirmMsg)) return;

  const linkId = 'SETOR-' + Date.now();
  const activeUser = document.getElementById('user-name')?.innerText.toLowerCase() || 'admin';

  // Transaksi 1: Pengeluaran dari Non-APBDes
  const t1 = {
    id: 'TRXN-' + Date.now() + '-OUT',
    date: date,
    type: 'pengeluaran',
    category: 'Non-APBDes',
    desc: desc + ' (Keluar)',
    amount: amount,
    payMethod: 'Transfer',
    status: 'approved',
    user: activeUser,
    notes: 'LINKED_SETOR_RKD:' + linkId
  };

  // Transaksi 2: Pemasukan ke APBDes
  const t2 = {
    id: 'TRX-' + (Date.now() + 1) + '-IN',
    date: date,
    type: 'pemasukan',
    category: categoryTo,
    desc: desc + ' (Masuk dari Non-APBDes)',
    amount: amount,
    payMethod: 'Transfer',
    status: 'approved',
    user: activeUser,
    notes: 'LINKED_SETOR_RKD:' + linkId
  };

  try {
    showLoading(true);
    // Save to local state optimistically
    state.transactions.push(t1, t2);
    localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(state));
    updateUI();

    // Send to server
    if (gasUrl) {
      // Send OUT
      const res1 = await postToGAS({
        action: 'saveTransaction',
        data: t1
      });
      // Send IN
      const res2 = await postToGAS({
        action: 'saveTransaction',
        data: t2
      });

      if (res1?.success && res2?.success) {
        showToast('Berhasil setor sisa Non-APBDes ke RKD.', 'success');
        await fetchFromGAS(); // refresh proper IDs from server
      } else {
        throw new Error('Gagal mencatat transaksi di server.');
      }
    } else {
      addToSyncQueue({ action: 'saveTransaction', data: t1 });
      addToSyncQueue({ action: 'saveTransaction', data: t2 });
      showToast('Setor berhasil disimpan secara offline.', 'success');
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message, 'error');
  } finally {
    showLoading(false);
    closeModal('modal-setor-rkd');
  }
}

function renderNonApbdesPage() {
  const el = document.getElementById('non-apbdes-list');
  if (!el) return;
  el.innerHTML = '';

  const trx = getActiveTrx().filter(isNonApbdesTrx);

  // Calculate Stats
  const inc = trx.filter(t => isPemasukan(t) && isApproved(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
  const exp = trx.filter(t => isPengeluaran(t) && isApproved(t)).reduce((s, t) => s + Number(t.amount || 0), 0);
  const bal = inc - exp;

  setText('stat-non-income', formatIDR(inc));
  setText('stat-non-expense', formatIDR(exp));
  setText('stat-non-balance', formatIDR(bal));

  if (!trx.length) {
    el.innerHTML = '<tr><td colspan="8" class="empty-state"><p>Belum ada transaksi Non-APBDes di tahun ' + getActiveYear() + '</p></td></tr>';
    return;
  }

  trx.forEach(t => {
    const r = document.createElement('tr');
    r.innerHTML = `
      <td><code style="font-size:0.7rem;background:#f1f5f9;padding:2px 5px;border-radius:4px">${t.id}</code></td>
      <td>${fmtDate(t.date)}</td>
      <td><span class="status-badge status-${t.type === 'pemasukan' ? 'approved' : 'rejected'}" style="font-size:0.6rem">${t.type === 'pemasukan' ? 'MASUK' : 'KELUAR'}</span></td>
      <td><span style="font-size:0.75rem;font-weight:600;color:var(--primary)">${t.category || '-'}</span></td>
      <td>${t.desc}</td>
      <td style="font-weight:700;color:${t.type === 'pemasukan' ? 'var(--success)' : 'var(--danger)'}">${t.type === 'pemasukan' ? '+' : '-'} ${formatIDR(t.amount)}</td>
      <td><span class="status-badge status-approved" style="font-size:0.65rem">${t.payMethod || 'Transfer'}</span></td>
      <td><button class="btn btn-outline btn-sm" onclick="confirmDelete('${t.id}')"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button></td>
    `;
    el.appendChild(r);
  });
  lucide.createIcons();
}

async function runDiagnosis() {
  // --- Diagnosa dari state di memori browser (tidak butuh GAS) ---
  const trx = state.transactions || [];
  const pemasukanAll = trx.filter(t => isPemasukan(t));
  const pemasukanApproved = trx.filter(t => isPemasukan(t) && isApproved(t));
  const totalInc = pemasukanApproved.reduce((s, t) => s + Number(t.amount || 0), 0);

  let msg = `=== DIAGNOSA STATE BROWSER ===\n`;
  msg += `Total transaksi: ${trx.length}\n`;
  msg += `Pemasukan (semua): ${pemasukanAll.length}\n`;
  msg += `Pemasukan approved: ${pemasukanApproved.length}\n`;
  msg += `Total inc (approved): ${formatIDR(totalInc)}\n\n`;

  if (trx.length > 0) {
    msg += `=== SAMPLE 5 TRANSAKSI PERTAMA ===\n`;
    trx.slice(0, 5).forEach((t, i) => {
      msg += `[${i + 1}] type="${t.type}" | status="${t.status}" | amount=${t.amount} | category="${t.category}"\n`;
    });
  } else {
    msg += `⚠️ state.transactions KOSONG!\nKemungkinan localStorage belum dimuat atau GAS belum terhubung.\n`;
  }

  // Coba juga GAS jika tersedia
  if (gasUrl) {
    try {
      const r = await fetch(gasUrl + '?action=debugData');
      const d = await r.json();
      if (!d.error) {
        msg += `\n=== DATA MENTAH DARI GOOGLE SHEET (${d.totalRows} baris) ===\n`;
        (d.rawRows || []).forEach(row => {
          msg += `Row ${row.row}: tipe="${row.tipe}" | status="${row.status}" | amount=${row.amount} (${row.amountType})\n`;
        });
      } else {
        msg += `\n⚠️ GAS debug belum ter-deploy (deploy ulang Code.gs terlebih dahulu)\nError: ${d.error}`;
      }
    } catch (e) {
      msg += `\n⚠️ Tidak bisa koneksi ke GAS: ${e.message}`;
    }
  }

  alert(msg);
}

function clearCacheAndReload() {
  if (!confirm('Ini akan menghapus semua data tersimpan di browser (cache lokal) dan memuat ulang halaman. Data GAS tidak terpengaruh. Lanjutkan?')) return;
  // Hapus semua key terkait aplikasi dari localStorage
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('kas_desa_')) localStorage.removeItem(k);
  });
  showToast('Cache berhasil dihapus. Memuat ulang...', 'success');
  setTimeout(() => location.reload(), 800);
}

async function handleResetDatabase() {
  if (!gasUrl) {
    showToast('Harap hubungkan ke GAS terlebih dahulu untuk melakukan reset.', 'error');
    return;
  }

  const confirm1 = confirm('PERINGATAN: Anda akan menghapus SELURUH data transaksi, master silpa, dan kategori. Tindakan ini tidak dapat dibatalkan. Lanjutkan?');
  if (!confirm1) return;

  const confirm2 = confirm('KONFIRMASI TERAKHIR: Seluruh catatan keuangan akan hilang selamanya dari spreadsheet. Benar-benar ingin mereset database?');
  if (!confirm2) return;

  showLoading(true);
  try {
    const res = await postToGAS({ action: 'resetDatabase' });
    if (res?.success) {
      showToast('Database berhasil dikosongkan!', 'success');
      await fetchFromGAS(); // Refresh local state
      closeModal('modal-settings');
    } else {
      showToast('Gagal mereset database: ' + (res?.message || 'Unknown error'), 'error');
    }
  } catch (e) {
    showToast('Terjadi kesalahan: ' + e.message, 'error');
  }
  showLoading(false);
}

// ─── EXPORT TO EXCEL ───────────────────────────────────────────
function exportTableToExcel(tableID, filename = '') {
  if (typeof XLSX === 'undefined') {
    showToast('Library Excel belum dimuat, silakan muat ulang halaman.', 'error');
    return;
  }

  const table = document.getElementById(tableID);
  if (!table) {
    showToast('Data tabel tidak ditemukan', 'error');
    return;
  }

  try {
    const wb = XLSX.utils.table_to_book(table, { sheet: "Laporan", raw: true });
    const dateStr = new Date().toISOString().slice(0, 10);
    const finalFilename = filename ? `${filename}_${dateStr}.xlsx` : `Export_${dateStr}.xlsx`;
    XLSX.writeFile(wb, finalFilename);
    showToast('Berhasil mendownload Excel', 'success');
  } catch (e) {
    showToast('Gagal mendownload: ' + e.message, 'error');
  }
}

async function exportWithTemplate(type) {
  if (typeof ExcelJS === 'undefined') {
    showToast('Library ExcelJS belum dimuat. Silakan muat ulang halaman.', 'error');
    return;
  }

  showLoading(true);
  try {
    const yr = getActiveYear();
    const response = await fetch('Laporan TA 2024.xlsx');
    if (!response.ok) {
      throw new Error('Gagal mengunduh file template Laporan TA 2024.xlsx');
    }
    const arrayBuffer = await response.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);

    // Dapatkan transaksi APBDes tahun aktif yang disetujui, diurutkan berdasarkan tanggal
    const activeTrx = [...getActiveApbdesTrx()]
      .filter(t => isApproved(t))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Hitung Silpa/Saldo Awal dasar
    const uniqueCategories = [...new Set((state.sources || []).map(s => `[${s.type}] ${s.name}`))];
    const totalSourcesInit = uniqueCategories.reduce((sum, cat) => {
      const matchYr = (state.sources || []).find(s => matchCategory(cat, s) && String(s.year || '') === yr);
      const matchGlobal = (state.sources || []).find(s => matchCategory(cat, s) && !s.year);
      const src = matchYr || matchGlobal || { initialBalance: 0 };
      return sum + Number(src.initialBalance || 0);
    }, 0);
    const silpa = totalSourcesInit + Number(state.settings?.saldo_lalu || 0);

    if (type === 'bku') {
      const sheet = workbook.worksheets.find(w => w.name.trim().toUpperCase() === 'BKU');
      if (!sheet) throw new Error('Sheet BKU tidak ditemukan di dalam template.');

      const namaBulanIndo = [
        'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
        'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'
      ];
      const monthKeywords = [
        'JANUARI', 'PEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
        'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOPEMBER', 'DESEMBER'
      ];

      let saldo_awal = silpa;

      for (let m = 1; m <= 12; m++) {
        const keyword = monthKeywords[m - 1];
        let R_title = null;

        for (let r = 1; r <= sheet.rowCount; r++) {
          const cellValue = String(sheet.getRow(r).getCell(1).value || '');
          if (cellValue.includes('BULAN') && (
            cellValue.toUpperCase().includes(keyword) ||
            (keyword === 'PEBRUARI' && cellValue.toUpperCase().includes('FEBRUARI')) ||
            (keyword === 'NOPEMBER' && cellValue.toUpperCase().includes('NOVEMBER'))
          )) {
            R_title = sheet.getRow(r);
            break;
          }
        }

        if (!R_title) continue;

        // Update tahun di judul bulan
        R_title.getCell(1).value = `BULAN   :     ${namaBulanIndo[m - 1]}  ${yr}`;

        // Update tahun di judul BUKU KAS HARIAN di atasnya (biasanya 2 baris di atas)
        const tahunRow = sheet.getRow(R_title.number - 2);
        if (tahunRow && String(tahunRow.getCell(1).value || '').includes('TAHUN')) {
          tahunRow.getCell(1).value = `TAHUN ${yr}`;
        }

        // Cari baris header tabel dengan kata "NO"
        let headerRowIdx = null;
        for (let r = R_title.number + 1; r <= R_title.number + 6; r++) {
          const v = String(sheet.getRow(r).getCell(1).value || '');
          if (v.trim().toUpperCase() === 'NO') {
            headerRowIdx = r;
            break;
          }
        }

        if (!headerRowIdx) continue;

        const saldoAwalRowIdx = headerRowIdx + 1;
        const rowSaldoAwal = sheet.getRow(saldoAwalRowIdx);

        // Update saldo awal
        rowSaldoAwal.getCell(4).value = m === 1 ? `Saldo Silpa Tahun ${yr}` : 'Saldo Pindahan Bulan Sebelumnya';
        rowSaldoAwal.getCell(5).value = saldo_awal;
        rowSaldoAwal.getCell(6).value = null;

        // Cari baris JUMLAH
        let jumlahRowIdx = null;
        for (let r = headerRowIdx + 2; r <= sheet.rowCount; r++) {
          const v = String(sheet.getRow(r).getCell(4).value || '');
          if (v.trim().toUpperCase() === 'JUMLAH') {
            jumlahRowIdx = r;
            break;
          }
        }

        if (!jumlahRowIdx) continue;

        // Ambil transaksi untuk bulan ini
        const monthTrx = activeTrx.filter(t => {
          const parts = String(t.date || '').split('-');
          return parts.length >= 2 && Number(parts[1]) === m;
        });

        const N = monthTrx.length;
        const origCount = jumlahRowIdx - (headerRowIdx + 2);

        // Sesuaikan jumlah baris transaksi
        if (N > origCount) {
          const insertCount = N - origCount;
          for (let i = 0; i < insertCount; i++) {
            sheet.insertRow(jumlahRowIdx, []);
          }
        } else if (N < origCount) {
          const deleteCount = origCount - N;
          sheet.spliceRows(headerRowIdx + 2 + N, deleteCount);
        }

        // Tulis transaksi baru ke baris-baris kosong tersebut
        for (let i = 0; i < N; i++) {
          const t = monthTrx[i];
          const rIdx = headerRowIdx + 2 + i;
          const row = sheet.getRow(rIdx);

          if (rIdx !== headerRowIdx + 2) {
            copyRowStyle(sheet, headerRowIdx + 2, rIdx);
          }

          row.getCell(1).value = i + 1; // NO
          row.getCell(2).value = new Date(t.date); // TGL
          row.getCell(3).value = t.noBukti || t.id || ''; // NO BKT.
          row.getCell(4).value = t.desc || t.uraian || ''; // URAIAN
          row.getCell(5).value = isPemasukan(t) ? Number(t.amount) : null;
          row.getCell(6).value = isPengeluaran(t) ? Number(t.amount) : null;
          row.getCell(7).value = t.category || ''; // SUMBER DANA
          row.getCell(8).value = t.tpk || ''; // TPK
        }

        const newJumlahRowIdx = headerRowIdx + 2 + N;
        const rowJumlah = sheet.getRow(newJumlahRowIdx);
        rowJumlah.getCell(5).value = N > 0 ? { formula: `SUM(E${headerRowIdx + 2}:E${headerRowIdx + 1 + N})` } : 0;
        rowJumlah.getCell(6).value = N > 0 ? { formula: `SUM(F${headerRowIdx + 2}:F${headerRowIdx + 1 + N})` } : 0;

        const newSaldoBulanRowIdx = newJumlahRowIdx + 1;
        const rowSaldoBulan = sheet.getRow(newSaldoBulanRowIdx);
        rowSaldoBulan.getCell(4).value = `Saldo bulan ${namaBulanIndo[m - 1]} ${yr}`;
        rowSaldoBulan.getCell(6).value = { formula: `E${saldoAwalRowIdx}+E${newJumlahRowIdx}-F${newJumlahRowIdx}` };

        // Kalkulasi saldo berjalan numerik untuk bulan berikutnya
        const monthInc = monthTrx.filter(t => isPemasukan(t)).reduce((sum, t) => sum + Number(t.amount || 0), 0);
        const monthExp = monthTrx.filter(t => isPengeluaran(t)).reduce((sum, t) => sum + Number(t.amount || 0), 0);
        saldo_awal = saldo_awal + monthInc - monthExp;

        // Update tanggal penandatanganan jika ada
        let dateRowIdx = null;
        for (let r = newSaldoBulanRowIdx + 1; r <= newSaldoBulanRowIdx + 10; r++) {
          const v = String(sheet.getRow(r).getCell(5).value || '');
          if (v.includes('Patihan,')) {
            dateRowIdx = r;
            break;
          }
        }
        if (dateRowIdx) {
          const lastDay = new Date(Number(yr), m, 0).getDate();
          sheet.getRow(dateRowIdx).getCell(5).value = `Patihan, ${lastDay}   ${namaBulanIndo[m - 1]} ${yr}`;
        }
      }

    } else if (type === 'lpj') {
      const sheet = workbook.worksheets.find(w => w.name.trim().toUpperCase().startsWith('LPJ'));
      if (!sheet) throw new Error('Sheet LPJ tidak ditemukan di dalam template.');

      // Update tahun periode di judul (biasanya di baris 3)
      const titleRow = sheet.getRow(3);
      if (titleRow) {
        titleRow.getCell(1).value = `PERIODE :  1 JANUARI  ${yr}  S/D 31 DESEMBER  ${yr}`;
      }

      // Update Saldo Silpa Row (Row 7)
      const silpaRow = sheet.getRow(7);
      if (silpaRow) {
        silpaRow.getCell(4).value = `Saldo Silpa Tahun ${Number(yr) - 1}`;
        silpaRow.getCell(5).value = silpa;
      }

      // Cari baris JUMLAH untuk Penerimaan (Pemasukan)
      let lpjJumlahIncRowIdx = null;
      for (let r = 8; r <= sheet.rowCount; r++) {
        const v = String(sheet.getRow(r).getCell(4).value || '');
        if (v.trim().toUpperCase() === 'JUMLAH') {
          lpjJumlahIncRowIdx = r;
          break;
        }
      }

      if (!lpjJumlahIncRowIdx) throw new Error('Format baris JUMLAH Penerimaan di sheet LPJ tidak ditemukan.');

      const incTrx = activeTrx.filter(t => isPemasukan(t));
      const N_inc = incTrx.length;
      const origIncCount = lpjJumlahIncRowIdx - 8;

      // Sesuaikan baris untuk Penerimaan
      if (N_inc > origIncCount) {
        const insertCount = N_inc - origIncCount;
        for (let i = 0; i < insertCount; i++) {
          sheet.insertRow(lpjJumlahIncRowIdx, []);
        }
      } else if (N_inc < origIncCount) {
        const deleteCount = origIncCount - N_inc;
        sheet.spliceRows(8 + N_inc, deleteCount);
      }

      // Tulis transaksi Penerimaan
      for (let i = 0; i < N_inc; i++) {
        const t = incTrx[i];
        const rIdx = 8 + i;
        const row = sheet.getRow(rIdx);

        if (rIdx !== 8) {
          copyRowStyle(sheet, 8, rIdx);
        }

        row.getCell(1).value = i + 1;
        row.getCell(2).value = new Date(t.date);
        row.getCell(3).value = t.noBukti || t.id || '';
        row.getCell(4).value = t.desc || t.uraian || '';
        row.getCell(5).value = Number(t.amount);
        row.getCell(6).value = t.category || '';
      }

      const newLpjJumlahIncRowIdx = 8 + N_inc;
      const rowJumlahInc = sheet.getRow(newLpjJumlahIncRowIdx);
      rowJumlahInc.getCell(5).value = N_inc > 0 ? { formula: `SUM(E8:E${8 + N_inc - 1})` } : 0;

      // Cari baris JUMLAH PENGELUARAN secara dinamis
      let lpjJumlahExpRowIdx = null;
      for (let r = newLpjJumlahIncRowIdx + 1; r <= sheet.rowCount; r++) {
        const v = String(sheet.getRow(r).getCell(4).value || '');
        if (v.trim().toUpperCase() === 'JUMLAH PENGELUARAN') {
          lpjJumlahExpRowIdx = r;
          break;
        }
      }

      if (!lpjJumlahExpRowIdx) throw new Error('Format baris JUMLAH PENGELUARAN di sheet LPJ tidak ditemukan.');

      // Cari baris header tabel Pengeluaran (dengan tulisan "NO") di antara newLpjJumlahIncRowIdx dan lpjJumlahExpRowIdx
      let expHeaderRowIdx = null;
      for (let r = newLpjJumlahIncRowIdx + 1; r < lpjJumlahExpRowIdx; r++) {
        const v = String(sheet.getRow(r).getCell(1).value || '');
        if (v.trim().toUpperCase() === 'NO') {
          expHeaderRowIdx = r;
          break;
        }
      }

      if (!expHeaderRowIdx) throw new Error('Header tabel Pengeluaran di sheet LPJ tidak ditemukan.');

      const expTrx = activeTrx.filter(t => isPengeluaran(t));
      const N_exp = expTrx.length;
      const startExpRowIdx = expHeaderRowIdx + 2; // baris data pertama pengeluaran (biasanya expHeaderRowIdx + 1 adalah "BELANJA DLL :")
      const origExpCount = lpjJumlahExpRowIdx - startExpRowIdx;

      // Sesuaikan baris untuk Pengeluaran
      if (N_exp > origExpCount) {
        const insertCount = N_exp - origExpCount;
        for (let i = 0; i < insertCount; i++) {
          sheet.insertRow(lpjJumlahExpRowIdx, []);
        }
      } else if (N_exp < origExpCount) {
        const deleteCount = origExpCount - N_exp;
        sheet.spliceRows(startExpRowIdx + N_exp, deleteCount);
      }

      // Tulis transaksi Pengeluaran
      for (let i = 0; i < N_exp; i++) {
        const t = expTrx[i];
        const rIdx = startExpRowIdx + i;
        const row = sheet.getRow(rIdx);

        if (rIdx !== startExpRowIdx) {
          copyRowStyle(sheet, startExpRowIdx, rIdx);
        }

        row.getCell(1).value = i + 1;
        row.getCell(2).value = new Date(t.date);
        row.getCell(3).value = t.noBukti || t.id || '';
        row.getCell(4).value = t.desc || t.uraian || '';
        row.getCell(5).value = Number(t.amount);
        row.getCell(6).value = t.category || '';
      }

      const newLpjJumlahExpRowIdx = startExpRowIdx + N_exp;
      const rowJumlahExp = sheet.getRow(newLpjJumlahExpRowIdx);
      rowJumlahExp.getCell(5).value = N_exp > 0 ? { formula: `SUM(E${startExpRowIdx}:E${startExpRowIdx + N_exp - 1})` } : 0;

      const saldoRowIdx = newLpjJumlahExpRowIdx + 1;
      const rowSaldo = sheet.getRow(saldoRowIdx);
      rowSaldo.getCell(5).value = { formula: `E7+E${newLpjJumlahIncRowIdx}-E${newLpjJumlahExpRowIdx}` };

      // Update tanggal penandatanganan jika ada
      let dateRowIdx = null;
      for (let r = saldoRowIdx + 1; r <= saldoRowIdx + 10; r++) {
        const v = String(sheet.getRow(r).getCell(5).value || '');
        if (v.includes('Patihan,')) {
          dateRowIdx = r;
          break;
        }
      }
      if (dateRowIdx) {
        sheet.getRow(dateRowIdx).getCell(5).value = `Patihan, 31 Desember  ${yr}`;
      }
    }

    // Write and download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Laporan TA ${yr}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Berhasil mengunduh Excel menggunakan template', 'success');

  } catch (e) {
    console.error(e);
    showToast('Gagal memproses template: ' + e.message, 'error');
  }
  showLoading(false);
}

// Fungsi helper untuk menyalin style baris secara mendalam (cell-by-cell)
function copyRowStyle(sheet, fromRowIdx, toRowIdx) {
  const fromRow = sheet.getRow(fromRowIdx);
  const toRow = sheet.getRow(toRowIdx);
  toRow.height = fromRow.height;
  for (let c = 1; c <= 15; c++) {
    const fromCell = fromRow.getCell(c);
    const toCell = toRow.getCell(c);
    toCell.style = fromCell.style;
  }
}

// ─── SIMULATION SANDBOX HANDLERS ────────────────────────────────
function toggleSimulationMode() {
  state.isSimulationModeActive = !state.isSimulationModeActive;
  updateUI();

  if (state.isSimulationModeActive) {
    showToast('Mode Simulasi AKTIF! Menampilkan proyeksi anggaran.', 'warning');
  } else {
    showToast('Mode Simulasi MATI. Kembali ke data riil.', 'info');
  }
}

function updateSimulationModeUI() {
  const statusEl = document.getElementById('simulation-toggle-status');
  const containerEl = document.getElementById('simulation-toggle-container');
  if (!statusEl || !containerEl) return;

  if (state.isSimulationModeActive) {
    statusEl.textContent = 'AKTIF';
    containerEl.classList.add('active');
    document.querySelectorAll('.stat-card, .chart-container, .allocation-card').forEach(el => {
      el.classList.add('simulation-active-border');
    });

    let badge = document.getElementById('dashboard-simulation-badge');
    if (!badge) {
      const headerTitle = document.querySelector('#page-dashboard .page-header-title');
      if (headerTitle) {
        badge = document.createElement('div');
        badge.id = 'dashboard-simulation-badge';
        badge.className = 'simulation-active-badge';
        badge.innerText = '⚠️ Mode Proyeksi Simulasi Aktif';
        headerTitle.appendChild(badge);
      }
    }
  } else {
    statusEl.textContent = 'MATI';
    containerEl.classList.remove('active');
    document.querySelectorAll('.stat-card, .chart-container, .allocation-card').forEach(el => {
      el.classList.remove('simulation-active-border');
    });
    const badge = document.getElementById('dashboard-simulation-badge');
    if (badge) badge.remove();
  }

  // Update sidebar badge
  const badgeSim = document.getElementById('badge-simulasi');
  if (badgeSim) {
    const count = (state.simulations || []).length;
    if (count > 0) {
      badgeSim.textContent = count;
      badgeSim.style.display = 'flex';
    } else {
      badgeSim.style.display = 'none';
    }
  }
}

function renderSimulations() {
  const el = document.getElementById('simulasi-transactions-list');
  if (!el) return;
  el.innerHTML = '';

  const sims = state.simulations || [];
  if (!sims.length) {
    el.innerHTML = '<tr><td colspan="6" class="empty-state"><p>Tidak ada draf simulasi pengeluaran. Gunakan tombol "+ Tambah Simulasi" untuk membuat baru.</p></td></tr>';
    return;
  }

  sims.forEach(t => {
    const r = document.createElement('tr');
    r.innerHTML = `
      <td>${fmtDate(t.date)}</td>
      <td><b>${t.category || '-'}</b></td>
      <td>${t.desc}</td>
      <td style="font-weight:700;color:var(--danger)">${formatIDR(t.amount)}</td>
      <td>${t.payMethod}</td>
      <td>
        <div style="display:flex;gap:0.4rem;">
          <button class="btn btn-success btn-sm" onclick="cairkanSimulasi('${t.id}')">
            <i data-lucide="check-circle" style="width:13px;height:13px"></i> Cairkan
          </button>
          <button class="btn btn-outline btn-sm" onclick="confirmDelete('${t.id}')" style="color:var(--danger);border-color:rgba(239,68,68,0.2)">
            <i data-lucide="trash-2" style="width:13px;height:13px"></i> Hapus
          </button>
        </div>
      </td>
    `;
    el.appendChild(r);
  });

  lucide.createIcons();
}

async function cairkanSimulasi(id) {
  const idx = (state.simulations || []).findIndex(t => t.id === id);
  if (idx === -1) return;

  const simTrx = state.simulations[idx];

  if (!confirm(`Apakah Anda yakin ingin mencairkan anggaran ini secara resmi?\n\nPengeluaran sebesar ${formatIDR(simTrx.amount)} untuk "${simTrx.desc}" akan dicatat sebagai transaksi riil.`)) {
    return;
  }

  const isAdmin = (document.getElementById('user-name')?.innerText.toLowerCase() || 'web') === 'admin';
  const initialStatus = (isAdmin || simTrx.type === 'pemasukan' || simTrx.amount < (state.config?.BATAS_APPROVAL || 5000000)) ? 'approved' : 'pending';

  const realTrx = {
    ...simTrx,
    id: 'TRX-REAL-' + Date.now(),
    status: initialStatus
  };

  // Hapus dari simulations
  state.simulations.splice(idx, 1);

  // Tambah ke transactions
  state.transactions.unshift(realTrx);

  const envKey = STATE_CACHE_KEY + '_' + (state.env?.active || 'PROD');
  localStorage.setItem(envKey, JSON.stringify(state));
  updateUI();

  if (gasUrl) {
    showToast('Sinkronisasi transaksi pencairan ke server...', 'info');
    postToGAS({ action: 'saveTransaction', data: realTrx }).then(res => {
      if (res?.success && !res.offline) {
        showToast('Transaksi pencairan berhasil disinkronkan!', 'success');
      }
    });
  } else {
    showToast('Transaksi pencairan berhasil disimpan (mode lokal)!', 'success');
  }
}

function hapusSimulasi(id) {
  state.simulations = (state.simulations || []).filter(t => t.id !== id);
  const envKey = STATE_CACHE_KEY + '_' + (state.env?.active || 'PROD');
  localStorage.setItem(envKey, JSON.stringify(state));
  updateUI();
  showToast('Draf simulasi pengeluaran dihapus.', 'info');
}

function updateModalBudgetInfo() {
  const infoEl = document.getElementById('trx-budget-info');
  if (!infoEl) return;

  const type = document.getElementById('trx-type').value;
  const category = document.getElementById('trx-category').value;
  const amountVal = document.getElementById('trx-amount').value;
  const amount = parseFloat(amountVal) || 0;

  if (type === 'pemasukan') {
    infoEl.textContent = 'Pemasukan menambah kas (tidak dibatasi pagu).';
    infoEl.style.color = 'var(--success)';
    return;
  }

  if (!category) {
    infoEl.textContent = 'Pilih sumber dana untuk melihat sisa anggaran.';
    infoEl.style.color = 'var(--text-muted)';
    return;
  }

  // Hitung sisa anggaran dengan logika yang sama seperti di saveTransaction
  const activeTrx = getActiveTrx();
  const isPerubahan = (state.settings?.APBDes || 'Awal') === 'Perubahan';
  const totalBudget = isPerubahan
    ? (state.sources || []).filter(s => matchCategory(category, s) && String(s.year || '') === getActiveYear()).reduce((sum, s) => sum + Number(s.initialBalance || 0), 0)
    : 0;
  const totalSpent = activeTrx.filter(t => t.category === category && t.type === 'pengeluaran' && t.status !== 'rejected').reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const totalIncome = activeTrx.filter(t => t.category === category && t.type === 'pemasukan' && isApproved(t)).reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const remaining = (totalBudget + totalIncome) - totalSpent;

  if (totalBudget === 0 && totalIncome === 0) {
    infoEl.textContent = `Peringatan: Belum ada anggaran/pemasukan terdaftar untuk ${category}.`;
    infoEl.style.color = 'var(--danger)';
    return;
  }

  if (amount > remaining) {
    infoEl.textContent = `⚠️ Saldo tidak mencukupi! Sisa: ${formatIDR(remaining)} (Kurang: ${formatIDR(amount - remaining)})`;
    infoEl.style.color = 'var(--danger)';
  } else {
    infoEl.textContent = `Sisa anggaran tersedia: ${formatIDR(remaining)}`;
    infoEl.style.color = 'var(--text-body)';

    // Switch to dark/light theme body text color dynamically
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    infoEl.style.color = isDark ? '#94a3b8' : '#475569';
  }
}



