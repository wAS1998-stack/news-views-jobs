package com.newsviews.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.Quiz
import androidx.compose.material.icons.filled.Share
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.newsviews.app.BuildConfig
import com.newsviews.app.Stats
import com.newsviews.app.ads.InlineAd
import com.newsviews.app.ads.findActivity
import com.newsviews.app.data.Dates
import com.newsviews.app.data.Quiz
import com.newsviews.app.data.QuizRef
import com.newsviews.app.play.PlayPrompts

/** Today's quiz card at the top of the Jobs list: a daily reason to open the app (with a streak), until it is done. */
@Composable
fun QuizCard(q: QuizRef, streak: Int, s: Strings, onStart: () -> Unit) {
    Card(onClick = onStart, shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        modifier = Modifier.fillMaxWidth()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.Quiz, null, tint = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(s.quizTitle, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                Text(s.quizCard(q.n), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                if (streak > 0) Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 2.dp)) {
                    Icon(Icons.Filled.LocalFireDepartment, null, tint = Pills.saffron().fg, modifier = Modifier.padding(end = 4.dp))
                    Text(s.streak(streak), style = MaterialTheme.typography.labelLarge, color = Pills.saffron().fg)
                }
            }
            Button(onClick = onStart) { Text(s.quizStart) }
        }
    }
}

/** After today's quiz: the streak stays in view, with yesterday's quiz (if missed) and all quizzes one tap away. */
@Composable
fun QuizDoneCard(streak: Int, s: Strings, onYesterday: (() -> Unit)?, onAll: () -> Unit) {
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(start = 16.dp, end = 8.dp, top = 10.dp, bottom = 4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(if (streak > 0) Icons.Filled.LocalFireDepartment else Icons.Filled.CheckCircle, null,
                    tint = if (streak > 0) Pills.saffron().fg else Pills.green().fg, modifier = Modifier.padding(end = 8.dp))
                Text(if (streak > 0) s.x.quizDoneCard(streak) else s.x.quizDoneNoStreak, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            }
            Row {
                if (onYesterday != null) TextButton(onClick = onYesterday) { Text(s.x.playYesterday) }
                TextButton(onClick = onAll) { Text(s.x.allQuizzes) }
            }
        }
    }
}

/** Every quiz in the feed (the last two weeks), with a tick and the score for the ones already played. */
@Composable
fun QuizHubScreen(vm: MainViewModel, s: Strings, onOpen: (String) -> Unit) {
    val idx by vm.index.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val quizzes = idx?.quizzes ?: emptyList()
    if (quizzes.isEmpty()) { Centered(if (idx == null) s.loading else s.x.noQuizzes); return }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize()) {
        item {
            val streak = settings.quizStreak()
            if (streak > 0) Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 4.dp)) {
                Icon(Icons.Filled.LocalFireDepartment, null, tint = Pills.saffron().fg, modifier = Modifier.padding(end = 4.dp))
                Text(s.streak(streak), style = MaterialTheme.typography.titleMedium, color = Pills.saffron().fg)
            }
        }
        items(quizzes, key = { it.id }) { q ->
            val score = settings.quizScores[q.date.take(10)]
            Card(onClick = { onOpen(q.id) }, shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (score != null) Icons.Filled.CheckCircle else Icons.Filled.Quiz, null,
                        tint = if (score != null) Pills.green().fg else MaterialTheme.colorScheme.primary, modifier = Modifier.size(24.dp))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(q.title.ifBlank { Dates.pretty(q.date, settings.hindi) }, style = MaterialTheme.typography.titleMedium)
                        Text(listOf(s.quizCard(q.n).substringAfter("· ", s.quizCard(q.n)), if (score != null) s.x.quizScoreShort(score) else s.x.quizNotPlayed).joinToString(" · "),
                            style = MaterialTheme.typography.bodyMedium, color = if (score != null) Pills.green().fg else MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

/** The quiz: tap an answer to see whether it is right and why; the score, streak and share buttons at the end. */
@Composable
fun QuizScreen(vm: MainViewModel, s: Strings, id: String, onMore: () -> Unit = {}) {
    val ctx = LocalContext.current
    val settings by vm.settings.collectAsStateWithLifecycle()
    Loader(id, { vm.repo.quiz(id) }, s, web = "${BuildConfig.SITE}/quiz/$id/", cached = { vm.repo.cachedQuiz(id) }) { z: Quiz ->
        // the answers survive rotation and a trip to another app (an IntArray is saved in the instance state)
        var picked by rememberSaveable(z.id, z.questions.size) { mutableStateOf(IntArray(z.questions.size) { -1 }) }
        var reported by rememberSaveable(z.id) { mutableStateOf(false) }
        val answered = picked.count { it >= 0 }
        val score = z.questions.indices.count { picked.getOrElse(it) { -1 } == z.questions[it].answer }
        val finished = answered == z.questions.size && z.questions.isNotEmpty()
        LaunchedEffect(finished) {
            if (finished && !reported) {
                reported = true
                // the streak counts the day the quiz was played (today's quiz on time, or a missed one played today)
                vm.quizDone(Dates.today().toString(), z.date.take(10), score, z.questions.size)
                Stats.event(ctx, "quiz_done", "score" to "$score/${z.questions.size}")
                // a good score is a good moment to ask for a rating (Play decides whether the sheet really appears)
                if (score >= 7) ctx.findActivity()?.let { PlayPrompts.positiveMoment(it, "quiz") }
            }
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 12.dp)) {
            Text(z.title, style = MaterialTheme.typography.titleLarge)
            // the quiz's own language (some days Hindi, some English): a note only when it differs from the app's
            val inHindi = remember(z.id) { z.questions.any { q -> q.q.any { it in 'ऀ'..'ॿ' } } }
            if (inHindi && !settings.hindi) Text(s.quizHindiNote, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            z.questions.forEachIndexed { i, q ->
                val mine = picked.getOrElse(i) { -1 }
                Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), modifier = Modifier.fillMaxWidth().padding(top = 14.dp)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("${i + 1}. ${q.q}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                        q.options.forEachIndexed { j, o ->
                            val done = mine >= 0
                            val right = j == q.answer
                            val green = Pills.green()
                            val red = Pills.red()
                            val bg = when {
                                done && right -> green.bg
                                done && j == mine -> red.bg
                                else -> Color.Transparent
                            }
                            val edge = when {
                                done && right -> green.fg
                                done && j == mine -> red.fg
                                else -> MaterialTheme.colorScheme.outlineVariant
                            }
                            // right / wrong is said by an icon and to screen readers too, not by colour alone
                            val state = when {
                                done && right -> s.x.correct
                                done && j == mine -> s.x.wrong
                                else -> ""
                            }
                            Card(shape = RoundedCornerShape(10.dp), colors = CardDefaults.cardColors(containerColor = bg), border = BorderStroke(1.dp, edge),
                                modifier = Modifier.fillMaxWidth()
                                    .clickable(enabled = !done) { picked = picked.copyOf().also { it[i] = j } }
                                    .semantics { if (state.isNotEmpty()) stateDescription = state }) {
                                Row(Modifier.padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text(o, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                                    if (done && right) Icon(Icons.Filled.Check, null, tint = green.fg, modifier = Modifier.padding(start = 8.dp))
                                    else if (done && j == mine) Icon(Icons.Filled.Close, null, tint = red.fg, modifier = Modifier.padding(start = 8.dp))
                                }
                            }
                        }
                        if (mine >= 0 && q.why.isNotBlank()) Text(q.why, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            if (finished) {
                // one in-page ad at the natural end of the quiz: after the answered questions, with the score and the
                // streak between it and the Share / More quizzes buttons (never directly under a button)
                InlineAd(s.ad, contentUrl = "${BuildConfig.SITE}/quiz/${z.id}/")
                Spacer(Modifier.height(18.dp))
                Text(s.quizScore(score, z.questions.size), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
                val streak = settings.quizStreak()
                if (streak > 0) Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                    Icon(Icons.Filled.LocalFireDepartment, null, tint = Pills.saffron().fg, modifier = Modifier.padding(end = 4.dp))
                    Text(s.streak(streak), style = MaterialTheme.typography.titleMedium, color = Pills.saffron().fg)
                }
                Text(s.quizDoneToday, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                val quizUrl = withUtm("${BuildConfig.SITE}/quiz/${z.id}/")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 10.dp)) {
                    OutlinedButton(onClick = {
                        Stats.event(ctx, "share", "kind" to "quiz")
                        shareText(ctx, s.quizShareText(score, z.questions.size), quizUrl, s.shareFooter)
                    }) { Icon(Icons.Filled.Share, null); Spacer(Modifier.width(8.dp)); Text(s.quizShare) }
                    OutlinedButton(onClick = {
                        Stats.event(ctx, "share", "kind" to "quiz_whatsapp")
                        shareText(ctx, s.quizShareText(score, z.questions.size), quizUrl, s.shareFooter, whatsapp = true)
                    }) { Text(s.x.whatsapp) }
                }
                Button(onClick = onMore, modifier = Modifier.padding(top = 8.dp)) { Text(s.x.moreQuizzes) }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
