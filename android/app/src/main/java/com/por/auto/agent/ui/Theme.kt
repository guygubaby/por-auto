package com.por.auto.agent.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// 墨 + 琥珀：暖纸张底、近黑主色、琥珀只做强调，避免默认紫。
private val Ink = Color(0xFF1C1915)
private val Paper = Color(0xFFFAF6EF)
private val Amber = Color(0xFFF0B429)
private val AmberDeep = Color(0xFF9A6B00)
private val Clay = Color(0xFFB4451F)

private val LightColors = lightColorScheme(
    primary = Ink,
    onPrimary = Color(0xFFFFFBF3),
    primaryContainer = Color(0xFFEDE6DA),
    onPrimaryContainer = Ink,
    secondary = Color(0xFF5B5348),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFEFE8DC),
    onSecondaryContainer = Ink,
    tertiary = Amber,
    onTertiary = Ink,
    tertiaryContainer = Color(0xFFFFE9B8),
    onTertiaryContainer = Color(0xFF3A2C00),
    background = Paper,
    onBackground = Ink,
    surface = Color(0xFFFFFFFF),
    onSurface = Ink,
    surfaceVariant = Color(0xFFF2EBE0),
    onSurfaceVariant = Color(0xFF6E6459),
    outline = Color(0xFFC9BFB0),
    outlineVariant = Color(0xFFE7DFD3),
    error = Clay,
    onError = Color(0xFFFFFFFF),
)

private val DarkColors = darkColorScheme(
    primary = Amber,
    onPrimary = Ink,
    primaryContainer = Color(0xFF3A2C00),
    onPrimaryContainer = Color(0xFFFFE9B8),
    secondary = Color(0xFFCFC5B6),
    onSecondary = Ink,
    secondaryContainer = Color(0xFF2C2722),
    onSecondaryContainer = Color(0xFFEFE8DC),
    tertiary = Amber,
    onTertiary = Ink,
    tertiaryContainer = Color(0xFF4A3A0C),
    onTertiaryContainer = Color(0xFFFFE9B8),
    background = Color(0xFF131110),
    onBackground = Color(0xFFF2EDE4),
    surface = Color(0xFF1D1A17),
    onSurface = Color(0xFFF2EDE4),
    surfaceVariant = Color(0xFF272320),
    onSurfaceVariant = Color(0xFFA79D91),
    outline = Color(0xFF6B6156),
    outlineVariant = Color(0xFF35302B),
    error = Color(0xFFFFB59B),
    onError = Color(0xFF3B0A00),
)

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(10.dp),
    medium = RoundedCornerShape(14.dp),
    large = RoundedCornerShape(20.dp),
    extraLarge = RoundedCornerShape(28.dp),
)

private val AppTypography = Typography(
    headlineSmall = TextStyle(fontSize = 26.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold),
    titleLarge = TextStyle(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold),
    titleMedium = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium),
    bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 13.5.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 17.sp),
    labelLarge = TextStyle(fontSize = 13.5.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.2.sp),
)

/** 统一的间距尺度，页面内不再出现散落的魔法数字。 */
object Space {
    val xs = 4.dp
    val sm = 8.dp
    val md = 12.dp
    val lg = 16.dp
    val xl = 24.dp
    val xxl = 32.dp
}

@Composable
fun PorAutoTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
        shapes = AppShapes,
        typography = AppTypography,
        content = content,
    )
}
