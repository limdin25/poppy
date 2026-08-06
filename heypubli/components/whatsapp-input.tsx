"use client";

import { PhoneInput } from "react-international-phone";
import "react-international-phone/style.css";

interface WhatsAppInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Name of the hidden input that carries the E.164 value in a form submit. */
  name?: string;
}

// One unified, square bordered field: [ flag v | +55 number ]. Borders live on the
// container so the flag selector and the number input line up cleanly and match the
// height/radius of the other form inputs.
//
// The container must NOT be overflow-hidden. The country list is a child of it, so
// clipping the container clips the dropdown down to a 30px sliver and nobody can change
// country. The rounded corners are done per child instead.
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
        className="flex w-full items-stretch rounded-lg border border-border bg-white focus-within:border-accent"
        countrySelectorStyleProps={{
          buttonStyle: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            borderRight: "1px solid #E5E7EB",
            borderRadius: "0.5rem 0 0 0.5rem",
            background: "transparent",
            padding: "0 10px",
            height: "100%",
          },
          dropdownStyleProps: { style: { zIndex: 30 } },
        }}
        inputStyle={{
          border: "none",
          borderRadius: "0 0.5rem 0.5rem 0",
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
