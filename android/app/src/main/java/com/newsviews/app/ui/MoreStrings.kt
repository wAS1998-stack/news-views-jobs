package com.newsviews.app.ui

/** Newer UI text in English and Hindi (reached as Strings.x), kept apart so the main Strings class stays a manageable size. */
data class MoreStrings(
    // closed / cancelled / postponed jobs
    val closedOn: (String) -> String, val closedNoDate: String, val closedHint: String, val noticeRef: String,
    val cancelled: String, val postponed: String, val cancelledTitle: String, val postponedTitle: String,
    val cancelledHint: String, val postponedHint: String, val officialUpdate: String,
    // report a mistake / feedback
    val reportMistake: String, val sendFeedback: String, val noEmailApp: (String) -> String,
    val reportSubject: (String) -> String, val reportBody: (String, String, String) -> String,
    val feedbackSubject: String, val feedbackBody: (String, String) -> String,
    // search
    val searchResults: String, val noMatchUpdates: String,
    // dates and "Remind me"
    val evLabel: (String) -> String, val typeLabel: (String) -> String, val posted: (String) -> String, val remindMe: String, val reminderOn: String, val remindHint: String,
    val eventDateExam: String, val eventDateOther: String, val published: String, val examName: String,
    // quiz
    val allQuizzes: String, val playYesterday: String, val moreQuizzes: String, val quizHub: String, val quizScoreShort: (String) -> String,
    val quizNotPlayed: String, val quizDoneCard: (Int) -> String, val quizDoneNoStreak: String, val correct: String, val wrong: String,
    val quizAlerts: String, val quizAlertsHint: String, val noQuizzes: String,
    // applied / offline
    val applied: String, val markApplied: String, val appliedHint: String, val availableOffline: String,
    // share, update required
    val whatsapp: String, val updateRequired: String, val updateRequiredHint: String, val updateButton: String,
    // where the details come from (host of the official source) and when they were last checked
    val sourceLine: (String, String) -> String,
) {
    companion object {
        val EN = MoreStrings(
            closedOn = { "Applications closed on $it" }, closedNoDate = "Applications closed",
            closedHint = "This recruitment no longer accepts applications. The official notice stays here for reference; similar open jobs are below.",
            noticeRef = "Official notice (for reference)",
            cancelled = "Cancelled", postponed = "Postponed", cancelledTitle = "Recruitment cancelled", postponedTitle = "Recruitment postponed",
            cancelledHint = "The recruiting body has cancelled this recruitment. Check the official notice for details.",
            postponedHint = "The recruiting body has postponed this recruitment; new dates will be in a later official notice.",
            officialUpdate = "Official update",
            reportMistake = "Report a mistake", sendFeedback = "Send feedback", noEmailApp = { "No e-mail app found. Write to $it" },
            reportSubject = { "[Sarkari Radar] Error: $it" },
            reportBody = { url, version, feed ->
                "Page: $url\nApp version: $version · Feed: $feed\n\nWhat is wrong? (tick and describe)\n[ ] Last date / other dates\n[ ] Number of posts\n" +
                    "[ ] Eligibility, age or qualification\n[ ] Apply link or notice link\n[ ] Fee or salary\n[ ] Not a government job\n[ ] Something else\n\n" +
                    "Details (a link to the official notice helps us fix it fast):\n"
            },
            feedbackSubject = "[Sarkari Radar] Feedback",
            feedbackBody = { version, feed -> "App version: $version · Feed: $feed\n\nYour feedback or idea:\n" },
            searchResults = "Search results, exams, departments", noMatchUpdates = "Nothing matches your search.",
            // the notice's own date, named only where its meaning is certain (an exam-date notice: the exam; a result: its
            // declaration); for admit cards and answer keys it can be the exam, the release or a deadline — just "Date"
            evLabel = { when (it) { "exam-date", "exam" -> "Exam"; "result" -> "Result"; else -> "Date" } },
            typeLabel = { when (it) { "exam-date" -> "Exam date"; "exam" -> "Exam"; "result" -> "Result"; "admit-card" -> "Admit card"; "answer-key" -> "Answer key"; else -> "" } },
            posted = { "Posted $it" }, remindMe = "Remind me", reminderOn = "Reminder on",
            remindHint = "We'll remind you at 7 PM the day before and at 8 AM on the day.",
            eventDateExam = "Exam / event date", eventDateOther = "Date in the notice", published = "Published", examName = "Exam",
            allQuizzes = "All quizzes", playYesterday = "Play yesterday's", moreQuizzes = "More quizzes", quizHub = "Daily quizzes",
            quizScoreShort = { "Score $it" }, quizNotPlayed = "Not played yet",
            quizDoneCard = { "Today's quiz done · $it-day streak" }, quizDoneNoStreak = "Today's quiz done",
            correct = "Correct", wrong = "Wrong",
            quizAlerts = "Daily quiz", quizAlertsHint = "One morning notification when the new current affairs quiz is out.",
            noQuizzes = "No quizzes right now — check back tomorrow.",
            applied = "Applied", markApplied = "Mark as applied", appliedHint = "Marked as applied — no more last-date reminders for this job.",
            availableOffline = "Available offline",
            whatsapp = "WhatsApp", updateRequired = "Update required",
            updateRequiredHint = "This version of Sarkari Radar can no longer read the latest job data. Please update the app from Google Play — it takes a minute and keeps your saved jobs and settings.",
            updateButton = "Update on Google Play",
            sourceLine = { host, date -> listOfNotNull(host.ifBlank { null }?.let { "Source: $it" }, date.ifBlank { null }?.let { "updated $it" }).joinToString(" · ") },
        )
        val HI = MoreStrings(
            closedOn = { "आवेदन $it को बंद हो गए" }, closedNoDate = "आवेदन बंद हो गए",
            closedHint = "इस भर्ती में अब आवेदन नहीं होते। आधिकारिक नोटिस संदर्भ के लिए यहाँ है; मिलती-जुलती खुली नौकरियाँ नीचे हैं।",
            noticeRef = "आधिकारिक नोटिस (संदर्भ के लिए)",
            cancelled = "रद्द", postponed = "स्थगित", cancelledTitle = "भर्ती रद्द", postponedTitle = "भर्ती स्थगित",
            cancelledHint = "भर्ती करने वाली संस्था ने यह भर्ती रद्द कर दी है। विवरण आधिकारिक नोटिस में देखें।",
            postponedHint = "भर्ती करने वाली संस्था ने यह भर्ती स्थगित कर दी है; नई तिथियाँ बाद के आधिकारिक नोटिस में आएँगी।",
            officialUpdate = "आधिकारिक सूचना",
            reportMistake = "गलती बताएँ", sendFeedback = "सुझाव भेजें", noEmailApp = { "कोई ईमेल ऐप नहीं मिला। $it पर लिखें" },
            reportSubject = { "[Sarkari Radar] Error: $it" },
            reportBody = { url, version, feed ->
                "पेज: $url\nऐप वर्ज़न: $version · फ़ीड: $feed\n\nक्या गलत है? (टिक करें और लिखें)\n[ ] अंतिम तिथि / अन्य तिथियाँ\n[ ] पदों की संख्या\n" +
                    "[ ] पात्रता, आयु या योग्यता\n[ ] आवेदन या नोटिस का लिंक\n[ ] शुल्क या वेतन\n[ ] यह सरकारी नौकरी नहीं है\n[ ] कुछ और\n\n" +
                    "विवरण (आधिकारिक नोटिस का लिंक हो तो जल्दी ठीक होगा):\n"
            },
            feedbackSubject = "[Sarkari Radar] Feedback",
            feedbackBody = { version, feed -> "ऐप वर्ज़न: $version · फ़ीड: $feed\n\nआपका सुझाव:\n" },
            searchResults = "रिजल्ट, परीक्षा, विभाग खोजें", noMatchUpdates = "आपकी खोज से कुछ नहीं मिला।",
            evLabel = { when (it) { "exam-date", "exam" -> "परीक्षा"; "result" -> "रिजल्ट"; else -> "तिथि" } },
            typeLabel = { when (it) { "exam-date" -> "परीक्षा तिथि"; "exam" -> "परीक्षा"; "result" -> "रिजल्ट"; "admit-card" -> "प्रवेश पत्र"; "answer-key" -> "उत्तर कुंजी"; else -> "" } },
            posted = { "प्रकाशित $it" }, remindMe = "याद दिलाएँ", reminderOn = "रिमाइंडर चालू",
            remindHint = "एक दिन पहले शाम 7 बजे और उसी दिन सुबह 8 बजे याद दिलाएँगे।",
            eventDateExam = "परीक्षा / इवेंट तिथि", eventDateOther = "नोटिस में दी गई तिथि", published = "प्रकाशित", examName = "परीक्षा",
            allQuizzes = "सभी क्विज़", playYesterday = "कल का क्विज़ खेलें", moreQuizzes = "और क्विज़", quizHub = "डेली क्विज़",
            quizScoreShort = { "स्कोर $it" }, quizNotPlayed = "अभी नहीं खेला",
            quizDoneCard = { "आज का क्विज़ पूरा · लगातार $it दिन" }, quizDoneNoStreak = "आज का क्विज़ पूरा",
            correct = "सही", wrong = "गलत",
            quizAlerts = "डेली क्विज़", quizAlertsHint = "नया करंट अफेयर्स क्विज़ आने पर सुबह एक सूचना।",
            noQuizzes = "अभी कोई क्विज़ नहीं — कल फिर देखें।",
            applied = "आवेदन किया", markApplied = "आवेदन कर दिया", appliedHint = "आवेदन किया चिह्नित — इस नौकरी के अंतिम तिथि रिमाइंडर अब नहीं आएँगे।",
            availableOffline = "ऑफ़लाइन उपलब्ध",
            whatsapp = "WhatsApp", updateRequired = "अपडेट ज़रूरी",
            updateRequiredHint = "सरकारी रडार का यह वर्ज़न अब नई नौकरियों का डेटा नहीं पढ़ सकता। कृपया Google Play से ऐप अपडेट करें — एक मिनट लगेगा और आपकी सेव नौकरियाँ व सेटिंग बनी रहेंगी।",
            updateButton = "Google Play से अपडेट करें",
            sourceLine = { host, date -> listOfNotNull(host.ifBlank { null }?.let { "स्रोत: $it" }, date.ifBlank { null }?.let { "अपडेट $it" }).joinToString(" · ") },
        )
    }
}
