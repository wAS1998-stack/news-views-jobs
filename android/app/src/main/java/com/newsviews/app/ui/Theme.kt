package com.newsviews.app.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/* The website's palette: ink navy, azure, saffron, green for open, red for closed. */
object Brand {
    val Ink = Color(0xFF14213D)
    val Azure = Color(0xFF1F5FAE)
    val Saffron = Color(0xFFE8772E)
    val Green = Color(0xFF1B7F5A)
    val Red = Color(0xFFB23B3B)
    val Paper = Color(0xFFFBFAF7)
    val Line = Color(0xFFE3E0D8)
    val Muted = Color(0xFF5C6370)
}

private val Light = lightColorScheme(
    primary = Brand.Azure, onPrimary = Color.White,
    primaryContainer = Color(0xFFDCE7F7), onPrimaryContainer = Brand.Ink,
    secondary = Brand.Saffron, onSecondary = Color.White,
    secondaryContainer = Color(0xFFFCE6D6), onSecondaryContainer = Color(0xFF5A2A0B),
    tertiary = Brand.Green,
    background = Brand.Paper, onBackground = Brand.Ink,
    surface = Color.White, onSurface = Brand.Ink,
    surfaceVariant = Color(0xFFF2F0EB), onSurfaceVariant = Brand.Muted,
    surfaceContainer = Color.White, surfaceContainerLow = Brand.Paper, surfaceContainerHigh = Color(0xFFF4F2EE),
    outline = Color(0xFFC9C5BB), outlineVariant = Brand.Line,
    error = Brand.Red,
)

private val Dark = darkColorScheme(
    primary = Color(0xFF8DB5EE), onPrimary = Color(0xFF0B1E3A),
    primaryContainer = Color(0xFF1D3A63), onPrimaryContainer = Color(0xFFDCE7F7),
    secondary = Color(0xFFF2A46F), onSecondary = Color(0xFF3B1A05),
    secondaryContainer = Color(0xFF5A2E12), onSecondaryContainer = Color(0xFFFCE6D6),
    tertiary = Color(0xFF6CC9A0),
    background = Color(0xFF0E1525), onBackground = Color(0xFFE6E9F0),
    surface = Color(0xFF151D30), onSurface = Color(0xFFE6E9F0),
    surfaceVariant = Color(0xFF1E2840), onSurfaceVariant = Color(0xFFA9B1C2),
    surfaceContainer = Color(0xFF151D30), surfaceContainerLow = Color(0xFF0E1525), surfaceContainerHigh = Color(0xFF1C2539),
    outline = Color(0xFF3A4560), outlineVariant = Color(0xFF263049),
    error = Color(0xFFF08A8A),
)

private val Type = Typography(
    titleLarge = TextStyle(fontWeight = FontWeight.Bold, fontSize = 22.sp, lineHeight = 28.sp),
    titleMedium = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    labelMedium = TextStyle(fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp),
)

@Composable
fun NewsViewsTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, typography = Type, content = content)
}

val STATE_HI = mapOf(
    "all-india" to "अखिल भारत / केंद्र", "andhra-pradesh" to "आंध्र प्रदेश", "arunachal-pradesh" to "अरुणाचल प्रदेश", "assam" to "असम",
    "bihar" to "बिहार", "chhattisgarh" to "छत्तीसगढ़", "delhi" to "दिल्ली (NCR)", "goa" to "गोवा", "gujarat" to "गुजरात", "haryana" to "हरियाणा",
    "himachal-pradesh" to "हिमाचल प्रदेश", "jharkhand" to "झारखंड", "karnataka" to "कर्नाटक", "kerala" to "केरल", "madhya-pradesh" to "मध्य प्रदेश",
    "maharashtra" to "महाराष्ट्र", "manipur" to "मणिपुर", "meghalaya" to "मेघालय", "mizoram" to "मिज़ोरम", "nagaland" to "नागालैंड", "odisha" to "ओडिशा",
    "punjab" to "पंजाब", "rajasthan" to "राजस्थान", "sikkim" to "सिक्किम", "tamil-nadu" to "तमिलनाडु", "telangana" to "तेलंगाना", "tripura" to "त्रिपुरा",
    "uttar-pradesh" to "उत्तर प्रदेश", "uttarakhand" to "उत्तराखंड", "west-bengal" to "पश्चिम बंगाल", "jammu-kashmir" to "जम्मू और कश्मीर", "gulf" to "खाड़ी / विदेश",
)
val QUAL_HI = mapOf(
    "10th-pass" to "10वीं पास", "12th-pass" to "12वीं पास", "graduate" to "स्नातक", "engineering-diploma" to "इंजीनियरिंग / डिप्लोमा", "post-graduate" to "स्नातकोत्तर",
)
val TYPE_HI = mapOf("result" to "रिजल्ट", "admit-card" to "प्रवेश पत्र", "answer-key" to "उत्तर कुंजी", "exam-date" to "परीक्षा तिथि")
