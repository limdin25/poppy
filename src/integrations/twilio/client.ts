function getCredentials() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set");
  return { accountSid, authToken };
}

function getAuthHeader(): string {
  const { accountSid, authToken } = getCredentials();
  return "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
}

function baseUrl(): string {
  const { accountSid } = getCredentials();
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}`;
}

const TRUNKING_BASE = "https://trunking.twilio.com/v1/Trunks";

// --- Types ---

export interface TwilioNumber {
  phone_number: string;
  friendly_name: string;
  sid: string;
  [key: string]: unknown;
}

export interface TwilioProvisionedNumber {
  sid: string;
  phone_number: string;
  [key: string]: unknown;
}

export interface TwilioSipTrunk {
  sid: string;
  friendly_name: string;
  [key: string]: unknown;
}

// --- Functions ---

/** Search for available phone numbers in a given country/area code. */
export async function searchNumbers(
  countryCode: string,
  areaCode?: string
): Promise<TwilioNumber[]> {
  const params = new URLSearchParams();
  if (areaCode) params.set("AreaCode", areaCode);

  const url = `${baseUrl()}/AvailablePhoneNumbers/${countryCode}/Local.json?${params}`;
  const res = await fetch(url, { headers: { Authorization: getAuthHeader() } });
  if (!res.ok) throw new Error(`Twilio searchNumbers failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.available_phone_numbers;
}

/** Provision (purchase) a phone number. */
export async function provisionNumber(
  phoneNumber: string
): Promise<TwilioProvisionedNumber> {
  const body = new URLSearchParams({ PhoneNumber: phoneNumber });
  const res = await fetch(`${baseUrl()}/IncomingPhoneNumbers.json`, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`Twilio provisionNumber failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Create a SIP trunk and associate a phone number with it. */
export async function createSipTrunk(
  numberSid: string
): Promise<TwilioSipTrunk> {
  // Create trunk
  const trunkRes = await fetch(TRUNKING_BASE, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ FriendlyName: `trunk-${numberSid}` }),
  });
  if (!trunkRes.ok) throw new Error(`Twilio createSipTrunk failed: ${trunkRes.status} ${await trunkRes.text()}`);
  const trunk = await trunkRes.json();

  // Associate number with trunk
  const assocRes = await fetch(`${TRUNKING_BASE}/${trunk.sid}/PhoneNumbers`, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ PhoneNumberSid: numberSid }),
  });
  if (!assocRes.ok) throw new Error(`Twilio associateNumber failed: ${assocRes.status} ${await assocRes.text()}`);

  return trunk;
}

/** Release (delete) a provisioned phone number. */
export async function releaseNumber(numberSid: string): Promise<void> {
  const res = await fetch(`${baseUrl()}/IncomingPhoneNumbers/${numberSid}.json`, {
    method: "DELETE",
    headers: { Authorization: getAuthHeader() },
  });
  if (!res.ok) throw new Error(`Twilio releaseNumber failed: ${res.status} ${await res.text()}`);
}
