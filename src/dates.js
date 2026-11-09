'use strict';

const TZ = process.env.TZ_DISPLAY || 'Europe/Istanbul';
const isoFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ });

// Today's calendar date (YYYY-MM-DD) in the panel's timezone, not UTC.
function today(now = new Date()) {
  return isoFmt.format(now);
}

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = { TZ, today, addDays };
