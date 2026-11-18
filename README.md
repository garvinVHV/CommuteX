# CommuteX

Delhi NCR commute copilot: chat a trip, get the cheapest or fastest metro route, live road traffic, honest price ranges, ticket handoff, alarms and trip sharing.

## Run it (Windows, Mac or Linux; no GPU needed)
1. Install **Node.js 24 LTS** (22.13+ works) from https://nodejs.org. SQLite is built into Node, so there is nothing else to install.
2. Unzip, open the folder in VS Code, open the terminal.
3. Copy `.env.example` to `.env` and fill it in:
   - `GEMINI_API_KEY` (free: https://aistudio.google.com/apikey) **or** `OPENAI_API_KEY` + `OPENAI_MODEL`. **Required.** The server refuses to start without one.
   - `TOMTOM_KEY` (free: https://developer.tomtom.com) for live road traffic. Without it traffic is only estimated.
   - `NMRC_WHATSAPP`: please verify this against nmrcnoida.com or a poster at a Noida Metro station.
4. `npm install`, then `npm start`, then open http://localhost:3000

## On your phone
Phones only allow GPS, push and microphone on HTTPS. Run `npx cloudflared tunnel --url http://localhost:3000` and open the https link it prints. Your laptop and the server must stay on.

## What it does
- **Chat** (English, Hindi, Hinglish): "from Gurugram Worldmark to Bennett University", "but reach by 6pm", "which stations do I change at?", "alarm for my 9am class at Amity tomorrow".
- **Prices**: cab, auto, bike and e-rickshaw estimates shown as ranges. Factors: peak hours, late night, rain, festival dates (edit `FESTIVALS` in `metro.js`), traffic. Tap **I paid** on a cab or auto step; after 3 reports the estimates calibrate to real prices.
- **Metro tickets**: shows the station pair and fare, with WhatsApp buttons for DMRC (9650855800) and Noida Metro. You type the two stations into the official bot yourself. A "buy now" nudge appears as you near the boarding station.
- **Alarms**: by chat or the Alarms panel. With a venue, they ring when you need to *leave*. Allow notifications and they also ring with the tab closed (the server must be running).
- **Timetable photo**: Alarms panel > Upload a timetable photo. The AI reads it and sets this week's alarms.
- **Voice**: mic button (Chrome/Edge only), English or Hindi.
- **Share trip**: WhatsApp message with ETA and your location link.
- **Weather, AQI and festival** pill in the header; last-mile alternatives under each cab/auto step.
- **Demo helpers**: tap Start trip, then type `simulate`. Fake a metro delay: `curl -X POST localhost:3000/api/advisory -H "Content-Type: application/json" -d "{\"line\":\"Blue\",\"delay_min\":15,\"note\":\"Signal fault\"}"`

## Honest limits
- Uber cannot be booked automatically without Uber's partner approval; the app opens Uber with pickup and drop filled in.
- Prices are estimates, not live quotes from Uber, Ola or Rapido.
- DMRC has no public live-train feed, so metro delays come from your advisories and peak-hour estimates only.
- Metro data is a demo set (3 lines, about 36 stations, approximate coordinates). The Aqua Line is not included yet.
