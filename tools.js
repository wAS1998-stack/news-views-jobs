/* ==================================================================
   tools.js — India-focused calculators & utilities for News-Views.
   Everything runs in the visitor's browser (no uploads, no server), so the
   pages are fast, private and free to host. Each tool page carries a real
   explainer + FAQ so it can rank on its own, not just a widget.

   Exports buildToolPages(ctx) -> [{ path, html, title, changefreq }]
   ctx = { head, foot, esc, SITE, BUILT, breadcrumbLd, faqLd, faqSection, rates }
   ================================================================== */

/* ---- 7th CPC pay matrix (generated with the official 3% / round-to-100 rule) ---- */
const LEVELS = [
  ["1", 18000, 56900], ["2", 19900, 63200], ["3", 21700, 69100], ["4", 25500, 81100],
  ["5", 29200, 92300], ["6", 35400, 112400], ["7", 44900, 142400], ["8", 47600, 151100],
  ["9", 53100, 167800], ["10", 56100, 177500], ["11", 67700, 208700], ["12", 78800, 209200],
  ["13", 123100, 215900], ["13A", 131100, 216600], ["14", 144200, 218200], ["15", 182200, 224100],
  ["16", 205400, 224400], ["17", 225000, 225000], ["18", 250000, 250000],
];
function cells(start, cap) {
  const out = [start];
  while (out.length < 40) {
    const n = Math.round((out[out.length - 1] * 1.03) / 100) * 100;
    if (n > cap) break;
    out.push(n);
  }
  return out;
}
const MATRIX = LEVELS.map(([lv, start, cap]) => ({ level: lv, cells: cells(start, cap) }));

/* Posts commonly placed at each level — only well-established examples. */
const LEVEL_POSTS = {
  "1": ["Multi Tasking Staff (SSC MTS)", "Railway Group D / Level-1 posts (Track Maintainer, Helper)", "Peon, Daftary"],
  "2": ["Lower Division Clerk / Junior Secretariat Assistant (SSC CHSL)", "Railway Junior Clerk cum Typist (RRB NTPC 12th level)"],
  "3": ["Constable GD in CAPFs, SSF & Assam Rifles (SSC GD)", "Railway Trains Clerk"],
  "4": ["Postal / Sorting Assistant (SSC CHSL)", "Data Entry Operator", "Railway Accounts Clerk cum Typist"],
  "5": ["Railway Senior Clerk cum Typist & Junior Account Assistant (RRB NTPC graduate)", "Upper Division Clerk"],
  "6": ["Junior Engineer (SSC JE)", "Sub-Inspector in Delhi Police & CAPFs (SSC CPO)", "Railway Station Master (RRB NTPC)"],
  "7": ["Assistant Section Officer (SSC CGL)", "Inspector — Income Tax / Central Excise / Preventive Officer (SSC CGL)"],
  "8": ["Assistant Audit Officer / Assistant Accounts Officer (SSC CGL)"],
  "10": ["Group A entry — IAS, IPS, IFS and other Central Services (UPSC CSE)", "Assistant Commandant (UPSC CAPF)"],
  "11": ["Senior Time Scale in Group A services"],
  "14": ["Joint Secretary to the Government of India"],
  "15": ["Additional Secretary to the Government of India"],
  "17": ["Secretary to the Government of India"],
  "18": ["Cabinet Secretary"],
};

/* ---- shared salary maths (also shipped to the browser as a string) ---- */
const SALARY_JS = `
function nvSalary(basic, level, cityClass, tpta, daPct, nps) {
  var lv = parseInt(level, 10) || 13;
  var da = Math.round(basic * daPct / 100);
  var hraPct = cityClass === "X" ? 30 : cityClass === "Y" ? 20 : 10;
  var hraMin = cityClass === "X" ? 5400 : cityClass === "Y" ? 3600 : 1800;
  var hra = Math.max(Math.round(basic * hraPct / 100), hraMin);
  var taBase = tpta ? (lv <= 2 ? 1350 : lv <= 8 ? 3600 : 7200) : (lv <= 2 ? 900 : lv <= 8 ? 1800 : 3600);
  var ta = Math.round(taBase * (1 + daPct / 100));
  var gross = basic + da + hra + ta;
  var npsAmt = nps ? Math.round((basic + da) * 0.10) : 0;
  var cgegis = lv <= 5 ? 30 : lv <= 9 ? 60 : 120;
  var ded = npsAmt + cgegis;
  return { basic: basic, da: da, hra: hra, hraPct: hraPct, ta: ta, gross: gross, nps: npsAmt, cgegis: cgegis, ded: ded, net: gross - ded };
}
function nvInr(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }
`;
// eslint-disable-next-line no-new-func
const nvSalary = new Function(SALARY_JS + "; return nvSalary;")();
const inr = (n) => "₹" + Math.round(n).toLocaleString("en-IN");

/* ---- tool definitions ------------------------------------------- */
function photoTool({ slug, h1, title, desc, presetKey, intro, extraFaq = [] }) {
  return {
    slug, h1, title, desc, cat: "Documents",
    intro,
    body: `
<div class="tool" id="resizer" data-preset="${presetKey}">
  <label class="drop" for="rz-file"><input id="rz-file" type="file" accept="image/*"><span><b>Choose a photo</b> or drop it here<br><small>JPG, PNG or phone photo — it never leaves your device</small></span></label>
  <div class="tool-grid">
    <label>Preset<select id="rz-preset">
      <option value="photo">Photograph — 200×230 px, 20–50 KB</option>
      <option value="sign">Signature — 140×60 px, 10–20 KB</option>
      <option value="thumb">Left thumb impression — 240×240 px, 20–50 KB</option>
      <option value="decl">Handwritten declaration — 800×400 px, 50–100 KB</option>
      <option value="passport">Passport-size photo — 413×531 px (3.5×4.5 cm), 20–100 KB</option>
      <option value="kb20">Any image under 20 KB</option>
      <option value="kb50">Any image under 50 KB</option>
      <option value="kb100">Any image under 100 KB</option>
      <option value="kb200">Any image under 200 KB</option>
      <option value="custom">Custom size…</option>
    </select></label>
    <label>Width (px)<input id="rz-w" type="number" min="20" max="4000"></label>
    <label>Height (px)<input id="rz-h" type="number" min="20" max="4000"></label>
    <label>Min KB<input id="rz-min" type="number" min="0" max="5000"></label>
    <label>Max KB<input id="rz-max" type="number" min="5" max="5000"></label>
    <label class="chk"><input id="rz-crop" type="checkbox" checked> Crop to fit exactly</label>
  </div>
  <div class="rz-out" id="rz-out" hidden>
    <img id="rz-img" alt="Resized preview">
    <p class="rz-meta" id="rz-meta"></p>
    <a class="btn btn-primary" id="rz-dl" download="photo.jpg">Download JPG</a>
  </div>
  <p class="tool-note">Sizes above are the most common requirements in SSC, IBPS, RRB, UPSC and state commission forms. Always match the exact size stated in your notification.</p>
</div>
<script>
(function(){
  var P={photo:[200,230,20,50],sign:[140,60,10,20],thumb:[240,240,20,50],decl:[800,400,50,100],passport:[413,531,20,100],
    kb20:[0,0,5,20],kb50:[0,0,10,50],kb100:[0,0,20,100],kb200:[0,0,40,200],custom:[300,300,10,100]};
  var $=function(i){return document.getElementById(i)}, img=null;
  function setPreset(k){var p=P[k];$("rz-preset").value=k;$("rz-w").value=p[0]||"";$("rz-h").value=p[1]||"";$("rz-min").value=p[2];$("rz-max").value=p[3];
    $("rz-w").placeholder=p[0]?"":"keep";$("rz-h").placeholder=p[1]?"":"keep";}
  setPreset(document.getElementById("resizer").dataset.preset||"photo");
  function draw(w,h){var c=document.createElement("canvas");c.width=w;c.height=h;var x=c.getContext("2d");
    x.fillStyle="#fff";x.fillRect(0,0,w,h);x.imageSmoothingQuality="high";
    var sw=img.naturalWidth,sh=img.naturalHeight;
    if($("rz-crop").checked){var r=Math.max(w/sw,h/sh),cw=w/r,ch=h/r;x.drawImage(img,(sw-cw)/2,(sh-ch)/2,cw,ch,0,0,w,h);}
    else{var r2=Math.min(w/sw,h/sh),dw=sw*r2,dh=sh*r2;x.drawImage(img,0,0,sw,sh,(w-dw)/2,(h-dh)/2,dw,dh);}
    return c;}
  function toBlob(c,q){return new Promise(function(res){c.toBlob(res,"image/jpeg",q)});}
  async function run(){
    if(!img)return;
    var W=parseInt($("rz-w").value,10),H=parseInt($("rz-h").value,10);
    var mn=(parseFloat($("rz-min").value)||0)*1024,mx=(parseFloat($("rz-max").value)||200)*1024;
    if(!W||!H){W=img.naturalWidth;H=img.naturalHeight;var lim=Math.max(400,Math.min(1600,Math.round(Math.sqrt(mx)*5)));if(Math.max(W,H)>lim){var s=lim/Math.max(W,H);W=Math.round(W*s);H=Math.round(H*s);}}
    var c=draw(W,H),best=null,lo=0.05,hi=0.95,b;
    for(var i=0;i<9;i++){var q=(lo+hi)/2;b=await toBlob(c,q);if(b.size>mx){hi=q;}else{best=b;lo=q;}}
    var scale=1;
    while(!best&&scale>0.15){scale*=0.85;c=draw(Math.round(W*scale),Math.round(H*scale));
      lo=0.05;hi=0.85;for(var j=0;j<7;j++){var q2=(lo+hi)/2;b=await toBlob(c,q2);if(b.size>mx){hi=q2;}else{best=b;lo=q2;}}}
    if(!best)best=b;
    if(best.size<mn){var hb=await toBlob(c,0.98);if(hb.size<=mx)best=hb;}
    var url=URL.createObjectURL(best);$("rz-img").src=url;$("rz-dl").href=url;
    var kb=(best.size/1024).toFixed(1);
    $("rz-meta").innerHTML="<b>"+c.width+"×"+c.height+" px</b> · <b>"+kb+" KB</b>"+(best.size<mn?" — below the minimum: the image has little detail; try a larger photo or turn off cropping.":best.size>mx?" — still above the limit; try smaller dimensions.":" ✓ within limits");
    $("rz-out").hidden=false;}
  function load(f){if(!f)return;var r=new FileReader();r.onload=function(){img=new Image();img.onload=run;img.src=r.result};r.readAsDataURL(f);}
  $("rz-file").addEventListener("change",function(e){load(e.target.files[0])});
  var d=document.querySelector(".drop");["dragover","dragenter"].forEach(function(t){d.addEventListener(t,function(e){e.preventDefault();d.classList.add("on")})});
  ["dragleave","drop"].forEach(function(t){d.addEventListener(t,function(e){e.preventDefault();d.classList.remove("on")})});
  d.addEventListener("drop",function(e){load(e.dataTransfer.files[0])});
  $("rz-preset").addEventListener("change",function(e){setPreset(e.target.value);run()});
  ["rz-w","rz-h","rz-min","rz-max","rz-crop"].forEach(function(i){$(i).addEventListener("change",run)});
})();
</script>`,
    article: [
      ["Why online forms reject photos", "Recruitment portals check three things automatically: the file type (almost always JPG/JPEG), the pixel dimensions and the file size in kilobytes. A phone photo is usually 3–5 MB and thousands of pixels wide, so it fails all three. This tool crops the image to the exact pixel size, then adjusts JPEG quality until the file lands inside the KB range — all inside your browser."],
      ["Photo checklist for government exam forms", "Use a recent colour photo with a plain white or light background, face centred and covering about 70% of the frame, eyes open and looking at the camera, no cap or dark glasses. Scan or photograph your signature in black ink on white paper, cropping tightly around it. Many recent notifications (SSC, IBPS) also ask for a left-thumb impression and a handwritten declaration — presets for both are included."],
      ["Privacy", "Your photo is processed with the browser's own canvas — nothing is uploaded to any server. You can even switch to airplane mode after the page loads and it will still work."],
    ],
    faq: [
      { q: "What size photo is required for SSC and IBPS forms?", a: "Most notifications ask for a JPG photograph of about 200×230 pixels between 20 and 50 KB and a signature of about 140×60 pixels between 10 and 20 KB. Always confirm the exact limits in your notification, as some exams differ." },
      { q: "Is my photo uploaded anywhere?", a: "No. The resizing happens entirely in your browser using the canvas API; the image never leaves your device." },
      { q: "The result is below the minimum KB — what should I do?", a: "Very plain images compress extremely well. Start from a higher-resolution photo, or untick 'Crop to fit' so more detail is kept; the tool already uses near-maximum quality when a file is under the minimum." },
      ...extraFaq,
    ],
  };
}

function buildDefs(rates) {
  const DA = Number(rates.daPercent || 60);
  const defs = [];

  defs.push(photoTool({
    slug: "photo-resizer", presetKey: "photo",
    h1: "Photo & Signature Resizer for Govt Exam Forms",
    title: "Photo Resizer for SSC, IBPS, RRB Forms – 20 KB to 50 KB",
    desc: "Resize your photo, signature, thumb impression and declaration to the exact pixel size and KB limit for SSC, IBPS, RRB and UPSC forms. Free, instant, no upload.",
    intro: "Get your photograph and signature accepted on the first try. Pick a preset, choose your image and download a JPG at the exact pixel size and file size the application portal expects.",
  }));
  defs.push(photoTool({
    slug: "signature-resizer", presetKey: "sign",
    h1: "Signature Resizer — 10 KB to 20 KB, 140×60 px",
    title: "Signature Resize to 20 KB (140×60) for Online Forms",
    desc: "Resize a scanned or photographed signature to 140×60 pixels and 10–20 KB for SSC, IBPS, RRB and other online application forms. Free and private.",
    intro: "Sign in black ink on plain white paper, take a well-lit photo, and this tool crops it to 140×60 pixels and compresses it into the 10–20 KB range most recruitment forms require.",
  }));
  for (const kb of [20, 50, 100, 200]) {
    defs.push(photoTool({
      slug: `resize-image-to-${kb}kb`, presetKey: `kb${kb}`,
      h1: `Resize Image to ${kb} KB Online`,
      title: `Resize Image to ${kb} KB – Free Photo Compressor (JPG)`,
      desc: `Compress any photo or document image to under ${kb} KB in seconds, keeping it sharp. Ideal for exam forms, scholarship portals and job applications. No upload.`,
      intro: `Upload limits like "maximum ${kb} KB" are common on government portals. Choose your image and this tool finds the highest quality that still fits under ${kb} KB, or set exact pixel dimensions too.`,
      extraFaq: [{ q: `How do I reduce a photo to ${kb} KB without losing quality?`, a: `The tool lowers JPEG quality step by step and only shrinks the dimensions if quality alone cannot reach ${kb} KB, so you get the sharpest image that fits.` }],
    }));
  }

  defs.push({
    slug: "age-calculator", cat: "Eligibility",
    h1: "Age Calculator for Government Exams",
    title: "Age Calculator for Govt Exams – Age as on Cut-off Date",
    desc: "Calculate your exact age on the exam's cut-off date and check eligibility with OBC, SC/ST, PwBD age relaxation — for SSC, UPSC, Railway, Banking and state exams.",
    intro: "Every notification fixes a cut-off date (for example 1 January or 1 August) and a minimum and maximum age. Enter your date of birth and the notification's details to see your exact age and whether you qualify after category relaxation.",
    body: `
<div class="tool" id="age">
  <div class="tool-grid">
    <label>Date of birth<input id="ag-dob" type="date" value="2002-01-01"></label>
    <label>Age as on (cut-off date)<input id="ag-on" type="date"></label>
    <label>Minimum age<input id="ag-min" type="number" value="18" min="0" max="70"></label>
    <label>Maximum age (General)<input id="ag-max" type="number" value="27" min="0" max="70"></label>
    <label>Category<select id="ag-cat">
      <option value="0">General / EWS</option><option value="3">OBC (non-creamy layer) +3</option><option value="5">SC / ST +5</option>
      <option value="10">PwBD (General/EWS) +10</option><option value="13">PwBD (OBC) +13</option><option value="15">PwBD (SC/ST) +15</option>
    </select></label>
  </div>
  <div class="result" id="ag-res"></div>
  <p class="tool-note">Relaxations shown are the standard central-government rules. Ex-servicemen, departmental candidates, widows and some states have different relaxations — check your notification.</p>
</div>
<script>
(function(){
  var $=function(i){return document.getElementById(i)};
  var y=new Date().getFullYear(); $("ag-on").value=(y+1)+"-01-01";
  function diff(a,b){var Y=b.getFullYear()-a.getFullYear(),M=b.getMonth()-a.getMonth(),D=b.getDate()-a.getDate();
    if(D<0){M--;D+=new Date(b.getFullYear(),b.getMonth(),0).getDate();} if(M<0){Y--;M+=12;} return [Y,M,D];}
  function fmt(d){return d.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});}
  function run(){
    var dob=new Date($("ag-dob").value+"T00:00:00"),on=new Date($("ag-on").value+"T00:00:00");
    if(isNaN(dob)||isNaN(on)){$("ag-res").innerHTML="";return;}
    var a=diff(dob,on),mn=+$("ag-min").value||0,mx=(+$("ag-max").value||0)+(+$("ag-cat").value||0);
    // Eligible if born on/after (on - (mx+1) years + 1 day) and on/before (on - mn years)
    var latest=new Date(on);latest.setFullYear(on.getFullYear()-mn);
    var earliest=new Date(on);earliest.setFullYear(on.getFullYear()-mx-1);earliest.setDate(earliest.getDate()+1);
    var ok=dob>=earliest&&dob<=latest;
    $("ag-res").innerHTML='<p class="big">'+a[0]+' years, '+a[1]+' months, '+a[2]+' days</p>'+
      '<p class="'+(ok?"ok":"no")+'">'+(ok?"✓ Eligible":"✗ Not eligible")+' for an age limit of '+mn+'–'+mx+' years (after relaxation) as on '+fmt(on)+'.</p>'+
      '<p>Eligible birth dates: <b>'+fmt(earliest)+'</b> to <b>'+fmt(latest)+'</b>.</p>';
  }
  ["ag-dob","ag-on","ag-min","ag-max","ag-cat"].forEach(function(i){$(i).addEventListener("input",run)}); run();
})();
</script>`,
    article: [
      ["How the cut-off date works", "Your age is counted on a fixed date written in the notification — not on the day you apply. If an exam says 18–27 years as on 1 August, a candidate born on 2 August 1999 is 26 on that date and eligible, while someone born on 1 August 1998 has already turned 28 and is not. The calculator also gives the exact range of birth dates that qualify, which is how most notifications phrase it (\"born not before … and not later than …\")."],
      ["Standard age relaxation", "Under central-government rules the upper age limit is relaxed by 3 years for OBC (non-creamy layer), 5 years for SC/ST, and 10 years for Persons with Benchmark Disabilities (13 for PwBD-OBC, 15 for PwBD-SC/ST). EWS candidates get no age relaxation in central recruitment. Ex-servicemen usually get their military service plus 3 years, and departmental or state-specific rules vary."],
    ],
    faq: [
      { q: "How is age calculated for SSC exams?", a: "SSC fixes a crucial date, usually 1 January or 1 August of the exam year. Enter that date in 'Age as on' and the minimum and maximum age for your post to see if you are eligible." },
      { q: "Is the upper age limit inclusive?", a: "Yes. An upper limit of 27 years means you are eligible until the day before your 28th birthday falls on or before the cut-off date — the calculator applies this rule." },
      { q: "Do EWS candidates get age relaxation?", a: "Not in central government recruitment. Some states give EWS relaxation, so check the state notification." },
    ],
  });

  defs.push({
    slug: "income-tax-calculator", cat: "Salary & Tax",
    h1: `Income Tax Calculator ${rates.taxYear || "FY 2026-27"}`,
    title: "Income Tax Calculator FY 2026-27 – New vs Old Regime",
    desc: "Compare tax under the new and old regime for FY 2026-27 (AY 2027-28): ₹75,000 standard deduction, zero tax up to ₹12 lakh, 80C, HRA, home loan — see which saves more.",
    intro: "Enter your annual salary and any deductions to see your tax under both regimes side by side, with the Section 87A rebate, marginal relief, surcharge and 4% cess applied.",
    body: `
<div class="tool" id="tax">
  <div class="tool-grid">
    <label>Annual gross salary / income (₹)<input id="tx-inc" type="number" value="1200000" min="0" step="10000"></label>
    <label>Age<select id="tx-age"><option value="0">Below 60</option><option value="1">60 to 79</option><option value="2">80 and above</option></select></label>
    <label class="chk"><input id="tx-sal" type="checkbox" checked> Salaried / pensioner (standard deduction)</label>
    <label>Employer NPS contribution, 80CCD(2) (₹)<input id="tx-enps" type="number" value="0" min="0"></label>
  </div>
  <details class="old-ded" open><summary>Old-regime deductions (ignored in new regime)</summary>
  <div class="tool-grid">
    <label>80C — PF, PPF, LIC, ELSS, tuition (max 1.5 L)<input id="tx-80c" type="number" value="150000" min="0"></label>
    <label>80D — health insurance<input id="tx-80d" type="number" value="25000" min="0"></label>
    <label>HRA exemption<input id="tx-hra" type="number" value="0" min="0"></label>
    <label>Home-loan interest, 24(b) (max 2 L)<input id="tx-hl" type="number" value="0" min="0"></label>
    <label>NPS 80CCD(1B) (max 50,000)<input id="tx-nps" type="number" value="0" min="0"></label>
    <label>Other deductions (80E, 80G, 80TTA…)<input id="tx-oth" type="number" value="0" min="0"></label>
  </div></details>
  <div class="result tax-res" id="tx-res"></div>
  <p class="tool-note">Rates: Finance Act slabs for FY 2026-27 (unchanged from FY 2025-26). Surcharge marginal relief is not modelled for incomes above ₹50 lakh. This is an estimate — consult a tax professional for filing.</p>
</div>
<script>
(function(){
  var $=function(i){return document.getElementById(i)}, v=function(i){return Math.max(0,+$(i).value||0)};
  function slab(t,s){var tax=0,prev=0;for(var i=0;i<s.length;i++){var lim=s[i][0],r=s[i][1];if(t>prev){tax+=(Math.min(t,lim)-prev)*r;}prev=lim;}return tax;}
  function sur(inc,tax,isNew){var r=inc>5e7?(isNew?.25:.37):inc>2e7?.25:inc>1e7?.15:inc>5e6?.10:0;return tax*r;}
  function inr(n){return "₹"+Math.round(n).toLocaleString("en-IN");}
  function run(){
    var inc=v("tx-inc"),sal=$("tx-sal").checked,age=+$("tx-age").value,enps=v("tx-enps");
    // NEW regime
    var tiN=Math.max(0,inc-(sal?75000:0)-enps);
    var N=[[4e5,0],[8e5,.05],[12e5,.10],[16e5,.15],[2e6,.20],[24e5,.25],[1e15,.30]];
    var tN=slab(tiN,N);
    if(tiN<=12e5)tN=0; else tN=Math.min(tN,tiN-12e5);           // 87A rebate + marginal relief
    tN+=sur(tiN,tN,true); var cN=tN*0.04; tN+=cN;
    // OLD regime
    var ded=Math.min(v("tx-80c"),150000)+v("tx-80d")+v("tx-hra")+Math.min(v("tx-hl"),200000)+Math.min(v("tx-nps"),50000)+v("tx-oth")+enps;
    var tiO=Math.max(0,inc-(sal?50000:0)-ded);
    var ex=age===2?5e5:age===1?3e5:2.5e5;
    var O=[[ex,0],[5e5,.05],[1e6,.20],[1e15,.30]]; if(age===2)O=[[5e5,0],[1e6,.20],[1e15,.30]];
    var tO=slab(tiO,O); if(tiO<=5e5)tO=0;                         // 87A old regime
    tO+=sur(tiO,tO,false); tO+=tO*0.04;
    var better=tN<=tO?"new":"old",save=Math.abs(tO-tN);
    $("tx-res").innerHTML='<div class="cmp"><div class="'+(better==="new"?"win":"")+'"><h3>New regime</h3><p>Taxable income <b>'+inr(tiN)+'</b></p><p class="big">'+inr(tN)+'</p><p>'+inr(tN/12)+' per month</p></div>'+
      '<div class="'+(better==="old"?"win":"")+'"><h3>Old regime</h3><p>Taxable income <b>'+inr(tiO)+'</b></p><p class="big">'+inr(tO)+'</p><p>'+inr(tO/12)+' per month</p></div></div>'+
      '<p class="ok">'+(save<1?"Both regimes give the same tax.":"The <b>"+better+" regime</b> saves you <b>"+inr(save)+"</b> a year.")+'</p>';
  }
  document.querySelectorAll("#tax input,#tax select").forEach(function(e){e.addEventListener("input",run)}); run();
})();
</script>`,
    article: [
      ["New regime slabs for FY 2026-27", "Up to ₹4 lakh: nil · ₹4–8 lakh: 5% · ₹8–12 lakh: 10% · ₹12–16 lakh: 15% · ₹16–20 lakh: 20% · ₹20–24 lakh: 25% · above ₹24 lakh: 30%. Salaried taxpayers get a ₹75,000 standard deduction, and the Section 87A rebate (up to ₹60,000) makes taxable income up to ₹12 lakh completely tax-free — so a salary of up to ₹12.75 lakh pays no tax. Just above ₹12 lakh, marginal relief caps the tax at the amount by which income exceeds ₹12 lakh."],
      ["Old regime slabs", "Up to ₹2.5 lakh: nil (₹3 lakh for seniors 60–79, ₹5 lakh for 80+) · up to ₹5 lakh: 5% · ₹5–10 lakh: 20% · above ₹10 lakh: 30%. The standard deduction is ₹50,000 and the 87A rebate makes taxable income up to ₹5 lakh tax-free. The old regime still wins for people with large deductions — typically full 80C, HRA in a metro and a home loan."],
      ["Which regime should government employees choose?", "Central and state employees under NPS get the employer's NPS contribution (14% of basic + DA) deductible under 80CCD(2) in both regimes. With that deduction plus the higher new-regime rebate, most employees up to about ₹15–16 lakh pay less in the new regime unless they claim HRA and a home loan together. Enter your own numbers above — the comparison updates instantly."],
    ],
    faq: [
      { q: "Is income up to ₹12 lakh tax-free in FY 2026-27?", a: "Yes, under the new regime. Taxable income up to ₹12 lakh gets a full rebate under Section 87A, and salaried people also get a ₹75,000 standard deduction, so salary up to ₹12.75 lakh pays no tax." },
      { q: "Did Budget 2026 change the tax slabs?", a: "No. The slabs, rebate and standard deduction for FY 2026-27 are the same as FY 2025-26." },
      { q: "Can I switch between old and new regime every year?", a: "Salaried individuals without business income can choose the regime each year when filing the return. Those with business income can switch back only once." },
    ],
  });

  // 7th CPC salary calculator
  const levelOpts = MATRIX.map((m) => `<option value="${m.level}">Level ${m.level} — from ${inr(m.cells[0])}</option>`).join("");
  defs.push({
    slug: "7th-pay-commission-salary-calculator", cat: "Salary & Tax",
    h1: "7th Pay Commission Salary Calculator",
    title: `7th Pay Salary Calculator ${new Date().getFullYear()} – In-hand with ${DA}% DA`,
    desc: `Calculate central government salary under the 7th CPC pay matrix: basic pay, DA at ${DA}%, HRA (X/Y/Z city), transport allowance, NPS deduction and in-hand pay for every level.`,
    intro: `Choose your pay level and basic pay to see the full salary slip — Dearness Allowance at the current ${DA}% rate (effective ${rates.daEffective || ""}), HRA for your city class, transport allowance with DA, NPS and approximate in-hand pay.`,
    body: `
<div class="tool" id="sal">
  <div class="tool-grid">
    <label>Pay level<select id="sl-lv">${levelOpts}</select></label>
    <label>Basic pay (cell)<select id="sl-basic"></select></label>
    <label>City class (HRA)<select id="sl-city"><option value="X">X — metro (30%)</option><option value="Y" selected>Y — big city (20%)</option><option value="Z">Z — others (10%)</option></select></label>
    <label>DA %<input id="sl-da" type="number" value="${DA}" min="0" max="200"></label>
    <label class="chk"><input id="sl-tpta" type="checkbox"> Higher-TA city (Delhi, Mumbai, Kolkata, Chennai, Bengaluru, Hyderabad etc.)</label>
    <label class="chk"><input id="sl-nps" type="checkbox" checked> NPS / UPS deduction (10%)</label>
  </div>
  <div class="result" id="sl-res"></div>
  <p class="tool-note">DA ${DA}% from ${rates.daEffective || ""}. ${rates.daNextExpected || ""} — change the DA box to preview it. CGEGIS is an approximate group-wise figure; income tax and professional tax are not deducted here.</p>
</div>
<script>
${SALARY_JS}
(function(){
  var M=${JSON.stringify(Object.fromEntries(MATRIX.map((m) => [m.level, m.cells])))};
  var $=function(i){return document.getElementById(i)};
  var q=new URLSearchParams(location.search); if(q.get("level")&&M[q.get("level")])$("sl-lv").value=q.get("level");
  function fill(){var c=M[$("sl-lv").value];$("sl-basic").innerHTML=c.map(function(b,i){return '<option value="'+b+'">Cell '+(i+1)+' — '+nvInr(b)+'</option>'}).join("");}
  function row(k,v,cls){return '<tr'+(cls?' class="'+cls+'"':'')+'><td>'+k+'</td><td>'+v+'</td></tr>';}
  function run(){var s=nvSalary(+$("sl-basic").value,$("sl-lv").value,$("sl-city").value,$("sl-tpta").checked,+$("sl-da").value||0,$("sl-nps").checked);
    $("sl-res").innerHTML='<p class="big">'+nvInr(s.net)+' <small>approx. in-hand / month</small></p><table class="slip">'+
      row("Basic pay",nvInr(s.basic))+row("Dearness Allowance ("+(+$("sl-da").value||0)+"%)",nvInr(s.da))+row("HRA ("+s.hraPct+"%)",nvInr(s.hra))+row("Transport allowance + DA",nvInr(s.ta))+
      row("<b>Gross salary</b>","<b>"+nvInr(s.gross)+"</b>","tot")+row("NPS (10% of basic + DA)","− "+nvInr(s.nps))+row("CGEGIS","− "+nvInr(s.cgegis))+
      row("<b>In-hand (before tax)</b>","<b>"+nvInr(s.net)+"</b>","tot")+'</table><p>Annual gross: <b>'+nvInr(s.gross*12)+'</b></p>';}
  $("sl-lv").addEventListener("change",function(){fill();run()});
  ["sl-basic","sl-city","sl-da","sl-tpta","sl-nps"].forEach(function(i){$(i).addEventListener("input",run)});
  fill();run();
})();
</script>`,
    article: [
      ["How a central government salary is built", `Pay is fixed by the 7th CPC pay matrix: each Level has 40 'cells' and you move up one cell (a 3% raise) every year on 1 January or 1 July. On top of the basic pay you get Dearness Allowance (now ${DA}% of basic), House Rent Allowance (30%, 20% or 10% of basic for X, Y and Z class cities, since DA crossed 50%), and Transport Allowance, which itself carries DA. NPS (or the Unified Pension Scheme) deducts 10% of basic + DA, and the government adds 14% to your pension account.`],
      ["Salary by pay level", `See the detailed page for each level — starting salary, in-hand pay in each city class and the posts recruited at that level: ${MATRIX.map((m) => `<a href="/salary/pay-level-${m.level.toLowerCase()}/">Level ${m.level}</a>`).join(", ")}.`],
    ],
    faq: [
      { q: `What is the current DA rate?`, a: `DA is ${DA}% of basic pay with effect from ${rates.daEffective}. ${rates.daNextExpected || ""}` },
      { q: "What are X, Y and Z cities?", a: "They are HRA classes by population. X cities are the large metros (Delhi, Mumbai, Bengaluru, Chennai, Kolkata, Hyderabad, Pune, Ahmedabad), Y cities include most state capitals and large towns, and everywhere else is Z." },
      { q: "When do central employees get their increment?", a: "Once a year on 1 January or 1 July, depending on the date of joining or promotion. It moves you one cell down the pay matrix column, about 3% higher." },
    ],
  });

  defs.push({
    slug: "8th-pay-commission-salary-calculator", cat: "Salary & Tax",
    h1: "8th Pay Commission Salary Calculator (Estimate)",
    title: "8th Pay Commission Salary Calculator – Fitment Factor Estimate",
    desc: "Estimate your revised basic pay and salary under the 8th Pay Commission with different fitment factors (1.83 to 2.86). Clear status update: what is official and what is not.",
    intro: "The 8th Central Pay Commission was constituted on 3 November 2025 and has not yet given its report, so no fitment factor is official. Use this calculator to see what your pay would look like under the figures being discussed.",
    body: `
<div class="tool" id="cpc8">
  <div class="tool-grid">
    <label>Current basic pay (7th CPC) ₹<input id="c8-basic" type="number" value="35400" min="18000" step="100"></label>
    <label>Fitment factor<select id="c8-ff"><option>1.83</option><option selected>1.92</option><option>2.28</option><option>2.57</option><option>2.86</option></select></label>
    <label>Custom factor<input id="c8-cf" type="number" step="0.01" placeholder="e.g. 2.10"></label>
    <label>City class<select id="c8-city"><option value="X">X (metro)</option><option value="Y" selected>Y</option><option value="Z">Z</option></select></label>
  </div>
  <div class="result" id="c8-res"></div>
  <p class="tool-note">Projection only. DA resets to 0% when a new pay commission is implemented, so the comparison uses DA 0% for the 8th CPC estimate and the current ${DA}% for today's pay. HRA is shown at today's 30/20/10% rates.</p>
</div>
<script>
${SALARY_JS}
(function(){
  var $=function(i){return document.getElementById(i)};
  function run(){var b=+$("c8-basic").value||0,f=+$("c8-cf").value||+$("c8-ff").value,c=$("c8-city").value;
    var nb=Math.round(b*f/100)*100, now=nvSalary(b,7,c,false,${DA},true), nw=nvSalary(nb,7,c,false,0,true);
    $("c8-res").innerHTML='<div class="cmp"><div><h3>Today (7th CPC)</h3><p>Basic <b>'+nvInr(b)+'</b></p><p class="big">'+nvInr(now.gross)+'</p><p>gross / month</p></div>'+
      '<div class="win"><h3>8th CPC at '+f+'×</h3><p>Basic <b>'+nvInr(nb)+'</b></p><p class="big">'+nvInr(nw.gross)+'</p><p>gross / month</p></div></div>'+
      '<p class="ok">Change: <b>'+(nw.gross>=now.gross?"+":"")+nvInr(nw.gross-now.gross)+'</b> a month ('+(((nw.gross/now.gross)-1)*100).toFixed(1)+'%).</p>';}
  ["c8-basic","c8-ff","c8-cf","c8-city"].forEach(function(i){$(i).addEventListener("input",run)}); run();
})();
</script>`,
    article: [
      ["Where the 8th Pay Commission stands", "The government announced the 8th CPC on 16 January 2025 and constituted it on 3 November 2025, with Justice Ranjana Prakash Desai as Chairperson and an 18-month mandate. The report is therefore expected around mid-2027. The pay revision is widely expected to take effect from 1 January 2026, with arrears — but that is decided only when the Cabinet accepts the report."],
      ["What the fitment factor means", "The fitment factor multiplies your current basic pay to give the new basic. The 7th CPC used 2.57. For the 8th CPC, figures around 1.83–2.86 are being discussed by analysts and staff unions; 1.92 is the most commonly quoted projection. None of these is official. Because DA is merged into the new basic and restarts from zero, a factor below about 1.60 would barely change take-home pay at today's DA of 60%."],
    ],
    faq: [
      { q: "Has the 8th Pay Commission fitment factor been announced?", a: "No. The commission has not submitted its report; any fitment factor you see is a projection or a union demand." },
      { q: "From when will the 8th Pay Commission be applicable?", a: "It is expected to be effective from 1 January 2026, but the date is confirmed only when the government accepts the report, likely in 2027." },
      { q: "Will DA become zero after the 8th Pay Commission?", a: "Yes. At each pay revision the existing DA is merged into the new basic pay and DA restarts from 0%." },
    ],
  });

  defs.push({
    slug: "percentage-calculator", cat: "Exams",
    h1: "Marks Percentage & CGPA Calculator",
    title: "Percentage Calculator for Marks & CGPA to Percentage",
    desc: "Convert marks to percentage, CGPA to percentage (CBSE ×9.5 and university formulas) and percentage to CGPA — for job and exam application forms.",
    intro: "Application forms ask for your marks as a percentage. Convert total marks, or a CGPA on a 10-point scale, in one step.",
    body: `
<div class="tool" id="pct">
  <h3>Marks to percentage</h3>
  <div class="tool-grid"><label>Marks obtained<input id="pc-o" type="number" value="432"></label><label>Total marks<input id="pc-t" type="number" value="500"></label></div>
  <p class="result" id="pc-r1"></p>
  <h3>CGPA to percentage</h3>
  <div class="tool-grid"><label>CGPA (10-point)<input id="pc-c" type="number" step="0.01" value="8.2"></label>
    <label>Formula<select id="pc-f"><option value="9.5">CBSE / most universities (× 9.5)</option><option value="10">× 10</option><option value="vtu">VTU ((CGPA − 0.75) × 10)</option><option value="mu">Mumbai Univ. (7.1 × CGPA + 11)</option></select></label></div>
  <p class="result" id="pc-r2"></p>
  <h3>Percentage to CGPA</h3>
  <div class="tool-grid"><label>Percentage<input id="pc-p" type="number" step="0.01" value="78"></label></div>
  <p class="result" id="pc-r3"></p>
</div>
<script>
(function(){
  var $=function(i){return document.getElementById(i)};
  function run(){
    var o=+$("pc-o").value,t=+$("pc-t").value; $("pc-r1").innerHTML=t>0?'<b>'+(o/t*100).toFixed(2)+'%</b>':"";
    var c=+$("pc-c").value,f=$("pc-f").value,p=f==="vtu"?(c-0.75)*10:f==="mu"?7.1*c+11:c*(+f); $("pc-r2").innerHTML='<b>'+p.toFixed(2)+'%</b>';
    var pp=+$("pc-p").value; $("pc-r3").innerHTML='<b>'+(pp/9.5).toFixed(2)+' CGPA</b> (÷ 9.5)';
  }
  document.querySelectorAll("#pct input,#pct select").forEach(function(e){e.addEventListener("input",run)}); run();
})();
</script>`,
    article: [
      ["Which CGPA formula should I use?", "CBSE certificates state that percentage = CGPA × 9.5, and most universities on a 10-point scale use the same rule. Some universities publish their own conversion on the marksheet or in an ordinance — if yours does, that formula takes precedence, and recruiters accept the one printed by your university."],
      ["Rounding in application forms", "Enter the percentage exactly as calculated, up to two decimals. Do not round 59.6% up to 60% to meet an eligibility condition — most notifications explicitly say percentages will not be rounded off."],
    ],
    faq: [
      { q: "How do I convert CGPA to percentage for SSC or bank forms?", a: "Use the conversion formula of your board or university. For CBSE and most universities it is CGPA × 9.5. If your university gives no formula, many recruiters accept CGPA × 10 — check the notification." },
      { q: "How is percentage calculated from marks?", a: "Divide the marks obtained by the maximum marks and multiply by 100. Include all subjects counted in the aggregate on your marksheet." },
    ],
  });

  defs.push({
    slug: "exam-score-calculator", cat: "Exams",
    h1: "Exam Score Calculator with Negative Marking",
    title: "Exam Marks Calculator with Negative Marking – SSC, RRB, IBPS",
    desc: "Calculate your expected score from the answer key: correct and wrong answers, marks per question and negative marking (1/4, 1/3, 0.5) for SSC, RRB, IBPS and state exams.",
    intro: "Compare your responses with the answer key, then enter how many you got right and wrong. The calculator applies the exam's marking scheme to give your raw score and accuracy.",
    body: `
<div class="tool" id="sc">
  <div class="tool-grid">
    <label>Preset<select id="sc-p">
      <option value="2,0.5,100">SSC CGL / CHSL Tier 1 (+2, −0.5, 100 Qs)</option>
      <option value="2,0.25,80">SSC GD (+2, −0.25, 80 Qs)</option>
      <option value="1,0.333333,100">RRB NTPC / Group D (+1, −1/3, 100 Qs)</option>
      <option value="1,0.25,100">IBPS / SBI Prelims (+1, −0.25, 100 Qs)</option>
      <option value="2,0.666667,100">UPSC Prelims GS (+2, −0.66, 100 Qs)</option>
      <option value="1,0,100">No negative marking</option>
    </select></label>
    <label>Correct answers<input id="sc-c" type="number" value="70" min="0"></label>
    <label>Wrong answers<input id="sc-w" type="number" value="12" min="0"></label>
    <label>Marks per correct<input id="sc-m" type="number" step="0.01"></label>
    <label>Negative per wrong<input id="sc-n" type="number" step="0.01"></label>
    <label>Total questions<input id="sc-t" type="number"></label>
  </div>
  <div class="result" id="sc-res"></div>
</div>
<script>
(function(){
  var $=function(i){return document.getElementById(i)};
  function preset(){var p=$("sc-p").value.split(",");$("sc-m").value=p[0];$("sc-n").value=(+p[1]).toFixed(2);$("sc-t").value=p[2];}
  function run(){var c=+$("sc-c").value||0,w=+$("sc-w").value||0,m=+$("sc-m").value||0,n=+$("sc-n").value||0,t=+$("sc-t").value||0;
    var s=c*m-w*n,max=t*m,att=c+w;
    $("sc-res").innerHTML='<p class="big">'+s.toFixed(2)+' / '+max+'</p><p>Attempted <b>'+att+'</b> · Unattempted <b>'+Math.max(0,t-att)+'</b> · Accuracy <b>'+(att?(c/att*100).toFixed(1):0)+'%</b> · Marks lost to negatives <b>'+(w*n).toFixed(2)+'</b></p>'+
      (att>t?'<p class="no">Correct + wrong exceeds total questions.</p>':'');}
  $("sc-p").addEventListener("change",function(){preset();run()});
  document.querySelectorAll("#sc input").forEach(function(e){e.addEventListener("input",run)}); preset(); run();
})();
</script>`,
    article: [
      ["How to use it with an answer key", "When the commission releases the provisional answer key with your response sheet, count the questions where your marked option matches the key (correct) and where it differs (wrong). Leave unattempted questions out. Enter both numbers here to get your raw score; normalised scores for multi-shift exams are published later by the commission."],
      ["Is guessing worth it?", "With −1/4 marking, a pure guess between four options breaks even on average, and eliminating even one option makes it profitable. With −1/2 (SSC) or −2/3 (UPSC GS), guess only when you can rule out at least two options."],
    ],
    faq: [
      { q: "What is the negative marking in SSC CGL Tier 1?", a: "Each correct answer earns 2 marks and each wrong answer deducts 0.5 marks; unattempted questions carry no penalty." },
      { q: "Does this give my normalised score?", a: "No. It gives the raw score. Multi-shift exams such as SSC and RRB apply normalisation, which the commission publishes with the result." },
    ],
  });

  return defs;
}

/* ---- pay-level pages --------------------------------------------- */
function levelPages(rates) {
  const DA = Number(rates.daPercent || 60);
  return MATRIX.map((m) => {
    const b = m.cells[0], last = m.cells[m.cells.length - 1];
    const s = { X: nvSalary(b, m.level, "X", true, DA, true), Y: nvSalary(b, m.level, "Y", false, DA, true), Z: nvSalary(b, m.level, "Z", false, DA, true) };
    const posts = LEVEL_POSTS[m.level] || [];
    return { level: m.level, cells: m.cells, start: b, last, s, posts, DA };
  });
}

/* ---- rendering ---------------------------------------------------- */
function buildToolPages(ctx) {
  const { head, foot, esc, SITE, breadcrumbLd, faqLd, faqSection, rates } = ctx;
  const defs = buildDefs(rates);
  const pages = [];
  const cats = [...new Set(defs.map((d) => d.cat))];

  for (const d of defs) {
    const canonical = `${SITE.url}/tools/${d.slug}/`;
    const related = defs.filter((x) => x.slug !== d.slug).sort((a, b) => (b.cat === d.cat) - (a.cat === d.cat)).slice(0, 4);
    const ld = [
      breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Tools", url: SITE.url + "/tools/" }, { name: d.h1, url: canonical }]),
      { "@context": "https://schema.org", "@type": "WebApplication", name: d.h1, url: canonical, description: d.desc,
        applicationCategory: "UtilitiesApplication", operatingSystem: "Any", browserRequirements: "Requires JavaScript",
        offers: { "@type": "Offer", price: "0", priceCurrency: "INR" }, publisher: { "@type": "Organization", name: SITE.brand } },
      faqLd(d.faq),
    ];
    pages.push({ path: `tools/${d.slug}/index.html`, url: canonical, html: head({ title: `${d.title} | ${SITE.name}`.length <= 72 ? `${d.title} | ${SITE.name}` : d.title, desc: d.desc, canonical, ld }) + `
<main class="wrap article" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; <a href="/tools/">Tools</a> &nbsp;&rsaquo;&nbsp; ${esc(d.cat)}</p>
  <article>
    <h1>${esc(d.h1)}</h1>
    <p class="lede">${esc(d.intro)}</p>
    ${d.body}
    <div class="prose">${d.article.map(([h, p]) => `<h2 class="section-h">${esc(h)}</h2><p>${p}</p>`).join("")}</div>
    ${faqSection(d.faq)}
    <section class="related"><h2 class="section-h">More free tools</h2>
      <ul class="tool-list">${related.map((r) => `<li><a class="tool-card" href="/tools/${r.slug}/"><b>${esc(r.h1)}</b><span>${esc(r.desc.slice(0, 110))}…</span></a></li>`).join("")}</ul>
      <p class="backlink"><a href="/tools/">All tools &rarr;</a></p>
    </section>
  </article>
</main>` + foot() });
  }

  // Tools hub
  {
    const canonical = `${SITE.url}/tools/`;
    const ld = [breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Tools", url: canonical }]),
      { "@context": "https://schema.org", "@type": "CollectionPage", name: "Free tools for exam aspirants and government employees", url: canonical,
        mainEntity: { "@type": "ItemList", itemListElement: defs.map((d, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE.url}/tools/${d.slug}/`, name: d.h1 })) } }];
    pages.push({ path: "tools/index.html", url: canonical, html: head({ title: `Free Calculators & Tools for Govt Exams and Employees | ${SITE.name}`,
      desc: "Photo & signature resizer, age calculator, income tax calculator FY 2026-27, 7th and 8th pay commission salary calculators, percentage and exam score calculators — free, fast, private.", canonical, ld }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; Tools</p>
  <section class="cat-head">
    <p class="eyebrow">Free &middot; No sign-up &middot; Runs in your browser</p>
    <h1>Tools for exam aspirants &amp; government employees</h1>
    <p class="lede">Everything you need around an application form or a pay slip — resize your photo to the exact KB limit, check age eligibility, compare tax regimes and work out your salary.</p>
  </section>
  ${cats.map((c) => `<h2 class="section-h">${esc(c)}</h2><ul class="tool-list">${defs.filter((d) => d.cat === c).map((r) => `<li><a class="tool-card" href="/tools/${r.slug}/"><b>${esc(r.h1)}</b><span>${esc(r.desc.slice(0, 120))}…</span></a></li>`).join("")}</ul>`).join("")}
  <h2 class="section-h">Salary by pay level</h2>
  <p class="tagrow">${MATRIX.map((m) => `<a class="chip" href="/salary/pay-level-${m.level.toLowerCase()}/">Level ${m.level}</a>`).join("")}</p>
</main>` + foot() });
  }

  // Pay level pages + hub
  const LV = levelPages(rates);
  for (const L of LV) {
    const slug = `pay-level-${L.level.toLowerCase()}`;
    const canonical = `${SITE.url}/salary/${slug}/`;
    const prev = LV[LV.indexOf(L) - 1], next = LV[LV.indexOf(L) + 1];
    const faq = [
      { q: `What is the starting basic pay in Pay Level ${L.level}?`, a: `${inr(L.start)} per month under the 7th CPC pay matrix.` },
      { q: `What is the in-hand salary for Level ${L.level}?`, a: `At the entry cell with DA at ${L.DA}%, gross pay is about ${inr(L.s.Z.gross)}–${inr(L.s.X.gross)} a month depending on the city, and in-hand pay after NPS is roughly ${inr(L.s.Z.net)}–${inr(L.s.X.net)} before income tax.` },
      { q: `What is the maximum basic pay in Level ${L.level}?`, a: `${inr(L.last)}${L.cells.length > 1 ? `, reached at cell ${L.cells.length} after annual 3% increments` : " (fixed pay)"}.` },
    ];
    const tbl = (k) => `<tr><td>${k === "X" ? "X city (TPTA)" : k + " city"}</td><td>${inr(L.s[k].basic)}</td><td>${inr(L.s[k].da)}</td><td>${inr(L.s[k].hra)}</td><td>${inr(L.s[k].ta)}</td><td><b>${inr(L.s[k].gross)}</b></td><td>${inr(L.s[k].nps)}</td><td><b>${inr(L.s[k].net)}</b></td></tr>`;
    const ld = [breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Salary", url: SITE.url + "/salary/" }, { name: `Pay Level ${L.level}`, url: canonical }]), faqLd(faq)];
    pages.push({ path: `salary/${slug}/index.html`, url: canonical, html: head({
      title: `Pay Level ${L.level} Salary – In-hand with ${L.DA}% DA (7th CPC) | ${SITE.name}`,
      desc: `7th CPC Pay Level ${L.level}: basic ${inr(L.start)}${L.cells.length > 1 ? `–${inr(L.last)}` : ""}, in-hand about ${inr(L.s.Z.net)}–${inr(L.s.X.net)} with ${L.DA}% DA, HRA and TA. Full pay matrix and posts at this level.`, canonical, ld }) + `
<main class="wrap article" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; <a href="/salary/">Salary</a> &nbsp;&rsaquo;&nbsp; Level ${L.level}</p>
  <article>
    <p class="eyebrow">7th CPC pay matrix &middot; DA ${L.DA}% from ${esc(rates.daEffective || "")}</p>
    <h1>Pay Level ${L.level} salary: ${inr(L.s.Z.net)}–${inr(L.s.X.net)} in-hand</h1>
    <p class="lede">Pay Level ${L.level} starts at a basic pay of <b>${inr(L.start)}</b>${L.cells.length > 1 ? ` and rises to <b>${inr(L.last)}</b> over ${L.cells.length} annual increments` : " (fixed)"}. With Dearness Allowance at ${L.DA}%, House Rent Allowance and Transport Allowance, a new entrant takes home roughly <b>${inr(L.s.Z.net)}</b> in a Z-class town and <b>${inr(L.s.X.net)}</b> in a metro.</p>
    <h2 class="section-h">Entry salary breakdown (per month)</h2>
    <div class="table-wrap"><table class="slip wide"><thead><tr><th>City</th><th>Basic</th><th>DA ${L.DA}%</th><th>HRA</th><th>TA + DA</th><th>Gross</th><th>NPS</th><th>In-hand*</th></tr></thead>
    <tbody>${tbl("X")}${tbl("Y")}${tbl("Z")}</tbody></table></div>
    <p class="tool-note">*Before income tax and professional tax; CGEGIS also deducted. X city figures assume a higher-TA city. Try your exact cell in the <a href="/tools/7th-pay-commission-salary-calculator/?level=${L.level}">salary calculator</a>.</p>
    ${L.posts.length ? `<h2 class="section-h">Posts commonly at Level ${L.level}</h2><ul>${L.posts.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
    ${L.cells.length > 1 ? `<h2 class="section-h">Level ${L.level} pay matrix (all cells)</h2>
    <div class="cells">${L.cells.map((c, i) => `<span><small>Cell ${i + 1}</small>${inr(c)}</span>`).join("")}</div>` : ""}
    <div class="prose"><h2 class="section-h">How pay grows at Level ${L.level}</h2>
    <p>Each year on 1 January or 1 July you move one cell down the column — a raise of about 3%, rounded to the nearest ₹100. DA is revised twice a year based on inflation (the next revision, ${esc(rates.daNextExpected || "")}), and promotions move you to the next level at the cell equal to or just above your current pay.</p></div>
    ${faqSection(faq)}
    <p class="cta-row">${prev ? `<a class="btn btn-ghost" href="/salary/pay-level-${prev.level.toLowerCase()}/">&larr; Level ${prev.level}</a>` : ""} ${next ? `<a class="btn btn-ghost" href="/salary/pay-level-${next.level.toLowerCase()}/">Level ${next.level} &rarr;</a>` : ""} <a class="btn btn-primary" href="/tools/8th-pay-commission-salary-calculator/">8th CPC estimate</a></p>
  </article>
</main>` + foot() });
  }
  {
    const canonical = `${SITE.url}/salary/`;
    const ld = [breadcrumbLd([{ name: "Home", url: SITE.url + "/" }, { name: "Salary", url: canonical }])];
    pages.push({ path: "salary/index.html", url: canonical, html: head({ title: `7th Pay Matrix ${new Date().getFullYear()} – Salary for Level 1 to 18 | ${SITE.name}`,
      desc: `Central government pay matrix with in-hand salary for every level at ${LV[0].DA}% DA: basic pay, HRA, TA and NPS for Level 1 to Level 18.`, canonical, ld }) + `
<main class="wrap" id="main">
  <p class="crumb"><a href="/">Home</a> &nbsp;&rsaquo;&nbsp; Salary</p>
  <section class="cat-head"><p class="eyebrow">7th CPC &middot; DA ${LV[0].DA}%</p><h1>Central government salary by pay level</h1>
  <p class="lede">Starting basic pay and approximate in-hand salary for every level of the 7th Pay Commission matrix. Open a level for the full breakdown, the posts at that level and every pay cell.</p></section>
  <div class="table-wrap"><table class="slip wide"><thead><tr><th>Level</th><th>Basic pay range</th><th>Gross (Y city)</th><th>In-hand (Y city)</th></tr></thead><tbody>
  ${LV.map((L) => `<tr><td><a href="/salary/pay-level-${L.level.toLowerCase()}/">Level ${L.level}</a></td><td>${inr(L.start)}${L.cells.length > 1 ? " – " + inr(L.last) : ""}</td><td>${inr(L.s.Y.gross)}</td><td><b>${inr(L.s.Y.net)}</b></td></tr>`).join("")}
  </tbody></table></div>
  <p class="cta-row"><a class="btn btn-primary" href="/tools/7th-pay-commission-salary-calculator/">Salary calculator</a> <a class="btn btn-ghost" href="/tools/8th-pay-commission-salary-calculator/">8th Pay Commission estimate</a> <a class="btn btn-ghost" href="/tools/income-tax-calculator/">Income tax calculator</a></p>
</main>` + foot() });
  }
  return { pages, defs, levels: LV };
}

module.exports = { buildToolPages, MATRIX, nvSalary };
