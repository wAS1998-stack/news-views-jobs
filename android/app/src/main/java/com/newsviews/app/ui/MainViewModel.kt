package com.newsviews.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.newsviews.app.Stats
import com.newsviews.app.ads.Ads
import com.newsviews.app.data.AppIndex
import com.newsviews.app.data.JobItem
import com.newsviews.app.data.Prefs
import com.newsviews.app.data.Qual
import com.newsviews.app.data.Repository
import com.newsviews.app.data.SearchIndex
import com.newsviews.app.data.Settings
import com.newsviews.app.data.Status
import com.newsviews.app.data.UpdateItem
import com.newsviews.app.data.isClosed
import com.newsviews.app.data.status
import com.newsviews.app.push.Alerts
import com.newsviews.app.work.Reminders
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class Filters(
    val query: String = "", val state: String = "", val qual: String = "", val closingSoon: Boolean = false, val updateType: String = "",
    val cat: String = "",              // a category slug, or FOLLOWING
    val ageFits: Boolean = false,
    val updateFollowing: Boolean = false,
    val upcoming: Boolean = false,      // Results tab: upcoming exam / admit card / result dates, soonest first
    val forYou: Boolean = true,         // Jobs tab: only the states (+ central) and qualification chosen in Alerts
    val updateQuery: String = "",       // Results tab search
    val queryRev: Int = 0,              // bumped when the app sets [query] itself (a link), so the search box shows it
) { companion object { const val FOLLOWING = "_following" } }

class MainViewModel(app: Application) : AndroidViewModel(app) {
    val repo = Repository(app)
    val prefs = Prefs(app)

    private val _index = MutableStateFlow<AppIndex?>(null)   // the cached copy is read off the main thread in init
    val index: StateFlow<AppIndex?> = _index.asStateFlow()
    private val _search = MutableStateFlow<SearchIndex?>(null)
    /** The search words of the current feed, built off the main thread whenever a new feed arrives. */
    val search: StateFlow<SearchIndex?> = _search.asStateFlow()
    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()
    private val _error = MutableStateFlow(false)
    val error: StateFlow<Boolean> = _error.asStateFlow()
    private val _filters = MutableStateFlow(Filters())
    val filters: StateFlow<Filters> = _filters.asStateFlow()
    private val _review = MutableSharedFlow<String>(extraBufferCapacity = 1)
    /** A good moment to ask for a Play rating (the second saved job with reminders on); MainActivity's root shows it. */
    val reviewMoments: SharedFlow<String> = _review.asSharedFlow()

    val settings: StateFlow<Settings> = prefs.flow.stateIn(viewModelScope, SharingStarted.Eagerly, Settings())
    /** false until the saved settings have been read (avoids flashing the welcome screen). */
    val settingsLoaded: StateFlow<Boolean> = prefs.flow.map { true }.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    init {
        viewModelScope.launch {
            val cached = withContext(Dispatchers.IO) { repo.cachedIndex() }
            if (_index.value == null && cached != null) _index.value = cached
        }
        viewModelScope.launch {
            _index.collectLatest { idx -> _search.value = idx?.let { withContext(Dispatchers.Default) { SearchIndex.build(it) } } }
        }
        // notification channel names follow the app's language (read from the saved settings, not the default value)
        viewModelScope.launch {
            prefs.flow.map { it.hindi }.distinctUntilChanged().collect { Alerts.createChannels(getApplication(), it) }
        }
        refresh()
    }

    private var lastOk = 0L

    /** Downloads the feed; retries a few times (a phone that has just woken up often has no network yet). */
    fun refresh() {
        if (_loading.value) return
        viewModelScope.launch {
            _loading.value = true
            try {
                var ok = false
                var last: Exception? = null
                for (attempt in 0 until 3) {
                    try {
                        val idx = repo.fetchIndex()
                        _index.value = idx
                        _error.value = false
                        lastOk = System.currentTimeMillis()
                        Stats.crashKeys(idx.built, idx.jobs.size, settings.value.hindi, Ads.pro.value)
                        // reminders, snapshots and topics in their own coroutine: the refresh spinner doesn't wait for
                        // Firebase, and a reminder problem must not mark the feed as offline
                        viewModelScope.launch { runCatching { afterRefresh(idx) } }
                        ok = true
                        break
                    } catch (e: Exception) {
                        last = e
                        if (attempt < 2) delay(if (attempt == 0) 2000L else 5000L)
                    }
                }
                if (!ok) {
                    _error.value = true                        // only once every retry failed (no "offline" flash in between)
                    // no network is normal on a phone; anything else (a server error, a broken feed) is worth knowing about
                    last?.let { if (it !is java.io.IOException) Stats.nonFatal(it, "refresh") }
                }
            } finally {
                _loading.value = false
            }
        }
    }

    /** Saved jobs follow their current last date (extensions) — also restores reminders after a backup restore. "Remind
        me" dates follow the feed too. The saved snapshots are refreshed (they decide the "sv-" extension topics). */
    private suspend fun afterRefresh(idx: AppIndex) {
        val s = prefs.current()
        val ctx = getApplication<Application>()
        val byId = idx.jobs.associateBy { it.id }
        if (s.saved.isNotEmpty()) {
            val live = s.saved.mapNotNull { byId[it] }
            withContext(Dispatchers.IO) { live.forEach { repo.saveSnapshot(it) } }
            if (s.reminders) Reminders.rescheduleAll(ctx, live, s.hindi, s.applied)
        }
        rescheduleTracked(idx, s)
        Alerts.sync(ctx, prefs)
    }

    /** Re-plans every "Remind me" from the current feed (a changed exam date moves the reminder); a date that has
        passed or left the feed is dropped from the list. */
    private suspend fun rescheduleTracked(idx: AppIndex, s: Settings) {
        if (s.tracked.isEmpty()) return
        val ctx = getApplication<Application>()
        val jobs = idx.jobs.associateBy { it.id }
        val ups = idx.updates.associateBy { it.id }
        val today = com.newsviews.app.data.Dates.today().toString()
        val keep = mutableSetOf<String>()
        for (key in s.tracked) {
            val date = Reminders.eventDate(key, jobs, ups)
            if (date.length < 10 || date.take(10) < today) { Reminders.cancelEvent(ctx, key); continue }
            keep += key
            val (title, label) = trackedText(key, jobs, ups, s.hindi)
            Reminders.scheduleEvent(ctx, key, title, label, date)
        }
        if (keep != s.tracked) prefs.setTracked(keep)
    }

    private fun trackedText(key: String, jobs: Map<String, JobItem>, ups: Map<String, UpdateItem>, hindi: Boolean): Pair<String, String> {
        val str = if (hindi) Strings.HI else Strings.EN
        return if (key.startsWith("x:")) (jobs[key.substring(2)]?.short(hindi) ?: "") to str.x.typeLabel("exam")
        else ups[key.substring(2)].let { u -> (u?.short(hindi) ?: "") to str.x.typeLabel(u?.ty ?: "") }
    }

    /** Coming back to the app: refresh if the data is more than 10 minutes old or the last try failed. */
    fun refreshIfStale() {
        if (_error.value || System.currentTimeMillis() - lastOk > 10 * 60 * 1000) refresh()
    }

    fun setFilters(f: Filters) { _filters.value = f }

    /** [search]: the prepared word lists (null while they are being built — then each job's words are made on the spot). */
    fun visibleJobs(idx: AppIndex, f: Filters, s: Settings, search: SearchIndex? = null): List<JobItem> {
        val q = SearchIndex.query(f.query)
        val si = search?.takeIf { it.source === idx }
        val age = s.age()
        val mine = f.forYou && s.hasProfile()
        val myStates = s.states + (if (s.central) setOf("all-india") else emptySet())
        val myLevels = s.qual.levels.toSet()
        return idx.jobs.filter { j ->
            (!mine || ((s.states.isEmpty() && (s.central || "all-india" !in j.s)) || j.s.any { it in myStates }) && (j.q.isEmpty() || j.q.any { it in myLevels })) &&
            (f.state.isEmpty() || f.state in j.s) &&
                (f.qual.isEmpty() || f.qual in j.q) &&
                (!f.closingSoon || j.status() == Status.SOON) &&
                (f.cat.isEmpty() || (if (f.cat == Filters.FOLLOWING) s.follows(j.o) else f.cat in j.c)) &&
                (!f.ageFits || (age != null && s.ageFor(j)?.let { a -> j.ageFits(a, s.relaxation()) } == true)) &&
                (q.isEmpty || (si?.jobMatches(j, q) ?: q.matches(SearchIndex.jobTokens(j, idx))))
        }.let { l ->
            // open jobs first; with a search, jobs whose own title matches before those found through a state / category
            // word (stable: keeps the feed's order otherwise)
            if (q.isEmpty) l.sortedBy { it.status().isClosed() }
            else l.sortedWith(compareBy({ it.status().isClosed() }, { si?.jobRank(it, q) ?: (if (q.matches(SearchIndex.jobCoreTokens(it))) 0 else 1) }))
        }
    }

    /** The Results tab list: type / followed filters and the search box. */
    fun visibleUpdates(idx: AppIndex, f: Filters, s: Settings, search: SearchIndex? = null): List<UpdateItem> {
        val q = SearchIndex.query(f.updateQuery)
        val si = search?.takeIf { it.source === idx }
        val l = idx.updates.filter { u ->
            (f.updateType.isEmpty() || u.ty == f.updateType) && (!f.updateFollowing || s.follows(u.o)) &&
                (q.isEmpty || (si?.updateMatches(u, q) ?: q.matches(SearchIndex.updateTokens(u, idx))))
        }
        return if (q.isEmpty) l else l.sortedBy { u -> si?.updateRank(u, q) ?: (if (q.matches(SearchIndex.updateCoreTokens(u))) 0 else 1) }
    }

    /** Up to [n] open jobs related to [job]: same department first, then same category or qualification in the
        person's states. Built from the cached index, no network. */
    fun relatedJobs(idx: AppIndex, job: JobItem, s: Settings, n: Int = 5): Pair<List<JobItem>, List<JobItem>> {
        val open = idx.jobs.filter { it.id != job.id && !it.status().isClosed() }
        val sameOrg = if (job.o.isBlank()) emptyList() else open.filter { it.o == job.o }.take(3)
        val myStates = s.states + (if (s.central || s.states.isEmpty()) setOf("all-india") else emptySet())
        val similar = open.asSequence().filter { it !in sameOrg }
            .filter { o -> (job.c.isNotEmpty() && o.c.any { it in job.c }) || (job.q.isNotEmpty() && o.q.any { it in job.q }) }
            .filter { o -> s.states.isEmpty() || o.s.any { it in myStates } || o.s.any { it in job.s } }
            .take(n - sameOrg.size.coerceAtMost(n)).toList()
        return sameOrg to similar
    }

    fun toggleSaved(item: JobItem) {
        viewModelScope.launch {
            val now = prefs.toggleSaved(item.id)
            val ctx = getApplication<Application>()
            if (now) {
                withContext(Dispatchers.IO) { repo.saveSnapshot(item) }
                repo.saveDetail(item.id)           // the whole page, for reading it offline
                val s = prefs.current()
                if (s.reminders && !item.status().isClosed()) Reminders.schedule(ctx, item.id, item.title(s.hindi), item.en)
                // a second saved job with reminders on: someone who plans with the app — a good moment for a rating
                if (s.reminders && s.saved.size == 2 && !item.status().isClosed()) _review.tryEmit("saved2")
            } else {
                withContext(Dispatchers.IO) { repo.dropSnapshot(item.id) }
                Reminders.cancel(ctx, item.id)
                prefs.dropApplied(item.id)
            }
            Alerts.sync(ctx, prefs)                // the saved job's "last date extended" topic
        }
    }

    /** "Applied" on a saved job: its last-date reminders stop (and come back if it is unmarked). */
    fun toggleApplied(item: JobItem) {
        viewModelScope.launch {
            val now = prefs.toggleApplied(item.id)
            val ctx = getApplication<Application>()
            val s = prefs.current()
            if (now) Reminders.cancel(ctx, item.id)
            else if (s.reminders && item.id in s.saved && !item.status().isClosed()) Reminders.schedule(ctx, item.id, item.title(s.hindi), item.en)
            com.newsviews.app.Stats.event(ctx, "applied_mark", "on" to now.toString())
        }
    }

    /** "Remind me" on a result / admit card / exam date ([key] "u:<id>") or a job's exam date ("x:<id>"). Returns nothing;
        the bell follows Settings.tracked. */
    fun toggleTracked(key: String, title: String, label: String, date: String) {
        viewModelScope.launch {
            val now = prefs.toggleTracked(key)
            val ctx = getApplication<Application>()
            if (now) Reminders.scheduleEvent(ctx, key, title, label, date) else Reminders.cancelEvent(ctx, key)
            com.newsviews.app.Stats.event(ctx, "remind_me", "on" to now.toString())
        }
    }

    fun savedJobs(idx: AppIndex?, saved: Set<String>): List<JobItem> {
        val live = idx?.jobs?.associateBy { it.id } ?: emptyMap()
        return saved.mapNotNull { live[it] ?: repo.savedSnapshot(it) }.sortedWith(compareBy({ it.status().isClosed() }, { it.en.ifEmpty { "9999" } }))
    }

    private fun resync() = viewModelScope.launch { Alerts.sync(getApplication(), prefs) }

    fun setHindi(v: Boolean) = viewModelScope.launch { prefs.setHindi(v); Alerts.sync(getApplication(), prefs) }
    fun setAlerts(v: Boolean) = viewModelScope.launch { prefs.setAlerts(v); Alerts.sync(getApplication(), prefs) }
    fun setResults(v: Boolean) = viewModelScope.launch { prefs.setResults(v); Alerts.sync(getApplication(), prefs) }
    fun setDigest(v: Boolean) = viewModelScope.launch { prefs.setDigest(v); Alerts.sync(getApplication(), prefs) }
    fun setQuizAlerts(v: Boolean) = viewModelScope.launch { prefs.setQuizAlerts(v); Alerts.sync(getApplication(), prefs) }
    fun setReminders(v: Boolean) = viewModelScope.launch {
        prefs.setReminders(v)
        val s = prefs.current()
        if (v) _index.value?.let { idx -> val byId = idx.jobs.associateBy { it.id }; Reminders.rescheduleAll(getApplication(), s.saved.mapNotNull { byId[it] }, s.hindi, s.applied) }
        else Reminders.cancelAll(getApplication(), s.saved)
    }
    fun setQual(q: Qual) = viewModelScope.launch { prefs.setQual(q); Alerts.sync(getApplication(), prefs) }
    fun toggleState(slug: String) = viewModelScope.launch {
        val cur = settings.value.states
        prefs.setStates(if (slug in cur) cur - slug else cur + slug)
        Alerts.sync(getApplication(), prefs)
    }
    fun clearStates() = viewModelScope.launch { prefs.setStates(emptySet()); Alerts.sync(getApplication(), prefs) }
    fun setCentral(on: Boolean) = viewModelScope.launch { prefs.setCentral(on); Alerts.sync(getApplication(), prefs) }
    fun toggleFollow(org: String) = viewModelScope.launch { if (org.isNotBlank()) { prefs.toggleFollow(org); Alerts.sync(getApplication(), prefs) } }
    fun setDob(iso: String) = viewModelScope.launch { prefs.setDob(iso) }
    /** A quiz was finished: the streak counts the day it was played; the score is kept per quiz (its date). */
    fun quizDone(playedOn: String, quizDate: String, score: Int, total: Int) = viewModelScope.launch {
        prefs.quizDone(playedOn)
        if (quizDate.isNotBlank()) prefs.quizScore(quizDate, "$score/$total")
    }
    fun setCategory(c: String) = viewModelScope.launch { prefs.setCategory(c) }
    /** Debug builds only (CI screenshots): a sample date of birth and two followed departments. */
    fun demoProfile() = viewModelScope.launch {
        prefs.setDob("2000-01-15")
        for (o in listOf("SSC", "RRB")) if (!prefs.current().follows(o)) prefs.toggleFollow(o)
    }
    fun finishOnboarding() = viewModelScope.launch { prefs.setOnboarded(); Alerts.sync(getApplication(), prefs) }
    fun syncAlerts() { resync() }
}
