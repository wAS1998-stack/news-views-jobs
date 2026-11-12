package com.newsviews.app.data

import com.newsviews.app.ui.QUAL_HI
import com.newsviews.app.ui.STATE_HI
import com.newsviews.app.ui.TYPE_HI
import com.newsviews.app.ui.qualName

/**
 * Search over the feed, in English and Hindi: every job and result gets a list of words (built once per feed, off the
 * main thread — see MainViewModel.search) from its titles, department, posts, states, categories and qualifications.
 * A query matches when every typed word (after dropping filler such as "jobs", "2026", "भर्ती") is the start of one of
 * those words, or one of its synonyms is a whole word or phrase of the item ("rly" = railway = RRB = रेलवे, "up" =
 * "uttar pradesh"). Synonyms and two-word phrases ("post office", "uttar pradesh", "admit card") match exactly — word
 * pairs are indexed for that — so "post office" no longer finds every "posts … officer". Words of one or two letters
 * ("up", "mp", "pg") must match a whole word, so "up" does not find every "update".
 */
class SearchIndex private constructor(
    val source: AppIndex,
    private val jobWords: Map<String, Set<String>>,
    private val updateWords: Map<String, Set<String>>,
    private val jobTitleWords: Map<String, Set<String>>,
    private val updateTitleWords: Map<String, Set<String>>,
) {

    fun jobMatches(job: JobItem, q: Query): Boolean = q.isEmpty || q.matches(jobWords[job.id] ?: jobTokens(job, source))
    fun updateMatches(u: UpdateItem, q: Query): Boolean = q.isEmpty || q.matches(updateWords[u.id] ?: updateTokens(u, source))
    /** 0 when the title / department / post itself matches (shown first), 1 when only a state, category or
        qualification word did ("upsc" finds UPSC first, then the state PSCs filed under "UPSC & State PSC"). */
    fun jobRank(job: JobItem, q: Query): Int = if (q.isEmpty || q.matches(jobTitleWords[job.id] ?: jobCoreTokens(job))) 0 else 1
    fun updateRank(u: UpdateItem, q: Query): Int = if (q.isEmpty || q.matches(updateTitleWords[u.id] ?: updateCoreTokens(u))) 0 else 1

    /** One part of a query: the word as typed (matched as a word start; null for a recognised phrase) and the synonyms
        and phrases that count too (matched exactly, as a whole word or a whole word pair). */
    class Part internal constructor(val typed: String?, val exact: List<String>)

    /** A parsed query: every part must match. */
    class Query internal constructor(private val parts: List<Part>) {
        val isEmpty: Boolean get() = parts.isEmpty()
        fun matches(tokens: Set<String>): Boolean = parts.all { p -> (p.typed != null && hitTyped(p.typed, tokens)) || p.exact.any { it in tokens } }
        private fun hitTyped(w: String, tokens: Set<String>): Boolean =
            if (w.length <= 2) w in tokens else tokens.any { it.startsWith(w) && ' ' !in it }
    }

    companion object {
        /** Builds the word lists of every job and result (a few thousand short strings: call on Dispatchers.Default). */
        fun build(idx: AppIndex): SearchIndex =
            SearchIndex(idx, idx.jobs.associate { it.id to jobTokens(it, idx) }, idx.updates.associate { it.id to updateTokens(it, idx) },
                idx.jobs.associate { it.id to jobCoreTokens(it) }, idx.updates.associate { it.id to updateCoreTokens(it) })

        private val SPLIT = Regex("[^\\p{L}\\p{N}\\p{M}]+")   // keeps Devanagari vowel signs (\p{M}) inside words

        /** Lower-case words of [text], punctuation removed ("B.Sc/B.Tech" -> b, sc, b, tech). */
        fun words(text: String): List<String> = text.lowercase().split(SPLIT).filter { it.isNotBlank() }

        private val STOP = setOf(
            "job", "jobs", "vacancy", "vacancies", "recruitment", "recruitments", "bharti", "bharati", "naukri", "naukari", "sarkari", "govt",
            "government", "2025", "2026", "2027", "notification", "online", "form", "apply", "latest", "new", "the", "for", "of", "in", "and",
            "भर्ती", "भर्तियाँ", "नौकरी", "नौकरियाँ", "सरकारी", "वैकेंसी", "की", "के", "का", "में",
            // "10th pass" / "12वीं पास": the level is the word that matters ("pass" matched no word, so the search found nothing)
            "pass", "passed", "पास",
        )

        /** Query words that mean the same thing (each group: any member finds the others). Multi-word members are phrases. */
        private val SYNONYMS: List<List<String>> = listOf(
            listOf("rly", "railway", "railways", "rail", "rrb", "rrc", "रेलवे", "रेल"),
            listOf("bank", "banks", "banking", "बैंक"),
            listOf("police", "पुलिस", "constable", "कांस्टेबल", "सिपाही"),
            listOf("teacher", "teachers", "teaching", "शिक्षक", "अध्यापक", "टीचर"),
            listOf("army", "सेना", "agniveer", "अग्निवीर"),
            listOf("defence", "defense", "रक्षा"),
            listOf("post office", "postal", "india post", "gds", "डाक"),
            listOf("clerk", "क्लर्क", "लिपिक"),
            listOf("nurse", "nurses"),           // not "nursing" / "नर्स…": the category "Medical & nursing" would bring every hospital job
            listOf("doctor", "doctors", "डॉक्टर"),
            listOf("engineer", "engineering", "इंजीनियर", "इंजीनियरिंग"),
            listOf("apprentice", "अप्रेंटिस", "प्रशिक्षु"),
            listOf("driver", "ड्राइवर", "चालक"),
            listOf("peon", "mts", "चपरासी"),
            listOf("anganwadi", "आंगनवाड़ी"),
            listOf("court", "कोर्ट", "न्यायालय"),
            listOf("result", "results", "रिजल्ट", "परिणाम"),
            listOf("admit card", "hall ticket", "call letter", "प्रवेश पत्र", "एडमिट"),
            listOf("answer key", "उत्तर कुंजी", "आंसर"),
            listOf("exam date", "exam schedule", "परीक्षा तिथि"),
            listOf("10th", "10", "matric", "matriculation", "दसवीं", "10वीं"),
            listOf("12th", "12", "intermediate", "बारहवीं", "12वीं"),
            listOf("graduate", "graduation", "degree", "स्नातक", "ग्रेजुएट"),
            listOf("post graduate", "pg", "postgraduate", "स्नातकोत्तर"),
            listOf("diploma", "polytechnic", "डिप्लोमा"),
            listOf("iti", "आईटीआई"),
            listOf("up", "uttar pradesh", "उत्तर प्रदेश", "यूपी"),
            listOf("mp", "madhya pradesh", "मध्य प्रदेश", "एमपी"),
            listOf("hp", "himachal", "हिमाचल"),
            listOf("ap", "andhra", "आंध्र"),
            listOf("uk", "uttarakhand", "उत्तराखंड"),
            listOf("wb", "west bengal", "bengal", "पश्चिम बंगाल", "बंगाल"),
            listOf("tn", "tamil nadu", "tamilnadu", "तमिलनाडु"),
            listOf("jk", "jammu", "kashmir", "जम्मू", "कश्मीर"),
            listOf("cg", "chhattisgarh", "छत्तीसगढ़"),
            listOf("delhi", "ncr", "दिल्ली"),
            listOf("bihar", "बिहार"),
            listOf("rajasthan", "राजस्थान"),
            listOf("haryana", "हरियाणा"),
            listOf("punjab", "पंजाब"),
            listOf("gujarat", "गुजरात"),
            listOf("maharashtra", "महाराष्ट्र"),
            listOf("jharkhand", "झारखंड"),
            listOf("odisha", "orissa", "ओडिशा"),
            listOf("central", "all india", "केंद्र", "केंद्रीय"),
        )
        /** Each group as normalised strings ("Uttar Pradesh" -> "uttar pradesh"), looked up by a one-word or a two-word member. */
        private val SYN_BY_WORD: Map<String, List<String>>
        private val SYN_BY_PHRASE: Map<String, List<String>>
        init {
            val one = HashMap<String, List<String>>(); val two = HashMap<String, List<String>>()
            for (g in SYNONYMS) {
                val alts = g.map { words(it).joinToString(" ") }.filter { it.isNotEmpty() }.distinct()
                for (m in alts) { val n = m.count { it == ' ' }; if (n == 0) one[m] = alts else if (n == 1) two[m] = alts }
            }
            SYN_BY_WORD = one; SYN_BY_PHRASE = two
        }

        /** Parses what was typed: lower case, punctuation removed, filler dropped; a known two-word phrase ("post office",
            "uttar pradesh") becomes one part matched exactly; every other word keeps its own synonyms. */
        fun query(text: String): Query {
            val ws = words(text).filter { it !in STOP }
            val parts = ArrayList<Part>()
            var i = 0
            while (i < ws.size) {
                if (i + 1 < ws.size) {
                    val ph = SYN_BY_PHRASE[ws[i] + " " + ws[i + 1]]
                    if (ph != null) { parts += Part(null, ph); i += 2; continue }
                }
                val w = ws[i]
                parts += Part(w, SYN_BY_WORD[w].orEmpty().filter { it != w })
                i++
            }
            return Query(parts)
        }

        /** Words and adjacent word pairs of [text] (pairs let phrases such as "uttar pradesh" match exactly). */
        private fun addText(out: MutableSet<String>, text: String) {
            val w = words(text)
            out += w
            for (k in 0 until w.size - 1) out += w[k] + " " + w[k + 1]
        }
        private fun phrase(text: String) = words(text).joinToString(" ")

        /** Short forms a state is known by in job titles and searches. */
        private val STATE_ABBR = mapOf(
            "uttar-pradesh" to listOf("up", "यूपी"), "madhya-pradesh" to listOf("mp", "एमपी"), "himachal-pradesh" to listOf("hp"), "andhra-pradesh" to listOf("ap"),
            "uttarakhand" to listOf("uk"), "west-bengal" to listOf("wb"), "tamil-nadu" to listOf("tn"), "jammu-kashmir" to listOf("jk"), "chhattisgarh" to listOf("cg"),
            "delhi" to listOf("ncr"), "all-india" to listOf("central", "india", "केंद्र", "केंद्रीय"),
        )
        /** Words for each qualification level (the level a job asks for is what people type). */
        private val QUAL_WORDS = mapOf(
            "10th-pass" to listOf("10th", "10", "matric", "matriculation", "दसवीं", "10वीं"),
            "12th-pass" to listOf("12th", "12", "intermediate", "बारहवीं", "12वीं"),
            "graduate" to listOf("graduate", "graduation", "degree", "स्नातक", "ग्रेजुएट"),
            "engineering-diploma" to listOf("diploma", "iti", "polytechnic", "engineering", "डिप्लोमा", "आईटीआई", "इंजीनियरिंग"),
            "post-graduate" to listOf("pg", "postgraduate", "post graduate", "स्नातकोत्तर"),
        )
        private val TYPE_WORDS = mapOf(
            "result" to "result results merit list cut off",
            "admit-card" to "admit card hall ticket call letter",
            "answer-key" to "answer key",
            "exam-date" to "exam date schedule calendar",
        )

        private fun stateWords(slug: String, idx: AppIndex, out: MutableSet<String>) {
            (idx.states.firstOrNull { it.slug == slug }?.name ?: Builtin.states.firstOrNull { it.slug == slug }?.name)?.let { addText(out, it) }
            STATE_HI[slug]?.let { addText(out, it) }
            STATE_ABBR[slug]?.let { out += it }
            addText(out, slug.replace('-', ' '))
        }

        private fun catWords(slugs: List<String>, idx: AppIndex, out: MutableSet<String>) {
            for (c in slugs) {
                out += words(c)
                idx.cats.firstOrNull { it.slug == c }?.let { addText(out, it.name); addText(out, it.hi) }
            }
        }

        /** The words of a job's own titles, department and posts. */
        internal fun jobCoreTokens(j: JobItem): Set<String> {
            val out = HashSet<String>()
            for (t in listOf(j.t, j.th, j.tc, j.thc, j.o, j.p, j.ph)) addText(out, t)
            return out
        }

        internal fun updateCoreTokens(u: UpdateItem): Set<String> {
            val out = HashSet<String>()
            for (t in listOf(u.t, u.th, u.tc, u.thc, u.o)) addText(out, t)
            return out
        }

        internal fun jobTokens(j: JobItem, idx: AppIndex): Set<String> {
            val out = HashSet<String>()
            for (t in listOf(j.t, j.th, j.tc, j.thc, j.o, j.p, j.ph)) addText(out, t)
            for (st in j.s) stateWords(st, idx, out)
            catWords(j.c, idx, out)
            for (q in j.q) {
                // the level as a phrase only: "Post Graduate" must not make a PG job match "graduate" or "post"
                out += phrase(qualName(q)); QUAL_HI[q]?.let { out += phrase(it) }
                QUAL_WORDS[q]?.let { out += it }
            }
            if (j.w == 1) out += listOf("walk", "walkin", "walk in", "interview", "वॉक")
            return out
        }

        internal fun updateTokens(u: UpdateItem, idx: AppIndex): Set<String> {
            val out = HashSet<String>()
            for (t in listOf(u.t, u.th, u.tc, u.thc, u.o)) addText(out, t)
            TYPE_WORDS[u.ty]?.let { addText(out, it) }
            TYPE_HI[u.ty]?.let { addText(out, it) }
            idx.types.firstOrNull { it.slug == u.ty }?.let { addText(out, it.name) }
            catWords(u.c, idx, out)
            return out
        }
    }
}
