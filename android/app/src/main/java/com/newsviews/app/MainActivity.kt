package com.newsviews.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.Image
import androidx.compose.ui.res.painterResource
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Work
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.newsviews.app.ads.Ads
import com.newsviews.app.ads.BottomBanner
import com.newsviews.app.ads.findActivity
import com.newsviews.app.play.PlayPrompts
import androidx.activity.result.contract.ActivityResultContracts
import com.newsviews.app.ui.AlertsScreen
import com.newsviews.app.ui.Brand
import com.newsviews.app.ui.JobDetailScreen
import com.newsviews.app.ui.JobsScreen
import com.newsviews.app.ui.MainViewModel
import com.newsviews.app.ui.NewsViewsTheme
import com.newsviews.app.ui.Onboarding
import com.newsviews.app.ui.SavedScreen
import com.newsviews.app.ui.Strings
import com.newsviews.app.ui.UpdateDetailScreen
import com.newsviews.app.ui.UpdatesScreen
import kotlinx.coroutines.flow.MutableStateFlow

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()
    /** A job or update to open, from a notification tap or a news-views.in link. */
    private val pending = MutableStateFlow<Pair<String, String>?>(null)
    private val updateLauncher = registerForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // only on a fresh start: after rotation / dark-mode switch the same intent would reopen the page the user left
        if (savedInstanceState == null) handle(intent)
        setContent { NewsViewsTheme { Root(vm, pending) } }
        if (savedInstanceState == null) {
            Ads.start(this)
            PlayPrompts.checkForUpdate(this, updateLauncher)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    override fun onResume() {
        super.onResume()
        vm.syncAlerts()
        vm.refreshIfStale()
    }

    private fun handle(intent: Intent?) {
        intent ?: return
        // test hooks for the automated screenshots (debug builds only)
        if (BuildConfig.DEBUG && intent.getBooleanExtra("skip_onboarding", false)) vm.finishOnboarding()
        if (BuildConfig.DEBUG && intent.getBooleanExtra("ad_test", false)) Ads.forceNext = true
        if (BuildConfig.DEBUG && intent.getBooleanExtra("demo_profile", false)) vm.demoProfile()
        if (BuildConfig.DEBUG && intent.getBooleanExtra("upcoming", false)) vm.setFilters(vm.filters.value.copy(upcoming = true, updateType = ""))
        if (BuildConfig.DEBUG && intent.hasExtra("hindi")) vm.setHindi(intent.getBooleanExtra("hindi", false))
        if (BuildConfig.DEBUG && intent.hasExtra("tab")) { pending.value = "tab" to (intent.getStringExtra("tab") ?: "jobs"); return }
        // ids come from notifications and links any app can send: accept only the feed's own id format
        val ok = { id: String? -> id != null && ID_RE.matches(id) }
        val kind = intent.getStringExtra("kind")
        val id = intent.getStringExtra("id")
        if ((kind == "job" || kind == "update") && ok(id)) { pending.value = kind!! to id!!; return }
        val uri = intent.data ?: return
        val seg = uri.pathSegments
        when {
            seg.size >= 2 && seg[0] == "jobs" && ok(seg[1]) -> pending.value = "job" to seg[1]
            // the site's result / admit-card / answer-key / exam-date list pages open the Results tab, filtered
            seg.size >= 2 && seg[0] == "updates" && seg[1] in UPDATE_TYPES -> {
                vm.setFilters(vm.filters.value.copy(updateType = seg[1], upcoming = false))
                pending.value = "tab" to "updates"
            }
            seg.size >= 2 && seg[0] == "updates" && ok(seg[1]) -> pending.value = "update" to seg[1]
            seg.firstOrNull() == "updates" -> pending.value = "tab" to "updates"
        }
    }
}

private val ID_RE = Regex("^[a-z0-9][a-z0-9-]{0,140}$")
private val UPDATE_TYPES = setOf("result", "admit-card", "answer-key", "exam-date")

private data class Tab(val route: String, val label: (Strings) -> String, val icon: androidx.compose.ui.graphics.vector.ImageVector)

private val TABS = listOf(
    Tab("jobs", { it.jobs }, Icons.Filled.Work),
    Tab("updates", { it.results }, Icons.Filled.EmojiEvents),
    Tab("saved", { it.saved }, Icons.Filled.Bookmark),
    Tab("alerts", { it.alerts }, Icons.Filled.Notifications),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Root(vm: MainViewModel, pending: MutableStateFlow<Pair<String, String>?>) {
    val settings by vm.settings.collectAsStateWithLifecycle()
    val loaded by vm.settingsLoaded.collectAsStateWithLifecycle()
    if (!loaded) return
    val s = if (settings.hindi) Strings.HI else Strings.EN
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route ?: "jobs"
    val top = TABS.any { it.route == route }
    val open by pending.collectAsStateWithLifecycle()
    val idx by vm.index.collectAsStateWithLifecycle()
    val activity = LocalContext.current.findActivity()
    var prevRoute by rememberSaveable { mutableStateOf<String?>(null) }
    // arrived through a link or a notification before finishing the welcome screen: show what they came for first;
    // the welcome screen comes on the next start (it used to flash the job and jump back to the welcome screen)
    var linkVisit by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(idx) { idx?.let { Ads.setConfig(it.ads) } }
    val argId = entry?.arguments?.getString("id")
    val detailTitle = when {
        route.startsWith("job/") -> idx?.jobs?.firstOrNull { it.id == argId }?.short(settings.hindi)
        route.startsWith("update/") -> idx?.updates?.firstOrNull { it.id == argId }?.short(settings.hindi)
        else -> null
    }
    // ads: count pages opened; a full-screen ad may only appear on the way back from a page to a list
    LaunchedEffect(route) {
        if (prevRoute == route) return@LaunchedEffect          // recreated screen (rotation): not a new page view
        val isPage = route.startsWith("job/") || route.startsWith("update/")
        val wasPage = prevRoute?.let { it.startsWith("job/") || it.startsWith("update/") } == true
        if (isPage) { Ads.pageOpened(); activity?.let { PlayPrompts.pageOpened(it) } }
        else if (wasPage && activity != null && !Ads.backFromPage(activity)) PlayPrompts.maybeAskReview(activity)
        prevRoute = route
    }

    LaunchedEffect(open) {
        val p = open ?: return@LaunchedEffect
        // debug hook: a plain jump to the tab, clearing open pages (go() would restore the tab's saved stack)
        if (p.first != "tab") linkVisit = true
        if (p.first == "tab") nav.navigate(p.second) { popUpTo("jobs"); launchSingleTop = true }
        else nav.navigate(if (p.first == "update") "update/${p.second}" else "job/${p.second}") { launchSingleTop = true }
        pending.value = null
    }

    if (!settings.onboarded && open == null && !linkVisit) {
        Scaffold { pad -> Column(Modifier.padding(pad)) { Onboarding(vm, s) } }
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    if (!top) detailTitle?.let { Text(it, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    if (top) Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(painterResource(R.drawable.ic_brand), null, modifier = Modifier.size(28.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Sarkari", fontWeight = FontWeight.ExtraBold)
                        Text(" Radar", color = Brand.Saffron, fontWeight = FontWeight.ExtraBold)
                        if (route == "alerts") {
                            Spacer(Modifier.width(10.dp))
                            Text(s.alertsTitle, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                },
                navigationIcon = { if (!top) IconButton(onClick = { if (!nav.popBackStack()) nav.navigate("jobs") }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, if (settings.hindi) "वापस" else "Back") } },
                actions = { if (route == "jobs" || route == "updates") IconButton(onClick = { vm.refresh() }) { Icon(Icons.Filled.Refresh, if (settings.hindi) "रीफ़्रेश" else "Refresh") } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        bottomBar = {
            if (top) Column {
                if (route != "alerts") BottomBanner(s.ad)
                NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                    TABS.forEach { t ->
                        NavigationBarItem(
                            selected = route == t.route,
                            onClick = { go(nav, t.route) },
                            icon = { Icon(t.icon, null) },
                            label = { Text(t.label(s)) },
                        )
                    }
                }
            }
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { pad ->
        NavHost(nav, startDestination = "jobs", modifier = Modifier.padding(pad)) {
            composable("jobs") { JobsScreen(vm, s) { nav.navigate("job/$it") } }
            composable("updates") { UpdatesScreen(vm, s, onOpen = { nav.navigate("update/$it") }, onOpenJob = { nav.navigate("job/$it") }) }
            composable("saved") { SavedScreen(vm, s) { nav.navigate("job/$it") } }
            composable("alerts") { AlertsScreen(vm, s) }
            composable("job/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                JobDetailScreen(vm, s, it.arguments?.getString("id") ?: "")
            }
            composable("update/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) {
                UpdateDetailScreen(vm, s, it.arguments?.getString("id") ?: "")
            }
        }
    }
}

private fun go(nav: NavHostController, route: String) {
    nav.navigate(route) {
        popUpTo("jobs") { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
