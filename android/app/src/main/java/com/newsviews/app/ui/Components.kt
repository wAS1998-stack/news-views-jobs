package com.newsviews.app.ui

import android.content.ActivityNotFoundException
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
import androidx.compose.material.icons.outlined.BookmarkBorder
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

fun shareText(context: Context, title: String, url: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, title)
        putExtra(Intent.EXTRA_TEXT, "$title\n$url")
    }
    context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

@Composable
fun Pill(text: String, fg: Color, bg: Color) {
    Text(
        text, color = fg, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, maxLines = 1,
        modifier = Modifier.background(bg, RoundedCornerShape(50)).padding(horizontal = 9.dp, vertical = 3.dp),
    )
}

@Composable
fun StatusPill(job: JobItem, s: Strings) {
    val d = Dates.daysLeft(job.en)
    when (job.status()) {
        Status.CLOSED -> Pill(s.closed, Brand.Red, Brand.Red.copy(alpha = .10f))
        Status.SOON -> Pill(when (d) { 0L -> s.lastDayToday; 1L -> s.closesTomorrow; else -> s.daysLeft(d ?: 0) }, Brand.Saffron, Brand.Saffron.copy(alpha = .14f))
        Status.OPEN -> Pill(s.open, Brand.Green, Brand.Green.copy(alpha = .12f))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun JobCard(job: JobItem, hindi: Boolean, s: Strings, saved: Boolean, onSave: () -> Unit, onClick: () -> Unit) {
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
            if (job.p.isNotBlank() && !job.short(hindi).contains(job.p, ignoreCase = true))
                Text(job.p, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
                    overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp, end = 12.dp))
            Spacer(Modifier.padding(top = 8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(end = 12.dp)) {
                StatusPill(job, s)
                if (job.w == 1) Pill(s.walkIn, Brand.Azure, Brand.Azure.copy(alpha = .12f))
                if (job.v > 0) Pill(s.posts(job.v), MaterialTheme.colorScheme.onSurface, MaterialTheme.colorScheme.surfaceVariant)
                if (job.en.isNotBlank()) Pill("${s.lastDate} ${Dates.short(job.en)}", MaterialTheme.colorScheme.onSurfaceVariant, MaterialTheme.colorScheme.surfaceVariant)
                job.q.firstOrNull()?.let { q -> Pill(if (hindi) QUAL_HI[q] ?: q else qualName(q), MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.primaryContainer) }
            }
        }
    }
}

fun qualName(slug: String) = when (slug) {
    "10th-pass" -> "10th Pass"; "12th-pass" -> "12th Pass"; "graduate" -> "Graduate"
    "engineering-diploma" -> "Engineering / Diploma"; "post-graduate" -> "Post Graduate"; else -> slug
}

@Composable
fun UpdateRow(u: UpdateItem, hindi: Boolean, typeName: String, onClick: () -> Unit) {
    Card(
        onClick = onClick, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                val c = when (u.ty) { "result" -> Brand.Green; "admit-card" -> Brand.Azure; "answer-key" -> Brand.Saffron; else -> Brand.Muted }
                Pill(typeName, c, c.copy(alpha = .12f))
                Spacer(Modifier.width(8.dp))
                if (u.o.isNotBlank()) Text(u.o, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                else Spacer(Modifier.weight(1f))
                Text(Dates.short(u.d), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.padding(top = 6.dp))
            Text(u.short(hindi), style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
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
fun CalRow(c: com.newsviews.app.ui.CalItem, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            val col = when (c.type) { "result" -> Brand.Green; "admit-card" -> Brand.Azure; "answer-key" -> Brand.Saffron; "exam" -> Brand.Saffron; else -> Brand.Muted }
            Pill(c.label, col, col.copy(alpha = .12f))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(c.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (c.org.isNotBlank()) Text(c.org, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
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

@Composable
fun ChoiceChip(text: String, selected: Boolean, onClick: () -> Unit) {
    androidx.compose.material3.FilterChip(selected = selected, onClick = onClick, label = { Text(text) })
}
