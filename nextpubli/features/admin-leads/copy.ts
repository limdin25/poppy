export const adminLeadsCopy = {
  title: "Signups",
  subtitle:
    "Everyone in the funnel, whichever door they came through: Facebook recruits, paying customers and self-serve signups.",
  emptyTitle: "No signups yet",
  emptyBody:
    "As soon as somebody enters the funnel (a Facebook lead form, the signup wizard, or an affiliate purchase) they appear here.",
  stats: {
    total: "In the funnel",
    sent: "Sent to Instagram",
    connected: "Connected",
    lost: "Not connected yet",
  },
  columns: {
    person: "Person",
    contact: "Contact",
    stage: "Got as far as",
    when: "First seen",
    actions: "",
  },
  lanes: {
    partner: "Partner",
    customer: "Customer",
    organic: "Organic",
  },
  laneHint: {
    partner: "Facebook recruit. Free community invite.",
    customer: "Buyer via an affiliate link. Pays for the community.",
    organic: "Found the site on their own. Invite only with approval.",
  },
  stages: {
    captured: "Captured from the ad",
    contacted: "First WhatsApp sent",
    engaged: "Replied on WhatsApp",
    started: "Answered the questions",
    sent_to_instagram: "Sent to Instagram",
    connected: "Connected",
    invited: "In the community",
  },
  stageHint: {
    captured: "Lead form received, nothing sent yet",
    contacted: "Welcome message delivered, no reply yet",
    engaged: "In conversation on WhatsApp",
    started: "Never pressed Connect Instagram",
    sent_to_instagram: "Pressed Connect but did not finish at Instagram",
    connected: "Account created",
    invited: "Skool invite confirmed",
  },
  approval: {
    heading: "Waiting for your approval",
    explainer:
      "Self-serve signups. Approve to promote them to partner and send the free community invite; reject to leave them as a normal creator.",
    approve: "Approve + invite",
    reject: "No invite",
    approved: "Approved",
    rejected: "No invite",
  },
  attempts: (n: number) => (n > 1 ? `${n} attempts` : "1 attempt"),
  csvLabel: "Download CSV",
} as const;
