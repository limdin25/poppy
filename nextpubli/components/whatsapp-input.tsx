"use client";

import { PhoneInput } from "react-international-phone";
import "react-international-phone/style.css";

interface WhatsAppInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Name of the hidden input that carries the E.164 value in a form submit. */
  name?: string;
}

// One unified, square bordered field: [ 🇧🇷 ▾ | +55 number… ] — borders live on the
// container so the flag selector and the number input line up cleanly and match the
// height/radius of the other form inputs.
export function WhatsAppInput({
  value,
  onChange,
  name = "whatsapp",
}: WhatsAppInputProps) {
  return (
    <>
      <PhoneInput
        defaultCountry="br"
        value={value}
        onChange={(phone) => onChange(phone)}
        className="flex w-full items-stretch overflow-hidden rounded-lg border border-border bg-white focus-within:border-accent"
        countrySelectorStyleProps={{
          buttonStyle: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            borderRight: "1px solid #E5E7EB",
            borderRadius: 0,
            background: "transparent",
            padding: "0 10px",
            height: "100%",
          },
        }}
        inputStyle={{
          border: "none",
          borderRadius: 0,
          padding: "0 0.75rem",
          fontSize: "0.95rem",
          width: "100%",
          height: "42px",
          background: "transparent",
        }}
      />
      {/* The form submits the full E.164 number (e.g. +5511999998888). */}
      <input type="hidden" name={name} value={value} />
    </>
  );
}
