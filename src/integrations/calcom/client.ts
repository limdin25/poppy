const BASE_URL = "https://api.cal.com/v1";

function getApiKey(): string {
  const key = process.env.CALCOM_API_KEY;
  if (!key) throw new Error("CALCOM_API_KEY is not set");
  return key;
}

// --- Types ---

export interface CalAvailabilitySlot {
  time: string;
  [key: string]: unknown;
}

export interface CalBooking {
  id: number;
  uid: string;
  title: string;
  startTime: string;
  endTime: string;
  [key: string]: unknown;
}

// --- Functions ---

/** Get available time slots for an event type within a date range. */
export async function getAvailability(
  eventTypeId: number,
  startDate: string,
  endDate: string
): Promise<CalAvailabilitySlot[]> {
  const params = new URLSearchParams({
    apiKey: getApiKey(),
    eventTypeId: String(eventTypeId),
    startTime: startDate,
    endTime: endDate,
  });

  const res = await fetch(`${BASE_URL}/availability?${params}`);
  if (!res.ok) throw new Error(`Cal.com getAvailability failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.slots ?? data;
}

/** Create a booking for an event type. */
export async function createBooking(
  eventTypeId: number,
  start: string,
  name: string,
  email: string,
  notes?: string
): Promise<CalBooking> {
  const res = await fetch(`${BASE_URL}/bookings?apiKey=${getApiKey()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventTypeId,
      start,
      responses: { name, email },
      metadata: { notes: notes || "" },
    }),
  });
  if (!res.ok) throw new Error(`Cal.com createBooking failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Cancel an existing booking by its ID. */
export async function cancelBooking(bookingId: number): Promise<void> {
  const res = await fetch(`${BASE_URL}/bookings/${bookingId}/cancel?apiKey=${getApiKey()}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Cal.com cancelBooking failed: ${res.status} ${await res.text()}`);
}
