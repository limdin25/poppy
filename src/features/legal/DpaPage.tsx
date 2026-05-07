import { Link } from 'react-router-dom'

export default function DpaPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Link to="/welcome" className="text-sm text-indigo-600 hover:text-indigo-800">
          &larr; Back to Hey Elsie
        </Link>

        <h1 className="mt-6 text-3xl font-bold text-gray-900">Data Processing Agreement</h1>
        <p className="mt-2 text-sm text-gray-500">Last updated: 7 May 2026</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-gray-700">
          <section>
            <p>
              This Data Processing Agreement ("DPA") forms part of the Terms of Service between Hey Elsie Ltd ("Processor", "we") and the business customer ("Controller", "you") and applies to the processing of personal data by the Processor on behalf of the Controller under UK GDPR.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">1. Definitions</h2>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li><strong>"Personal Data"</strong> means any information relating to an identified or identifiable natural person processed by the Processor on behalf of the Controller</li>
              <li><strong>"Processing"</strong> means any operation performed on Personal Data, including collection, storage, use, disclosure, and deletion</li>
              <li><strong>"Data Subject"</strong> means the individual whose Personal Data is processed (your customers, callers, message senders)</li>
              <li><strong>"Sub-processor"</strong> means a third party engaged by the Processor to process Personal Data</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">2. Scope of processing</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  <tr><td className="py-2 pr-4 font-semibold align-top">Subject matter</td><td className="py-2">Provision of AI receptionist services</td></tr>
                  <tr><td className="py-2 pr-4 font-semibold align-top">Duration</td><td className="py-2">For the duration of the service agreement plus 30 days</td></tr>
                  <tr><td className="py-2 pr-4 font-semibold align-top">Nature and purpose</td><td className="py-2">Answering phone calls, responding to messages, booking appointments, generating AI responses, recording call transcripts</td></tr>
                  <tr><td className="py-2 pr-4 font-semibold align-top">Types of data</td><td className="py-2">Names, phone numbers, email addresses, message content, call recordings, call transcripts, appointment details</td></tr>
                  <tr><td className="py-2 pr-4 font-semibold align-top">Data subjects</td><td className="py-2">Your customers, callers, and anyone who sends messages to your connected channels</td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">3. Processor obligations</h2>
            <p className="mt-2">The Processor shall:</p>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>Process Personal Data only on documented instructions from the Controller (i.e. to provide the agreed service)</li>
              <li>Ensure persons authorised to process Personal Data are bound by confidentiality obligations</li>
              <li>Implement appropriate technical and organisational security measures</li>
              <li>Not engage Sub-processors without prior general authorisation from the Controller (see Section 5)</li>
              <li>Assist the Controller in responding to Data Subject requests (access, rectification, erasure, portability)</li>
              <li>Assist the Controller in ensuring compliance with GDPR obligations regarding security, breach notification, and data protection impact assessments</li>
              <li>Delete or return all Personal Data upon termination of the service, unless retention is required by law</li>
              <li>Make available all information necessary to demonstrate compliance and allow audits</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">4. Security measures</h2>
            <p className="mt-2">We implement the following security measures:</p>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>Encryption in transit (TLS 1.2+) for all data transfers</li>
              <li>Encryption at rest for all stored data (AES-256 via Supabase/AWS)</li>
              <li>Row Level Security (RLS) ensuring each business can only access their own data</li>
              <li>Authentication via Supabase Auth with secure JWT tokens</li>
              <li>API keys and secrets stored as environment variables, never in code</li>
              <li>Regular security reviews and dependency updates</li>
              <li>Access logging and audit trails for admin actions</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">5. Sub-processors</h2>
            <p className="mt-2">
              By agreeing to this DPA, you provide general authorisation for us to engage Sub-processors. The current list of Sub-processors is published in our <Link to="/privacy" className="text-indigo-600 hover:underline">Privacy Policy</Link>. We will notify you by email at least 30 days before adding a new Sub-processor. You may object to a new Sub-processor within 14 days; if we cannot accommodate the objection, either party may terminate the agreement.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">6. International transfers</h2>
            <p className="mt-2">
              Some Sub-processors are located outside the UK/EEA (primarily in the USA). For these transfers, we rely on:
            </p>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>Standard Contractual Clauses (SCCs) approved by the European Commission</li>
              <li>The UK International Data Transfer Agreement (IDTA) where applicable</li>
              <li>Sub-processor-specific data processing agreements covering GDPR requirements</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">7. Data breach notification</h2>
            <p className="mt-2">
              In the event of a Personal Data breach, we will notify you without undue delay and in any event within 72 hours of becoming aware of the breach. The notification will include:
            </p>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>The nature of the breach</li>
              <li>Categories and approximate number of Data Subjects affected</li>
              <li>Likely consequences of the breach</li>
              <li>Measures taken or proposed to address the breach</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">8. Data Subject requests</h2>
            <p className="mt-2">
              If we receive a request from a Data Subject regarding their Personal Data, we will promptly redirect them to you (the Controller). We will assist you in fulfilling Data Subject requests using our admin tools, including data export and deletion capabilities.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">9. Data retention and deletion</h2>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>Upon termination of the service, we will delete all Personal Data within 30 days</li>
              <li>Call transcripts and recordings are automatically deleted after 90 days</li>
              <li>Billing records are retained for 7 years as required by UK tax law (HMRC)</li>
              <li>You may request earlier deletion at any time via our admin tools or by contacting us</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">10. AI-specific provisions</h2>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>Personal Data sent to AI models (Anthropic Claude, Retell AI) is processed in real-time and not retained by the AI provider for training</li>
              <li>AI-generated responses are created on-demand using only your business context and the current conversation</li>
              <li>We do not use your customers' data to train, fine-tune, or improve AI models</li>
              <li>Call transcripts sent for AI summarisation are processed transiently and not stored by the AI provider</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">11. Audit rights</h2>
            <p className="mt-2">
              You may audit our compliance with this DPA by providing 30 days' written notice. We will cooperate with the audit and provide reasonable access to relevant documentation. Audits shall be conducted during normal business hours and shall not unreasonably disrupt our operations.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">12. Governing law</h2>
            <p className="mt-2">
              This DPA is governed by the laws of England and Wales and is subject to the jurisdiction of the courts of England and Wales.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">13. Contact</h2>
            <p className="mt-2">
              For DPA-related enquiries: <a href="mailto:privacy@heyelsie.com" className="text-indigo-600 hover:underline">privacy@heyelsie.com</a>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
