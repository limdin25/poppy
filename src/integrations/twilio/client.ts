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

/** Search for available phone numbers in a given country/area code.
 *  UK note: SMS-capable numbers are type "Mobile" (07…) — GB "Local" numbers
 *  can't text. */
export async function searchNumbers(
  countryCode: string,
  areaCode?: string,
  type: "Local" | "Mobile" = "Local",
  smsEnabled = false
): Promise<TwilioNumber[]> {
  const params = new URLSearchParams();
  if (areaCode) params.set("AreaCode", areaCode);
  if (smsEnabled) params.set("SmsEnabled", "true");

  const url = `${baseUrl()}/AvailablePhoneNumbers/${countryCode}/${type}.json?${params}`;
  const res = await fetch(url, { headers: { Authorization: getAuthHeader() } });
  if (!res.ok) throw new Error(`Twilio searchNumbers failed: ${res.status} ${await res.text()}`);
  const data = await res.json() as { available_phone_numbers: TwilioNumber[] };
  return data.available_phone_numbers;
}

/** Provision (purchase) a phone number. Regulated countries (e.g. GB mobile)
 *  require an approved regulatory BundleSid + validated AddressSid. */
export async function provisionNumber(
  phoneNumber: string,
  opts?: { bundleSid?: string; addressSid?: string }
): Promise<TwilioProvisionedNumber> {
  const body = new URLSearchParams({ PhoneNumber: phoneNumber });
  if (opts?.bundleSid) body.set("BundleSid", opts.bundleSid);
  if (opts?.addressSid) body.set("AddressSid", opts.addressSid);
  const res = await fetch(`${baseUrl()}/IncomingPhoneNumbers.json`, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`Twilio provisionNumber failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<TwilioProvisionedNumber>;
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
  const trunk = await trunkRes.json() as TwilioSipTrunk;

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

/** Send an SMS message. Uses btoa() for Edge runtime compatibility. */
export async function sendSMS(
  from: string,
  to: string,
  body: string,
  opts?: { statusCallback?: string; mediaUrl?: string }
): Promise<{ sid: string }> {
  const { accountSid, authToken } = getCredentials();
  const auth = "Basic " + btoa(`${accountSid}:${authToken}`);
  const params = new URLSearchParams({ From: from, To: to, Body: body });
  if (opts?.statusCallback) params.set("StatusCallback", opts.statusCallback);
  if (opts?.mediaUrl) params.set("MediaUrl", opts.mediaUrl);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  if (!res.ok) throw new Error(`Twilio sendSMS failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ sid: string }>;
}

/** Point a purchased number's inbound-SMS webhook at a URL. */
export async function setNumberSmsUrl(numberSid: string, smsUrl: string): Promise<void> {
  const res = await fetch(`${baseUrl()}/IncomingPhoneNumbers/${numberSid}.json`, {
    method: "POST",
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ SmsUrl: smsUrl, SmsMethod: "POST" }),
  });
  if (!res.ok) throw new Error(`Twilio setNumberSmsUrl failed: ${res.status} ${await res.text()}`);
}
