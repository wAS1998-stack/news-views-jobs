package com.newsviews.app.ui

import com.newsviews.app.ads.InlineAd
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.newsviews.app.data.Dates
import com.newsviews.app.data.Faq
import com.newsviews.app.data.JobDetail
import com.newsviews.app.data.JobItem
import com.newsviews.app.data.UpdateDetail

@Composable
private fun Fact(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier.padding(vertical = 6.dp)) {
        Text(label.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun FaqList(faqs: List<Faq>) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        faqs.forEach { f ->
            var open by rememberSaveable(f.q) { mutableStateOf(false) }
            Card(shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), modifier = Modifier.fillMaxWidth().clickable { open = !open }) {
                Column(Modifier.padding(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(f.q, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        Icon(if (open) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore, null)
                    }
                    if (open) Text(f.a, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp))
                }
            }
        }
    }
}

@Composable
private fun <T> Loader(key: String, load: suspend () -> T, s: Strings, content: @Composable (T) -> Unit) {
    var data by remember(key) { mutableStateOf<T?>(null) }
    var failed by remember(key) { mutableStateOf(false) }
    var attempt by remember(key) { mutableStateOf(0) }
    LaunchedEffect(key, attempt) {
        failed = false
        try { data = load() } catch (e: Exception) { failed = true }
    }
    val d = data
    when {
        d != null -> content(d)
        failed -> Centered(s.couldNotLoad, s.retry) { attempt++ }
        else -> Centered(s.loading)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun JobDetailScreen(vm: MainViewModel, s: Strings, id: String) {
    val ctx = LocalContext.current
    val settings by vm.settings.collectAsStateWithLifecycle()
    val idx by vm.index.collectAsStateWithLifecycle()
    val hindi = settings.hindi
    Loader(id, { vm.repo.job(id) }, s) { j: JobDetail ->
        val h = if (hindi) j.hi else null
        val item = idx?.jobs?.firstOrNull { it.id == id } ?: JobItem(id = j.id, t = j.title, th = j.hi?.title ?: "", o = j.org_short, v = j.total_vacancies, en = j.application_end, pub = j.published)
        val saved = id in settings.saved
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(j.org_short.ifBlank { j.organization }, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                FollowChip(j.org_short, settings.follows(j.org_short), s) { vm.toggleFollow(j.org_short) }
            }
            Spacer(Modifier.height(4.dp))
            Text(h?.title?.ifBlank { null } ?: j.title, style = MaterialTheme.typography.titleLarge)
            if (j.organization.isNotBlank() && j.organization != j.org_short) Text(j.organization, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(10.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                StatusPill(item, s)
                if (j.verified) Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Verified, null, tint = Brand.Green); Spacer(Modifier.width(4.dp))
                    Text(s.verified, style = MaterialTheme.typography.labelMedium, color = Brand.Green)
                }
            }
            Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), modifier = Modifier.fillMaxWidth().padding(top = 14.dp)) {
                FlowRow(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                    if (j.total_vacancies > 0) Fact(s.postName, "%,d".format(j.total_vacancies))
                    if (j.application_end.isNotBlank()) Fact(s.lastDate, Dates.pretty(j.application_end))
                    if (j.application_start.isNotBlank()) Fact(s.startDate, Dates.pretty(j.application_start))
                    s.ageRange(j.age_min, j.age_max).takeIf { it.isNotBlank() }?.let { Fact(s.age, it) }
                    if (j.exam_date.isNotBlank()) Fact(s.examDate, Dates.pretty(j.exam_date))
                }
            }
            // the reader's own age against the limit (date of birth from Alerts › Age & category)
            val age = settings.age()
            if (age != null && j.age_max > 0) {
                val under = j.age_min > 0 && age < j.age_min
                val fits = !under && age <= j.age_max + settings.relaxation()
                Text(if (fits) s.ageOk(age) else if (under) s.ageUnder(age) else s.ageOver(age), style = MaterialTheme.typography.labelLarge,
                    color = if (fits) Brand.Green else Brand.Saffron, modifier = Modifier.padding(top = 10.dp))
            }
            Spacer(Modifier.height(14.dp))
            // the main button says what it really opens (the feed decides: apply page, offline form, walk-in notice, notice or homepage)
            val ctaUrl = j.cta_url.ifBlank { j.apply_link.ifBlank { j.official_website } }
            val ctaLabel = when (j.cta) { "apply" -> s.ctaApply; "page" -> s.ctaPage; "form" -> s.ctaForm; "walkin" -> s.ctaWalkin; "email" -> s.ctaEmail; "careers" -> s.ctaCareers; "notice" -> s.ctaNotice; "website" -> s.ctaWebsite; else -> s.apply }
            if (ctaUrl.isNotBlank()) Button(onClick = { openUrl(ctx, ctaUrl) }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.AutoMirrored.Filled.OpenInNew, null); Spacer(Modifier.width(8.dp)); Text(ctaLabel)
            }
            when (j.cta) { "page" -> s.hintPage; "form" -> s.hintForm; "walkin" -> s.hintWalkin; "email" -> s.hintEmail; "careers" -> s.hintCareers; "website" -> s.hintWebsite; else -> null }?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                if (j.official_notification.isNotBlank() && j.official_notification.trimEnd('/') != ctaUrl.trimEnd('/')) OutlinedButton(onClick = { openUrl(ctx, j.official_notification) }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Filled.Description, null); Spacer(Modifier.width(6.dp)); Text(s.notification, maxLines = 1)
                }
                OutlinedButton(onClick = { vm.toggleSaved(item) }) { Icon(if (saved) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, if (saved) s.unsave else s.save) }
                OutlinedButton(onClick = { shareText(ctx, j.title, j.url) }) { Icon(Icons.Filled.Share, s.share) }
            }
            val summary = h?.summary?.ifBlank { null } ?: j.summary
            if (summary.isNotBlank()) Section(s.summary) { Text(summary, style = MaterialTheme.typography.bodyLarge) }
            InlineAd(s.ad)
            val overview = h?.overview?.ifEmpty { null } ?: j.overview
            if (overview.isNotEmpty()) Section(s.details) { Bullets(overview) }
            val facts = listOfNotNull(
                j.qualification.takeIf { it.isNotBlank() }?.let { s.qualification to it },
                j.salary.takeIf { it.isNotBlank() }?.let { s.salary to it },
                j.fee.takeIf { it.isNotBlank() && it != "{}" }?.let { s.fee to it.replace(Regex("[{}\"]"), "").replace(",", ", ").replace(":", ": ") },
                j.location.takeIf { it.isNotBlank() }?.let { s.location to it },
                j.post_name.takeIf { it.isNotBlank() }?.let { s.postName to it },
            )
            val elig = h?.eligibility_notes?.ifBlank { null } ?: j.eligibility_notes
            if (facts.isNotEmpty() || elig.isNotBlank()) Section(s.eligibility) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    facts.forEach { (k, v) -> Column { Text(k, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(v, style = MaterialTheme.typography.bodyLarge) } }
                    if (elig.isNotBlank()) Text(elig, style = MaterialTheme.typography.bodyLarge)
                }
            }
            val sel = h?.selection_process?.ifEmpty { null } ?: j.selection_process
            if (sel.isNotEmpty()) Section(s.selection) { Bullets(sel) }
            val how = h?.how_to_apply?.ifEmpty { null } ?: j.how_to_apply
            if (how.isNotEmpty()) Section(s.howToApply) { Bullets(how, numbered = true) }
            val faq = h?.faq?.ifEmpty { null } ?: j.faq
            if (faq.isNotEmpty()) Section(s.faq) { FaqList(faq) }
            TextButton(onClick = { openUrl(ctx, j.url) }, modifier = Modifier.padding(top = 16.dp)) { Text(s.openOnSite) }
            Text(s.disclaimer, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
fun UpdateDetailScreen(vm: MainViewModel, s: Strings, id: String) {
    val ctx = LocalContext.current
    val settings by vm.settings.collectAsStateWithLifecycle()
    val hindi = settings.hindi
    Loader(id, { vm.repo.update(id) }, s) { u: UpdateDetail ->
        val h = if (hindi) u.hi else null
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 12.dp)) {
            val c = when (u.type) { "result" -> Brand.Green; "admit-card" -> Brand.Azure; "answer-key" -> Brand.Saffron; else -> Brand.Muted }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Pill(if (hindi) TYPE_HI[u.type] ?: u.type_name else u.type_name, c, c.copy(alpha = .12f))
                Spacer(Modifier.width(8.dp))
                Text(listOf(u.org_short, Dates.pretty(u.date)).filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (u.org_short.isNotBlank()) Row(Modifier.padding(top = 6.dp)) {
                FollowChip(u.org_short, settings.follows(u.org_short), s) { vm.toggleFollow(u.org_short) }
            }
            Spacer(Modifier.height(8.dp))
            Text(h?.title?.ifBlank { null } ?: u.title, style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(14.dp))
            val link = u.official_link.ifBlank { u.official_website.ifBlank { u.link } }
            if (link.isNotBlank()) Button(onClick = { openUrl(ctx, link) }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.AutoMirrored.Filled.OpenInNew, null); Spacer(Modifier.width(8.dp)); Text(s.website)
            }
            OutlinedButton(onClick = { shareText(ctx, u.title, u.url) }, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Icon(Icons.Filled.Share, null); Spacer(Modifier.width(8.dp)); Text(s.share)
            }
            val summary = h?.summary?.ifBlank { null } ?: u.summary
            if (summary.isNotBlank()) Section(s.summary) { Text(summary, style = MaterialTheme.typography.bodyLarge) }
            InlineAd(s.ad)
            val steps = h?.steps?.ifEmpty { null } ?: u.steps
            if (steps.isNotEmpty()) Section(s.steps) { Bullets(steps, numbered = true) }
            val details = h?.details?.ifEmpty { null } ?: u.details
            if (details.isNotEmpty()) Section(s.details) { Bullets(details) }
            val faq = h?.faq?.ifEmpty { null } ?: u.faq
            if (faq.isNotEmpty()) Section(s.faq) { FaqList(faq) }
            TextButton(onClick = { openUrl(ctx, u.url) }, modifier = Modifier.padding(top = 16.dp)) { Text(s.openOnSite) }
            Text(s.disclaimer, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(24.dp))
        }
    }
}
