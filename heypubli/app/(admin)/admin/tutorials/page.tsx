import { TutorialIndex } from "@/features/tutorials";

export const metadata = {
  title: "Tutorials | HeyPubli Admin",
};

export default function AdminTutorialsPage() {
  // Shown next to each class so Hugo can copy the public address without
  // guessing at it. Falls back to the production domain when the env var is
  // absent, which is the case in local dev and in tests.
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://heypubli.com").replace(/\/$/, "");

  return <TutorialIndex baseUrl={baseUrl} />;
}
