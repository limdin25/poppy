import { Link } from 'react-router-dom'

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Link to="/welcome" className="text-sm text-indigo-600 hover:text-indigo-800">
          &larr; Back to Hey Elsie
        </Link>

        <h1 className="mt-6 text-3xl font-bold text-gray-900">Terms of Service</h1>
        <p className="mt-2 text-sm text-gray-500">Last updated: 7 May 2026</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-gray-700">
          <section>
            <h2 className="text-lg font-semibold text-gray-900">1. The service</h2>
            <p className="mt-2">
              Hey Elsie provides an AI-powered receptionist service for businesses. This includes AI phone answering, AI message responses (WhatsApp, email, Instagram), and AI appointment booking into Google Calendar.
            </p>
            <p className="mt-2">
              By using Hey Elsie, you agree to these terms. If you do not agree, do not use the service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">2. Account and access</h2>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>You must provide accurate business information during setup</li>
              <li>You are responsible for maintaining the security of your account credentials</li>
              <li>You must have the authority to connect messaging accounts and calendars on behalf of your business</li>
              <li>One account per business. Multiple locations require separate accounts</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">3. Pricing and billing</h2>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li><strong>No setup fee:</strong> There is no activation fee or upfront cost. You pay nothing until Elsie books you a job.</li>
              <li><strong>Per-booking fee:</strong> {'\u00a3'}20/$20/{'\u20ac'}20 per appointment booked by Elsie AI into your Google Calendar.</li>
              <li><strong>Monthly cap:</strong> You will never pay more than {'\u00a3'}189/$189/{'\u20ac'}189 per 30-day billing cycle, regardless of the number of bookings.</li>
              <li><strong>Free services:</strong> AI-answered calls, AI-sent messages, and message handling are free. You only pay for completed bookings.</li>
              <li><strong>Manual bookings:</strong> Appointments you book yourself (not through Elsie) are never charged.</li>
              <li><strong>Billing cycle:</strong> 30 days from your activation date. Invoiced at the end of each cycle via Stripe.</li>
              <li><strong>Zero-usage months:</strong> If Elsie makes no bookings in a cycle, no invoice is generated.</li>
              <li><strong>Cancelled bookings:</strong> If a customer cancels an appointment after Elsie books it, the booking fee still applies. The booking was created; the cancellation is between you and your customer.</li>
              <li><strong>Disputes:</strong> You may dispute a booking charge if Elsie made an error (wrong time, wrong service, duplicate). Submit disputes through your billing dashboard. We review and credit your account if approved.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">4. AI disclosure</h2>
            <p className="mt-2">
              Elsie identifies itself as an AI assistant at the start of every phone call. Messages sent by Elsie may include an AI disclosure. You agree that your customers will be informed they are interacting with an AI system. You must not instruct Elsie to hide that it is AI.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">5. Your responsibilities</h2>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>Keep your business information, services, prices, and FAQs up to date so Elsie gives accurate information</li>
              <li>Maintain a valid payment method on file</li>
              <li>Inform your customers that an AI assistant may handle their enquiries (we recommend adding a note to your voicemail greeting and website)</li>
              <li>Comply with GDPR and applicable data protection law for your customers' data</li>
              <li>Do not use Hey Elsie for illegal purposes, spam, or to mislead consumers</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">6. Limitations of the AI</h2>
            <p className="mt-2">
              Elsie is an AI assistant and may occasionally make mistakes. While we strive for accuracy, we do not guarantee that every response, booking, or piece of information will be correct. You should review your calendar and messages regularly.
            </p>
            <p className="mt-2">
              Hey Elsie is not liable for losses arising from incorrect AI responses, missed messages, or booking errors. Our liability is limited to the fees you have paid in the 12 months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">7. Service availability</h2>
            <p className="mt-2">
              We aim for 99.9% uptime but do not guarantee uninterrupted service. Planned maintenance will be communicated in advance. We are not responsible for downtime caused by third-party services (Twilio, Google, WhatsApp, etc.).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">8. Payment failures</h2>
            <p className="mt-2">
              If a payment fails, Stripe will retry automatically. Elsie will continue working during payment retries. After 14 days of failed payments, we may pause Elsie's services until the payment is resolved. We will notify you by email before any pause.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">9. Cancellation</h2>
            <ul className="mt-2 list-disc pl-6 space-y-1">
              <li>You can cancel at any time from your account dashboard or by contacting us</li>
              <li>No lock-in period, no exit fees</li>
              <li>Upon cancellation, you will be charged for bookings made up to the cancellation date</li>
              <li>Your data will be retained for 30 days after cancellation, then deleted</li>
              <li>Billing records are retained for 7 years as required by UK tax law</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">10. Intellectual property</h2>
            <p className="mt-2">
              Hey Elsie, the Elsie name, and the service platform are our intellectual property. Your business data remains yours. We do not use your data to train AI models. AI responses generated for your customers are created on-demand and not stored beyond what is needed to provide the service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">11. Governing law</h2>
            <p className="mt-2">
              These terms are governed by the laws of England and Wales. Disputes will be resolved in the courts of England and Wales.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">12. Changes to terms</h2>
            <p className="mt-2">
              We may update these terms from time to time. We will notify you by email of material changes at least 30 days before they take effect. Continued use of the service constitutes acceptance of the updated terms.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">13. Contact</h2>
            <p className="mt-2">
              Email: <a href="mailto:hello@heyelsie.com" className="text-indigo-600 hover:underline">hello@heyelsie.com</a>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
