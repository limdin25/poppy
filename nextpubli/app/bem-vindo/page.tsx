import Link from "next/link";
import { ContactCaptureForm } from "@/features/contact-capture";

export default function BemVindoPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-8">
        <Link href="/" className="inline-block">
          <span
            className="text-2xl font-bold"
            style={{
              background: "linear-gradient(135deg, #F56040, #E1306C, #C13584)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            NextPubli
          </span>
        </Link>
        <ContactCaptureForm />
      </div>
    </main>
  );
}
