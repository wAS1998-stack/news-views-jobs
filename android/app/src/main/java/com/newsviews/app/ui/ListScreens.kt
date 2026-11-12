package com.newsviews.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Event
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.platform.LocalContext
import com.newsviews.app.BuildConfig
import com.newsviews.app.ads.Ads
import com.newsviews.app.ads.NativeAdCard
import com.newsviews.app.ads.RefreshNative
import com.newsviews.app.ads.findActivity
import com.newsviews.app.data.AppIndex
import com.newsviews.app.data.Builtin
import com.newsviews.app.data.SearchIndex
import com.newsviews.app.data.isClosed
import com.newsviews.app.data.status
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.newsviews.app.data.Dates
import com.newsviews.app.work.Reminders
import com.newsviews.app.data.Named
import java.time.Duration
import java.time.Instant

private fun ago(iso: String, hindi: Boolean): String {
    val t = try { Instant.parse(iso) } catch (e: Exception) { return "" }
    val m = Duration.between(t, Instant.now()).toMinutes().coerceAtLeast(0)
    return when {
        m < 2 -> if (hindi) "अभी" else "just now"
        m < 60 -> if (hindi) "$m मिनट पहले" else "$m min ago"
        m < 48 * 60 -> if (hindi) "${m / 60} घंटे पहले" else "${m / 60} h ago"
        else -> if (hindi) "${m / 1440} दिन पहले" else "${m / 1440} days ago"
    }
}

@Composable
private fun Dropdown(label: String, selected: Boolean, options: List<Named>, onPick: (String) -> Unit, allLabel: String, hindiNames: Map<String, String>?, hindi: Boolean) {
    var open by remember { mutableStateOf(false) }
    Box {
        FilterChip(selected = selected, onClick = { open = true }, label = { Text(label, maxLines = 1) },
            trailingIcon = { Icon(Icons.Filled.ArrowDropDown, null) })
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text(allLabel) }, onClick = { onPick(""); open = false })
            options.forEach { o ->
                DropdownMenuItem(text = { Text(if (hindi) hindiNames?.get(o.slug) ?: o.name else o.name) }, onClick = { onPick(o.slug); open = false })
            }
        }
    }
}

/** A search box that owns its text: a StateFlow round-trip lags a frame and drops letters with Hindi / swipe keyboards,
    so the typed text lives here and is only copied into the filters. [rev] changes only when the app itself sets the
    query (a news-views.in organisation link): then the box takes the new text. */
@Composable
private fun SearchBox(initial: String, rev: Int, placeholder: String, clearLabel: String, onChange: (String) -> Unit) {
    var query by rememberSaveable(rev) { mutableStateOf(initial) }
    OutlinedTextField(
        value = query, onValueChange = { query = it; onChange(it) },
        placeholder = { Text(placeholder) }, singleLine = true,
        leadingIcon = { Icon(Icons.Filled.Search, null) },
        trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = ""; onChange("") }) { Icon(Icons.Filled.Clear, clearLabel) } },
        shape = RoundedCornerShape(14.dp),
        colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = MaterialTheme.colorScheme.surface, focusedContainerColor = MaterialTheme.colorScheme.surface),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
fun StatusLine(idx: AppIndex?, error: Boolean, s: Strings, hindi: Boolean, count: Int?, onRetry: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        val txt = buildString {
            if (count != null) append(s.openJobs(count))
            if (idx != null && idx.at.isNotBlank()) { if (isNotEmpty()) append(" · "); append(s.updatedAgo(ago(idx.at, hindi))) }
        }
        Text(if (error && idx != null) s.offline else txt, style = MaterialTheme.typography.labelMedium,
            color = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
        if (error) TextButton(onClick = onRetry) { Text(s.retry) }
    }
}

/** "Remove ads for good" — shown in the list whenever Play has a price for Pro, also when no rewarded video is loaded. */
@Composable
private fun ProCard(s: Strings, price: String, onBuy: () -> Unit) {
    com.newsviews.app.LogOnce("pro_offer_view", "list")
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer), modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(s.proTitle, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSecondaryContainer)
                Text(s.proHint(price), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.padding(top = 2.dp))
            }
            Spacer(Modifier.width(12.dp))
            Button(onClick = onBuy) { Text(s.proButton) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobsScreen(vm: MainViewModel, s: Strings, onQuiz: (String) -> Unit = {}, onQuizzes: () -> Unit = {}, onOpen: (String) -> Unit) {
    val idx by vm.index.collectAsStateWithLifecycle()
    val search by vm.search.collectAsStateWithLifecycle()
    val loading by vm.loading.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val f by vm.filters.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val hindi = settings.hindi
    val list = remember(idx, f, settings, search) { idx?.let { vm.visibleJobs(it, f, settings, search) } ?: emptyList() }
    val listState = rememberLazyListState()
    var dobDialog by remember { mutableStateOf(false) }
    // the opt-in "no ads for N hours" offer, once a rewarded video is loaded and no pass is running
    val adCfg by Ads.config.collectAsStateWithLifecycle()
    val rewardedReady by Ads.rewardedReady.collectAsStateWithLifecycle()
    val adsOff = Ads.adsOff()
    val offer = BuildConfig.ADS && adCfg.on && adCfg.rewarded && rewardedReady && !adsOff
    val activity = LocalContext.current.findActivity()
    RefreshNative("jobs")
    val reminderPrompt = rememberReminderPrompt(s)
    val proPrice by com.newsviews.app.play.Billing.price.collectAsStateWithLifecycle()
    // Pro whenever Play answers with a price (independent of a rewarded video being loaded)
    val proOffer = BuildConfig.ADS && adCfg.on && adCfg.pro && proPrice.isNotBlank() && !adsOff
    if (dobDialog) DobDialog(s, settings.dob, onDismiss = { dobDialog = false }) { iso -> vm.setDob(iso); vm.setFilters(f.copy(ageFits = true)); dobDialog = false }

    Column(Modifier.fillMaxSize()) {
        SearchBox(f.query, f.queryRev, s.search, s.clear) { vm.setFilters(vm.filters.value.copy(query = it)) }
        // categories (from the feed) and followed departments
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item { FilterChip(selected = f.cat.isEmpty(), onClick = { vm.setFilters(f.copy(cat = "")) }, label = { Text(s.allTypes) }) }
            if (settings.follows.isNotEmpty()) item {
                FilterChip(selected = f.cat == Filters.FOLLOWING, onClick = { vm.setFilters(f.copy(cat = if (f.cat == Filters.FOLLOWING) "" else Filters.FOLLOWING)) },
                    label = { Text(s.following) }, leadingIcon = { Icon(Icons.Filled.Star, null) })
            }
            items(idx?.cats ?: emptyList(), key = { it.slug }) { c ->
                FilterChip(selected = f.cat == c.slug, onClick = { vm.setFilters(f.copy(cat = if (f.cat == c.slug) "" else c.slug)) },
                    label = { Text(if (hindi && c.hi.isNotBlank()) c.hi else c.name) })
            }
        }
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (settings.hasProfile()) item {
                FilterChip(selected = f.forYou, onClick = { vm.setFilters(f.copy(forYou = !f.forYou)) }, label = { Text(s.forYou) },
                    leadingIcon = { Icon(Icons.Filled.Person, null) })
            }
            item {
                // central government (all-India) jobs first under "All states", then each state
                val opts = (idx?.states ?: Builtin.states).let { l -> l.filter { it.slug == "all-india" }.map { it.copy(name = s.central) } + l.filter { it.slug != "all-india" } }
                val names = STATE_HI + ("all-india" to s.central)
                val st = opts.firstOrNull { it.slug == f.state }
                Dropdown(if (st == null) s.allStates else if (hindi) names[st.slug] ?: st.name else st.name, st != null, opts,
                    { vm.setFilters(f.copy(state = it)) }, s.allStates, names, hindi)
            }
            item {
                val q = (idx?.quals ?: Builtin.quals).firstOrNull { it.slug == f.qual }
                Dropdown(if (q == null) s.allQuals else if (hindi) QUAL_HI[q.slug] ?: q.name else q.name, q != null, idx?.quals ?: Builtin.quals,
                    { vm.setFilters(f.copy(qual = it)) }, s.allQuals, QUAL_HI, hindi)
            }
            item { FilterChip(selected = f.closingSoon, onClick = { vm.setFilters(f.copy(closingSoon = !f.closingSoon)) }, label = { Text(s.closingSoon) }) }
            item {
                FilterChip(selected = f.ageFits, label = { Text(s.ageFits) },
                    onClick = { if (settings.age() == null) dobDialog = true else vm.setFilters(f.copy(ageFits = !f.ageFits)) })
            }
        }
        StatusLine(idx, error, s, hindi, if (idx != null) list.count { !it.status().isClosed() } else null) { vm.refresh() }
        PullToRefreshBox(isRefreshing = loading, onRefresh = { vm.refresh() }, modifier = Modifier.fillMaxSize()) {
            when {
                idx == null && loading -> Centered(s.loading)
                idx == null -> Centered(s.couldNotLoad, s.retry) { vm.refresh() }
                list.isEmpty() -> Centered(s.noMatch)
                else -> LazyColumn(state = listState, contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
                    // the daily quiz: today's (or yesterday's until today's is out) until it is played; then a small card
                    // with the streak, yesterday's quiz if it was missed, and all quizzes
                    val today = Dates.today()
                    val yesterday = today.minusDays(1).toString()
                    val quizzes = idx?.quizzes ?: emptyList()
                    val newest = quizzes.firstOrNull()
                    val playedToday = today.toString() in settings.quizDays
                    val playedNewest = newest != null && newest.date.take(10) in settings.quizScores
                    if (newest != null && !playedNewest && newest.date >= yesterday) item(key = "quiz-${newest.id}") {
                        QuizCard(newest, settings.quizStreak(), s) { onQuiz(newest.id) }
                    } else if (newest != null && (playedToday || playedNewest)) item(key = "quiz-done") {
                        val missed = quizzes.firstOrNull { it.date == yesterday && it.date !in settings.quizScores }
                        QuizDoneCard(settings.quizStreak(), s, onYesterday = missed?.let { m -> { onQuiz(m.id) } }, onAll = onQuizzes)
                    }
                    itemsIndexed(list, key = { _, j -> j.id }) { i, j ->
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            if (i == 5 && offer) AdFreeCard(s, adCfg.rewardHours, proPrice = if (proOffer) proPrice else "",
                                onPro = { activity?.let { com.newsviews.app.play.Billing.buy(it, "list") } }) { activity?.let { Ads.showRewarded(it, "list") } }
                            else if (i == 5 && proOffer) ProCard(s, proPrice) { activity?.let { com.newsviews.app.play.Billing.buy(it, "list") } }
                            val every = adCfg.nativeEvery.coerceAtLeast(5)
                            if (i >= 9 && (i - 9) % every == 0 && (i - 9) / every < 5) {
                                val k = (i - 9) / every
                                NativeAdCard(if (k == 0) "jobs" else "jobs-$k", s.ad, preloadNext = if (k < 4) "jobs-${k + 1}" else null)
                            }
                            JobCard(j, hindi, s, j.id in settings.saved, onSave = {
                                val wasSaved = j.id in settings.saved
                                vm.toggleSaved(j)
                                if (!wasSaved && settings.reminders && j.en.isNotBlank() && j.ns.isBlank() && !j.status().isClosed()) reminderPrompt()
                            }, onClick = { onOpen(j.id) })
                        }
                    }
                    // a short (filtered) list has no ad inside it: one at its end
                    if (list.size in 4..9) item(key = "native-end") { NativeAdCard("jobs", s.ad) }
                }
            }
        }
    }
}

/** One dated entry in the "Upcoming dates" view: an exam / admit card / result date, or a job's exam date. */
data class CalItem(val date: String, val isJob: Boolean, val id: String, val title: String, val org: String, val label: String, val type: String)

fun upcomingItems(idx: AppIndex, hindi: Boolean, s: Strings, typeName: (String) -> String): List<CalItem> {
    val today = Dates.today().toString()
    val ups = idx.updates.filter { it.ev >= today && it.ev.length >= 10 }
        .map { CalItem(it.ev.take(10), false, it.id, it.short(hindi), it.o, typeName(it.ty), it.ty) }
    val exams = idx.jobs.filter { it.x >= today && it.x.length >= 10 }
        .map { CalItem(it.x.take(10), true, it.id, it.short(hindi), it.o, s.examLabel, "exam") }
    return (ups + exams).sortedWith(compareBy({ it.date }, { it.isJob }))
}

@Composable
private fun DateHeader(iso: String, s: Strings, hindi: Boolean) {
    val d = Dates.parse(iso) ?: return
    val diff = java.time.temporal.ChronoUnit.DAYS.between(Dates.today(), d)
    val label = when (diff) { 0L -> s.today; 1L -> s.tomorrow; else -> d.format(java.time.format.DateTimeFormatter.ofPattern("EEE, d MMM", if (hindi) Dates.HINDI else java.util.Locale.ENGLISH)) }
    Text(label, style = MaterialTheme.typography.titleSmall, color = if (diff <= 1L) Pills.saffron().fg else MaterialTheme.colorScheme.primary,
        modifier = Modifier.padding(top = 10.dp, bottom = 2.dp))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpdatesScreen(vm: MainViewModel, s: Strings, onOpen: (String) -> Unit, onOpenJob: (String) -> Unit = {}) {
    val idx by vm.index.collectAsStateWithLifecycle()
    val search by vm.search.collectAsStateWithLifecycle()
    val loading by vm.loading.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val f by vm.filters.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val hindi = settings.hindi
    val list = remember(idx, f.updateType, f.updateFollowing, f.updateQuery, settings.follows, search) {
        idx?.let { vm.visibleUpdates(it, f, settings, search) } ?: emptyList()
    }
    RefreshNative("updates")
    val adCfg by Ads.config.collectAsStateWithLifecycle()
    val typeName = { slug: String -> if (hindi) TYPE_HI[slug] ?: slug else idx?.types?.firstOrNull { it.slug == slug }?.name?.removeSuffix("s") ?: slug }

    Column(Modifier.fillMaxSize()) {
        SearchBox(f.updateQuery, 0, s.x.searchResults, s.clear) { vm.setFilters(vm.filters.value.copy(updateQuery = it)) }
        LazyRow(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item { FilterChip(selected = f.updateType.isEmpty() && !f.upcoming, onClick = { vm.setFilters(f.copy(updateType = "", upcoming = false)) }, label = { Text(s.allTypes) }) }
            item {
                FilterChip(selected = f.upcoming, onClick = { vm.setFilters(f.copy(upcoming = !f.upcoming, updateType = "")) },
                    label = { Text(s.upcoming) }, leadingIcon = { Icon(Icons.Filled.Event, null) })
            }
            if (settings.follows.isNotEmpty()) item {
                FilterChip(selected = f.updateFollowing, onClick = { vm.setFilters(f.copy(updateFollowing = !f.updateFollowing)) },
                    label = { Text(s.following) }, leadingIcon = { Icon(Icons.Filled.Star, null) })
            }
            items(idx?.types ?: Builtin.types) { t ->
                FilterChip(selected = f.updateType == t.slug && !f.upcoming, onClick = { vm.setFilters(f.copy(updateType = t.slug, upcoming = false)) },
                    label = { Text(if (hindi) TYPE_HI[t.slug] ?: t.name else t.name) })
            }
        }
        StatusLine(idx, error, s, hindi, null) { vm.refresh() }
        PullToRefreshBox(isRefreshing = loading, onRefresh = { vm.refresh() }, modifier = Modifier.fillMaxSize()) {
            when {
                idx == null && loading -> Centered(s.loading)
                idx == null -> Centered(s.couldNotLoad, s.retry) { vm.refresh() }
                f.upcoming -> {
                    val cal = remember(idx, hindi, f.updateQuery, search) {
                        val ix = idx ?: return@remember emptyList<CalItem>()
                        val all = upcomingItems(ix, hindi, s, typeName)
                        val q = SearchIndex.query(f.updateQuery)
                        if (q.isEmpty) all else {
                            val si = search?.takeIf { it.source === ix }
                            val ups = ix.updates.associateBy { it.id }
                            val jobs = ix.jobs.associateBy { it.id }
                            all.filter { c ->
                                if (c.isJob) jobs[c.id]?.let { j -> si?.jobMatches(j, q) ?: q.matches(SearchIndex.jobTokens(j, ix)) } == true
                                else ups[c.id]?.let { u -> si?.updateMatches(u, q) ?: q.matches(SearchIndex.updateTokens(u, ix)) } == true
                            }
                        }
                    }
                    if (cal.isEmpty()) Centered(if (f.updateQuery.isNotBlank()) s.x.noMatchUpdates else s.noUpcoming)
                    else LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 0.dp, bottom = 24.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxSize()) {
                        cal.forEachIndexed { i, c ->
                            if (i == 0 || cal[i - 1].date != c.date) item(key = "h-${c.date}") { DateHeader(c.date, s, hindi) }
                            item(key = "${if (c.isJob) "j" else "u"}-${c.id}") {
                                val key = if (c.isJob) "x:${c.id}" else "u:${c.id}"
                                CalRow(c, tracked = key in settings.tracked, remindLabel = s.x.remindMe,
                                    onRemind = if (Reminders.canRemind(c.date)) ({ vm.toggleTracked(key, c.title, s.x.typeLabel(c.type), c.date) }) else null) {
                                    if (c.isJob) onOpenJob(c.id) else onOpen(c.id)
                                }
                            }
                        }
                    }
                }
                list.isEmpty() -> Centered(if (f.updateQuery.isNotBlank()) s.x.noMatchUpdates else s.noMatch)
                else -> LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
                    val long = list.size >= 10
                    itemsIndexed(list, key = { _, u -> u.id }) { i, u ->
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            // natives inside a long list: from the 7th entry, every nativeEvery entries, at most 5 (each preloads the next)
                            val every = adCfg.nativeEvery.coerceAtLeast(5)
                            if (long && i >= 6 && (i - 6) % every == 0 && (i - 6) / every < 5) {
                                val k = (i - 6) / every
                                NativeAdCard(if (k == 0) "updates" else "updates-$k", s.ad, preloadNext = if (k < 4) "updates-${k + 1}" else null)
                            }
                            UpdateRow(u, hindi, typeName(u.ty), s) { onOpen(u.id) }
                        }
                    }
                    // a short (filtered) list: one native at its end instead
                    if (list.size in 4..9) item(key = "native-end") { NativeAdCard("updates", s.ad) }
                }
            }
        }
    }
}

@Composable
fun SavedScreen(vm: MainViewModel, s: Strings, onOpen: (String) -> Unit) {
    val idx by vm.index.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    // snapshots of saved jobs are files: read them off the main thread (with which ones can be read offline)
    val data by produceState(initialValue = emptyList<com.newsviews.app.data.JobItem>() to emptySet<String>(), idx, settings.saved) {
        value = withContext(Dispatchers.IO) {
            val l = vm.savedJobs(idx, settings.saved)
            l to l.filter { vm.repo.hasOfflineCopy(it.id) }.map { it.id }.toSet()
        }
    }
    val (list, offline) = data
    if (list.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.BookmarkBorder, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(bottom = 12.dp))
            Text(s.noSaved, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
            Text(s.savedHint, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp))
        }
        return
    }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
        items(list, key = { it.id }) { j ->
            JobCard(j, settings.hindi, s, true, onSave = { vm.toggleSaved(j) }, onClick = { onOpen(j.id) },
                applied = j.id in settings.applied, offline = j.id in offline,
                // closed jobs need no "applied" switch (no reminders left to stop); one already marked keeps its badge
                onApplied = if (j.status().isClosed()) null else { { vm.toggleApplied(j) } })
        }
    }
}

@Composable
fun Centered(text: String, action: String? = null, onAction: () -> Unit = {}) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (action != null) TextButton(onClick = onAction) { Text(action) }
    }
}
