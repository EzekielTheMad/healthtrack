package com.omnihealthtracker.app

import kotlinx.coroutines.flow.MutableStateFlow

/** In-process invalidation only; no health data is broadcast to other apps. */
object NativeEvents {
    val changes = MutableStateFlow(0L)
    fun invalidate() { changes.value = changes.value + 1 }
}
