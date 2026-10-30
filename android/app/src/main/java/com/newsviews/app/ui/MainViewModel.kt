package com.newsviews.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.newsviews.app.data.AppIndex
import com.newsviews.app.data.JobItem
import com.newsviews.app.data.Prefs
import com.newsviews.app.data.Qual
import com.newsviews.app.data.Repository
import com.newsviews.app.data.Settings
import com.newsviews.app.data.Status
import com.newsviews.app.data.status
import com.newsviews.app.push.Alerts
import com.newsviews.app.work.Reminders
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class Filters(val query: String = "", val state: String = "", val qual: String = "", val closingSoon: Boolean = false, val updateType: String = "")

class MainViewModel(app: Application) : AndroidViewModel(app) {
    val repo = Repository(app)
    val prefs = Prefs(app)

    private val _index = MutableStateFlow<AppIndex?>(repo.cachedIndex())
    val index: StateFlow<AppIndex?> = _index.asStateFlow()
    private val _loading = MutableStateFlow(false)
    val loading: StateFlow<Boolean> = _loading.asStateFlow()
    private val _error = MutableStateFlow(false)
    val error: StateFlow<Boolean> = _error.asStateFlow()
    private val _filters = MutableStateFlow(Filters())
    val filters: StateFlow<Filters> = _filters.asStateFlow()

    val settings: StateFlow<Settings> = prefs.flow.stateIn(viewModelScope, SharingStarted.Eagerly, Settings())
    /** false until the saved settings have been read (avoids flashing the welcome screen). */
    val settingsLoaded: StateFlow<Boolean> = prefs.flow.map { true }.stateIn(viewModelScope, SharingStarted.Eagerly, false)

    init { refresh() }

    private var lastOk = 0L

    /** Downloads the feed; retries a few times (a phone that has just woken up often has no network yet). */
    fun refresh() {
        if (_loading.value) return
        viewModelScope.launch {
            _loading.value = true
            try {
                for (attempt in 0 until 3) {
                    try {
                        _index.value = repo.fetchIndex()
                        _error.value = false
                        lastOk = System.currentTimeMillis()
                        break
                    } catch (e: Exception) {
                        _error.value = true
                        if (attempt < 2) delay(if (attempt == 0) 2000L else 5000L)
                    }
                }
            } finally {
                _loading.value = false
            }
        }
    }

    /** Coming back to the app: refresh if the data is more than 10 minutes old or the last try failed. */
    fun refreshIfStale() {
        if (_error.value || System.currentTimeMillis() - lastOk > 10 * 60 * 1000) refresh()
    }

    fun setFilters(f: Filters) { _filters.value = f }

    fun visibleJobs(idx: AppIndex, f: Filters): List<JobItem> {
        val words = f.query.lowercase().split(' ').filter { it.isNotBlank() }
        return idx.jobs.filter { j ->
            (f.state.isEmpty() || f.state in j.s) &&
                (f.qual.isEmpty() || f.qual in j.q) &&
                (!f.closingSoon || j.status() == Status.SOON) &&
                (words.isEmpty() || words.all { w -> "${j.t} ${j.th} ${j.o} ${j.p}".lowercase().contains(w) })
        }
    }

    fun toggleSaved(item: JobItem) {
        viewModelScope.launch {
            val now = prefs.toggleSaved(item.id)
            val ctx = getApplication<Application>()
            if (now) {
                repo.saveSnapshot(item)
                if (settings.value.reminders) Reminders.schedule(ctx, item.id, item.title(settings.value.hindi), item.en)
            } else {
                repo.dropSnapshot(item.id)
                Reminders.cancel(ctx, item.id)
            }
        }
    }

    fun savedJobs(idx: AppIndex?, saved: Set<String>): List<JobItem> {
        val live = idx?.jobs?.associateBy { it.id } ?: emptyMap()
        return saved.mapNotNull { live[it] ?: repo.savedSnapshot(it) }.sortedWith(compareBy({ it.status() == Status.CLOSED }, { it.en.ifEmpty { "9999" } }))
    }

    private fun resync() = viewModelScope.launch { Alerts.sync(getApplication(), prefs) }

    fun setHindi(v: Boolean) = viewModelScope.launch { prefs.setHindi(v); Alerts.sync(getApplication(), prefs) }
    fun setAlerts(v: Boolean) = viewModelScope.launch { prefs.setAlerts(v); Alerts.sync(getApplication(), prefs) }
    fun setResults(v: Boolean) = viewModelScope.launch { prefs.setResults(v); Alerts.sync(getApplication(), prefs) }
    fun setReminders(v: Boolean) = viewModelScope.launch { prefs.setReminders(v) }
    fun setQual(q: Qual) = viewModelScope.launch { prefs.setQual(q); Alerts.sync(getApplication(), prefs) }
    fun toggleState(slug: String) = viewModelScope.launch {
        val cur = settings.value.states
        prefs.setStates(if (slug in cur) cur - slug else cur + slug)
        Alerts.sync(getApplication(), prefs)
    }
    fun clearStates() = viewModelScope.launch { prefs.setStates(emptySet()); Alerts.sync(getApplication(), prefs) }
    fun finishOnboarding() = viewModelScope.launch { prefs.setOnboarded(); Alerts.sync(getApplication(), prefs) }
    fun syncAlerts() { resync() }
}
