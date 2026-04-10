/* ========= helpers ========= */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const fmtNum = n => Number(n||0).toLocaleString('en-US');
const today = () => new Date().toISOString().slice(0,10);
const uid = () => Date.now().toString(36)+Math.random().toString(36).slice(2,6);

/* ========= data store ========= */
const KEYS={closings:'cm_closings',safe:'cm_safe',debts:'cm_debts',employees:'cm_employees',
    capital:'cm_capital',purchases:'cm_purchases',withdrawals:'cm_withdrawals',
    settings:'cm_settings',payroll:'cm_payroll'};
function loadData(k){try{return JSON.parse(localStorage.getItem(k))||[];}catch(e){return[];}}
function saveData(k,v){localStorage.setItem(k,JSON.stringify(v));}
function loadSettings(){try{return JSON.parse(localStorage.getItem(KEYS.settings))||{};}catch(e){return {};}}
function saveSettings(s){localStorage.setItem(KEYS.settings,JSON.stringify(s));}

/* ========= navigation ========= */
function navigate(page){
    $$('.page').forEach(p=>p.classList.remove('active'));
    const el=$('#page-'+page);if(el)el.classList.add('active');
    $$('.sb-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
    $$('.bn-item').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
    const titles={home:'لوحة التحكم',closing:'التقفيلة',safe:'الخزنة',debts:'الديون',expenses:'المصاريف',salaries:'الرواتب',payroll:'صرف الرواتب',capital:'رأس المال',purchases:'المشتريات',report:'التقرير الشهري',settings:'الإعدادات'};
    $('#topbarTitle').textContent=titles[page]||'لوحة التحكم';
    closeSidebar();
    const r={closing:renderClosings,safe:renderSafe,debts:renderDebts,expenses:renderExpenses,salaries:renderSalaries,payroll:renderPayroll,capital:renderCapital,purchases:renderPurchases,report:renderReport,settings:renderSettings};
    if(r[page])r[page]();
}
function closeSidebar(){$('#sidebar').classList.remove('open');$('#sbOverlay').classList.remove('show');}

/* ========= toast / modal ========= */
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),2200);}
function openModal(title,bodyHtml,footHtml){$('#modalTitle').textContent=title;$('#modalBody').innerHTML=bodyHtml;$('#modalFoot').innerHTML=footHtml||'';$('#modal').classList.remove('hidden');}
function closeModal(){$('#modal').classList.add('hidden');}

/* ========= date display ========= */
function showDate(){
    const d=new Date();
    const opts={weekday:'long',year:'numeric',month:'long',day:'numeric'};
    const s=d.toLocaleDateString('ar-SA',opts);
    $('#topbarDate').textContent=s;
    const cd=$('#closingDateDisplay');if(cd)cd.textContent=s;
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
    });
    wizStep=0;
    renderWizStep();
    $('#wizardOverlay').classList.remove('hidden');
    document.body.classList.add('wizard-open');
}
function closeWizard(){
    $('#wizardOverlay').classList.add('hidden');
    document.body.classList.remove('wizard-open');
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
            <select id="managerSelect" class="input-field" onchange="onManagerSelect()">
                <option value="">-- اختر المدير --</option>
                ${opts}
                <option value="__new__">+ إضافة مدير جديد</option>
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
    }
    body.innerHTML=`
    <div class="wiz-cashier-label" style="color:${cashier.color}"><i class="${cashier.icon}"></i> ${cashier.label}</div>
    <div class="wiz-label"><i class="${field.icon}"></i> ${field.label}</div>
    <input type="number" class="wiz-input" id="wizInput" inputmode="decimal" value="${wizData.cashiers[ck][fk]||''}" placeholder="0">
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
        <select id="debtPersonSelect" class="input-field"><option value="">-- اختر المدين --</option>${opts}<option value="__new__">+ اسم جديد</option></select>
        <div id="newDebtPersonRow" class="debtor-add-row" style="display:none"><input type="text" class="input-field" id="newDebtPerson" placeholder="اسم المدين"><button class="btn btn-success btn-sm" onclick="confirmNewDebtPerson()">✓</button></div>
    </div>
    <input type="number" class="input-field" id="debtAmountInput" placeholder="المبلغ" inputmode="decimal" style="margin-top:6px">
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
    const amount=parseFloat($('#debtAmountInput')?.value)||0;
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

/* withdraw entry UI */
function buildWithdrawEntryUI(ck){
    const allDebts=loadData(KEYS.debts);
    const names=[...new Set(allDebts.map(d=>d.person))];
    let opts=names.map(n=>`<option value="${n}">${n}</option>`).join('');
    const list=wizData.cashiers[ck].withdrawList||[];
    let items=list.map((w,i)=>`<div class="withdraw-item"><span>${w.person}: ${fmtNum(w.amount)}</span><button onclick="removeWizWithdraw('${ck}',${i})"><i class="ri-close-circle-line"></i></button></div>`).join('');
    return `<div class="wiz-withdraw-entry"><h4><i class="ri-hand-coin-line"></i> تفاصيل السحوبات</h4>
    <div class="debtor-selector">
        <select id="withdrawPersonSelect" class="input-field"><option value="">-- اختر الشخص --</option>${opts}<option value="__new__">+ اسم جديد</option></select>
        <div id="newWithdrawPersonRow" class="debtor-add-row" style="display:none"><input type="text" class="input-field" id="newWithdrawPerson" placeholder="اسم الشخص"><button class="btn btn-success btn-sm" onclick="confirmNewWithdrawPerson()">✓</button></div>
    </div>
    <input type="number" class="input-field" id="withdrawAmountInput" placeholder="المبلغ" inputmode="decimal" style="margin-top:6px">
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
    const amount=parseFloat($('#withdrawAmountInput')?.value)||0;
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
        const net=d.network||0;
        const deductions=(d.returns||0)+(d.expenses||0)+(d.lunch||0)+(d.debts||0)+(d.withdrawals||0);
        const expected=(d.sales||0)-deductions;
        const diff=(d.network||0)-expected;
        grandNet+=net;
        html+=`<h4 style="color:${c.color};margin:10px 0 6px;font-size:.9rem"><i class="${c.icon}"></i> ${c.label}</h4>`;
        html+=`<table><thead><tr><th>البيان</th><th>المبلغ</th></tr></thead><tbody>`;
        CASHIER_FIELDS.forEach(f=>{
            const v=d[f.key]||0;
            const clr=getTypeColor(f.type);
            html+=`<tr><td>${f.label}</td><td style="color:${clr};font-weight:700">${fmtNum(v)} ${cur}</td></tr>`;
        });
        html+=`<tr style="background:var(--surface2)"><td>إجمالي الخصومات</td><td style="color:var(--clr-expense);font-weight:700">${fmtNum(deductions)} ${cur}</td></tr>`;
        html+=`<tr style="background:var(--surface2)"><td>المتوقع (الرصيد - الخصومات)</td><td style="font-weight:700">${fmtNum(expected)} ${cur}</td></tr>`;
        if(diff!==0)html+=`<tr style="background:#fef3c7"><td>الفرق</td><td style="color:${diff>0?'var(--clr-income)':'var(--clr-expense)'};font-weight:700">${fmtNum(diff)} ${cur}</td></tr>`;
        const netClr=net>=0?'var(--clr-income)':'var(--clr-expense)';
        html+=`<tr class="total-row"><td>الصافي (المبلغ المستلم)</td><td style="color:${netClr}">${fmtNum(net)} ${cur}</td></tr>`;
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
    if(inp)wizData.cashiers[cashier.key][field.key]=parseFloat(inp.value)||0;
    return true;
}

function saveClosing(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const closings=loadData(KEYS.closings);
    const safe=loadData(KEYS.safe);
    const debts=loadData(KEYS.debts);
    const withdrawals=loadData(KEYS.withdrawals);
    const date=today();
    let totalNet=0;

    const cashiersData={};
    CASHIERS.forEach(c=>{
        const d=wizData.cashiers[c.key];
        const net=d.network||0;
        cashiersData[c.key]={...d,net};
        totalNet+=net;
        /* save debts */
        (d.debtsList||[]).forEach(debt=>{
            debts.push({id:uid(),person:debt.person,amount:debt.amount,note:debt.note||'',type:'debt',cashier:c.label,date});
        });
        /* save withdrawals + record in debts */
        (d.withdrawList||[]).forEach(w=>{
            withdrawals.push({id:uid(),person:w.person,amount:w.amount,note:w.note||'',cashier:c.label,date});
            debts.push({id:uid(),person:w.person,amount:w.amount,note:'سحب: '+(w.note||''),type:'withdraw',cashier:c.label,date});
        });
    });
    /* save closing */
    closings.push({id:uid(),date,manager:wizData.manager||'',cashiers:cashiersData,totalNet});
    /* safe transaction */
    if(totalNet!==0){
        safe.push({id:uid(),date,type:totalNet>0?'deposit':'withdraw',amount:Math.abs(totalNet),note:'تقفيلة '+date+(wizData.manager?' - المدير: '+wizData.manager:'')});
    }
    saveData(KEYS.closings,closings);
    saveData(KEYS.safe,safe);
    saveData(KEYS.debts,debts);
    saveData(KEYS.withdrawals,withdrawals);
    closeWizard();
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
    list.innerHTML=closings.map(c=>{
        const clr=c.totalNet>=0?'income':'expense';
        const mgr=c.manager?`<span style="color:var(--primary);font-size:.75rem"><i class="ri-user-star-line"></i> ${c.manager}</span>`:'';
        return `<div class="record-card">
        <div class="rec-info"><div class="rec-title">${c.date} ${mgr}</div><div class="rec-sub">${CASHIERS.map(cs=>cs.label).join(' | ')}</div></div>
        <div class="rec-amount ${clr}">${fmtNum(c.totalNet)} ${cur}</div>
        <div class="rec-actions"><button onclick="editClosing('${c.id}')" title="تعديل"><i class="ri-edit-line"></i></button><button onclick="printClosing('${c.id}')"><i class="ri-printer-line"></i></button><button onclick="deleteClosing('${c.id}')"><i class="ri-delete-bin-line"></i></button></div>
    </div>`;}).join('');
}
function deleteClosing(id){
    if(!confirm('حذف التقفيلة؟'))return;
    let arr=loadData(KEYS.closings);arr=arr.filter(c=>c.id!==id);saveData(KEYS.closings,arr);
    toast('تم الحذف');renderClosings();
}
function editClosing(id){
    const closings=loadData(KEYS.closings);
    const cl=closings.find(c=>c.id===id);if(!cl)return;
    const s=loadSettings();const cur=s.currency||'د.ع';
    let html=`<div class="field"><label>التاريخ</label><input type="date" id="editClDate" class="input-field" value="${cl.date}"></div>`;
    html+=`<div class="field"><label>المدير</label><input type="text" id="editClManager" class="input-field" value="${cl.manager||''}"></div>`;
    CASHIERS.forEach(c=>{
        const d=cl.cashiers[c.key]||{};
        html+=`<h4 style="margin:10px 0 6px;color:${c.color}">${c.label}</h4>`;
        CASHIER_FIELDS.forEach(f=>{
            html+=`<div class="field"><label>${f.label}</label><input type="number" id="editCl_${c.key}_${f.key}" class="input-field" value="${d[f.key]||0}"></div>`;
        });
    });
    openModal('تعديل التقفيلة',html,`<button class="btn btn-success" onclick="saveEditClosing('${id}')">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function saveEditClosing(id){
    const closings=loadData(KEYS.closings);
    const idx=closings.findIndex(c=>c.id===id);if(idx<0)return;
    const cl=closings[idx];
    cl.date=$('#editClDate').value||cl.date;
    cl.manager=$('#editClManager').value.trim();
    let totalNet=0;
    CASHIERS.forEach(c=>{
        CASHIER_FIELDS.forEach(f=>{
            cl.cashiers[c.key][f.key]=parseFloat($(`#editCl_${c.key}_${f.key}`).value)||0;
        });
        const d=cl.cashiers[c.key];
        const net=d.network||0;
        d.net=net;
        totalNet+=net;
    });
    cl.totalNet=totalNet;
    closings[idx]=cl;
    saveData(KEYS.closings,closings);
    closeModal();toast('تم التحديث');renderClosings();
}

/* ========= PRINT CLOSING ========= */
function printClosing(id){
    const cl=loadData(KEYS.closings).find(c=>c.id===id);if(!cl)return;
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    let html=`<div class="print-header"><h2>تقفيلة يومية</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">${cl.date}</p></div>`;
    if(cl.manager)html+=`<div class="print-manager"><i class="ri-user-star-line"></i> المدير المسؤول: ${cl.manager}</div>`;

    CASHIERS.forEach(c=>{
        const d=cl.cashiers[c.key];if(!d)return;
        const deductions=(d.returns||0)+(d.expenses||0)+(d.lunch||0)+(d.debts||0)+(d.withdrawals||0);
        html+=`<div class="print-section"><h3>${c.label}</h3><table class="print-compact-table"><tbody>`;
        CASHIER_FIELDS.forEach(f=>{
            const v=d[f.key]||0;
            const pClr=getPrintColorClass(f.type);
            html+=`<tr><td>${f.label}</td><td class="print-amount ${pClr}">${fmtNum(v)} ${cur}</td></tr>`;
        });
        html+=`<tr style="border-top:1px solid #999"><td>إجمالي الخصومات</td><td class="print-amount p-expense">${fmtNum(deductions)} ${cur}</td></tr>`;
        const net=d.net||0;
        html+=`<tr style="border-top:2px solid #333;font-weight:800"><td>الصافي (المبلغ المستلم)</td><td class="print-amount" style="color:${net>=0?'#16a34a':'#dc2626'}">${fmtNum(net)} ${cur}</td></tr>`;
        html+=`</tbody></table>`;
        /* print debts list */
        if(d.debtsList&&d.debtsList.length){
            html+=`<table class="print-compact-table" style="margin-top:2px"><tr><th colspan="3" style="font-size:7pt;color:#ef4444">تفاصيل الديون</th></tr>`;
            d.debtsList.forEach(db=>html+=`<tr><td>${db.person}</td><td class="p-debt">${fmtNum(db.amount)}</td><td>${db.note||''}</td></tr>`);
            html+=`</table>`;
        }
        if(d.withdrawList&&d.withdrawList.length){
            html+=`<table class="print-compact-table" style="margin-top:2px"><tr><th colspan="3" style="font-size:7pt;color:#d97706">تفاصيل السحوبات</th></tr>`;
            d.withdrawList.forEach(w=>html+=`<tr><td>${w.person}</td><td class="p-withdraw">${fmtNum(w.amount)}</td><td>${w.note||''}</td></tr>`);
            html+=`</table>`;
        }
        html+=`</div>`;
    });
    html+=`<div class="print-total" style="color:${cl.totalNet>=0?'#16a34a':'#dc2626'}">الإجمالي الكلي: ${fmtNum(cl.totalNet)} ${cur}</div>`;
    doPrint(html);
}
function getPrintColorClass(type){
    const m={income:'p-income',expense:'p-expense',debt:'p-debt',withdraw:'p-withdraw',deduct:'p-deduct'};
    return m[type]||'';
}

/* ========= SAFE ========= */
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
    let html='';
    Object.keys(groups).sort((a,b)=>b.localeCompare(a)).forEach(date=>{
        html+=`<div style="font-size:.82rem;font-weight:700;color:var(--text2);margin:10px 0 4px;padding:4px 8px;background:var(--bg);border-radius:6px">${date}</div>`;
        groups[date].forEach(t=>{
            const isDep=t.type==='deposit';
            const clr=isDep?'income':'expense';
            const sign=isDep?'+':'-';
            html+=`<div class="record-card"><div class="rec-info"><div class="rec-title">${t.note||t.type}</div><div class="rec-sub">${t.date}</div></div>
            <div class="rec-amount ${clr}">${sign}${fmtNum(t.amount)} ${cur}</div></div>`;
        });
    });
    list.innerHTML=html;
}
function safeTransaction(type){
    openModal(type==='deposit'?'إيداع في الخزنة':'سحب من الخزنة',`
    <div class="field"><label>المبلغ</label><input type="number" id="safeAmountInput" class="input-field" inputmode="decimal"></div>
    <div class="field"><label>ملاحظة</label><input type="text" id="safeNoteInput" class="input-field"></div>`,
    `<button class="btn btn-success" onclick="confirmSafeTrans('${type}')">تأكيد</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function confirmSafeTrans(type){
    const amount=parseFloat($('#safeAmountInput').value)||0;
    const note=$('#safeNoteInput').value||'';
    if(!amount)return toast('أدخل المبلغ');
    const safe=loadData(KEYS.safe);
    safe.push({id:uid(),date:today(),type,amount,note});
    saveData(KEYS.safe,safe);
    closeModal();toast('تم بنجاح');renderSafe();
}

/* safe print */
function safePrint(){
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const trans=loadData(KEYS.safe).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    let html=`<div class="print-header"><h2>كشف الخزنة</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">${today()}</p></div>`;
    html+=`<table class="print-compact-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>`;
    trans.forEach(t=>{
        const isDep=t.type==='deposit';
        const clr=isDep?'p-income':'p-expense';
        const sign=isDep?'+':'-';
        html+=`<tr><td>${t.date}</td><td>${isDep?'إيداع':'سحب'}</td><td class="${clr}">${sign}${fmtNum(t.amount)} ${cur}</td><td>${t.note||''}</td></tr>`;
    });
    html+=`</tbody></table>`;
    html+=`<div class="print-total" style="color:${getSafeBalance()>=0?'#16a34a':'#dc2626'}">الرصيد: ${fmtNum(getSafeBalance())} ${cur}</div>`;
    doPrint(html);
}

/* safe export CSV */
function safeExport(){
    const trans=loadData(KEYS.safe);
    if(!trans.length)return toast('لا توجد بيانات');
    let csv='\uFEFF"التاريخ","النوع","المبلغ","ملاحظة"\n';
    trans.forEach(t=>{csv+=`"${t.date}","${t.type==='deposit'?'إيداع':'سحب'}","${t.amount}","${t.note||''}"\n`;});
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='safe_'+today()+'.csv';a.click();
    toast('تم التصدير');
}

/* ========= DEBTS ========= */
let debtTab='employees';
function renderDebts(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const debts=loadData(KEYS.debts);
    const emps=loadData(KEYS.employees).map(e=>e.name);
    const searchVal=($('#debtsSearch')?.value||'').trim().toLowerCase();

    /* tab buttons */
    $$('[data-dtab]').forEach(b=>{b.classList.toggle('active',b.dataset.dtab===debtTab);});

    let filtered=debtTab==='employees'?debts.filter(d=>emps.includes(d.person)):debts.filter(d=>!emps.includes(d.person));
    if(searchVal)filtered=filtered.filter(d=>d.person.toLowerCase().includes(searchVal)||(d.note||'').toLowerCase().includes(searchVal)||d.date.includes(searchVal));

    /* persons grid */
    const persons={};
    filtered.forEach(d=>{if(!persons[d.person])persons[d.person]=0;persons[d.person]+=d.amount;});
    const grid=$('#debtsPersonsList');
    const pKeys=Object.keys(persons);
    if(!pKeys.length){grid.innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا توجد ديون</p></div>';}
    else{grid.innerHTML=pKeys.map(p=>`<div class="person-card" onclick="showPersonDebts('${p}')"><div class="person-icon"><i class="ri-user-line"></i></div><div class="person-name">${p}</div><div class="person-amount">${fmtNum(persons[p])} ${cur}</div></div>`).join('');}

    /* all debts list */
    const allList=$('#debtsAllList');
    const sorted=filtered.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    allList.innerHTML=sorted.map(d=>{
        const clr=d.type==='withdraw'?'withdraw-clr':'debt-clr';
        const icon=d.type==='withdraw'?'ri-hand-coin-line':'ri-file-list-3-line';
        return `<div class="record-card"><div class="rec-info"><div class="rec-title"><i class="${icon}" style="color:${d.type==='withdraw'?'var(--clr-withdraw)':'var(--clr-debt)'}"></i> ${d.person}</div><div class="rec-sub">${d.date} - ${d.note||d.cashier||''}</div></div>
        <div class="rec-amount ${clr}">${fmtNum(d.amount)} ${cur}</div>
        <div class="rec-actions"><button onclick="editDebt('${d.id}')" title="تعديل"><i class="ri-edit-line"></i></button><button onclick="deleteDebt('${d.id}')"><i class="ri-delete-bin-line"></i></button></div></div>`;
    }).join('');

    /* total */
    const total=filtered.reduce((s,d)=>s+d.amount,0);
    $('#debtsTotalDisp').textContent=fmtNum(total)+' '+cur;
}
function deleteDebt(id){
    if(!confirm('حذف؟'))return;
    let arr=loadData(KEYS.debts);arr=arr.filter(d=>d.id!==id);saveData(KEYS.debts,arr);
    toast('تم الحذف');renderDebts();
}
function editDebt(id){
    const debts=loadData(KEYS.debts);
    const d=debts.find(x=>x.id===id);if(!d)return;
    openModal('تعديل الدين',`
    <div class="field"><label>الشخص</label><input type="text" id="editDebtPerson" class="input-field" value="${d.person}"></div>
    <div class="field"><label>المبلغ</label><input type="number" id="editDebtAmount" class="input-field" value="${d.amount}"></div>
    <div class="field"><label>ملاحظة</label><input type="text" id="editDebtNote" class="input-field" value="${d.note||''}"></div>
    <div class="field"><label>التاريخ</label><input type="date" id="editDebtDate" class="input-field" value="${d.date}"></div>`,
    `<button class="btn btn-success" onclick="saveEditDebt('${id}')">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function saveEditDebt(id){
    const debts=loadData(KEYS.debts);
    const idx=debts.findIndex(x=>x.id===id);if(idx<0)return;
    debts[idx].person=$('#editDebtPerson').value.trim()||debts[idx].person;
    debts[idx].amount=parseFloat($('#editDebtAmount').value)||debts[idx].amount;
    debts[idx].note=$('#editDebtNote').value.trim();
    debts[idx].date=$('#editDebtDate').value||debts[idx].date;
    saveData(KEYS.debts,debts);
    closeModal();toast('تم التحديث');renderDebts();
}
function showPersonDebts(person){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const debts=loadData(KEYS.debts).filter(d=>d.person===person);
    const total=debts.reduce((s,d)=>s+d.amount,0);
    let html=`<div style="text-align:center;margin-bottom:10px"><div style="font-size:.85rem;color:var(--text2)">إجمالي الديون</div><div style="font-size:1.4rem;font-weight:800;color:var(--danger)">${fmtNum(total)} ${cur}</div></div>`;
    html+=`<div class="records-list">`;
    debts.sort((a,b)=>(b.date||'').localeCompare(a.date||'')).forEach(d=>{
        const clr=d.type==='withdraw'?'withdraw-clr':'debt-clr';
        html+=`<div class="record-card"><div class="rec-info"><div class="rec-title">${d.type==='withdraw'?'سحب':'دين'}</div><div class="rec-sub">${d.date} - ${d.note||d.cashier||''}</div></div><div class="rec-amount ${clr}">${fmtNum(d.amount)} ${cur}</div></div>`;
    });
    html+=`</div><button class="btn btn-warning btn-block" onclick="printPersonDebts('${person}')" style="margin-top:10px"><i class="ri-printer-line"></i> طباعة</button>`;
    openModal('ديون '+person,html);
}
function printPersonDebts(person){
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const debts=loadData(KEYS.debts).filter(d=>d.person===person);
    const total=debts.reduce((s,d)=>s+d.amount,0);
    let html=`<div class="print-header"><h2>كشف ديون: ${person}</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">${today()}</p></div>`;
    html+=`<table class="print-compact-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>`;
    debts.forEach(d=>{
        const clr=d.type==='withdraw'?'p-withdraw':'p-debt';
        html+=`<tr><td>${d.date}</td><td>${d.type==='withdraw'?'سحب':'دين'}</td><td class="${clr}">${fmtNum(d.amount)} ${cur}</td><td>${d.note||''}</td></tr>`;
    });
    html+=`</tbody></table>`;
    html+=`<div class="print-total" style="color:#dc2626">الإجمالي: ${fmtNum(total)} ${cur}</div>`;
    closeModal();doPrint(html);
}

/* ========= EXPENSES ========= */
function renderExpenses(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const closings=loadData(KEYS.closings);
    const monthInput=$('#expFilterMonth');
    if(!monthInput.value)monthInput.value=today().slice(0,7);
    const ym=monthInput.value;
    const filtered=closings.filter(c=>c.date&&c.date.startsWith(ym));
    let expenses=[];
    filtered.forEach(c=>{
        CASHIERS.forEach(cs=>{
            const d=c.cashiers[cs.key];if(!d)return;
            if(d.expenses)expenses.push({date:c.date,cashier:cs.label,type:'مصاريف',amount:d.expenses});
            if(d.lunch)expenses.push({date:c.date,cashier:cs.label,type:'غداء',amount:d.lunch});
        });
    });
    const expSearch=($('#expSearch')?.value||'').trim().toLowerCase();
    if(expSearch)expenses=expenses.filter(e=>e.type.includes(expSearch)||e.cashier.toLowerCase().includes(expSearch)||e.date.includes(expSearch));
    const list=$('#expensesList');
    if(!expenses.length){list.innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا توجد مصاريف</p></div>';$('#expTotalDisp').textContent='0';return;}
    list.innerHTML=expenses.map(e=>`<div class="record-card"><div class="rec-info"><div class="rec-title">${e.type} - ${e.cashier}</div><div class="rec-sub">${e.date}</div></div><div class="rec-amount expense">${fmtNum(e.amount)} ${cur}</div></div>`).join('');
    const total=expenses.reduce((s,e)=>s+e.amount,0);
    $('#expTotalDisp').textContent=fmtNum(total)+' '+cur;
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
        const commission=calcCommission(e);
        return `<div class="emp-card" onclick="openEmployee('${e.id}')">
        <div class="emp-top"><span class="emp-name">${e.name}</span><span class="emp-role">${e.role||'موظف'}</span></div>
        <div class="emp-stats">
            <div class="emp-stat"><div class="emp-stat-label">الراتب</div><div class="emp-stat-val">${fmtNum(e.salary)} ${cur}</div></div>
            <div class="emp-stat"><div class="emp-stat-label">العمولة</div><div class="emp-stat-val" style="color:var(--clr-income)">${fmtNum(commission)} ${cur}</div></div>
        </div></div>`;
    }).join('');
}
function calcCommission(emp){
    if(!emp.commRate)return 0;
    return (emp.salesAmount||0)*(emp.commRate/100);
}
function openEmployee(id){
    const emps=loadData(KEYS.employees);
    const emp=emps.find(e=>e.id===id);
    if(!emp)return;
    const s=loadSettings();const cur=s.currency||'د.ع';
    const commission=calcCommission(emp);
    const totalOwed=(emp.salary||0)+commission;
    let html=`<div class="field"><label>الاسم</label><input type="text" id="empNameInput" class="input-field" value="${emp.name}"></div>
    <div class="field"><label>الوظيفة</label><input type="text" id="empRoleInput" class="input-field" value="${emp.role||''}"></div>
    <div class="field"><label>الراتب الأساسي</label><input type="number" id="empSalaryInput" class="input-field" value="${emp.salary||0}"></div>
    <div class="field"><label>مبلغ المبيعات (للعمولة)</label><input type="number" id="empSalesInput" class="input-field" value="${emp.salesAmount||0}"></div>
    <div class="field"><label>نسبة العمولة %</label><input type="number" id="empCommInput" class="input-field" value="${emp.commRate||0}"></div>
    <div style="background:var(--bg);padding:10px;border-radius:8px;margin-top:10px">
        <div style="display:flex;justify-content:space-between;font-size:.85rem"><span>العمولة:</span><span style="color:var(--clr-income);font-weight:700">${fmtNum(commission)} ${cur}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-top:4px"><span>المستحق الكلي:</span><span style="font-weight:800;color:var(--primary)">${fmtNum(totalOwed)} ${cur}</span></div>
    </div>`;
    openModal('تعديل الموظف',html,`<button class="btn btn-success" onclick="saveEmployee('${id}')">حفظ</button><button class="btn btn-danger" onclick="deleteEmployee('${id}')">حذف</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function addEmployee(){
    openModal('إضافة موظف',`
    <div class="field"><label>الاسم</label><input type="text" id="empNameInput" class="input-field"></div>
    <div class="field"><label>الوظيفة</label><input type="text" id="empRoleInput" class="input-field"></div>
    <div class="field"><label>الراتب الأساسي</label><input type="number" id="empSalaryInput" class="input-field"></div>
    <div class="field"><label>مبلغ المبيعات (للعمولة)</label><input type="number" id="empSalesInput" class="input-field" value="0"></div>
    <div class="field"><label>نسبة العمولة %</label><input type="number" id="empCommInput" class="input-field" value="0"></div>`,
    `<button class="btn btn-success" onclick="saveEmployee()">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function saveEmployee(id){
    const name=$('#empNameInput').value.trim();
    if(!name)return toast('أدخل الاسم');
    const emps=loadData(KEYS.employees);
    const obj={
        id:id||uid(),
        name,
        role:$('#empRoleInput').value.trim(),
        salary:parseFloat($('#empSalaryInput').value)||0,
        salesAmount:parseFloat($('#empSalesInput').value)||0,
        commRate:parseFloat($('#empCommInput').value)||0
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
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const emps=loadData(KEYS.employees);
    if(!emps.length)return toast('لا يوجد موظفين');
    let html=`<div class="print-header"><h2>كشف الرواتب</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">${today()}</p></div>`;
    html+=`<table class="print-compact-table"><thead><tr><th>الموظف</th><th>الوظيفة</th><th>الراتب</th><th>العمولة</th><th>المستحق</th></tr></thead><tbody>`;
    let totalOwed=0;
    emps.forEach(e=>{
        const comm=calcCommission(e);
        const owed=(e.salary||0)+comm;
        totalOwed+=owed;
        html+=`<tr><td>${e.name}</td><td>${e.role||''}</td><td>${fmtNum(e.salary)}</td><td class="p-income">${fmtNum(comm)}</td><td style="font-weight:700">${fmtNum(owed)} ${cur}</td></tr>`;
    });
    html+=`</tbody></table>`;
    html+=`<div class="print-total">إجمالي المستحقات: ${fmtNum(totalOwed)} ${cur}</div>`;
    doPrint(html);
}

/* ========= PAYROLL ========= */
function renderPayroll(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const monthInput=$('#payrollMonth');
    if(!monthInput.value)monthInput.value=today().slice(0,7);
    const emps=loadData(KEYS.employees);
    const payroll=loadData(KEYS.payroll);
    const ym=monthInput.value;
    const list=$('#payrollList');

    if(!emps.length){list.innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا يوجد موظفين</p></div>';$('#payrollHistory').innerHTML='';return;}

    list.innerHTML=emps.map(e=>{
        const comm=calcCommission(e);
        const owed=(e.salary||0)+comm;
        const paid=payroll.filter(p=>p.empId===e.id&&p.month===ym).reduce((s,p)=>s+p.amount,0);
        const remaining=owed-paid;
        return `<div class="emp-card">
        <div class="emp-top"><span class="emp-name">${e.name}</span><span class="emp-role">${e.role||'موظف'}</span></div>
        <div class="emp-stats">
            <div class="emp-stat"><div class="emp-stat-label">المستحق</div><div class="emp-stat-val">${fmtNum(owed)}</div></div>
            <div class="emp-stat"><div class="emp-stat-label">المسلّم</div><div class="emp-stat-val" style="color:var(--clr-income)">${fmtNum(paid)}</div></div>
            <div class="emp-stat"><div class="emp-stat-label">المتبقي</div><div class="emp-stat-val" style="color:${remaining>0?'var(--clr-expense)':'var(--clr-income)'}">${fmtNum(remaining)}</div></div>
        </div>
        <button class="btn btn-success btn-block btn-sm" style="margin-top:8px" onclick="disbursePayroll('${e.id}','${e.name}',${owed},${paid})"><i class="ri-hand-coin-line"></i> صرف</button>
        </div>`;
    }).join('');

    /* history */
    const history=payroll.filter(p=>p.month===ym).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    const hList=$('#payrollHistory');
    if(!history.length){hList.innerHTML='<div class="empty-state"><i class="ri-inbox-line"></i><p>لا توجد سجلات</p></div>';return;}
    hList.innerHTML=history.map(p=>`<div class="record-card"><div class="rec-info"><div class="rec-title">${p.empName}</div><div class="rec-sub">${p.date} - ${p.note||''}</div></div><div class="rec-amount expense">${fmtNum(p.amount)} ${cur}</div>
    <div class="rec-actions"><button onclick="deletePayrollEntry('${p.id}')"><i class="ri-delete-bin-line"></i></button></div></div>`).join('');
}
function disbursePayroll(empId,empName,owed,paid){
    const remaining=owed-paid;
    openModal('صرف راتب '+empName,`
    <div style="background:var(--bg);padding:10px;border-radius:8px;margin-bottom:10px;font-size:.85rem"><span>المتبقي: </span><strong style="color:${remaining>0?'var(--danger)':'var(--success)'}">${fmtNum(remaining)}</strong></div>
    <div class="field"><label>المبلغ</label><input type="number" id="payAmountInput" class="input-field" value="${remaining>0?remaining:0}" inputmode="decimal"></div>
    <div class="field"><label>ملاحظة</label><input type="text" id="payNoteInput" class="input-field"></div>`,
    `<button class="btn btn-success" onclick="confirmDisburse('${empId}','${empName}')">تأكيد</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function confirmDisburse(empId,empName){
    const amount=parseFloat($('#payAmountInput').value)||0;
    const note=$('#payNoteInput').value||'';
    if(!amount)return toast('أدخل المبلغ');
    const ym=$('#payrollMonth').value||today().slice(0,7);
    const payroll=loadData(KEYS.payroll);
    payroll.push({id:uid(),empId,empName,amount,note,date:today(),month:ym});
    saveData(KEYS.payroll,payroll);
    /* deduct from safe */
    const safe=loadData(KEYS.safe);
    safe.push({id:uid(),date:today(),type:'withdraw',amount,note:'راتب: '+empName+' '+(note?'- '+note:'')});
    saveData(KEYS.safe,safe);
    closeModal();toast('تم صرف الراتب');renderPayroll();
}
function deletePayrollEntry(id){
    if(!confirm('حذف؟'))return;
    let arr=loadData(KEYS.payroll);arr=arr.filter(p=>p.id!==id);saveData(KEYS.payroll,arr);
    toast('تم الحذف');renderPayroll();
}
function printPayroll(){
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const ym=$('#payrollMonth').value||today().slice(0,7);
    const emps=loadData(KEYS.employees);
    const payroll=loadData(KEYS.payroll).filter(p=>p.month===ym);
    let html=`<div class="print-header"><h2>كشف صرف الرواتب - ${ym}</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">${today()}</p></div>`;
    html+=`<table class="print-compact-table"><thead><tr><th>الموظف</th><th>المستحق</th><th>المسلّم</th><th>المتبقي</th></tr></thead><tbody>`;
    emps.forEach(e=>{
        const comm=calcCommission(e);
        const owed=(e.salary||0)+comm;
        const paid=payroll.filter(p=>p.empId===e.id).reduce((s,p)=>s+p.amount,0);
        const rem=owed-paid;
        html+=`<tr><td>${e.name}</td><td>${fmtNum(owed)}</td><td class="p-income">${fmtNum(paid)}</td><td class="${rem>0?'p-expense':''}" style="font-weight:700">${fmtNum(rem)} ${cur}</td></tr>`;
    });
    html+=`</tbody></table>`;
    /* receipts detail */
    if(payroll.length){
        html+=`<h3 style="margin-top:6px">تفاصيل الصرف</h3><table class="print-compact-table"><thead><tr><th>التاريخ</th><th>الموظف</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>`;
        payroll.forEach(p=>html+=`<tr><td>${p.date}</td><td>${p.empName}</td><td class="p-expense">${fmtNum(p.amount)} ${cur}</td><td>${p.note||''}</td></tr>`);
        html+=`</tbody></table>`;
    }
    doPrint(html);
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
    list.innerHTML=trans.map(t=>{
        const isDep=t.type==='deposit';
        const clr=isDep?'income':'expense';
        const sign=isDep?'+':'-';
        return `<div class="record-card"><div class="rec-info"><div class="rec-title">${t.note||t.type}</div><div class="rec-sub">${t.date}</div></div>
        <div class="rec-amount ${clr}">${sign}${fmtNum(t.amount)} ${cur}</div></div>`;
    }).join('');
}
function capitalTransaction(type){
    openModal(type==='deposit'?'إضافة رأس مال':'سحب من رأس المال',`
    <div class="field"><label>المبلغ</label><input type="number" id="capitalAmountInput" class="input-field" inputmode="decimal"></div>
    <div class="field"><label>ملاحظة</label><input type="text" id="capitalNoteInput" class="input-field"></div>`,
    `<button class="btn btn-success" onclick="confirmCapitalTrans('${type}')">تأكيد</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function confirmCapitalTrans(type){
    const amount=parseFloat($('#capitalAmountInput').value)||0;
    const note=$('#capitalNoteInput').value||'';
    if(!amount)return toast('أدخل المبلغ');
    /* capital goes to safe */
    const safe=loadData(KEYS.safe);
    safe.push({id:uid(),date:today(),type,amount,note:'رأس مال: '+(note||type)});
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
    list.innerHTML=purchases.map(p=>`<div class="record-card"><div class="rec-info"><div class="rec-title">${p.desc||'شراء'}</div><div class="rec-sub">${p.date}</div></div>
    <div class="rec-amount expense">${fmtNum(p.amount)} ${cur}</div>
    <div class="rec-actions"><button onclick="deletePurchase('${p.id}')"><i class="ri-delete-bin-line"></i></button></div></div>`).join('');
    const total=purchases.reduce((s,p)=>s+p.amount,0);
    $('#purchTotalDisp').textContent=fmtNum(total)+' '+cur;
}
function addPurchase(){
    openModal('إضافة عملية شراء',`
    <div class="field"><label>الوصف</label><input type="text" id="purchDescInput" class="input-field"></div>
    <div class="field"><label>المبلغ</label><input type="number" id="purchAmountInput" class="input-field" inputmode="decimal"></div>`,
    `<button class="btn btn-success" onclick="confirmPurchase()">حفظ</button><button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}
function confirmPurchase(){
    const desc=$('#purchDescInput').value.trim();
    const amount=parseFloat($('#purchAmountInput').value)||0;
    if(!amount)return toast('أدخل المبلغ');
    const purchases=loadData(KEYS.purchases);
    purchases.push({id:uid(),date:today(),desc,amount});
    saveData(KEYS.purchases,purchases);
    /* deduct from safe */
    const safe=loadData(KEYS.safe);
    safe.push({id:uid(),date:today(),type:'withdraw',amount,note:'مشتريات: '+(desc||'')});
    saveData(KEYS.safe,safe);
    closeModal();toast('تم الحفظ');renderPurchases();
}
function deletePurchase(id){
    if(!confirm('حذف؟'))return;
    let arr=loadData(KEYS.purchases);arr=arr.filter(p=>p.id!==id);saveData(KEYS.purchases,arr);
    toast('تم الحذف');renderPurchases();
}

/* ========= MONTHLY REPORT ========= */
function renderReport(){
    const s=loadSettings();const cur=s.currency||'د.ع';
    const monthInput=$('#reportMonth');
    if(!monthInput.value)monthInput.value=today().slice(0,7);
    const ym=monthInput.value;
    const closings=loadData(KEYS.closings).filter(c=>c.date&&c.date.startsWith(ym));
    const purchases=loadData(KEYS.purchases).filter(p=>p.date&&p.date.startsWith(ym));
    const payrollData=loadData(KEYS.payroll).filter(p=>p.month===ym);
    const content=$('#reportContent');

    /* totals */
    let totalSales=0,totalNet=0,totalExpenses=0,totalDebts=0,totalWithdrawals=0;
    closings.forEach(c=>{
        totalNet+=c.totalNet||0;
        CASHIERS.forEach(cs=>{
            const d=c.cashiers[cs.key];if(!d)return;
            totalSales+=(d.sales||0);
            totalExpenses+=(d.expenses||0)+(d.lunch||0);
            totalDebts+=(d.debts||0);
            totalWithdrawals+=(d.withdrawals||0);
        });
    });
    const totalPurchases=purchases.reduce((s,p)=>s+p.amount,0);
    const totalPayroll=payrollData.reduce((s,p)=>s+p.amount,0);

    let html='';
    /* summary */
    html+=`<div class="report-summary"><h3><i class="ri-bar-chart-box-fill"></i> ملخص شهر ${ym}</h3><div class="summary-grid">
    <div class="summary-item"><div class="s-label">إجمالي المبيعات</div><div class="s-val">${fmtNum(totalSales)}</div></div>
    <div class="summary-item"><div class="s-label">صافي التقفيلات</div><div class="s-val">${fmtNum(totalNet)}</div></div>
    <div class="summary-item"><div class="s-label">المصاريف</div><div class="s-val">${fmtNum(totalExpenses)}</div></div>
    <div class="summary-item"><div class="s-label">الديون</div><div class="s-val">${fmtNum(totalDebts)}</div></div>
    <div class="summary-item"><div class="s-label">المشتريات</div><div class="s-val">${fmtNum(totalPurchases)}</div></div>
    <div class="summary-item"><div class="s-label">الرواتب المصروفة</div><div class="s-val">${fmtNum(totalPayroll)}</div></div>
    </div></div>`;

    /* closings table */
    if(closings.length){
        html+=`<div class="report-section"><h3><i class="ri-calculator-fill"></i> التقفيلات (${closings.length})</h3><table class="report-table"><thead><tr><th>التاريخ</th><th>المدير</th><th>الصافي</th></tr></thead><tbody>`;
        closings.forEach(c=>{
            const clr=c.totalNet>=0?'color:var(--clr-income)':'color:var(--clr-expense)';
            html+=`<tr><td>${c.date}</td><td>${c.manager||'-'}</td><td style="${clr};font-weight:700">${fmtNum(c.totalNet)} ${cur}</td></tr>`;
        });
        html+=`<tr class="total-row"><td colspan="2">الإجمالي</td><td>${fmtNum(totalNet)} ${cur}</td></tr></tbody></table></div>`;
    }

    /* purchases */
    if(purchases.length){
        html+=`<div class="report-section"><h3><i class="ri-shopping-cart-2-fill"></i> المشتريات (${purchases.length})</h3><table class="report-table"><thead><tr><th>التاريخ</th><th>الوصف</th><th>المبلغ</th></tr></thead><tbody>`;
        purchases.forEach(p=>html+=`<tr><td>${p.date}</td><td>${p.desc||''}</td><td class="p-expense" style="font-weight:700">${fmtNum(p.amount)} ${cur}</td></tr>`);
        html+=`<tr class="total-row"><td colspan="2">الإجمالي</td><td>${fmtNum(totalPurchases)} ${cur}</td></tr></tbody></table></div>`;
    }

    content.innerHTML=html||'<div class="empty-state"><i class="ri-bar-chart-box-line"></i><p>لا توجد بيانات لهذا الشهر</p></div>';
}
function printReport(){
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const ym=$('#reportMonth').value||today().slice(0,7);
    const closings=loadData(KEYS.closings).filter(c=>c.date&&c.date.startsWith(ym));
    const purchases=loadData(KEYS.purchases).filter(p=>p.date&&p.date.startsWith(ym));
    const payrollData=loadData(KEYS.payroll).filter(p=>p.month===ym);

    let totalSales=0,totalNet=0,totalExpenses=0,totalDebts=0,totalWithdrawals=0;
    closings.forEach(c=>{totalNet+=c.totalNet||0;CASHIERS.forEach(cs=>{const d=c.cashiers[cs.key];if(!d)return;totalSales+=(d.sales||0);totalExpenses+=(d.expenses||0)+(d.lunch||0);totalDebts+=(d.debts||0);totalWithdrawals+=(d.withdrawals||0);});});
    const totalPurchases=purchases.reduce((s,p)=>s+p.amount,0);
    const totalPayroll=payrollData.reduce((s,p)=>s+p.amount,0);

    let html=`<div class="print-header"><h2>التقرير الشهري - ${ym}</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">${today()}</p></div>`;
    html+=`<div class="print-summary-box"><span>مبيعات: ${fmtNum(totalSales)}</span><span>صافي: ${fmtNum(totalNet)}</span><span>مصاريف: ${fmtNum(totalExpenses)}</span></div>`;
    html+=`<div class="print-summary-box"><span>ديون: ${fmtNum(totalDebts)}</span><span>مشتريات: ${fmtNum(totalPurchases)}</span><span>رواتب: ${fmtNum(totalPayroll)}</span></div>`;

    if(closings.length){
        html+=`<h3>التقفيلات</h3><table class="print-compact-table"><thead><tr><th>التاريخ</th><th>المدير</th><th>الصافي</th></tr></thead><tbody>`;
        closings.forEach(c=>html+=`<tr><td>${c.date}</td><td>${c.manager||'-'}</td><td style="color:${c.totalNet>=0?'#16a34a':'#dc2626'};font-weight:700">${fmtNum(c.totalNet)} ${cur}</td></tr>`);
        html+=`</tbody></table>`;
    }
    if(purchases.length){
        html+=`<h3>المشتريات</h3><table class="print-compact-table"><thead><tr><th>التاريخ</th><th>الوصف</th><th>المبلغ</th></tr></thead><tbody>`;
        purchases.forEach(p=>html+=`<tr><td>${p.date}</td><td>${p.desc||''}</td><td style="color:#dc2626">${fmtNum(p.amount)} ${cur}</td></tr>`);
        html+=`</tbody></table>`;
    }
    html+=`<div class="print-total">رصيد الخزنة / رأس المال: ${fmtNum(getSafeBalance())} ${cur}</div>`;
    doPrint(html);
}

/* ========= SETTINGS ========= */
function renderSettings(){
    const s=loadSettings();
    $('#setStoreName').value=s.storeName||'';
    $('#setCurrency').value=s.currency||'د.ع';
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
            Object.entries(KEYS).forEach(([k,v])=>{if(data[k])localStorage.setItem(v,JSON.stringify(data[k]));});
            toast('تم الاستيراد بنجاح');
            navigate('home');
        }catch(err){toast('ملف غير صالح');}
    };
    reader.readAsText(file);
}
function loadDemo(){
    if(!confirm('سيتم تحميل بيانات تجريبية. متابعة؟'))return;
    const d=today();
    const emp1={id:uid(),name:'أحمد محمد',role:'كاشير رجال',salary:3000,salesAmount:50000,commRate:2};
    const emp2={id:uid(),name:'فاطمة علي',role:'كاشير نساء',salary:2800,salesAmount:40000,commRate:1.5};
    const emp3={id:uid(),name:'سارة حسين',role:'كاشير تجميل',salary:2500,salesAmount:30000,commRate:2};
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
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const debts=loadData(KEYS.debts);
    let html=`<div class="print-header"><h2>سجل الديون</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">${today()}</p></div>`;
    html+=`<table class="print-compact-table"><thead><tr><th>الشخص</th><th>المبلغ</th><th>ملاحظة</th><th>التاريخ</th></tr></thead><tbody>`;
    let total=0;
    debts.forEach(d=>{
        total+=d.amount;
        html+=`<tr><td>${d.person}</td><td>${fmtNum(d.amount)} ${cur}</td><td>${d.note||d.cashier||''}</td><td>${d.date}</td></tr>`;
    });
    html+=`</tbody></table>`;
    html+=`<div class="print-total">الإجمالي: ${fmtNum(total)} ${cur}</div>`;
    doPrint(html);
}

/* ========= PRINT EXPENSES ========= */
function printExpenses(){
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const ym=$('#expFilterMonth')?.value||'';
    let closings=loadData(KEYS.closings);
    if(ym)closings=closings.filter(c=>c.date&&c.date.startsWith(ym));
    let expenses=[];
    closings.forEach(c=>{
        CASHIERS.forEach(cs=>{
            const d=c.cashiers[cs.key];if(!d)return;
            if(d.expenses)expenses.push({date:c.date,cashier:cs.label,type:'مصاريف',amount:d.expenses});
            if(d.lunch)expenses.push({date:c.date,cashier:cs.label,type:'غداء',amount:d.lunch});
        });
    });
    let html=`<div class="print-header"><h2>سجل المصاريف${ym?' - '+ym:''}</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">${today()}</p></div>`;
    html+=`<table class="print-compact-table"><thead><tr><th>التاريخ</th><th>الكاشير</th><th>النوع</th><th>المبلغ</th></tr></thead><tbody>`;
    let total=0;
    expenses.forEach(e=>{total+=e.amount;html+=`<tr><td>${e.date}</td><td>${e.cashier}</td><td>${e.type}</td><td>${fmtNum(e.amount)} ${cur}</td></tr>`;});
    html+=`</tbody></table>`;
    html+=`<div class="print-total">الإجمالي: ${fmtNum(total)} ${cur}</div>`;
    doPrint(html);
}

/* ========= PRINT PURCHASES ========= */
function printPurchases(){
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const purchases=loadData(KEYS.purchases).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    let html=`<div class="print-header"><h2>سجل المشتريات</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">${today()}</p></div>`;
    html+=`<table class="print-compact-table"><thead><tr><th>التاريخ</th><th>الوصف</th><th>المبلغ</th></tr></thead><tbody>`;
    let total=0;
    purchases.forEach(p=>{total+=p.amount;html+=`<tr><td>${p.date}</td><td>${p.desc||''}</td><td>${fmtNum(p.amount)} ${cur}</td></tr>`;});
    html+=`</tbody></table>`;
    html+=`<div class="print-total">الإجمالي: ${fmtNum(total)} ${cur}</div>`;
    doPrint(html);
}

/* ========= PRINT CAPITAL ========= */
function printCapital(){
    const s=loadSettings();const cur=s.currency||'د.ع';const store=s.storeName||'';
    const trans=loadData(KEYS.safe).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
    let html=`<div class="print-header"><h2>سجل رأس المال</h2>`;
    if(store)html+=`<p>${store}</p>`;
    html+=`<p class="print-date">${today()}</p></div>`;
    html+=`<div class="print-summary-box"><span>الرصيد الحالي: ${fmtNum(getSafeBalance())} ${cur}</span></div>`;
    html+=`<table class="print-compact-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th></tr></thead><tbody>`;
    trans.forEach(t=>{
        const type=t.type==='deposit'?'إيداع':'سحب';
        const clr=t.type==='deposit'?'color:#16a34a':'color:#dc2626';
        html+=`<tr><td>${t.date}</td><td>${type}</td><td style="${clr};font-weight:700">${fmtNum(t.amount)} ${cur}</td><td>${t.note||''}</td></tr>`;
    });
    html+=`</tbody></table>`;
    doPrint(html);
}

/* ========= PRINT HELPER ========= */
function doPrint(html){
    const area=$('#printArea');
    area.innerHTML=html;
    setTimeout(()=>window.print(),200);
}

/* ========= INIT ========= */
document.addEventListener('DOMContentLoaded',()=>{
    showDate();

    /* sidebar */
    $('#sidebarToggle').addEventListener('click',()=>{$('#sidebar').classList.add('open');$('#sbOverlay').classList.add('show');});
    $('#closeSidebar').addEventListener('click',closeSidebar);
    $('#sbOverlay').addEventListener('click',closeSidebar);
    $$('.sb-item').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.page)));

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

    /* debts tabs */
    $$('[data-dtab]').forEach(b=>b.addEventListener('click',()=>{debtTab=b.dataset.dtab;renderDebts();}));

    /* expenses */
    $('#expFilterBtn').addEventListener('click',renderExpenses);

    /* salaries */
    $('#addEmployeeBtn').addEventListener('click',addEmployee);
    $('#printAllSalBtn').addEventListener('click',printAllSalaries);

    /* payroll */
    $('#payrollFilterBtn').addEventListener('click',renderPayroll);
    $('#printPayrollBtn').addEventListener('click',printPayroll);

    /* capital */
    $('#capitalAddBtn').addEventListener('click',()=>capitalTransaction('deposit'));
    $('#capitalWithdrawBtn').addEventListener('click',()=>capitalTransaction('withdraw'));

    /* purchases */
    $('#addPurchaseBtn').addEventListener('click',addPurchase);

    /* report */
    $('#reportFilterBtn').addEventListener('click',renderReport);
    $('#printReportBtn').addEventListener('click',printReport);

    /* settings */
    $('#saveSettingsBtn').addEventListener('click',saveSettingsForm);
    $('#exportBtn').addEventListener('click',exportData);
    $('#importBtn').addEventListener('click',()=>$('#importFile').click());
    $('#importFile').addEventListener('change',e=>{if(e.target.files[0])importData(e.target.files[0]);});
    $('#demoBtn').addEventListener('click',loadDemo);
    $('#clearBtn').addEventListener('click',clearAll);

    /* modal */
    $('#modalClose').addEventListener('click',closeModal);
    $('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))closeModal();});

    /* global search */
    $('#globalSearchBtn').addEventListener('click',globalSearch);
    $('#globalSearch').addEventListener('keydown',e=>{if(e.key==='Enter')globalSearch();});
    $('#globalSearch').addEventListener('input',()=>{if(!$('#globalSearch').value.trim()){$('#globalSearchResults').style.display='none';$('#homeGrid').style.display='';}});

    /* print buttons */
    const printDebtsBtn=$('#printDebtsBtn');if(printDebtsBtn)printDebtsBtn.addEventListener('click',printDebts);
    const printExpBtn=$('#printExpBtn');if(printExpBtn)printExpBtn.addEventListener('click',printExpenses);
    const printPurchBtn=$('#printPurchBtn');if(printPurchBtn)printPurchBtn.addEventListener('click',printPurchases);
    const printCapitalBtn=$('#printCapitalBtn');if(printCapitalBtn)printCapitalBtn.addEventListener('click',printCapital);

    /* search inputs - Enter key */
    ['closingSearch','safeSearch','debtsSearch','expSearch','salSearch','purchSearch','capitalSearch'].forEach(id=>{
        const el=$('#'+id);
        if(el)el.addEventListener('keydown',e=>{if(e.key==='Enter'){
            if(id==='closingSearch')renderClosings();
            else if(id==='safeSearch')renderSafe();
            else if(id==='debtsSearch')renderDebts();
            else if(id==='expSearch')renderExpenses();
            else if(id==='salSearch')renderSalaries();
            else if(id==='purchSearch')renderPurchases();
            else if(id==='capitalSearch')renderCapital();
        }});
    });

    /* service worker */
    if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js');}
});
