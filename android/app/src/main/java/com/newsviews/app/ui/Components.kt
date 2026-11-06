package com.newsviews.app.ui

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.TextButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.newsviews.app.push.Alerts
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.OfflinePin
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.Flag
import androidx.compose.material.icons.outlined.NotificationsNone
import android.widget.Toast
import com.newsviews.app.BuildConfig
import com.newsviews.app.Stats
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.newsviews.app.data.Dates
import com.newsviews.app.data.JobItem
import com.newsviews.app.data.Status
import com.newsviews.app.data.UpdateItem
import com.newsviews.app.data.isNew
import com.newsviews.app.data.status

/** A browser app on the phone (not this app): news-views.in links are verified App Links, so without a browser
    package they would open straight back in the app. */
private fun browserPackage(context: Context): String? {
    CustomTabsClient.getPackageName(context, null)?.let { return it }
    val probe = Intent(Intent.ACTION_VIEW, Uri.parse("https://www.example.com")).addCategory(Intent.CATEGORY_BROWSABLE)
    val pkg = context.packageManager.resolveActivity(probe, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo?.packageName
    return pkg?.takeIf { it != "android" && it != context.packageName }
}

fun openUrl(context: Context, url: String) {
    if (url.isBlank()) return
    val uri = Uri.parse(url)
    val ownSite = uri.host?.let { it == "news-views.in" || it.endsWith(".news-views.in") } == true
    val browser = if (ownSite) browserPackage(context) else null
    try {
        val tabs = CustomTabsIntent.Builder()
            .setDefaultColorSchemeParams(CustomTabColorSchemeParams.Builder().setToolbarColor(Brand.Ink.toArgb()).build())
            .setShowTitle(true)
            .build()
        if (browser != null) tabs.intent.setPackage(browser)
        tabs.launchUrl(context, uri)
    } catch (e: Exception) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, uri).apply { if (browser != null) setPackage(browser) }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {}
    }
}

const val PLAY_LISTING = "https://play.google.com/store/apps/details?id=in.newsviews.app"
/** The app's page on the site: links to Play once the listing is live, so shared messages never break. */
const val APP_PAGE = "https://news-views.in/app/"

/** The app's Play listing in the Play Store app (rating works there), or on the web when Play isn't installed. */
fun openPlayListing(context: Context) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=${context.packageName.removeSuffix(".debug")}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (e: ActivityNotFoundException) {
        openUrl(context, PLAY_LISTING)
    }
}

fun shareText(context: Context, title: String, url: String, footer: String = "", whatsapp: Boolean = false) {
    sendText(context, title, if (footer.isBlank()) "$title\n$url" else "$title\n$url\n\n$footer", whatsapp)
}

/** Opens the share sheet — or WhatsApp directly ([whatsapp], falling back to the share sheet when it isn't installed). */
fun sendText(context: Context, subject: String, text: String, whatsapp: Boolean = false) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, subject)
        putExtra(Intent.EXTRA_TEXT, text)
    }
    if (whatsapp) try {
        context.startActivity(Intent(send).setPackage("com.whatsapp").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return
    } catch (_: ActivityNotFoundException) { } catch (_: SecurityException) { }
    try { context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { }
}

/** Shared links say where they came from (the site's analytics count app shares). */
fun withUtm(url: String): String = if (url.isBlank()) url else url + (if ('?' in url) "&" else "?") + "utm_source=app&utm_medium=share"

/** "<short title>\n<posts> · <qualification> · Last date <d>\n<link>" in the app's language, then the app footer. */
fun jobShareText(item: JobItem, url: String, hindi: Boolean, s: Strings): String {
    val facts = listOfNotNull(
        if (item.v > 0) s.posts(item.v) else null,
        item.q.firstOrNull()?.let { if (hindi) QUAL_HI[it] ?: qualName(it) else qualName(it) },
        item.en.takeIf { it.isNotBlank() }?.let { "${s.lastDate} ${Dates.pretty(it, hindi)}" },
    ).joinToString(" · ")
    return listOf(item.short(hindi), facts, withUtm(url)).filter { it.isNotBlank() }.joinToString("\n") + "\n\n" + s.shareFooter
}

private val EMAIL_RE = Regex("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$")

/** The support address: the feed's "contact" when it looks like an e-mail address, else the site's. */
fun supportEmail(feedContact: String?): String = feedContact?.trim()?.takeIf { EMAIL_RE.matches(it) } ?: "contact@news-views.in"

/** An e-mail draft in the person's mail app (nothing is sent without them). */
fun emailDraft(context: Context, to: String, subject: String, body: String, noApp: String) {
    val uri = Uri.parse("mailto:$to?subject=${Uri.encode(subject)}&body=${Uri.encode(body)}")
    val i = Intent(Intent.ACTION_SENDTO, uri).apply {
        putExtra(Intent.EXTRA_EMAIL, arrayOf(to))
        putExtra(Intent.EXTRA_SUBJECT, subject)
        putExtra(Intent.EXTRA_TEXT, body)
    }.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try { context.startActivity(i) } catch (_: Exception) { Toast.makeText(context, noApp, Toast.LENGTH_LONG).show() }
}

/** "Report a mistake" under a job or result page: an e-mail with the page, app version, feed and a short checklist. */
@Composable
fun ReportMistake(s: Strings, id: String, url: String, contact: String?, feedBuilt: String, kind: String) {
    val ctx = LocalContext.current
    TextButton(onClick = {
        Stats.event(ctx, "report_error", "kind" to kind)
        val to = supportEmail(contact)
        emailDraft(ctx, to, s.x.reportSubject(id), s.x.reportBody(url, BuildConfig.VERSION_NAME, feedBuilt.ifBlank { "-" }), s.x.noEmailApp(to))
    }) {
        Icon(Icons.Outlined.Flag, null); Spacer(Modifier.width(6.dp)); Text(s.x.reportMistake)
    }
}

@Composable
fun Pill(text: String, fg: Color, bg: Color) {
    Text(
        text, color = fg, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, maxLines = 1,
        modifier = Modifier.background(bg, RoundedCornerShape(50)).padding(horizontal = 9.dp, vertical = 3.dp),
    )
}

@Composable
fun Pill(text: String, c: PillColors) { Pill(text, c.fg, c.bg) }

@Composable
fun StatusPill(job: JobItem, s: Strings) {
    val d = Dates.daysLeft(job.en)
    when (job.status()) {
        Status.CLOSED -> Pill(s.closed, Pills.red())
        Status.CANCELLED -> Pill(s.x.cancelled, Pills.red())
        Status.POSTPONED -> Pill(s.x.postponed, Pills.saffron())
        Status.SOON -> Pill(when (d) { 0L -> s.lastDayToday; 1L -> s.closesTomorrow; else -> s.daysLeft(d ?: 0) }, Pills.saffron())
        Status.OPEN -> Pill(s.open, Pills.green())
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun JobCard(job: JobItem, hindi: Boolean, s: Strings, saved: Boolean, onSave: () -> Unit, onClick: () -> Unit, applied: Boolean = false, offline: Boolean = false,
            onApplied: (() -> Unit)? = null) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.padding(start = 16.dp, top = 4.dp, end = 4.dp, bottom = 12.dp)) {
            // department + badges on the left, bookmark pinned to the right edge
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    if (job.o.isNotBlank()) {
                        Text(job.o, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold,
                            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        Spacer(Modifier.width(8.dp))
                    }
                    if (job.isNew()) Pill(s.new, Color.White, Color(0xFFB84A0E))   // darker saffron: 4.9:1 with white
                    if (job.ok == 1) { Spacer(Modifier.width(6.dp)); Icon(Icons.Filled.Verified, s.verified, tint = Brand.Green, modifier = Modifier.padding(top = 1.dp)) }
                }
                IconButton(onClick = onSave) {
                    Icon(if (saved) Icons.Filled.Bookmark else Icons.Outlined.BookmarkBorder, if (saved) s.unsave else s.save,
                        tint = if (saved) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Text(job.short(hindi), style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(end = 12.dp))
            // the posts, when the short title doesn't already name them
            val post = job.post(hindi)
            if (post.isNotBlank() && !job.short(hindi).contains(post, ignoreCase = true))
                Text(post, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
                    overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp, end = 12.dp))
            Spacer(Modifier.padding(top = 8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(end = 12.dp)) {
                StatusPill(job, s)
                if (job.w == 1) Pill(s.walkIn, Pills.azure())
                if (job.v > 0) Pill(s.posts(job.v), MaterialTheme.colorScheme.onSurface, MaterialTheme.colorScheme.surfaceVariant)
                if (job.en.isNotBlank()) Pill("${s.lastDate} ${Dates.short(job.en, hindi)}", MaterialTheme.colorScheme.onSurfaceVariant, MaterialTheme.colorScheme.surfaceVariant)
                job.q.firstOrNull()?.let { q -> Pill(if (hindi) QUAL_HI[q] ?: q else qualName(q), MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.primaryContainer) }
            }
            // saved jobs: "Applied" (a switch on the Saved tab: it stops the last-date reminders), and readable without network
            if (applied || offline || onApplied != null) Row(Modifier.padding(top = 8.dp, end = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                if (onApplied != null) {
                    androidx.compose.material3.FilterChip(selected = applied, onClick = onApplied, label = { Text(if (applied) s.x.applied else s.x.markApplied) },
                        leadingIcon = if (applied) { { Icon(Icons.Filled.Check, null) } } else null)
                    Spacer(Modifier.width(14.dp))
                } else if (applied) {
                    Icon(Icons.Filled.CheckCircle, null, tint = Pills.green().fg, modifier = Modifier.padding(end = 4.dp))
                    Text(s.x.applied, style = MaterialTheme.typography.labelMedium, color = Pills.green().fg)
                    Spacer(Modifier.width(14.dp))
                }
                if (offline) {
                    Icon(Icons.Filled.OfflinePin, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 4.dp))
                    Text(s.x.availableOffline, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

fun qualName(slug: String) = when (slug) {
    "10th-pass" -> "10th Pass"; "12th-pass" -> "12th Pass"; "graduate" -> "Graduate"
    "engineering-diploma" -> "Engineering / Diploma"; "post-graduate" -> "Post Graduate"; else -> slug
}

/** A result / admit card / answer key / exam date in the Results list. When the notice gives a date (the exam, the
    result…), that date leads ("Exam 28 Nov"); the day it was posted comes second. */
@Composable
fun UpdateRow(u: UpdateItem, hindi: Boolean, typeName: String, s: Strings, onClick: () -> Unit) {
    Card(
        onClick = onClick, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Pill(typeName, Pills.forType(u.ty))
                Spacer(Modifier.width(8.dp))
                if (u.o.isNotBlank()) Text(u.o, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                else Spacer(Modifier.weight(1f))
                val ev = Dates.short(u.ev, hindi)
                if (ev.isNotBlank()) Text("${s.x.evLabel(u.ty)} $ev", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
                else Text(Dates.short(u.d, hindi), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.padding(top = 6.dp))
            Text(u.short(hindi), style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (u.ev.isNotBlank() && u.d.isNotBlank() && u.ev.take(10) != u.d.take(10))
                Text(s.x.posted(Dates.short(u.d, hindi)), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
fun Section(title: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 20.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onBackground)
        Spacer(Modifier.padding(top = 8.dp))
        content()
    }
}

@Composable
fun Bullets(items: List<String>, numbered: Boolean = false) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items.forEachIndexed { i, t ->
            Row {
                Text(if (numbered) "${i + 1}." else "•", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.width(24.dp))
                Text(t, style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

@Composable
fun CalRow(c: com.newsviews.app.ui.CalItem, tracked: Boolean = false, remindLabel: String = "", onRemind: (() -> Unit)? = null, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Row(Modifier.padding(start = 14.dp, top = 10.dp, bottom = 10.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Pill(c.label, Pills.forType(c.type))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(c.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (c.org.isNotBlank()) Text(c.org, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (onRemind != null) RemindBell(tracked, remindLabel, onRemind)
        }
    }
}

/** The "Remind me" bell: filled while a reminder is set. */
@Composable
fun RemindBell(tracked: Boolean, label: String, onClick: () -> Unit) {
    IconButton(onClick = onClick) {
        Icon(if (tracked) Icons.Filled.NotificationsActive else Icons.Outlined.NotificationsNone, label,
            tint = if (tracked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** "Follow SSC" / "Following ✓" — every new job, admit card and result of that department as a notification. */
@Composable
fun FollowChip(org: String, following: Boolean, s: Strings, onClick: () -> Unit) {
    if (org.isBlank()) return
    androidx.compose.material3.FilterChip(
        selected = following, onClick = onClick,
        label = { Text(if (following) s.followingOrg else s.follow(org), maxLines = 1, overflow = TextOverflow.Ellipsis) },
        leadingIcon = { Icon(if (following) Icons.Filled.Check else Icons.Filled.Add, null) },
    )
}

/** The opt-in rewarded-video offer. It says plainly that a video ad will play and what the reward is. Only bonus
    preparation tips sit behind it; notices, dates, eligibility and apply links never do. */
@Composable
fun AdFreeCard(s: Strings, hours: Int, proPrice: String = "", onPro: () -> Unit = {}, onWatch: () -> Unit) {
    com.newsviews.app.LogOnce("pass_offer_view", "list")
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(s.adFreeTitle(hours), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSecondaryContainer)
                    Text(s.adFreeHint, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSecondaryContainer, modifier = Modifier.padding(top = 2.dp))
                }
                Spacer(Modifier.width(12.dp))
                Button(onClick = onWatch) { Text(s.adFreeButton) }
            }
            if (proPrice.isNotBlank()) TextButton(onClick = onPro, modifier = Modifier.padding(top = 2.dp)) { Text(s.orPro(proPrice)) }
        }
    }
}

/** Call the returned function right after a job is saved: if notifications are blocked, it offers to allow them —
    otherwise the last-date reminder the person just asked for could never reach them. */
@Composable
fun rememberReminderPrompt(s: Strings): () -> Unit {
    val ctx = LocalContext.current
    var show by remember { mutableStateOf(false) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    if (show) AlertDialog(
        onDismissRequest = { show = false },
        title = { Text(s.allowReminders) },
        text = { Text(s.allowRemindersHint) },
        confirmButton = {
            TextButton(onClick = {
                show = false
                if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                    ask.launch(Manifest.permission.POST_NOTIFICATIONS)
                else try {
                    ctx.startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, ctx.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                } catch (_: Exception) { }
            }) { Text(s.allow) }
        },
        dismissButton = { TextButton(onClick = { show = false }) { Text(s.later) } },
    )
    return { if (!Alerts.canNotify(ctx)) show = true }
}

/** Related jobs at the end of a page ("More from SSC", "Similar jobs for you"): compact rows, built from the cached index. */
@Composable
fun RelatedJobs(title: String, items: List<JobItem>, hindi: Boolean, s: Strings, onOpen: (String) -> Unit) {
    if (items.isEmpty()) return
    Section(title) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items.forEach { j ->
                Card(onClick = { onOpen(j.id) }, shape = RoundedCornerShape(12.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                        Text(j.short(hindi), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        val meta = listOfNotNull(j.o.ifBlank { null }, if (j.v > 0) s.posts(j.v) else null, j.en.takeIf { it.isNotBlank() }?.let { "${s.lastDate} ${Dates.short(it, hindi)}" })
                        if (meta.isNotEmpty()) Text(meta.joinToString(" · "), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
    }
}

@Composable
fun ChoiceChip(text: String, selected: Boolean, onClick: () -> Unit) {
    androidx.compose.material3.FilterChip(selected = selected, onClick = onClick, label = { Text(text) })
}
