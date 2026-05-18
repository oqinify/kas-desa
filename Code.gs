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
  STAGING: { name: 'Staging', spreadsheetId: '1M-0ryJx6tzF4oSGatZ5EOqiyFs55icOErN-GmGsvB6o' }, // Isi dengan ID Spreadsheet Testing
  DEV: { name: 'Development', spreadsheetId: '13dQr5IKAhCQ9DBE78ZiRJqIhfC9GnPq_ini3lMdfQp4' }  // Isi dengan ID Spreadsheet Dev
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
      case 'debugData': result = getDebugData(); break;
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
      case 'saveSumberDana': result = saveSumberDana(body.type, body.name, body.initialBalance, body.description, body.year); break;
      case 'deleteSumberDana': result = deleteSumberDana(body.type, body.name, body.year); break;
      case 'editSumberDana': result = editSumberDana(body.oldType, body.oldName, body.oldYear, body.newType, body.newName, body.newYear, body.initialBalance, body.description); break;
      case 'saveKategori': result = saveKategori(body.name, body.type, body.description); break;
      case 'deleteKategori': result = deleteKategori(body.name); break;
      case 'updateSettings': result = updateSettings(body.key, body.value); break;
      case 'resetDatabase': result = resetDatabase(); break;
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

    { name: 'Silpa', headers: ['Sumber Dana','Nama','Saldo Awal','Keterangan','Status Aktif','Tahun'] },


    { name: 'Settings', headers: ['Key','Value'] },
    { name: 'Referensi', headers: ['Sumber Dana'] },

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


  // Default settings
  const setSheet = ss.getSheetByName('Settings');
  if (setSheet.getLastRow() <= 1) {
    setSheet.appendRow(['saldo_lalu',0]);
    setSheet.appendRow(['tahun_anggaran',CONFIG.TAHUN_ANGGARAN]);
    setSheet.appendRow(['nama_kantor',CONFIG.NAMA_KANTOR]);
    setSheet.appendRow(['APBDes','Awal']);
  }
  // Default Referensi
  const refSheet = ss.getSheetByName('Referensi');
  if (refSheet.getLastRow() <= 1) {
    ['DD Earmark','DD NonEarmark','ADD Siltap','ADD Operasional','PAD','DLL','BHPR'].forEach(t => refSheet.appendRow([t]));
  }

  // Tambah validasi data: kolom Sumber Dana di sheet Silpa harus dari sheet Referensi
  const silpaSheet = ss.getSheetByName('Silpa');
  if (silpaSheet) {
    const refRange = refSheet.getRange(2, 1, Math.max(refSheet.getLastRow() - 1, 7), 1);
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(refRange, true)
      .setAllowInvalid(false)
      .setHelpText('Pilih Sumber Dana dari daftar Referensi')
      .build();
    silpaSheet.getRange(2, 1, 1000, 1).setDataValidation(rule);
  }


  return { success: true, message: 'Database berhasil diinisialisasi!' };
}

// ─── DATA RETRIEVAL ────────────────────────────────────────────
function getAllData() {
  const ss = getSpreadsheet_();
  
  const trxSheet = ss.getSheetByName('Transaksi');
  let transactions = [];
  if (trxSheet) {
    const lastRow = trxSheet.getLastRow();
    let trxData = [];
    if (lastRow > 1) trxData = trxSheet.getRange(2,1,lastRow-1,12).getValues();
    transactions = trxData.map(r => {
      // Normalisasi amount: hapus format mata uang, parse ke angka
      const rawAmount = r[6];
      const amount = typeof rawAmount === 'number'
        ? rawAmount
        : Number(String(rawAmount).replace(/[^0-9,.-]/g, '').replace(',', '.')) || 0;

      return {
        id:       String(r[0] || '').trim(),
        date:     r[1] instanceof Date ? Utilities.formatDate(r[1], CONFIG.TIMEZONE, "yyyy-MM-dd") : String(r[1] || '').trim(),
        type:     String(r[2] || '').trim().toLowerCase(),
        category: String(r[3] || '').trim(),
        subCategory: String(r[4] || '').trim(),
        desc:     String(r[5] || '').trim(),
        amount:   amount,
        payMethod: String(r[7] || '').trim(),
        status:   String(r[8] || '').trim().toLowerCase(),
        notes:    String(r[9] || '').trim(),
        user:     String(r[10] || '').trim(),
        timestamp: r[11]
      };
    }).reverse();
  }

  const srcSheet = ss.getSheetByName('Silpa');
  let sources = [];
  if (srcSheet) {
    const srcData = srcSheet.getLastRow()>1 ? srcSheet.getRange(2,1,srcSheet.getLastRow()-1,6).getValues() : [];
    sources = srcData.map(r => ({ 
      type: r[0], 
      name: r[1], 
      initialBalance: r[2], 
      description: r[3], 
      active: r[4], 
      year: r[5] ? String(r[5]) : '' 
    }));
  }



  const setSheet = ss.getSheetByName('Settings');
  let settings = {};
  if (setSheet) {
    const setData = setSheet.getLastRow()>1 ? setSheet.getRange(2,1,setSheet.getLastRow()-1,2).getValues() : [];
    setData.forEach(r => settings[r[0]] = r[1]);
  }

  const refSheet = ss.getSheetByName('Referensi');
  let references = [];
  if (refSheet) {
    references = refSheet.getLastRow()>1 ? refSheet.getRange(2,1,refSheet.getLastRow()-1,1).getValues().flat() : [];
  }

  return { 
    transactions, 
    sources, 
    settings,
    references,

    config: CONFIG,

    env: {
      active: getActiveEnv_(),
      name: ENVIRONMENTS[getActiveEnv_()]?.name || 'Default'
    },
    dbStatus: (trxSheet && srcSheet && setSheet && refSheet) ? 'ready' : 'needs_init'
  };
}



// ─── TRANSACTION CRUD ──────────────────────────────────────────
function saveTransactionToSheet(data) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName('Transaksi');
  const id = 'TRX-' + Utilities.formatDate(new Date(),CONFIG.TIMEZONE,"yyyyMMddHHmmss") + '-' + Math.floor(Math.random()*1000);
  
  // Jika user admin, matikan approval (selalu approved)
  let status = 'approved';
  if (data.user !== 'admin') {
     status = (data.type === 'pengeluaran' && data.amount >= CONFIG.BATAS_APPROVAL) ? 'pending' : 'approved';
  }
  
  sheet.appendRow([id, data.date, data.type, data.category, data.subCategory||'', data.desc, data.amount, data.payMethod||'Transfer', status, data.notes||'', data.user||'web', new Date()]);
  _logActivity(data.user||'web', 'CREATE', 'Silpa baru: '+id);

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
function saveSumberDana(type, name, initialBalance, description, year) {
  const ss = getSpreadsheet_(); const sheet = ss.getSheetByName('Silpa'); const data = sheet.getDataRange().getValues();
  const yrStr = year ? String(year).trim() : '';

  // Check if same type, name, and year exists
  for (let i=1;i<data.length;i++) { 
    if(data[i][0]===type && data[i][1]===name && String(data[i][5]||'')===yrStr) { 
      sheet.getRange(i+1,3).setValue(initialBalance); 
      if(description) sheet.getRange(i+1,4).setValue(description); 
      return { success:true, mode:'updated' }; 
    } 
  }
  sheet.appendRow([type, name, initialBalance, description||'', 'Aktif', yrStr]);
  return { success:true, mode:'created' };
}
function deleteSumberDana(type, name, year) {
  const ss = getSpreadsheet_(); const sheet = ss.getSheetByName('Silpa'); const data = sheet.getDataRange().getValues();
  const yrStr = year ? String(year).trim() : '';

  for (let i=1;i<data.length;i++) { 
    if(data[i][0]===type && data[i][1]===name && String(data[i][5]||'')===yrStr) { 
      sheet.deleteRow(i+1); 
      return { success:true }; 
    } 
  }
  return { success:false };
}
function editSumberDana(oldType, oldName, oldYear, newType, newName, newYear, newBalance, newDescription) {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName('Silpa');
  const oldYrStr = oldYear ? String(oldYear).trim() : '';
  const newYrStr = newYear ? String(newYear).trim() : '';

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === oldType && data[i][1] === oldName && String(data[i][5]||'') === oldYrStr) {
      if (newType) sheet.getRange(i + 1, 1).setValue(newType);
      if (newName) sheet.getRange(i + 1, 2).setValue(newName);
      if (newBalance !== undefined) sheet.getRange(i + 1, 3).setValue(newBalance);
      if (newDescription !== undefined) sheet.getRange(i + 1, 4).setValue(newDescription);
      sheet.getRange(i + 1, 6).setValue(newYrStr);
      
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
    if (data[i][3] === oldLabel) { // Kolom Silpa adalah index 3 (D)

      sheet.getRange(i + 1, 4).setValue(newLabel);
    }
  }
}
function saveKategori(name, type, description) { return { success: false }; }
function deleteKategori(name) { return { success: false }; }

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
function resetDatabase() {
  const ss = getSpreadsheet_();
  const sheetsToClear = ['Transaksi', 'Silpa', 'Log_Aktivitas'];

  
  sheetsToClear.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet) {
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.deleteRows(2, lastRow - 1);
      }
    }
  });
  
  _logActivity('system', 'RESET', 'Database direset ke kondisi awal');
  return { success: true, message: 'Database berhasil dikosongkan!' };
}

// ─── DEBUG ─────────────────────────────────────────────────────
function getDebugData() {
  const ss = getSpreadsheet_();
  const trxSheet = ss.getSheetByName('Transaksi');
  if (!trxSheet) return { error: 'Sheet Transaksi tidak ditemukan!' };
  const lastRow = trxSheet.getLastRow();
  if (lastRow <= 1) return { totalRows: 0, rawRows: [], message: 'Sheet Transaksi kosong' };
  const limit = Math.min(lastRow - 1, 10);
  const raw = trxSheet.getRange(2, 1, limit, 12).getValues();
  return {
    totalRows: lastRow - 1,
    rawRows: raw.map((r, i) => ({
      row: i + 2,
      id:         String(r[0]),
      tipe:       String(r[2]),
      category:   String(r[3]),
      amount:     r[6],
      amountType: typeof r[6],
      status:     String(r[8])
    }))
  };
}
