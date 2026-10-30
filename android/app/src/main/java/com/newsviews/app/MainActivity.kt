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
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
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

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        handle(intent)
        setContent { NewsViewsTheme { Root(vm, pending) } }
        Ads.start(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
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
        if (BuildConfig.DEBUG && intent.hasExtra("hindi")) vm.setHindi(intent.getBooleanExtra("hindi", false))
        if (BuildConfig.DEBUG && intent.hasExtra("tab")) { pending.value = "tab" to (intent.getStringExtra("tab") ?: "jobs"); return }
        val kind = intent.getStringExtra("kind")
        val id = intent.getStringExtra("id")
        if (kind != null && id != null) { pending.value = kind to id; return }
        val uri = intent.data ?: return
        val seg = uri.pathSegments
        if (seg.size >= 2 && seg[0] == "jobs") pending.value = "job" to seg[1]
        else if (seg.size >= 2 && seg[0] == "updates") pending.value = "update" to seg[1]
    }
}

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
    var prevRoute by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(idx) { idx?.let { Ads.setConfig(it.ads) } }
    // ads: count pages opened; a full-screen ad may only appear on the way back from a page to a list
    LaunchedEffect(route) {
        val isPage = route.startsWith("job/") || route.startsWith("update/")
        val wasPage = prevRoute?.let { it.startsWith("job/") || it.startsWith("update/") } == true
        if (isPage) Ads.pageOpened() else if (wasPage && activity != null) Ads.backFromPage(activity)
        prevRoute = route
    }

    LaunchedEffect(open) {
        val p = open ?: return@LaunchedEffect
        // debug hook: a plain jump to the tab, clearing open pages (go() would restore the tab's saved stack)
        if (p.first == "tab") nav.navigate(p.second) { popUpTo("jobs"); launchSingleTop = true }
        else nav.navigate(if (p.first == "update") "update/${p.second}" else "job/${p.second}") { launchSingleTop = true }
        pending.value = null
    }

    if (!settings.onboarded && open == null) {
        Scaffold { pad -> Column(Modifier.padding(pad)) { Onboarding(vm, s) } }
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    if (top) Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("News-Views", fontWeight = FontWeight.ExtraBold)
                        Text(".", color = Brand.Saffron, fontWeight = FontWeight.ExtraBold)
                        Spacer(Modifier.width(10.dp))
                        Text(if (route == "alerts") s.alertsTitle else s.tagline, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                navigationIcon = { if (!top) IconButton(onClick = { if (!nav.popBackStack()) nav.navigate("jobs") }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
                actions = { if (route == "jobs" || route == "updates") IconButton(onClick = { vm.refresh() }) { Icon(Icons.Filled.Refresh, null) } },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
        bottomBar = {
            if (top) Column {
                if (route != "alerts") BottomBanner()
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
            composable("updates") { UpdatesScreen(vm, s) { nav.navigate("update/$it") } }
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
