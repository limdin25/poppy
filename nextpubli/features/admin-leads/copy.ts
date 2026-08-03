export const adminLeadsCopy = {
  title: "Signups",
  subtitle:
    "Everyone who answered the three signup questions, whether or not they went on to connect Instagram.",
  emptyTitle: "No signups yet",
  emptyBody:
    "As soon as somebody finishes the name, email and mobile questions on /signup they appear here, even if they never connect Instagram.",
  stats: {
    total: "Answered the questions",
    sent: "Sent to Instagram",
    connected: "Connected",
    lost: "Not connected yet",
  },
  columns: {
    person: "Person",
    contact: "Contact",
    stage: "Got as far as",
    when: "First seen",
  },
  stages: {
    started: "Answered the questions",
    sent_to_instagram: "Sent to Instagram",
    connected: "Connected",
  },
  stageHint: {
    started: "Never pressed Connect Instagram",
    sent_to_instagram: "Pressed Connect but did not finish at Instagram",
    connected: "Account created",
  },
  attempts: (n: number) => (n > 1 ? `${n} attempts` : "1 attempt"),
  csvLabel: "Download CSV",
} as const;
