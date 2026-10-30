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
            signingConfigs.findByName("release")?.let { signingConfig = it }
            manifestPlaceholders["admobAppId"] = if (liveAds) adId("appId") else testAppId
            buildConfigField("boolean", "ADS", liveAds.toString())
            buildConfigField("String", "AD_BANNER", "\"${adId("banner")}\"")
            buildConfigField("String", "AD_INLINE", "\"${adId("inline").ifEmpty { adId("banner") }}\"")
            buildConfigField("String", "AD_INTERSTITIAL", "\"${adId("interstitial")}\"")
        }
        debug {
            applicationIdSuffix = ".debug"
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
    testImplementation("junit:junit:4.13.2")
}
