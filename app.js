/* ========= helpers ========= */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const fmtNum = n => Math.round(Number(n||0)/1000).toLocaleString('en-US');
const today = () => new Date().toISOString().slice(0,10);
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,6);
const parseK = v => (parseFloat(v)||0)*1000;   // input in thousands → real value
const toK = v => (v||0)/1000;                   // real value → display in thousands

/* ========= auth store ========= */
const AUTH_KEYS={users:'cm_users',session:'cm_session'};
function loadUsers(){try{return JSON.parse(localStorage.getItem(AUTH_KEYS.users))||[];}catch(e){return [];}}
function saveUsers(u){localStorage.setItem(AUTH_KEYS.users,JSON.stringify(u));if(!_syncingFromFirebase)syncUsersToFirebase();}
function getSession(){try{return JSON.parse(localStorage.getItem(AUTH_KEYS.session))||null;}catch(e){return null;}}
function setSession(u){localStorage.setItem(AUTH_KEYS.session,JSON.stringify(u));}
function clearSession(){localStorage.removeItem(AUTH_KEYS.session);}
function getCurrentUser(){return getSession();}
function isAdmin(){const u=getCurrentUser();return u&&u.role==='admin';}
function getByTag(){return (getCurrentUser()||{}).username||'';}
async function hashPwd(pwd){
    const data=new TextEncoder().encode(pwd);
    const buf=await crypto.subtle.digest('SHA-256',data);
    return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function hasAction(action){
    const u=getCurrentUser();
    if(!u)return false;
    if(u.role==='admin')return true;
    return (u.permissions||[]).includes(action);
}

/* ========= AUTH FLOW ========= */
function showLogin(){
    const users=loadUsers();
    const overlay=$('#loginOverlay');
    const isSetup=users.length===0;
    overlay.querySelector('.login-title').textContent=isSetup?'إنشاء حساب المسؤول':'تسجيل الدخول';
    overlay.querySelector('.login-subtitle').textContent=isSetup?'قم بإنشاء حساب المدير الأول':'أدخل بيانات الدخول';
    const confirmRow=$('#loginConfirmRow');
    if(confirmRow)confirmRow.style.display=isSetup?'':'none';
    overlay.classList.remove('hidden');
    $('#app').style.display='none';
}
async function doLogin(){
    const username=$('#loginUser').value.trim();
    const password=$('#loginPass').value;
    if(!username||!password)return toast('أدخل البيانات');
    const users=loadUsers();
    if(users.length===0){
        const confirm=$('#loginConfirm')?.value;
        if(password!==confirm)return toast('كلمة المرور غير متطابقة');
        if(password.length<4)return toast('كلمة المرور قصيرة جداً');
        const hash=await hashPwd(password);
        const allPerms=['closing','safe','debts','expenses','generalExpenses','closingSheet','salaries','payroll','capital','purchases','report','settings','security','edit','delete','print','addDebt','addWithdraw','addExpense','addGeneralExpense','export','import'];
        const admin={id:uid(),username,passwordHash:hash,role:'admin',permissions:allPerms};
        saveUsers([admin]);
        setSession({id:admin.id,username:admin.username,role:'admin',permissions:allPerms});
        toast('تم إنشاء حساب المسؤول');
        hideLogin();return;
    }
    const hash=await hashPwd(password);
    const user=users.find(u=>u.username===username&&u.passwordHash===hash);
    if(!user)return toast('بيانات خاطئة');
    setSession({id:user.id,username:user.username,role:user.role,permissions:user.permissions});
    hideLogin();
}
function hideLogin(){
    $('#loginOverlay').classList.add('hidden');
    $('#app').style.display='';
    initApp();
}
function logout(){
    showCustomDialog({
        icon:'ri-logout-box-r-line',
        iconClass:'logout-icon',
        title:'تسجيل الخروج',
        msg:'هل تريد تسجيل الخروج من حسابك؟',
        buttons:[
            {label:'<i class="ri-logout-box-r-line"></i> تسجيل الخروج',cls:'btn-danger',action:'confirmLogout()'},
            {label:'إلغاء',cls:'btn-ghost',action:'hideDialog()'}
        ]
    });
}
function confirmLogout(){hideDialog();clearSession();location.reload();}
function checkAuth(){
    const session=getSession();const users=loadUsers();
    if(users.length===0||!session){showLogin();return false;}
    const user=users.find(u=>u.id===session.id);
    if(!user){clearSession();showLogin();return false;}
    return true;
}

/* ========= data store ========= */
const KEYS={closings:'cm_closings',safe:'cm_safe',debts:'cm_debts',employees:'cm_employees',
    capital:'cm_capital',purchases:'cm_purchases',withdrawals:'cm_withdrawals',
    settings:'cm_settings',payroll:'cm_payroll',expenseEntries:'cm_expenseEntries',
    individualClosings:'cm_individual_closings',cashierAccounts:'cm_cashier_accounts'};
const SYNC_KEYS_MAP={
    'cm_closings':'closings_data','cm_safe':'safe','cm_debts':'debts','cm_employees':'employees',
    'cm_purchases':'purchases','cm_withdrawals':'withdrawals','cm_settings':'settings',
    'cm_payroll':'payroll','cm_expenseEntries':'expenseEntries',
    'cm_individual_closings':'individualClosings','cm_cashier_accounts':'cashierAccounts'
};
let _syncingFromFirebase=false;
const _recentSaves={};
function loadData(k){try{return JSON.parse(localStorage.getItem(k))||[];}catch(e){return[];}}
function saveData(k,v){localStorage.setItem(k,JSON.stringify(v));_recentSaves[k]=Date.now();if(!_syncingFromFirebase)syncDataToFirebase(k,v);}
function loadSettings(){try{return JSON.parse(localStorage.getItem(KEYS.settings))||{};}catch(e){return {};}}
function saveSettings(s){localStorage.setItem(KEYS.settings,JSON.stringify(s));_recentSaves[KEYS.settings]=Date.now();if(!_syncingFromFirebase)syncDataToFirebase(KEYS.settings,s);}

/* ========= MULTI-SELECT / BULK DELETE ========= */
let _multiSelectMode={};/* {pageKey: true/false} */
let _selectedIds={};/* {pageKey: Set} */
function toggleMultiSelect(pageKey,listSelector,renderFn){
    _multiSelectMode[pageKey]=!_multiSelectMode[pageKey];
    if(!_multiSelectMode[pageKey]){_selectedIds[pageKey]=new Set();}
    else{_selectedIds[pageKey]=_selectedIds[pageKey]||new Set();}
    renderFn();
    _updateBulkBar(pageKey);
}
function _isMultiSelect(pageKey){return !!_multiSelectMode[pageKey];}
function _toggleSelectItem(pageKey,id,renderFn){
    if(!_selectedIds[pageKey])_selectedIds[pageKey]=new Set();
    if(_selectedIds[pageKey].has(id))_selectedIds[pageKey].delete(id);
    else _selectedIds[pageKey].add(id);
    renderFn();
    _updateBulkBar(pageKey);
}
function _selectAll(pageKey,ids,renderFn){
    _selectedIds[pageKey]=new Set(ids);
    renderFn();
    _updateBulkBar(pageKey);
}
function _deselectAll(pageKey,renderFn){
    _selectedIds[pageKey]=new Set();
    renderFn();
    _updateBulkBar(pageKey);
}
function _updateBulkBar(pageKey){
    const bar=document.getElementById('bulkBar-'+pageKey);
    if(!bar)return;
    const sel=_selectedIds[pageKey]||new Set();
    if(_multiSelectMode[pageKey]&&sel.size>0){
        bar.classList.remove('hidden');
        bar.querySelector('.bulk-count').textContent=sel.size+' محدد';
    }else{bar.classList.add('hidden');}
}
function bulkDelete(pageKey,dataKey,renderFn){
    const sel=_selectedIds[pageKey];
    if(!sel||sel.size===0)return toast('لا يوجد عناصر محددة');
    showCustomDialog({icon:'ri-delete-bin-line',iconClass:'red',title:'حذف متعدد',msg:`هل تريد حذف ${sel.size} عنصر؟`,buttons:[
        {label:'حذف',cls:'btn-danger',action:`_confirmBulkDelete('${pageKey}','${dataKey}')`},
        {label:'إلغاء',cls:'btn-ghost',action:'hideDialog()'}
    ]});
}
function _confirmBulkDelete(pageKey,dataKey){
    hideDialog();
    const sel=_selectedIds[pageKey];
    let data=loadData(dataKey);
    data=data.filter(item=>!sel.has(item.id));
    saveData(dataKey,data);
    _selectedIds[pageKey]=new Set();
    _multiSelectMode[pageKey]=false;
    /* re-render the page */
    const renderMap={payroll:renderPayroll,expenses:renderExpenses,debts:renderDebts,safe:renderSafe,capital:renderCapital,purchases:renderPurchases,genexp:renderGeneralExpenses,closings:renderClosings};
    if(renderMap[pageKey])renderMap[pageKey]();
    toast('تم الحذف');
}
function _multiSelectCheckbox(pageKey,id,renderFnName){
    if(!_isMultiSelect(pageKey))return '';
    const checked=(_selectedIds[pageKey]&&_selectedIds[pageKey].has(id))?'checked':'';
    return `<input type="checkbox" class="bulk-cb" ${checked} onclick="event.stopPropagation();_toggleSelectItem('${pageKey}','${id}',${renderFnName})" style="width:18px;height:18px;margin-inline-end:8px;cursor:pointer;accent-color:var(--primary)">`;
}
function _multiSelectBar(pageKey,dataKey,allIds,renderFnName){
    const active=_isMultiSelect(pageKey);
    let html=`<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap">`;
    html+=`<button class="btn btn-sm ${active?'btn-warning':'btn-ghost'}" onclick="toggleMultiSelect('${pageKey}',null,${renderFnName})"><i class="ri-checkbox-multiple-line"></i> ${active?'إلغاء التحديد':'تحديد'}</button>`;
    if(active){
        html+=`<button class="btn btn-sm btn-primary" onclick="_selectAll('${pageKey}',[${allIds.map(id=>"'"+id+"'").join(',')}],${renderFnName})"><i class="ri-check-double-line"></i> تحديد الكل</button>`;
        html+=`<button class="btn btn-sm btn-ghost" onclick="_deselectAll('${pageKey}',${renderFnName})">إلغاء الكل</button>`;
    }
    html+=`</div>`;
    html+=`<div id="bulkBar-${pageKey}" class="bulk-bar ${(_selectedIds[pageKey]&&_selectedIds[pageKey].size>0)?'':'hidden'}"><span class="bulk-count">${(_selectedIds[pageKey]||new Set()).size} محدد</span><button class="btn btn-danger btn-sm" onclick="bulkDelete('${pageKey}','${dataKey}',${renderFnName})"><i class="ri-delete-bin-line"></i> حذف المحدد</button></div>`;
    return html;
}

/* ========= Firebase Integration ========= */
const firebaseConfig = {
    apiKey: "AIzaSyBF3_iG2b8gYz-qoz4rQV95MrlWQHNPu98",
    authDomain: "taqfela-pro.firebaseapp.com",
    databaseURL: "https://taqfela-pro-default-rtdb.firebaseio.com",
    projectId: "taqfela-pro",
    storageBucket: "taqfela-pro.firebasestorage.app",
    messagingSenderId: "1058350153841",
    appId: "1:1058350153841:web:baeb3fafd8f224ff145bd0",
    measurementId: "G-3TH5EWJ2SV"
};
let fbApp, fbDb;
try { fbApp = firebase.initializeApp(firebaseConfig); fbDb = firebase.database(); } catch(e){ console.warn('Firebase init failed:', e); }

/* ========= FIREBASE FULL SYNC SYSTEM ========= */
function syncDataToFirebase(localKey, data){
    if(!fbDb) return;
    const fbKey = SYNC_KEYS_MAP[localKey];
    if(!fbKey) return;
    fbDb.ref('store_data/'+fbKey).set(data).catch(e=>console.warn('Sync failed for '+fbKey+':',e));
}

function syncUsersToFirebase(){
    if(!fbDb) return;
    const users=loadUsers();
    fbDb.ref('store_data/users').set(users).catch(e=>console.warn('Sync users failed:',e));
}

async function initFirebaseSync(){
    if(!fbDb) return;
    try{
        const snap=await fbDb.ref('store_data').once('value');
        const remoteData=snap.val();
        if(remoteData){
            _syncingFromFirebase=true;
            let needsUpload=false;
            Object.entries(SYNC_KEYS_MAP).forEach(([localKey,fbKey])=>{
                if(remoteData[fbKey]===undefined||remoteData[fbKey]===null) return;
                if(localKey===KEYS.settings){
                    const local=loadSettings();
                    const remote=typeof remoteData[fbKey]==='object'?remoteData[fbKey]:{};
                    localStorage.setItem(localKey,JSON.stringify(Object.assign({},remote,local)));
                } else {
                    const localItems=loadData(localKey);
                    const remoteItems=Array.isArray(remoteData[fbKey])?remoteData[fbKey]:Object.values(remoteData[fbKey]||{});
                    if(!localItems.length){
                        localStorage.setItem(localKey,JSON.stringify(remoteItems));
                    } else if(remoteItems.length){
                        const merged={};
                        localItems.forEach(item=>{if(item&&item.id)merged[item.id]=item;});
                        remoteItems.forEach(item=>{if(item&&item.id&&!merged[item.id])merged[item.id]=item;});
                        const mergedArr=Object.values(merged);
                        if(mergedArr.length>localItems.length||mergedArr.length>remoteItems.length) needsUpload=true;
                        localStorage.setItem(localKey,JSON.stringify(mergedArr));
                    }
                }
            });
            if(remoteData.users){
                const localUsers=loadUsers();
                const remoteUsers=Array.isArray(remoteData.users)?remoteData.users:Object.values(remoteData.users||{});
                if(!localUsers.length){
                    localStorage.setItem(AUTH_KEYS.users,JSON.stringify(remoteUsers));
                } else if(remoteUsers.length){
                    const merged={};
                    localUsers.forEach(u=>{if(u&&u.id)merged[u.id]=u;});
                    remoteUsers.forEach(u=>{if(u&&u.id&&!merged[u.id])merged[u.id]=u;});
                    const mergedUsers=Object.values(merged);
                    if(mergedUsers.length>0) localStorage.setItem(AUTH_KEYS.users,JSON.stringify(mergedUsers));
                    if(mergedUsers.length>localUsers.length||mergedUsers.length>remoteUsers.length) needsUpload=true;
                }
            }
            _syncingFromFirebase=false;
            if(needsUpload) uploadAllToFirebase();
        } else {
            uploadAllToFirebase();
        }
    }catch(e){console.warn('Firebase sync init failed:',e);}
    startSyncListeners();
    startNotificationListener();
    refreshActivePage();
}

function uploadAllToFirebase(){
    if(!fbDb) return;
    const data={};
    Object.entries(SYNC_KEYS_MAP).forEach(([localKey,fbKey])=>{
        data[fbKey]=localKey===KEYS.settings?loadSettings():loadData(localKey);
    });
    data.users=loadUsers();
    fbDb.ref('store_data').set(data).catch(e=>console.warn('Upload failed:',e));
}

function manualUploadAll(){
    if(!fbDb) return toast('لا يوجد اتصال بقاعدة البيانات');
    showCustomDialog({
        icon:'ri-upload-cloud-2-fill',
        iconClass:'',
        title:'رفع البيانات',
        msg:'سيتم رفع جميع البيانات المحلية إلى قاعدة البيانات وستحل محل البيانات الموجودة. هل تريد المتابعة؟',
        buttons:[
            {label:'<i class="ri-upload-cloud-2-line"></i> رفع الآن',cls:'btn-primary',action:'confirmManualUpload()'},
            {label:'إلغاء',cls:'btn-ghost',action:'hideDialog()'}
        ]
    });
}
function confirmManualUpload(){
    hideDialog();
    uploadAllToFirebase();
    syncUsersToFirebase();
    syncCashierAccounts();
    toast('تم رفع جميع البيانات بنجاح');
}

function manualDownloadAll(){
    if(!fbDb) return toast('لا يوجد اتصال بقاعدة البيانات');
    showCustomDialog({
        icon:'ri-download-cloud-2-fill',
        iconClass:'',
        title:'تنزيل البيانات',
        msg:'سيتم تنزيل جميع البيانات من السيرفر وستحل محل البيانات المحلية. هل تريد المتابعة؟',
        buttons:[
            {label:'<i class="ri-download-cloud-2-line"></i> تنزيل الآن',cls:'btn-success',action:'confirmManualDownload()'},
            {label:'إلغاء',cls:'btn-ghost',action:'hideDialog()'}
        ]
    });
}
function confirmManualDownload(){
    hideDialog();
    if(!fbDb) return toast('لا يوجد اتصال');
    fbDb.ref('store_data').once('value').then(snap=>{
        const remoteData=snap.val();
        if(!remoteData) return toast('لا توجد بيانات في السيرفر');
        _syncingFromFirebase=true;
        Object.entries(SYNC_KEYS_MAP).forEach(([localKey,fbKey])=>{
            if(remoteData[fbKey]!==undefined&&remoteData[fbKey]!==null){
                localStorage.setItem(localKey,JSON.stringify(remoteData[fbKey]));
            }
        });
        if(remoteData.users){
            localStorage.setItem(AUTH_KEYS.users,JSON.stringify(remoteData.users));
        }
        _syncingFromFirebase=false;
        refreshActivePage();
        toast('تم تنزيل جميع البيانات بنجاح');
    }).catch(e=>{toast('فشل التنزيل');console.warn(e);});
}

function startSyncListeners(){
    if(!fbDb) return;
    Object.entries(SYNC_KEYS_MAP).forEach(([localKey,fbKey])=>{
        fbDb.ref('store_data/'+fbKey).on('value',snap=>{
            if(_recentSaves[localKey]&&(Date.now()-_recentSaves[localKey])<5000) return;
            const data=snap.val();
            if(data!==undefined&&data!==null){
                _syncingFromFirebase=true;
                localStorage.setItem(localKey,JSON.stringify(data));
                _syncingFromFirebase=false;
                refreshActivePage();
            }
        });
    });
    fbDb.ref('store_data/users').on('value',snap=>{
        if(_recentSaves[AUTH_KEYS.users]&&(Date.now()-_recentSaves[AUTH_KEYS.users])<5000) return;
        const users=snap.val();
        if(users){
            _syncingFromFirebase=true;
            localStorage.setItem(AUTH_KEYS.users,JSON.stringify(users));
            _syncingFromFirebase=false;
        }
    });
}

function refreshActivePage(){
    const activePage=document.querySelector('.page.active');
    if(!activePage) return;
    const pid=activePage.id.replace('page-','');
    const r={closing:renderClosings,safe:renderSafe,debts:renderDebts,expenses:renderExpenses,
        salaries:renderSalaries,payroll:renderPayroll,capital:renderCapital,purchases:renderPurchases,
        report:renderReport,settings:renderSettings,security:renderSecurity,individual:renderIndividual,
        generalExpenses:renderGeneralExpenses,closingSheet:renderClosingSheet};
    if(r[pid])try{r[pid]();}catch(e){}
    if(pid==='home'){
        const secTile=$('#securityTile');if(secTile)secTile.style.display=isAdmin()?'':'none';
    }
}

/* ========= NOTIFICATION SYSTEM ========= */
const NOTIF_KEY='cm_notifications';

function loadNotifications(){try{return JSON.parse(localStorage.getItem(NOTIF_KEY))||[];}catch(e){return[];}}
function saveNotificationsLocal(notifs){localStorage.setItem(NOTIF_KEY,JSON.stringify(notifs));}

function startNotificationListener(){
    if(!fbDb) return;
    fbDb.ref('notifications').orderByChild('targetApp').equalTo('main').on('child_added',snap=>{
        const notif=snap.val();
        if(!notif) return;
        const notifs=loadNotifications();
        if(notifs.find(n=>n.id===notif.id)) return;
        notifs.unshift(notif);
        saveNotificationsLocal(notifs);
        updateNotifBadge();
        if(notif.type==='new_closing') toast('📥 تقفيلة جديدة من '+notif.cashierLabel);
        else if(notif.type==='alert_response') toast('📩 رد على التنبيه من '+notif.senderUser);
    });
}

function updateNotifBadge(){
    const notifs=loadNotifications();
    const unread=notifs.filter(n=>!n.read).length;
    const badge=$('#notifBadge');
    if(badge){badge.textContent=unread;badge.style.display=unread>0?'':'none';}
}

function toggleNotifPanel(){
    const panel=$('#notifPanel');
    if(!panel) return;
    if(!panel.classList.contains('open')){
        renderNotifPanel();
        panel.classList.add('open');
    } else {
        panel.classList.remove('open');
    }
}

function renderNotifPanel(){
    const notifs=loadNotifications();
    const unread=notifs.filter(n=>!n.read);
    const list=$('#notifList');
    if(!list) return;
    if(!unread.length){
        list.innerHTML='<div class="empty-state" style="padding:20px"><i class="ri-notification-off-line"></i><p>لا توجد إشعارات جديدة</p></div>';
        return;
    }
    list.innerHTML=unread.slice(0,50).map(n=>{
        const timeAgo=getTimeAgo(n.timestamp);
        const icon=n.type==='new_closing'?'ri-calculator-line':n.type==='alert_response'?'ri-chat-check-line':'ri-notification-3-line';
        const statusHtml=n.type==='alert_response'?`<span class="notif-status resolved"><i class="ri-check-line"></i> تم الرد</span>`:'';
        return `<div class="notif-item notif-unread" onclick="handleNotifClick('${n.id}')">
            <div class="notif-icon"><i class="${icon}"></i></div>
            <div class="notif-content">
                <div class="notif-title">${escapeHtml(n.title||'')}</div>
                <div class="notif-msg">${escapeHtml(n.message||'')}</div>
                ${statusHtml}
                <div class="notif-time">${timeAgo}</div>
            </div>
        </div>`;
    }).join('');
}

function escapeHtml(str){return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function handleNotifClick(id){
    const notifs=loadNotifications();
    const notif=notifs.find(n=>n.id===id);
    if(!notif) return;
    notif.read=true;
    saveNotificationsLocal(notifs);
    updateNotifBadge();
    renderNotifPanel();
    const panel=$('#notifPanel');if(panel)panel.classList.remove('open');
    if(notif.type==='new_closing') navigate('individual');
    else if(notif.type==='alert_response') navigate('individual');
}

function markAllNotifsRead(){
    const notifs=loadNotifications();
    notifs.forEach(n=>n.read=true);
    saveNotificationsLocal(notifs);
    updateNotifBadge();
    renderNotifPanel();
}

function clearAllNotifs(){
    saveNotificationsLocal([]);
    updateNotifBadge();
    renderNotifPanel();
}

function getTimeAgo(ts){
    if(!ts) return '';
    const diff=Date.now()-ts;
    const mins=Math.floor(diff/60000);
    if(mins<1) return 'الآن';
    if(mins<60) return mins+' دقيقة';
    const hrs=Math.floor(mins/60);
    if(hrs<24) return hrs+' ساعة';
    const days=Math.floor(hrs/24);
    if(days<30) return days+' يوم';
    return Math.floor(days/30)+' شهر';
}

/* ========= ALERT SYSTEM (Main → Cashier) ========= */
function openSendAlert(closingId){
    const cl=loadData(KEYS.individualClosings).find(c=>c.id===closingId);
    if(!cl) return;
    const html=`
        <div style="text-align:center;margin-bottom:12px">
            <div style="font-weight:700;color:var(--primary);margin-bottom:4px"><i class="ri-send-plane-fill"></i> إرسال تنبيه للكاشير</div>
            <div style="font-size:.82rem;color:var(--text2)">${cl.cashierLabel} - ${cl.date}</div>
        </div>
        <div class="field"><label>نوع التنبيه</label>
            <select id="alertType" class="input-field">
                <option value="shortage">نقص في التقفيلة</option>
                <option value="error">خطأ في البيانات</option>
                <option value="note">ملاحظة عامة</option>
            </select>
        </div>
        <div class="field"><label>الملاحظة</label>
            <textarea id="alertMessage" class="input-field" rows="3" placeholder="اكتب ملاحظتك هنا..."></textarea>
        </div>`;
    openModal('إرسال تنبيه',html,`<button class="btn btn-primary" onclick="confirmSendAlert('${closingId}')"><i class="ri-send-plane-line"></i> إرسال</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}

function confirmSendAlert(closingId){
    if(!fbDb) return toast('لا يوجد اتصال بقاعدة البيانات');
    const cl=loadData(KEYS.individualClosings).find(c=>c.id===closingId);
    if(!cl) return;
    const alertType=$('#alertType')?.value||'note';
    const message=$('#alertMessage')?.value?.trim();
    if(!message) return toast('اكتب الملاحظة');
    const typeLabels={shortage:'نقص في التقفيلة',error:'خطأ في البيانات',note:'ملاحظة'};
    const alertId=uid();
    const alertData={
        id:alertId,
        type:'alert_shortage',
        alertType:alertType,
        title:typeLabels[alertType]||'تنبيه',
        message:message,
        closingId:closingId,
        closingDate:cl.date,
        cashierKey:cl.cashierKey,
        cashierLabel:cl.cashierLabel,
        timestamp:Date.now(),
        targetApp:'cashier',
        targetCashierType:cl.cashierKey,
        read:false,
        status:'pending',
        senderUser:getByTag()
    };
    fbDb.ref('notifications/'+alertId).set(alertData).then(()=>{
        toast('تم إرسال التنبيه بنجاح');
        closeModal();
    }).catch(e=>{toast('فشل إرسال التنبيه');console.warn(e);});
}

function startFirebaseListener(){
    if(!fbDb) return;
    fbDb.ref('closings').on('child_added', snap => {
        const remote = snap.val();
        if(!remote || remote.source !== 'cashier-app') return;
        importRemoteClosing(remote);
    });
}

function importRemoteClosing(remote){
    /* check if already imported in individual closings */
    const individuals = loadData(KEYS.individualClosings);
    if(individuals.find(c => c.id === remote.id || c.firebaseId === remote.id)) return;
    /* also check old cm_closings for backward compat */
    const closings = loadData(KEYS.closings);
    if(closings.find(c => c.firebaseId === remote.id)) return;

    const cashierMap = {men:'men',women:'women',cosmetics:'cosmetics'};
    const ck = cashierMap[remote.cashierKey];
    if(!ck) return;

    const date = remote.date || today();
    const by = remote.cashierLabel || '';
    const d = remote.data || {};

    /* save individual closing record */
    individuals.push({
        id: uid(),
        firebaseId: remote.id,
        cashierKey: ck,
        cashierLabel: remote.cashierLabel || '',
        date: date,
        manager: remote.manager || '',
        data: {...d},
        debtsList: remote.debtsList || [],
        withdrawList: remote.withdrawList || [],
        expensesList: remote.expensesList || [],
        net: calcCashierNet(d).net,
        by: by,
        timestamp: remote.timestamp || Date.now(),
        source: 'cashier-app'
    });
    saveData(KEYS.individualClosings, individuals);

    /* save debts */
    const debts = loadData(KEYS.debts);
    (remote.debtsList||[]).forEach(debt => {
        debts.push({id:uid(),person:debt.person,amount:debt.amount,note:debt.note||'',type:'debt',cashier:remote.cashierLabel,date:date,by:by});
    });
    saveData(KEYS.debts, debts);

    /* save withdrawals */
    const withdrawals = loadData(KEYS.withdrawals);
    const debts2 = loadData(KEYS.debts);
    (remote.withdrawList||[]).forEach(w => {
        withdrawals.push({id:uid(),person:w.person,amount:w.amount,note:w.note||'',cashier:remote.cashierLabel,date:date,by:by});
        debts2.push({id:uid(),person:w.person,amount:w.amount,note:'سحب: '+(w.note||''),type:'withdraw',cashier:remote.cashierLabel,date:date,by:by});
    });
    saveData(KEYS.withdrawals, withdrawals);
    saveData(KEYS.debts, debts2);

    /* save expense entries */
    const expEntries = loadData(KEYS.expenseEntries);
    (remote.expensesList||[]).forEach(exp => {
        expEntries.push({id:uid(),amount:exp.amount,desc:exp.desc||'',type:exp.type||'dept',cashier:remote.cashierLabel,date:date,by:by});
    });
    saveData(KEYS.expenseEntries, expEntries);

    /* merge individual closings for this date into one combined closing */
    mergeIndividualClosings(date);

    toast('تقفيلة جديدة من '+remote.cashierLabel);

    /* create notification */
    if(fbDb){
        const notifId=uid();
        fbDb.ref('notifications/'+notifId).set({
            id:notifId,type:'new_closing',title:'تقفيلة جديدة',
            message:remote.cashierLabel+' - '+remote.date+(remote.manager?' ('+remote.manager+')':''),
            closingId:remote.id,closingDate:remote.date,
            cashierLabel:remote.cashierLabel,cashierKey:remote.cashierKey,
            timestamp:Date.now(),targetApp:'main',read:false,
            senderUser:remote.manager||''
        }).catch(e=>console.warn('Notif create failed:',e));
    }

    /* refresh current page */
    const activePage = document.querySelector('.page.active');
    if(activePage){
        const pid = activePage.id.replace('page-','');
        const r = {closing:renderClosings,safe:renderSafe,debts:renderDebts,expenses:renderExpenses,capital:renderCapital,report:renderReport,individual:renderIndividual,generalExpenses:renderGeneralExpenses,closingSheet:renderClosingSheet};
        if(r[pid]) r[pid]();
    }
}

function mergeIndividualClosings(date){
    const individuals = loadData(KEYS.individualClosings);
    const dateClosings = individuals.filter(c => c.date === date);
    if(!dateClosings.length) return;

    /* get latest closing per cashier type for this date */
    const byCashier = {};
    dateClosings.forEach(c => {
        if(!byCashier[c.cashierKey] || c.timestamp > (byCashier[c.cashierKey].timestamp||0)){
            byCashier[c.cashierKey] = c;
        }
    });

    /* build merged closing */
    const cashiersData = {};
    let totalNet = 0;
    let manager = '';
    CASHIERS.forEach(c => {
        const ind = byCashier[c.key];
        if(ind){
            const dd = ind.data || {};
            const r = calcCashierNet(dd);             // الحساب الصحيح
            cashiersData[c.key] = {
                sales:dd.sales||0, network:dd.network||0, returns:dd.returns||0,
                expenses:dd.expenses||0, lunch:dd.lunch||0, debts:dd.debts||0,
                withdrawals:dd.withdrawals||0,
                debtsList:ind.debtsList||[], withdrawList:ind.withdrawList||[],
                expensesList:ind.expensesList||[], net:r.net,
                manager:ind.manager||''
            };
            totalNet += r.net;
            if(ind.manager && !manager) manager = ind.manager;
        } else {
            cashiersData[c.key] = {sales:0,network:0,returns:0,expenses:0,lunch:0,debts:0,withdrawals:0,debtsList:[],withdrawList:[],expensesList:[],net:0,manager:''};
        }
    });

    /* remove existing merged closing ONLY for this exact date from cashier-app source */
    let closings = loadData(KEYS.closings);
    if(!Array.isArray(closings)) closings = [];
    // Extra safety: only remove if date is exact string match AND source is cashier-app
    const normalizedDate = String(date).slice(0,10); // ensure YYYY-MM-DD format
    const oldMerged = closings.find(c => String(c.date).slice(0,10) === normalizedDate && c.source === 'cashier-app');
    closings = closings.filter(c => !(String(c.date).slice(0,10) === normalizedDate && c.source === 'cashier-app'));
    const mergedId = oldMerged ? oldMerged.id : uid();
    closings.push({
        id: mergedId, date: normalizedDate, manager: manager,
        cashiers: cashiersData, totalNet: totalNet,
        by: 'تقفيلة مدمجة', source: 'cashier-app',
        updatedAt: Date.now()
    });
    saveData(KEYS.closings, closings);

    /* update safe: remove old merged safe entry ONLY for this exact date */
    let safe = loadData(KEYS.safe);
    if(!Array.isArray(safe)) safe = [];
    safe = safe.filter(t => !(String(t.date).slice(0,10) === normalizedDate && t.mergedClosing === true));
    if(totalNet !== 0){
        safe.push({id:uid(),date:normalizedDate,type:totalNet>0?'deposit':'withdraw',amount:Math.abs(totalNet),
            note:'تقفيلة مدمجة '+normalizedDate+(manager?' - المدير: '+manager:''),by:'تقفيلة مدمجة',mergedClosing:true});
    }
    saveData(KEYS.safe, safe);
}

/* ========= navigation ========= */
/* ========= navigation with history API (back button support) ========= */
let _navStack=['home'];           /* مكدس الصفحات داخلياً */
let _navInProgress=false;          /* لمنع التكرار */

function navigate(page, fromPopState){
    const user=getCurrentUser();
    if(user&&page!=='home'){
        if(page==='security'){if(!isAdmin()){toast('غير مصرح');return;}}
        else if(user.role!=='admin'&&user.permissions&&!user.permissions.includes(page)){toast('غير مصرح لك بالدخول');return;}
    }
    /* reset search state when navigating */
    const gs=$('#globalSearch');const gsr=$('#globalSearchResults');const hg=$('#homeGrid');
    if(gs)gs.value='';
    if(gsr)gsr.style.display='none';
    if(hg)hg.style.display='';
    const tbs=$('#topbarSearch');if(tbs)tbs.value='';

    $$('.page').forEach(p=>p.classList.remove('active'));
    const el=$('#page-'+page);if(el)el.classList.add('active');
    $$('.sb-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
    $$('.bn-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
    const titles={home:'لوحة التحكم',closing:'التقفيلة',individual:'التقفيلات المنفصلة',safe:'الخزنة',debts:'الديون',expenses:'المصاريف',generalExpenses:'المصاريف العامة',closingSheet:'كشف الحسابات',salaries:'الرواتب',payroll:'صرف الرواتب',capital:'رأس المال',purchases:'المشتريات',salaryAdvances:'سحوبات الرواتب',profitLoss:'تحليل الأرباح',report:'التقرير الشهري',settings:'الإعدادات',security:'الحماية والمستخدمين'};
    $('#topbarTitle').textContent=titles[page]||'لوحة التحكم';
    closeSidebar();
    const r={closing:renderClosings,individual:renderIndividual,safe:renderSafe,debts:renderDebts,expenses:renderExpenses,generalExpenses:renderGeneralExpenses,closingSheet:renderClosingSheet,salaries:renderSalaries,payroll:renderPayroll,capital:renderCapital,purchases:renderPurchases,salaryAdvances:renderSalaryAdvances,profitLoss:renderProfitLoss,report:renderReport,settings:renderSettings,security:renderSecurity};
    if(r[page])r[page]();
    if(page==='home'){
        const secTile=$('#securityTile');if(secTile)secTile.style.display=isAdmin()?'':'none';
    }

    /* إدارة التاريخ - push state فقط إن لم تكن العملية من popstate */
    if(!fromPopState && !_navInProgress){
        try{
            history.pushState({page},'','#'+page);
            if(_navStack[_navStack.length-1]!==page) _navStack.push(page);
        }catch(e){console.warn('pushState failed',e);}
    }
}

/* استقبال زر الرجوع في الهاتف */
window.addEventListener('popstate', e=>{
    _navInProgress=true;
    try{
        const state=e.state;
        /* أي modal مفتوح - أغلقه أولاً بدلاً من الرجوع */
        const openModal=document.querySelector('.modal-overlay:not(.hidden)');
        if(openModal){
            closeModal();
            history.pushState({page:_currentPage()},'','#'+_currentPage());
            _navInProgress=false;
            return;
        }
        /* أي معالج تقفيلة مفتوح - أغلقه */
        const wizOverlay=document.getElementById('wizardOverlay');
        if(wizOverlay && !wizOverlay.classList.contains('hidden')){
            doCloseWizard();
            history.pushState({page:_currentPage()},'','#'+_currentPage());
            _navInProgress=false;
            return;
        }
        const indOverlay=document.getElementById('indWizOverlay');
        if(indOverlay && !indOverlay.classList.contains('hidden')){
            indOverlay.classList.add('hidden');
            document.body.classList.remove('wizard-open');
            history.pushState({page:_currentPage()},'','#'+_currentPage());
            _navInProgress=false;
            return;
        }
        /* تنقل عادي بين الصفحات */
        const targetPage=(state && state.page) || 'home';
        navigate(targetPage, true);
    }catch(err){console.error(err);}
    _navInProgress=false;
});

function _currentPage(){
    const active=document.querySelector('.page.active');
    return active?active.id.replace('page-',''):'home';
}
function closeSidebar(){if(window.innerWidth>=1024)return;$('#sidebar').classList.remove('open');$('#sbOverlay').classList.remove('show');}

/* ========= toast / modal / custom dialog ========= */
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),2200);}
function openModal(title,bodyHtml,footHtml){$('#modalTitle').textContent=title;$('#modalBody').innerHTML=bodyHtml;$('#modalFoot').innerHTML=footHtml||'';$('#modal').classList.remove('hidden');}
function closeModal(){$('#modal').classList.add('hidden');}
function showCustomDialog({icon,iconClass,title,msg,buttons}){
    const d=$('#customDialog');
    $('#dialogIcon').innerHTML=`<i class="${icon}"></i>`;
    $('#dialogIcon').className='custom-dialog-icon'+(iconClass?' '+iconClass:'');
    $('#dialogTitle').textContent=title;
    $('#dialogMsg').textContent=msg;
    let html='';
    buttons.forEach(b=>{html+=`<button class="btn ${b.cls||'btn-ghost'}" onclick="${b.action}">${b.label}</button>`;});
    $('#dialogActions').innerHTML=html;
    d.classList.remove('hidden');
}
function hideDialog(){$('#customDialog').classList.add('hidden');}

/* ========= date display ========= */
function showDate(){
    const d=new Date();
    const opts={weekday:'long',year:'numeric',month:'long',day:'numeric'};
    const s=d.toLocaleDateString('ar-SA',opts);
    $('#topbarDate').textContent=s;
    const cd=$('#closingDateDisplay');if(cd)cd.textContent=s;
    const id2=$('#individualDateDisplay');if(id2)id2.textContent=s;
}

/* ========= CASHIERS & FIELDS ========= */
const CASHIERS=[
    {key:'men',label:'كاشير الرجال',icon:'ri-men-line',color:'#6366f1'},
    {key:'women',label:'كاشير النساء',icon:'ri-women-line',color:'#ec4899'},
    {key:'cosmetics',label:'كاشير التجميل',icon:'ri-sparkling-line',color:'#f59e0b'}
];
const CASHIER_FIELDS=[
    {key:'sales',label:'رصيد الكاشير',icon:'ri-wallet-3-line',type:'income'},
    {key:'network',label:'المبلغ المستلم',icon:'ri-bank-card-line',type:'income'},
    {key:'returns',label:'التخفيضات',icon:'ri-arrow-go-back-line',type:'deduct'},
    {key:'expenses',label:'المصاريف',icon:'ri-money-dollar-box-line',type:'expense'},

    {key:'lunch',label:'الغداء',icon:'ri-restaurant-line',type:'expense'},
    {key:'debts',label:'الديون',icon:'ri-file-list-3-line',type:'debt'},
    {key:'withdrawals',label:'السحوبات',icon:'ri-hand-coin-line',type:'withdraw'}
];
const TOTAL_STEPS = CASHIERS.length * CASHIER_FIELDS.length + 2; // +1 manager +1 summary

/* ========= CENTRAL CALCULATION ENGINE ========= */
/* هذه هي الدالة الوحيدة والمعتمدة لحساب صافي كل كاشير.
   القاعدة:
     الصافي = المبيعات - (المرتجعات + المصاريف + الغداء + الديون + السحوبات)
   المبلغ المستلم (network) هو مجرد مرجع للمقارنة، ليس هو الصافي.
   الفرق = المبلغ المستلم - الصافي المحسوب (يدل على زيادة/نقص في الكاشير).
   الصافي قد يكون سالباً إذا زادت الخصومات عن المبيعات - وهذا مقصود.
*/
function calcCashierNet(d){
    if(!d) return {gross:0,deductions:0,net:0,network:0,diff:0};
    const gross      = Number(d.sales)       || 0;
    const returns    = Number(d.returns)     || 0;
    const expenses   = Number(d.expenses)    || 0;
    const lunch      = Number(d.lunch)       || 0;
    const debts      = Number(d.debts)       || 0;
    const withdraws  = Number(d.withdrawals) || 0;
    const network    = Number(d.network)     || 0;
    const deductions = returns + expenses + lunch + debts + withdraws;
    const net        = gross - deductions;            // may be negative
    const diff       = network - net;                 // actual - expected
    return {gross,deductions,net,network,diff,
            returns,expenses,lunch,debts,withdraws};
}

/* حساب إجمالي تقفيلة كاملة */
function calcClosingTotal(cl){
    if(!cl||!cl.cashiers) return 0;
    let t=0;
    CASHIERS.forEach(c=>{
        const d=cl.cashiers[c.key]; if(!d) return;
        t += calcCashierNet(d).net;
    });
    return t;
}

/* إعادة ترقيم حقل net داخل كل كاشير (للبيانات القديمة) */
function recomputeClosingInPlace(cl){
    if(!cl||!cl.cashiers) return cl;
    let total=0;
    CASHIERS.forEach(c=>{
        const d=cl.cashiers[c.key]; if(!d) return;
        const r=calcCashierNet(d);
        d.net=r.net;
        total+=r.net;
    });
    cl.totalNet=total;
    return cl;
}

/* ============================================================
   ترقية البيانات: تُستدعى مرة واحدة عند تشغيل التطبيق بعد التحديث.
   - تعيد حساب net/totalNet لكل تقفيلة بالصيغة الصحيحة
   - تعيد بناء معاملات الخزنة المرتبطة بالتقفيلات (مع الحفاظ على
     الإيداعات/السحوبات اليدوية غير المرتبطة)
   ============================================================ */
const DATA_VERSION_KEY='cm_data_version';
const CURRENT_DATA_VERSION=3;

function runDataUpgrade(){
    const current=Number(localStorage.getItem(DATA_VERSION_KEY)||0);
    if(current>=CURRENT_DATA_VERSION) return;

    try{
        console.log('[Upgrade] بدء ترقية البيانات من v'+current+' إلى v'+CURRENT_DATA_VERSION);

        /* ========= V2: إعادة حساب التقفيلات + مزامنة الخزنة ========= */
        if(current < 2){

        /* 1. إعادة حساب صوافي كل التقفيلات */
        const closings=loadData(KEYS.closings);
        let fixedCount=0;
        closings.forEach(cl=>{
            const oldTotal=cl.totalNet||0;
            recomputeClosingInPlace(cl);
            if(oldTotal!==cl.totalNet) fixedCount++;
        });
        saveData(KEYS.closings,closings);
        console.log('[Upgrade v2] تم إعادة احتساب '+fixedCount+' تقفيلة');

        /* 2. إعادة حساب التقفيلات الفردية */
        const inds=loadData(KEYS.individualClosings);
        inds.forEach(ind=>{
            if(ind.data) ind.net=calcCashierNet(ind.data).net;
        });
        saveData(KEYS.individualClosings,inds);

        /* 3. إعادة بناء معاملات الخزنة المرتبطة بالتقفيلات */
        let safe=loadData(KEYS.safe);
        const manualSafe=safe.filter(t=>{
            if(t.closingId) return false;
            const note=(t.note||'').trim();
            if(note.startsWith('تقفيلة ')) return false;
            return true;
        });
        const closingSafe=[];
        closings.forEach(cl=>{
            if(!cl.totalNet || cl.totalNet===0) return;
            const safeId=cl.safeLinkId || uid();
            cl.safeLinkId=safeId;
            closingSafe.push({
                id:safeId,
                date:cl.date,
                type:cl.totalNet>0?'deposit':'withdraw',
                amount:Math.abs(cl.totalNet),
                note:'تقفيلة '+cl.date+(cl.manager?' - المدير: '+cl.manager:''),
                by:cl.by||'',
                closingId:cl.id,
                mergedClosing:cl.source==='cashier-app'
            });
        });
        saveData(KEYS.safe,[...manualSafe,...closingSafe]);
        saveData(KEYS.closings,closings);
        console.log('[Upgrade v2] تم إصلاح الخزنة');

        setTimeout(()=>{
            if(typeof toast==='function'){
                toast('✅ تم تحديث الحسابات - '+fixedCount+' تقفيلة');
            }
        },800);

        }

        /* ========= V3: إضافة type='dept' للمصاريف القديمة ========= */
        if(current < 3){
            const entries=loadData(KEYS.expenseEntries);
            let typeAdded=0;
            entries.forEach(e=>{
                if(!e.type){
                    e.type='dept';
                    typeAdded++;
                }
            });
            saveData(KEYS.expenseEntries,entries);
            console.log('[Upgrade v3] تم إضافة type=dept إلى '+typeAdded+' مصروف قديم');
        }

        localStorage.setItem(DATA_VERSION_KEY,String(CURRENT_DATA_VERSION));
    }catch(e){
        console.error('[Upgrade] فشل:',e);
    }
}

/* إعادة الترقية يدوياً (من الإعدادات) */
function forceRecomputeAll(){
    if(!confirm('سيتم إعادة حساب جميع التقفيلات وإصلاح الخزنة. هل تريد المتابعة؟')) return;
    localStorage.removeItem(DATA_VERSION_KEY);
    runDataUpgrade();
    toast('✅ تم إعادة الحساب بنجاح');
    if(typeof renderClosings==='function') renderClosings();
    if(typeof renderSafe==='function') renderSafe();
    if(typeof renderReport==='function' && $('#page-report')?.classList.contains('active')) renderReport();
}

/* ========= wizard state ========= */
let wizData={};
let wizStep=0;

function getStepInfo(step){
    if(step===0)return {type:'manager'};
    const fieldStep=step-1;
    const fieldCount=CASHIER_FIELDS.length;
    const summaryIdx=CASHIERS.length*fieldCount;
    if(fieldStep>=summaryIdx)return {type:'summary'};
    const ci=Math.floor(fieldStep/fieldCount);
    const fi=fieldStep%fieldCount;
    return {type:'field',cashier:CASHIERS[ci],field:CASHIER_FIELDS[fi]};
}

function startWizard(){
    wizData={manager:'',cashiers:{}};
    CASHIERS.forEach(c=>{
        wizData.cashiers[c.key]={};
        CASHIER_FIELDS.forEach(f=>wizData.cashiers[c.key][f.key]=0);
        wizData.cashiers[c.key].debtsList=[];
        wizData.cashiers[c.key].withdrawList=[];
        wizData.cashiers[c.key].expensesList=[];
    });
    wizStep=0;
    renderWizStep();
    $('#wizardOverlay').classList.remove('hidden');
    document.body.classList.add('wizard-open');
}
function closeWizard(){
    showCustomDialog({
        icon:'ri-door-open-line',
        iconClass:'exit-icon',
        title:'الخروج من التقفيلة',
        msg:'ماذا تريد أن تفعل؟',
        buttons:[
            {label:'<i class="ri-arrow-go-back-line"></i> خروج من التقفيلة',cls:'btn-warning',action:'doCloseWizard()'},
            {label:'<i class="ri-logout-box-r-line"></i> تسجيل خروج من الحساب',cls:'btn-danger',action:'doLogoutFromWizard()'},
            {label:'متابعة التقفيلة',cls:'btn-ghost',action:'hideDialog()'}
        ]
    });
}
function doCloseWizard(){
    hideDialog();
    $('#wizardOverlay').classList.add('hidden');
    document.body.classList.remove('wizard-open');
}
function doLogoutFromWizard(){
    hideDialog();
    $('#wizardOverlay').classList.add('hidden');
    document.body.classList.remove('wizard-open');
    clearSession();location.reload();
}

function renderWizStep(){
    const info=getStepInfo(wizStep);
    $('#wizProgress').textContent=`${wizStep+1}/${TOTAL_STEPS}`;
    $('#wizProgressFill').style.width=((wizStep+1)/TOTAL_STEPS*100)+'%';
    $('#wizBack').style.visibility=wizStep===0?'hidden':'visible';
    const isLast=wizStep===TOTAL_STEPS-1;
    $('#wizNext').innerHTML=isLast?'<i class="ri-save-line"></i> حفظ':'التالي <i class="ri-arrow-left-line"></i>';

    const body=$('#wizBody');

    if(info.type==='manager'){
        const settings=loadSettings();
        const managers=settings.managers||[];
        let opts=managers.map(m=>`<option value="${m}">${m}</option>`).join('');
        body.innerHTML=`
        <div class="wiz-cashier-label" style="color:var(--primary)"><i class="ri-user-star-line"></i> المدير المسؤول</div>
        <div class="debtor-selector">
            <input type="text" class="input-field" placeholder="🔍 بحث عن مدير..." style="margin-bottom:6px" oninput="filterPersonSelect('managerSelect',this.value)">
            <select id="managerSelect" class="input-field" onchange="onManagerSelect()">
                <option value="__new__">+ إضافة مدير جديد</option>
                <option value="">-- اختر المدير --</option>
                ${opts}
            </select>
            <div id="newManagerRow" style="display:none;margin-top:6px">
                <div class="debtor-add-row">
                    <input type="text" class="input-field" id="newManagerName" placeholder="اسم المدير الجديد">
                    <button class="btn btn-success btn-sm" onclick="confirmNewManager()">✓</button>
                </div>
            </div>
        </div>
        <p style="font-size:.8rem;color:var(--text3);margin-top:10px;text-align:center">يمكنك اختيار مدير محفوظ أو إضافة اسم جديد</p>`;
        if(wizData.manager){
            const sel=$('#managerSelect');
            if(sel){
                const exists=[...sel.options].some(o=>o.value===wizData.manager);
                if(exists)sel.value=wizData.manager;
                else{sel.value='__new__';$('#newManagerRow').style.display='block';setTimeout(()=>{const inp=$('#newManagerName');if(inp)inp.value=wizData.manager;},0);}
            }
        }
        return;
    }

    if(info.type==='summary'){
        renderWizSummary(body);
        return;
    }

    const {cashier,field}=info;
    const ck=cashier.key,fk=field.key;
    let extra='';
    if(fk==='debts'){
        extra=buildDebtEntryUI(ck);
    }else if(fk==='withdrawals'){
        extra=buildWithdrawEntryUI(ck);
    }else if(fk==='expenses'){
        extra=buildExpenseEntryUI(ck);
    }
    body.innerHTML=`
    <div class="wiz-cashier-label" style="color:${cashier.color}"><i class="${cashier.icon}"></i> ${cashier.label}</div>
    <div class="wiz-label"><i class="${field.icon}"></i> ${field.label} <span style="font-size:.75rem;color:var(--text3)">(بالآلاف)</span></div>
    <input type="number" class="wiz-input" id="wizInput" inputmode="decimal" value="${toK(wizData.cashiers[ck][fk])||''}" placeholder="0">
    ${extra}`;
    setTimeout(()=>{
        const inp=$('#wizInput');
        if(inp){
            inp.focus();
            inp.addEventListener('keydown',e=>{
                if(e.key==='Enter'){e.preventDefault();$('#wizNext').click();}
            });
        }
    },100);
}

function onManagerSelect(){
    const sel=$('#managerSelect');
    if(sel.value==='__new__'){
        $('#newManagerRow').style.display='block';
        setTimeout(()=>{const inp=$('#newManagerName');if(inp)inp.focus();},50);
    }else{
        $('#newManagerRow').style.display='none';
        wizData.manager=sel.value;
    }
}
function confirmNewManager(){
    const name=$('#newManagerName').value.trim();
    if(!name)return toast('أدخل اسم المدير');
    wizData.manager=name;
    const settings=loadSettings();
    if(!settings.managers)settings.managers=[];
    if(!settings.managers.includes(name)){settings.managers.push(name);saveSettings(settings);}
    toast('تم حفظ المدير: '+name);
    const sel=$('#managerSelect');
    const opt=document.createElement('option');opt.value=name;opt.textContent=name;
    sel.insertBefore(opt,sel.querySelector('option[value="__new__"]'));
    sel.value=name;
    $('#newManagerRow').style.display='none';
}

/* debt entry UI */
function buildDebtEntryUI(ck){
    const allDebts=loadData(KEYS.debts);
    const names=[...new Set(allDebts.map(d=>d.person))];
    let opts=names.map(n=>`<option value="${n}">${n}</option>`).join('');
    const list=wizData.cashiers[ck].debtsList||[];
    let items=list.map((d,i)=>`<div class="debt-item"><span>${d.person}: ${fmtNum(d.amount)}</span><button onclick="removeWizDebt('${ck}',${i})"><i class="ri-close-circle-line"></i></button></div>`).join('');
    return `<div class="wiz-debt-entry"><h4><i class="ri-file-list-3-line"></i> تفاصيل الديون</h4>
    <div class="debtor-selector">
        <input type="text" class="input-field" placeholder="🔍 بحث عن اسم..." style="margin-bottom:6px" oninput="filterPersonSelect('debtPersonSelect',this.value)">
        <select id="debtPersonSelect" class="input-field"><option value="__new__">+ اسم جديد</option><option value="">-- اختر المدين --</option>${opts}</select>
        <div id="newDebtPersonRow" class="debtor-add-row" style="display:none"><input type="text" class="input-field" id="newDebtPerson" placeholder="اسم المدين"><button class="btn btn-success btn-sm" onclick="confirmNewDebtPerson()">✓</button></div>
    </div>
    <input type="number" class="input-field" id="debtAmountInput" placeholder="المبلغ (بالآلاف)" inputmode="decimal" style="margin-top:6px">
    <input type="text" class="input-field" id="debtNoteInput" placeholder="ملاحظة (اختياري)" style="margin-top:6px">
    <button class="btn btn-primary btn-sm btn-block" onclick="addWizDebt('${ck}')" style="margin-top:8px"><i class="ri-add-line"></i> إضافة دين</button>
    <div class="debt-list">${items}</div></div>`;
}
function confirmNewDebtPerson(){
    const inp=$('#newDebtPerson');
    if(inp&&inp.value.trim()){
        const sel=$('#debtPersonSelect');
        const opt=document.createElement('option');opt.value=inp.value.trim();opt.textContent=inp.value.trim();
        sel.insertBefore(opt,sel.querySelector('option[value="__new__"]'));
        sel.value=inp.value.trim();
        $('#newDebtPersonRow').style.display='none';
    }
}
function addWizDebt(ck){
    const sel=$('#debtPersonSelect');
    if(sel&&sel.value==='__new__'){$('#newDebtPersonRow').style.display='flex';return;}
    const person=sel?sel.value:'';
    const amount=parseK($('#debtAmountInput')?.value);
    const note=$('#debtNoteInput')?.value||'';
    if(!person)return toast('اختر المدين');
    if(!amount)return toast('أدخل المبلغ');
    wizData.cashiers[ck].debtsList.push({person,amount,note});
    const total=wizData.cashiers[ck].debtsList.reduce((s,d)=>s+d.amount,0);
    wizData.cashiers[ck].debts=total;
    renderWizStep();
}
function removeWizDebt(ck,i){
    wizData.cashiers[ck].debtsList.splice(i,1);
    const total=wizData.cashiers[ck].debtsList.reduce((s,d)=>s+d.amount,0);
    wizData.cashiers[ck].debts=total;
    renderWizStep();
}

/* expense entry UI - with type selector (قسم/إدارة/عامة) */
function buildExpenseEntryUI(ck){
    const list=wizData.cashiers[ck].expensesList||[];
    const typeLabel=t=>t==='admin'?'<span style="color:#7c3aed;font-size:.7rem">[إدارة]</span>':t==='general'?'<span style="color:#0891b2;font-size:.7rem">[عامة]</span>':'<span style="color:var(--text2);font-size:.7rem">[قسم]</span>';
    let items=list.map((e,i)=>`<div class="debt-item"><span>${typeLabel(e.type||'dept')} ${e.desc||'مصروف'}: ${fmtNum(e.amount)}</span><button onclick="removeWizExpense('${ck}',${i})"><i class="ri-close-circle-line"></i></button></div>`).join('');
    return `<div class="wiz-debt-entry"><h4><i class="ri-money-dollar-box-line"></i> تفاصيل المصاريف</h4>
    <input type="number" class="input-field" id="expEntryAmountInput" placeholder="المبلغ (بالآلاف)" inputmode="decimal">
    <input type="text" class="input-field" id="expEntryDescInput" placeholder="وصف المصروف (مثال: مواد تنظيف)" style="margin-top:6px">
    <div style="margin-top:8px;display:flex;gap:4px;background:var(--surface2);border-radius:8px;padding:4px" id="expTypeBox_${ck}">
        <label class="exp-type-opt active" data-type="dept" style="flex:1;text-align:center;padding:6px 8px;cursor:pointer;border-radius:6px;background:var(--primary);color:#fff;font-size:.78rem;font-weight:700" onclick="selectExpType('${ck}','dept')"><i class="ri-store-line"></i> قسم</label>
        <label class="exp-type-opt" data-type="general" style="flex:1;text-align:center;padding:6px 8px;cursor:pointer;border-radius:6px;color:var(--text);font-size:.78rem;font-weight:700" onclick="selectExpType('${ck}','general')"><i class="ri-building-line"></i> عامة</label>
        <label class="exp-type-opt" data-type="admin" style="flex:1;text-align:center;padding:6px 8px;cursor:pointer;border-radius:6px;color:var(--text);font-size:.78rem;font-weight:700" onclick="selectExpType('${ck}','admin')"><i class="ri-user-star-line"></i> إدارة</label>
    </div>
    <div style="font-size:.72rem;color:var(--text2);margin-top:4px"><i class="ri-information-line"></i> "عامة/إدارة" لا تُخصم من صافي الكاشير، بل تُسجّل في <strong>المصاريف العامة</strong></div>
    <button class="btn btn-primary btn-sm btn-block" onclick="addWizExpense('${ck}')" style="margin-top:8px"><i class="ri-add-line"></i> إضافة مصروف</button>
    <div class="debt-list">${items}</div></div>`;
}
function selectExpType(ck,type){
    const box=document.getElementById('expTypeBox_'+ck);if(!box)return;
    box.querySelectorAll('.exp-type-opt').forEach(el=>{
        const isActive=el.dataset.type===type;
        el.classList.toggle('active',isActive);
        el.style.background=isActive?'var(--primary)':'transparent';
        el.style.color=isActive?'#fff':'var(--text)';
    });
    box.dataset.selected=type;
}
function addWizExpense(ck){
    const amount=parseK($('#expEntryAmountInput')?.value);
    const desc=$('#expEntryDescInput')?.value||'';
    if(!amount)return toast('أدخل المبلغ');
    const box=document.getElementById('expTypeBox_'+ck);
    const type=(box&&box.dataset.selected)||'dept';
    wizData.cashiers[ck].expensesList.push({amount,desc,type});
    /* expenses field = only dept expenses (these deduct from cashier net) */
    const deptTotal=wizData.cashiers[ck].expensesList.filter(e=>(e.type||'dept')==='dept').reduce((s,e)=>s+e.amount,0);
    wizData.cashiers[ck].expenses=deptTotal;
    renderWizStep();
}
function removeWizExpense(ck,i){
    wizData.cashiers[ck].expensesList.splice(i,1);
    const deptTotal=wizData.cashiers[ck].expensesList.filter(e=>(e.type||'dept')==='dept').reduce((s,e)=>s+e.amount,0);
    wizData.cashiers[ck].expenses=deptTotal;
    renderWizStep();
}

/* withdraw entry UI */
function buildWithdrawEntryUI(ck){
    const allDebts=loadData(KEYS.debts);
    const names=[...new Set(allDebts.map(d=>d.person))];
    let opts=names.map(n=>`<option value="${n}">${n}</option>`).join('');
    const list=wizData.cashiers[ck].withdrawList||[];
    let items=list.map((w,i)=>`<div class="withdraw-item"><span>${w.person}: ${fmtNum(w.amount)}</span><button onclick="removeWizWithdraw('${ck}',${i})"><i class="ri-close-circle-line"></i></button></div>`).join('');
    return `<div class="wiz-withdraw-entry"><h4><i class="ri-hand-coin-line"></i> تفاصيل السحوبات</h4>
    <div class="debtor-selector">
        <input type="text" class="input-field" placeholder="🔍 بحث عن اسم..." style="margin-bottom:6px" oninput="filterPersonSelect('withdrawPersonSelect',this.value)">
        <select id="withdrawPersonSelect" class="input-field"><option value="__new__">+ اسم جديد</option><option value="">-- اختر الشخص --</option>${opts}</select>
        <div id="newWithdrawPersonRow" class="debtor-add-row" style="display:none"><input type="text" class="input-field" id="newWithdrawPerson" placeholder="اسم الشخص"><button class="btn btn-success btn-sm" onclick="confirmNewWithdrawPerson()">✓</button></div>
    </div>
    <input type="number" class="input-field" id="withdrawAmountInput" placeholder="المبلغ (بالآلاف)" inputmode="decimal" style="margin-top:6px">
    <input type="text" class="input-field" id="withdrawNoteInput" placeholder="ملاحظة (اختياري)" style="margin-top:6px">
    <button class="btn btn-primary btn-sm btn-block" onclick="addWizWithdraw('${ck}')" style="margin-top:8px"><i class="ri-add-line"></i> إضافة سحب</button>
    <div class="withdraw-list">${items}</div></div>`;
}
function confirmNewWithdrawPerson(){
    const inp=$('#newWithdrawPerson');
    if(inp&&inp.value.trim()){
        const sel=$('#withdrawPersonSelect');
        const opt=document.createElement('option');opt.value=inp.value.trim();opt.textContent=inp.value.trim();
        sel.insertBefore(opt,sel.querySelector('option[value="__new__"]'));
        sel.value=inp.value.trim();
        $('#newWithdrawPersonRow').style.display='none';
    }
}
function addWizWithdraw(ck){
    const sel=$('#withdrawPersonSelect');
    if(sel&&sel.value==='__new__'){$('#newWithdrawPersonRow').style.display='flex';return;}
    const person=sel?sel.value:'';
    const amount=parseK($('#withdrawAmountInput')?.value);
    const note=$('#withdrawNoteInput')?.value||'';
    if(!person)return toast('اختر الشخص');
    if(!amount)return toast('أدخل المبلغ');
    wizData.cashiers[ck].withdrawList.push({person,amount,note});
    const total=wizData.cashiers[ck].withdrawList.reduce((s,w)=>s+w.amount,0);
    wizData.cashiers[ck].withdrawals=total;
    renderWizStep();
}
function removeWizWithdraw(ck,i){
    wizData.cashiers[ck].withdrawList.splice(i,1);
    const total=wizData.cashiers[ck].withdrawList.reduce((s,w)=>s+w.amount,0);
    wizData.cashiers[ck].withdrawals=total;
    renderWizStep();
}

/* wizard summary */
function renderWizSummary(body){
    const s=loadSettings();const cur=s.currency||'د.ع';
    let html=`<div class="wiz-summary">`;
    if(wizData.manager){
        html+=`<div style="text-align:center;font-weight:700;color:var(--primary);margin-bottom:10px"><i class="ri-user-star-line"></i> المدير: ${wizData.manager}</div>`;
    }
    let grandNet=0;
    CASHIERS.forEach(c=>{
        const d=wizData.cashiers[c.key];
        const r=calcCashierNet(d);
        const deductions=r.deductions;
        const expected=r.net;                         // الصافي المحسوب = المتوقع
        const diff=r.diff;                            // المستلم - المحسوب
        grandNet+=r.net;
        html+=`<h4 style="color:${c.color};margin:10px 0 6px;font-size:.9rem"><i class="${c.icon}"></i> ${c.label}</h4>`;
        html+=`<table><thead><tr><th>البيان</th><th>المبلغ</th></tr></thead><tbody>`;
        CASHIER_FIELDS.forEach(f=>{
            const v=d[f.key]||0;
            const clr=getTypeColor(f.type);
            html+=`<tr><td>${f.label}</td><td style="color:${clr};font-weight:700">${fmtNum(v)} ${cur}</td></tr>`;
        });
        html+=`<tr style="background:var(--surface2)"><td>إجمالي الخصومات</td><td style="color:var(--clr-expense);font-weight:700">${fmtNum(deductions)} ${cur}</td></tr>`;
        html+=`<tr style="background:var(--surface2)"><td>الصافي المحسوب (الرصيد - الخصومات)</td><td style="font-weight:700;color:${r.net>=0?'var(--clr-income)':'var(--clr-expense)'}">${fmtNum(r.net)} ${cur}</td></tr>`;
        if(diff!==0)html+=`<tr style="background:#fef3c7"><td>الفرق (المستلم - المحسوب)</td><td style="color:${diff>0?'var(--clr-income)':'var(--clr-expense)'};font-weight:700">${fmtNum(diff)} ${cur}</td></tr>`;
        const netClr=r.net>=0?'var(--clr-income)':'var(--clr-expense)';
        html+=`<tr class="total-row"><td>الصافي النهائي</td><td style="color:${netClr}">${fmtNum(r.net)} ${cur}</td></tr>`;
        html+=`</tbody></table>`;
    });
    html+=`<div style="text-align:center;margin-top:14px;padding:12px;background:var(--bg);border-radius:var(--radius-sm)">
        <div style="font-size:.85rem;color:var(--text2)">الإجمالي الكلي</div>
        <div style="font-size:1.6rem;font-weight:800;color:${grandNet>=0?'var(--clr-income)':'var(--clr-expense)'}">${fmtNum(grandNet)} ${cur}</div>
    </div></div>`;
    body.innerHTML=html;
}

function getTypeColor(type){
    const map={income:'#16a34a',expense:'#dc2626',debt:'#ef4444',withdraw:'#d97706',deduct:'#7c3aed'};
    return map[type]||'var(--text)';
}

function saveCurrentStep(){
    const info=getStepInfo(wizStep);
    if(info.type==='manager'){
        const sel=$('#managerSelect');
        if(sel&&sel.value&&sel.value!=='__new__')wizData.manager=sel.value;
        return true;
    }
    if(info.type==='summary')return true;
    const {cashier,field}=info;
    const inp=$('#wizInput');
    if(inp)wizData.cashiers[cashier.key][field.key]=parseK(inp.value);
    return true;
}

function saveClosing(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const closings=loadData(KEYS.closings);
    const safe=loadData(KEYS.safe);
    const debts=loadData(KEYS.debts);
    const withdrawals=loadData(KEYS.withdrawals);
    const expEntries=loadData(KEYS.expenseEntries);
    const date=today();
    let totalNet=0;
    const by=getByTag();

    const cashiersData={};
    CASHIERS.forEach(c=>{
        const d=wizData.cashiers[c.key];
        const r=calcCashierNet(d);                    // المحسوب: مبيعات - خصومات (يقبل السالب)
        cashiersData[c.key]={...d,net:r.net,manager:wizData.manager||''};
        totalNet+=r.net;
        /* save debts */
        (d.debtsList||[]).forEach(debt=>{
            debts.push({id:uid(),person:debt.person,amount:debt.amount,note:debt.note||'',type:'debt',cashier:c.label,date,by});
        });
        /* save withdrawals + record in debts */
        (d.withdrawList||[]).forEach(w=>{
            withdrawals.push({id:uid(),person:w.person,amount:w.amount,note:w.note||'',cashier:c.label,date,by});
            debts.push({id:uid(),person:w.person,amount:w.amount,note:'سحب: '+(w.note||''),type:'withdraw',cashier:c.label,date,by});
        });
        /* save expense entries with type */
        (d.expensesList||[]).forEach(exp=>{
            expEntries.push({id:uid(),amount:exp.amount,desc:exp.desc||'',type:exp.type||'dept',cashier:c.label,date,by});
        });
    });
    /* save closing */
    const closingId=uid();
    closings.push({id:closingId,date,manager:wizData.manager||'',cashiers:cashiersData,totalNet,by,safeLinkId:null});
    /* safe transaction - ربط بـ safeLinkId للحذف المتزامن */
    if(totalNet!==0){
        const safeId=uid();
        safe.push({id:safeId,date,type:totalNet>0?'deposit':'withdraw',amount:Math.abs(totalNet),
            note:'تقفيلة '+date+(wizData.manager?' - المدير: '+wizData.manager:''),by,
            closingId:closingId});
        /* update the closing we just pushed with link id */
        const ci=closings.findIndex(c=>c.id===closingId);
        if(ci>=0) closings[ci].safeLinkId=safeId;
    }
    saveData(KEYS.closings,closings);
    saveData(KEYS.safe,safe);
    saveData(KEYS.debts,debts);
    saveData(KEYS.withdrawals,withdrawals);
    saveData(KEYS.expenseEntries,expEntries);
    /* إنشاء تقفيلات منفصلة لكل كاشير */
    const indClosings=loadData(KEYS.individualClosings);
    CASHIERS.forEach(c=>{
        const d=wizData.cashiers[c.key];if(!d)return;
        const r=calcCashierNet(d);
        indClosings.push({
            id:uid(),firebaseId:null,
            cashierKey:c.key,cashierLabel:c.label,
            date,manager:wizData.manager||'',
            data:{sales:d.sales||0,network:d.network||0,returns:d.returns||0,expenses:d.expenses||0,lunch:d.lunch||0,debts:d.debts||0,withdrawals:d.withdrawals||0},
            debtsList:d.debtsList||[],withdrawList:d.withdrawList||[],expensesList:d.expensesList||[],
            net:r.net,by,timestamp:Date.now(),source:'main-app',closingId
        });
    });
    saveData(KEYS.individualClosings,indClosings);
    /* sync to Firebase */
    if(fbDb){
        const fbData={id:closingId,date,manager:wizData.manager||'',cashiers:cashiersData,totalNet,by,timestamp:Date.now(),source:'main-app'};
        fbDb.ref('closings/'+closingId).set(fbData).catch(e=>console.warn('Firebase sync failed:',e));
    }
    doCloseWizard();
    toast('تم حفظ التقفيلة بنجاح');
    renderClosings();
}

/* ========= CLOSINGS PAGE ========= */
function renderClosings(){
    showDate();
    const searchVal=($('#closingSearch')?.value||'').trim().toLowerCase();
    let closings=loadData(KEYS.closings).sort((a,b)=>b.date.localeCompare(a.date));
    if(searchVal)closings=closings.filter(c=>c.date.includes(searchVal)||(c.manager||'').toLowerCase().includes(searchVal)||String(c.totalNet).includes(searchVal));
    const s=loadSettings();const cur=s.currency||'د.ع';
    const list=$('#closingsList');
    if(!closings.length){list.innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا توجد تقفيلات</p></div>';return;}
    const allIds=closings.map(c=>c.id);
    let cHtml=_multiSelectBar('closings',KEYS.closings,allIds,'renderClosings');
    cHtml+=closings.map(c=>{
        const cTotal=calcClosingTotal(c);
        const clr=cTotal>=0?'income':'expense';
        const mgr=c.manager?`<span style="color:var(--primary);font-size:.75rem"><i class="ri-user-star-line"></i> ${c.manager}</span>`:'';
        const detailsBtn=`<button onclick="viewClosingDetails('${c.id}')" title="تفاصيل"><i class="ri-eye-line"></i></button>`;
        const editBtn=hasAction('edit')?`<button onclick="editClosing('${c.id}')" title="تعديل"><i class="ri-edit-line"></i></button>`:'';
        const printBtn=hasAction('print')?`<button onclick="printClosing('${c.id}')"><i class="ri-printer-line"></i></button>`:'';
        const delBtn=hasAction('delete')?`<button onclick="deleteClosing('${c.id}')"><i class="ri-delete-bin-line"></i></button>`:'';
        const sel=(_selectedIds['closings']&&_selectedIds['closings'].has(c.id))?'selected':'';
        const cb=_multiSelectCheckbox('closings',c.id,'renderClosings');
        return `<div class="record-card ${sel}">
        <div style="display:flex;align-items:center">${cb}<div class="rec-info"><div class="rec-title">${c.date} ${mgr}</div><div class="rec-sub">${CASHIERS.map(cs=>cs.label).join(' | ')}${c.by?' | <span class="by-tag">بواسطة: '+c.by+'</span>':''}</div></div></div>
        <div class="rec-amount ${clr}">${fmtNum(cTotal)} ${cur}</div>
        <div class="rec-actions">${detailsBtn}${editBtn}${printBtn}${delBtn}</div>
    </div>`;}).join('');
    list.innerHTML=cHtml;
}
function deleteClosing(id){
    if(!hasAction('delete'))return toast('غير مصرح');
    if(!confirm('حذف التقفيلة؟ سيتم حذف معاملة الخزنة المرتبطة أيضاً.'))return;
    let arr=loadData(KEYS.closings);
    const target=arr.find(c=>c.id===id);
    arr=arr.filter(c=>c.id!==id);
    saveData(KEYS.closings,arr);
    /* حذف معاملة الخزنة المرتبطة */
    if(target){
        let safe=loadData(KEYS.safe);
        const before=safe.length;
        safe=safe.filter(t=>{
            if(target.safeLinkId && t.id===target.safeLinkId) return false;
            if(t.closingId===id) return false;
            /* للبيانات القديمة: حذف بالمطابقة على التاريخ والمبلغ والملاحظة */
            if(!target.safeLinkId && t.date===target.date
               && t.amount===Math.abs(target.totalNet||0)
               && (t.note||'').includes('تقفيلة')
               && (t.note||'').includes(target.date)) return false;
            return true;
        });
        if(safe.length!==before) saveData(KEYS.safe,safe);
    }
    /* حذف التقفيلات المنفصلة المرتبطة */
    let indArr=loadData(KEYS.individualClosings);
    const indBefore=indArr.length;
    indArr=indArr.filter(c=>c.closingId!==id);
    if(indArr.length!==indBefore) saveData(KEYS.individualClosings,indArr);
    toast('تم الحذف');renderClosings();
    if(typeof renderSafe==='function' && $('#page-safe')?.classList.contains('active')) renderSafe();
}
function editClosing(id){
    if(!hasAction('edit'))return toast('غير مصرح');
    const closings=loadData(KEYS.closings);
    const cl=closings.find(c=>c.id===id);if(!cl)return;
    const s=loadSettings();const cur=s.currency||'د.ع';
    let html=`<div class="field"><label>التاريخ</label><input type="date" id="editClDate" class="input-field" value="${cl.date}"></div>`;
    html+=`<div class="field"><label>المدير</label><input type="text" id="editClManager" class="input-field" value="${cl.manager||''}"></div>`;
    CASHIERS.forEach(c=>{
        const d=cl.cashiers[c.key]||{};
        html+=`<h4 style="margin:10px 0 6px;color:${c.color}">${c.label}</h4>`;
        CASHIER_FIELDS.forEach(f=>{
            html+=`<div class="field"><label>${f.label} (بالآلاف)</label><input type="number" id="editCl_${c.key}_${f.key}" class="input-field" value="${toK(d[f.key]||0)}"></div>`;
        });
    });
    openModal('تعديل التقفيلة',html,`<button class="btn btn-success" onclick="saveEditClosing('${id}')">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function saveEditClosing(id){
    const closings=loadData(KEYS.closings);
    const idx=closings.findIndex(c=>c.id===id);if(idx<0)return;
    const cl=closings[idx];
    const oldTotalNet=cl.totalNet||0;
    const oldSafeLinkId=cl.safeLinkId;
    cl.date=$('#editClDate').value||cl.date;
    cl.manager=$('#editClManager').value.trim();
    let totalNet=0;
    CASHIERS.forEach(c=>{
        CASHIER_FIELDS.forEach(f=>{
            cl.cashiers[c.key][f.key]=parseK($(`#editCl_${c.key}_${f.key}`).value);
        });
        const d=cl.cashiers[c.key];
        const r=calcCashierNet(d);                    // الحساب الصحيح
        d.net=r.net;
        totalNet+=r.net;
    });
    cl.totalNet=totalNet;
    cl.by=getByTag();
    closings[idx]=cl;
    saveData(KEYS.closings,closings);

    /* مزامنة معاملة الخزنة المرتبطة */
    let safe=loadData(KEYS.safe);
    let linkedIdx=-1;
    if(oldSafeLinkId) linkedIdx=safe.findIndex(t=>t.id===oldSafeLinkId);
    if(linkedIdx<0) linkedIdx=safe.findIndex(t=>t.closingId===id);
    if(linkedIdx>=0){
        if(totalNet===0){
            safe.splice(linkedIdx,1);
            cl.safeLinkId=null;
        } else {
            safe[linkedIdx].amount=Math.abs(totalNet);
            safe[linkedIdx].type=totalNet>0?'deposit':'withdraw';
            safe[linkedIdx].date=cl.date;
            safe[linkedIdx].note='تقفيلة '+cl.date+(cl.manager?' - المدير: '+cl.manager:'');
            safe[linkedIdx].by=cl.by;
            safe[linkedIdx].closingId=id;
            cl.safeLinkId=safe[linkedIdx].id;
        }
    } else if(totalNet!==0){
        const newSafeId=uid();
        safe.push({id:newSafeId,date:cl.date,type:totalNet>0?'deposit':'withdraw',
            amount:Math.abs(totalNet),
            note:'تقفيلة '+cl.date+(cl.manager?' - المدير: '+cl.manager:''),
            by:cl.by,closingId:id});
        cl.safeLinkId=newSafeId;
    }
    closings[idx]=cl;
    saveData(KEYS.closings,closings);
    saveData(KEYS.safe,safe);

    closeModal();toast('تم التحديث');renderClosings();
    if(typeof renderSafe==='function' && $('#page-safe')?.classList.contains('active')) renderSafe();
}

/* ========= PRINT CLOSING ========= */
function printClosing(id){
    if(!hasAction('print'))return toast('غير مصرح');
    const cl=loadData(KEYS.closings).find(c=>c.id===id);if(!cl)return;
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const printDate=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
    let html=`<div class="print-page-border">`;
    html+=`<div class="print-header"><h2>تقفيلة يومية</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">تاريخ التقفيلة: ${cl.date}</p>`;
    html+=`<p class="print-date">تاريخ الطباعة: ${printDate}</p></div>`;
    if(cl.manager)html+=`<div class="print-manager"><i class="ri-user-star-line"></i> المدير المسؤول: ${cl.manager}</div>`;

    CASHIERS.forEach(c=>{
        const d=cl.cashiers[c.key];if(!d)return;
        const hasData=(d.sales||0)||(d.network||0);
        if(!hasData)return;
        const r=calcCashierNet(d);
        const deductions=r.deductions;
        const cashierMgr=d.manager||cl.manager||'';
        html+=`<div class="print-section"><h3>${c.label}${cashierMgr?' <span class="print-cashier-mgr">( '+cashierMgr+' )</span>':''}</h3><table><tbody>`;
        CASHIER_FIELDS.forEach(f=>{
            const v=d[f.key]||0;
            const pClr=getPrintColorClass(f.type);
            html+=`<tr><td style="width:55%">${f.label}</td><td class="print-amount ${pClr}">${fmtNum(v)} ${cur}</td></tr>`;
        });
        html+=`<tr style="border-top:2px solid #999;background:#f0f0f0"><td style="width:55%"><strong>إجمالي الخصومات</strong></td><td class="print-amount p-expense">${fmtNum(deductions)} ${cur}</td></tr>`;
        html+=`<tr style="background:#f7f7f7"><td style="width:55%"><strong>الصافي المحسوب (الرصيد - الخصومات)</strong></td><td class="print-amount" style="color:${r.net>=0?'#16a34a':'#dc2626'}">${fmtNum(r.net)} ${cur}</td></tr>`;
        if(r.diff!==0){
            html+=`<tr style="background:#fff7e0"><td style="width:55%"><strong>الفرق (المستلم - المحسوب)</strong></td><td class="print-amount" style="color:${r.diff>0?'#16a34a':'#dc2626'}">${fmtNum(r.diff)} ${cur}</td></tr>`;
        }
        html+=`<tr style="border-top:2.5px solid #333;background:#e8e8e8"><td style="width:55%"><strong>الصافي النهائي</strong></td><td class="print-amount" style="color:${r.net>=0?'#16a34a':'#dc2626'}">${fmtNum(r.net)} ${cur}</td></tr>`;
        html+=`</tbody></table>`;
        if(d.debtsList&&d.debtsList.length){
            html+=`<div class="print-detail-header" style="color:#ef4444">تفاصيل الديون:</div>`;
            d.debtsList.forEach(db=>html+=`<div class="print-detail-row">● ${db.person}: ${fmtNum(db.amount)} ${cur} ${db.note?'('+db.note+')':''}</div>`);
        }
        if(d.withdrawList&&d.withdrawList.length){
            html+=`<div class="print-detail-header" style="color:#d97706">تفاصيل السحوبات:</div>`;
            d.withdrawList.forEach(w=>html+=`<div class="print-detail-row">● ${w.person}: ${fmtNum(w.amount)} ${cur} ${w.note?'('+w.note+')':''}</div>`);
        }
        if(d.expensesList&&d.expensesList.length){
            html+=`<div class="print-detail-header" style="color:#f59e0b">تفاصيل المصاريف:</div>`;
            d.expensesList.forEach(ex=>html+=`<div class="print-detail-row">● ${ex.desc||'مصروف'}: ${fmtNum(ex.amount)} ${cur}</div>`);
        }
        html+=`</div>`;
    });
    html+=`<div class="print-total" style="color:${cl.totalNet>=0?'#16a34a':'#dc2626'}">الإجمالي الكلي: ${fmtNum(cl.totalNet)} ${cur}</div>`;
    html+=`</div>`;
    showPrintDialog(html);
}
function getPrintColorClass(type){
    const m={income:'p-income',expense:'p-expense',debt:'p-debt',withdraw:'p-withdraw',deduct:'p-deduct'};
    return m[type]||'';
}

/* ========= PRINT ALL CLOSINGS SUMMARY ========= */
function printAllClosings(){
    if(!hasAction('print'))return toast('غير مصرح');
    const closings=loadData(KEYS.closings).sort((a,b)=>b.date.localeCompare(a.date));
    if(!closings.length)return toast('لا توجد تقفيلات');
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const printDate=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
    let html=`<div class="print-page-border">`;
    html+=`<div class="print-header"><h2>ملخص جميع التقفيلات</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">تاريخ الطباعة: ${printDate}</p></div>`;
    html+=`<table><thead><tr><th>#</th><th>التاريخ</th><th>المدير</th>`;
    CASHIERS.forEach(cs=>html+=`<th>${cs.label}</th>`);
    html+=`<th>الصافي</th></tr></thead><tbody>`;
    let grandTotal=0;
    closings.forEach((c,i)=>{
        const cTotal=calcClosingTotal(c);
        grandTotal+=cTotal;
        html+=`<tr><td>${i+1}</td><td>${c.date}</td><td>${c.manager||'-'}</td>`;
        CASHIERS.forEach(cs=>{const d=c.cashiers[cs.key];html+=`<td>${d?fmtNum(calcCashierNet(d).net):'-'}</td>`;});
        html+=`<td style="color:${cTotal>=0?'#16a34a':'#dc2626'};font-weight:700">${fmtNum(cTotal)} ${cur}</td></tr>`;
    });
    html+=`<tr style="font-weight:700;background:#f1f5f9"><td colspan="3">الإجمالي (${closings.length} تقفيلة)</td>`;
    CASHIERS.forEach(cs=>{
        const total=closings.reduce((s,c)=>{const d=c.cashiers[cs.key];return s+(d?calcCashierNet(d).net:0);},0);
        html+=`<td>${fmtNum(total)}</td>`;
    });
    html+=`<td style="color:${grandTotal>=0?'#16a34a':'#dc2626'}">${fmtNum(grandTotal)} ${cur}</td></tr>`;
    html+=`</tbody></table></div>`;
    showPrintDialog(html);
}

/* ========= VIEW CLOSING DETAILS ========= */
function viewClosingDetails(id){
    const cl=loadData(KEYS.closings).find(c=>c.id===id);if(!cl)return;
    const s=loadSettings();const cur=s.currency||'د.ع';
    let html='';
    if(cl.manager)html+=`<div style="text-align:center;font-weight:700;color:var(--primary);margin-bottom:10px"><i class="ri-user-star-line"></i> المدير: ${cl.manager}</div>`;
    CASHIERS.forEach(c=>{
        const d=cl.cashiers[c.key];if(!d)return;
        const r=calcCashierNet(d);
        const deductions=r.deductions;
        const expected=r.net;
        const diff=r.diff;
        html+=`<h4 style="color:${c.color};margin:10px 0 6px;font-size:.9rem"><i class="${c.icon}"></i> ${c.label}</h4>`;
        html+=`<table style="width:100%;font-size:.85rem;border-collapse:collapse"><tbody>`;
        CASHIER_FIELDS.forEach(f=>{
            const v=d[f.key]||0;
            const clr=getTypeColor(f.type);
            html+=`<tr><td style="padding:4px 8px">${f.label}</td><td style="padding:4px 8px;font-weight:700;color:${clr};text-align:left">${fmtNum(v)} ${cur}</td></tr>`;
        });
        html+=`<tr style="background:var(--surface2)"><td style="padding:4px 8px">إجمالي الخصومات</td><td style="padding:4px 8px;font-weight:700;color:var(--clr-expense);text-align:left">${fmtNum(deductions)} ${cur}</td></tr>`;
        html+=`<tr style="background:var(--surface2)"><td style="padding:4px 8px">الصافي المحسوب</td><td style="padding:4px 8px;font-weight:700;text-align:left;color:${r.net>=0?'var(--clr-income)':'var(--clr-expense)'}">${fmtNum(r.net)} ${cur}</td></tr>`;
        if(diff!==0)html+=`<tr style="background:#fef3c7"><td style="padding:4px 8px">الفرق (المستلم - المحسوب)</td><td style="padding:4px 8px;font-weight:700;color:${diff>0?'var(--clr-income)':'var(--clr-expense)'};text-align:left">${fmtNum(diff)} ${cur}</td></tr>`;
        const net=r.net;                              // الصافي النهائي هو المحسوب
        html+=`<tr style="border-top:2px solid var(--border);font-weight:800"><td style="padding:4px 8px">الصافي النهائي</td><td style="padding:4px 8px;color:${net>=0?'var(--clr-income)':'var(--clr-expense)'};text-align:left">${fmtNum(net)} ${cur}</td></tr>`;
        html+=`</tbody></table>`;
        if(d.debtsList&&d.debtsList.length){
            html+=`<div style="font-size:.78rem;margin-top:4px;color:#ef4444;font-weight:600">الديون:</div>`;
            d.debtsList.forEach(db=>html+=`<div style="font-size:.78rem;padding:2px 8px">${db.person}: ${fmtNum(db.amount)} ${cur} ${db.note?'('+db.note+')':''}</div>`);
        }
        if(d.withdrawList&&d.withdrawList.length){
            html+=`<div style="font-size:.78rem;margin-top:4px;color:#d97706;font-weight:600">السحوبات:</div>`;
            d.withdrawList.forEach(w=>html+=`<div style="font-size:.78rem;padding:2px 8px">${w.person}: ${fmtNum(w.amount)} ${cur} ${w.note?'('+w.note+')':''}</div>`);
        }
        if(d.expensesList&&d.expensesList.length){
            html+=`<div style="font-size:.78rem;margin-top:4px;color:#f59e0b;font-weight:600">المصاريف:</div>`;
            d.expensesList.forEach(ex=>html+=`<div style="font-size:.78rem;padding:2px 8px">${ex.desc||'مصروف'}: ${fmtNum(ex.amount)} ${cur}</div>`);
        }
    });
    html+=`<div style="text-align:center;margin-top:14px;padding:12px;background:var(--bg);border-radius:8px">
        <div style="font-size:.85rem;color:var(--text2)">الإجمالي الكلي</div>
        <div style="font-size:1.4rem;font-weight:800;color:${cl.totalNet>=0?'var(--clr-income)':'var(--clr-expense)'}">${fmtNum(cl.totalNet)} ${cur}</div>
    </div>`;
    openModal('تفاصيل التقفيلة - '+cl.date,html);
}

/* ========= INDIVIDUAL CLOSINGS PAGE ========= */
/* ========= INDIVIDUAL CLOSING WIZARD (manual entry from main app) ========= */
let indWizData = {}; // {cashierKey, manager, fields, debtsList, withdrawList, expensesList}
let indWizStep = 0;
const IND_TOTAL_STEPS = CASHIER_FIELDS.length + 2; // manager + fields + summary

function startIndividualWizard(cashierKey){
    if(!hasAction('closing'))return toast('غير مصرح');
    const cashier = CASHIERS.find(c=>c.key===cashierKey);
    if(!cashier) return;
    indWizData = {
        cashierKey: cashierKey,
        cashierLabel: cashier.label,
        manager: getCurrentUser()?.username||'',
        fields: {},
        debtsList: [],
        withdrawList: [],
        expensesList: []
    };
    CASHIER_FIELDS.forEach(f=>indWizData.fields[f.key]=0);
    indWizStep = 0;

    // Build overlay
    let overlay = document.getElementById('indWizOverlay');
    if(!overlay){
        overlay = document.createElement('div');
        overlay.id = 'indWizOverlay';
        overlay.className = 'wizard-overlay';
        overlay.innerHTML = `
            <div class="wizard-container">
                <div class="wizard-topbar" style="background:${cashier.color||'var(--primary)'}">
                    <button class="wiz-close" onclick="closeIndWizard()"><i class="ri-close-line"></i></button>
                    <span class="wiz-title" id="indWizTitle">تقفيلة ${cashier.label}</span>
                    <span class="wiz-progress" id="indWizProgress">1/${IND_TOTAL_STEPS}</span>
                </div>
                <div class="wizard-progress-bar"><div class="wizard-progress-fill" id="indWizProgressFill"></div></div>
                <div class="wizard-body" id="indWizBody"></div>
                <div class="wizard-footer">
                    <button class="btn btn-ghost" id="indWizBack" onclick="indWizPrev()"><i class="ri-arrow-right-line"></i> السابق</button>
                    <button class="btn btn-primary" id="indWizNext" onclick="indWizNext()">التالي <i class="ri-arrow-left-line"></i></button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
    }
    overlay.classList.remove('hidden');
    document.body.classList.add('wizard-open');
    history.pushState({page:'indWizard'},'','');
    renderIndWizStep();
}

function closeIndWizard(){
    if(!confirm('هل تريد الخروج من التقفيلة؟')) return;
    const overlay = document.getElementById('indWizOverlay');
    if(overlay) overlay.classList.add('hidden');
    document.body.classList.remove('wizard-open');
}

function indWizNext(){
    saveIndWizStep();
    if(indWizStep === IND_TOTAL_STEPS-1){ saveIndividualClosing(); return; }
    indWizStep++;
    renderIndWizStep();
    history.pushState({page:'indWizard',step:indWizStep},'','');
}

function indWizPrev(){
    saveIndWizStep();
    if(indWizStep > 0){ indWizStep--; renderIndWizStep(); }
}

function getIndStepInfo(step){
    if(step===0) return {type:'manager'};
    const fi = step-1;
    if(fi>=CASHIER_FIELDS.length) return {type:'summary'};
    return {type:'field', field:CASHIER_FIELDS[fi]};
}

function saveIndWizStep(){
    const info = getIndStepInfo(indWizStep);
    if(info.type==='manager'){const inp=document.getElementById('indWizInput');if(inp)indWizData.manager=inp.value.trim();return;}
    if(info.type==='summary') return;
    const inp = document.getElementById('indWizInput');
    if(inp) indWizData.fields[info.field.key] = parseK(inp.value);
}

function renderIndWizStep(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const info = getIndStepInfo(indWizStep);
    const body = document.getElementById('indWizBody');
    const cashier = CASHIERS.find(c=>c.key===indWizData.cashierKey)||{};

    document.getElementById('indWizProgress').textContent = (indWizStep+1)+'/'+IND_TOTAL_STEPS;
    document.getElementById('indWizProgressFill').style.width = ((indWizStep+1)/IND_TOTAL_STEPS*100)+'%';
    document.getElementById('indWizBack').style.visibility = indWizStep===0?'hidden':'visible';
    const isLast = indWizStep===IND_TOTAL_STEPS-1;
    document.getElementById('indWizNext').innerHTML = isLast?'<i class="ri-save-line"></i> حفظ وإرسال':'التالي <i class="ri-arrow-left-line"></i>';

    if(info.type==='manager'){
        const settings=loadSettings();
        const managers=(settings.managers||[]);
        const opts=managers.map(m=>`<option value="${m}">${m}</option>`).join('');
        body.innerHTML=`<div class="wiz-cashier-label" style="color:${cashier.color||'var(--primary)'}"><i class="${cashier.icon||'ri-store-line'}"></i> ${cashier.label}</div>
        <div class="wiz-label">المدير المسؤول</div>
        <input type="text" class="wiz-input" id="indWizInput" value="${indWizData.manager||''}" placeholder="اسم المدير">
        ${opts?`<select class="input-field" style="margin-top:8px" onchange="document.getElementById('indWizInput').value=this.value"><option value="">-- اختر مديراً --</option>${opts}</select>`:''}`;
        return;
    }

    if(info.type==='summary'){
        renderIndWizSummary(body, s, cur);
        return;
    }

    const {field} = info;
    const currentVal = toK(indWizData.fields[field.key]||0);
    const typeColor = getTypeColor(field.type);

    let extra='';
    if(field.key==='debts'){
        const list=indWizData.debtsList.map((d,i)=>`<div class="debt-item"><span>${d.person}: ${fmtNum(d.amount)}</span><button onclick="indRemoveDebt(${i})"><i class="ri-close-circle-line"></i></button></div>`).join('');
        const allDebts=loadData(KEYS.debts);
        const names=[...new Set(allDebts.map(d=>d.person))];
        const opts2=names.map(n=>`<option value="${n}">${n}</option>`).join('');
        extra=`<div class="wiz-debt-entry"><h4><i class="ri-file-list-3-line"></i> تفاصيل الديون</h4>
            <select id="indDebtPerson" class="input-field"><option value="">-- اختر --</option>${opts2}<option value="__new__">+ جديد</option></select>
            <input type="number" id="indDebtAmount" class="input-field" placeholder="المبلغ (بالآلاف)" inputmode="decimal" style="margin-top:6px">
            <input type="text" id="indDebtNote" class="input-field" placeholder="ملاحظة" style="margin-top:6px">
            <button class="btn btn-primary btn-sm btn-block" onclick="indAddDebt()" style="margin-top:8px"><i class="ri-add-line"></i> إضافة</button>
            <div class="debt-list">${list}</div></div>`;
    }
    if(field.key==='expenses'){
        const typeLabel=t=>t==='admin'?'<span style="color:#7c3aed;font-size:.7rem">[إدارة]</span>':t==='general'?'<span style="color:#0891b2;font-size:.7rem">[عامة]</span>':'<span style="color:var(--text2);font-size:.7rem">[قسم]</span>';
        const list=indWizData.expensesList.map((e,i)=>`<div class="debt-item"><span>${typeLabel(e.type||'dept')} ${e.desc||'مصروف'}: ${fmtNum(e.amount)}</span><button onclick="indRemoveExp(${i})"><i class="ri-close-circle-line"></i></button></div>`).join('');
        extra=`<div class="wiz-debt-entry"><h4><i class="ri-money-dollar-box-line"></i> تفاصيل المصاريف</h4>
            <input type="number" id="indExpAmount" class="input-field" placeholder="المبلغ (بالآلاف)" inputmode="decimal">
            <input type="text" id="indExpDesc" class="input-field" placeholder="الوصف" style="margin-top:6px">
            <div style="margin-top:8px;display:flex;gap:4px;background:var(--surface2);border-radius:8px;padding:4px" id="indExpTypeBox" data-selected="dept">
                <label class="exp-type-opt active" data-type="dept" style="flex:1;text-align:center;padding:6px 8px;cursor:pointer;border-radius:6px;background:var(--primary);color:#fff;font-size:.78rem;font-weight:700" onclick="indSelectExpType('dept')"><i class="ri-store-line"></i> قسم</label>
                <label class="exp-type-opt" data-type="general" style="flex:1;text-align:center;padding:6px 8px;cursor:pointer;border-radius:6px;color:var(--text);font-size:.78rem;font-weight:700" onclick="indSelectExpType('general')"><i class="ri-building-line"></i> عامة</label>
                <label class="exp-type-opt" data-type="admin" style="flex:1;text-align:center;padding:6px 8px;cursor:pointer;border-radius:6px;color:var(--text);font-size:.78rem;font-weight:700" onclick="indSelectExpType('admin')"><i class="ri-user-star-line"></i> إدارة</label>
            </div>
            <div style="font-size:.72rem;color:var(--text2);margin-top:4px"><i class="ri-information-line"></i> "عامة/إدارة" لا تُخصم من صافي الكاشير</div>
            <button class="btn btn-primary btn-sm btn-block" onclick="indAddExp()" style="margin-top:8px"><i class="ri-add-line"></i> إضافة</button>
            <div class="debt-list">${list}</div></div>`;
    }

    body.innerHTML=`<div class="wiz-cashier-label" style="color:${cashier.color||'var(--primary)'}"><i class="${cashier.icon||'ri-store-line'}"></i> ${cashier.label}</div>
    <div class="wiz-label"><i class="${field.icon}" style="color:${typeColor}"></i> ${field.label}</div>
    <input type="number" class="wiz-input" id="indWizInput" value="${currentVal||''}" placeholder="0" inputmode="decimal" style="border-color:${typeColor}">
    <p style="font-size:.78rem;color:var(--text3);text-align:center;margin-top:6px">أدخل المبلغ بالآلاف (مثال: 50 = 50,000)</p>
    ${extra}`;
    document.getElementById('indWizInput')?.focus();
}

function renderIndWizSummary(body, s, cur){
    const cashier = CASHIERS.find(c=>c.key===indWizData.cashierKey)||{};
    const d = indWizData.fields;
    const r = calcCashierNet(d);
    const deductions=r.deductions;
    const net=r.net;
    const diff=r.diff;
    let html=`<div class="wiz-summary">`;
    if(indWizData.manager) html+=`<div style="text-align:center;font-weight:700;color:var(--primary);margin-bottom:10px"><i class="ri-user-star-line"></i> المدير: ${indWizData.manager}</div>`;
    html+=`<h4 style="color:${cashier.color||'var(--primary)'};margin:6px 0;font-size:.9rem;text-align:center"><i class="${cashier.icon||''}"></i> ${cashier.label}</h4>`;
    html+=`<table><thead><tr><th>البيان</th><th>المبلغ</th></tr></thead><tbody>`;
    CASHIER_FIELDS.forEach(f=>{
        const v=d[f.key]||0;
        const clr=getTypeColor(f.type);
        html+=`<tr><td>${f.label}</td><td style="color:${clr};font-weight:700">${fmtNum(v)} ${cur}</td></tr>`;
    });
    html+=`<tr style="background:var(--surface2)"><td>إجمالي الخصومات</td><td style="color:var(--clr-expense);font-weight:700">${fmtNum(deductions)} ${cur}</td></tr>`;
    html+=`<tr style="background:var(--surface2)"><td>الصافي المحسوب</td><td style="font-weight:700;color:${net>=0?'var(--clr-income)':'var(--clr-expense)'}">${fmtNum(net)} ${cur}</td></tr>`;
    if(diff!==0)html+=`<tr style="background:#fef3c7"><td>الفرق (المستلم - المحسوب)</td><td style="color:${diff>0?'var(--clr-income)':'var(--clr-expense)'};font-weight:700">${fmtNum(diff)} ${cur}</td></tr>`;
    html+=`<tr class="total-row"><td>الصافي النهائي</td><td style="color:${net>=0?'var(--clr-income)':'var(--clr-expense)'}">${fmtNum(net)} ${cur}</td></tr>`;
    html+=`</tbody></table></div>`;
    body.innerHTML=html;
}

function indAddDebt(){
    const sel=document.getElementById('indDebtPerson');
    let person=sel?sel.value:'';
    if(person==='__new__'){const ni=prompt('اسم الشخص:','');if(!ni)return;person=ni.trim();}
    const amount=parseK(document.getElementById('indDebtAmount')?.value);
    const note=document.getElementById('indDebtNote')?.value.trim()||'';
    if(!person)return toast('اختر الشخص');
    if(!amount)return toast('أدخل المبلغ');
    indWizData.debtsList.push({person,amount,note});
    indWizData.fields.debts=(indWizData.debtsList.reduce((s,d)=>s+d.amount,0));
    renderIndWizStep();
}
function indRemoveDebt(i){indWizData.debtsList.splice(i,1);indWizData.fields.debts=indWizData.debtsList.reduce((s,d)=>s+d.amount,0);renderIndWizStep();}
function indAddExp(){
    const amount=parseK(document.getElementById('indExpAmount')?.value);
    const desc=document.getElementById('indExpDesc')?.value.trim()||'مصروف';
    if(!amount)return toast('أدخل المبلغ');
    const box=document.getElementById('indExpTypeBox');
    const type=(box&&box.dataset.selected)||'dept';
    indWizData.expensesList.push({amount,desc,type});
    /* expenses field = only dept */
    indWizData.fields.expenses=indWizData.expensesList.filter(e=>(e.type||'dept')==='dept').reduce((s,e)=>s+e.amount,0);
    renderIndWizStep();
}
function indSelectExpType(type){
    const box=document.getElementById('indExpTypeBox');if(!box)return;
    box.querySelectorAll('.exp-type-opt').forEach(el=>{
        const isActive=el.dataset.type===type;
        el.classList.toggle('active',isActive);
        el.style.background=isActive?'var(--primary)':'transparent';
        el.style.color=isActive?'#fff':'var(--text)';
    });
    box.dataset.selected=type;
}
function indRemoveExp(i){
    indWizData.expensesList.splice(i,1);
    indWizData.fields.expenses=indWizData.expensesList.filter(e=>(e.type||'dept')==='dept').reduce((s,e)=>s+e.amount,0);
    renderIndWizStep();
}

function saveIndividualClosing(){
    const cashier = CASHIERS.find(c=>c.key===indWizData.cashierKey)||{};
    const d = indWizData.fields;
    const net = calcCashierNet(d).net;                // الحساب الصحيح (يقبل السالب)
    const date = today();
    const by = getByTag();

    // Save to individualClosings
    const individuals = loadData(KEYS.individualClosings)||[];
    const newRec = {
        id: uid(),
        firebaseId: null,
        cashierKey: cashier.key,
        cashierLabel: cashier.label,
        date: date,
        manager: indWizData.manager||'',
        data: {...d},
        debtsList: indWizData.debtsList||[],
        withdrawList: indWizData.withdrawList||[],
        expensesList: indWizData.expensesList||[],
        net: net,
        by: by,
        timestamp: Date.now(),
        source: 'manual'
    };
    individuals.push(newRec);
    saveData(KEYS.individualClosings, individuals);

    // Save debts
    const debts=loadData(KEYS.debts)||[];
    (indWizData.debtsList||[]).forEach(debt=>{
        debts.push({id:uid(),person:debt.person,amount:debt.amount,note:debt.note||'',type:'debt',cashier:cashier.label,date,by});
    });
    saveData(KEYS.debts,debts);

    // Save expenses
    const expEntries=loadData(KEYS.expenseEntries)||[];
    (indWizData.expensesList||[]).forEach(exp=>{
        expEntries.push({id:uid(),amount:exp.amount,desc:exp.desc||'',type:exp.type||'dept',cashier:cashier.label,date,by});
    });
    saveData(KEYS.expenseEntries,expEntries);

    // Merge into combined closing
    mergeIndividualClosings(date);

    // Close overlay
    const overlay = document.getElementById('indWizOverlay');
    if(overlay) overlay.classList.add('hidden');
    document.body.classList.remove('wizard-open');

    toast('✅ تم حفظ تقفيلة '+cashier.label);
    renderIndividual();
}

function _syncClosingsToIndividual(){
    const combined=loadData(KEYS.closings);
    const indArr=loadData(KEYS.individualClosings);
    const linkedIds=new Set(indArr.filter(c=>c.closingId).map(c=>c.closingId));
    let added=false;
    combined.forEach(cl=>{
        if(linkedIds.has(cl.id))return;
        if(!cl.cashiers)return;
        CASHIERS.forEach(c=>{
            const d=cl.cashiers[c.key];if(!d)return;
            const r=calcCashierNet(d);
            indArr.push({
                id:uid(),firebaseId:null,
                cashierKey:c.key,cashierLabel:c.label,
                date:cl.date,manager:cl.manager||d.manager||'',
                data:{sales:d.sales||0,network:d.network||0,returns:d.returns||0,expenses:d.expenses||0,lunch:d.lunch||0,debts:d.debts||0,withdrawals:d.withdrawals||0},
                debtsList:d.debtsList||[],withdrawList:d.withdrawList||[],expensesList:d.expensesList||[],
                net:r.net,by:cl.by||'',timestamp:Date.now(),source:'main-app',closingId:cl.id
            });
        });
        added=true;
    });
    if(added)saveData(KEYS.individualClosings,indArr);
}

function renderIndividual(){
    _syncClosingsToIndividual();
    showDate();
    const searchVal=($('#individualSearch')?.value||'').trim().toLowerCase();
    let closings=loadData(KEYS.individualClosings).sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.timestamp||0)-(a.timestamp||0));
    if(searchVal)closings=closings.filter(c=>c.date.includes(searchVal)||(c.cashierLabel||'').toLowerCase().includes(searchVal)||(c.manager||'').toLowerCase().includes(searchVal));
    const s=loadSettings();const cur=s.currency||'د.ع';
    const list=$('#individualList');
    if(!closings.length){list.innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا توجد تقفيلات منفصلة</p></div>';return;}
    /* group by date */
    const groups={};
    closings.forEach(c=>{const d=c.date||'';if(!groups[d])groups[d]=[];groups[d].push(c);});
    let html='';
    Object.keys(groups).sort((a,b)=>b.localeCompare(a)).forEach(date=>{
        html+=`<div style="display:flex;align-items:center;justify-content:space-between;font-size:.82rem;font-weight:700;color:var(--text2);margin:10px 0 4px;padding:4px 8px;background:var(--bg);border-radius:6px"><span><i class="ri-calendar-line"></i> ${date}</span><button class="btn btn-sm btn-warning" onclick="printIndividualByDate('${date}')" title="طباعة تقفيلات ${date}"><i class="ri-printer-line"></i> طباعة اليوم</button></div>`;
        groups[date].forEach(c=>{
            const cashierInfo = CASHIERS.find(cs=>cs.key===c.cashierKey) || {};
            const clr=c.net>=0?'income':'expense';
            const mgr=c.manager?`<span style="color:var(--primary);font-size:.75rem"><i class="ri-user-star-line"></i> ${c.manager}</span>`:'';
            html+=`<div class="record-card" onclick="viewIndividualDetails('${c.id}')" style="cursor:pointer">
                <div class="rec-info">
                    <div class="rec-title"><span style="color:${cashierInfo.color||'var(--primary)'}"><i class="${cashierInfo.icon||'ri-store-line'}"></i> ${c.cashierLabel}</span> ${mgr}</div>
                    <div class="rec-sub">${c.date}${c.by?' | <span class="by-tag">'+c.by+'</span>':''}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px">
                    <button class="btn btn-sm" onclick="event.stopPropagation();printIndividualClosing('${c.id}')" title="طباعة"><i class="ri-printer-line"></i></button>
                    <div class="rec-amount ${clr}">${fmtNum(c.net)} ${cur}</div>
                </div>
            </div>`;
        });
    });
    list.innerHTML=html;
}

function viewIndividualDetails(id){
    const cl=loadData(KEYS.individualClosings).find(c=>c.id===id);if(!cl)return;
    const s=loadSettings();const cur=s.currency||'د.ع';
    const cashierInfo = CASHIERS.find(c=>c.key===cl.cashierKey) || {};
    const d = cl.data || {};
    const r = calcCashierNet(d);
    const net = r.net;
    const deductions = r.deductions;
    const expected = r.net;
    const diff = r.diff;
    let html = '';
    if(cl.manager)html+=`<div style="text-align:center;font-weight:700;color:var(--primary);margin-bottom:10px"><i class="ri-user-star-line"></i> المدير: ${cl.manager}</div>`;
    html+=`<h4 style="color:${cashierInfo.color||'var(--primary)'};margin:6px 0;font-size:.9rem;text-align:center"><i class="${cashierInfo.icon||''}"></i> ${cl.cashierLabel}</h4>`;
    html+=`<table style="width:100%;font-size:.85rem;border-collapse:collapse"><tbody>`;
    CASHIER_FIELDS.forEach(f=>{
        const v=d[f.key]||0;
        const clr=getTypeColor(f.type);
        html+=`<tr><td style="padding:4px 8px">${f.label}</td><td style="padding:4px 8px;font-weight:700;color:${clr};text-align:left">${fmtNum(v)} ${cur}</td></tr>`;
    });
    html+=`<tr style="background:var(--surface2)"><td style="padding:4px 8px">إجمالي الخصومات</td><td style="padding:4px 8px;font-weight:700;color:var(--clr-expense);text-align:left">${fmtNum(deductions)} ${cur}</td></tr>`;
    html+=`<tr style="background:var(--surface2)"><td style="padding:4px 8px">الصافي المحسوب</td><td style="padding:4px 8px;font-weight:700;text-align:left;color:${net>=0?'var(--clr-income)':'var(--clr-expense)'}">${fmtNum(net)} ${cur}</td></tr>`;
    if(diff!==0)html+=`<tr style="background:#fef3c7"><td style="padding:4px 8px">الفرق (المستلم - المحسوب)</td><td style="padding:4px 8px;font-weight:700;color:${diff>0?'var(--clr-income)':'var(--clr-expense)'};text-align:left">${fmtNum(diff)} ${cur}</td></tr>`;
    html+=`<tr style="border-top:2px solid var(--border);font-weight:800"><td style="padding:4px 8px">الصافي النهائي</td><td style="padding:4px 8px;color:${net>=0?'var(--clr-income)':'var(--clr-expense)'};text-align:left">${fmtNum(net)} ${cur}</td></tr>`;
    html+=`</tbody></table>`;
    if(cl.debtsList&&cl.debtsList.length){
        html+=`<div style="font-size:.78rem;margin-top:4px;color:#ef4444;font-weight:600">الديون:</div>`;
        cl.debtsList.forEach(db=>html+=`<div style="font-size:.78rem;padding:2px 8px">${db.person}: ${fmtNum(db.amount)} ${cur} ${db.note?'('+db.note+')':''}</div>`);
    }
    if(cl.withdrawList&&cl.withdrawList.length){
        html+=`<div style="font-size:.78rem;margin-top:4px;color:#d97706;font-weight:600">السحوبات:</div>`;
        cl.withdrawList.forEach(w=>html+=`<div style="font-size:.78rem;padding:2px 8px">${w.person}: ${fmtNum(w.amount)} ${cur} ${w.note?'('+w.note+')':''}</div>`);
    }
    if(cl.expensesList&&cl.expensesList.length){
        html+=`<div style="font-size:.78rem;margin-top:4px;color:#f59e0b;font-weight:600">المصاريف:</div>`;
        cl.expensesList.forEach(ex=>html+=`<div style="font-size:.78rem;padding:2px 8px">${ex.desc||'مصروف'}: ${fmtNum(ex.amount)} ${cur}</div>`);
    }
    openModal('تفاصيل تقفيلة '+cl.cashierLabel+' - '+cl.date,html,
        cl.source==='cashier-app'?`<button class="btn btn-warning" onclick="closeModal();openSendAlert('${cl.id}')"><i class="ri-send-plane-line"></i> إرسال تنبيه</button>`:'');
}
function printIndividualClosing(id){
    if(!hasAction('print'))return toast('غير مصرح');
    const cl=loadData(KEYS.individualClosings).find(c=>c.id===id);if(!cl)return;
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const cashierInfo=CASHIERS.find(c=>c.key===cl.cashierKey)||{};
    const d=cl.data||{};
    const deductions=(d.returns||0)+(d.expenses||0)+(d.lunch||0)+(d.debts||0)+(d.withdrawals||0);
    const expected=(d.sales||0)-deductions;
    const diff=(d.network||0)-expected;
    const net=cl.net||0;
    const printDate=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
    let html=`<div class="print-page-border">`;
    html+=`<div class="print-header"><h2>تقفيلة منفصلة - ${cl.cashierLabel}</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">تاريخ التقفيلة: ${cl.date}</p>`;
    html+=`<p class="print-date">تاريخ الطباعة: ${printDate}</p></div>`;
    if(cl.manager)html+=`<div class="print-manager"><i class="ri-user-star-line"></i> المدير المسؤول: ${cl.manager}</div>`;
    html+=`<div class="print-section"><h3>${cl.cashierLabel}${cl.manager?' <span class="print-cashier-mgr">( '+cl.manager+' )</span>':''}</h3><table><tbody>`;
    CASHIER_FIELDS.forEach(f=>{
        const v=d[f.key]||0;
        const pClr=getPrintColorClass(f.type);
        html+=`<tr><td style="width:55%">${f.label}</td><td class="print-amount ${pClr}">${fmtNum(v)} ${cur}</td></tr>`;
    });
    html+=`<tr style="border-top:2px solid #999;background:#f0f0f0"><td style="width:55%"><strong>إجمالي الخصومات</strong></td><td class="print-amount p-expense">${fmtNum(deductions)} ${cur}</td></tr>`;
    html+=`<tr style="background:#f0f0f0"><td style="width:55%"><strong>المتوقع</strong></td><td class="print-amount">${fmtNum(expected)} ${cur}</td></tr>`;
    if(diff!==0)html+=`<tr style="background:#fef9c4"><td style="width:55%"><strong>الفرق</strong></td><td class="print-amount" style="color:${diff>0?'#16a34a':'#dc2626'}">${fmtNum(diff)} ${cur}</td></tr>`;
    html+=`<tr style="border-top:2.5px solid #333;background:#e8e8e8"><td style="width:55%"><strong>الصافي (المبلغ المستلم)</strong></td><td class="print-amount" style="color:${net>=0?'#16a34a':'#dc2626'}">${fmtNum(net)} ${cur}</td></tr>`;
    html+=`</tbody></table>`;
    if(cl.debtsList&&cl.debtsList.length){
        html+=`<div class="print-detail-header" style="color:#ef4444">تفاصيل الديون:</div>`;
        cl.debtsList.forEach(db=>html+=`<div class="print-detail-row">● ${db.person}: ${fmtNum(db.amount)} ${cur} ${db.note?'('+db.note+')':''}</div>`);
    }
    if(cl.withdrawList&&cl.withdrawList.length){
        html+=`<div class="print-detail-header" style="color:#d97706">تفاصيل السحوبات:</div>`;
        cl.withdrawList.forEach(w=>html+=`<div class="print-detail-row">● ${w.person}: ${fmtNum(w.amount)} ${cur} ${w.note?'('+w.note+')':''}</div>`);
    }
    if(cl.expensesList&&cl.expensesList.length){
        html+=`<div class="print-detail-header" style="color:#f59e0b">تفاصيل المصاريف:</div>`;
        cl.expensesList.forEach(ex=>html+=`<div class="print-detail-row">● ${ex.desc||'مصروف'}: ${fmtNum(ex.amount)} ${cur}</div>`);
    }
    html+=`</div>`;
    if(cl.by)html+=`<div style="text-align:center;font-size:11pt;font-weight:600;margin-top:10px;color:#555">بواسطة: ${cl.by}</div>`;
    html+=`</div>`;
    showPrintDialog(html);
}
function _buildIndPrintBlock(cl){
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const cashierInfo=CASHIERS.find(c=>c.key===cl.cashierKey)||{};
    const d=cl.data||{};
    const deductions=(d.returns||0)+(d.expenses||0)+(d.lunch||0)+(d.debts||0)+(d.withdrawals||0);
    const expected=(d.sales||0)-deductions;
    const diff=(d.network||0)-expected;
    const net=cl.net||0;
    let html=`<div class="print-page-border">`;
    html+=`<div class="print-header"><h2>تقفيلة منفصلة - ${cl.cashierLabel}</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">تاريخ التقفيلة: ${cl.date}</p></div>`;
    if(cl.manager)html+=`<div class="print-manager"><i class="ri-user-star-line"></i> المدير المسؤول: ${cl.manager}</div>`;
    html+=`<div class="print-section"><h3>${cl.cashierLabel}${cl.manager?' <span class="print-cashier-mgr">( '+cl.manager+' )</span>':''}</h3><table><tbody>`;
    CASHIER_FIELDS.forEach(f=>{
        const v=d[f.key]||0;
        const pClr=getPrintColorClass(f.type);
        html+=`<tr><td style="width:55%">${f.label}</td><td class="print-amount ${pClr}">${fmtNum(v)} ${cur}</td></tr>`;
    });
    html+=`<tr style="border-top:2px solid #999;background:#f0f0f0"><td style="width:55%"><strong>إجمالي الخصومات</strong></td><td class="print-amount p-expense">${fmtNum(deductions)} ${cur}</td></tr>`;
    html+=`<tr style="background:#f0f0f0"><td style="width:55%"><strong>المتوقع</strong></td><td class="print-amount">${fmtNum(expected)} ${cur}</td></tr>`;
    if(diff!==0)html+=`<tr style="background:#fef9c4"><td style="width:55%"><strong>الفرق</strong></td><td class="print-amount" style="color:${diff>0?'#16a34a':'#dc2626'}">${fmtNum(diff)} ${cur}</td></tr>`;
    html+=`<tr style="border-top:2.5px solid #333;background:#e8e8e8"><td style="width:55%"><strong>الصافي (المبلغ المستلم)</strong></td><td class="print-amount" style="color:${net>=0?'#16a34a':'#dc2626'}">${fmtNum(net)} ${cur}</td></tr>`;
    html+=`</tbody></table>`;
    if(cl.debtsList&&cl.debtsList.length){
        html+=`<div class="print-detail-header" style="color:#ef4444">تفاصيل الديون:</div>`;
        cl.debtsList.forEach(db=>html+=`<div class="print-detail-row">● ${db.person}: ${fmtNum(db.amount)} ${cur} ${db.note?'('+db.note+')':''}</div>`);
    }
    if(cl.withdrawList&&cl.withdrawList.length){
        html+=`<div class="print-detail-header" style="color:#d97706">تفاصيل السحوبات:</div>`;
        cl.withdrawList.forEach(w=>html+=`<div class="print-detail-row">● ${w.person}: ${fmtNum(w.amount)} ${cur} ${w.note?'('+w.note+')':''}</div>`);
    }
    if(cl.expensesList&&cl.expensesList.length){
        html+=`<div class="print-detail-header" style="color:#f59e0b">تفاصيل المصاريف:</div>`;
        cl.expensesList.forEach(ex=>html+=`<div class="print-detail-row">● ${ex.desc||'مصروف'}: ${fmtNum(ex.amount)} ${cur}</div>`);
    }
    html+=`</div>`;
    if(cl.by)html+=`<div style="text-align:center;font-size:11pt;font-weight:600;margin-top:10px;color:#555">بواسطة: ${cl.by}</div>`;
    html+=`</div>`;
    return html;
}
function printAllIndividualClosings(){
    if(!hasAction('print'))return toast('غير مصرح');
    const closings=loadData(KEYS.individualClosings).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    if(!closings.length)return toast('لا توجد تقفيلات منفصلة');
    let html='';
    closings.forEach((cl,i)=>{
        if(i>0)html+=`<div style="page-break-before:always"></div>`;
        html+=_buildIndPrintBlock(cl);
    });
    showPrintDialog(html);
}
function printIndividualByDate(date){
    if(!hasAction('print'))return toast('غير مصرح');
    const closings=loadData(KEYS.individualClosings).filter(c=>c.date===date).sort((a,b)=>(a.cashierKey||'').localeCompare(b.cashierKey||''));
    if(!closings.length)return toast('لا توجد تقفيلات لهذا التاريخ');
    let html='';
    closings.forEach((cl,i)=>{
        if(i>0)html+=`<div style="page-break-before:always"></div>`;
        html+=_buildIndPrintBlock(cl);
    });
    showPrintDialog(html);
}
function getSafeBalance(){
    return loadData(KEYS.safe).reduce((s,t)=>s+(t.type==='deposit'?t.amount:-t.amount),0);
}
function renderSafe(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    $('#safeBalance').textContent=fmtNum(getSafeBalance())+' '+cur;
    const searchVal=($('#safeSearch')?.value||'').trim().toLowerCase();
    let trans=loadData(KEYS.safe).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    if(searchVal)trans=trans.filter(t=>(t.note||'').toLowerCase().includes(searchVal)||t.date.includes(searchVal)||String(t.amount).includes(searchVal));
    const list=$('#safeTransList');
    if(!trans.length){list.innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا توجد معاملات</p></div>';return;}
    /* group by date */
    const groups={};
    trans.forEach(t=>{const d=t.date||'بدون تاريخ';if(!groups[d])groups[d]=[];groups[d].push(t);});
    const allIds=trans.map(t=>t.id);
    let html=_multiSelectBar('safe',KEYS.safe,allIds,'renderSafe');
    const canEdit=hasAction('edit'),canDel=hasAction('delete');
    Object.keys(groups).sort((a,b)=>b.localeCompare(a)).forEach(date=>{
        html+=`<div style="font-size:.82rem;font-weight:700;color:var(--text2);margin:10px 0 4px;padding:4px 8px;background:var(--bg);border-radius:6px">${date}</div>`;
        groups[date].forEach(t=>{
            const isDep=t.type==='deposit';
            const clr=isDep?'income':'expense';
            const sign=isDep?'+':'-';
            const detailsBtn=`<button onclick="viewSafeTransDetails('${t.id}')" title="تفاصيل"><i class="ri-eye-line"></i></button>`;
            const editBtn=canEdit?`<button onclick="editSafeTrans('${t.id}')" title="تعديل"><i class="ri-edit-line"></i></button>`:'';
            const delBtn=canDel?`<button onclick="deleteSafeTrans('${t.id}')" title="حذف"><i class="ri-delete-bin-line"></i></button>`:'';
            const linkBadge=t.closingId?'<span style="background:#dbeafe;color:#1e40af;padding:2px 6px;border-radius:6px;font-size:.65rem;margin-right:4px">مرتبطة بتقفيلة</span>':'';
            const sel=(_selectedIds['safe']&&_selectedIds['safe'].has(t.id))?'selected':'';
            const cb=_multiSelectCheckbox('safe',t.id,'renderSafe');
            html+=`<div class="record-card ${sel}"><div style="display:flex;align-items:center">${cb}<div class="rec-info"><div class="rec-title">${linkBadge}${t.note||t.type}</div><div class="rec-sub">${t.date}${t.by?' | <span class="by-tag">'+t.by+'</span>':''}</div></div></div>
            <div class="rec-amount ${clr}">${sign}${fmtNum(t.amount)} ${cur}</div>
            <div class="rec-actions">${detailsBtn}${editBtn}${delBtn}</div></div>`;
        });
    });
    list.innerHTML=html;
}

/* عرض تفاصيل معاملة الخزنة */
function viewSafeTransDetails(id){
    const trans=loadData(KEYS.safe);
    const t=trans.find(x=>x.id===id);if(!t)return;
    const s=loadSettings();const cur=s.currency||'د.ع';
    const isDep=t.type==='deposit';
    const typeLabel=isDep?'إيداع':'سحب';
    const typeColor=isDep?'#16a34a':'#dc2626';
    let linkedInfo='';
    if(t.closingId){
        const cl=loadData(KEYS.closings).find(c=>c.id===t.closingId);
        if(cl){
            const total=calcClosingTotal(cl);
            linkedInfo=`
            <tr style="background:#dbeafe"><td colspan="2" style="padding:10px"><strong><i class="ri-link"></i> مرتبطة بتقفيلة:</strong></td></tr>
            <tr><td style="padding:8px;color:var(--text2)">التاريخ</td><td style="padding:8px">${cl.date}</td></tr>
            <tr><td style="padding:8px;color:var(--text2)">المدير</td><td style="padding:8px">${cl.manager||'-'}</td></tr>
            <tr><td style="padding:8px;color:var(--text2)">الإجمالي</td><td style="padding:8px;font-weight:700;color:${total>=0?'var(--clr-income)':'var(--clr-expense)'}">${fmtNum(total)} ${cur}</td></tr>
            <tr><td colspan="2" style="padding:8px"><button class="btn btn-sm btn-ghost" onclick="closeModal();navigate('closing');setTimeout(()=>viewClosingDetails('${cl.id}'),200)"><i class="ri-external-link-line"></i> عرض التقفيلة</button></td></tr>`;
        }
    }
    const html=`
    <table style="width:100%;font-size:.9rem;border-collapse:collapse">
        <tbody>
            <tr><td style="padding:8px;color:var(--text2);width:40%">النوع</td><td style="padding:8px"><span style="background:${typeColor};color:#fff;padding:3px 10px;border-radius:10px;font-weight:700;font-size:.82rem">${typeLabel}</span></td></tr>
            <tr style="background:var(--surface2)"><td style="padding:8px;color:var(--text2)">المبلغ</td><td style="padding:8px;font-weight:700;color:${typeColor};font-size:1.15rem">${isDep?'+':'-'}${fmtNum(t.amount)} ${cur}</td></tr>
            <tr><td style="padding:8px;color:var(--text2)">الملاحظة</td><td style="padding:8px">${t.note||'-'}</td></tr>
            <tr style="background:var(--surface2)"><td style="padding:8px;color:var(--text2)">التاريخ</td><td style="padding:8px">${t.date||'-'}</td></tr>
            ${t.by?`<tr><td style="padding:8px;color:var(--text2)">أضيف بواسطة</td><td style="padding:8px">${t.by}</td></tr>`:''}
            ${linkedInfo}
        </tbody>
    </table>`;
    openModal('تفاصيل معاملة الخزنة',html,`<button class="btn btn-ghost" onclick="closeModal()">إغلاق</button>`);
}

function safeTransaction(type){
    if(type==='withdraw'&&!hasAction('addWithdraw'))return toast('غير مصرح - لا تملك صلاحية السحب');
    openModal(type==='deposit'?'إيداع في الخزنة':'سحب من الخزنة',`
    <div class="field"><label>المبلغ (بالآلاف)</label><input type="number" id="safeAmountInput" class="input-field" inputmode="decimal"></div>
    <div class="field"><label>ملاحظة</label><input type="text" id="safeNoteInput" class="input-field"></div>`,
    `<button class="btn btn-success" onclick="confirmSafeTrans('${type}')">تأكيد</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function confirmSafeTrans(type){
    const amount=parseK($('#safeAmountInput').value);
    const note=$('#safeNoteInput').value||'';
    if(!amount)return toast('أدخل المبلغ');
    const safe=loadData(KEYS.safe);
    safe.push({id:uid(),date:today(),type,amount,note,by:getByTag()});
    saveData(KEYS.safe,safe);
    closeModal();toast('تم بنجاح');renderSafe();
}
function editSafeTrans(id){
    if(!hasAction('edit'))return toast('غير مصرح');
    const safe=loadData(KEYS.safe);
    const t=safe.find(x=>x.id===id);if(!t)return;
    openModal('تعديل معاملة الخزنة',`
    <div class="field"><label>النوع</label><select id="editSafeType" class="input-field"><option value="deposit" ${t.type==='deposit'?'selected':''}>إيداع</option><option value="withdraw" ${t.type==='withdraw'?'selected':''}>سحب</option></select></div>
    <div class="field"><label>المبلغ (بالآلاف)</label><input type="number" id="editSafeAmount" class="input-field" value="${toK(t.amount)}" inputmode="decimal"></div>
    <div class="field"><label>ملاحظة</label><input type="text" id="editSafeNote" class="input-field" value="${t.note||''}"></div>
    <div class="field"><label>التاريخ</label><input type="date" id="editSafeDate" class="input-field" value="${t.date}"></div>`,
    `<button class="btn btn-success" onclick="saveEditSafeTrans('${id}')">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function saveEditSafeTrans(id){
    const safe=loadData(KEYS.safe);
    const idx=safe.findIndex(x=>x.id===id);if(idx<0)return;
    safe[idx].type=$('#editSafeType').value;
    safe[idx].amount=parseK($('#editSafeAmount').value);
    safe[idx].note=$('#editSafeNote').value.trim();
    safe[idx].date=$('#editSafeDate').value||safe[idx].date;
    safe[idx].by=getByTag();
    saveData(KEYS.safe,safe);
    closeModal();toast('تم التحديث');renderSafe();renderCapital();
}
function deleteSafeTrans(id){
    if(!hasAction('delete'))return toast('غير مصرح');
    if(!confirm('حذف المعاملة؟'))return;
    let arr=loadData(KEYS.safe);arr=arr.filter(t=>t.id!==id);saveData(KEYS.safe,arr);
    toast('تم الحذف');renderSafe();renderCapital();
}

/* safe print */
function safePrint(){
    if(!hasAction('print'))return toast('غير مصرح');
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const trans=loadData(KEYS.safe).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    const printDate=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
    let html=`<div class="print-page-border">`;
    html+=`<div class="print-header"><h2>كشف الخزنة</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">تاريخ الطباعة: ${printDate}</p></div>`;
    html+=`<table><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>`;
    trans.forEach(t=>{
        const isDep=t.type==='deposit';
        const clr=isDep?'p-income':'p-expense';
        const sign=isDep?'+':'-';
        html+=`<tr><td>${t.date}</td><td>${isDep?'إيداع':'سحب'}</td><td class="${clr}">${sign}${fmtNum(t.amount)} ${cur}</td><td>${t.note||''}</td></tr>`;
    });
    html+=`</tbody></table>`;
    html+=`<div class="print-total" style="color:${getSafeBalance()>=0?'#16a34a':'#dc2626'}">الرصيد: ${fmtNum(getSafeBalance())} ${cur}</div>`;
    html+=`</div>`;
    showPrintDialog(html);
}

/* safe export JSON */
function safeExport(){
    if(!hasAction('export'))return toast('غير مصرح - لا تملك صلاحية التصدير');
    const trans=loadData(KEYS.safe);
    if(!trans.length)return toast('لا توجد بيانات');
    const blob=new Blob([JSON.stringify(trans,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='safe_'+today()+'.json';a.click();
    toast('تم تصدير الخزنة');
}

/* safe import JSON */
function safeImport(){
    if(!hasAction('import'))return toast('غير مصرح - لا تملك صلاحية الاستيراد');
    importPage('safe','الخزنة',renderSafe);
}

/* ========= DEBTS ========= */
let debtTab='employees';
let debtFilter='all'; // 'all' | 'employees' | 'customers'
function renderDebts(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const debts=loadData(KEYS.debts);
    const emps=loadData(KEYS.employees).map(e=>e.name);
    const searchVal=($('#debtsSearch')?.value||'').trim().toLowerCase();

    /* filter buttons */
    $$('[data-dfilter]').forEach(b=>{b.classList.toggle('active',b.dataset.dfilter===debtFilter);});

    /* compute counts and totals */
    const empDebts=debts.filter(d=>emps.includes(d.person));
    const custDebts=debts.filter(d=>!emps.includes(d.person));
    const empTotal=empDebts.reduce((s,d)=>s+d.amount,0);
    const custTotal=custDebts.reduce((s,d)=>s+d.amount,0);
    const allTotal=debts.reduce((s,d)=>s+d.amount,0);

    /* update filter counts */
    const cAll=$('#debtsCountAll');if(cAll)cAll.textContent=debts.length;
    const cEmp=$('#debtsCountEmp');if(cEmp)cEmp.textContent=empDebts.length;
    const cCust=$('#debtsCountCust');if(cCust)cCust.textContent=custDebts.length;

    /* summary cards */
    const summaryEl=$('#debtsSummaryCards');
    if(summaryEl){
        summaryEl.innerHTML=`
        <div class="debts-summary-card"><div class="dsc-label">إجمالي الديون</div><div class="dsc-val" style="color:var(--danger)">${fmtNum(allTotal)} ${cur}</div></div>
        <div class="debts-summary-card"><div class="dsc-label">ديون الموظفين</div><div class="dsc-val" style="color:#8b5cf6">${fmtNum(empTotal)} ${cur}</div></div>
        <div class="debts-summary-card"><div class="dsc-label">ديون العملاء</div><div class="dsc-val" style="color:#ef4444">${fmtNum(custTotal)} ${cur}</div></div>`;
    }

    /* apply filter */
    let filtered;
    if(debtFilter==='employees') filtered=empDebts;
    else if(debtFilter==='customers') filtered=custDebts;
    else filtered=debts;

    if(searchVal)filtered=filtered.filter(d=>d.person.toLowerCase().includes(searchVal)||(d.note||'').toLowerCase().includes(searchVal)||d.date.includes(searchVal));

    /* persons grid */
    const persons={};
    filtered.forEach(d=>{if(!persons[d.person])persons[d.person]=0;persons[d.person]+=d.amount;});
    const grid=$('#debtsPersonsList');
    const pKeys=Object.keys(persons);
    if(!pKeys.length){grid.innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا توجد ديون</p></div>';}
    else{grid.innerHTML=pKeys.map(p=>{
        const safePerson=p.replace(/'/g,"\\'");
        return `<div class="person-card" onclick="showPersonDebts('${safePerson}')" style="position:relative">
            <button class="person-quick-add" onclick="event.stopPropagation();quickAddDebtFor('${safePerson}')" title="إضافة دين جديد لـ ${p}" style="position:absolute;top:6px;left:6px;background:linear-gradient(135deg,#dc2626,#991b1b);color:#fff;border:none;width:32px;height:32px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:1.1rem;box-shadow:0 2px 6px rgba(220,38,38,.4);z-index:2">
                <i class="ri-add-line"></i>
            </button>
            <div class="person-icon"><i class="ri-user-line"></i></div>
            <div class="person-name">${p}</div>
            <div class="person-amount">${fmtNum(persons[p])} ${cur}</div>
        </div>`;
    }).join('');}

    /* all debts list */
    const allList=$('#debtsAllList');
    const sorted=filtered.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    const debtIds=sorted.map(d=>d.id);
    let debtHtml=_multiSelectBar('debts',KEYS.debts,debtIds,'renderDebts');
    debtHtml+=sorted.map(d=>{
        const clr=d.type==='repayment'?'income-clr':d.type==='withdraw'?'withdraw-clr':'debt-clr';
        const icon=d.type==='repayment'?'ri-refund-line':d.type==='withdraw'?'ri-hand-coin-line':'ri-file-list-3-line';
        const iconColor=d.type==='repayment'?'var(--clr-income)':d.type==='withdraw'?'var(--clr-withdraw)':'var(--clr-debt)';
        const editBtn=hasAction('edit')?`<button onclick="editDebt('${d.id}')" title="تعديل"><i class="ri-edit-line"></i></button>`:'';
        const delBtn=hasAction('delete')?`<button onclick="deleteDebt('${d.id}')"><i class="ri-delete-bin-line"></i></button>`:'';
        const sel=(_selectedIds['debts']&&_selectedIds['debts'].has(d.id))?'selected':'';
        const cb=_multiSelectCheckbox('debts',d.id,'renderDebts');
        return `<div class="record-card ${sel}"><div style="display:flex;align-items:center">${cb}<div class="rec-info"><div class="rec-title"><i class="${icon}" style="color:${iconColor}"></i> ${d.person}</div><div class="rec-sub">${d.date} - ${d.note||d.cashier||''}${d.by?' | <span class="by-tag">'+d.by+'</span>':''}</div></div></div>
        <div class="rec-amount ${clr}">${fmtNum(d.amount)} ${cur}</div>
        <div class="rec-actions">${editBtn}${delBtn}</div></div>`;
    }).join('');
    allList.innerHTML=debtHtml;

    /* total */
    const total=filtered.reduce((s,d)=>s+d.amount,0);
    $('#debtsTotalDisp').textContent=fmtNum(total)+' '+cur;
}
/* ======== QUICK ADD DEBT FOR SPECIFIC PERSON ======== */
function quickAddDebtFor(personName){
    if(!hasAction('addDebt'))return toast('غير مصرح - لا تملك صلاحية إضافة ديون');
    if(!personName)return;
    const s=loadSettings();const cur=s.currency||'د.ع';
    const debts=loadData(KEYS.debts);
    const currentBalance=debts.filter(d=>d.person===personName).reduce((t,d)=>t+d.amount,0);
    const cashierOpts=`<option value="">-- عام --</option>`+CASHIERS.map(c=>`<option value="${c.label}">${c.label}</option>`).join('');

    const html=`
        <div style="background:linear-gradient(135deg,#fee2e2,#fecaca);border:1px solid #f87171;border-radius:10px;padding:12px;margin-bottom:14px">
            <div style="display:flex;align-items:center;gap:10px">
                <div style="width:42px;height:42px;background:#dc2626;color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.2rem">
                    <i class="ri-user-line"></i>
                </div>
                <div style="flex:1">
                    <div style="font-weight:800;color:#7f1d1d">${personName}</div>
                    <div style="font-size:.78rem;color:#991b1b">الرصيد الحالي: <strong>${fmtNum(currentBalance)} ${cur}</strong></div>
                </div>
            </div>
        </div>
        <div class="field"><label>المبلغ الجديد (بالآلاف)</label>
            <input type="number" id="qAddDebtAmount" class="input-field" inputmode="decimal" placeholder="مثال: 25 = 25,000" autofocus>
        </div>
        <div class="field"><label>السبب / ملاحظة</label>
            <input type="text" id="qAddDebtNote" class="input-field" placeholder="مثال: ملابس، عطر، بضاعة...">
        </div>
        <div class="field"><label>الكاشير المرتبط</label>
            <select id="qAddDebtCashier" class="input-field">${cashierOpts}</select>
        </div>
        <div class="field"><label>التاريخ</label>
            <input type="date" id="qAddDebtDate" class="input-field" value="${today()}">
        </div>
        <div style="background:#fef3c7;padding:8px 10px;border-radius:6px;font-size:.78rem;color:#92400e;margin-top:8px">
            <i class="ri-information-line"></i> بعد الإضافة سيصبح رصيد <strong>${personName}</strong> هو: <span id="qAddDebtPreview">${fmtNum(currentBalance)} ${cur}</span>
        </div>`;
    openModal('إضافة دين جديد على '+personName, html,
        `<button class="btn btn-danger" onclick="confirmQuickAddDebt('${personName.replace(/'/g,"\\'")}')"><i class="ri-add-circle-line"></i> إضافة الدين</button>
         <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
    /* live preview of new balance */
    setTimeout(()=>{
        const amtInput=document.getElementById('qAddDebtAmount');
        const preview=document.getElementById('qAddDebtPreview');
        if(amtInput&&preview){
            amtInput.addEventListener('input',()=>{
                const v=parseK(amtInput.value)||0;
                preview.innerHTML=`<strong style="color:${(currentBalance+v)>0?'#dc2626':'#16a34a'}">${fmtNum(currentBalance+v)} ${cur}</strong>`;
            });
            amtInput.focus();
        }
    },100);
}

function confirmQuickAddDebt(personName){
    const amount=parseK(document.getElementById('qAddDebtAmount')?.value);
    if(!amount||amount<=0)return toast('أدخل مبلغاً صحيحاً');
    const note=(document.getElementById('qAddDebtNote')?.value||'').trim();
    const cashier=document.getElementById('qAddDebtCashier')?.value||'';
    const date=document.getElementById('qAddDebtDate')?.value||today();
    const by=getByTag();
    const debts=loadData(KEYS.debts);
    debts.push({
        id:uid(),
        person:personName,
        amount:amount,
        note:note,
        type:'debt',
        cashier:cashier,
        date:date,
        by:by
    });
    saveData(KEYS.debts,debts);
    closeModal();
    toast('✅ تمت إضافة '+fmtNum(amount)+' على '+personName);
    renderDebts();
}

/* ======== SEARCHABLE PERSON SELECTOR HELPER ======== */
function buildPersonSelector(selectId,newInputId,names,placeholder){
    placeholder=placeholder||'-- اختر شخص --';
    const opts=names.map(n=>`<option value="${n}">${n}</option>`).join('');
    return `<div class="field"><label>الشخص</label>
        <input type="text" id="${selectId}_search" class="input-field" placeholder="🔍 بحث عن اسم..." style="margin-bottom:6px" oninput="filterPersonSelect('${selectId}',this.value)">
        <select id="${selectId}" class="input-field">
            <option value="__new__">+ اسم جديد</option>
            <option value="">${placeholder}</option>${opts}
        </select>
        <input type="text" id="${newInputId}" class="input-field" placeholder="اسم الشخص الجديد" style="display:none;margin-top:6px">
    </div>`;
}
function filterPersonSelect(selectId,query){
    const sel=document.getElementById(selectId);
    if(!sel)return;
    const q=query.trim().toLowerCase();
    [...sel.options].forEach(opt=>{
        if(opt.value==='__new__'||opt.value==='')opt.style.display='';
        else opt.style.display=opt.textContent.toLowerCase().includes(q)?'':'none';
    });
}
function initPersonSelector(selectId,newInputId){
    setTimeout(()=>{
        const sel=document.getElementById(selectId);
        if(sel)sel.addEventListener('change',()=>{
            const ni=document.getElementById(newInputId);
            if(ni)ni.style.display=sel.value==='__new__'?'':'none';
        });
        // default to showing new name field since __new__ is first option
        const ni=document.getElementById(newInputId);
        if(ni&&sel&&sel.value==='__new__')ni.style.display='';
    },100);
}

/* ======== ADD DEBT MANUALLY ======== */
function openAddDebtModal(){
    if(!hasAction('addDebt'))return toast('غير مصرح - لا تملك صلاحية إضافة ديون');
    const emps=loadData(KEYS.employees).map(e=>e.name);
    const debts=loadData(KEYS.debts);
    const allNames=[...new Set([...emps,...debts.map(d=>d.person)])].filter(Boolean);
    const cashierOpts=`<option value="">-- عام --</option>`+[...CASHIERS.map(c=>c.label)].map(c=>`<option value="${c}">${c}</option>`).join('');
    openModal('إضافة دين جديد',`
        ${buildPersonSelector('addDebtPerson','addDebtPersonNew',allNames,'-- اختر شخص --')}
        <div class="field"><label>المبلغ (بالآلاف)</label><input type="number" id="addDebtAmount" class="input-field" inputmode="decimal" placeholder="مثال: 50 = 50,000"></div>
        <div class="field"><label>ملاحظة / السبب</label><input type="text" id="addDebtNote" class="input-field" placeholder="مثال: ملابس، عطر..."></div>
        <div class="field"><label>الكاشير المرتبط</label><select id="addDebtCashier" class="input-field">${cashierOpts}</select></div>
        <div class="field"><label>التاريخ</label><input type="date" id="addDebtDate" class="input-field" value="${today()}"></div>`,
    `<button class="btn btn-danger" onclick="confirmAddDebt()"><i class="ri-add-circle-line"></i> إضافة الدين</button>
     <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
    initPersonSelector('addDebtPerson','addDebtPersonNew');
}
function confirmAddDebt(){
    const sel=document.getElementById('addDebtPerson');
    let person=sel?sel.value:'';
    if(person==='__new__'){const ni=document.getElementById('addDebtPersonNew');person=ni?ni.value.trim():'';}
    person=(person||'').trim();
    if(!person)return toast('أدخل اسم الشخص');
    const amount=parseK(document.getElementById('addDebtAmount')?.value);
    if(!amount||amount<=0)return toast('أدخل مبلغاً صحيحاً');
    const note=(document.getElementById('addDebtNote')?.value||'').trim();
    const cashier=document.getElementById('addDebtCashier')?.value||'';
    const date=document.getElementById('addDebtDate')?.value||today();
    const by=getByTag();
    const debts=loadData(KEYS.debts);
    debts.push({id:uid(),person,amount,note,type:'debt',cashier,date,by});
    saveData(KEYS.debts,debts);
    closeModal();toast('تم إضافة دين '+fmtNum(amount)+' على '+person);renderDebts();
}

/* ======== ADD WITHDRAWAL DEBT MANUALLY ======== */
function openAddWithdrawDebtModal(){
    if(!hasAction('addWithdraw'))return toast('غير مصرح - لا تملك صلاحية إضافة سحب');
    const emps=loadData(KEYS.employees).map(e=>e.name);
    const debts=loadData(KEYS.debts);
    const allNames=[...new Set([...emps,...debts.map(d=>d.person)])].filter(Boolean);
    openModal('إضافة سحب',`
        ${buildPersonSelector('addWdPerson','addWdPersonNew',allNames,'-- اختر شخص --')}
        <div class="field"><label>المبلغ (بالآلاف)</label><input type="number" id="addWdAmount" class="input-field" inputmode="decimal"></div>
        <div class="field"><label>ملاحظة</label><input type="text" id="addWdNote" class="input-field" placeholder="مثال: سلفة، بضاعة..."></div>
        <div class="field"><label>التاريخ</label><input type="date" id="addWdDate" class="input-field" value="${today()}"></div>`,
    `<button class="btn btn-warning" onclick="confirmAddWithdrawDebt()"><i class="ri-hand-coin-line"></i> إضافة السحب</button>
     <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
    initPersonSelector('addWdPerson','addWdPersonNew');
}
function confirmAddWithdrawDebt(){
    const sel=document.getElementById('addWdPerson');
    let person=sel?sel.value:'';
    if(person==='__new__'){const ni=document.getElementById('addWdPersonNew');person=ni?ni.value.trim():'';}
    person=(person||'').trim();
    if(!person)return toast('أدخل اسم الشخص');
    const amount=parseK(document.getElementById('addWdAmount')?.value);
    if(!amount||amount<=0)return toast('أدخل مبلغاً صحيحاً');
    const note=(document.getElementById('addWdNote')?.value||'').trim()||'سحب';
    const date=document.getElementById('addWdDate')?.value||today();
    const by=getByTag();
    const debts=loadData(KEYS.debts);
    debts.push({id:uid(),person,amount,note:'سحب: '+note,type:'withdraw',cashier:'',date,by});
    saveData(KEYS.debts,debts);
    const wds=loadData(KEYS.withdrawals);
    wds.push({id:uid(),person,amount,note,cashier:'',date,by});
    saveData(KEYS.withdrawals,wds);
    closeModal();toast('تم إضافة سحب '+fmtNum(amount)+' لـ '+person);renderDebts();
}

/* ======== ADD EXPENSE MANUALLY ======== */
function openAddExpenseModal(){
    if(!hasAction('addExpense'))return toast('غير مصرح - لا تملك صلاحية إضافة مصاريف');
    const cashierOpts=CASHIERS.map(c=>`<option value="${c.label}">${c.label}</option>`).join('');
    openModal('إضافة مصروف',`
        <div class="field"><label>الوصف</label><input type="text" id="addExpDesc" class="input-field" placeholder="مثال: مواد تنظيف، غداء موظفين..."></div>
        <div class="field"><label>المبلغ (بالآلاف)</label><input type="number" id="addExpAmount" class="input-field" inputmode="decimal" placeholder="مثال: 15 = 15,000"></div>
        <div class="field"><label>الكاشير المرتبط</label>
            <select id="addExpCashier" class="input-field">
                <option value="">-- عام --</option>${cashierOpts}
            </select>
        </div>
        <div class="field"><label>التاريخ</label><input type="date" id="addExpDate" class="input-field" value="${today()}"></div>`,
    `<button class="btn btn-primary" onclick="confirmAddExpense()"><i class="ri-add-circle-line"></i> إضافة المصروف</button>
     <button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function confirmAddExpense(){
    const desc=(document.getElementById('addExpDesc')?.value||'').trim();
    if(!desc)return toast('أدخل وصف المصروف');
    const amount=parseK(document.getElementById('addExpAmount')?.value);
    if(!amount||amount<=0)return toast('أدخل مبلغاً صحيحاً');
    const cashier=document.getElementById('addExpCashier')?.value||'';
    const date=document.getElementById('addExpDate')?.value||today();
    const by=getByTag();
    const entries=loadData(KEYS.expenseEntries);
    entries.push({id:uid(),amount,desc,cashier,date,by});
    saveData(KEYS.expenseEntries,entries);
    closeModal();toast('تم إضافة مصروف '+fmtNum(amount));renderExpenses();
}

function deleteDebt(id){
    if(!hasAction('delete'))return toast('غير مصرح');
    if(!confirm('حذف؟'))return;
    let arr=loadData(KEYS.debts);arr=arr.filter(d=>d.id!==id);saveData(KEYS.debts,arr);
    toast('تم الحذف');renderDebts();
}
function editDebt(id){
    if(!hasAction('edit'))return toast('غير مصرح');
    const debts=loadData(KEYS.debts);
    const d=debts.find(x=>x.id===id);if(!d)return;
    openModal('تعديل الدين',`
    <div class="field"><label>الشخص</label><input type="text" id="editDebtPerson" class="input-field" value="${d.person}"></div>
    <div class="field"><label>المبلغ (بالآلاف)</label><input type="number" id="editDebtAmount" class="input-field" value="${toK(d.amount)}"></div>
    <div class="field"><label>ملاحظة</label><input type="text" id="editDebtNote" class="input-field" value="${d.note||''}"></div>
    <div class="field"><label>التاريخ</label><input type="date" id="editDebtDate" class="input-field" value="${d.date}"></div>`,
    `<button class="btn btn-success" onclick="saveEditDebt('${id}')">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function saveEditDebt(id){
    const debts=loadData(KEYS.debts);
    const idx=debts.findIndex(x=>x.id===id);if(idx<0)return;
    debts[idx].person=$('#editDebtPerson').value.trim()||debts[idx].person;
    debts[idx].amount=parseK($('#editDebtAmount').value)||debts[idx].amount;
    debts[idx].note=$('#editDebtNote').value.trim();
    debts[idx].date=$('#editDebtDate').value||debts[idx].date;
    debts[idx].by=getByTag();
    saveData(KEYS.debts,debts);
    closeModal();toast('تم التحديث');renderDebts();
}
function showPersonDebts(person){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const debts=loadData(KEYS.debts).filter(d=>d.person===person);
    const total=debts.reduce((s,d)=>s+d.amount,0);
    let html=`<div style="text-align:center;margin-bottom:10px"><div style="font-size:.85rem;color:var(--text2)">إجمالي الديون</div><div style="font-size:1.4rem;font-weight:800;color:${total>0?'var(--danger)':'var(--success)'}">${fmtNum(total)} ${cur}</div></div>`;
    html+=`<div class="records-list">`;
    debts.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).forEach(d=>{
        const clr=d.type==='repayment'?'income-clr':d.type==='withdraw'?'withdraw-clr':'debt-clr';
        const lbl=d.type==='repayment'?'تسديد':d.type==='withdraw'?'سحب':'دين';
        html+=`<div class="record-card"><div class="rec-info"><div class="rec-title">${lbl}</div><div class="rec-sub">${d.date} - ${d.note||d.cashier||''}</div></div><div class="rec-amount ${clr}">${fmtNum(d.amount)} ${cur}</div></div>`;
    });
    html+=`</div>`;
    html+=`<button class="btn btn-danger btn-block" onclick="closeModal();setTimeout(()=>quickAddDebtFor('${person.replace(/'/g,"\\'")}'),150)" style="margin-top:10px"><i class="ri-add-circle-line"></i> إضافة دين جديد</button>`;
    if(total>0){
        html+=`<button class="btn btn-success btn-block" onclick="repayDebt('${person}')" style="margin-top:6px"><i class="ri-money-dollar-circle-line"></i> تسديد دين</button>`;
    }
    html+=`<button class="btn btn-warning btn-block" onclick="printPersonDebts('${person}')" style="margin-top:6px"><i class="ri-printer-line"></i> طباعة</button>`;
    openModal('ديون '+person,html);
}
function repayDebt(person){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const debts=loadData(KEYS.debts).filter(d=>d.person===person);
    const total=debts.reduce((s,d)=>s+d.amount,0);
    let html=`<div style="background:var(--bg);padding:10px;border-radius:8px;margin-bottom:10px;font-size:.85rem">
        <div>إجمالي الديون الحالية: <strong style="color:var(--danger)">${fmtNum(total)} ${cur}</strong></div>
    </div>`;
    html+=`<div class="field"><label>مبلغ التسديد (بالآلاف)</label><input type="number" id="repayAmountInput" class="input-field" value="${toK(total)}" inputmode="decimal"></div>`;
    html+=`<div class="field"><label>ملاحظة</label><input type="text" id="repayNoteInput" class="input-field" placeholder="مثال: تسديد نقدي"></div>`;
    openModal('تسديد دين - '+person,html,
    `<button class="btn btn-success" onclick="confirmRepayDebt('${person}')">تأكيد التسديد</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function confirmRepayDebt(person){
    const repayAmount=parseK($('#repayAmountInput').value);
    if(!repayAmount||repayAmount<=0)return toast('أدخل مبلغ التسديد');
    const note=$('#repayNoteInput').value.trim()||'تسديد دين';
    const by=getByTag();

    /* reduce existing debt records */
    const debts=loadData(KEYS.debts);
    let remaining=repayAmount;
    const personDebts=debts.filter(d=>d.person===person&&d.amount>0).sort((a,b)=>new Date(a.date)-new Date(b.date));
    for(let d of personDebts){
        if(remaining<=0)break;
        if(d.amount<=remaining){remaining-=d.amount;d.amount=0;}
        else{d.amount-=remaining;remaining=0;}
    }
    /* add repayment record for tracking */
    debts.push({id:uid(),person,amount:-repayAmount,note,type:'repayment',cashier:'',date:today(),by});
    saveData(KEYS.debts,debts.filter(d=>d.amount!==0));

    /* add to safe as deposit */
    const safe=loadData(KEYS.safe);
    safe.push({id:uid(),date:today(),type:'deposit',amount:repayAmount,note:'تسديد دين: '+person+' - '+note,by});
    saveData(KEYS.safe,safe);

    closeModal();toast('تم تسديد '+fmtNum(repayAmount)+' من دين '+person);renderDebts();
}
function printPersonDebts(person){
    if(!hasAction('print'))return toast('غير مصرح');
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const debts=loadData(KEYS.debts).filter(d=>d.person===person);
    const total=debts.reduce((s,d)=>s+d.amount,0);
    const printDate=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
    let html=`<div class="print-page-border">`;
    html+=`<div class="print-header"><h2>كشف ديون: ${person}</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">تاريخ الطباعة: ${printDate}</p></div>`;
    html+=`<table><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>`;
    debts.forEach(d=>{
        const clr=d.type==='repayment'?'p-income':d.type==='withdraw'?'p-withdraw':'p-debt';
        const lbl=d.type==='repayment'?'تسديد':d.type==='withdraw'?'سحب':'دين';
        html+=`<tr><td>${d.date}</td><td>${lbl}</td><td class="${clr}">${fmtNum(d.amount)} ${cur}</td><td>${d.note||''}</td></tr>`;
    });
    html+=`</tbody></table>`;
    html+=`<div class="print-total" style="color:#dc2626">الإجمالي: ${fmtNum(total)} ${cur}</div>`;
    html+=`</div>`;
    closeModal();showPrintDialog(html);
}

/* ========= EXPENSES ========= */
function renderExpenses(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const monthInput=$('#expFilterMonth');
    if(!monthInput.value)monthInput.value=today().slice(0,7);
    const ym=monthInput.value;

    /* new individual expense entries - استبعاد مصاريف "إدارة" و "عامة" (تظهر في صفحة المصاريف العامة) */
    let entries=loadData(KEYS.expenseEntries).filter(e=>e.date&&e.date.startsWith(ym)&&(e.type||'dept')==='dept');

    /* legacy expenses from closings (lunch + expenses without detail) */
    const closings=loadData(KEYS.closings).filter(c=>c.date&&c.date.startsWith(ym));
    closings.forEach(c=>{
        CASHIERS.forEach(cs=>{
            const d=c.cashiers[cs.key];if(!d)return;
            if(d.lunch)entries.push({id:null,date:c.date,cashier:cs.label,desc:'غداء',amount:d.lunch,legacy:true});
            if(d.expenses&&(!d.expensesList||!d.expensesList.length)){
                entries.push({id:null,date:c.date,cashier:cs.label,desc:'مصاريف',amount:d.expenses,legacy:true});
            }
        });
    });

    const expSearch=($('#expSearch')?.value||'').trim().toLowerCase();
    if(expSearch)entries=entries.filter(e=>(e.desc||'').toLowerCase().includes(expSearch)||(e.cashier||'').toLowerCase().includes(expSearch)||e.date.includes(expSearch));
    const list=$('#expensesList');
    if(!entries.length){list.innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا توجد مصاريف</p></div>';$('#expTotalDisp').textContent='0';return;}
    const canEdit=hasAction('edit'),canDel=hasAction('delete');
    const delEntries=entries.filter(e=>e.id&&!e.legacy);
    const allIds=delEntries.map(e=>e.id);
    let listHtml=_multiSelectBar('expenses',KEYS.expenseEntries,allIds,'renderExpenses');
    listHtml+=entries.map(e=>{
        const detailsBtn=e.id&&!e.legacy?`<button onclick="viewExpenseDetails('${e.id}')" title="تفاصيل"><i class="ri-eye-line"></i></button>`:'';
        const convertBtn=e.id&&!e.legacy?`<button onclick="convertExpenseType('${e.id}')" title="تحويل إلى عامة/إدارة" style="color:#f97316"><i class="ri-swap-line"></i></button>`:'';
        const editBtn=e.id&&!e.legacy&&canEdit?`<button onclick="editExpense('${e.id}')" title="تعديل"><i class="ri-edit-line"></i></button>`:'';
        const delBtn=e.id&&!e.legacy&&canDel?`<button onclick="deleteExpense('${e.id}')" title="حذف"><i class="ri-delete-bin-line"></i></button>`:'';
        const actions=(detailsBtn||convertBtn||editBtn||delBtn)?`<div class="rec-actions">${detailsBtn}${convertBtn}${editBtn}${delBtn}</div>`:'';
        const legacyBadge=e.legacy?'<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:6px;font-size:.68rem;margin-right:4px">قديم</span>':'';
        const sel=e.id&&(_selectedIds['expenses']&&_selectedIds['expenses'].has(e.id))?'selected':'';
        const cb=e.id&&!e.legacy?_multiSelectCheckbox('expenses',e.id,'renderExpenses'):'';
        return `<div class="record-card ${sel}"><div style="display:flex;align-items:center">${cb}<div class="rec-info"><div class="rec-title">${legacyBadge}${e.desc||'مصروف'}${e.cashier?' - '+e.cashier:''}</div><div class="rec-sub">${e.date}${e.by?' | <span class="by-tag">'+e.by+'</span>':''}</div></div></div><div class="rec-amount expense">${fmtNum(e.amount)} ${cur}</div>${actions}</div>`;
    }).join('');
    list.innerHTML=listHtml;
    const total=entries.reduce((s,e)=>s+e.amount,0);
    $('#expTotalDisp').textContent=fmtNum(total)+' '+cur;
}

/* عرض تفاصيل المصروف */
function viewExpenseDetails(id){
    const entries=loadData(KEYS.expenseEntries);
    const e=entries.find(x=>x.id===id);if(!e)return;
    const s=loadSettings();const cur=s.currency||'د.ع';
    const typeLabel={dept:'قسم',general:'عامة',admin:'إدارة'}[(e.type||'dept')]||'قسم';
    const typeColor={dept:'#6366f1',general:'#0891b2',admin:'#7c3aed'}[(e.type||'dept')]||'#6366f1';
    const html=`
    <table style="width:100%;font-size:.9rem;border-collapse:collapse">
        <tbody>
            <tr><td style="padding:8px;color:var(--text2)">الوصف</td><td style="padding:8px;font-weight:700">${e.desc||'-'}</td></tr>
            <tr style="background:var(--surface2)"><td style="padding:8px;color:var(--text2)">المبلغ</td><td style="padding:8px;font-weight:700;color:var(--clr-expense);font-size:1.1rem">${fmtNum(e.amount)} ${cur}</td></tr>
            <tr><td style="padding:8px;color:var(--text2)">النوع</td><td style="padding:8px"><span style="background:${typeColor};color:#fff;padding:3px 10px;border-radius:10px;font-weight:700;font-size:.82rem">${typeLabel}</span></td></tr>
            <tr style="background:var(--surface2)"><td style="padding:8px;color:var(--text2)">القسم</td><td style="padding:8px">${e.cashier||'-'}</td></tr>
            <tr><td style="padding:8px;color:var(--text2)">التاريخ</td><td style="padding:8px">${e.date||'-'}</td></tr>
            ${e.by?`<tr style="background:var(--surface2)"><td style="padding:8px;color:var(--text2)">أضيف بواسطة</td><td style="padding:8px">${e.by}</td></tr>`:''}
        </tbody>
    </table>`;
    openModal('تفاصيل المصروف',html,`<button class="btn btn-ghost" onclick="closeModal()">إغلاق</button>`);
}

/* تحويل نوع المصروف (dept → general/admin أو العكس) */
function convertExpenseType(id){
    if(!hasAction('edit'))return toast('غير مصرح');
    const entries=loadData(KEYS.expenseEntries);
    const e=entries.find(x=>x.id===id);if(!e)return;
    const curType=e.type||'dept';
    const s=loadSettings();const cur=s.currency||'د.ع';
    const html=`
    <div style="padding:8px;background:var(--surface2);border-radius:8px;margin-bottom:12px">
        <div style="font-size:.82rem;color:var(--text2)">${e.desc||'مصروف'}</div>
        <div style="font-weight:800;color:var(--clr-expense);font-size:1.1rem">${fmtNum(e.amount)} ${cur}</div>
    </div>
    <div class="field"><label>حوّل المصروف إلى:</label>
        <div style="display:flex;gap:6px;margin-top:6px">
            <button class="btn ${curType==='dept'?'btn-primary':'btn-ghost'}" onclick="doConvertExpense('${id}','dept')" style="flex:1"><i class="ri-store-line"></i> قسم</button>
            <button class="btn ${curType==='general'?'btn-primary':'btn-ghost'}" onclick="doConvertExpense('${id}','general')" style="flex:1;background:${curType==='general'?'#0891b2':''}"><i class="ri-building-line"></i> عامة</button>
            <button class="btn ${curType==='admin'?'btn-primary':'btn-ghost'}" onclick="doConvertExpense('${id}','admin')" style="flex:1;background:${curType==='admin'?'#7c3aed':''}"><i class="ri-user-star-line"></i> إدارة</button>
        </div>
    </div>
    <div style="font-size:.78rem;color:var(--text2);margin-top:8px;line-height:1.5;background:#fef3c7;padding:8px;border-radius:6px">
        <i class="ri-information-line"></i> ملاحظة: سيتم تغيير النوع فقط دون تعديل التقفيلة المرتبطة. سيظهر المصروف في الصفحة المناسبة لنوعه الجديد.
    </div>`;
    openModal('تحويل نوع المصروف',html,`<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function doConvertExpense(id,newType){
    const entries=loadData(KEYS.expenseEntries);
    const idx=entries.findIndex(x=>x.id===id);if(idx<0)return;
    const oldType=entries[idx].type||'dept';
    if(oldType===newType){closeModal();toast('النوع لم يتغير');return;}
    entries[idx].type=newType;
    saveData(KEYS.expenseEntries,entries);
    closeModal();
    const labels={dept:'القسم',general:'العامة',admin:'الإدارة'};
    toast('تم التحويل إلى مصاريف '+labels[newType]);
    /* إعادة تحديث الصفحة النشطة */
    const active=_currentPage();
    if(active==='expenses') renderExpenses();
    else if(active==='generalExpenses') renderGeneralExpenses();
}
function editExpense(id){
    if(!hasAction('edit'))return toast('غير مصرح');
    const entries=loadData(KEYS.expenseEntries);
    const e=entries.find(x=>x.id===id);if(!e)return;
    openModal('تعديل المصروف',`
    <div class="field"><label>الوصف</label><input type="text" id="editExpDesc" class="input-field" value="${e.desc||''}"></div>
    <div class="field"><label>المبلغ (بالآلاف)</label><input type="number" id="editExpAmount" class="input-field" value="${toK(e.amount)}" inputmode="decimal"></div>
    <div class="field"><label>التاريخ</label><input type="date" id="editExpDate" class="input-field" value="${e.date}"></div>`,
    `<button class="btn btn-success" onclick="saveEditExpense('${id}')">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function saveEditExpense(id){
    const entries=loadData(KEYS.expenseEntries);
    const idx=entries.findIndex(x=>x.id===id);if(idx<0)return;
    entries[idx].desc=$('#editExpDesc').value.trim();
    entries[idx].amount=parseK($('#editExpAmount').value);
    entries[idx].date=$('#editExpDate').value||entries[idx].date;
    entries[idx].by=getByTag();
    saveData(KEYS.expenseEntries,entries);
    closeModal();toast('تم التحديث');renderExpenses();
}
function deleteExpense(id){
    if(!hasAction('delete'))return toast('غير مصرح');
    if(!confirm('حذف المصروف؟'))return;
    let arr=loadData(KEYS.expenseEntries);arr=arr.filter(e=>e.id!==id);saveData(KEYS.expenseEntries,arr);
    toast('تم الحذف');renderExpenses();
}

/* ========= SALARIES ========= */
function renderSalaries(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const emps=loadData(KEYS.employees);
    const searchVal=($('#salSearch')?.value||'').trim().toLowerCase();
    const grid=$('#employeesGrid');
    let filtered=emps;
    if(searchVal)filtered=emps.filter(e=>e.name.toLowerCase().includes(searchVal)||(e.role||'').toLowerCase().includes(searchVal));
    if(!filtered.length){grid.innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا يوجد موظفين</p></div>';return;}
    grid.innerHTML=filtered.map(e=>{
        const isComm=e.salaryType==='commission';
        const gLabel=e.gender==='female'?'أنثى':'ذكر';
        const gColor=e.gender==='female'?'#e11d48':'#2563eb';
        return `<div class="emp-card" onclick="openEmployee('${e.id}')">
        <div class="emp-top"><span class="emp-name">${e.name}</span><span class="emp-role">${e.role||'موظف'}</span><span style="font-size:.7rem;padding:2px 6px;border-radius:6px;background:${gColor}15;color:${gColor};font-weight:700">${gLabel}</span></div>
        <div class="emp-stats">
            <div class="emp-stat"><div class="emp-stat-label">الراتب</div><div class="emp-stat-val">${fmtNum(e.salary)} ${cur}</div></div>
            <div class="emp-stat"><div class="emp-stat-label">${isComm?'العمولة':'النوع'}</div><div class="emp-stat-val" style="color:${isComm?'var(--clr-income)':'var(--text2)'}">${isComm?e.commRate+'%':'ثابت'}</div></div>
        </div></div>`;
    }).join('');
}
function calcCommission(emp){
    if(!emp||emp.salaryType!=='commission'||!emp.commRate)return 0;
    return (emp.salesAmount||0)*(emp.commRate/100);
}
function openEmployee(id){
    const emps=loadData(KEYS.employees);
    const emp=emps.find(e=>e.id===id);
    if(!emp)return;
    const s=loadSettings();const cur=s.currency||'د.ع';
    const isComm=emp.salaryType==='commission';
    const isMale=emp.gender!=='female';
    let html=`<div class="field"><label>الاسم</label><input type="text" id="empNameInput" class="input-field" value="${emp.name}"></div>
    <div class="field"><label>الوظيفة</label><input type="text" id="empRoleInput" class="input-field" value="${emp.role||''}"></div>
    <div class="field"><label>الجنس</label>
        <div style="display:flex;gap:12px;margin-top:4px">
            <label style="display:flex;align-items:center;gap:4px"><input type="radio" name="empGender" value="male" ${isMale?'checked':''}> ذكر</label>
            <label style="display:flex;align-items:center;gap:4px"><input type="radio" name="empGender" value="female" ${!isMale?'checked':''}> أنثى</label>
        </div>
    </div>
    <div class="field"><label>نوع الراتب</label>
        <div style="display:flex;gap:12px;margin-top:4px">
            <label style="display:flex;align-items:center;gap:4px"><input type="radio" name="salaryType" value="fixed" ${!isComm?'checked':''}> راتب ثابت</label>
            <label style="display:flex;align-items:center;gap:4px"><input type="radio" name="salaryType" value="commission" ${isComm?'checked':''}> حسب العمولة</label>
        </div>
    </div>
    <div class="field"><label>الراتب الأساسي (بالآلاف)</label><input type="number" id="empSalaryInput" class="input-field" value="${toK(emp.salary)}" inputmode="decimal"></div>
    <div class="field" id="empCommField" style="${isComm?'':'display:none'}"><label>نسبة العمولة %</label><input type="number" id="empCommInput" class="input-field" value="${emp.commRate||0}"></div>`;
    openModal('تعديل الموظف',html,`<button class="btn btn-success" onclick="saveEmployee('${id}')">حفظ</button><button class="btn btn-danger" onclick="deleteEmployee('${id}')">حذف</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
    setTimeout(()=>{
        document.querySelectorAll('input[name="salaryType"]').forEach(r=>r.addEventListener('change',()=>{
            const cf=$('#empCommField');if(cf)cf.style.display=document.querySelector('input[name="salaryType"]:checked').value==='commission'?'':'none';
        }));
    },50);
}
function addEmployee(){
    openModal('إضافة موظف',`
    <div class="field"><label>الاسم</label><input type="text" id="empNameInput" class="input-field"></div>
    <div class="field"><label>الوظيفة</label><input type="text" id="empRoleInput" class="input-field"></div>
    <div class="field"><label>الجنس</label>
        <div style="display:flex;gap:12px;margin-top:4px">
            <label style="display:flex;align-items:center;gap:4px"><input type="radio" name="empGender" value="male" checked> ذكر</label>
            <label style="display:flex;align-items:center;gap:4px"><input type="radio" name="empGender" value="female"> أنثى</label>
        </div>
    </div>
    <div class="field"><label>نوع الراتب</label>
        <div style="display:flex;gap:12px;margin-top:4px">
            <label style="display:flex;align-items:center;gap:4px"><input type="radio" name="salaryType" value="fixed" checked> راتب ثابت</label>
            <label style="display:flex;align-items:center;gap:4px"><input type="radio" name="salaryType" value="commission"> حسب العمولة</label>
        </div>
    </div>
    <div class="field"><label>الراتب الأساسي (بالآلاف)</label><input type="number" id="empSalaryInput" class="input-field" inputmode="decimal"></div>
    <div class="field" id="empCommField" style="display:none"><label>نسبة العمولة %</label><input type="number" id="empCommInput" class="input-field" value="0"></div>`,
    `<button class="btn btn-success" onclick="saveEmployee()">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
    setTimeout(()=>{
        document.querySelectorAll('input[name="salaryType"]').forEach(r=>r.addEventListener('change',()=>{
            const cf=$('#empCommField');if(cf)cf.style.display=document.querySelector('input[name="salaryType"]:checked').value==='commission'?'':'none';
        }));
    },50);
}
function saveEmployee(id){
    const name=$('#empNameInput').value.trim();
    if(!name)return toast('أدخل الاسم');
    const emps=loadData(KEYS.employees);
    const stEl=document.querySelector('input[name="salaryType"]:checked');
    const gEl=document.querySelector('input[name="empGender"]:checked');
    const obj={
        id:id||uid(),
        name,
        role:$('#empRoleInput').value.trim(),
        gender:gEl?gEl.value:'male',
        salary:parseK($('#empSalaryInput').value),
        salaryType:stEl?stEl.value:'fixed',
        commRate:parseFloat($('#empCommInput')?.value)||0
    };
    if(id){const idx=emps.findIndex(e=>e.id===id);if(idx>=0)emps[idx]=obj;}
    else emps.push(obj);
    saveData(KEYS.employees,emps);
    closeModal();toast('تم الحفظ');renderSalaries();
}
function deleteEmployee(id){
    if(!confirm('حذف الموظف؟'))return;
    let arr=loadData(KEYS.employees);arr=arr.filter(e=>e.id!==id);saveData(KEYS.employees,arr);
    closeModal();toast('تم الحذف');renderSalaries();
}
function printAllSalaries(){
    if(!hasAction('print'))return toast('غير مصرح');
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const emps=loadData(KEYS.employees);
    if(!emps.length)return toast('لا يوجد موظفين');
    const printDate=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
    let html=`<div class="print-page-border">`;
    html+=`<div class="print-header"><h2>كشف الرواتب</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">تاريخ الطباعة: ${printDate}</p></div>`;
    html+=`<table><thead><tr><th>#</th><th>الموظف</th><th>الوظيفة</th><th>الراتب</th><th>النوع</th></tr></thead><tbody>`;
    let totalOwed=0;
    emps.forEach((e,i)=>{
        const owed=e.salary||0;
        totalOwed+=owed;
        const typeLabel=e.salaryType==='commission'?'عمولة '+e.commRate+'%':'ثابت';
        html+=`<tr><td>${i+1}</td><td>${e.name}</td><td>${e.role||''}</td><td style="font-weight:700">${fmtNum(owed)} ${cur}</td><td>${typeLabel}</td></tr>`;
    });
    html+=`</tbody></table>`;
    html+=`<div class="print-total">إجمالي الرواتب: ${fmtNum(totalOwed)} ${cur}</div>`;
    html+=`</div>`;
    showPrintDialog(html);
}

/* ========= PAYROLL ========= */
function renderPayroll(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const monthInput=$('#payrollMonth');
    if(!monthInput.value)monthInput.value=today().slice(0,7);
    const histMonthInput=$('#payrollHistoryMonth');
    if(histMonthInput&&!histMonthInput.value)histMonthInput.value=today().slice(0,7);
    const emps=loadData(KEYS.employees);
    const payroll=loadData(KEYS.payroll);
    const ym=monthInput.value;
    const list=$('#payrollList');

    if(!emps.length){list.innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا يوجد موظفين</p></div>';$('#payrollHistory').innerHTML='';return;}

    list.innerHTML=emps.map(e=>{
        const owed=e.salary||0;
        const paid=payroll.filter(p=>p.empId===e.id&&p.month===ym).reduce((s,p)=>s+p.amount,0);
        const remaining=owed-paid;
        const isComm=e.salaryType==='commission';
        const typeLabel=isComm?`<span style="color:var(--clr-income);font-size:.75rem">عمولة ${e.commRate}%</span>`:'<span style="font-size:.75rem;color:var(--text3)">ثابت</span>';
        return `<div class="emp-card">
        <div class="emp-top"><span class="emp-name">${e.name}</span><span class="emp-role">${e.role||'موظف'} ${typeLabel}</span></div>
        <div class="emp-stats">
            <div class="emp-stat"><div class="emp-stat-label">الراتب</div><div class="emp-stat-val">${fmtNum(owed)}</div></div>
            <div class="emp-stat"><div class="emp-stat-label">المسلّم</div><div class="emp-stat-val" style="color:var(--clr-income)">${fmtNum(paid)}</div></div>
            <div class="emp-stat"><div class="emp-stat-label">المتبقي</div><div class="emp-stat-val" style="color:${remaining>0?'var(--clr-expense)':'var(--clr-income)'}">${fmtNum(remaining)}</div></div>
        </div>
        <button class="btn btn-success btn-block btn-sm" style="margin-top:8px" onclick="disbursePayroll('${e.id}')"><i class="ri-hand-coin-line"></i> صرف</button>
        </div>`;
    }).join('');

    /* history */
    const history=payroll.filter(p=>p.month===ym).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    const hList=$('#payrollHistory');
    if(!history.length){hList.innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا توجد سجلات</p></div>';return;}
    const allIds=history.map(p=>p.id);
    let hHtml=_multiSelectBar('payroll',KEYS.payroll,allIds,'renderPayroll');
    hHtml+=history.map(p=>{
        const delBtn=hasAction('delete')?`<button onclick="deletePayrollEntry('${p.id}')"><i class="ri-delete-bin-line"></i></button>`:'';
        const tipBadge=p.tip>0?`<span class="tip-badge"><i class="ri-gift-line"></i> إكرامية: ${fmtNum(p.tip)} ${cur}</span>`:'';
        const netLine=p.tip>0||((p.deductions)&&((p.deductions.debt||0)+(p.deductions.attendance||0)+(p.deductions.loan||0))>0)
            ?`<div class="rec-net-line">الصافي: <strong style="color:var(--clr-income)">${fmtNum(p.netPay||p.amount)} ${cur}</strong></div>`:'';
        const sel=(_selectedIds['payroll']&&_selectedIds['payroll'].has(p.id))?'selected':'';
        const cb=_multiSelectCheckbox('payroll',p.id,'renderPayroll');
        return `<div class="record-card payroll-rec ${sel}">
            <div style="display:flex;align-items:center">${cb}<div class="rec-info">
                <div class="rec-title">${p.empName}${tipBadge}</div>
                <div class="rec-sub">${p.date} - ${p.note||''}${p.by?' | <span class="by-tag">'+p.by+'</span>':''}</div>
                ${netLine}
            </div></div>
            <div style="text-align:left">
                <div class="rec-amount expense">${fmtNum(p.amount)} ${cur}</div>
                ${p.tip>0?`<div style="font-size:.75rem;color:var(--clr-income);font-weight:700;text-align:left">+${fmtNum(p.tip)}</div>`:''}
            </div>
            <div class="rec-actions">${delBtn}</div>
        </div>`;}).join('');
    hList.innerHTML=hHtml;
}
function disbursePayroll(empId){
    const emps=loadData(KEYS.employees);
    const emp=emps.find(e=>e.id===empId);if(!emp)return;
    const s=loadSettings();const cur=s.currency||'د.ع';
    const ym=$('#payrollMonth').value||today().slice(0,7);
    const payroll=loadData(KEYS.payroll);
    const owed=emp.salary||0;
    const paid=payroll.filter(p=>p.empId===empId&&p.month===ym).reduce((s,p)=>s+p.amount,0);
    const remaining=owed-paid;
    const isComm=emp.salaryType==='commission';

    /* check employee debts */
    const debts=loadData(KEYS.debts).filter(d=>d.person===emp.name);
    const totalDebts=debts.reduce((s,d)=>s+d.amount,0);

    let html=`<div style="background:var(--bg);padding:10px;border-radius:8px;margin-bottom:10px;font-size:.85rem">
        <div>الراتب الأساسي: <strong>${fmtNum(owed)} ${cur}</strong></div>
        <div>المسلّم: <strong style="color:var(--clr-income)">${fmtNum(paid)}</strong> | المتبقي: <strong style="color:${remaining>0?'var(--danger)':'var(--success)'}">${fmtNum(remaining)}</strong></div>
    </div>`;

    if(totalDebts>0){
        html+=`<div style="background:#fef2f2;border:1px solid #fecaca;padding:10px;border-radius:8px;margin-bottom:10px;font-size:.85rem">
            <div style="font-weight:700;color:#dc2626;margin-bottom:4px"><i class="ri-error-warning-line"></i> على هذا الموظف ديون</div>
            <div>إجمالي الديون: <strong style="color:#dc2626">${fmtNum(totalDebts)} ${cur}</strong></div>
        </div>`;
    }

    if(isComm){
        html+=`<div class="field"><label>مبلغ المبيعات (بالآلاف) - لحساب العمولة</label><input type="number" id="paySalesInput" class="input-field" inputmode="decimal" oninput="calcPayrollComm('${empId}')"></div>
        <div id="payCommResult" style="background:var(--surface2);padding:8px;border-radius:8px;margin-bottom:10px;font-size:.85rem;display:none"></div>`;
    }

    html+=`<div class="field"><label>المبلغ المراد صرفه (بالآلاف)</label><input type="number" id="payAmountInput" class="input-field" value="${toK(remaining>0?remaining:0)}" inputmode="decimal" oninput="updatePayNet()"></div>`;

    /* tip section */
    html+=`<div class="tip-field-wrap">
        <div class="tip-field-header"><i class="ri-gift-line"></i> إكرامية (اختياري)</div>
        <input type="number" id="payTipInput" class="input-field" placeholder="مبلغ الإكرامية بالآلاف (اختياري)" inputmode="decimal" oninput="updatePayNet()" style="margin-top:6px">
    </div>`;

    /* deductions section */
    html+=`<div style="background:var(--surface2);padding:12px;border-radius:8px;margin-bottom:10px">
        <div style="font-weight:700;font-size:.88rem;margin-bottom:8px"><i class="ri-scissors-cut-line"></i> الاستقطاعات</div>`;

    if(totalDebts>0){
        html+=`<div class="field" style="margin-bottom:8px"><label><input type="checkbox" id="payDeductDebt" onchange="updatePayNet()"> استقطاع دين</label>
        <input type="number" id="payDeductDebtAmount" class="input-field" placeholder="مبلغ الاستقطاع بالآلاف" value="${toK(totalDebts)}" inputmode="decimal" oninput="updatePayNet()" style="margin-top:4px"></div>`;
    }

    html+=`<div class="field" style="margin-bottom:8px"><label><input type="checkbox" id="payDeductAttend" onchange="updatePayNet()"> استقطاع بصمة / تأخير</label>
        <input type="number" id="payDeductAttendAmount" class="input-field" placeholder="مبلغ الاستقطاع بالآلاف" inputmode="decimal" oninput="updatePayNet()" style="margin-top:4px"></div>`;

    html+=`<div class="field" style="margin-bottom:0"><label><input type="checkbox" id="payDeductLoan" onchange="updatePayNet()"> استقطاع قرض / سلفة</label>
        <input type="number" id="payDeductLoanAmount" class="input-field" placeholder="مبلغ الاستقطاع بالآلاف" inputmode="decimal" oninput="updatePayNet()" style="margin-top:4px"></div>`;
    html+=`</div>`;

    html+=`<div id="payNetResult" style="background:var(--bg);padding:10px;border-radius:8px;margin-bottom:10px;font-size:.88rem;font-weight:700;display:none"></div>`;
    html+=`<div class="field"><label>ملاحظة</label><input type="text" id="payNoteInput" class="input-field"></div>`;

    openModal('صرف راتب '+emp.name,html,
    `<button class="btn btn-success" onclick="confirmDisburse('${empId}','${emp.name}')">تأكيد الصرف</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function calcPayrollComm(empId){
    const emps=loadData(KEYS.employees);
    const emp=emps.find(e=>e.id===empId);if(!emp)return;
    const salesInput=parseK($('#paySalesInput').value);
    const commission=salesInput*(emp.commRate/100);
    const total=(emp.salary||0)+commission;
    const s=loadSettings();const cur=s.currency||'د.ع';
    const el=$('#payCommResult');
    el.style.display='';
    el.innerHTML=`<div>العمولة (${emp.commRate}%): <strong style="color:var(--clr-income)">${fmtNum(commission)} ${cur}</strong></div>
    <div>الإجمالي (راتب + عمولة): <strong style="color:var(--primary)">${fmtNum(total)} ${cur}</strong></div>`;
    $('#payAmountInput').value=toK(total);
}
function updatePayNet(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const baseAmount=parseK($('#payAmountInput').value)||0;
    const tipAmount=parseK($('#payTipInput')?.value)||0;
    let totalDeduct=0;
    const debtEl=$('#payDeductDebt');const debtAmtEl=$('#payDeductDebtAmount');
    const attendEl=$('#payDeductAttend');const attendAmtEl=$('#payDeductAttendAmount');
    const loanEl=$('#payDeductLoan');const loanAmtEl=$('#payDeductLoanAmount');
    if(debtEl&&debtEl.checked&&debtAmtEl)totalDeduct+=parseK(debtAmtEl.value)||0;
    if(attendEl&&attendEl.checked&&attendAmtEl)totalDeduct+=parseK(attendAmtEl.value)||0;
    if(loanEl&&loanEl.checked&&loanAmtEl)totalDeduct+=parseK(loanAmtEl.value)||0;
    const net=baseAmount+tipAmount-totalDeduct;
    const el=$('#payNetResult');
    if(totalDeduct>0||tipAmount>0){
        el.style.display='';
        let parts=[];
        parts.push(`الراتب: ${fmtNum(baseAmount)}`);
        if(tipAmount>0)parts.push(`<span style="color:var(--clr-income)">+ إكرامية: ${fmtNum(tipAmount)}</span>`);
        if(totalDeduct>0)parts.push(`<span style="color:var(--danger)">- استقطاعات: ${fmtNum(totalDeduct)}</span>`);
        parts.push(`= <span style="color:${net>=0?'var(--success)':'var(--danger)'}">الصافي: ${fmtNum(net)} ${cur}</span>`);
        el.innerHTML=parts.join(' ');
    }else{el.style.display='none';}
}
function confirmDisburse(empId,empName){
    const amount=parseK($('#payAmountInput').value);
    const tipAmount=parseK($('#payTipInput')?.value)||0;
    const note=$('#payNoteInput').value||'';
    if(!amount)return toast('أدخل المبلغ');
    const ym=$('#payrollMonth').value||today().slice(0,7);
    const by=getByTag();

    /* calculate deductions */
    let deductDebt=0,deductAttend=0,deductLoan=0;
    const debtEl=$('#payDeductDebt');const debtAmtEl=$('#payDeductDebtAmount');
    if(debtEl&&debtEl.checked&&debtAmtEl)deductDebt=parseK(debtAmtEl.value)||0;
    const attendEl=$('#payDeductAttend');const attendAmtEl=$('#payDeductAttendAmount');
    if(attendEl&&attendEl.checked&&attendAmtEl)deductAttend=parseK(attendAmtEl.value)||0;
    const loanEl=$('#payDeductLoan');const loanAmtEl=$('#payDeductLoanAmount');
    if(loanEl&&loanEl.checked&&loanAmtEl)deductLoan=parseK(loanAmtEl.value)||0;
    const totalDeduct=deductDebt+deductAttend+deductLoan;
    const netPay=amount+tipAmount-totalDeduct;
    if(netPay<0)return toast('مبلغ الاستقطاع أكبر من الراتب');

    /* build note with tip and deductions */
    let fullNote=note;
    const parts=[];
    if(tipAmount>0)parts.push('إكرامية: '+fmtNum(tipAmount));
    if(deductDebt>0)parts.push('استقطاع دين: '+fmtNum(deductDebt));
    if(deductAttend>0)parts.push('استقطاع بصمة/تأخير: '+fmtNum(deductAttend));
    if(deductLoan>0)parts.push('استقطاع قرض/سلفة: '+fmtNum(deductLoan));
    if(parts.length)fullNote=(fullNote?fullNote+' | ':'')+parts.join(' | ');

    /* save payroll entry — amount = base salary only, tip stored separately */
    const payroll=loadData(KEYS.payroll);
    payroll.push({id:uid(),empId,empName,amount,tip:tipAmount,deductions:{debt:deductDebt,attendance:deductAttend,loan:deductLoan},netPay,note:fullNote,date:today(),month:ym,by});
    saveData(KEYS.payroll,payroll);

    /* deduct from safe: net pay (including tip) goes out */
    const safe=loadData(KEYS.safe);
    safe.push({id:uid(),date:today(),type:'withdraw',amount:netPay,note:'راتب: '+empName+(fullNote?' - '+fullNote:''),by});
    saveData(KEYS.safe,safe);

    /* if debt deduction → reduce debts */
    if(deductDebt>0){
        const debts=loadData(KEYS.debts);
        let remaining=deductDebt;
        const empDebts=debts.filter(d=>d.person===empName).sort((a,b)=>new Date(a.date)-new Date(b.date));
        for(let d of empDebts){
            if(remaining<=0)break;
            const orig=d.amount;
            if(d.amount<=remaining){remaining-=d.amount;d.amount=0;}
            else{d.amount-=remaining;remaining=0;}
        }
        /* add a repayment record */
        debts.push({id:uid(),person:empName,amount:-deductDebt,note:'استقطاع من الراتب - '+ym,type:'repayment',cashier:'',date:today(),by});
        saveData(KEYS.debts,debts.filter(d=>d.amount!==0));
    }

    closeModal();
    let toastMsg='تم صرف الراتب';
    if(tipAmount>0)toastMsg+=' + إكرامية '+fmtNum(tipAmount);
    if(totalDeduct>0)toastMsg+=' مع الاستقطاعات';
    toast(toastMsg);
    renderPayroll();
}
function deletePayrollEntry(id){
    if(!hasAction('delete'))return toast('غير مصرح');
    if(!confirm('حذف؟'))return;
    let arr=loadData(KEYS.payroll);arr=arr.filter(p=>p.id!==id);saveData(KEYS.payroll,arr);
    toast('تم الحذف');renderPayroll();
}
function showPayrollColumnPicker(mode){
    /* mode: 'blank' = كشف رواتب, 'history' = كشف صرف */
    if(!hasAction('print'))return toast('غير مصرح');
    const cols=mode==='blank'
        ?[{key:'name',label:'الموظف',fixed:true},{key:'salary',label:'الراتب الاسمي',fixed:true},{key:'withdrawals',label:'السحوبات'},{key:'sales',label:'المبيعات'},{key:'tips',label:'الإكرامية'},{key:'comm',label:'النسبة'},{key:'debts',label:'الديون'},{key:'deduct',label:'الاستقطاع'}]
        :[{key:'name',label:'الموظف',fixed:true},{key:'tips',label:'الإكرامية'},{key:'deductions',label:'الاستقطاعات'},{key:'net',label:'الصافي'},{key:'note',label:'ملاحظة'}];
    let body=`<div style="direction:rtl;text-align:right;padding:4px 0"><p style="margin-bottom:8px;font-weight:700;font-size:.95rem">اختر الأعمدة المطلوبة:</p>`;
    body+=`<label style="display:block;margin-bottom:6px;cursor:pointer"><input type="checkbox" id="pcolAll" checked onchange="document.querySelectorAll('.pcol-cb').forEach(c=>{if(!c.disabled)c.checked=this.checked})"> <strong>تحديد الكل</strong></label><hr style="margin:6px 0;border-color:rgba(0,0,0,.1)">`;
    cols.forEach(c=>{
        body+=`<label style="display:block;margin-bottom:5px;cursor:pointer"><input type="checkbox" class="pcol-cb" data-col="${c.key}" checked ${c.fixed?'disabled':''}> ${c.label}${c.fixed?' (أساسي)':''}</label>`;
    });
    body+=`</div>`;
    openModal('خيارات أعمدة الطباعة',body,`<button class="btn btn-primary" onclick="_doPrintPayroll('${mode}')"><i class="ri-printer-fill"></i> طباعة</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function _getSelectedPrintCols(){
    const checked=[];
    document.querySelectorAll('.pcol-cb:checked').forEach(c=>checked.push(c.dataset.col));
    return checked;
}
function _doPrintPayroll(mode){
    const cols=_getSelectedPrintCols();
    closeModal();
    if(mode==='blank') _buildPrintPayroll(cols);
    else _buildPrintPayrollHistory(cols);
}

function printPayroll(){ showPayrollColumnPicker('blank'); }
function _buildPrintPayroll(cols){
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const emps=loadData(KEYS.employees);
    if(!emps.length)return toast('لا يوجد موظفين');
    const debts=loadData(KEYS.debts);
    const ym=$('#payrollMonth')?.value||today().slice(0,7);
    const thSt='padding:9px 8px;border:1px solid rgba(180,160,210,0.3);font-weight:900;';
    const brd='border:1px solid rgba(180,160,210,0.25);';
    const hc='color:#1e3a8a';
    const dateStr=getPrintDateString();
    const maleEmps=emps.filter(e=>e.gender!=='female');
    const femaleEmps=emps.filter(e=>e.gender==='female');
    function buildSection(sectionEmps,sectionTitle){
        if(!sectionEmps.length)return '';
        let sh='';
        sh+=`<h3 style="margin:8px 0 4px;color:#1e3a8a;font-size:12pt;border-bottom:1.5px solid rgba(147,197,253,0.5);padding-bottom:3px">${sectionTitle}</h3>`;
        sh+=`<table style="border-collapse:collapse;width:100%"><thead><tr style="background:linear-gradient(90deg,rgba(147,197,253,0.35),rgba(249,168,212,0.35))"><th style="${thSt}${hc}">#</th>`;
        if(cols.includes('name'))sh+=`<th style="${thSt}${hc}">الموظف</th>`;
        if(cols.includes('salary'))sh+=`<th style="${thSt}${hc}">الراتب الاسمي</th>`;
        if(cols.includes('withdrawals'))sh+=`<th style="${thSt}${hc}">السحوبات</th>`;
        if(cols.includes('sales'))sh+=`<th style="${thSt}${hc}">المبيعات</th>`;
        if(cols.includes('tips'))sh+=`<th style="${thSt}${hc}">الإكرامية</th>`;
        if(cols.includes('comm'))sh+=`<th style="${thSt}${hc}">النسبة</th>`;
        if(cols.includes('debts'))sh+=`<th style="${thSt}${hc}">الديون</th>`;
        if(cols.includes('deduct'))sh+=`<th style="${thSt}${hc}">الاستقطاع</th>`;
        sh+=`</tr></thead><tbody>`;
        let secSalary=0,secWd=0;
        sectionEmps.forEach((e,i)=>{
            const sal=e.salary||0;secSalary+=sal;
            const bg=i%2===0?'rgba(219,234,254,0.3)':'rgba(252,231,243,0.22)';
            const comm=e.salaryType==='commission'?(e.commRate||0)+'%':'ثابت';
            const empDebtsOnly=debts.filter(d=>d.person===e.name&&d.type!=='withdraw'&&d.type!=='repayment');
            const empRepayments=debts.filter(d=>d.person===e.name&&d.type==='repayment');
            const debtTotal=empDebtsOnly.reduce((s,d)=>s+d.amount,0)+empRepayments.reduce((s,d)=>s+d.amount,0);
            const empWithdraws=debts.filter(d=>d.person===e.name&&d.type==='withdraw'&&d.date&&d.date.startsWith(ym));
            const wdTotal=empWithdraws.reduce((s,d)=>s+d.amount,0);secWd+=wdTotal;
            sh+=`<tr style="background:${bg}"><td style="padding:6px;${brd}text-align:center">${i+1}</td>`;
            if(cols.includes('name'))sh+=`<td style="padding:6px;${brd}font-weight:800">${e.name}</td>`;
            if(cols.includes('salary'))sh+=`<td style="padding:6px;${brd}color:#2563eb;font-weight:700">${fmtNum(sal)} ${cur}</td>`;
            if(cols.includes('withdrawals')){
                let wdCell=wdTotal>0?`<span style="color:#dc2626;font-weight:700">${fmtNum(wdTotal)} ${cur}</span>`:'-';
                sh+=`<td style="padding:6px;${brd}text-align:center">${wdCell}</td>`;
            }
            if(cols.includes('sales'))sh+=`<td style="padding:6px;${brd}"></td>`;
            if(cols.includes('tips'))sh+=`<td style="padding:6px;${brd}"></td>`;
            if(cols.includes('comm'))sh+=`<td style="padding:6px;${brd}text-align:center;color:#9333ea;font-weight:700">${comm}</td>`;
            if(cols.includes('debts'))sh+=`<td style="padding:6px;${brd}color:${debtTotal>0?'#dc2626':'#16a34a'};font-weight:700">${debtTotal!==0?fmtNum(debtTotal)+' '+cur:'-'}</td>`;
            if(cols.includes('deduct'))sh+=`<td style="padding:6px;${brd}"></td>`;
            sh+=`</tr>`;
        });
        const nameIdx=cols.includes('name')?2:1;
        sh+=`<tr style="font-weight:700;background:linear-gradient(90deg,rgba(147,197,253,0.3),rgba(249,168,212,0.3))">`;
        sh+=`<td colspan="${nameIdx}" style="padding:9px;${brd}color:#1e3a8a">الإجمالي</td>`;
        if(cols.includes('salary'))sh+=`<td style="padding:9px;${brd}color:#b45309;font-weight:900">${fmtNum(secSalary)} ${cur}</td>`;
        if(cols.includes('withdrawals'))sh+=`<td style="padding:9px;${brd}color:#dc2626;font-weight:900">${secWd>0?fmtNum(secWd)+' '+cur:'-'}</td>`;
        if(cols.includes('sales'))sh+=`<td style="padding:9px;${brd}"></td>`;
        if(cols.includes('tips'))sh+=`<td style="padding:9px;${brd}"></td>`;
        if(cols.includes('comm'))sh+=`<td style="padding:9px;${brd}"></td>`;
        if(cols.includes('debts'))sh+=`<td style="padding:9px;${brd}"></td>`;
        if(cols.includes('deduct'))sh+=`<td style="padding:9px;${brd}"></td>`;
        sh+=`</tr></tbody></table>`;
        return sh;
    }
    const pgStyle='background:linear-gradient(135deg,rgba(219,234,254,0.3),rgba(252,231,243,0.3));border:2px solid rgba(180,160,210,0.3);border-radius:0;padding:0;margin:0;width:100%';
    const hdrStyle='display:flex;justify-content:space-between;align-items:center;background:linear-gradient(90deg,rgba(219,234,254,0.4),rgba(252,231,243,0.4));border-radius:0;padding:8px 12px;margin-bottom:0;border-bottom:2px solid rgba(180,160,210,0.3)';
    function wrapPage(content,title){
        if(!content)return '';
        let p=`<div class="print-page-border" style="${pgStyle}">`;
        p+=`<div class="print-header" style="${hdrStyle}">`;
        p+=`<div style="font-size:11pt;font-weight:900;color:#1e3a8a">لافيش سنتر - قسم الملابس</div>`;
        p+=`<div style="font-size:14pt;font-weight:900;color:#1e3a8a">كشف الرواتب - ${ym}</div>`;
        p+=`<div style="font-size:10pt;font-weight:800;color:#333;direction:ltr">${dateStr}</div>`;
        p+=`</div>`;
        p+=content;
        p+=`</div>`;
        return p;
    }
    const maleContent=buildSection(maleEmps,'موظفين الرجالي');
    const femaleContent=buildSection(femaleEmps,'موظفين النسائي');
    let html=wrapPage(maleContent,'موظفين الرجالي');
    if(maleContent&&femaleContent)html+=`<div style="page-break-before:always"></div>`;
    html+=wrapPage(femaleContent,'موظفين النسائي');
    showPrintDialog(html,true);
}

function printPayrollHistory(){ showPayrollColumnPicker('history'); }
function _buildPrintPayrollHistory(cols){
    if(!hasAction('print'))return toast('غير مصرح');
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const ym=$('#payrollHistoryMonth').value||$('#payrollMonth').value||today().slice(0,7);
    const emps=loadData(KEYS.employees);
    const payroll=loadData(KEYS.payroll).filter(p=>p.month===ym);
    if(!payroll.length)return toast('لا توجد رواتب مسلّمة لهذا الشهر');
    const thSt='padding:9px 8px;border:1px solid rgba(180,160,210,0.3);font-weight:900;';
    const brd='border:1px solid rgba(180,160,210,0.25);';
    const hc='color:#1e3a8a';
    const dateStr=getPrintDateString();
    const maleEmps=emps.filter(e=>e.gender!=='female');
    const femaleEmps=emps.filter(e=>e.gender==='female');
    /* تفاصيل الصرف فقط - مفصولة حسب الجنس */
    function buildDetailSection(sectionEmps,sectionTitle){
        const sPayroll=payroll.filter(p=>sectionEmps.some(e=>e.id===p.empId));
        if(!sPayroll.length)return '';
        let sh='';
        sh+=`<h3 style="margin:8px 0 4px;color:#1e3a8a;font-size:12pt;border-bottom:1.5px solid rgba(147,197,253,0.5);padding-bottom:3px">${sectionTitle}</h3>`;
        sh+=`<table style="border-collapse:collapse;width:100%;margin-top:4px"><thead><tr style="background:linear-gradient(90deg,rgba(249,168,212,0.3),rgba(147,197,253,0.35))"><th style="${thSt}${hc}">#</th><th style="${thSt}${hc}">الموظف</th><th style="${thSt}${hc}">الراتب</th>`;
        if(cols.includes('tips'))sh+=`<th style="${thSt}${hc}">الإكرامية</th>`;
        if(cols.includes('deductions'))sh+=`<th style="${thSt}${hc}">الاستقطاعات</th>`;
        if(cols.includes('net'))sh+=`<th style="${thSt}${hc}">الصافي</th>`;
        if(cols.includes('note'))sh+=`<th style="${thSt}${hc}">ملاحظة</th>`;
        sh+=`</tr></thead><tbody>`;
        let secBase=0,secTips=0,secDed=0,secNet=0;
        sPayroll.forEach((p,i)=>{
            const tip=p.tip||0;
            const ded=p.deductions?((p.deductions.debt||0)+(p.deductions.attendance||0)+(p.deductions.loan||0)):0;
            const net=p.netPay||p.amount;
            secBase+=p.amount;secTips+=tip;secDed+=ded;secNet+=net;
            const bg=i%2===0?'rgba(219,234,254,0.3)':'rgba(252,231,243,0.22)';
            sh+=`<tr style="background:${bg}"><td style="padding:6px;${brd}text-align:center">${i+1}</td><td style="padding:6px;${brd}font-weight:800">${p.empName}</td><td style="padding:6px;${brd}color:#2563eb;font-weight:700">${fmtNum(p.amount)} ${cur}</td>`;
            if(cols.includes('tips'))sh+=`<td style="padding:6px;${brd}color:#9333ea;font-weight:700">${tip>0?fmtNum(tip)+' '+cur:'-'}</td>`;
            if(cols.includes('deductions'))sh+=`<td style="padding:6px;${brd}color:#dc2626;font-weight:700">${ded>0?fmtNum(ded)+' '+cur:'-'}</td>`;
            if(cols.includes('net'))sh+=`<td style="padding:6px;${brd}color:#16a34a;font-weight:900">${fmtNum(net)} ${cur}</td>`;
            if(cols.includes('note'))sh+=`<td style="padding:6px;${brd}font-size:11pt">${p.note||''}</td>`;
            sh+=`</tr>`;
        });
        sh+=`<tr style="font-weight:700;background:linear-gradient(90deg,rgba(249,168,212,0.3),rgba(147,197,253,0.3))"><td colspan="2" style="padding:9px;${brd}${hc}">الإجمالي</td><td style="padding:9px;${brd}color:#2563eb;font-weight:900">${fmtNum(secBase)} ${cur}</td>`;
        if(cols.includes('tips'))sh+=`<td style="padding:9px;${brd}color:#9333ea;font-weight:900">${secTips>0?fmtNum(secTips)+' '+cur:'-'}</td>`;
        if(cols.includes('deductions'))sh+=`<td style="padding:9px;${brd}color:#dc2626;font-weight:900">${secDed>0?fmtNum(secDed)+' '+cur:'-'}</td>`;
        if(cols.includes('net'))sh+=`<td style="padding:9px;${brd}color:#16a34a;font-weight:900">${fmtNum(secNet)} ${cur}</td>`;
        if(cols.includes('note'))sh+=`<td style="padding:9px;${brd}"></td>`;
        sh+=`</tr></tbody></table>`;
        return sh;
    }
    const pgStyle='background:linear-gradient(135deg,rgba(219,234,254,0.3),rgba(252,231,243,0.3));border:2px solid rgba(180,160,210,0.3);border-radius:0;padding:0;margin:0;width:100%';
    const hdrStyle='display:flex;justify-content:space-between;align-items:center;background:linear-gradient(90deg,rgba(219,234,254,0.4),rgba(252,231,243,0.4));border-radius:0;padding:8px 12px;margin-bottom:0;border-bottom:2px solid rgba(180,160,210,0.3)';
    function wrapPage(content){
        if(!content)return '';
        let p=`<div class="print-page-border" style="${pgStyle}">`;
        p+=`<div class="print-header" style="${hdrStyle}">`;
        p+=`<div style="font-size:11pt;font-weight:900;color:#1e3a8a">لافيش سنتر - قسم الملابس</div>`;
        p+=`<div style="font-size:14pt;font-weight:900;color:#1e3a8a">كشف صرف الرواتب - ${ym}</div>`;
        p+=`<div style="font-size:10pt;font-weight:800;color:#333;direction:ltr">${dateStr}</div>`;
        p+=`</div>`;
        p+=content;
        p+=`</div>`;
        return p;
    }
    const maleContent=buildDetailSection(maleEmps,'موظفين الرجالي');
    const femaleContent=buildDetailSection(femaleEmps,'موظفين النسائي');
    let html=wrapPage(maleContent);
    if(maleContent&&femaleContent)html+=`<div style="page-break-before:always"></div>`;
    html+=wrapPage(femaleContent);
    showPrintDialog(html,true);
}

/* ========= CAPITAL (= SAFE) ========= */
function getCapitalBalance(){
    return getSafeBalance();
}
function renderCapital(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    $('#capitalBalance').textContent=fmtNum(getCapitalBalance())+' '+cur;
    const searchVal=($('#capitalSearch')?.value||'').trim().toLowerCase();
    let trans=loadData(KEYS.safe).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    if(searchVal)trans=trans.filter(t=>(t.note||'').toLowerCase().includes(searchVal)||t.date.includes(searchVal)||String(t.amount).includes(searchVal));
    const list=$('#capitalList');
    if(!trans.length){list.innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا توجد معاملات</p></div>';return;}
    const canEdit=hasAction('edit'),canDel=hasAction('delete');
    const allIds=trans.map(t=>t.id);
    let capHtml=_multiSelectBar('capital',KEYS.safe,allIds,'renderCapital');
    capHtml+=trans.map(t=>{
        const isDep=t.type==='deposit';
        const clr=isDep?'income':'expense';
        const sign=isDep?'+':'-';
        const editBtn=canEdit?`<button onclick="editSafeTrans('${t.id}')"><i class="ri-edit-line"></i></button>`:'';
        const delBtn=canDel?`<button onclick="deleteSafeTrans('${t.id}')"><i class="ri-delete-bin-line"></i></button>`:'';
        const sel=(_selectedIds['capital']&&_selectedIds['capital'].has(t.id))?'selected':'';
        const cb=_multiSelectCheckbox('capital',t.id,'renderCapital');
        return `<div class="record-card ${sel}"><div style="display:flex;align-items:center">${cb}<div class="rec-info"><div class="rec-title">${t.note||t.type}</div><div class="rec-sub">${t.date}${t.by?' | <span class="by-tag">'+t.by+'</span>':''}</div></div></div>
        <div class="rec-amount ${clr}">${sign}${fmtNum(t.amount)} ${cur}</div>
        <div class="rec-actions">${editBtn}${delBtn}</div></div>`;
    }).join('');
    list.innerHTML=capHtml;
}
function capitalTransaction(type){
    openModal(type==='deposit'?'إضافة رأس مال':'سحب من رأس المال',`
    <div class="field"><label>المبلغ (بالآلاف)</label><input type="number" id="capitalAmountInput" class="input-field" inputmode="decimal"></div>
    <div class="field"><label>ملاحظة</label><input type="text" id="capitalNoteInput" class="input-field"></div>`,
    `<button class="btn btn-success" onclick="confirmCapitalTrans('${type}')">تأكيد</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function confirmCapitalTrans(type){
    const amount=parseK($('#capitalAmountInput').value);
    const note=$('#capitalNoteInput').value||'';
    if(!amount)return toast('أدخل المبلغ');
    /* capital goes to safe */
    const safe=loadData(KEYS.safe);
    safe.push({id:uid(),date:today(),type,amount,note:'رأس مال: '+(note||type),by:getByTag()});
    saveData(KEYS.safe,safe);
    closeModal();toast('تم بنجاح');renderCapital();
}

/* ========= PURCHASES ========= */
function renderPurchases(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const searchVal=($('#purchSearch')?.value||'').trim().toLowerCase();
    let purchases=loadData(KEYS.purchases).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    if(searchVal)purchases=purchases.filter(p=>(p.desc||'').toLowerCase().includes(searchVal)||p.date.includes(searchVal)||String(p.amount).includes(searchVal));
    const list=$('#purchasesList');
    if(!purchases.length){list.innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا توجد مشتريات</p></div>';$('#purchTotalDisp').textContent='0';return;}
    const canEdit=hasAction('edit'),canDel=hasAction('delete');
    const allIds=purchases.map(p=>p.id);
    let pHtml=_multiSelectBar('purchases',KEYS.purchases,allIds,'renderPurchases');
    pHtml+=purchases.map(p=>{
        const editBtn=canEdit?`<button onclick="editPurchase('${p.id}')"><i class="ri-edit-line"></i></button>`:'';
        const delBtn=canDel?`<button onclick="deletePurchase('${p.id}')"><i class="ri-delete-bin-line"></i></button>`:'';
        const sel=(_selectedIds['purchases']&&_selectedIds['purchases'].has(p.id))?'selected':'';
        const cb=_multiSelectCheckbox('purchases',p.id,'renderPurchases');
        return `<div class="record-card ${sel}"><div style="display:flex;align-items:center">${cb}<div class="rec-info"><div class="rec-title">${p.desc||'شراء'}</div><div class="rec-sub">${p.date}${p.by?' | <span class="by-tag">'+p.by+'</span>':''}</div></div></div>
    <div class="rec-amount expense">${fmtNum(p.amount)} ${cur}</div>
    <div class="rec-actions">${editBtn}${delBtn}</div></div>`;}).join('');
    list.innerHTML=pHtml;
    const total=purchases.reduce((s,p)=>s+p.amount,0);
    $('#purchTotalDisp').textContent=fmtNum(total)+' '+cur;
}
function addPurchase(){
    openModal('إضافة عملية شراء',`
    <div class="field"><label>الوصف</label><input type="text" id="purchDescInput" class="input-field"></div>
    <div class="field"><label>المبلغ (بالآلاف)</label><input type="number" id="purchAmountInput" class="input-field" inputmode="decimal"></div>`,
    `<button class="btn btn-success" onclick="confirmPurchase()">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function confirmPurchase(){
    const desc=$('#purchDescInput').value.trim();
    const amount=parseK($('#purchAmountInput').value);
    if(!amount)return toast('أدخل المبلغ');
    const by=getByTag();
    const purchases=loadData(KEYS.purchases);
    purchases.push({id:uid(),date:today(),desc,amount,by});
    saveData(KEYS.purchases,purchases);
    /* deduct from safe */
    const safe=loadData(KEYS.safe);
    safe.push({id:uid(),date:today(),type:'withdraw',amount,note:'مشتريات: '+(desc||''),by});
    saveData(KEYS.safe,safe);
    closeModal();toast('تم الحفظ');renderPurchases();
}
function deletePurchase(id){
    if(!hasAction('delete'))return toast('غير مصرح');
    if(!confirm('حذف؟'))return;
    let arr=loadData(KEYS.purchases);arr=arr.filter(p=>p.id!==id);saveData(KEYS.purchases,arr);
    toast('تم الحذف');renderPurchases();
}
function editPurchase(id){
    if(!hasAction('edit'))return toast('غير مصرح');
    const purchases=loadData(KEYS.purchases);
    const p=purchases.find(x=>x.id===id);if(!p)return;
    openModal('تعديل عملية الشراء',`
    <div class="field"><label>الوصف</label><input type="text" id="editPurchDesc" class="input-field" value="${p.desc||''}"></div>
    <div class="field"><label>المبلغ (بالآلاف)</label><input type="number" id="editPurchAmount" class="input-field" value="${toK(p.amount)}" inputmode="decimal"></div>
    <div class="field"><label>التاريخ</label><input type="date" id="editPurchDate" class="input-field" value="${p.date}"></div>`,
    `<button class="btn btn-success" onclick="saveEditPurchase('${id}')">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function saveEditPurchase(id){
    const purchases=loadData(KEYS.purchases);
    const idx=purchases.findIndex(x=>x.id===id);if(idx<0)return;
    purchases[idx].desc=$('#editPurchDesc').value.trim();
    purchases[idx].amount=parseK($('#editPurchAmount').value);
    purchases[idx].date=$('#editPurchDate').value||purchases[idx].date;
    purchases[idx].by=getByTag();
    saveData(KEYS.purchases,purchases);
    closeModal();toast('تم التحديث');renderPurchases();
}

/* ========= REPORT (DAILY + MONTHLY + SECTION FILTER) ========= */
let reportPeriodMode = 'monthly'; // 'daily' | 'monthly'
let reportSection = 'all';       // 'all' | 'closing' | 'safe' | 'debts' | 'expenses' | 'payroll' | 'purchases'

function switchReportPeriod(mode){
    reportPeriodMode = mode;
    const dateEl = document.getElementById('reportDate');
    const monthEl = document.getElementById('reportMonth');
    const tabD = document.getElementById('rptTabDaily');
    const tabM = document.getElementById('rptTabMonthly');
    if(!dateEl||!monthEl) return;
    if(mode === 'daily'){
        dateEl.style.display = '';
        monthEl.style.display = 'none';
        if(!dateEl.value) dateEl.value = today();
        tabD && tabD.classList.add('active');
        tabM && tabM.classList.remove('active');
    } else {
        dateEl.style.display = 'none';
        monthEl.style.display = '';
        tabD && tabD.classList.remove('active');
        tabM && tabM.classList.add('active');
    }
    renderReport();
}

function setReportSection(sec){
    reportSection = sec;
    document.querySelectorAll('.rs-tab').forEach(b=>{
        b.classList.toggle('active', b.dataset.rsec === sec);
    });
    renderReport();
}

function renderReport(){

    const s=loadSettings();const cur=s.currency||'د.ع';
    const content=$('#reportContent');

    /* determine filter prefix (date string) */
    let filterPrefix, filterLabel;
    if(reportPeriodMode === 'daily'){
        const dateEl=$('#reportDate');
        if(!dateEl.value) dateEl.value=today();
        filterPrefix = dateEl.value; // YYYY-MM-DD exact
        filterLabel = 'يوم ' + filterPrefix;
    } else {
        const monthInput=$('#reportMonth');
        if(!monthInput.value) monthInput.value=today().slice(0,7);
        filterPrefix = monthInput.value; // YYYY-MM prefix
        filterLabel = 'شهر ' + filterPrefix;
    }

    const closings=loadData(KEYS.closings).filter(c=>c.date&&c.date.startsWith(filterPrefix));
    const purchases=loadData(KEYS.purchases).filter(p=>p.date&&p.date.startsWith(filterPrefix));
    const payrollData=reportPeriodMode==='daily'
        ? loadData(KEYS.payroll).filter(p=>p.date===filterPrefix)
        : loadData(KEYS.payroll).filter(p=>p.month===filterPrefix);
    const safeTrans=loadData(KEYS.safe).filter(t=>t.date&&t.date.startsWith(filterPrefix));
    const debts=loadData(KEYS.debts).filter(d=>d.date&&d.date.startsWith(filterPrefix));
    const expEntries=loadData(KEYS.expenseEntries).filter(e=>e.date&&e.date.startsWith(filterPrefix));
    const sec = reportSection; /* active section filter */

    /* gather all closing details per cashier - باستخدام الحساب المركزي */
    let totalSales=0,totalNetwork=0,totalReturns=0,totalExpFromClosings=0,totalLunch=0,totalDebtsFromClosings=0,totalWithdrawals=0,totalNet=0;
    closings.forEach(c=>{
        CASHIERS.forEach(cs=>{
            const d=c.cashiers[cs.key];if(!d)return;
            const r=calcCashierNet(d);
            totalSales+=r.gross;
            totalNetwork+=r.network;
            totalReturns+=r.returns;
            totalExpFromClosings+=r.expenses;
            totalLunch+=r.lunch;
            totalDebtsFromClosings+=r.debts;
            totalWithdrawals+=r.withdraws;
            totalNet+=r.net;                          // الصافي المحسوب الصحيح
        });
    });

    /* individual expense entries */
    const totalExpEntries=expEntries.reduce((s,e)=>s+e.amount,0);
    /* legacy expenses from closings */
    let legacyExpenses=0;
    closings.forEach(c=>{CASHIERS.forEach(cs=>{const d=c.cashiers[cs.key];if(!d)return;if(d.lunch)legacyExpenses+=d.lunch;if(d.expenses)legacyExpenses+=d.expenses;});});
    const totalAllExpenses=totalExpEntries+legacyExpenses;

    const totalPurchases=purchases.reduce((s,p)=>s+p.amount,0);
    const totalPayroll=payrollData.reduce((s,p)=>s+(p.netPay||p.amount),0);
    const totalPayrollGross=payrollData.reduce((s,p)=>s+p.amount,0);
    const totalDeductions=payrollData.reduce((s,p)=>{const ded=p.deductions;return s+(ded?(ded.debt||0)+(ded.attendance||0)+(ded.loan||0):0);},0);

    /* debt movements this month */
    const debtAdded=debts.filter(d=>d.amount>0).reduce((s,d)=>s+d.amount,0);
    const debtRepaid=debts.filter(d=>d.amount<0).reduce((s,d)=>s+Math.abs(d.amount),0);
    const allDebts=loadData(KEYS.debts);
    const totalDebtBalance=allDebts.reduce((s,d)=>s+d.amount,0);

    /* safe movements this month */
    const safeDeposits=safeTrans.filter(t=>t.type==='deposit').reduce((s,t)=>s+t.amount,0);
    const safeWithdrawals=safeTrans.filter(t=>t.type==='withdraw').reduce((s,t)=>s+t.amount,0);
    const safeBalance=getSafeBalance();

    /* general expenses for this period */
    const allGenExp=loadData(KEYS.expenseEntries).filter(e=>{const t=e.type||'dept';return t==='general'||t==='admin';});
    const genExpFiltered=allGenExp.filter(e=>e.date&&e.date.startsWith(filterPrefix));
    const genExpTotal=genExpFiltered.reduce((s,e)=>s+(e.amount||0),0);
    const genExpAdmin=genExpFiltered.filter(e=>e.type==='admin').reduce((s,e)=>s+(e.amount||0),0);
    const genExpGeneral=genExpFiltered.filter(e=>e.type!=='admin').reduce((s,e)=>s+(e.amount||0),0);

    let html='';

    /* ===== SUMMARY SECTION ===== */
    /* معادلة التحقق: صافي التقفيلات = المبيعات - المرتجعات - المصاريف - الغداء - الديون - السحوبات */
    const totalDeductionsClosings = totalReturns + totalExpFromClosings + totalLunch + totalDebtsFromClosings + totalWithdrawals;
    const verifyNet = totalSales - totalDeductionsClosings;

    html+=`<div class="report-summary"><h3><i class="ri-bar-chart-box-fill"></i> ملخص ${filterLabel}</h3><div class="summary-grid">
    <div class="summary-item"><div class="s-label">إجمالي المبيعات</div><div class="s-val">${fmtNum(totalSales)}</div></div>
    <div class="summary-item"><div class="s-label">صافي التقفيلات</div><div class="s-val">${fmtNum(totalNet)}</div></div>
    <div class="summary-item"><div class="s-label">المصاريف الكلية</div><div class="s-val">${fmtNum(totalAllExpenses)}</div></div>
    <div class="summary-item"><div class="s-label">الرواتب المصروفة</div><div class="s-val">${fmtNum(totalPayrollGross)}</div></div>
    <div class="summary-item"><div class="s-label">المشتريات</div><div class="s-val">${fmtNum(totalPurchases)}</div></div>
    <div class="summary-item"><div class="s-label">الديون الجديدة</div><div class="s-val">${fmtNum(debtAdded)}</div></div>
    <div class="summary-item"><div class="s-label">الديون المسددة</div><div class="s-val">${fmtNum(debtRepaid)}</div></div>
    <div class="summary-item" style="border:2px solid rgba(255,255,255,.3);border-radius:10px"><div class="s-label">رصيد الخزنة</div><div class="s-val" style="font-size:1.2rem">${fmtNum(safeBalance)}</div></div>
    </div></div>`;

    /* ===== VERIFICATION BOX - معادلة التحقق ===== */
    if(closings.length){
        html+=`<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin:12px 0">
        <div style="font-weight:700;color:#0f172a;margin-bottom:8px"><i class="ri-calculator-line"></i> معادلة التحقق</div>
        <div style="font-size:.88rem;line-height:1.8;color:#334155">
            المبيعات <strong style="color:#16a34a">${fmtNum(totalSales)}</strong>
            − المرتجعات ${fmtNum(totalReturns)}
            − المصاريف ${fmtNum(totalExpFromClosings)}
            − الغداء ${fmtNum(totalLunch)}
            − الديون ${fmtNum(totalDebtsFromClosings)}
            − السحوبات ${fmtNum(totalWithdrawals)}
            = <strong style="color:${verifyNet>=0?'#16a34a':'#dc2626'}">${fmtNum(verifyNet)} ${cur}</strong>
        </div>
        <div style="font-size:.82rem;color:#64748b;margin-top:6px">صافي التقفيلات المخزن: <strong>${fmtNum(totalNet)}</strong>
        ${Math.abs(verifyNet-totalNet)<1?'<span style="color:#16a34a">✓ مطابق</span>':'<span style="color:#dc2626">⚠ غير مطابق - اضغط "إعادة حساب" في الإعدادات</span>'}</div>
        </div>`;
    }

    /* ===== CLOSINGS DETAIL ===== */
    if((sec==='all'||sec==='closing')&&closings.length){
        html+=`<div class="report-section"><h3><i class="ri-calculator-fill"></i> التقفيلات (${closings.length})</h3>`;
        html+=`<table class="report-table"><thead><tr><th>التاريخ</th><th>المدير</th>`;
        CASHIERS.forEach(cs=>html+=`<th>${cs.label}</th>`);
        html+=`<th>الصافي</th></tr></thead><tbody>`;
        closings.forEach(c=>{
            const cTotal=calcClosingTotal(c);           // إعادة الحساب من المصدر
            const clr=cTotal>=0?'color:var(--clr-income)':'color:var(--clr-expense)';
            html+=`<tr><td>${c.date}</td><td>${c.manager||'-'}</td>`;
            CASHIERS.forEach(cs=>{
                const d=c.cashiers[cs.key];
                html+=`<td>${d?fmtNum(calcCashierNet(d).net):'-'}</td>`;
            });
            html+=`<td style="${clr};font-weight:700">${fmtNum(cTotal)} ${cur}</td></tr>`;
        });
        html+=`<tr class="total-row"><td colspan="${2+CASHIERS.length}">إجمالي صافي التقفيلات</td><td>${fmtNum(totalNet)} ${cur}</td></tr></tbody></table>`;

        /* breakdown */
        html+=`<div style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;font-size:.82rem">
        <div style="background:var(--bg);padding:8px 10px;border-radius:8px"><div style="color:var(--text2)">مبيعات</div><div style="font-weight:700">${fmtNum(totalSales)} ${cur}</div></div>
        <div style="background:var(--bg);padding:8px 10px;border-radius:8px"><div style="color:var(--text2)">شبكة</div><div style="font-weight:700">${fmtNum(totalNetwork)} ${cur}</div></div>
        <div style="background:var(--bg);padding:8px 10px;border-radius:8px"><div style="color:var(--text2)">مرتجعات</div><div style="font-weight:700">${fmtNum(totalReturns)} ${cur}</div></div>
        <div style="background:var(--bg);padding:8px 10px;border-radius:8px"><div style="color:var(--text2)">مصاريف</div><div style="font-weight:700">${fmtNum(totalExpFromClosings)} ${cur}</div></div>
        <div style="background:var(--bg);padding:8px 10px;border-radius:8px"><div style="color:var(--text2)">غداء</div><div style="font-weight:700">${fmtNum(totalLunch)} ${cur}</div></div>
        <div style="background:var(--bg);padding:8px 10px;border-radius:8px"><div style="color:var(--text2)">ديون</div><div style="font-weight:700">${fmtNum(totalDebtsFromClosings)} ${cur}</div></div>
        <div style="background:var(--bg);padding:8px 10px;border-radius:8px"><div style="color:var(--text2)">سحوبات</div><div style="font-weight:700">${fmtNum(totalWithdrawals)} ${cur}</div></div>
        </div></div>`;
    }

    /* ===== PAYROLL SECTION ===== */
    if((sec==='all'||sec==='payroll')&&payrollData.length){
        html+=`<div class="report-section"><h3><i class="ri-hand-coin-fill"></i> صرف الرواتب (${payrollData.length})</h3><table class="report-table"><thead><tr><th>التاريخ</th><th>الموظف</th><th>المبلغ</th><th>الاستقطاعات</th><th>الصافي</th><th>ملاحظة</th></tr></thead><tbody>`;
        payrollData.forEach(p=>{
            const ded=p.deductions;
            const dedTotal=ded?(ded.debt||0)+(ded.attendance||0)+(ded.loan||0):0;
            const net=p.netPay||p.amount;
            html+=`<tr><td>${p.date}</td><td>${p.empName}</td><td>${fmtNum(p.amount)} ${cur}</td><td style="color:var(--clr-deduct)">${dedTotal>0?fmtNum(dedTotal):'-'}</td><td style="font-weight:700;color:var(--clr-expense)">${fmtNum(net)} ${cur}</td><td style="font-size:.78rem">${p.note||''}</td></tr>`;
        });
        html+=`<tr class="total-row"><td colspan="2">الإجمالي</td><td>${fmtNum(totalPayrollGross)} ${cur}</td><td>${totalDeductions>0?fmtNum(totalDeductions):'-'}</td><td>${fmtNum(totalPayroll)} ${cur}</td><td></td></tr></tbody></table></div>`;
    }

    /* ===== EXPENSES SECTION ===== */
    if((sec==='all'||sec==='expenses')&&expEntries.length){
        html+=`<div class="report-section"><h3><i class="ri-money-dollar-box-fill"></i> المصاريف المسجلة (${expEntries.length})</h3><table class="report-table"><thead><tr><th>التاريخ</th><th>الكاشير</th><th>الوصف</th><th>المبلغ</th></tr></thead><tbody>`;
        expEntries.forEach(e=>html+=`<tr><td>${e.date}</td><td>${e.cashier||''}</td><td>${e.desc||''}</td><td style="color:var(--clr-expense);font-weight:700">${fmtNum(e.amount)} ${cur}</td></tr>`);
        html+=`<tr class="total-row"><td colspan="3">الإجمالي</td><td>${fmtNum(totalExpEntries)} ${cur}</td></tr></tbody></table></div>`;
    }

    /* ===== PURCHASES SECTION ===== */
    if((sec==='all'||sec==='purchases')&&purchases.length){
        html+=`<div class="report-section"><h3><i class="ri-shopping-cart-2-fill"></i> المشتريات (${purchases.length})</h3><table class="report-table"><thead><tr><th>التاريخ</th><th>الوصف</th><th>المبلغ</th></tr></thead><tbody>`;
        purchases.forEach(p=>html+=`<tr><td>${p.date}</td><td>${p.desc||''}</td><td style="color:var(--clr-expense);font-weight:700">${fmtNum(p.amount)} ${cur}</td></tr>`);
        html+=`<tr class="total-row"><td colspan="2">الإجمالي</td><td>${fmtNum(totalPurchases)} ${cur}</td></tr></tbody></table></div>`;
    }

    /* ===== DEBTS SECTION ===== */
    if((sec==='all'||sec==='debts')&&debts.length){
        html+=`<div class="report-section"><h3><i class="ri-file-list-3-fill"></i> حركات الديون (${debts.length})</h3><table class="report-table"><thead><tr><th>التاريخ</th><th>الشخص</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>`;
        debts.forEach(d=>{
            const lbl=d.type==='repayment'?'تسديد':d.type==='withdraw'?'سحب':'دين';
            const clr=d.amount<0?'color:var(--clr-income)':'color:var(--clr-debt)';
            html+=`<tr><td>${d.date}</td><td>${d.person}</td><td>${lbl}</td><td style="${clr};font-weight:700">${fmtNum(d.amount)} ${cur}</td><td style="font-size:.78rem">${d.note||''}</td></tr>`;
        });
        html+=`<tr class="total-row"><td colspan="3">رصيد الديون الكلي</td><td colspan="2" style="color:var(--clr-debt)">${fmtNum(totalDebtBalance)} ${cur}</td></tr></tbody></table></div>`;
    }

    /* ===== SAFE TRANSACTIONS SECTION ===== */
    if((sec==='all'||sec==='safe')&&safeTrans.length){
        html+=`<div class="report-section"><h3><i class="ri-safe-2-fill"></i> حركات الخزنة (${safeTrans.length})</h3><table class="report-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>`;
        safeTrans.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).forEach(t=>{
            const isDeposit=t.type==='deposit';
            const clr=isDeposit?'color:var(--clr-income)':'color:var(--clr-expense)';
            html+=`<tr><td>${t.date}</td><td>${isDeposit?'إيداع':'سحب'}</td><td style="${clr};font-weight:700">${fmtNum(t.amount)} ${cur}</td><td style="font-size:.78rem">${t.note||''}</td></tr>`;
        });
        html+=`<tr class="total-row"><td>الإجمالي</td><td>إيداعات: ${fmtNum(safeDeposits)}</td><td>سحوبات: ${fmtNum(safeWithdrawals)}</td><td></td></tr></tbody></table></div>`;
    }

    /* ===== GENERAL EXPENSES SECTION ===== */
    if((sec==='all'||sec==='generalExpenses')&&genExpFiltered.length){
        html+=`<div class="report-section"><h3><i class="ri-building-line" style="color:#f97316"></i> المصاريف العامة (${genExpFiltered.length})</h3>`;
        html+=`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;font-size:.82rem">
            <div style="background:var(--bg);padding:8px;border-radius:8px;text-align:center"><div style="color:var(--text2)">الإجمالي</div><div style="font-weight:700;color:#f97316">${fmtNum(genExpTotal)} ${cur}</div></div>
            <div style="background:var(--bg);padding:8px;border-radius:8px;text-align:center"><div style="color:var(--text2)">إدارة</div><div style="font-weight:700;color:#7c3aed">${fmtNum(genExpAdmin)} ${cur}</div></div>
            <div style="background:var(--bg);padding:8px;border-radius:8px;text-align:center"><div style="color:var(--text2)">عامة</div><div style="font-weight:700;color:#0891b2">${fmtNum(genExpGeneral)} ${cur}</div></div>
        </div>`;
        html+=`<table class="report-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>الوصف</th><th>المبلغ</th></tr></thead><tbody>`;
        genExpFiltered.forEach(e=>{
            const typeLabel=e.type==='admin'?'إدارة':'عامة';
            html+=`<tr><td>${e.date}</td><td>${typeLabel}</td><td>${e.desc||''}</td><td style="color:#f97316;font-weight:700">${fmtNum(e.amount)} ${cur}</td></tr>`;
        });
        html+=`<tr class="total-row"><td colspan="3">الإجمالي</td><td>${fmtNum(genExpTotal)} ${cur}</td></tr></tbody></table></div>`;
    }

    /* ===== CLOSING SHEET (كشف الحسابات) SECTION ===== */
    if((sec==='all'||sec==='closingSheet')&&closings.length){
        let sheetNet=0;
        closings.forEach(c=>{sheetNet+=calcClosingTotal(c);});
        const sheetSafeBalance=getSafeBalance();
        html+=`<div class="report-section"><h3><i class="ri-file-list-line" style="color:#0ea5e9"></i> كشف الحسابات</h3>`;
        html+=`<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;font-size:.85rem">
            <div style="background:var(--bg);padding:10px;border-radius:8px;text-align:center"><div style="color:var(--text2)">صافي التقفيلات</div><div style="font-weight:800;font-size:1.1rem;color:var(--primary)">${fmtNum(sheetNet)} ${cur}</div></div>
            <div style="background:var(--bg);padding:10px;border-radius:8px;text-align:center"><div style="color:var(--text2)">رصيد الخزنة</div><div style="font-weight:800;font-size:1.1rem;color:${sheetSafeBalance>=0?'var(--clr-income)':'var(--clr-expense)'}">${fmtNum(sheetSafeBalance)} ${cur}</div></div>
        </div></div>`;
    }

    /* ===== FINAL SUMMARY ===== */
    html+=`<div class="report-section" style="background:linear-gradient(135deg,var(--primary),var(--primary-l));color:#fff;text-align:center;padding:20px">
    <h3 style="color:#fff;margin-bottom:12px"><i class="ri-wallet-3-fill"></i> الإجمالي النهائي</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">
    <div style="background:rgba(255,255,255,.15);padding:12px;border-radius:10px"><div style="font-size:.82rem;opacity:.8">إجمالي الإيداعات</div><div style="font-size:1.3rem;font-weight:800">${fmtNum(safeDeposits)} ${cur}</div></div>
    <div style="background:rgba(255,255,255,.15);padding:12px;border-radius:10px"><div style="font-size:.82rem;opacity:.8">إجمالي السحوبات</div><div style="font-size:1.3rem;font-weight:800">${fmtNum(safeWithdrawals)} ${cur}</div></div>
    <div style="background:rgba(255,255,255,.25);padding:12px;border-radius:10px;border:2px solid rgba(255,255,255,.4)"><div style="font-size:.82rem;opacity:.9">رصيد الخزنة الحالي</div><div style="font-size:1.5rem;font-weight:900">${fmtNum(safeBalance)} ${cur}</div></div>
    </div></div>`;

    content.innerHTML=html||'<div class="empty-state"><i class="ri-bar-chart-box-line"></i><p>لا توجد بيانات لهذا الشهر</p></div>';
}
function printReport(){
    if(!hasAction('print'))return toast('غير مصرح');
    /* get selected sections from checkboxes */
    const checkedSections=[...document.querySelectorAll('#printCheckboxes input:checked')].map(c=>c.value);
    if(!checkedSections.length)return toast('اختر قسماً واحداً على الأقل للطباعة');
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    let filterPrefix,filterLabel;
    if(reportPeriodMode==='daily'){
        filterPrefix=$('#reportDate').value||today();
        filterLabel='يوم '+filterPrefix;
    } else {
        filterPrefix=$('#reportMonth').value||today().slice(0,7);
        filterLabel='شهر '+filterPrefix;
    }
    const ym=filterPrefix;
    const closings=loadData(KEYS.closings).filter(c=>c.date&&c.date.startsWith(ym));
    const purchases=loadData(KEYS.purchases).filter(p=>p.date&&p.date.startsWith(ym));
    const payrollData=reportPeriodMode==='daily'
        ?loadData(KEYS.payroll).filter(p=>p.date===ym)
        :loadData(KEYS.payroll).filter(p=>p.month===ym);
    const safeTrans=loadData(KEYS.safe).filter(t=>t.date&&t.date.startsWith(ym));
    const debts=loadData(KEYS.debts).filter(d=>d.date&&d.date.startsWith(ym));
    const expEntries=loadData(KEYS.expenseEntries).filter(e=>e.date&&e.date.startsWith(ym));

    let totalSales=0,totalNet=0,totalExpFromClosings=0,totalLunch=0,totalDebtsFromClosings=0,totalWithdrawals=0,totalReturns=0;
    closings.forEach(c=>{
        CASHIERS.forEach(cs=>{
            const d=c.cashiers[cs.key];if(!d)return;
            const r=calcCashierNet(d);
            totalSales+=r.gross;
            totalReturns+=r.returns;
            totalExpFromClosings+=r.expenses;
            totalLunch+=r.lunch;
            totalDebtsFromClosings+=r.debts;
            totalWithdrawals+=r.withdraws;
            totalNet+=r.net;
        });
    });
    const totalPurchases=purchases.reduce((s,p)=>s+p.amount,0);
    const totalPayrollGross=payrollData.reduce((s,p)=>s+p.amount,0);
    const totalPayroll=payrollData.reduce((s,p)=>s+(p.netPay||p.amount),0);
    const totalDeductions=payrollData.reduce((s,p)=>{const ded=p.deductions;return s+(ded?(ded.debt||0)+(ded.attendance||0)+(ded.loan||0):0);},0);
    const totalExpEntries=expEntries.reduce((s,e)=>s+e.amount,0);
    const legacyExpenses=totalExpFromClosings+totalLunch;
    const totalAllExpenses=totalExpEntries+legacyExpenses;
    const safeDeposits=safeTrans.filter(t=>t.type==='deposit').reduce((s,t)=>s+t.amount,0);
    const safeWithdrawals2=safeTrans.filter(t=>t.type==='withdraw').reduce((s,t)=>s+t.amount,0);
    const safeBalance=getSafeBalance();
    const debtAdded=debts.filter(d=>d.amount>0).reduce((s,d)=>s+d.amount,0);
    const debtRepaid=debts.filter(d=>d.amount<0).reduce((s,d)=>s+Math.abs(d.amount),0);
    const totalDebtBalance=loadData(KEYS.debts).reduce((s,d)=>s+d.amount,0);
    const printDate=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});

    let html=`<div class="print-page-border">`;
    html+=`<div class="print-header"><h2>التقرير الشامل - ${filterLabel}</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">تاريخ الطباعة: ${printDate}</p></div>`;

    /* summary boxes */
    html+=`<div class="print-summary-box"><span>مبيعات: ${fmtNum(totalSales)}</span><span>صافي التقفيلات: ${fmtNum(totalNet)}</span><span>المصاريف: ${fmtNum(totalAllExpenses)}</span></div>`;
    html+=`<div class="print-summary-box"><span>الرواتب: ${fmtNum(totalPayrollGross)}</span><span>المشتريات: ${fmtNum(totalPurchases)}</span><span>ديون جديدة: ${fmtNum(debtAdded)}</span></div>`;

    /* closings */
    if(checkedSections.includes('closing')&&closings.length){
        html+=`<h3 style="margin-top:4px">التقفيلات (${closings.length})</h3><table><thead><tr><th>التاريخ</th><th>المدير</th>`;
        CASHIERS.forEach(cs=>html+=`<th>${cs.label}</th>`);
        html+=`<th>الصافي</th></tr></thead><tbody>`;
        closings.forEach(c=>{
            const cTotal=calcClosingTotal(c);
            html+=`<tr><td>${c.date}</td><td>${c.manager||'-'}</td>`;
            CASHIERS.forEach(cs=>{const d=c.cashiers[cs.key];html+=`<td>${d?fmtNum(calcCashierNet(d).net):'-'}</td>`;});
            html+=`<td style="color:${cTotal>=0?'#16a34a':'#dc2626'};font-weight:700">${fmtNum(cTotal)} ${cur}</td></tr>`;
        });
        html+=`</tbody></table>`;
    }

    /* payroll */
    if(checkedSections.includes('payroll')&&payrollData.length){
        html+=`<h3 style="margin-top:4px">صرف الرواتب (${payrollData.length})</h3><table><thead><tr><th>#</th><th>الموظف</th><th>المبلغ</th><th>الاستقطاعات</th><th>الصافي</th><th>ملاحظة</th></tr></thead><tbody>`;
        payrollData.forEach((p,i)=>{
            const ded=p.deductions;const dedTotal=ded?(ded.debt||0)+(ded.attendance||0)+(ded.loan||0):0;const net=p.netPay||p.amount;
            html+=`<tr><td>${i+1}</td><td>${p.empName}</td><td>${fmtNum(p.amount)}</td><td>${dedTotal>0?fmtNum(dedTotal):'-'}</td><td style="font-weight:700">${fmtNum(net)} ${cur}</td><td>${p.note||''}</td></tr>`;
        });
        html+=`<tr style="font-weight:700;background:#f1f5f9"><td colspan="2">الإجمالي</td><td>${fmtNum(totalPayrollGross)}</td><td>${totalDeductions>0?fmtNum(totalDeductions):'-'}</td><td>${fmtNum(totalPayroll)} ${cur}</td><td></td></tr></tbody></table>`;
    }

    /* expenses */
    if(checkedSections.includes('expenses')&&expEntries.length){
        html+=`<h3 style="margin-top:4px">المصاريف (${expEntries.length})</h3><table><thead><tr><th>التاريخ</th><th>الوصف</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>`;
        expEntries.forEach(e=>html+=`<tr><td>${e.date}</td><td>${e.desc||''}</td><td style="color:#dc2626;font-weight:700">${fmtNum(e.amount)} ${cur}</td><td>${e.note||''}</td></tr>`);
        html+=`</tbody></table>`;
    }

    /* purchases */
    if(checkedSections.includes('purchases')&&purchases.length){
        html+=`<h3 style="margin-top:4px">المشتريات (${purchases.length})</h3><table><thead><tr><th>التاريخ</th><th>الوصف</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>`;
        purchases.forEach(p=>html+=`<tr><td>${p.date}</td><td>${p.desc||''}</td><td style="color:#dc2626;font-weight:700">${fmtNum(p.amount)} ${cur}</td><td>${p.note||''}</td></tr>`);
        html+=`</tbody></table>`;
    }

    /* debts */
    if(checkedSections.includes('debts')&&debts.length){
        html+=`<h3 style="margin-top:4px">حركات الديون (${debts.length})</h3><table><thead><tr><th>التاريخ</th><th>الشخص</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>`;
        debts.forEach(d=>{
            const lbl=d.type==='repayment'?'تسديد':d.type==='withdraw'?'سحب':'دين';
            html+=`<tr><td>${d.date}</td><td>${d.person}</td><td>${lbl}</td><td style="color:${d.amount<0?'#16a34a':'#dc2626'};font-weight:700">${fmtNum(d.amount)} ${cur}</td><td>${d.note||''}</td></tr>`;
        });
        html+=`</tbody></table>`;
    }

    /* safe */
    if(checkedSections.includes('safe')&&safeTrans.length){
        html+=`<h3 style="margin-top:4px">حركات الخزنة (${safeTrans.length})</h3><table><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>`;
        safeTrans.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).forEach(t=>{
            const isDeposit=t.type==='deposit';
            html+=`<tr><td>${t.date}</td><td>${isDeposit?'إيداع':'سحب'}</td><td style="color:${isDeposit?'#16a34a':'#dc2626'};font-weight:700">${fmtNum(t.amount)} ${cur}</td><td>${t.note||''}</td></tr>`;
        });
        html+=`</tbody></table>`;
    }

    /* general expenses */
    if(checkedSections.includes('generalExpenses')){
        const allGenExpP=loadData(KEYS.expenseEntries).filter(e=>{const t=e.type||'dept';return t==='general'||t==='admin';});
        const genExpP=allGenExpP.filter(e=>e.date&&e.date.startsWith(ym));
        if(genExpP.length){
            const genExpTotalP=genExpP.reduce((s,e)=>s+(e.amount||0),0);
            html+=`<h3 style="margin-top:4px">المصاريف العامة (${genExpP.length})</h3><table><thead><tr><th>التاريخ</th><th>النوع</th><th>الوصف</th><th>المبلغ</th></tr></thead><tbody>`;
            genExpP.forEach(e=>{
                html+=`<tr><td>${e.date}</td><td>${e.type==='admin'?'إدارة':'عامة'}</td><td>${e.desc||''}</td><td style="color:#f97316;font-weight:700">${fmtNum(e.amount)} ${cur}</td></tr>`;
            });
            html+=`<tr style="font-weight:700;background:#f1f5f9"><td colspan="3">الإجمالي</td><td>${fmtNum(genExpTotalP)} ${cur}</td></tr></tbody></table>`;
        }
    }

    /* closing sheet */
    if(checkedSections.includes('closingSheet')&&closings.length){
        let sheetNetP=0;
        closings.forEach(c=>{sheetNetP+=calcClosingTotal(c);});
        html+=`<h3 style="margin-top:4px">كشف الحسابات</h3>`;
        html+=`<div style="display:flex;justify-content:space-around;border:1px solid #999;padding:4px;border-radius:4px;font-weight:700;font-size:10pt">`;
        html+=`<span>صافي التقفيلات: ${fmtNum(sheetNetP)} ${cur}</span><span>رصيد الخزنة: ${fmtNum(safeBalance)} ${cur}</span></div>`;
    }

    /* final summary */
    html+=`<div style="margin-top:5px;border:2px solid #333;border-radius:4px;padding:5px">`;
    html+=`<div style="text-align:center;font-weight:800;font-size:11pt;margin-bottom:4px">الإجمالي النهائي</div>`;
    html+=`<div class="print-summary-box"><span>إيداعات الخزنة: ${fmtNum(safeDeposits)}</span><span>سحوبات الخزنة: ${fmtNum(safeWithdrawals2)}</span></div>`;
    html+=`<div class="print-summary-box"><span>ديون مسددة: ${fmtNum(debtRepaid)}</span><span>رصيد الديون: ${fmtNum(totalDebtBalance)}</span></div>`;
    html+=`<div style="text-align:center;font-size:12pt;font-weight:900;margin-top:4px;padding:5px;background:#f1f5f9;border-radius:4px">رصيد الخزنة الحالي: ${fmtNum(safeBalance)} ${cur}</div>`;
    html+=`</div>`;
    html+=`</div>`;
    showPrintDialog(html);
}

/* ============== إضافة مصروف/سحب مباشر في المصاريف العامة ============== */
function addGeneralExpense(){
    if(!hasAction('addGeneralExpense'))return toast('غير مصرح - لا تملك صلاحية إضافة مصاريف عامة');
    const s=loadSettings();const cur=s.currency||'د.ع';
    const html=`
    <div class="field"><label>الوصف</label><input type="text" id="newGenExpDesc" class="input-field" placeholder="مثال: إيجار، كهرباء، إنترنت..."></div>
    <div class="field"><label>المبلغ (بالآلاف)</label><input type="number" id="newGenExpAmount" class="input-field" placeholder="0" inputmode="decimal"></div>
    <div class="field"><label>النوع</label>
        <div style="display:flex;gap:6px;margin-top:6px" id="newGenExpTypeBox" data-selected="general">
            <button type="button" class="btn" onclick="selectGenExpType('general')" id="newGenTypeBtn_general" style="flex:1;background:#0891b2;color:#fff"><i class="ri-building-line"></i> عامة</button>
            <button type="button" class="btn btn-ghost" onclick="selectGenExpType('admin')" id="newGenTypeBtn_admin" style="flex:1"><i class="ri-user-star-line"></i> إدارة</button>
        </div>
    </div>
    <div class="field"><label>التاريخ</label><input type="date" id="newGenExpDate" class="input-field" value="${today()}"></div>
    <div class="field"><label>القسم المرتبط (اختياري)</label>
        <select id="newGenExpCashier" class="input-field">
            <option value="">— بدون —</option>
            ${CASHIERS.map(c=>`<option value="${c.label}">${c.label}</option>`).join('')}
        </select>
    </div>`;
    openModal('إضافة مصروف عام/إدارة',html,
        `<button class="btn btn-success" onclick="saveGeneralExpense()"><i class="ri-save-line"></i> حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function selectGenExpType(type){
    const box=document.getElementById('newGenExpTypeBox');if(!box)return;
    box.dataset.selected=type;
    const btnG=document.getElementById('newGenTypeBtn_general');
    const btnA=document.getElementById('newGenTypeBtn_admin');
    if(btnG){btnG.className='btn '+(type==='general'?'':'btn-ghost');btnG.style.background=type==='general'?'#0891b2':'';btnG.style.color=type==='general'?'#fff':'';}
    if(btnA){btnA.className='btn '+(type==='admin'?'':'btn-ghost');btnA.style.background=type==='admin'?'#7c3aed':'';btnA.style.color=type==='admin'?'#fff':'';}
}
function saveGeneralExpense(){
    const desc=$('#newGenExpDesc').value.trim();
    const amount=parseK($('#newGenExpAmount').value);
    const date=$('#newGenExpDate').value||today();
    const cashier=$('#newGenExpCashier').value||'';
    const type=document.getElementById('newGenExpTypeBox').dataset.selected||'general';
    if(!desc)return toast('أدخل الوصف');
    if(!amount)return toast('أدخل المبلغ');
    const entries=loadData(KEYS.expenseEntries);
    entries.push({id:uid(),amount,desc,type,cashier,date,by:getByTag()});
    saveData(KEYS.expenseEntries,entries);
    closeModal();
    toast('✅ تم حفظ المصروف');
    renderGeneralExpenses();
}

function addGeneralWithdraw(){
    if(!hasAction('addWithdraw'))return toast('غير مصرح - لا تملك صلاحية إضافة سحب');
    const allDebts=loadData(KEYS.debts);
    const names=[...new Set(allDebts.map(d=>d.person))].filter(Boolean);
    const options=names.map(n=>`<option value="${n}">${n}</option>`).join('');
    const html=`
    <div class="field"><label>الشخص</label>
        <select id="newGenWdPerson" class="input-field">
            <option value="">-- اختر --</option>
            ${options}
            <option value="__new__">+ شخص جديد</option>
        </select>
    </div>
    <div class="field" id="newGenWdPersonNewWrap" style="display:none"><label>اسم الشخص الجديد</label><input type="text" id="newGenWdPersonNew" class="input-field"></div>
    <div class="field"><label>المبلغ (بالآلاف)</label><input type="number" id="newGenWdAmount" class="input-field" inputmode="decimal"></div>
    <div class="field"><label>ملاحظة</label><input type="text" id="newGenWdNote" class="input-field" placeholder="سبب السحب..."></div>
    <div class="field"><label>التصنيف</label>
        <div style="display:flex;gap:6px;margin-top:6px" id="newGenWdTypeBox" data-selected="general">
            <button type="button" class="btn" onclick="selectGenWdType('general')" id="newGenWdTypeBtn_general" style="flex:1;background:#0891b2;color:#fff"><i class="ri-building-line"></i> عامة</button>
            <button type="button" class="btn btn-ghost" onclick="selectGenWdType('admin')" id="newGenWdTypeBtn_admin" style="flex:1"><i class="ri-user-star-line"></i> إدارة</button>
        </div>
    </div>
    <div class="field"><label>التاريخ</label><input type="date" id="newGenWdDate" class="input-field" value="${today()}"></div>
    <div style="font-size:.78rem;color:var(--text2);background:#fef3c7;padding:8px;border-radius:6px;margin-top:8px"><i class="ri-information-line"></i> السحب سيُسجّل في الديون <strong>وأيضاً</strong> كمصروف ${'general'} في سجل المصاريف العامة.</div>`;
    openModal('إضافة سحب عام/إدارة',html,
        `<button class="btn btn-success" onclick="saveGeneralWithdraw()"><i class="ri-save-line"></i> حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
    /* listener لإظهار حقل الاسم الجديد */
    const sel=document.getElementById('newGenWdPerson');
    if(sel)sel.addEventListener('change',e=>{
        document.getElementById('newGenWdPersonNewWrap').style.display=e.target.value==='__new__'?'':'none';
    });
}
function selectGenWdType(type){
    const box=document.getElementById('newGenWdTypeBox');if(!box)return;
    box.dataset.selected=type;
    const btnG=document.getElementById('newGenWdTypeBtn_general');
    const btnA=document.getElementById('newGenWdTypeBtn_admin');
    if(btnG){btnG.className='btn '+(type==='general'?'':'btn-ghost');btnG.style.background=type==='general'?'#0891b2':'';btnG.style.color=type==='general'?'#fff':'';}
    if(btnA){btnA.className='btn '+(type==='admin'?'':'btn-ghost');btnA.style.background=type==='admin'?'#7c3aed':'';btnA.style.color=type==='admin'?'#fff':'';}
}
function saveGeneralWithdraw(){
    let person=$('#newGenWdPerson').value;
    if(person==='__new__'){
        person=$('#newGenWdPersonNew').value.trim();
        if(!person)return toast('أدخل اسم الشخص');
    }
    if(!person)return toast('اختر الشخص');
    const amount=parseK($('#newGenWdAmount').value);
    if(!amount)return toast('أدخل المبلغ');
    const note=$('#newGenWdNote').value.trim();
    const date=$('#newGenWdDate').value||today();
    const type=document.getElementById('newGenWdTypeBox').dataset.selected||'general';
    const by=getByTag();
    const typeLabel=type==='admin'?'إدارة':'عامة';

    /* إضافة للسحوبات */
    const withdrawals=loadData(KEYS.withdrawals);
    withdrawals.push({id:uid(),person,amount,note:'['+typeLabel+'] '+note,cashier:'',date,by,generalType:type});
    saveData(KEYS.withdrawals,withdrawals);

    /* إضافة للديون (سحب) */
    const debts=loadData(KEYS.debts);
    debts.push({id:uid(),person,amount,note:'سحب ['+typeLabel+']: '+note,type:'withdraw',cashier:'',date,by});
    saveData(KEYS.debts,debts);

    /* إضافة كمصروف عام */
    const entries=loadData(KEYS.expenseEntries);
    entries.push({id:uid(),amount,desc:'سحب: '+person+(note?' — '+note:''),type,cashier:'',date,by,fromWithdraw:true});
    saveData(KEYS.expenseEntries,entries);

    closeModal();
    toast('✅ تم حفظ السحب');
    renderGeneralExpenses();
}

/* ============================================================
   ==============  GENERAL EXPENSES PAGE  =====================
   ============================================================ */
let _genExpChartInstance=null;

function getGeneralExpenses(ym, typeFilter){
    /* دمج: من expenseEntries + من closings (legacy fallback) */
    let all=loadData(KEYS.expenseEntries)||[];
    if(ym) all=all.filter(e=>e.date&&e.date.startsWith(ym));
    /* استبعاد dept - نعرض فقط general و admin */
    all=all.filter(e=>{
        const t=e.type||'dept';
        return t==='general' || t==='admin';
    });
    if(typeFilter && typeFilter!=='all') all=all.filter(e=>(e.type||'dept')===typeFilter);
    /* sort newest first */
    all.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    return all;
}

function renderGeneralExpenses(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const monthInput=$('#genExpMonth');
    if(monthInput && !monthInput.value) monthInput.value=today().slice(0,7);
    const ym=monthInput?monthInput.value:'';
    const typeFilter=$('#genExpTypeFilter')?.value||'all';

    const entries=getGeneralExpenses(ym,typeFilter);
    const totalAll=entries.reduce((s,e)=>s+(e.amount||0),0);
    const totalAdmin=entries.filter(e=>e.type==='admin').reduce((s,e)=>s+(e.amount||0),0);
    const totalGeneral=entries.filter(e=>e.type==='general').reduce((s,e)=>s+(e.amount||0),0);

    $('#genExpTotalAll').textContent=fmtNum(totalAll)+' '+cur;
    $('#genExpTotalAdmin').textContent=fmtNum(totalAdmin)+' '+cur;
    $('#genExpTotalGeneral').textContent=fmtNum(totalGeneral)+' '+cur;
    $('#genExpCount').textContent=entries.length;

    /* القائمة */
    const list=$('#genExpList');
    if(!entries.length){
        list.innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا توجد مصاريف عامة/إدارة لهذا الشهر</p></div>';
    } else {
        const canEdit=hasAction('edit'),canDel=hasAction('delete');
        const allIds=entries.filter(e=>e.id).map(e=>e.id);
        /* تجميع بالتاريخ */
        const groups={};
        entries.forEach(e=>{const d=e.date||'';if(!groups[d])groups[d]=[];groups[d].push(e);});
        let html=_multiSelectBar('genexp',KEYS.expenseEntries,allIds,'renderGeneralExpenses');
        Object.keys(groups).sort((a,b)=>b.localeCompare(a)).forEach(date=>{
            html+=`<div style="font-size:.82rem;font-weight:700;color:var(--text2);margin:10px 0 4px;padding:4px 8px;background:var(--bg);border-radius:6px"><i class="ri-calendar-line"></i> ${date}</div>`;
            groups[date].forEach(e=>{
                const typeBadge=e.type==='admin'
                    ?'<span style="background:#ede9fe;color:#7c3aed;padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:700">إدارة</span>'
                    :'<span style="background:#cffafe;color:#0891b2;padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:700">عامة</span>';
                const detailsBtn=e.id?`<button onclick="viewExpenseDetails('${e.id}')" title="تفاصيل"><i class="ri-eye-line"></i></button>`:'';
                const convertBtn=e.id?`<button onclick="convertExpenseType('${e.id}')" title="تحويل" style="color:#f97316"><i class="ri-swap-line"></i></button>`:'';
                const editBtn=e.id&&canEdit?`<button onclick="editGenExpense('${e.id}')" title="تعديل"><i class="ri-edit-line"></i></button>`:'';
                const delBtn=e.id&&canDel?`<button onclick="deleteGenExpense('${e.id}')" title="حذف"><i class="ri-delete-bin-line"></i></button>`:'';
                const actions=(detailsBtn||convertBtn||editBtn||delBtn)?`<div class="rec-actions">${detailsBtn}${convertBtn}${editBtn}${delBtn}</div>`:'';
                const sel=e.id&&(_selectedIds['genexp']&&_selectedIds['genexp'].has(e.id))?'selected':'';
                const cb=e.id?_multiSelectCheckbox('genexp',e.id,'renderGeneralExpenses'):'';
                html+=`<div class="record-card ${sel}">
                    <div style="display:flex;align-items:center">${cb}<div class="rec-info">
                        <div class="rec-title">${typeBadge} ${e.desc||'مصروف'}</div>
                        <div class="rec-sub">${e.cashier?'القسم: '+e.cashier+' | ':''}${e.by?'<span class="by-tag">'+e.by+'</span>':''}</div>
                    </div></div>
                    <div class="rec-amount expense">${fmtNum(e.amount)} ${cur}</div>
                    ${actions}
                </div>`;
            });
        });
        list.innerHTML=html;
    }

    /* الرسم البياني الشهري - آخر 12 شهر */
    renderGenExpChart();
}

function renderGenExpChart(){
    const canvas=document.getElementById('genExpChart');
    if(!canvas || typeof Chart==='undefined') return;
    /* آخر 12 شهر */
    const now=new Date();
    const months=[];
    for(let i=11;i>=0;i--){
        const d=new Date(now.getFullYear(),now.getMonth()-i,1);
        months.push({
            key:d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'),
            label:d.toLocaleDateString('ar-IQ',{year:'2-digit',month:'short'})
        });
    }
    const allEntries=loadData(KEYS.expenseEntries)||[];
    const dataAdmin=months.map(m=>allEntries.filter(e=>e.date&&e.date.startsWith(m.key)&&e.type==='admin').reduce((s,e)=>s+e.amount,0));
    const dataGeneral=months.map(m=>allEntries.filter(e=>e.date&&e.date.startsWith(m.key)&&e.type==='general').reduce((s,e)=>s+e.amount,0));

    if(_genExpChartInstance){_genExpChartInstance.destroy();}
    _genExpChartInstance=new Chart(canvas.getContext('2d'),{
        type:'bar',
        data:{
            labels:months.map(m=>m.label),
            datasets:[
                {label:'مصاريف إدارة',data:dataAdmin,backgroundColor:'#7c3aed',borderRadius:4},
                {label:'مصاريف عامة',data:dataGeneral,backgroundColor:'#0891b2',borderRadius:4}
            ]
        },
        options:{
            responsive:true,maintainAspectRatio:false,
            plugins:{legend:{position:'bottom',labels:{font:{family:'Tajawal',size:11}}}},
            scales:{
                x:{stacked:false,ticks:{font:{family:'Tajawal',size:10}}},
                y:{stacked:false,ticks:{font:{family:'Tajawal',size:10},callback:v=>fmtNum(v)}}
            }
        }
    });
}

function editGenExpense(id){
    if(!hasAction('edit'))return toast('غير مصرح');
    const entries=loadData(KEYS.expenseEntries);
    const e=entries.find(x=>x.id===id);if(!e)return;
    const curType=e.type||'general';
    openModal('تعديل المصروف العام',`
    <div class="field"><label>الوصف</label><input type="text" id="editGenExpDesc" class="input-field" value="${e.desc||''}"></div>
    <div class="field"><label>المبلغ (بالآلاف)</label><input type="number" id="editGenExpAmount" class="input-field" value="${toK(e.amount)}" inputmode="decimal"></div>
    <div class="field"><label>النوع</label>
        <select id="editGenExpType" class="input-field">
            <option value="general" ${curType==='general'?'selected':''}>عامة</option>
            <option value="admin" ${curType==='admin'?'selected':''}>إدارة</option>
            <option value="dept" ${curType==='dept'?'selected':''}>قسم (ينقل لصفحة المصاريف)</option>
        </select>
    </div>
    <div class="field"><label>التاريخ</label><input type="date" id="editGenExpDate" class="input-field" value="${e.date}"></div>`,
    `<button class="btn btn-success" onclick="saveEditGenExpense('${id}')">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function saveEditGenExpense(id){
    const entries=loadData(KEYS.expenseEntries);
    const idx=entries.findIndex(x=>x.id===id);if(idx<0)return;
    entries[idx].desc=$('#editGenExpDesc').value.trim();
    entries[idx].amount=parseK($('#editGenExpAmount').value);
    entries[idx].type=$('#editGenExpType').value;
    entries[idx].date=$('#editGenExpDate').value||entries[idx].date;
    entries[idx].by=getByTag();
    saveData(KEYS.expenseEntries,entries);
    closeModal();toast('تم التحديث');renderGeneralExpenses();
}
function deleteGenExpense(id){
    if(!hasAction('delete'))return toast('غير مصرح');
    if(!confirm('حذف هذا المصروف؟'))return;
    let arr=loadData(KEYS.expenseEntries);
    arr=arr.filter(e=>e.id!==id);
    saveData(KEYS.expenseEntries,arr);
    toast('تم الحذف');renderGeneralExpenses();
}

function printGeneralExpenses(){
    if(!hasAction('print'))return toast('غير مصرح');
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const ym=$('#genExpMonth')?.value||today().slice(0,7);
    const typeFilter=$('#genExpTypeFilter')?.value||'all';
    const entries=getGeneralExpenses(ym,typeFilter);
    const totalAll=entries.reduce((s,e)=>s+(e.amount||0),0);
    const totalAdmin=entries.filter(e=>e.type==='admin').reduce((s,e)=>s+(e.amount||0),0);
    const totalGeneral=entries.filter(e=>e.type==='general').reduce((s,e)=>s+(e.amount||0),0);
    const printDate=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});

    let html=`<div class="print-page-border">`;
    html+=`<div class="print-header"><h2>كشف المصاريف العامة والإدارية</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">الشهر: ${ym} | تاريخ الطباعة: ${printDate}</p></div>`;

    html+=`<div class="print-summary-box">
        <span>إجمالي: ${fmtNum(totalAll)} ${cur}</span>
        <span>إدارة: ${fmtNum(totalAdmin)} ${cur}</span>
        <span>عامة: ${fmtNum(totalGeneral)} ${cur}</span>
        <span>عدد: ${entries.length}</span>
    </div>`;

    if(entries.length){
        html+=`<table><thead><tr><th>#</th><th>التاريخ</th><th>النوع</th><th>الوصف</th><th>القسم</th><th>المبلغ</th></tr></thead><tbody>`;
        entries.forEach((e,i)=>{
            const typeText=e.type==='admin'?'إدارة':'عامة';
            const typeColor=e.type==='admin'?'#7c3aed':'#0891b2';
            html+=`<tr><td>${i+1}</td><td>${e.date}</td><td style="color:${typeColor};font-weight:700">${typeText}</td><td>${e.desc||'-'}</td><td>${e.cashier||'-'}</td><td class="print-amount p-expense">${fmtNum(e.amount)} ${cur}</td></tr>`;
        });
        html+=`<tr style="font-weight:700;background:#f1f5f9"><td colspan="5">الإجمالي</td><td class="print-amount p-expense">${fmtNum(totalAll)} ${cur}</td></tr></tbody></table>`;
    } else {
        html+=`<p style="text-align:center;padding:20px;color:#666">لا توجد مصاريف</p>`;
    }
    html+=`</div>`;
    showPrintDialog(html);
}

function exportGeneralExpensesPDF(){
    /* نستخدم نافذة الطباعة مع حفظ PDF (المتصفح يدعمه) */
    printGeneralExpenses();
    toast('اختر "حفظ كـ PDF" من نافذة الطباعة');
}

/* ============================================================
   ================  CLOSING SHEET PAGE  ======================
   ============================================================ */
let _sheetMode='vertical';
let _sheetTab='net';   /* 'net' = الصافي النهائي، 'gross' = الرصيد الخام */

function setSheetMode(mode){
    _sheetMode=mode;
    document.querySelectorAll('.sheet-mode-btn').forEach(b=>{
        const active=b.dataset.mode===mode;
        b.classList.toggle('active',active);
        b.style.background=active?'var(--primary)':'transparent';
        b.style.color=active?'#fff':'var(--text)';
    });
    renderClosingSheet();
}

function setSheetTab(tab){
    _sheetTab=tab;
    document.querySelectorAll('.sheet-tab-btn').forEach(b=>{
        const active=b.dataset.tab===tab;
        b.classList.toggle('active',active);
        if(active){
            b.style.background=tab==='net'?'linear-gradient(135deg,#0ea5e9,#0284c7)':'linear-gradient(135deg,#f59e0b,#d97706)';
            b.style.color='#fff';
        } else {
            b.style.background='transparent';
            b.style.color='var(--text)';
        }
    });
    renderClosingSheet();
}

function renderClosingSheet(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const monthInput=$('#sheetMonth');
    if(monthInput && !monthInput.value) monthInput.value=today().slice(0,7);
    const ym=monthInput?monthInput.value:today().slice(0,7);

    const closings=loadData(KEYS.closings)
        .filter(c=>c.date&&c.date.startsWith(ym))
        .sort((a,b)=>(a.date||'').localeCompare(b.date||''));

    const content=$('#closingSheetContent');

    /* التبويبان */
    const tabsHTML=`
    <div style="display:flex;gap:4px;background:var(--surface2);border-radius:10px;padding:5px;margin-bottom:14px">
        <button class="sheet-tab-btn ${_sheetTab==='net'?'active':''}" data-tab="net" onclick="setSheetTab('net')" style="flex:1;border:none;padding:10px;border-radius:7px;cursor:pointer;font-weight:700;font-size:.88rem;background:${_sheetTab==='net'?'linear-gradient(135deg,#0ea5e9,#0284c7)':'transparent'};color:${_sheetTab==='net'?'#fff':'var(--text)'}">
            <i class="ri-checkbox-circle-line"></i> صافي التقفيلات
            <div style="font-size:.7rem;opacity:.9;font-weight:400;margin-top:2px">الناتج النهائي بعد الخصم</div>
        </button>
        <button class="sheet-tab-btn ${_sheetTab==='gross'?'active':''}" data-tab="gross" onclick="setSheetTab('gross')" style="flex:1;border:none;padding:10px;border-radius:7px;cursor:pointer;font-weight:700;font-size:.88rem;background:${_sheetTab==='gross'?'linear-gradient(135deg,#f59e0b,#d97706)':'transparent'};color:${_sheetTab==='gross'?'#fff':'var(--text)'}">
            <i class="ri-stack-line"></i> رصيد الكاشير الخام
            <div style="font-size:.7rem;opacity:.9;font-weight:400;margin-top:2px">المبيعات ثم الخصومات</div>
        </button>
    </div>`;

    if(!closings.length){
        content.innerHTML=tabsHTML+'<div class="empty-state"><i class="ri-inbox-line"></i><p>لا توجد تقفيلات لهذا الشهر</p></div>';
        return;
    }

    /* حساب كلا الجانبين */
    const rows=closings.map(c=>{
        const cashierDetails={};
        let gross=0,returns=0,expenses=0,lunch=0,debts=0,withdraws=0;
        CASHIERS.forEach(cs=>{
            const d=c.cashiers[cs.key];
            if(d){
                const r=calcCashierNet(d);
                cashierDetails[cs.key]={net:r.net,gross:r.gross};
                gross+=r.gross;
                returns+=r.returns;
                expenses+=r.expenses;
                lunch+=r.lunch;
                debts+=r.debts;
                withdraws+=r.withdraws;
            } else {
                cashierDetails[cs.key]={net:0,gross:0};
            }
        });
        const totalDeductions=returns+expenses+lunch+debts+withdraws;
        return {
            date:c.date, manager:c.manager||'',
            total:calcClosingTotal(c),
            cashiers:cashierDetails,
            gross, returns, expenses, lunch, debts, withdraws, totalDeductions
        };
    });

    const grandTotal=rows.reduce((s,r)=>s+r.total,0);
    const grandGross=rows.reduce((s,r)=>s+r.gross,0);
    const grandReturns=rows.reduce((s,r)=>s+r.returns,0);
    const grandExpenses=rows.reduce((s,r)=>s+r.expenses,0);
    const grandLunch=rows.reduce((s,r)=>s+r.lunch,0);
    const grandDebts=rows.reduce((s,r)=>s+r.debts,0);
    const grandWithdraws=rows.reduce((s,r)=>s+r.withdraws,0);
    const grandTotalDeductions=grandReturns+grandExpenses+grandLunch+grandDebts+grandWithdraws;

    /* ====================== التبويب الأول: الصافي النهائي ====================== */
    if(_sheetTab==='net'){
        let html=tabsHTML;
        if(_sheetMode==='vertical'){
            html+=`<div class="sheet-vertical" style="background:#fffaf0;border:2px solid #fbbf24;border-radius:12px;padding:20px;max-width:500px;margin:0 auto;font-family:'Tajawal',serif">
            <div style="text-align:center;margin-bottom:14px;border-bottom:2px dashed #92400e;padding-bottom:10px">
                <div style="font-weight:800;color:#92400e;font-size:1.1rem"><i class="ri-file-list-line"></i> كشف صافي التقفيلات</div>
                <div style="font-size:.85rem;color:#b45309;margin-top:4px">${ym} | عدد التقفيلات: ${closings.length}</div>
            </div>
            <div style="font-family:'Courier New',monospace;font-size:1.15rem;line-height:1.8;text-align:left;direction:ltr">`;
            rows.forEach(r=>{
                const sign=r.total<0?'-':' ';
                const str=fmtNum(Math.abs(r.total)).padStart(10,' ');
                html+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 8px">
                    <span style="color:#64748b;font-size:.75rem;font-family:'Tajawal'">${r.date}</span>
                    <span style="color:${r.total>=0?'#166534':'#991b1b'};font-weight:700">${sign}${str}</span>
                </div>`;
            });
            html+=`<div style="border-top:3px double #92400e;margin:8px 8px 4px;padding-top:6px"></div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:#fde68a;border-radius:6px;margin-top:4px">
                <span style="font-family:'Tajawal';font-weight:800;color:#78350f">الإجمالي</span>
                <span style="color:${grandTotal>=0?'#166534':'#991b1b'};font-weight:800;font-size:1.25rem">${grandTotal<0?'-':''}${fmtNum(Math.abs(grandTotal))} ${cur}</span>
            </div></div></div>`;
        } else {
            /* أفقي */
            html+=`<div class="card" style="padding:14px;overflow-x:auto">
            <table class="report-table" style="width:100%;font-size:.85rem">
                <thead><tr style="background:var(--primary);color:#fff">
                    <th>التاريخ</th><th>المدير</th>`;
            CASHIERS.forEach(cs=>html+=`<th>${cs.label}</th>`);
            html+=`<th style="background:#0284c7">الإجمالي</th></tr></thead><tbody>`;
            const cashierTotals={};CASHIERS.forEach(cs=>cashierTotals[cs.key]=0);
            rows.forEach((r,i)=>{
                html+=`<tr style="background:${i%2===0?'var(--bg)':'var(--surface)'}">
                    <td style="font-weight:700">${r.date}</td>
                    <td style="font-size:.8rem">${r.manager||'-'}</td>`;
                CASHIERS.forEach(cs=>{
                    const v=r.cashiers[cs.key].net;
                    cashierTotals[cs.key]+=v;
                    const clr=v<0?'color:var(--clr-expense)':v>0?'color:var(--text)':'color:var(--text3)';
                    html+=`<td style="${clr}">${v!==0?fmtNum(v):'—'}</td>`;
                });
                const tclr=r.total<0?'color:var(--clr-expense)':'color:var(--clr-income)';
                html+=`<td style="${tclr};font-weight:800">${fmtNum(r.total)}</td></tr>`;
            });
            html+=`<tr style="background:#fde68a;font-weight:800;border-top:3px double #92400e">
                <td colspan="2" style="color:#78350f">الإجمالي الشهري</td>`;
            CASHIERS.forEach(cs=>{
                const t=cashierTotals[cs.key];
                const clr=t<0?'color:var(--clr-expense)':'color:#166534';
                html+=`<td style="${clr}">${fmtNum(t)}</td>`;
            });
            const gclr=grandTotal<0?'color:var(--clr-expense)':'color:#166534';
            html+=`<td style="${gclr};font-size:1.05rem">${fmtNum(grandTotal)} ${cur}</td></tr>`;
            html+=`</tbody></table></div>`;
            html+=`<div style="margin-top:12px;padding:12px;background:linear-gradient(135deg,#0ea5e9,#0284c7);color:#fff;border-radius:10px;text-align:center">
                <div style="font-size:.85rem;opacity:.9">مجموع صوافي جميع التقفيلات</div>
                <div style="font-size:1.8rem;font-weight:800">${fmtNum(grandTotal)} ${cur}</div>
                <div style="font-size:.78rem;opacity:.85;margin-top:4px">${closings.length} تقفيلة</div>
            </div>`;
        }
        content.innerHTML=html;
        return;
    }

    /* ====================== التبويب الثاني: الرصيد الخام مع الخصومات ====================== */
    let html=tabsHTML;
    if(_sheetMode==='vertical'){
        /* نعرض: مبيعات كل يوم عموديًا ثم المجموع ثم الخصومات ثم النتيجة */
        html+=`<div style="background:#fff7ed;border:2px solid #fb923c;border-radius:12px;padding:20px;max-width:520px;margin:0 auto;font-family:'Tajawal'">
        <div style="text-align:center;margin-bottom:14px;border-bottom:2px dashed #9a3412;padding-bottom:10px">
            <div style="font-weight:800;color:#9a3412;font-size:1.1rem"><i class="ri-stack-line"></i> كشف رصيد الكاشير الخام</div>
            <div style="font-size:.82rem;color:#c2410c;margin-top:4px">${ym} | المبيعات قبل أي خصم</div>
        </div>

        <!-- القسم 1: المبيعات اليومية -->
        <div style="font-weight:700;color:#9a3412;font-size:.9rem;margin-bottom:6px;padding:6px 10px;background:#fed7aa;border-radius:6px"><i class="ri-arrow-up-line"></i> رصيد الكاشير (المبيعات)</div>
        <div style="font-family:'Courier New',monospace;font-size:1.1rem;line-height:1.7;direction:ltr;padding:0 8px">`;
        rows.forEach(r=>{
            const str=fmtNum(r.gross).padStart(10,' ');
            html+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:1px 4px">
                <span style="color:#64748b;font-size:.72rem;font-family:'Tajawal'">${r.date}</span>
                <span style="color:#166534;font-weight:700"> ${str}</span>
            </div>`;
        });
        html+=`<div style="border-top:2px solid #9a3412;margin:6px 4px 4px;padding-top:4px"></div>
        <div style="display:flex;justify-content:space-between;padding:4px;background:#fed7aa;border-radius:4px;font-weight:800">
            <span style="font-family:'Tajawal';color:#7c2d12">إجمالي المبيعات</span>
            <span style="color:#166534">${fmtNum(grandGross)}</span>
        </div></div>

        <!-- القسم 2: الخصومات -->
        <div style="font-weight:700;color:#9a3412;font-size:.9rem;margin:14px 0 6px;padding:6px 10px;background:#fed7aa;border-radius:6px"><i class="ri-arrow-down-line"></i> الخصومات الشهرية</div>
        <div style="font-family:'Courier New',monospace;font-size:1.05rem;line-height:1.7;direction:ltr;padding:0 8px;color:#991b1b">`;
        if(grandReturns)html+=`<div style="display:flex;justify-content:space-between"><span style="font-family:Tajawal">- المرتجعات</span><span>${fmtNum(grandReturns).padStart(10,' ')}</span></div>`;
        if(grandExpenses)html+=`<div style="display:flex;justify-content:space-between"><span style="font-family:Tajawal">- المصاريف (قسم)</span><span>${fmtNum(grandExpenses).padStart(10,' ')}</span></div>`;
        if(grandLunch)html+=`<div style="display:flex;justify-content:space-between"><span style="font-family:Tajawal">- الغداء</span><span>${fmtNum(grandLunch).padStart(10,' ')}</span></div>`;
        if(grandDebts)html+=`<div style="display:flex;justify-content:space-between"><span style="font-family:Tajawal">- الديون</span><span>${fmtNum(grandDebts).padStart(10,' ')}</span></div>`;
        if(grandWithdraws)html+=`<div style="display:flex;justify-content:space-between"><span style="font-family:Tajawal">- السحوبات</span><span>${fmtNum(grandWithdraws).padStart(10,' ')}</span></div>`;
        if(grandTotalDeductions===0)html+=`<div style="text-align:center;color:#9a3412;font-family:Tajawal;padding:8px">لا توجد خصومات</div>`;
        html+=`<div style="border-top:2px solid #991b1b;margin:6px 4px 4px;padding-top:4px"></div>
        <div style="display:flex;justify-content:space-between;padding:4px;background:#fecaca;border-radius:4px;font-weight:800">
            <span style="font-family:'Tajawal';color:#7f1d1d">إجمالي الخصومات</span>
            <span>${fmtNum(grandTotalDeductions)}</span>
        </div></div>

        <!-- القسم 3: الناتج النهائي -->
        <div style="margin-top:14px;padding:12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border-radius:10px;text-align:center">
            <div style="font-family:'Courier New',monospace;font-size:.95rem;opacity:.9;direction:ltr">
                ${fmtNum(grandGross)} − ${fmtNum(grandTotalDeductions)} =
            </div>
            <div style="font-size:1.8rem;font-weight:800;margin-top:4px">${grandTotal<0?'-':''}${fmtNum(Math.abs(grandTotal))} ${cur}</div>
            <div style="font-size:.78rem;opacity:.9;margin-top:2px">الناتج النهائي</div>
        </div>
        </div>`;
    } else {
        /* أفقي */
        html+=`<div class="card" style="padding:14px;overflow-x:auto">
        <table class="report-table" style="width:100%;font-size:.85rem">
            <thead><tr style="background:#f59e0b;color:#fff">
                <th>التاريخ</th><th>المدير</th>`;
        CASHIERS.forEach(cs=>html+=`<th>${cs.label}<br><span style="font-size:.7rem;opacity:.85;font-weight:400">(مبيعات)</span></th>`);
        html+=`<th>إجمالي المبيعات</th><th>خصومات</th><th style="background:#d97706">الناتج</th></tr></thead><tbody>`;
        const cashierTotals={};CASHIERS.forEach(cs=>cashierTotals[cs.key]=0);
        rows.forEach((r,i)=>{
            html+=`<tr style="background:${i%2===0?'var(--bg)':'var(--surface)'}">
                <td style="font-weight:700">${r.date}</td>
                <td style="font-size:.8rem">${r.manager||'-'}</td>`;
            CASHIERS.forEach(cs=>{
                const v=r.cashiers[cs.key].gross;
                cashierTotals[cs.key]+=v;
                html+=`<td style="color:${v>0?'#166534':'var(--text3)'}">${v?fmtNum(v):'—'}</td>`;
            });
            html+=`<td style="color:#166534;font-weight:700">${fmtNum(r.gross)}</td>`;
            html+=`<td style="color:#991b1b">${r.totalDeductions?fmtNum(r.totalDeductions):'—'}</td>`;
            const tclr=r.total<0?'color:var(--clr-expense)':'color:var(--clr-income)';
            html+=`<td style="${tclr};font-weight:800">${fmtNum(r.total)}</td></tr>`;
        });
        html+=`<tr style="background:#fed7aa;font-weight:800;border-top:3px double #9a3412">
            <td colspan="2" style="color:#7c2d12">الإجمالي الشهري</td>`;
        CASHIERS.forEach(cs=>{
            html+=`<td style="color:#166534">${fmtNum(cashierTotals[cs.key])}</td>`;
        });
        html+=`<td style="color:#166534;font-size:1.05rem">${fmtNum(grandGross)}</td>`;
        html+=`<td style="color:#991b1b">${fmtNum(grandTotalDeductions)}</td>`;
        const gclr=grandTotal<0?'color:var(--clr-expense)':'color:#166534';
        html+=`<td style="${gclr};font-size:1.05rem">${fmtNum(grandTotal)} ${cur}</td></tr>`;
        html+=`</tbody></table></div>`;

        /* تفصيل الخصومات */
        html+=`<div class="card" style="margin-top:12px;padding:14px">
        <h3 class="card-h"><i class="ri-pie-chart-2-line"></i> تفصيل الخصومات الشهرية</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;font-size:.85rem">
            ${grandReturns?`<div style="background:#fef3c7;padding:10px;border-radius:8px;text-align:center"><div style="color:#92400e;font-size:.78rem">المرتجعات</div><div style="font-weight:800;color:#b45309;font-size:1.1rem">${fmtNum(grandReturns)}</div></div>`:''}
            ${grandExpenses?`<div style="background:#fee2e2;padding:10px;border-radius:8px;text-align:center"><div style="color:#7f1d1d;font-size:.78rem">مصاريف (قسم)</div><div style="font-weight:800;color:#b91c1c;font-size:1.1rem">${fmtNum(grandExpenses)}</div></div>`:''}
            ${grandLunch?`<div style="background:#fed7aa;padding:10px;border-radius:8px;text-align:center"><div style="color:#7c2d12;font-size:.78rem">الغداء</div><div style="font-weight:800;color:#c2410c;font-size:1.1rem">${fmtNum(grandLunch)}</div></div>`:''}
            ${grandDebts?`<div style="background:#fecaca;padding:10px;border-radius:8px;text-align:center"><div style="color:#7f1d1d;font-size:.78rem">الديون</div><div style="font-weight:800;color:#dc2626;font-size:1.1rem">${fmtNum(grandDebts)}</div></div>`:''}
            ${grandWithdraws?`<div style="background:#fde68a;padding:10px;border-radius:8px;text-align:center"><div style="color:#78350f;font-size:.78rem">السحوبات</div><div style="font-weight:800;color:#d97706;font-size:1.1rem">${fmtNum(grandWithdraws)}</div></div>`:''}
        </div>
        </div>`;

        /* المعادلة النهائية */
        html+=`<div style="margin-top:12px;padding:14px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border-radius:10px;text-align:center">
            <div style="font-family:'Courier New',monospace;font-size:1rem;opacity:.9;direction:ltr;margin-bottom:4px">
                ${fmtNum(grandGross)} − ${fmtNum(grandTotalDeductions)} =
            </div>
            <div style="font-size:1.8rem;font-weight:800">${fmtNum(grandTotal)} ${cur}</div>
            <div style="font-size:.78rem;opacity:.85;margin-top:2px">الناتج النهائي (مبيعات خام − خصومات)</div>
        </div>`;
    }
    content.innerHTML=html;
}

function printClosingSheet(){
    if(!hasAction('print'))return toast('غير مصرح');
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const ym=$('#sheetMonth')?.value||today().slice(0,7);
    const closings=loadData(KEYS.closings)
        .filter(c=>c.date&&c.date.startsWith(ym))
        .sort((a,b)=>(a.date||'').localeCompare(b.date||''));
    const printDate=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});

    let html=`<div class="print-page-border">`;

    if(!closings.length){
        html+=`<div class="print-header"><h2>كشف حسابات التقفيلات</h2>`;
        if(store)html+=`<p>${store}</p>`;
        html+=`<p class="print-date">الشهر: ${ym} | تاريخ الطباعة: ${printDate}</p></div>`;
        html+=`<p style="text-align:center;padding:30px">لا توجد تقفيلات لهذا الشهر</p></div>`;
        showPrintDialog(html);
        return;
    }

    /* حساب البيانات لكلا التبويبين */
    const rows=closings.map(c=>{
        const cashierDetails={};
        let gross=0,returns=0,expenses=0,lunch=0,debts=0,withdraws=0;
        CASHIERS.forEach(cs=>{
            const d=c.cashiers[cs.key];
            if(d){
                const r=calcCashierNet(d);
                cashierDetails[cs.key]={net:r.net,gross:r.gross};
                gross+=r.gross; returns+=r.returns; expenses+=r.expenses;
                lunch+=r.lunch; debts+=r.debts; withdraws+=r.withdraws;
            } else {
                cashierDetails[cs.key]={net:0,gross:0};
            }
        });
        const totalDeductions=returns+expenses+lunch+debts+withdraws;
        return {date:c.date, manager:c.manager||'', total:calcClosingTotal(c),
                cashiers:cashierDetails, gross, returns, expenses, lunch, debts, withdraws, totalDeductions};
    });
    const grandTotal=rows.reduce((s,r)=>s+r.total,0);
    const grandGross=rows.reduce((s,r)=>s+r.gross,0);
    const grandReturns=rows.reduce((s,r)=>s+r.returns,0);
    const grandExpenses=rows.reduce((s,r)=>s+r.expenses,0);
    const grandLunch=rows.reduce((s,r)=>s+r.lunch,0);
    const grandDebts=rows.reduce((s,r)=>s+r.debts,0);
    const grandWithdraws=rows.reduce((s,r)=>s+r.withdraws,0);
    const grandTotalDeductions=grandReturns+grandExpenses+grandLunch+grandDebts+grandWithdraws;

    if(_sheetTab==='gross'){
        /* ========== طباعة رصيد الكاشير الخام ========== */
        html+=`<div class="print-header"><h2>كشف رصيد الكاشير الخام</h2>`;
        if(store)html+=`<p>${store}</p>`;
        html+=`<p class="print-date">الشهر: ${ym} | المبيعات قبل أي خصم | تاريخ الطباعة: ${printDate}</p></div>`;

        if(_sheetMode==='vertical'){
            html+=`<div class="print-section"><h3>رصيد الكاشير (المبيعات)</h3>`;
            html+=`<table><thead><tr><th>التاريخ</th><th>المدير</th><th>المبيعات الخام</th></tr></thead><tbody>`;
            rows.forEach(r=>{
                html+=`<tr><td>${r.date}</td><td>${r.manager||'-'}</td>
                    <td class="print-amount" style="color:#166534">${fmtNum(r.gross)} ${cur}</td></tr>`;
            });
            html+=`<tr style="font-weight:700;background:#fde68a"><td colspan="2">إجمالي المبيعات</td>
                <td class="print-amount" style="color:#166534">${fmtNum(grandGross)} ${cur}</td></tr>`;
            html+=`</tbody></table></div>`;

            /* الخصومات */
            html+=`<div class="print-section"><h3>الخصومات الشهرية</h3>`;
            html+=`<table><thead><tr><th>البند</th><th>المبلغ</th></tr></thead><tbody>`;
            if(grandReturns) html+=`<tr><td>المرتجعات</td><td style="color:#991b1b">${fmtNum(grandReturns)} ${cur}</td></tr>`;
            if(grandExpenses) html+=`<tr><td>المصاريف (قسم)</td><td style="color:#991b1b">${fmtNum(grandExpenses)} ${cur}</td></tr>`;
            if(grandLunch) html+=`<tr><td>الغداء</td><td style="color:#991b1b">${fmtNum(grandLunch)} ${cur}</td></tr>`;
            if(grandDebts) html+=`<tr><td>الديون</td><td style="color:#991b1b">${fmtNum(grandDebts)} ${cur}</td></tr>`;
            if(grandWithdraws) html+=`<tr><td>السحوبات</td><td style="color:#991b1b">${fmtNum(grandWithdraws)} ${cur}</td></tr>`;
            html+=`<tr style="font-weight:700;background:#fecaca"><td>إجمالي الخصومات</td>
                <td style="color:#991b1b">${fmtNum(grandTotalDeductions)} ${cur}</td></tr>`;
            html+=`</tbody></table></div>`;

            html+=`<div class="print-total">${fmtNum(grandGross)} − ${fmtNum(grandTotalDeductions)} = <strong>${fmtNum(grandTotal)} ${cur}</strong></div>`;
        } else {
            /* أفقي خام */
            html+=`<table><thead><tr><th>التاريخ</th><th>المدير</th>`;
            CASHIERS.forEach(cs=>html+=`<th>${cs.label} (مبيعات)</th>`);
            html+=`<th>إجمالي المبيعات</th><th>الخصومات</th><th>الناتج</th></tr></thead><tbody>`;
            const cashierTotals={};CASHIERS.forEach(cs=>cashierTotals[cs.key]=0);
            rows.forEach(r=>{
                html+=`<tr><td>${r.date}</td><td>${r.manager||'-'}</td>`;
                CASHIERS.forEach(cs=>{
                    const v=r.cashiers[cs.key].gross;
                    cashierTotals[cs.key]+=v;
                    html+=`<td style="color:${v>0?'#166534':'inherit'}">${v?fmtNum(v):'-'}</td>`;
                });
                html+=`<td style="color:#166534;font-weight:700">${fmtNum(r.gross)}</td>`;
                html+=`<td style="color:#991b1b">${r.totalDeductions?fmtNum(r.totalDeductions):'-'}</td>`;
                html+=`<td class="print-amount" style="color:${r.total<0?'#dc2626':'#16a34a'}">${fmtNum(r.total)} ${cur}</td></tr>`;
            });
            html+=`<tr style="font-weight:700;background:#fde68a"><td colspan="2">الإجمالي</td>`;
            CASHIERS.forEach(cs=>html+=`<td style="color:#166534">${fmtNum(cashierTotals[cs.key])}</td>`);
            html+=`<td style="color:#166534">${fmtNum(grandGross)}</td>`;
            html+=`<td style="color:#991b1b">${fmtNum(grandTotalDeductions)}</td>`;
            html+=`<td class="print-amount" style="color:${grandTotal<0?'#dc2626':'#16a34a'}">${fmtNum(grandTotal)} ${cur}</td></tr>`;
            html+=`</tbody></table>`;

            /* تفصيل الخصومات */
            html+=`<div class="print-section" style="margin-top:8px"><h3>تفصيل الخصومات</h3>`;
            html+=`<table><thead><tr><th>البند</th><th>المبلغ</th></tr></thead><tbody>`;
            if(grandReturns) html+=`<tr><td>المرتجعات</td><td style="color:#991b1b">${fmtNum(grandReturns)} ${cur}</td></tr>`;
            if(grandExpenses) html+=`<tr><td>المصاريف (قسم)</td><td style="color:#991b1b">${fmtNum(grandExpenses)} ${cur}</td></tr>`;
            if(grandLunch) html+=`<tr><td>الغداء</td><td style="color:#991b1b">${fmtNum(grandLunch)} ${cur}</td></tr>`;
            if(grandDebts) html+=`<tr><td>الديون</td><td style="color:#991b1b">${fmtNum(grandDebts)} ${cur}</td></tr>`;
            if(grandWithdraws) html+=`<tr><td>السحوبات</td><td style="color:#991b1b">${fmtNum(grandWithdraws)} ${cur}</td></tr>`;
            html+=`<tr style="font-weight:700;background:#fecaca"><td>إجمالي الخصومات</td>
                <td style="color:#991b1b">${fmtNum(grandTotalDeductions)} ${cur}</td></tr>`;
            html+=`</tbody></table></div>`;

            html+=`<div class="print-total">${fmtNum(grandGross)} − ${fmtNum(grandTotalDeductions)} = <strong>${fmtNum(grandTotal)} ${cur}</strong></div>`;
        }
    } else {
        /* ========== طباعة صافي التقفيلات (الافتراضي) ========== */
        html+=`<div class="print-header"><h2>كشف صافي التقفيلات</h2>`;
        if(store)html+=`<p>${store}</p>`;
        html+=`<p class="print-date">الشهر: ${ym} | تاريخ الطباعة: ${printDate}</p></div>`;

        const cashierTotals={};
        CASHIERS.forEach(cs=>cashierTotals[cs.key]=0);

        if(_sheetMode==='vertical'){
            html+=`<table><thead><tr><th>التاريخ</th><th>الصافي</th></tr></thead><tbody>`;
            rows.forEach(r=>{
                html+=`<tr><td>${r.date}</td>
                    <td class="print-amount" style="color:${r.total<0?'#dc2626':'#16a34a'}">${fmtNum(r.total)} ${cur}</td></tr>`;
            });
            html+=`<tr style="font-weight:700;background:#fde68a"><td>الإجمالي</td>
                <td class="print-amount" style="color:${grandTotal<0?'#dc2626':'#16a34a'}">${fmtNum(grandTotal)} ${cur}</td></tr>`;
            html+=`</tbody></table>`;
        } else {
            html+=`<table><thead><tr><th>التاريخ</th><th>المدير</th>`;
            CASHIERS.forEach(cs=>html+=`<th>${cs.label}</th>`);
            html+=`<th>الإجمالي</th></tr></thead><tbody>`;
            rows.forEach(r=>{
                html+=`<tr><td>${r.date}</td><td>${r.manager||'-'}</td>`;
                CASHIERS.forEach(cs=>{
                    const v=r.cashiers[cs.key].net;
                    cashierTotals[cs.key]+=v;
                    html+=`<td style="color:${v<0?'#991b1b':'inherit'}">${v!==0?fmtNum(v):'-'}</td>`;
                });
                html+=`<td class="print-amount" style="color:${r.total<0?'#dc2626':'#16a34a'};font-weight:700">${fmtNum(r.total)} ${cur}</td></tr>`;
            });
            html+=`<tr style="font-weight:700;background:#fde68a"><td colspan="2">الإجمالي الشهري</td>`;
            CASHIERS.forEach(cs=>{
                const t=cashierTotals[cs.key];
                html+=`<td style="color:${t<0?'#991b1b':'#166534'}">${fmtNum(t)}</td>`;
            });
            html+=`<td class="print-amount" style="color:${grandTotal<0?'#dc2626':'#16a34a'}">${fmtNum(grandTotal)} ${cur}</td></tr>`;
            html+=`</tbody></table>`;
        }
    }

    html+=`</div>`;
    showPrintDialog(html);
}

/* ========= SETTINGS ========= */
function renderSettings(){
    const s=loadSettings();
    $('#setStoreName').value=s.storeName||'';
    $('#setCurrency').value=s.currency||'د.ع';
    const themeToggle=$('#themeToggle');
    if(themeToggle)themeToggle.checked=(s.theme==='dark');
    /* firebase status */
    const fbStatus=$('#firebaseStatus');
    if(fbStatus){
        if(fbDb){
            fbDb.ref('.info/connected').once('value',snap=>{
                if(snap.val()===true){
                    fbStatus.innerHTML='<i class="ri-checkbox-circle-fill" style="color:var(--success);font-size:1rem"></i> <span style="color:var(--success)">متصل بـ Firebase - المزامنة اللحظية مفعّلة</span>';
                } else {
                    fbStatus.innerHTML='<i class="ri-error-warning-fill" style="color:var(--warning);font-size:1rem"></i> <span style="color:var(--warning)">غير متصل بـ Firebase حالياً</span>';
                }
            });
        } else {
            fbStatus.innerHTML='<i class="ri-close-circle-fill" style="color:var(--danger);font-size:1rem"></i> <span style="color:var(--danger)">Firebase غير متاح</span>';
        }
    }
}
function toggleTheme(){
    const s=loadSettings();
    s.theme=s.theme==='dark'?'light':'dark';
    saveSettings(s);
    applyTheme(s.theme);
}
function applyTheme(theme){
    document.documentElement.setAttribute('data-theme',theme||'light');
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.content=theme==='dark'?'#4f46e5':'#6366f1';
}
function saveSettingsForm(){
    const s=loadSettings();
    s.storeName=$('#setStoreName').value.trim();
    s.currency=$('#setCurrency').value;
    saveSettings(s);
    toast('تم حفظ الإعدادات');
}
function exportData(){
    const data={};
    Object.entries(KEYS).forEach(([k,v])=>{data[k]=JSON.parse(localStorage.getItem(v)||'[]');});
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cashier_backup_'+today()+'.json';a.click();
    toast('تم التصدير');
}
function importData(file){
    const reader=new FileReader();
    reader.onload=e=>{
        try{
            const data=JSON.parse(e.target.result);
            let totalAdded=0;
            let totalSkipped=0;

            Object.entries(KEYS).forEach(([k,v])=>{
                if(!data[k]||!Array.isArray(data[k])) return;
                const incoming=data[k];

                // For settings (object), merge keys
                if(k==='settings'){
                    const existing=loadSettings();
                    const merged=Object.assign({},incoming,existing); // existing takes priority
                    saveSettings(merged);
                    return;
                }

                // For array data: merge by id, keep existing + add new
                const existing=loadData(v)||[];
                const existingIds=new Set(existing.map(r=>r.id).filter(Boolean));
                const toAdd=incoming.filter(r=>{
                    // give id if missing
                    if(!r.id) r.id=uid();
                    return !existingIds.has(r.id);
                });
                totalAdded+=toAdd.length;
                totalSkipped+=(incoming.length-toAdd.length);
                if(toAdd.length>0){
                    const merged=[...existing,...toAdd];
                    localStorage.setItem(v,JSON.stringify(merged));
                }
            });

            const msg='✅ تم الاستيراد: '+totalAdded+' سجل جديد'+(totalSkipped>0?' ('+totalSkipped+' موجود مسبقاً)':'');
            toast(msg);
            navigate('home');
        }catch(err){
            console.error('importData error:',err);
            toast('ملف غير صالح: '+err.message);
        }
    };
    reader.readAsText(file);
}
function copyCashierLink(){
    const url=new URL('./cashier/index.html',location.href).href;
    navigator.clipboard.writeText(url).then(()=>toast('تم نسخ الرابط')).catch(()=>{
        /* fallback */
        const ta=document.createElement('textarea');ta.value=url;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();
        toast('تم نسخ الرابط');
    });
}
function loadDemo(){
    if(!confirm('سيتم تحميل بيانات تجريبية. متابعة؟'))return;
    const d=today();
    const emp1={id:uid(),name:'أحمد محمد',role:'كاشير رجال',salary:3000,salaryType:'fixed',commRate:0};
    const emp2={id:uid(),name:'فاطمة علي',role:'كاشير نساء',salary:2800,salaryType:'commission',commRate:1.5};
    const emp3={id:uid(),name:'سارة حسين',role:'كاشير تجميل',salary:2500,salaryType:'commission',commRate:2};
    saveData(KEYS.employees,[emp1,emp2,emp3]);

    const closing={id:uid(),date:d,manager:'خالد المدير',cashiers:{
        men:{sales:5000,network:3000,returns:200,expenses:150,lunch:50,debts:300,withdrawals:100,debtsList:[{person:'سعد خالد',amount:300,note:'بضاعة'}],withdrawList:[{person:'أحمد محمد',amount:100,note:'سلفة'}],net:3000},
        women:{sales:4000,network:2500,returns:100,expenses:100,lunch:40,debts:200,withdrawals:50,debtsList:[{person:'نور علي',amount:200,note:''}],withdrawList:[],net:2500},
        cosmetics:{sales:3000,network:2000,returns:50,expenses:80,lunch:30,debts:150,withdrawals:0,debtsList:[{person:'سعد خالد',amount:150,note:''}],withdrawList:[],net:2000}
    },totalNet:7500};
    saveData(KEYS.closings,[closing]);
    saveData(KEYS.safe,[
        {id:uid(),date:d,type:'deposit',amount:7500,note:'تقفيلة '+d+' - المدير: خالد المدير'},
        {id:uid(),date:d,type:'deposit',amount:10000,note:'رأس مال: رأس مال أولي'}
    ]);
    saveData(KEYS.debts,[
        {id:uid(),person:'سعد خالد',amount:300,note:'بضاعة',type:'debt',cashier:'كاشير الرجال',date:d},
        {id:uid(),person:'نور علي',amount:200,note:'',type:'debt',cashier:'كاشير النساء',date:d},
        {id:uid(),person:'سعد خالد',amount:150,note:'',type:'debt',cashier:'كاشير التجميل',date:d},
        {id:uid(),person:'أحمد محمد',amount:100,note:'سحب: سلفة',type:'withdraw',cashier:'كاشير الرجال',date:d}
    ]);
    saveData(KEYS.withdrawals,[{id:uid(),person:'أحمد محمد',amount:100,note:'سلفة',cashier:'كاشير الرجال',date:d}]);
    saveData(KEYS.purchases,[{id:uid(),date:d,desc:'بضاعة متنوعة',amount:5000}]);
    const settings=loadSettings();
    settings.managers=settings.managers||[];
    if(!settings.managers.includes('خالد المدير'))settings.managers.push('خالد المدير');
    saveSettings(settings);
    toast('تم تحميل البيانات التجريبية');
    navigate('home');
}
function clearAll(){
    if(!confirm('سيتم مسح جميع البيانات. هل أنت متأكد؟'))return;
    if(!confirm('تأكيد نهائي - لا يمكن التراجع!'))return;
    Object.values(KEYS).forEach(k=>localStorage.removeItem(k));
    toast('تم مسح جميع البيانات');
    navigate('home');
}

/* ========= GLOBAL SEARCH ========= */
function globalSearch(){
    const q=($('#globalSearch').value||'').trim().toLowerCase();
    const results=$('#globalSearchResults');
    const grid=$('#homeGrid');
    if(!q){results.style.display='none';grid.style.display='';return;}
    const s=loadSettings();const cur=s.currency||'د.ع';
    let html='';
    /* closings */
    loadData(KEYS.closings).forEach(c=>{
        if((c.date||'').includes(q)||(c.manager||'').toLowerCase().includes(q)||String(c.totalNet).includes(q)){
            html+=`<div class="record-card" onclick="navigate('closing')"><div class="rec-info"><div class="rec-title"><i class="ri-calculator-line" style="color:var(--primary)"></i> تقفيلة - ${c.date}</div><div class="rec-sub">${c.manager||''} | صافي: ${fmtNum(c.totalNet)} ${cur}</div></div></div>`;
        }
    });
    /* debts */
    loadData(KEYS.debts).forEach(d=>{
        if(d.person.toLowerCase().includes(q)||(d.note||'').toLowerCase().includes(q)||d.date.includes(q)){
            html+=`<div class="record-card" onclick="navigate('debts')"><div class="rec-info"><div class="rec-title"><i class="ri-file-list-3-line" style="color:var(--clr-debt)"></i> دين - ${d.person}</div><div class="rec-sub">${d.date} | ${fmtNum(d.amount)} ${cur}</div></div></div>`;
        }
    });
    /* safe */
    loadData(KEYS.safe).forEach(t=>{
        if((t.note||'').toLowerCase().includes(q)||t.date.includes(q)||String(t.amount).includes(q)){
            html+=`<div class="record-card" onclick="navigate('safe')"><div class="rec-info"><div class="rec-title"><i class="ri-safe-2-line" style="color:var(--clr-income)"></i> خزنة - ${t.note||''}</div><div class="rec-sub">${t.date} | ${fmtNum(t.amount)} ${cur}</div></div></div>`;
        }
    });
    /* employees */
    loadData(KEYS.employees).forEach(e=>{
        if(e.name.toLowerCase().includes(q)||(e.role||'').toLowerCase().includes(q)){
            html+=`<div class="record-card" onclick="navigate('salaries')"><div class="rec-info"><div class="rec-title"><i class="ri-user-line" style="color:var(--primary)"></i> موظف - ${e.name}</div><div class="rec-sub">${e.role||''} | راتب: ${fmtNum(e.salary||0)} ${cur}</div></div></div>`;
        }
    });
    /* purchases */
    loadData(KEYS.purchases).forEach(p=>{
        if((p.desc||'').toLowerCase().includes(q)||p.date.includes(q)||String(p.amount).includes(q)){
            html+=`<div class="record-card" onclick="navigate('purchases')"><div class="rec-info"><div class="rec-title"><i class="ri-shopping-cart-2-line" style="color:var(--clr-expense)"></i> شراء - ${p.desc||''}</div><div class="rec-sub">${p.date} | ${fmtNum(p.amount)} ${cur}</div></div></div>`;
        }
    });
    if(!html)html='<div class="empty-state"><i class="ri-search-line"></i><p>لا توجد نتائج</p></div>';
    results.innerHTML=html;
    results.style.display='';
    grid.style.display='none';
}

/* ========= PRINT DEBTS ========= */
function printDebts(){
    if(!hasAction('print'))return toast('غير مصرح');
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const debts=loadData(KEYS.debts);
    const printDate=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
    let html=`<div class="print-page-border">`;
    html+=`<div class="print-header"><h2>سجل الديون</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">تاريخ الطباعة: ${printDate}</p></div>`;
    html+=`<table><thead><tr><th>الشخص</th><th>المبلغ</th><th>ملاحظة</th><th>التاريخ</th></tr></thead><tbody>`;
    let total=0;
    debts.forEach(d=>{
        total+=d.amount;
        html+=`<tr><td>${d.person}</td><td>${fmtNum(d.amount)} ${cur}</td><td>${d.note||d.cashier||''}</td><td>${d.date}</td></tr>`;
    });
    html+=`</tbody></table>`;
    html+=`<div class="print-total">الإجمالي: ${fmtNum(total)} ${cur}</div>`;
    html+=`</div>`;
    showPrintDialog(html);
}

/* ========= PRINT EXPENSES ========= */
function printExpenses(){
    if(!hasAction('print'))return toast('غير مصرح');
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const ym=$('#expFilterMonth')?.value||'';
    let closings=loadData(KEYS.closings);
    if(ym)closings=closings.filter(c=>c.date&&c.date.startsWith(ym));
    let expenses=[];
    closings.forEach(c=>{
        CASHIERS.forEach(cs=>{
            const d=c.cashiers[cs.key];if(!d)return;
            if(d.expenses)expenses.push({date:c.date,cashier:cs.label,type:'مصاريف',amount:d.expenses,note:''});
            if(d.lunch)expenses.push({date:c.date,cashier:cs.label,type:'غداء',amount:d.lunch,note:''});
        });
    });
    /* add individual expense entries */
    let expEntries=loadData(KEYS.expenseEntries);
    if(ym)expEntries=expEntries.filter(e=>e.date&&e.date.startsWith(ym));
    expEntries.forEach(e=>expenses.push({date:e.date,cashier:e.cashier||'',type:e.desc||'مصروف',amount:e.amount,note:e.note||''}));
    const printDate=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
    let html=`<div class="print-page-border">`;
    html+=`<div class="print-header"><h2>سجل المصاريف${ym?' - '+ym:''}</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">تاريخ الطباعة: ${printDate}</p></div>`;
    html+=`<table><thead><tr><th>التاريخ</th><th>الكاشير</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>`;
    let total=0;
    expenses.forEach(e=>{total+=e.amount;html+=`<tr><td>${e.date}</td><td>${e.cashier}</td><td>${e.type}</td><td>${fmtNum(e.amount)} ${cur}</td><td>${e.note||''}</td></tr>`;});
    html+=`</tbody></table>`;
    html+=`<div class="print-total">الإجمالي: ${fmtNum(total)} ${cur}</div>`;
    html+=`</div>`;
    showPrintDialog(html);
}

/* ========= PRINT PURCHASES ========= */
function printPurchases(){
    if(!hasAction('print'))return toast('غير مصرح');
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const purchases=loadData(KEYS.purchases).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    const printDate=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
    let html=`<div class="print-page-border">`;
    html+=`<div class="print-header"><h2>سجل المشتريات</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">تاريخ الطباعة: ${printDate}</p></div>`;
    html+=`<table><thead><tr><th>التاريخ</th><th>الوصف</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>`;
    let total=0;
    purchases.forEach(p=>{total+=p.amount;html+=`<tr><td>${p.date}</td><td>${p.desc||''}</td><td>${fmtNum(p.amount)} ${cur}</td><td>${p.note||''}</td></tr>`;});
    html+=`</tbody></table>`;
    html+=`<div class="print-total">الإجمالي: ${fmtNum(total)} ${cur}</div>`;
    html+=`</div>`;
    showPrintDialog(html);
}

/* ========= PRINT CAPITAL ========= */
function printCapital(){
    if(!hasAction('print'))return toast('غير مصرح');
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const trans=loadData(KEYS.safe).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    const printDate=new Date().toLocaleDateString('ar-IQ',{year:'numeric',month:'long',day:'numeric'});
    let html=`<div class="print-page-border">`;
    html+=`<div class="print-header"><h2>سجل رأس المال</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">تاريخ الطباعة: ${printDate}</p></div>`;
    html+=`<div class="print-summary-box"><span>الرصيد الحالي: ${fmtNum(getSafeBalance())} ${cur}</span></div>`;
    html+=`<table><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>`;
    trans.forEach(t=>{
        const type=t.type==='deposit'?'إيداع':'سحب';
        const clr=t.type==='deposit'?'color:#16a34a':'color:#dc2626';
        html+=`<tr><td>${t.date}</td><td>${type}</td><td style="${clr};font-weight:700">${fmtNum(t.amount)} ${cur}</td><td>${t.note||''}</td></tr>`;
    });
    html+=`</tbody></table>`;
    html+=`</div>`;
    showPrintDialog(html);
}

/* ========= SECURITY PAGE ========= */
const ALL_PAGE_PERMS=[
    {key:'closing',label:'التقفيلة'},{key:'individual',label:'التقفيلات المنفصلة'},{key:'safe',label:'الخزنة'},{key:'debts',label:'الديون'},
    {key:'expenses',label:'المصاريف'},{key:'generalExpenses',label:'المصاريف العامة'},{key:'closingSheet',label:'كشف الحسابات'},
    {key:'salaries',label:'الرواتب'},{key:'payroll',label:'صرف الرواتب'},
    {key:'capital',label:'رأس المال'},{key:'purchases',label:'المشتريات'},{key:'report',label:'التقرير'},
    {key:'settings',label:'الإعدادات'}
];
const ACTION_PERMS=[
    {key:'edit',label:'تعديل السجلات',icon:'ri-edit-line'},
    {key:'delete',label:'حذف السجلات',icon:'ri-delete-bin-line'},
    {key:'print',label:'طباعة',icon:'ri-printer-line'},
    {key:'addDebt',label:'إضافة ديون',icon:'ri-file-list-3-line'},
    {key:'addWithdraw',label:'إضافة سحب',icon:'ri-hand-coin-line'},
    {key:'addExpense',label:'إضافة مصاريف',icon:'ri-money-dollar-box-line'},
    {key:'addGeneralExpense',label:'إضافة مصاريف عامة/إدارة',icon:'ri-building-line'},
    {key:'export',label:'تصدير البيانات',icon:'ri-download-2-line'},
    {key:'import',label:'استيراد البيانات',icon:'ri-upload-2-line'}
];
function renderSecurity(){
    if(!isAdmin()){toast('غير مصرح');navigate('home');return;}
    const users=loadUsers();
    const list=$('#securityUsersList');
    if(!users.length){list.innerHTML='<div class="empty-state"><p>لا يوجد مستخدمين</p></div>';return;}
    list.innerHTML=users.map(u=>{
        const badge=u.role==='admin'?'<span class="admin-badge">مسؤول</span>':'<span class="user-badge">مستخدم</span>';
        const perms=(u.permissions||[]).length;
        const cashierLabel=u.cashierType?{men:'كاشير الرجال',women:'كاشير النساء',cosmetics:'كاشير التجميل'}[u.cashierType]||'':'';
        const cashierBadge=cashierLabel?`<span style="font-size:.7rem;background:var(--primary);color:#fff;padding:1px 6px;border-radius:8px;margin-right:4px">${cashierLabel}</span>`:'';
        return `<div class="record-card">
            <div class="rec-info"><div class="rec-title">${u.username} ${badge} ${cashierBadge}</div><div class="rec-sub">${perms} صلاحيات</div></div>
            <div class="rec-actions">
                <button onclick="editUser('${u.id}')" title="تعديل"><i class="ri-edit-line"></i></button>
                ${u.role!=='admin'?`<button onclick="deleteUser('${u.id}')" title="حذف"><i class="ri-delete-bin-line"></i></button>`:''}
            </div>
        </div>`;
    }).join('');
}
function addUser(){
    if(!isAdmin())return;
    let pagePermsHtml='<p style="font-weight:700;margin:8px 0 4px;color:var(--primary)"><i class="ri-pages-line"></i> صلاحيات الصفحات</p>';
    pagePermsHtml+=ALL_PAGE_PERMS.map(p=>`<label style="display:flex;align-items:center;gap:6px;margin:4px 0"><input type="checkbox" class="newUserPerm" value="${p.key}" checked> ${p.label}</label>`).join('');
    let actionPermsHtml='<p style="font-weight:700;margin:12px 0 4px;color:var(--danger)"><i class="ri-shield-check-line"></i> صلاحيات العمليات</p>';
    actionPermsHtml+=ACTION_PERMS.map(p=>`<label style="display:flex;align-items:center;gap:6px;margin:4px 0"><input type="checkbox" class="newUserPerm" value="${p.key}"> <i class="${p.icon}" style="font-size:.9rem"></i> ${p.label}</label>`).join('');
    const cashierTypeHtml=`<div class="field"><label>نوع الكاشير (للتطبيق الفرعي)</label>
        <select id="newUserCashierType" class="input-field">
            <option value="">-- بدون (ليس كاشير) --</option>
            <option value="men">كاشير الرجال</option>
            <option value="women">كاشير النساء</option>
            <option value="cosmetics">كاشير التجميل</option>
        </select></div>`;
    openModal('إضافة مستخدم',`
    <div class="field"><label>اسم المستخدم</label><input type="text" id="newUserName" class="input-field" autocomplete="off"></div>
    <div class="field"><label>كلمة المرور</label><input type="password" id="newUserPass" class="input-field" autocomplete="new-password"></div>
    <div class="field"><label>تأكيد كلمة المرور</label><input type="password" id="newUserPassConfirm" class="input-field" autocomplete="new-password"></div>
    ${cashierTypeHtml}
    <div class="field"><label>الصلاحيات</label><div style="max-height:250px;overflow-y:auto;padding:4px">${pagePermsHtml}${actionPermsHtml}</div></div>`,
    `<button class="btn btn-success" onclick="confirmAddUser()">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
async function confirmAddUser(){
    const username=$('#newUserName').value.trim();
    const password=$('#newUserPass').value;
    const confirm=$('#newUserPassConfirm').value;
    if(!username||!password)return toast('أدخل البيانات');
    if(password!==confirm)return toast('كلمة المرور غير متطابقة');
    if(password.length<4)return toast('كلمة المرور قصيرة');
    const users=loadUsers();
    if(users.find(u=>u.username===username))return toast('اسم المستخدم موجود');
    const perms=[...document.querySelectorAll('.newUserPerm:checked')].map(cb=>cb.value);
    const cashierType=$('#newUserCashierType')?.value||'';
    const hash=await hashPwd(password);
    users.push({id:uid(),username,passwordHash:hash,role:'user',permissions:perms,cashierType:cashierType});
    saveUsers(users);closeModal();toast('تم إضافة المستخدم');renderSecurity();
    syncCashierAccounts();
}
function editUser(id){
    if(!isAdmin())return;
    const users=loadUsers();const user=users.find(u=>u.id===id);if(!user)return;
    const perms=user.permissions||[];
    let pagePermsHtml='<p style="font-weight:700;margin:8px 0 4px;color:var(--primary)"><i class="ri-pages-line"></i> صلاحيات الصفحات</p>';
    pagePermsHtml+=ALL_PAGE_PERMS.map(p=>`<label style="display:flex;align-items:center;gap:6px;margin:4px 0"><input type="checkbox" class="editUserPerm" value="${p.key}" ${perms.includes(p.key)?'checked':''}> ${p.label}</label>`).join('');
    let actionPermsHtml='<p style="font-weight:700;margin:12px 0 4px;color:var(--danger)"><i class="ri-shield-check-line"></i> صلاحيات العمليات</p>';
    actionPermsHtml+=ACTION_PERMS.map(p=>`<label style="display:flex;align-items:center;gap:6px;margin:4px 0"><input type="checkbox" class="editUserPerm" value="${p.key}" ${perms.includes(p.key)?'checked':''}> <i class="${p.icon}" style="font-size:.9rem"></i> ${p.label}</label>`).join('');
    const userCashierType=user.cashierType||'';
    const cashierTypeEditHtml=`<div class="field"><label>نوع الكاشير (للتطبيق الفرعي)</label>
        <select id="editUserCashierType" class="input-field">
            <option value="" ${!userCashierType?'selected':''}>-- بدون (ليس كاشير) --</option>
            <option value="men" ${userCashierType==='men'?'selected':''}>كاشير الرجال</option>
            <option value="women" ${userCashierType==='women'?'selected':''}>كاشير النساء</option>
            <option value="cosmetics" ${userCashierType==='cosmetics'?'selected':''}>كاشير التجميل</option>
        </select></div>`;
    openModal('تعديل المستخدم: '+user.username,`
    <div class="field"><label>اسم المستخدم</label><input type="text" id="editUserName" class="input-field" value="${user.username}" ${user.role==='admin'?'disabled':''}></div>
    <div class="field"><label>كلمة المرور الجديدة (اتركها فارغة للإبقاء)</label><input type="password" id="editUserPass" class="input-field" autocomplete="new-password"></div>
    ${user.role!=='admin'?`<div class="field"><label>الصلاحيات</label><div style="max-height:250px;overflow-y:auto;padding:4px">${pagePermsHtml}${actionPermsHtml}</div></div>`:'<p style="color:var(--text2);font-size:.85rem;margin:10px 0">المسؤول يملك جميع الصلاحيات</p>'}
    ${cashierTypeEditHtml}`,
    `<button class="btn btn-success" onclick="confirmEditUser('${id}')">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
async function confirmEditUser(id){
    const users=loadUsers();const idx=users.findIndex(u=>u.id===id);if(idx<0)return;
    const username=$('#editUserName').value.trim();
    const password=$('#editUserPass').value;
    if(username&&users[idx].role!=='admin')users[idx].username=username;
    if(password){
        if(password.length<4)return toast('كلمة المرور قصيرة');
        users[idx].passwordHash=await hashPwd(password);
    }
    if(users[idx].role!=='admin'){
        users[idx].permissions=[...document.querySelectorAll('.editUserPerm:checked')].map(cb=>cb.value);
    }
    users[idx].cashierType=$('#editUserCashierType')?.value||'';
    saveUsers(users);
    const session=getSession();
    if(session&&session.id===id)setSession({id:users[idx].id,username:users[idx].username,role:users[idx].role,permissions:users[idx].permissions});
    closeModal();toast('تم التحديث');renderSecurity();
    syncCashierAccounts();
}
function deleteUser(id){
    if(!isAdmin())return;
    if(!confirm('حذف المستخدم؟'))return;
    let users=loadUsers();users=users.filter(u=>u.id!==id);saveUsers(users);
    toast('تم الحذف');renderSecurity();
    syncCashierAccounts();
}

/* ========= SYNC CASHIER ACCOUNTS TO FIREBASE ========= */
function syncCashierAccounts(){
    if(!fbDb) return;
    const users=loadUsers();
    const accounts={};
    users.forEach(u=>{
        if(u.cashierType){
            accounts[u.id]={
                username:u.username,
                passwordHash:u.passwordHash,
                cashierType:u.cashierType
            };
        }
    });
    fbDb.ref('cashier_accounts').set(accounts).then(()=>{
        console.log('Cashier accounts synced to Firebase');
    }).catch(e=>console.warn('Failed to sync cashier accounts:',e));
}

/* ========= PAGE EXPORT / IMPORT ========= */
function exportPage(dataKey, filename, label){
    if(!hasAction('export'))return toast('غير مصرح - لا تملك صلاحية التصدير');
    const keyMap={individualClosings:KEYS.individualClosings,closings:KEYS.closings,debts:KEYS.debts,expenseEntries:KEYS.expenseEntries,employees:KEYS.employees,payroll:KEYS.payroll,safe:KEYS.safe,purchases:KEYS.purchases};
    const key=keyMap[dataKey];
    if(!key) return toast('خطأ في التصدير');
    const data=loadData(key);
    if(!data.length) return toast('لا توجد بيانات');
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename+'_'+today()+'.json';a.click();
    toast('تم تصدير '+label);
}
function importPage(dataKey, label, renderFn){
    if(!hasAction('import'))return toast('غير مصرح - لا تملك صلاحية الاستيراد');
    const keyMap={individualClosings:KEYS.individualClosings,closings:KEYS.closings,debts:KEYS.debts,expenseEntries:KEYS.expenseEntries,employees:KEYS.employees,payroll:KEYS.payroll,safe:KEYS.safe,purchases:KEYS.purchases};
    const key=keyMap[dataKey];
    if(!key) return toast('خطأ في الاستيراد');
    const input=document.createElement('input');
    input.type='file';input.accept='.json';
    input.onchange=e=>{
        const file=e.target.files[0];if(!file) return;
        const reader=new FileReader();
        reader.onload=ev=>{
            try{
                const incoming=JSON.parse(ev.target.result);
                if(!Array.isArray(incoming)) return toast('ملف غير صالح');
                const existing=loadData(key);
                const existingIds=new Set(existing.map(r=>r.id).filter(Boolean));
                let added=0;
                incoming.forEach(r=>{
                    if(!r.id) r.id=uid();
                    if(!existingIds.has(r.id)){existing.push(r);added++;}
                });
                saveData(key,existing);
                toast('تم استيراد '+added+' سجل إلى '+label);
                if(renderFn) renderFn();
            }catch(err){toast('ملف غير صالح');}
        };
        reader.readAsText(file);
    };
    input.click();
}

/* ========= PRINT HELPER ========= */
let _pendingPrintHtml='';
function getPrintDateString(){
    const days=['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    const now=new Date();
    const d=now.getDate();
    const m=now.getMonth()+1;
    const y=now.getFullYear();
    return days[now.getDay()]+' '+d+'/'+m+'/'+y;
}
function wrapPrintHtml(html,noHeader){
    const dateStr=getPrintDateString();
    const header=noHeader?'':`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0;padding:4px 0 6px;border-bottom:2.5px solid #333">
        <div style="font-size:11pt;font-weight:900;color:#111;text-align:right">قسم الملابس<br>لافيش سنتر</div>
        <div style="font-size:10pt;font-weight:800;color:#111;text-align:left;direction:ltr">${dateStr}</div>
    </div>`;
    const footer=`<div style="margin-top:20px;padding-top:10px;border-top:1.5px solid #999">
        <div style="text-align:center">
            <div style="border-top:1.5px solid #333;width:160px;margin:40px auto 0;padding-top:4px;font-size:9pt;font-weight:700;color:#333">توقيع المدير</div>
        </div>
    </div>`;
    return `<div style="width:100%;margin:0;padding:0">${header}${html}${footer}</div>`;
}
function doPrint(html,landscape,noHeader){
    const area=$('#printArea');
    area.innerHTML=wrapPrintHtml(html,noHeader);
    let styleEl=document.getElementById('printOrientStyle');
    if(!styleEl){styleEl=document.createElement('style');styleEl.id='printOrientStyle';document.head.appendChild(styleEl);}
    if(landscape){
        styleEl.textContent=`@media print{
            @page{size:A4 landscape;margin:2mm 0}
            #printArea{width:100%!important;max-width:100%!important}
            #printArea table{width:100%!important;table-layout:auto!important;font-size:15pt!important}
            #printArea th,#printArea td{font-size:15pt!important;padding:7px 10px!important}
            #printArea .print-amount{font-size:16pt!important}
            #printArea .print-total{font-size:17pt!important}
        }`;
    } else {
        styleEl.textContent='@media print{@page{size:A4;margin:2mm 0}}';
    }
    setTimeout(()=>{
        window.print();
        setTimeout(()=>{area.innerHTML='';},500);
    },200);
}
function showPrintDialog(html,noHeader){
    _pendingPrintHtml=html;
    _pendingPrintNoHeader=!!noHeader;
    showCustomDialog({
        icon:'ri-printer-line',
        iconClass:'',
        title:'خيارات الطباعة',
        msg:'اختر اتجاه الورقة',
        buttons:[
            {label:'<i class="ri-layout-top-line"></i> عمودي',cls:'btn-primary',action:'hideDialog();doPrint(_pendingPrintHtml,false,_pendingPrintNoHeader)'},
            {label:'<i class="ri-layout-left-line"></i> أفقي',cls:'btn-warning',action:'hideDialog();doPrint(_pendingPrintHtml,true,_pendingPrintNoHeader)'},
            {label:'إلغاء',cls:'btn-ghost',action:'hideDialog()'}
        ]
    });
}

/* ========= SALARY ADVANCES (سحوبات الرواتب) ========= */
function renderSalaryAdvances(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const monthInput=$('#advancesMonth');
    if(!monthInput.value) monthInput.value=today().slice(0,7);
    const ym=monthInput.value;
    const searchVal=($('#advancesSearch')?.value||'').trim().toLowerCase();

    const emps=loadData(KEYS.employees);
    const debts=loadData(KEYS.debts);
    const payroll=loadData(KEYS.payroll);

    if(!emps.length){
        $('#advancesTotalBar').innerHTML='';
        $('#advancesList').innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا يوجد موظفين مسجلين</p></div>';
        return;
    }

    /* filter employees by search */
    let filteredEmps=emps;
    if(searchVal) filteredEmps=emps.filter(e=>(e.name||'').toLowerCase().includes(searchVal)||(e.role||'').toLowerCase().includes(searchVal));

    let grandTotalAdvances=0, grandTotalPaid=0, grandTotalDeductions=0, grandTotalFinal=0;

    const cards=filteredEmps.map(emp=>{
        const empName=emp.name;
        const baseSalary=emp.salary||0;
        const isComm=emp.salaryType==='commission';
        const commRate=emp.commRate||0;

        /* سحوبات هذا الموظف (withdrawals from debts) for this month */
        const empWithdraws=debts.filter(d=>d.person===empName&&d.type==='withdraw'&&d.date&&d.date.startsWith(ym));
        const totalWithdraws=empWithdraws.reduce((s,d)=>s+d.amount,0);

        /* رواتب مصروفة لهذا الموظف هذا الشهر */
        const empPayroll=payroll.filter(p=>p.empId===emp.id&&p.month===ym);
        const totalPaid=empPayroll.reduce((s,p)=>s+(p.netPay||p.amount),0);
        const totalBasePaid=empPayroll.reduce((s,p)=>s+p.amount,0);
        const totalTips=empPayroll.reduce((s,p)=>s+(p.tip||0),0);
        const totalDeductions=empPayroll.reduce((s,p)=>{
            const ded=p.deductions||{};
            return s+(ded.debt||0)+(ded.attendance||0)+(ded.loan||0);
        },0);

        /* الديون المتراكمة */
        const empAllDebts=debts.filter(d=>d.person===empName);
        const currentDebt=empAllDebts.reduce((s,d)=>s+d.amount,0);

        /* حساب العمولة من المبيعات المحفوظة */
        const salesKey='_advSales_'+emp.id+'_'+ym;
        const savedSales=parseFloat(localStorage.getItem(salesKey))||0;
        const commission=isComm?(savedSales*(commRate/100)):0;
        const effectiveSalary=baseSalary+commission;

        /* الراتب النهائي = الراتب الفعلي - السحوبات - المصروف سابقاً */
        const finalSalary=effectiveSalary-totalWithdraws-totalPaid;

        grandTotalAdvances+=totalWithdraws;
        grandTotalPaid+=totalPaid;
        grandTotalDeductions+=totalDeductions;
        grandTotalFinal+=finalSalary;

        /* بناء قائمة الحركات */
        let transHtml='';
        /* سحوبات */
        empWithdraws.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).forEach(w=>{
            transHtml+=`<div class="adv-trans-item">
                <div class="adv-trans-icon withdraw"><i class="ri-arrow-up-circle-line"></i></div>
                <div class="adv-trans-info"><div class="ati-note">${w.note||'سحب'}</div><div class="ati-date">${w.date}${w.by?' - '+w.by:''}</div></div>
                <div class="adv-trans-amount" style="color:var(--clr-expense)">-${fmtNum(w.amount)} ${cur}</div>
            </div>`;
        });
        /* رواتب مصروفة */
        empPayroll.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).forEach(p=>{
            const ded=p.deductions||{};
            const totalDed=(ded.debt||0)+(ded.attendance||0)+(ded.loan||0);
            let payNote='راتب مصروف';
            if(p.tip>0) payNote+=' + إكرامية '+fmtNum(p.tip);
            if(totalDed>0) payNote+=' | استقطاع '+fmtNum(totalDed);
            transHtml+=`<div class="adv-trans-item">
                <div class="adv-trans-icon paid"><i class="ri-hand-coin-line"></i></div>
                <div class="adv-trans-info"><div class="ati-note">${payNote}</div><div class="ati-date">${p.date}${p.by?' - '+p.by:''}</div></div>
                <div class="adv-trans-amount" style="color:var(--clr-income)">${fmtNum(p.netPay||p.amount)} ${cur}</div>
            </div>`;
        });

        if(!transHtml&&!isComm){
            transHtml='<div style="text-align:center;color:var(--text3);padding:10px;font-size:.85rem">لا توجد حركات هذا الشهر</div>';
        }

        /* commission sales input */
        let salesRow='';
        if(isComm){
            salesRow=`<div class="adv-sales-row">
                <label style="font-size:.8rem;font-weight:700;white-space:nowrap"><i class="ri-shopping-bag-line"></i> المبيعات (آلاف):</label>
                <input type="number" class="input-field" id="advSales_${emp.id}" value="${savedSales?toK(savedSales):''}" inputmode="decimal" placeholder="0" onchange="saveAdvSales('${emp.id}','${ym}')">
                <span class="adv-comm-badge">${commRate}% = ${fmtNum(commission)} ${cur}</span>
            </div>`;
        }

        return `<div class="adv-emp-card">
            <div class="adv-emp-header">
                <div>
                    <div class="adv-emp-name"><i class="ri-user-3-line" style="color:var(--primary)"></i> ${empName}</div>
                    <div class="adv-emp-role">${emp.role||'موظف'} ${isComm?'<span style="color:var(--clr-income)">| عمولة '+commRate+'%</span>':'| ثابت'}</div>
                </div>
                ${currentDebt>0?'<span style="font-size:.78rem;font-weight:700;color:#dc2626;background:#fef2f2;padding:2px 8px;border-radius:6px"><i class="ri-error-warning-line"></i> ديون: '+fmtNum(currentDebt)+' '+cur+'</span>':''}
            </div>
            ${salesRow}
            <div class="adv-emp-summary">
                <div class="adv-emp-stat"><div class="aes-label">الراتب الأساسي</div><div class="aes-val">${fmtNum(baseSalary)} ${cur}</div></div>
                ${isComm?'<div class="adv-emp-stat"><div class="aes-label">العمولة</div><div class="aes-val" style="color:var(--clr-income)">'+fmtNum(commission)+' '+cur+'</div></div>':''}
                <div class="adv-emp-stat"><div class="aes-label">السحوبات</div><div class="aes-val" style="color:${totalWithdraws>0?'var(--clr-expense)':'var(--text3)'}">${fmtNum(totalWithdraws)} ${cur}</div></div>
                <div class="adv-emp-stat"><div class="aes-label">المصروف</div><div class="aes-val" style="color:var(--clr-income)">${fmtNum(totalPaid)} ${cur}</div></div>
                <div class="adv-emp-stat"><div class="aes-label">المتبقي</div><div class="aes-val" style="color:${finalSalary>0?'var(--clr-income)':finalSalary<0?'var(--clr-expense)':'var(--text3)'}">${fmtNum(finalSalary)} ${cur}</div></div>
            </div>
            ${transHtml?'<div class="adv-trans-list">'+transHtml+'</div>':''}
            <div class="adv-final-bar">
                <div class="adv-final-label"><i class="ri-wallet-3-line"></i> الراتب النهائي المتبقي</div>
                <div class="adv-final-val" style="color:${finalSalary>=0?'var(--clr-income)':'var(--clr-expense)'}">${fmtNum(finalSalary)} ${cur}</div>
            </div>
        </div>`;
    }).join('');

    /* total bar */
    $('#advancesTotalBar').innerHTML=`<div class="adv-total-bar">
        <div class="adv-total-chip"><div class="atc-label">إجمالي السحوبات</div><div class="atc-val" style="color:var(--clr-expense)">${fmtNum(grandTotalAdvances)} ${cur}</div></div>
        <div class="adv-total-chip"><div class="atc-label">إجمالي المصروف</div><div class="atc-val" style="color:var(--clr-income)">${fmtNum(grandTotalPaid)} ${cur}</div></div>
        <div class="adv-total-chip"><div class="atc-label">إجمالي الاستقطاعات</div><div class="atc-val" style="color:#f59e0b">${fmtNum(grandTotalDeductions)} ${cur}</div></div>
        <div class="adv-total-chip"><div class="atc-label">المتبقي الكلي</div><div class="atc-val" style="color:${grandTotalFinal>=0?'var(--clr-income)':'var(--clr-expense)'}">${fmtNum(grandTotalFinal)} ${cur}</div></div>
    </div>`;

    if(!cards.trim()){
        $('#advancesList').innerHTML='<div class="empty-state"><i class="ri-search-line"></i><p>لا توجد نتائج</p></div>';
    } else {
        $('#advancesList').innerHTML=cards;
    }
}

function saveAdvSales(empId,ym){
    const el=$('#advSales_'+empId);
    if(!el) return;
    const val=parseK(el.value);
    localStorage.setItem('_advSales_'+empId+'_'+ym,val);
    renderSalaryAdvances();
}

function printSalaryAdvances(){
    if(!hasAction('print'))return toast('غير مصرح');
    const s=loadSettings();const cur=s.currency||'د.ع';
    const monthInput=$('#advancesMonth');
    if(!monthInput.value) monthInput.value=today().slice(0,7);
    const ym=monthInput.value;
    const store=s.storeName||'نظام الكاشير';

    const emps=loadData(KEYS.employees);
    const debts=loadData(KEYS.debts);
    const payroll=loadData(KEYS.payroll);

    let rows='';
    let gAdv=0,gPaid=0,gFinal=0;

    emps.forEach(emp=>{
        const empName=emp.name;
        const baseSalary=emp.salary||0;
        const isComm=emp.salaryType==='commission';
        const commRate=emp.commRate||0;

        const empWithdraws=debts.filter(d=>d.person===empName&&d.type==='withdraw'&&d.date&&d.date.startsWith(ym));
        const totalWithdraws=empWithdraws.reduce((s,d)=>s+d.amount,0);
        const empPayroll=payroll.filter(p=>p.empId===emp.id&&p.month===ym);
        const totalPaid=empPayroll.reduce((s,p)=>s+(p.netPay||p.amount),0);

        const salesKey='_advSales_'+emp.id+'_'+ym;
        const savedSales=parseFloat(localStorage.getItem(salesKey))||0;
        const commission=isComm?(savedSales*(commRate/100)):0;
        const effectiveSalary=baseSalary+commission;
        const finalSalary=effectiveSalary-totalWithdraws-totalPaid;

        gAdv+=totalWithdraws;gPaid+=totalPaid;gFinal+=finalSalary;

        rows+=`<tr>
            <td>${empName}</td>
            <td>${emp.role||'موظف'}</td>
            <td>${fmtNum(baseSalary)}</td>
            ${isComm?'<td>'+fmtNum(commission)+'</td>':'<td>-</td>'}
            <td style="color:#dc2626">${fmtNum(totalWithdraws)}</td>
            <td style="color:#16a34a">${fmtNum(totalPaid)}</td>
            <td style="font-weight:900;color:${finalSalary>=0?'#16a34a':'#dc2626'}">${fmtNum(finalSalary)}</td>
        </tr>`;

        /* detail rows for withdrawals */
        empWithdraws.forEach(w=>{
            rows+=`<tr style="font-size:10pt;color:#666"><td colspan="4" style="padding-right:20px">↳ ${w.note||'سحب'} (${w.date})</td><td style="color:#dc2626">-${fmtNum(w.amount)}</td><td colspan="2"></td></tr>`;
        });
    });

    let html=`<div class="print-page-border">
    <div class="print-header"><h2>${store}</h2><p>كشف سحوبات الرواتب - شهر ${ym}</p></div>
    <div class="print-date">تاريخ الطباعة: ${today()}</div>
    <table><thead><tr><th>الموظف</th><th>الوظيفة</th><th>الراتب</th><th>العمولة</th><th>السحوبات</th><th>المصروف</th><th>المتبقي</th></tr></thead>
    <tbody>${rows}
    <tr style="font-weight:900;border-top:3px solid #333"><td colspan="4">الإجمالي</td><td style="color:#dc2626">${fmtNum(gAdv)}</td><td style="color:#16a34a">${fmtNum(gPaid)}</td><td style="color:${gFinal>=0?'#16a34a':'#dc2626'}">${fmtNum(gFinal)}</td></tr>
    </tbody></table>
    <div class="print-footer">تم الإنشاء بواسطة ${store} - ${today()}</div>
    </div>`;
    showPrintDialog(html);
}

/* ========= PROFIT & LOSS ANALYSIS (تحليل الأرباح والخسائر) ========= */
let _profitChart=null;

function renderProfitLoss(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const monthInput=$('#profitMonth');
    if(!monthInput.value) monthInput.value=today().slice(0,7);
    const filterPrefix=monthInput.value;
    const markup=parseFloat($('#profitMarkup').value)||50;
    const markupFactor=markup/100;

    /* ===== جلب بيانات الخزنة ===== */
    const safeTrans=loadData(KEYS.safe).filter(t=>t.date&&t.date.startsWith(filterPrefix));
    const safeDeposits=safeTrans.filter(t=>t.type==='deposit');
    const safeWithdraws=safeTrans.filter(t=>t.type==='withdraw');

    /* تصنيف الإيداعات */
    const closingDeposits=safeDeposits.filter(t=>t.closingId);
    const otherDeposits=safeDeposits.filter(t=>!t.closingId);

    const totalClosingDeposits=closingDeposits.reduce((s,t)=>s+t.amount,0);
    const totalOtherDeposits=otherDeposits.reduce((s,t)=>s+t.amount,0);
    const totalDeposits=totalClosingDeposits+totalOtherDeposits;
    const totalWithdraws=safeWithdraws.reduce((s,t)=>s+t.amount,0);

    /* صافي حركة الخزنة هذا الشهر */
    const netSafeMovement=totalDeposits-totalWithdraws;

    /* الرصيد الكلي للخزنة */
    const safeBalance=getSafeBalance();

    /* ===== حساب الربح على أساس الخزنة ===== */
    /* إيداعات التقفيلات = صافي المبيعات بعد خصم المصاريف والديون على مستوى الكاشير */
    /* تكلفة البضاعة = إيداعات التقفيلات / (1 + نسبة الربح) */
    const costOfGoods=totalClosingDeposits/(1+markupFactor);
    const grossProfit=totalClosingDeposits-costOfGoods;

    /* صافي الربح = الربح الإجمالي - سحوبات الخزنة */
    const netProfit=grossProfit-totalWithdraws;

    /* نسب */
    const grossProfitPct=totalClosingDeposits>0?((grossProfit/totalClosingDeposits)*100):0;
    const netProfitPct=totalClosingDeposits>0?((netProfit/totalClosingDeposits)*100):0;

    /* ===== جلب بيانات إضافية للعرض ===== */
    const closings=loadData(KEYS.closings).filter(c=>c.date&&c.date.startsWith(filterPrefix));
    const debts=loadData(KEYS.debts).filter(d=>d.date&&d.date.startsWith(filterPrefix));
    const debtAdded=debts.filter(d=>d.amount>0).reduce((s,d)=>s+d.amount,0);
    const debtRepaid=debts.filter(d=>d.amount<0).reduce((s,d)=>s+Math.abs(d.amount),0);
    const payrollData=loadData(KEYS.payroll).filter(p=>p.month===filterPrefix);
    const totalPayroll=payrollData.reduce((s,p)=>s+(p.netPay||p.amount),0);

    /* إجمالي المبيعات الأصلية من التقفيلات */
    let totalSales=0,totalReturns=0;
    closings.forEach(c=>{CASHIERS.forEach(cs=>{const d=c.cashiers[cs.key];if(!d)return;const r=calcCashierNet(d);totalSales+=r.gross;totalReturns+=r.returns;});});

    /* ===== بطاقة النتيجة ===== */
    const isProfit=netProfit>0;
    const isZero=netProfit===0;
    const resultClass=isZero?'profit-zero':isProfit?'profit-positive':'profit-negative';
    const resultIcon=isZero?'ri-equal-line':isProfit?'ri-arrow-up-circle-fill':'ri-arrow-down-circle-fill';
    const resultLabel=isZero?'لا ربح ولا خسارة':isProfit?'صافي الربح':'صافي الخسارة';

    $('#profitResultCard').innerHTML=`
    <div class="profit-result-card ${resultClass}">
        <div class="profit-result-icon"><i class="${resultIcon}"></i></div>
        <div class="profit-result-label">${resultLabel} - شهر ${filterPrefix}</div>
        <div class="profit-result-amount">${fmtNum(Math.abs(netProfit))} ${cur}</div>
        <div class="profit-result-pct">${netProfitPct.toFixed(1)}% من إيداعات التقفيلات</div>
    </div>`;

    /* ===== شبكة الملخص ===== */
    $('#profitSummaryGrid').innerHTML=`
    <div class="profit-summary-grid">
        <div class="profit-summary-item"><div class="ps-icon" style="color:#22c55e"><i class="ri-safe-2-fill"></i></div><div class="ps-label">إيداعات التقفيلات</div><div class="ps-val" style="color:var(--clr-income)">${fmtNum(totalClosingDeposits)} ${cur}</div></div>
        <div class="profit-summary-item"><div class="ps-icon" style="color:#0ea5e9"><i class="ri-add-circle-fill"></i></div><div class="ps-label">إيداعات أخرى</div><div class="ps-val">${fmtNum(totalOtherDeposits)} ${cur}</div></div>
        <div class="profit-summary-item"><div class="ps-icon" style="color:#6366f1"><i class="ri-wallet-3-fill"></i></div><div class="ps-label">إجمالي الإيداعات</div><div class="ps-val">${fmtNum(totalDeposits)} ${cur}</div></div>
        <div class="profit-summary-item"><div class="ps-icon" style="color:#ef4444"><i class="ri-arrow-down-circle-fill"></i></div><div class="ps-label">سحوبات الخزنة</div><div class="ps-val" style="color:var(--clr-expense)">${fmtNum(totalWithdraws)} ${cur}</div></div>
        <div class="profit-summary-item"><div class="ps-icon" style="color:#f97316"><i class="ri-box-3-fill"></i></div><div class="ps-label">تكلفة البضاعة (${markup}%)</div><div class="ps-val">${fmtNum(costOfGoods)} ${cur}</div></div>
        <div class="profit-summary-item"><div class="ps-icon" style="color:#22c55e"><i class="ri-funds-fill"></i></div><div class="ps-label">هامش الربح الإجمالي</div><div class="ps-val" style="color:var(--clr-income)">${fmtNum(grossProfit)} ${cur}</div></div>
        <div class="profit-summary-item"><div class="ps-icon" style="color:#8b5cf6"><i class="ri-percent-fill"></i></div><div class="ps-label">نسبة الربح الإجمالي</div><div class="ps-val">${grossProfitPct.toFixed(1)}%</div></div>
        <div class="profit-summary-item"><div class="ps-icon" style="color:#14b8a6"><i class="ri-safe-2-fill"></i></div><div class="ps-label">صافي حركة الخزنة</div><div class="ps-val" style="color:${netSafeMovement>=0?'var(--clr-income)':'var(--clr-expense)'}">${fmtNum(netSafeMovement)} ${cur}</div></div>
        <div class="profit-summary-item"><div class="ps-icon" style="color:#d97706"><i class="ri-coin-fill"></i></div><div class="ps-label">رصيد الخزنة الحالي</div><div class="ps-val" style="font-weight:900">${fmtNum(safeBalance)} ${cur}</div></div>
    </div>`;

    /* ===== الرسم البياني ===== */
    if(_profitChart){_profitChart.destroy();_profitChart=null;}
    const ctx=document.getElementById('profitChart');
    if(ctx){
        _profitChart=new Chart(ctx,{
            type:'doughnut',
            data:{
                labels:['تكلفة البضاعة','سحوبات الخزنة','صافي الربح/الخسارة'],
                datasets:[{
                    data:[
                        Math.round(costOfGoods/1000),
                        Math.round(totalWithdraws/1000),
                        Math.round(Math.abs(netProfit)/1000)
                    ],
                    backgroundColor:['#f97316','#ef4444',netProfit>=0?'#22c55e':'#dc2626'],
                    borderWidth:2,
                    borderColor:'#fff'
                }]
            },
            options:{
                responsive:true,
                plugins:{
                    legend:{position:'bottom',labels:{font:{family:'Tajawal',size:12},padding:12}},
                    tooltip:{callbacks:{label:function(c){return c.label+': '+Number(c.raw).toLocaleString('en-US')+' '+cur;}}}
                }
            }
        });
    }

    /* ===== جدول التفاصيل ===== */
    /* قائمة سحوبات الخزنة */
    let withdrawRows='';
    safeWithdraws.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).forEach(w=>{
        withdrawRows+=`<tr><td style="padding-right:24px">${w.date} - ${w.note||'سحب'}</td><td>${fmtNum(w.amount)} ${cur}</td></tr>`;
    });

    $('#profitDetailsSection').innerHTML=`
    <div class="profit-detail-section">
        <h3><i class="ri-safe-2-fill"></i> تحليل الربح والخسارة من الخزنة</h3>
        <table class="profit-detail-table">
            <thead><tr><th>البند</th><th>المبلغ</th></tr></thead>
            <tbody>
                <tr><td><i class="ri-shopping-bag-line" style="color:#6366f1"></i> إجمالي المبيعات (من التقفيلات)</td><td>${fmtNum(totalSales)} ${cur}</td></tr>
                <tr><td><i class="ri-arrow-go-back-line" style="color:#ef4444"></i> (-) التخفيضات والخصومات</td><td>${fmtNum(totalReturns)} ${cur}</td></tr>
                <tr><td><i class="ri-safe-2-line" style="color:#22c55e"></i> <strong>ما دخل الخزنة من التقفيلات</strong></td><td style="color:var(--clr-income);font-weight:700">${fmtNum(totalClosingDeposits)} ${cur}</td></tr>
                ${totalOtherDeposits?`<tr><td><i class="ri-add-circle-line" style="color:#0ea5e9"></i> إيداعات أخرى (يدوية)</td><td>${fmtNum(totalOtherDeposits)} ${cur}</td></tr>`:''}
                <tr class="total-row"><td><strong>إجمالي الإيداعات في الخزنة</strong></td><td><strong>${fmtNum(totalDeposits)} ${cur}</strong></td></tr>
                <tr><td><i class="ri-box-3-line" style="color:#f97316"></i> (-) تكلفة البضاعة المقدرة (نسبة ${markup}%)</td><td class="negative">${fmtNum(costOfGoods)} ${cur}</td></tr>
                <tr class="total-row profit-row"><td><strong>هامش الربح الإجمالي</strong></td><td class="positive"><strong>${fmtNum(grossProfit)} ${cur}</strong></td></tr>
                <tr><td colspan="2" style="font-weight:700;color:var(--text2);padding-top:12px"><i class="ri-arrow-down-circle-line"></i> سحوبات الخزنة (${safeWithdraws.length} عملية)</td></tr>
                ${withdrawRows||'<tr><td colspan="2" style="text-align:center;color:var(--text3)">لا توجد سحوبات</td></tr>'}
                <tr class="total-row"><td><strong>إجمالي السحوبات</strong></td><td class="negative"><strong>${fmtNum(totalWithdraws)} ${cur}</strong></td></tr>
                <tr class="total-row profit-row"><td><strong style="font-size:1rem">${netProfit>=0?'صافي الربح':'صافي الخسارة'}</strong></td><td class="${netProfit>=0?'positive':'negative'}" style="font-size:1rem"><strong>${fmtNum(Math.abs(netProfit))} ${cur} ${netProfit>=0?'✓':'✗'}</strong></td></tr>
            </tbody>
        </table>
    </div>
    <div class="profit-detail-section" style="margin-top:12px">
        <h3><i class="ri-information-fill"></i> معلومات إضافية</h3>
        <table class="profit-detail-table">
            <thead><tr><th>البند</th><th>المبلغ</th></tr></thead>
            <tbody>
                <tr><td><i class="ri-safe-2-line" style="color:#14b8a6"></i> رصيد الخزنة الحالي (الكلي)</td><td style="font-weight:800">${fmtNum(safeBalance)} ${cur}</td></tr>
                <tr><td><i class="ri-arrow-up-circle-line" style="color:#22c55e"></i> صافي حركة الخزنة (هذا الشهر)</td><td style="color:${netSafeMovement>=0?'var(--clr-income)':'var(--clr-expense)'}">${fmtNum(netSafeMovement)} ${cur}</td></tr>
                <tr><td><i class="ri-file-list-3-line" style="color:#ef4444"></i> الديون الجديدة</td><td>${fmtNum(debtAdded)} ${cur}</td></tr>
                <tr><td><i class="ri-checkbox-circle-line" style="color:#22c55e"></i> الديون المسددة</td><td>${fmtNum(debtRepaid)} ${cur}</td></tr>
                <tr><td><i class="ri-team-line" style="color:#8b5cf6"></i> الرواتب المصروفة</td><td>${fmtNum(totalPayroll)} ${cur}</td></tr>
                <tr><td><i class="ri-calculator-line" style="color:#6366f1"></i> عدد التقفيلات</td><td>${closings.length}</td></tr>
                <tr><td><i class="ri-exchange-line" style="color:#0ea5e9"></i> عدد عمليات الخزنة</td><td>${safeTrans.length}</td></tr>
            </tbody>
        </table>
    </div>`;
}

function printProfitLoss(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const monthInput=$('#profitMonth');
    if(!monthInput.value) monthInput.value=today().slice(0,7);
    const filterPrefix=monthInput.value;
    const markup=parseFloat($('#profitMarkup').value)||50;
    const markupFactor=markup/100;

    const safeTrans=loadData(KEYS.safe).filter(t=>t.date&&t.date.startsWith(filterPrefix));
    const safeDeposits=safeTrans.filter(t=>t.type==='deposit');
    const safeWithdraws=safeTrans.filter(t=>t.type==='withdraw');
    const closingDeposits=safeDeposits.filter(t=>t.closingId);
    const otherDeposits=safeDeposits.filter(t=>!t.closingId);
    const totalClosingDeposits=closingDeposits.reduce((s,t)=>s+t.amount,0);
    const totalOtherDeposits=otherDeposits.reduce((s,t)=>s+t.amount,0);
    const totalDeposits=totalClosingDeposits+totalOtherDeposits;
    const totalWithdraws=safeWithdraws.reduce((s,t)=>s+t.amount,0);
    const costOfGoods=totalClosingDeposits/(1+markupFactor);
    const grossProfit=totalClosingDeposits-costOfGoods;
    const netProfit=grossProfit-totalWithdraws;
    const safeBalance=getSafeBalance();
    const store=s.storeName||'نظام الكاشير';

    let withdrawRows='';
    safeWithdraws.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).forEach(w=>{
        withdrawRows+=`<tr><td style="padding-right:16px">${w.date} - ${w.note||'سحب'}</td><td>${fmtNum(w.amount)} ${cur}</td></tr>`;
    });

    let html=`<div class="print-page-border">
    <div class="print-header"><h2>${store}</h2><p>تقرير الأرباح والخسائر (من الخزنة) - شهر ${filterPrefix}</p></div>
    <div class="print-date">نسبة الربح المستخدمة: ${markup}%</div>
    <table><thead><tr><th>البند</th><th>المبلغ</th></tr></thead><tbody>
    <tr><td>إيداعات التقفيلات</td><td>${fmtNum(totalClosingDeposits)} ${cur}</td></tr>
    ${totalOtherDeposits?`<tr><td>إيداعات أخرى (يدوية)</td><td>${fmtNum(totalOtherDeposits)} ${cur}</td></tr>`:''}
    <tr style="font-weight:900;border-top:2px solid #333"><td>إجمالي الإيداعات</td><td>${fmtNum(totalDeposits)} ${cur}</td></tr>
    <tr><td>(-) تكلفة البضاعة المقدرة (${markup}%)</td><td>${fmtNum(costOfGoods)} ${cur}</td></tr>
    <tr style="font-weight:900;border-top:2px solid #333"><td>هامش الربح الإجمالي</td><td>${fmtNum(grossProfit)} ${cur}</td></tr>
    <tr><td colspan="2" style="font-weight:700;padding-top:8px">سحوبات الخزنة:</td></tr>
    ${withdrawRows||'<tr><td colspan="2" style="text-align:center">لا توجد سحوبات</td></tr>'}
    <tr style="font-weight:900;border-top:2px solid #333"><td>إجمالي السحوبات</td><td>${fmtNum(totalWithdraws)} ${cur}</td></tr>
    </tbody></table>
    <div class="print-total" style="margin-top:8px;${netProfit>=0?'color:#16a34a':'color:#dc2626'}">${netProfit>=0?'صافي الربح':'صافي الخسارة'}: ${fmtNum(Math.abs(netProfit))} ${cur}</div>
    <div style="margin-top:4px;font-size:11px;color:#555">رصيد الخزنة الحالي: ${fmtNum(safeBalance)} ${cur}</div>
    <div class="print-footer">تم الإنشاء بواسطة ${store} - ${today()}</div>
    </div>`;
    showPrintDialog(html);
}

function exportProfitLoss(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const monthInput=$('#profitMonth');
    if(!monthInput.value) monthInput.value=today().slice(0,7);
    const filterPrefix=monthInput.value;
    const markup=parseFloat($('#profitMarkup').value)||50;
    const markupFactor=markup/100;

    const safeTrans=loadData(KEYS.safe).filter(t=>t.date&&t.date.startsWith(filterPrefix));
    const safeDeposits=safeTrans.filter(t=>t.type==='deposit');
    const safeWithdraws=safeTrans.filter(t=>t.type==='withdraw');
    const closingDeposits=safeDeposits.filter(t=>t.closingId);
    const otherDeposits=safeDeposits.filter(t=>!t.closingId);
    const totalClosingDeposits=closingDeposits.reduce((s,t)=>s+t.amount,0);
    const totalOtherDeposits=otherDeposits.reduce((s,t)=>s+t.amount,0);
    const totalDeposits=totalClosingDeposits+totalOtherDeposits;
    const totalWithdraws=safeWithdraws.reduce((s,t)=>s+t.amount,0);
    const costOfGoods=totalClosingDeposits/(1+markupFactor);
    const grossProfit=totalClosingDeposits-costOfGoods;
    const netProfit=grossProfit-totalWithdraws;
    const safeBalance=getSafeBalance();

    const data={
        month:filterPrefix,
        markupPercent:markup,
        totalClosingDeposits,totalOtherDeposits,totalDeposits,
        totalWithdraws,
        costOfGoods,grossProfit,netProfit,
        safeBalance,
        withdrawals:safeWithdraws.map(w=>({date:w.date,note:w.note||'سحب',amount:w.amount})),
        currency:cur,
        exportDate:today()
    };
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download=`profit-loss-safe-${filterPrefix}.json`;
    a.click();URL.revokeObjectURL(a.href);
    toast('تم تصدير التقرير');
}

/* ========= INIT ========= */
document.addEventListener('DOMContentLoaded',()=>{
    /* login events (always available) */
    $('#loginBtn').addEventListener('click',doLogin);
    $('#loginPass').addEventListener('keydown',e=>{if(e.key==='Enter'){
        const users=loadUsers();
        if(users.length===0){$('#loginConfirm')?.focus();}
        else doLogin();
    }});
    const lc=$('#loginConfirm');if(lc)lc.addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});

    /* check auth */
    if(!checkAuth())return;
    initApp();
});

function initApp(){
    showDate();

    /* ترقية البيانات القديمة: إعادة احتساب الصوافي وإصلاح الخزنة */
    runDataUpgrade();

    /* تهيئة history API - حقن الصفحة الرئيسية كأول دخول */
    try{
        /* قراءة hash إن وجد */
        let initialPage='home';
        const hash=location.hash.replace(/^#/,'');
        if(hash && document.getElementById('page-'+hash)) initialPage=hash;
        history.replaceState({page:initialPage},'','#'+initialPage);
        if(initialPage!=='home') navigate(initialPage,true);
    }catch(e){console.warn('history init failed',e);}

    /* apply theme */
    const settings=loadSettings();
    applyTheme(settings.theme);

    /* start Firebase real-time listener for cashier closings */
    startFirebaseListener();

    /* start full Firebase sync */
    initFirebaseSync();

    /* sync cashier accounts to Firebase */
    syncCashierAccounts();

    /* update notification badge */
    updateNotifBadge();

    /* user display */
    const user=getCurrentUser();
    if(user){
        const disp=$('#currentUserDisp');if(disp)disp.textContent=user.username;
        const secTile=$('#securityTile');if(secTile)secTile.style.display=isAdmin()?'':'none';
        const secSb=document.querySelector('.sb-security');if(secSb)secSb.style.display=isAdmin()?'':'none';
    }

    /* sidebar */
    $('#sidebarToggle').addEventListener('click',()=>{$('#sidebar').classList.add('open');$('#sbOverlay').classList.add('show');});
    $('#closeSidebar').addEventListener('click',closeSidebar);
    $('#sbOverlay').addEventListener('click',closeSidebar);
    $$('.sb-item').forEach(b=>{if(b.dataset.page)b.addEventListener('click',()=>navigate(b.dataset.page));});
    const logoutBtn=$('#logoutBtn');if(logoutBtn)logoutBtn.addEventListener('click',logout);

    /* bottom nav */
    $$('.bn-item').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.page)));

    /* home tiles */
    $$('.home-tile').forEach(t=>t.addEventListener('click',()=>navigate(t.dataset.page)));

    /* closing */
    $('#newClosingBtn').addEventListener('click',startWizard);
    $('#wizardClose').addEventListener('click',closeWizard);
    $('#wizNext').addEventListener('click',()=>{
        saveCurrentStep();
        if(wizStep===TOTAL_STEPS-1){saveClosing();return;}
        wizStep++;renderWizStep();
    });
    $('#wizBack').addEventListener('click',()=>{saveCurrentStep();if(wizStep>0){wizStep--;renderWizStep();}});

    /* safe */
    $('#safeDepositBtn').addEventListener('click',()=>safeTransaction('deposit'));
    $('#safeWithdrawBtn').addEventListener('click',()=>safeTransaction('withdraw'));
    $('#safePrintBtn').addEventListener('click',safePrint);
    $('#safeExportBtn').addEventListener('click',safeExport);
    const safeImportBtn=$('#safeImportBtn');if(safeImportBtn)safeImportBtn.addEventListener('click',safeImport);

    /* debts filter buttons */
    $$('[data-dfilter]').forEach(b=>b.addEventListener('click',()=>{debtFilter=b.dataset.dfilter;renderDebts();}));

    /* expenses */
    $('#expFilterBtn').addEventListener('click',renderExpenses);

    /* salaries */
    $('#addEmployeeBtn').addEventListener('click',addEmployee);
    $('#printAllSalBtn').addEventListener('click',printAllSalaries);

    /* payroll */
    $('#payrollFilterBtn').addEventListener('click',renderPayroll);
    $('#printPayrollBtn').addEventListener('click',printPayroll);
    $('#printPayrollHistoryBtn').addEventListener('click',printPayrollHistory);

    /* capital */
    $('#capitalAddBtn').addEventListener('click',()=>capitalTransaction('deposit'));
    $('#capitalWithdrawBtn').addEventListener('click',()=>capitalTransaction('withdraw'));

    /* purchases */
    $('#addPurchaseBtn').addEventListener('click',addPurchase);

    /* report */
    $('#reportFilterBtn').addEventListener('click',renderReport);
    /* report section tabs */
    document.querySelectorAll('.rs-tab').forEach(b=>{
        b.addEventListener('click',()=>setReportSection(b.dataset.rsec));
    });
    /* report date input */
    const reportDateEl=document.getElementById('reportDate');
    if(reportDateEl)reportDateEl.addEventListener('change',renderReport);
    $('#printReportBtn').addEventListener('click',printReport);

    /* General Expenses page filters */
    const genExpMonthEl=document.getElementById('genExpMonth');
    if(genExpMonthEl)genExpMonthEl.addEventListener('change',renderGeneralExpenses);
    const genExpTypeEl=document.getElementById('genExpTypeFilter');
    if(genExpTypeEl)genExpTypeEl.addEventListener('change',renderGeneralExpenses);

    /* Closing Sheet page filter */
    const sheetMonthEl=document.getElementById('sheetMonth');
    if(sheetMonthEl)sheetMonthEl.addEventListener('change',renderClosingSheet);

    /* settings */
    $('#saveSettingsBtn').addEventListener('click',saveSettingsForm);
    const themeToggle=$('#themeToggle');if(themeToggle)themeToggle.addEventListener('change',toggleTheme);
    $('#exportBtn').addEventListener('click',exportData);
    $('#importBtn').addEventListener('click',()=>$('#importFile').click());
    $('#importFile').addEventListener('change',e=>{if(e.target.files[0])importData(e.target.files[0]);});
    $('#demoBtn').addEventListener('click',loadDemo);
    $('#clearBtn').addEventListener('click',clearAll);
    const manualUploadBtn=$('#manualUploadBtn');if(manualUploadBtn)manualUploadBtn.addEventListener('click',manualUploadAll);
    const manualDownloadBtn=$('#manualDownloadBtn');if(manualDownloadBtn)manualDownloadBtn.addEventListener('click',manualDownloadAll);

    /* security */
    const addUserBtn=$('#addUserBtn');if(addUserBtn)addUserBtn.addEventListener('click',addUser);

    /* notifications */
    const notifToggle=$('#notifToggle');if(notifToggle)notifToggle.addEventListener('click',toggleNotifPanel);
    document.addEventListener('click',e=>{const panel=$('#notifPanel');const toggle=$('#notifToggle');if(panel&&panel.classList.contains('open')&&!panel.contains(e.target)&&toggle&&!toggle.contains(e.target))panel.classList.remove('open');});

    /* modal */
    $('#modalClose').addEventListener('click',closeModal);
    $('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))closeModal();});

    /* global search */
    $('#globalSearchBtn').addEventListener('click',globalSearch);
    $('#globalSearch').addEventListener('keydown',e=>{if(e.key==='Enter')globalSearch();});
    $('#globalSearch').addEventListener('input',()=>{if(!$('#globalSearch').value.trim()){$('#globalSearchResults').style.display='none';$('#homeGrid').style.display='';}});

    /* topbar search (desktop) */
    const tbSearch=$('#topbarSearch');const tbSearchBtn=$('#topbarSearchBtn');
    if(tbSearch&&tbSearchBtn){
        tbSearchBtn.addEventListener('click',()=>{$('#globalSearch').value=tbSearch.value;globalSearch();if($('#page-home').classList.contains('active'))return;navigate('home');});
        tbSearch.addEventListener('keydown',e=>{if(e.key==='Enter'){$('#globalSearch').value=tbSearch.value;globalSearch();if(!$('#page-home').classList.contains('active'))navigate('home');}});
    }

    /* print buttons */
    const printDebtsBtn=$('#printDebtsBtn');if(printDebtsBtn)printDebtsBtn.addEventListener('click',printDebts);
    const printExpBtn=$('#printExpBtn');if(printExpBtn)printExpBtn.addEventListener('click',printExpenses);
    const printPurchBtn=$('#printPurchBtn');if(printPurchBtn)printPurchBtn.addEventListener('click',printPurchases);
    const printCapitalBtn=$('#printCapitalBtn');if(printCapitalBtn)printCapitalBtn.addEventListener('click',printCapital);

    /* search inputs - Enter key */
    ['closingSearch','safeSearch','debtsSearch','expSearch','salSearch','purchSearch','capitalSearch','individualSearch'].forEach(id=>{
        const el=$('#'+id);
        if(el)el.addEventListener('keydown',e=>{if(e.key==='Enter'){
            if(id==='closingSearch')renderClosings();
            else if(id==='safeSearch')renderSafe();
            else if(id==='debtsSearch')renderDebts();
            else if(id==='expSearch')renderExpenses();
            else if(id==='salSearch')renderSalaries();
            else if(id==='purchSearch')renderPurchases();
            else if(id==='capitalSearch')renderCapital();
            else if(id==='individualSearch')renderIndividual();
        }});
    });

    /* service worker */
    if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js');}
}