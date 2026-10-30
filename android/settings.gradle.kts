pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // ad-network SDKs that are not on Maven Central (used only when that network is listed in config.json "admob.mediation")
        maven("https://dl-maven-android.mintegral.com/repository/mbridge_android_sdk_oversea") { content { includeGroupByRegex("com\\.mbridge.*") } }
        maven("https://artifact.bytedance.com/repository/pangle/") { content { includeGroupByRegex("com\\.(pangle|bytedance).*") } }
        maven("https://cboost.jfrog.io/artifactory/chartboost-ads/") { content { includeGroupByRegex("com\\.chartboost.*") } }
    }
}
rootProject.name = "NewsViews"
include(":app")
