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

  try {
    const event = req.body;

    if (event.meta?.event_name !== 'order_created') {
      return res.status(200).json({ received: true });
    }

    const customerEmail = event.data?.attributes?.user_email;

    if (!customerEmail) {
      return res.status(200).json({ received: true });
    }

    const cvContent = await redis.get(`cv:${customerEmail}`);

    if (!cvContent) {
      console.error('CV not found for:', customerEmail);
      return res.status(200).json({ received: true });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 3000,
        messages: [{
          role: 'user',
          content: `You are an expert resume writer. Rewrite this resume to be ATS-optimized, powerful, and interview-ready.

Rules:
- Keep all real experience and facts
- Rewrite bullet points to show achievements not duties
- Use strong action verbs
- Add relevant keywords for ATS
- Write a compelling professional summary
- Make it concise and impactful

Return ONLY the rewritten resume as plain text, ready to copy-paste. No explanations, no markdown, just the resume.

Original resume:
${cvContent}`
        }]
      })
    });

    const data = await response.json();
    const fixedCV = data.content[0].text;

    await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: 'service_9af93co',
        template_id: 'template_mh6mgwq',
        user_id: 'eiENqjftW_C-RJ3nb',
        template_params: {
          customer_email: customerEmail,
          cv_content: fixedCV
        }
      })
    });

    await redis.del(`cv:${customerEmail}`);

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
