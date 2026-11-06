"use strict";
/* District → state, for jobs whose notice names a district but not its state ("Zilla Panchayat, Dharwad",
   "Unnao District Court", "DHFWS Purba Medinipur"). Without it such jobs fell into the All India / Central
   bucket — and the app's central alert topic, which every user gets by default.
   Names that are shared by two states (Aurangabad, Bilaspur, Hamirpur, Pratapgarh, Balrampur, Bishnupur…) or that are
   also common words or names (Anand, Hassan, Sagar, Puri, Saran, Korea, Mandi, Sidhi — "sidhi bharti"…) are left out on purpose: a missing
   district only keeps the old behaviour, a wrong one would send the job to the wrong state. A name listed under two
   states is dropped automatically. */
const LIST = {
  "andhra-pradesh": "srikakulam, vizianagaram, parvathipuram manyam, alluri sitharama raju, anakapalli, kakinada, east godavari, west godavari, konaseema, eluru, guntur, bapatla, palnadu, prakasam, ongole, nellore, kurnool, nandyal, anantapur, anantapuramu, sri sathya sai, kadapa, annamayya, chittoor, tirupati, rajahmundry, rajamahendravaram, machilipatnam",
  "arunachal-pradesh": "tawang, west kameng, east kameng, papum pare, lower subansiri, upper subansiri, kurung kumey, kra daadi, west siang, east siang, upper siang, lower dibang valley, dibang valley, lohit, namsai, changlang, tirap, longding, anjaw, kamle, pakke kessang, lepa rada, shi yomi, naharlagun, pasighat",
  "assam": "baksa, barpeta, bajali, biswanath, bongaigaon, cachar, charaideo, chirang, darrang, dhemaji, dhubri, dima hasao, goalpara, golaghat, hailakandi, hojai, jorhat, kamrup, kamrup metropolitan, karbi anglong, karimganj, sribhumi, kokrajhar, north lakhimpur, majuli, morigaon, marigaon, nagaon, nalbari, sivasagar, sonitpur, south salmara, tamulpur, tinsukia, udalguri, tezpur, diphu",
  "bihar": "araria, arwal, banka, begusarai, bhojpur, arrah, buxar, darbhanga, east champaran, motihari, gopalganj, jamui, jehanabad, kaimur, bhabua, katihar, khagaria, kishanganj, lakhisarai, madhepura, madhubani, munger, nalanda, nawada, purnia, purnea, rohtas, sasaram, saharsa, samastipur, chapra, chhapra, sheikhpura, sheohar, sitamarhi, siwan, supaul, hajipur, west champaran, bettiah, bihar sharif",
  "chhattisgarh": "balod, baloda bazar, bastar, jagdalpur, bemetara, dantewada, dakshin bastar, dhamtari, durg, gariaband, gaurela pendra marwahi, janjgir champa, janjgir, jashpur, kabirdham, kawardha, kanker, kondagaon, korba, koriya, mahasamund, mungeli, narayanpur, raigarh, rajnandgaon, sukma, surajpur, surguja, ambikapur, khairagarh, manendragarh, mohla manpur, sarangarh",
  "goa": "north goa, south goa, mapusa",
  "gujarat": "amreli, aravalli, banaskantha, bharuch, bhavnagar, botad, chhota udaipur, dahod, dangs, devbhumi dwarka, gir somnath, jamnagar, junagadh, kheda, kutch, kachchh, mahisagar, mehsana, morbi, navsari, panchmahal, panchmahals, porbandar, sabarkantha, surendranagar, valsad, godhra, palanpur, nadiad, bhuj, vapi, himmatnagar",
  "haryana": "ambala, bhiwani, charkhi dadri, fatehabad, hissar, jhajjar, jind, kaithal, karnal, kurukshetra, mahendragarh, narnaul, nuh, mewat, palwal, panipat, rewari, sirsa, sonipat, sonepat, yamunanagar, yamuna nagar",
  "himachal-pradesh": "chamba, kangra, kinnaur, kullu, lahaul, spiti, sirmaur, nahan",
  "jharkhand": "chatra, deoghar, dumka, east singhbhum, garhwa, giridih, godda, gumla, hazaribagh, jamtara, khunti, koderma, latehar, lohardaga, pakur, palamu, daltonganj, ramgarh, sahebganj, sahibganj, seraikela, saraikela, simdega, west singhbhum, chaibasa",
  "karnataka": "bagalkot, ballari, bellary, belagavi, bidar, chamarajanagar, chamarajanagara, chikkaballapur, chikkaballapura, chikkamagaluru, chikmagalur, chitradurga, dakshina kannada, davanagere, davangere, dharwad, gadag, haveri, kalaburagi, gulbarga, kodagu, coorg, kolar, koppal, mandya, raichur, ramanagara, shivamogga, shimoga, tumakuru, tumkur, udupi, uttara kannada, karwar, vijayapura, vijayanagara, yadgir, hubballi, mangaluru",
  "kerala": "alappuzha, alleppey, ernakulam, idukki, kannur, kasaragod, kasargod, kollam, quilon, kottayam, calicut, malappuram, palakkad, palghat, pathanamthitta, trivandrum, trichur, wayanad",
  "madhya-pradesh": "agar malwa, alirajpur, anuppur, ashoknagar, balaghat, barwani, betul, bhind, burhanpur, chhatarpur, chhindwara, damoh, datia, dewas, dindori, guna, harda, hoshangabad, narmadapuram, jhabua, katni, khandwa, khargone, mandla, mandsaur, morena, narsinghpur, neemuch, niwari, panna, raisen, ratlam, rewa, satna, sehore, seoni, shahdol, shajapur, sheopur, shivpuri, singrauli, tikamgarh, umaria, vidisha, maihar, mauganj, pandhurna",
  "maharashtra": "ahmednagar, ahilyanagar, akola, amravati, chhatrapati sambhajinagar, beed, bhandara, buldhana, chandrapur, dhule, gadchiroli, gondia, hingoli, jalgaon, jalna, kolhapur, latur, nanded, nandurbar, osmanabad, dharashiv, palghar, parbhani, raigad, ratnagiri, sangli, satara, sindhudurg, solapur, wardha, washim, yavatmal, baramati",
  "manipur": "chandel, churachandpur, imphal east, imphal west, jiribam, kakching, kamjong, kangpokpi, noney, pherzawl, tamenglong, tengnoupal, thoubal, ukhrul",
  "meghalaya": "garo hills, khasi hills, jaintia hills, ri bhoi, ri-bhoi, tura, jowai, nongpoh",
  "mizoram": "champhai, kolasib, lawngtlai, lunglei, mamit, saiha, siaha, serchhip, hnahthial, khawzawl, saitual",
  "nagaland": "kiphire, longleng, mokokchung, peren, phek, tuensang, wokha, zunheboto, noklak, chumoukedima, niuland, tseminyu, shamator",
  "odisha": "angul, anugul, balangir, bolangir, balasore, baleswar, bargarh, bhadrak, boudh, dhenkanal, gajapati, ganjam, jagatsinghpur, jajpur, jharsuguda, kalahandi, kandhamal, kendrapara, kendujhar, keonjhar, khordha, khurda, koraput, malkangiri, mayurbhanj, nabarangpur, nayagarh, nuapada, rayagada, sambalpur, subarnapur, sundargarh, berhampur",
  "punjab": "barnala, faridkot, fatehgarh sahib, fazilka, ferozepur, firozpur, gurdaspur, hoshiarpur, kapurthala, malerkotla, moga, sri muktsar sahib, muktsar, pathankot, rupnagar, ropar, sangrur, shaheed bhagat singh nagar, nawanshahr, tarn taran",
  "rajasthan": "alwar, banswara, baran, barmer, bharatpur, bhilwara, bundi, chittorgarh, churu, dausa, dholpur, dungarpur, hanumangarh, jaisalmer, jalore, jalor, jhalawar, jhunjhunu, karauli, nagaur, rajsamand, sawai madhopur, sikar, sirohi, sri ganganagar, ganganagar, tonk, kotputli, balotra, beawar, didwana, phalodi, salumbar",
  "sikkim": "east sikkim, west sikkim, north sikkim, south sikkim, gyalshing, namchi, mangan, pakyong, soreng",
  "tamil-nadu": "ariyalur, chengalpattu, cuddalore, dharmapuri, dindigul, erode, kallakurichi, kanchipuram, kancheepuram, kanniyakumari, kanyakumari, karur, krishnagiri, mayiladuthurai, nagapattinam, namakkal, nilgiris, ooty, perambalur, pudukkottai, pudukottai, ramanathapuram, ranipet, sivaganga, sivagangai, tenkasi, thanjavur, theni, thoothukudi, tuticorin, tirunelveli, tirupathur, tirupattur, tiruppur, tirupur, tiruvallur, thiruvallur, tiruvannamalai, thiruvannamalai, tiruvarur, thiruvarur, vellore, viluppuram, villupuram, virudhunagar, hosur",
  "telangana": "adilabad, bhadradri kothagudem, kothagudem, hanumakonda, jagtial, jagitial, jangaon, bhupalpally, jogulamba gadwal, gadwal, kamareddy, karimnagar, khammam, kumuram bheem, asifabad, mahabubabad, mahabubnagar, mancherial, medak, medchal, mulugu, nagarkurnool, nalgonda, narayanpet, nirmal, peddapalli, rajanna sircilla, sircilla, rangareddy, ranga reddy, sangareddy, siddipet, suryapet, vikarabad, wanaparthy, yadadri bhuvanagiri",
  "tripura": "dhalai, gomati, khowai, north tripura, sepahijala, south tripura, unakoti, west tripura, dharmanagar",
  "uttar-pradesh": "aligarh, ambedkar nagar, amethi, amroha, auraiya, ayodhya, faizabad, azamgarh, baghpat, bahraich, ballia, barabanki, bareilly, basti, bhadohi, bijnor, budaun, badaun, bulandshahr, chandauli, chitrakoot, deoria, etah, etawah, farrukhabad, firozabad, gautam buddha nagar, ghazipur, gonda, gorakhpur, hapur, hardoi, hathras, jalaun, orai, jaunpur, jhansi, kannauj, kanpur dehat, kasganj, kaushambi, kushinagar, lakhimpur kheri, kheri, lalitpur, mahoba, mainpuri, mathura, mau, mirzapur, moradabad, muzaffarnagar, pilibhit, raebareli, rae bareli, saharanpur, sambhal, sant kabir nagar, shahjahanpur, shamli, shravasti, siddharthnagar, sitapur, sonbhadra, sultanpur, unnao",
  "uttarakhand": "almora, bageshwar, chamoli, champawat, pauri garhwal, garhwal, pithoragarh, rudraprayag, tehri, udham singh nagar, uttarkashi",
  "west-bengal": "alipurduar, bankura, birbhum, cooch behar, coochbehar, dakshin dinajpur, darjeeling, hooghly, hugli, jalpaiguri, jhargram, kalimpong, malda, maldah, murshidabad, nadia, 24 parganas, bardhaman, burdwan, medinipur, midnapore, purulia, uttar dinajpur",
  "jammu-kashmir": "anantnag, bandipora, baramulla, budgam, doda, ganderbal, kathua, kishtwar, kulgam, kupwara, poonch, pulwama, rajouri, ramban, reasi, shopian, udhampur",
};

const OWNER = new Map(), SHARED = new Set();
for (const [slug, names] of Object.entries(LIST)) {
  for (const n of names.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (OWNER.has(n) && OWNER.get(n) !== slug) SHARED.add(n);
    else OWNER.set(n, slug);
  }
}
for (const n of SHARED) OWNER.delete(n);
// Longest names first, so "chhota udaipur" (Gujarat) is consumed before anything shorter could match inside it.
const NAMES = [...OWNER.keys()].sort((a, b) => b.length - a.length);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RE = new RegExp(`(?:^|[^a-z])(${NAMES.map(esc).join("|")})(?![a-z])`, "g");

/** The one state whose districts the text names, or "" (none, or districts of two different states). */
function districtState(text) {
  const low = String(text || "").toLowerCase();
  const found = new Set();
  for (const m of low.matchAll(RE)) found.add(OWNER.get(m[1]));
  return found.size === 1 ? [...found][0] : "";
}

// State-government web addresses: "bhadrak.odisha.gov.in", "cmd.kerala.gov.in", "dharwad.nic.in" (a district site).
const DOMAINS = [
  ["andhra-pradesh", /(^|\.)ap\.(gov|nic)\.in$/], ["tamil-nadu", /(^|\.)tn\.(gov|nic)\.in$/], ["kerala", /(^|\.)kerala\.(gov|nic)\.in$/],
  ["karnataka", /(^|\.)(karnataka\.gov|kar\.nic)\.in$/], ["telangana", /(^|\.)(telangana|ts)\.(gov|nic)\.in$/],
  ["maharashtra", /(^|\.)(maharashtra\.gov|mah\.nic)\.in$/], ["gujarat", /(^|\.)(gujarat\.gov|guj\.nic)\.in$/],
  ["rajasthan", /(^|\.)(rajasthan\.gov|raj\.nic)\.in$/], ["madhya-pradesh", /(^|\.)mp\.(gov|nic)\.in$/],
  ["chhattisgarh", /(^|\.)(cg\.gov|cgstate\.gov|cg\.nic)\.in$/], ["uttar-pradesh", /(^|\.)up\.(gov|nic)\.in$/],
  ["bihar", /(^|\.)(bihar\.gov|bih\.nic)\.in$/], ["jharkhand", /(^|\.)jharkhand\.(gov|nic)\.in$/],
  ["odisha", /(^|\.)(odisha\.gov|ori\.nic)\.in$/], ["west-bengal", /(^|\.)wb\.(gov|nic)\.in$/], ["assam", /(^|\.)assam\.(gov|nic)\.in$/],
  ["punjab", /(^|\.)punjab\.(gov|nic)\.in$/], ["haryana", /(^|\.)(haryana\.gov|hry\.nic)\.in$/], ["himachal-pradesh", /(^|\.)hp\.(gov|nic)\.in$/],
  ["uttarakhand", /(^|\.)uk\.(gov|nic)\.in$/], ["goa", /(^|\.)goa\.(gov|nic)\.in$/], ["delhi", /(^|\.)delhi\.(gov|nic)\.in$/],
  ["tripura", /(^|\.)tripura\.(gov|nic)\.in$/], ["meghalaya", /(^|\.)meghalaya\.(gov|nic)\.in$/], ["manipur", /(^|\.)manipur\.(gov|nic)\.in$/],
  ["mizoram", /(^|\.)mizoram\.(gov|nic)\.in$/], ["nagaland", /(^|\.)nagaland\.(gov|nic)\.in$/], ["sikkim", /(^|\.)sikkim\.(gov|nic)\.in$/],
  ["arunachal-pradesh", /(^|\.)arunachal\.(gov|nic)\.in$/], ["jammu-kashmir", /(^|\.)jk\.(gov|nic)\.in$/],
];
/** The state of a state-government or district web address, or "". */
function domainState(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
  for (const [slug, re] of DOMAINS) if (re.test(host)) return slug;
  // District sites and courts: "dharwad.nic.in", "unnao.dcourts.gov.in", "malda.gov.in".
  const m = host.match(/^([a-z]+)\.(?:nic\.in|gov\.in|dcourts\.gov\.in)$/);
  return (m && OWNER.get(m[1])) || "";
}

module.exports = { districtState, domainState, _shared: SHARED, _count: OWNER.size };
