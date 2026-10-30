package com.newsviews.app.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DisplayMode
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.newsviews.app.BuildConfig
import com.newsviews.app.data.Dates
import com.newsviews.app.data.Qual
import java.time.Instant
import java.time.ZoneOffset
import com.newsviews.app.ads.Ads
import com.newsviews.app.ads.findActivity
import com.newsviews.app.push.Alerts

@Composable
private fun ToggleRow(title: String, hint: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(hint, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun Group(content: @Composable () -> Unit) {
    Card(shape = RoundedCornerShape(14.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant), modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) { content() }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun StatePicker(vm: MainViewModel, hindi: Boolean, selected: Set<String>, allLabel: String) {
    val idx by vm.index.collectAsStateWithLifecycle()
    val states = (idx?.states ?: com.newsviews.app.data.Builtin.states).filter { it.slug != "all-india" }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ChoiceChip(allLabel, selected.isEmpty()) { vm.clearStates() }
        states.forEach { st -> ChoiceChip(if (hindi) STATE_HI[st.slug] ?: st.name else st.name, st.slug in selected) { vm.toggleState(st.slug) } }
    }
}

@Composable
fun QualPicker(vm: MainViewModel, hindi: Boolean, selected: Qual) {
    Column {
        Qual.entries.forEach { q ->
            Row(Modifier.fillMaxWidth().clickable { vm.setQual(q) }, verticalAlignment = Alignment.CenterVertically) {
                RadioButton(selected = q == selected, onClick = { vm.setQual(q) })
                Text(if (hindi) q.hi else q.en, style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

@Composable
fun AlertsScreen(vm: MainViewModel, s: Strings) {
    val ctx = LocalContext.current
    val st by vm.settings.collectAsStateWithLifecycle()
    var granted by remember { mutableStateOf(Alerts.canNotify(ctx)) }
    val askPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    val adPrivacy by Ads.privacyRequired.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        if (!granted && Build.VERSION.SDK_INT >= 33) {
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer), modifier = Modifier.fillMaxWidth()) {
                Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(s.permissionNeeded, modifier = Modifier.weight(1f), color = MaterialTheme.colorScheme.onSecondaryContainer)
                    Button(onClick = { askPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }) { Text(s.allow) }
                }
            }
        }
        if (!Alerts.firebaseReady(ctx)) {
            Text(s.alertsNeedSetup, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
        }
        Group {
            ToggleRow(s.alertsOn, s.alertsOnHint, st.alerts) { vm.setAlerts(it); if (it && !granted && Build.VERSION.SDK_INT >= 33) askPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }
            HorizontalDivider()
            ToggleRow(s.resultsAlerts, s.resultsHint, st.results) { vm.setResults(it) }
            HorizontalDivider()
            ToggleRow(s.reminders, s.remindersHint, st.reminders) { vm.setReminders(it) }
        }
        Group {
            Text(s.following, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 10.dp))
            Text(if (st.follows.isEmpty()) s.noFollows else s.followHint, style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 8.dp))
            if (st.follows.isNotEmpty()) FollowedList(st.follows) { vm.toggleFollow(it) }
            Spacer(Modifier.height(8.dp))
        }
        Group {
            Text(s.myStates, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 10.dp))
            Text(s.myStatesHint, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 8.dp))
            StatePicker(vm, st.hindi, st.states, s.allStates)
            Spacer(Modifier.height(8.dp))
        }
        Group {
            Text(s.myQual, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 10.dp))
            QualPicker(vm, st.hindi, st.qual)
        }
        Group {
            var dobDialog by remember { mutableStateOf(false) }
            if (dobDialog) DobDialog(s, st.dob, onDismiss = { dobDialog = false }) { vm.setDob(it); dobDialog = false }
            Text(s.eligibility, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 10.dp))
            TextButton(onClick = { dobDialog = true }) {
                Text(if (st.dob.isBlank()) s.setDob else "${s.dob}: ${Dates.pretty(st.dob)}" + (st.age()?.let { " ($it)" } ?: ""))
            }
            Text(s.category, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 4.dp, bottom = 4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ChoiceChip(s.catGen, st.category == "gen") { vm.setCategory("gen") }
                ChoiceChip(s.catObc, st.category == "obc") { vm.setCategory("obc") }
                ChoiceChip(s.catSc, st.category == "scst") { vm.setCategory("scst") }
            }
            Text(s.ageNote, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp, bottom = 12.dp))
        }
        Group {
            Text(s.language, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 10.dp, bottom = 6.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 10.dp)) {
                ChoiceChip("English", !st.hindi) { vm.setHindi(false) }
                ChoiceChip("हिंदी", st.hindi) { vm.setHindi(true) }
            }
        }
        Group {
            Text(s.about, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 10.dp))
            TextButton(onClick = { openUrl(ctx, "https://play.google.com/store/apps/details?id=in.newsviews.app") }) { Text(s.rate) }
            TextButton(onClick = { shareText(ctx, s.shareText, "https://play.google.com/store/apps/details?id=in.newsviews.app") }) { Text(s.shareApp) }
            TextButton(onClick = { openUrl(ctx, BuildConfig.SITE + "/privacy-policy/") }) { Text(s.privacy) }
            if (adPrivacy) TextButton(onClick = { ctx.findActivity()?.let { Ads.showPrivacyOptions(it) } }) { Text(s.adPrivacy) }
            TextButton(onClick = { openUrl(ctx, BuildConfig.SITE + "/") }) { Text("news-views.in") }
            TextButton(onClick = { ctx.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }) {
                Text(if (st.hindi) "नोटिफ़िकेशन सेटिंग" else "Notification settings")
            }
            Text(s.disclaimer, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 12.dp, end = 12.dp, top = 4.dp, bottom = 8.dp))
            Text("v${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 12.dp, bottom = 12.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FollowedList(follows: Set<String>, onRemove: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        follows.sorted().forEach { o ->
            InputChip(selected = true, onClick = { onRemove(o) }, label = { Text(o) }, trailingIcon = { Icon(Icons.Filled.Close, null) })
        }
    }
}

/** Date of birth, typed (faster than scrolling back 25 years); kept only on the phone. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DobDialog(s: Strings, current: String, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val year = Dates.today().year
    val initial = Dates.parse(current)?.atStartOfDay(ZoneOffset.UTC)?.toInstant()?.toEpochMilli()
    val state = rememberDatePickerState(initialSelectedDateMillis = initial, yearRange = (year - 70)..(year - 14), initialDisplayMode = DisplayMode.Input)
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                val ms = state.selectedDateMillis
                if (ms != null) onPick(Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate().toString()) else onDismiss()
            }) { Text(s.ok) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(s.cancel) } },
    ) {
        DatePicker(state = state, title = { Text(s.dob, modifier = Modifier.padding(start = 24.dp, end = 12.dp, top = 16.dp)) })
    }
}

/** First launch: pick language, states and qualification, then allow notifications. */
@Composable
fun Onboarding(vm: MainViewModel, s: Strings) {
    val st by vm.settings.collectAsStateWithLifecycle()
    val askPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { vm.finishOnboarding() }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp)) {
        Text(s.welcome, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(s.welcomeHint, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 14.dp)) {
            ChoiceChip("English", !st.hindi) { vm.setHindi(false) }
            ChoiceChip("हिंदी", st.hindi) { vm.setHindi(true) }
        }
        Text(s.chooseState, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 18.dp, bottom = 8.dp))
        StatePicker(vm, st.hindi, st.states, s.allStates)
        Text(s.myQual, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 18.dp))
        QualPicker(vm, st.hindi, st.qual)
        Button(onClick = {
            if (Build.VERSION.SDK_INT >= 33) askPermission.launch(Manifest.permission.POST_NOTIFICATIONS) else vm.finishOnboarding()
        }, modifier = Modifier.fillMaxWidth().padding(top = 20.dp)) { Text(s.continueBtn) }
        TextButton(onClick = { vm.finishOnboarding() }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Text(s.skip) }
        Text(s.disclaimer, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp))
    }
}
