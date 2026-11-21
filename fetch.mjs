// Fetches free padel courts for Utrecht clubs and writes public/index.html
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const DAYS = 21; // aantal dagen vooruit (3 weken)
const FOYS = [
  { key: 'vecht', fed: 'df82f4dd-fd87-4af5-9c2f-656fe1a44357', loc: 'd9b0cde9-9ab6-4859-87b3-563c7ba1ccb9', rt: 6 },
  { key: 'zee',   fed: 'df82f4dd-fd87-4af5-9c2f-656fe1a44357', loc: 'f37fb2ae-bf24-44f1-9b81-61e6c0784840', rt: 6 },
  { key: 'casa',  fed: '59ebda71-857f-46ab-1a08-08dc922b4e2e', loc: 'd8c1d061-6306-46d7-84a7-d6ed6560ab82', rt: 145 },
];
const TENANT = '01879bb0-bc6c-4ec0-9a25-487304ea0057';
const PT_RESOURCES = { resources: [
  { resource_id: 'c53e74f3-1fb0-41eb-be26-7f76d3ce8edb', name: 'Premier Baan 1', sport_id: 'PADEL', properties: { resource_type: 'indoor', resource_size: 'double' } },
  { resource_id: '8f715fd9-0c18-4a1a-918b-c00e51e959ce', name: 'Premier Baan 2', sport_id: 'PADEL', properties: { resource_type: 'indoor', resource_size: 'double' } },
]};

const amsDate = (offset) => {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(d); // YYYY-MM-DD
};
async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 Padelbord', ...headers } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

const dates = Array.from({ length: DAYS }, (_, i) => amsDate(i));
const raw = { generated: new Date().toISOString(), dates, foys: {}, pt: { tenant: PT_RESOURCES, err: null, avail: {} } };

for (const c of FOYS) {
  const entry = { data: {}, err: {} };
  for (const d of dates) {
    const u = `https://api.foys.io/court-booking/public/api/v1/locations/search?reservationTypeId=${c.rt}&locationId=${c.loc}&playingTimes[]=60&playingTimes[]=90&playingTimes[]=120&date=${d}T00:00`;
    try {
      const j = await getJson(u, { 'X-FederationID': c.fed });
      const items = (j[0] && j[0].inventoryItemsTimeSlots) || [];
      entry.data[d] = [{ inventoryItemsTimeSlots: items.map(it => ({
        name: it.name, type: it.type,
        timeSlots: (it.timeSlots || []).filter(s => s.isAvailable)
          .map(s => ({ startTime: s.startTime, duration: s.duration, price: s.price, isAvailable: true })),
      })) }];
    }
    catch (e) { entry.err[d] = e.message; }
  }
  raw.foys[c.key] = entry;
  console.log(c.key, 'ok', Object.keys(entry.data).length, 'errors', Object.keys(entry.err).length);
}

// Playtomic's website blocks requests that do not look like a browser, so ask like one.
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'nl-NL,nl;q=0.9,en;q=0.8',
  'Referer': 'https://playtomic.com/clubs/padel-fabrique',
  'Origin': 'https://playtomic.com',
};
async function getPlaytomic(url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await fetch(url, { headers: BROWSER_HEADERS });
    if (r.ok) return r.json();
    const body = (await r.text()).replace(/<[^>]*>/g, ' ').replace(/[<>&"]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const msg = `HTTP ${r.status} (server: ${r.headers.get('server') || '?'}) ${body}`;
    if (attempt === 2) throw new Error(msg);
    console.log('playtomic retry after', msg);
    await new Promise(res => setTimeout(res, 3000));
  }
}

let ptFails = 0;
const ptDates = [amsDate(-1), ...dates];
for (const d of ptDates) {
  try { raw.pt.avail[d] = await getPlaytomic(`https://playtomic.com/api/clubs/availability?tenant_id=${TENANT}&date=${d}&sport_id=PADEL`); }
  catch (e) { ptFails++; raw.pt.err = e.message; }
}
if (ptFails < ptDates.length) raw.pt.err = null;
console.log('fabrique failures', ptFails, 'of', ptDates.length, raw.pt.err || '');

const tpl = await readFile(new URL('./template.html', import.meta.url), 'utf8');
const json = JSON.stringify(raw).replace(/</g, '\\u003c');
await mkdir('public', { recursive: true });
await writeFile('public/index.html', tpl.replace('/*DATA*/', json));
console.log('wrote public/index.html');
