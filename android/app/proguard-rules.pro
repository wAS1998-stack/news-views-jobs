# Crashlytics: readable stack traces
-keepattributes SourceFile,LineNumberTable
-keep public class * extends java.lang.Exception

# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class com.newsviews.app.data.** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class com.newsviews.app.data.**$$serializer { *; }

# Moloco's SDK reads ironSource LevelPlay impression data only when that SDK is present (optional reference);
# without the ironSource adapter in the build those classes are absent, which is fine at run time.
-dontwarn com.unity3d.mediation.**
