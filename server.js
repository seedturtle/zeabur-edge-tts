/**
 * zeabur-edge-tts v1.1.0
 * Pure WebSocket Edge TTS — no TypeScript/npm packages needed
 * Only uses: express + ws (both pure JS)
 */
import express from 'express';
import cors from 'cors';
import { WebSocket } from 'ws';
import crypto from 'crypto';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const DEFAULT_VOICE = 'zh-TW-HsiaoNeural';
const WS_URL = 'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0';

function uuid() {
  return crypto.randomUUID().replaceAll('-', '');
}

function ssml(text, voice, rate, pitch, volume) {
  const rateStr = rate   ? `rate="${rate}"`   : '';
  const pitchStr = pitch ? `pitch="${pitch}"` : '';
  const volStr = volume ? `volume="${volume}"` : '';
  const prosodyAttrs = [rateStr, pitchStr, volStr].filter(Boolean).join(' ');
  const prosodyOpen = prosodyAttrs ? `<prosody ${prosodyAttrs}>` : '<prosody>';
  const prosodyClose = prosodyAttrs ? '</prosody>' : '</prosody>';
  // Extract language from voice (e.g. zh-TW-HsiaoNeural -> zh-TW)
  const lang = voice.split('-').slice(0, 2).join('-');
  return `X-RequestId:${uuid()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toISOString()}\r\nPath:ssml\r\n\r\n<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voice}'>${prosodyOpen}${text}${prosodyClose}</voice></speak>`;
}

function synthesizeEdgeTTS(text, voice, rate, pitch, volume) {
  return new Promise((resolve, reject) => {
    const audioChunks = [];
    const ws = new WebSocket(WS_URL + `&ConnectionId=${uuid()}`, {
      headers: {
        'User-Agent': UA,
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      }
    });

    let settled = false;
    const cleanup = () => { try { ws.close(); } catch(e) {} };

    ws.on('open', () => {
      // Send speech config
      const config = `X-Timestamp:${new Date().toISOString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`;
      ws.send(config);

      // Send SSML
      ws.send(ssml(text, voice, rate, pitch, volume));
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const str = data.toString('utf8');
        const sep = 'Path:audio\r\n';
        const idx = str.indexOf(sep);
        if (idx !== -1) {
          audioChunks.push(data.subarray(idx + sep.length));
        }
      } else {
        const msg = data.toString('utf8');
        if (msg.includes('turn.end')) {
          if (!settled) {
            settled = true;
            cleanup();
            resolve(Buffer.concat(audioChunks));
          }
        } else if (msg.includes('error') || msg.includes('Error')) {
          if (!settled) {
            settled = true;
            cleanup();
            reject(new Error('Edge TTS error: ' + msg));
          }
        }
      }
    });

    ws.on('error', (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    });

    ws.on('close', () => {
      if (!settled && audioChunks.length > 0) {
        settled = true;
        resolve(Buffer.concat(audioChunks));
      } else if (!settled) {
        settled = true;
        reject(new Error('WebSocket closed without audio'));
      }
    });

    // 15 second timeout
    setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('Edge TTS timeout (15s)'));
      }
    }, 15000);
  });
}

app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.1.0' }));

app.post('/tts', async (req, res) => {
  const { text, voice = DEFAULT_VOICE, rate, pitch, volume } = req.body;

  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > 10000) {
    return res.status(400).json({ error: 'text too long (max 10000 chars)' });
  }

  try {
    const buf = await synthesizeEdgeTTS(text.trim(), voice, rate, pitch, volume);
    res.set('Content-Type', 'audio/mpeg');
    res.set('Content-Length', buf.length.toString());
    res.set('X-Voice-Used', voice);
    res.set('Access-Control-Allow-Origin', '*');
    res.send(buf);
  } catch (err) {
    console.error('TTS error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get('/voices', (req, res) => {
  // Return commonly used Chinese voices
  const voices = [
    { name: 'zh-TW-HsiaoNeural',    friendlyName: 'Hsiao (Taiwan)',        locale: 'zh-TW' },
    { name: 'zh-CN-XiaoxiaoNeural', friendlyName: 'Xiaoxiao (China)',     locale: 'zh-CN' },
    { name: 'zh-CN-YunxiNeural',   friendlyName: 'Yunxi (China Male)',   locale: 'zh-CN' },
    { name: 'zh-CN-YunyangNeural',  friendlyName: 'Yunyang (China News)', locale: 'zh-CN' },
    { name: 'zh-TW-Yun-zeNeural',   friendlyName: 'Yun-ze (Taiwan)',    locale: 'zh-TW' },
  ];
  res.json({ voices });
});

app.listen(8080, '0.0.0.0', () => {
  console.log('zeabur-edge-tts v1.1.0 ready on 0.0.0.0:8080');
});
