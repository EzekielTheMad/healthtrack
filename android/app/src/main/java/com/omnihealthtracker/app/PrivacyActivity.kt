package com.omnihealthtracker.app

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

class PrivacyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = getString(R.string.privacy_title)
        setContentView(TextView(this).apply { text = getString(R.string.privacy_explanation); textSize = 18f; setPadding(32, 64, 32, 32) })
    }
}
