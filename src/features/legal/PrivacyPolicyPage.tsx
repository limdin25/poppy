import { Link } from 'react-router-dom'

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Link to="/welcome" className="text-sm text-indigo-600 hover:text-indigo-800">
          &larr; Back to Hey Elsie
        </Link>

        <h1 className="mt-6 text-3xl font-bold text-gray-900">Privacy Policy</h1>
        <p className="mt-2 text-sm text-gray-500">Last updated: 7 May 2026</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-gray-700">
          <section>
            <h2 className="text-lg font-semibold text-gray-900">1. Who we are</h2>
            <p className="mt-2">
              Hey Elsie ("we", "us", "our") is an AI receptionist service operated by Hey Elsie Ltd. We provide businesses with AI-powered call answering, message handling, and appointment booking services. Our registered address is in the United Kingdom.
            </p>
            <p className="mt-2">
              For the purposes of data protection legislation, we act as a <strong>data processor</strong> when handling personal data on behalf of our business customers (the "data controllers"). We act as a <strong>data controller</strong> for the personal data of our business customers themselves.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">2. What data we collect</h2>

            <h3 className="mt-4 font-semibold text-gray-800">From business customers (B2B)</h3>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>Account details: name, email, phone number, business name, business address</li>
              <li>Payment information: processed and stored securely by Stripe</li>
              <li>Service configuration: services offered, pricing, FAQs, working hours, greeting preferences</li>
              <li>Connected account credentials: Google Calendar OAuth tokens, messaging platform connections</li>
            </ul>

            <h3 className="mt-4 font-semibold text-gray-800">From end consumers (on behalf of business customers)</h3>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>Contact details: name, phone number, email address</li>
              <li>Communication content: call transcripts, WhatsApp messages, Instagram DMs, emails</li>
              <li>Appointment details: date, time, service booked, booking confirmations</li>
              <li>Call recordings and AI-generated summaries</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">3. How we use data</h2>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>To provide AI receptionist services: answering calls, responding to messages, booking appointments</li>
              <li>To generate AI responses using the business's configured context (services, FAQs, tone)</li>
              <li>To process billing: recording bookings, generating invoices, processing payments</li>
              <li>To send notifications: daily summaries, calendar alerts, billing updates</li>
              <li>To maintain and improve our service: monitoring system health, debugging errors</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">4. Legal basis for processing</h2>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li><strong>Contract performance:</strong> processing business customer data to provide our service</li>
              <li><strong>Legitimate interests:</strong> processing end consumer data on behalf of business customers to deliver the AI receptionist service</li>
              <li><strong>Consent:</strong> where required, such as call recording disclosures</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">5. Sub-processors</h2>
            <p className="mt-2">We use the following sub-processors to deliver our service:</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-4 font-semibold">Provider</th>
                    <th className="py-2 pr-4 font-semibold">Purpose</th>
                    <th className="py-2 font-semibold">Location</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr><td className="py-2 pr-4">Supabase (AWS)</td><td className="py-2 pr-4">Database and authentication</td><td className="py-2">EU (eu-west-2)</td></tr>
                  <tr><td className="py-2 pr-4">Anthropic</td><td className="py-2 pr-4">AI language model (Claude)</td><td className="py-2">USA</td></tr>
                  <tr><td className="py-2 pr-4">Retell AI</td><td className="py-2 pr-4">AI voice agent</td><td className="py-2">USA</td></tr>
                  <tr><td className="py-2 pr-4">Twilio</td><td className="py-2 pr-4">Phone number and call routing</td><td className="py-2">USA</td></tr>
                  <tr><td className="py-2 pr-4">Unipile</td><td className="py-2 pr-4">WhatsApp and email integration</td><td className="py-2">France</td></tr>
                  <tr><td className="py-2 pr-4">Stripe</td><td className="py-2 pr-4">Payment processing</td><td className="py-2">USA/EU</td></tr>
                  <tr><td className="py-2 pr-4">Vercel</td><td className="py-2 pr-4">Application hosting</td><td className="py-2">Global</td></tr>
                  <tr><td className="py-2 pr-4">Resend</td><td className="py-2 pr-4">Transactional email delivery</td><td className="py-2">USA</td></tr>
                  <tr><td className="py-2 pr-4">Google</td><td className="py-2 pr-4">Calendar integration</td><td className="py-2">Global</td></tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2">
              For US-based sub-processors, we rely on Standard Contractual Clauses (SCCs) and the UK International Data Transfer Agreement where applicable.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">6. Data retention</h2>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>Call transcripts and recordings: 90 days after the call, then automatically deleted</li>
              <li>Messages (WhatsApp, email, Instagram): retained while the business account is active, deleted within 30 days of account closure</li>
              <li>Appointment records: retained while the business account is active</li>
              <li>Billing records: retained for 7 years as required by UK tax law</li>
              <li>Account data: retained while the account is active, deleted within 30 days of closure</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">7. Your rights (UK GDPR)</h2>
            <p className="mt-2">
              If you are a business customer, you have the right to:
            </p>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>Access your personal data</li>
              <li>Rectify inaccurate data</li>
              <li>Erase your data ("right to be forgotten")</li>
              <li>Restrict processing</li>
              <li>Data portability</li>
              <li>Object to processing</li>
            </ul>
            <p className="mt-2">
              If you are an end consumer whose data we process on behalf of a business, please contact the business directly. They are the data controller and will coordinate with us to fulfil your request.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">8. AI disclosure</h2>
            <p className="mt-2">
              Hey Elsie uses artificial intelligence to answer phone calls, respond to messages, and book appointments. Callers are informed at the start of each call that they are speaking with an AI assistant. Messages sent by AI include identification that they were composed by Elsie AI.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">9. Cookies</h2>
            <p className="mt-2">
              We use strictly necessary cookies for authentication and session management. We do not use advertising or tracking cookies.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">10. Contact</h2>
            <p className="mt-2">
              For privacy-related enquiries, data access requests, or complaints:
            </p>
            <p className="mt-2">
              Email: <a href="mailto:privacy@heyelsie.com" className="text-indigo-600 hover:underline">privacy@heyelsie.com</a>
            </p>
            <p className="mt-2">
              You also have the right to lodge a complaint with the Information Commissioner's Office (ICO) at <a href="https://ico.org.uk" className="text-indigo-600 hover:underline" target="_blank" rel="noopener noreferrer">ico.org.uk</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
