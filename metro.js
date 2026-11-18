// DEMO DATA: coordinates are approximate and only a handful of stations are listed.
// For production, load the DMRC static GTFS feed (https://otd.delhi.gov.in) into SQLite instead.
export const LINES = {
  Yellow: { color: '#F5C518', stops: ['Huda City Centre','IFFCO Chowk','MG Road','Sikanderpur','Guru Dronacharya','Arjan Garh','Ghitorni','Sultanpur','Chhatarpur','Qutub Minar','Saket','Malviya Nagar','Hauz Khas','Green Park','AIIMS','INA','Central Secretariat','Rajiv Chowk'] },
  Blue: { color: '#2D7BF0', stops: ['Rajiv Chowk','Mandi House','Yamuna Bank','Akshardham','Mayur Vihar-I','Noida Sector 15','Noida Sector 16','Noida Sector 18','Botanical Garden','Golf Course','Noida City Centre','Noida Sector 34','Noida Sector 52','Noida Sector 61','Noida Sector 59','Noida Sector 62'] },
  Magenta: { color: '#E0489E', stops: ['Hauz Khas','Kalkaji Mandir','Kalindi Kunj','Okhla Bird Sanctuary','Botanical Garden'] },
  Aqua: { color: '#65C2B7', stops: ['Noida Sector 51', 'Knowledge Park II', 'Pari Chowk', 'Depot Station'] }
};

export const STATIONS = {
  'Huda City Centre':[28.4592,77.0724],'IFFCO Chowk':[28.4723,77.0723],'MG Road':[28.4796,77.0803],'Sikanderpur':[28.4817,77.0935],
  'Guru Dronacharya':[28.4818,77.1022],'Arjan Garh':[28.4807,77.1250],'Ghitorni':[28.4939,77.1488],'Sultanpur':[28.4986,77.1613],
  'Chhatarpur':[28.5069,77.1747],'Qutub Minar':[28.5128,77.1858],'Saket':[28.5206,77.2012],'Malviya Nagar':[28.5283,77.2059],
  'Hauz Khas':[28.5435,77.2066],'Green Park':[28.5588,77.2066],'AIIMS':[28.5663,77.2073],'INA':[28.5754,77.2094],
  'Central Secretariat':[28.6149,77.2123],'Rajiv Chowk':[28.6328,77.2197],'Mandi House':[28.6254,77.2347],'Yamuna Bank':[28.6233,77.2680],
  'Akshardham':[28.6178,77.2795],'Mayur Vihar-I':[28.6044,77.2943],'Noida Sector 15':[28.5855,77.3118],'Noida Sector 16':[28.5788,77.3174],
  'Noida Sector 18':[28.5708,77.3260],'Botanical Garden':[28.5640,77.3340],'Golf Course':[28.5619,77.3418],'Noida City Centre':[28.5746,77.3561],
  'Noida Sector 34':[28.5826,77.3623],'Noida Sector 52':[28.5895,77.3667],'Noida Sector 61':[28.6000,77.3731],'Noida Sector 59':[28.6089,77.3741],
  'Noida Sector 62':[28.6260,77.3650],'Kalkaji Mandir':[28.5494,77.2586],'Kalindi Kunj':[28.5427,77.3145],'Okhla Bird Sanctuary':[28.5545,77.3258],
  'Noida Sector 51': [28.5843, 77.3649], 'Knowledge Park II': [28.4770, 77.5028], 'Pari Chowk': [28.4688, 77.5143], 'Depot Station': [28.4445, 77.5452]
};

// Quick place lookup (matched by keyword). Anything else falls back to OpenStreetMap Nominatim.
export const PLACES = {
  'worldmark': { name: 'Worldmark, Sector 65, Gurugram', ll: [28.4054, 77.0587] },
  'bennett': { name: 'Bennett University, Greater Noida', ll: [28.4496, 77.5836] },
  'amity': { name: 'Amity University, Sector 125, Noida', ll: [28.5442, 77.3337] },
  'cyber hub': { name: 'Cyber Hub, Gurugram', ll: [28.4950, 77.0890] },
  'connaught': { name: 'Connaught Place, Delhi', ll: [28.6315, 77.2167] },
  'india gate': { name: 'India Gate, Delhi', ll: [28.6129, 77.2295] },
  'airport': { name: 'IGI Airport T3, Delhi', ll: [28.5562, 77.1000] },
  'hauz khas': { name: 'Hauz Khas Village, Delhi', ll: [28.5535, 77.1943] },
  'saket': { name: 'Select Citywalk, Saket', ll: [28.5285, 77.2193] },
  'sector 18': { name: 'Sector 18, Noida', ll: [28.5708, 77.3260] },
  'new delhi railway': { name: 'New Delhi Railway Station', ll: [28.6425, 77.2194] }
};

// Dates where cab/auto prices usually rise. surge = extra multiplier. Fixed-date ones are safe; VERIFY moving festivals (Diwali, Holi...) each year.
export const FESTIVALS = [
  { date: '2026-11-08', name: 'Diwali', surge: 0.4 }, { date: '2026-12-25', name: 'Christmas', surge: 0.15 },
  { date: '2026-12-31', name: 'New Year\u2019s Eve', surge: 0.5 }, { date: '2027-01-26', name: 'Republic Day', surge: 0.2 },
  { date: '2027-03-22', name: 'Holi', surge: 0.15 }, { date: '2027-08-15', name: 'Independence Day', surge: 0.2 }
];