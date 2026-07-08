'use client';

import Link from 'next/link';

export default function PrivacyPolicyPage() {
  return (
    <div style={{ background: 'var(--bg-primary)', color: 'var(--color-text-primary)' }}>
      {/* ---------- Nav ---------- */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 backdrop-blur-md"
        style={{
          background: 'rgba(255, 251, 247, 0.85)',
          borderBottom: '1px solid var(--border-card)',
        }}
      >
        <Link href="/" className="flex items-center gap-2 no-underline">
          <span
            className="text-xl font-bold"
            style={{ color: 'var(--color-sage)' }}
          >
            Health
          </span>
          <span className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>
            Track
          </span>
        </Link>
        <Link
          href="/login"
          className="px-4 py-2 rounded-lg text-sm font-semibold no-underline transition-colors"
          style={{
            background: 'transparent',
            color: 'var(--color-sage)',
            border: '1px solid #4ADE80',
          }}
        >
          Sign In
        </Link>
      </nav>

      {/* ---------- Content ---------- */}
      <main className="max-w-3xl mx-auto px-6 pt-32 pb-20">
        <h1 className="text-3xl md:text-4xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm mb-12" style={{ color: 'var(--color-text-muted)' }}>
          Effective date: March 25, 2026
        </p>

        <div className="space-y-10">
          {/* Introduction */}
          <section>
            <p className="leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              This HealthTrack instance is operated by its administrator (&quot;we,&quot;
              &quot;our,&quot; or &quot;us&quot;). This Privacy Policy explains how we
              collect, use, disclose, and safeguard your information when you use our health data tracking
              application. Please read this policy carefully. By using HealthTrack, you agree to the
              collection and use of information in accordance with this policy.
            </p>
          </section>

          {/* 1. Information We Collect */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">1. Information We Collect</h2>

            <h3 className="text-lg font-semibold mb-2">Account Data</h3>
            <p className="leading-relaxed mb-4" style={{ color: 'var(--color-text-muted)' }}>
              When you create an account, we collect your email address, name, and authentication
              credentials. If you sign in with Google OAuth, we receive your name, email address,
              and profile picture from Google.
            </p>

            <h3 className="text-lg font-semibold mb-2">Health Data</h3>
            <p className="leading-relaxed mb-4" style={{ color: 'var(--color-text-muted)' }}>
              You may voluntarily provide health information including medications, medical conditions,
              allergies, procedures, lab results, vital signs, appointments, and personal health notes.
              You may also upload lab result PDFs for AI-powered extraction.
            </p>

            <h3 className="text-lg font-semibold mb-2">Device &amp; Wearable Data</h3>
            <p className="leading-relaxed mb-4" style={{ color: 'var(--color-text-muted)' }}>
              If you connect your Oura Ring account, we sync vitals data (such as heart rate, sleep
              scores, and activity metrics) with your explicit consent. This data is stored encrypted
              in our database.
            </p>

            <h3 className="text-lg font-semibold mb-2">Usage Data</h3>
            <p className="leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              We collect basic usage information such as pages visited, features used, and session
              duration to improve the application. We do not use third-party analytics trackers.
            </p>
          </section>

          {/* 2. How We Use Your Information */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">2. How We Use Your Information</h2>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              We use the information we collect to:
            </p>
            <ul className="list-disc list-inside space-y-2" style={{ color: 'var(--color-text-muted)' }}>
              <li>Provide, operate, and maintain the HealthTrack application</li>
              <li>Enable AI-powered health analysis and lab PDF parsing using Anthropic&apos;s Claude API</li>
              <li>Sync and display vitals data from connected devices like Oura Ring</li>
              <li>Allow you to share health data with providers or family members</li>
              <li>Improve and optimize the application experience</li>
              <li>Communicate with you about service updates or issues</li>
            </ul>
          </section>

          {/* 3. Third-Party Services */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">3. Third-Party Services</h2>
            <p className="leading-relaxed mb-4" style={{ color: 'var(--color-text-muted)' }}>
              HealthTrack integrates with the following third-party services:
            </p>

            <h3 className="text-lg font-semibold mb-2">Anthropic Claude API</h3>
            <p className="leading-relaxed mb-4" style={{ color: 'var(--color-text-muted)' }}>
              When you use AI health queries or upload lab PDFs for parsing, your health data is sent
              to Anthropic&apos;s Claude API for analysis. Anthropic does not store your health data
              after processing your request. Anthropic&apos;s data handling is governed by their own
              privacy policy and API terms of service.
            </p>

            <h3 className="text-lg font-semibold mb-2">Oura Ring API</h3>
            <p className="leading-relaxed mb-4" style={{ color: 'var(--color-text-muted)' }}>
              If you choose to connect your Oura Ring, we access your vitals data through the Oura
              API with your explicit consent. Oura data is synced and stored encrypted in our
              database. You can disconnect your Oura Ring at any time.
            </p>

            <h3 className="text-lg font-semibold mb-2">Google Authentication</h3>
            <p className="leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              If you sign in with Google, we use Google OAuth to authenticate your identity. We
              receive only your name, email, and profile picture. We do not access any other
              Google account data.
            </p>
          </section>

          {/* 4. Data Storage & Security */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">4. Data Storage &amp; Security</h2>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              We take the security of your health data seriously and implement the following measures:
            </p>
            <ul className="list-disc list-inside space-y-2" style={{ color: 'var(--color-text-muted)' }}>
              <li>AES-256-GCM encryption for OAuth tokens and sensitive credentials</li>
              <li>Per-user authorization checks on every data access, ensuring users can only access their own data</li>
              <li>Automatic session logout after 15 minutes of inactivity</li>
              <li>All health data stored locally on the server instance you run — it never leaves your infrastructure except for the optional integrations above</li>
              <li>HTTPS encryption for all data in transit</li>
            </ul>
            <p className="leading-relaxed mt-3" style={{ color: 'var(--color-text-muted)' }}>
              While we strive to protect your data, no method of electronic storage or transmission
              is 100% secure. We cannot guarantee absolute security.
            </p>
          </section>

          {/* 5. Health Data Sharing */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">5. Health Data Sharing</h2>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              Your health data sharing is entirely under your control:
            </p>
            <ul className="list-disc list-inside space-y-2" style={{ color: 'var(--color-text-muted)' }}>
              <li>You choose what health data sections to share and with whom</li>
              <li>Sharing can be revoked at any time</li>
              <li>We do not sell, rent, or trade your health data to any third party</li>
              <li>We do not use your health data for advertising purposes</li>
            </ul>
          </section>

          {/* 6. Data Retention & Deletion */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">6. Data Retention &amp; Deletion</h2>
            <p className="leading-relaxed mb-3" style={{ color: 'var(--color-text-muted)' }}>
              We retain your data for as long as your account is active. You may at any time:
            </p>
            <ul className="list-disc list-inside space-y-2" style={{ color: 'var(--color-text-muted)' }}>
              <li>Export your health data in JSON format</li>
              <li>Delete individual records or sections of your health data</li>
              <li>Delete your entire account, which permanently removes all associated data from our systems</li>
            </ul>
            <p className="leading-relaxed mt-3" style={{ color: 'var(--color-text-muted)' }}>
              After account deletion, your data is permanently removed from our active databases.
              Backups may retain data for up to 30 days before being purged.
            </p>
          </section>

          {/* 7. Cookies & Tracking */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">7. Cookies &amp; Tracking</h2>
            <p className="leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              HealthTrack uses minimal cookies, limited to authentication session cookies required for
              the application to function. We do not use advertising cookies, third-party tracking
              pixels, or analytics services that track you across other websites.
            </p>
          </section>

          {/* 8. Children's Privacy */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">8. Children&apos;s Privacy</h2>
            <p className="leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              HealthTrack is not intended for use by children under 13 years of age. We do not
              knowingly collect personal information from children under 13. HealthTrack does support
              dependent profiles (such as for minor children), which are created and managed by a
              parent or legal guardian. The parent or guardian is responsible for the dependent&apos;s
              data and must consent to its collection and use. If you believe a child under 13 has
              provided us with personal information without parental consent, please contact us so we
              can delete it.
            </p>
          </section>

          {/* 9. Changes to This Policy */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">9. Changes to This Policy</h2>
            <p className="leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              We may update this Privacy Policy from time to time. When we do, we will revise the
              &quot;Effective date&quot; at the top of this page. We encourage you to review this
              policy periodically. Continued use of HealthTrack after changes constitutes acceptance
              of the updated policy.
            </p>
          </section>

          {/* 10. Contact Information */}
          <section>
            <h2 className="text-xl md:text-2xl font-bold mb-4">10. Contact Information</h2>
            <p className="leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              If you have questions or concerns about this Privacy Policy or our data practices,
              please contact your instance administrator.
            </p>
          </section>
        </div>
      </main>

      {/* ---------- Footer ---------- */}
      <footer
        className="px-6 py-8 text-center text-sm"
        style={{
          borderTop: '1px solid var(--border-card)',
          color: 'var(--color-text-muted)',
        }}
      >
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-1">
            <span className="font-bold" style={{ color: 'var(--color-sage)' }}>
              Health
            </span>
            <span className="font-bold" style={{ color: 'var(--color-text-primary)' }}>
              Track
            </span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="no-underline hover:underline" style={{ color: 'var(--color-text-muted)' }}>
              Privacy Policy
            </Link>
            <Link href="/terms" className="no-underline hover:underline" style={{ color: 'var(--color-text-muted)' }}>
              Terms of Service
            </Link>
          </div>
          <p>&copy; 2026 HealthTrack. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
