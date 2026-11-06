package com.newsviews.app.ui

import androidx.compose.ui.text.style.TextAlign
import com.newsviews.app.BuildConfig
import com.newsviews.app.data.NotInFeed
import com.newsviews.app.ads.InlineAd
import com.newsviews.app.ads.NativeAdCard
import com.newsviews.app.ads.Ads
import com.newsviews.app.ads.findActivity
import com.newsviews.app.Stats
import com.newsviews.app.play.PlayPrompts
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
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
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
import com.newsviews.app.work.Reminders
import com.newsviews.app.data.Faq
import com.newsviews.app.data.JobDetail
import com.newsviews.app.data.JobItem
import com.newsviews.app.data.Status
import com.newsviews.app.data.UpdateDetail
import com.newsviews.app.data.isClosed
import com.newsviews.app.data.status

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

/** A state's name from the feed (English) in the chosen language. */
private fun stateName(name: String, hindi: Boolean): String =
    if (!hindi) name else com.newsviews.app.data.Builtin.states.firstOrNull { it.name == name }?.let { STATE_HI[it.slug] } ?: name

/** Fees come as text, or as a JSON object of category → amount ({"General":"₹500","SC/ST":"Nil"}) — only the latter is reformatted. */
private fun feeText(raw: String): String {
    val t = raw.trim()
    if (!t.startsWith("{")) return t
    return Regex("\"([^\"]+)\"\\s*:\\s*\"?([^\",}]*)\"?").findAll(t).joinToString(" · ") { "${it.groupValues[1]}: ${it.groupValues[2].trim()}" }.ifBlank { t }
}

/**
 * Loads a page. With [cached], the copy already on the phone shows at once and the feed is asked in the background
 * (stale-while-revalidate): a failed refresh then keeps the cached page instead of an error.
 */
@Composable
internal fun <T> Loader(key: String, load: suspend () -> T, s: Strings, web: String, cached: (suspend () -> T?)? = null, content: @Composable (T) -> Unit) {
    val ctx = LocalContext.current
    var data by remember(key) { mutableStateOf<T?>(null) }
    var failed by remember(key) { mutableStateOf(false) }
    var gone by remember(key) { mutableStateOf(false) }
    var attempt by remember(key) { mutableStateOf(0) }
    LaunchedEffect(key, attempt) {
        failed = false
        if (data == null && cached != null) data = try { cached() } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { null }
        try { data = load() }
        catch (e: kotlinx.coroutines.CancellationException) { throw e }
        catch (e: NotInFeed) { gone = true; failed = true; data = null }
        catch (e: Exception) { if (data == null) failed = true }
    }
    val d = data
    when {
        d != null -> content(d)
        failed -> Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            // not in the app feed any more (an older or retired page): the website still has it, or redirects
            Text(if (gone) s.notInApp else s.couldNotLoad, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            Button(onClick = { openUrl(ctx, web) }, modifier = Modifier.padding(top = 14.dp)) { Text(s.openOnSite) }
            if (!gone) TextButton(onClick = { attempt++ }) { Text(s.retry) }
        }
        else -> Centered(s.loading)
    }
}

/** The red "Applications closed on …" / "Recruitment cancelled" card that replaces the Apply button on a closed job. */
@Composable
private fun ClosedCard(title: String, hint: String, note: String) {
    val c = Pills.red()
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = c.bg), border = BorderStroke(1.dp, c.fg.copy(alpha = .35f)),
        modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = c.fg)
            if (note.isNotBlank()) Text(note, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(top = 6.dp))
            Text(hint, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(top = 6.dp))
        }
    }
}

/** A postponed recruitment: what the official update says, above the (still useful) notice and apply links. */
@Composable
private fun PostponedCard(s: Strings, note: String, link: String) {
    val ctx = LocalContext.current
    val c = Pills.saffron()
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = c.bg), modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
        Column(Modifier.padding(16.dp)) {
            Text(s.x.postponedTitle, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = c.fg)
            Text(note.ifBlank { s.x.postponedHint }, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface, modifier = Modifier.padding(top = 6.dp))
            if (link.isNotBlank()) TextButton(onClick = { openUrl(ctx, link) }) { Text(s.x.officialUpdate) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun JobDetailScreen(vm: MainViewModel, s: Strings, id: String, onOpenJob: (String) -> Unit = {}) {
    val ctx = LocalContext.current
    val settings by vm.settings.collectAsStateWithLifecycle()
    val idx by vm.index.collectAsStateWithLifecycle()
    val hindi = settings.hindi
    val reminderPrompt = rememberReminderPrompt(s)
    // ads: this page shows a fresh native ad from one of two slots and loads the other for the next page
    val adSlot = remember(id) { Ads.detailSlot() }
    LaunchedEffect(adSlot) { Ads.preloadNative(ctx, Ads.otherDetailSlot(adSlot)) }   // shown on the next page: no content URL
    Loader(id, { vm.repo.job(id) }, s, web = "${BuildConfig.SITE}/jobs/$id/", cached = { vm.repo.cachedJob(id) }) { j: JobDetail ->
        val h = if (hindi) j.hi else null
        val item = idx?.jobs?.firstOrNull { it.id == id }
            ?: JobItem(id = j.id, t = j.title, th = j.hi?.title ?: "", o = j.org_short, v = j.total_vacancies, en = j.application_end, pub = j.published,
                ns = j.notice_status, q = j.quals, p = j.post_name, ph = j.hi?.post_name ?: "", x = j.exam_date)
        val saved = id in settings.saved
        val status = item.status()
        val closed = status.isClosed()
        val pageUrl = j.url.ifBlank { "${BuildConfig.SITE}/jobs/$id/" }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(j.org_short.ifBlank { j.organization }, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                FollowChip(j.org_short, settings.follows(j.org_short), s) { vm.toggleFollow(j.org_short) }
            }
            Spacer(Modifier.height(4.dp))
            Text(h?.title?.ifBlank { null } ?: j.title, style = MaterialTheme.typography.titleLarge)
            val org = h?.organization?.ifBlank { null } ?: j.organization
            if (org.isNotBlank() && org != j.org_short) Text(org, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(10.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                StatusPill(item, s)
                if (saved && id in settings.applied) Pill(s.x.applied, Pills.green())
                if (j.verified) Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Verified, null, tint = Brand.Green); Spacer(Modifier.width(4.dp))
                    Text(s.verified, style = MaterialTheme.typography.labelMedium, color = Brand.Green)
                }
            }
            Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), modifier = Modifier.fillMaxWidth().padding(top = 14.dp)) {
                FlowRow(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                    if (j.total_vacancies > 0) Fact(s.postName, "%,d".format(j.total_vacancies))
                    if (j.application_end.isNotBlank()) Fact(s.lastDate, Dates.pretty(j.application_end, hindi))
                    if (j.application_start.isNotBlank()) Fact(s.startDate, Dates.pretty(j.application_start, hindi))
                    s.ageRange(j.age_min, j.age_max).takeIf { it.isNotBlank() }?.let { Fact(s.age, it) }
                    if (j.exam_date.isNotBlank()) Fact(s.examDate, Dates.pretty(j.exam_date, hindi))
                }
            }
            s.x.sourceLine(j.src_host, Dates.pretty(j.upd, hindi)).takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
            }
            // the reader's own age against the limit (date of birth from Alerts › Age & category)
            val age = settings.age(Dates.parse(j.application_end) ?: Dates.today())   // on the last date, the usual cut-off
            if (!closed && age != null && j.age_max > 0) {
                val under = j.age_min > 0 && age < j.age_min
                val fits = !under && age <= j.age_max + settings.relaxation()
                Text(if (fits) s.ageOk(age) else if (under) s.ageUnder(age) else s.ageOver(age), style = MaterialTheme.typography.labelLarge,
                    color = if (fits) Brand.Green else Brand.Saffron, modifier = Modifier.padding(top = 10.dp))
            }
            Spacer(Modifier.height(14.dp))
            val ctaUrl = j.cta_url.ifBlank { j.apply_link.ifBlank { j.official_website } }
            val shareLine = jobShareText(item, pageUrl, hindi, s)
            val onSave = {
                vm.toggleSaved(item)
                // no reminder prompt for a closed job: there is nothing left to remind about
                if (!saved && !closed && settings.reminders && item.en.isNotBlank()) reminderPrompt()
            }
            if (closed) {
                // closed or cancelled: no Apply button — what happened, and the notice for reference only
                if (status == Status.CANCELLED) ClosedCard(s.x.cancelledTitle, s.x.cancelledHint, j.status_note)
                else ClosedCard(Dates.pretty(item.en, hindi).let { if (it.isBlank()) s.x.closedNoDate else s.x.closedOn(it) }, s.x.closedHint, "")
                // never the application page (closed jobs have no Apply button): the cancellation notice, else the official
                // notice, else the organisation's homepage labelled as such, else nothing
                val update = j.status_link.takeIf { status == Status.CANCELLED && it.isNotBlank() }
                val ref = update ?: j.official_notification.ifBlank { j.official_website }
                val refLabel = when {
                    update != null -> s.x.officialUpdate
                    j.official_notification.isNotBlank() -> s.x.noticeRef
                    else -> s.ctaWebsite
                }
                if (ref.isNotBlank()) OutlinedButton(onClick = { Stats.event(ctx, "open_link", "kind" to "closed_notice"); openUrl(ctx, ref) }, modifier = Modifier.fillMaxWidth().padding(top = 10.dp)) {
                    Icon(Icons.Filled.Description, null); Spacer(Modifier.width(8.dp)); Text(refLabel)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    OutlinedButton(onClick = onSave) { Icon(if (saved) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, if (saved) s.unsave else s.save) }
                    OutlinedButton(onClick = { Stats.event(ctx, "share", "kind" to "job"); sendText(ctx, item.short(hindi), shareLine) }) { Icon(Icons.Filled.Share, s.share) }
                }
                // where to go next comes first on a closed job
                idx?.let { ix ->
                    val (sameOrg, similar) = remember(ix, id, settings.states, settings.qual, settings.central) { vm.relatedJobs(ix, item, settings) }
                    RelatedJobs(s.moreFrom(item.o.ifBlank { j.org_short }), sameOrg, hindi, s, onOpenJob)
                    RelatedJobs(s.similarJobs, similar, hindi, s, onOpenJob)
                }
            } else {
                if (status == Status.POSTPONED) PostponedCard(s, j.status_note, j.status_link)
                // the main button says what it really opens (the feed decides: apply page, offline form, walk-in notice, notice or homepage)
                val ctaLabel = when (j.cta) { "apply" -> s.ctaApply; "page" -> s.ctaPage; "form" -> s.ctaForm; "walkin" -> s.ctaWalkin; "email" -> s.ctaEmail; "careers" -> s.ctaCareers; "notice" -> s.ctaNotice; "website" -> s.ctaWebsite; else -> s.apply }
                if (ctaUrl.isNotBlank() && status != Status.POSTPONED) Button(onClick = {
                    Stats.event(ctx, "open_link", "kind" to j.cta.ifBlank { "apply" })
                    PlayPrompts.applyTapped(ctx)
                    openUrl(ctx, ctaUrl)
                }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.AutoMirrored.Filled.OpenInNew, null); Spacer(Modifier.width(8.dp)); Text(ctaLabel)
                }
                if (status != Status.POSTPONED) when (j.cta) { "page" -> s.hintPage; "form" -> s.hintForm; "walkin" -> s.hintWalkin; "email" -> s.hintEmail; "careers" -> s.hintCareers; "website" -> s.hintWebsite; else -> null }?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    if (j.official_notification.isNotBlank() && j.official_notification.trimEnd('/') != ctaUrl.trimEnd('/')) OutlinedButton(onClick = { openUrl(ctx, j.official_notification) }, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Filled.Description, null); Spacer(Modifier.width(6.dp)); Text(s.notification, maxLines = 1)
                    }
                    OutlinedButton(onClick = onSave) { Icon(if (saved) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, if (saved) s.unsave else s.save) }
                    OutlinedButton(onClick = { Stats.event(ctx, "share", "kind" to "job"); sendText(ctx, item.short(hindi), shareLine) }) { Icon(Icons.Filled.Share, s.share) }
                }
                // a saved job: "Applied" stops its last-date reminders
                if (saved) {
                    val applied = id in settings.applied
                    FilterChip(selected = applied, onClick = { vm.toggleApplied(item) }, label = { Text(if (applied) s.x.applied else s.x.markApplied) },
                        leadingIcon = if (applied) { { Icon(Icons.Filled.Check, null) } } else null, modifier = Modifier.padding(top = 6.dp))
                    if (applied) Text(s.x.appliedHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            TextButton(onClick = { Stats.event(ctx, "share", "kind" to "job_whatsapp"); sendText(ctx, item.short(hindi), shareLine, whatsapp = true) }) { Text(s.x.whatsapp) }
            val summary = h?.summary?.ifBlank { null } ?: j.summary
            if (summary.isNotBlank()) Section(s.summary) { Text(summary, style = MaterialTheme.typography.bodyLarge) }
            InlineAd(s.ad, contentUrl = pageUrl)
            val overview = h?.overview?.ifEmpty { null } ?: j.overview
            if (overview.isNotEmpty()) Section(s.details) { Bullets(overview) }
            // each fact in Hindi when the enrichment translated it, else as the notice gives it
            fun hiOr(hv: String?, en: String) = hv?.ifBlank { null } ?: en
            val location = hiOr(h?.location, j.location)
            val facts = listOfNotNull(
                hiOr(h?.qualification, j.qualification).takeIf { it.isNotBlank() }?.let { s.qualification to it },
                hiOr(h?.salary, j.salary).takeIf { it.isNotBlank() }?.let { s.salary to it },
                hiOr(h?.fee, j.fee).takeIf { it.isNotBlank() && it != "{}" }?.let { s.fee to feeText(it) },
                location.takeIf { it.isNotBlank() }?.let { s.location to it },
                j.states.takeIf { it.isNotEmpty() && location.isBlank() }?.let { st -> s.location to st.joinToString(", ") { stateName(it, hindi) } },
                hiOr(h?.post_name, j.post_name).takeIf { it.isNotBlank() }?.let { s.postName to it },
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
            if (!closed && how.isNotEmpty()) Section(s.howToApply) { Bullets(how, numbered = true) }
            // bonus content: preparation tips come with the pass (one rewarded video). Never gated when no rewarded ad is
            // set up or the person already holds a pass; the notice, apply link and everything above stay free always.
            val tips = h?.preparation_tips?.ifEmpty { null } ?: j.preparation_tips
            if (tips.isNotEmpty()) Section(s.prepTips) {
                val adCfg by Ads.config.collectAsStateWithLifecycle()
                val rewardedReady by Ads.rewardedReady.collectAsStateWithLifecycle()
                val proPrice by com.newsviews.app.play.Billing.price.collectAsStateWithLifecycle()
                val isPro by Ads.pro.collectAsStateWithLifecycle()
                val adsOff = Ads.adsOff()
                // locked only while a video is actually loaded: with no video to offer, the tips are simply shown
                val gated = BuildConfig.ADS && adCfg.on && adCfg.rewarded && BuildConfig.AD_REWARDED.isNotBlank() && !adsOff && rewardedReady
                // Pro is offered whenever Play has a price for it — whether or not a video happens to be loaded
                val proOffer = BuildConfig.ADS && adCfg.on && adCfg.pro && proPrice.isNotBlank() && !isPro
                if (!gated) {
                    Bullets(tips)
                    if (proOffer && !adsOff) TextButton(onClick = { ctx.findActivity()?.let { com.newsviews.app.play.Billing.buy(it, "tips") } }) { Text(s.orPro(proPrice)) }
                } else Card(shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp)) {
                        Text(s.prepLocked(adCfg.rewardHours.coerceIn(1, 24 * 7)), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSecondaryContainer)
                        com.newsviews.app.LogOnce("tips_gate_view", "tips")
                        Button(onClick = { ctx.findActivity()?.let { Ads.showRewarded(it, "tips") } }, enabled = rewardedReady, modifier = Modifier.padding(top = 10.dp)) {
                            Text(if (rewardedReady) s.adFreeButton else s.adFreeLoading)
                        }
                        if (proOffer) TextButton(onClick = { ctx.findActivity()?.let { com.newsviews.app.play.Billing.buy(it, "tips") } }) { Text(s.orPro(proPrice)) }
                    }
                }
            }
            val faq = h?.faq?.ifEmpty { null } ?: j.faq
            if (faq.isNotEmpty()) Section(s.faq) { FaqList(faq) }
            // the end of the page: one native ad (far from the Apply and Notification buttons), then where to go next
            NativeAdCard(adSlot, s.ad, Modifier.padding(top = 22.dp))
            if (!closed) idx?.let { ix ->
                val (sameOrg, similar) = remember(ix, id, settings.states, settings.qual, settings.central) { vm.relatedJobs(ix, item, settings) }
                RelatedJobs(s.moreFrom(item.o.ifBlank { j.org_short }), sameOrg, hindi, s, onOpenJob)
                RelatedJobs(s.similarJobs, similar, hindi, s, onOpenJob)
            }
            Row(Modifier.padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { openUrl(ctx, pageUrl) }) { Text(s.openOnSite) }
            }
            ReportMistake(s, id, pageUrl, idx?.contact, idx?.built ?: "", "job")
            Text(s.disclaimer, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(24.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun UpdateDetailScreen(vm: MainViewModel, s: Strings, id: String, onOpenJob: (String) -> Unit = {}) {
    val ctx = LocalContext.current
    val settings by vm.settings.collectAsStateWithLifecycle()
    val idx by vm.index.collectAsStateWithLifecycle()
    val hindi = settings.hindi
    val adSlot = remember(id) { Ads.detailSlot() }
    LaunchedEffect(adSlot) { Ads.preloadNative(ctx, Ads.otherDetailSlot(adSlot)) }   // shown on the next page: no content URL
    Loader(id, { vm.repo.update(id) }, s, web = "${BuildConfig.SITE}/updates/$id/", cached = { vm.repo.cachedUpdate(id) }) { u: UpdateDetail ->
        val h = if (hindi) u.hi else null
        val item = idx?.updates?.firstOrNull { it.id == id }
        val pageUrl = u.url.ifBlank { "${BuildConfig.SITE}/updates/$id/" }
        val shortTitle = item?.short(hindi) ?: (h?.title?.ifBlank { null } ?: u.title)
        val typeLabel = if (hindi) TYPE_HI[u.type] ?: u.type_name else u.type_name
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Pill(typeLabel, Pills.forType(u.type))
                Spacer(Modifier.width(8.dp))
                Text(listOf(u.org_short, Dates.pretty(u.date, hindi)).filter { it.isNotBlank() }.joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (u.org_short.isNotBlank()) Row(Modifier.padding(top = 6.dp)) {
                FollowChip(u.org_short, settings.follows(u.org_short), s) { vm.toggleFollow(u.org_short) }
            }
            Spacer(Modifier.height(8.dp))
            Text(h?.title?.ifBlank { null } ?: u.title, style = MaterialTheme.typography.titleLarge)
            // the dates the notice gives, above the official link
            val ev = u.event_date.take(10)
            if (ev.isNotBlank() || u.exam_name.isNotBlank() || u.date.isNotBlank()) Card(shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), modifier = Modifier.fillMaxWidth().padding(top = 14.dp)) {
                FlowRow(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                    if (ev.isNotBlank() && ev != u.date.take(10)) Fact(if (u.type == "exam-date") s.x.eventDateExam else s.x.eventDateOther, Dates.pretty(ev, hindi))
                    if (u.date.isNotBlank()) Fact(s.x.published, Dates.pretty(u.date, hindi))
                    if (u.exam_name.isNotBlank()) Fact(s.x.examName, u.exam_name)
                }
            }
            s.x.sourceLine(u.src_host, Dates.pretty(u.upd, hindi)).takeIf { it.isNotBlank() }?.let {
                Text(it, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
            }
            // "Remind me": the evening before and the morning of the date in the notice
            if (ev.length == 10 && Reminders.canRemind(ev)) {
                val key = "u:$id"
                val tracked = key in settings.tracked
                OutlinedButton(onClick = { vm.toggleTracked(key, shortTitle, s.x.typeLabel(u.type), ev) }, modifier = Modifier.fillMaxWidth().padding(top = 10.dp)) {
                    Icon(if (tracked) Icons.Filled.NotificationsActive else Icons.Outlined.NotificationsNone, null); Spacer(Modifier.width(8.dp))
                    Text(if (tracked) s.x.reminderOn else s.x.remindMe)
                }
                if (tracked) Text(s.x.remindHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            }
            Spacer(Modifier.height(14.dp))
            val link = u.official_link.ifBlank { u.official_website.ifBlank { u.link } }
            if (link.isNotBlank()) Button(onClick = { Stats.event(ctx, "open_link", "kind" to "update"); openUrl(ctx, link) }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.AutoMirrored.Filled.OpenInNew, null); Spacer(Modifier.width(8.dp)); Text(s.website)
            }
            val dateText = (if (ev.isNotBlank()) "${s.x.evLabel(u.type)} ${Dates.pretty(ev, hindi)}" else Dates.pretty(u.date, hindi))
            val shareLine = listOf(shortTitle, listOf(typeLabel, dateText).filter { it.isNotBlank() }.joinToString(" · "), withUtm(pageUrl)).joinToString("\n") + "\n\n" + s.shareFooter
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                OutlinedButton(onClick = { Stats.event(ctx, "share", "kind" to "update"); sendText(ctx, shortTitle, shareLine) }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Filled.Share, null); Spacer(Modifier.width(8.dp)); Text(s.share)
                }
                OutlinedButton(onClick = { Stats.event(ctx, "share", "kind" to "update_whatsapp"); sendText(ctx, shortTitle, shareLine, whatsapp = true) }, modifier = Modifier.weight(1f)) {
                    Text(s.x.whatsapp)
                }
            }
            val summary = h?.summary?.ifBlank { null } ?: u.summary
            if (summary.isNotBlank()) Section(s.summary) { Text(summary, style = MaterialTheme.typography.bodyLarge) }
            InlineAd(s.ad, contentUrl = pageUrl)
            val steps = h?.steps?.ifEmpty { null } ?: u.steps
            if (steps.isNotEmpty()) Section(s.steps) { Bullets(steps, numbered = true) }
            val details = h?.details?.ifEmpty { null } ?: u.details
            if (details.isNotEmpty()) Section(s.details) { Bullets(details) }
            val faq = h?.faq?.ifEmpty { null } ?: u.faq
            if (faq.isNotEmpty()) Section(s.faq) { FaqList(faq) }
            NativeAdCard(adSlot, s.ad, Modifier.padding(top = 22.dp))
            // open jobs of the same department (a result page is often read by people waiting for the next recruitment)
            val org = u.org_short
            val sameOrg = remember(idx, org) { if (org.isBlank()) emptyList() else idx?.jobs?.filter { it.o == org && !it.status().isClosed() }?.take(3) ?: emptyList() }
            RelatedJobs(s.moreFrom(org), sameOrg, hindi, s, onOpenJob)
            TextButton(onClick = { openUrl(ctx, pageUrl) }, modifier = Modifier.padding(top = 16.dp)) { Text(s.openOnSite) }
            ReportMistake(s, id, pageUrl, idx?.contact, idx?.built ?: "", "update")
            Text(s.disclaimer, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(24.dp))
        }
    }
}
