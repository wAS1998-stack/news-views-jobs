plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}
// Firebase (job alerts) is switched on only when google-services.json is present (CI writes it from a secret).
val hasFirebase = file("google-services.json").exists()
if (hasFirebase) apply(plugin = "com.google.gms.google-services")

// Release signing from environment variables (CI secrets); without them only the debug build is made.
val ksPath: String? = System.getenv("ANDROID_KEYSTORE_PATH")
val ksPass: String? = System.getenv("ANDROID_KEYSTORE_PASSWORD")
val ksAlias: String = System.getenv("ANDROID_KEY_ALIAS") ?: "upload"
val versionCodeEnv = (System.getenv("APP_VERSION_CODE") ?: "1").toInt()

// Ads (Google AdMob). The real IDs live in the repo-root config.json under "admob" (one place for the site and the app;
// the site also writes app-ads.txt from them). Debug builds always use Google's public test IDs, so testing never
// touches the live account; a release build shows ads only once the real app ID and banner unit ID are filled in.
@Suppress("UNCHECKED_CAST")
val admob: Map<String, Any?> = try {
    ((groovy.json.JsonSlurper().parse(rootProject.file("../config.json")) as Map<String, Any?>)["admob"] as? Map<String, Any?>) ?: emptyMap()
} catch (e: Exception) { emptyMap() }
fun adId(key: String): String = (admob[key] as? String)?.trim().orEmpty()
val testAppId = "ca-app-pub-3940256099942544~3347511713"
val liveAds = adId("appId").startsWith("ca-app-pub-") && adId("banner").startsWith("ca-app-pub-")

// AdMob mediation: other ad networks compete for every ad slot through AdMob (bidding). Each network listed in
// config.json "admob.mediation" adds its Google-made adapter to the app; it earns only after it is switched on in
// AdMob › Mediation (and the network's own account is linked). Versions: github.com/googleads/googleads-mobile-android-mediation
val mediationAdapters = mapOf(
    "meta" to "com.google.ads.mediation:facebook:6.22.0.1",        // Meta Audience Network
    "applovin" to "com.google.ads.mediation:applovin:13.6.4.2",
    "inmobi" to "com.google.ads.mediation:inmobi:11.5.0.0",
    "liftoff" to "com.google.ads.mediation:vungle:7.7.9.0",        // Liftoff Monetize (Vungle)
    "unity" to "com.google.ads.mediation:unity:4.21.0.0",          // Unity Ads (its SDK is added below: the adapter leaves it out)
    "mintegral" to "com.google.ads.mediation:mintegral:17.1.81.1",
    "ironsource" to "com.google.ads.mediation:ironsource:9.7.0.0",
    "dtexchange" to "com.google.ads.mediation:fyber:8.5.0.0",      // Digital Turbine DT Exchange
    "moloco" to "com.google.ads.mediation:moloco:4.13.0.0",
    "pangle" to "com.google.ads.mediation:pangle:8.3.0.4.0",
    "pubmatic" to "com.google.ads.mediation:pubmatic:5.4.1.0",
    "bigo" to "com.google.ads.mediation:bigo:6.1.0.0",
    "chartboost" to "com.google.ads.mediation:chartboost:9.14.1.0",
)
val mediation: List<String> = ((admob["mediation"] as? List<*>) ?: emptyList<Any>()).map { it.toString().trim().lowercase() }

android {
    namespace = "com.newsviews.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "in.newsviews.app"
        minSdk = 26
        targetSdk = 36
        versionCode = versionCodeEnv
        versionName = "1.0." + versionCodeEnv
        buildConfigField("boolean", "HAS_FIREBASE", hasFirebase.toString())
        buildConfigField("String", "API_BASE", "\"https://news-views.in/app/v1/\"")
        buildConfigField("String", "SITE", "\"https://news-views.in\"")
    }

    signingConfigs {
        // test builds (debug, and release before the upload key exists) are signed with this fixed test key from the repo,
        // so each new test APK installs over the previous one; it is not secret and never used for Google Play
        getByName("debug") {
            val testKey = rootProject.file("test-signing.jks")
            if (testKey.exists()) { storeFile = testKey; storePassword = "android"; keyAlias = "androiddebugkey"; keyPassword = "android" }
        }
        if (ksPath != null && ksPass != null && file(ksPath).exists()) {
            create("release") {
                storeFile = file(ksPath)
                storePassword = ksPass
                keyAlias = ksAlias
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD") ?: ksPass
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // without the upload key (CI before the secrets exist) the release build is still made — signed with the debug
            // key — so the shrunk/optimised build is compiled and smoke-tested on every change, not first at Play upload
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
            manifestPlaceholders["admobAppId"] = if (liveAds) adId("appId") else testAppId
            buildConfigField("boolean", "ADS", liveAds.toString())
            buildConfigField("String", "AD_BANNER", "\"${adId("banner")}\"")
            buildConfigField("String", "AD_INLINE", "\"${adId("inline").ifEmpty { adId("banner") }}\"")
            buildConfigField("String", "AD_INTERSTITIAL", "\"${adId("interstitial")}\"")
        }
        debug {
            // same package as release: Firebase (google-services.json) is registered for in.newsviews.app only
            versionNameSuffix = "-debug"
            manifestPlaceholders["admobAppId"] = testAppId
            buildConfigField("boolean", "ADS", "true")
            buildConfigField("String", "AD_BANNER", "\"ca-app-pub-3940256099942544/9214589741\"")
            buildConfigField("String", "AD_INLINE", "\"ca-app-pub-3940256099942544/6300978111\"")
            buildConfigField("String", "AD_INTERSTITIAL", "\"ca-app-pub-3940256099942544/1033173712\"")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "DebugProbesKt.bin")
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.06.01")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.navigation:navigation-compose:2.9.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-process:2.9.1")
    // the ad SDKs pull in an old androidx.fragment; the Activity Result API (permission + update prompts) needs ≥ 1.3
    // (release lint: InvalidFragmentVersionForActivityResult)
    implementation("androidx.fragment:fragment-ktx:1.8.6")
    implementation("androidx.datastore:datastore-preferences:1.1.7")
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    implementation("androidx.browser:browser:1.8.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.10.2")
    implementation(platform("com.google.firebase:firebase-bom:34.0.0"))
    implementation("com.google.firebase:firebase-messaging")
    implementation("com.google.android.gms:play-services-ads:25.5.0")
    implementation("com.google.android.ump:user-messaging-platform:4.0.0")
    implementation("com.google.android.play:review:2.0.2")        // Play's in-app rating sheet
    implementation("com.google.android.play:app-update:2.1.0")    // Play's in-app update download
    mediation.mapNotNull { mediationAdapters[it] }.forEach { implementation(it) }
    // SDKs that an adapter's published POM deliberately omits (found by the R8 release build: missing classes)
    if ("unity" in mediation) implementation("com.unity3d.ads:unity-ads:4.21.0")
    testImplementation("junit:junit:4.13.2")
}
