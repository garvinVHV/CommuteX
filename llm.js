import fs from 'node:fs';
const G = process.env.GEMINI_API_KEY, O = process.env.OPENAI_API_KEY;
export const llmName = G ? 'Gemini' : O ? 'OpenAI' : null;
const KB = fs.existsSync('knowledge.txt') ? fs.readFileSync('knowledge.txt', 'utf8').slice(0, 20000) : '';

async function ask(sys, text, img, ms = 12000) {
  const post = (u, h, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b), signal: AbortSignal.timeout(ms) }).then(r => r.json());
  let j, raw;
  if (G) {
    const parts = [{ text }]; if (img) parts.unshift({ inline_data: { mime_type: img.mime, data: img.b64 } });
    j = await post(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-3.8-flash'}:generateContent`, { 'x-goog-api-key': G },
      { systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json' } });
    if (j.error) throw new Error(j.error.message); raw = j.candidates?.[0]?.content?.parts?.filter(p => !p.thought).map(p => p.text).join('');
  } else {
    const content = img ? [{ type: 'text', text }, { type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.b64}` } }] : text;
    j = await post('https://api.openai.com/v1/chat/completions', { Authorization: `Bearer ${O}` },
      { model: process.env.OPENAI_MODEL || 'gpt-4o-mini', response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content }] });
    if (j.error) throw new Error(j.error.message); raw = j.choices?.[0]?.message?.content;
  }
  return JSON.parse(raw);
}

const system = (ctx, now, live) => `You are the language parser and assistant for CommuteX, a Delhi NCR trip planner (metro, auto, cab, bike taxi). Users may write English, Hindi or Hinglish.
Current date and time in India: ${now}. Live conditions: ${live}. Previous trip in this chat: ${ctx ? JSON.stringify(ctx) : 'none'}.
Reply with JSON only, in this exact shape:
{"intent":"route"|"chat"|"alarm","from":string|null,"to":string|null,"deadline":"HH:MM" (24h IST) or null,"prefer":"cheapest"|"fastest"|null,"reply":string|null,"title":string|null,"event_time":"YYYY-MM-DDTHH:MM" in IST or null,"dest":string|null,"lead_min":number|null}
- intent "route": the user wants to travel. Put places in from/to as short searchable names, e.g. "Gurugram Worldmark". Use "my location" if they start from where they are. If they only add a deadline or preference, keep from/to from the previous trip.
- intent "alarm": an alarm or reminder for an event or class. Fill title, event_time (resolve tomorrow or weekdays from the current date), dest (where, if stated) and lead_min only if they gave explicit minutes before.
- intent "chat": use this for ANY conversational request, general questions, local recommendations, or if the user is just chatting normally. Reply naturally in "reply". Only use "route" if they are explicitly asking for directions between two places.
Facts:
${KB}`;

export async function understand(text, ctx, now, live) {
  try { return await ask(system(ctx, now, live), text); }
  catch (e) { console.warn('AI call failed, using built-in parser:', e.message); return null; }
}
export const readTimetable = (b64, mime) => ask('You read class or event timetable images. Return JSON only: {"events":[{"title":string,"day":"Monday" to "Sunday","time":"HH:MM" (24h start time),"place":string|null}]}. Include every distinct weekly slot; skip breaks.', 'Extract the timetable.', { b64, mime }, 45000);
