import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
})

export const config = {
  api: { bodyParser: true }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { cvContent, customerEmail } = req.body;

  if (!cvContent || cvContent.length < 50) {
    return res.status(400).json({ error: 'CV content too short' });
  }

  // Guardamos el CV en Redis con el email como key (expira en 24hs)
  if (customerEmail) {
    await redis.set(`cv:${customerEmail}`, cvContent, { ex: 86400 });
  }

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1500,
        messages: [{
          role: 'user',
          content: `You are a brutally honest senior recruiter. Analyze this resume and respond ONLY with a JSON object, no markdown, no extra text:
{
  "score": <number 1-100>,
  "verdict_title": "<5-8 word brutal verdict>",
  "verdict_desc": "<2 sentence overall assessment>",
  "roasts": [
    { "category": "FIRST IMPRESSION", "text": "<2-3 sentences>" },
    { "category": "EXPERIENCE SECTION", "text": "<2-3 sentences>" },
    { "category": "SKILLS & BUZZWORDS", "text": "<2-3 sentences>" },
    { "category": "THE FATAL FLAW", "text": "<2-3 sentences>" }
  ]
}

Resume:
${cvContent}`
        }]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    const rawText = data.content[0].text;
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const result = JSON.parse(cleaned);
    return res.status(200).json(result);

  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
