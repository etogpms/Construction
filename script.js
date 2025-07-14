/*
 * Construction Project Monitoring Dashboard Script
 * Handles CRUD operations, filtering, exporting, and rendering charts
 * Data persistence uses localStorage for demo purposes.
 */

(() => {
  const LS_KEY = "construction_projects"; // deprecated, kept for backward compatibility
  const db = firebase.firestore();
  const PROJECTS_COL = 'projects';
  let unsubscribeProjects = null;

  const ADMIN_EMAIL = "johnlowel.fradejas@mwss.gov.ph"; // change to your address
  let isAdmin = false;

  const elements = {
    projectsContainer: document.getElementById("projectsContainer"),
    agencyFilter: document.getElementById("agencyFilter"),
    statusFilter: document.getElementById("statusFilter"),
    searchInput: document.getElementById("searchInput"),
    projectForm: document.getElementById("projectForm"),
    projectModal: new bootstrap.Modal(document.getElementById("projectModal")),
    exportBtn: document.getElementById("exportBtn"),
    loginForm: document.getElementById('loginForm'),
    signupForm: document.getElementById('signupForm'),
    showSignupLink: document.getElementById('showSignupLink'),
    showLoginLink: document.getElementById('showLoginLink'),
    loginLinks: document.getElementById('loginLinks'),
    signupLinks: document.getElementById('signupLinks'),
    manageUsersBtn: document.getElementById('manageUsersBtn'),
    pendingUsersTable: document.getElementById('pendingUsersTable'),
  };

  // convenient references
  const {loginForm, signupForm, showSignupLink, showLoginLink, loginLinks, signupLinks} = elements;
  const appWrapper = document.getElementById('appWrapper');
  const billingContainer = document.getElementById('billingContainer');
  const addBillingBtn    = document.getElementById('addBillingBtn');
  const viewOnlyLink = document.getElementById('viewOnlyLink');
  const logoutBtn  = document.getElementById('logoutBtn');
  const loginBtn   = document.getElementById('loginBtn');
  const loginScreen = document.getElementById('loginScreen');

  let projects = [];
  let isViewOnly = false;
  let pendingUsers = [];
  

  // Load config for signups
  async function loadConfig(){
    try{
      const doc = await db.collection('config').doc('app').get();
      if(doc.exists){
        const data = doc.data();
        // signup enable/disable config deprecated
      }
    }catch(err){console.warn('Failed to load config',err);} 
    updateAdminUI();
  }

  function updateAdminUI(){
    if(isAdmin){
      elements.manageUsersBtn.style.display = 'inline-block';
    } else {
      elements.manageUsersBtn.style.display = 'none';
    }
  }

  async function loadPendingUsers(){
  try{
    const snap = await db.collection('users').where('approved','==',false).get();
    pendingUsers = snap.docs.map(d=>({id:d.id,...d.data()}));
    renderPendingUsersTable();
  }catch(err){console.error('Failed to load pending users',err);}
}

function renderPendingUsersTable(){
  const tbody = elements.pendingUsersTable.querySelector('tbody');
  tbody.innerHTML='';
  pendingUsers.forEach(u=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td>${u.email}</td><td>${u.createdAt?.toDate?u.createdAt.toDate().toLocaleString():''}</td><td></td>`;
    const actions=tr.lastElementChild;
    const approve=document.createElement('button');
    approve.className='btn btn-sm btn-success me-1';
    approve.textContent='Approve';
    approve.onclick=()=>approveUser(u);
    const reject=document.createElement('button');
    reject.className='btn btn-sm btn-danger';
    reject.textContent='Reject';
    reject.onclick=()=>rejectUser(u);
    actions.append(approve,reject);
    tbody.appendChild(tr);
  });
}

async function approveUser(u){
  try{
    await db.collection('users').doc(u.id).update({approved:true});
    firebase.auth().sendPasswordResetEmail(u.email).catch(()=>{});
    loadPendingUsers();
  }catch(e){alert(e.message);} 
}
async function rejectUser(u){
  try{
    await db.collection('users').doc(u.id).delete();
    loadPendingUsers();
  }catch(e){alert(e.message);} 
}



  // ---- Billing Details handlers ----
  function createBillingRow(data={}){
    const div=document.createElement('div');
    div.className='row g-2 align-items-end mb-2 billing-row';
    div.innerHTML=`<div class="col-4"><input type="date" class="form-control billing-date" value="${data.date||''}" placeholder="Date"/></div>
                  <div class="col-4"><input type="number" class="form-control billing-amount" value="${data.amount||''}" placeholder="Amount (PHP)" step="0.01" min="0"/></div>
                  <div class="col-3"><input type="text" class="form-control billing-desc" value="${data.desc||''}" placeholder="Description"/></div>
                  <div class="col-1 text-end"><button type="button" class="btn btn-outline-danger btn-sm remove-billing"><i class="fa fa-minus"></i></button></div>`;
    div.querySelector('.remove-billing').onclick=()=>{
      div.remove();
    };
    billingContainer.appendChild(div);
  }
  if(addBillingBtn){
    addBillingBtn.addEventListener('click',()=>createBillingRow());
  }

  function gatherBilling(){
    const rows = Array.from(billingContainer.querySelectorAll('.billing-row'));
    return rows.map(r=>({
      date:  r.querySelector('.billing-date').value,
      amount: parseFloat(r.querySelector('.billing-amount').value)||0,
      desc: r.querySelector('.billing-desc').value.trim()
    })).filter(b=>b.date && b.amount);
  }
  function populateBilling(arr){
    billingContainer.innerHTML='';
    (arr||[]).forEach(d=>createBillingRow(d));
  }

  // ---- Project CRUD & Rendering ----

  async function saveProject(project) {
    await db.collection(PROJECTS_COL).doc(project.id).set(project);
  }

  function onSaveProject(e) {
    e.preventDefault();
    const formData = new FormData(elements.projectForm);
  const progressBilling = gatherBilling();
    const id = formData.get("projectId") || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).substr(2, 5));
    if(!formData.get("projectName").trim()){alert('Project Name is required');return;}
    if(!formData.get("contractor").trim()){alert('Contractor is required');return;}
    const accDateRaw=formData.get("accompDate");
    const accDate = accDateRaw || new Date().toISOString().slice(0,10);
    const currentPercent=parseFloat(formData.get("percentAccomplishment"))||0;
    const prevPercent=parseFloat(formData.get("percentPrevious"))||0;
    const plannedPercent=parseFloat(formData.get("percentPlanned"))||0;
    const variance=+(currentPercent-plannedPercent).toFixed(2);
    const newAcc={date:accDate,percent:currentPercent,prevPercent,plannedPercent,variance,activities:formData.get("activities"),issue:formData.get("issues"),action:formData.get("actionTaken")};
    const existing = projects.find(p=>p.id===id)||{};
    const project={
      id,
      name:formData.get("projectName"),
      implementingAgency:formData.get("implementingAgency"),
    location: formData.get("projectLocation"),
      contractor:formData.get("contractor"),
      contractAmount:parseFloat(formData.get("contractAmount"))||0,
      revisedContractAmount:formData.get("revisedContractAmount")?parseFloat(formData.get("revisedContractAmount")):null,
      ntpDate:formData.get("ntpDate"),
      originalDuration:parseInt(formData.get("originalDuration"),10)||0,
      timeExtension:parseInt(formData.get("timeExtension"),10)||0,
      originalCompletion:formData.get("originalCompletion"),
      revisedCompletion:formData.get("revisedCompletion"),
      activities:formData.get("activities"),
      issues:formData.get("issues"),
      remarks:formData.get("remarks"),
      otherDetails: formData.get("otherDetails"),
      progressBilling,
      history:[...(existing.history||[])],
      photos: existing.photos || (existing.sCurveDataUrl ? [existing.sCurveDataUrl] : []),
      accomplishments:[...(existing.accomplishments||[])]
    };
    const userEmail=firebase.auth().currentUser?.email||'unknown';
    if(!project.history) project.history=[];
    project.history.push({email:userEmail,timestamp:new Date().toISOString(),action:formData.get("projectId")?'edit':'create'});
    if(newAcc.date){project.accomplishments.push({...newAcc});}
    function postSaveUI(){elements.searchInput.value='';elements.agencyFilter.value='';elements.statusFilter.value='';elements.projectModal.hide();clearForm();
  billingContainer.innerHTML='';}
    const photoInputs=["projectPhoto1","projectPhoto2","projectPhoto3"].map(id=>document.getElementById(id));
    const files=photoInputs.map(inp=>inp?.files[0]).filter(f=>!!f);
    if(files.length){Promise.all(files.map(f=>new Promise((res,rej)=>{const reader=new FileReader();reader.onload=()=>res(reader.result);reader.onerror=rej;reader.readAsDataURL(f);}))).then(async dataUrls=>{project.photos=dataUrls;saveProject(project).catch(err=>alert(err.message));postSaveUI();}).catch(err=>alert(err.message));}else{saveProject(project).then(postSaveUI).catch(err=>alert(err.message));}
  }

  window.deleteProject = async function(id){ if(!isAdmin){alert('Only admin can delete projects');return;} try{await db.collection(PROJECTS_COL).doc(id).delete();projects=projects.filter(p=>p.id!==id);render();}catch(err){alert(err.message);} };

  function clearForm(){
  billingContainer.innerHTML='';elements.projectForm.reset();document.getElementById("projectId").value="";["projectPhoto1","projectPhoto2","projectPhoto3"].forEach(id=>{const el=document.getElementById(id);if(el) el.value="";});document.getElementById("actionTaken").value="";document.getElementById("percentAccomplishment").value=0;document.getElementById("percentPrevious").value=0;document.getElementById("percentPlanned").value=0;document.getElementById("accompDate").value="";}

  function populateForm(project){
  populateBilling(project.progressBilling);document.getElementById("projectId").value=project.id;document.getElementById("projectName").value=project.name;document.getElementById("implementingAgency").value=project.implementingAgency;
document.getElementById("projectLocation").value=project.location || '';document.getElementById("contractor").value=project.contractor;document.getElementById("contractAmount").value=project.contractAmount;document.getElementById("revisedContractAmount").value=project.revisedContractAmount??'';document.getElementById("ntpDate").value=project.ntpDate;document.getElementById("originalDuration").value=project.originalDuration;document.getElementById("timeExtension").value=project.timeExtension;document.getElementById("originalCompletion").value=project.originalCompletion;document.getElementById("revisedCompletion").value=project.revisedCompletion;document.getElementById("activities").value=project.activities;document.getElementById("issues").value=project.issues;document.getElementById("actionTaken").value="";document.getElementById("remarks").value=project.remarks;document.getElementById("otherDetails").value=project.otherDetails;const last=(project.accomplishments||[]).slice(-1)[0]||{percent:0,prevPercent:0,date:""};document.getElementById("percentPrevious").value=last.prevPercent??last.percent??0;document.getElementById("percentPlanned").value=last.plannedPercent??0;document.getElementById("percentAccomplishment").value=last.percent??0;document.getElementById("accompDate").value=last.date;document.getElementById("actionTaken").value=last.action||"";}

  function getProjectStatus(p){
      const latest = (p.accomplishments || []).slice(-1)[0];
      if(latest){
        // Completed if cumulative accomplishment has reached 100 %
        if((latest.percent ?? 0) >= 100) return 'Completed';
        // If actual to-date accomplishment lags behind planned, mark as Delayed
        if((latest.percent ?? 0) < (latest.plannedPercent ?? 0)) return 'Delayed';
      }
      // Fallback to schedule-based check
      const today = new Date().toISOString().split('T')[0];
      if(p.revisedCompletion && today > p.revisedCompletion) return 'Delayed';
      if(!p.revisedCompletion && today > p.originalCompletion) return 'Delayed';
      return 'On-going';
    }

  function projectRowHtml(p){
    const latest = (p.accomplishments || []).slice(-1)[0] || { percent: 0 };
    const curr = latest.percent ?? 0;
    let actionsHtml = firebase.auth().currentUser ? `<button class="btn btn-sm btn-primary me-1" title="Edit" onclick="editProject('${p.id}')"><i class="fa fa-pencil"></i></button>` : '';
    if(isAdmin){
      actionsHtml = `<button class="btn btn-sm btn-primary me-1" title="Edit" onclick="editProject('${p.id}')"><i class="fa fa-pencil"></i></button><button class="btn btn-sm btn-danger" title="Delete" onclick="deleteProject('${p.id}')"><i class="fa fa-trash"></i></button>`;
    }
    return `<tr data-id="${p.id}"><td>${p.name}</td><td>${p.implementingAgency || ''}</td><td>${p.contractor}</td><td><span class="badge bg-${getProjectStatus(p) === 'Delayed' ? 'danger' : 'primary'}">${getProjectStatus(p)}</span></td><td>${p.revisedCompletion || p.originalCompletion}</td><td>${curr}%</td><td class="d-flex gap-1">${actionsHtml}</td></tr>`;
  }

  function render(){const addBtn=document.getElementById('addProjectBtn');if(addBtn) addBtn.style.display=firebase.auth().currentUser?'inline-block':'none';const agencies = [...new Set(projects.map(p => p.implementingAgency))];
      const prevAgency = elements.agencyFilter.value;
      // rebuild options only if count changed (or first render)
      if(elements.agencyFilter.options.length - 1 !== agencies.length){
        elements.agencyFilter.innerHTML = `<option value="">All Agencies</option>` + agencies.map(a => `<option value="${a}">${a}</option>`).join("");
      }
      // restore previous selection if still in list
      if(prevAgency && agencies.includes(prevAgency)){
        elements.agencyFilter.value = prevAgency;
      }
      const text = elements.searchInput.value.toLowerCase();
      const agency = elements.agencyFilter.value;const status = elements.statusFilter.value;
      const filtered = projects.filter(p => {
        const projStatus = getProjectStatus(p);
        const matchText = (p.name || "").toLowerCase().includes(text) || (p.contractor || "").toLowerCase().includes(text);
        const matchAgency = agency ? p.implementingAgency === agency : true;
        let matchStatus = true;
        if(status){
          if(status === 'On-going'){
            // treat both On-going and Delayed as active work
            matchStatus = projStatus === 'On-going' || projStatus === 'Delayed';
          }else{
            matchStatus = projStatus === status;
          }
        }
        return matchText && matchAgency && matchStatus;
      });const tbody=document.getElementById('projectsTbody');tbody.innerHTML=filtered.map(projectRowHtml).join('');attachRowEvents();}

  function attachRowEvents(){const tbody=document.getElementById('projectsTbody');Array.from(tbody.querySelectorAll('tr')).forEach(row=>{row.addEventListener('click',e=>{if(isViewOnly) return; if(e.target.closest('button')) return;const pid=row.dataset.id;viewProject(pid);});});}

  window.editProject=(id)=>{const p=projects.find(x=>x.id===id);if(!p) return;populateForm(p);elements.projectModal.show();};

  window.viewProject=(id)=>{const p=projects.find(proj=>proj.id===id);if(!p) return;const photos=(p.photos&&p.photos.length)?p.photos:(p.sCurveDataUrl?[p.sCurveDataUrl]:[]);
  const billingHtml = (p.progressBilling&&p.progressBilling.length)?`<h6 class="mt-3">Billing Details</h6><div class="table-responsive"><table class="table table-sm"><thead><tr><th>Date</th><th>Amount (PHP)</th><th>Description</th></tr></thead><tbody>${p.progressBilling.map(b=>`<tr><td>${b.date}</td><td>₱${Number(b.amount).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td>${b.desc||''}</td></tr>`).join('')}</tbody></table></div>`:'';const photosHtml=photos.length?`<div class="d-flex gap-3 mb-3 flex-wrap">${photos.slice(0,3).map(url=>`<img src="${url}" class="img-fluid" style="max-height:300px;object-fit:contain;">`).join('')}</div>`:'';const body=document.getElementById('detailsBody');body.innerHTML=`<h5 class="fw-bold mb-2">${p.name}</h5><p><strong>Implementing Agency:</strong> ${p.implementingAgency}</p><p><strong>Contractor:</strong> ${p.contractor}</p>
<p><strong>Location:</strong> ${p.location || ''}</p><p><strong>Contract Amount:</strong> ₱${Number(p.contractAmount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p>${p.revisedContractAmount?`<p><strong>Revised Contract Amount:</strong> ₱${Number(p.revisedContractAmount).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p>`:''}<p><strong>Status:</strong> ${getProjectStatus(p)}</p><p><strong>NTP:</strong> ${p.ntpDate}</p><p><strong>Duration:</strong> ${p.originalDuration} days ${p.timeExtension?"+"+p.timeExtension:""}</p><p><strong>Target Completion:</strong> ${p.revisedCompletion||p.originalCompletion}</p>${p.remarks?`<p><strong>Remarks:</strong> ${p.remarks}</p>`:''}${p.otherDetails?`<p><strong>Details:</strong> ${p.otherDetails}</p>`:''}<h6 class="mt-3">Accomplishment History</h6><div class="table-responsive"><table class="table table-sm"><thead><tr><th>Date</th><th>% Accomplishment<br>Planned</th><th>% Accomplishment<br>Previous</th><th>% Accomplishment<br>To Date</th><th>Variance %</th><th>Activities</th><th>Issue</th><th>Action Taken</th></tr></thead><tbody>${(p.accomplishments||[]).map(a=>`<tr><td>${a.date}</td><td>${(a.plannedPercent??0).toFixed(2)}%</td><td>${(a.prevPercent??0).toFixed(2)}%</td><td>${(a.percent??0).toFixed(2)}%</td><td>${a.variance>=0?'+':''}${(a.variance??0).toFixed(2)}%</td><td>${a.activities||''}</td><td>${a.issue||p.issues||''}</td><td>${a.action||''}</td></tr>`).join('')}</tbody></table></div>${billingHtml}${(p.history||[]).length?`<h6 class="mt-3">Edit History</h6><div class="table-responsive"><table class="table table-sm"><thead><tr><th>User</th><th>Timestamp</th><th>Action</th></tr></thead><tbody>${p.history.map(h=>`<tr><td>${h.email}</td><td>${new Date(h.timestamp).toLocaleString()}</td><td>${h.action}</td></tr>`).join('')}</tbody></table></div>`:''}`;body.innerHTML+=photosHtml;const footer=document.getElementById('detailsFooter');footer.innerHTML=`<button class="btn btn-outline-secondary" id="printBtn"><i class="fa fa-print me-1"></i>Print</button><button class="btn btn-outline-success" id="docxBtn"><i class="fa fa-download me-1"></i>Word</button>`;document.getElementById('printBtn').onclick=()=>window.print();document.getElementById('docxBtn').onclick=()=>exportProjectDocx(p);bootstrap.Modal.getOrCreateInstance(document.getElementById('detailsModal')).show();};

  // simple docx export skipped for brevity ...

  /* Page Scroll & Modal Scroll Buttons */
  const scrollTopBtn=document.getElementById('scrollTopBtn');
  const scrollBottomBtn=document.getElementById('scrollBottomBtn');
  function toggleScrollButtons(){
      const scrolled = document.documentElement.scrollTop || document.body.scrollTop;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      // Only show the buttons when the page is at least 200 px taller than the viewport
      if (maxScroll < 200) {
        scrollTopBtn.style.display = 'none';
        scrollBottomBtn.style.display = 'none';
        return;
      }
      scrollTopBtn.style.display = scrolled > 100 ? 'flex' : 'none';
      scrollBottomBtn.style.display = scrolled < maxScroll - 100 ? 'flex' : 'none';
    }
  window.addEventListener('scroll',toggleScrollButtons);toggleScrollButtons();scrollTopBtn.addEventListener('click',()=>{window.scrollTo({top:0,behavior:'smooth'});});scrollBottomBtn.addEventListener('click',()=>{window.scrollTo({top:document.documentElement.scrollHeight,behavior:'smooth'});});
  const modalDialog=document.querySelector('#projectModal .modal-dialog-scrollable');
  const modalContent=document.querySelector('#projectModal .modal-body');
  const modalUp=document.getElementById('modalScrollUp');
  const modalDown=document.getElementById('modalScrollDown');
  function toggleModalScrollBtns(){if(!modalDialog) return;const scrolled=modalContent.scrollTop;const max=modalContent.scrollHeight-modalContent.clientHeight;modalUp.style.display=scrolled>50?'flex':'none';modalDown.style.display=scrolled<max-50?'flex':'none';}
  // View-only link
  if(viewOnlyLink){
    viewOnlyLink.addEventListener('click', async e=>{
      e.preventDefault();
      try{
        await firebase.auth().signInAnonymously();
      }catch(err){
        console.error('Anon sign-in failed',err);
        console.warn('Anon sign-in unavailable, proceeding without auth');
        isViewOnly = true;
        showApp();
        if(unsubscribeProjects) unsubscribeProjects();
        unsubscribeProjects = db.collection(PROJECTS_COL).onSnapshot(snap=>{
          projects = snap.docs.map(d=>({id:d.id,...d.data()}));
          render();
        });
      }
    });
  }
  // Attach listeners
  if(elements.projectForm) elements.projectForm.addEventListener('submit', onSaveProject);
  if(elements.searchInput) elements.searchInput.addEventListener('input', render);
  if(elements.agencyFilter) elements.agencyFilter.addEventListener('change', render);
  if(elements.statusFilter) elements.statusFilter.addEventListener('change', render);

  // ---- End project functions ----

// Signup handler
  signupForm.addEventListener('submit', e=>{
    
    e.preventDefault();
    const email=document.getElementById('signupEmail').value.trim();
    const pw1=document.getElementById('signupPassword').value;
    const pw2=document.getElementById('signupPassword2').value;
    if(pw1!==pw2){alert('Passwords do not match');return;}
    firebase.auth().createUserWithEmailAndPassword(email,pw1)
      .then(cred=>{
        // mark as unapproved
        return db.collection('users').doc(cred.user.uid).set({
          email: cred.user.email,
          approved: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(()=>{
          alert('Account request submitted. An admin will review your request.');
          firebase.auth().signOut();
          showLoginForm();
        });
      })
      .catch(err=>alert(err.message));
  });

  
  

function showLogin() {
loginScreen.classList.remove('d-none');
loginScreen.style.display = 'flex';
appWrapper.style.display  = 'none';
logoutBtn.style.display   = 'none';
}

function showSignup(){
  loginForm.classList.add('d-none');
  loginLinks.classList.add('d-none');
  signupForm.classList.remove('d-none');
  signupLinks.classList.remove('d-none');
  document.getElementById('loginTitle').textContent='Sign Up';
}

function showLoginForm(){
  signupForm.classList.add('d-none');
  signupLinks.classList.add('d-none');
  loginForm.classList.remove('d-none');
  loginLinks.classList.remove('d-none');
  document.getElementById('loginTitle').textContent='Login';
}

// link listeners
if(showSignupLink) showSignupLink.addEventListener('click',e=>{e.preventDefault();showSignup();});
if(showLoginLink)  showLoginLink.addEventListener('click',e=>{e.preventDefault();showLoginForm();});

function showApp() {
  if(isViewOnly){
    loginScreen.classList.add('d-none');
    appWrapper.style.display='block';
    loginBtn.style.display = 'inline-block';
    logoutBtn.style.display='none';
    return;
  }
  if(isViewOnly){
    loginScreen.classList.add('d-none');
    appWrapper.style.display='block';
    logoutBtn.style.display='none';
    return;
  }
loginScreen.classList.add('d-none');
appWrapper.style.display  = 'block';
loginBtn.style.display   = 'none';
logoutBtn.style.display   = 'inline-block';
}

const ADMIN_EMAIL_LOWER = ADMIN_EMAIL.toLowerCase();


  // Monitor auth state
  firebase.auth().onAuthStateChanged(async user => {
    if (user) {
      if(user.isAnonymous){
        isViewOnly = true;
        isAdmin = false;
        showApp();
        updateAdminUI();
        if(unsubscribeProjects) unsubscribeProjects();
        unsubscribeProjects = db.collection(PROJECTS_COL).onSnapshot(snap=>{
          projects = snap.docs.map(d=>({id:d.id,...d.data()}));
          render();
        });
        return;
      }
      const emailLower = (user.email||'').trim().toLowerCase();
      isAdmin = emailLower === ADMIN_EMAIL_LOWER;
      console.log('Signed-in as', user.email, '| isAdmin?', isAdmin);
      if(!isAdmin){
        const doc = await db.collection('users').doc(user.uid).get();
        if(!doc.exists || doc.data().approved!==true){
          alert('Your account is pending approval.');
          firebase.auth().signOut();
          return;
        }
      }
      showApp();
      updateAdminUI();
      if(unsubscribeProjects) unsubscribeProjects();
      const legacyKey='construction_projects';
async function migrateLegacyIfAny(){
  try{
    const legacy = JSON.parse(localStorage.getItem(legacyKey)||'[]');
    if(!legacy.length) return false;
    const batch = db.batch();
    legacy.forEach(p=>{
      const id=p.id|| (crypto.randomUUID?crypto.randomUUID():Date.now().toString(36));
      batch.set(db.collection(PROJECTS_COL).doc(id), {...p,id});
    });
    await batch.commit();
    localStorage.removeItem(legacyKey);
    console.log('Migrated',legacy.length,'legacy projects to Firestore');
    return true;
  }catch(err){console.error('Legacy migration failed',err); return false;}
}

await migrateLegacyIfAny();

unsubscribeProjects = db.collection(PROJECTS_COL).onSnapshot(async snap => {
        projects = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if(projects.length===0){
          // attempt legacy localStorage migration
          try{
            const legacy = JSON.parse(localStorage.getItem('construction_projects')||'[]');
            if(legacy.length){
              const batch = db.batch();
              legacy.forEach(p=>{
                const id = p.id || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36));
                batch.set(db.collection(PROJECTS_COL).doc(id), {...p,id});
              });
              await batch.commit();
              localStorage.removeItem('construction_projects');
              console.log('Migrated', legacy.length,'projects from localStorage to Firestore');
            }
          }catch(err){console.warn('Legacy migration failed',err);}
        }
        render();
      });
    } else {
      isAdmin = false;
      showLogin();
      if(unsubscribeProjects){unsubscribeProjects(); unsubscribeProjects=null;}
      projects=[];
      render();
    }
  });

  // Handle login form submission
  loginForm.addEventListener('submit', e => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const pw    = document.getElementById('loginPassword').value;
    firebase.auth().signInWithEmailAndPassword(email, pw)
      .catch(err => alert(err.message));
  });

  // Handle logout
  logoutBtn.addEventListener('click', () => firebase.auth().signOut());
  if(loginBtn) loginBtn.addEventListener('click', () => {
    // exit view-only: go back to login page
    isViewOnly = false;
    firebase.auth().signOut().catch(()=>{}); // ensure no anon session remains
    showLogin();
  });
  // Admin manage pending users
  elements.manageUsersBtn.addEventListener('click', ()=>{
    if(!isAdmin) return;
    loadPendingUsers();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('usersModal')).show();
  });

  document.getElementById("projectModal").addEventListener("shown.bs.modal", () => {
    toggleModalScrollBtns();
  });
  modalContent.addEventListener("scroll", toggleModalScrollBtns);
  modalUp.addEventListener("click", () => {
    modalContent.scrollTo({ top: 0, behavior: "smooth" });
  });
  modalDown.addEventListener("click", () => {
    modalContent.scrollTo({ top: modalContent.scrollHeight, behavior: "smooth" });
  });

})();
