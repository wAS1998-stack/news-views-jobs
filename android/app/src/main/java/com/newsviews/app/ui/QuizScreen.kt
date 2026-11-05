package com.newsviews.app.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.newsviews.app.BuildConfig
import com.newsviews.app.Stats
import com.newsviews.app.ads.InlineAd
import com.newsviews.app.data.Dates
import com.newsviews.app.data.Quiz
import com.newsviews.app.data.QuizRef

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
                    Icon(Icons.Filled.LocalFireDepartment, null, tint = Brand.Saffron, modifier = Modifier.padding(end = 4.dp))
                    Text(s.streak(streak), style = MaterialTheme.typography.labelLarge, color = Brand.Saffron)
                }
            }
            Button(onClick = onStart) { Text(s.quizStart) }
        }
    }
}

/** The quiz: tap an answer to see whether it is right and why; the score, streak and a share button at the end. */
@Composable
fun QuizScreen(vm: MainViewModel, s: Strings, id: String) {
    val ctx = LocalContext.current
    val settings by vm.settings.collectAsStateWithLifecycle()
    Loader(id, { vm.repo.quiz(id) }, s, web = "${BuildConfig.SITE}/quiz/$id/") { z: Quiz ->
        val picked = remember(z.id) { mutableStateListOf<Int>().apply { repeat(z.questions.size) { add(-1) } } }
        val answered = picked.count { it >= 0 }
        val score = z.questions.indices.count { picked[it] == z.questions[it].answer }
        val finished = answered == z.questions.size && z.questions.isNotEmpty()
        LaunchedEffect(finished) {
            if (finished) {
                // the streak counts the day the quiz was played (today's quiz on time, or a missed one played today)
                vm.quizDone(Dates.today().toString())
                Stats.event(ctx, "quiz_done", "score" to "$score/${z.questions.size}")
            }
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 12.dp)) {
            Text(z.title, style = MaterialTheme.typography.titleLarge)
            if (!settings.hindi) Text(s.quizHindiNote, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
            z.questions.forEachIndexed { i, q ->
                Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), modifier = Modifier.fillMaxWidth().padding(top = 14.dp)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("${i + 1}. ${q.q}", style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                        q.options.forEachIndexed { j, o ->
                            val done = picked[i] >= 0
                            val right = j == q.answer
                            val bg = when {
                                done && right -> Brand.Green.copy(alpha = .14f)
                                done && j == picked[i] -> Brand.Red.copy(alpha = .12f)
                                else -> Color.Transparent
                            }
                            val edge = when {
                                done && right -> Brand.Green
                                done && j == picked[i] -> Brand.Red
                                else -> MaterialTheme.colorScheme.outlineVariant
                            }
                            Card(shape = RoundedCornerShape(10.dp), colors = CardDefaults.cardColors(containerColor = bg), border = BorderStroke(1.dp, edge),
                                modifier = Modifier.fillMaxWidth().clickable(enabled = !done) { picked[i] = j }) {
                                Text(o, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp))
                            }
                        }
                        if (picked[i] >= 0 && q.why.isNotBlank()) Text(q.why, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            if (finished) {
                Spacer(Modifier.height(18.dp))
                Text(s.quizScore(score, z.questions.size), style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.primary)
                val streak = settings.quizStreak()
                if (streak > 0) Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                    Icon(Icons.Filled.LocalFireDepartment, null, tint = Brand.Saffron, modifier = Modifier.padding(end = 4.dp))
                    Text(s.streak(streak), style = MaterialTheme.typography.titleMedium, color = Brand.Saffron)
                }
                Text(s.quizDoneToday, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
                OutlinedButton(onClick = {
                    Stats.event(ctx, "share", "kind" to "quiz")
                    shareText(ctx, s.quizShareText(score, z.questions.size), "${BuildConfig.SITE}/quiz/${z.id}/", s.shareFooter)
                }, modifier = Modifier.padding(top = 10.dp)) { Icon(Icons.Filled.Share, null); Spacer(Modifier.width(8.dp)); Text(s.quizShare) }
                // one in-page ad at the natural end of the quiz, never between the answer buttons
                InlineAd(s.ad)
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}
