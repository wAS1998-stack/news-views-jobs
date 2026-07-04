# Official Government Job Sources — Central + All States (Reference Map)

Your `config.json` is already set up with two nationwide aggregator feeds
(`govtjobsblog.in` and `govtjobsdiary.com`) that post **central + all-state**
government jobs, so you have full India-wide coverage out of the box. Your
fetcher reads each notification, extracts the facts, and rewrites them in your
own words — so your pages stay original.

This document is the **complete map of official sources** for when you want to
add or switch to official bodies (the most original, defensible long-term path).
Government URLs change over time, so confirm the live address with a quick search
before relying on any one of them.

---

## How to add a source

Add any feed URL to the `feeds` array in `config.json`:
```json
"feeds": [
  "https://www.govtjobsblog.in/feed",
  "https://www.govtjobsdiary.com/feed",
  "https://ANOTHER-SOURCE/feed"
]
```
Most official sites below do **not** publish RSS — they post notifications as web
pages or PDFs. To pull from those directly you'd add a small per-site scraper
(I can help build one). The aggregator feeds are the quickest way to cover them
all today.

---

## Central Government Bodies

| Body | What it recruits for | Official site (verify) |
|---|---|---|
| SSC | CGL, CHSL, MTS, GD, CPO, JE | ssc.gov.in |
| UPSC | Civil Services, NDA, CDS, engineering services | upsc.gov.in |
| IBPS | Bank PO, Clerk, SO (public sector banks) | ibps.in |
| SBI | SBI PO, Clerk, SO | sbi.co.in/careers |
| RBI | Grade B officers, Assistants | rbi.org.in (Opportunities) |
| RRB / RRC | Railways — NTPC, Group D, JE, ALP | indianrailways.gov.in |
| Indian Army | Officer & soldier entries | joinindianarmy.nic.in |
| Indian Navy | Officer & sailor entries | joinindiannavy.gov.in |
| Indian Air Force | Agniveer Vayu, officer entries | careerindianairforce.cdac.in |
| NTA | UGC NET, and various exams | nta.ac.in |
| LIC | AAO, ADO, Assistant | licindia.in/careers |
| ESIC | UDC, MTS, officers, paramedical | esic.gov.in |
| EPFO | SSA, Stenographer, officers | epfindia.gov.in |
| DRDO | Scientists, technical, apprentices | drdo.gov.in |
| ISRO | Scientists/Engineers, technical | isro.gov.in |
| National Career Service | Central + state + private vacancies | ncs.gov.in |
| Employment News | Official weekly job gazette | employmentnews.gov.in |

**Major PSUs:** ONGC, NTPC, BHEL, SAIL, GAIL, IOCL, BPCL, HPCL, NHPC, PowerGrid,
Coal India, HAL, BEL — each posts on its own careers page.

---

## State Public Service Commissions & Recruitment Boards

| State | Commission / Board | Official site (verify) |
|---|---|---|
| Andhra Pradesh | APPSC | psc.ap.gov.in |
| Arunachal Pradesh | APPSC | appsc.gov.in |
| Assam | APSC / SLPRB | apsc.nic.in |
| Bihar | BPSC / BSSC | bpsc.bih.nic.in |
| Chhattisgarh | CGPSC / CG Vyapam | psc.cg.gov.in |
| Goa | GPSC | gpsc.goa.gov.in |
| Gujarat | GPSC / GSSSB | gpsc.gujarat.gov.in |
| Haryana | HPSC / HSSC | hpsc.gov.in, hssc.gov.in |
| Himachal Pradesh | HPPSC / HPSSC | hppsc.hp.gov.in |
| Jharkhand | JPSC / JSSC | jpsc.gov.in, jssc.nic.in |
| Karnataka | KPSC / KEA | kpsc.kar.nic.in |
| Kerala | Kerala PSC | keralapsc.gov.in |
| Madhya Pradesh | MPPSC / MP ESB (Vyapam) | mppsc.mp.gov.in |
| Maharashtra | MPSC | mpsc.gov.in |
| Manipur | MPSC | mpscmanipur.gov.in |
| Meghalaya | MPSC | mpsc.nic.in |
| Mizoram | MPSC | mpsc.mizoram.gov.in |
| Nagaland | NPSC | npsc.co.in |
| Odisha | OPSC / OSSC | opsc.gov.in, ossc.gov.in |
| Punjab | PPSC / PSSSB | ppsc.gov.in |
| Rajasthan | RPSC / RSMSSB | rpsc.rajasthan.gov.in |
| Sikkim | SPSC | spscskm.gov.in |
| Tamil Nadu | TNPSC / TNUSRB | tnpsc.gov.in |
| Telangana | TGPSC | tspsc.gov.in |
| Tripura | TPSC | tpsc.tripura.gov.in |
| Uttar Pradesh | UPPSC / UPSSSC | uppsc.up.nic.in, upsssc.gov.in |
| Uttarakhand | UKPSC / UKSSSC | ukpsc.gov.in |
| West Bengal | WBPSC / WBSSC | wbpsc.gov.in |

## Union Territories

| UT | Body | Official site (verify) |
|---|---|---|
| Delhi | DSSSB | dsssb.delhi.gov.in |
| Jammu & Kashmir | JKPSC / JKSSB | jkpsc.nic.in, jkssb.nic.in |
| Ladakh | UT Administration | ladakh.gov.in |
| Chandigarh | Chandigarh Administration | chandigarh.gov.in |
| Puducherry | Puducherry PSC | pondicherry.gov.in |
| Andaman & Nicobar | A&N Administration | andaman.gov.in |
| Dadra & Nagar Haveli and Daman & Diu | UT Administration | ddd.gov.in |
| Lakshadweep | UT Administration | lakshadweep.gov.in |

---

## Recommended approach

1. **Now (live in minutes):** keep the two nationwide aggregator feeds already in
   `config.json`. They cover central + every state, and your fetcher rewrites the
   facts so content stays original. This is the fastest path to a full site.
2. **Later (strongest moat):** add official sources from the tables above. Most
   need a small scraper since they lack RSS — ask me and I'll build scrapers for
   the specific bodies you care about most (e.g., SSC + your state's PSC).
3. **Always:** your job pages link readers to the official notification, and your
   30 guides remain the original-content backbone that ranks and satisfies AdSense.
