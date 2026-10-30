package com.newsviews.app.ui

fun num(d: Double): String = if (d % 1.0 == 0.0) d.toInt().toString() else d.toString()

/** All UI text in English and Hindi; the language switch in Alerts changes the UI and the job titles together. */
data class Strings(
    val jobs: String, val results: String, val saved: String, val alerts: String,
    val tagline: String, val search: String, val allStates: String, val allQuals: String, val closingSoon: String,
    val openJobs: (Int) -> String, val updatedAgo: (String) -> String, val noMatch: String, val offline: String, val retry: String,
    val posts: (Int) -> String, val lastDate: String, val daysLeft: (Long) -> String, val lastDayToday: String, val closesTomorrow: String,
    val closed: String, val open: String, val new: String, val verified: String,
    val allTypes: String, val noSaved: String, val savedHint: String,
    val apply: String, val notification: String, val website: String, val share: String, val save: String, val unsave: String,
    val summary: String, val eligibility: String, val selection: String, val howToApply: String, val faq: String, val steps: String, val details: String,
    val age: String, val qualification: String, val salary: String, val fee: String, val examDate: String, val startDate: String, val location: String, val postName: String,
    val openOnSite: String, val loading: String, val couldNotLoad: String,
    val alertsTitle: String, val alertsOn: String, val alertsOnHint: String, val myStates: String, val myStatesHint: String, val myQual: String,
    val resultsAlerts: String, val resultsHint: String, val reminders: String, val remindersHint: String, val language: String,
    val alertsNeedSetup: String, val permissionNeeded: String, val allow: String,
    val about: String, val rate: String, val shareApp: String, val privacy: String, val shareText: String,
    val welcome: String, val welcomeHint: String, val continueBtn: String, val skip: String, val chooseState: String,
    val ageRange: (Double, Double) -> String,
    val ad: String, val adPrivacy: String,
    val disclaimer: String,
) {
    companion object {
        val EN = Strings(
            jobs = "Jobs", results = "Results", saved = "Saved", alerts = "Alerts",
            tagline = "Sarkari naukri, verified", search = "Search jobs, posts, departments", allStates = "All states", allQuals = "Any qualification", closingSoon = "Closing soon",
            openJobs = { "$it open jobs" }, updatedAgo = { "Updated $it" }, noMatch = "No jobs match these filters.", offline = "You're offline — showing saved data.", retry = "Retry",
            posts = { if (it == 1) "1 post" else "%,d posts".format(it) }, lastDate = "Last date", daysLeft = { "$it days left" }, lastDayToday = "Last day today", closesTomorrow = "Closes tomorrow",
            closed = "Closed", open = "Open", new = "NEW", verified = "Verified from official site",
            allTypes = "All", noSaved = "No saved jobs yet", savedHint = "Tap the bookmark on any job to keep it here and get a reminder before the last date.",
            apply = "Apply / official site", notification = "Official notification", website = "Official website", share = "Share", save = "Save", unsave = "Saved",
            summary = "Summary", eligibility = "Eligibility", selection = "Selection process", howToApply = "How to apply", faq = "Questions", steps = "How to download", details = "Details",
            age = "Age limit", qualification = "Qualification", salary = "Salary", fee = "Fee", examDate = "Exam date", startDate = "Apply from", location = "Location", postName = "Posts",
            openOnSite = "Open on news-views.in", loading = "Loading…", couldNotLoad = "Couldn't load this page.",
            alertsTitle = "Alerts & settings", alertsOn = "Job alerts", alertsOnHint = "Get a notification when a new job matches your state and qualification.",
            myStates = "My states", myStatesHint = "All-India jobs always come through. Leave empty for every state.", myQual = "My highest qualification",
            resultsAlerts = "Results & admit cards", resultsHint = "Major exams only (SSC, Railway, banks, state PSCs, police…)", reminders = "Last-date reminders", remindersHint = "For saved jobs: 2 days before and on the last day.", language = "Language",
            alertsNeedSetup = "Instant alerts are being switched on — reminders for saved jobs already work.", permissionNeeded = "Notifications are blocked for this app.", allow = "Allow",
            about = "About", rate = "Rate the app", shareApp = "Share the app", privacy = "Privacy policy", shareText = "Govt job alerts for your state and qualification — News-Views",
            welcome = "Welcome to News-Views", welcomeHint = "Pick your state and qualification and we'll alert you about matching government jobs.", continueBtn = "Continue", skip = "Skip", chooseState = "Choose states",
            ad = "Advertisement", adPrivacy = "Ad privacy choices",
            ageRange = { a, b -> if (a > 0 && b > 0) "${num(a)}–${num(b)} years" else if (b > 0) "Up to ${num(b)} years" else "" },
            disclaimer = "News-Views is an independent publisher. It is not affiliated with, endorsed by or acting for any government body. Information is taken from official notifications and websites, which are linked on every page — always confirm the details on the official website before you apply.",
        )
        val HI = Strings(
            jobs = "नौकरियाँ", results = "रिजल्ट", saved = "सेव", alerts = "अलर्ट",
            tagline = "सरकारी नौकरी, सत्यापित", search = "नौकरी, पद, विभाग खोजें", allStates = "सभी राज्य", allQuals = "कोई भी योग्यता", closingSoon = "जल्द बंद",
            openJobs = { "$it खुली भर्तियाँ" }, updatedAgo = { "अपडेट $it" }, noMatch = "इन फ़िल्टर से कोई नौकरी नहीं मिली।", offline = "आप ऑफ़लाइन हैं — सेव डेटा दिखा रहे हैं।", retry = "फिर कोशिश करें",
            posts = { "%,d पद".format(it) }, lastDate = "अंतिम तिथि", daysLeft = { "$it दिन बाकी" }, lastDayToday = "आज अंतिम दिन", closesTomorrow = "कल बंद",
            closed = "बंद", open = "खुला", new = "नया", verified = "आधिकारिक वेबसाइट से सत्यापित",
            allTypes = "सभी", noSaved = "अभी कोई सेव नौकरी नहीं", savedHint = "किसी भी नौकरी पर बुकमार्क दबाएँ — वह यहाँ रहेगी और अंतिम तिथि से पहले याद दिलाएँगे।",
            apply = "आवेदन / आधिकारिक साइट", notification = "आधिकारिक अधिसूचना", website = "आधिकारिक वेबसाइट", share = "शेयर", save = "सेव", unsave = "सेव है",
            summary = "सारांश", eligibility = "पात्रता", selection = "चयन प्रक्रिया", howToApply = "आवेदन कैसे करें", faq = "प्रश्न", steps = "डाउनलोड कैसे करें", details = "विवरण",
            age = "आयु सीमा", qualification = "योग्यता", salary = "वेतन", fee = "शुल्क", examDate = "परीक्षा तिथि", startDate = "आवेदन शुरू", location = "स्थान", postName = "पद",
            openOnSite = "news-views.in पर खोलें", loading = "लोड हो रहा है…", couldNotLoad = "यह पेज लोड नहीं हुआ।",
            alertsTitle = "अलर्ट और सेटिंग", alertsOn = "नौकरी अलर्ट", alertsOnHint = "आपके राज्य और योग्यता की नई नौकरी आते ही सूचना पाएँ।",
            myStates = "मेरे राज्य", myStatesHint = "अखिल भारतीय नौकरियाँ हमेशा आएँगी। सभी राज्यों के लिए खाली छोड़ें।", myQual = "मेरी उच्चतम योग्यता",
            resultsAlerts = "रिजल्ट और प्रवेश पत्र", resultsHint = "केवल बड़ी परीक्षाएँ (SSC, रेलवे, बैंक, राज्य PSC, पुलिस…)", reminders = "अंतिम तिथि रिमाइंडर", remindersHint = "सेव नौकरियों के लिए: 2 दिन पहले और अंतिम दिन।", language = "भाषा",
            alertsNeedSetup = "तुरंत अलर्ट जल्द शुरू होंगे — सेव नौकरियों के रिमाइंडर अभी से काम करते हैं।", permissionNeeded = "इस ऐप के नोटिफ़िकेशन बंद हैं।", allow = "अनुमति दें",
            about = "जानकारी", rate = "ऐप को रेट करें", shareApp = "ऐप शेयर करें", privacy = "गोपनीयता नीति", shareText = "आपके राज्य और योग्यता के सरकारी नौकरी अलर्ट — News-Views",
            welcome = "News-Views में स्वागत है", welcomeHint = "अपना राज्य और योग्यता चुनें — मेल खाती सरकारी नौकरियों का अलर्ट मिलेगा।", continueBtn = "आगे बढ़ें", skip = "छोड़ें", chooseState = "राज्य चुनें",
            ad = "विज्ञापन", adPrivacy = "विज्ञापन गोपनीयता विकल्प",
            ageRange = { a, b -> if (a > 0 && b > 0) "${num(a)}–${num(b)} वर्ष" else if (b > 0) "${num(b)} वर्ष तक" else "" },
            disclaimer = "News-Views एक स्वतंत्र प्रकाशक है। इसका किसी भी सरकारी संस्था से कोई संबंध नहीं है और यह उसकी ओर से काम नहीं करता। जानकारी आधिकारिक अधिसूचनाओं और वेबसाइटों से ली जाती है, जिनके लिंक हर पेज पर हैं — आवेदन से पहले आधिकारिक वेबसाइट पर विवरण ज़रूर जाँचें।",
        )
    }
}
