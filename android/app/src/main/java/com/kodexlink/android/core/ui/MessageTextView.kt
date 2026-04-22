package com.kodexlink.android.core.ui

// Auto-generated from iOS: ios/KodexLink/Core/UI/MessageTextView.swift
// UIViewRepresentable (UITextView) → AndroidView (android.widget.TextView)
//
// iOS rationale: UITextView uses TextKit incremental layout — only re-measures
// newly appended text during streaming, unlike SwiftUI Text which re-measures
// the entire string on every update.
//
// Android equivalent: android.widget.TextView with a SpannableStringBuilder
// supports similar incremental append semantics via setText()+append(), making
// it preferable to Compose Text for long streaming messages.

import android.graphics.Color
import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.method.ScrollingMovementMethod
import android.util.TypedValue
import android.widget.TextView
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView

/**
 * A streaming-optimized text view backed by [android.widget.TextView].
 *
 * For short or static text this behaves identically to Compose [Text].
 * For long messages that grow incrementally (LLM streaming), it avoids
 * full re-measurement by detecting whether [text] is a prefix-extension
 * of the currently displayed text and using [TextView.append] instead of
 * [TextView.setText], mirroring the TextKit incremental layout benefit in
 * the iOS implementation.
 *
 * @param text      The full text to display (may grow on each recomposition).
 * @param textSizeSp Font size in SP (default 15).
 * @param textColor  ARGB color int for the text (default black).
 * @param isBold     Whether to use bold typeface.
 * @param modifier   Compose modifier for the wrapping AndroidView.
 */
@Composable
fun MessageTextView(
    text: String,
    textSizeSp: Float = 15f,
    textColor: Int = Color.BLACK,
    isBold: Boolean = false,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current

    // Keep a ref to the underlying TextView so we can do incremental appends
    val viewRef = remember { mutableStateOf<TextView?>(null) }

    AndroidView(
        modifier = modifier,
        factory = {
            TextView(context).apply {
                isFocusable = false
                isClickable = false
                isLongClickable = true          // allow copy
                setTextIsSelectable(true)
                background = null
                setPadding(0, 0, 0, 0)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, textSizeSp)
                setTextColor(textColor)
                typeface = if (isBold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
                setText(text)
                viewRef.value = this
            }
        },
        update = { view ->
            // Update styling if changed
            view.setTextSize(TypedValue.COMPLEX_UNIT_SP, textSizeSp)
            view.setTextColor(textColor)
            view.typeface = if (isBold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT

            val current = view.text?.toString() ?: ""
            when {
                current == text -> {
                    // No change — nothing to do
                }
                text.startsWith(current) -> {
                    // Incremental streaming append — avoids full re-layout
                    view.append(text.substring(current.length))
                }
                else -> {
                    // Replacement (e.g. edit or full reset)
                    view.setText(text)
                }
            }
        }
    )
}
