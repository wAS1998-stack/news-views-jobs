package com.newsviews.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.outlined.BookmarkBorder
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
import com.newsviews.app.data.AppIndex
import com.newsviews.app.data.Builtin
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun JobsScreen(vm: MainViewModel, s: Strings, onOpen: (String) -> Unit) {
    val idx by vm.index.collectAsStateWithLifecycle()
    val loading by vm.loading.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val f by vm.filters.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val hindi = settings.hindi
    val list = remember(idx, f, settings) { idx?.let { vm.visibleJobs(it, f, settings) } ?: emptyList() }
    val listState = rememberLazyListState()
    var dobDialog by remember { mutableStateOf(false) }
    if (dobDialog) DobDialog(s, settings.dob, onDismiss = { dobDialog = false }) { iso -> vm.setDob(iso); vm.setFilters(f.copy(ageFits = true)); dobDialog = false }

    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = f.query, onValueChange = { vm.setFilters(f.copy(query = it)) },
            placeholder = { Text(s.search) }, singleLine = true,
            leadingIcon = { Icon(Icons.Filled.Search, null) },
            trailingIcon = { if (f.query.isNotEmpty()) IconButton(onClick = { vm.setFilters(f.copy(query = "")) }) { Icon(Icons.Filled.Clear, null) } },
            shape = RoundedCornerShape(14.dp),
            colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = MaterialTheme.colorScheme.surface, focusedContainerColor = MaterialTheme.colorScheme.surface),
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        )
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
            item {
                val st = (idx?.states ?: Builtin.states).firstOrNull { it.slug == f.state }
                Dropdown(if (st == null) s.allStates else if (hindi) STATE_HI[st.slug] ?: st.name else st.name, st != null, idx?.states ?: Builtin.states,
                    { vm.setFilters(f.copy(state = it)) }, s.allStates, STATE_HI, hindi)
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
        StatusLine(idx, error, s, hindi, if (idx != null) list.size else null) { vm.refresh() }
        PullToRefreshBox(isRefreshing = loading, onRefresh = { vm.refresh() }, modifier = Modifier.fillMaxSize()) {
            when {
                idx == null && loading -> Centered(s.loading)
                idx == null -> Centered(s.couldNotLoad, s.retry) { vm.refresh() }
                list.isEmpty() -> Centered(s.noMatch)
                else -> LazyColumn(state = listState, contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
                    items(list, key = { it.id }) { j ->
                        JobCard(j, hindi, s, j.id in settings.saved, onSave = { vm.toggleSaved(j) }, onClick = { onOpen(j.id) })
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UpdatesScreen(vm: MainViewModel, s: Strings, onOpen: (String) -> Unit) {
    val idx by vm.index.collectAsStateWithLifecycle()
    val loading by vm.loading.collectAsStateWithLifecycle()
    val error by vm.error.collectAsStateWithLifecycle()
    val f by vm.filters.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val hindi = settings.hindi
    val list = remember(idx, f.updateType, f.updateFollowing, settings.follows) {
        idx?.updates?.filter { (f.updateType.isEmpty() || it.ty == f.updateType) && (!f.updateFollowing || settings.follows(it.o)) } ?: emptyList()
    }
    val typeName = { slug: String -> if (hindi) TYPE_HI[slug] ?: slug else idx?.types?.firstOrNull { it.slug == slug }?.name?.removeSuffix("s") ?: slug }

    Column(Modifier.fillMaxSize()) {
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item { FilterChip(selected = f.updateType.isEmpty(), onClick = { vm.setFilters(f.copy(updateType = "")) }, label = { Text(s.allTypes) }) }
            if (settings.follows.isNotEmpty()) item {
                FilterChip(selected = f.updateFollowing, onClick = { vm.setFilters(f.copy(updateFollowing = !f.updateFollowing)) },
                    label = { Text(s.following) }, leadingIcon = { Icon(Icons.Filled.Star, null) })
            }
            items(idx?.types ?: Builtin.types) { t ->
                FilterChip(selected = f.updateType == t.slug, onClick = { vm.setFilters(f.copy(updateType = t.slug)) },
                    label = { Text(if (hindi) TYPE_HI[t.slug] ?: t.name else t.name) })
            }
        }
        StatusLine(idx, error, s, hindi, null) { vm.refresh() }
        PullToRefreshBox(isRefreshing = loading, onRefresh = { vm.refresh() }, modifier = Modifier.fillMaxSize()) {
            when {
                idx == null && loading -> Centered(s.loading)
                idx == null -> Centered(s.couldNotLoad, s.retry) { vm.refresh() }
                else -> LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
                    items(list, key = { it.id }) { u -> UpdateRow(u, hindi, typeName(u.ty)) { onOpen(u.id) } }
                }
            }
        }
    }
}

@Composable
fun SavedScreen(vm: MainViewModel, s: Strings, onOpen: (String) -> Unit) {
    val idx by vm.index.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val list = remember(idx, settings.saved) { vm.savedJobs(idx, settings.saved) }
    if (list.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.BookmarkBorder, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(bottom = 12.dp))
            Text(s.noSaved, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
            Text(s.savedHint, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp))
        }
        return
    }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
        items(list, key = { it.id }) { j -> JobCard(j, settings.hindi, s, true, onSave = { vm.toggleSaved(j) }, onClick = { onOpen(j.id) }) }
    }
}

@Composable
fun Centered(text: String, action: String? = null, onAction: () -> Unit = {}) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (action != null) TextButton(onClick = onAction) { Text(action) }
    }
}
