/**
 * ═══════════════════════════════════════════════════════════════
 *   SISTEM KEUANGAN KANTOR - BACKEND (Google Apps Script)
 *   Database: Google Spreadsheet
 *   Version: 3.0 - GitHub Pages Edition
 * ═══════════════════════════════════════════════════════════════
 */

const CONFIG = {
  NAMA_KANTOR: 'Kantor Desa Patihan',
  TAHUN_ANGGARAN: new Date().getFullYear(),
  BATAS_APPROVAL: 5000000,
  TIMEZONE: 'GMT+7'
};

const ENVIRONMENTS = {
  PROD: { name: 'Production', spreadsheetId: '' }, // Isi dengan ID Spreadsheet Utama
  STAGING: { name: 'Staging', spreadsheetId: '' }, // Isi dengan ID Spreadsheet Testing
  DEV: { name: 'Development', spreadsheetId: '' }  // Isi dengan ID Spreadsheet Dev
};


// ─── WEB APP ENTRY (API Mode for GitHub Pages) ────────────────
function doGet(e) {
  const action = e?.parameter?.action || 'page';
  
  // If no action param, serve the GAS-hosted page
  if (action === 'page') {
    return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle(CONFIG.NAMA_KANTOR + ' - Sistem Keuangan')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  
  // API mode — return JSON
  let result;
  try {
    switch (action) {
      case 'getAllData': result = getAllData(); break;
      case 'getReport': result = getMonthlyReport(Number(e.parameter.month), Number(e.parameter.year)); break;
      case 'initDB': result = initDatabase(); break;
      case 'getEnvs': result = getEnvironments(); break;
      case 'switchEnv': result = switchEnvironment(e.parameter.env); break;
      default: result = { error: 'Unknown action: ' + action };

    }
  } catch (err) {
    result = { error: err.message };
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const action = body.action;
  let result;
  
  try {
    switch (action) {
      case 'saveTransaction': result = saveTransactionToSheet(body.data); break;
      case 'updateTransaction': result = updateTransaction(body.id, body.data); break;
      case 'deleteTransaction': result = deleteTransaction(body.id); break;
      case 'updateApproval': result = updateApprovalStatus(body.id, body.status); break;
      case 'saveSumberDana': result = saveSumberDana(body.type, body.name, body.initialBalance, body.description); break;
      case 'deleteSumberDana': result = deleteSumberDana(body.type, body.name); break;
      case 'editSumberDana': result = editSumberDana(body.oldType, body.oldName, body.newType, body.newName, body.initialBalance, body.description); break;
      case 'saveKategori': result = saveKategori(body.name, body.type, body.description); break;
      case 'deleteKategori': result = deleteKategori(body.name); break;
      case 'updateSettings': result = updateSettings(body.key, body.value); break;
      default: result = { error: 'Unknown action: ' + action };
    }
  } catch (err) {
    result = { error: err.message };
  }
  
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── DATABASE INIT ─────────────────────────────────────────────
function getActiveEnv_() {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('ACTIVE_ENV') || 'PROD';
}

function getSpreadsheet_() {
  const activeEnv = getActiveEnv_();
  const envConfig = ENVIRONMENTS[activeEnv];
  
  if (envConfig && envConfig.spreadsheetId) {
    return SpreadsheetApp.openById(envConfig.spreadsheetId);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getEnvironments() {
  return {
    active: getActiveEnv_(),
    available: ENVIRONMENTS
  };
}

function switchEnvironment(env) {
  if (ENVIRONMENTS[env]) {
    PropertiesService.getScriptProperties().setProperty('ACTIVE_ENV', env);
    return { success: true, message: 'Berhasil pindah ke lingkungan: ' + ENVIRONMENTS[env].name };
  }
  return { success: false, message: 'Lingkungan tidak valid' };
}


function initDatabase() {
  const ss = getSpreadsheet_();
  const schemas = [
    { name: 'Transaksi', headers: ['ID','Tanggal','Tipe','Sumber Dana','Kategori','Deskripsi','Jumlah','Metode Bayar','Status','Catatan','User','Timestamp'] },
    { name: 'Anggaran', headers: ['Tipe','Nama','Pagu Anggaran','Terpakai','Sisa','Periode'] },
    { name: 'Master_SumberDana', headers: ['Tipe','Nama','Saldo Awal','Keterangan','Status Aktif'] },
    { name: 'Master_Kategori', headers: ['Nama Kategori','Tipe','Keterangan'] },
    { name: 'Settings', headers: ['Key','Value'] },
    { name: 'Log_Aktivitas', headers: ['Timestamp','User','Aksi','Detail'] }
  ];
  schemas.forEach(s => {
    let sheet = ss.getSheetByName(s.name);
    if (!sheet) {
      sheet = ss.insertSheet(s.name);
      sheet.getRange(1,1,1,s.headers.length).setValues([s.headers]).setFontWeight('bold').setBackground('#0f172a').setFontColor('#fff');
      sheet.setFrozenRows(1);
    }
  });
  // Default sumber dana
  const srcSheet = ss.getSheetByName('Master_SumberDana');
  if (srcSheet.getLastRow() <= 1) {
    srcSheet.appendRow(['DD','Dana Desa Tahap 1',100000000,'Dana transfer pusat','Aktif']);
    srcSheet.appendRow(['ADD','Alokasi Dana Desa Tahap 1',50000000,'Dana transfer daerah','Aktif']);
    srcSheet.appendRow(['PAD','Pendapatan Asli Desa',25000000,'Pendapatan asli desa','Aktif']);
  }
  // Default kategori
  const catSheet = ss.getSheetByName('Master_Kategori');
  if (catSheet.getLastRow() <= 1) {
    [['Belanja Pegawai','pengeluaran','Gaji dan tunjangan'],['Belanja Barang & Jasa','pengeluaran','ATK, konsumsi'],['Belanja Modal','pengeluaran','Aset tetap'],['Belanja Operasional','pengeluaran','Biaya operasional'],['Penerimaan Transfer','pemasukan','Transfer pemerintah'],['Penerimaan Retribusi','pemasukan','Retribusi daerah'],['Penerimaan Lainnya','pemasukan','Pendapatan lain']].forEach(c => catSheet.appendRow(c));
  }
  // Default settings
  const setSheet = ss.getSheetByName('Settings');
  if (setSheet.getLastRow() <= 1) {
    setSheet.appendRow(['saldo_lalu',0]);
    setSheet.appendRow(['tahun_anggaran',CONFIG.TAHUN_ANGGARAN]);
    setSheet.appendRow(['nama_kantor',CONFIG.NAMA_KANTOR]);
  }
  return { success: true, message: 'Database berhasil diinisialisasi!' };
}

// ─── DATA RETRIEVAL ────────────────────────────────────────────
function getAllData() {
  const ss = getSpreadsheet_();
  const trxSheet = ss.getSheetByName('Transaksi');
  const lastRow = trxSheet.getLastRow();
  let trxData = [];
  if (lastRow > 1) trxData = trxSheet.getRange(2,1,lastRow-1,12).getValues();
  const transactions = trxData.map(r => ({
    id:r[0], date: r[1] instanceof Date ? Utilities.formatDate(r[1],CONFIG.TIMEZONE,"yyyy-MM-dd") : r[1],
    type:r[2], category:r[3], subCategory:r[4], desc:r[5], amount:r[6], payMethod:r[7], status:r[8], notes:r[9], user:r[10], timestamp:r[11]
  })).reverse();

  const srcSheet = ss.getSheetByName('Master_SumberDana');
  const srcData = srcSheet.getLastRow()>1 ? srcSheet.getRange(2,1,srcSheet.getLastRow()-1,5).getValues() : [];
  const sources = srcData.map(r => ({ type:r[0], name:r[1], initialBalance:r[2], description:r[3], active:r[4] }));

  const catSheet = ss.getSheetByName('Master_Kategori');
  const catData = catSheet.getLastRow()>1 ? catSheet.getRange(2,1,catSheet.getLastRow()-1,3).getValues() : [];
  const categories = catData.map(r => ({ name:r[0], type:r[1], description:r[2] }));

  const setSheet = ss.getSheetByName('Settings');
  const setData = setSheet.getLastRow()>1 ? setSheet.getRange(2,1,setSheet.getLastRow()-1,2).getValues() : [];
  const settings = {}; setData.forEach(r => settings[r[0]] = r[1]);

  return { 
    transactions, 
    sources, 
    categories, 
    settings, 
    config: CONFIG,
    env: {
      active: getActiveEnv_(),
      name: ENVIRONMENTS[getActiveEnv_()]?.name || 'Default'
    }
  };
}


// ─── TRANSACTION CRUD ──────────────────────────────────────────
function saveTransactionToSheet(data) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName('Transaksi');
  const id = 'TRX-' + Utilities.formatDate(new Date(),CONFIG.TIMEZONE,"yyyyMMddHHmmss") + '-' + Math.floor(Math.random()*1000);
  const status = (data.type === 'pengeluaran' && data.amount >= CONFIG.BATAS_APPROVAL) ? 'pending' : 'approved';
  sheet.appendRow([id, data.date, data.type, data.category, data.subCategory||'', data.desc, data.amount, data.payMethod||'Transfer', status, data.notes||'', data.user||'web', new Date()]);
  _logActivity(data.user||'web', 'CREATE', 'Transaksi baru: '+id);
  return { success:true, id, status };
}

function updateTransaction(id, data) {
  const ss = getSpreadsheet_(); const sheet = ss.getSheetByName('Transaksi'); const all = sheet.getDataRange().getValues();
  for (let i=1;i<all.length;i++) {
    if (all[i][0]===id) {
      if(data.date) sheet.getRange(i+1,2).setValue(data.date);
      if(data.type) sheet.getRange(i+1,3).setValue(data.type);
      if(data.category) sheet.getRange(i+1,4).setValue(data.category);
      if(data.desc) sheet.getRange(i+1,6).setValue(data.desc);
      if(data.amount) sheet.getRange(i+1,7).setValue(data.amount);
      if(data.payMethod) sheet.getRange(i+1,8).setValue(data.payMethod);
      return { success:true };
    }
  }
  return { success:false, message:'ID tidak ditemukan' };
}

function deleteTransaction(id) {
  const ss = getSpreadsheet_(); const sheet = ss.getSheetByName('Transaksi'); const data = sheet.getDataRange().getValues();
  for (let i=1;i<data.length;i++) { if(data[i][0]===id) { sheet.deleteRow(i+1); return { success:true }; } }
  return { success:false, message:'ID tidak ditemukan' };
}

function updateApprovalStatus(id, status) {
  const ss = getSpreadsheet_(); const sheet = ss.getSheetByName('Transaksi'); const data = sheet.getDataRange().getValues();
  for (let i=1;i<data.length;i++) { if(data[i][0]===id) { sheet.getRange(i+1,9).setValue(status); return { success:true }; } }
  return { success:false, message:'ID tidak ditemukan' };
}

// ─── MASTER DATA CRUD ─────────────────────────────────────────
function saveSumberDana(type, name, initialBalance, description) {
  const ss = getSpreadsheet_(); const sheet = ss.getSheetByName('Master_SumberDana'); const data = sheet.getDataRange().getValues();
  // Check if same type and name exists
  for (let i=1;i<data.length;i++) { 
    if(data[i][0]===type && data[i][1]===name) { 
      sheet.getRange(i+1,3).setValue(initialBalance); 
      if(description) sheet.getRange(i+1,4).setValue(description); 
      return { success:true, mode:'updated' }; 
    } 
  }
  sheet.appendRow([type, name, initialBalance, description||'', 'Aktif']);
  return { success:true, mode:'created' };
}
function deleteSumberDana(type, name) {
  const ss = getSpreadsheet_(); const sheet = ss.getSheetByName('Master_SumberDana'); const data = sheet.getDataRange().getValues();
  for (let i=1;i<data.length;i++) { if(data[i][0]===type && data[i][1]===name) { sheet.deleteRow(i+1); return { success:true }; } }
  return { success:false };
}
function editSumberDana(oldType, oldName, newType, newName, newBalance, newDescription) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName('Master_SumberDana');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === oldType && data[i][1] === oldName) {
      if (newType) sheet.getRange(i + 1, 1).setValue(newType);
      if (newName) sheet.getRange(i + 1, 2).setValue(newName);
      if (newBalance !== undefined) sheet.getRange(i + 1, 3).setValue(newBalance);
      if (newDescription !== undefined) sheet.getRange(i + 1, 4).setValue(newDescription);
      
      // Cascading update in Transaksi sheet if name/type changed
      if ((newType && newType !== oldType) || (newName && newName !== oldName)) {
        const oldLabel = `[${oldType}] ${oldName}`;
        const newLabel = `[${newType || oldType}] ${newName || oldName}`;
        _cascadeUpdateSource(oldLabel, newLabel);
      }
      
      return { success: true, mode: 'updated' };
    }
  }
  return { success: false, message: 'Sumber tidak ditemukan' };
}

function _cascadeUpdateSource(oldLabel, newLabel) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName('Transaksi');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][3] === oldLabel) { // Kolom Sumber Dana adalah index 3 (D)
      sheet.getRange(i + 1, 4).setValue(newLabel);
    }
  }
}
function saveKategori(name, type, description) {
  const ss = getSpreadsheet_(); const sheet = ss.getSheetByName('Master_Kategori'); const data = sheet.getDataRange().getValues();
  for (let i=1;i<data.length;i++) { if(data[i][0]===name) { sheet.getRange(i+1,2).setValue(type); return { success:true, mode:'updated' }; } }
  sheet.appendRow([name, type, description||'']);
  return { success:true, mode:'created' };
}
function deleteKategori(name) {
  const ss = getSpreadsheet_(); const sheet = ss.getSheetByName('Master_Kategori'); const data = sheet.getDataRange().getValues();
  for (let i=1;i<data.length;i++) { if(data[i][0]===name) { sheet.deleteRow(i+1); return { success:true }; } }
  return { success:false };
}
function updateSettings(key, value) {
  const ss = getSpreadsheet_(); const sheet = ss.getSheetByName('Settings'); const data = sheet.getDataRange().getValues();
  for (let i=1;i<data.length;i++) { if(data[i][0]===key) { sheet.getRange(i+1,2).setValue(value); return { success:true }; } }
  sheet.appendRow([key, value]); return { success:true };
}

function getMonthlyReport(month, year) {
  const ss = getSpreadsheet_(); const sheet = ss.getSheetByName('Transaksi'); const lastRow = sheet.getLastRow();
  if (lastRow<=1) return { income:0, expense:0, transactions:[] };
  const data = sheet.getRange(2,1,lastRow-1,12).getValues();
  const filtered = data.filter(r => { const d = r[1] instanceof Date ? r[1] : new Date(r[1]); return d.getMonth()===(month-1) && d.getFullYear()===year && r[8]==='approved'; });
  const income = filtered.filter(r=>r[2]==='pemasukan').reduce((s,r)=>s+(r[6]||0),0);
  const expense = filtered.filter(r=>r[2]==='pengeluaran').reduce((s,r)=>s+(r[6]||0),0);
  return { income, expense, balance: income-expense };
}

// ─── HELPERS ───────────────────────────────────────────────────
function _logActivity(user, action, detail) {
  try { const ss = getSpreadsheet_(); const sheet = ss.getSheetByName('Log_Aktivitas'); if(sheet) sheet.appendRow([new Date(), user, action, detail]); } catch(e) {}
}
