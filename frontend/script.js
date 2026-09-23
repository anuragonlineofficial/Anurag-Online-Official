// ============================================
// CONFIG
// ============================================
const DB_URL="https://anuragonline-43a15-default-rtdb.asia-southeast1.firebasedatabase.app";
const DB_SECRET="vaTvZgPALWoBh1K4zS2Ocxqlqv3ExhsL7tja2QCe";
const DEFAULT_ADMIN_USERNAME="admin";
const DEFAULT_ADMIN_PASSWORD="admin123";

// 🔥 BACKEND URL (Render)
const BACKEND_URL = "https://anurag-online-backend.onrender.com";

// 📱 TELEGRAM
const TELEGRAM_BOT_TOKEN="YOUR_BOT_TOKEN_HERE";
const TELEGRAM_CHAT_ID="YOUR_CHAT_ID_HERE";

// 🔒 FIXED PRICES (display only — actual charge server par)
const PACKAGE_PRICES={7:2100,14:4200,21:6300,28:8400,35:10500,42:12600,49:14700};

// ============================================
// STATE
// ============================================
let DB={App_Status:{},Keys:{},Banned_HWIDs:{},Trials:{},Operators:{},Admin:{},PaymentRequests:{}};
let currentEditKey=null,currentKeyFilter='all',currentUser=null,currentEditOperator=null,selectedDays=0,syncInterval=null;
let cashfree=null;

// ============================================
// HELPERS
// ============================================
function ensureDBShape(d){
    if(!d||typeof d!=='object')d={};
    d.Keys=d.Keys||{};d.Banned_HWIDs=d.Banned_HWIDs||{};d.App_Status=d.App_Status||{};
    d.Trials=d.Trials||{};d.Operators=d.Operators||{};d.Admin=d.Admin||{};d.PaymentRequests=d.PaymentRequests||{};
    return d;
}

// ============================================
// CASHFREE SDK INIT (PRODUCTION)
// ============================================
async function initCashfree(){
    if(typeof Cashfree==='undefined'){console.log("Cashfree SDK not loaded");return;}
    cashfree=Cashfree({mode:"production"});
    console.log("Cashfree initialized in PRODUCTION mode");
}

// ============================================
// LOGIN
// ============================================
async function doLogin(){
    const btn=document.getElementById('login-btn');
    const username=document.getElementById('login-username').value.trim().toLowerCase();
    const password=document.getElementById('login-password').value.trim();

    if(!username||!password){showIsland("Enter Username & Password","error");return;}

    btn.innerHTML=`<i class="fas fa-spinner fa-spin"></i> CHECKING...`;
    btn.disabled=true;

    try{
        const res=await fetch(`${DB_URL}/.json?auth=${DB_SECRET}`);
        if(!res.ok)throw new Error("Connection failed");
        let data=await res.json();
        DB=ensureDBShape(data);

        let adminUser=DEFAULT_ADMIN_USERNAME,adminPass=DEFAULT_ADMIN_PASSWORD,adminCreated="Default";
        if(DB.Admin&&DB.Admin.Username&&DB.Admin.Password){
            adminUser=DB.Admin.Username;adminPass=DB.Admin.Password;
            adminCreated=DB.Admin.CreatedAt?new Date(DB.Admin.CreatedAt).toLocaleString():"Set";
        }

        if(username===adminUser&&password===adminPass){
            currentUser={role:'admin',username,created:adminCreated};
            completeLogin();return;
        }

        if(DB.Operators&&DB.Operators[username]){
            const op=DB.Operators[username];
            if(op.Password===password){
                if(op.Active===false){
                    showIsland("Account disabled! Contact Admin.","error");
                    btn.innerHTML=`<i class="fas fa-fingerprint" style="margin-right:8px"></i> LOGIN`;
                    btn.disabled=false;return;
                }
                currentUser={role:'operator',username};
                completeLogin();return;
            }
        }

        showIsland("Invalid username or password!","error");
        btn.innerHTML=`<i class="fas fa-fingerprint" style="margin-right:8px"></i> LOGIN`;
        btn.disabled=false;
    }catch(e){
        console.error(e);
        showIsland("Connection Error","error");
        btn.innerHTML=`<i class="fas fa-fingerprint" style="margin-right:8px"></i> LOGIN`;
        btn.disabled=false;
    }
}

function completeLogin(){
    document.getElementById('login-screen').style.display='none';
    document.getElementById('main-app').style.display='flex';
    document.getElementById('bottom-nav').style.display='flex';

    const badge=document.getElementById('user-badge');
    badge.textContent=currentUser.role.toUpperCase();
    badge.className='user-badge '+currentUser.role;

    const roleEl=document.getElementById('info-role');
    const userEl=document.getElementById('info-username');
    const createdEl=document.getElementById('info-created');
    if(roleEl)roleEl.textContent=currentUser.role.toUpperCase();
    if(userEl)userEl.textContent=currentUser.username;
    if(createdEl)createdEl.textContent=currentUser.created||"N/A";

    const adminNavs=['nav-bans','nav-trials','nav-operators','nav-system'];
    if(currentUser.role==='admin'){
        adminNavs.forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='flex';});
    }else{
        adminNavs.forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
    }

    loadAppStatus();
    renderKeys();
    if(currentUser.role==='admin'){
        renderBans();renderTrials();renderOperators();
    }

    showIsland("Welcome "+currentUser.username+"!","success","fa-unlock-alt");

    if(syncInterval)clearInterval(syncInterval);
    syncInterval=setInterval(silentBackgroundSync,10000);
}

// ============================================
// FETCH / SYNC
// ============================================
async function fetchDatabase(){
    const icon=document.getElementById('reload-icon');
    icon.classList.add('spin');
    try{
        const res=await fetch(`${DB_URL}/.json?auth=${DB_SECRET}`);
        if(res.ok){
            let data=await res.json();
            DB=ensureDBShape(data);
            loadAppStatus();renderKeys();
            if(currentUser&&currentUser.role==='admin'){
                renderBans();renderTrials();renderOperators();
            }
            showIsland("Database Synced","success","fa-sync-alt");
        }
    }catch(e){console.error(e);showIsland("Sync failed","error");}
    icon.classList.remove('spin');
}

async function silentBackgroundSync(){
    if(!currentUser)return;
    try{
        const res=await fetch(`${DB_URL}/.json?auth=${DB_SECRET}`);
        if(res.ok){
            let data=await res.json();
            if(data&&typeof data==='object'){
                DB.Keys=data.Keys||{};DB.Banned_HWIDs=data.Banned_HWIDs||{};DB.Trials=data.Trials||{};
                DB.Operators=data.Operators||{};DB.PaymentRequests=data.PaymentRequests||{};
                renderKeys();
                if(currentUser.role==='admin'){
                    renderBans();renderTrials();renderOperators();
                }
            }
        }
    }catch(e){}
}

async function syncNode(path,obj){
    try{
        const opts={method:obj===null?'DELETE':'PUT'};
        if(obj!==null)opts.body=JSON.stringify(obj);
        await fetch(`${DB_URL}/${path}.json?auth=${DB_SECRET}`,opts);
    }catch(e){console.error(e);showIsland("Sync Error","error");}
}

// ============================================
// TELEGRAM
// ============================================
async function sendTelegramNotification(keyId,days,limit,amount,operator){
    if(!TELEGRAM_BOT_TOKEN||TELEGRAM_BOT_TOKEN==="YOUR_BOT_TOKEN_HERE")return;
    try{
        const message=`🔔 *NEW PAYMENT RECEIVED*\n\n🔑 *Key:* \`${keyId}\`\n📅 *Days:* ${days}\n📱 *Devices:* ${limit}\n💰 *Amount:* ₹${amount}\n👤 *Operator:* ${operator}\n💳 *Gateway:* Cashfree\n⚠️ *NON-REFUNDABLE*\n\n👉 Admin Panel me approve karein!`;
        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({chat_id:TELEGRAM_CHAT_ID,text:message,parse_mode:'Markdown'})
        });
    }catch(e){console.error(e);}
}

// ============================================
// NAVIGATION
// ============================================
function nav(viewId,el,title,subtitle){
    if(currentUser&&currentUser.role==='operator'&&['bans','trials','operators','system'].includes(viewId)){
        showIsland("Access Denied!","error");return;
    }
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    const t=document.getElementById('view-'+viewId);
    if(t)t.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    if(el)el.classList.add('active');
    document.getElementById('page-subtitle-text').innerText=subtitle;
    if(viewId==='operators')renderOperators();
    if(viewId==='bans')renderBans();
    if(viewId==='trials')renderTrials();
    if(viewId==='system')loadAppStatus();
    if(viewId==='keys')renderKeys();
}

function logout(){
    if(confirm("Logout from panel?")){
        if(syncInterval)clearInterval(syncInterval);
        currentUser=null;location.reload();
    }
}

function closeModals(){document.querySelectorAll('.modal-overlay').forEach(m=>m.classList.remove('active'));}
function closePaymentModal(){document.getElementById('payment-instruction-modal').classList.remove('active');closeModals();}
function closeChangelog(){document.getElementById('changelog-modal').classList.remove('active');try{localStorage.setItem('ao_changelog_v10',new Date().toDateString());}catch(e){}}

function toggleSwitch(el){el.classList.toggle('active');}
function setToggle(id,state){const el=document.getElementById(id);if(!el)return;if(state)el.classList.add('active');else el.classList.remove('active');}
function getToggle(id){const el=document.getElementById(id);return el?el.classList.contains('active'):false;}

function copyToClipboard(text,label,event){
    if(event){event.stopPropagation();event.preventDefault();}
    const fallback=(str)=>{
        const el=document.createElement('textarea');
        el.value=str;el.style.position='fixed';el.style.opacity='0';
        document.body.appendChild(el);el.select();
        try{document.execCommand('copy');showIsland(`${label} Copied!`,"success","fa-copy");}
        catch(e){showIsland("Copy failed","error");}
        document.body.removeChild(el);
    };
    if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(text).then(()=>{showIsland(`${label} Copied!`,"success","fa-copy");}).catch(()=>fallback(text));
    }else fallback(text);
}

function setKeyFilter(filter){
    currentKeyFilter=filter;
    document.querySelectorAll('#key-filters .filter-pill').forEach(btn=>{
        if(btn.getAttribute('data-filter')===filter)btn.classList.add('active');
        else btn.classList.remove('active');
    });
    renderKeys();
}

function setDays(days,btnEl){
    selectedDays=days;
    document.querySelectorAll('.day-btn').forEach(b=>b.classList.remove('selected'));
    if(btnEl)btnEl.classList.add('selected');
    autoCalculateExpiry();
    const pA=document.getElementById('payment-btn-admin');
    const pO=document.getElementById('payment-btn-op');
    if(pA)pA.disabled=false;
    if(pO)pO.disabled=false;
}

function autoCalculateExpiry(){
    const days=selectedDays;
    const limit=parseInt(document.getElementById('mod-key-limit').value)||1;
    if(days>0){
        const expiry=new Date();
        expiry.setDate(expiry.getDate()+days);
        const yyyy=expiry.getFullYear(),mm=String(expiry.getMonth()+1).padStart(2,'0'),dd=String(expiry.getDate()).padStart(2,'0');
        document.getElementById('mod-key-date').value=`${yyyy}-${mm}-${dd}`;
        const price=PACKAGE_PRICES[days]||0;
        document.getElementById('mod-key-amount').value=`₹${price} (LOCKED)`;
        document.getElementById('expiry-preview-text').textContent=`Expiry: ${dd}/${mm}/${yyyy} • Price: ₹${price}`;

        // Update operator fee summary
        const opSum=document.getElementById('op-fee-summary');
        if(opSum){
            opSum.style.display='block';
            document.getElementById('op-fee-package').textContent=`${days} Days`;
            document.getElementById('op-fee-devices').textContent=`${limit} Device${limit>1?'s':''}`;
            document.getElementById('op-fee-amount').textContent=`₹${price.toLocaleString('en-IN')}`;
        }

        // Update admin fee summary
        const adSum=document.getElementById('admin-fee-summary');
        if(adSum){
            adSum.style.display='block';
            document.getElementById('admin-fee-amount').textContent=`₹${price.toLocaleString('en-IN')}`;
        }
    }else{
        document.getElementById('mod-key-amount').value='';
        document.getElementById('expiry-preview-text').textContent='Select a package';
        const opSum=document.getElementById('op-fee-summary');
        if(opSum)opSum.style.display='none';
        const adSum=document.getElementById('admin-fee-summary');
        if(adSum)adSum.style.display='none';
    }
}

function toggleAdvancedMode(force){
    const sec=document.getElementById('advanced-section');
    const chev=document.getElementById('adv-chevron');
    const isHidden=sec.style.display==='none';
    if(force==='hide'||(!isHidden&&force!=='show')){
        sec.style.display='none';chev.style.transform='rotate(0deg)';
    }else{
        sec.style.display='block';chev.style.transform='rotate(180deg)';
    }
}

function getLocalRemarks(){try{return JSON.parse(localStorage.getItem('ao_remarks'))||{};}catch(e){return{};}}
function saveLocalRemark(keyId,name,payment){
    const r=getLocalRemarks();r[keyId]={name,payment};
    localStorage.setItem('ao_remarks',JSON.stringify(r));
}

// ============================================
// APP STATUS
// ============================================
function loadAppStatus(){
    const as=DB.App_Status||{};
    const set=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val;};
    set('as-title',as.Panel_Title||"Anurag Online Official");
    set('as-subtitle',as.Panel_SubTitle||"Secure Digital Platform");
    set('as-main-banner',as.Main_Banner_Url||"");
    set('as-admin-link',as.Admin_Link||"https://t.me/AnuragOnlineOfficial");
    setToggle('tog-em-mode',as.Emergency_Mode===true);
    setToggle('tog-em-cancel',as.Emergency_Cancel_Btn===true);
    set('as-em-title',as.Emergency_Title||"");
    set('as-em-msg',as.Emergency_Msg||"");
    set('as-em-banner',as.Emergency_Banner||"");
    setToggle('tog-trial',as.Trial_Enabled===true);
}

function saveAppStatus(){
    if(!currentUser||currentUser.role!=='admin')return showIsland("Access Denied!","error");
    const s={
        Panel_Title:document.getElementById('as-title').value.trim(),
        Panel_SubTitle:document.getElementById('as-subtitle').value.trim(),
        Main_Banner_Url:document.getElementById('as-main-banner').value.trim(),
        Admin_Link:document.getElementById('as-admin-link').value.trim(),
        Emergency_Mode:getToggle('tog-em-mode'),
        Emergency_Cancel_Btn:getToggle('tog-em-cancel'),
        Emergency_Title:document.getElementById('as-em-title').value.trim(),
        Emergency_Msg:document.getElementById('as-em-msg').value,
        Emergency_Banner:document.getElementById('as-em-banner').value.trim(),
        Trial_Enabled:getToggle('tog-trial')
    };
    DB.App_Status=s;syncNode('App_Status',s);
    showIsland("Config Saved","success","fa-cogs");
}

// ============================================
// CHANGE PASSWORD
// ============================================
function openChangePasswordModal(){
    document.getElementById('mod-current-pass').value='';
    document.getElementById('mod-new-pass').value='';
    document.getElementById('mod-confirm-pass').value='';
    document.getElementById('change-password-modal').classList.add('active');
}

async function saveNewPassword(){
    const cp=document.getElementById('mod-current-pass').value.trim();
    const np=document.getElementById('mod-new-pass').value.trim();
    const cf=document.getElementById('mod-confirm-pass').value.trim();
    if(!cp||!np||!cf)return showIsland("Fill all fields","error");
    if(np!==cf)return showIsland("Passwords don't match!","error");
    if(np.length<4)return showIsland("Password too short!","error");

    if(currentUser.role==='admin'){
        let ap=DEFAULT_ADMIN_PASSWORD;
        if(DB.Admin&&DB.Admin.Password)ap=DB.Admin.Password;
        if(cp!==ap)return showIsland("Current password wrong!","error");
        DB.Admin={Username:DB.Admin.Username||DEFAULT_ADMIN_USERNAME,Password:np,CreatedAt:DB.Admin.CreatedAt||Date.now(),UpdatedAt:Date.now()};
        await syncNode('Admin',DB.Admin);
    }else{
        const op=DB.Operators[currentUser.username];
        if(!op||op.Password!==cp)return showIsland("Current password wrong!","error");
        op.Password=np;op.UpdatedAt=Date.now();
        await syncNode(`Operators/${currentUser.username}`,op);
    }
    closeModals();showIsland("Password updated!","success","fa-key");
}

// ============================================
// KEY MODAL
// ============================================
function openKeyModal(){
    currentEditKey=null;
    document.getElementById('modal-key-title').innerText="Generate Key";
    document.getElementById('mod-key-id').value="";
    document.getElementById('mod-key-id').readOnly=false;
    document.getElementById('mod-key-limit').value=1;
    document.getElementById('mod-key-date').value="";
    document.getElementById('mod-key-amount').value="";
    selectedDays=0;
    document.querySelectorAll('.day-btn').forEach(b=>b.classList.remove('selected'));
    document.getElementById('expiry-preview-text').textContent='Select a package';
    document.getElementById('mod-key-name').value="";
    document.getElementById('mod-key-payment').value="";
    document.getElementById('op-fee-summary').style.display='none';
    document.getElementById('admin-fee-summary').style.display='none';

    if(currentUser.role==='admin'){
        document.getElementById('admin-key-actions').style.display='block';
        document.getElementById('operator-key-actions').style.display='none';
        document.getElementById('payment-btn-admin').disabled=true;
    }else{
        document.getElementById('admin-key-actions').style.display='none';
        document.getElementById('operator-key-actions').style.display='block';
        document.getElementById('payment-btn-op').disabled=true;
    }
    toggleAdvancedMode('hide');
    document.getElementById('key-modal').classList.add('active');

    // Device limit change पर fee summary update
    setTimeout(()=>{
        const limitInput=document.getElementById('mod-key-limit');
        if(limitInput && !limitInput.dataset.listenerAdded){
            limitInput.dataset.listenerAdded='true';
            limitInput.addEventListener('input',()=>{
                if(selectedDays>0)autoCalculateExpiry();
            });
        }
    },100);
}

function openEditKeyModal(keyId){
    if(!currentUser)return;
    currentEditKey=keyId;
    const data=DB.Keys[keyId]||{};
    if(currentUser.role==='operator'&&data.CreatedBy!==currentUser.username){
        showIsland("Access Denied!","error");return;
    }
    document.getElementById('modal-key-title').innerText="Edit Configuration";
    document.getElementById('mod-key-id').value=keyId;
    document.getElementById('mod-key-id').readOnly=true;
    document.getElementById('mod-key-limit').value=data.DeviceLimit||1;
    if(data.ExpiryDate)document.getElementById('mod-key-date').value=data.ExpiryDate;
    document.getElementById('mod-key-amount').value=data.Amount?`₹${data.Amount} (PAID)`:'';
    selectedDays=0;
    document.querySelectorAll('.day-btn').forEach(b=>b.classList.remove('selected'));
    document.getElementById('expiry-preview-text').textContent='Select a package to update expiry';
    document.getElementById('op-fee-summary').style.display='none';
    document.getElementById('admin-fee-summary').style.display='none';

    if(currentUser.role==='admin'){
        document.getElementById('admin-key-actions').style.display='block';
        document.getElementById('operator-key-actions').style.display='none';
    }else{
        document.getElementById('admin-key-actions').style.display='none';
        document.getElementById('operator-key-actions').style.display='block';
    }

    const r=getLocalRemarks();
    if(r[keyId]){
        document.getElementById('mod-key-name').value=r[keyId].name||"";
        document.getElementById('mod-key-payment').value=r[keyId].payment||"";
        if(r[keyId].name||r[keyId].payment)toggleAdvancedMode('show');
        else toggleAdvancedMode('hide');
    }else{
        document.getElementById('mod-key-name').value="";
        document.getElementById('mod-key-payment').value="";
        toggleAdvancedMode('hide');
    }
    document.getElementById('key-modal').classList.add('active');
}

function randomKey(){
    document.getElementById('mod-key-id').value='AO-VIP-'+Math.floor(10000+Math.random()*90000);
}

// ============================================
// ADMIN DIRECT KEY
// ============================================
async function saveKeyDirectly(){
    if(!currentUser||currentUser.role!=='admin')return showIsland("Access Denied!","error");
    const keyId=document.getElementById('mod-key-id').value.trim();
    const limit=parseInt(document.getElementById('mod-key-limit').value)||1;
    const expDate=document.getElementById('mod-key-date').value;
    const days=selectedDays;

    if(!keyId)return showIsland("Enter Access Key","error");
    if(!days||!expDate)return showIsland("Select a package","error");
    if(DB.Keys[keyId]&&!currentEditKey)return showIsland("Key already exists!","error");

    if(currentEditKey&&DB.Keys[currentEditKey]){
        const e=DB.Keys[currentEditKey];
        e.DeviceLimit=limit;
        if(days>0&&expDate)e.ExpiryDate=expDate;
        DB.Keys[currentEditKey]=e;
        await syncNode(`Keys/${currentEditKey}`,e);
        showIsland("Key Updated!","success","fa-crown");
        closeModals();renderKeys();return;
    }

    const newKey={
        Banned:false,DeviceLimit:limit,ExpiryDate:expDate,
        CreatedAt:Date.now(),CreatedBy:currentUser.username,CreatedByRole:'admin',
        Amount:0,PaymentVerified:false,AdminGenerated:true
    };
    DB.Keys[keyId]=newKey;
    await syncNode(`Keys/${keyId}`,newKey);
    saveLocalRemark(keyId,
        document.getElementById('mod-key-name').value.trim(),
        document.getElementById('mod-key-payment').value.trim()
    );
    showIsland("Key Generated! 🎉","success","fa-crown");
    closeModals();renderKeys();
}

// ============================================
// CASHFREE PAYMENT
// ============================================
async function openPaymentModal(){
    const keyId=document.getElementById('mod-key-id').value.trim();
    const days=selectedDays;
    const limit=parseInt(document.getElementById('mod-key-limit').value)||1;

    if(!keyId)return showIsland("Pehle Access Key enter karein","error");
    if(!days)return showIsland("Package select karein","error");
    if(DB.Keys[keyId])return showIsland("Key already exists!","error");

    const displayAmount=PACKAGE_PRICES[days]||0;
    if(displayAmount<=0)return showIsland("Invalid package","error");

    const requestId=`${keyId.replace(/[^a-zA-Z0-9]/g,'')}_${Date.now()}`;

    showIsland("Order ban raha hai...","warning","fa-spinner");

    try{
        const res=await fetch(`${BACKEND_URL}/api/create-order`,{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                keyId: keyId,
                days: days,
                customer_name: 'Anurag Online Customer',
                customer_phone: '9999999999',
                customer_email: 'customer@anuragonlineofficial.com'
            })
        });

        const data=await res.json();

        if(!data.success){
            return showIsland("Order failed: "+(data.error||'Unknown'),"error");
        }

        await savePaymentRequest(requestId, keyId, days, limit, data.amount);

        if(!cashfree)await initCashfree();
        if(!cashfree){
            return showIsland("Cashfree SDK not loaded","error");
        }

        const checkoutOptions={
            paymentSessionId: data.payment_session_id,
            redirectTarget: "_modal"
        };

        cashfree.checkout(checkoutOptions).then((result)=>{
            if(result.error){
                showIsland("Payment failed: "+result.error.message,"error");
                return;
            }
            if(result.paymentDetails){
                showIsland("Payment Successful! 🎉","success","fa-check-circle");
                sendTelegramNotification(keyId, days, limit, data.amount, currentUser.username);
                document.getElementById('key-modal').classList.remove('active');
                document.getElementById('payment-instruction-modal').classList.add('active');
                renderKeys();
            }
        });

    }catch(e){
        console.error(e);
        showIsland("Payment error: "+e.message,"error");
    }
}

async function savePaymentRequest(requestId,keyId,days,limit,amount){
    try{
        const pr={
            keyId,days,deviceLimit:limit,amount,
            requestedBy:currentUser.username,
            requestedByRole:currentUser.role,
            status:'pending',
            requestedAt:Date.now(),
            gateway:'Cashfree',
            nonRefundable:true,
            paymentSessionRef:requestId
        };
        if(!DB.PaymentRequests)DB.PaymentRequests={};
        DB.PaymentRequests[requestId]=pr;
        await syncNode(`PaymentRequests/${requestId}`,pr);
        return true;
    }catch(e){console.error(e);return false;}
}

// ============================================
// APPROVE / REJECT PAYMENT
// ============================================
async function approvePaymentRequest(requestId){
    if(!currentUser||currentUser.role!=='admin')return;
    const request=DB.PaymentRequests[requestId];
    if(!request)return showIsland("Request not found","error");
    if(!confirm(`✅ Approve Payment?\n\nKey: ${request.keyId}\nAmount: ₹${request.amount}\nDays: ${request.days}\nDevices: ${request.deviceLimit}\n\n⚠️ NON-REFUNDABLE`))return;
    if(DB.Keys[request.keyId])return showIsland("Key already exists!","error");

    const expiry=new Date();
    expiry.setDate(expiry.getDate()+request.days);
    const yyyy=expiry.getFullYear(),mm=String(expiry.getMonth()+1).padStart(2,'0'),dd=String(expiry.getDate()).padStart(2,'0');

    const newKey={
        Banned:false,DeviceLimit:request.deviceLimit,ExpiryDate:`${yyyy}-${mm}-${dd}`,
        CreatedAt:Date.now(),CreatedBy:request.requestedBy,CreatedByRole:request.requestedByRole,
        PaymentId:requestId,Amount:request.amount,PaymentVerified:true,Gateway:'Cashfree'
    };
    DB.Keys[request.keyId]=newKey;
    await syncNode(`Keys/${request.keyId}`,newKey);

    request.status='approved';request.approvedAt=Date.now();request.approvedBy=currentUser.username;
    await syncNode(`PaymentRequests/${requestId}`,request);

    showIsland("Payment Approved! Key Generated 🎉","success","fa-check-circle");
    renderKeys();
}

async function rejectPaymentRequest(requestId){
    if(!currentUser||currentUser.role!=='admin')return;
    const request=DB.PaymentRequests[requestId];
    if(!request)return showIsland("Request not found","error");
    if(!confirm(`❌ Reject this request?\n\nKey: ${request.keyId}\nAmount: ₹${request.amount}`))return;

    request.status='rejected';request.rejectedAt=Date.now();request.rejectedBy=currentUser.username;
    await syncNode(`PaymentRequests/${requestId}`,request);
    showIsland("Request Rejected","error","fa-times-circle");
    renderKeys();
}

// ============================================
// KEY MANAGEMENT
// ============================================
function toggleKeyBan(keyId,state){
    if(!currentUser)return;
    if(currentUser.role==='operator'&&DB.Keys[keyId].CreatedBy!==currentUser.username)return showIsland("Access Denied!","error");
    DB.Keys[keyId].Banned=state;
    syncNode(`Keys/${keyId}/Banned`,state);
    renderKeys();
    showIsland(state?"Key Suspended":"Key Restored",state?"error":"success","fa-shield-alt");
}

async function deleteKey(keyId){
    if(!currentUser)return;
    if(currentUser.role==='operator'&&DB.Keys[keyId].CreatedBy!==currentUser.username)return showIsland("Access Denied!","error");
    if(!confirm(`Delete key "${keyId}"?\n\n⚠️ Iske saath uska payment record bhi delete ho jayega!`))return;

    const keyData=DB.Keys[keyId];
    const paymentId=keyData&&keyData.PaymentId;

    // 🔥 Delete associated payment request
    if(paymentId&&DB.PaymentRequests&&DB.PaymentRequests[paymentId]){
        delete DB.PaymentRequests[paymentId];
        await syncNode(`PaymentRequests/${paymentId}`,null);
    }

    // Delete key
    delete DB.Keys[keyId];
    await syncNode(`Keys/${keyId}`,null);

    const r=getLocalRemarks();
    if(r[keyId]){delete r[keyId];localStorage.setItem('ao_remarks',JSON.stringify(r));}

    renderKeys();
    showIsland("Key + Payment Deleted","success","fa-trash");
}

function unbindDevice(keyId,hwid){
    if(!currentUser)return;
    if(currentUser.role==='operator'&&DB.Keys[keyId].CreatedBy!==currentUser.username)return showIsland("Access Denied!","error");
    if(confirm("Unbind this Hardware ID?")){
        if(DB.Keys[keyId].Devices)delete DB.Keys[keyId].Devices[hwid];
        syncNode(`Keys/${keyId}/Devices/${hwid}`,null);
        renderKeys();showIsland("Device Unlinked","success");
    }
}

function clearAllDevices(keyId){
    if(!currentUser)return;
    if(currentUser.role==='operator'&&DB.Keys[keyId].CreatedBy!==currentUser.username)return showIsland("Access Denied!","error");
    if(confirm(`Remove ALL devices from ${keyId}?`)){
        DB.Keys[keyId].Devices={};
        syncNode(`Keys/${keyId}/Devices`,null);
        renderKeys();showIsland("All Devices Cleared","success","fa-broom");
    }
}

function openEditHWIDModal(keyId,oldHwid){
    if(!currentUser)return;
    if(currentUser.role==='operator'&&DB.Keys[keyId].CreatedBy!==currentUser.username)return showIsland("Access Denied!","error");
    document.getElementById('mod-edit-hwid').value=oldHwid;
    document.getElementById('mod-edit-old-hwid').value=oldHwid;
    document.getElementById('mod-edit-key-id').value=keyId;
    document.getElementById('edit-hwid-modal').classList.add('active');
}

async function saveEditedHWID(){
    const keyId=document.getElementById('mod-edit-key-id').value;
    const oldHwid=document.getElementById('mod-edit-old-hwid').value;
    const newHwid=document.getElementById('mod-edit-hwid').value.trim();
    if(!newHwid)return showIsland("HWID cannot be empty","error");
    if(newHwid===oldHwid)return closeModals();
    if(!DB.Keys[keyId]||!DB.Keys[keyId].Devices||!DB.Keys[keyId].Devices[oldHwid])return showIsland("Device not found","error");

    const devData=DB.Keys[keyId].Devices[oldHwid];
    DB.Keys[keyId].Devices[newHwid]=devData;
    await syncNode(`Keys/${keyId}/Devices/${newHwid}`,devData);
    delete DB.Keys[keyId].Devices[oldHwid];
    await syncNode(`Keys/${keyId}/Devices/${oldHwid}`,null);
    closeModals();renderKeys();showIsland("Device ID Updated","success","fa-pen");
}

async function banHWIDShortcut(keyId,hwid){
    if(!currentUser)return;
    if(currentUser.role==='operator'&&DB.Keys[keyId].CreatedBy!==currentUser.username)return showIsland("Access Denied!","error");
    if(confirm(`Ban this Device ID: ${hwid}?`)){
        if(!DB.Banned_HWIDs)DB.Banned_HWIDs={};
        DB.Banned_HWIDs[hwid]=true;
        await syncNode(`Banned_HWIDs/${hwid}`,true);
        if(DB.Keys[keyId].Devices)delete DB.Keys[keyId].Devices[hwid];
        await syncNode(`Keys/${keyId}/Devices/${hwid}`,null);
        renderKeys();
        if(currentUser.role==='admin')renderBans();
        showIsland("Device Banned","error","fa-user-slash");
    }
}

function toggleCard(id){
    const el=document.getElementById(`list-card-${id}`);
    if(el)el.classList.toggle('expanded');
}

// ============================================
// RENDER KEYS + PENDING PAYMENTS (MERGED)
// ============================================
function renderKeys(){
    if(!currentUser)return;
    const list=document.getElementById('keys-list');
    if(!list)return;

    const search=(document.getElementById('search-keys')?.value||'').toLowerCase();
    list.innerHTML="";
    let count=0;

    // 🔥 PENDING PAYMENTS (सिर्फ admin को)
    if(currentUser.role==='admin' && DB.PaymentRequests){
        const pendingPayments = Object.entries(DB.PaymentRequests)
            .filter(([id,r])=>r.status==='pending')
            .sort((a,b)=>(b[1].requestedAt||0)-(a[1].requestedAt||0));
        
        pendingPayments.forEach(([id,req])=>{
            if(search!=="" && !(req.keyId||'').toLowerCase().includes(search) && !(req.requestedBy||'').toLowerCase().includes(search)) return;
            count++;
            
            const date=new Date(req.requestedAt).toLocaleString();
            
            list.innerHTML+=`
            <div class="list-card payment">
                <div class="card-header-main" style="cursor:default">
                    <div class="card-header-left" style="flex:1">
                        <div class="card-title" style="color:var(--warning);font-size:1rem">
                            <i class="fas fa-hourglass-half"></i> ₹${req.amount} PENDING
                        </div>
                        <div class="card-subtitle" style="font-size:0.72rem">
                            <span><i class="fas fa-key"></i> ${req.keyId}</span>
                            <span><i class="fas fa-calendar"></i> ${req.days}d</span>
                            <span><i class="fas fa-desktop"></i> ${req.deviceLimit} device</span>
                        </div>
                        <div class="card-subtitle" style="font-size:0.65rem;margin-top:4px">
                            <span><i class="fas fa-user"></i> ${req.requestedBy}</span>
                            <span><i class="fas fa-clock"></i> ${date}</span>
                            <span><i class="fas fa-credit-card"></i> Cashfree</span>
                        </div>
                        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
                            <span class="badge pending" style="font-size:0.55rem"><i class="fas fa-clock"></i> PAYMENT PENDING</span>
                            <span class="badge non-refundable" style="font-size:0.55rem"><i class="fas fa-ban"></i> NON-REFUNDABLE</span>
                        </div>
                    </div>
                    <div class="card-header-right" style="flex-direction:column;gap:6px;align-items:flex-end">
                        <button class="btn-xs approve" style="padding:8px 14px;font-size:0.7rem;width:auto" onclick="approvePaymentRequest('${id}')"><i class="fas fa-check"></i> APPROVE</button>
                        <button class="btn-xs del" style="padding:8px 14px;font-size:0.7rem;width:auto" onclick="rejectPaymentRequest('${id}')"><i class="fas fa-times"></i> REJECT</button>
                    </div>
                </div>
            </div>`;
        });
    }

    const today=new Date();today.setHours(0,0,0,0);

    const arr=Object.entries(DB.Keys||{}).sort((a,b)=>(b[1].CreatedAt||0)-(a[1].CreatedAt||0));

    arr.forEach(([keyId,data])=>{
        if(currentUser.role==='operator'&&data.CreatedBy!==currentUser.username)return;
        if(search!==""&&!keyId.toLowerCase().includes(search))return;

        const expDateObj=new Date(data.ExpiryDate);
        const diffDays=Math.ceil((expDateObj-today)/(1000*60*60*24));
        const realDevices=(data.Devices&&typeof data.Devices==='object')?Object.keys(data.Devices).filter(k=>k!=='dummy'):[];
        const isBanned=data.Banned===true;

        let state='active';
        if(isBanned)state='banned';
        else if(diffDays<0)state='expired';
        else if(realDevices.length===0)state='pending';
        else if(diffDays<=3)state='nearby';

        if(currentKeyFilter!=='all'&&state!==currentKeyFilter)return;
        count++;

        let devicesHtml="";
        realDevices.forEach(hwid=>{
            const di=data.Devices[hwid]||{};
            const model=di.Model||"Unknown Device";
            devicesHtml+=`
            <div class="device-box">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="color:#fff;font-weight:700;display:flex;align-items:center;gap:6px"><i class="fas fa-mobile-alt" style="color:var(--text-dim)"></i> ${model}</span>
                    <div style="display:flex;gap:6px">
                        <button class="btn-icon" style="width:30px;height:30px;background:rgba(6,182,212,0.1);color:var(--primary);border:none" onclick="openEditHWIDModal('${keyId}','${hwid}');event.stopPropagation()"><i class="fas fa-pen" style="font-size:0.7rem"></i></button>
                        <button class="btn-icon" style="width:30px;height:30px;background:rgba(239,68,68,0.1);color:var(--danger);border:none" onclick="banHWIDShortcut('${keyId}','${hwid}');event.stopPropagation()"><i class="fas fa-ban" style="font-size:0.7rem"></i></button>
                        <button class="btn-icon" style="width:30px;height:30px;background:rgba(245,158,11,0.1);color:var(--warning);border:none" onclick="unbindDevice('${keyId}','${hwid}');event.stopPropagation()"><i class="fas fa-unlink" style="font-size:0.7rem"></i></button>
                    </div>
                </div>
                <div class="interactive-text device-hwid" style="margin-top:4px" onclick="copyToClipboard('${hwid}','HWID',event)">
                    ${hwid} <i class="fas fa-copy" style="font-size:0.7rem;color:var(--primary);opacity:0.8"></i>
                </div>
            </div>`;
        });

        let badgeClass='badge',badgeText='',wrapClass='list-card';
        if(state==='banned'){badgeClass+=' banned';badgeText='BANNED';wrapClass+=' banned';}
        else if(state==='expired'){badgeClass+=' expired';badgeText='EXPIRED';wrapClass+=' expired';}
        else if(state==='pending'){badgeClass+=' pending';badgeText='PENDING';wrapClass+=' pending';}
        else if(state==='nearby'){badgeClass+=' nearby';badgeText='EXPIRING';wrapClass+=' nearby';}
        else{badgeClass+=' active';badgeText='ACTIVE';wrapClass+=' active';}

        let ownerBadge='';
        if(currentUser.role==='admin'&&data.CreatedBy){
            const isAdminKey=data.CreatedByRole==='admin';
            ownerBadge=`<span class="badge owner-${isAdminKey?'admin':'operator'}"><i class="fas fa-${isAdminKey?'crown':'user'}"></i> ${data.CreatedBy}</span>`;
        }

        let paymentBadge='';
        if(data.PaymentVerified||data.PaymentId){
            paymentBadge=`<span class="badge payment-tag"><i class="fas fa-credit-card"></i> PAID ₹${data.Amount||0}</span>`;
        }else if(data.AdminGenerated){
            paymentBadge=`<span class="badge owner-admin"><i class="fas fa-crown"></i> ADMIN FREE</span>`;
        }

        list.innerHTML+=`
        <div class="${wrapClass}" id="list-card-${keyId}">
            <div class="card-header-main" onclick="toggleCard('${keyId}')">
                <div class="card-header-left">
                    <div class="card-title interactive-text" onclick="copyToClipboard('${keyId}','Key',event)">
                        <i class="fas fa-key" style="color:var(--primary);margin-right:4px"></i> 
                        ${keyId} 
                        <i class="fas fa-copy" style="font-size:0.75rem;color:var(--text-dim);opacity:0.7"></i>
                    </div>
                    <div class="card-subtitle">
                        <span><i class="far fa-calendar-alt"></i> ${data.ExpiryDate}</span>
                        <span><i class="fas fa-desktop"></i> ${realDevices.length}/${data.DeviceLimit}</span>
                        ${ownerBadge}
                        ${paymentBadge}
                    </div>
                </div>
                <div class="card-header-right">
                    <div class="${badgeClass}">${badgeText}</div>
                    <i class="fas fa-chevron-down chevron-icon"></i>
                </div>
            </div>
            <div class="card-details">
                ${realDevices.length>0?`
                <div style="display:flex;justify-content:flex-end;margin-bottom:4px">
                    <button class="btn-xs" style="background:rgba(239,68,68,0.1);color:var(--danger);width:auto;padding:8px 14px" onclick="clearAllDevices('${keyId}');event.stopPropagation()"><i class="fas fa-broom"></i> CLEAR ALL</button>
                </div>`:''}
                <div class="devices-wrapper">
                    ${devicesHtml}
                    ${realDevices.length===0?'<div style="color:var(--text-dim);font-size:0.8rem;text-align:center;padding:15px">No Devices Linked</div>':''}
                </div>
                <div class="card-actions">
                    <button class="btn-xs edit" onclick="openEditKeyModal('${keyId}');event.stopPropagation()"><i class="fas fa-pen"></i></button>
                    <button class="btn-xs ban" onclick="toggleKeyBan('${keyId}',${!isBanned});event.stopPropagation()"><i class="fas ${isBanned?'fa-check':'fa-ban'}"></i></button>
                    <button class="btn-xs del" onclick="deleteKey('${keyId}');event.stopPropagation()"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        </div>`;
    });

    if(count===0){
        if(currentUser.role==='operator'){
            list.innerHTML=`<div class="empty-state">Aapne koi key nahi banayi<br><span style="font-size:0.75rem;color:var(--text-muted)">Payment karke key generate karein</span></div>`;
        }else{
            list.innerHTML=`<div class="empty-state">No Access Keys or Payments Found</div>`;
        }
    }
}

// ============================================
// BANS
// ============================================
function openBanModal(){
    document.getElementById('mod-ban-id').value='';
    document.getElementById('ban-modal').classList.add('active');
}

async function saveBan(){
    const hwid=document.getElementById('mod-ban-id').value.trim();
    if(!hwid)return showIsland("Enter HWID","error");
    if(!DB.Banned_HWIDs)DB.Banned_HWIDs={};
    DB.Banned_HWIDs[hwid]=true;
    await syncNode(`Banned_HWIDs/${hwid}`,true);
    closeModals();renderBans();
    showIsland("Device Blocked","error","fa-user-slash");
}

async function unbanHWID(hwid){
    if(confirm(`Remove ${hwid} from Ban List?`)){
        delete DB.Banned_HWIDs[hwid];
        await syncNode(`Banned_HWIDs/${hwid}`,null);
        renderBans();showIsland("Device Unbanned","success");
    }
}

function renderBans(){
    if(!currentUser||currentUser.role!=='admin')return;
    const list=document.getElementById('bans-list');
    if(!list)return;
    const search=(document.getElementById('search-bans')?.value||'').toLowerCase();
    list.innerHTML="";
    let count=0;
    const data=DB.Banned_HWIDs||{};
    Object.entries(data).forEach(([hwid,val])=>{
        if(!val)return;
        if(search!==""&&!hwid.toLowerCase().includes(search))return;
        count++;
        list.innerHTML+=`
        <div class="list-card banned">
            <div class="card-header-main" style="cursor:default">
                <div class="card-header-left">
                    <div class="card-title interactive-text" style="color:var(--danger);font-size:0.95rem" onclick="copyToClipboard('${hwid}','Banned ID',event)">
                        ${hwid} <i class="fas fa-copy" style="font-size:0.7rem;color:var(--danger);opacity:0.8"></i>
                    </div>
                    <div class="card-subtitle"><i class="fas fa-shield-alt"></i> Access Blocked</div>
                </div>
                <div class="card-header-right">
                    <button class="btn-xs" style="background:rgba(16,185,129,0.1);color:var(--success);padding:10px 16px;font-weight:800" onclick="unbanHWID('${hwid}')">UNBAN</button>
                </div>
            </div>
        </div>`;
    });
    if(count===0)list.innerHTML=`<div class="empty-state">No Banned Devices</div>`;
}

// ============================================
// TRIALS
// ============================================
function renderTrials(){
    if(!currentUser||currentUser.role!=='admin')return;
    const list=document.getElementById('trials-list');
    if(!list)return;
    const search=(document.getElementById('search-trials')?.value||'').toLowerCase();
    list.innerHTML="";
    let count=0;
    const data=DB.Trials||{};
    Object.entries(data).forEach(([hwid,td])=>{
        if(!td||!td.EndTime)return;
        if(search!==""&&!hwid.toLowerCase().includes(search))return;
        count++;
        let endStr="Unknown";
        try{endStr=new Date(td.EndTime*1000).toLocaleString();}catch(e){}
        list.innerHTML+=`
        <div class="list-card" style="border-left-color:var(--primary)">
            <div class="card-header-main" style="cursor:default">
                <div class="card-header-left">
                    <div class="card-title interactive-text" style="color:var(--primary);font-size:0.9rem" onclick="copyToClipboard('${hwid}','Trial ID',event)">
                        ${hwid} <i class="fas fa-copy" style="font-size:0.7rem;color:var(--primary);opacity:0.8"></i>
                    </div>
                    <div class="card-subtitle"><i class="fas fa-clock"></i> Ends: ${endStr}</div>
                </div>
                <div class="card-header-right">
                    <button class="btn-xs" style="background:rgba(239,68,68,0.1);color:var(--danger);padding:10px 16px" onclick="revokeTrial('${hwid}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        </div>`;
    });
    if(count===0)list.innerHTML=`<div class="empty-state">No Active Trials</div>`;
}

async function revokeTrial(hwid){
    if(confirm(`Revoke Free Trial for ${hwid}?`)){
        delete DB.Trials[hwid];
        await syncNode(`Trials/${hwid}`,null);
        renderTrials();showIsland("Trial Revoked","success");
    }
}

// ============================================
// OPERATORS
// ============================================
function openOperatorModal(){
    if(!currentUser||currentUser.role!=='admin')return;
    currentEditOperator=null;
    document.getElementById('modal-operator-title').innerText="Create Operator";
    document.getElementById('mod-op-username').value='';
    document.getElementById('mod-op-username').readOnly=false;
    document.getElementById('mod-op-password').value='';
    document.getElementById('mod-op-name').value='';
    document.getElementById('mod-op-notes').value='';
    document.getElementById('modal-operator-btn-text').innerText="Create";
    document.getElementById('operator-modal').classList.add('active');
}

function openEditOperatorModal(username){
    if(!currentUser||currentUser.role!=='admin')return;
    currentEditOperator=username;
    const op=DB.Operators[username]||{};
    document.getElementById('modal-operator-title').innerText="Edit Operator";
    document.getElementById('mod-op-username').value=username;
    document.getElementById('mod-op-username').readOnly=true;
    document.getElementById('mod-op-password').value=op.Password||'';
    document.getElementById('mod-op-name').value=op.DisplayName||'';
    document.getElementById('mod-op-notes').value=op.Notes||'';
    document.getElementById('modal-operator-btn-text').innerText="Update";
    document.getElementById('operator-modal').classList.add('active');
}

async function saveOperator(){
    if(!currentUser||currentUser.role!=='admin')return;
    const username=document.getElementById('mod-op-username').value.trim().toLowerCase();
    const password=document.getElementById('mod-op-password').value.trim();
    const displayName=document.getElementById('mod-op-name').value.trim();
    const notes=document.getElementById('mod-op-notes').value.trim();

    if(!username||!password)return showIsland("Fill ID & Password","error");
    if(username.length<3)return showIsland("ID too short","error");
    if(password.length<4)return showIsland("Password too short","error");
    if(username==='admin')return showIsland("'admin' is reserved!","error");

    if(currentEditOperator&&DB.Operators[currentEditOperator]){
        DB.Operators[currentEditOperator].Password=password;
        DB.Operators[currentEditOperator].DisplayName=displayName;
        DB.Operators[currentEditOperator].Notes=notes;
        DB.Operators[currentEditOperator].UpdatedAt=Date.now();
        await syncNode(`Operators/${currentEditOperator}`,DB.Operators[currentEditOperator]);
        showIsland("Operator Updated","success");
    }else{
        if(DB.Operators[username])return showIsland("Operator already exists!","error");
        const newOp={Password:password,DisplayName:displayName,Notes:notes,Active:true,CreatedAt:Date.now(),CreatedBy:currentUser.username};
        DB.Operators[username]=newOp;
        await syncNode(`Operators/${username}`,newOp);
        showIsland("Operator Created","success","fa-user-plus");
    }
    closeModals();renderOperators();
}

async function toggleOperatorActive(username){
    if(!currentUser||currentUser.role!=='admin')return;
    const op=DB.Operators[username];
    if(!op)return;
    op.Active=!op.Active;
    await syncNode(`Operators/${username}/Active`,op.Active);
    renderOperators();
    showIsland(op.Active?"Operator Enabled":"Operator Disabled",op.Active?"success":"warning");
}

function deleteOperator(username){
    if(!currentUser||currentUser.role!=='admin')return;
    if(confirm(`Delete operator "${username}"?`)){
        const opKeys=Object.entries(DB.Keys).filter(([k,v])=>v.CreatedBy===username);
        if(opKeys.length>0){
            if(!confirm(`Is operator ne ${opKeys.length} keys banayi hain. Wo rahengi. Delete?`))return;
        }
        delete DB.Operators[username];
        syncNode(`Operators/${username}`,null);
        renderOperators();showIsland("Operator Deleted","success","fa-trash");
    }
}

function renderOperators(){
    if(!currentUser||currentUser.role!=='admin')return;
    const list=document.getElementById('operators-list');
    if(!list)return;
    const search=(document.getElementById('search-operators')?.value||'').toLowerCase();
    list.innerHTML="";
    let count=0;

    Object.entries(DB.Operators||{}).forEach(([username,data])=>{
        if(search!==""&&!username.toLowerCase().includes(search))return;
        if(data.DisplayName&&!data.DisplayName.toLowerCase().includes(search)&&!username.toLowerCase().includes(search))return;
        count++;

        const keyCount=Object.entries(DB.Keys||{}).filter(([k,v])=>v.CreatedBy===username).length;
        const isActive=data.Active!==false;
        const createdDate=data.CreatedAt?new Date(data.CreatedAt).toLocaleDateString():"Unknown";

        list.innerHTML+=`
        <div class="list-card operator ${isActive?'':'banned'}">
            <div class="card-header-main" style="cursor:default">
                <div class="card-header-left">
                    <div class="card-title interactive-text" style="color:var(--accent);font-size:1rem" onclick="copyToClipboard('${username}','Operator ID',event)">
                        <i class="fas fa-user-circle"></i> ${username}
                        <i class="fas fa-copy" style="font-size:0.7rem;color:var(--accent);opacity:0.8"></i>
                    </div>
                    <div class="card-subtitle">
                        ${data.DisplayName?`<span><i class="fas fa-id-card"></i> ${data.DisplayName}</span>`:''}
                        <span><i class="fas fa-key"></i> ${keyCount} keys</span>
                        <span><i class="far fa-calendar"></i> ${createdDate}</span>
                    </div>
                    <div style="margin-top:4px">
                        <span class="badge ${isActive?'active':'banned'}" style="font-size:0.55rem">
                            <i class="fas fa-${isActive?'check-circle':'times-circle'}"></i> ${isActive?'ACTIVE':'DISABLED'}
                        </span>
                    </div>
                </div>
                <div class="card-header-right" style="flex-direction:column;gap:6px;align-items:flex-end">
                    <button class="btn-xs edit" style="padding:6px 10px;font-size:0.65rem;width:auto" onclick="openEditOperatorModal('${username}')"><i class="fas fa-pen"></i> Edit</button>
                    <div style="display:flex;gap:6px">
                        <button class="btn-xs ban" style="padding:6px 10px;font-size:0.65rem;width:auto" onclick="toggleOperatorActive('${username}')"><i class="fas fa-${isActive?'pause':'play'}"></i></button>
                        <button class="btn-xs del" style="padding:6px 10px;font-size:0.65rem;width:auto" onclick="deleteOperator('${username}')"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            </div>
            ${data.Notes?`<div style="margin-top:10px;padding:10px;background:rgba(255,255,255,0.03);border-radius:10px;font-size:0.75rem;color:var(--text-dim);border-left:3px solid var(--accent)"><i class="fas fa-sticky-note"></i> ${data.Notes}</div>`:''}
        </div>`;
    });

    if(count===0)list.innerHTML=`<div class="empty-state">No Operators Found<br><span style="font-size:0.75rem;color:var(--text-muted)">Click "+" to create</span></div>`;
}

// ============================================
// POLICY ROUTING
// ============================================
function openPolicy(name){
    document.getElementById('login-screen').style.display='none';
    document.getElementById('main-app').style.display='none';
    const bn=document.getElementById('bottom-nav');
    if(bn)bn.style.display='none';
    document.querySelectorAll('.policy-page').forEach(p=>p.classList.remove('active'));
    const target=document.getElementById('policy-'+name);
    if(target){target.classList.add('active');window.scrollTo(0,0);}
}

function closePolicy(){
    document.querySelectorAll('.policy-page').forEach(p=>p.classList.remove('active'));
    if(currentUser){
        document.getElementById('main-app').style.display='flex';
        const bn=document.getElementById('bottom-nav');
        if(bn)bn.style.display='flex';
    }else{
        document.getElementById('login-screen').style.display='flex';
    }
    window.scrollTo(0,0);
}

// ============================================
// DYNAMIC ISLAND
// ============================================
let islandTimeout;
function showIsland(msg,type="success",icon=null){
    const isl=document.getElementById('dynamic-island');
    const ic=document.getElementById('di-icon');
    const m=document.getElementById('di-msg');
    if(icon)ic.className=`fas ${icon}`;
    else ic.className=type==="success"?`fas fa-check-circle`:`fas fa-exclamation-circle`;
    ic.style.color=type==="success"?"var(--primary)":"var(--danger)";
    if(type==="warning")ic.style.color="var(--warning)";
    m.innerText=msg;
    if(navigator.vibrate){try{navigator.vibrate(type==="success"?50:[50,50,50]);}catch(e){}}
    isl.classList.add('show');
    clearTimeout(islandTimeout);
    islandTimeout=setTimeout(()=>isl.classList.remove('show'),3000);
}

// ============================================
// BOOT
// ============================================
document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('login-username').addEventListener('keypress',e=>{if(e.key==='Enter')doLogin();});
    document.getElementById('login-password').addEventListener('keypress',e=>{if(e.key==='Enter')doLogin();});

    document.querySelectorAll('.modal-overlay').forEach(o=>{
        o.addEventListener('click',e=>{if(e.target===o)closeModals();});
    });

    setTimeout(initCashfree,1000);

    try{
        const lastSeen=localStorage.getItem('ao_changelog_v10');
        if(lastSeen!==new Date().toDateString()){
            setTimeout(()=>{
                const cm=document.getElementById('changelog-modal');
                if(cm)cm.classList.add('active');
            },600);
        }
    }catch(e){}
});

window.addEventListener('hashchange',()=>{
    const h=window.location.hash.replace('#','');
    if(['terms','privacy','refund'].includes(h))openPolicy(h);
});