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
    { id:'TRX-001', date:'2026-05-01', type:'pemasukan', category:'DD (Dana Desa)', subCategory:'Penerimaan Transfer', desc:'Transfer Dana Desa Tahap 1', amount:50000000, payMethod:'Transfer', status:'approved', user:'admin' },
    { id:'TRX-002', date:'2026-05-02', type:'pengeluaran', category:'DD (Dana Desa)', subCategory:'Belanja Pegawai', desc:'Gaji Perangkat Desa Mei', amount:15000000, payMethod:'Transfer', status:'approved', user:'admin' },
    { id:'TRX-003', date:'2026-05-03', type:'pengeluaran', category:'ADD (Alokasi Dana Desa)', subCategory:'Belanja Barang & Jasa', desc:'Pembelian ATK Kantor', amount:2500000, payMethod:'Tunai', status:'approved', user:'admin' },
    { id:'TRX-004', date:'2026-05-04', type:'pengeluaran', category:'DD (Dana Desa)', subCategory:'Belanja Modal', desc:'Pengadaan Laptop Kantor', amount:12000000, payMethod:'Transfer', status:'pending', user:'staff' },
    { id:'TRX-005', date:'2026-05-04', type:'pemasukan', category:'PAD (Pendapatan Asli Desa)', subCategory:'Penerimaan Retribusi', desc:'Retribusi Pasar Desa', amount:3500000, payMethod:'Tunai', status:'approved', user:'admin' },
  ],
  sources: [
    { type:'DD', name:'Dana Desa Tahap 1', initialBalance:100000000, description:'Dana transfer pusat', active:'Aktif' },
    { type:'ADD', name:'Alokasi Dana Desa Tahap 1', initialBalance:50000000, description:'Dana transfer daerah', active:'Aktif' },
    { type:'PAD', name:'Pendapatan Asli Desa', initialBalance:25000000, description:'Pendapatan asli desa', active:'Aktif' },
  ],
  categories: [
    { name:'Belanja Pegawai', type:'pengeluaran' },{ name:'Belanja Barang & Jasa', type:'pengeluaran' },
    { name:'Belanja Modal', type:'pengeluaran' },{ name:'Belanja Operasional', type:'pengeluaran' },
    { name:'Penerimaan Transfer', type:'pemasukan' },{ name:'Penerimaan Retribusi', type:'pemasukan' },
    { name:'Penerimaan Lainnya', type:'pemasukan' },
  ],
  settings: { saldo_lalu: 0 },
  config: { NAMA_KANTOR:'Kantor Desa Patihan', BATAS_APPROVAL:5000000 },
  env: { active: 'PROD', name: 'Production' }
};

// Load cached state if exists (based on last environment)
const lastEnv = localStorage.getItem('kas_desa_last_env') || 'PROD';
const cachedState = localStorage.getItem(STATE_CACHE_KEY + '_' + lastEnv);
if (cachedState) {
  state = JSON.parse(cachedState);
}




// ─── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const d = document.getElementById('trx-date');
  if (d) d.value = new Date().toISOString().split('T')[0];
  const savedTheme = localStorage.getItem('kas_desa_theme');
  if (savedTheme === 'dark') document.documentElement.setAttribute('data-theme','dark');
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

function handleConnectivityChange() {
  const isOnline = navigator.onLine;
  document.getElementById('conn-status').textContent = isOnline ? 'Online' : 'Offline';
  if (isOnline) {
    showToast('Koneksi kembali! Menyingkronkan data...','success');
    syncOfflineActions();
  } else {
    showToast('Anda sedang offline. Perubahan akan disimpan secara lokal.','info');
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
      showToast('Data berhasil dimuat dari server!','success');
    }

  } catch(e) {
    document.getElementById('conn-status').textContent = 'Offline';
    showToast('Gagal terhubung (Mode Offline aktif): ' + e.message,'error');
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
    const r = await fetch(gasUrl, { method:'POST', body:JSON.stringify(body), headers:{'Content-Type':'text/plain'} });
    return await r.json();
  } catch(e) { 
    queueOfflineAction(body);
    return { success: true, status: 'offline', offline: true }; 
  }
}

function queueOfflineAction(body) {
  syncQueue.push({ id: Date.now(), body, timestamp: new Date() });
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(syncQueue));
  updateSyncBadge();
  showToast('Tersimpan offline! Akan disinkronkan saat online.','info');
}

async function syncOfflineActions() {
  if (syncQueue.length === 0) return;
  
  showLoading(true);
  let successCount = 0;
  const newQueue = [];
  
  for (const item of syncQueue) {
    try {
      const r = await fetch(gasUrl, { method:'POST', body:JSON.stringify(item.body), headers:{'Content-Type':'text/plain'} });
      const res = await r.json();
      if (res.success) successCount++;
      else newQueue.push(item);
    } catch(e) {
      newQueue.push(item);
    }
  }
  
  syncQueue = newQueue;
  localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(syncQueue));
  updateSyncBadge();
  showLoading(false);
  
  if (successCount > 0) {
    showToast(`${successCount} data berhasil disinkronkan!`,'success');
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


function saveGasUrl() {
  const url = document.getElementById('set-gas-url').value.trim();
  if (!url) { showToast('URL tidak boleh kosong!','error'); return; }
  gasUrl = url;
  localStorage.setItem(GAS_URL_KEY, url);
  showToast('URL tersimpan!','success');
  fetchFromGAS();
  closeModal('modal-settings');
}

async function testConnection() {
  const url = document.getElementById('set-gas-url').value.trim();
  if (!url) { showToast('Masukkan URL terlebih dahulu','error'); return; }
  showToast('Menguji koneksi...','info');
  try {
    const r = await fetch(url + '?action=getAllData');
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    showToast('Koneksi berhasil! ✓','success');
  } catch(e) { showToast('Gagal: '+e.message,'error'); }
}

// ─── UPDATE UI ─────────────────────────────────────────────────
function updateUI() {
  updateStats(); renderRecentTransactions(); renderFullTransactions();
  renderBudgets(); renderApprovals(); renderMiniApprovals();
  updateReportUI(); populateDropdowns(); populateReferenceDropdowns();

  renderSettingsSources(); initCharts();

  updateEnvUI();
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
    } catch(e) {
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
  const init = (state.sources||[]).reduce((s,x) => s+Number(x.initialBalance||0),0) + Number(state.settings?.saldo_lalu||0);

  const inc = state.transactions.filter(t=>t.type==='pemasukan'&&t.status==='approved').reduce((s,t)=>s+Number(t.amount||0),0);
  const exp = state.transactions.filter(t=>t.type==='pengeluaran'&&t.status==='approved').reduce((s,t)=>s+Number(t.amount||0),0);

  const pend = state.transactions.filter(t=>t.status==='pending').length;
  setText('stat-income',formatIDR(inc)); setText('stat-expense',formatIDR(exp));
  setText('stat-balance',formatIDR(init+inc-exp)); setText('stat-pending',pend);
  const b = document.getElementById('badge-approval');
  if (b) { b.innerText=pend; b.style.display=pend>0?'flex':'none'; }
}

function renderRecentTransactions() {
  const el = document.getElementById('recent-transactions-list'); if(!el) return; el.innerHTML='';
  const sorted = [...state.transactions].sort((a,b)=>new Date(b.date)-new Date(a.date));
  if (!sorted.length) { el.innerHTML='<tr><td colspan="5" class="empty-state"><p>Belum ada transaksi</p></td></tr>'; return; }
  sorted.slice(0,5).forEach(t => {
    const r = document.createElement('tr');
    r.innerHTML=`<td>${fmtDate(t.date)}</td><td><b>${t.category||'-'}</b></td><td>${t.desc}</td><td style="color:${t.type==='pemasukan'?'var(--success)':'var(--danger)'};font-weight:700">${t.type==='pemasukan'?'+':'-'} ${formatIDR(t.amount)}</td><td><span class="status-badge status-${(t.status||'').toLowerCase()}">${t.status}</span></td>`;
    el.appendChild(r);
  });
}

function renderFullTransactions() {
  const el = document.getElementById('full-transactions-list'); if(!el) return; el.innerHTML='';
  const sorted = [...state.transactions].sort((a,b)=>new Date(b.date)-new Date(a.date));
  if (!sorted.length) { el.innerHTML='<tr><td colspan="8" class="empty-state"><p>Belum ada transaksi</p></td></tr>'; return; }
  sorted.forEach(t => {
    const r = document.createElement('tr');
    r.innerHTML=`<td><code style="font-size:0.7rem;background:#f1f5f9;padding:2px 5px;border-radius:4px">${t.id}</code></td><td>${fmtDate(t.date)}</td><td><span class="status-badge status-${t.type==='pemasukan'?'approved':'rejected'}" style="font-size:0.6rem">${t.type==='pemasukan'?'MASUK':'KELUAR'}</span></td><td>${t.category||'-'}</td><td>${t.desc}</td><td style="font-weight:700">${formatIDR(t.amount)}</td><td><span class="status-badge status-${(t.status||'').toLowerCase()}">${t.status}</span></td><td><button class="btn btn-outline btn-sm" onclick="confirmDelete('${t.id}')"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button></td>`;
    el.appendChild(r);
  });
  lucide.createIcons();
}

function renderBudgets() {
  const el = document.getElementById('budget-list'); if(!el) return; el.innerHTML='';
  (state.sources||[]).forEach(src => {
    const label = `[${src.type}] ${src.name}`;
    const spent = state.transactions.filter(t=>t.category===label&&t.type==='pengeluaran'&&t.status==='approved').reduce((s,t)=>s+Number(t.amount||0),0);
    const init = Number(src.initialBalance||0);

    const pct = init>0?Math.min(100,(spent/init)*100):0;
    let clr='var(--success)'; if(pct>90) clr='var(--danger)'; else if(pct>75) clr='var(--warning)'; else if(pct>50) clr='var(--info)';
    const c = document.createElement('div'); c.className='card';
    c.innerHTML=`<div style="display:flex;justify-content:space-between;margin-bottom:0.9rem"><div><h4 style="font-weight:700;color:var(--text-title);font-size:0.9rem">${label}</h4><span style="font-size:0.7rem;color:var(--text-muted)">${src.description||''}</span></div><span style="font-size:0.8rem;font-weight:700;color:${clr}">${pct.toFixed(1)}%</span></div><div style="background:#f1f5f9;height:7px;border-radius:4px;overflow:hidden;margin-bottom:0.9rem"><div style="width:${pct}%;height:100%;background:${clr};transition:width 1s;border-radius:4px"></div></div><div style="display:flex;justify-content:space-between;font-size:0.75rem"><span>Terpakai: <b style="color:var(--danger)">${formatIDR(spent)}</b></span><span>Pagu: <b>${formatIDR(init)}</b></span></div>`;
    el.appendChild(c);
  });
}

function renderApprovals() {
  const el = document.getElementById('approval-list'); if(!el) return; el.innerHTML='';
  const pend = state.transactions.filter(t=>t.status==='pending');
  if (!pend.length) { el.innerHTML='<div class="empty-state"><p>Tidak ada pengajuan pending</p></div>'; return; }
  pend.forEach(t => {
    const d = document.createElement('div'); d.className='approval-item';
    d.innerHTML=`<div><div style="font-weight:700;color:var(--text-title);margin-bottom:0.2rem">${t.desc}</div><div style="font-size:0.75rem;color:var(--text-muted)">${t.category} • ${fmtDate(t.date)}</div></div><div style="text-align:right"><div style="font-weight:800;color:var(--text-title);margin-bottom:0.6rem">${formatIDR(t.amount)}</div><div style="display:flex;gap:0.4rem"><button class="btn btn-danger btn-sm" onclick="processApproval('${t.id}','rejected')">Tolak</button><button class="btn btn-success btn-sm" onclick="processApproval('${t.id}','approved')">Setujui</button></div></div>`;
    el.appendChild(d);
  });
}

function renderMiniApprovals() {
  const el = document.getElementById('mini-approval-list'); if(!el) return; el.innerHTML='';
  const pend = state.transactions.filter(t=>t.status==='pending');
  if (!pend.length) { el.innerHTML='<div class="empty-state" style="padding:1.25rem 0"><p>Tidak ada antrian</p></div>'; return; }
  pend.slice(0,3).forEach(t => {
    const d = document.createElement('div');
    d.style.cssText='padding:0.6rem 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center';
    d.innerHTML=`<div><div style="font-weight:600;font-size:0.8rem">${t.desc}</div><div style="font-size:0.7rem;color:var(--text-muted)">${formatIDR(t.amount)}</div></div><button class="btn-icon" onclick="showPage('approval')"><i data-lucide="chevron-right"></i></button>`;
    el.appendChild(d);
  }); lucide.createIcons();
}

function updateReportUI() {
  const inc = state.transactions.filter(t=>t.type==='pemasukan'&&t.status==='approved').reduce((s,t)=>s+Number(t.amount||0),0);
  const exp = state.transactions.filter(t=>t.type==='pengeluaran'&&t.status==='approved').reduce((s,t)=>s+Number(t.amount||0),0);
  const init = (state.sources||[]).reduce((s,x)=>s+Number(x.initialBalance||0),0)+Number(state.settings?.saldo_lalu||0);

  setText('rep-income',formatIDR(inc)); setText('rep-expense',formatIDR(exp)); setText('rep-balance',formatIDR(init+inc-exp));
  const el = document.getElementById('report-category-list'); if(!el) return; el.innerHTML='';
  (state.sources||[]).forEach(src => {
    const label = `[${src.type}] ${src.name}`;
    const si = state.transactions.filter(t=>t.category===label&&t.type==='pemasukan'&&t.status==='approved').reduce((s,t)=>s+Number(t.amount||0),0);
    const so = state.transactions.filter(t=>t.category===label&&t.type==='pengeluaran'&&t.status==='approved').reduce((s,t)=>s+Number(t.amount||0),0);
    const ib = Number(src.initialBalance||0);

    const r = document.createElement('tr');
    r.innerHTML=`<td><b>${label}</b></td><td>${formatIDR(ib)}</td><td class="txt-success">+${formatIDR(si)}</td><td class="txt-danger">-${formatIDR(so)}</td><td style="font-weight:800">${formatIDR(ib+si-so)}</td>`;
    el.appendChild(r);
  });
}

// ─── ACTIONS ───────────────────────────────────────────────────
async function saveTransaction() {
  const data = {
    type: document.getElementById('trx-type').value,
    date: document.getElementById('trx-date').value,
    category: document.getElementById('trx-category').value,
    subCategory: '',
    amount: parseFloat(document.getElementById('trx-amount').value),
    desc: document.getElementById('trx-desc').value,
    payMethod: 'Transfer',
    notes: document.getElementById('trx-notes')?.value||''
  };
  if (!data.amount||!data.desc) { showToast('Isi jumlah dan deskripsi!','error'); return; }

  // Optimistic UI Update
  const tempId = 'TRX-TEMP-' + Date.now();
  const optimisticData = { ...data, id: tempId, status: 'pending', user: 'local' };
  state.transactions.unshift(optimisticData);
  localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(state));
  updateUI();

  if (gasUrl) {
    postToGAS({ action:'saveTransaction', data }).then(res => {
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
  document.getElementById('trx-amount').value=''; document.getElementById('trx-desc').value='';
  if(document.getElementById('trx-notes')) document.getElementById('trx-notes').value='';
}


async function processApproval(id, status) {
  if (gasUrl) {
    const res = await postToGAS({ action:'updateApproval', id, status });
    if (res?.success) { showToast('Status diperbarui!','success'); await fetchFromGAS(); }
  } else {
    const t = state.transactions.find(t=>t.id===id);
    if (t) { t.status=status; showToast('Status: '+status,'success'); updateUI(); }
  }
}

async function confirmDelete(id) {
  if (!confirm('Hapus transaksi '+id+'?')) return;
  
  // Optimistic UI Update
  state.transactions = state.transactions.filter(t=>t.id!==id);
  localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(state));
  updateUI();

  if (gasUrl) {
    postToGAS({ action:'deleteTransaction', id });
    showToast('Dihapus!','success');
  } else {
    showToast('Dihapus (lokal)','success');
  }
}


async function addSource() {
  const type = document.getElementById('set-source-type').value;
  const name = document.getElementById('set-source-name').value;
  const init = parseFloat(document.getElementById('set-source-init').value)||0;

  if (!name) { showToast('Nama rincian wajib diisi!','error'); return; }
  
  // Optimistic UI Update (Check for existing first)
  const existingIdx = state.sources.findIndex(s => s.type === type && s.name === name);
  if (existingIdx !== -1) {
    state.sources[existingIdx].initialBalance = init;
  } else {
    state.sources.push({ type, name, initialBalance:init, description:'', active:'Aktif' });
  }
  
  localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(state));
  updateUI();
  
  if (gasUrl) { 
    postToGAS({ action:'saveSumberDana', type, name, initialBalance:init, description:'' }); 
  }
  
  document.getElementById('set-source-name').value=''; 
  document.getElementById('set-source-init').value='';
  showToast(existingIdx !== -1 ? 'Silpa diperbarui!' : 'Silpa ditambahkan!', 'success');

}



async function deleteSource(type, name) {
  if (!confirm(`Hapus Silpa [${type}] ${name}? Semua transaksi terkait tetap ada namun pagu akan hilang.`)) return;

  
  // Optimistic UI Update
  state.sources = state.sources.filter(s => !(s.type === type && s.name === name));
  localStorage.setItem(STATE_CACHE_KEY, JSON.stringify(state));
  updateUI();

  if (gasUrl) { 
    postToGAS({ action:'deleteSumberDana', type, name }); 
    showToast('Dihapus!','success');
  } else {
    showToast('Dihapus (lokal)','success'); 
  }
}


function openEditSource(type, name) {
  const src = state.sources.find(s => s.type === type && s.name === name);
  if (!src) return;
  document.getElementById('edit-source-old-type').value = src.type;
  document.getElementById('edit-source-old-name').value = src.name;
  document.getElementById('edit-source-type').value = src.type;
  document.getElementById('edit-source-name').value = src.name;
  document.getElementById('edit-source-init').value = src.initialBalance;
  document.getElementById('edit-source-desc').value = src.description || '';
  openModal('modal-edit-source');
}

async function saveEditedSource() {
  const oldType = document.getElementById('edit-source-old-type').value;
  const oldName = document.getElementById('edit-source-old-name').value;
  const newType = document.getElementById('edit-source-type').value;
  const newName = document.getElementById('edit-source-name').value;
  const init = parseFloat(document.getElementById('edit-source-init').value) || 0;

  const desc = document.getElementById('edit-source-desc').value;
  
  if (gasUrl) {
    showLoading(true);
    const res = await postToGAS({ 
      action: 'editSumberDana', 
      oldType, oldName, 
      newType, newName, 
      initialBalance: init, 
      description: desc 
    });
    showLoading(false);
    if (res?.success) { showToast('Silpa diperbarui!', 'success'); await fetchFromGAS(); }
    else showToast('Gagal memperbarui Silpa', 'error');

  } else {
    const idx = state.sources.findIndex(s => s.type === oldType && s.name === oldName);
    if (idx !== -1) {
      const oldLabel = `[${oldType}] ${oldName}`;
      const newLabel = `[${newType}] ${newName}`;
      state.sources[idx] = { type: newType, name: newName, initialBalance: init, description: desc, active: 'Aktif' };
      // Local cascade
      state.transactions.forEach(t => { if(t.category === oldLabel) t.category = newLabel; });
      showToast('Silpa diperbarui (lokal)', 'success');
      updateUI();
    }
  }
  closeModal('modal-edit-source');
}




function renderSettingsSources() {
  const el = document.getElementById('settings-source-list'); if(!el) return; el.innerHTML='';
  (state.sources||[]).forEach(s => {
    const r = document.createElement('tr');
    r.innerHTML=`<td style="font-weight:600">${s.type}</td><td>${s.name}</td><td>${formatIDR(s.initialBalance||0)}</td><td style="display:flex;gap:0.4rem"><button class="btn btn-outline btn-sm" onclick="openEditSource('${s.type}','${s.name}')"><i data-lucide="edit-3" style="width:13px;height:13px"></i></button><button class="btn btn-danger btn-sm" onclick="deleteSource('${s.type}','${s.name}')"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button></td>`;
    el.appendChild(r);
  });
  lucide.createIcons();
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

function populateDropdowns() {

  const s1 = document.getElementById('trx-category');
  if (s1) { 
    const v=s1.value; 
    s1.innerHTML='<option value="">-- Pilih Sumber Dana --</option>'; 
    (state.references||[]).forEach(t=>{
      const o=document.createElement('option');
      o.value=t; o.text=t;
      s1.add(o);
    }); 
    if(v) s1.value=v; 
  }
}

// ─── NAV / UI ──────────────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page-content').forEach(p=>p.style.display='none');
  const p=document.getElementById('page-'+id); if(p) p.style.display='block';
  document.querySelectorAll('.nav-link').forEach(l=>l.classList.remove('active'));
  const n=document.getElementById('nav-'+id); if(n) n.classList.add('active');
  if (window.innerWidth<=1024) document.getElementById('sidebar').classList.remove('active');
}
function openModal(id) { document.getElementById(id).style.display='flex'; if(id==='modal-transaksi') populateDropdowns(); }
function closeModal(id) { document.getElementById(id).style.display='none'; }
function openSettings() { openModal('modal-settings'); }
function showLoading(s) { document.getElementById('loading').style.display=s?'flex':'none'; }
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('active'); }

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme')==='dark';
  document.documentElement.setAttribute('data-theme', isDark?'':'dark');
  localStorage.setItem('kas_desa_theme', isDark?'light':'dark');
  updateThemeIcon();
}
function updateThemeIcon() {
  const btn = document.getElementById('theme-btn');
  if(!btn) return;
  const isDark = document.documentElement.getAttribute('data-theme')==='dark';
  btn.innerHTML = isDark?'<i data-lucide="sun"></i>':'<i data-lucide="moon"></i>';
  lucide.createIcons();
}

function handleSearch(val) {
  const q = val.toLowerCase();
  const rows = document.querySelectorAll('#full-transactions-list tr');
  rows.forEach(r => { r.style.display = r.textContent.toLowerCase().includes(q)?'':'none'; });
}

// ─── CHARTS ────────────────────────────────────────────────────
function initCharts() {
  const c1 = document.getElementById('cashflowChart'); if(!c1) return;
  if (cashflowChart) cashflowChart.destroy(); if (categoryChart) categoryChart.destroy();
  const dates=[]; for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);dates.push(d.toISOString().split('T')[0]);}
  const iD=dates.map(d=>state.transactions.filter(t=>(t.date||'').includes(d)&&t.type==='pemasukan'&&t.status==='approved').reduce((s,t)=>s+(t.amount||0),0));
  const eD=dates.map(d=>state.transactions.filter(t=>(t.date||'').includes(d)&&t.type==='pengeluaran'&&t.status==='approved').reduce((s,t)=>s+(t.amount||0),0));
  cashflowChart = new Chart(c1.getContext('2d'),{type:'line',data:{labels:dates.map(d=>d.split('-')[2]+'/'+d.split('-')[1]),datasets:[
    {label:'Pemasukan',data:iD,borderColor:'#10b981',backgroundColor:'rgba(16,185,129,0.08)',fill:true,tension:0.4,borderWidth:2.5,pointRadius:4,pointBackgroundColor:'#10b981'},
    {label:'Pengeluaran',data:eD,borderColor:'#ef4444',backgroundColor:'rgba(239,68,68,0.08)',fill:true,tension:0.4,borderWidth:2.5,pointRadius:4,pointBackgroundColor:'#ef4444'}
  ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{usePointStyle:true,padding:16}}},scales:{y:{beginAtZero:true,grid:{color:'#f1f5f9'}},x:{grid:{display:false}}}}});

  const c2 = document.getElementById('categoryChart'); if(!c2) return;
  const cl=[...new Set(state.transactions.filter(t=>t.type==='pengeluaran'&&t.status==='approved').map(t=>t.category))];
  const cd=cl.map(c=>state.transactions.filter(t=>t.category===c&&t.type==='pengeluaran'&&t.status==='approved').reduce((s,t)=>s+(t.amount||0),0));
  categoryChart = new Chart(c2.getContext('2d'),{type:'doughnut',data:{labels:cl.length?cl:['Belum ada'],datasets:[{data:cd.length?cd:[1],backgroundColor:cl.length?['#6366f1','#3b82f6','#f59e0b','#10b981','#ec4899','#8b5cf6']:['#e2e8f0'],borderWidth:0}]},options:{responsive:true,cutout:'70%',plugins:{legend:{position:'bottom',labels:{usePointStyle:true,padding:10,font:{size:10}}}}}});
}

// ─── TOAST & HELPERS ───────────────────────────────────────────
function showToast(msg,type='info') {
  let c=document.querySelector('.toast-container');
  if(!c){c=document.createElement('div');c.className='toast-container';document.body.appendChild(c);}
  const t=document.createElement('div');t.className='toast '+type;
  const ic={success:'check-circle',error:'alert-circle',info:'info'};
  t.innerHTML=`<i data-lucide="${ic[type]||'info'}" style="width:16px;height:16px"></i> ${msg}`;
  c.appendChild(t); lucide.createIcons();
  setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(100px)';setTimeout(()=>t.remove(),300);},3500);
}
function formatIDR(a){return new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',minimumFractionDigits:2,maximumFractionDigits:2}).format(a||0);}
function fmtDate(d){try{return new Date(d).toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'});}catch(e){return d;}}
function setText(id,v){const e=document.getElementById(id);if(e)e.innerText=v;}

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

