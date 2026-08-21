-- The address a builder can actually find, with the house number on it.
--
-- 2026-08-21. Rightmove publishes no house number on 96.6% of adverts, so
-- brrr_properties.address is a street and a postcode. The WhatsApp invite that
-- went to Lunar Builders carried exactly that: "Oundle Road, Kingstanding,
-- Birmingham B44 8EP". Shakeel replied the same minute asking for the full
-- address, nobody answered him for 41 hours, and he cancelled on the morning of
-- the viewing saying he "needed the full address in advance and didn't receive
-- it in time". A builder cannot be sent to a street.
--
-- The number IS knowable: the branch puts it in the viewing confirmation email.
-- Ben Rose's read "Re: 10, Stevenson Avenue, Farington, Leyland, PR25 4GQ".
--
-- A SEPARATE COLUMN rather than a correction to `address`, on purpose. Two
-- modules read the street as address.split(',')[0] (api/lib/draft-guards.ts and
-- api/lib/branch-email-match.ts), so a leading "10, " would turn the street
-- name into a house number for both, and branch email matching would stop
-- matching.

alter table brrr_properties add column if not exists viewing_address text;

comment on column brrr_properties.viewing_address is
  'Full address including the house number, for the builder invite. Comes from the branch''s viewing confirmation email. Never parsed for a street name: use address for that.';
