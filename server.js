/**
 * zeabur-edge-tts
 * HTTP proxy for Microsoft Edge TTS
 * Deploy to Zeabur (port 8080)
 *
 * POST /tts
 * Body: { text: string, voice?: string, rate?: string, pitch?: string }
 * Returns: audio/mpeg MP3
 */

import express from 'express';
import cors from 'cors';
import { tts } from 'edge-tts';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const DEFAULT_VOICE = 'zh-TW-HsiaoNeural';

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'zeabur-edge-tts' }));

app.post('/tts', async (req, res) => {
  const { text, voice = DEFAULT_VOICE, rate, pitch } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > 10000) {
    return res.status(400).json({ error: 'text too long (max 10000 chars)' });
  }

  try {
    const opts = { voice };
    if (rate)  opts.rate  = rate;
    if (pitch) opts.pitch = pitch;

    const buf = await tts(text.trim(), opts);
    if (!buf || buf.length === 0) {
      return res.status(502).json({ error: 'No audio received' });
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

const PORT = 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`zeabur-edge-tts listening on port ${PORT}`);
});
