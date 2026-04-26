/**
 * zeabur-edge-tts
 * HTTP proxy for Microsoft Edge TTS (uses edge-tts-universal)
 * Deploy to Zeabur — binds to $PORT (default 3000)
 * 
 * POST /tts
 * Body: { text: string, voice: string (optional), rate?: string, pitch?: string }
 * Returns: audio/mpeg MP3 file
 */

import express from 'express';
import cors from 'cors';
import { UniversalCommunicate } from 'edge-tts-universal';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const DEFAULT_VOICE = 'zh-TW-HsiaoNeural';

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'zeabur-edge-tts' }));

app.post('/tts', async (req, res) => {
  const { text, voice = DEFAULT_VOICE, rate, pitch, volume } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'text is required' });
  }

  if (text.length > 10000) {
    return res.status(400).json({ error: 'text too long (max 10000 chars)' });
  }

  const chunks = [];
  try {
    const opts = { voice };
    if (rate)  opts.rate  = rate;
    if (pitch) opts.pitch = pitch;
    if (volume) opts.volume = volume;

    const tts = new UniversalCommunicate(text.trim(), opts);

    for await (const chunk of tts.stream()) {
      if (chunk.type === 'audio' && chunk.data) {
        chunks.push(Buffer.from(chunk.data));
      }
    }

    const buf = Buffer.concat(chunks);
    if (buf.length === 0) {
      return res.status(502).json({ error: 'No audio received from Edge TTS service' });
    }

    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Length', buf.length.toString());
    res.set('X-Voice-Used', voice);
    res.set('Access-Control-Allow-Origin', '*');
    res.send(buf);

  } catch (err) {
    console.error('Edge TTS error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get('/voices', async (req, res) => {
  try {
    const { listVoicesUniversal } = await import('edge-tts-universal');
    const voices = await listVoicesUniversal();
    // Return just Chinese + English voices to keep it simple
    const filtered = voices.filter(v =>
      v.Locale.startsWith('zh') || v.Locale.startsWith('en')
    );
    res.json({ voices: filtered });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

const PORT = parseInt(process.env.PORT || '8080', 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Zeabur Edge TTS listening on port ${PORT}`);
  console.log(`POST /tts with { text, voice, rate, pitch }`);
});
